"""Map Builder — floors, tiles, traps, interactive objects (doors, etc.)."""

import os
import json
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from PIL import Image

from app.database import get_session, DATA_DIR
from app.models import Session, MapFloor, MapTrap, MapObject, MapLibrary, MapData, MapTemplate, MapChest, MapPortal, Item, Character, InventoryItem
from app.websocket_manager import manager

router = APIRouter(prefix="/api/map-builder", tags=["map-builder"])


def _session_from_code(session_code: str, db: AsyncSession):
    """Synchronous helper (awaited in endpoints)."""
    return db.execute(select(Session).where(Session.code == session_code))


async def _sync_builder_walls_to_objects(f: MapFloor, db: AsyncSession) -> None:
    """Regenerate MapObject walls from a floor's 'wall'/'pit' tiles.

    Unifies the two wall tools: Builder wall brush creates the same
    MapObject rectangles that the Map tab's wall tool does, so collision
    always goes through the single tested pipeline. Works for both
    square and hex grids.
    """
    import math
    from sqlalchemy import delete
    # Remove previous auto-generated walls for this session
    await db.execute(
        delete(MapObject)
        .where(MapObject.session_id == f.session_id)
        .where(MapObject.kind == "builder_wall")
    )
    cols = int(getattr(f, "map_cols", 0) or 0)
    rows = int(getattr(f, "map_rows", 0) or 0)
    if cols <= 0 or rows <= 0:
        return
    try:
        tiles = json.loads(f.tiles_json or "{}")
    except Exception:
        tiles = {}

    grid_type = (f.grid_type or "square").lower()

    if grid_type == "square":
        for key, kind in tiles.items():
            if kind not in ("wall", "pit"):
                continue
            try:
                c, r = map(int, key.split(","))
            except Exception:
                continue
            if c < 0 or r < 0 or c >= cols or r >= rows:
                continue
            x1 = c / cols
            x2 = (c + 1) / cols
            y1 = r / rows
            y2 = (r + 1) / rows
            db.add(MapObject(
                session_id=f.session_id,
                kind="builder_wall",
                name="Wall",
                x1=x1, y1=y1, x2=x2, y2=y2,
                color="#666",
                blocks_movement=True,
                blocks_vision=False,
                visible_to_players=True,
            ))
    elif grid_type == "hex":
        # Pointy-top axial hex → bounding-rect MapObject per wall cell.
        # Bounding rect is an approximation (corner overshoot), but it
        # matches how tokens are positioned (center of hex) so collision
        # feels identical to the square-grid case.
        gs = float(getattr(f, "tile_size", 0) or 50)
        mw = cols * gs
        mh = rows * gs
        if mw <= 0 or mh <= 0:
            return
        half_w = gs / 2.0
        half_h = gs / math.sqrt(3)  # tip-to-center for pointy-top
        for key, kind in tiles.items():
            if kind not in ("wall", "pit"):
                continue
            try:
                q, r = map(int, key.split(","))
            except Exception:
                continue
            cx = gs * (q + r / 2.0)
            cy = gs * (math.sqrt(3) / 2.0) * r
            x1_px = cx - half_w
            x2_px = cx + half_w
            y1_px = cy - half_h
            y2_px = cy + half_h
            # Skip cells entirely outside play area
            if x2_px <= 0 or y2_px <= 0 or x1_px >= mw or y1_px >= mh:
                continue
            # Clamp to play-area box before normalising
            x1_px = max(0.0, x1_px)
            y1_px = max(0.0, y1_px)
            x2_px = min(mw, x2_px)
            y2_px = min(mh, y2_px)
            if x2_px - x1_px < 1e-6 or y2_px - y1_px < 1e-6:
                continue
            db.add(MapObject(
                session_id=f.session_id,
                kind="builder_wall",
                name="Wall",
                x1=x1_px / mw, y1=y1_px / mh,
                x2=x2_px / mw, y2=y2_px / mh,
                color="#666",
                blocks_movement=True,
                blocks_vision=False,
                visible_to_players=True,
            ))


def _ser_floor(f: MapFloor) -> dict:
    return {
        "id": f.id,
        "session_id": f.session_id,
        "map_id": f.map_id,
        "name": f.name,
        "sort_order": f.sort_order,
        "tile_size": f.tile_size,
        "grid_type": f.grid_type,
        "tiles_json": f.tiles_json,
        "is_active": f.is_active,
        "background_color": f.background_color,
        "map_cols": getattr(f, "map_cols", 40) or 40,
        "map_rows": getattr(f, "map_rows", 30) or 30,
        "image_path": f.image_path,
        "image_url": f.image_url,
    }


def _ser_trap(t: MapTrap) -> dict:
    return {
        "id": t.id,
        "session_id": t.session_id,
        "floor_id": t.floor_id,
        "col": t.col,
        "row": t.row,
        "name": t.name,
        "description": t.description,
        "trap_type": t.trap_type,
        "trigger_type": t.trigger_type,
        "dc_detect": t.dc_detect,
        "dc_disarm": t.dc_disarm,
        "damage_dice": t.damage_dice,
        "damage_type": t.damage_type,
        "status_effect_json": t.status_effect_json,
        "is_hidden": t.is_hidden,
        "is_triggered": t.is_triggered,
        "is_disarmed": t.is_disarmed,
        "discovered_by_json": t.discovered_by_json,
    }


async def _get_session_or_404(session_code: str, db: AsyncSession):
    r = await db.execute(select(Session).where(Session.code == session_code))
    s = r.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Session not found")
    return s


