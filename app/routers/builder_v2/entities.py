"""Entity CRUD: chests, traps, portals, npc_spawns, cover_zones, light_markers."""

import json

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import BV2Entity, BV2Location
from app.routers.builder_v2.common import (
    VALID_ENTITY_TYPES,
    broadcast,
    router,
    ser_entity,
    session_code_for_location,
)

# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

def _coerce_props(raw: dict | None) -> str:
    """Validate props is a dict and return JSON string."""
    if raw is None:
        return "{}"
    if not isinstance(raw, dict):
        raise HTTPException(400, "`props` must be an object")
    return json.dumps(raw)


# ─────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────

@router.get("/locations/{location_id}/entities")
async def list_entities(location_id: int, db: AsyncSession = Depends(get_session)):
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")
    r = await db.execute(
        select(BV2Entity).where(BV2Entity.location_id == location_id).order_by(BV2Entity.id)
    )
    return [ser_entity(e) for e in r.scalars().all()]


@router.get("/entities/{entity_id}")
async def get_entity(entity_id: int, db: AsyncSession = Depends(get_session)):
    e = await db.get(BV2Entity, entity_id)
    if not e:
        raise HTTPException(404, "Entity not found")
    return ser_entity(e)


@router.post("/locations/{location_id}/entities")
async def create_entity(location_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")

    entity_type = str(body.get("entity_type") or "").lower()
    if entity_type not in VALID_ENTITY_TYPES:
        raise HTTPException(400, f"Unknown entity_type: {entity_type}")

    col = max(0, min(loc.cols - 1, int(body.get("col", 0))))
    row = max(0, min(loc.rows - 1, int(body.get("row", 0))))

    e = BV2Entity(
        location_id=location_id,
        entity_type=entity_type,
        col=col,
        row=row,
        name=str(body.get("name") or "")[:120],
        props_json=_coerce_props(body.get("props")),
        visible_to_players=bool(body.get("visible_to_players", True)),
    )
    db.add(e)
    await db.commit()
    await db.refresh(e)

    sess_code = await session_code_for_location(location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.entity_added", {
            "location_id": location_id,
            "entity": ser_entity(e),
        })
    return ser_entity(e)


@router.patch("/entities/{entity_id}")
async def update_entity(entity_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    e = await db.get(BV2Entity, entity_id)
    if not e:
        raise HTTPException(404, "Entity not found")

    loc = await db.get(BV2Location, e.location_id)
    if not loc:
        raise HTTPException(404, "Location not found")

    if "entity_type" in body:
        et = str(body["entity_type"]).lower()
        if et not in VALID_ENTITY_TYPES:
            raise HTTPException(400, f"Unknown entity_type: {et}")
        e.entity_type = et

    if "name" in body:
        e.name = str(body["name"])[:120]
    if "col" in body:
        e.col = max(0, min(loc.cols - 1, int(body["col"])))
    if "row" in body:
        e.row = max(0, min(loc.rows - 1, int(body["row"])))
    if "props" in body:
        e.props_json = _coerce_props(body["props"])
    if "visible_to_players" in body:
        e.visible_to_players = bool(body["visible_to_players"])

    await db.commit()
    await db.refresh(e)

    sess_code = await session_code_for_location(e.location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.entity_updated", {
            "location_id": e.location_id,
            "entity": ser_entity(e),
        })
    return ser_entity(e)


@router.delete("/entities/{entity_id}")
async def delete_entity(entity_id: int, db: AsyncSession = Depends(get_session)):
    e = await db.get(BV2Entity, entity_id)
    if not e:
        raise HTTPException(404, "Entity not found")

    location_id = e.location_id
    await db.delete(e)
    await db.commit()

    sess_code = await session_code_for_location(location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.entity_deleted", {
            "location_id": location_id,
            "entity_id": entity_id,
        })
    return {"ok": True}


@router.post("/entities/{entity_id}/move")
async def move_entity(entity_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    e = await db.get(BV2Entity, entity_id)
    if not e:
        raise HTTPException(404, "Entity not found")

    loc = await db.get(BV2Location, e.location_id)
    if not loc:
        raise HTTPException(404, "Location not found")

    e.col = max(0, min(loc.cols - 1, int(body.get("col", e.col))))
    e.row = max(0, min(loc.rows - 1, int(body.get("row", e.row))))

    await db.commit()
    await db.refresh(e)

    sess_code = await session_code_for_location(e.location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.entity_updated", {
            "location_id": e.location_id,
            "entity": ser_entity(e),
        })
    return ser_entity(e)
