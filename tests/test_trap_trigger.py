import json
import random
from unittest.mock import patch

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
async def test_trap_triggers_and_deals_damage(client):
    """Undodgeable trap with charges=2 triggers twice then disarms."""
    # Create session
    sr = await client.post("/api/sessions/create", json={"name": "T"})
    code = sr.json()["session_code"]

    # Join player
    jr = await client.post("/api/sessions/join", json={
        "session_code": code, "player_name": "Hero",
    })
    char_id = jr.json()["character_id"]

    # Set HP baseline
    await client.patch(f"/api/characters/{char_id}", json={"current_hp": 50, "max_hp": 50})

    # Create bv2 map + location + trap
    mr = await client.post(f"/api/builder-v2/sessions/{code}/maps", json={"name": "M"})
    map_id = mr.json()["id"]
    lr = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 10, "rows": 10})
    loc_id = lr.json()["id"]

    # Create trap entity at (3,3)
    tr = await client.post(f"/api/builder-v2/locations/{loc_id}/traps", json={
        "col": 3, "row": 3, "name": "Spike Pit",
        "damage_dice": "1d4",
        "damage_type": "piercing",
        "undodgeable": True,
        "charges": 2,
        "is_armed": True,
    })
    assert tr.status_code == 200
    trap_id = tr.json()["id"]

    # Place character first (placement — no trap trigger)
    await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
        "location_id": loc_id, "col": 2, "row": 2,
    })

    # Step 1: move character to (3,3)
    await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
        "col": 3, "row": 3,
    })

    # Assert HP decreased
    char1 = await client.get(f"/api/characters/{char_id}")
    hp1 = char1.json()["current_hp"]
    assert hp1 < 50

    # Step 2: move away and back
    await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
        "col": 4, "row": 3,
    })
    await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
        "col": 3, "row": 3,
    })

    char2 = await client.get(f"/api/characters/{char_id}")
    hp2 = char2.json()["current_hp"]
    assert hp2 < hp1

    # Step 3: charges exhausted → no more damage
    await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
        "col": 4, "row": 3,
    })
    await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
        "col": 3, "row": 3,
    })

    char3 = await client.get(f"/api/characters/{char_id}")
    hp3 = char3.json()["current_hp"]
    assert hp3 == hp2  # unchanged

    # Verify trap is disarmed
    trap_r = await client.get(f"/api/builder-v2/traps/{trap_id}")
    trap_data = trap_r.json()
    assert trap_data["is_armed"] is False
    assert trap_data["charges_used"] == 2


@pytest.mark.asyncio
async def test_trap_misses_on_low_roll(client):
    """Dodgeable trap with high AC character misses on low roll."""
    sr = await client.post("/api/sessions/create", json={"name": "T"})
    code = sr.json()["session_code"]

    jr = await client.post("/api/sessions/join", json={
        "session_code": code, "player_name": "Hero",
    })
    char_id = jr.json()["character_id"]

    await client.patch(f"/api/characters/{char_id}", json={"current_hp": 50, "max_hp": 50, "armor_class": 20})

    mr = await client.post(f"/api/builder-v2/sessions/{code}/maps", json={"name": "M"})
    map_id = mr.json()["id"]
    lr = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 10, "rows": 10})
    loc_id = lr.json()["id"]

    await client.post(f"/api/builder-v2/locations/{loc_id}/traps", json={
        "col": 3, "row": 3, "name": "Dart",
        "damage_dice": "1d6",
        "undodgeable": False,
        "attack_bonus": 0,
        "charges": -1,
    })

    with patch('app.routers.builder_v2.traps.random.randint', return_value=1):
        await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
            "location_id": loc_id, "col": 3, "row": 3,
        })

    char = await client.get(f"/api/characters/{char_id}")
    assert char.json()["current_hp"] == 50  # unchanged
