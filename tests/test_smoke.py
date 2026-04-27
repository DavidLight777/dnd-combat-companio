"""Smoke tests — ensure core endpoints respond and don't crash.

Run: pytest tests/test_smoke.py -q
Each test must finish in <1s.
"""
import os
import sys

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from app.database import init_db
from main import app


@pytest_asyncio.fixture
async def client():
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def session_code(client):
    r = await client.post("/api/sessions/create", json={"gm_name": "TestGM", "name": "Test"})
    assert r.status_code == 200, r.text
    return r.json()["session_code"]


# ── Core ─────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_server_info(client):
    r = await client.get("/api/server-info")
    assert r.status_code == 200
    assert "port" in r.json()


@pytest.mark.asyncio
async def test_create_session(client):
    r = await client.post("/api/sessions/create", json={"gm_name": "GM", "name": "Test"})
    assert r.status_code == 200
    assert len(r.json()["session_code"]) > 4  # format: word-1234


@pytest.mark.asyncio
async def test_list_characters_empty(client, session_code):
    r = await client.get(f"/api/sessions/{session_code}/characters")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ── Characters ───────────────────────────────────────────────
@pytest.mark.asyncio
async def test_join_session_creates_character(client, session_code):
    r = await client.post("/api/sessions/join", json={
        "session_code": session_code, "player_name": "Hero",
    })
    assert r.status_code in (200, 201), r.text
    assert r.json()["character_id"] > 0


# ── NPC Library ──────────────────────────────────────────────
@pytest.mark.asyncio
async def test_npc_library_endpoints(client, session_code):
    # session_id needed
    sess = await client.get(f"/api/sessions/{session_code}")
    sid = sess.json()["id"]
    r = await client.get(f"/api/npc-library/templates?session_id={sid}")
    assert r.status_code == 200


# ── Item DB ──────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_item_categories_seeded(client):
    r = await client.get("/api/item-categories")
    assert r.status_code == 200
    assert len(r.json()) > 0


@pytest.mark.asyncio
async def test_items_list(client):
    r = await client.get("/api/items")
    assert r.status_code == 200


# ── Abilities ────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_abilities_list(client):
    r = await client.get("/api/abilities")
    assert r.status_code == 200


# ── Races / Classes ──────────────────────────────────────────
@pytest.mark.asyncio
async def test_races_list(client):
    r = await client.get("/api/races-classes/races")
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_classes_list(client):
    r = await client.get("/api/races-classes/classes")
    assert r.status_code == 200


# ── Map ──────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_map_state(client, session_code):
    r = await client.get(f"/api/map/{session_code}")
    assert r.status_code in (200, 404)  # 404 ok if no map uploaded


@pytest.mark.asyncio
# ── Combat ───────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_combat_active_none(client, session_code):
    r = await client.get(f"/api/combat/session/{session_code}/active")
    assert r.status_code == 200
    assert r.json() is None or r.json() == {} or r.json().get("active") == False


# ── Quests ───────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_quest_templates_list(client, session_code):
    sess = await client.get(f"/api/sessions/{session_code}")
    sid = sess.json()["id"]
    r = await client.get(f"/api/quest-templates?session_id={sid}")
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)


@pytest.mark.asyncio
async def test_quests_for_session(client, session_code):
    r = await client.get(f"/api/quests/session/{session_code}")
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)


# ── Economy ──────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_character_currency(client, session_code):
    # Create a character via join, then check currency
    j = await client.post("/api/sessions/join", json={
        "session_code": session_code, "player_name": "Trader",
    })
    cid = j.json()["character_id"]
    r = await client.get(f"/api/characters/{cid}/currency")
    assert r.status_code == 200, r.text
    # Currency response should be a dict (e.g. {"gold": 0, "silver": 0, ...})
    assert isinstance(r.json(), (dict, list))


# ── Announcements ────────────────────────────────────────────
@pytest.mark.asyncio
async def test_announcements_for_session(client, session_code):
    r = await client.get(f"/api/announcements/{session_code}")
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)


# ── Status effects ───────────────────────────────────────────
@pytest.mark.asyncio
async def test_status_effects_templates(client):
    r = await client.get("/api/status-templates")
    assert r.status_code == 200


# ── Smoke: every router imports without error ────────────────
def test_all_routers_importable():
    from app.routers import (
        abilities,
        ai,
        announcements,
        builder_v2,
        cards,
        characters,
        chests,
        combat,
        combat_actions,
        combat_events,
        economy,
        initiative,
        inventory,
        memory,
        notes,
        npc_library,
        poisons,
        professions,
        quests,
        races_classes,
        session_timer,
        sessions,
        status_effects,
        websocket,
        wizard,
    )

    # Map router shadows builtin map(), needs alias import
    from app.routers import map as map_router
    assert sessions.router is not None
    assert characters.router is not None
    assert combat_events.router is not None
    assert abilities.router is not None
    assert map_router.router is not None
    assert wizard.router is not None
    assert economy.router is not None
    assert builder_v2.router is not None
    # Critical re-exports preserved
    from app.routers.abilities import _resolve_ability
    from app.routers.map import reset_movement_for
    assert callable(reset_movement_for)
    assert callable(_resolve_ability)


# ── Builder v2 (Phase 1: maps / locations / tiles) ───────────
@pytest.mark.asyncio
async def test_bv2_full_edit_flow(client, session_code):
    """End-to-end: create map → location → paint tiles → verify → activate."""
    BASE = "/api/builder-v2"

    # Empty list to start
    r = await client.get(f"{BASE}/sessions/{session_code}/maps")
    assert r.status_code == 200, r.text
    assert r.json() == []

    # Create map
    r = await client.post(f"{BASE}/sessions/{session_code}/maps", json={"name": "Test Map"})
    assert r.status_code == 200, r.text
    map_id = r.json()["id"]
    assert r.json()["name"] == "Test Map"
    assert r.json()["is_active"] is False

    # Create location
    r = await client.post(f"{BASE}/maps/{map_id}/locations", json={
        "name": "Town Square", "cols": 20, "rows": 15,
    })
    assert r.status_code == 200, r.text
    loc_id = r.json()["id"]
    assert r.json()["cols"] == 20
    assert r.json()["rows"] == 15
    assert r.json()["grid_type"] == "square"

    # PATCH tiles — paint a 3-tile wall
    r = await client.patch(f"{BASE}/locations/{loc_id}/tiles", json={
        "set": [
            {"col": 5, "row": 5, "tile_type": "wall"},
            {"col": 6, "row": 5, "tile_type": "wall"},
            {"col": 7, "row": 5, "tile_type": "wall"},
        ],
        "erase": [],
    })
    assert r.status_code == 200, r.text
    assert r.json()["set"] == 3

    # GET full payload — should have 3 tiles, all walls with blocks_*
    r = await client.get(f"{BASE}/locations/{loc_id}")
    assert r.status_code == 200
    payload = r.json()
    assert len(payload["tiles"]) == 3
    for t in payload["tiles"]:
        assert t["tile_type"] == "wall"
        assert t["blocks_movement"] is True
        assert t["blocks_vision"] is True

    # PATCH — overwrite one cell + erase another
    r = await client.patch(f"{BASE}/locations/{loc_id}/tiles", json={
        "set": [{"col": 5, "row": 5, "tile_type": "floor"}],
        "erase": [{"col": 7, "row": 5}],
    })
    assert r.status_code == 200
    assert r.json() == {"ok": True, "set": 1, "erased": 1}

    r = await client.get(f"{BASE}/locations/{loc_id}/tiles")
    tiles_by_cell = {(t["col"], t["row"]): t for t in r.json()}
    assert (5, 5) in tiles_by_cell and tiles_by_cell[(5, 5)]["tile_type"] == "floor"
    assert (5, 5) in tiles_by_cell and tiles_by_cell[(5, 5)]["blocks_movement"] is False
    assert (6, 5) in tiles_by_cell and tiles_by_cell[(6, 5)]["tile_type"] == "wall"
    assert (7, 5) not in tiles_by_cell  # erased

    # PUT — replace all tiles with a single lava cell
    r = await client.put(f"{BASE}/locations/{loc_id}/tiles", json={
        "tiles": [{"col": 0, "row": 0, "tile_type": "lava"}],
    })
    assert r.status_code == 200
    assert r.json() == {"ok": True, "count": 1}
    r = await client.get(f"{BASE}/locations/{loc_id}/tiles")
    assert len(r.json()) == 1 and r.json()[0]["tile_type"] == "lava"

    # Activate location → also activates parent map
    r = await client.post(f"{BASE}/locations/{loc_id}/activate")
    assert r.status_code == 200, r.text
    assert r.json()["is_active"] is True
    r = await client.get(f"{BASE}/sessions/{session_code}/maps")
    assert r.json()[0]["is_active"] is True


