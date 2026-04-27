import json

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    MapData,
    Session,
)
from app.routers.map.common import router


# ── Fog of war: reveal cells ────────────────────────────────
@router.post("/{session_code}/fog/reveal")
async def reveal_fog_cells(session_code: str, body: dict, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404)

    map_result = await db.execute(select(MapData).where(MapData.session_id == session.id))
    map_data = map_result.scalar_one_or_none()
    if not map_data:
        raise HTTPException(404, "No map loaded")

    cells = body.get("cells", [])  # [[col,row],...]
    current = json.loads(map_data.revealed_cells)
    current_set = set(tuple(c) for c in current)
    for cell in cells:
        current_set.add(tuple(cell))
    map_data.revealed_cells = json.dumps(sorted([list(c) for c in current_set]))
    await db.commit()
    return {"revealed_cells": json.loads(map_data.revealed_cells)}


# ── Fog of war: reveal all ──────────────────────────────────
@router.post("/{session_code}/fog/reveal-all")
async def reveal_all_fog(session_code: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404)

    map_result = await db.execute(select(MapData).where(MapData.session_id == session.id))
    map_data = map_result.scalar_one_or_none()
    if not map_data:
        raise HTTPException(404, "No map loaded")

    map_data.fog_enabled = False
    map_data.revealed_cells = "[]"
    await db.commit()
    return {"fog_enabled": False}


# ── Fog of war: reset ───────────────────────────────────────
@router.post("/{session_code}/fog/reset")
async def reset_fog(session_code: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404)

    map_result = await db.execute(select(MapData).where(MapData.session_id == session.id))
    map_data = map_result.scalar_one_or_none()
    if not map_data:
        raise HTTPException(404, "No map loaded")

    map_data.fog_enabled = True
    map_data.revealed_cells = "[]"
    await db.commit()
    return {"fog_enabled": True, "revealed_cells": []}


# ══════════════════════════════════════════════════════════════
