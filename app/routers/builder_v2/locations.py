"""Location-level CRUD: a Location is one playable area inside a Map."""

from fastapi import Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    BV2Edge,
    BV2Entity,
    BV2Light,
    BV2Location,
    BV2Map,
    BV2Tile,
    BV2VisitState,
    Character,
    Session,
)
from app.routers.builder_v2.common import (
    broadcast,
    router,
    ser_entity,
    ser_light,
    ser_location,
    ser_tile,
)


@router.get("/maps/{map_id}/locations")
async def list_locations(map_id: int, db: AsyncSession = Depends(get_session)):
    m = await db.get(BV2Map, map_id)
    if not m:
        raise HTTPException(404, "Map not found")
    r = await db.execute(
        select(BV2Location)
        .where(BV2Location.map_id == map_id)
        .order_by(BV2Location.sort_order, BV2Location.id)
    )
    return [ser_location(loc) for loc in r.scalars().all()]


@router.post("/maps/{map_id}/locations")
async def create_location(map_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    m = await db.get(BV2Map, map_id)
    if not m:
        raise HTTPException(404, "Map not found")

    # Sort order — append to end by default
    r = await db.execute(select(BV2Location).where(BV2Location.map_id == map_id))
    existing = r.scalars().all()
    sort_order = int(body.get("sort_order", len(existing)))

    loc = BV2Location(
        map_id=map_id,
        name=(body.get("name") or f"Location {len(existing) + 1}")[:120],
        description=(body.get("description") or "")[:500],
        sort_order=sort_order,
        grid_type=("hex" if str(body.get("grid_type") or "").lower() == "hex" else "square"),
        tile_size=max(10, min(200, int(body.get("tile_size", 50)))),
        cols=max(5, min(500, int(body.get("cols", 40)))),
        rows=max(5, min(500, int(body.get("rows", 30)))),
        background_color=str(body.get("background_color") or "#1a1a1a")[:10],
        background_image_url=body.get("background_image_url"),
        ambient_light=max(0.0, min(1.0, float(body.get("ambient_light", 1.0)))),
        is_indoor=bool(body.get("is_indoor", False)),
        is_active=False,
    )
    db.add(loc)
    await db.commit()
    await db.refresh(loc)
    s = await db.get(Session, m.session_id)
    if s:
        await broadcast(s.code, "bv2.location_added", ser_location(loc))
    return ser_location(loc)


@router.get("/locations/{location_id}")
async def get_location_full(location_id: int, db: AsyncSession = Depends(get_session)):
    """Full payload — location settings + all tiles + entities + lights."""
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")

    tiles_r = await db.execute(select(BV2Tile).where(BV2Tile.location_id == location_id))
    entities_r = await db.execute(select(BV2Entity).where(BV2Entity.location_id == location_id))
    lights_r = await db.execute(select(BV2Light).where(BV2Light.location_id == location_id))

    return {
        "location": ser_location(loc),
        "tiles": [ser_tile(t) for t in tiles_r.scalars().all()],
        "entities": [ser_entity(e) for e in entities_r.scalars().all()],
        "lights": [ser_light(li) for li in lights_r.scalars().all()],
    }


@router.patch("/locations/{location_id}")
async def update_location(location_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")

    if "name" in body and body["name"]:
        loc.name = str(body["name"])[:120]
    if "description" in body:
        loc.description = str(body["description"] or "")[:500]
    if "sort_order" in body:
        loc.sort_order = int(body["sort_order"])
    if "grid_type" in body:
        gt = str(body["grid_type"] or "").lower()
        loc.grid_type = "hex" if gt == "hex" else "square"
    if "tile_size" in body:
        loc.tile_size = max(10, min(200, int(body["tile_size"])))
    if "cols" in body:
        loc.cols = max(5, min(500, int(body["cols"])))
    if "rows" in body:
        loc.rows = max(5, min(500, int(body["rows"])))
    if "background_color" in body and body["background_color"]:
        loc.background_color = str(body["background_color"])[:10]
    if "background_image_url" in body:
        loc.background_image_url = body["background_image_url"] or None
    if "ambient_light" in body:
        loc.ambient_light = max(0.0, min(1.0, float(body["ambient_light"])))
    if "is_indoor" in body:
        loc.is_indoor = bool(body["is_indoor"])

    await db.commit()
    await db.refresh(loc)

    m = await db.get(BV2Map, loc.map_id)
    s = await db.get(Session, m.session_id) if m else None
    if s:
        await broadcast(s.code, "bv2.location_updated", ser_location(loc))
    return ser_location(loc)


@router.delete("/locations/{location_id}")
async def delete_location(location_id: int, db: AsyncSession = Depends(get_session)):
    """Explicit cascade — see the matching note in maps.delete_map."""
    from sqlalchemy import delete as sa_delete
    from sqlalchemy import update as sa_update

    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")
    m = await db.get(BV2Map, loc.map_id)
    s = await db.get(Session, m.session_id) if m else None
    sess_code = s.code if s else None

    await db.execute(sa_delete(BV2Tile).where(BV2Tile.location_id == location_id))
    await db.execute(sa_delete(BV2Entity).where(BV2Entity.location_id == location_id))
    await db.execute(sa_delete(BV2Light).where(BV2Light.location_id == location_id))
    await db.execute(sa_delete(BV2Edge).where(BV2Edge.location_id == location_id))
    # Nullify edges in OTHER locations that target this one (SQLite ignores ondelete=SET NULL)
    await db.execute(
        sa_update(BV2Edge)
        .where(BV2Edge.target_location_id == location_id)
        .values(target_location_id=None, target_entry_col=0, target_entry_row=0)
    )
    # Nullify characters standing in this location (SQLite ignores ondelete=SET NULL)
    await db.execute(
        sa_update(Character)
        .where(Character.current_location_id == location_id)
        .values(current_location_id=None)
    )
    await db.execute(sa_delete(BV2VisitState).where(BV2VisitState.location_id == location_id))
    await db.delete(loc)
    await db.commit()
    if sess_code:
        await broadcast(sess_code, "bv2.location_deleted", {"location_id": location_id})
    return {"ok": True}


@router.post("/locations/{location_id}/activate")
async def activate_location(location_id: int, db: AsyncSession = Depends(get_session)):
    """Make this Location the active one in its Map. The active map's
    active location is what players see in the runtime view.
    """
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")

    # Deactivate other locations in the same map
    await db.execute(
        update(BV2Location)
        .where(BV2Location.map_id == loc.map_id)
        .where(BV2Location.id != loc.id)
        .values(is_active=False)
    )
    loc.is_active = True

    # Also auto-activate the parent Map (so the runtime resolver picks it)
    m = await db.get(BV2Map, loc.map_id)
    if m:
        await db.execute(
            update(BV2Map)
            .where(BV2Map.session_id == m.session_id)
            .where(BV2Map.id != m.id)
            .values(is_active=False)
        )
        m.is_active = True

    await db.commit()
    await db.refresh(loc)
    s = await db.get(Session, m.session_id) if m else None
    if s:
        await broadcast(s.code, "bv2.location_activated", {
            "map_id": loc.map_id,
            "location_id": loc.id,
            "name": loc.name,
        })
    return ser_location(loc)
