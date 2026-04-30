"""PATCH /locations/{id} обновляет ambient_light."""
import pytest
import uuid
from httpx import ASGITransport, AsyncClient
from main import app
from app.database import init_db


@pytest.mark.asyncio
async def test_patch_location_ambient_light():
    """PATCH /locations/{id} обновляет ambient_light."""
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as ac:
        code = "AM" + uuid.uuid4().hex[:6].upper()
        sr = await ac.post("/api/sessions/create",
                           json={"name": "T", "code": code})
        code = sr.json()["session_code"]
        mr = await ac.post(f"/api/builder-v2/sessions/{code}/maps",
                           json={"name": "M"})
        map_id = mr.json()["id"]
        lr = await ac.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"name": "L", "cols": 10, "rows": 10,
                                 "ambient_light": 1.0})
        loc_id = lr.json()["id"]

        r = await ac.patch(f"/api/builder-v2/locations/{loc_id}",
                           json={"ambient_light": 0.2})
        assert r.status_code == 200
        assert abs(r.json()["ambient_light"] - 0.2) < 0.01

        # Verify persisted
        r2 = await ac.get(f"/api/builder-v2/locations/{loc_id}")
        assert abs(r2.json()["location"]["ambient_light"] - 0.2) < 0.01
