"""Character CRUD and stat management — session-aware version."""
import random
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    Session, Character, CharacterEffect, StatModifier,
    AttackModifier, DamageModifier, TurnTimer, InventoryItem,
    CharacterStatusEffect,
)
from app.schemas import CharacterCreate, CharacterUpdate, HpPatch, ModifierCreate, EffectCreate, TimerCreate
from app.game_mechanics import get_all_active_bonuses, aggregate_status_penalties, apply_advantage, format_advantage_breakdown, resolve_advantage_mode

router = APIRouter(prefix="/api", tags=["characters"])


# ── Expired-potion cleanup ───────────────────────────────────
# Bug fix (Apr 2026): potion-sourced StatModifier rows carry an
# `expires_at` wall-clock timestamp, but the only place that deleted
# expired rows was `_process_participant_turn_end` in combat_events.
# If the player drank the potion outside combat (or combat ended
# before expiration), the row lingered with `is_active=True` and the
# bonus kept applying forever. Reproduced: a character showed +4 STR
# from an `Elixir of Giants boost` 6 days after it should have worn off.
#
# Fix strategy: reap expired rows on EVERY `GET /characters/{id}`
# (the hottest read path — both the GM and player sheets poll it
# constantly). The sweep is cheap: one indexed DELETE per call.
async def _expire_stale_potion_mods(char_id: int, db: AsyncSession) -> int:
    """Delete any expired potion stat-mods for this character.

    Returns the number of rows deleted. Safe to call anywhere — a
    no-op when there are no expired rows. We compare against a naive
    UTC `now` because SQLite's DateTime column strips timezone on
    storage, so an aware comparison would mismatch on some drivers.
    """
    now_naive = datetime.now(timezone.utc).replace(tzinfo=None)
    result = await db.execute(
        sa_delete(StatModifier).where(
            StatModifier.character_id == char_id,
            StatModifier.source == "potion",
            StatModifier.expires_at.is_not(None),
            StatModifier.expires_at <= now_naive,
        )
    )
    return int(result.rowcount or 0)


# ── Helper: serialize character ──────────────────────────────
def _serialize_char(c: Character) -> dict:
    return {
        "id": c.id,
        "session_id": c.session_id,
        "name": c.name,
        "is_npc": c.is_npc,
        "armor_class": c.armor_class,
        "current_hp": c.current_hp,
        "max_hp": c.max_hp,
        "strength": c.strength,
        "dexterity": c.dexterity,
        "constitution": c.constitution,
        "intelligence": c.intelligence,
        "wisdom": c.wisdom,
        "charisma": c.charisma,
        "initiative_bonus": c.initiative_bonus,
        "token_color": c.token_color,
        "is_alive": c.is_alive,
        "gold": c.gold,
        "gold_copper": c.wealth_bronze,
        "wealth_bronze": c.wealth_bronze,
        "mana_current": c.mana_current,
        "mana_max": c.mana_max,
        "mana_regen_per_turn": c.mana_regen_per_turn,
        "can_edit_own_items": c.can_edit_own_items,
        "place_at_table": c.place_at_table,
        "is_at_table": c.place_at_table,  # alias for spec compliance
        "show_hp_to_players": c.show_hp_to_players,
        "is_gm_controlled": c.is_gm_controlled,
        "turn_count": c.turn_count,
        "status_effects": c.status_effects,
        "notes": c.notes,
        "gm_notes": c.gm_notes,
        "effects": [
            {"id": e.id, "name": e.name, "effect_type": e.effect_type,
             "value": e.value, "is_active": e.is_active}
            for e in c.effects
        ],
        "race_id": c.race_id,
        "level": c.level,
        "experience": c.experience,
        # Rework v2: cosmetic identity + inventory/decline
        "age": c.age,
        "gender": c.gender,
        "max_inventory_slots": c.max_inventory_slots,
        "declined_stats": bool(c.declined_stats),
        # Rework Phase 1: rank chain + Phase 4: multi-profession list
        "rank": getattr(c, "rank", "common") or "common",
        "professions": [
            {
                "id": cp.id,
                "class_id": cp.class_id,
                "level": cp.level,
                "is_active": cp.is_active,
                "name": getattr(cp.character_class, "name", None) if cp.character_class else None,
            }
            for cp in (c.professions or [])
        ],
        "stat_modifiers": [
            {"id": m.id, "stat_name": m.stat_name, "name": m.name,
             "value": m.value, "is_active": m.is_active, "source": m.source,
             "expires_at": m.expires_at.isoformat() if m.expires_at else None}
            for m in c.stat_modifiers
        ],
        "attack_modifiers": [
            {"id": m.id, "name": m.name, "value": m.value, "is_active": m.is_active}
            for m in c.attack_modifiers
        ],
        "damage_modifiers": [
            {"id": m.id, "name": m.name, "value": m.value, "is_active": m.is_active}
            for m in c.damage_modifiers
        ],
        "turn_timers": [
            {"id": t.id, "name": t.name, "initial_value": t.initial_value,
             "current_value": t.current_value, "is_active": t.is_active}
            for t in c.turn_timers
        ],
    }


