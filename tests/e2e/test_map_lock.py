import re
import requests
from playwright.sync_api import Page, expect


def test_gm_locks_map_for_players(seeded_session, gm_page: Page, page: Page):
    """GM toggles map lock → player sees locked overlay via WS."""
    url = seeded_session["url"]
    code = seeded_session["session_code"]
    gm_token = seeded_session["gm_token"]

    # 1) Join as player via API to get token + char_id
    join_resp = requests.post(
        f"{url}/api/sessions/join",
        json={
            "session_code": code,
            "player_name": "Hero",
            "race_id": None,
            "age": 25,
            "gender": "Male",
        },
    )
    assert join_resp.status_code == 200
    join_data = join_resp.json()
    player_token = join_data["player_token"]
    character_id = join_data["character_id"]

    # 2) Open player app directly with pre-seeded auth (bypass wizard)
    player = page.context.new_page()
    player.goto(url + "/")
    player.evaluate(
        """
        (data) => {
            sessionStorage.setItem('session_code', data.code);
            sessionStorage.setItem('player_token', data.token);
            sessionStorage.setItem('character_id', data.char_id);
        }
        """,
        {"code": code, "token": player_token, "char_id": str(character_id)},
    )
    player.goto(f"{url}/player?code={code}")
    # Wait for WS to connect
    expect(player.locator("#ws-label")).to_have_text("connected", timeout=10000)

    # 3) GM opens map tab (just to ensure GM page is active)
    gm_page.click("[data-tab='map']")
    gm_page.wait_for_timeout(300)

    # 4) PATCH map_locked_for_players = True
    resp = requests.patch(
        f"{url}/api/sessions/{code}/settings",
        json={"gm_token": gm_token, "map_locked_for_players": True},
    )
    assert resp.status_code == 200, f"PATCH failed: {resp.text}"
    assert resp.json()["map_locked_for_players"] is True

    # 5) Player should receive WS broadcast
    player.wait_for_timeout(800)
    assert player.evaluate("() => window.__lastMapLockState") is True

    # Also verify the panel gets the class if it exists
    has_panel = player.evaluate("() => !!document.getElementById('player-grid-panel')")
    if has_panel:
        panel = player.locator("#player-grid-panel")
        expect(panel).to_have_class(re.compile(r"map-locked"))

    # 6) Unlock
    resp2 = requests.patch(
        f"{url}/api/sessions/{code}/settings",
        json={"gm_token": gm_token, "map_locked_for_players": False},
    )
    assert resp2.status_code == 200
    assert resp2.json()["map_locked_for_players"] is False

    # 7) State cleared
    player.wait_for_timeout(800)
    assert player.evaluate("() => window.__lastMapLockState") is False
