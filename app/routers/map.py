"""Map management — upload, tokens, fog of war."""

import os
import json
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from PIL import Image

from app.database import get_session, DATA_DIR
from app.models import (
    Session, Character, MapData, MapMarker, MapDrawing,
    CombatEvent, CombatParticipant, MapObject, MapFloor, MapTrap,
)
from app.websocket_manager import manager

router = APIRouter(prefix="/api/map", tags=["map"])

MAPS_DIR = os.path.join(DATA_DIR, "maps")
# Rework v3 Phase 6: token portrait storage. Files are stored under
# data/tokens/{character_id}.{ext}. One portrait per character —
# re-uploading overwrites the previous file.
TOKENS_DIR = os.path.join(DATA_DIR, "tokens")
os.makedirs(TOKENS_DIR, exist_ok=True)
MAX_DIMENSION = 4096
# Cap portrait size more aggressively: no reason to store 4K headshots.
TOKEN_MAX_DIMENSION = 512


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


def _seed_row(chars: list, y_norm: float) -> None:
    """Spread `chars` evenly along a row at y=`y_norm` (normalised 0..1)."""
    n = len(chars)
    if n == 0:
        return
    for i, c in enumerate(chars):
        c.map_x = 0.1 + (0.8 * (i + 0.5) / n)
        c.map_y = y_norm


async def _is_players_turn_or_no_combat(character: Character, db: AsyncSession) -> bool:
    """Return True if `character` may currently move.

    Rework v3 Phase 3 — a player may move their token freely while no
    combat is active; once a CombatEvent for the same session flips to
    `active`, only the character whose id matches the current
    participant's character_id is allowed to move. GM calls bypass this
    entirely (they skip the ownership branch that triggers this check).

    The function is deliberately lenient on errors: any lookup failure
    returns True so that transient DB hiccups don't freeze movement.
    """
    try:
        active_combat = (await db.execute(
            select(CombatEvent)
            .where(CombatEvent.session_id == character.session_id)
            .where(CombatEvent.status == "active")
            .limit(1)
        )).scalar_one_or_none()
        if not active_combat:
            return True  # no combat → freely move
        if not active_combat.current_participant_id:
            # Combat is marked active but no participant is current —
            # should not normally happen; be permissive rather than
            # locking the player out of their own screen.
            return True
        current_p = await db.get(CombatParticipant, active_combat.current_participant_id)
        if not current_p:
            return True
        return current_p.character_id == character.id
    except Exception:
        return True


async def _session_has_active_combat(session_id: int, db: AsyncSession) -> bool:
    """Cheap helper: True iff an active CombatEvent exists for this session."""
    try:
        active_combat = (await db.execute(
            select(CombatEvent.id)
            .where(CombatEvent.session_id == session_id)
            .where(CombatEvent.status == "active")
            .limit(1)
        )).scalar_one_or_none()
        return active_combat is not None
    except Exception:
        return False


def _chebyshev_cells(
    x0: float, y0: float, x1: float, y1: float,
    map_w: int, map_h: int, grid_size: int,
    grid_type: str = "square",
) -> float:
    """Distance between two normalised positions, in whole cells.

    Square grids use the Chebyshev (king-move) metric; hex grids use
    the pointy-top axial hex distance. Returns 0 on degenerate inputs.
    Delegates to :mod:`app.combat_range.grid_cells` so every gameplay
    surface — movement, range checks, measure tool — agrees on the
    exact metric. Name is preserved for call-site compatibility.
    """
    from app.combat_range import grid_cells
    return grid_cells(x0, y0, x1, y1, map_w, map_h, grid_size, grid_type)


