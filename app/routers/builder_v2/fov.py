"""FOV / Fog-of-War visit state."""

import json

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import BV2Entity, BV2Location, BV2VisitState, Character
from app.routers.builder_v2.common import (
    broadcast,
    router,
    session_code_for_location,
)

# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

def _json_list(s: str | None) -> list:
    if not s:
        return []
    try:
        data = json.loads(s)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _json_set(s: str | None) -> set:
    """Convert a JSON list of [col,row] into a set of "col,row" strings."""
    return {f"{c},{r}" for c, r in _json_list(s)}


def _set_to_list(tile_set: set) -> list:
    """Convert a set of "col,row" strings back into a JSON-serialisable list."""
    return sorted([[int(c), int(r)] for c, r in (k.split(",") for k in tile_set)])


# ─────────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────────

@router.post("/locations/{location_id}/visit")
async def post_visit(location_id: int, body: dict, db: AsyncSession = Depends(get_session)):
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")

    character_id = int(body.get("character_id", 0))
    character = await db.get(Character, character_id)
    if not character:
        raise HTTPException(404, "Character not found")

    visible_cells = body.get("visible_cells") or []
    if not isinstance(visible_cells, list):
        raise HTTPException(400, "`visible_cells` must be a list")

    # Find or create visit state
    r = await db.execute(
        select(BV2VisitState)
        .where(BV2VisitState.character_id == character_id)
        .where(BV2VisitState.location_id == location_id)
    )
    visit = r.scalar_one_or_none()
    if not visit:
        visit = BV2VisitState(character_id=character_id, location_id=location_id)
        db.add(visit)

    # Merge explored tiles
    explored = _json_set(visit.explored_tiles_json)
    for cell in visible_cells:
        if isinstance(cell, (list, tuple)) and len(cell) == 2:
            explored.add(f"{cell[0]},{cell[1]}")
    visit.explored_tiles_json = json.dumps(_set_to_list(explored))

    # Auto-discover entities in visible cells
    visible_set = explored  # all explored + newly visible
    r = await db.execute(select(BV2Entity).where(BV2Entity.location_id == location_id))
    discovered = set(_json_list(visit.discovered_entity_ids_json))
    is_gm = bool(character.is_gm_controlled)
    for ent in r.scalars().all():
        key = f"{ent.col},{ent.row}"
        if key in visible_set:
            if not ent.visible_to_players and not is_gm:
                continue
            discovered.add(ent.id)
    visit.discovered_entity_ids_json = json.dumps(sorted(discovered))

    await db.commit()
    await db.refresh(visit)

    sess_code = await session_code_for_location(location_id, db)
    if sess_code:
        await broadcast(sess_code, "bv2.visit_updated", {
            "character_id": character_id,
            "location_id": location_id,
        })

    return {
        "character_id": character_id,
        "location_id": location_id,
        "explored_tiles": _json_list(visit.explored_tiles_json),
        "discovered_entity_ids": sorted(discovered),
    }


@router.get("/locations/{location_id}/visit")
async def get_visit(location_id: int, character_id: int, db: AsyncSession = Depends(get_session)):
    loc = await db.get(BV2Location, location_id)
    if not loc:
        raise HTTPException(404, "Location not found")

    r = await db.execute(
        select(BV2VisitState)
        .where(BV2VisitState.character_id == character_id)
        .where(BV2VisitState.location_id == location_id)
    )
    visit = r.scalar_one_or_none()
    if not visit:
        return {
            "character_id": character_id,
            "location_id": location_id,
            "explored_tiles": [],
            "discovered_entity_ids": [],
        }

    return {
        "character_id": character_id,
        "location_id": location_id,
        "explored_tiles": _json_list(visit.explored_tiles_json),
        "discovered_entity_ids": _json_list(visit.discovered_entity_ids_json),
    }
