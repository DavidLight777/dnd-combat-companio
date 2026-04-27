from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    MapDrawing,
    MapFloor,
    MapMarker,
    MapObject,
    MapTrap,
    Session,
)
from app.routers.map.common import _ser_drawing, _ser_marker, _ser_object, router


# ── Get all overlays (markers + drawings + objects) ───────────
@router.get("/{session_code}/overlays")
async def get_overlays(session_code: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404)

    # Map Builder: only overlays belonging to the active floor (or
    # with no floor assignment for backward compat) are shipped.
    active_floor = (await db.execute(
        select(MapFloor).where(MapFloor.session_id == session.id).where(MapFloor.is_active == True)
    )).scalar_one_or_none()
    active_floor_id = active_floor.id if active_floor else None

    markers_result = await db.execute(
        select(MapMarker).where(MapMarker.session_id == session.id)
    )
    drawings_result = await db.execute(
        select(MapDrawing).where(MapDrawing.session_id == session.id)
    )
    objects_result = await db.execute(
        select(MapObject).where(MapObject.session_id == session.id)
    )
    traps_result = await db.execute(
        select(MapTrap).where(MapTrap.session_id == session.id)
    )

    def _belongs_to_active_floor(row):
        return getattr(row, 'floor_id', None) is None or getattr(row, 'floor_id', None) == active_floor_id

    return {
        "markers":  [_ser_marker(m)  for m in markers_result.scalars().all() if _belongs_to_active_floor(m)],
        "drawings": [_ser_drawing(d) for d in drawings_result.scalars().all() if _belongs_to_active_floor(d)],
        "objects":  [_ser_object(o)  for o in objects_result.scalars().all() if _belongs_to_active_floor(o)],
        "traps":    [{
            "id": t.id, "col": t.col, "row": t.row, "name": t.name,
            "trap_type": t.trap_type, "trigger_type": t.trigger_type,
            "is_hidden": t.is_hidden, "is_triggered": t.is_triggered,
            "is_disarmed": t.is_disarmed, "damage_dice": t.damage_dice,
            "damage_type": t.damage_type, "dc_detect": t.dc_detect,
        } for t in traps_result.scalars().all() if _belongs_to_active_floor(t)],
    }

