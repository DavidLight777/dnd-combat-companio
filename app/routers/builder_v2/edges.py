"""Edge transition CRUD: links between locations via side segments."""

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    BV2Edge,
    BV2Location,
    Character,
    Session,
)
from app.routers.builder_v2.common import (
    broadcast,
    router,
    session_code_for_location,
)
from app.routers.builder_v2.traps import check_trap_trigger

VALID_SIDES = {"north", "south", "east", "west"}


def _edge_payload(e: BV2Edge) -> dict:
    return {
        "id": e.id,
        "location_id": e.location_id,
        "side": e.side,
        "range_start": e.range_start,
        "range_end": e.range_end,
        "target_location_id": e.target_location_id,
        "target_entry_col": e.target_entry_col,
        "target_entry_row": e.target_entry_row,
    }


@router.get("/locations/{location_id}/edges")
async def list_edges(location_id: int, db: AsyncSession = Depends(get_session)):
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")
    r = await db.execute(
        select(BV2Edge).where(BV2Edge.location_id == location_id).order_by(BV2Edge.id)
    )
    return [_edge_payload(e) for e in r.scalars().all()]


@router.post("/locations/{location_id}/edges")
async def create_edge(location_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")

    side = str(body.get("side") or "").lower()
    if side not in VALID_SIDES:
        raise HTTPException(400, f"Invalid side: {side}")

    # Clamp range to location bounds on that side (inclusive, 0-based)
    max_range = (loc.cols if side in ("north", "south") else loc.rows) - 1
    range_start = max(0, min(max_range, int(body.get("range_start", 0))))
    range_end = max(range_start, min(max_range, int(body.get("range_end", max_range))))

    target_location_id = body.get("target_location_id")
    if target_location_id is not None:
        target_location_id = int(target_location_id)
        target = await db.get(BV2Location, target_location_id)
        if not target:
            raise HTTPException(404, "Target location not found")

    e = BV2Edge(
        location_id=location_id,
        side=side,
        range_start=range_start,
        range_end=range_end,
        target_location_id=target_location_id,
        target_entry_col=max(0, int(body.get("target_entry_col", 0))),
        target_entry_row=max(0, int(body.get("target_entry_row", 0))),
    )
    db.add(e)
    await db.commit()
    await db.refresh(e)

    sess_code = await session_code_for_location(location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.edge_added", {
            "location_id": location_id,
            "edge": _edge_payload(e),
        })
    return _edge_payload(e)


@router.patch("/edges/{edge_id}")
async def update_edge(edge_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    e = await db.get(BV2Edge, edge_id)
    if not e:
        raise HTTPException(404, "Edge not found")

    loc = await db.get(BV2Location, e.location_id)

    if "side" in body:
        side = str(body["side"]).lower()
        if side not in VALID_SIDES:
            raise HTTPException(400, f"Invalid side: {side}")
        e.side = side

    if "range_start" in body:
        e.range_start = max(0, int(body["range_start"]))
    if "range_end" in body:
        e.range_end = max(0, int(body["range_end"]))
    if loc:
        max_range = (loc.cols if e.side in ("north", "south") else loc.rows) - 1
        e.range_start = min(e.range_start, max_range)
        e.range_end = max(e.range_start, min(e.range_end, max_range))

    if "target_location_id" in body:
        tid = body["target_location_id"]
        if tid is None:
            e.target_location_id = None
        else:
            tid = int(tid)
            target = await db.get(BV2Location, tid)
            if not target:
                raise HTTPException(404, "Target location not found")
            e.target_location_id = tid

    if "target_entry_col" in body:
        e.target_entry_col = max(0, int(body["target_entry_col"]))
    if "target_entry_row" in body:
        e.target_entry_row = max(0, int(body["target_entry_row"]))

    await db.commit()
    await db.refresh(e)

    sess_code = await session_code_for_location(e.location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.edge_updated", {
            "location_id": e.location_id,
            "edge": _edge_payload(e),
        })
    return _edge_payload(e)


@router.delete("/edges/{edge_id}")
async def delete_edge(edge_id: int, db: AsyncSession = Depends(get_session)):
    e = await db.get(BV2Edge, edge_id)
    if not e:
        raise HTTPException(404, "Edge not found")

    location_id = e.location_id
    await db.delete(e)
    await db.commit()

    sess_code = await session_code_for_location(location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.edge_deleted", {
            "location_id": location_id,
            "edge_id": edge_id,
        })
    return {"ok": True}


# ── Grid movement with edge transitions ─────────────────────

async def _find_matching_edge(db: AsyncSession, location_id: int, col: int, row: int):
    """Return the edge whose side and range match the given cell."""
    loc = await db.get(BV2Location, location_id)
    if not loc:
        return None

    side = None
    if col == 0:
        side = "west"
    elif col == loc.cols - 1:
        side = "east"
    elif row == 0:
        side = "north"
    elif row == loc.rows - 1:
        side = "south"

    if not side:
        return None

    # For north/south the range is along cols; for east/west along rows
    coord = col if side in ("north", "south") else row

    r = await db.execute(
        select(BV2Edge)
        .where(BV2Edge.location_id == location_id)
        .where(BV2Edge.side == side)
        .where(BV2Edge.range_start <= coord)
        .where(BV2Edge.range_end >= coord)
    )
    return r.scalar_one_or_none()


@router.post("/characters/{character_id}/move-grid")
async def move_character_grid(character_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    character = await db.get(Character, character_id)
    if not character:
        raise HTTPException(404, "Character not found")

    new_col = int(body.get("col", character.col))
    new_row = int(body.get("row", character.row))

    # Optional: set location explicitly (e.g., first placement)
    is_placement = "location_id" in body
    if is_placement:
        character.current_location_id = int(body["location_id"])

    old_loc_id = character.current_location_id
    character.col = new_col
    character.row = new_row

    # Check for edge transition (skip on placement calls)
    if old_loc_id and not is_placement:
        edge = await _find_matching_edge(db, old_loc_id, new_col, new_row)
        if edge and edge.target_location_id:
            # Defensive: verify target still exists (Fix 5.2 — dangling FK guard)
            target = await db.get(BV2Location, edge.target_location_id)
            if target:
                character.current_location_id = edge.target_location_id
                character.col = edge.target_entry_col
                character.row = edge.target_entry_row

    await db.commit()
    await db.refresh(character)

    # Phase 17 Round 5: check trap trigger after grid move
    if not is_placement:
        try:
            loc_id_for_trap = character.current_location_id
            if loc_id_for_trap:
                s = await db.get(Session, character.session_id)
                if s:
                    await check_trap_trigger(db, loc_id_for_trap, character, s.code)
        except Exception:
            pass

    s = await db.get(Session, character.session_id)
    if s:
        payload = {
            "character_id": character.id,
            "col": character.col,
            "row": character.row,
            "location_id": character.current_location_id,
        }
        if old_loc_id and character.current_location_id != old_loc_id:
            payload["from_location_id"] = old_loc_id
            payload["to_location_id"] = character.current_location_id
            await broadcast(s.code, "bv2.character_edge_transitioned", payload)
        else:
            await broadcast(s.code, "bv2.character_moved", payload)

    return {
        "ok": True,
        "character_id": character.id,
        "col": character.col,
        "row": character.row,
        "location_id": character.current_location_id,
    }
