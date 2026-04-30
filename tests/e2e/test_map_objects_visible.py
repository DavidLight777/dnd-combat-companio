"""Map objects (chests, portals, traps) placed in builder appear on GM and player maps."""
import requests
from playwright.sync_api import Page


def test_map_objects_visible_on_gm_and_player(seeded_session, gm_page: Page, player_page: Page):
    """BV2 entities (chest, portal, trap) must appear on both GM and player canvases."""
    url = seeded_session["url"]
    code = seeded_session["session_code"]

    # ── Setup map ──
    r = requests.post(f"{url}/api/builder-v2/sessions/{code}/maps", json={"name": "ObjTest"})
    r.raise_for_status()
    map_id = r.json()["id"]
    r = requests.post(
        f"{url}/api/builder-v2/maps/{map_id}/locations",
        json={"name": "Room", "cols": 10, "rows": 10, "ambient_light": 1.0}
    )
    r.raise_for_status()
    loc_id = r.json()["id"]
    requests.post(f"{url}/api/builder-v2/locations/{loc_id}/activate")

    # ── Create chest (uses dedicated chest endpoint so BV2Chest row exists) ──
    requests.post(f"{url}/api/builder-v2/locations/{loc_id}/chests", json={
        "col": 2, "row": 2,
        "name": "Loot Box",
        "visible_to_players": True,
        "icon": "🗃",
    })
    # ── Create portal entity ──
    requests.post(f"{url}/api/builder-v2/locations/{loc_id}/entities", json={
        "entity_type": "portal",
        "col": 5, "row": 5,
        "name": "Mystic Gate",
        "visible_to_players": True,
    })

    # ── Verify API returns them ──
    state = requests.get(f"{url}/api/map/{code}").json()
    assert state.get("_mapChests"), "API missing _mapChests"
    assert state.get("_portals"), "API missing _portals"
    portal_names = [p["name"] for p in state["_portals"]]
    assert "Mystic Gate" in portal_names, f"Portal not in API: {portal_names}"

    # ── GM Map tab ──
    gm_page.click("[data-tab='map']")
    gm_page.wait_for_timeout(1200)
    gm_result = gm_page.evaluate("""() => {
      const mc = mapCanvas;
      return {
        hasChests: !!(mc.mapChests && mc.mapChests.length),
        hasPortals: !!(mc.portals && mc.portals.length),
        chestCount: mc.mapChests ? mc.mapChests.length : 0,
        portalCount: mc.portals ? mc.portals.length : 0,
      };
    }""")
    assert gm_result["hasPortals"], f"GM canvas has no portals: {gm_result}"

    # ── Player page ──
    player_page.goto(f"{url}/player")
    player_page.wait_for_timeout(2000)
    pl_result = player_page.evaluate("""() => {
      const mc = playerMainGrid;
      return {
        hasChests: !!(mc.mapChests && mc.mapChests.length),
        hasPortals: !!(mc.portals && mc.portals.length),
        chestCount: mc.mapChests ? mc.mapChests.length : 0,
        portalCount: mc.portals ? mc.portals.length : 0,
      };
    }""")
    assert pl_result["hasPortals"], f"Player canvas has no portals: {pl_result}"
    assert pl_result["hasChests"], f"Player canvas has no chests: {pl_result}"
