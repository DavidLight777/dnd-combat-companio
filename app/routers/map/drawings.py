import json

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    MapData,
    MapDrawing,
    Session,
)
from app.routers.map.common import _ser_drawing, router

# ══════════════════════════════════════════════════════════════
# DRAWINGS (Stage 9)
# ══════════════════════════════════════════════════════════════

@router.post("/{session_code}/drawings")
async def create_drawing(session_code: str, body: dict, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    map_result = await db.execute(select(MapData).where(MapData.session_id == session.id))
    map_data = map_result.scalar_one_or_none()
    if not map_data:
        raise HTTPException(404, "No map loaded")

    d = MapDrawing(
        session_id=session.id, map_id=map_data.id,
        drawing_type=body.get("drawing_type", "freehand"),
        points=json.dumps(body.get("points", [])),
        color=body.get("color", "#ff0000"),
        line_width=body.get("line_width", 2),
        fill_opacity=body.get("fill_opacity", 0.2),
        visible_to_players=body.get("visible_to_players", True),
        label=body.get("label"),
    )
    db.add(d)
    await db.commit()
    await db.refresh(d)
    return _ser_drawing(d)


@router.delete("/drawings/{drawing_id}")
async def delete_drawing(drawing_id: int, db: AsyncSession = Depends(get_session)):
    d = await db.get(MapDrawing, drawing_id)
    if not d:
        raise HTTPException(404)
    await db.delete(d)
    await db.commit()
    return {"ok": True}


@router.delete("/{session_code}/drawings/all")
async def clear_all_drawings(session_code: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404)
    await db.execute(
        MapDrawing.__table__.delete().where(MapDrawing.session_id == session.id)
    )
    await db.commit()
    return {"ok": True}


