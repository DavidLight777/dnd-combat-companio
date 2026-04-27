import json
import os

from fastapi import Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    Character,
    MapData,
    MapFloor,
    MapTemplate,
    Session,
)
from app.routers.map.common import (
    MAPS_DIR,
    MAX_DIMENSION,
    _effective_speed_cells,
    _seed_row,
    router,
)
from app.websocket_manager import manager


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

    # Rework v3 Phase 1: auto-place every character that has no map
    # position yet (map_x / map_y is NULL). Without this, MapCanvas
    # render-skips tokens whose coords are null, so the GM and every
    # player see a completely empty battlefield right after the first
    # upload. Existing placements are left untouched so re-uploading a
    # map doesn't stomp the GM's layout.
    chars_to_place = (await db.execute(
        select(Character).where(Character.session_id == session.id)
    )).scalars().all()
    pcs  = [c for c in chars_to_place if (c.map_x is None or c.map_y is None) and not c.is_npc]
    npcs = [c for c in chars_to_place if (c.map_x is None or c.map_y is None) and c.is_npc]
    _seed_row(pcs,  y_norm=0.08)
    _seed_row(npcs, y_norm=0.92)

    await db.commit()

    # Notify every connected client (GM + players) so they refresh.
    try:
        await manager.broadcast_to_session(session_code, "map.updated", {
            "image_url": image_url,
            "image_width": w,
            "image_height": h,
        })
    except Exception:
        pass

    return {"image_url": image_url, "width": w, "height": h}


# ── Delete uploaded map ──────────────────────────────────────
@router.delete("/{session_code}/upload")
async def delete_map(session_code: str, db: AsyncSession = Depends(get_session)):
    """Remove the uploaded map image for a session.

    Keeps Map Builder floors, tokens, and overlays intact so the GM
    can swap a background image out without losing any layout work.
    """
    result = await db.execute(select(Session).where(Session.code == session_code))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    md = (await db.execute(
        select(MapData).where(MapData.session_id == session.id)
    )).scalar_one_or_none()
    if not md:
        return {"ok": True, "removed": False}

    # Best-effort file removal (missing file is not an error).
    try:
        if md.image_path and os.path.exists(md.image_path):
            os.remove(md.image_path)
    except Exception:
        pass

    await db.delete(md)
    await db.commit()
    try:
        await manager.broadcast_to_session(session_code, "map.updated", {"image_url": None})
    except Exception:
        pass
    return {"ok": True, "removed": True}



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

    # Rework v3 Phase 1 self-heal: auto-seed default positions for any
    # character created AFTER the map was uploaded (NPCs added mid-game,
    # a new player joining an existing session, etc.). Without this
    # pass those tokens have map_x/map_y = NULL and MapCanvas silently
    # skips them — which is exactly how NPCs disappeared in testing.
    # We only run it when a map already exists; otherwise the positions
    # will be seeded by `upload_map` on first upload.
    if map_data:
        unplaced_pcs  = [c for c in chars if (c.map_x is None or c.map_y is None) and not c.is_npc]
        unplaced_npcs = [c for c in chars if (c.map_x is None or c.map_y is None) and c.is_npc]
        if unplaced_pcs or unplaced_npcs:
            _seed_row(unplaced_pcs,  y_norm=0.08)
            _seed_row(unplaced_npcs, y_norm=0.92)
            await db.commit()

    # Phase 4: expose speed/movement fields so the client can draw the
    # reachable overlay and update the HUD without a second round-trip.
    tokens = []
    for c in chars:
        speed_total = await _effective_speed_cells(c, db)
        tokens.append({
            "character_id": c.id, "name": c.name, "is_npc": c.is_npc,
            "x": c.map_x, "y": c.map_y,
            "color": c.token_color, "visible": c.is_visible_on_map,
            "current_hp": c.current_hp, "max_hp": c.max_hp, "is_alive": c.is_alive,
            "vision_radius": c.vision_radius,
            "sight_range_cells": c.sight_range_cells,
            "speed_total": speed_total,
            "movement_used": float(c.movement_used_this_turn or 0.0),
            "movement_left": max(0.0, speed_total - float(c.movement_used_this_turn or 0.0)),
            # Phase 6: portrait image for canvas render.
            "token_image_url": c.token_image_url,
            # Phase 5: bv2 grid position (separate from legacy pixel x/y)
            "bv2_location_id": c.current_location_id,
            "bv2_col": c.col,
            "bv2_row": c.row,
        })

    out: dict = {"has_map": False, "tokens": tokens}

    # Map Builder v2: read visual data from the active MapFloor directly.
    # MapData is now a thin pointer (active_floor_id) + session-level state
    # (fog, tokens).  This removes the need to copy floor data into MapData.
    active_floor = None
    if map_data and map_data.active_floor_id:
        active_floor = await db.get(MapFloor, map_data.active_floor_id)

    if active_floor:
        out = {
            "has_map": True,
            "image_url": active_floor.image_url or map_data.image_url or "",
            "image_width": map_data.image_width,
            "image_height": map_data.image_height,
            "grid_size": active_floor.tile_size or map_data.grid_size or 50,
            "grid_enabled": map_data.grid_enabled,
            "grid_type": active_floor.grid_type or getattr(map_data, "grid_type", "square") or "square",
            "fog_enabled": map_data.fog_enabled,
            "remember_explored": map_data.remember_explored,
            "revealed_cells": json.loads(map_data.revealed_cells),
            "tokens": tokens,
            "active_floor_id": active_floor.id,
            "active_floor_name": active_floor.name,
            "active_floor_tiles": json.loads(active_floor.tiles_json or "{}"),
            "active_floor_grid_type": active_floor.grid_type or "square",
            "active_floor_tile_size": active_floor.tile_size or 50,
            "active_floor_cols": getattr(active_floor, "map_cols", 40) or 40,
            "active_floor_rows": getattr(active_floor, "map_rows", 30) or 30,
        }
        # Include parent map info
        if active_floor.map_id:
            parent_map = await db.get(MapTemplate, active_floor.map_id)
            if parent_map:
                out["active_map_id"] = parent_map.id
                out["active_map_name"] = parent_map.name
    elif map_data:
        # Fallback to legacy MapData fields (transition period)
        out = {
            "has_map": bool(map_data.image_url),
            "image_url": map_data.image_url or "",
            "image_width": map_data.image_width,
            "image_height": map_data.image_height,
            "grid_size": map_data.grid_size,
            "grid_enabled": map_data.grid_enabled,
            "grid_type": getattr(map_data, "grid_type", "square") or "square",
            "fog_enabled": map_data.fog_enabled,
            "remember_explored": map_data.remember_explored,
            "revealed_cells": json.loads(map_data.revealed_cells),
            "tokens": tokens,
        }

    return out



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
    if "grid_type" in body:
        gt = str(body["grid_type"] or "").lower()
        map_data.grid_type = gt if gt in ("square", "hex") else "square"
    if "fog_enabled" in body:
        map_data.fog_enabled = body["fog_enabled"]
    if "remember_explored" in body:
        map_data.remember_explored = body["remember_explored"]
    await db.commit()
    return {"ok": True}


