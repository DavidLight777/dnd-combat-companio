"""Portal entity CRUD — typed detail table, no JSON."""

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    BV2Entity,
    BV2Location,
    BV2Portal,
)
from app.routers.builder_v2.common import (
    broadcast,
    router,
    ser_entity,
    session_code_for_location,
)


async def _get_portal_entity(entity_id: int, db: AsyncSession):
    e = await db.get(BV2Entity, entity_id)
    if not e or e.entity_type != "portal":
        raise HTTPException(404, "Portal not found")
    return e


async def _portal_detail(entity_id: int, db: AsyncSession) -> dict:
    e = await _get_portal_entity(entity_id, db)
    p = await db.get(BV2Portal, entity_id)
    if not p:
        raise HTTPException(404, "Portal detail missing")
    base = ser_entity(e)
    base.update({
        "target_location_id": p.target_location_id,
        "target_col": p.target_col,
        "target_row": p.target_row,
        "is_one_way": p.is_one_way,
        "requires_key_item_id": p.requires_key_item_id,
        "label": p.label,
        "is_active": p.is_active,
    })
    return base


@router.post("/locations/{location_id}/portals")
async def create_portal(location_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")

    col = max(0, min(loc.cols - 1, int(body.get("col", 0))))
    row = max(0, min(loc.rows - 1, int(body.get("row", 0))))

    e = BV2Entity(
        location_id=location_id,
        entity_type="portal",
        col=col,
        row=row,
        name=str(body.get("name") or "")[:120],
        visible_to_players=bool(body.get("visible_to_players", True)),
    )
    db.add(e)
    await db.commit()
    await db.refresh(e)

    p = BV2Portal(
        entity_id=e.id,
        target_location_id=body.get("target_location_id"),
        target_col=int(body.get("target_col", 0)),
        target_row=int(body.get("target_row", 0)),
        is_one_way=bool(body.get("is_one_way", False)),
        requires_key_item_id=body.get("requires_key_item_id"),
        label=str(body.get("label", ""))[:200],
        is_active=bool(body.get("is_active", True)),
    )
    db.add(p)
    await db.commit()

    sess_code = await session_code_for_location(location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.entity_added", {
            "location_id": location_id,
            "entity": await _portal_detail(e.id, db),
        })
    return await _portal_detail(e.id, db)


@router.get("/portals/{entity_id}")
async def get_portal(entity_id: int, db: AsyncSession = Depends(get_session)):
    return await _portal_detail(entity_id, db)


@router.patch("/portals/{entity_id}")
async def update_portal(entity_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    e = await _get_portal_entity(entity_id, db)
    p = await db.get(BV2Portal, entity_id)
    if not p:
        raise HTTPException(404, "Portal detail missing")

    if "name" in body:
        e.name = str(body["name"])[:120]
    if "visible_to_players" in body:
        e.visible_to_players = bool(body["visible_to_players"])
    if "target_location_id" in body:
        p.target_location_id = body["target_location_id"]
    if "target_col" in body:
        p.target_col = int(body["target_col"])
    if "target_row" in body:
        p.target_row = int(body["target_row"])
    if "is_one_way" in body:
        p.is_one_way = bool(body["is_one_way"])
    if "requires_key_item_id" in body:
        p.requires_key_item_id = body["requires_key_item_id"]
    if "label" in body:
        p.label = str(body["label"])[:200]
    if "is_active" in body:
        p.is_active = bool(body["is_active"])

    await db.commit()
    await db.refresh(e)
    await db.refresh(p)

    sess_code = await session_code_for_location(e.location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.entity_updated", {
            "location_id": e.location_id,
            "entity": await _portal_detail(entity_id, db),
        })
    return await _portal_detail(entity_id, db)


@router.delete("/portals/{entity_id}")
async def delete_portal(entity_id: int, db: AsyncSession = Depends(get_session)):
    e = await _get_portal_entity(entity_id, db)
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
