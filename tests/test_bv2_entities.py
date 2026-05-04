import pytest
from httpx import ASGITransport, AsyncClient
from main import app
from app.database import init_db


@pytest.fixture
async def client():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_trap_zone_trigger_size_cells(client):
    """Trap with size_cells=2 triggers when character enters any cell in the zone."""
    sr = await client.post("/api/sessions/create", json={"name": "T"})
    code = sr.json()["session_code"]

    jr = await client.post("/api/sessions/join", json={
        "session_code": code, "player_name": "Hero",
    })
    char_id = jr.json()["character_id"]
    await client.patch(f"/api/characters/{char_id}", json={"current_hp": 50, "max_hp": 50})

    mr = await client.post(f"/api/builder-v2/sessions/{code}/maps", json={"name": "M"})
    map_id = mr.json()["id"]
    lr = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 10, "rows": 10})
    loc_id = lr.json()["id"]

    # Create trap at (3,3) with size_cells=2 (covers 3x3, 4x3, 3x4, 4x4)
    tr = await client.post(f"/api/builder-v2/locations/{loc_id}/traps", json={
        "col": 3, "row": 3, "name": "Big Pit",
        "damage_dice": "1d4",
        "damage_type": "piercing",
        "undodgeable": True,
        "charges": 1,
        "size_cells": 2,
    })
    assert tr.status_code == 200

    # Place character at (2,2)
    await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
        "location_id": loc_id, "col": 2, "row": 2,
    })

    # Step into adjacent cell (4,4) which is inside the 2x2 zone
    await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
        "col": 4, "row": 4,
    })

    char = await client.get(f"/api/characters/{char_id}")
    assert char.json()["current_hp"] < 50


@pytest.mark.asyncio
async def test_trap_dodge_offer_blocks_retrigger(client):
    """Dodgeable trap should not offer dodge twice without reset."""
    sr = await client.post("/api/sessions/create", json={"name": "T"})
    code = sr.json()["session_code"]

    jr = await client.post("/api/sessions/join", json={
        "session_code": code, "player_name": "Hero",
    })
    char_id = jr.json()["character_id"]
    await client.patch(f"/api/characters/{char_id}", json={"current_hp": 50, "max_hp": 50})

    mr = await client.post(f"/api/builder-v2/sessions/{code}/maps", json={"name": "M"})
    map_id = mr.json()["id"]
    lr = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 10, "rows": 10})
    loc_id = lr.json()["id"]

    tr = await client.post(f"/api/builder-v2/locations/{loc_id}/traps", json={
        "col": 3, "row": 3, "name": "Dart",
        "damage_dice": "1d6",
        "undodgeable": False,
        "attack_bonus": 0,
        "charges": -1,
    })
    trap_id = tr.json()["id"]

    # Place character first, then step on trap
    await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
        "location_id": loc_id, "col": 2, "row": 2,
    })
    await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
        "col": 3, "row": 3,
    })

    trap = await client.get(f"/api/builder-v2/traps/{trap_id}")
    assert trap.json()["is_triggered"] is True

    # Step away and back → is_triggered should block re-offer, HP unchanged
    await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
        "col": 4, "row": 3,
    })
    await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
        "col": 3, "row": 3,
    })

    char = await client.get(f"/api/characters/{char_id}")
    assert char.json()["current_hp"] == 50


@pytest.mark.asyncio
async def test_trap_accept_hit_applies_damage(client):
    sr = await client.post("/api/sessions/create", json={"name": "T"})
    code = sr.json()["session_code"]

    jr = await client.post("/api/sessions/join", json={
        "session_code": code, "player_name": "Hero",
    })
    char_id = jr.json()["character_id"]
    await client.patch(f"/api/characters/{char_id}", json={
        "current_hp": 50,
        "max_hp": 50,
        "dexterity": 0,
    })

    mr = await client.post(f"/api/builder-v2/sessions/{code}/maps", json={"name": "M"})
    map_id = mr.json()["id"]
    lr = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 10, "rows": 10})
    loc_id = lr.json()["id"]

    tr = await client.post(f"/api/builder-v2/locations/{loc_id}/traps", json={
        "col": 3, "row": 3, "name": "Dart",
        "damage_dice": "1d6",
        "undodgeable": False,
        "charges": 1,
    })
    trap_id = tr.json()["id"]

    await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
        "location_id": loc_id, "col": 2, "row": 2,
    })
    await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
        "col": 3, "row": 3,
    })

    res = await client.post(f"/api/builder-v2/traps/{trap_id}/dodge", json={
        "character_id": char_id,
        "force_hit": True,
    })
    assert res.status_code == 200
    assert res.json()["missed"] is False
    assert res.json()["damage"] > 0
    assert res.json()["new_hp"] < 50


