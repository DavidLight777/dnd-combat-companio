"""Trap entity CRUD — typed detail table, no JSON."""

import json
import random
import re

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.game_mechanics import roll_dice
from app.models import (
    BV2Entity,
    BV2Location,
    BV2Trap,
    Character,
    CharacterStatusEffect,
    Session,
)
from app.routers.builder_v2.common import (
    broadcast,
    router,
    ser_entity,
    session_code_for_location,
)
from app.websocket_manager import manager

_DICE_RE = re.compile(r"^(\d+)d(\d+)([+-]\d+)?$")


def _parse_damage_dice(body: dict) -> tuple[int, int]:
    """Extract count and type from damage_dice string or new fields."""
    # Prefer new structured fields
    if "damage_dice_count" in body and "damage_dice_type" in body:
        return max(1, int(body["damage_dice_count"])), int(body["damage_dice_type"])
    # Fallback: parse legacy string like "2d6" or "2d6+3"
    dice = body.get("damage_dice", "")
    if dice:
        m = _DICE_RE.match(str(dice))
        if m:
            return int(m.group(1)), int(m.group(2))
    return 1, 6

_VALID_TRAP_TYPES = {"spike", "dart", "pit", "fire", "poison", "magic", "custom"}
_VALID_DAMAGE_TYPES = {
    "piercing", "slashing", "bludgeoning", "fire", "cold",
    "lightning", "poison", "necrotic", "radiant", "psychic",
    "acid", "thunder", "force",
}
_VALID_ABILITIES = {"str", "dex", "con", "int", "wis", "cha"}
_VALID_TRIGGERS = {"on_enter", "on_exit", "proximity", "manual"}


def _validate_trap_body(body: dict) -> None:
    dice = body.get("damage_dice")
    if dice is not None and not _DICE_RE.match(str(dice)):
        raise HTTPException(422, "damage_dice must match NdM[+K]")
    ttype = body.get("trap_type")
    if ttype is not None and ttype not in _VALID_TRAP_TYPES:
        raise HTTPException(422, f"Invalid trap_type: {ttype}")
    dtype = body.get("damage_type")
    if dtype is not None and dtype not in _VALID_DAMAGE_TYPES:
        raise HTTPException(422, f"Invalid damage_type: {dtype}")
    save = body.get("save_ability")
    if save is not None and save not in _VALID_ABILITIES:
        raise HTTPException(422, f"Invalid save_ability: {save}")
    trig = body.get("trigger_mode")
    if trig is not None and trig not in _VALID_TRIGGERS:
        raise HTTPException(422, f"Invalid trigger_mode: {trig}")


async def _get_trap_entity(entity_id: int, db: AsyncSession):
    e = await db.get(BV2Entity, entity_id)
    if not e or e.entity_type != "trap":
        raise HTTPException(404, "Trap not found")
    return e


async def _trap_detail(entity_id: int, db: AsyncSession) -> dict:
    e = await _get_trap_entity(entity_id, db)
    t = await db.get(BV2Trap, entity_id)
    if not t:
        raise HTTPException(404, "Trap detail missing")
    base = ser_entity(e)
    base.update({
        "trap_type": t.trap_type,
        "damage_dice": t.damage_dice or f"{t.damage_dice_count}d{t.damage_dice_type}",
        "damage_type": t.damage_type,
        "dc_detect": t.dc_detect,
        "dc_disarm": t.dc_disarm,
        "dc_save": t.dc_save,
        "save_ability": t.save_ability,
        "is_triggered": t.is_triggered,
        "is_disarmed": t.is_disarmed,
        "trigger_mode": t.trigger_mode,
        "reset_on_trigger": t.reset_on_trigger,
        "undodgeable": t.undodgeable,
        "attack_bonus": t.attack_bonus,
        "charges": t.charges,
        "charges_used": t.charges_used,
        "is_armed": t.is_armed,
        "dot_effect_json": t.dot_effect_json,
        "size_cells": t.size_cells,
        "dot_template_id": t.dot_template_id,
        "damage_dice_count": t.damage_dice_count,
        "damage_dice_type": t.damage_dice_type,
    })
    return base


