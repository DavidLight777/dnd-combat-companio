"""Library CRUD: snapshot save/load for Maps."""

import json

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import (
    BV2Edge,
    BV2Entity,
    BV2Library,
    BV2Light,
    BV2Location,
    BV2Map,
    BV2Tile,
    Session,
)
from app.routers.builder_v2.common import broadcast, router

# ─────────────────────────────────────────────────────────────
# Snapshot helpers
# ─────────────────────────────────────────────────────────────

async def _snapshot_map(db: AsyncSession, map_id: int) -> dict:
    """Capture every location + tile + entity + light + edge in a Map."""
    locs_r = await db.execute(
        select(BV2Location).where(BV2Location.map_id == map_id).order_by(BV2Location.sort_order)
    )
    locations = []
    for loc in locs_r.scalars().all():
        loc_data = {
            "name": loc.name,
            "description": loc.description or "",
            "sort_order": loc.sort_order,
            "grid_type": loc.grid_type,
            "tile_size": loc.tile_size,
            "cols": loc.cols,
            "rows": loc.rows,
            "background_color": loc.background_color,
            "background_image_url": loc.background_image_url,
            "ambient_light": float(loc.ambient_light) if loc.ambient_light is not None else 1.0,
            "is_indoor": bool(loc.is_indoor),
        }

        tiles_r = await db.execute(select(BV2Tile).where(BV2Tile.location_id == loc.id))
        loc_data["tiles"] = [
            {"col": t.col, "row": t.row, "tile_type": t.tile_type,
             "blocks_movement": bool(t.blocks_movement), "blocks_vision": bool(t.blocks_vision)}
            for t in tiles_r.scalars().all()
        ]

        ents_r = await db.execute(select(BV2Entity).where(BV2Entity.location_id == loc.id))
        loc_data["entities"] = [
            {"entity_type": e.entity_type, "col": e.col, "row": e.row,
             "name": e.name or "",
             "visible_to_players": bool(e.visible_to_players)}
            for e in ents_r.scalars().all()
        ]

        lights_r = await db.execute(select(BV2Light).where(BV2Light.location_id == loc.id))
        loc_data["lights"] = [
            {"col": li.col, "row": li.row,
             "radius_cells": float(li.radius_cells) if li.radius_cells is not None else 0.0,
             "color_hex": li.color_hex,
             "intensity": float(li.intensity) if li.intensity is not None else 0.0,
             "source_kind": li.source_kind}
            for li in lights_r.scalars().all()
        ]

        # Edges filled in a second pass once loc_id_to_index is known
        loc_data["edges"] = []
        locations.append(loc_data)

    # Build loc_id -> index map (same ordering as above)
    loc_id_to_index = {}
    locs_r2 = await db.execute(
        select(BV2Location)
        .where(BV2Location.map_id == map_id)
        .order_by(BV2Location.sort_order)
    )
    for idx, loc in enumerate(locs_r2.scalars().all()):
        loc_id_to_index[loc.id] = idx

    edges_r = await db.execute(
        select(BV2Edge).where(BV2Edge.location_id.in_(loc_id_to_index.keys()))
    )
    for e in edges_r.scalars().all():
        idx = loc_id_to_index[e.location_id]
        locations[idx]["edges"].append({
            "side": e.side,
            "range_start": e.range_start,
            "range_end": e.range_end,
            "target_location_index": loc_id_to_index.get(e.target_location_id),
            "target_entry_col": e.target_entry_col,
            "target_entry_row": e.target_entry_row,
        })

    return {"locations": locations}


def _safe_json(s: str | None):
    if not s:
        return {}
    try:
        return json.loads(s)
    except Exception:
        return {}


# ─────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────

@router.get("/library")
async def list_library(session_code: str | None = None, db: AsyncSession = Depends(get_session)):
    """List snapshots. If session_code is given, include that session's
    snapshots; otherwise return only global ones (session_id IS NULL)."""
    if session_code:
        s = await db.execute(select(Session).where(Session.code == session_code))
        sess = s.scalar_one_or_none()
        if sess:
            r = await db.execute(
                select(BV2Library)
                .where((BV2Library.session_id == sess.id) | (BV2Library.session_id.is_(None)))
                .order_by(BV2Library.id.desc())
            )
        else:
            r = await db.execute(select(BV2Library).where(BV2Library.session_id.is_(None)).order_by(BV2Library.id.desc()))
    else:
        r = await db.execute(select(BV2Library).where(BV2Library.session_id.is_(None)).order_by(BV2Library.id.desc()))

    return [
        {
            "id": snap.id,
            "session_id": snap.session_id,
            "name": snap.name,
            "description": snap.description or "",
            "preview_url": snap.preview_url,
            "created_at": snap.created_at.isoformat() if snap.created_at else None,
        }
        for snap in r.scalars().all()
    ]


