"""Map management — upload, tokens, fog of war."""

import os
import json
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from PIL import Image

from app.database import get_session, DATA_DIR
from app.models import Session, Character, MapData, MapMarker, MapDrawing

router = APIRouter(prefix="/api/map", tags=["map"])

MAPS_DIR = os.path.join(DATA_DIR, "maps")
MAX_DIMENSION = 4096


# ── Upload map ───────────────────────────────────────────────
@router.post("/{session_code}/upload")
async def upload_map(session_code: str, file: UploadFile = File(...), db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "File must be an image")

    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(400, "Max file size is 20MB")

    ext = file.filename.rsplit(".", 1)[-1] if "." in file.filename else "png"
    filename = f"{session_code}_map.{ext}"
    filepath = os.path.join(MAPS_DIR, filename)

    with open(filepath, "wb") as f:
        f.write(content)

    # Resize if needed
    img = Image.open(filepath)
    w, h = img.size
    if w > MAX_DIMENSION or h > MAX_DIMENSION:
        ratio = min(MAX_DIMENSION / w, MAX_DIMENSION / h)
        new_size = (int(w * ratio), int(h * ratio))
        img = img.resize(new_size, Image.LANCZOS)
        img.save(filepath)
        w, h = new_size

    image_url = f"/api/map/file/{filename}"

    # Upsert map data
    existing = await db.execute(select(MapData).where(MapData.session_id == session.id))
    map_data = existing.scalar_one_or_none()
    if map_data:
        map_data.image_path = filepath
        map_data.image_url = image_url
        map_data.image_width = w
        map_data.image_height = h
    else:
        map_data = MapData(
            session_id=session.id, image_path=filepath, image_url=image_url,
            image_width=w, image_height=h,
        )
        db.add(map_data)

    await db.commit()
    return {"image_url": image_url, "width": w, "height": h}


# ── Serve map file ───────────────────────────────────────────
@router.get("/file/{filename}")
async def get_map_file(filename: str):
    filepath = os.path.join(MAPS_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(404, "Map file not found")
    return FileResponse(filepath)


# ── Get map state ────────────────────────────────────────────
@router.get("/{session_code}")
async def get_map_state(session_code: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    map_result = await db.execute(select(MapData).where(MapData.session_id == session.id))
    map_data = map_result.scalar_one_or_none()

    # Get token positions
    chars_result = await db.execute(select(Character).where(Character.session_id == session.id))
    chars = chars_result.scalars().all()
    tokens = [
        {
            "character_id": c.id, "name": c.name, "is_npc": c.is_npc,
            "x": c.map_x, "y": c.map_y,
            "color": c.token_color, "visible": c.is_visible_on_map,
            "current_hp": c.current_hp, "max_hp": c.max_hp, "is_alive": c.is_alive,
            "vision_radius": c.vision_radius,
        }
        for c in chars
    ]

    if not map_data:
        return {"has_map": False, "tokens": tokens}

    return {
        "has_map": True,
        "image_url": map_data.image_url,
        "image_width": map_data.image_width,
        "image_height": map_data.image_height,
        "grid_size": map_data.grid_size,
        "grid_enabled": map_data.grid_enabled,
        "fog_enabled": map_data.fog_enabled,
        "remember_explored": map_data.remember_explored,
        "revealed_cells": json.loads(map_data.revealed_cells),
        "tokens": tokens,
    }


# ── Move token ───────────────────────────────────────────────
@router.patch("/token/{character_id}")
async def move_token(character_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, character_id)
    if not c:
        raise HTTPException(404)
    c.map_x = body.get("x", c.map_x)
    c.map_y = body.get("y", c.map_y)
    await db.commit()
    return {"ok": True, "x": c.map_x, "y": c.map_y}


# ── Update grid settings ────────────────────────────────────
@router.patch("/{session_code}/settings")
async def update_map_settings(session_code: str, body: dict, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404)

    map_result = await db.execute(select(MapData).where(MapData.session_id == session.id))
    map_data = map_result.scalar_one_or_none()
    if not map_data:
        raise HTTPException(404, "No map loaded")

    if "grid_size" in body:
        map_data.grid_size = max(20, min(100, body["grid_size"]))
    if "grid_enabled" in body:
        map_data.grid_enabled = body["grid_enabled"]
    if "fog_enabled" in body:
        map_data.fog_enabled = body["fog_enabled"]
    if "remember_explored" in body:
        map_data.remember_explored = body["remember_explored"]
    await db.commit()
    return {"ok": True}


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
# MARKERS (Stage 9)
# ══════════════════════════════════════════════════════════════
def _ser_marker(m: MapMarker) -> dict:
    return {
        "id": m.id, "session_id": m.session_id, "map_id": m.map_id,
        "marker_type": m.marker_type, "x": m.x, "y": m.y,
        "label": m.label, "description": m.description,
        "icon": m.icon, "color": m.color,
        "visible_to_players": m.visible_to_players,
        "created_by": m.created_by,
    }


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


# ══════════════════════════════════════════════════════════════
# DRAWINGS (Stage 9)
# ══════════════════════════════════════════════════════════════
def _ser_drawing(d: MapDrawing) -> dict:
    return {
        "id": d.id, "session_id": d.session_id, "map_id": d.map_id,
        "drawing_type": d.drawing_type,
        "points": json.loads(d.points) if d.points else [],
        "color": d.color, "line_width": d.line_width,
        "fill_opacity": d.fill_opacity,
        "visible_to_players": d.visible_to_players,
        "label": d.label,
    }


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


# ── Get all overlays (markers + drawings) ─────────────────────
@router.get("/{session_code}/overlays")
async def get_overlays(session_code: str, db: AsyncSession = Depends(get_session)):
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404)

    markers_result = await db.execute(
        select(MapMarker).where(MapMarker.session_id == session.id)
    )
    drawings_result = await db.execute(
        select(MapDrawing).where(MapDrawing.session_id == session.id)
    )

    return {
        "markers": [_ser_marker(m) for m in markers_result.scalars().all()],
        "drawings": [_ser_drawing(d) for d in drawings_result.scalars().all()],
    }
