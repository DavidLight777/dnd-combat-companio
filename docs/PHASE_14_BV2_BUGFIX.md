# Phase 14 — Builder V2 Bug Sprint

**Assigned to:** Kimi
**Author:** Cascade
**Date:** 2026-04-29
**Severity:** P1 — multiple game-breaking bugs visible in live demo

> **STOP. READ FIRST: `docs/REAL_TESTING.md` and `docs/STABILITY_HOTFIX.md`.**
> Every fix you ship MUST have a test that fails before and passes after.
> "pytest passed" without a new test for the new bug is **not verification**.

---

## What the user sees (from live screenshots)

1. **Player cannot move** — map shows "Path is blocked by a wall"
   on floor cells with no wall tiles. Player token is stuck.
2. **Black rectangles on the map** — large dark squares appear
   on top of correctly-lit areas. The lighting overlay is composited
   incorrectly.
3. **GM Torch / Lamp / Magic buttons do nothing visible** — clicking
   them in the Builder sidebar selects a brush but clicking a cell
   doesn't reliably open the light placement modal.
4. **Zone button purpose is unclear** — UI has a "Zone" tile type
   with no tooltip, no documentation, no feedback when painted.
5. **Edge transitions are invisible / non-functional for players** —
   the `>` arrows on the map border appear but stepping on them does
   nothing. The player doesn't know they exist.
6. **No way to trigger a location transition** — there is no clear
   UX path for a player to move between locations through an edge.

---

## ⚠ MANDATORY RULES

### M-R1 — Every fix has a regression test

```
Before commit:
  git stash                     ← remove your fix
  pytest tests/test_<bug>.py -v ← MUST FAIL
  git stash pop
  pytest tests/test_<bug>.py -v ← MUST PASS
```

Post in chat:
```
Bug: <name>
Test: tests/test_<name>.py
Before fix: FAILED (paste the failure line)
After fix: PASSED
```

### M-R2 — No guessing API routes

Look in `app/routers/builder_v2/` before calling any endpoint.
If an endpoint is missing, add it **in the same commit** as the fix.

### M-R3 — No console errors

After each fix, open DevTools → Console. Zero red errors allowed.
If errors exist, they are bugs. Fix them.

### M-R4 — Test the player side AND the GM side

These bugs affect both. After each fix, verify in:
- GM window: `http://localhost:8000/gm?code=DEMO01`
- Player window (incognito): `http://localhost:8000`

---

## Bug A — Player movement blocked by phantom walls

### Root cause

`_path_is_blocked` in `app/routers/map/common.py:139` queries
`BV2Tile.blocks_movement == True`. The seed script (`scripts/seed_demo_map.py`)
calls `PUT /api/builder-v2/locations/{id}/tiles` which uses the
`TILE_DEFAULTS` in `app/routers/builder_v2/common.py`.

**Check:** does the bulk PUT endpoint set `blocks_movement` correctly
for every tile type? Specifically, do `floor` tiles get
`blocks_movement=False`? Run this query and report:

```python
# scripts/debug_movement.py
import asyncio, sys
sys.path.insert(0, '.')
from app.database import async_session
from app.models import BV2Tile
from sqlalchemy import select, func

async def main():
    async with async_session() as db:
        r = await db.execute(
            select(BV2Tile.tile_type, func.count())
            .where(BV2Tile.blocks_movement == True)
            .group_by(BV2Tile.tile_type)
        )
        for row in r.all():
            print(f"  {row[0]}: {row[1]} blocking tiles")

asyncio.run(main())
```

If `floor` appears in the output — the bulk PUT is not applying
`TILE_DEFAULTS`. Fix the PUT handler to call `tile_blocks(tile_type)`
for every tile and persist `blocks_movement` / `blocks_vision`
correctly.

### Required test

