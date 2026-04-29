"""Map-level CRUD: a Map is the top-level container that groups Locations."""

from fastapi import Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    BV2Chest,
    BV2ChestItem,
    BV2CoverCell,
    BV2CoverZone,
    BV2Edge,
    BV2Entity,
    BV2InteriorCell,
    BV2InteriorZone,
    BV2Light,
    BV2Location,
    BV2Map,
    BV2NPCSpawn,
    BV2Portal,
    BV2Tile,
    BV2Trap,
    BV2VisitState,
    Character,
    Session,
)
from app.routers.builder_v2.common import (
    broadcast,
    get_session_or_404,
    router,
    ser_map,
)


@router.get("/sessions/{session_code}/maps")
async def list_maps(session_code: str, db: AsyncSession = Depends(get_session)):
    s = await get_session_or_404(session_code, db)
    r = await db.execute(
        select(BV2Map).where(BV2Map.session_id == s.id).order_by(BV2Map.id)
    )
    return [ser_map(m) for m in r.scalars().all()]


@router.post("/sessions/{session_code}/maps")
async def create_map(session_code: str, body: dict, db: AsyncSession = Depends(get_session)):
    s = await get_session_or_404(session_code, db)
    m = BV2Map(
        session_id=s.id,
        name=(body.get("name") or "New Map")[:120],
        description=(body.get("description") or "")[:500],
        is_active=False,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    await broadcast(session_code, "bv2.map_added", ser_map(m))
    return ser_map(m)


@router.patch("/maps/{map_id}")
async def update_map(map_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    m = await db.get(BV2Map, map_id)
    if not m:
        raise HTTPException(404, "Map not found")
    if "name" in body and body["name"]:
        m.name = str(body["name"])[:120]
    if "description" in body:
        m.description = str(body["description"] or "")[:500]
    if "cover_image_url" in body:
        m.cover_image_url = body["cover_image_url"] or None
    await db.commit()
    await db.refresh(m)
    s = await db.get(Session, m.session_id)
    if s:
        await broadcast(s.code, "bv2.map_updated", ser_map(m))
    return ser_map(m)


@router.delete("/maps/{map_id}")
async def delete_map(map_id: int, db: AsyncSession = Depends(get_session)):
    """SQLite doesn't enforce ON DELETE CASCADE by default, so we do it
    explicitly: locations → (tiles, entities, lights, edges, visit-state).
    """
    from sqlalchemy import delete as sa_delete
    from sqlalchemy import select as sa_select
    from sqlalchemy import update as sa_update

    m = await db.get(BV2Map, map_id)
    if not m:
        raise HTTPException(404, "Map not found")
    s = await db.get(Session, m.session_id)
    sess_code = s.code if s else None

    # Find all locations belonging to this map
    r = await db.execute(select(BV2Location.id).where(BV2Location.map_id == map_id))
    loc_ids = [row[0] for row in r.all()]

    if loc_ids:
        # Nullify character pointers BEFORE deleting locations (SQLite ignores ondelete=SET NULL)
        await db.execute(
            sa_update(Character)
            .where(Character.current_location_id.in_(loc_ids))
            .values(current_location_id=None)
        )
        # Explicit detail cleanup before entity delete (SQLite ignores ondelete=CASCADE)
        entity_subq = sa_select(BV2Entity.id).where(BV2Entity.location_id.in_(loc_ids))
        await db.execute(sa_delete(BV2CoverCell).where(BV2CoverCell.zone_entity_id.in_(entity_subq)))
        await db.execute(sa_delete(BV2CoverZone).where(BV2CoverZone.entity_id.in_(entity_subq)))
        await db.execute(sa_delete(BV2ChestItem).where(BV2ChestItem.chest_entity_id.in_(entity_subq)))
        await db.execute(sa_delete(BV2Chest).where(BV2Chest.entity_id.in_(entity_subq)))
        await db.execute(sa_delete(BV2Trap).where(BV2Trap.entity_id.in_(entity_subq)))
        await db.execute(sa_delete(BV2Portal).where(BV2Portal.entity_id.in_(entity_subq)))
        await db.execute(sa_delete(BV2NPCSpawn).where(BV2NPCSpawn.entity_id.in_(entity_subq)))
        await db.execute(sa_delete(BV2Tile).where(BV2Tile.location_id.in_(loc_ids)))
        await db.execute(sa_delete(BV2Entity).where(BV2Entity.location_id.in_(loc_ids)))
        await db.execute(sa_delete(BV2Light).where(BV2Light.location_id.in_(loc_ids)))
        await db.execute(sa_delete(BV2Edge).where(BV2Edge.location_id.in_(loc_ids)))
        await db.execute(sa_delete(BV2VisitState).where(BV2VisitState.location_id.in_(loc_ids)))
        # Interior zones/cells explicit cleanup (SQLite ignores ON DELETE CASCADE)
        zone_ids_q = await db.execute(sa_select(BV2InteriorZone.id).where(BV2InteriorZone.location_id.in_(loc_ids)))
        zone_ids = [r[0] for r in zone_ids_q.all()]
        if zone_ids:
            await db.execute(sa_delete(BV2InteriorCell).where(BV2InteriorCell.zone_id.in_(zone_ids)))
            await db.execute(sa_delete(BV2InteriorZone).where(BV2InteriorZone.id.in_(zone_ids)))
        await db.execute(sa_delete(BV2Location).where(BV2Location.id.in_(loc_ids)))

    await db.delete(m)
    await db.commit()
    if sess_code:
        await broadcast(sess_code, "bv2.map_deleted", {"map_id": map_id})
    return {"ok": True}


@router.post("/maps/{map_id}/activate")
async def activate_map(map_id: int, db: AsyncSession = Depends(get_session)):
    """Mark this Map as the active one for the session. Only one map at
    a time is "active" — the runtime view picks the active map's
    active location.
    """
    m = await db.get(BV2Map, map_id)
    if not m:
        raise HTTPException(404, "Map not found")
    await db.execute(
        update(BV2Map)
        .where(BV2Map.session_id == m.session_id)
        .where(BV2Map.id != m.id)
        .values(is_active=False)
    )
    m.is_active = True
    await db.commit()
    await db.refresh(m)
    s = await db.get(Session, m.session_id)
    if s:
        await broadcast(s.code, "bv2.map_activated", {"map_id": m.id, "name": m.name})
    return ser_map(m)
