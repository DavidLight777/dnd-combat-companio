# Stability Sprint — post-split hotfix

**Assigned to:** Kimi
**Author:** Cascade
**Date:** 2026-04-28
**Severity:** P0 — Map tab does not render after Step 3 split.

> **STOP. READ FIRST: `docs/REAL_TESTING.md`.** When you say
> "fixed", the proof must be: a Playwright test that **failed
> before** your fix and **passes after**. The Step-5 E2E framework
> you just built is exactly the right tool here. Use it.

---

## 0. Symptom

User reports:

> я запустил код, и map tab карта не отображается

The 6-step Stability Sprint is shipped, all 88 unit tests + 10
Playwright E2E pass, but in the actual browser the GM Map tab
shows nothing. The `pytest` results were green because **none of
those tests open the GM Map tab and verify the canvas paints
pixels**. This is exactly the scenario `REAL_TESTING.md` warns
about: passing tests ≠ working software when the tests don't
exercise the broken path.

---

## 1. What Cascade verified is intact

The split is mechanically correct:

- `static/js/map-canvas/index.js` declares `class MapCanvas` and
  loads first.
- All seven peer files use `MapCanvas.prototype.X = function...`
  inside an IIFE — proper prototype patches.
- Methods called from consumer code that **do** exist in the
  split modules:
  - `loadImage`, `setGrid`, `setFog`, `setTokens`, `setDrawings`,
    `setMarkers`, `setObjects`, `setTraps`, `setTiles`,
    `setMapChests`, `setPortals`, `setAmbientLight`, `setIndoor`,
    `setLights`, `setEdges`, `setInteriors` — all in `state.js`
  - `render`, `_renderTiles`, `_renderHexGrid`, `_renderEdges` —
    all in `render.js`
  - `_renderLightingOverlay` — in `lighting.js`
  - `computeVisibleCells` — in `fog.js`
  - `_autoFitIfChanged`, `centerView`, `_bindEvents` — in
    `events.js`
  - `animateTokenTo`, `playFxOnCharacter`, `_triggerScreenShake`
    — in `token-anim.js`
- HTML script tags in `static/gm.html:960–967` and
  `static/player.html:496–503` load all 8 modules in correct
  order with cache-bust hashes.
- The new no-cache headers in `main.py` are live, so stale-cache
  is **not** a possible cause.

**Therefore** the bug is one of:

1. A **runtime error** in one of the 8 split files that throws
   inside the constructor or first `render()`, leaving the
   canvas blank. Visible in DevTools Console as a red error.
2. An **async hang** in `initMapCanvas` / `initPlayerMainGrid`
   (e.g. `await window.SpriteRegistry.load()` never resolves
   because of a 404 on a tile sprite). Visible in DevTools
   Network tab.
3. A **0×0 canvas** because `_resize()` runs before the parent
   element has dimensions (Map tab not visible at construction
   time → `parent.clientWidth === 0`). Visible by inspecting the
   `<canvas>` element in DevTools and checking its `width` /
   `height` attributes.
4. A **silent fetch failure** — `loadMapState` `try`/`catch`-es
   the whole body, so if `/api/map/{code}` 500s nothing renders
   and no error appears in console.
5. A **stale player-map-canvas orphan** — `static/player.html:32`
   still has `<canvas id="player-map-canvas">` inside the modal.
   The unification deletes the second `MapCanvas` instance but
   left the DOM element behind. Probably harmless (modal has
   `display:none`) but worth removing.

---

## 2. Diagnostic protocol — DO THIS FIRST

Order matters. Don't skip.

### Step 2.1 — Browser console

1. Hard-reload (`Ctrl+F5` once just to be safe — though no-cache
   is on, the OLD code may have been cached at server-start).
2. Open `/gm` → DevTools (F12) → Console tab → clear it.
3. Click the **Map tab**.
4. Screenshot **everything** that appears in the console
   (warnings AND errors AND info).
5. Repeat on `/player`.

If you see:

- `ReferenceError: MapCanvas is not defined`
  → script-tag order is wrong. Verify `index.js` loads before any
    `*.prototype` patcher in HTML.
- `TypeError: this.X is not a function`
  → method `X` got dropped during split. Find which file should
    own it, paste the function back in, run again.
- `404` on a `/static/js/map-canvas/*.js`
  → the file name in HTML doesn't match the file on disk.