```python
# tests/test_movement_bug_a.py
"""Floor tiles must not block movement — regression for phantom wall bug."""
import pytest
from httpx import ASGITransport, AsyncClient
from main import app
from app.database import init_db

@pytest.mark.asyncio
async def test_floor_tile_does_not_block_movement():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as ac:
        # Create session + map + location
        sr = await ac.post("/api/sessions/create",
                           json={"name": "T", "code": "MOVE_TEST_A"})
        code = sr.json()["session_code"]
        mr = await ac.post(f"/api/builder-v2/sessions/{code}/maps",
                           json={"name": "M"})
        map_id = mr.json()["id"]
        lr = await ac.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"name": "L", "cols": 5, "rows": 5})
        loc_id = lr.json()["id"]

        # Paint a floor tile
        await ac.put(f"/api/builder-v2/locations/{loc_id}/tiles",
                     json={"tiles": [{"col": 2, "row": 2, "tile_type": "floor"}]})

        # Fetch it back — must have blocks_movement=False
        r = await ac.get(f"/api/builder-v2/locations/{loc_id}")
        tiles = r.json()["tiles"]
        floor_tile = next((t for t in tiles if t["col"] == 2 and t["row"] == 2), None)
        assert floor_tile is not None
        assert floor_tile["blocks_movement"] is False, \
            f"Floor tile blocks movement! Got: {floor_tile}"

@pytest.mark.asyncio
async def test_wall_tile_blocks_movement():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as ac:
        sr = await ac.post("/api/sessions/create",
                           json={"name": "T", "code": "MOVE_TEST_B"})
        code = sr.json()["session_code"]
        mr = await ac.post(f"/api/builder-v2/sessions/{code}/maps",
                           json={"name": "M"})
        map_id = mr.json()["id"]
        lr = await ac.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"name": "L", "cols": 5, "rows": 5})
        loc_id = lr.json()["id"]

        await ac.put(f"/api/builder-v2/locations/{loc_id}/tiles",
                     json={"tiles": [{"col": 1, "row": 1, "tile_type": "wall"}]})

        r = await ac.get(f"/api/builder-v2/locations/{loc_id}")
        tiles = r.json()["tiles"]
        wall_tile = next((t for t in tiles if t["col"] == 1 and t["row"] == 1), None)
        assert wall_tile is not None
        assert wall_tile["blocks_movement"] is True, \
            f"Wall tile should block movement! Got: {wall_tile}"
```

---

## Bug B — Black rectangles / lighting overlay artifact

### Root cause hypothesis

`_renderLightingOverlay` in `static/js/map-canvas/lighting.js`
draws darkness on `_darkLayer` then punches out light circles.
The black rectangles are most likely caused by one of:

1. **`_darkLayer` not cleared before repaint** — if `clearRect`
   is missing or uses wrong dimensions, old darkness bleeds into
   the new frame.
2. **Composite operation not reset** — if `globalCompositeOperation`
   is set to `destination-out` (for punching out light) and not
   reset to `source-over` afterwards, subsequent draws appear black.
3. **`bright_radius_cells` being `null`** — the bright-radius
   gradient is drawn first; if null causes `NaN` in the radius
   calculation, `createRadialGradient` throws silently and the
   light is partially skipped, leaving a black hole.

### Diagnostic protocol

Add this temporarily to `lighting.js` at the top of
`_renderLightingOverlay`:

```js
console.log('[lighting] overlay start, lights=', (this._lights||[]).length,
  'ambient=', this._ambientLight, 'canvas=', this.canvas.width, this.canvas.height);
```

And at the end:
```js
console.log('[lighting] overlay done, compositeOp=', this.ctx.globalCompositeOperation);
```

If `compositeOp` is not `source-over` at the end → that's bug #2.
If `canvas` is 0×0 → canvas not resized before render.
Remove the logs after fixing.

### Required fix checklist

- [ ] `clearRect(0, 0, w, h)` on `_darkLayer` canvas at the START
      of every call (not conditional).
- [ ] After all light punch-outs, reset:
      `ctx.globalCompositeOperation = 'source-over'`
- [ ] Guard against `NaN` in radial gradient:
      ```js
      const r = isFinite(radiusPx) && radiusPx > 0 ? radiusPx : 1;
      ```
- [ ] If `bright_radius_cells` is null/undefined, treat as `0`.

### Required test