async def _effective_speed_cells(character: Character, db: AsyncSession) -> int:
    """Total movement budget per turn for this character, in cells.

    Base from `Character.base_speed_cells`, plus any `speed_bonus` from
    equipped items. Status effects / drawings that tweak speed can be
    layered in later — kept to a single place so the UI (`speed_total`)
    and the enforcement path agree on the same number.
    """
    total = character.base_speed_cells or 6
    try:
        from app.models import InventoryItem, ItemBonus
        rows = (await db.execute(
            select(ItemBonus)
            .join(InventoryItem, InventoryItem.item_id == ItemBonus.item_id)
            .where(InventoryItem.character_id == character.id)
            .where(InventoryItem.is_equipped == True)  # noqa: E712
            .where(ItemBonus.bonus_type == "speed_bonus")
            .where(ItemBonus.is_conditional == False)  # noqa: E712
        )).scalars().all()
        for b in rows:
            total += int(round(b.value or 0))
    except Exception:
        pass
    return max(0, total)


async def _path_is_blocked(
    session_id: int, x0: float, y0: float, x1: float, y1: float,
    db: AsyncSession,
) -> bool:
    """Return True if the straight line (x0,y0)->(x1,y1) crosses any
    `blocks_movement=True` MapObject for this session.

    We sample the line with ~12 steps per cell-distance (enough density
    that a 1-cell move still gets at least one mid-point sample) and
    declare "blocked" on the first point-in-rect hit. Errors short-
    circuit to `False` so a busted overlay query never freezes the
    player — the budget check above is still doing useful work.
    """
    try:
        rows = (await db.execute(
            select(MapObject)
            .where(MapObject.session_id == session_id)
            .where(MapObject.blocks_movement == True)  # noqa: E712
        )).scalars().all()
        if not rows:
            return False
        # Reject the destination outright, then sample the segment.
        def _in_any_rect(nx: float, ny: float) -> bool:
            for o in rows:
                if nx >= o.x1 and nx <= o.x2 and ny >= o.y1 and ny <= o.y2:
                    return True
            return False
        if _in_any_rect(x1, y1):
            return True
        # Segment sampling — density proportional to raw normalised
        # distance, capped at 64 so a huge teleport doesn't chew CPU.
        import math
        dx, dy = x1 - x0, y1 - y0
        steps = max(4, min(64, int(math.hypot(dx, dy) * 200)))
        for i in range(1, steps):
            t = i / steps
            if _in_any_rect(x0 + dx * t, y0 + dy * t):
                return True
        return False
    except Exception:
        return False


