"""Floor tiles must not block movement — regression for phantom wall bug."""
import pytest
import uuid
from httpx import ASGITransport, AsyncClient
from main import app
from app.database import init_db


@pytest.mark.asyncio
async def test_floor_tile_does_not_block_movement():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as ac:
        # Create session + map + location
        code = "MV" + uuid.uuid4().hex[:6].upper()
        sr = await ac.post("/api/sessions/create",
                           json={"name": "T", "code": code})
        code = sr.json()["session_code"]
        mr = await ac.post(f"/api/builder-v2/sessions/{code}/maps",
                           json={"name": "M"})
        map_id = mr.json()["id"]
        lr = await ac.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"name": "L", "cols": 5, "rows": 5})
        loc_id = lr.json()["id"]

        # Paint a floor tile
        await ac.put(f"/api/builder-v2/locations/{loc_id}/tiles",
                     json={"tiles": [{"col": 2, "row": 2, "tile_type": "floor"}]})

        # Fetch it back — must have blocks_movement=False
        r = await ac.get(f"/api/builder-v2/locations/{loc_id}")
        tiles = r.json()["tiles"]
        floor_tile = next((t for t in tiles if t["col"] == 2 and t["row"] == 2), None)
        assert floor_tile is not None
        assert floor_tile["blocks_movement"] is False, \
            f"Floor tile blocks movement! Got: {floor_tile}"

@pytest.mark.asyncio
async def test_wall_tile_blocks_movement():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as ac:
        code = "MV" + uuid.uuid4().hex[:6].upper()
        sr = await ac.post("/api/sessions/create",
                           json={"name": "T", "code": code})
        code = sr.json()["session_code"]
        mr = await ac.post(f"/api/builder-v2/sessions/{code}/maps",
                           json={"name": "M"})
        map_id = mr.json()["id"]
        lr = await ac.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"name": "L", "cols": 5, "rows": 5})
        loc_id = lr.json()["id"]

        await ac.put(f"/api/builder-v2/locations/{loc_id}/tiles",
                     json={"tiles": [{"col": 1, "row": 1, "tile_type": "wall"}]})

        r = await ac.get(f"/api/builder-v2/locations/{loc_id}")
        tiles = r.json()["tiles"]
        wall_tile = next((t for t in tiles if t["col"] == 1 and t["row"] == 1), None)
        assert wall_tile is not None
        assert wall_tile["blocks_movement"] is True, \
            f"Wall tile should block movement! Got: {wall_tile}"
