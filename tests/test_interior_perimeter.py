"""Interior zone perimeter wall auto-generation."""
import pytest
from httpx import ASGITransport, AsyncClient
from main import app
from app.database import init_db


@pytest.mark.asyncio
async def test_building_zone_creates_perimeter_walls():
    """Creating a building interior zone stamps wall tiles on its perimeter."""
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as ac:
        sr = await ac.post("/api/sessions/create", json={"name": "T"})
        code = sr.json()["session_code"]
        mr = await ac.post(f"/api/builder-v2/sessions/{code}/maps", json={"name": "M"})
        map_id = mr.json()["id"]
        lr = await ac.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"name": "L", "cols": 10, "rows": 10})
        loc_id = lr.json()["id"]

        # Create a 2x2 building zone at (3,3)-(4,4)
        r = await ac.post(f"/api/builder-v2/locations/{loc_id}/interiors", json={
            "name": "House",
            "kind": "building",
            "cells": [
                {"col": 3, "row": 3},
                {"col": 4, "row": 3},
                {"col": 3, "row": 4},
                {"col": 4, "row": 4},
            ],
        })
        assert r.status_code == 200

        # List tiles — perimeter should have walls
        tiles_r = await ac.get(f"/api/builder-v2/locations/{loc_id}/tiles")
        tiles = tiles_r.json()
        tile_map = {(t["col"], t["row"]): t for t in tiles}

        # Walls are stamped OUTSIDE the zone, not on zone cells
        # For 2x2 zone at (3,3)-(4,4), outside neighbours include (3,2), (4,2), etc.
        assert tile_map.get((3, 2), {}).get("tile_type") == "wall", \
            f"Expected wall at (3,2), got {tile_map.get((3,2))}"
        assert tile_map.get((2, 3), {}).get("tile_type") == "wall", \
            f"Expected wall at (2,3), got {tile_map.get((2,3))}"
        # Zone cells themselves should NOT be walls
        assert tile_map.get((3, 3), {}).get("tile_type") != "wall", \
            f"Zone cell (3,3) should not be wall, got {tile_map.get((3,3))}"


@pytest.mark.asyncio
async def test_non_building_zone_does_not_create_walls():
    """Non-building zones do NOT stamp wall tiles."""
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as ac:
        sr = await ac.post("/api/sessions/create", json={"name": "T"})
        code = sr.json()["session_code"]
        mr = await ac.post(f"/api/builder-v2/sessions/{code}/maps", json={"name": "M"})
        map_id = mr.json()["id"]
        lr = await ac.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"name": "L", "cols": 10, "rows": 10})
        loc_id = lr.json()["id"]

        r = await ac.post(f"/api/builder-v2/locations/{loc_id}/interiors", json={
            "name": "Garden",
            "kind": "garden",
            "cells": [
                {"col": 1, "row": 1},
                {"col": 2, "row": 1},
            ],
        })
        assert r.status_code == 200

        tiles_r = await ac.get(f"/api/builder-v2/locations/{loc_id}/tiles")
        tiles = tiles_r.json()
        assert len(tiles) == 0, "Non-building zone should not create wall tiles"