async def reset_movement_for(character_id: int, db: AsyncSession) -> None:
    """Reset this character's per-turn movement budget to 0.

    Exported so combat_events.next_turn / start_combat / end_combat can
    call it without importing the ORM machinery themselves.
    """
    try:
        c = await db.get(Character, character_id)
        if c and (c.movement_used_this_turn or 0) != 0:
            c.movement_used_this_turn = 0.0
            # Do NOT commit here — the caller owns the transaction.
    except Exception:
        pass


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
            "speed_total": speed_total,
            "movement_used": float(c.movement_used_this_turn or 0.0),
            "movement_left": max(0.0, speed_total - float(c.movement_used_this_turn or 0.0)),
            # Phase 6: portrait image for canvas render.
            "token_image_url": c.token_image_url,
        })

    out: dict = {"has_map": False, "tokens": tokens}

    if map_data:
        out = {
            "has_map": True,
            "image_url": map_data.image_url,
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

    # Map Builder: include active floor tiles + metadata even when no image map
    try:
        active_floor = (await db.execute(
            select(MapFloor).where(MapFloor.session_id == session.id).where(MapFloor.is_active == True)
        )).scalar_one_or_none()
        if active_floor:
            out["active_floor_id"] = active_floor.id
            out["active_floor_name"] = active_floor.name
            out["active_floor_tiles"] = json.loads(active_floor.tiles_json or "{}")
            out["active_floor_grid_type"] = active_floor.grid_type or "square"
            out["active_floor_tile_size"] = active_floor.tile_size or 50
    except Exception:
        pass
    return out


# ── Move token ───────────────────────────────────────────────
# Rework v3 Phase 1: we now broadcast a WS event after every successful
# move so that every client (GM + all players) can keep their grids in
# sync in real time. Previously the patch was fire-and-forget, which
# worked when only the GM had the map open, but players now see the
# grid permanently in Main and need live updates.
# Rework v3 Phase 2: optional ownership gate. Player-originated calls
# include the caller's `player_token`; if present, it MUST match the
# token stored on this character. GM calls omit the field and keep
# their god-mode access. Phase 3 will turn this into a hard requirement
# for player-originated moves together with combat-turn gating.
@router.patch("/token/{character_id}")
async def move_token(character_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, character_id)
    if not c:
        raise HTTPException(404)
    caller_token = (body or {}).get("player_token")
    new_x = body.get("x", c.map_x)
    new_y = body.get("y", c.map_y)
    move_distance_cells = 0.0

    if caller_token:
        # Phase 2: ownership check.
        if c.player_token != caller_token:
            raise HTTPException(403, "Not your token to move")
        # Phase 3: combat-turn gating.
        if not await _is_players_turn_or_no_combat(c, db):
            raise HTTPException(403, "Not your turn in combat")
        # Phase 4: speed budget — only while combat is active. Outside
        # combat we let the player roam freely. The check runs BEFORE
        # persisting the new position so a rejected move has zero side
        # effects on the row.
        if await _session_has_active_combat(c.session_id, db):
            # We need map dimensions and grid size to convert normalised
            # deltas into cells. Without map data we can't enforce —
            # fall through silently in that (unlikely) case.
            md = (await db.execute(
                select(MapData).where(MapData.session_id == c.session_id)
            )).scalar_one_or_none()
            if md and md.image_width and md.image_height and md.grid_size:
                move_distance_cells = _chebyshev_cells(
                    c.map_x or 0.0, c.map_y or 0.0, new_x or 0.0, new_y or 0.0,
                    md.image_width, md.image_height, md.grid_size,
                    getattr(md, "grid_type", "square") or "square",
                )
                # Round to whole cells — snap-to-grid on the client
                # guarantees integer deltas, but float noise around 1e-6
                # could tip a legal move into "exceeded".
                move_distance_cells = round(move_distance_cells, 3)
                budget = await _effective_speed_cells(c, db)
                used = c.movement_used_this_turn or 0.0
                if used + move_distance_cells > budget + 1e-6:
                    remaining = max(0.0, budget - used)
                    raise HTTPException(
                        403,
                        f"Out of movement: {remaining:.0f}/{budget} cells left this turn",
                    )
                # Phase 5: wall collision. Walk the straight line from
                # (x0,y0) to (x1,y1) in one-cell steps; if any step
                # lands inside a blocking MapObject rectangle, reject.
                # We also check the destination explicitly — cheap and
                # covers the degenerate case where the step count rounds
                # down to zero.
                if await _path_is_blocked(c.session_id, c.map_x or 0.0, c.map_y or 0.0,
                                          new_x or 0.0, new_y or 0.0, db):
                    raise HTTPException(403, "Path is blocked by a wall")
    c.map_x = new_x
    c.map_y = new_y
    if caller_token and move_distance_cells > 0:
        c.movement_used_this_turn = (c.movement_used_this_turn or 0.0) + move_distance_cells
    await db.commit()

    # Resolve session code so we can broadcast. If this character has
    # somehow been orphaned (no session), we skip the broadcast rather
    # than 500 the move itself — the persisted position is what matters.
    try:
        sess = await db.get(Session, c.session_id)
        if sess:
            speed_total = await _effective_speed_cells(c, db)
            await manager.broadcast_to_session(sess.code, "map.token_moved", {
                "character_id": c.id,
                "x": c.map_x,
                "y": c.map_y,
                "visible": c.is_visible_on_map,
                # Phase 4: ship updated movement info with every move so
                # the client HUD stays accurate without a follow-up GET.
                "speed_total": speed_total,
                "movement_used": float(c.movement_used_this_turn or 0.0),
                "movement_left": max(0.0, speed_total - float(c.movement_used_this_turn or 0.0)),
            })
    except Exception:
        pass

    return {
        "ok": True,
        "x": c.map_x,
        "y": c.map_y,
        "movement_used": float(c.movement_used_this_turn or 0.0),
        "move_distance_cells": move_distance_cells,
    }


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


# ══════════════════════════════════════════════════════════════
# Rework v3 Phase 5 — MAP OBJECTS CRUD (walls / zones)
# ══════════════════════════════════════════════════════════════
def _ser_object(o: MapObject) -> dict:
    return {
        "id": o.id,
        "name": o.name,
        "kind": o.kind,
        "x1": o.x1, "y1": o.y1, "x2": o.x2, "y2": o.y2,
        "color": o.color,
        "blocks_movement": o.blocks_movement,
        "blocks_vision": o.blocks_vision,
        "visible_to_players": o.visible_to_players,
    }


async def _broadcast_objects_changed(session_code: str, reason: str) -> None:
    try:
        await manager.broadcast_to_session(session_code, "map.objects_updated", {"reason": reason})
    except Exception:
        pass


@router.get("/{session_code}/objects")
async def list_map_objects(session_code: str, db: AsyncSession = Depends(get_session)):
    session = (await db.execute(select(Session).where(Session.code == session_code))).scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    rows = (await db.execute(select(MapObject).where(MapObject.session_id == session.id))).scalars().all()
    return [_ser_object(o) for o in rows]


@router.post("/{session_code}/objects")
async def create_map_object(session_code: str, body: dict, db: AsyncSession = Depends(get_session)):
    session = (await db.execute(select(Session).where(Session.code == session_code))).scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    # Normalise & clamp so degenerate rects and out-of-range coords
    # never reach the DB.
    x1 = max(0.0, min(1.0, float(body.get("x1", 0.0))))
    y1 = max(0.0, min(1.0, float(body.get("y1", 0.0))))
    x2 = max(0.0, min(1.0, float(body.get("x2", 0.0))))
    y2 = max(0.0, min(1.0, float(body.get("y2", 0.0))))
    if x2 < x1: x1, x2 = x2, x1
    if y2 < y1: y1, y2 = y2, y1
    o = MapObject(
        session_id=session.id,
        name=(body.get("name") or "Wall")[:60],
        kind=(body.get("kind") or "wall")[:20],
        x1=x1, y1=y1, x2=x2, y2=y2,
        color=(body.get("color") or "#8a4abf")[:10],
        blocks_movement=bool(body.get("blocks_movement", True)),
        blocks_vision=bool(body.get("blocks_vision", False)),
        visible_to_players=bool(body.get("visible_to_players", True)),
    )
    db.add(o)
    await db.commit()
    await db.refresh(o)
    await _broadcast_objects_changed(session_code, "created")
    return _ser_object(o)


@router.patch("/object/{object_id}")
async def update_map_object(object_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    o = await db.get(MapObject, object_id)
    if not o:
        raise HTTPException(404, "Object not found")
    for f in ("name", "kind", "color"):
        if f in body and body[f] is not None:
            setattr(o, f, str(body[f]))
    for f in ("x1", "y1", "x2", "y2"):
        if f in body and body[f] is not None:
            setattr(o, f, max(0.0, min(1.0, float(body[f]))))
    if o.x2 < o.x1: o.x1, o.x2 = o.x2, o.x1
    if o.y2 < o.y1: o.y1, o.y2 = o.y2, o.y1
    for f in ("blocks_movement", "blocks_vision", "visible_to_players"):
        if f in body and body[f] is not None:
            setattr(o, f, bool(body[f]))
    await db.commit()
    # Resolve session code for the broadcast.
    sess = await db.get(Session, o.session_id)
    if sess:
        await _broadcast_objects_changed(sess.code, "updated")
    return _ser_object(o)


@router.delete("/object/{object_id}")
async def delete_map_object(object_id: int, db: AsyncSession = Depends(get_session)):
    o = await db.get(MapObject, object_id)
    if not o:
        raise HTTPException(404, "Object not found")
    sess_code = None
    try:
        sess = await db.get(Session, o.session_id)
        if sess:
            sess_code = sess.code
    except Exception:
        pass
    await db.delete(o)
    await db.commit()
    if sess_code:
        await _broadcast_objects_changed(sess_code, "deleted")
    return {"ok": True}


# ══════════════════════════════════════════════════════════════
# Rework v3 Phase 6 — TOKEN PORTRAITS
# ══════════════════════════════════════════════════════════════
@router.get("/token-image/{filename}")
async def get_token_image(filename: str):
    """Serve a saved portrait file. No auth — the filename contains the
    character id, which isn't sensitive, and the token image is already
    visible on every player screen."""
    # Block any attempt at path traversal.
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "Invalid filename")
    path = os.path.join(TOKENS_DIR, filename)
    if not os.path.exists(path):
        raise HTTPException(404, "Token image not found")
    return FileResponse(path)


@router.post("/token-image/{character_id}")
async def upload_token_image(
    character_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_session),
):
    """Upload a portrait for this character. The player_token header
    would be ideal, but we keep the trust model simple for now — the GM
    is expected to police this. We downscale to `TOKEN_MAX_DIMENSION`
    and re-encode as PNG so the stored file is predictable + small.
    Broadcasts `map.updated` so every connected client refreshes the
    map (which re-fetches the token row with its new image)."""
    c = await db.get(Character, character_id)
    if not c:
        raise HTTPException(404, "Character not found")
    # Read the upload into memory; PIL handles format sniffing.
    try:
        img = Image.open(file.file)
        img.load()
    except Exception:
        raise HTTPException(400, "Not a valid image")
    img = img.convert("RGBA")
    img.thumbnail((TOKEN_MAX_DIMENSION, TOKEN_MAX_DIMENSION))
    filename = f"token_{character_id}.png"
    path = os.path.join(TOKENS_DIR, filename)
    img.save(path, format="PNG")
    c.token_image_url = f"/api/map/token-image/{filename}"
    await db.commit()
    # Notify everybody so the new image shows up without a hard reload.
    try:
        sess = await db.get(Session, c.session_id)
        if sess:
            await manager.broadcast_to_session(sess.code, "map.updated", {"reason": "token_image"})
    except Exception:
        pass
    return {"ok": True, "token_image_url": c.token_image_url}


