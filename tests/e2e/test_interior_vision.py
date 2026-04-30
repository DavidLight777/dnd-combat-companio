"""Interior zone blocks vision: player outside cannot see inside."""
import requests
from playwright.sync_api import Page


def test_interior_blocks_vision(seeded_session, gm_page: Page, player_page: Page):
    """A building interior zone hides its contents from outside vision."""
    url = seeded_session["url"]
    code = seeded_session["session_code"]

    # ── Setup 10×10 map ──
    r = requests.post(f"{url}/api/builder-v2/sessions/{code}/maps", json={"name": "IntTest"})
    r.raise_for_status()
    map_id = r.json()["id"]

    r = requests.post(
        f"{url}/api/builder-v2/maps/{map_id}/locations",
        json={"name": "Room", "cols": 10, "rows": 10, "ambient_light": 1.0}
    )
    r.raise_for_status()
    loc_id = r.json()["id"]
    requests.post(f"{url}/api/builder-v2/locations/{loc_id}/activate")

    # ── Create building interior zone 3×3 at (3,3)-(5,5) ──
    # This gives a true interior cell at (4,4) that is blocked by walls
    r = requests.post(f"{url}/api/builder-v2/locations/{loc_id}/interiors", json={
        "name": "House",
        "kind": "building",
        "cells": [
            {"col": 3, "row": 3}, {"col": 4, "row": 3}, {"col": 5, "row": 3},
            {"col": 3, "row": 4}, {"col": 4, "row": 4}, {"col": 5, "row": 4},
            {"col": 3, "row": 5}, {"col": 4, "row": 5}, {"col": 5, "row": 5},
        ],
    })
    r.raise_for_status()

    # ── Verify outside perimeter walls exist ──
    tiles_r = requests.get(f"{url}/api/builder-v2/locations/{loc_id}/tiles")
    tiles = tiles_r.json()
    tile_map = {(t["col"], t["row"]): t for t in tiles}
    # Wall should be outside the zone, e.g. at (3,2) — north of (3,3)
    assert tile_map.get((3, 2), {}).get("tile_type") == "wall", "Perimeter wall missing at (3,2)"

    # ── Place player at (3,0) directly north of the building ──
    player_char_id = player_page.evaluate("() => sessionStorage.getItem('character_id')")
    requests.patch(
        f"{url}/api/characters/{player_char_id}",
        json={"current_location_id": loc_id, "sight_range_cells": 8}
    )
    requests.patch(
        f"{url}/api/map/token/{player_char_id}",
        json={"x": 0.35, "y": 0.05}  # col 3, row 0
    )

    # Reload player page
    player_page.goto(f"{url}/player")
    player_page.wait_for_timeout(2000)

    # ── Evaluate: cells directly behind the north wall should NOT be visible ──
    result = player_page.evaluate("""() => {
      const mc = playerMainGrid;
      if (!mc) return { error: 'no playerMainGrid' };
      mc.render();
      return {
        hasCurrentVisible: !!(mc.currentVisible && mc.currentVisible.size),
        cell33Visible: mc.currentVisible ? mc.currentVisible.has('3,3') : null,
        cell43Visible: mc.currentVisible ? mc.currentVisible.has('4,3') : null,
        cell53Visible: mc.currentVisible ? mc.currentVisible.has('5,3') : null,
        visibleCount: mc.currentVisible ? mc.currentVisible.size : 0,
      };
    }""")

    assert "error" not in result, f"JS failed: {result}"
    assert result["hasCurrentVisible"] is True, "No visible cells computed"
    # At least one cell directly behind the north wall should be blocked
    behind_wall_blocked = (
        not result["cell33Visible"] or
        not result["cell43Visible"] or
        not result["cell53Visible"]
    )
    assert behind_wall_blocked, (
        f"Expected at least one cell behind north wall to be blocked, "
        f"got 33={result['cell33Visible']} 43={result['cell43Visible']} 53={result['cell53Visible']}"
    )
