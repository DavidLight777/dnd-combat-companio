"""Verification tests for Riverside Village demo map seed."""
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from main import app
from app.database import init_db
from scripts.seed_demo_map import seed_demo


@pytest_asyncio.fixture(scope="module")
async def demo_client():
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture(scope="module")
async def seeded(demo_client):
    r = await demo_client.post(
        "/api/sessions/create",
        json={"name": "Demo Session", "code": "DEMO01"},
    )
    if r.status_code == 400 and "already exists" in r.text:
        pass
    else:
        assert r.status_code == 200, r.text

    result = await seed_demo(demo_client, "DEMO01")
    if result.get("skipped"):
        # map already existed from a prior run; fetch its id for assertions
        r = await demo_client.get("/api/builder-v2/sessions/DEMO01/maps")
        maps = r.json()
        for m in maps:
            if m["name"] == "Riverside Village":
                result["map_id"] = m["id"]
                break
    return result


@pytest.mark.asyncio
async def test_seed_script_is_idempotent(demo_client, seeded):
    result = await seed_demo(demo_client, "DEMO01")
    assert result.get("skipped") is True

    r = await demo_client.get("/api/builder-v2/sessions/DEMO01/maps")
    maps = r.json()
    rv_maps = [m for m in maps if m["name"] == "Riverside Village"]
    assert len(rv_maps) == 1


@pytest.mark.asyncio
async def test_all_5_locations_exist(demo_client, seeded):
    map_id = seeded["map_id"]
    r = await demo_client.get(f"/api/builder-v2/maps/{map_id}/locations")
    locs = r.json()
    names = {loc["name"] for loc in locs}
    assert names == {
        "Village Square", "Tavern", "Market",
        "Dungeon Entrance", "Underground Dungeon",
    }


@pytest.mark.asyncio
async def test_dungeon_is_fully_dark(demo_client, seeded):
    map_id = seeded["map_id"]
    r = await demo_client.get(f"/api/builder-v2/maps/{map_id}/locations")
    locs = r.json()
    dungeon = next((loc for loc in locs if loc["name"] == "Underground Dungeon"), None)
    assert dungeon is not None
    assert dungeon["ambient_light"] == 0.0


@pytest.mark.asyncio
async def test_boss_chest_has_4_items(demo_client, seeded):
    map_id = seeded["map_id"]
    r = await demo_client.get(f"/api/builder-v2/maps/{map_id}/locations")
    locs = r.json()
    dungeon = next((loc for loc in locs if loc["name"] == "Underground Dungeon"), None)
    assert dungeon is not None

    r = await demo_client.get(f"/api/builder-v2/locations/{dungeon['id']}")
    data = r.json()
    entities = data["entities"]
    chests = [e for e in entities if e["entity_type"] == "chest" and "Legendary" in e["name"]]
    assert len(chests) == 1
    assert len(chests[0]["items"]) == 4


@pytest.mark.asyncio
async def test_edges_connect_all_locations(demo_client, seeded):
    map_id = seeded["map_id"]
    r = await demo_client.get(f"/api/builder-v2/maps/{map_id}/locations")
    locations = r.json()
    loc_id_to_name = {loc["id"]: loc["name"] for loc in locations}
    all_names = set(loc_id_to_name.values())

    graph = {name: set() for name in all_names}
    for loc in locations:
        loc_id = loc["id"]
        r = await demo_client.get(f"/api/builder-v2/locations/{loc_id}/edges")
        edges = r.json()
        for e in edges:
            target_id = e.get("target_location_id")
            if target_id and target_id in loc_id_to_name:
                graph[loc_id_to_name[loc_id]].add(loc_id_to_name[target_id])

    start = "Village Square"
    visited = set()
    stack = [start]
    while stack:
        cur = stack.pop()
        if cur in visited:
            continue
        visited.add(cur)
        for nxt in graph.get(cur, []):
            if nxt not in visited and nxt in graph:
                stack.append(nxt)

    assert visited == all_names
