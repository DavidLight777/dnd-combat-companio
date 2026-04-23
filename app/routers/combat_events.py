"""Stage 5 — Combat Events & Initiative System."""

import json
import random
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    CombatEvent, CombatParticipant, Character, CharacterStatusEffect,
    StatModifier, Session, InventoryItem, CharacterAbility,
)
from app.websocket_manager import manager

router = APIRouter(prefix="/api/combat", tags=["combat"])


# ── Schemas ───────────────────────────────────────────────────
class CreateCombatBody(BaseModel):
    session_id: int
    name: str = "Combat"


class AddParticipantBody(BaseModel):
    character_id: int


class AddParticipantsBody(BaseModel):
    character_ids: list[int]


class SetInitiativeBody(BaseModel):
    character_id: int
    roll: int


class ManualInitiativeBody(BaseModel):
    participant_id: int
    final_initiative: int


class TimerBody(BaseModel):
    participant_id: int
    duration_seconds: int


class ExecuteAttackBody(BaseModel):
    attacker_id: int
    target_id: int
    attack_type: str = "weapon"     # "weapon" | "ability"
    ability_id: int | None = None
    advantage: str = "normal"       # "advantage" | "normal" | "disadvantage"
    player_roll: int | None = None  # optional player-submitted d20
    # FIX 3: optional dice overrides from universal dice widget (GM superpower;
    # ignored by the player-facing two-step flow).
    dice_count: int | None = None
    dice_type:  int | None = None
    # Rework v3: number of d20s rolled on the HIT check (1..ADV_DICE_CAP).
    # Default behaviour: 1 for normal, 2 for adv/disadv.
    hit_dice_count: int | None = None
    # Rework v3: picks a preset from weapon.damage_modes, if any.
    damage_mode_index: int | None = None


# Two-step attack flow: hit roll only (no damage, no apply)
class HitRollBody(BaseModel):
    attacker_id: int
    target_id: int
    advantage: str = "normal"       # "advantage" | "normal" | "disadvantage"
    hit_dice_count: int | None = None   # Rework v3: number of d20s


# Two-step attack flow: damage roll only (applies damage to target)
class DamageRollBody(BaseModel):
    attacker_id: int
    target_id: int
    critical: bool = False          # must come from preceding hit roll
    # Rework v3: damage dice are fixed by the weapon; player-supplied dice_count
    # / dice_type are ignored for normal attacks. The `damage_mode_index` field
    # picks from ``weapon.damage_modes`` if the weapon has multiple modes.
    damage_mode_index: int | None = None
    advantage: str = "normal"       # advantage on damage roll itself
    dice_count: int | None = None   # accepted for back-compat; ignored for players
    dice_type:  int | None = None   # accepted for back-compat; ignored for players


# ── Helpers ───────────────────────────────────────────────────
_STAT_SHORT = {
    "strength": "STR", "dexterity": "DEX", "constitution": "CON",
    "intelligence": "INT", "wisdom": "WIS", "charisma": "CHA",
}


def _stat_short(name: str | None) -> str:
    if not name:
        return ""
    return _STAT_SHORT.get(name, name[:3].upper())


def _resolve_display_stat(weapon: dict | None, attacker, kind: str) -> tuple[int, str]:
    """Rework: derive stat modifier + short label using weapon.hit_stat / damage_stat
    with legacy finesse fallback. kind is 'hit' or 'damage'."""
    from app.game_mechanics import _resolve_stat_from_weapon
    stats = {
        "strength": attacker.strength, "dexterity": attacker.dexterity,
        "constitution": attacker.constitution, "intelligence": attacker.intelligence,
        "wisdom": attacker.wisdom, "charisma": attacker.charisma,
    }
    val, name = _resolve_stat_from_weapon(stats, weapon, kind)
    return val, _stat_short(name)


async def _serialize_combat(ce: CombatEvent, db: AsyncSession) -> dict:
    result = await db.execute(
        select(CombatParticipant).where(
            CombatParticipant.combat_event_id == ce.id
        ).order_by(CombatParticipant.turn_order)
    )
    parts = result.scalars().all()
    serialized = []
    for p in parts:
        char = await db.get(Character, p.character_id)
        serialized.append(_serialize_participant(p, char))
    return {
        "id": ce.id,
        "session_id": ce.session_id,
        "name": ce.name,
        "status": ce.status,
        "round_number": ce.round_number,
        "current_participant_id": ce.current_participant_id,
        "started_at": ce.started_at.isoformat() if ce.started_at else None,
        "ended_at": ce.ended_at.isoformat() if ce.ended_at else None,
        "participants": serialized,
    }


def _serialize_participant(p: CombatParticipant, ch: Character | None = None) -> dict:
    if ch is None:
        ch = p.character
    return {
        "id": p.id,
        "combat_event_id": p.combat_event_id,
        "character_id": p.character_id,
        "name": ch.name if ch else "?",
        "is_npc": ch.is_npc if ch else False,
        "current_hp": ch.current_hp if ch else 0,
        "max_hp": ch.max_hp if ch else 0,
        "armor_class": ch.armor_class if ch else 10,
        "is_alive": ch.is_alive if ch else False,
        "initiative_roll": p.initiative_roll,
        "initiative_bonus": p.initiative_bonus,
        "final_initiative": p.final_initiative,
        "turn_order": p.turn_order,
        "is_active": p.is_active,
        "show_hp_to_players": p.show_hp_to_players,
        "show_ac_to_players": p.show_ac_to_players,
    }


def _calc_initiative_bonus(char: Character) -> int:
    """Base initiative_bonus + equipped item initiative bonuses."""
    bonus = char.initiative_bonus or 0
    # Add bonuses from equipped items (inventory_items loaded via selectin)
    try:
        for inv in char.inventory_items:
            if inv.is_equipped and inv.item and inv.item.bonuses:
                for b in inv.item.bonuses:
                    if b.stat == "initiative_bonus":
                        bonus += b.value
    except Exception:
        pass  # If inventory not loaded, just use base bonus
    return bonus


async def _get_combat(combat_id: int, db: AsyncSession) -> CombatEvent:
    ce = await db.get(CombatEvent, combat_id)
    if not ce:
        raise HTTPException(404, "Combat event not found")
    return ce


# ══════════════════════════════════════════════════════════════
# COMBAT CRUD
# ══════════════════════════════════════════════════════════════
@router.post("/create")
async def create_combat(body: CreateCombatBody, db: AsyncSession = Depends(get_session)):
    # Verify session exists
    sess = await db.get(Session, body.session_id)
    if not sess:
        raise HTTPException(404, "Session not found")

    ce = CombatEvent(session_id=body.session_id, name=body.name)
    db.add(ce)
    await db.commit()
    await db.refresh(ce)
    return await _serialize_combat(ce, db)


@router.get("/{combat_id}/state")
async def get_combat_state(combat_id: int, db: AsyncSession = Depends(get_session)):
    ce = await _get_combat(combat_id, db)
    return await _serialize_combat(ce, db)


