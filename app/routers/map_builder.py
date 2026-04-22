"""Map Builder — floors, tiles, traps, interactive objects (doors, etc.)."""

import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Session, MapFloor, MapTrap, MapObject
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
        "name": f.name,
        "sort_order": f.sort_order,
        "tile_size": f.tile_size,
        "grid_type": f.grid_type,
        "tiles_json": f.tiles_json,
        "is_active": f.is_active,
        "background_color": f.background_color,
        "map_cols": getattr(f, "map_cols", 40) or 40,
        "map_rows": getattr(f, "map_rows", 30) or 30,
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
    f = MapFloor(
        session_id=s.id,
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
    await db.execute(
        select(MapFloor)
        .where(MapFloor.session_id == f.session_id)
        .where(MapFloor.id != f.id)
    )
    # Update via explicit UPDATE to avoid fetching every row
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
    await db.commit()
    await db.refresh(f)
    sess = await db.get(Session, f.session_id)
    if sess:
        await _broadcast(sess.code, "map.floor_activated", {"floor_id": f.id, "name": f.name})
        # Push refreshed overlays so clients pick up the regenerated walls.
        await _broadcast(sess.code, "map.objects_updated", {})
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
