"""Helpers, serializers, basic CRUD, imports"""

"""Character CRUD and stat management — session-aware version."""
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    Character,
    StatModifier,
)
from app.schemas import CharacterUpdate, HpPatch

router = APIRouter(prefix="/api", tags=["characters"])


def xp_to_next(level: int) -> int:
    """Rework spec: threshold = 100 + 100 * level (Lvl 0 → 1 = 100, Lvl 10 → 11 = 1100)."""
    return 100 + 100 * max(0, int(level or 0))


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
    now_naive = datetime.now(UTC).replace(tzinfo=None)
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
        "spiritual_hp": c.spiritual_hp,
        "spiritual_max_hp": c.spiritual_max_hp,
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
        "attribute_points_available": getattr(c, "attribute_points_available", 0) or 0,
        "kill_xp_reward": getattr(c, "kill_xp_reward", 0) or 0,
        # Rework Phase 1: rank chain + Phase 4: multi-profession list
        "map_x": getattr(c, "map_x", None),
        "map_y": getattr(c, "map_y", None),
        "current_location_id": getattr(c, "current_location_id", None),
        "col": getattr(c, "col", None),
        "row": getattr(c, "row", None),
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
    # Rework v2: surface race HP die for the level-up preview (rank-aware).
    from sqlalchemy import func as _func
    from sqlalchemy import select as _sel

    from app.models import RaceRankConfig as _RRC
    hp_die, hp_dice_count, race_name = 8, 1, None
    if c.race_id:
        race = await db.get(Race, c.race_id)
        if race:
            hp_die = int(race.hp_die or 8)
            hp_dice_count = int(race.hp_dice_count or 1)
            race_name = race.name
            # Try rank-aware override
            char_rank = (getattr(c, "rank", None) or "common").lower()
            q_rc = await db.execute(
                _sel(_RRC).where(
                    _RRC.race_id == race.id,
                    _func.lower(_RRC.rank) == char_rank,
                )
            )
            rc = q_rc.scalars().first()
            if rc:
                hp_die = int(rc.physical_hp_die or hp_die)
                hp_dice_count = int(rc.physical_hp_dice_count or hp_dice_count)
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
    from app.game_mechanics import get_effective_mana_max, restore_mana
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
    from app.game_mechanics import get_effective_mana_max, spend_mana
    c = await db.get(Character, char_id)
    if not c:
        raise HTTPException(404, "Character not found")
    cost = body.get("cost", 0)
    eff_max = get_effective_mana_max(c.mana_max)
    result = spend_mana(c.mana_current, eff_max, cost)
    if not result["success"]:
        raise HTTPException(400, result["reason"])
    c.mana_current = result["new_mana"]
    await db.commit()
    await db.refresh(c)
    return {"mana_current": c.mana_current, "mana_max": c.mana_max, "effective_mana_max": eff_max}