# ── Get character ────────────────────────────────────────────
@router.get("/characters/{char_id}")
async def get_character(char_id: int, db: AsyncSession = Depends(get_session)):
    from app.models import Race
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    # Bug fix (Apr 2026): sweep expired potion stat-mods before we
    # serialize so the sheet never shows a bonus that should have
    # faded. If anything got reaped, commit + refresh the row so the
    # ORM re-loads `stat_modifiers` without the stale entries.
    if await _expire_stale_potion_mods(char_id, db):
        await db.commit()
        await db.refresh(c)
    payload = _serialize_char(c)
    # Rework v2: surface race HP die for the level-up preview.
    hp_die, hp_dice_count, race_name = 8, 1, None
    if c.race_id:
        race = await db.get(Race, c.race_id)
        if race:
            hp_die = int(race.hp_die or 8)
            hp_dice_count = int(race.hp_dice_count or 1)
            race_name = race.name
    payload["hp_die"] = hp_die
    payload["hp_dice_count"] = hp_dice_count
    payload["race_name"] = race_name
    payload["xp_to_next"] = xp_to_next(c.level)
    return payload


# ── Update character ─────────────────────────────────────────
@router.put("/characters/{char_id}")
@router.patch("/characters/{char_id}")
async def update_character(char_id: int, body: CharacterUpdate, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    # Snapshot CON before the write so we can ripple the delta through to the
    # inventory slot cap using the canonical formula (+2 slots per +1 CON).
    # We intentionally apply a DELTA to preserve any GM override already on
    # max_inventory_slots (e.g. magical boon). Skip for NPC unlimited (=0) or
    # if the caller explicitly sends max_inventory_slots in the same payload.
    patch = body.model_dump(exclude_unset=True)
    old_con = int(c.constitution or 0)
    for field, val in patch.items():
        # Map legacy gold_copper → wealth_bronze
        if field == "gold_copper":
            c.wealth_bronze = val
            continue
        setattr(c, field, val)
    if "constitution" in patch and "max_inventory_slots" not in patch:
        new_con = int(c.constitution or 0)
        con_delta = new_con - old_con
        if con_delta and int(c.max_inventory_slots or 0) > 0:
            c.max_inventory_slots = max(0, int(c.max_inventory_slots) + 2 * con_delta)
    await db.commit()
    await db.refresh(c)
    return _serialize_char(c)


# ── HP patch ─────────────────────────────────────────────────
@router.patch("/characters/{char_id}/hp")
async def patch_hp(char_id: int, body: HpPatch, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    if body.set is not None:
        c.current_hp = max(0, min(body.set, c.max_hp))
    elif body.delta is not None:
        c.current_hp = max(0, min(c.current_hp + body.delta, c.max_hp))
    c.is_alive = c.current_hp > 0
    await db.commit()
    await db.refresh(c)
    return {"current_hp": c.current_hp, "max_hp": c.max_hp, "is_alive": c.is_alive}


# ── Mana restore ────────────────────────────────────────────
@router.post("/characters/{char_id}/restore-mana")
async def restore_mana_endpoint(char_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    from app.game_mechanics import restore_mana, get_effective_mana_max
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    eff_max = get_effective_mana_max(c.mana_max)
    if body.get("full"):
        c.mana_current = restore_mana(c.mana_current, eff_max, full=True)
    else:
        amount = body.get("amount", 0)
        c.mana_current = restore_mana(c.mana_current, eff_max, amount=amount)
    await db.commit()
    await db.refresh(c)
    return {"mana_current": c.mana_current, "mana_max": c.mana_max, "effective_mana_max": eff_max}


# ── Mana spend ──────────────────────────────────────────────
@router.post("/characters/{char_id}/spend-mana")
async def spend_mana_endpoint(char_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    from app.game_mechanics import spend_mana, get_effective_mana_max
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    cost = body.get("cost", 0)
    eff_max = get_effective_mana_max(c.mana_max)
    result = spend_mana(c.mana_current, eff_max, cost)
    if not result["success"]:
        raise HTTPException(400, result)
    c.mana_current = result["mana_current"]
    await db.commit()
    await db.refresh(c)
    return {"mana_current": c.mana_current, "mana_max": c.mana_max, "effective_mana_max": eff_max}


# ══════════════════════════════════════════════════════════════
# Rework Phase 8 — XP / LEVEL / RANK progression
# ══════════════════════════════════════════════════════════════
RANK_CHAIN = [
    "common", "uncommon", "rare", "epic", "legendary", "mythic", "divine",
]


def xp_to_next(level: int) -> int:
    """Rework spec: threshold = 100 + 100 * level (Lvl 0 → 1 = 100, Lvl 10 → 11 = 1100)."""
    return 100 + 100 * max(0, int(level or 0))


def _next_rank(rank: str) -> str | None:
    r = (rank or "common").lower()
    try:
        idx = RANK_CHAIN.index(r)
    except ValueError:
        return None
    return RANK_CHAIN[idx + 1] if idx + 1 < len(RANK_CHAIN) else None


async def _broadcast_char(session_id: int, character_id: int):
    try:
        from app.websocket_manager import manager as _ws
        await _ws.broadcast(session_id, {"event": "character.update", "character_id": character_id})
    except Exception:
        pass


@router.post("/characters/{char_id}/grant-xp")
async def grant_xp(char_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    """GM grants XP. Level does NOT auto-increment — GM decides when to level up."""
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    amount = int(body.get("amount", 0) or 0)
    c.experience = max(0, (c.experience or 0) + amount)
    await db.commit()
    await db.refresh(c)
    await _broadcast_char(c.session_id, c.id)
    return {
        "experience": c.experience,
        "level": c.level,
        "rank": getattr(c, "rank", "common"),
        "xp_to_next": xp_to_next(c.level or 0),
    }


@router.post("/characters/{char_id}/level-up")
async def level_up(char_id: int, body: dict | None = None, db: AsyncSession = Depends(get_session)):
    """Rework v2: level-up rolls a race HP die and applies ONE chosen benefit.

    Body:
      {
        "choice": "stats" | "upgrade_feature",
        "stat_a": "strength",            # required for "stats"
        "stat_b": "dexterity",           # required for "stats" (must differ from stat_a)
        "character_ability_id": 17,      # required for "upgrade_feature"
        "force": false                   # optional GM bypass of the XP threshold
      }
    Return: {level, hp_rolls, hp_gained, chosen, ...}
    """
    import random
    from app.models import Race, Ability, CharacterAbility, StatModifier

    body = body or {}
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    cur_level = int(c.level or 0)
    threshold = xp_to_next(cur_level)
    if not body.get("force") and (c.experience or 0) < threshold:
        raise HTTPException(400, {
            "message": "Not enough XP",
            "have": c.experience or 0,
            "need": threshold,
        })

    choice = str(body.get("choice", "")).lower()
    if choice not in ("stats", "upgrade_feature"):
        raise HTTPException(400, "`choice` must be 'stats' or 'upgrade_feature'")

    # ── 1. Roll the race HP die (+ apply to max & current)
    hp_die = 8
    hp_dice_count = 1
    if c.race_id:
        race = await db.get(Race, c.race_id)
        if race:
            hp_die = int(race.hp_die or 8)
            hp_dice_count = int(race.hp_dice_count or 1)
    # Rework v3: passive-ability bonuses may bump the die size or count.
    hp_die_bonus = sum(
        int(m.value or 0) for m in c.stat_modifiers
        if m.is_active and m.stat_name == "hp_die_bonus"
    )
    hp_die_count_bonus = sum(
        int(m.value or 0) for m in c.stat_modifiers
        if m.is_active and m.stat_name == "hp_die_count_bonus"
    )
    hp_die = max(1, hp_die + hp_die_bonus)
    hp_dice_count = max(1, hp_dice_count + hp_die_count_bonus)
    rolls = [random.randint(1, hp_die) for _ in range(max(1, hp_dice_count))]
    hp_gained = sum(rolls)
    c.max_hp += hp_gained
    c.current_hp += hp_gained

    chosen: dict = {"choice": choice, "hp_rolls": rolls, "hp_die": hp_die,
                    "hp_dice_count": hp_dice_count, "hp_gained": hp_gained}

    # ── 2. Apply chosen benefit
    if choice == "stats":
        a = body.get("stat_a")
        b = body.get("stat_b")
        valid = {"strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"}
        if a not in valid or b not in valid or a == b:
            raise HTTPException(400, "Provide two distinct stats (stat_a != stat_b)")
        # Track CON delta so we can bump the inventory slot cap by the same
        # amount as the wizard formula (10 + 2 × CON). We apply a DELTA rather
        # than recompute from scratch to preserve any GM override already on
        # max_inventory_slots (e.g. a +N magical boon).
        old_con = int(c.constitution or 0)
        setattr(c, a, int(getattr(c, a) or 0) + 1)
        setattr(c, b, int(getattr(c, b) or 0) + 1)
        new_con = int(c.constitution or 0)
        con_delta = new_con - old_con
        if con_delta and int(c.max_inventory_slots or 0) > 0:
            c.max_inventory_slots = max(0, int(c.max_inventory_slots) + 2 * con_delta)
            chosen["slots_delta"] = 2 * con_delta
            chosen["max_inventory_slots"] = c.max_inventory_slots
        chosen["stat_a"] = a
        chosen["stat_b"] = b

    else:  # upgrade_feature
        cab_id = body.get("character_ability_id")
        if not cab_id:
            raise HTTPException(400, "`character_ability_id` is required for upgrade_feature")
        cab = await db.get(CharacterAbility, int(cab_id))
        if not cab or cab.character_id != c.id:
            raise HTTPException(404, "Feature not owned by this character")
        old_ab = cab.ability
        if not old_ab:
            raise HTTPException(404, "Feature template missing")

        RANKS = ["common", "uncommon", "rare", "epic", "legendary"]
        cur_rar = (old_ab.rarity or "common").lower()
        if cur_rar not in RANKS or RANKS.index(cur_rar) >= len(RANKS) - 1:
            raise HTTPException(400, "Feature is already at the highest rarity")
        new_rar = RANKS[RANKS.index(cur_rar) + 1]

        # Pull pool at new rarity, same session-or-global scope
        q = await db.execute(
            select(Ability)
            .where(Ability.is_in_starting_pool == True)       # noqa: E712
            .where(Ability.rarity == new_rar)
            .where((Ability.session_id == c.session_id) | (Ability.session_id.is_(None)))
            .order_by(Ability.id)
        )
        pool = list(q.scalars().all())
        if not pool:
            raise HTTPException(
                400,
                f"No {new_rar} feature available to upgrade to. Ask the GM to add some.",
            )
        bucket = pool[:4]
        d_size = len(bucket)
        d_rolled = random.randint(1, d_size)
        new_ab = bucket[d_rolled - 1]

        # Replace the CharacterAbility (same row, new template)
        cab.ability_id = new_ab.id
        cab.current_uses = new_ab.max_uses
        cab.cooldown_remaining = 0
        cab.granted_from = "level_up"
        chosen["character_ability_id"] = cab.id
        chosen["old_ability_id"] = old_ab.id
        chosen["new_ability_id"] = new_ab.id
        chosen["new_rarity"] = new_rar
        chosen["d_size"] = d_size
        chosen["d_rolled"] = d_rolled

    # ── 3. Consume XP + advance level
    c.experience = max(0, (c.experience or 0) - threshold)
    c.level = cur_level + 1

    await db.commit()
    await db.refresh(c)
    await _broadcast_char(c.session_id, c.id)
    return {
        "experience": c.experience,
        "level": c.level,
        "rank": getattr(c, "rank", "common"),
        "xp_to_next": xp_to_next(c.level),
        "max_hp": c.max_hp,
        "current_hp": c.current_hp,
        "chosen": chosen,
    }


@router.post("/characters/{char_id}/rank-up")
async def rank_up(char_id: int, body: dict | None = None, db: AsyncSession = Depends(get_session)):
    """Promote character to the next rank.
    Rules (from update and fix.md):
      * Level == 20 → new level = 1 of next rank.
      * Level < 20 → keep the same level number in the new rank.
      * If level > 15 when promoting → clamp to 15.
      * HP / stats / bonuses are preserved (no auto-scaling here).
    """
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    cur_rank = getattr(c, "rank", "common") or "common"
    nxt = _next_rank(cur_rank)
    if not nxt:
        raise HTTPException(400, "Already at the highest rank (divine)")
    cur_level = int(c.level or 0)
    if cur_level >= 20:
        new_level = 1
    elif cur_level > 15:
        new_level = 15
    else:
        new_level = cur_level
    c.rank = nxt
    c.level = new_level
    await db.commit()
    await db.refresh(c)
    await _broadcast_char(c.session_id, c.id)
    return {
        "rank": c.rank,
        "level": c.level,
        "experience": c.experience,
        "xp_to_next": xp_to_next(c.level),
    }


@router.get("/characters/{char_id}/progression")
async def get_progression(char_id: int, db: AsyncSession = Depends(get_session)):
    """Convenience endpoint: return the full progression snapshot."""
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    return {
        "level": c.level or 0,
        "experience": c.experience or 0,
        "rank": getattr(c, "rank", "common") or "common",
        "xp_to_next": xp_to_next(c.level or 0),
        "next_rank": _next_rank(getattr(c, "rank", "common") or "common"),
    }


# ── Create NPC (GM) ─────────────────────────────────────────
@router.post("/sessions/{code}/npc")
async def create_npc(code: str, body: CharacterCreate, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    npc = Character(
        session_id=session.id,
        name=body.name,
        is_npc=True,
        is_gm_controlled=True,
        armor_class=body.armor_class,
        current_hp=body.max_hp,
        max_hp=body.max_hp,
    )
    db.add(npc)
    await db.commit()
    await db.refresh(npc)
    # Rework v3 Phase 1: ping every map-aware client so the new token
    # appears on the embedded grid without a manual refresh. The
    # self-heal in `GET /api/map/{code}` will assign default
    # coordinates. `map.updated` is the coarse-grained event that both
    # GM and player clients already listen to.
    try:
        from app.websocket_manager import manager
        await manager.broadcast_to_session(code, "map.updated", {"reason": "npc_created"})
    except Exception:
        pass
    return _serialize_char(npc)


# ── Delete character ─────────────────────────────────────────
@router.delete("/characters/{char_id}")
async def delete_character(char_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    # Capture session code before we delete the row, so we can still
    # broadcast afterwards (the relationship becomes unusable post-delete).
    sess_code = None
    try:
        sess = await db.get(Session, c.session_id)
        if sess:
            sess_code = sess.code
    except Exception:
        pass
    await db.delete(c)
    await db.commit()
    if sess_code:
        try:
            from app.websocket_manager import manager
            await manager.broadcast_to_session(sess_code, "map.updated", {"reason": "character_deleted"})
        except Exception:
            pass
    return {"ok": True}


# ── Table visibility (FIX 1) ─────────────────────────────────
class TableVisibilityBody(BaseModel):
    is_at_table: bool | None = None
    place_at_table: bool | None = None  # alias for is_at_table
    show_hp_to_players: bool | None = None


@router.patch("/characters/{char_id}/table-visibility")
async def patch_table_visibility(
    char_id: int,
    body: TableVisibilityBody,
    db: AsyncSession = Depends(get_session),
):
    """FIX 1: Toggle a character's appearance at the player 'table view'
    and whether their HP is visible. Broadcasts WS `table.updated` so
    players re-render their Main-tab table cards immediately.
    The DB column is `place_at_table` — `is_at_table` is accepted as alias.
    Memory auto-entry (FIX 5) is created when an NPC transitions OFF→ON.
    """
    from app.websocket_manager import manager

    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")

    # Detect OFF→ON transition for NPC so FIX 5 can create memory entries
    was_at_table = bool(c.place_at_table)
    transition_to_on = False

    # Accept either is_at_table or place_at_table (alias)
    new_at_table = body.is_at_table if body.is_at_table is not None else body.place_at_table

    if new_at_table is not None:
        c.place_at_table = bool(new_at_table)
        transition_to_on = c.is_npc and (not was_at_table) and c.place_at_table
    if body.show_hp_to_players is not None:
        c.show_hp_to_players = bool(body.show_hp_to_players)

    await db.commit()
    await db.refresh(c)

    # FIX 5: Auto-memory for player characters when NPC placed at table
    if transition_to_on:
        try:
            from app.routers.memory import create_memory_entry
            players_res = await db.execute(
                select(Character).where(
                    Character.session_id == c.session_id,
                    Character.is_npc == False,  # noqa: E712
                )
            )
            players = players_res.scalars().all()
            for p in players:
                await create_memory_entry(
                    db, p.id, "npc_encounter",
                    f"Met: {c.name}",
                    c.notes or f"Encountered {c.name}.",
                    related_npc_id=c.id,
                )
        except Exception as e:
            # Non-fatal — memory is best-effort
            import logging
            logging.getLogger("characters").warning(f"memory auto-entry failed: {e}")

    # Broadcast to all session clients
    try:
        sess = await db.get(Session, c.session_id)
        if sess:
            await manager.broadcast_to_session(sess.code, "table.updated", {
                "character_id": c.id,
                "is_at_table": c.place_at_table,
                "place_at_table": c.place_at_table,
                "show_hp_to_players": c.show_hp_to_players,
            })
    except Exception:
        pass

    return {
        "ok": True,
        "character_id": c.id,
        "is_at_table": c.place_at_table,
        "place_at_table": c.place_at_table,
        "show_hp_to_players": c.show_hp_to_players,
    }


# ══════════════════════════════════════════════════════════════
# MODIFIERS
# ══════════════════════════════════════════════════════════════
@router.post("/characters/{char_id}/modifiers")
async def add_modifier(char_id: int, body: ModifierCreate, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404)
    if body.modifier_type == "stat":
        m = StatModifier(character_id=char_id, stat_name=body.stat_name or "strength", name=body.name, value=body.value)
    elif body.modifier_type == "attack":
        m = AttackModifier(character_id=char_id, name=body.name, value=body.value)
    elif body.modifier_type == "damage":
        m = DamageModifier(character_id=char_id, name=body.name, value=body.value)
    else:
        raise HTTPException(400, "Invalid modifier_type")
    db.add(m)
    await db.commit()
    return {"ok": True}


@router.put("/modifiers/{mod_id}")
async def update_modifier(mod_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    mod_type = body.pop("type", None) or body.pop("modifier_type", "attack")
    table = {"stat": StatModifier, "attack": AttackModifier, "damage": DamageModifier}
    cls = table.get(mod_type)
    if not cls:
        raise HTTPException(400)
    m = await db.get(cls, mod_id)
    if not m:
        raise HTTPException(404)
    for k, v in body.items():
        if hasattr(m, k):
            setattr(m, k, v)
    await db.commit()
    await db.refresh(m)
    return {"ok": True}


@router.delete("/modifiers/{mod_id}")
async def delete_modifier(mod_id: int, type: str = "attack", db: AsyncSession = Depends(get_session)):
    table = {"stat": StatModifier, "attack": AttackModifier, "damage": DamageModifier}
    cls = table.get(type)
    if not cls:
        raise HTTPException(400)
    m = await db.get(cls, mod_id)
    if not m:
        raise HTTPException(404)
    await db.delete(m)
    await db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# EFFECTS
# ══════════════════════════════════════════════════════════════
@router.post("/characters/{char_id}/effects")
async def add_effect(char_id: int, body: EffectCreate, db: AsyncSession = Depends(get_session)):
    e = CharacterEffect(character_id=char_id, name=body.name, effect_type=body.effect_type, value=body.value)
    db.add(e)
    await db.commit()
    return {"ok": True}


@router.put("/effects/{eff_id}")
async def update_effect(eff_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    e = await db.get(CharacterEffect, eff_id)
    if not e:
        raise HTTPException(404)
    for k, v in body.items():
        if hasattr(e, k):
            setattr(e, k, v)
    await db.commit()
    return {"ok": True}


@router.delete("/effects/{eff_id}")
async def delete_effect(eff_id: int, db: AsyncSession = Depends(get_session)):
    e = await db.get(CharacterEffect, eff_id)
    if not e:
        raise HTTPException(404)
    await db.delete(e)
    await db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# TURN TIMERS
# ══════════════════════════════════════════════════════════════
@router.post("/characters/{char_id}/timers")
async def add_timer(char_id: int, body: TimerCreate, db: AsyncSession = Depends(get_session)):
    t = TurnTimer(character_id=char_id, name=body.name, initial_value=body.initial_value, current_value=body.initial_value)
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return {"id": t.id, "name": t.name, "initial_value": t.initial_value, "current_value": t.current_value, "is_active": t.is_active}


@router.put("/timers/{timer_id}")
async def update_timer(timer_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    t = await db.get(TurnTimer, timer_id)
    if not t:
        raise HTTPException(404)
    for k, v in body.items():
        if hasattr(t, k):
            setattr(t, k, v)
    await db.commit()
    await db.refresh(t)
    return {"id": t.id, "name": t.name, "initial_value": t.initial_value, "current_value": t.current_value, "is_active": t.is_active}


@router.delete("/timers/{timer_id}")
async def delete_timer(timer_id: int, db: AsyncSession = Depends(get_session)):
    t = await db.get(TurnTimer, timer_id)
    if not t:
        raise HTTPException(404)
    await db.delete(t)
    await db.commit()
    return {"ok": True}


# ── Advance turn ─────────────────────────────────────────────
@router.post("/characters/{char_id}/advance-turn")
async def advance_turn(char_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404)
    c.turn_count = (c.turn_count or 0) + 1
    # Decrement active timers
    for t in c.turn_timers:
        if t.is_active and t.current_value > 0:
            t.current_value -= 1
    await db.commit()
    await db.refresh(c)
    return _serialize_char(c)


@router.post("/characters/{char_id}/reset-turns")
async def reset_turns(char_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404)
    c.turn_count = 0
    await db.commit()
    await db.refresh(c)
    return _serialize_char(c)


# ══════════════════════════════════════════════════════════════
# STAGE 7 — DICE ROLLING BY CHARACTERISTIC
# ══════════════════════════════════════════════════════════════
class CharacteristicRollBody(BaseModel):
    stat: str  # strength, dexterity, etc.
    roll_type: str = "ability_check"  # ability_check, saving_throw, skill_check
    skill_name: str | None = None
    advantage_mode: str = "normal"  # normal / advantage / disadvantage
    dice_count: int = 1  # Number of dice to roll
    dice_type: int = 20  # Die type (4, 6, 8, 10, 12, 20, 100)


STAT_MAP = {
    "strength": "strength", "dexterity": "dexterity",
    "constitution": "constitution", "intelligence": "intelligence",
    "wisdom": "wisdom", "charisma": "charisma",
}


def _stat_modifier(val: int) -> int:
    """Rework: stat value IS the bonus (no D&D (val-10)//2 formula)."""
    try:
        return int(val or 0)
    except (TypeError, ValueError):
        return 0


@router.post("/characters/{char_id}/roll-characteristic")
async def roll_characteristic(char_id: int, body: CharacteristicRollBody, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")

    stat_key = STAT_MAP.get(body.stat.lower())
    if not stat_key:
        raise HTTPException(400, f"Invalid stat: {body.stat}")

    # Rework v2: stat value IS the bonus (0..N). Missing field falls back to 0.
    base_val = getattr(c, stat_key, 0) or 0
    # Add active stat modifiers (race/class/gm)
    stat_mods = [m for m in c.stat_modifiers if m.stat_name == stat_key and m.is_active]
    mod_from_mods = sum(m.value for m in stat_mods)

    # Item bonuses (stat_bonus_<stat>)
    equipped_result = await db.execute(
        select(InventoryItem).where(
            InventoryItem.character_id == char_id,
            InventoryItem.is_equipped == True,
        )
    )
    equipped = equipped_result.scalars().all()
    item_bonuses = get_all_active_bonuses(equipped)
    item_stat_bonus = int(item_bonuses.get(f"stat_bonus_{stat_key}", 0))

    # Status penalties (stat_penalties)
    import json as _json
    status_result = await db.execute(
        select(CharacterStatusEffect).where(
            CharacterStatusEffect.character_id == char_id,
            CharacterStatusEffect.remaining_turns != 0,  # active effects
        )
    )
    active_effects = status_result.scalars().all()
    effects_list = []
    for se in active_effects:
        try:
            effects_list.append(_json.loads(se.effects) if se.effects else [])
        except Exception:
            effects_list.append([])
    penalties = aggregate_status_penalties(effects_list)
    stat_penalty = penalties.get("stat_penalties", {}).get(stat_key, 0)

    total_stat = base_val + mod_from_mods + item_stat_bonus + stat_penalty
    mod = _stat_modifier(total_stat)

    # Apply advantage/disadvantage with configurable dice
    dice_count = max(1, min(body.dice_count or 1, 20))
    dice_type = body.dice_type or 20
    if dice_type not in (4, 6, 8, 10, 12, 20, 100):
        dice_type = 20

    def _single_roll():
        # Roll dice_count dice of dice_type, sum them, add modifier
        rolls = [random.randint(1, dice_type) for _ in range(dice_count)]
        d = sum(rolls)
        t = d + mod
        return t, rolls if dice_count > 1 else rolls[0]

    effective_adv = resolve_advantage_mode(body.advantage_mode or "normal", penalties)
    adv = apply_advantage(_single_roll, effective_adv)
    d20 = adv.all_details[adv.chosen_index]
    total = adv.chosen_total
    dice_label = f"{dice_count}d{dice_type}" if dice_count > 1 else f"D{dice_type}"
    adv_breakdown = format_advantage_breakdown(
        effective_adv, list(adv.all_details), adv.chosen_index, dice_label
    )

    # Build detailed breakdown
    roll_label = body.roll_type.replace("_", " ").title()
    stat_label = stat_key.capitalize()
    skill_part = f" ({body.skill_name})" if body.skill_name else ""

    # Format dice result display
    if isinstance(d20, list):
        dice_display = f"{dice_label}[{','.join(str(r) for r in d20)}]={sum(d20)}"
    else:
        dice_display = f"{dice_label}({d20})"
    breakdown_parts = [dice_display]
    breakdown_parts.append(f"{stat_label} mod({mod:+d})")
    # Sources for the mod
    source_details = []
    if mod_from_mods:
        race_class = [m for m in stat_mods if m.source in ('race', 'class')]
        for m in race_class:
            source_details.append(f"{m.name or m.source.title()}({m.value:+d})")
    if item_stat_bonus:
        for b in item_bonuses.get("breakdown", []):
            if b.get("bonus_type") == "stat_bonus" and b.get("stat_name") == stat_key:
                source_details.append(f"{b['source']}({int(b['value']):+d})")
    if stat_penalty:
        source_details.append(f"Status({stat_penalty:+d})")

    detail_str = ", ".join(source_details)
    if detail_str:
        detail_str = f" [{detail_str}]"

    adv_prefix = f" ({adv_breakdown})" if adv_breakdown else ""
    description = f"{c.name} {stat_label} {roll_label}{skill_part}{adv_prefix}: {' + '.join(breakdown_parts)}{detail_str} = {total}"

    return {
        "character_id": c.id,
        "character_name": c.name,
        "stat": stat_key,
        "stat_value": total_stat,
        "modifier": mod,
        "d20": d20,
        "dice_count": dice_count,
        "dice_type": dice_type,
        "total": total,
        "roll_type": body.roll_type,
        "skill_name": body.skill_name,
        "description": description,
        "advantage_mode": effective_adv,
        "all_d20s": list(adv.all_details),
        "chosen_d20_index": adv.chosen_index,
        "advantage_breakdown": adv_breakdown,
        "breakdown": {
            "base_stat": base_val,
            "modifier_bonus": mod_from_mods,
            "item_stat_bonus": item_stat_bonus,
            "status_penalty": stat_penalty,
            "effective_stat": total_stat,
            "stat_modifier": mod,
            "sources": source_details,
        },
    }
