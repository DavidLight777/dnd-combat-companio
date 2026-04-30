"""Player vision: NPC behind wall is hidden from player."""
import requests
from playwright.sync_api import Page, expect


def test_npc_behind_wall_is_hidden(seeded_session, gm_page: Page, player_page: Page):
    """NPC on the other side of a wall must not be visible to the player."""
    url = seeded_session["url"]
    code = seeded_session["session_code"]

    # ── Setup map with a wall ──
    r = requests.post(f"{url}/api/builder-v2/sessions/{code}/maps", json={"name": "VisionTest"})
    r.raise_for_status()
    map_id = r.json()["id"]

    r = requests.post(
        f"{url}/api/builder-v2/maps/{map_id}/locations",
        json={"name": "Room", "cols": 10, "rows": 10, "ambient_light": 0.0}
    )
    r.raise_for_status()
    loc_id = r.json()["id"]

    # Wall tiles at (3,2) and (4,2) — horizontal barrier
    tiles = []
    for c in range(3, 5):
        tiles.append({"col": c, "row": 2, "tile_type": "wall"})
    r = requests.put(
        f"{url}/api/builder-v2/locations/{loc_id}/tiles",
        json={"tiles": tiles}
    )
    r.raise_for_status()

    # Activate location
    requests.post(f"{url}/api/builder-v2/locations/{loc_id}/activate")

    # ── Place player token at (2,2) ──
    player_char_id = player_page.evaluate("() => sessionStorage.getItem('character_id')")
    requests.patch(
        f"{url}/api/map/token/{player_char_id}",
        json={"x": 0.25, "y": 0.25}  # col 2, row 2 on 10x10 grid
    )
    # Also set character location
    requests.patch(
        f"{url}/api/characters/{player_char_id}",
        json={"current_location_id": loc_id, "sight_range_cells": 8}
    )

    # ── Create NPC and place at (5,2) — behind the wall ──
    r = requests.post(
        f"{url}/api/sessions/{code}/npc",
        json={
            "name": "Hidden Orc",
            "max_hp": 20,
        }
    )
    r.raise_for_status()
    npc_id = r.json()["id"]
    requests.patch(
        f"{url}/api/map/token/{npc_id}",
        json={"x": 0.55, "y": 0.25}  # col 5, row 2 on 10x10 grid
    )

    # ── Reload player page so it picks up the map ──
    player_page.goto(f"{url}/player")
    player_page.wait_for_timeout(1500)

    # ── Evaluate JS: check that NPC cell is NOT in currentVisible ──
    result = player_page.evaluate("""() => {
      const mc = playerMainGrid;
      if (!mc) return { error: 'no playerMainGrid' };
      if (!mc.currentVisible) return { error: 'no currentVisible' };

      // Player token should be at (2,2)
      const own = (mc.tokens || []).find(t => t.character_id === mc.ownCharacterId);
      const npc = (mc.tokens || []).find(t => t.is_npc);

      return {
        ownPos: own ? { x: own.x, y: own.y } : null,
        npcPos: npc ? { x: npc.x, y: npc.y } : null,
        hasCurrentVisible: !!mc.currentVisible,
        visibleCount: mc.currentVisible ? mc.currentVisible.size : 0,
        npcCellVisible: npc ? mc.currentVisible.has(`${Math.floor(npc.x * mc.mapWidth / mc.gridSize)},${Math.floor(npc.y * mc.mapHeight / mc.gridSize)}`) : null,
        ownCellVisible: own ? mc.currentVisible.has(`${Math.floor(own.x * mc.mapWidth / mc.gridSize)},${Math.floor(own.y * mc.mapHeight / mc.gridSize)}`) : null,
      };
    }""")

    assert "error" not in result, f"JS evaluation failed: {result}"
    assert result["ownPos"] is not None, "Player token not found on map"
    assert result["npcPos"] is not None, "NPC token not found on map"
    assert result["hasCurrentVisible"] is True, "currentVisible not computed"
    assert result["ownCellVisible"] is True, "Player should see their own cell"
    assert result["npcCellVisible"] is False, "NPC behind wall should NOT be visible"
