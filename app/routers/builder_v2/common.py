"""Map Builder v2 — shared helpers, router, serializers."""

import json

from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    BV2Entity,
    BV2Light,
    BV2Location,
    BV2Map,
    BV2Tile,
    Session,
)
from app.websocket_manager import manager

router = APIRouter(prefix="/api/builder-v2", tags=["builder-v2"])


# ─────────────────────────────────────────────────────────────
# Tile-type registry — single source of truth for movement /
# vision blocking. Keep in sync with `static/js/builder_v2/`.
# ─────────────────────────────────────────────────────────────
TILE_DEFAULTS: dict[str, dict] = {
    "floor": {"blocks_movement": False, "blocks_vision": False},
    "wall":  {"blocks_movement": True,  "blocks_vision": True},
    "water": {"blocks_movement": False, "blocks_vision": False},  # difficult terrain
    "lava":  {"blocks_movement": False, "blocks_vision": False},  # damaging terrain
    "pit":   {"blocks_movement": True,  "blocks_vision": False},
    "door":  {"blocks_movement": False, "blocks_vision": False},  # default open
    "rough": {"blocks_movement": False, "blocks_vision": False},
    "zone":  {"blocks_movement": False, "blocks_vision": False},  # interior marker
}

VALID_ENTITY_TYPES: set[str] = {
    "chest",
    "trap",
    "portal",
    "npc_spawn",
    "cover_zone",
    "light_marker",
    "stairs_down",
    "furniture",
}


def tile_blocks(tile_type: str) -> dict:
    """Default blocks_movement / blocks_vision for a given tile type."""
    return TILE_DEFAULTS.get(tile_type, {"blocks_movement": False, "blocks_vision": False})


# ─────────────────────────────────────────────────────────────
# Session lookup
# ─────────────────────────────────────────────────────────────
async def get_session_or_404(session_code: str, db: AsyncSession) -> Session:
    r = await db.execute(select(Session).where(Session.code == session_code))
    s = r.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Session not found")
    return s


# ─────────────────────────────────────────────────────────────
# Broadcast helper — never let a WS error break a DB commit
# ─────────────────────────────────────────────────────────────
async def broadcast(session_code: str, event: str, payload: dict) -> None:
    try:
        await manager.broadcast_to_session(session_code, event, payload)
    except Exception:
        pass


# ─────────────────────────────────────────────────────────────
# Serialisers
# ─────────────────────────────────────────────────────────────
def ser_map(m: BV2Map) -> dict:
    return {
        "id": m.id,
        "session_id": m.session_id,
        "name": m.name,
        "description": m.description or "",
        "is_active": bool(m.is_active),
        "cover_image_url": m.cover_image_url,
    }


def ser_location(loc: BV2Location) -> dict:
    return {
        "id": loc.id,
        "map_id": loc.map_id,
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
        "is_active": bool(loc.is_active),
    }


def ser_tile(t: BV2Tile) -> dict:
    return {
        "id": t.id,
        "col": t.col,
        "row": t.row,
        "tile_type": t.tile_type,
        "blocks_movement": bool(t.blocks_movement),
        "blocks_vision": bool(t.blocks_vision),
        "is_open": bool(t.is_open),
        "extra": _safe_json(t.extra_json),
    }


def ser_entity(e: BV2Entity) -> dict:
    return {
        "id": e.id,
        "location_id": e.location_id,
        "entity_type": e.entity_type,
        "col": e.col,
        "row": e.row,
        "name": e.name or "",
        "visible_to_players": bool(e.visible_to_players),
        "discovered_by": _safe_json(e.discovered_by_json) or [],
    }


def ser_light(li: BV2Light) -> dict:
    radius = float(li.radius_cells) if li.radius_cells is not None else 0.0
    bright = float(li.bright_radius_cells) if li.bright_radius_cells is not None else 0.0
    if bright <= 0:
        bright = radius * 0.5
    return {
        "id": li.id,
        "location_id": li.location_id,
        "character_id": li.character_id,
        "col": li.col,
        "row": li.row,
        "radius_cells": radius,
        "bright_radius_cells": bright,
        "color_hex": li.color_hex,
        "intensity": float(li.intensity) if li.intensity is not None else 0.0,
        "source_kind": li.source_kind,
    }


def _safe_json(s: str | None):
    if not s:
        return {}
    try:
        return json.loads(s)
    except Exception:
        return {}


# ─────────────────────────────────────────────────────────────
# Ownership lookups — `db.get` doesn't tell you the session
# code for broadcasting, so each helper resolves it.
# ─────────────────────────────────────────────────────────────
async def session_code_for_map(map_id: int, db: AsyncSession) -> str | None:
    m = await db.get(BV2Map, map_id)
    if not m:
        return None
    s = await db.get(Session, m.session_id)
    return s.code if s else None


async def session_code_for_location(location_id: int, db: AsyncSession) -> str | None:
    loc = await db.get(BV2Location, location_id)
    if not loc:
        return None
    return await session_code_for_map(loc.map_id, db)


async def is_active_bv2_location(location_id: int, db: AsyncSession) -> bool:
    """True if this location is the active one in the session's active bv2 map."""
    loc = await db.get(BV2Location, location_id)
    if not loc:
        return False
    m = await db.get(BV2Map, loc.map_id)
    if not m or not m.is_active:
        return False
    return loc.is_active
