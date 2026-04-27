"""Tile-level CRUD: bulk PUT (replace all) and PATCH (delta update).

Auto-save in the GM client uses PATCH with only changed cells. PUT is
for "Apply preset" / library load flows. Both routes broadcast a single
WS event so all clients pick up the change with one render.
"""

from fastapi import Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import BV2Location, BV2Tile
from app.routers.builder_v2.common import (
    broadcast,
    is_active_bv2_location,
    router,
    ser_tile,
    session_code_for_location,
    tile_blocks,
)


def _coerce_cell(raw: dict, cols: int, rows: int) -> tuple[int, int, str] | None:
    """Validate one incoming cell payload. Returns (col, row, tile_type)
    or None if the cell is out of bounds / malformed.
    """
    try:
        col = int(raw["col"])
        row = int(raw["row"])
    except (KeyError, TypeError, ValueError):
        return None
    if col < 0 or row < 0 or col >= cols or row >= rows:
        return None
    tile_type = str(raw.get("tile_type") or "floor")[:32]
    return col, row, tile_type


@router.get("/locations/{location_id}/tiles")
async def list_tiles(location_id: int, db: AsyncSession = Depends(get_session)):
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")
    r = await db.execute(select(BV2Tile).where(BV2Tile.location_id == location_id))
    return [ser_tile(t) for t in r.scalars().all()]


@router.put("/locations/{location_id}/tiles")
async def replace_tiles(location_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    """Replace ALL tiles for a location. Body: { "tiles": [{col,row,tile_type,extra?}, ...] }."""
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")

    incoming = body.get("tiles") or []
    if not isinstance(incoming, list):
        raise HTTPException(400, "`tiles` must be a list")

    # Wipe old tiles
    await db.execute(delete(BV2Tile).where(BV2Tile.location_id == location_id))

    seen: set[tuple[int, int]] = set()
    for raw in incoming:
        if not isinstance(raw, dict):
            continue
        coerced = _coerce_cell(raw, loc.cols, loc.rows)
        if not coerced:
            continue
        col, row, tile_type = coerced
        if (col, row) in seen:
            continue  # last write wins — but PUT shouldn't have dupes
        seen.add((col, row))
        blocks = tile_blocks(tile_type)
        db.add(BV2Tile(
            location_id=location_id,
            col=col, row=row, tile_type=tile_type,
            blocks_movement=blocks["blocks_movement"],
            blocks_vision=blocks["blocks_vision"],
            extra_json="{}",
        ))

    await db.commit()

    # Reload + broadcast
    r = await db.execute(select(BV2Tile).where(BV2Tile.location_id == location_id))
    tiles = [ser_tile(t) for t in r.scalars().all()]

    sess_code = await session_code_for_location(location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.tiles_replaced", {
            "location_id": location_id,
            "count": len(tiles),
        })
        if await is_active_bv2_location(location_id, db):
            await broadcast(sess_code, "map.tile_painted", {
                "tiles": {f"{t['col']},{t['row']}": t for t in tiles},
            })
    return {"ok": True, "count": len(tiles)}


@router.patch("/locations/{location_id}/tiles")
async def patch_tiles(location_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    """Delta update — apply a list of cell changes.

    Body: {
      "set":   [{col,row,tile_type,extra?}, ...],   # upsert
      "erase": [{col,row}, ...],                    # delete
    }
    """
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")

    set_list = body.get("set") or []
    erase_list = body.get("erase") or []
    if not isinstance(set_list, list) or not isinstance(erase_list, list):
        raise HTTPException(400, "`set` and `erase` must be lists")

    # Build lookup for existing rows in the affected cells (one query)
    affected_cells: set[tuple[int, int]] = set()
    for raw in set_list + erase_list:
        if not isinstance(raw, dict):
            continue
        try:
            affected_cells.add((int(raw["col"]), int(raw["row"])))
        except (KeyError, TypeError, ValueError):
            continue
    if not affected_cells:
        return {"ok": True, "set": 0, "erased": 0}

    existing: dict[tuple[int, int], BV2Tile] = {}
    if affected_cells:
        # SQLite has 999 host param limit — chunk just in case.
        cols = [c for c, _ in affected_cells]
        rows = [r for _, r in affected_cells]
        r = await db.execute(
            select(BV2Tile)
            .where(BV2Tile.location_id == location_id)
            .where(BV2Tile.col.in_(cols))
            .where(BV2Tile.row.in_(rows))
        )
        for t in r.scalars().all():
            existing[(t.col, t.row)] = t

    set_count = 0
    for raw in set_list:
        if not isinstance(raw, dict):
            continue
        coerced = _coerce_cell(raw, loc.cols, loc.rows)
        if not coerced:
            continue
        col, row, tile_type = coerced
        blocks = tile_blocks(tile_type)
        prev = existing.get((col, row))
        if prev:
            prev.tile_type = tile_type
            prev.blocks_movement = blocks["blocks_movement"]
            prev.blocks_vision = blocks["blocks_vision"]
            if "is_open" in raw:
                prev.is_open = bool(raw["is_open"])
        else:
            db.add(BV2Tile(
                location_id=location_id,
                col=col, row=row, tile_type=tile_type,
                blocks_movement=blocks["blocks_movement"],
                blocks_vision=blocks["blocks_vision"],
                is_open=bool(raw["is_open"]) if "is_open" in raw else True,
                extra_json="{}",
            ))
        set_count += 1

    erase_count = 0
    for raw in erase_list:
        if not isinstance(raw, dict):
            continue
        try:
            col = int(raw["col"])
            row = int(raw["row"])
        except (KeyError, TypeError, ValueError):
            continue
        prev = existing.get((col, row))
        if prev:
            await db.delete(prev)
            erase_count += 1

    await db.commit()

    sess_code = await session_code_for_location(location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.tiles_patched", {
            "location_id": location_id,
            "set": set_count,
            "erased": erase_count,
        })
        if await is_active_bv2_location(location_id, db):
            r = await db.execute(select(BV2Tile).where(BV2Tile.location_id == location_id))
            tiles = [ser_tile(t) for t in r.scalars().all()]
            await broadcast(sess_code, "map.tile_painted", {
                "tiles": {f"{t['col']},{t['row']}": t for t in tiles},
            })
    return {"ok": True, "set": set_count, "erased": erase_count}