async def _broadcast(session_code: str, event: str, payload: dict):
    try:
        await manager.broadcast_to_session(session_code, event, payload)
    except Exception:
        pass


# ══════════════════════════════════════════════════════════════
# FLOORS
# ══════════════════════════════════════════════════════════════
@router.get("/{session_code}/floors")
async def list_floors(session_code: str, db: AsyncSession = Depends(get_session)):
    s = await _get_session_or_404(session_code, db)
    r = await db.execute(
        select(MapFloor).where(MapFloor.session_id == s.id).order_by(MapFloor.sort_order)
    )
    return [_ser_floor(f) for f in r.scalars().all()]


@router.post("/{session_code}/floors")
async def create_floor(session_code: str, body: dict, db: AsyncSession = Depends(get_session)):
    s = await _get_session_or_404(session_code, db)
    name = (body.get("name") or "New Floor")[:60]
    sort_order = int(body.get("sort_order", 0))
    tile_size = int(body.get("tile_size", 50))
    grid_type = (body.get("grid_type") or "square")[:10]
    tiles_json = body.get("tiles_json") or "{}"
    bg = (body.get("background_color") or "#2a2a2a")[:10]

    map_cols = int(body.get("map_cols", 40))
    map_rows = int(body.get("map_rows", 30))
    map_id = body.get("map_id")
    if map_id is not None:
        try:
            map_id = int(map_id)
        except (ValueError, TypeError):
            map_id = None
    f = MapFloor(
        session_id=s.id,
        map_id=map_id,
        name=name,
        sort_order=sort_order,
        tile_size=tile_size,
        grid_type=grid_type,
        tiles_json=tiles_json,
        is_active=False,
        background_color=bg,
        map_cols=map_cols,
        map_rows=map_rows,
    )
    db.add(f)
    await db.commit()
    await db.refresh(f)
    await _broadcast(session_code, "map.floor_added", _ser_floor(f))
    return _ser_floor(f)


