"""Cover zone entity CRUD — typed detail table, no JSON."""

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    BV2CoverCell,
    BV2CoverZone,
    BV2Entity,
    BV2Location,
)
from app.routers.builder_v2.common import (
    broadcast,
    router,
    ser_entity,
    session_code_for_location,
)


async def _get_cover_entity(entity_id: int, db: AsyncSession):
    e = await db.get(BV2Entity, entity_id)
    if not e or e.entity_type != "cover_zone":
        raise HTTPException(404, "Cover zone not found")
    return e


async def _cover_detail(entity_id: int, db: AsyncSession) -> dict:
    e = await _get_cover_entity(entity_id, db)
    z = await db.get(BV2CoverZone, entity_id)
    if not z:
        raise HTTPException(404, "Cover detail missing")
    cells_r = await db.execute(
        select(BV2CoverCell).where(BV2CoverCell.zone_entity_id == entity_id)
    )
    cells = [{"col": c.col, "row": c.row} for c in cells_r.scalars().all()]
    base = ser_entity(e)
    base.update({
        "cover_level": z.cover_level,
        "material": z.material,
        "blocks_line_of_sight": z.blocks_line_of_sight,
        "is_destructible": z.is_destructible,
        "current_hp": z.current_hp,
        "max_hp": z.max_hp,
        "cells": cells,
    })
    return base


@router.post("/locations/{location_id}/cover-zones")
async def create_cover_zone(location_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")

    col = max(0, min(loc.cols - 1, int(body.get("col", 0))))
    row = max(0, min(loc.rows - 1, int(body.get("row", 0))))

    e = BV2Entity(
        location_id=location_id,
        entity_type="cover_zone",
        col=col,
        row=row,
        name=str(body.get("name") or "")[:120],
        visible_to_players=bool(body.get("visible_to_players", True)),
    )
    db.add(e)
    await db.commit()
    await db.refresh(e)

    z = BV2CoverZone(
        entity_id=e.id,
        cover_level=str(body.get("cover_level", "half"))[:20],
        material=str(body.get("material", "wooden"))[:20],
        blocks_line_of_sight=bool(body.get("blocks_line_of_sight", False)),
        is_destructible=bool(body.get("is_destructible", False)),
        current_hp=body.get("current_hp"),
        max_hp=body.get("max_hp"),
    )
    db.add(z)
    await db.commit()

    sess_code = await session_code_for_location(location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.entity_added", {
            "location_id": location_id,
            "entity": await _cover_detail(e.id, db),
        })
    return await _cover_detail(e.id, db)


@router.get("/cover-zones/{entity_id}")
async def get_cover_zone(entity_id: int, db: AsyncSession = Depends(get_session)):
    return await _cover_detail(entity_id, db)


@router.patch("/cover-zones/{entity_id}")
async def update_cover_zone(entity_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    e = await _get_cover_entity(entity_id, db)
    z = await db.get(BV2CoverZone, entity_id)
    if not z:
        raise HTTPException(404, "Cover detail missing")

    if "name" in body:
        e.name = str(body["name"])[:120]
    if "visible_to_players" in body:
        e.visible_to_players = bool(body["visible_to_players"])
    if "cover_level" in body:
        z.cover_level = str(body["cover_level"])[:20]
    if "material" in body:
        z.material = str(body["material"])[:20]
    if "blocks_line_of_sight" in body:
        z.blocks_line_of_sight = bool(body["blocks_line_of_sight"])
    if "is_destructible" in body:
        z.is_destructible = bool(body["is_destructible"])
    if "current_hp" in body:
        z.current_hp = body["current_hp"]
    if "max_hp" in body:
        z.max_hp = body["max_hp"]

    await db.commit()
    await db.refresh(e)
    await db.refresh(z)

    sess_code = await session_code_for_location(e.location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.entity_updated", {
            "location_id": e.location_id,
            "entity": await _cover_detail(entity_id, db),
        })
    return await _cover_detail(entity_id, db)


@router.delete("/cover-zones/{entity_id}")
async def delete_cover_zone(entity_id: int, db: AsyncSession = Depends(get_session)):
    e = await _get_cover_entity(entity_id, db)
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


# ── Cover cells sub-resource ────────────────────────────────

@router.post("/cover-zones/{entity_id}/cells")
async def add_cover_cell(entity_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    e = await _get_cover_entity(entity_id, db)
    cell = BV2CoverCell(
        zone_entity_id=entity_id,
        col=int(body["col"]),
        row=int(body["row"]),
    )
    db.add(cell)
    await db.commit()
    await db.refresh(cell)

    sess_code = await session_code_for_location(e.location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.entity_updated", {
            "location_id": e.location_id,
            "entity": await _cover_detail(entity_id, db),
        })
    return {"ok": True, "id": cell.id}


@router.delete("/cover-zones/{entity_id}/cells/{col}/{row}")
async def remove_cover_cell(entity_id: int, col: int, row: int, db: AsyncSession = Depends(get_session)):
    e = await _get_cover_entity(entity_id, db)
    r = await db.execute(
        select(BV2CoverCell)
        .where(BV2CoverCell.zone_entity_id == entity_id)
        .where(BV2CoverCell.col == col)
        .where(BV2CoverCell.row == row)
    )
    cell = r.scalar_one_or_none()
    if not cell:
        raise HTTPException(404, "Cell not found")
    await db.delete(cell)
    await db.commit()

    sess_code = await session_code_for_location(e.location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.entity_updated", {
            "location_id": e.location_id,
            "entity": await _cover_detail(entity_id, db),
        })
    return {"ok": True}