@pytest.mark.asyncio
async def test_chest_lockpick(client):
    """Chest lockpick endpoint unlocks on success."""
    sr = await client.post("/api/sessions/create", json={"name": "T"})
    code = sr.json()["session_code"]

    jr = await client.post("/api/sessions/join", json={
        "session_code": code, "player_name": "Hero",
    })
    char_id = jr.json()["character_id"]

    mr = await client.post(f"/api/builder-v2/sessions/{code}/maps", json={"name": "M"})
    map_id = mr.json()["id"]
    lr = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 10, "rows": 10})
    loc_id = lr.json()["id"]

    # Create locked chest
    cr = await client.post(f"/api/builder-v2/locations/{loc_id}/chests", json={
        "col": 2, "row": 2, "name": "Locked Chest",
        "is_locked": True,
        "lock_dc": 5,
    })
    chest_id = cr.json()["id"]
    assert cr.json()["is_locked"] is True

    # Pick lock
    pr = await client.post(f"/api/builder-v2/chests/{chest_id}/pick-lock", json={
        "character_id": char_id,
    })
    assert pr.status_code == 200
    # Lockpick may succeed or fail depending on roll; just check response shape
    assert "success" in pr.json()
    assert "is_locked" in pr.json()


@pytest.mark.asyncio
async def test_portal_size_cells(client):
    """Portal CRUD supports size_cells."""
    sr = await client.post("/api/sessions/create", json={"name": "T"})
    code = sr.json()["session_code"]

    mr = await client.post(f"/api/builder-v2/sessions/{code}/maps", json={"name": "M"})
    map_id = mr.json()["id"]
    lr = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 10, "rows": 10})
    loc_id = lr.json()["id"]

    pr = await client.post(f"/api/builder-v2/locations/{loc_id}/portals", json={
        "col": 1, "row": 1, "name": "Big Portal",
        "size_cells": 3,
    })
    assert pr.status_code == 200
    assert pr.json()["size_cells"] == 3

    portal_id = pr.json()["id"]
    ur = await client.patch(f"/api/builder-v2/portals/{portal_id}", json={
        "size_cells": 2,
    })
    assert ur.status_code == 200
    assert ur.json()["size_cells"] == 2


@pytest.mark.asyncio
async def test_portal_use_moves_character_to_target_location(client):
    sr = await client.post("/api/sessions/create", json={"name": "T"})
    code = sr.json()["session_code"]

    jr = await client.post("/api/sessions/join", json={
        "session_code": code, "player_name": "Hero",
    })
    char_id = jr.json()["character_id"]

    mr = await client.post(f"/api/builder-v2/sessions/{code}/maps", json={"name": "M"})
    map_id = mr.json()["id"]
    lr1 = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"name": "A", "cols": 10, "rows": 10})
    lr2 = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"name": "B", "cols": 8, "rows": 8})
    loc_a = lr1.json()["id"]
    loc_b = lr2.json()["id"]

    pr = await client.post(f"/api/builder-v2/locations/{loc_a}/portals", json={
        "col": 1,
        "row": 1,
        "target_location_id": loc_b,
        "target_col": 3,
        "target_row": 4,
    })
    portal_id = pr.json()["id"]

    await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
        "location_id": loc_a,
        "col": 1,
        "row": 1,
    })

    res = await client.post(f"/api/builder-v2/portals/{portal_id}/use", json={
        "character_id": char_id,
    })
    assert res.status_code == 200
    assert res.json()["location_id"] == loc_b
    assert res.json()["col"] == 3
    assert res.json()["row"] == 4

    char = await client.get(f"/api/characters/{char_id}")
    assert char.json()["current_location_id"] == loc_b
    assert char.json()["col"] == 3
    assert char.json()["row"] == 4


@pytest.mark.asyncio
async def test_trap_disarm_marks_trap_disarmed(client):
    sr = await client.post("/api/sessions/create", json={"name": "T"})
    code = sr.json()["session_code"]

    jr = await client.post("/api/sessions/join", json={
        "session_code": code, "player_name": "Hero",
    })
    char_id = jr.json()["character_id"]

    mr = await client.post(f"/api/builder-v2/sessions/{code}/maps", json={"name": "M"})
    map_id = mr.json()["id"]
    lr = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 10, "rows": 10})
    loc_id = lr.json()["id"]

    tr = await client.post(f"/api/builder-v2/locations/{loc_id}/traps", json={
        "col": 2,
        "row": 2,
        "name": "Wire",
        "damage_dice": "1d4",
        "dc_disarm": 1,
    })
    trap_id = tr.json()["id"]

    res = await client.post(f"/api/builder-v2/traps/{trap_id}/disarm", json={
        "character_id": char_id,
    })
    assert res.status_code == 200
    assert res.json()["success"] is True
    assert res.json()["is_disarmed"] is True

    trap = await client.get(f"/api/builder-v2/traps/{trap_id}")
    assert trap.json()["is_disarmed"] is True