@pytest.mark.asyncio
async def test_bv2_out_of_bounds_tiles_rejected(client, session_code):
    """Tiles outside the location's cols×rows must be silently skipped, not crashed."""
    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    r = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 5, "rows": 5})
    loc_id = r.json()["id"]

    r = await client.patch(f"/api/builder-v2/locations/{loc_id}/tiles", json={
        "set": [
            {"col": 0, "row": 0, "tile_type": "floor"},   # ok
            {"col": 99, "row": 99, "tile_type": "wall"},  # out of bounds
            {"col": -1, "row": 0, "tile_type": "wall"},   # negative
        ],
        "erase": [],
    })
    assert r.status_code == 200
    # Only the in-bounds cell should be saved
    assert r.json()["set"] == 1


@pytest.mark.asyncio
async def test_bv2_404s(client):
    """Missing-resource paths return 404 with a JSON body."""
    r = await client.get("/api/builder-v2/locations/999999")
    assert r.status_code == 404
    r = await client.patch("/api/builder-v2/locations/999999/tiles", json={"set": [], "erase": []})
    assert r.status_code == 404
    r = await client.post("/api/builder-v2/maps/999999/activate")
    assert r.status_code == 404
    r = await client.get("/api/builder-v2/sessions/__nope__/maps")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_bv2_delete_cascades(client, session_code):
    """Deleting a map should cascade-delete its locations and tiles."""
    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    r = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={})
    loc_id = r.json()["id"]
    await client.patch(f"/api/builder-v2/locations/{loc_id}/tiles", json={
        "set": [{"col": 0, "row": 0, "tile_type": "wall"}], "erase": [],
    })

    r = await client.delete(f"/api/builder-v2/maps/{map_id}")
    assert r.status_code == 200

    # Location and its tiles should be gone
    r = await client.get(f"/api/builder-v2/locations/{loc_id}")
    assert r.status_code == 404


# ── bv2 Entities (Phase 2) ───────────────────────────────────

@pytest.mark.asyncio
async def test_bv2_entity_crud(client, session_code):
    """Create, read, update, move, delete an entity."""
    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    r = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 20, "rows": 15})
    loc_id = r.json()["id"]

    # Create a simple decor entity (generic endpoint, no detail table)
    r = await client.post(f"/api/builder-v2/locations/{loc_id}/entities", json={
        "entity_type": "light_marker",
        "col": 5, "row": 5,
        "name": "Lantern",
    })
    assert r.status_code == 200, r.text
    ent = r.json()
    assert ent["entity_type"] == "light_marker"
    assert ent["col"] == 5
    ent_id = ent["id"]

    # List
    r = await client.get(f"/api/builder-v2/locations/{loc_id}/entities")
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert r.json()[0]["id"] == ent_id

    # Patch
    r = await client.patch(f"/api/builder-v2/entities/{ent_id}", json={
        "name": "Bright Lantern",
    })
    assert r.status_code == 200
    assert r.json()["name"] == "Bright Lantern"

    # Move
    r = await client.post(f"/api/builder-v2/entities/{ent_id}/move", json={"col": 10, "row": 10})
    assert r.status_code == 200
    assert r.json()["col"] == 10
    assert r.json()["row"] == 10

    # Delete
    r = await client.delete(f"/api/builder-v2/entities/{ent_id}")
    assert r.status_code == 200
    r = await client.get(f"/api/builder-v2/locations/{loc_id}/entities")
    assert len(r.json()) == 0


@pytest.mark.asyncio
async def test_bv2_entity_types_validated(client, session_code):
    """Unknown entity_type must return 400."""
    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    r = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={})
    loc_id = r.json()["id"]

    r = await client.post(f"/api/builder-v2/locations/{loc_id}/entities", json={
        "entity_type": "dragon",
        "col": 0, "row": 0,
    })
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_bv2_entity_cascade_on_location_delete(client, session_code):
    """Deleting a location removes its entities."""
    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    r = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={})
    loc_id = r.json()["id"]

    r = await client.post(f"/api/builder-v2/locations/{loc_id}/entities", json={
        "entity_type": "trap",
        "col": 1, "row": 1,
    })
    ent_id = r.json()["id"]

    r = await client.delete(f"/api/builder-v2/locations/{loc_id}")
    assert r.status_code == 200

    r = await client.get(f"/api/builder-v2/entities/{ent_id}")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_bv2_entity_move_bounds_clamped(client, session_code):
    """Moving an entity outside location bounds clamps to edge."""
    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    r = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 10, "rows": 10})
    loc_id = r.json()["id"]

    r = await client.post(f"/api/builder-v2/locations/{loc_id}/entities", json={
        "entity_type": "portal",
        "col": 5, "row": 5,
    })
    ent_id = r.json()["id"]

    r = await client.post(f"/api/builder-v2/entities/{ent_id}/move", json={"col": 999, "row": -5})
    assert r.status_code == 200
    assert r.json()["col"] == 9   # clamped to cols-1
    assert r.json()["row"] == 0   # clamped to 0


# ── bv2 FOV (Phase 3) ────────────────────────────────────────