```python
# tests/test_lighting_bug_b.py
"""BV2Light with null bright_radius must not crash the API."""
import pytest
from httpx import ASGITransport, AsyncClient
from main import app
from app.database import init_db

@pytest.mark.asyncio
async def test_light_with_null_bright_radius_serializes_cleanly():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as ac:
        sr = await ac.post("/api/sessions/create",
                           json={"name": "T", "code": "LIGHT_TEST_A"})
        code = sr.json()["session_code"]
        mr = await ac.post(f"/api/builder-v2/sessions/{code}/maps",
                           json={"name": "M"})
        map_id = mr.json()["id"]
        lr = await ac.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"name": "L", "cols": 10, "rows": 10,
                                 "ambient_light": 0.0})
        loc_id = lr.json()["id"]

        # Create light WITHOUT bright_radius_cells
        r = await ac.post(f"/api/builder-v2/locations/{loc_id}/lights",
                          json={"col": 5, "row": 5, "radius_cells": 4,
                                "color_hex": "#ff8800", "intensity": 1.0,
                                "source_kind": "torch"})
        assert r.status_code == 200
        light = r.json()
        # bright_radius_cells must be a number (0.0), not null
        assert light["bright_radius_cells"] is not None, \
            "bright_radius_cells must never be null in API response"
        assert isinstance(light["bright_radius_cells"], (int, float))
```

Also add a Playwright E2E test:

```python
# tests/e2e/test_lighting_no_black_rect.py
"""No black rectangles visible on lit map — regression for Bug B."""
def test_no_black_rectangle_on_lit_map(gm_page):
    gm_page.click("[data-tab='builder-v2']")
    gm_page.wait_for_timeout(1500)

    # Sample pixel in the CENTER of the lit area
    # Village Square has a torch at col 16, row 12 — well-lit center
    pixel = gm_page.evaluate("""() => {
      const canvas = document.getElementById('bv2-canvas');
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      const cx = Math.floor(canvas.width / 2);
      const cy = Math.floor(canvas.height / 2);
      const d = ctx.getImageData(cx - 20, cy - 20, 40, 40).data;
      // Count fully-black pixels (r==0, g==0, b==0, a==255)
      let blackCount = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] < 5 && d[i+1] < 5 && d[i+2] < 5 && d[i+3] > 200) blackCount++;
      }
      return { blackCount, total: d.length / 4 };
    }""")
    assert pixel is not None
    black_ratio = pixel["blackCount"] / pixel["total"]
    assert black_ratio < 0.3, \
        f"Too many black pixels in lit area: {black_ratio:.1%} ({pixel})"
```

---

## Bug C — GM Light buttons (Torch/Lamp/Magic) don't open modal on click

### Root cause

`70-lights.js` wires brush selection correctly:
```js
S.brush = `light:${preset}`;  // e.g. "light:torch"
```

`20-mapview.js` handles clicks:
```js
} else if (brush.startsWith('light:')) {
  const { col, row } = this._screenToTile(e.offsetX, e.offsetY);
  if (this._inBounds(col, row) && typeof S.openLightModal === 'function') {
    S.openLightModal(null, 'create', { col, row, preset: brush.replace('light:', '') });
  }
}
```

**Problem:** `this._inBounds(col, row)` — if no location tiles exist
yet or the location dimensions are not set on the view, `_inBounds`
returns `false` for every cell, and `openLightModal` is never called.

**Additionally:** the HTML buttons in the sidebar must have class
`bv2-light-brush` AND `data-preset="torch"` etc. Verify this in
`static/js/gm.html`. If the class is wrong, `70-lights.js` line 177
never matches.

### Diagnostic

Open DevTools Console and run:
```js
document.querySelectorAll('.bv2-light-brush').length
// must return 3 (torch, lamp, magic)
// if 0 → the buttons don't have the correct class
```

And:
```js
window.bv2.brush  // after clicking Torch button
// must be "light:torch"
```

And after clicking on the map:
```js
// Add temporarily to 20-mapview.js mouseup handler:
console.log('click brush=', S.brush, 'col=', col, 'row=', row,
  'inBounds=', this._inBounds(col, row));
```

### Fix