@router.post("/locations/{location_id}/traps")
async def create_trap(location_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")
    _validate_trap_body(body)

    col = max(0, min(loc.cols - 1, int(body.get("col", 0))))
    row = max(0, min(loc.rows - 1, int(body.get("row", 0))))

    e = BV2Entity(
        location_id=location_id,
        entity_type="trap",
        col=col,
        row=row,
        name=str(body.get("name") or "")[:120],
        visible_to_players=bool(body.get("visible_to_players", True)),
    )
    db.add(e)
    await db.commit()
    await db.refresh(e)

    dice_count, dice_type = _parse_damage_dice(body)
    t = BV2Trap(
        entity_id=e.id,
        trap_type=str(body.get("trap_type", "spike"))[:20],
        damage_dice=str(body.get("damage_dice", f"{dice_count}d{dice_type}"))[:20],
        damage_type=str(body.get("damage_type", "piercing"))[:20],
        dc_detect=int(body.get("dc_detect", 12)),
        dc_disarm=int(body.get("dc_disarm", 12)),
        dc_save=int(body.get("dc_save", 12)),
        save_ability=str(body.get("save_ability", "dex"))[:10],
        is_triggered=bool(body.get("is_triggered", False)),
        is_disarmed=bool(body.get("is_disarmed", False)),
        trigger_mode=str(body.get("trigger_mode", "on_enter"))[:20],
        reset_on_trigger=bool(body.get("reset_on_trigger", False)),
        undodgeable=bool(body.get("undodgeable", False)),
        attack_bonus=int(body.get("attack_bonus", 0)),
        charges=int(body.get("charges") or 1),
        charges_used=0,
        is_armed=bool(body.get("is_armed", True)),
        dot_effect_json=body.get("dot_effect_json") if body.get("dot_effect_json") else None,
        size_cells=max(1, int(body.get("size_cells", 1))),
        dot_template_id=body.get("dot_template_id") if body.get("dot_template_id") else None,
        damage_dice_count=dice_count,
        damage_dice_type=dice_type,
    )
    db.add(t)
    await db.commit()

    sess_code = await session_code_for_location(location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.entity_added", {
            "location_id": location_id,
            "entity": await _trap_detail(e.id, db),
        })
    return await _trap_detail(e.id, db)


@router.get("/traps/{entity_id}")
async def get_trap(entity_id: int, db: AsyncSession = Depends(get_session)):
    return await _trap_detail(entity_id, db)


@router.patch("/traps/{entity_id}")
async def update_trap(entity_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    _validate_trap_body(body)
    e = await _get_trap_entity(entity_id, db)
    t = await db.get(BV2Trap, entity_id)
    if not t:
        raise HTTPException(404, "Trap detail missing")

    if "name" in body:
        e.name = str(body["name"])[:120]
    if "visible_to_players" in body:
        e.visible_to_players = bool(body["visible_to_players"])
    for k in ("trap_type", "damage_dice", "damage_type", "save_ability", "trigger_mode"):
        if k in body:
            setattr(t, k, str(body[k]))
    for k in ("dc_detect", "dc_disarm", "dc_save", "attack_bonus", "size_cells"):
        if k in body and body[k] is not None:
            setattr(t, k, max(1, int(body[k])))
    if "charges" in body and body["charges"] is not None:
        t.charges = int(body["charges"])
    for k in ("is_triggered", "is_disarmed", "reset_on_trigger", "undodgeable", "is_armed"):
        if k in body:
            setattr(t, k, bool(body[k]))
    if "charges_used" in body:
        t.charges_used = int(body["charges_used"])
    if "dot_effect_json" in body:
        val = body["dot_effect_json"]
        t.dot_effect_json = json.dumps(val) if isinstance(val, dict) else (str(val) if val else None)
    if "dot_template_id" in body:
        val = body["dot_template_id"]
        t.dot_template_id = int(val) if val is not None else None
    if "damage_dice" in body or "damage_dice_count" in body or "damage_dice_type" in body:
        dice_count, dice_type = _parse_damage_dice(body)
        t.damage_dice_count = dice_count
        t.damage_dice_type = dice_type
        t.damage_dice = str(body.get("damage_dice", f"{dice_count}d{dice_type}"))[:20]

    await db.commit()
    await db.refresh(e)
    await db.refresh(t)

    sess_code = await session_code_for_location(e.location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.entity_updated", {
            "location_id": e.location_id,
            "entity": await _trap_detail(entity_id, db),
        })
    return await _trap_detail(entity_id, db)


@router.delete("/traps/{entity_id}")
async def delete_trap(entity_id: int, db: AsyncSession = Depends(get_session)):
    e = await _get_trap_entity(entity_id, db)
    loc_id = e.location_id
    await db.delete(e)
    await db.commit()

    sess_code = await session_code_for_location(loc_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.entity_deleted", {
            "location_id": loc_id,
            "entity_id": entity_id,
        })
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# Phase 17 Round 5: auto-trigger on token move
# ══════════════════════════════════════════════════════════════