- `Failed to load resource` for an image / atlas
  → likely SpriteRegistry blocking.

### Step 2.2 — Network tab

DevTools → Network → reload page → filter by `Status: not 2xx`.
Anything red = file the page tried to load and failed. Especially
look for:
- `/static/js/map-canvas.js` (singular, no `/`) — that's the OLD
  path, deleted in step 3. If something still requests it, find
  the offending HTML/JS and update it.
- Any `404` on tile sprites loaded by `SpriteRegistry`.

### Step 2.3 — DOM inspection

Click the Map tab, then in DevTools Elements panel, inspect
`<canvas id="map-canvas">`:

- If `width="0" height="0"` → cause is **#3** above. The fix is
  to call `_resize()` AFTER the tab becomes visible, not at
  construction time. See section 4.
- If `width="800" height="600"` (or similar) but blank → `render()`
  ran on a sized canvas but produced no pixels. Likely **#1** or
  **#4**. Add a `console.log('render', this.mapWidth,
  this.mapHeight, this.tokens?.length)` at the top of
  `render.js` `render()` and see what gets logged.

### Step 2.4 — API check

In console, run:
```js
fetch('/api/map/' + (window.SESSION_CODE || 'PEAK-8121'))
  .then(r => r.json())
  .then(s => console.log('map state', s))
```
If the response has `has_map: false`, no `tokens`, no
`active_floor_tiles` — the **bridge isn't producing data**, and
no amount of frontend fixing will help. Investigate
`app/routers/map/files.py` `_build_state_from_bv2` and confirm
the BV2 active map+location exists for this session.

---

## 3. The likely #1 root cause based on user's screenshot

The user's screenshot from the previous round shows the GM canvas
**partially** rendering — tokens and tiles visible — but with
faint geometry. This was followed by his "no lines for player"
report which Cascade attributed to "grid is GM-only by design".

**Now** the user reports nothing renders. So between then and now,
something regressed. The only large change since then is **the
split**. Therefore the most likely culprit is the split itself.

The single most plausible failure mode is **method ordering** —
specifically, an IIFE in `state.js` / `render.js` / etc. running
BEFORE `MapCanvas` exists. That happens if one of the prototype
patcher files accidentally executes top-level code that touches
`MapCanvas` before `class MapCanvas` is parsed.

Check every patcher file's top:

```js
(function () {
  MapCanvas.prototype.method = function () { ... };
})();
```

That's safe — the body only runs when called, and calling assigns
properties. **Unsafe variants** to look for and fix:

```js
(function () {
  // ❌ BAD — this runs immediately at script load and may run
  // before index.js if anyone moved script tags.
  const proto = MapCanvas.prototype;
  proto.method = function () { ... };
})();
```

If `proto = MapCanvas.prototype` runs and `MapCanvas` is
undefined, you get `ReferenceError` in the console immediately.

**Action:** grep the 8 module files for any top-level read of
`MapCanvas` outside a function. There should be **zero**. Every
reference must be inside a function body that gets called later.

```bash
grep -n "MapCanvas\." static/js/map-canvas/*.js | grep -v "prototype\." | grep -v "^.*:[ ]*//\|^.*:[ ]*\*"
```

If anything comes back that isn't `class MapCanvas` (in index.js)
or `MapCanvas.prototype.X = ...`, that's your bug.

---

## 4. Likely #2 root cause — `initMapCanvas` race

`gm/01-core.js:113-118` does:

```js
if (tab.dataset.tab === 'map') {
  initMapCanvas();                          // async, returns Promise
  if (mapCanvas) { mapCanvas._resize(); mapCanvas.render(); }
  // ↑ runs IMMEDIATELY — mapCanvas is still null because init is async
}
```

`initMapCanvas` is `async function` and awaits
`SpriteRegistry.load()`. The `if (mapCanvas)` check on the next
line runs synchronously; `mapCanvas` is still null, so `_resize`
never fires. Inside `initMapCanvas`, `loadMapState()` does call
`render()` once data arrives — so this should still work
**eventually**, but only if `loadMapState` succeeds and the
canvas's parent has dimensions at that moment.

**Fix:**

```js
if (tab.dataset.tab === 'map') {
  initMapCanvas().then(() => {
    if (mapCanvas) { mapCanvas._resize(); mapCanvas.render(); }
  });
}
```

This is a small safety improvement regardless of the actual bug.

---

## 5. Cleanup — orphaned modal canvas

`static/player.html:32` still has:

```html
<canvas id="player-map-canvas" style="display:block;width:100%;height:100%"></canvas>
```

After Step 4 (canvas reparenting) this element is unused — the
real canvas is `#player-grid-canvas`, which gets `appendChild`-ed
into the modal's slot on open. The orphan is shadowed but never
referenced.

