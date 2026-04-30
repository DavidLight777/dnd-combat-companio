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
