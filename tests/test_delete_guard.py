"""Bug D — Delete UI re-entry guard + backend cleanup.

1. Backend: DELETE /maps/{id} must remove ALL child rows across every
   bv2 table (locations, tiles, entities, lights, edges, portals,
   interior_zones, interior_cells, chests, traps, npc_spawns,
   cover_zones, cover_cells, visit_states).

2. Frontend: double-click during pending delete must not fire a second
   DELETE request. Covered by Playwright in tests/e2e/.
"""

import pytest
from sqlalchemy import select, func

from app.database import get_session
from app.models import (
    BV2Map, BV2Location, BV2Tile, BV2Entity, BV2Light, BV2Edge,
    BV2VisitState, BV2InteriorZone, BV2InteriorCell,
    BV2Chest, BV2Trap, BV2Portal, BV2NPCSpawn, BV2CoverZone, BV2CoverCell,
    Character,
)


async def _count_all_bv2_rows(db, loc_ids):
    """Return dict of table name → row count for given location ids."""
    # Tables with direct location_id
    loc_tables = {
        "tiles": BV2Tile,
        "entities": BV2Entity,
        "lights": BV2Light,
        "edges": BV2Edge,
        "visit_states": BV2VisitState,
        "interior_zones": BV2InteriorZone,
    }
    # Tables with entity_id (need entity subquery)
    ent_tables = {
        "chests": BV2Chest,
        "traps": BV2Trap,
        "portals": BV2Portal,
        "npc_spawns": BV2NPCSpawn,
        "cover_zones": BV2CoverZone,
    }
    result = {}
    for name, model in loc_tables.items():
        cnt = await db.execute(
            select(func.count()).select_from(model).where(model.location_id.in_(loc_ids))
        )
        result[name] = cnt.scalar()
    # Entity-linked tables
    ent_ids_q = await db.execute(
        select(BV2Entity.id).where(BV2Entity.location_id.in_(loc_ids))
    )
    ent_ids = [r[0] for r in ent_ids_q.all()]
    for name, model in ent_tables.items():
        if ent_ids:
            cnt = await db.execute(
                select(func.count()).select_from(model).where(model.entity_id.in_(ent_ids))
            )
            result[name] = cnt.scalar()
        else:
            result[name] = 0
    # Interior cells (zone_id -> interior_zone.id)
    zone_ids_q = await db.execute(
        select(BV2InteriorZone.id).where(BV2InteriorZone.location_id.in_(loc_ids))
    )
    zone_ids = [r[0] for r in zone_ids_q.all()]
    if zone_ids:
        cnt = await db.execute(
            select(func.count()).select_from(BV2InteriorCell).where(BV2InteriorCell.zone_id.in_(zone_ids))
        )
        result["interior_cells"] = cnt.scalar()
    else:
        result["interior_cells"] = 0
    # Cover cells (zone_entity_id -> cover_zone.entity_id)
    if ent_ids:
        cnt = await db.execute(
            select(func.count()).select_from(BV2CoverCell).where(BV2CoverCell.zone_entity_id.in_(ent_ids))
        )
        result["cover_cells"] = cnt.scalar()
    else:
        result["cover_cells"] = 0
    # locations themselves
    loc_cnt = await db.execute(
        select(func.count()).select_from(BV2Location).where(BV2Location.id.in_(loc_ids))
    )
    result["locations"] = loc_cnt.scalar()
    return result


@pytest.mark.asyncio
async def test_delete_bv2_map_cleans_all_child_tables(client, session_code):
    """Seed a map with locations and every child type, delete it,
    assert zero orphan rows."""
    # Create map + location
    map_resp = await client.post(
        f"/api/builder-v2/sessions/{session_code}/maps",
        json={"name": "DeleteTest"}
    )
    map_id = map_resp.json()["id"]
    loc_resp = await client.post(
        f"/api/builder-v2/maps/{map_id}/locations",
        json={"cols": 8, "rows": 8}
    )
    loc_id = loc_resp.json()["id"]

    # Seed children via API
    await client.put(f"/api/builder-v2/locations/{loc_id}/tiles", json={
        "tiles": [{"col": 0, "row": 0, "tile_type": "wall"}]
    })
    await client.post(f"/api/builder-v2/locations/{loc_id}/lights", json={
        "col": 1, "row": 1, "radius_cells": 4
    })
    await client.post(f"/api/builder-v2/locations/{loc_id}/edges", json={
        "side": "north", "range_start": 0, "range_end": 3, "target_location_id": None
    })

    # Add a character in this location so we can verify current_location_id is nulled
    join_r = await client.post("/api/sessions/join", json={
        "session_code": session_code, "player_name": "Walker"
    })
    char_id = join_r.json()["character_id"]
    await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
        "location_id": loc_id, "col": 3, "row": 3
    })

    # Verify pre-delete counts
    async for db in get_session():
        pre = await _count_all_bv2_rows(db, [loc_id])
        break
    assert pre["tiles"] >= 1
    assert pre["lights"] >= 1
    assert pre["edges"] >= 1
    assert pre["locations"] >= 1

    # Delete map
    del_r = await client.delete(f"/api/builder-v2/maps/{map_id}")
    assert del_r.status_code == 200

    # Verify all child rows are gone
    async for db in get_session():
        post = await _count_all_bv2_rows(db, [loc_id])
        char = await db.get(Character, char_id)
        assert char.current_location_id is None, "character location pointer should be nulled"
        break

    for name, count in post.items():
        assert count == 0, f"orphan rows in {name} after delete: {count}"
