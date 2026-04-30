from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    BV2Location,
    BV2Map,
    Character,
    MapData,
    Session,
)
from app.routers.map.common import (
    _chebyshev_cells,
    _effective_speed_cells,
    _is_players_turn_or_no_combat,
    _path_is_blocked,
    _session_has_active_combat,
    router,
)
from app.websocket_manager import manager


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
        # Walls ALWAYS block players, in or out of combat.
        # Phase 11.5 E: check walls in the character's current location
        if await _path_is_blocked(
                c.session_id, c.map_x or 0.0, c.map_y or 0.0,
                new_x or 0.0, new_y or 0.0, db,
                location_id=c.current_location_id):
            raise HTTPException(403, "Path is blocked by a wall")
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
                # (Wall collision is enforced unconditionally above.)
    c.map_x = new_x
    c.map_y = new_y

    # bv2 sync: when an active bv2 map+location exists for this session,
    # mirror the drag into bv2 fields so the bridge keeps the token in
    # the dragged cell on next state load. Without this, the legacy
    # endpoint persists map_x/map_y but the bridge keeps reading the
    # stale c.col/c.row, making the token snap back to its old place.
    try:
        bv2_map = (await db.execute(
            select(BV2Map)
            .where(BV2Map.session_id == c.session_id)
            .where(BV2Map.is_active == True)  # noqa: E712
        )).scalar_one_or_none()
        if bv2_map:
            # Phase 11.5 D: sync against the character's current location, not
            # session-active. Fall back to session-active only when the character
            # has no location yet (first placement).
            bv2_loc = None
            if c.current_location_id:
                bv2_loc = await db.get(BV2Location, c.current_location_id)
                # Defensive: must belong to this session's active map
                if bv2_loc and bv2_loc.map_id != bv2_map.id:
                    bv2_loc = None
            if bv2_loc is None:
                bv2_loc = (await db.execute(
                    select(BV2Location)
                    .where(BV2Location.map_id == bv2_map.id)
                    .where(BV2Location.is_active == True)  # noqa: E712
                )).scalar_one_or_none()

            if bv2_loc and new_x is not None and new_y is not None:
                cols = max(1, bv2_loc.cols)
                rows = max(1, bv2_loc.rows)
                c.col = max(0, min(cols - 1, int(new_x * cols)))
                c.row = max(0, min(rows - 1, int(new_y * rows)))
                c.current_location_id = bv2_loc.id   # idempotent now
    except Exception:
        pass

    # Phase 11 R1: edge transition — if the dragged cell sits on a
    # location boundary AND that boundary has an edge with a target,
    # teleport to the target's entry cell.
    edge_transitioned = False
    old_loc_id = c.current_location_id
    if bv2_loc and c.col is not None and c.row is not None:
        from app.routers.builder_v2.edges import _find_matching_edge
        edge = await _find_matching_edge(db, bv2_loc.id, c.col, c.row)
        if edge and edge.target_location_id:
            target = await db.get(BV2Location, edge.target_location_id)
            if target:
                edge_transitioned = True
                c.current_location_id = edge.target_location_id
                c.col = max(0, min(target.cols - 1, edge.target_entry_col))
                c.row = max(0, min(target.rows - 1, edge.target_entry_row))
                # also update legacy pixel position so the immediate
                # state response reflects the teleport
                c.map_x = (c.col + 0.5) / max(1, target.cols)
                c.map_y = (c.row + 0.5) / max(1, target.rows)

    if caller_token and move_distance_cells > 0 and not edge_transitioned:
        c.movement_used_this_turn = (c.movement_used_this_turn or 0.0) + move_distance_cells
    await db.commit()

    # Phase 17 R5: check trap trigger after token move
    try:
        from app.routers.builder_v2.traps import check_trap_trigger
        if c.current_location_id and not edge_transitioned:
            sess = await db.get(Session, c.session_id)
            if sess:
                await check_trap_trigger(db, c.current_location_id, c, sess.code)
    except Exception:
        pass

    # Resolve session code so we can broadcast. If this character has
    # somehow been orphaned (no session), we skip the broadcast rather
    # than 500 the move itself — the persisted position is what matters.
    try:
        sess = await db.get(Session, c.session_id)
        if sess:
            if edge_transitioned:
                await manager.broadcast_to_session(
                    sess.code, "bv2.character_edge_transitioned", {
                        "character_id": c.id,
                        "from_location_id": old_loc_id,
                        "to_location_id": c.current_location_id,
                        "col": c.col, "row": c.row,
                    })
            else:
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


