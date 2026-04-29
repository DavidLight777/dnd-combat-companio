"""Phase 13 REDO R2 — unit tests for bright_radius_cells.

- Model migration adds column with default 0.
- POST / PATCH accept and echo back bright_radius_cells.
- _build_state_from_bv2 resolves the auto default (0 → radius/2).
"""

import pytest


@pytest.mark.asyncio
async def test_create_light_with_bright_radius(client, session_code):
    """POST /locations/{id}/lights accepts bright_radius_cells."""
    map_id = (await client.post(
        f"/api/builder-v2/sessions/{session_code}/maps",
        json={"name": "M"})).json()["id"]
    loc_id = (await client.post(
        f"/api/builder-v2/maps/{map_id}/locations",
        json={"cols": 8, "rows": 8})).json()["id"]

    resp = await client.post(
        f"/api/builder-v2/locations/{loc_id}/lights",
        json={"col": 2, "row": 2, "radius_cells": 6, "bright_radius_cells": 2.5}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["bright_radius_cells"] == 2.5


@pytest.mark.asyncio
async def test_create_light_auto_bright_radius(client, session_code):
    """When bright_radius_cells is omitted, ser_light returns radius/2."""
    map_id = (await client.post(
        f"/api/builder-v2/sessions/{session_code}/maps",
        json={"name": "M"})).json()["id"]
    loc_id = (await client.post(
        f"/api/builder-v2/maps/{map_id}/locations",
        json={"cols": 8, "rows": 8})).json()["id"]

    resp = await client.post(
        f"/api/builder-v2/locations/{loc_id}/lights",
        json={"col": 2, "row": 2, "radius_cells": 8}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["bright_radius_cells"] == 4.0  # auto = radius * 0.5


@pytest.mark.asyncio
async def test_patch_light_bright_radius(client, session_code):
    """PATCH /lights/{id} updates bright_radius_cells and clamps to radius."""
    map_id = (await client.post(
        f"/api/builder-v2/sessions/{session_code}/maps",
        json={"name": "M"})).json()["id"]
    loc_id = (await client.post(
        f"/api/builder-v2/maps/{map_id}/locations",
        json={"cols": 8, "rows": 8})).json()["id"]

    create = await client.post(
        f"/api/builder-v2/locations/{loc_id}/lights",
        json={"col": 2, "row": 2, "radius_cells": 6}
    )
    light_id = create.json()["id"]

    # Update bright radius
    resp = await client.patch(
        f"/api/builder-v2/lights/{light_id}",
        json={"bright_radius_cells": 1.5}
    )
    assert resp.status_code == 200
    assert resp.json()["bright_radius_cells"] == 1.5

    # Clamp to radius (6) — try 10, should become 6
    resp = await client.patch(
        f"/api/builder-v2/lights/{light_id}",
        json={"bright_radius_cells": 100}
    )
    assert resp.status_code == 200
    assert resp.json()["bright_radius_cells"] == 6.0


@pytest.mark.asyncio
async def test_bridge_payload_resolves_auto_bright_radius(client, session_code):
    """_build_state_from_bv2 exposes bright_radius_cells resolved from auto."""
    map_id = (await client.post(
        f"/api/builder-v2/sessions/{session_code}/maps",
        json={"name": "M"})).json()["id"]
    loc_id = (await client.post(
        f"/api/builder-v2/maps/{map_id}/locations",
        json={"cols": 8, "rows": 8})).json()["id"]
    await client.post(f"/api/builder-v2/locations/{loc_id}/activate")

    await client.post(
        f"/api/builder-v2/locations/{loc_id}/lights",
        json={"col": 2, "row": 2, "radius_cells": 10}
    )

    state = (await client.get(f"/api/map/{session_code}")).json()
    lights = state.get("bv2_lights", [])
    assert len(lights) == 1
    assert lights[0]["bright_radius_cells"] == 5.0  # 10 * 0.5
