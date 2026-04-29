import os
import sys

import pytest_asyncio
from httpx import ASGITransport, AsyncClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from app.database import init_db
from main import app


@pytest_asyncio.fixture
async def client():
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def session_code(client):
    r = await client.post("/api/sessions/create", json={"gm_name": "TestGM", "name": "Test"})
    assert r.status_code == 200, r.text
    return r.json()["session_code"]
