"""NPC spawn entity CRUD — typed detail table, no JSON."""

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    BV2Entity,
    BV2Location,
    BV2NPCSpawn,
)
from app.routers.builder_v2.common import (
    broadcast,
    router,
    ser_entity,
    session_code_for_location,
)


async def _get_spawn_entity(entity_id: int, db: AsyncSession):
    e = await db.get(BV2Entity, entity_id)
    if not e or e.entity_type != "npc_spawn":
        raise HTTPException(404, "NPC spawn not found")
    return e


async def _spawn_detail(entity_id: int, db: AsyncSession) -> dict:
    e = await _get_spawn_entity(entity_id, db)
    s = await db.get(BV2NPCSpawn, entity_id)
    if not s:
        raise HTTPException(404, "Spawn detail missing")
    base = ser_entity(e)
    base.update({
        "npc_template_id": s.npc_template_id,
        "auto_spawn_trigger": s.auto_spawn_trigger,
        "spawn_count": s.spawn_count,
        "has_spawned": s.has_spawned,
        "is_hostile": s.is_hostile,
        "trigger_zone_size": s.trigger_zone_size,
    })
    return base


@router.post("/locations/{location_id}/npc-spawns")
async def create_npc_spawn(location_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")

    col = max(0, min(loc.cols - 1, int(body.get("col", 0))))
    row = max(0, min(loc.rows - 1, int(body.get("row", 0))))

    e = BV2Entity(
        location_id=location_id,
        entity_type="npc_spawn",
        col=col,
        row=row,
        name=str(body.get("name") or "")[:120],
        visible_to_players=bool(body.get("visible_to_players", True)),
    )
    db.add(e)
    await db.commit()
    await db.refresh(e)

    s = BV2NPCSpawn(
        entity_id=e.id,
        npc_template_id=int(body["npc_template_id"]),
        auto_spawn_trigger=str(body.get("auto_spawn_trigger", "on_enter"))[:20],
        spawn_count=int(body.get("spawn_count", 1)),
        has_spawned=bool(body.get("has_spawned", False)),
        is_hostile=bool(body.get("is_hostile", True)),
        trigger_zone_size=max(1, int(body.get("trigger_zone_size", 1))),
    )
    db.add(s)
    await db.commit()

    sess_code = await session_code_for_location(location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.entity_added", {
            "location_id": location_id,
            "entity": await _spawn_detail(e.id, db),
        })
    return await _spawn_detail(e.id, db)


@router.get("/npc-spawns/{entity_id}")
async def get_npc_spawn(entity_id: int, db: AsyncSession = Depends(get_session)):
    return await _spawn_detail(entity_id, db)


@router.patch("/npc-spawns/{entity_id}")
async def update_npc_spawn(entity_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    e = await _get_spawn_entity(entity_id, db)
    s = await db.get(BV2NPCSpawn, entity_id)
    if not s:
        raise HTTPException(404, "Spawn detail missing")

    if "name" in body:
        e.name = str(body["name"])[:120]
    if "visible_to_players" in body:
        e.visible_to_players = bool(body["visible_to_players"])
    if "npc_template_id" in body:
        s.npc_template_id = int(body["npc_template_id"])
    if "auto_spawn_trigger" in body:
        s.auto_spawn_trigger = str(body["auto_spawn_trigger"])[:20]
    if "spawn_count" in body:
        s.spawn_count = int(body["spawn_count"])
    if "has_spawned" in body:
        s.has_spawned = bool(body["has_spawned"])
    if "is_hostile" in body:
        s.is_hostile = bool(body["is_hostile"])
    if "trigger_zone_size" in body:
        s.trigger_zone_size = max(1, int(body["trigger_zone_size"]))

    await db.commit()
    await db.refresh(e)
    await db.refresh(s)

    sess_code = await session_code_for_location(e.location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.entity_updated", {
            "location_id": e.location_id,
            "entity": await _spawn_detail(entity_id, db),
        })
    return await _spawn_detail(entity_id, db)


@router.delete("/npc-spawns/{entity_id}")
async def delete_npc_spawn(entity_id: int, db: AsyncSession = Depends(get_session)):
    e = await _get_spawn_entity(entity_id, db)
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