async def check_trap_trigger(
    db: AsyncSession,
    location_id: int,
    character: Character,
    session_code: str,
):
    """Fire trap if character stepped inside its zone."""
    # Phase 17 R5: refresh character after it may have been committed in caller
    await db.refresh(character)
    from sqlalchemy import and_
    result = await db.execute(
        select(BV2Entity, BV2Trap)
        .join(BV2Trap, BV2Entity.id == BV2Trap.entity_id)
        .where(
            BV2Entity.location_id == location_id,
            BV2Entity.entity_type == "trap",
            and_(
                character.col >= BV2Entity.col,
                character.col < BV2Entity.col + BV2Trap.size_cells,
                character.row >= BV2Entity.row,
                character.row < BV2Entity.row + BV2Trap.size_cells,
            ),
        )
    )
    row = result.first()
    if not row:
        return
    entity, trap = row

    if not trap.is_armed or trap.is_disarmed:
        return

    if trap.charges != -1 and trap.charges_used >= trap.charges:
        return

    # Dodge check — offer dodge roll if not undodgeable
    if not trap.undodgeable:
        if trap.is_triggered and not trap.reset_on_trigger:
            return
        trap.is_triggered = True
        await db.commit()  # Persist is_triggered so re-entry is blocked
        await manager.broadcast_to_session(session_code, "trap.dodge_offer", {
            "character_id": character.id,
            "character_name": character.name,
            "trap_id": trap.entity_id,
            "trap_name": entity.name or "Trap",
            "attack_bonus": trap.attack_bonus or 0,
        })
        # Dodge resolution is handled by player response; defer damage
        return

    missed = False
    damage = 0
    dot_applied = False
    dot_name = None
    dot_turns = None

    if not missed:
        dice_str = f"{trap.damage_dice_count}d{trap.damage_dice_type}"
        if trap.damage_dice:
            dice_str = trap.damage_dice
        _, damage = roll_dice(dice_str)
        character.current_hp = max(0, (character.current_hp or 0) - damage)

        if trap.dot_effect_json:
            try:
                dot_data = json.loads(trap.dot_effect_json)
            except Exception:
                dot_data = None
            if dot_data and isinstance(dot_data, dict):
                dot_name = dot_data.get("type", "Poison")
                dot_turns = dot_data.get("turns", 3)
                dot_dice = dot_data.get("dice", "1d4")
                cse = CharacterStatusEffect(
                    character_id=character.id,
                    template_id=None,
                    name=dot_name,
                    icon="☠",
                    color="#8a4abf",
                    effects=json.dumps([{"type": "dot", "dice": dot_dice}]),
                    remaining_turns=dot_turns,
                )
                db.add(cse)
                dot_applied = True

    trap.charges_used = (trap.charges_used or 0) + 1
    if trap.charges != -1 and trap.charges_used >= trap.charges:
        trap.is_armed = False

    await db.commit()
    await db.refresh(character)

    await manager.broadcast_to_session(session_code, "trap.triggered", {
        "character_id": character.id,
        "character_name": character.name,
        "trap_id": trap.entity_id,
        "trap_name": entity.name or "Trap",
        "damage": damage,
        "damage_type": trap.damage_type or "piercing",
        "missed": missed,
        "new_hp": character.current_hp,
        "max_hp": character.max_hp,
        "dot_applied": dot_applied,
        "dot_name": dot_name,
        "dot_turns": dot_turns,
    })


@router.post("/traps/{entity_id}/dodge")
async def dodge_trap(entity_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    """Player attempts to dodge a trap."""
    e = await _get_trap_entity(entity_id, db)
    t = await db.get(BV2Trap, entity_id)
    if not t or not t.is_armed or t.is_disarmed:
        raise HTTPException(400, "Trap not active")
    char_id = int(body.get("character_id", 0))
    char = await db.get(Character, char_id)
    if not char:
        raise HTTPException(404, "Character not found")
    force_hit = bool(body.get("force_hit", False))
    dodge_roll = 0 if force_hit else random.randint(1, 20) + (char.dexterity or 0)
    missed = False if force_hit else dodge_roll >= (t.attack_bonus or 0) + 10  # simple dodge threshold
    if not missed:
        # apply damage
        damage = 0
        if t.damage_dice:
            _, damage = roll_dice(t.damage_dice)
            char.current_hp = max(0, (char.current_hp or 0) - damage)
        t.charges_used = (t.charges_used or 0) + 1
        if t.charges != -1 and t.charges_used >= t.charges:
            t.is_armed = False
    # Reset trigger flag so the trap can fire again (unless one-shot)
    if t.reset_on_trigger:
        t.is_triggered = False
    await db.commit()
    if not missed:
        await db.refresh(char)
    sess_code = await session_code_for_location(e.location_id, db)
    if sess_code:
        await manager.broadcast_to_session(sess_code, "trap.dodge_resolved", {
            "character_id": char.id,
            "trap_id": entity_id,
            "missed": missed,
            "new_hp": char.current_hp,
            "damage": damage if not missed else 0,
        })
    return {"missed": missed, "new_hp": char.current_hp, "damage": damage if not missed else 0}


@router.post("/traps/{entity_id}/disarm")
async def disarm_trap(entity_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    """Player attempts to disarm a trap."""
    e = await _get_trap_entity(entity_id, db)
    t = await db.get(BV2Trap, entity_id)
    if not t or not t.is_armed or t.is_disarmed:
        raise HTTPException(400, "Trap not active")
    char_id = int(body.get("character_id", 0))
    char = await db.get(Character, char_id)
    if not char:
        raise HTTPException(404, "Character not found")
    disarm_roll = random.randint(1, 20) + (char.dexterity or 0)
    success = disarm_roll >= t.dc_disarm
    if success:
        t.is_disarmed = True
        await db.commit()
    sess_code = await session_code_for_location(e.location_id, db)
    if sess_code:
        await manager.broadcast_to_session(sess_code, "trap.disarm_resolved", {
            "character_id": char.id,
            "trap_id": entity_id,
            "success": success,
            "is_disarmed": t.is_disarmed,
        })
    return {"success": success, "is_disarmed": t.is_disarmed}
