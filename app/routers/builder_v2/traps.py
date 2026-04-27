"""Trap entity CRUD — typed detail table, no JSON."""

import re

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    BV2Entity,
    BV2Location,
    BV2Trap,
)
from app.routers.builder_v2.common import (
    broadcast,
    router,
    ser_entity,
    session_code_for_location,
)

_DICE_RE = re.compile(r"^(\d+)d(\d+)([+-]\d+)?$")

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
        "damage_dice": t.damage_dice,
        "damage_type": t.damage_type,
        "dc_detect": t.dc_detect,
        "dc_disarm": t.dc_disarm,
        "dc_save": t.dc_save,
        "save_ability": t.save_ability,
        "is_triggered": t.is_triggered,
        "is_disarmed": t.is_disarmed,
        "trigger_mode": t.trigger_mode,
        "reset_on_trigger": t.reset_on_trigger,
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

    t = BV2Trap(
        entity_id=e.id,
        trap_type=str(body.get("trap_type", "spike"))[:20],
        damage_dice=str(body.get("damage_dice", "1d6"))[:20],
        damage_type=str(body.get("damage_type", "piercing"))[:20],
        dc_detect=int(body.get("dc_detect", 12)),
        dc_disarm=int(body.get("dc_disarm", 12)),
        dc_save=int(body.get("dc_save", 12)),
        save_ability=str(body.get("save_ability", "dex"))[:10],
        is_triggered=bool(body.get("is_triggered", False)),
        is_disarmed=bool(body.get("is_disarmed", False)),
        trigger_mode=str(body.get("trigger_mode", "on_enter"))[:20],
        reset_on_trigger=bool(body.get("reset_on_trigger", False)),
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
    for k in ("dc_detect", "dc_disarm", "dc_save"):
        if k in body:
            setattr(t, k, int(body[k]))
    for k in ("is_triggered", "is_disarmed", "reset_on_trigger"):
        if k in body:
            setattr(t, k, bool(body[k]))

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
