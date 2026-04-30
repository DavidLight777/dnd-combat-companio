"""Token animation: after API move, token interpolates smoothly instead of freezing."""
import requests
from playwright.sync_api import Page


def test_token_interpolates_after_move(seeded_session, gm_page: Page, player_page: Page):
    """When a token moves via API, the player canvas shows smooth interpolation."""
    url = seeded_session["url"]
    code = seeded_session["session_code"]

    # ── Setup map ──
    r = requests.post(f"{url}/api/builder-v2/sessions/{code}/maps", json={"name": "AnimTest"})
    r.raise_for_status()
    map_id = r.json()["id"]

    r = requests.post(
        f"{url}/api/builder-v2/maps/{map_id}/locations",
        json={"name": "Room", "cols": 10, "rows": 10, "ambient_light": 1.0}
    )
    r.raise_for_status()
    loc_id = r.json()["id"]
    requests.post(f"{url}/api/builder-v2/locations/{loc_id}/activate")

    # ── Place player token at (1,1) ──
    player_char_id = player_page.evaluate("() => sessionStorage.getItem('character_id')")
    requests.patch(
        f"{url}/api/characters/{player_char_id}",
        json={"current_location_id": loc_id, "sight_range_cells": 8}
    )
    requests.patch(
        f"{url}/api/map/token/{player_char_id}",
        json={"x": 0.15, "y": 0.15}  # col 1, row 1
    )

    # Reload player page
    player_page.goto(f"{url}/player")
    player_page.wait_for_timeout(2000)

    # ── Move token via API to (8,8) ──
    requests.patch(
        f"{url}/api/map/token/{player_char_id}",
        json={"x": 0.85, "y": 0.85}  # col 8, row 8
    )

    # Poll token position aggressively to catch interpolation in progress.
    # Animation duration is 200ms — sample every ~40ms starting immediately.
    readings = []
    for _ in range(8):
        pos = player_page.evaluate("""() => {
          const mc = playerMainGrid;
          const own = (mc.tokens || []).find(t => t.character_id === mc.ownCharacterId);
          return own ? { x: own.x, y: own.y } : null;
        }""")
        readings.append(pos)
        player_page.wait_for_timeout(40)

    # Token must move from start (0.15) toward target (0.85).
    # At least one reading must be strictly between 0.15 and 0.85.
    xs = [r["x"] for r in readings if r]
    between = [x for x in xs if 0.15 < x < 0.85]
    assert len(between) > 0, (
        f"Token never interpolated: xs={xs}"
    )
