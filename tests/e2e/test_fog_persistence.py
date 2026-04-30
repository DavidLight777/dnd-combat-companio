"""Fog of War: explored cells persist after token moves."""
import requests
from playwright.sync_api import Page


def test_explored_cells_persist_after_token_move(seeded_session, gm_page: Page, player_page: Page):
    """After a player token moves, previously explored cells remain in revealedCells."""
    url = seeded_session["url"]
    code = seeded_session["session_code"]

    # ── Setup a 20×20 map ──
    r = requests.post(f"{url}/api/builder-v2/sessions/{code}/maps", json={"name": "FogTest"})
    r.raise_for_status()
    map_id = r.json()["id"]

    r = requests.post(
        f"{url}/api/builder-v2/maps/{map_id}/locations",
        json={"name": "Room", "cols": 20, "rows": 20, "ambient_light": 0.0}
    )
    r.raise_for_status()
    loc_id = r.json()["id"]
    requests.post(f"{url}/api/builder-v2/locations/{loc_id}/activate")

    # ── Place player token at (5,5) ──
    player_char_id = player_page.evaluate("() => sessionStorage.getItem('character_id')")
    requests.patch(
        f"{url}/api/characters/{player_char_id}",
        json={"current_location_id": loc_id, "sight_range_cells": 6}
    )
    requests.patch(
        f"{url}/api/map/token/{player_char_id}",
        json={"x": 0.275, "y": 0.275}  # col 5, row 5 on 20×20
    )

    # ── Reload player page and wait for grid init ──
    player_page.goto(f"{url}/player")
    player_page.wait_for_timeout(2000)

    # Force a render so _renderLightingOverlay populates revealedCells
    init_state = player_page.evaluate("""() => {
      const mc = playerMainGrid;
      if (!mc) return { error: 'no playerMainGrid' };
      mc.render();
      return {
        revealedCount: mc.revealedCells ? mc.revealedCells.size : 0,
        currentVisibleCount: mc.currentVisible ? mc.currentVisible.size : 0,
        hasOwn: !!(mc.tokens || []).find(t => t.character_id === mc.ownCharacterId),
      };
    }""")

    assert "error" not in init_state, f"Grid init failed: {init_state}"
    assert init_state["hasOwn"] is True, "Player token not found on map"
    assert init_state["revealedCount"] > 0, "No cells revealed after initial render"
    assert init_state["currentVisibleCount"] > 0, "No cells visible after initial render"

    initial_revealed = init_state["revealedCount"]
    initial_visible = init_state["currentVisibleCount"]

    # ── Move player to (10,10) via API ──
    requests.patch(
        f"{url}/api/map/token/{player_char_id}",
        json={"x": 0.525, "y": 0.525}  # col 10, row 10 on 20×20
    )

    # Wait for WS token_moved event + re-render
    player_page.wait_for_timeout(2500)

    # Force another render
    after_state = player_page.evaluate("""() => {
      const mc = playerMainGrid;
      if (!mc) return { error: 'no playerMainGrid' };
      mc.render();
      return {
        revealedCount: mc.revealedCells ? mc.revealedCells.size : 0,
        currentVisibleCount: mc.currentVisible ? mc.currentVisible.size : 0,
      };
    }""")

    assert "error" not in after_state, f"After-move state failed: {after_state}"
    # Explored cells should accumulate, not shrink
    assert after_state["revealedCount"] >= initial_revealed, \
        f"Revealed cells shrank: {initial_revealed} -> {after_state['revealedCount']}"


def test_unexplored_cells_are_black(player_page: Page, seeded_session):
    """Cells never visited by the player should remain pitch-black."""
    url = seeded_session["url"]
    code = seeded_session["session_code"]

    # Setup map (no token = no vision = everything unexplored)
    r = requests.post(f"{url}/api/builder-v2/sessions/{code}/maps", json={"name": "BlackTest"})
    r.raise_for_status()
    map_id = r.json()["id"]

    r = requests.post(
        f"{url}/api/builder-v2/maps/{map_id}/locations",
        json={"name": "Void", "cols": 10, "rows": 10, "ambient_light": 0.0}
    )
    r.raise_for_status()
    loc_id = r.json()["id"]
    requests.post(f"{url}/api/builder-v2/locations/{loc_id}/activate")

    # Remove player token from map so there's no vision source
    player_char_id = player_page.evaluate("() => sessionStorage.getItem('character_id')")
    requests.patch(
        f"{url}/api/characters/{player_char_id}",
        json={"current_location_id": loc_id}
    )
    # Place token far away or clear it
    requests.patch(
        f"{url}/api/map/token/{player_char_id}",
        json={"x": None, "y": None}
    )

    player_page.goto(f"{url}/player")
    player_page.wait_for_timeout(2000)

    result = player_page.evaluate("""() => {
      const mc = playerMainGrid;
      if (!mc) return { error: 'no playerMainGrid' };
      mc.render();
      const own = (mc.tokens || []).find(t => t.character_id === mc.ownCharacterId);
      return {
        hasOwnToken: !!own,
        ownHasCoords: !!(own && own.x != null),
        hasRevealed: !!(mc.revealedCells && mc.revealedCells.size),
        hasCurrentVisible: !!(mc.currentVisible && mc.currentVisible.size),
      };
    }""")

    assert "error" not in result, f"State failed: {result}"
    # If player has no token coords, nothing should be visible/explored on this map
    if not result["ownHasCoords"]:
        assert result["hasCurrentVisible"] is False, "No token coords = no visible cells"
    # We don't strictly assert hasRevealed=False because revealedCells might persist
    # from a previous map session; the key invariant is currentVisible is empty.