@router.post("/library/save-from-map")
async def save_from_map(body: dict, db: AsyncSession = Depends(get_session)):
    map_id = int(body.get("map_id", 0))
    m = await db.get(BV2Map, map_id)
    if not m:
        raise HTTPException(404, "Map not found")

    snapshot = await _snapshot_map(db, map_id)
    snap = BV2Library(
        session_id=m.session_id,
        name=str(body.get("name") or m.name)[:120],
        description=str(body.get("description") or "")[:500],
        snapshot_json=json.dumps(snapshot),
        preview_url=body.get("preview_url"),
    )
    db.add(snap)
    await db.commit()
    await db.refresh(snap)
    return {
        "id": snap.id,
        "name": snap.name,
        "description": snap.description,
        "created_at": snap.created_at.isoformat() if snap.created_at else None,
    }


@router.post("/library/{snapshot_id}/load-as-map")
async def load_as_map(snapshot_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    snap = await db.get(BV2Library, snapshot_id)
    if not snap:
        raise HTTPException(404, "Snapshot not found")

    session_code = str(body.get("session_code") or "")
    s = await db.execute(select(Session).where(Session.code == session_code))
    sess = s.scalar_one_or_none()
    if not sess:
        raise HTTPException(404, "Session not found")

    try:
        data = json.loads(snap.snapshot_json)
    except Exception:
        raise HTTPException(400, "Corrupted snapshot JSON")

    # Create new Map
    new_map = BV2Map(
        session_id=sess.id,
        name=str(body.get("name") or snap.name)[:120],
        description=snap.description[:500],
        is_active=False,
    )
    db.add(new_map)
    await db.commit()
    await db.refresh(new_map)

    loc_index_to_id: dict[int, int] = {}
    locations = data.get("locations", [])
    for idx, loc_data in enumerate(locations):
        loc = BV2Location(
            map_id=new_map.id,
            name=loc_data.get("name", f"Location {idx + 1}")[:120],
            description=str(loc_data.get("description") or "")[:500],
            sort_order=loc_data.get("sort_order", idx),
            grid_type=loc_data.get("grid_type", "square"),
            tile_size=max(10, min(200, int(loc_data.get("tile_size", 50)))),
            cols=max(5, min(500, int(loc_data.get("cols", 40)))),
            rows=max(5, min(500, int(loc_data.get("rows", 30)))),
            background_color=str(loc_data.get("background_color") or "#1a1a1a")[:10],
            background_image_url=loc_data.get("background_image_url"),
            ambient_light=max(0.0, min(1.0, float(loc_data.get("ambient_light", 1.0)))),
            is_indoor=bool(loc_data.get("is_indoor", False)),
            is_active=False,
        )
        db.add(loc)
        await db.commit()
        await db.refresh(loc)
        loc_index_to_id[idx] = loc.id

        # Tiles
        for t in loc_data.get("tiles", []):
            db.add(BV2Tile(
                location_id=loc.id,
                col=int(t["col"]), row=int(t["row"]), tile_type=str(t.get("tile_type", "floor"))[:32],
                blocks_movement=bool(t.get("blocks_movement", False)),
                blocks_vision=bool(t.get("blocks_vision", False)),
                extra_json="{}",
            ))

        # Entities
        for e in loc_data.get("entities", []):
            db.add(BV2Entity(
                location_id=loc.id,
                entity_type=str(e["entity_type"]).lower()[:32],
                col=int(e.get("col", 0)), row=int(e.get("row", 0)),
                name=str(e.get("name") or "")[:120],
                visible_to_players=bool(e.get("visible_to_players", True)),
            ))

        # Lights
        for li in loc_data.get("lights", []):
            db.add(BV2Light(
                location_id=loc.id,
                col=int(li.get("col", 0)), row=int(li.get("row", 0)),
                radius_cells=max(0.5, float(li.get("radius_cells", 6.0))),
                color_hex=str(li.get("color_hex", "#ffd9a0"))[:9],
                intensity=max(0.0, float(li.get("intensity", 1.0))),
                source_kind=str(li.get("source_kind", "torch"))[:20],
            ))

        await db.commit()

    # Edges (second pass so target_location_index can resolve)
    for idx, loc_data in enumerate(locations):
        loc_id = loc_index_to_id[idx]
        for e in loc_data.get("edges", []):
            target_idx = e.get("target_location_index")
            target_loc_id = loc_index_to_id.get(target_idx) if target_idx is not None else None
            db.add(BV2Edge(
                location_id=loc_id,
                side=str(e["side"]).lower()[:8],
                range_start=int(e.get("range_start", 0)),
                range_end=int(e.get("range_end", 0)),
                target_location_id=target_loc_id,
                target_entry_col=int(e.get("target_entry_col", 0)),
                target_entry_row=int(e.get("target_entry_row", 0)),
            ))

    await db.commit()
    await broadcast(session_code, "bv2.map_added", {
        "id": new_map.id,
        "session_id": sess.id,
        "name": new_map.name,
        "is_active": False,
    })
    return {"ok": True, "map_id": new_map.id}


@router.delete("/library/{snapshot_id}")
async def delete_snapshot(snapshot_id: int, db: AsyncSession = Depends(get_session)):
    snap = await db.get(BV2Library, snapshot_id)
    if not snap:
        raise HTTPException(404, "Snapshot not found")
    await db.delete(snap)
    await db.commit()
    return {"ok": True}
