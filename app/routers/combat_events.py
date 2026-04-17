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
    # FIX 3: optional dice overrides from universal dice widget
    dice_count: int | None = None
    dice_type:  int | None = None


# Two-step attack flow: hit roll only (no damage, no apply)
class HitRollBody(BaseModel):
    attacker_id: int
    target_id: int
    advantage: str = "normal"       # "advantage" | "normal" | "disadvantage"


# Two-step attack flow: damage roll only (applies damage to target)
class DamageRollBody(BaseModel):
    attacker_id: int
    target_id: int
    critical: bool = False          # must come from preceding hit roll
    dice_count: int | None = None   # override weapon dice count
    dice_type:  int | None = None   # override weapon dice type
    advantage: str = "normal"       # advantage on damage roll itself


# ── Helpers ───────────────────────────────────────────────────
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
    return {
        "name": inv.item.name,
        "dice_count": ws.dice_count,
        "dice_type": ws.dice_type,
        "damage_type": ws.damage_type,
        "damage_bonus": 0,
        "attack_bonus": 0,
        "weapon_range": ws.weapon_range or "melee",
        "weapon_properties": props,
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
        stat_name = "STR"
        if weapon:
            props = weapon.get("weapon_properties", [])
            wrange = weapon.get("weapon_range", "melee")
            if wrange == "ranged":
                stat_name = "DEX"
            elif "finesse" in props:
                dex_mod = stat_modifier(attacker.dexterity)
                str_mod = stat_modifier(attacker.strength)
                stat_name = "DEX" if dex_mod > str_mod else "STR"
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

    # Advantage prefix
    if adv_mode != "normal" and body.player_roll is None:
        adv_label = "ADV" if adv_mode == "advantage" else "DISADV"
        d20s = atk_result.all_d20s
        hit_str = f"{adv_label}: D20[{', '.join(str(x) for x in d20s)}] took {d20} | " + hit_str

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
    if weapon:
        dc = weapon["dice_count"]
        dt = weapon["dice_type"]
    else:
        dc = attacker.attack_dice_count or 1
        dt = attacker.attack_dice_type or 6

    # FIX 3: allow universal dice widget to override dice count/type
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
        stat_label = "STR"
        if weapon:
            props = weapon.get("weapon_properties", [])
            wrange = weapon.get("weapon_range", "melee")
            if wrange == "ranged":
                stat_label = "DEX"
            elif "finesse" in props:
                stat_label = "DEX" if stat_modifier(attacker.dexterity) > stat_modifier(attacker.strength) else "STR"
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

    adv_mode = resolve_advantage_mode(body.advantage, atk_status_penalties)
    attacker_stats = _char_stats_dict(attacker)
    item_atk_bonus = int(atk_item_bonuses.get("attack_bonus", 0))
    status_atk_penalty = atk_status_penalties.get("attack_penalty", 0)

    atk_result = calculate_combat_attack(
        attacker_stats, target.armor_class, weapon,
        item_atk_bonus, status_atk_penalty, adv_mode,
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
        stat_name = "STR"
        if weapon:
            props = weapon.get("weapon_properties", [])
            wrange = weapon.get("weapon_range", "melee")
            if wrange == "ranged":
                stat_name = "DEX"
            elif "finesse" in props:
                dex_mod = stat_modifier(attacker.dexterity)
                str_mod = stat_modifier(attacker.strength)
                stat_name = "DEX" if dex_mod > str_mod else "STR"
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

    if adv_mode != "normal":
        adv_label = "ADV" if adv_mode == "advantage" else "DISADV"
        d20s = atk_result.all_d20s
        hit_str = f"{adv_label}: D20[{', '.join(str(x) for x in d20s)}] took {d20} | " + hit_str

    # Suggest default damage dice from weapon
    if weapon:
        default_dc = weapon.get("dice_count", 1)
        default_dt = weapon.get("dice_type", 6)
        weapon_name = weapon.get("name", "Weapon")
    else:
        default_dc = attacker.attack_dice_count or 1
        default_dt = attacker.attack_dice_type or 6
        weapon_name = "Unarmed"

    return {
        "hit": hit,
        "critical": critical,
        "fumble": fumble,
        "d20": d20,
        "total": total,
        "hit_breakdown": hit_str,
        "advantage_mode": adv_mode,
        "attacker_name": attacker.name,
        "target_name": target.name,
        "target_ac": target.armor_class,
        # Suggest defaults for damage step
        "weapon_name": weapon_name,
        "default_dice_count": default_dc,
        "default_dice_type": default_dt,
    }


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

    # Determine dice count/type (weapon defaults, overridable)
    if weapon:
        dc = weapon["dice_count"]
        dt = weapon["dice_type"]
    else:
        dc = attacker.attack_dice_count or 1
        dt = attacker.attack_dice_type or 6
    if body.dice_count is not None and body.dice_count > 0:
        dc = min(20, max(1, int(body.dice_count)))
    if body.dice_type is not None and body.dice_type > 0:
        dt = int(body.dice_type)

    # Crit doubles dice count
    actual_dc = dc * 2 if body.critical else dc

    # Roll with advantage on the *damage* total
    attacker_stats = _char_stats_dict(attacker)
    if weapon:
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
        stat_label = "STR"
        if weapon:
            props = weapon.get("weapon_properties", [])
            wrange = weapon.get("weapon_range", "melee")
            if wrange == "ranged":
                stat_label = "DEX"
            elif "finesse" in props:
                stat_label = "DEX" if stat_modifier(attacker.dexterity) > stat_modifier(attacker.strength) else "STR"
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
    }
