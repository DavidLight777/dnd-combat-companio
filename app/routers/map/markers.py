from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    MapData,
    MapMarker,
    Session,
)
from app.routers.map.common import _ser_marker, router

# MARKERS (Stage 9)
# ══════════════════════════════════════════════════════════════

@router.post("/{session_code}/markers")
async def create_marker(session_code: str, body: dict, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    map_result = await db.execute(select(MapData).where(MapData.session_id == session.id))
    map_data = map_result.scalar_one_or_none()
    if not map_data:
        raise HTTPException(404, "No map loaded")

    m = MapMarker(
        session_id=session.id, map_id=map_data.id,
        marker_type=body.get("marker_type", "pin"),
        x=body["x"], y=body["y"],
        label=body.get("label", ""),
        description=body.get("description", ""),
        icon=body.get("icon", "📌"),
        color=body.get("color", "#ff0000"),
        visible_to_players=body.get("visible_to_players", False),
        created_by=body.get("created_by"),
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return _ser_marker(m)


@router.put("/markers/{marker_id}")
async def update_marker(marker_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    m = await db.get(MapMarker, marker_id)
    if not m:
        raise HTTPException(404)
    for k in ("marker_type", "x", "y", "label", "description", "icon", "color", "visible_to_players"):
        if k in body:
            setattr(m, k, body[k])
    await db.commit()
    await db.refresh(m)
    return _ser_marker(m)


@router.delete("/markers/{marker_id}")
async def delete_marker(marker_id: int, db: AsyncSession = Depends(get_session)):
    m = await db.get(MapMarker, marker_id)
    if not m:
        raise HTTPException(404)
    await db.delete(m)
    await db.commit()
    return {"ok": True}


