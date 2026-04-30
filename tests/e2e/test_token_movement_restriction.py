from playwright.sync_api import Page, expect
import requests


def test_token_movement_restriction(seeded_session, gm_page: Page, page: Page):
    """Player token drag respects movement_left during combat."""
    url = seeded_session["url"]
    code = seeded_session["session_code"]

    # 1) Join player via API
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

    # 2) Create bv2 map + location and move character there
    map_id = requests.post(
        f"{url}/api/builder-v2/sessions/{code}/maps", json={"name": "M"}
    ).json()["id"]
    loc_id = requests.post(
        f"{url}/api/builder-v2/maps/{map_id}/locations",
        json={"cols": 10, "rows": 10},
    ).json()["id"]
    requests.post(f"{url}/api/builder-v2/locations/{loc_id}/activate")
    requests.post(
        f"{url}/api/builder-v2/characters/{character_id}/move-grid",
        json={"location_id": loc_id, "col": 2, "row": 2},
    )

    # 3) Complete wizard so player page loads without modal overlay
    requests.post(f"{url}/api/wizard/{character_id}/stat-choice", json={"declined": False})
    requests.post(f"{url}/api/wizard/{character_id}/roll-feature", json={})
    requests.post(f"{url}/api/wizard/{character_id}/finalize", json={})

    # 4) Set movement budget: base_speed=5, used=3 → left=2
    patch_resp = requests.patch(
        f"{url}/api/characters/{character_id}",
        json={"base_speed_cells": 5, "movement_used_this_turn": 3.0},
    )
    assert patch_resp.status_code == 200

    # 5) Open player app with pre-seeded auth
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
    expect(player.locator("#ws-label")).to_have_text("connected", timeout=10000)

    # 6) Open map modal
    player.click("#btn-open-map")
    player.wait_for_timeout(800)

    # 7) Get canvas bounds and grid size
    canvas = player.locator("#player-grid-canvas")
    expect(canvas).to_be_visible()
    box = canvas.bounding_box()
    gs = player.evaluate("() => playerMainGrid ? playerMainGrid.gridSize : 50")

    # Token should be at col 2, row 2 → center = (2+0.5)*gs, (2+0.5)*gs
    start_x = box["x"] + (2 + 0.5) * gs
    start_y = box["y"] + (2 + 0.5) * gs

    # Try to drag 5 cells to the right → col 7 (distance 5, but only 2 left)
    end_x = box["x"] + (7 + 0.5) * gs
    end_y = start_y

    player.mouse.move(start_x, start_y)
    player.mouse.down()
    player.mouse.move(end_x, end_y, steps=10)
    player.wait_for_timeout(200)

    # 8) During drag real token must NOT move (ghost preview only)
    mid_drag_col = player.evaluate(
        """
        () => {
            const g = playerMainGrid;
            if (!g) return -1;
            const t = (g.tokens || []).find(t => t.character_id === CHAR_ID);
            if (!t) return -1;
            return Math.floor(t.x * g.mapWidth / g.gridSize);
        }
        """
    )
    assert mid_drag_col == 2, f"Real token must stay at col 2 during drag, got {mid_drag_col}"

    player.mouse.up()
    player.wait_for_timeout(600)

    # 9) Assert token snapped back to around col 2 after mouseup
    final_col = player.evaluate(
        """
        () => {
            const g = playerMainGrid;
            if (!g) return -1;
            const t = (g.tokens || []).find(t => t.character_id === CHAR_ID);
            if (!t) return -1;
            return Math.floor(t.x * g.mapWidth / g.gridSize);
        }
        """
    )
    assert final_col == 2, f"Token should snap back to col 2, got {final_col}"