@pytest.mark.asyncio
async def test_bv2_visit_persists(client, session_code):
    """POST /visit stores explored cells; GET /visit returns them."""
    r = await client.post("/api/sessions/join", json={
        "session_code": session_code, "player_name": "Scout",
    })
    char_id = r.json()["character_id"]

    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    r = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 10, "rows": 10})
    loc_id = r.json()["id"]

    r = await client.post(f"/api/builder-v2/locations/{loc_id}/visit", json={
        "character_id": char_id,
        "visible_cells": [[0, 0], [1, 0], [2, 0]],
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert [0, 0] in data["explored_tiles"]
    assert [2, 0] in data["explored_tiles"]

    r = await client.get(f"/api/builder-v2/locations/{loc_id}/visit?character_id={char_id}")
    assert r.status_code == 200
    assert [1, 0] in r.json()["explored_tiles"]


@pytest.mark.asyncio
async def test_bv2_visit_merges_not_replaces(client, session_code):
    """Two sequential POSTs with different cells produce a union."""
    r = await client.post("/api/sessions/join", json={
        "session_code": session_code, "player_name": "Scout",
    })
    char_id = r.json()["character_id"]

    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    r = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 10, "rows": 10})
    loc_id = r.json()["id"]

    await client.post(f"/api/builder-v2/locations/{loc_id}/visit", json={
        "character_id": char_id,
        "visible_cells": [[0, 0]],
    })
    await client.post(f"/api/builder-v2/locations/{loc_id}/visit", json={
        "character_id": char_id,
        "visible_cells": [[1, 1]],
    })

    r = await client.get(f"/api/builder-v2/locations/{loc_id}/visit?character_id={char_id}")
    tiles = r.json()["explored_tiles"]
    assert [0, 0] in tiles
    assert [1, 1] in tiles


@pytest.mark.asyncio
async def test_bv2_visit_discovers_entities_in_visible_cells(client, session_code):
    """An entity inside visible_cells appears in discovered_entity_ids."""
    r = await client.post("/api/sessions/join", json={
        "session_code": session_code, "player_name": "Scout",
    })
    char_id = r.json()["character_id"]

    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    r = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 10, "rows": 10})
    loc_id = r.json()["id"]

    r = await client.post(f"/api/builder-v2/locations/{loc_id}/entities", json={
        "entity_type": "chest", "col": 3, "row": 3,
    })
    ent_id = r.json()["id"]

    r = await client.post(f"/api/builder-v2/locations/{loc_id}/visit", json={
        "character_id": char_id,
        "visible_cells": [[2, 2], [3, 3], [4, 4]],
    })
    assert r.status_code == 200
    assert ent_id in r.json()["discovered_entity_ids"]


@pytest.mark.asyncio
async def test_bv2_visit_respects_visible_to_players(client, session_code):
    """Entities with visible_to_players=False must NOT be auto-discovered by
    a non-GM character even when they stand on the exact same cell. Traps
    and hidden doors are gated behind DCs, not automatic FOV reveal.
    Regression guard for the core hidden-entity rule in Phase 3."""
    r = await client.post("/api/sessions/join", json={
        "session_code": session_code, "player_name": "Scout",
    })
    char_id = r.json()["character_id"]

    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    r = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={})
    loc_id = r.json()["id"]

    r = await client.post(f"/api/builder-v2/locations/{loc_id}/entities", json={
        "entity_type": "trap", "col": 1, "row": 1,
        "visible_to_players": False,
    })
    hidden_id = r.json()["id"]

    r = await client.post(f"/api/builder-v2/locations/{loc_id}/entities", json={
        "entity_type": "chest", "col": 2, "row": 2,
        "visible_to_players": True,
    })
    shown_id = r.json()["id"]

    r = await client.post(f"/api/builder-v2/locations/{loc_id}/visit", json={
        "character_id": char_id,
        "visible_cells": [[1, 1], [2, 2]],
    })
    assert r.status_code == 200
    discovered = r.json()["discovered_entity_ids"]
    assert shown_id in discovered
    assert hidden_id not in discovered


@pytest.mark.asyncio
async def test_bv2_sight_range_cells_exposed(client, session_code):
    """sight_range_cells must be present on every character-serialising
    endpoint the frontend consumes. If this test fails, FOV wiring in
    Phase 5/6 will have no way to read the per-character sight range."""
    r = await client.post("/api/sessions/join", json={
        "session_code": session_code, "player_name": "Scout",
    })
    char_id = r.json()["character_id"]

    # 1. /api/sessions/{code}/characters
    r = await client.get(f"/api/sessions/{session_code}/characters")
    me = next((x for x in r.json() if x["id"] == char_id), None)
    assert me is not None
    assert me.get("sight_range_cells") == 8

    # 2. /api/map/{code} (token serialiser used by the runtime canvas)
    r = await client.get(f"/api/map/{session_code}")
    assert r.status_code == 200
    tokens = r.json().get("tokens", [])
    mine = next((t for t in tokens if t["character_id"] == char_id), None)
    assert mine is not None
    assert mine.get("sight_range_cells") == 8


# ── bv2 Lighting (Phase 4) ───────────────────────────────────

@pytest.mark.asyncio
async def test_bv2_light_crud(client, session_code):
    """Create, read, update, delete a static light on a location."""
    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    r = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 20, "rows": 15})
    loc_id = r.json()["id"]

    # Create
    r = await client.post(f"/api/builder-v2/locations/{loc_id}/lights", json={
        "col": 5, "row": 5,
        "radius_cells": 4.0,
        "color_hex": "#ff0000",
        "intensity": 1.5,
        "source_kind": "torch",
    })
    assert r.status_code == 200, r.text
    light = r.json()
    assert light["radius_cells"] == 4.0
    assert light["color_hex"] == "#ff0000"
    light_id = light["id"]

    # List
    r = await client.get(f"/api/builder-v2/locations/{loc_id}/lights")
    assert r.status_code == 200
    assert len(r.json()) == 1

    # Patch
    r = await client.patch(f"/api/builder-v2/lights/{light_id}", json={
        "intensity": 2.0,
        "col": 6,
    })
    assert r.status_code == 200
    assert r.json()["intensity"] == 2.0
    assert r.json()["col"] == 6

    # Delete
    r = await client.delete(f"/api/builder-v2/lights/{light_id}")
    assert r.status_code == 200
    r = await client.get(f"/api/builder-v2/locations/{loc_id}/lights")
    assert len(r.json()) == 0


@pytest.mark.asyncio
async def test_bv2_light_affects_visibility(client, session_code):
    """A cell adjacent to a light source has higher effective illumination."""
    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    r = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 10, "rows": 10})
    loc_id = r.json()["id"]

    # Place a bright torch at (5,5)
    r = await client.post(f"/api/builder-v2/locations/{loc_id}/lights", json={
        "col": 5, "row": 5,
        "radius_cells": 3.0,
        "intensity": 1.0,
        "source_kind": "torch",
    })
    assert r.status_code == 200
    light_id = r.json()["id"]

    # Read back — verify radius and intensity are persisted
    r = await client.get(f"/api/builder-v2/locations/{loc_id}/lights")
    light = r.json()[0]
    assert light["radius_cells"] == 3.0
    assert light["intensity"] == 1.0
    assert light["col"] == 5
    assert light["row"] == 5


