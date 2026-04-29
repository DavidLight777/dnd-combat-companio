"""Stepping on an edge cell must teleport the character to the target location."""
import pytest
import uuid
from httpx import ASGITransport, AsyncClient
from main import app
from app.database import init_db


@pytest.mark.asyncio
async def test_player_transitions_through_edge():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as ac:
        # Create session, map, two locations
        code = "ET" + uuid.uuid4().hex[:6].upper()
        sr = await ac.post("/api/sessions/create",
                           json={"name": "T", "code": code})
        code = sr.json()["session_code"]
        mr = await ac.post(f"/api/builder-v2/sessions/{code}/maps",
                           json={"name": "M"})
        map_id = mr.json()["id"]
        loc_a = (await ac.post(f"/api/builder-v2/maps/{map_id}/locations",
                               json={"name": "A", "cols": 10, "rows": 10})).json()["id"]
        loc_b = (await ac.post(f"/api/builder-v2/maps/{map_id}/locations",
                               json={"name": "B", "cols": 10, "rows": 10})).json()["id"]

        # Create edge: east side of A row 5 → B entry (0, 5)
        await ac.post(f"/api/builder-v2/locations/{loc_a}/edges",
                      json={"side": "east", "range_start": 4, "range_end": 6,
                            "target_location_id": loc_b,
                            "target_entry_col": 0, "target_entry_row": 5})

        # Create a character in loc_a
        join = await ac.post("/api/sessions/join",
                             json={"session_code": code, "player_name": "Hero"})
        char_id = join.json()["character_id"]

        # First placement (explicit location_id = placement call)
        r = await ac.post(f"/api/builder-v2/characters/{char_id}/move-grid",
                          json={"location_id": loc_a, "col": 8, "row": 5})
        assert r.status_code == 200

        # Now move onto the edge cell (no location_id = not placement)
        r = await ac.post(f"/api/builder-v2/characters/{char_id}/move-grid",
                          json={"col": 9, "row": 5})
        assert r.status_code == 200

        # Verify character is now in loc_b
        r = await ac.get(f"/api/sessions/{code}/characters")
        hero = next(c for c in r.json() if c["id"] == char_id)
        assert hero["bv2_location_id"] == loc_b, \
            f"Character should have transitioned to loc_b, got {hero['bv2_location_id']}"
        assert hero["bv2_col"] == 0
        assert hero["bv2_row"] == 5