If `_inBounds` is the problem, guard it:
```js
_inBounds(col, row) {
  if (!this.cols || !this.rows) return true; // no bounds set = allow
  return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
}
```

If the HTML class is wrong, fix the button HTML in `gm.html` to
match exactly `class="bv2-light-brush"` and `data-preset="torch"`.

### Required test

```python
# tests/e2e/test_gm_light_buttons.py
def test_torch_button_opens_modal(gm_page):
    """Clicking the Torch brush then a map cell opens the light modal."""
    gm_page.click("[data-tab='builder-v2']")
    gm_page.wait_for_timeout(1000)

    # Click the Torch button
    gm_page.click(".bv2-light-brush[data-preset='torch']")

    # Verify brush is set
    brush = gm_page.evaluate("() => window.bv2.brush")
    assert brush == "light:torch", f"Brush not set: {brush}"

    # Click center of canvas
    canvas = gm_page.locator("#bv2-canvas")
    bb = canvas.bounding_box()
    gm_page.mouse.click(bb["x"] + bb["width"] / 2,
                         bb["y"] + bb["height"] / 2)
    gm_page.wait_for_timeout(300)

    # Light modal must appear
    modal = gm_page.locator("#bv2-light-modal")
    assert modal.is_visible(), "Light modal did not open after clicking with torch brush"
```

---

## Bug D — Zone tile: document what it does and add tooltip

### What Zone currently does

`Zone` is a tile type that renders differently from floor but has
no `blocks_movement`, no `blocks_vision`, and no special server-side
behaviour. It was added as a placeholder for "interior zone marker"
(Phase 9 interiors).

### Fix

**Do NOT add complex behaviour.** Just:

1. Add a tooltip/description in the sidebar:
   ```html
   <div class="tile-hint">
     Zone — marks an interior area (room, building).
     Assign a roof via the Interiors panel.
   </div>
   ```
2. When `Zone` is selected, highlight the "Interiors" panel header
   with a pulsing border for 2 seconds to guide the user there.
3. Add to `TILE_DEFAULTS` if missing (it may not be there):
   ```python
   "zone": {"blocks_movement": False, "blocks_vision": False},
   ```

No test required for the tooltip. Test the `TILE_DEFAULTS` entry:

```python
# tests/test_zone_tile.py
def test_zone_tile_does_not_block():
    from app.routers.builder_v2.common import tile_blocks
    result = tile_blocks("zone")
    assert result["blocks_movement"] is False
    assert result["blocks_vision"] is False
```

---

## Bug E — Edge transitions: player UX and server-side trigger

### What works today

- Edges are stored in `BV2Edge` with `side`, `range_start`,
  `range_end`, `target_location_id`, `target_entry_col/row`.
- `app/routers/builder_v2/edges.py:163` has `_find_matching_edge`
  logic.
- `20-mapview.js` renders `>` arrows at the map border for each edge.
- But: **there is no server-side handler that moves the player**
  when they step on an edge cell.

### Root cause (from Phase 11 memory)

`app/routers/map/tokens.py` syncs `col/row` when a token moves but
**never calls** `_find_matching_edge` to check if the destination
is an edge cell. The WS event `bv2.character_edge_transitioned` is
declared but never broadcast.

### Fix

In `app/routers/map/tokens.py`, after the tile-block check and
position update, add:

```python
# Check if new position triggers an edge transition
from app.routers.builder_v2.edges import _find_matching_edge

if c.current_location_id:
    new_col = body.get("col", c.col)
    new_row = body.get("row", c.row)
    edge = await _find_matching_edge(c.current_location_id, new_col, new_row, db)
    if edge:
        # Move character to target location
        c.current_location_id = edge.target_location_id
        c.col = edge.target_entry_col
        c.row = edge.target_entry_row
        c.map_x = edge.target_entry_col / target_loc.cols
        c.map_y = edge.target_entry_row / target_loc.rows
        await db.commit()
        await manager.broadcast(session_code, "bv2.character_edge_transitioned", {
            "character_id": c.id,
            "from_location_id": c.current_location_id,
            "to_location_id": edge.target_location_id,
            "col": edge.target_entry_col,
            "row": edge.target_entry_row,
        })
        return {"transitioned": True, "location_id": edge.target_location_id}
```