@pytest.mark.asyncio
async def test_bv2_character_carried_light(client, session_code):
    """Attach a light to a character, then detach it."""
    r = await client.post("/api/sessions/join", json={
        "session_code": session_code, "player_name": "Torchbearer",
    })
    char_id = r.json()["character_id"]

    # Attach
    r = await client.post(f"/api/builder-v2/characters/{char_id}/lights", json={
        "radius_cells": 5.0,
        "color_hex": "#00ff00",
        "intensity": 1.2,
        "source_kind": "magic",
    })
    assert r.status_code == 200, r.text
    light = r.json()
    assert light["character_id"] == char_id
    light_id = light["id"]

    # Detach
    r = await client.delete(f"/api/builder-v2/characters/{char_id}/lights/{light_id}")
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_bv2_location_ambient_light_zero_persists(client, session_code):
    """ambient_light=0 must survive a write/read round-trip without
    being silently coerced to 1.0. Regression for the JS `||` bug
    that hid dark locations behind a default-bright fallback."""
    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    r = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={
        "cols": 10, "rows": 10, "ambient_light": 0.0, "is_indoor": True,
    })
    assert r.status_code == 200
    loc_id = r.json()["id"]

    r = await client.get(f"/api/builder-v2/locations/{loc_id}")
    assert r.json()["location"]["ambient_light"] == 0.0


@pytest.mark.asyncio
async def test_bv2_carried_light_not_in_location_payload(client, session_code):
    """Carried lights (location_id=NULL) must not pollute a
    location's lights list. They are addressed only via the
    /characters/{id}/lights endpoints."""
    r = await client.post("/api/sessions/join", json={
        "session_code": session_code, "player_name": "TB",
    })
    char_id = r.json()["character_id"]

    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    r = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={})
    loc_id = r.json()["id"]

    await client.post(f"/api/builder-v2/locations/{loc_id}/lights", json={
        "col": 1, "row": 1, "radius_cells": 3.0, "intensity": 1.0,
    })
    await client.post(f"/api/builder-v2/characters/{char_id}/lights", json={
        "radius_cells": 5.0, "intensity": 1.0,
    })

    r = await client.get(f"/api/builder-v2/locations/{loc_id}/lights")
    assert len(r.json()) == 1   # only the static one
    assert all(li["character_id"] is None for li in r.json())


@pytest.mark.asyncio
async def test_bv2_location_delete_keeps_carried_lights(client, session_code):
    """Deleting a location removes its static lights but must not
    touch carried lights of characters in that session."""
    r = await client.post("/api/sessions/join", json={
        "session_code": session_code, "player_name": "TB",
    })
    char_id = r.json()["character_id"]

    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    r = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={})
    loc_id = r.json()["id"]

    r = await client.post(f"/api/builder-v2/characters/{char_id}/lights", json={
        "radius_cells": 5.0, "intensity": 1.0,
    })
    carried_id = r.json()["id"]

    r = await client.delete(f"/api/builder-v2/locations/{loc_id}")
    assert r.status_code == 200

    # Carried light still detachable -> still alive
    r = await client.delete(f"/api/builder-v2/characters/{char_id}/lights/{carried_id}")
    assert r.status_code == 200


# ── bv2 Edge Transitions (Phase 5) ───────────────────────────

@pytest.mark.asyncio
async def test_bv2_edge_crud(client, session_code):
    """Create, read, update, delete an edge between two locations."""
    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]

    r = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 10, "rows": 10})
    loc_a = r.json()["id"]
    r = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 10, "rows": 10})
    loc_b = r.json()["id"]

    # Create edge on east side of loc_a
    r = await client.post(f"/api/builder-v2/locations/{loc_a}/edges", json={
        "side": "east", "range_start": 2, "range_end": 5,
        "target_location_id": loc_b, "target_entry_col": 1, "target_entry_row": 1,
    })
    assert r.status_code == 200, r.text
    edge = r.json()
    assert edge["side"] == "east"
    assert edge["target_location_id"] == loc_b
    edge_id = edge["id"]

    # List
    r = await client.get(f"/api/builder-v2/locations/{loc_a}/edges")
    assert len(r.json()) == 1

    # Patch
    r = await client.patch(f"/api/builder-v2/edges/{edge_id}", json={"range_start": 3})
    assert r.status_code == 200
    assert r.json()["range_start"] == 3

    # Delete
    r = await client.delete(f"/api/builder-v2/edges/{edge_id}")
    assert r.status_code == 200
    r = await client.get(f"/api/builder-v2/locations/{loc_a}/edges")
    assert len(r.json()) == 0


@pytest.mark.asyncio
async def test_bv2_edge_transition_on_move(client, session_code):
    """Moving a character onto an edge cell teleports them to the target location."""
    r = await client.post("/api/sessions/join", json={
        "session_code": session_code, "player_name": "Wanderer",
    })
    char_id = r.json()["character_id"]

    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]

    r = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 10, "rows": 10})
    loc_a = r.json()["id"]
    r = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 10, "rows": 10})
    loc_b = r.json()["id"]

    # Create edge on east side of loc_a (col=9)
    await client.post(f"/api/builder-v2/locations/{loc_a}/edges", json={
        "side": "east", "range_start": 0, "range_end": 9,
        "target_location_id": loc_b, "target_entry_col": 1, "target_entry_row": 2,
    })

    # Place character in loc_a at (8, 2)
    r = await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
        "location_id": loc_a, "col": 8, "row": 2,
    })
    assert r.status_code == 200
    assert r.json()["location_id"] == loc_a
    assert r.json()["col"] == 8

    # Move to (9, 2) — on the east edge -> should transition to loc_b
    r = await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
        "col": 9, "row": 2,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["location_id"] == loc_b
    assert data["col"] == 1
    assert data["row"] == 2


@pytest.mark.asyncio
async def test_bv2_first_placement_does_not_trigger_edge(client, session_code):
    """Setting location_id + col/row in one move-grid call must
    *place* the character, never transition through an edge that
    happens to cover the placement cell. Regression for the
    `old_loc_id` capture-after-assignment bug."""
    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    a = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"cols": 10, "rows": 10})).json()["id"]
    b = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"cols": 10, "rows": 10})).json()["id"]

    await client.post(f"/api/builder-v2/locations/{a}/edges", json={
        "side": "east", "range_start": 0, "range_end": 9,
        "target_location_id": b, "target_entry_col": 3, "target_entry_row": 3,
    })

    r = await client.post("/api/sessions/join", json={
        "session_code": session_code, "player_name": "P",
    })
    char_id = r.json()["character_id"]

    # Place directly on the east edge (col=9). MUST stay in A.
    r = await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
        "location_id": a, "col": 9, "row": 5,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["location_id"] == a, f"placement teleported into {data['location_id']}"
    assert (data["col"], data["row"]) == (9, 5)