@router.patch("/floors/{floor_id}")
async def update_floor(floor_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    f = await db.get(MapFloor, floor_id)
    if not f:
        raise HTTPException(404, "Floor not found")
    for k in ("name", "sort_order", "tile_size", "grid_type", "tiles_json", "background_color", "map_cols", "map_rows"):
        if k in body and body[k] is not None:
            if k in ("sort_order", "tile_size", "map_cols", "map_rows"):
                setattr(f, k, int(body[k]))
            else:
                setattr(f, k, str(body[k]))
    await db.commit()
    await db.refresh(f)
    # Resolve session code
    sess = await db.get(Session, f.session_id)
    if sess:
        await _broadcast(sess.code, "map.floor_updated", _ser_floor(f))
    return _ser_floor(f)


@router.delete("/floors/{floor_id}")
async def delete_floor(floor_id: int, db: AsyncSession = Depends(get_session)):
    f = await db.get(MapFloor, floor_id)
    if not f:
        raise HTTPException(404, "Floor not found")
    sess = await db.get(Session, f.session_id)
    sess_code = sess.code if sess else None
    await db.delete(f)
    await db.commit()
    if sess_code:
        await _broadcast(sess_code, "map.floor_deleted", {"floor_id": floor_id})
    return {"ok": True}


@router.post("/floors/{floor_id}/activate")
async def activate_floor(floor_id: int, db: AsyncSession = Depends(get_session)):
    f = await db.get(MapFloor, floor_id)
    if not f:
        raise HTTPException(404, "Floor not found")
    # Deactivate all other floors in the same session
    from sqlalchemy import update
    await db.execute(
        update(MapFloor)
        .where(MapFloor.session_id == f.session_id)
        .where(MapFloor.id != f.id)
        .values(is_active=False)
    )
    f.is_active = True
    # Regenerate MapObject walls from this floor's wall tiles so the
    # Builder & Map wall tools share one enforcement path.
    await _sync_builder_walls_to_objects(f, db)
    # Update MapData to point at this floor (thin pointer — no data copy)
    map_data = await db.execute(select(MapData).where(MapData.session_id == f.session_id))
    map_data = map_data.scalar_one_or_none()
    if map_data:
        map_data.active_floor_id = f.id
    else:
        map_data = MapData(
            session_id=f.session_id,
            active_floor_id=f.id,
        )
        db.add(map_data)
    await db.commit()
    await db.refresh(f)
    sess = await db.get(Session, f.session_id)
    if sess:
        await _broadcast(sess.code, "map.floor_activated", {"floor_id": f.id, "name": f.name})
        # Push refreshed overlays so clients pick up the regenerated walls.
        await _broadcast(sess.code, "map.objects_updated", {})
        await _broadcast(sess.code, "map.updated", {})
    return _ser_floor(f)


@router.patch("/floors/{floor_id}/tiles")
async def update_tiles(floor_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    f = await db.get(MapFloor, floor_id)
    if not f:
        raise HTTPException(404, "Floor not found")
    tiles = body.get("tiles")
    if tiles is not None:
        if isinstance(tiles, dict):
            f.tiles_json = json.dumps(tiles)
        else:
            f.tiles_json = str(tiles)
    # If this floor is the active one, re-sync MapObject walls now so
    # wall changes take effect without waiting for re-activation.
    if f.is_active:
        await _sync_builder_walls_to_objects(f, db)
    await db.commit()
    await db.refresh(f)
    sess = await db.get(Session, f.session_id)
    if sess:
        await _broadcast(sess.code, "map.tiles_updated", {"floor_id": f.id})
        if f.is_active:
            await _broadcast(sess.code, "map.objects_updated", {})
    return {"floor_id": f.id, "tiles": json.loads(f.tiles_json)}


# ══════════════════════════════════════════════════════════════
# TRAPS
# ══════════════════════════════════════════════════════════════
@router.get("/{session_code}/traps")
async def list_traps(session_code: str, db: AsyncSession = Depends(get_session)):
    s = await _get_session_or_404(session_code, db)
    r = await db.execute(select(MapTrap).where(MapTrap.session_id == s.id))
    return [_ser_trap(t) for t in r.scalars().all()]


@router.post("/{session_code}/traps")
async def create_trap(session_code: str, body: dict, db: AsyncSession = Depends(get_session)):
    s = await _get_session_or_404(session_code, db)
    t = MapTrap(
        session_id=s.id,
        floor_id=body.get("floor_id"),
        col=int(body.get("col", 0)),
        row=int(body.get("row", 0)),
        name=(body.get("name") or "Trap")[:60],
        description=body.get("description", ""),
        trap_type=(body.get("trap_type") or "mechanical")[:20],
        trigger_type=(body.get("trigger_type") or "pressure")[:20],
        dc_detect=int(body.get("dc_detect", 10)),
        dc_disarm=int(body.get("dc_disarm", 10)),
        damage_dice=body.get("damage_dice", ""),
        damage_type=(body.get("damage_type") or "piercing")[:20],
        status_effect_json=body.get("status_effect_json"),
        is_hidden=bool(body.get("is_hidden", True)),
        is_triggered=False,
        is_disarmed=False,
        discovered_by_json="[]",
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    await _broadcast(session_code, "map.trap_added", _ser_trap(t))
    return _ser_trap(t)


@router.patch("/traps/{trap_id}")
async def update_trap(trap_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    t = await db.get(MapTrap, trap_id)
    if not t:
        raise HTTPException(404, "Trap not found")
    for k in ("name", "description", "trap_type", "trigger_type", "damage_dice",
              "damage_type", "status_effect_json"):
        if k in body and body[k] is not None:
            setattr(t, k, str(body[k]))
    for k in ("col", "row", "dc_detect", "dc_disarm"):
        if k in body and body[k] is not None:
            setattr(t, k, int(body[k]))
    for k in ("is_hidden", "is_triggered", "is_disarmed"):
        if k in body and body[k] is not None:
            setattr(t, k, bool(body[k]))
    if "floor_id" in body:
        t.floor_id = body["floor_id"]
    if "discovered_by_json" in body:
        t.discovered_by_json = str(body["discovered_by_json"])
    await db.commit()
    await db.refresh(t)
    sess = await db.get(Session, t.session_id)
    if sess:
        await _broadcast(sess.code, "map.trap_updated", _ser_trap(t))
    return _ser_trap(t)


@router.delete("/traps/{trap_id}")
async def delete_trap(trap_id: int, db: AsyncSession = Depends(get_session)):
    t = await db.get(MapTrap, trap_id)
    if not t:
        raise HTTPException(404, "Trap not found")
    sess = await db.get(Session, t.session_id)
    sess_code = sess.code if sess else None
    await db.delete(t)
    await db.commit()
    if sess_code:
        await _broadcast(sess_code, "map.trap_deleted", {"trap_id": trap_id})
    return {"ok": True}


@router.post("/traps/{trap_id}/trigger")
async def trigger_trap(trap_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    t = await db.get(MapTrap, trap_id)
    if not t:
        raise HTTPException(404, "Trap not found")
    if t.is_disarmed:
        raise HTTPException(400, "Trap is already disarmed")
    t.is_triggered = True
    await db.commit()
    await db.refresh(t)
    sess = await db.get(Session, t.session_id)
    payload = _ser_trap(t)
    payload["character_id"] = body.get("character_id")
    if sess:
        await _broadcast(sess.code, "map.trap_triggered", payload)
    return _ser_trap(t)


@router.post("/traps/{trap_id}/disarm")
async def disarm_trap(trap_id: int, db: AsyncSession = Depends(get_session)):
    t = await db.get(MapTrap, trap_id)
    if not t:
        raise HTTPException(404, "Trap not found")
    t.is_disarmed = True
    t.is_hidden = False
    await db.commit()
    await db.refresh(t)
    sess = await db.get(Session, t.session_id)
    if sess:
        await _broadcast(sess.code, "map.trap_disarmed", _ser_trap(t))
    return _ser_trap(t)


@router.post("/traps/{trap_id}/discover")
async def discover_trap(trap_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    t = await db.get(MapTrap, trap_id)
    if not t:
        raise HTTPException(404, "Trap not found")
    char_id = body.get("character_id")
    if not char_id:
        raise HTTPException(400, "character_id required")
    discovered = json.loads(t.discovered_by_json or "[]")
    if char_id not in discovered:
        discovered.append(int(char_id))
        t.discovered_by_json = json.dumps(discovered)
        t.is_hidden = False
        await db.commit()
        await db.refresh(t)
    sess = await db.get(Session, t.session_id)
    if sess:
        await _broadcast(sess.code, "map.trap_discovered", {
            "trap_id": t.id, "character_id": char_id,
        })
    return _ser_trap(t)


# ══════════════════════════════════════════════════════════════
# INTERACTIVE OBJECTS (doors etc.)
# ══════════════════════════════════════════════════════════════
@router.post("/objects/{object_id}/toggle-door")
async def toggle_door(object_id: int, db: AsyncSession = Depends(get_session)):
    o = await db.get(MapObject, object_id)
    if not o:
        raise HTTPException(404, "Object not found")
    if o.kind not in ("door", "secret_door"):
        raise HTTPException(400, "Not a door")
    o.is_open = not bool(o.is_open)
    await db.commit()
    await db.refresh(o)
    sess = await db.get(Session, o.session_id)
    if sess:
        await _broadcast(sess.code, "map.object_toggled", {
            "object_id": o.id, "kind": o.kind, "is_open": o.is_open,
            "blocks_movement": o.blocks_movement,
        })
    return {
        "id": o.id, "is_open": o.is_open, "kind": o.kind,
        "blocks_movement": o.blocks_movement, "blocks_vision": o.blocks_vision,
    }


# ══════════════════════════════════════════════════════════════
# MAP LIBRARY — Saved map templates
# ══════════════════════════════════════════════════════════════
def _ser_library(m: MapLibrary) -> dict:
    return {
        "id": m.id,
        "name": m.name,
        "description": m.description,
        "image_path": m.image_path,
        "image_url": m.image_url,
        "map_data_json": m.map_data_json,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


@router.get("/{session_code}/library")
async def list_library(session_code: str, db: AsyncSession = Depends(get_session)):
    s = await _get_session_or_404(session_code, db)
    r = await db.execute(
        select(MapLibrary).where(
            (MapLibrary.session_id == s.id) | (MapLibrary.session_id == None)
        ).order_by(MapLibrary.created_at.desc())
    )
    return [_ser_library(m) for m in r.scalars().all()]


@router.post("/{session_code}/library")
async def save_to_library(session_code: str, body: dict, db: AsyncSession = Depends(get_session)):
    s = await _get_session_or_404(session_code, db)

    # Get floors for the specified map (or all session floors if no map_id)
    map_id = body.get("map_id")
    if map_id is not None:
        try:
            map_id = int(map_id)
        except (ValueError, TypeError):
            map_id = None
    if map_id:
        r = await db.execute(
            select(MapFloor)
            .where(MapFloor.session_id == s.id)
            .where(MapFloor.map_id == map_id)
            .order_by(MapFloor.sort_order)
        )
    else:
        r = await db.execute(
            select(MapFloor).where(MapFloor.session_id == s.id).order_by(MapFloor.sort_order)
        )
    floors = r.scalars().all()
    if not floors:
        raise HTTPException(400, "No floors to save")

    # Build snapshot: floors + their entities
    floors_snapshot = []
    floor_id_to_index = {f.id: i for i, f in enumerate(floors)}
    preview_image_path = None
    preview_image_url = None

    for f in floors:
        floor_data = {
            "name": f.name,
            "tiles_json": f.tiles_json,
            "grid_type": f.grid_type,
            "tile_size": f.tile_size,
            "map_cols": f.map_cols,
            "map_rows": f.map_rows,
            "background_color": f.background_color,
            "image_path": f.image_path,
            "image_url": f.image_url,
        }

        # Save traps
        traps_r = await db.execute(select(MapTrap).where(MapTrap.floor_id == f.id))
        floor_data["traps"] = [
            {
                "col": t.col, "row": t.row, "name": t.name,
                "description": t.description, "trap_type": t.trap_type,
                "trigger_type": t.trigger_type, "dc_detect": t.dc_detect,
                "dc_disarm": t.dc_disarm, "damage_dice": t.damage_dice,
                "damage_type": t.damage_type, "status_effect_json": t.status_effect_json,
                "is_hidden": t.is_hidden,
            }
            for t in traps_r.scalars().all()
        ]

        # Save chests
        chests_r = await db.execute(select(MapChest).where(MapChest.floor_id == f.id))
        floor_data["chests"] = [
            {
                "col": c.col, "row": c.row, "name": c.name,
                "items_json": c.items_json, "is_hidden": c.is_hidden,
                "visible_to_players": c.visible_to_players,
                "is_locked": c.is_locked, "lock_dc": c.lock_dc,
            }
            for c in chests_r.scalars().all()
        ]

        # Save portals (target_floor_index instead of target_floor_id for portability)
        portals_r = await db.execute(select(MapPortal).where(MapPortal.floor_id == f.id))
        portals = []
        for p in portals_r.scalars().all():
            portal_data = {
                "col": p.col, "row": p.row, "name": p.name,
                "target_map_id": p.target_map_id,
                "target_col": p.target_col, "target_row": p.target_row,
            }
            # Convert target_floor_id to target_floor_index for portability
            if p.target_floor_id and p.target_floor_id in floor_id_to_index:
                portal_data["target_floor_index"] = floor_id_to_index[p.target_floor_id]
            portals.append(portal_data)
        floor_data["portals"] = portals

        floors_snapshot.append(floor_data)

        if f.image_url and not preview_image_url:
            preview_image_path = f.image_path
            preview_image_url = f.image_url

    map_data = {"floors": floors_snapshot}

    m = MapLibrary(
        session_id=s.id,
        name=body.get("name") or (floors[0].name + " Map"),
        description=body.get("description", ""),
        map_data_json=json.dumps(map_data),
        image_path=preview_image_path,
        image_url=preview_image_url,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return _ser_library(m)


@router.delete("/library/{library_id}")
async def delete_library(library_id: int, db: AsyncSession = Depends(get_session)):
    m = await db.get(MapLibrary, library_id)
    if not m:
        raise HTTPException(404, "Library entry not found")
    await db.delete(m)
    await db.commit()
    return {"ok": True}


@router.post("/library/{library_id}/load")
async def load_from_library(library_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    m = await db.get(MapLibrary, library_id)
    if not m:
        raise HTTPException(404, "Library entry not found")

    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(400, "session_id required")
    sess = await db.get(Session, session_id)
    if not sess:
        raise HTTPException(404, "Session not found")

    try:
        map_data = json.loads(m.map_data_json or "{}")
    except Exception:
        map_data = {}

    floors_data = map_data.get("floors", [])
    if not floors_data:
        # Fallback for old single-floor library entries
        floors_data = [{
            "name": m.name,
            "tiles_json": map_data.get("tiles_json", "{}"),
            "grid_type": map_data.get("grid_type", "square"),
            "tile_size": map_data.get("tile_size", 50),
            "map_cols": map_data.get("map_cols", 40),
            "map_rows": map_data.get("map_rows", 30),
            "background_color": map_data.get("background_color", "#2a2a2a"),
            "image_path": m.image_path,
            "image_url": m.image_url,
        }]

    # Count existing floors for starting sort_order
    r = await db.execute(select(MapFloor).where(MapFloor.session_id == session_id))
    base_sort = len(r.scalars().all())

    # Create new MapTemplate for the loaded map
    new_map = MapTemplate(
        session_id=session_id,
        name=m.name,
        description=m.description or "",
    )
    db.add(new_map)
    await db.commit()
    await db.refresh(new_map)

    created_floors = []
    floor_index_to_id = {}

    # Step 1: Create all floors
    for i, fd in enumerate(floors_data):
        f = MapFloor(
            session_id=session_id,
            map_id=new_map.id,
            name=fd.get("name", f"Floor {i+1}"),
            sort_order=base_sort + i,
            tile_size=fd.get("tile_size", 50),
            grid_type=fd.get("grid_type", "square"),
            tiles_json=fd.get("tiles_json", "{}"),
            background_color=fd.get("background_color", "#2a2a2a"),
            map_cols=fd.get("map_cols", 40),
            map_rows=fd.get("map_rows", 30),
            image_path=fd.get("image_path"),
            image_url=fd.get("image_url"),
        )
        db.add(f)
        await db.commit()
        await db.refresh(f)
        created_floors.append(_ser_floor(f))
        floor_index_to_id[i] = f.id
        await _broadcast(sess.code, "map.floor_added", _ser_floor(f))

    # Step 2: Create entities on each floor
    for i, fd in enumerate(floors_data):
        floor_id = floor_index_to_id[i]

        # Create traps
        for t in fd.get("traps", []):
            trap = MapTrap(
                session_id=session_id,
                floor_id=floor_id,
                col=t["col"], row=t["row"], name=t["name"],
                description=t.get("description", ""),
                trap_type=t.get("trap_type", "mechanical"),
                trigger_type=t.get("trigger_type", "pressure"),
                dc_detect=t.get("dc_detect", 10),
                dc_disarm=t.get("dc_disarm", 10),
                damage_dice=t.get("damage_dice", ""),
                damage_type=t.get("damage_type", "piercing"),
                status_effect_json=t.get("status_effect_json"),
                is_hidden=t.get("is_hidden", True),
            )
            db.add(trap)

        # Create chests
        for c in fd.get("chests", []):
            chest = MapChest(
                session_id=session_id,
                floor_id=floor_id,
                col=c["col"], row=c["row"], name=c["name"],
                items_json=c.get("items_json", "[]"),
                is_hidden=c.get("is_hidden", False),
                visible_to_players=c.get("visible_to_players", True),
                is_locked=c.get("is_locked", False),
                lock_dc=c.get("lock_dc", 10),
            )
            db.add(chest)

        # Create portals
        for p in fd.get("portals", []):
            # Resolve target_floor_index back to target_floor_id
            target_floor_id = None
            if "target_floor_index" in p:
                target_floor_id = floor_index_to_id.get(p["target_floor_index"])

            portal = MapPortal(
                session_id=session_id,
                floor_id=floor_id,
                col=p["col"], row=p["row"], name=p["name"],
                target_map_id=p.get("target_map_id"),
                target_floor_id=target_floor_id,
                target_col=p.get("target_col", 0),
                target_row=p.get("target_row", 0),
            )
            db.add(portal)

    await db.commit()

    # Step 3: Auto-activate the first floor
    if created_floors:
        first_floor_id = created_floors[0]["id"]
        # Call activate_floor logic inline
        f = await db.get(MapFloor, first_floor_id)
        if f:
            from sqlalchemy import update
            await db.execute(
                update(MapFloor)
                .where(MapFloor.session_id == f.session_id)
                .where(MapFloor.id != f.id)
                .values(is_active=False)
            )
            f.is_active = True
            await _sync_builder_walls_to_objects(f, db)
            map_data_row = await db.execute(select(MapData).where(MapData.session_id == f.session_id))
            map_data_row = map_data_row.scalar_one_or_none()
            if map_data_row:
                map_data_row.active_floor_id = f.id
            else:
                map_data_row = MapData(session_id=f.session_id, active_floor_id=f.id)
                db.add(map_data_row)
            await db.commit()
            await _broadcast(sess.code, "map.floor_activated", {"floor_id": f.id, "name": f.name})
            await _broadcast(sess.code, "map.objects_updated", {})
            await _broadcast(sess.code, "map.updated", {})

    return {"floors": created_floors, "count": len(created_floors), "map_id": new_map.id}


@router.patch("/floors/{floor_id}/image")
async def update_floor_image(floor_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    f = await db.get(MapFloor, floor_id)
    if not f:
        raise HTTPException(404, "Floor not found")
    if "image_path" in body:
        f.image_path = body["image_path"]
    if "image_url" in body:
        f.image_url = body["image_url"]
    await db.commit()
    await db.refresh(f)
    sess = await db.get(Session, f.session_id)
    if sess:
        await _broadcast(sess.code, "map.floor_updated", _ser_floor(f))
    return _ser_floor(f)


BUILDER_UPLOADS_DIR = os.path.join(DATA_DIR, "builder_uploads")
os.makedirs(BUILDER_UPLOADS_DIR, exist_ok=True)
MAX_BUILDER_IMG_DIM = 4096


@router.post("/floors/{floor_id}/upload-image")
async def upload_floor_image(
    floor_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_session),
):
    f = await db.get(MapFloor, floor_id)
    if not f:
        raise HTTPException(404, "Floor not found")

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "File must be an image")

    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(400, "Max file size is 20MB")

    ext = file.filename.rsplit(".", 1)[-1] if "." in file.filename else "png"
    filename = f"floor_{floor_id}_{os.urandom(4).hex()}.{ext}"
    filepath = os.path.join(BUILDER_UPLOADS_DIR, filename)

    with open(filepath, "wb") as fh:
        fh.write(content)

    # Resize if needed
    img = Image.open(filepath)
    w, h = img.size
    if w > MAX_BUILDER_IMG_DIM or h > MAX_BUILDER_IMG_DIM:
        ratio = min(MAX_BUILDER_IMG_DIM / w, MAX_BUILDER_IMG_DIM / h)
        new_size = (int(w * ratio), int(h * ratio))
        img = img.resize(new_size, Image.LANCZOS)
        img.save(filepath)
        w, h = new_size

    image_url = f"/api/map-builder/file/{filename}"
    f.image_path = filepath
    f.image_url = image_url
    await db.commit()
    await db.refresh(f)
    sess = await db.get(Session, f.session_id)
    if sess:
        await _broadcast(sess.code, "map.floor_updated", _ser_floor(f))
    return {"path": filepath, "url": image_url, "width": w, "height": h}


@router.get("/file/{filename}")
async def serve_builder_file(filename: str):
    filepath = os.path.join(BUILDER_UPLOADS_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(404, "File not found")
    return FileResponse(filepath)


# ══════════════════════════════════════════════════════════════
# MAP TEMPLATES (Map containers)
# ══════════════════════════════════════════════════════════════
@router.get("/{session_code}/maps")
async def list_maps(session_code: str, db: AsyncSession = Depends(get_session)):
    s = await _get_session_or_404(session_code, db)
    r = await db.execute(
        select(MapTemplate).where(MapTemplate.session_id == s.id).order_by(MapTemplate.id)
    )
    return [{"id": m.id, "name": m.name, "description": m.description, "is_active": m.is_active} for m in r.scalars().all()]


@router.post("/{session_code}/maps")
async def create_map(session_code: str, body: dict, db: AsyncSession = Depends(get_session)):
    s = await _get_session_or_404(session_code, db)
    m = MapTemplate(
        session_id=s.id,
        name=body.get("name", "New Map"),
        description=body.get("description", ""),
        is_active=False,
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return {"id": m.id, "name": m.name, "description": m.description, "is_active": m.is_active}


@router.post("/maps/{map_id}/activate")
async def activate_map(map_id: int, db: AsyncSession = Depends(get_session)):
    m = await db.get(MapTemplate, map_id)
    if not m:
        raise HTTPException(404, "Map not found")
    # Deactivate all other maps in session
    from sqlalchemy import update
    await db.execute(
        update(MapTemplate)
        .where(MapTemplate.session_id == m.session_id)
        .where(MapTemplate.id != m.id)
        .values(is_active=False)
    )
    m.is_active = True
    await db.commit()
    await db.refresh(m)
    sess = await db.get(Session, m.session_id)
    if sess:
        await _broadcast(sess.code, "map.map_activated", {"map_id": m.id, "name": m.name})
    return {"id": m.id, "name": m.name, "is_active": m.is_active}


@router.patch("/maps/{map_id}/floors/{floor_id}")
async def assign_floor_to_map(map_id: int, floor_id: int, db: AsyncSession = Depends(get_session)):
    m = await db.get(MapTemplate, map_id)
    if not m:
        raise HTTPException(404, "Map not found")
    f = await db.get(MapFloor, floor_id)
    if not f or f.session_id != m.session_id:
        raise HTTPException(404, "Floor not found")
    f.map_id = m.id
    await db.commit()
    await db.refresh(f)
    sess = await db.get(Session, m.session_id)
    if sess:
        await _broadcast(sess.code, "map.floor_updated", _ser_floor(f))
    return _ser_floor(f)


@router.get("/maps/{map_id}/floors")
async def get_map_floors(map_id: int, db: AsyncSession = Depends(get_session)):
    m = await db.get(MapTemplate, map_id)
    if not m:
        raise HTTPException(404, "Map not found")
    r = await db.execute(
        select(MapFloor).where(MapFloor.map_id == map_id).order_by(MapFloor.sort_order)
    )
    return [_ser_floor(f) for f in r.scalars().all()]


# ══════════════════════════════════════════════════════════════
# MAP CHESTS
# ══════════════════════════════════════════════════════════════
def _ser_chest(c: MapChest) -> dict:
    return {
        "id": c.id, "session_id": c.session_id, "floor_id": c.floor_id,
        "col": c.col, "row": c.row, "name": c.name,
        "items_json": c.items_json, "is_hidden": c.is_hidden,
        "visible_to_players": c.visible_to_players,
        "is_locked": c.is_locked, "lock_dc": c.lock_dc,
    }


@router.get("/{session_code}/chests")
async def list_chests(session_code: str, db: AsyncSession = Depends(get_session)):
    s = await _get_session_or_404(session_code, db)
    r = await db.execute(select(MapChest).where(MapChest.session_id == s.id))
    return [_ser_chest(c) for c in r.scalars().all()]


@router.post("/{session_code}/chests")
async def create_chest(session_code: str, body: dict, db: AsyncSession = Depends(get_session)):
    s = await _get_session_or_404(session_code, db)
    c = MapChest(
        session_id=s.id,
        floor_id=body.get("floor_id"),
        col=int(body.get("col", 0)),
        row=int(body.get("row", 0)),
        name=body.get("name", "Chest"),
        items_json=json.dumps(body.get("items", [])),
        is_hidden=bool(body.get("is_hidden", False)),
        visible_to_players=bool(body.get("visible_to_players", True)),
        is_locked=bool(body.get("is_locked", False)),
        lock_dc=int(body.get("lock_dc", 10)),
    )
    db.add(c)
    await db.commit()
    await db.refresh(c)
    await _broadcast(session_code, "map.chest_added", _ser_chest(c))
    return _ser_chest(c)


@router.patch("/chests/{chest_id}")
async def update_chest(chest_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    c = await db.get(MapChest, chest_id)
    if not c:
        raise HTTPException(404, "Chest not found")
    for k in ("name", "items_json", "is_hidden", "visible_to_players", "is_locked", "lock_dc"):
        if k in body and body[k] is not None:
            if k in ("is_hidden", "visible_to_players", "is_locked"):
                setattr(c, k, bool(body[k]))
            elif k == "lock_dc":
                setattr(c, k, int(body[k]))
            else:
                setattr(c, k, str(body[k]))
    if "items" in body:
        c.items_json = json.dumps(body["items"])
    await db.commit()
    await db.refresh(c)
    sess = await db.get(Session, c.session_id)
    if sess:
        await _broadcast(sess.code, "map.chest_updated", _ser_chest(c))
    return _ser_chest(c)


@router.delete("/chests/{chest_id}")
async def delete_chest(chest_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(MapChest, chest_id)
    if not c:
        raise HTTPException(404, "Chest not found")
    sess = await db.get(Session, c.session_id)
    sess_code = sess.code if sess else None
    await db.delete(c)
    await db.commit()
    if sess_code:
        await _broadcast(sess_code, "map.chest_deleted", {"chest_id": chest_id})
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# MAP PORTALS
# ══════════════════════════════════════════════════════════════
def _ser_portal(p: MapPortal) -> dict:
    return {
        "id": p.id, "session_id": p.session_id, "floor_id": p.floor_id,
        "col": p.col, "row": p.row, "name": p.name,
        "target_map_id": p.target_map_id, "target_floor_id": p.target_floor_id,
        "target_col": p.target_col, "target_row": p.target_row,
    }


@router.get("/{session_code}/portals")
async def list_portals(session_code: str, db: AsyncSession = Depends(get_session)):
    s = await _get_session_or_404(session_code, db)
    r = await db.execute(select(MapPortal).where(MapPortal.session_id == s.id))
    return [_ser_portal(p) for p in r.scalars().all()]


@router.post("/{session_code}/portals")
async def create_portal(session_code: str, body: dict, db: AsyncSession = Depends(get_session)):
    s = await _get_session_or_404(session_code, db)
    p = MapPortal(
        session_id=s.id,
        floor_id=body.get("floor_id"),
        col=int(body.get("col", 0)),
        row=int(body.get("row", 0)),
        name=body.get("name", "Portal"),
        target_map_id=body.get("target_map_id"),
        target_floor_id=body.get("target_floor_id"),
        target_col=int(body.get("target_col", 0)),
        target_row=int(body.get("target_row", 0)),
    )
    db.add(p)
    await db.commit()
    await db.refresh(p)
    await _broadcast(session_code, "map.portal_added", _ser_portal(p))
    return _ser_portal(p)


@router.patch("/portals/{portal_id}")
async def update_portal(portal_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    p = await db.get(MapPortal, portal_id)
    if not p:
        raise HTTPException(404, "Portal not found")
    for k in ("name", "target_map_id", "target_floor_id", "target_col", "target_row"):
        if k in body and body[k] is not None:
            if k in ("target_col", "target_row"):
                setattr(p, k, int(body[k]))
            else:
                setattr(p, k, body[k])
    await db.commit()
    await db.refresh(p)
    sess = await db.get(Session, p.session_id)
    if sess:
        await _broadcast(sess.code, "map.portal_updated", _ser_portal(p))
    return _ser_portal(p)


@router.delete("/portals/{portal_id}")
async def delete_portal(portal_id: int, db: AsyncSession = Depends(get_session)):
    p = await db.get(MapPortal, portal_id)
    if not p:
        raise HTTPException(404, "Portal not found")
    sess = await db.get(Session, p.session_id)
    sess_code = sess.code if sess else None
    await db.delete(p)
    await db.commit()
    if sess_code:
        await _broadcast(sess_code, "map.portal_deleted", {"portal_id": portal_id})
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# MAP CHEST ITEMS (loot system)
# ══════════════════════════════════════════════════════════════
@router.get("/chests/{chest_id}/items")
async def get_chest_items(chest_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(MapChest, chest_id)
    if not c:
        raise HTTPException(404, "Chest not found")
    try:
        items = json.loads(c.items_json or "[]")
    except Exception:
        items = []
    # Enrich with item names
    result = []
    for it in items:
        item_name = it.get("item_name", "Unknown")
        if not item_name or item_name == "Unknown":
            # Try to fetch from DB
            item_id = it.get("item_id")
            if item_id:
                db_item = await db.get(Item, item_id)
                if db_item:
                    item_name = db_item.name
        result.append({**it, "item_name": item_name})
    return {"chest_id": chest_id, "items": result, "is_locked": c.is_locked, "lock_dc": c.lock_dc}


@router.post("/chests/{chest_id}/items")
async def add_item_to_chest(chest_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    c = await db.get(MapChest, chest_id)
    if not c:
        raise HTTPException(404, "Chest not found")
    try:
        items = json.loads(c.items_json or "[]")
    except Exception:
        items = []
    new_item = {
        "item_id": body.get("item_id"),
        "quantity": int(body.get("quantity", 1)),
        "item_name": body.get("item_name", "Unknown"),
        "item_type": body.get("item_type", "item"),  # item, currency
        "currency_type": body.get("currency_type"),  # gold, silver, bronze
    }
    items.append(new_item)
    c.items_json = json.dumps(items)
    await db.commit()
    await db.refresh(c)
    sess = await db.get(Session, c.session_id)
    if sess:
        await _broadcast(sess.code, "map.chest_updated", _ser_chest(c))
    return _ser_chest(c)


@router.delete("/chests/{chest_id}/items/{item_index}")
async def remove_item_from_chest(chest_id: int, item_index: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(MapChest, chest_id)
    if not c:
        raise HTTPException(404, "Chest not found")
    try:
        items = json.loads(c.items_json or "[]")
    except Exception:
        items = []
    if 0 <= item_index < len(items):
        items.pop(item_index)
    c.items_json = json.dumps(items)
    await db.commit()
    await db.refresh(c)
    sess = await db.get(Session, c.session_id)
    if sess:
        await _broadcast(sess.code, "map.chest_updated", _ser_chest(c))
    return _ser_chest(c)


@router.post("/chests/{chest_id}/take")
async def take_items_from_chest(chest_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    """Player takes items from a MapChest.
    
    body: {
        character_id: int,
        item_indices: [0, 2],  # which items to take (null = take all)
    }
    """
    c = await db.get(MapChest, chest_id)
    if not c:
        raise HTTPException(404, "Chest not found")
    
    char = await db.get(Character, body.get("character_id"))
    if not char:
        raise HTTPException(404, "Character not found")
    
    try:
        items = json.loads(c.items_json or "[]")
    except Exception:
        items = []
    
    if not items:
        return {"taken": [], "message": "Chest is empty"}
    
    item_indices = body.get("item_indices")
    if item_indices is None:
        item_indices = list(range(len(items)))
    
    taken = []
    remaining = []
    
    for i, it in enumerate(items):
        if i in item_indices:
            # Handle currency
            if it.get("item_type") == "currency":
                currency_type = it.get("currency_type", "bronze")
                quantity = int(it.get("quantity", 0))
                if quantity > 0:
                    if currency_type == "gold":
                        char.gold = (char.gold or 0) + quantity
                    elif currency_type == "silver":
                        # Convert to bronze for simplicity
                        char.wealth_bronze = (char.wealth_bronze or 0) + quantity * 10
                    else:
                        char.wealth_bronze = (char.wealth_bronze or 0) + quantity
                    taken.append({**it, "taken": True})
            else:
                # Regular item - add to inventory
                item_id = it.get("item_id")
                quantity = int(it.get("quantity", 1))
                if item_id:
                    inv_item = InventoryItem(
                        character_id=char.id,
                        item_id=item_id,
                        quantity=quantity,
                    )
                    db.add(inv_item)
                taken.append({**it, "taken": True})
        else:
            remaining.append(it)
    
    c.items_json = json.dumps(remaining)
    await db.commit()
    await db.refresh(c)
    
    sess = await db.get(Session, c.session_id)
    if sess:
        await _broadcast(sess.code, "map.chest_updated", _ser_chest(c))
    
    return {"taken": taken, "remaining_count": len(remaining)}


# ══════════════════════════════════════════════════════════════
# PORTAL TELEPORTATION
# ══════════════════════════════════════════════════════════════
@router.post("/portals/{portal_id}/use")
async def use_portal(portal_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    """Teleport a character through a portal.
    
    body: {
        character_id: int,
    }
    Returns target info for client to switch map/floor.
    """
    p = await db.get(MapPortal, portal_id)
    if not p:
        raise HTTPException(404, "Portal not found")
    
    char = await db.get(Character, body.get("character_id"))
    if not char:
        raise HTTPException(404, "Character not found")
    
    # Move character to target position
    # Convert tile coordinates to normalized (0..1)
    target_floor = None
    if p.target_floor_id:
        target_floor = await db.get(MapFloor, p.target_floor_id)
    
    if target_floor:
        cols = getattr(target_floor, "map_cols", 40) or 40
        rows = getattr(target_floor, "map_rows", 30) or 30
        char.map_x = p.target_col / max(cols, 1)
        char.map_y = p.target_row / max(rows, 1)
    else:
        # Fallback: keep current position
        pass
    
    await db.commit()
    await db.refresh(char)
    
    # Broadcast token move
    sess = await db.get(Session, p.session_id)
    if sess:
        await _broadcast(sess.code, "map.token_moved", {
            "character_id": char.id,
            "x": char.map_x,
            "y": char.map_y,
        })
    
    return {
        "ok": True,
        "target_map_id": p.target_map_id,
        "target_floor_id": p.target_floor_id,
        "target_floor_name": target_floor.name if target_floor else None,
        "target_col": p.target_col,
        "target_row": p.target_row,
    }