**Also add `_find_matching_edge` to `edges.py` if it's not already
a standalone callable.** It must accept `(location_id, col, row, db)`
and return the matching `BV2Edge` or `None`.

### Player-side UX

When `bv2.character_edge_transitioned` is received by the player's
WS listener (`static/js/player/13-websocket.js`):

```js
ws.on('bv2.character_edge_transitioned', async (data) => {
  if (data.character_id !== MY_CHAR_ID) return;
  // Show a toast
  showToast(`You move to a new area…`);
  // Reload the map for the new location
  await loadPlayerMapState();
});
```

### Required test

```python
# tests/test_edge_transition.py
"""Stepping on an edge cell must teleport the character to the target location."""
import pytest
from httpx import ASGITransport, AsyncClient
from main import app
from app.database import init_db

@pytest.mark.asyncio
async def test_player_transitions_through_edge():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app),
                           base_url="http://test") as ac:
        # Create session, map, two locations
        sr = await ac.post("/api/sessions/create",
                           json={"name": "T", "code": "EDGE_TEST_A"})
        code = sr.json()["session_code"]
        mr = await ac.post(f"/api/builder-v2/sessions/{code}/maps",
                           json={"name": "M"})
        map_id = mr.json()["id"]
        loc_a = (await ac.post(f"/api/builder-v2/maps/{map_id}/locations",
                               json={"name": "A", "cols": 10, "rows": 10})).json()["id"]
        loc_b = (await ac.post(f"/api/builder-v2/maps/{map_id}/locations",
                               json={"name": "B", "cols": 10, "rows": 10})).json()["id"]

        # Create edge: east side of A row 5 → B entry (0, 5)
        await ac.post(f"/api/builder-v2/locations/{loc_a}/edges",
                      json={"side": "east", "range_start": 4, "range_end": 6,
                            "target_location_id": loc_b,
                            "target_entry_col": 0, "target_entry_row": 5})

        # Create a character in loc_a
        join = await ac.post(f"/api/sessions/{code}/join",
                             json={"name": "Hero", "player_token": "tok1"})
        char_id = join.json()["character_id"]

        # Place character at edge cell (col=9, row=5)
        await ac.patch(f"/api/map/token/{char_id}",
                       json={"col": 9, "row": 5, "player_token": "tok1"})

        # Verify character is now in loc_b
        r = await ac.get(f"/api/sessions/{code}/characters")
        hero = next(c for c in r.json() if c["id"] == char_id)
        assert hero["current_location_id"] == loc_b, \
            f"Character should have transitioned to loc_b, got {hero['current_location_id']}"
        assert hero["col"] == 0
        assert hero["row"] == 5
```

---

## Exit criteria

Before saying "done", **all of the following must be true:**

- [ ] `pytest tests/ -q --ignore=tests/e2e` — **green** (114 + new tests)
- [ ] `pytest tests/e2e -v --browser chromium` — **green**
- [ ] DevTools Console on `/gm?code=DEMO01` — **zero errors**
- [ ] Player can walk freely across floor tiles in Village Square
- [ ] No black rectangles visible anywhere on the lit map
- [ ] Clicking Torch brush then a cell → light modal opens
- [ ] Zone tile has tooltip explaining its purpose
- [ ] Player walking into an edge arrow → moves to the next location
- [ ] Toast notification appears when player changes location
- [ ] Commit: `fix: bv2 movement, lighting, light-brush, edge transitions`

---

## Anti-fail rules

1. **Don't change `_path_is_blocked` logic** unless you've confirmed
   the tile data itself is wrong first (run `debug_movement.py`).
2. **Don't rewrite `lighting.js`** — minimal surgical fix only.
   Add `clearRect`, fix composite reset, guard NaN. That's it.
3. **Don't add new tile types** for Zone — just add the tooltip.
4. **Don't invent new WS event names** — use `bv2.character_edge_transitioned`
   which is already declared in the backend.
5. **After every change: restart server, hard-reload (Ctrl+Shift+R),
   open DevTools Console, verify zero errors.**