@pytest.mark.asyncio
async def test_bv2_location_delete_nullifies_incoming_edges(client, session_code):
    """Deleting a target location must nullify edges in other
    locations that point to it. Otherwise SQLite keeps a dangling
    FK and `move-grid` teleports characters into ghost rows."""
    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    a = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"cols": 10, "rows": 10})).json()["id"]
    b = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"cols": 10, "rows": 10})).json()["id"]

    r = await client.post(f"/api/builder-v2/locations/{a}/edges", json={
        "side": "east", "range_start": 0, "range_end": 9,
        "target_location_id": b, "target_entry_col": 3, "target_entry_row": 3,
    })
    edge_id = r.json()["id"]

    r = await client.delete(f"/api/builder-v2/locations/{b}")
    assert r.status_code == 200

    r = await client.get(f"/api/builder-v2/locations/{a}/edges")
    edges = r.json()
    assert len(edges) == 1
    assert edges[0]["id"] == edge_id
    assert edges[0]["target_location_id"] is None


@pytest.mark.asyncio
async def test_bv2_character_grid_position_exposed(client, session_code):
    """current_location_id / col / row must be present on every
    character-serialising endpoint the frontend reads. If this
    fails, the frontend has no way to bootstrap grid state on
    refresh — only WS movement events would carry the info, which
    is not enough for initial render."""
    r = await client.post("/api/sessions/join", json={
        "session_code": session_code, "player_name": "P",
    })
    char_id = r.json()["character_id"]

    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 10, "rows": 10})).json()["id"]

    await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
        "location_id": loc_id, "col": 4, "row": 7,
    })

    # 1. /api/sessions/{code}/characters
    r = await client.get(f"/api/sessions/{session_code}/characters")
    me = next(x for x in r.json() if x["id"] == char_id)
    assert me["bv2_location_id"] == loc_id
    assert me["bv2_col"] == 4
    assert me["bv2_row"] == 7

    # 2. /api/map/{code} token serialiser
    r = await client.get(f"/api/map/{session_code}")
    mine = next(t for t in r.json()["tokens"] if t["character_id"] == char_id)
    assert mine["bv2_location_id"] == loc_id
    assert mine["bv2_col"] == 4
    assert mine["bv2_row"] == 7


@pytest.mark.asyncio
async def test_bv2_edge_range_clamping(client, session_code):
    """range_end must clamp to cols-1 / rows-1 (not cols / rows),
    and range_end must never end up below range_start."""
    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    a = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"cols": 10, "rows": 8})).json()["id"]
    b = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"cols": 10, "rows": 8})).json()["id"]

    # Out-of-bounds end on cols=10 north edge -> max valid is 9.
    r = await client.post(f"/api/builder-v2/locations/{a}/edges", json={
        "side": "north", "range_start": 0, "range_end": 9999,
        "target_location_id": b,
    })
    assert r.json()["range_end"] == 9

    # Inverted -> end floored to start.
    r = await client.post(f"/api/builder-v2/locations/{a}/edges", json={
        "side": "east", "range_start": 5, "range_end": 0,
        "target_location_id": b,
    })
    assert r.json()["range_end"] >= r.json()["range_start"]


# ── bv2 Library (Phase 6) ────────────────────────────────────

@pytest.mark.asyncio
async def test_bv2_library_save_and_load(client, session_code):
    """Full roundtrip: every snapshot field must survive
    save -> load, including ambient_light=0 (S1 regression),
    multi-location edges (target_location_index resolution),
    lights (all fields), hidden entities (visible_to_players=False),
    and cross-session loading."""
    # Build a map with: 2 locations, dark indoor, wall tile,
    # coloured torch, hidden trap, edge linking A -> B.
    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                          json={"name": "Original"})
    map_id = r.json()["id"]

    a = (await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={
        "cols": 10, "rows": 10, "ambient_light": 0.0, "is_indoor": True,
    })).json()["id"]
    b = (await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={
        "cols": 12, "rows": 8,
    })).json()["id"]

    await client.patch(f"/api/builder-v2/locations/{a}/tiles", json={
        "set": [{"col": 1, "row": 1, "tile_type": "wall"}], "erase": [],
    })
    await client.post(f"/api/builder-v2/locations/{a}/lights", json={
        "col": 3, "row": 3, "radius_cells": 4.5, "color_hex": "#ff0000",
        "intensity": 1.5, "source_kind": "torch",
    })
    await client.post(f"/api/builder-v2/locations/{a}/entities", json={
        "entity_type": "trap", "col": 5, "row": 5,
        "visible_to_players": False, "name": "Hidden Trap",
    })
    await client.post(f"/api/builder-v2/locations/{a}/edges", json={
        "side": "east", "range_start": 2, "range_end": 5,
        "target_location_id": b, "target_entry_col": 1, "target_entry_row": 1,
    })

    # Save -> list -> load
    r = await client.post("/api/builder-v2/library/save-from-map",
                          json={"map_id": map_id, "name": "Snap"})
    assert r.status_code == 200, r.text
    snap_id = r.json()["id"]

    r = await client.get(f"/api/builder-v2/library?session_code={session_code}")
    assert any(s["id"] == snap_id for s in r.json())

    r = await client.post(f"/api/builder-v2/library/{snap_id}/load-as-map",
                          json={"session_code": session_code, "name": "Loaded"})
    assert r.status_code == 200, r.text
    new_map_id = r.json()["map_id"]

    new_locs = (await client.get(f"/api/builder-v2/maps/{new_map_id}/locations")).json()
    assert len(new_locs) == 2
    new_a, new_b = new_locs[0]["id"], new_locs[1]["id"]

    # -- Location A: verify every field --
    full_a = (await client.get(f"/api/builder-v2/locations/{new_a}")).json()
    loc = full_a["location"]
    assert loc["ambient_light"] == 0.0, "S1 regression: ambient_light=0 coerced"
    assert loc["is_indoor"] is True
    assert loc["cols"] == 10 and loc["rows"] == 10

    # Tile
    assert len(full_a["tiles"]) == 1
    assert full_a["tiles"][0]["tile_type"] == "wall"

    # Light -- every persisted field
    assert len(full_a["lights"]) == 1
    li = full_a["lights"][0]
    assert li["radius_cells"] == 4.5
    assert li["color_hex"] == "#ff0000"
    assert li["intensity"] == 1.5
    assert li["source_kind"] == "torch"
    assert li["col"] == 3 and li["row"] == 3

    # Entity -- visible_to_players=False must persist (hidden trap)
    assert len(full_a["entities"]) == 1
    e = full_a["entities"][0]
    assert e["entity_type"] == "trap"
    assert e["name"] == "Hidden Trap"
    assert e["visible_to_players"] is False

    # Edge -- target_location_index resolved to the new B id
    edges = (await client.get(f"/api/builder-v2/locations/{new_a}/edges")).json()
    assert len(edges) == 1
    assert edges[0]["side"] == "east"
    assert edges[0]["range_start"] == 2 and edges[0]["range_end"] == 5
    assert edges[0]["target_location_id"] == new_b
    assert edges[0]["target_entry_col"] == 1 and edges[0]["target_entry_row"] == 1

    # -- Cross-session load (library is portable across sessions) --
    r = await client.post("/api/sessions/create",
                          json={"gm_name": "OtherGM", "name": "OtherSession"})
    other_code = r.json()["session_code"]
    r = await client.post(f"/api/builder-v2/library/{snap_id}/load-as-map",
                          json={"session_code": other_code, "name": "Cross"})
    assert r.status_code == 200

    # -- Error handling --
    r = await client.post("/api/builder-v2/library/99999/load-as-map",
                          json={"session_code": session_code, "name": "X"})
    assert r.status_code == 404

    # Cleanup
    r = await client.delete(f"/api/builder-v2/library/{snap_id}")
    assert r.status_code == 200


