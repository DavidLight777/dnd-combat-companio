# Phase 17 Round 4 — Token Movement Restriction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict player token drag movement to `movement_left` cells (Chebyshev distance) during combat; GM is never restricted.

**Architecture:** Track drag start position in `events.js`, compute Chebyshev distance on drop, reject if over budget with snap-back + toast. Toast UI lives in `token-anim.js`.

**Tech Stack:** Vanilla JS (Canvas2D), Playwright E2E tests.

---

### Task 1: Track drag start position in events.js

**Files:**
- Modify: `static/js/map-canvas/events.js`
- Modify: `static/js/map-canvas/token-anim.js`
- Test: `tests/e2e/test_token_movement_restriction.py`

- [ ] **Step 1: Write the failing E2E test**

```python
from playwright.sync_api import Page, expect
import requests


def test_token_movement_restriction(seeded_session, gm_page: Page, page: Page):
    """Player token drag respects movement_left during combat."""
    url = seeded_session["url"]
    code = seeded_session["session_code"]
    gm_token = seeded_session["gm_token"]

    # Join player via API
    join_resp = requests.post(
        f"{url}/api/sessions/join",
        json={"session_code": code, "player_name": "Hero",
              "race_id": None, "age": 25, "gender": "Male"},
    )
    assert join_resp.status_code == 200
    join_data = join_resp.json()
    player_token = join_data["player_token"]
    character_id = join_data["character_id"]

    # Open player app with pre-seeded auth
    player = page.context.new_page()
    player.goto(url + "/")
    player.evaluate("""
        (data) => {
            sessionStorage.setItem('session_code', data.code);
            sessionStorage.setItem('player_token', data.token);
            sessionStorage.setItem('character_id', data.char_id);
        }
    """, {"code": code, "token": player_token, "char_id": str(character_id)})
    player.goto(f"{url}/player?code={code}")
    expect(player.locator("#ws-label")).to_have_text("connected", timeout=10000)

    # GM places token on map via API (bv2 location required)
    map_resp = requests.post(
        f"{url}/api/builder-v2/sessions/{code}/maps", json={"name": "M"},
        headers={"Authorization": f"Bearer {gm_token}"} if False else None
    )
    # Actually gm_token is not an auth header, it's in body for some endpoints.
    # Use API directly: POST /api/builder-v2/sessions/{code}/maps doesn't need gm_token in header.
    map_id = requests.post(f"{url}/api/builder-v2/sessions/{code}/maps", json={"name": "M"}).json()["id"]
    loc_id = requests.post(f"{url}/api/builder-v2/maps/{map_id}/locations", json={"cols": 10, "rows": 10}).json()["id"]
    requests.post(f"{url}/api/builder-v2/locations/{loc_id}/activate")
    # Move character to location
    requests.post(f"{url}/api/builder-v2/characters/{character_id}/move-grid", json={"location_id": loc_id, "col": 2, "row": 2})

    # Set movement_left = 2 (combat mode)
    requests.patch(f"{url}/api/characters/{character_id}", json={"movement_left": 2, "movement_total": 5})

    # Reload player map
    player.reload()
    expect(player.locator("#ws-label")).to_have_text("connected", timeout=10000)
    player.wait_for_timeout(1000)

    # Get canvas bounds
    canvas = player.locator("#player-grid-canvas")
    box = canvas.bounding_box()
    gs = player.evaluate("() => playerMainGrid ? playerMainGrid.gridSize : 50")

    # Try to drag token 5 cells to the right (from col 2 to col 7)
    # Token is at (2+0.5)*gs, (2+0.5)*gs relative to canvas
    start_x = box["x"] + (2 + 0.5) * gs
    start_y = box["y"] + (2 + 0.5) * gs
    end_x = box["x"] + (7 + 0.5) * gs
    end_y = start_y

    player.mouse.move(start_x, start_y)
    player.mouse.down()
    player.mouse.move(end_x, end_y, steps=10)
    player.mouse.up()
    player.wait_for_timeout(500)

    # Assert token snapped back (still near col 2)
    final_col = player.evaluate("() => { const t = (playerMainGrid.tokens||[]).find(t=>t.character_id==CHAR_ID); return t ? Math.floor(t.x * playerMainGrid.mapWidth / playerMainGrid.gridSize) : -1 }")
    assert final_col == 2, f"Token should snap back to col 2, got {final_col}"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/e2e/test_token_movement_restriction.py -v --browser chromium`
Expected: FAIL — token moves to col 7 because no distance check exists.

- [ ] **Step 3: Implement distance check in events.js**

In `events.js` mouseup handler, before calling `this.onTokenMove(...)` for `role='player'`:

```js
if (this.role === 'player') {
  const own = (this.tokens || []).find(t => t.character_id === this.dragToken?.character_id);
  if (own && own.movement_left != null) {
    const gs = this.gridSize ?? 50;
    const startCol = Math.floor(this._dragStartX * this.mapWidth / gs);
    const startRow = Math.floor(this._dragStartY * this.mapHeight / gs);
    const endCol   = Math.floor(dropX * this.mapWidth / gs);
    const endRow   = Math.floor(dropY * this.mapHeight / gs);
    const dist = Math.max(Math.abs(endCol - startCol), Math.abs(endRow - startRow));
    if (dist > own.movement_left + 0.5) {
      own.x = this._dragStartX;
      own.y = this._dragStartY;
      this.render();
      this._showMovementError(`Not enough movement (need ${dist}, have ${Math.floor(own.movement_left)})`);
      this.dragToken = null;
      this.isDragging = false;
      this._dragStartX = null;
      this._dragStartY = null;
      return;
    }
  }
}
```

Also store drag start in mousedown token branch:
```js
this._dragStartX = t.x;
this._dragStartY = t.y;
```

- [ ] **Step 4: Add _showMovementError to token-anim.js**

```js
MapCanvas.prototype._showMovementError = function(msg) {
  const el = document.createElement('div');
  el.className = 'map-movement-error';
  el.textContent = msg;
  Object.assign(el.style, {
    position:'absolute', bottom:'60px', left:'50%', transform:'translateX(-50%)',
    background:'rgba(200,50,50,0.9)', color:'#fff', padding:'6px 14px',
    borderRadius:'6px', pointerEvents:'none', zIndex:'999', fontSize:'0.85rem'
  });
  const parent = this.canvas.parentElement;
  if (parent) {
    parent.style.position = 'relative';
    parent.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python -m pytest tests/e2e/test_token_movement_restriction.py -v --browser chromium`
Expected: PASS

- [ ] **Step 6: Run full E2E suite**

Run: `python -m pytest tests/e2e -v --browser chromium`
Expected: all pass (no regressions)

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/test_token_movement_restriction.py static/js/map-canvas/events.js static/js/map-canvas/token-anim.js
git commit -m "feat: restrict player token movement to movement_left during combat"
```
