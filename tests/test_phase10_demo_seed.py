"""Phase 10 demo seed verification."""
import os
import sys

import pytest
from httpx import ASGITransport, AsyncClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app.database import init_db
from main import app
from scripts.seed_phase10_demo import seed_demo


@pytest.fixture
async def client():
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.mark.asyncio
async def test_phase10_demo_seed_creates_full_world(client):
    """Smoke: seed_demo produces 6 locations + buildings + lights + edges + portals."""
    sess_code = (
        await client.post(
            "/api/sessions/create",
            json={"gm_name": "Demo", "name": "Phase 10 Demo"},
        )
    ).json()["session_code"]

    ids = await seed_demo(client, sess_code)
    assert {"map_id", "center", "north", "east", "south", "west", "crypt"}.issubset(
        ids.keys()
    )

    # 6 locations
    locs = (
        await client.get(f"/api/builder-v2/maps/{ids['map_id']}/locations")
    ).json()
    assert len(locs) == 6

    # Center has 2 buildings (interior zones)
    zones = (
        await client.get(f"/api/builder-v2/locations/{ids['center']}/interiors")
    ).json()
    assert len(zones) == 2

    # Crypt has 3 rooms + 4 torches
    crypt_zones = (
        await client.get(f"/api/builder-v2/locations/{ids['crypt']}/interiors")
    ).json()
    assert len(crypt_zones) == 3
    crypt_lights = (
        await client.get(f"/api/builder-v2/locations/{ids['crypt']}/lights")
    ).json()
    assert len(crypt_lights) == 4

    # Edge symmetry
    for lid in (ids["center"], ids["north"], ids["east"], ids["south"], ids["west"]):
        edges = (
            await client.get(f"/api/builder-v2/locations/{lid}/edges")
        ).json()
        for e in edges:
            assert e["target_location_id"] is not None

    # Portals
    west_ents = (
        await client.get(f"/api/builder-v2/locations/{ids['west']}/entities")
    ).json()
    crypt_ents = (
        await client.get(f"/api/builder-v2/locations/{ids['crypt']}/entities")
    ).json()
    assert any(e["entity_type"] == "portal" for e in west_ents)
    assert any(e["entity_type"] == "portal" for e in crypt_ents)