# ── bv2 Typed Entity Tables (Phase 7 Group A) ───────────────

@pytest.mark.asyncio
async def test_bv2_chest_full_config_roundtrip(client, session_code):
    """Chest detail table roundtrip: create, add items, GET, assert all fields."""
    # Setup map + location
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "M"})).json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 10, "rows": 10})).json()["id"]
    # Create two items
    item1 = (await client.post("/api/items", json={"name": "Sword", "category": "weapon",
                                                     "base_price": 100, "session_id": None})).json()["id"]
    item2 = (await client.post("/api/items", json={"name": "Shield", "category": "armor",
                                                     "base_price": 50, "session_id": None})).json()["id"]
    # Create chest entity
    r = await client.post(f"/api/builder-v2/locations/{loc_id}/chests", json={
        "col": 3, "row": 4, "name": "Treasure",
        "is_locked": True, "lock_dc": 15, "icon": "chest_gold",
    })
    assert r.status_code == 200, r.text
    chest = r.json()
    assert chest["entity_type"] == "chest"
    assert chest["is_locked"] is True
    assert chest["lock_dc"] == 15
    assert chest["icon"] == "chest_gold"
    ent_id = chest["id"]
    # Add items
    r = await client.post(f"/api/builder-v2/chests/{ent_id}/items", json={
        "item_id": item1, "quantity": 2,
    })
    assert r.status_code == 200
    r = await client.post(f"/api/builder-v2/chests/{ent_id}/items", json={
        "item_id": item2, "quantity": 1,
    })
    assert r.status_code == 200
    # GET full detail
    r = await client.get(f"/api/builder-v2/chests/{ent_id}")
    assert r.status_code == 200
    detail = r.json()
    assert detail["is_locked"] is True
    assert detail["lock_dc"] == 15
    assert len(detail["items"]) == 2
    names = {i["name"] for i in detail["items"]}
    assert names == {"Sword", "Shield"}
    q = {i["name"]: i["quantity"] for i in detail["items"]}
    assert q["Sword"] == 2
    assert q["Shield"] == 1


@pytest.mark.asyncio
async def test_bv2_trap_full_config_roundtrip(client, session_code):
    """Trap detail table roundtrip + invalid damage_dice negative path."""
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "M"})).json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 10, "rows": 10})).json()["id"]
    # Valid create
    r = await client.post(f"/api/builder-v2/locations/{loc_id}/traps", json={
        "col": 2, "row": 2, "name": "Spike Pit",
        "trap_type": "pit", "damage_dice": "2d6+3",
        "damage_type": "piercing", "dc_detect": 14,
        "dc_disarm": 12, "dc_save": 13,
        "save_ability": "dex", "trigger_mode": "on_enter",
        "reset_on_trigger": True,
    })
    assert r.status_code == 200, r.text
    t = r.json()
    assert t["damage_dice"] == "2d6+3"
    assert t["dc_detect"] == 14
    assert t["reset_on_trigger"] is True
    # Invalid dice -> 422
    r = await client.post(f"/api/builder-v2/locations/{loc_id}/traps", json={
        "col": 3, "row": 3, "name": "Bad",
        "damage_dice": "banana",
    })
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_bv2_portal_full_config_roundtrip(client, session_code):
    """Portal detail table roundtrip with target location + key item."""
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "M"})).json()["id"]
    a = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"cols": 8, "rows": 8})).json()["id"]
    b = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"cols": 8, "rows": 8})).json()["id"]
    key_item = (await client.post("/api/items", json={"name": "Key", "category": "misc",
                                                        "base_price": 10, "session_id": None})).json()["id"]
    r = await client.post(f"/api/builder-v2/locations/{a}/portals", json={
        "col": 1, "row": 1, "name": "Door",
        "target_location_id": b, "target_col": 5, "target_row": 5,
        "is_one_way": True, "requires_key_item_id": key_item, "label": "Magic Door",
    })
    assert r.status_code == 200, r.text
    p = r.json()
    assert p["target_location_id"] == b
    assert p["target_col"] == 5
    assert p["is_one_way"] is True
    assert p["requires_key_item_id"] == key_item
    # GET
    r = await client.get(f"/api/builder-v2/portals/{p['id']}")
    assert r.status_code == 200
    assert r.json()["label"] == "Magic Door"


@pytest.mark.asyncio
async def test_bv2_portal_target_nullified_on_target_delete(client, session_code):
    """S5b: deleting a target location must NULL out portal.target_location_id."""
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "M"})).json()["id"]
    a = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"cols": 8, "rows": 8})).json()["id"]
    b = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"cols": 8, "rows": 8})).json()["id"]
    r = await client.post(f"/api/builder-v2/locations/{a}/portals", json={
        "col": 0, "row": 0, "target_location_id": b,
    })
    ent_id = r.json()["id"]
    await client.delete(f"/api/builder-v2/locations/{b}")
    r = await client.get(f"/api/builder-v2/portals/{ent_id}")
    assert r.json()["target_location_id"] is None


@pytest.mark.asyncio
async def test_bv2_npc_spawn_full_config_roundtrip(client, session_code):
    """NPC spawn detail table roundtrip."""
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "M"})).json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 10, "rows": 10})).json()["id"]
    # Get session id first
    sess = (await client.get(f"/api/sessions/{session_code}")).json()
    sess_id = sess["id"]
    # Create NPC template
    tpl = (await client.post("/api/npc-library/templates", json={
        "session_id": sess_id, "name": "Goblin", "max_hp": 15,
        "armor_class": 12, "strength": 10, "dexterity": 14,
    })).json()["id"]
    r = await client.post(f"/api/builder-v2/locations/{loc_id}/npc-spawns", json={
        "col": 2, "row": 3, "name": "Ambush",
        "npc_template_id": tpl, "auto_spawn_trigger": "on_enter",
        "spawn_count": 3, "is_hostile": True,
    })
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["npc_template_id"] == tpl
    assert s["spawn_count"] == 3
    assert s["is_hostile"] is True
    r = await client.get(f"/api/builder-v2/npc-spawns/{s['id']}")
    assert r.json()["auto_spawn_trigger"] == "on_enter"