**Fix:** delete the orphan canvas from `player.html`. The modal
slot is `<div style="flex:1;...">`; it ends up containing the
moved `#player-grid-canvas`. Verify open/close still works after
removing the orphan.

---

## 6. Required tests for the fix

You will not say "done" without these:

### 6.1 — Playwright `tests/e2e/test_map_renders.py`

```python
import pytest
from playwright.sync_api import Page, expect

def test_gm_map_tab_renders_canvas(gm_page: Page):
    """Click the Map tab. After ≤2s the canvas must contain
    non-empty rendered pixels."""
    gm_page.locator('[data-tab="map"]').click()
    canvas = gm_page.locator('#map-canvas')
    expect(canvas).to_be_visible(timeout=2000)
    # Read canvas pixel data via JS — assert at least one
    # non-transparent pixel exists.
    has_pixels = gm_page.evaluate("""() => {
        const c = document.getElementById('map-canvas');
        if (!c || !c.width || !c.height) return false;
        const ctx = c.getContext('2d');
        const img = ctx.getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; i < img.length; i += 4) {
            if (img[i] > 0) return true;   // any non-transparent
        }
        return false;
    }""")
    assert has_pixels, "Canvas exists but is fully transparent"

def test_gm_map_canvas_has_size(gm_page: Page):
    gm_page.locator('[data-tab="map"]').click()
    size = gm_page.evaluate("""() => {
        const c = document.getElementById('map-canvas');
        return { w: c.width, h: c.height };
    }""")
    assert size["w"] > 0 and size["h"] > 0, f"canvas is {size}"

def test_player_map_renders(player_page):
    """Same for player main-tab grid canvas."""
    canvas = player_page.locator('#player-grid-canvas')
    expect(canvas).to_be_visible(timeout=2000)
    has_pixels = player_page.evaluate("""() => {
        const c = document.getElementById('player-grid-canvas');
        if (!c || !c.width || !c.height) return false;
        const ctx = c.getContext('2d');
        const img = ctx.getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; i < img.length; i += 4) if (img[i] > 0) return true;
        return false;
    }""")
    assert has_pixels
```

This test fails on `main` today (the bug). After your fix, all
three pass.

### 6.2 — Console-error guard

Add to your existing E2E `conftest.py`:

```python
@pytest.fixture(autouse=True)
def _no_console_errors(page: Page):
    errors = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.on("console", lambda msg: errors.append(msg.text)
            if msg.type == "error" else None)
    yield
    assert not errors, f"page logged errors:\n" + "\n".join(errors)
```

This makes EVERY E2E test a strict "no JS errors" assertion. The
exact thing you needed to catch this bug. After this fixture is
in, run all 10 existing E2E tests; expect at least one to fail
loudly because of the current map-canvas issue, surfacing the
true error message.

---

## 7. Done criteria

1. **DevTools console clean** on both `/gm` and `/player` after a
   hard reload + Map tab click.
2. **`#map-canvas` and `#player-grid-canvas`** both have non-zero
   `width`/`height` AND non-transparent pixels.
3. The three new tests in `tests/e2e/test_map_renders.py` pass.
4. The existing 10 E2E tests still pass with the new
   `_no_console_errors` fixture enabled.
5. Manual smoke: GM creates session → joins as player → both see
   tokens, tiles, fog, lighting on respective Map views.

Post in chat the diagnostic findings (which of #1-#5 from
section 1) and the actual fix, plus a screenshot of the green
test run including the new render tests.

---

## 8. Order of operations (refreshed)

1. ✅ `BUILDER_BUGFIX.md` (shipped, but un-tested — see issue)
2. ✅ `STABILITY_SPRINT.md` (shipped, but Map tab regression)
3. **→ THIS DOC** — fix the regression you introduced.
4. **→ Backfill `REAL_TESTING.md`** — write the four bug tests
   that should have been written in BUILDER_BUGFIX.
5. → `PHASE_13_REDO_LIGHTING.md`

Do not start step 4 or 5 until step 3 is shipped, verified, and
the user confirms the map renders.
