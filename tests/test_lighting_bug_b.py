"""BV2Light with null bright_radius must not crash the API."""
import pytest
import uuid
from httpx import ASGITransport, AsyncClient
from main import app
from app.database import init_db


@pytest.mark.asyncio
async def test_light_with_null_bright_radius_serializes_cleanly():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as ac:
        code = "LT" + uuid.uuid4().hex[:6].upper()
        sr = await ac.post("/api/sessions/create",
                           json={"name": "T", "code": code})
        code = sr.json()["session_code"]
        mr = await ac.post(f"/api/builder-v2/sessions/{code}/maps",
                           json={"name": "M"})
        map_id = mr.json()["id"]
        lr = await ac.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"name": "L", "cols": 10, "rows": 10,
                                 "ambient_light": 0.0})
        loc_id = lr.json()["id"]

        # Create light WITHOUT bright_radius_cells
        r = await ac.post(f"/api/builder-v2/locations/{loc_id}/lights",
                          json={"col": 5, "row": 5, "radius_cells": 4,
                                "color_hex": "#ff8800", "intensity": 1.0,
                                "source_kind": "torch"})
        assert r.status_code == 200
        light = r.json()
        # bright_radius_cells must be a number (0.0), not null
        assert light["bright_radius_cells"] is not None, \
            "bright_radius_cells must never be null in API response"
        assert isinstance(light["bright_radius_cells"], (int, float))