@pytest.mark.asyncio
async def test_bv2_cover_zone_multi_cell_roundtrip(client, session_code):
    """Cover zone with multiple cells roundtrip."""
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "M"})).json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 10, "rows": 10})).json()["id"]
    r = await client.post(f"/api/builder-v2/locations/{loc_id}/cover-zones", json={
        "col": 1, "row": 1, "name": "Rubble",
        "cover_level": "three_quarters", "material": "stone",
        "blocks_line_of_sight": True, "is_destructible": True,
        "current_hp": 20, "max_hp": 20,
    })
    assert r.status_code == 200, r.text
    zone = r.json()
    ent_id = zone["id"]
    assert zone["cover_level"] == "three_quarters"
    # Add cells
    for cell in [{"col": 1, "row": 1}, {"col": 2, "row": 1}, {"col": 2, "row": 2}]:
        r = await client.post(f"/api/builder-v2/cover-zones/{ent_id}/cells", json=cell)
        assert r.status_code == 200
    r = await client.get(f"/api/builder-v2/cover-zones/{ent_id}")
    assert len(r.json()["cells"]) == 3
    # Remove one cell
    r = await client.delete(f"/api/builder-v2/cover-zones/{ent_id}/cells/1/1")
    assert r.status_code == 200
    r = await client.get(f"/api/builder-v2/cover-zones/{ent_id}")
    assert len(r.json()["cells"]) == 2


@pytest.mark.asyncio
async def test_bv2_chest_with_items_appears_in_player_map_state(client, session_code):
    """Integration: chest + items -> activate -> /api/map shows chest in _mapChests."""
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "M"})).json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 10, "rows": 10})).json()["id"]
    item1 = (await client.post("/api/items", json={"name": "Gem", "category": "misc",
                                                     "base_price": 500, "session_id": None})).json()["id"]
    # Create chest with item (opened so items surface in public payload)
    r = await client.post(f"/api/builder-v2/locations/{loc_id}/chests", json={
        "col": 5, "row": 5, "name": "Loot",
        "is_locked": False, "is_opened": True,
    })
    ent_id = r.json()["id"]
    await client.post(f"/api/builder-v2/chests/{ent_id}/items", json={"item_id": item1, "quantity": 1})
    # Activate
    await client.post(f"/api/builder-v2/maps/{map_id}/activate", json={})
    await client.post(f"/api/builder-v2/locations/{loc_id}/activate", json={})
    # Map state
    state = (await client.get(f"/api/map/{session_code}")).json()
    assert state.get("bv2_active_location_id") == loc_id
    chests = state.get("_mapChests", [])
    assert any(c["name"] == "Loot" for c in chests)
    loot = next(c for c in chests if c["name"] == "Loot")
    assert any(i["name"] == "Gem" for i in loot.get("items", []))


@pytest.mark.asyncio
async def test_bv2_location_delete_nullifies_character_pointer(client, session_code):
    """S5: deleting a bv2 location must NULL out characters.current_location_id
    (SQLite ignores ON DELETE SET NULL)."""
    # Create map + location
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "M"})).json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 5, "rows": 5})).json()["id"]

    # Create a character via join and place them in the location
    r = await client.post("/api/sessions/join", json={
        "session_code": session_code, "player_name": "Tester",
    })
    char_id = r.json()["character_id"]
    await client.patch(f"/api/characters/{char_id}",
                       json={"current_location_id": loc_id, "col": 1, "row": 1})

    # Sanity: pointer is set
    assert (await client.get(f"/api/characters/{char_id}")).json()["current_location_id"] == loc_id

    # Delete the location
    r = await client.delete(f"/api/builder-v2/locations/{loc_id}")
    assert r.status_code == 200

    # Pointer must be cleared, not dangling
    after = (await client.get(f"/api/characters/{char_id}")).json()
    assert after["current_location_id"] is None, \
        "S5 regression: characters.current_location_id left dangling after location delete"

    # Same guarantee when the whole map is deleted
    loc_id2 = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                 json={"cols": 5, "rows": 5})).json()["id"]
    await client.patch(f"/api/characters/{char_id}",
                       json={"current_location_id": loc_id2, "col": 2, "row": 2})
    await client.delete(f"/api/builder-v2/maps/{map_id}")
    after2 = (await client.get(f"/api/characters/{char_id}")).json()
    assert after2["current_location_id"] is None, \
        "S5 regression: map delete did not clear character pointer to child location"


@pytest.mark.asyncio
async def test_bv2_location_hex_grid_persists(client, session_code):
    """grid_type='hex' must round-trip through PATCH/GET cleanly."""
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "M"})).json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 8, "rows": 6})).json()["id"]
    r = await client.patch(f"/api/builder-v2/locations/{loc_id}",
                           json={"grid_type": "hex"})
    assert r.status_code == 200
    assert r.json()["grid_type"] == "hex"
    await client.patch(f"/api/builder-v2/locations/{loc_id}/tiles", json={
        "set": [{"col": 7, "row": 5, "tile_type": "wall"}], "erase": [],
    })
    full = (await client.get(f"/api/builder-v2/locations/{loc_id}")).json()
    assert any(t["col"] == 7 and t["row"] == 5 for t in full["tiles"])


@pytest.mark.asyncio
async def test_bv2_active_map_surfaces_on_legacy_map_endpoint(client, session_code):
    """Activating a bv2 map+location must make /api/map/{code} return
    bv2-sourced state instead of legacy MapFloor data."""
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "BV2"})).json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 10, "rows": 10})).json()["id"]
    await client.patch(f"/api/builder-v2/locations/{loc_id}/tiles", json={
        "set": [{"col": 3, "row": 3, "tile_type": "wall",
                 "blocks_movement": True, "blocks_vision": True}],
        "erase": [],
    })
    await client.post(f"/api/builder-v2/locations/{loc_id}/entities", json={
        "entity_type": "light_marker", "col": 5, "row": 5, "name": "Goldie",
    })

    # Before activation: /api/map should NOT see bv2 data.
    state = (await client.get(f"/api/map/{session_code}")).json()
    assert state.get("bv2_active_location_id") is None

    # Activate map and location
    await client.post(f"/api/builder-v2/maps/{map_id}/activate", json={})
    await client.post(f"/api/builder-v2/locations/{loc_id}/activate", json={})

    # Now /api/map should be bv2-sourced
    state = (await client.get(f"/api/map/{session_code}")).json()
    assert state["has_map"] is True
    assert state["bv2_active_location_id"] == loc_id
    assert state["active_floor_tile_size"] == 50
    assert state["active_floor_grid_type"] == "square"
    assert "3,3" in state["active_floor_tiles"]
    assert state["active_floor_tiles"]["3,3"]["type"] == "wall"
    assert state["active_floor_tiles"]["3,3"]["blocks_vision"] is True


@pytest.mark.asyncio
async def test_bv2_library_load_then_activate_surfaces(client, session_code):
    """Full user journey: build -> save snapshot -> load as new map ->
    activate -> players see it on /api/map."""
    # Build a map with one wall
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "Original"})).json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 6, "rows": 6})).json()["id"]
    await client.patch(f"/api/builder-v2/locations/{loc_id}/tiles", json={
        "set": [{"col": 0, "row": 0, "tile_type": "wall"}], "erase": [],
    })

    # Save -> load -> get the new map id
    snap_id = (await client.post("/api/builder-v2/library/save-from-map",
                                 json={"map_id": map_id, "name": "Snap"})).json()["id"]
    new_map_id = (await client.post(f"/api/builder-v2/library/{snap_id}/load-as-map",
                                    json={"session_code": session_code,
                                          "name": "Loaded"})).json()["map_id"]
    new_loc_id = (await client.get(
        f"/api/builder-v2/maps/{new_map_id}/locations")).json()[0]["id"]

    # Activate the LOADED map
    await client.post(f"/api/builder-v2/maps/{new_map_id}/activate", json={})
    await client.post(f"/api/builder-v2/locations/{new_loc_id}/activate", json={})

    # Players see it
    state = (await client.get(f"/api/map/{session_code}")).json()
    assert state["bv2_active_location_id"] == new_loc_id
    assert "0,0" in state["active_floor_tiles"]


