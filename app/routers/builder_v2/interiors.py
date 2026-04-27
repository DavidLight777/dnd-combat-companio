"""Interior zone CRUD: sub-zones inside a Location."""

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    BV2InteriorCell,
    BV2InteriorZone,
    BV2Location,
)
from app.routers.builder_v2.common import (
    broadcast,
    router,
    session_code_for_location,
)


def _zone_payload(z: BV2InteriorZone, cells: list[dict] | None = None) -> dict:
    out = {
        "id": z.id,
        "location_id": z.location_id,
        "name": z.name,
        "kind": z.kind,
        "ambient_light_override": z.ambient_light_override,
        "reveal_mode": z.reveal_mode,
    }
    if cells is not None:
        out["cells"] = cells
    return out


@router.get("/locations/{location_id}/interiors")
async def list_interiors(location_id: int, db: AsyncSession = Depends(get_session)):
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")
    zones_q = await db.execute(
        select(BV2InteriorZone)
        .where(BV2InteriorZone.location_id == location_id)
        .order_by(BV2InteriorZone.id)
    )
    zones = zones_q.scalars().all()
    out = []
    for z in zones:
        cells_q = await db.execute(
            select(BV2InteriorCell)
            .where(BV2InteriorCell.zone_id == z.id)
            .order_by(BV2InteriorCell.id)
        )
        cells = [{"col": c.col, "row": c.row} for c in cells_q.scalars().all()]
        out.append(_zone_payload(z, cells))
    return out


@router.post("/locations/{location_id}/interiors")
async def create_interior(location_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")

    z = BV2InteriorZone(
        location_id=location_id,
        name=str(body.get("name") or "Interior")[:120],
        kind=str(body.get("kind") or "building")[:20],
        ambient_light_override=body.get("ambient_light_override"),
        reveal_mode=str(body.get("reveal_mode") or "on_enter")[:20],
    )
    db.add(z)
    await db.commit()
    await db.refresh(z)

    cells = body.get("cells") or []
    for cell in cells:
        db.add(BV2InteriorCell(
            zone_id=z.id,
            col=int(cell.get("col", 0)),
            row=int(cell.get("row", 0)),
        ))
    await db.commit()

    sess_code = await session_code_for_location(location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.interior_added", {
            "location_id": location_id,
            "zone_id": z.id,
        })

    cells_q = await db.execute(
        select(BV2InteriorCell).where(BV2InteriorCell.zone_id == z.id)
    )
    return _zone_payload(z, [{"col": c.col, "row": c.row} for c in cells_q.scalars().all()])


@router.patch("/interiors/{zone_id}")
async def update_interior(zone_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    z = await db.get(BV2InteriorZone, zone_id)
    if not z:
        raise HTTPException(404, "Zone not found")

    if "name" in body:
        z.name = str(body["name"])[:120]
    if "kind" in body:
        z.kind = str(body["kind"])[:20]
    if "ambient_light_override" in body:
        v = body["ambient_light_override"]
        z.ambient_light_override = float(v) if v is not None else None
    if "reveal_mode" in body:
        z.reveal_mode = str(body["reveal_mode"])[:20]

    await db.commit()
    await db.refresh(z)

    sess_code = await session_code_for_location(z.location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.interior_updated", {
            "location_id": z.location_id,
            "zone_id": z.id,
        })
    return _zone_payload(z)


@router.put("/interiors/{zone_id}/cells")
async def replace_interior_cells(zone_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    z = await db.get(BV2InteriorZone, zone_id)
    if not z:
        raise HTTPException(404, "Zone not found")

    from sqlalchemy import delete as sa_delete
    await db.execute(sa_delete(BV2InteriorCell).where(BV2InteriorCell.zone_id == zone_id))

    cells = body.get("cells") or []
    for cell in cells:
        db.add(BV2InteriorCell(
            zone_id=zone_id,
            col=int(cell.get("col", 0)),
            row=int(cell.get("row", 0)),
        ))
    await db.commit()

    sess_code = await session_code_for_location(z.location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.interior_updated", {
            "location_id": z.location_id,
            "zone_id": z.id,
        })
    return {"ok": True, "cells": cells}


@router.delete("/interiors/{zone_id}")
async def delete_interior(zone_id: int, db: AsyncSession = Depends(get_session)):
    z = await db.get(BV2InteriorZone, zone_id)
    if not z:
        raise HTTPException(404, "Zone not found")

    location_id = z.location_id
    from sqlalchemy import delete as sa_delete
    await db.execute(sa_delete(BV2InteriorCell).where(BV2InteriorCell.zone_id == zone_id))
    await db.delete(z)
    await db.commit()

    sess_code = await session_code_for_location(location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.interior_deleted", {
            "location_id": location_id,
            "zone_id": zone_id,
        })
    return {"ok": True}