@router.get("/session/{session_code}/active")
async def get_active_combat(session_code: str, db: AsyncSession = Depends(get_session)):
    """Get the currently active or preparing combat for a session."""
    result = await db.execute(select(Session).where(Session.code == session_code))
    sess = result.scalar_one_or_none()
    if not sess:
        raise HTTPException(404, "Session not found")

    result = await db.execute(
        select(CombatEvent).where(
            CombatEvent.session_id == sess.id,
            CombatEvent.status.in_(["preparing", "active"]),
        ).order_by(CombatEvent.id.desc()).limit(1)
    )
    ce = result.scalar_one_or_none()
    if not ce:
        return {"active": False}
    return {"active": True, "combat": await _serialize_combat(ce, db)}


# ══════════════════════════════════════════════════════════════
# PARTICIPANTS
# ══════════════════════════════════════════════════════════════
@router.post("/{combat_id}/add-participant")
async def add_participant(combat_id: int, body: AddParticipantBody, db: AsyncSession = Depends(get_session)):
    ce = await _get_combat(combat_id, db)
    if ce.status == "ended":
        raise HTTPException(400, "Combat already ended")

    char = await db.get(Character, body.character_id)
    if not char:
        raise HTTPException(404, "Character not found")

    # Check duplicate
    existing = await db.execute(
        select(CombatParticipant).where(
            CombatParticipant.combat_event_id == combat_id,
            CombatParticipant.character_id == body.character_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Character already in combat")

    bonus = _calc_initiative_bonus(char)
    p = CombatParticipant(
        combat_event_id=combat_id,
        character_id=body.character_id,
        initiative_bonus=bonus,
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    return _serialize_participant(p)


@router.post("/{combat_id}/add-participants")
async def add_participants(combat_id: int, body: AddParticipantsBody, db: AsyncSession = Depends(get_session)):
    ce = await _get_combat(combat_id, db)
    if ce.status == "ended":
        raise HTTPException(400, "Combat already ended")

    added = []
    for cid in body.character_ids:
        char = await db.get(Character, cid)
        if not char:
            continue
        # Skip duplicates
        existing = await db.execute(
            select(CombatParticipant).where(
                CombatParticipant.combat_event_id == combat_id,
                CombatParticipant.character_id == cid,
            )
        )
        if existing.scalar_one_or_none():
            continue

        bonus = _calc_initiative_bonus(char)
        p = CombatParticipant(
            combat_event_id=combat_id,
            character_id=cid,
            initiative_bonus=bonus,
        )
        db.add(p)
        added.append(cid)

    await db.commit()
    await db.refresh(ce)
    return {"ok": True, "added": added, "combat": await _serialize_combat(ce, db)}


@router.delete("/{combat_id}/participants/{char_id}")
async def remove_participant(combat_id: int, char_id: int, db: AsyncSession = Depends(get_session)):
    result = await db.execute(
        select(CombatParticipant).where(
            CombatParticipant.combat_event_id == combat_id,
            CombatParticipant.character_id == char_id,
        )
    )
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Participant not found")
    await db.delete(p)
    await db.commit()
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# INITIATIVE
# ══════════════════════════════════════════════════════════════
@router.post("/{combat_id}/roll-npc-initiative")
async def roll_npc_initiative(combat_id: int, db: AsyncSession = Depends(get_session)):
    """Roll initiative for ALL NPC participants at once."""
    ce = await _get_combat(combat_id, db)

    result = await db.execute(
        select(CombatParticipant).where(CombatParticipant.combat_event_id == combat_id)
    )
    participants = result.scalars().all()

    rolls = []
    for p in participants:
        char = await db.get(Character, p.character_id)
        if not char or not char.is_npc:
            continue
        d20 = random.randint(1, 20)
        p.initiative_roll = d20
        p.initiative_bonus = _calc_initiative_bonus(char)
        p.final_initiative = d20 + p.initiative_bonus
        rolls.append({
            "participant_id": p.id,
            "character_id": p.character_id,
            "name": char.name,
            "d20": d20,
            "bonus": p.initiative_bonus,
            "final": p.final_initiative,
        })

    await db.commit()
    await db.refresh(ce)
    return {"ok": True, "rolls": rolls, "combat": await _serialize_combat(ce, db)}


@router.post("/{combat_id}/request-player-initiative")
async def request_player_initiative(combat_id: int, db: AsyncSession = Depends(get_session)):
    """GM requests initiative rolls from all player participants. Broadcasts WS events to session."""
    result = await db.execute(
        select(CombatEvent).where(CombatEvent.id == combat_id)
    )
    ce = result.scalar_one_or_none()
    if not ce:
        raise HTTPException(404, "Combat not found")

    # Get session code
    sess = await db.get(Session, ce.session_id)
    session_code = sess.code if sess else None
    if not session_code:
        raise HTTPException(404, "Session not found")

    # Get player participants
    parts_result = await db.execute(
        select(CombatParticipant).where(
            CombatParticipant.combat_event_id == combat_id,
            CombatParticipant.is_active == True,
        )
    )
    parts = parts_result.scalars().all()

    sent_to = []
    for p in parts:
        char = await db.get(Character, p.character_id)
        if not char or char.is_npc:
            continue
        # Broadcast to entire session — each player JS filters by character_id
        await manager.broadcast_to_session(session_code, "combat.roll_initiative_request", {
            "combat_id": combat_id,
            "character_id": char.id,
            "initiative_bonus": p.initiative_bonus,
        })
        sent_to.append({"character_id": char.id, "name": char.name})

    return {"ok": True, "sent_to": sent_to}


@router.post("/{combat_id}/set-player-initiative")
async def set_player_initiative(combat_id: int, body: SetInitiativeBody, db: AsyncSession = Depends(get_session)):
    """Player submits their d20 roll."""
    result = await db.execute(
        select(CombatParticipant).where(
            CombatParticipant.combat_event_id == combat_id,
            CombatParticipant.character_id == body.character_id,
        )
    )
    p = result.scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Participant not found")

    char = await db.get(Character, p.character_id)
    p.initiative_roll = body.roll
    p.initiative_bonus = _calc_initiative_bonus(char) if char else 0
    p.final_initiative = body.roll + p.initiative_bonus
    await db.commit()
    return {
        "ok": True,
        "participant_id": p.id,
        "character_id": p.character_id,
        "d20": body.roll,
        "bonus": p.initiative_bonus,
        "final": p.final_initiative,
    }


@router.post("/{combat_id}/set-manual-initiative")
async def set_manual_initiative(combat_id: int, body: ManualInitiativeBody, db: AsyncSession = Depends(get_session)):
    """GM manually sets final initiative for any participant."""
    p = await db.get(CombatParticipant, body.participant_id)
    if not p or p.combat_event_id != combat_id:
        raise HTTPException(404, "Participant not found")
    p.final_initiative = body.final_initiative
    await db.commit()
    return {"ok": True, "participant_id": p.id, "final_initiative": p.final_initiative}


# ══════════════════════════════════════════════════════════════
# COMBAT FLOW
# ══════════════════════════════════════════════════════════════
@router.post("/{combat_id}/start")
async def start_combat(combat_id: int, db: AsyncSession = Depends(get_session)):
    ce = await _get_combat(combat_id, db)
    if ce.status != "preparing":
        raise HTTPException(400, f"Combat is already {ce.status}")

    result = await db.execute(
        select(CombatParticipant).where(CombatParticipant.combat_event_id == combat_id)
    )
    participants = result.scalars().all()

    if not participants:
        raise HTTPException(400, "No participants in combat")

    # Load characters for sorting
    char_map = {}
    for p in participants:
        char_map[p.id] = await db.get(Character, p.character_id)

    # Sort by final_initiative DESC, tiebreak by dexterity
    def sort_key(p):
        fi = p.final_initiative if p.final_initiative is not None else 0
        ch = char_map.get(p.id)
        dex = ch.dexterity if ch else 0
        return (-fi, -dex)

    sorted_parts = sorted(participants, key=sort_key)
    for i, p in enumerate(sorted_parts):
        p.turn_order = i

    # Set first active participant as current
    first_active = next((p for p in sorted_parts if p.is_active and char_map.get(p.id) and char_map[p.id].is_alive), None)
    ce.status = "active"
    ce.round_number = 1
    ce.started_at = datetime.now(timezone.utc)
    ce.current_participant_id = first_active.id if first_active else None

    # Rework v3 Phase 4: clear everyone's movement budget at combat
    # start so whatever was left over from the last fight doesn't carry
    # into this one.
    try:
        from app.routers.map import reset_movement_for
        for p in participants:
            await reset_movement_for(p.character_id, db)
    except Exception:
        pass

    await db.commit()
    await db.refresh(ce)
    return await _serialize_combat(ce, db)


@router.post("/{combat_id}/next-turn")
async def next_turn(combat_id: int, db: AsyncSession = Depends(get_session)):
    ce = await _get_combat(combat_id, db)
    if ce.status != "active":
        raise HTTPException(400, "Combat is not active")

    result = await db.execute(
        select(CombatParticipant).where(
            CombatParticipant.combat_event_id == combat_id
        ).order_by(CombatParticipant.turn_order)
    )
    participants = result.scalars().all()
    if not participants:
        raise HTTPException(400, "No participants")

    # Process turn-end effects for current participant
    turn_end_events = []
    current_p = next((p for p in participants if p.id == ce.current_participant_id), None)
    if current_p:
        turn_end_events = await _process_participant_turn_end(current_p.character_id, db)

    # Find current index
    current_idx = 0
    for i, p in enumerate(participants):
        if p.id == ce.current_participant_id:
            current_idx = i
            break

    # Advance to next active+alive participant (skip dead, skip_turn)
    tried = 0
    next_idx = current_idx
    skipped = []
    new_round = False
    while tried < len(participants):
        next_idx = (next_idx + 1) % len(participants)
        if next_idx == 0:
            new_round = True

        p = participants[next_idx]
        char = await db.get(Character, p.character_id)
        if p.is_active and char and char.is_alive:
            # Check skip_turn
            if await _has_skip_turn(char.id, db):
                skipped.append({"character_id": char.id, "name": char.name, "reason": "skip_turn"})
                await _process_participant_turn_end(char.id, db)
                tried += 1
                continue
            break
        tried += 1

    if new_round:
        ce.round_number += 1

    ce.current_participant_id = participants[next_idx].id

    # Rework v3 Phase 4: refresh the movement budget of the incoming
    # actor so their turn starts with a full allowance.
    try:
        from app.routers.map import reset_movement_for
        await reset_movement_for(participants[next_idx].character_id, db)
    except Exception:
        pass

    await db.commit()
    await db.refresh(ce)

    next_char = await db.get(Character, participants[next_idx].character_id)
    return {
        "combat": await _serialize_combat(ce, db),
        "turn_end_events": turn_end_events,
        "skipped": skipped,
        "current_character_id": next_char.id if next_char else None,
        "current_character_name": next_char.name if next_char else "?",
    }


@router.post("/{combat_id}/end")
async def end_combat(combat_id: int, db: AsyncSession = Depends(get_session)):
    ce = await _get_combat(combat_id, db)
    ce.status = "ended"
    ce.ended_at = datetime.now(timezone.utc)
    # Rework v3 Phase 4: clear movement budget for everyone when the
    # fight wraps — prevents stale "used 6/6" stickiness if a new
    # combat starts immediately.
    try:
        from app.routers.map import reset_movement_for
        for p in (ce.participants or []):
            await reset_movement_for(p.character_id, db)
    except Exception:
        pass

    # FIX 5: Collect player participants + defeated NPCs BEFORE commit
    player_ids: list[int] = []
    defeated_names: list[str] = []
    try:
        for p in (ce.participants or []):
            ch = await db.get(Character, p.character_id)
            if not ch:
                continue
            if ch.is_npc and not ch.is_alive:
                defeated_names.append(ch.name)
            elif not ch.is_npc:
                player_ids.append(ch.id)
    except Exception:
        pass

    await db.commit()

    # FIX 5: Auto-memory entry for each player who was in this combat
    if defeated_names and player_ids:
        try:
            from app.routers.memory import create_memory_entry
            combat_name = ce.name or "Combat"
            content = f"Fought and defeated: {', '.join(defeated_names)}."
            for pid in player_ids:
                # Make title unique per combat to avoid dedup collision on repeat battles
                title = f"Battle: {combat_name} #{ce.id}"
                await create_memory_entry(
                    db, pid, "event", title, content,
                )
        except Exception:
            pass

    # Broadcast combat.ended (existing client code expects it)
    try:
        from app.websocket_manager import manager
        from app.models import Session as SessionModel
        sess = await db.get(SessionModel, ce.session_id)
        if sess:
            await manager.broadcast_to_session(sess.code, "combat.ended", {
                "combat_id": ce.id, "combat_name": ce.name,
            })
    except Exception:
        pass

    return {"ok": True, "status": "ended"}


# ══════════════════════════════════════════════════════════════
# TURN-END HELPERS (reuse Stage 4 logic)
# ══════════════════════════════════════════════════════════════
async def _process_participant_turn_end(character_id: int, db: AsyncSession) -> list[dict]:
    char = await db.get(Character, character_id)
    if not char:
        return []

    result = await db.execute(
        select(CharacterStatusEffect).where(CharacterStatusEffect.character_id == character_id)
    )
    effects = result.scalars().all()
    if not effects:
        return []

    events = []
    hp_changes = []
    mana_changes = []

    for eff in effects:
        eff_data = json.loads(eff.effects) if eff.effects else []
        for e in eff_data:
            if e.get("type") == "hp_change_per_turn":
                hp_changes.append({"name": eff.name, "value": e["value"]})
            elif e.get("type") == "mana_change_per_turn":
                mana_changes.append({"name": eff.name, "value": e["value"]})

        if eff.remaining_turns is not None:
            eff.remaining_turns -= 1
            if eff.remaining_turns <= 0:
                events.append({
                    "type": "status_effect.expired",
                    "character_id": character_id,
                    "character_name": char.name,
                    "effect_name": eff.name,
                    "effect_id": eff.id,
                })
                await db.delete(eff)

    total_hp_change = sum(h["value"] for h in hp_changes)
    if total_hp_change != 0 and char.is_alive:
        char.current_hp = max(0, char.current_hp + total_hp_change)
        if char.current_hp <= 0:
            char.is_alive = False
        events.append({
            "type": "hp_change",
            "character_id": character_id,
            "character_name": char.name,
            "hp_change": total_hp_change,
            "new_hp": char.current_hp,
            "sources": hp_changes,
        })

    # Mana regen + status mana changes
    total_mana_change = sum(m["value"] for m in mana_changes)
    regen = char.mana_regen_per_turn or 0
    if (regen != 0 or total_mana_change != 0) and char.mana_max > 0:
        from app.game_mechanics import apply_mana_regen, get_effective_mana_max
        eff_max = get_effective_mana_max(char.mana_max)
        old_mana = char.mana_current
        char.mana_current = apply_mana_regen(char.mana_current, eff_max, regen, total_mana_change)
        if char.mana_current != old_mana:
            sources = []
            if regen: sources.append({"name": "Regen", "value": regen})
            sources.extend(mana_changes)
            events.append({
                "type": "mana.updated",
                "character_id": character_id,
                "character_name": char.name,
                "mana_change": char.mana_current - old_mana,
                "mana_current": char.mana_current,
                "mana_max": eff_max,
                "sources": sources,
            })

    # Expired potion stat boosts cleanup
    now = datetime.now(timezone.utc)
    expired_mods = await db.execute(
        select(StatModifier).where(
            StatModifier.character_id == character_id,
            StatModifier.source == "potion",
            StatModifier.expires_at != None,
            StatModifier.expires_at <= now,
        )
    )
    for mod in expired_mods.scalars().all():
        events.append({
            "type": "modifier.expired",
            "character_id": character_id,
            "character_name": char.name,
            "modifier_name": mod.name,
            "stat_name": mod.stat_name,
            "value": mod.value,
        })
        await db.delete(mod)

    # Ability cooldown decrement
    cd_result = await db.execute(
        select(CharacterAbility).where(
            CharacterAbility.character_id == character_id,
            CharacterAbility.cooldown_remaining > 0,
        )
    )
    for ca in cd_result.scalars().all():
        ca.cooldown_remaining = max(0, ca.cooldown_remaining - 1)
        if ca.cooldown_remaining == 0:
            events.append({
                "type": "ability.cooldown_ready",
                "character_id": character_id,
                "character_name": char.name,
                "ability_name": ca.ability.name if ca.ability else "Unknown",
            })

    return events


async def _has_skip_turn(character_id: int, db: AsyncSession) -> bool:
    result = await db.execute(
        select(CharacterStatusEffect).where(CharacterStatusEffect.character_id == character_id)
    )
    for eff in result.scalars().all():
        eff_data = json.loads(eff.effects) if eff.effects else []
        for e in eff_data:
            if e.get("type") == "skip_turn" and e.get("value"):
                return True
    return False


# ══════════════════════════════════════════════════════════════
# PHASE 5 — FULL COMBAT ATTACK FLOW
# ══════════════════════════════════════════════════════════════
async def _get_equipped_weapon(character_id: int, db: AsyncSession) -> dict | None:
    """Get the weapon equipped in main_hand slot, returning dict for game_mechanics."""
    result = await db.execute(
        select(InventoryItem).where(
            InventoryItem.character_id == character_id,
            InventoryItem.is_equipped == True,
            InventoryItem.equipped_slot == "main_hand",
        )
    )
    inv = result.scalars().first()
    if not inv or not inv.item or not inv.item.weapon_stats:
        return None
    ws = inv.item.weapon_stats
    props = ws.weapon_properties
    if isinstance(props, str):
        try:
            props = json.loads(props)
        except Exception:
            props = []
    # Rework v3: preset damage modes. Empty list = single-mode weapon.
    try:
        dmg_modes = json.loads(getattr(ws, "damage_modes", None) or "[]")
        if not isinstance(dmg_modes, list):
            dmg_modes = []
    except Exception:
        dmg_modes = []
    return {
        "name": inv.item.name,
        "dice_count": ws.dice_count,
        "dice_type": ws.dice_type,
        "damage_type": ws.damage_type,
        "damage_bonus": 0,
        "attack_bonus": 0,
        "weapon_range": ws.weapon_range or "melee",
        # Rework v3 Phase 7: cell-range for grid enforcement.
        "range_cells": ws.range_cells if ws.range_cells is not None else 1,
        "weapon_properties": props,
        # Rework Phase 2: stat binding lives on the weapon itself
        "hit_stat": getattr(ws, "hit_stat", None) or "strength",
        "damage_stat": getattr(ws, "damage_stat", "strength"),
        # Rework v3: preset alternate damage modes (1h/2h, element, etc.).
        "damage_modes": dmg_modes,
    }


async def _get_char_bonuses_and_penalties(char: Character, db: AsyncSession):
    """Load equipped item bonuses and status penalties for a character."""
    from app.game_mechanics import get_all_active_bonuses, aggregate_status_penalties

    # Item bonuses
    equipped_result = await db.execute(
        select(InventoryItem).where(
            InventoryItem.character_id == char.id,
            InventoryItem.is_equipped == True,
        )
    )
    equipped = equipped_result.scalars().all()
    item_bonuses = get_all_active_bonuses(equipped)

    # Status penalties
    eff_result = await db.execute(
        select(CharacterStatusEffect).where(
            CharacterStatusEffect.character_id == char.id,
        )
    )
    effects = eff_result.scalars().all()
    effects_json = []
    for eff in effects:
        try:
            effects_json.append(json.loads(eff.effects) if eff.effects else [])
        except Exception:
            effects_json.append([])
    status_penalties = aggregate_status_penalties(effects_json)

    return item_bonuses, status_penalties


def _char_stats_dict(c: Character) -> dict:
    return {
        "strength": c.strength,
        "dexterity": c.dexterity,
        "constitution": c.constitution,
        "intelligence": c.intelligence,
        "wisdom": c.wisdom,
        "charisma": c.charisma,
    }


@router.post("/execute-attack")
async def execute_attack(body: ExecuteAttackBody, db: AsyncSession = Depends(get_session)):
    """
    Full combat attack flow: hit roll → damage roll → apply damage → broadcast.
    Returns complete breakdown strings for all steps.
    """
    from app.game_mechanics import (
        calculate_combat_attack, calculate_combat_damage,
        stat_modifier, resolve_advantage_mode, get_all_active_bonuses,
    )

    # 1. Load attacker & target
    attacker = await db.get(Character, body.attacker_id)
    target = await db.get(Character, body.target_id)
    if not attacker:
        raise HTTPException(404, "Attacker not found")
    if not target:
        raise HTTPException(404, "Target not found")

    # 2. Load bonuses & penalties
    atk_item_bonuses, atk_status_penalties = await _get_char_bonuses_and_penalties(attacker, db)
    tgt_item_bonuses, tgt_status_penalties = await _get_char_bonuses_and_penalties(target, db)

    # 3. Get weapon
    weapon = await _get_equipped_weapon(body.attacker_id, db)

    # 3a. Rework v3 Phase 7 — range enforcement. Weapons carry a
    # `range_cells` value (default 1 = melee adjacent). If attacker
    # and target are both placed on the current battle map, reject
    # the call when the Chebyshev distance exceeds that budget. Non-
    # grid flows (no map / missing positions) fall through via
    # `RangeCheck.skipped=True` so this is strictly additive.
    from app.combat_range import check_range
    _weapon_range = (weapon or {}).get("range_cells") if weapon else None
    _rc = await check_range(attacker, target, _weapon_range, db)
    if not _rc.ok:
        raise HTTPException(403, {
            "error": True, "code": "OUT_OF_RANGE",
            "message": (
                f"Out of range — {target.name} is {_rc.distance_cells:g} cells away, "
                f"weapon reaches {_rc.max_cells}."
            ),
            "distance_cells": _rc.distance_cells,
            "max_cells": _rc.max_cells,
        })

    # 4. Resolve advantage mode (player choice + forced status)
    adv_mode = resolve_advantage_mode(body.advantage, atk_status_penalties)

    # 5. Stat modifier for attack
    attacker_stats = _char_stats_dict(attacker)
    item_atk_bonus = int(atk_item_bonuses.get("attack_bonus", 0))
    status_atk_penalty = atk_status_penalties.get("attack_penalty", 0)

    # 6. HIT ROLL
    if body.player_roll is not None:
        # Player submitted d20 — use as-is (single roll, no advantage re-roll)
        d20 = body.player_roll
        atk_result = calculate_combat_attack(
            attacker_stats, target.armor_class, weapon,
            item_atk_bonus, status_atk_penalty, "normal",
        )
        # Override d20 with player roll
        sm = atk_result.stat_mod
        wb = atk_result.weapon_bonus
        total = d20 + sm + wb + item_atk_bonus - status_atk_penalty
        fumble = (d20 == 1)
        critical = (d20 == 20)
        hit = False if fumble else (critical or total >= target.armor_class)
    else:
        atk_result = calculate_combat_attack(
            attacker_stats, target.armor_class, weapon,
            item_atk_bonus, status_atk_penalty, adv_mode,
            dice_count=body.hit_dice_count,
        )
        d20 = atk_result.d20
        sm = atk_result.stat_mod
        wb = atk_result.weapon_bonus
        total = atk_result.total
        fumble = atk_result.fumble
        critical = atk_result.critical
        hit = atk_result.hit

    # 7. Build hit breakdown string
    parts = [f"D20({d20})"]
    if sm != 0:
        _, stat_name = _resolve_display_stat(weapon, attacker, "hit")
        stat_name = stat_name or "STR"
        parts.append(f"{stat_name}({'+' if sm >= 0 else ''}{sm})")
    if wb != 0:
        parts.append(f"{weapon['name'] if weapon else 'Weapon'}({'+' if wb >= 0 else ''}{wb})")
    if item_atk_bonus != 0:
        # Find item sources for attack bonus
        for bd in atk_item_bonuses.get("breakdown", []):
            if bd["bonus_type"] == "attack_bonus":
                parts.append(f"{bd['source']}(+{int(bd['value'])})")
    if status_atk_penalty != 0:
        parts.append(f"Status({status_atk_penalty})")

    hit_str = " + ".join(parts) + f" = {total} vs AC {target.armor_class}"
    if fumble:
        hit_str += " → FUMBLE (nat 1)"
    elif critical:
        hit_str += " → CRITICAL HIT (nat 20)"
    elif hit:
        hit_str += " → HIT"
    else:
        hit_str += " → MISS"

    # Advantage / N-dice prefix (adv_breakdown already formatted by engine)
    if body.player_roll is None and atk_result.advantage_breakdown:
        hit_str = f"{atk_result.advantage_breakdown} | " + hit_str

    # 8. If miss, return early
    if not hit:
        return {
            "hit": False,
            "critical": False,
            "fumble": fumble,
            "hit_breakdown": hit_str,
            "damage_breakdown": None,
            "intake_breakdown": None,
            "final_damage": 0,
            "target_hp_before": target.current_hp,
            "target_hp_after": target.current_hp,
            "attacker_name": attacker.name,
            "target_name": target.name,
        }

    # 9. DAMAGE ROLL
    # Rework v3: honor preset damage_modes first, then GM dice overrides.
    _xa_damage_modes = (weapon or {}).get("damage_modes") or []
    if weapon:
        if _xa_damage_modes:
            idx = 0 if body.damage_mode_index is None else int(body.damage_mode_index)
            idx = max(0, min(len(_xa_damage_modes) - 1, idx))
            _mode = _xa_damage_modes[idx]
            dc = int(_mode.get("dice_count", weapon["dice_count"]))
            dt = int(_mode.get("dice_type", weapon["dice_type"]))
        else:
            dc = weapon["dice_count"]
            dt = weapon["dice_type"]
    else:
        dc = attacker.attack_dice_count or 1
        dt = attacker.attack_dice_type or 6

    # FIX 3: allow universal dice widget (GM superpower) to override dice count/type
    if body.dice_count is not None and body.dice_count > 0:
        dc = min(20, max(1, int(body.dice_count)))
    if body.dice_type is not None and body.dice_type > 0:
        dt = int(body.dice_type)

    # Roll damage dice (crit = double dice count)
    actual_dc = dc * 2 if critical else dc
    dice_rolls = [random.randint(1, dt) for _ in range(actual_dc)]
    base_damage = sum(dice_rolls)

    # Stat mod for damage
    if weapon:
        from app.game_mechanics import _calc_damage_stat_mod
        dmg_sm = _calc_damage_stat_mod(attacker_stats, weapon)
    else:
        dmg_sm = stat_modifier(attacker.strength)

    item_dmg_bonus = int(atk_item_bonuses.get("damage_bonus", 0))
    status_dmg_penalty = atk_status_penalties.get("damage_penalty", 0)

    raw_damage = max(0, base_damage + dmg_sm + item_dmg_bonus - status_dmg_penalty)

    # Build damage breakdown string
    dice_str = "+".join(str(r) for r in dice_rolls)
    dmg_parts = [f"{actual_dc}d{dt}({dice_str}={base_damage})"]
    if dmg_sm != 0:
        _, stat_label = _resolve_display_stat(weapon, attacker, "damage")
        stat_label = stat_label or "STR"
        dmg_parts.append(f"{stat_label} mod({'+' if dmg_sm >= 0 else ''}{dmg_sm})")
    if item_dmg_bonus != 0:
        for bd in atk_item_bonuses.get("breakdown", []):
            if bd["bonus_type"] == "damage_bonus":
                dmg_parts.append(f"{bd['source']}(+{int(bd['value'])})")
    if status_dmg_penalty != 0:
        dmg_parts.append(f"Status({-status_dmg_penalty})")

    damage_str = " + ".join(dmg_parts) + f" = {raw_damage} raw"
    if critical:
        damage_str = "CRIT ×2 dice! " + damage_str

    # 10. APPLY DAMAGE TO TARGET (armor/reduction)
    # Get target's flat & percent damage reduction from items
    tgt_flat_dr = int(tgt_item_bonuses.get("flat_damage_reduction", 0))
    tgt_pct_dr = float(tgt_item_bonuses.get("percent_damage_reduction", 0))
    # Status penalty on reduction (negative = less protection)
    tgt_dr_penalty = tgt_status_penalties.get("damage_reduction_penalty", 0.0)
    total_pct_reduction = min(100.0, max(0.0, tgt_pct_dr + tgt_dr_penalty))

    after_pct = raw_damage * (1.0 - total_pct_reduction / 100.0)
    final_damage = max(0, int(after_pct) - tgt_flat_dr)

    # Build intake breakdown string
    intake_parts = [f"{raw_damage}"]
    if total_pct_reduction > 0:
        sources = [bd for bd in tgt_item_bonuses.get("breakdown", []) if bd["bonus_type"] == "percent_damage_reduction"]
        src_str = ", ".join(f"{s['source']}({s['value']}%)" for s in sources)
        if tgt_dr_penalty:
            src_str += f", Status({tgt_dr_penalty}%)"
        intake_parts.append(f"× {(100 - total_pct_reduction):.0f}% ({src_str})")
        intake_parts.append(f"= {int(after_pct)}")
    if tgt_flat_dr > 0:
        sources = [bd for bd in tgt_item_bonuses.get("breakdown", []) if bd["bonus_type"] == "flat_damage_reduction"]
        src_str = ", ".join(f"{s['source']}({int(s['value'])})" for s in sources)
        intake_parts.append(f"- {tgt_flat_dr} flat ({src_str})")

    intake_str = " ".join(intake_parts) + f" = {final_damage} final"

    # 11. Apply to target HP
    hp_before = target.current_hp
    target.current_hp = max(0, target.current_hp - final_damage)
    hp_after = target.current_hp
    target_downed = hp_after <= 0

    if target_downed:
        target.is_alive = False

    await db.commit()
    await db.refresh(target)

    return {
        "hit": True,
        "critical": critical,
        "fumble": False,
        "hit_breakdown": hit_str,
        "damage_breakdown": damage_str,
        "intake_breakdown": intake_str,
        "final_damage": final_damage,
        "target_hp_before": hp_before,
        "target_hp_after": hp_after,
        "target_downed": target_downed,
        "attacker_name": attacker.name,
        "target_name": target.name,
        "dice_rolls": dice_rolls,
        "raw_damage": raw_damage,
    }


# ══════════════════════════════════════════════════════════════
# TWO-STEP ATTACK FLOW: /hit-roll → /damage-roll
# Players (and GM for NPCs) can roll d20 first, see HIT/CRIT/MISS,
# then roll damage with their own dice count/type + adv/disadv.
# ══════════════════════════════════════════════════════════════
@router.post("/hit-roll")
async def hit_roll(body: HitRollBody, db: AsyncSession = Depends(get_session)):
    """Step 1: Roll d20 + mods against target AC. No damage applied."""
    from app.game_mechanics import (
        calculate_combat_attack, stat_modifier, resolve_advantage_mode,
    )

    attacker = await db.get(Character, body.attacker_id)
    target = await db.get(Character, body.target_id)
    if not attacker:
        raise HTTPException(404, "Attacker not found")
    if not target:
        raise HTTPException(404, "Target not found")

    atk_item_bonuses, atk_status_penalties = await _get_char_bonuses_and_penalties(attacker, db)
    weapon = await _get_equipped_weapon(body.attacker_id, db)

    # Rework v3 Phase 7 — mirror the range enforcement that
    # /execute-attack does, so the two-step flow can't bypass it.
    from app.combat_range import check_range
    _weapon_range = (weapon or {}).get("range_cells") if weapon else None
    _rc = await check_range(attacker, target, _weapon_range, db)
    if not _rc.ok:
        raise HTTPException(403, {
            "error": True, "code": "OUT_OF_RANGE",
            "message": (
                f"Out of range — {target.name} is {_rc.distance_cells:g} cells away, "
                f"weapon reaches {_rc.max_cells}."
            ),
            "distance_cells": _rc.distance_cells,
            "max_cells": _rc.max_cells,
        })

    adv_mode = resolve_advantage_mode(body.advantage, atk_status_penalties)
    attacker_stats = _char_stats_dict(attacker)
    item_atk_bonus = int(atk_item_bonuses.get("attack_bonus", 0))
    status_atk_penalty = atk_status_penalties.get("attack_penalty", 0)

    atk_result = calculate_combat_attack(
        attacker_stats, target.armor_class, weapon,
        item_atk_bonus, status_atk_penalty, adv_mode,
        dice_count=body.hit_dice_count,
    )
    d20 = atk_result.d20
    sm = atk_result.stat_mod
    wb = atk_result.weapon_bonus
    total = atk_result.total
    fumble = atk_result.fumble
    critical = atk_result.critical
    hit = atk_result.hit

    # Build breakdown string (same logic as execute_attack)
    parts = [f"D20({d20})"]
    if sm != 0:
        _, stat_name = _resolve_display_stat(weapon, attacker, "hit")
        stat_name = stat_name or "STR"
        parts.append(f"{stat_name}({'+' if sm >= 0 else ''}{sm})")
    if wb != 0:
        parts.append(f"{weapon['name'] if weapon else 'Weapon'}({'+' if wb >= 0 else ''}{wb})")
    if item_atk_bonus != 0:
        for bd in atk_item_bonuses.get("breakdown", []):
            if bd["bonus_type"] == "attack_bonus":
                parts.append(f"{bd['source']}(+{int(bd['value'])})")
    if status_atk_penalty != 0:
        parts.append(f"Status({-status_atk_penalty})")

    hit_str = " + ".join(parts) + f" = {total} vs AC {target.armor_class}"
    if fumble:
        hit_str += " → FUMBLE (nat 1)"
    elif critical:
        hit_str += " → CRITICAL HIT (nat 20)"
    elif hit:
        hit_str += " → HIT"
    else:
        hit_str += " → MISS"

    if atk_result.advantage_breakdown:
        hit_str = f"{atk_result.advantage_breakdown} | " + hit_str

    # Suggest default damage dice from weapon
    if weapon:
        default_dc = weapon.get("dice_count", 1)
        default_dt = weapon.get("dice_type", 6)
        weapon_name = weapon.get("name", "Weapon")
        damage_modes = weapon.get("damage_modes") or []
    else:
        default_dc = attacker.attack_dice_count or 1
        default_dt = attacker.attack_dice_type or 6
        weapon_name = "Unarmed"
        damage_modes = []

    # Defense reaction: on a normal hit (not crit, not fumble, not miss)
    # create a pending defense so the target can choose dodge or static AC.
    pending_defense_id = None
    if hit and not critical and not fumble:
        from app.defense_reactions import create_pending_defense, broadcast_defense_request
        sess = await db.get(Session, attacker.session_id)
        session_code = sess.code if sess else ""
        pd = create_pending_defense(
            attacker_id=attacker.id,
            target_id=target.id,
            session_id=attacker.session_id or 0,
            session_code=session_code,
            attack_total=total,
            attack_roll_d20=d20,
            attacker_name=attacker.name,
            target_name=target.name,
            target_ac=target.armor_class,
            critical=critical,
            fumble=fumble,
            hit=hit,
            weapon_name=weapon_name,
        )
        pending_defense_id = pd.id
        await broadcast_defense_request(pd)

    return {
        "hit": hit,
        "critical": critical,
        "fumble": fumble,
        "d20": d20,
        "all_d20s": list(atk_result.all_d20s),
        "dice_count_rolled": len(atk_result.all_d20s),
        "total": total,
        "hit_breakdown": hit_str,
        "advantage_mode": adv_mode,
        "attacker_name": attacker.name,
        "target_name": target.name,
        "target_ac": target.armor_class,
        # Suggest defaults for damage step (read-only for player UI)
        "weapon_name": weapon_name,
        "default_dice_count": default_dc,
        "default_dice_type": default_dt,
        # Rework v3: preset damage modes available on the weapon (can be empty)
        "damage_modes": damage_modes,
        "pending_defense_id": pending_defense_id,
    }


class ResolveDefenseBody(BaseModel):
    mode: str  # "ac" | "dodge_dex" | "dodge_con"
    dice_count: int = 1          # for dodge_dex / dodge_con: how many d20 to roll
    advantage: str = "normal"    # "normal" | "advantage" | "disadvantage"


@router.post("/defense/{pending_id}/resolve")
async def resolve_defense(pending_id: str, body: ResolveDefenseBody, db: AsyncSession = Depends(get_session)):
    """Resolve a pending defense: target chooses AC, dodge (DEX), or brace (CON)."""
    from app.defense_reactions import (
        get_pending_defense, resolve_pending_defense, apply_ability_damage_on_failed_defense,
    )
    from app.game_mechanics import stat_modifier

    pd = get_pending_defense(pending_id)
    if not pd:
        raise HTTPException(404, "Pending defense not found")
    if pd.resolved:
        raise HTTPException(400, "Defense already resolved")

    target = await db.get(Character, pd.target_id)
    if not target:
        raise HTTPException(404, "Target character not found")

    target_stats = {
        "armor_class": target.armor_class,
        "dexterity": target.dexterity,
        "constitution": target.constitution,
    }

    result = await resolve_pending_defense(
        pending_id,
        body.mode,
        target_stats=target_stats,
        dice_count=body.dice_count,
        advantage_mode=body.advantage,
    )
    if not result:
        raise HTTPException(400, "Could not resolve defense")

    # If this originated from an ability and defense failed, apply deferred damage
    if not result.get("success") and pd.ability_context:
        dmg_res = await apply_ability_damage_on_failed_defense(pd, db)
        if dmg_res:
            result["ability_damage"] = dmg_res

    return result


@router.post("/damage-roll")
async def damage_roll(body: DamageRollBody, db: AsyncSession = Depends(get_session)):
    """Step 2: Roll damage dice, apply reduction, deduct HP from target."""
    from app.game_mechanics import (
        _calc_damage_stat_mod, stat_modifier, apply_advantage,
    )

    attacker = await db.get(Character, body.attacker_id)
    target = await db.get(Character, body.target_id)
    if not attacker:
        raise HTTPException(404, "Attacker not found")
    if not target:
        raise HTTPException(404, "Target not found")

    atk_item_bonuses, atk_status_penalties = await _get_char_bonuses_and_penalties(attacker, db)
    tgt_item_bonuses, tgt_status_penalties = await _get_char_bonuses_and_penalties(target, db)
    weapon = await _get_equipped_weapon(body.attacker_id, db)

    # Rework v3: damage dice are fixed by the weapon. If the weapon exposes
    # alternate `damage_modes`, the player picks a preset via
    # ``body.damage_mode_index``. GM-side panel may override `dice_count` /
    # `dice_type` (e.g. to roll extra dice on a power attack); when set on
    # the body they take precedence over weapon defaults.
    damage_modes = (weapon or {}).get("damage_modes") or []
    chosen_mode = None
    if weapon:
        if damage_modes:
            idx = 0 if body.damage_mode_index is None else int(body.damage_mode_index)
            if not (0 <= idx < len(damage_modes)):
                raise HTTPException(400, f"invalid damage_mode_index {idx} (weapon has {len(damage_modes)} modes)")
            chosen_mode = damage_modes[idx]
            dc = int(chosen_mode.get("dice_count", weapon["dice_count"]))
            dt = int(chosen_mode.get("dice_type", weapon["dice_type"]))
        else:
            dc = weapon["dice_count"]
            dt = weapon["dice_type"]
    else:
        dc = attacker.attack_dice_count or 1
        dt = attacker.attack_dice_type or 6

    # GM/Power-attack override: if caller passes explicit dice_count/dice_type,
    # honor them (clamped to a sane range).
    if body.dice_count is not None and int(body.dice_count) > 0:
        dc = max(1, min(20, int(body.dice_count)))
    if body.dice_type is not None and int(body.dice_type) > 0:
        dt = max(2, min(100, int(body.dice_type)))

    # Crit doubles dice count
    actual_dc = dc * 2 if body.critical else dc

    # Roll with advantage on the *damage* total
    attacker_stats = _char_stats_dict(attacker)
    if weapon:
        # Honor the chosen mode's damage_stat if set, else weapon default.
        if chosen_mode and chosen_mode.get("damage_stat") is not None:
            from app.game_mechanics import stat_modifier as _sm
            stat_key = str(chosen_mode.get("damage_stat"))
            raw_val = attacker_stats.get(stat_key)
            dmg_sm = _sm(int(raw_val)) if isinstance(raw_val, int) else 0
        else:
            dmg_sm = _calc_damage_stat_mod(attacker_stats, weapon)
    else:
        dmg_sm = stat_modifier(attacker.strength)

    item_dmg_bonus = int(atk_item_bonuses.get("damage_bonus", 0))
    status_dmg_penalty = atk_status_penalties.get("damage_penalty", 0)

    def _roll_once():
        rolls = [random.randint(1, dt) for _ in range(actual_dc)]
        base = sum(rolls)
        raw = max(0, base + dmg_sm + item_dmg_bonus - status_dmg_penalty)
        return raw, rolls

    adv_mode = body.advantage if body.advantage in ("normal", "advantage", "disadvantage") else "normal"
    adv = apply_advantage(_roll_once, adv_mode)
    dice_rolls = adv.all_details[adv.chosen_index]
    base_damage = sum(dice_rolls)
    raw_damage = adv.chosen_total

    # Build damage breakdown
    dice_str = "+".join(str(r) for r in dice_rolls)
    dmg_parts = [f"{actual_dc}d{dt}({dice_str}={base_damage})"]
    if dmg_sm != 0:
        _, stat_label = _resolve_display_stat(weapon, attacker, "damage")
        stat_label = stat_label or "STR"
        dmg_parts.append(f"{stat_label} mod({'+' if dmg_sm >= 0 else ''}{dmg_sm})")
    if item_dmg_bonus != 0:
        for bd in atk_item_bonuses.get("breakdown", []):
            if bd["bonus_type"] == "damage_bonus":
                dmg_parts.append(f"{bd['source']}(+{int(bd['value'])})")
    if status_dmg_penalty != 0:
        dmg_parts.append(f"Status({-status_dmg_penalty})")

    damage_str = " + ".join(dmg_parts) + f" = {raw_damage} raw"
    if body.critical:
        damage_str = "CRIT ×2 dice! " + damage_str
    if adv_mode != "normal":
        adv_label = "ADV" if adv_mode == "advantage" else "DISADV"
        totals = adv.all_totals
        damage_str = f"{adv_label}: Dmg[{', '.join(str(x) for x in totals)}] took {raw_damage} | " + damage_str

    # Apply target reductions
    tgt_flat_dr = int(tgt_item_bonuses.get("flat_damage_reduction", 0))
    tgt_pct_dr = float(tgt_item_bonuses.get("percent_damage_reduction", 0))
    tgt_dr_penalty = tgt_status_penalties.get("damage_reduction_penalty", 0.0)
    total_pct_reduction = min(100.0, max(0.0, tgt_pct_dr + tgt_dr_penalty))

    after_pct = raw_damage * (1.0 - total_pct_reduction / 100.0)
    final_damage = max(0, int(after_pct) - tgt_flat_dr)

    intake_parts = [f"{raw_damage}"]
    if total_pct_reduction > 0:
        sources = [bd for bd in tgt_item_bonuses.get("breakdown", []) if bd["bonus_type"] == "percent_damage_reduction"]
        src_str = ", ".join(f"{s['source']}({s['value']}%)" for s in sources)
        if tgt_dr_penalty:
            src_str += f", Status({tgt_dr_penalty}%)"
        intake_parts.append(f"× {(100 - total_pct_reduction):.0f}% ({src_str})")
        intake_parts.append(f"= {int(after_pct)}")
    if tgt_flat_dr > 0:
        sources = [bd for bd in tgt_item_bonuses.get("breakdown", []) if bd["bonus_type"] == "flat_damage_reduction"]
        src_str = ", ".join(f"{s['source']}({int(s['value'])})" for s in sources)
        intake_parts.append(f"- {tgt_flat_dr} flat ({src_str})")
    intake_str = " ".join(intake_parts) + f" = {final_damage} final"

    # Apply HP change
    hp_before = target.current_hp
    target.current_hp = max(0, target.current_hp - final_damage)
    hp_after = target.current_hp
    target_downed = hp_after <= 0
    if target_downed:
        target.is_alive = False

    # Rework Phase 5: apply weapon-poison DoT to target (only if damage actually landed)
    poison_applied = None
    if final_damage > 0 and not target_downed:
        poison_applied = await _apply_weapon_poison_on_hit(attacker, target, db)

    await db.commit()
    await db.refresh(target)

    return {
        "critical": body.critical,
        "damage_breakdown": damage_str,
        "intake_breakdown": intake_str,
        "dice_rolls": dice_rolls,
        "raw_damage": raw_damage,
        "final_damage": final_damage,
        "target_hp_before": hp_before,
        "target_hp_after": hp_after,
        "target_downed": target_downed,
        "attacker_name": attacker.name,
        "target_name": target.name,
        "poison": poison_applied,
    }


async def _apply_weapon_poison_on_hit(attacker: Character, target: Character, db: AsyncSession):
    """Rework Phase 5: on a successful hit, check if attacker's equipped weapon has a
    poison coat, roll DoT damage, attach a DoT status effect to target, and consume a charge.
    Returns a small dict describing what happened, or None if no coat.
    """
    from app.models import InventoryItemPoison
    # Find the equipped main_hand weapon inventory entry
    eq = await db.execute(
        select(InventoryItem).where(
            InventoryItem.character_id == attacker.id,
            InventoryItem.is_equipped == True,
            InventoryItem.equipped_slot == "main_hand",
        )
    )
    inv = eq.scalars().first()
    if not inv:
        return None
    coat_q = await db.execute(
        select(InventoryItemPoison).where(InventoryItemPoison.inventory_item_id == inv.id)
    )
    coat = coat_q.scalars().first()
    if not coat or coat.charges_remaining <= 0:
        return None
    tpl = coat.poison_template
    if not tpl:
        return None
    # Roll DoT damage once, lock it in per tick for simplicity
    dice_rolls = [random.randint(1, max(2, tpl.damage_dice_type)) for _ in range(max(1, tpl.damage_dice_count))]
    dot_damage = sum(dice_rolls)
    # Attach status effect
    effect_json = json.dumps([{
        "type": "hp_change_per_turn",
        "value": -int(dot_damage),
        "source": "poison",
        "damage_type": tpl.damage_type,
        "dice_expr": f"{tpl.damage_dice_count}d{tpl.damage_dice_type}",
    }])
    se = CharacterStatusEffect(
        character_id=target.id,
        template_id=None,
        name=f"{tpl.icon} {tpl.name}",
        icon=tpl.icon,
        color=tpl.color,
        effects=effect_json,
        remaining_turns=coat.turns_per_hit,
        applied_by_id=attacker.id,
    )
    db.add(se)
    # Consume charge
    coat.charges_remaining -= 1
    if coat.charges_remaining <= 0:
        await db.delete(coat)
    # Notify listeners
    try:
        await manager.broadcast(target.session_id, {
            "event": "status.update",
            "character_id": target.id,
        })
        await manager.broadcast(attacker.session_id, {
            "event": "inventory.update",
            "character_id": attacker.id,
        })
    except Exception:
        pass
    return {
        "template_id": tpl.id,
        "name": tpl.name,
        "icon": tpl.icon,
        "dice_expr": f"{tpl.damage_dice_count}d{tpl.damage_dice_type}",
        "per_tick_damage": dot_damage,
        "turns": coat.turns_per_hit,
        "charges_remaining": max(0, coat.charges_remaining),
    }
_id, {
            "event": "inventory.update",
            "character_id": attacker.id,
        })
    except Exception:
        pass
    return {
        "template_id": tpl.id,
        "name": tpl.name,
        "icon": tpl.icon,
        "dice_expr": f"{tpl.damage_dice_count}d{tpl.damage_dice_type}",
        "per_tick_damage": dot_damage,
        "turns": coat.turns_per_hit,
        "charges_remaining": max(0, coat.charges_remaining),
    }