@pytest.mark.asyncio
async def test_player_map_hides_interior_objects_until_zone_entered(client):
    sr = await client.post("/api/sessions/create", json={"name": "T"})
    code = sr.json()["session_code"]

    jr = await client.post("/api/sessions/join", json={
        "session_code": code, "player_name": "Hero",
    })
    char_id = jr.json()["character_id"]

    mr = await client.post(f"/api/builder-v2/sessions/{code}/maps", json={"name": "M"})
    map_id = mr.json()["id"]
    lr = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 8, "rows": 8})
    loc_id = lr.json()["id"]

    await client.post(f"/api/builder-v2/locations/{loc_id}/interiors", json={
        "name": "House",
        "kind": "building",
        "reveal_mode": "on_enter",
        "cells": [
            {"col": 2, "row": 2},
            {"col": 3, "row": 2},
            {"col": 2, "row": 3},
            {"col": 3, "row": 3},
        ],
    })
    chest = await client.post(f"/api/builder-v2/locations/{loc_id}/chests", json={
        "col": 2,
        "row": 2,
        "name": "House Chest",
    })
    trap = await client.post(f"/api/builder-v2/locations/{loc_id}/traps", json={
        "col": 3,
        "row": 3,
        "name": "House Trap",
        "damage_dice": "1d4",
    })
    portal = await client.post(f"/api/builder-v2/locations/{loc_id}/portals", json={
        "col": 3,
        "row": 2,
        "name": "House Portal",
        "target_location_id": loc_id,
    })
    await client.post(f"/api/builder-v2/maps/{map_id}/activate", json={})
    await client.post(f"/api/builder-v2/locations/{loc_id}/activate", json={})

    await client.patch(f"/api/characters/{char_id}", json={
        "current_location_id": loc_id,
        "col": 0,
        "row": 0,
    })
    outside = (await client.get(f"/api/map/{code}?character_id={char_id}")).json()
    assert chest.json()["id"] not in [c["id"] for c in outside["_mapChests"]]
    assert trap.json()["id"] not in [t["id"] for t in outside["_traps"]]
    assert portal.json()["id"] not in [p["id"] for p in outside["_portals"]]

    gm_state = (await client.get(f"/api/map/{code}")).json()
    assert chest.json()["id"] in [c["id"] for c in gm_state["_mapChests"]]
    assert trap.json()["id"] in [t["id"] for t in gm_state["_traps"]]
    assert portal.json()["id"] in [p["id"] for p in gm_state["_portals"]]

    await client.patch(f"/api/characters/{char_id}", json={
        "current_location_id": loc_id,
        "col": 2,
        "row": 2,
    })
    inside = (await client.get(f"/api/map/{code}?character_id={char_id}")).json()
    assert chest.json()["id"] in [c["id"] for c in inside["_mapChests"]]
    assert trap.json()["id"] in [t["id"] for t in inside["_traps"]]
    assert portal.json()["id"] in [p["id"] for p in inside["_portals"]]


@pytest.mark.asyncio
async def test_npc_spawn_trigger_zone_size(client):
    """NPC spawn CRUD supports trigger_zone_size."""
    sr = await client.post("/api/sessions/create", json={"name": "T"})
    code = sr.json()["session_code"]

    mr = await client.post(f"/api/builder-v2/sessions/{code}/maps", json={"name": "M"})
    map_id = mr.json()["id"]
    lr = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 10, "rows": 10})
    loc_id = lr.json()["id"]

    nr = await client.post(f"/api/builder-v2/locations/{loc_id}/npc-spawns", json={
        "col": 1, "row": 1, "name": "Ambush",
        "npc_template_id": 1,
        "trigger_zone_size": 2,
    })
    assert nr.status_code == 200
    assert nr.json()["trigger_zone_size"] == 2

    spawn_id = nr.json()["id"]
    ur = await client.patch(f"/api/builder-v2/npc-spawns/{spawn_id}", json={
        "trigger_zone_size": 3,
    })
    assert ur.status_code == 200
    assert ur.json()["trigger_zone_size"] == 3