@router.delete("/token-image/{character_id}")
async def delete_token_image(character_id: int, db: AsyncSession = Depends(get_session)):
    c = await db.get(Character, character_id)
    if not c:
        raise HTTPException(404, "Character not found")
    # Delete the file if it still matches the recorded URL.
    try:
        if c.token_image_url:
            # Extract filename tail and only allow files inside TOKENS_DIR.
            tail = c.token_image_url.rsplit("/", 1)[-1]
            path = os.path.join(TOKENS_DIR, tail)
            if os.path.isfile(path) and path.startswith(TOKENS_DIR):
                os.remove(path)
    except Exception:
        pass
    c.token_image_url = None
    await db.commit()
    try:
        sess = await db.get(Session, c.session_id)
        if sess:
            await manager.broadcast_to_session(sess.code, "map.updated", {"reason": "token_image_cleared"})
    except Exception:
        pass
    return {"ok": True}


@router.delete("/{session_code}/objects/all")
async def clear_all_objects(session_code: str, db: AsyncSession = Depends(get_session)):
    session = (await db.execute(select(Session).where(Session.code == session_code))).scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    rows = (await db.execute(select(MapObject).where(MapObject.session_id == session.id))).scalars().all()
    for o in rows:
        await db.delete(o)
    await db.commit()
    await _broadcast_objects_changed(session_code, "cleared")
    return {"ok": True, "deleted": len(rows)}