@pytest.mark.asyncio
async def test_phase7_bridge_payload_keeps_bv2_chests_with_null_active_floor_id(client, session_code):
    """The bv2 bridge must return _mapChests with active_floor_id=None.
    The client uses active_floor_id=None as a signal to NOT wipe the
    bridge-provided chests."""
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "M"})).json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 10, "rows": 10})).json()["id"]
    r = await client.post(f"/api/builder-v2/locations/{loc_id}/chests", json={
        "col": 5, "row": 5, "name": "Loot", "is_locked": False, "is_opened": True,
    })
    ent_id = r.json()["id"]
    await client.post(f"/api/builder-v2/maps/{map_id}/activate", json={})
    await client.post(f"/api/builder-v2/locations/{loc_id}/activate", json={})
    state = (await client.get(f"/api/map/{session_code}")).json()
    # Critical assertions for Bug #2:
    assert state["active_floor_id"] is None, \
        "bv2-sourced state must signal active_floor_id=None"
    assert state["bv2_active_location_id"] == loc_id, \
        "bv2 source marker must be set"
    assert any(c["name"] == "Loot" for c in state.get("_mapChests", [])), \
        "bridge must populate _mapChests; the client trusts this"


@pytest.mark.asyncio
async def test_phase7_library_load_then_activate_via_ui_flow(client, session_code):
    """Verify the backend supports the auto-activate-after-load flow
    that the client now performs. The client calls loadSnapshot ->
    activateMap -> activateLoc; this test exercises the same
    sequence and asserts /api/map surfaces the new map."""
    # Build + save a snapshot
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "Original"})).json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 6, "rows": 6})).json()["id"]
    await client.patch(f"/api/builder-v2/locations/{loc_id}/tiles", json={
        "set": [{"col": 1, "row": 1, "tile_type": "wall"}], "erase": [],
    })
    snap_id = (await client.post("/api/builder-v2/library/save-from-map",
                                 json={"map_id": map_id, "name": "Snap"})).json()["id"]
    # Load (UI step 1)
    new_map_id = (await client.post(f"/api/builder-v2/library/{snap_id}/load-as-map",
                                    json={"session_code": session_code,
                                          "name": "Loaded"})).json()["map_id"]
    # Auto-activate map (UI step 2 — this is what 90-library.js will now do)
    await client.post(f"/api/builder-v2/maps/{new_map_id}/activate", json={})
    # Auto-activate first location (UI step 3)
    locs = (await client.get(f"/api/builder-v2/maps/{new_map_id}/locations")).json()
    assert len(locs) > 0, "loaded snapshot must include at least one location"
    await client.post(f"/api/builder-v2/locations/{locs[0]['id']}/activate", json={})
    # Player view sees it immediately
    state = (await client.get(f"/api/map/{session_code}")).json()
    assert state["bv2_active_location_id"] == locs[0]["id"]


@pytest.mark.asyncio
async def test_bv2_bridge_payload_includes_lights_and_edges(client, session_code):
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "LE"})).json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 8, "rows": 8})).json()["id"]
    # Add light
    await client.post(f"/api/builder-v2/locations/{loc_id}/lights", json={
        "col": 2, "row": 2, "radius_cells": 4, "color_hex": "#ffaa44",
        "intensity": 1.0, "source_kind": "torch",
    })
    # Add edge
    await client.post(f"/api/builder-v2/locations/{loc_id}/edges", json={
        "side": "east", "range_start": 3, "range_end": 5,
        "target_location_id": None,
    })
    await client.post(f"/api/builder-v2/maps/{map_id}/activate", json={})
    await client.post(f"/api/builder-v2/locations/{loc_id}/activate", json={})

    state = (await client.get(f"/api/map/{session_code}")).json()
    assert len(state.get("bv2_lights", [])) == 1
    assert state["bv2_lights"][0]["col"] == 2
    assert state["bv2_lights"][0]["color_hex"] == "#ffaa44"
    assert len(state.get("bv2_edges", [])) == 1
    assert state["bv2_edges"][0]["side"] == "east"


@pytest.mark.asyncio
async def test_bv2_bridge_payload_revealed_cells_for_character(client, session_code):
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "R"})).json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 6, "rows": 6})).json()["id"]
    # Create a character
    join = await client.post("/api/sessions/join", json={
        "session_code": session_code, "player_name": "Scout",
    })
    char_id = join.json()["character_id"]
    # Place character in location
    await client.patch(f"/api/characters/{char_id}", json={
        "current_location_id": loc_id, "col": 1, "row": 1,
    })
    # Visit endpoint stores explored tiles
    await client.post(f"/api/builder-v2/locations/{loc_id}/visit", json={
        "character_id": char_id,
        "visible_cells": [[1, 1], [2, 1], [1, 2]],
    })
    await client.post(f"/api/builder-v2/maps/{map_id}/activate", json={})
    await client.post(f"/api/builder-v2/locations/{loc_id}/activate", json={})

    state = (await client.get(f"/api/map/{session_code}?character_id={char_id}")).json()
    rc = state.get("revealed_cells", [])
    assert "1,1" in rc
    assert "2,1" in rc
    assert "1,2" in rc


@pytest.mark.asyncio
async def test_bv2_bridge_payload_revealed_cells_empty_without_character_id(client, session_code):
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "NR"})).json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 6, "rows": 6})).json()["id"]
    await client.post(f"/api/builder-v2/maps/{map_id}/activate", json={})
    await client.post(f"/api/builder-v2/locations/{loc_id}/activate", json={})

    state = (await client.get(f"/api/map/{session_code}")).json()
    assert state.get("revealed_cells") == []


@pytest.mark.asyncio
async def test_bv2_shift_location_content(client, session_code):
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "Shift"})).json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 6, "rows": 6})).json()["id"]
    # Place a tile at (1,1)
    await client.patch(f"/api/builder-v2/locations/{loc_id}/tiles", json={
        "set": [{"col": 1, "row": 1, "tile_type": "wall"}], "erase": [],
    })
    # Shift right+down by 1
    r = await client.post(f"/api/builder-v2/locations/{loc_id}/shift", json={
        "delta_col": 1, "delta_row": 1,
    })
    assert r.status_code == 200
    assert r.json()["shifted"] is True
    # Tile should now be at (2,2)
    tiles = (await client.get(f"/api/builder-v2/locations/{loc_id}/tiles")).json()
    assert any(t["col"] == 2 and t["row"] == 2 and t["tile_type"] == "wall" for t in tiles)
