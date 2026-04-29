# Phase 13 REDO — Foundry-grade dynamic lighting

**Assigned to:** Kimi
**Author:** Cascade
**Date:** 2026-04-28

> **STOP. READ FIRST (in order):**
> 1. `docs/REAL_TESTING.md` — the discipline.
> 2. `docs/STABILITY_HOTFIX.md` — the canonical example of how to
>    do a round correctly. The post-split regression you just
>    closed is the template for *every* round in this doc.
>
> **Every round below ships only when:**
> - A new Playwright test that **failed before** your change and
>   **passes after** is committed alongside the fix.
> - The `_no_console_errors` autouse fixture in
>   `tests/e2e/conftest.py` is active during the test run — i.e.
>   a JS error anywhere in the page fails the test.
> - You post three pieces of proof in chat: (a) clean DevTools
>   console screenshot, (b) green `pytest tests/e2e -v --browser
>   chromium` output, (c) a before/after screenshot of the
>   visual change.
>
> Running pre-existing unit tests is **not verification**. If you
> skip any of the above, the work will be rejected regardless of
> how nice the lighting looks.

---

## 0. Context — what happened and why we rolled back

The previous Phase 13 attempt (Pixi.js + Kenney pixel-art atlas) was
**abandoned and rolled back** on 2026-04-28. Reasons:

1. **Stylistic mismatch.** Our UI is dark-flat-minimal (rounded
   corners, flat fills, orange accents). Kenney Roguelike is 16×16
   retro pixel art. The two aesthetics reject each other visually —
   it looked like a NES screenshot inside an iOS app.
2. **Hex grid incompatible.** Kenney tiles are drawn for square
   cells. On hex they either clip at corners or leave seams. Our
   engine already supports `grid_type='hex'` (see `BV2Location`
   model) and `Phase 13 R3` had `console.warn('hex grid not supported')`
   as a placeholder — a dead-end commitment.
3. **Integration friction.** Multiple hotfix rounds (R3 hotfix A for
   `PixiAtlas.load()` await, R3 hotfix B for wrong Kenney coordinates,
   cache-bust struggles) showed that bolting Pixi on top of the
   working Canvas2D renderer was fighting the architecture rather
   than improving it.
4. **Wrong priority.** The actual complaint that started Phase 13
   was that **lighting looks "topornyj" (clunky)** — stair-stepped
   shadows, no colour tint, no interaction with walls. Pixel-art
   tiles were an orthogonal distraction.

**Kept from the abandoned attempt:**
- Nothing. All Pixi files deleted (`static/js/pixi/`,
  `static/vendor/pixi/`, `static/assets/atlas/`).
- Cookie gate `USE_PIXI` removed from `gm.html` / `player.html`.
- Bridges removed from `gm/06-map-main.js` and `player/10-map.js`.
- `scripts/pack_atlas.py` deleted.
- Test file `tests/test_phase13_*.py` — verify whether any remain
  and delete any that reference the removed files.

**What stays (post-Stability-Sprint state):**
- Canvas2D `MapCanvas` renderer — now **split** into 8 modules:
  - `static/js/map-canvas/index.js` (class + constructor)
  - `static/js/map-canvas/state.js` (setters)
  - `static/js/map-canvas/render.js` (`render()` + draw helpers)
  - `static/js/map-canvas/events.js` (pointer/wheel/drag)
  - `static/js/map-canvas/lighting.js` (`_renderLightingOverlay`) ← **this doc edits mostly here**
  - `static/js/map-canvas/hex-math.js` (hex conversions)
  - `static/js/map-canvas/token-anim.js` (token animations + FX)
  - `static/js/map-canvas/fog.js` (`computeVisibleCells`)
- Existing `BV2Light` model, endpoints in
  `app/routers/builder_v2/lights.py`, builder UI in
  `static/js/builder_v2/70-lights.js`.
- The current clunky lighting in
  `MapCanvas.prototype._renderLightingOverlay()` (in
  `map-canvas/lighting.js`) — **we replace this.**
- `_no_console_errors` autouse fixture in `tests/e2e/conftest.py`
  — every E2E test fails on any JS error. Keep it on.
- No-cache static headers in `main.py` — an ordinary F5 always
  serves fresh JS. **Do not add `?v=` query strings.** (Previous
  advice in this doc about cache-bust strings is obsolete.)

**All tests pass after the Stability Sprint (88 unit + 13 E2E).**
Confirm with `pytest tests/ -q && pytest tests/e2e -v --browser
chromium` before starting R1.

---

## 1. Goal

Replace the current cell-based "punch out darkness" lighting with a
Foundry-VTT-style dynamic lighting system on pure Canvas2D:

- Smooth polygon-based light shapes that clip against walls.
- Coloured lights that tint the floor they illuminate.
- `bright` vs `dim` radii (hard inner ring, soft outer fade).
- Additive blending so overlapping lights combine.
- Subtle animations (torch flicker, magical pulse).
- Hex grid parity with square grid.
- Token-carried vision as a light source with no colour.
- Day/night darkness slider.

**Non-goals:** WebGL, shaders, external asset packs, tile textures.
Everything must run on the existing Canvas2D pipeline.

---

## 2. Diagnosis of the current renderer

File: `@c:\Users\Litun\Desktop\DND Project\dnd-companion\static\js\map-canvas\lighting.js`
Function: `MapCanvas.prototype._renderLightingOverlay(ctx)`.
Related: `computeVisibleCells` lives in `static/js/map-canvas/fog.js`.

### Problems, each mapped to a fix in this plan

| # | Problem | Code symptom | Fixed in |
|---|---------|--------------|----------|
| 1 | Stair-stepped light edges at walls | clip path built from `visibleSet` cell rects in `lighting.js` | **R1** |
| 2 | No colour tint — orange torch does not warm the floor | `grad.addColorStop` uses only `rgba(0,0,0,...)` | **R2** |
| 3 | No bright/dim separation | single gradient from `intensity` to `0` | **R2** |
| 4 | Lights don't stack in intersections | `destination-out` punches the same darkness with each light, no additive path | **R2** |
| 5 | Everything is static | no `requestAnimationFrame` loop in the renderer | **R3** |
| 6 | Hex grid unsupported | `computeVisibleCells()` in `fog.js` uses square-grid shadowcasting with hard-coded octants | **R1** |
| 7 | Fog of war + lighting not coupled | `setFog()` and `_renderLightingOverlay()` are independent layers | **R3** |
| 8 | No day/night slider | `ambient_light` is a 0..1 number but only shows as a global dark veil | **R3** |

---

## 3. Reference — how Foundry VTT does it (stripped down)

Public docs + open-source readings (`foundryvtt` community, Owlbear
Rodeo blog posts) give us the mental model:

1. **PointSource polygon.** Each light emits 60–360 rays. Each ray
   stops at the first blocking wall or at `radius`. The polygon is
   the convex hull of the ray tips.
2. **Two radii.** `bright` (full intensity) and `dim` (half
   intensity). Bright is a smaller polygon; dim is the outer one
   with gradient falloff to zero.
3. **Colour blend.** The light canvas is filled with the darkness
   colour, then each light is drawn as a **coloured** radial gradient
   with blend mode `screen` (additive in linear space). The final
   light canvas is composited onto the map with blend mode
   `multiply`.
4. **Animation.** Per-light `animation.type` + `animation.speed` +
   `animation.intensity`. A RAF loop perturbs radius and/or intensity
   at a fixed frequency. Torch = flicker (noise), pulse = sine.
5. **Token vision.** Each token is itself a `PointSource` with no
   colour, used only to define the `fog.sight` polygon. Overlay:
   seen but unlit = silhouette; seen and lit = full colour;
   unseen = darkness.
6. **Darkness slider** (`scene.darkness` 0..1) multiplies the
   ambient level. At 1.0 only the lights illuminate.

We implement the minimum that gives 80% of the visible polish:
items 1–4 in R1 + R2, items 5–6 in R3.

---

## 4. Round-by-round plan

All three rounds stay on one branch. Each round ends with green
tests + a manual smoke-test screenshot handed to Cascade in chat
before starting the next.

### R1 — Polygon-based light shapes with soft edges
**Done — `cccac31`**

**Goal:** replace cell-based clip path with a true ray-cast polygon.
End result: gentle curves where walls cut the light, not stair
steps. No colour work yet; the light is still monochrome-dark.

#### Files to touch

- `static/js/map-canvas/lighting.js` — rewrite of
  `_renderLightingOverlay`. Keep the old function as
  `_renderLightingOverlay_legacy` for reference during review; mark
  with a `// TODO: delete in R3 final` and remove in R3.
- `static/js/map-canvas/index.js` — add new helpers
  `_raycastPolygon` and `_makeBlocksAt` as
  `Object.defineProperty`-or-prototype methods. Pick whichever
  style the surrounding split code already uses (all 8 files
  use `MapCanvas.prototype.X = function...` inside an IIFE —
  follow that pattern exactly. **Do NOT use ES6 `get X()` syntax
  outside a `class { }` body** — that was the syntax error that
  broke the split and wasted a debug cycle. See
  `STABILITY_HOTFIX.md` section for the fix pattern.).
- `tests/e2e/test_phase13_lighting_r1.py` — new, Playwright
  pixel-level tests that assert the light polygon actually clips
  to a wall.
- `tests/test_phase13_lighting_r1.py` — new, Python-side unit
  test for the raycaster helper extracted into pure-function form.

#### New helper (put it inside `map-canvas.js`, near the existing
`computeVisibleCells`):

```js
// Phase 13 REDO R1 — ray-cast polygon from a point source.
// Returns array of [x,y] in WORLD (pre-transform) pixel coordinates.
//
// `blocksAt(px,py)` must be a fast predicate that reports whether
// a blocking wall intersects the pixel. For square tiles that's a
// lookup into this.tiles; for hex it's the same lookup with a
// hex-to-axial mapping. Keep it grid-shape-agnostic.
_raycastPolygon(originX, originY, radiusPx, blocksAt, numRays = 120) {
  const poly = [];
  const step = (Math.PI * 2) / numRays;
  for (let i = 0; i < numRays; i++) {
    const a = i * step;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    // March in 1-cell-ish increments for speed. 4px is plenty for
    // a 50px grid — we sample ~12 times per cell on the diagonal.
    const STEP_PX = Math.max(2, this.gridSize / 12);
    let t = 0;
    while (t < radiusPx) {
      const x = originX + dx * t;
      const y = originY + dy * t;
      if (blocksAt(x, y)) break;
      t += STEP_PX;
    }
    if (t > radiusPx) t = radiusPx;
    poly.push([originX + dx * t, originY + dy * t]);
  }
  return poly;
}
```

#### Grid-agnostic `blocksAt` factory:

```js
_makeBlocksAt() {
  const gs = this.gridSize;
  const tiles = this.tiles || {};
  const walls = (this.mapObjects || []).filter(o =>
    o.kind === 'wall' && o.blocks_vision !== false);
  // Hex vs square: both end up as a cell key; the payload's
  // blocks_vision flag is the same field.
  const cellKey = this.gridType === 'hex'
    ? this._hexPixelToKey.bind(this)
    : (x, y) => `${Math.floor(x / gs)},${Math.floor(y / gs)}`;
  return (x, y) => {
    const k = cellKey(x, y);
    const t = tiles[k];
    if (t && t.blocks_vision) {
      // Open door lets light through
      if (t.type === 'door' && t.is_open) return false;
      return true;
    }
    // Explicit wall objects (line segments in world px)
    for (const w of walls) {
      if (_segmentNearPoint(w.x1, w.y1, w.x2, w.y2, x, y, 2)) return true;
    }
    return false;
  };
}
```

`_hexPixelToKey` already exists in the current code (check
`_screenToGrid` for hex branch). If not, add it — it's the inverse
of the hex drawing math in `_drawHexGrid`.

`_segmentNearPoint(ax, ay, bx, by, px, py, tol)` is a tiny
point-to-segment distance helper. Write it as a standalone module
function at the top of `map-canvas.js`.

#### Rewrite of the lighting loop

```js
_renderLightingOverlay(ctx) {
  const isGm = this.role === 'gm';
  const softFactor = isGm ? 0.35 : 1.0;
  const darkAlpha = (this.isIndoor
      ? 0.88
      : Math.max(0, 1 - (this.ambientLight ?? 1.0))) * softFactor;
  if (darkAlpha <= 0 && !this.lights.length) return;

  const w = this.canvas.width, h = this.canvas.height;
  this._ensureLightLayer(w, h);
  const lctx = this._lightLayerCtx;
  lctx.clearRect(0, 0, w, h);
  lctx.fillStyle = `rgba(0,0,0,${darkAlpha})`;
  lctx.fillRect(0, 0, w, h);

  if (!this.lights.length) {
    ctx.drawImage(this._lightLayer, 0, 0);
    return;
  }

  const gs = this.gridSize;
  const blocksAt = this._makeBlocksAt();

  lctx.globalCompositeOperation = 'destination-out';
  for (const light of this.lights) {
    const radius = light.radius_cells ?? 4;
    const radiusPx = radius * gs;
    const cxWorld = (light.col + 0.5) * gs;
    const cyWorld = (light.row + 0.5) * gs;
    const poly = this._raycastPolygon(cxWorld, cyWorld, radiusPx, blocksAt, 120);

    // World → screen
    const sx = cxWorld * this.scale + this.offsetX;
    const sy = cyWorld * this.scale + this.offsetY;
    const rPx = radiusPx * this.scale;

    // Build screen-space polygon path
    lctx.save();
    lctx.beginPath();
    for (let i = 0; i < poly.length; i++) {
      const px = poly[i][0] * this.scale + this.offsetX;
      const py = poly[i][1] * this.scale + this.offsetY;
      if (i === 0) lctx.moveTo(px, py); else lctx.lineTo(px, py);
    }
    lctx.closePath();
    lctx.clip();

    // Soft radial gradient inside the polygon
    const intensity = light.intensity ?? 1.0;
    const grad = lctx.createRadialGradient(sx, sy, 0, sx, sy, rPx);
    grad.addColorStop(0,   `rgba(0,0,0,${intensity * softFactor})`);
    grad.addColorStop(0.6, `rgba(0,0,0,${intensity * 0.5 * softFactor})`);
    grad.addColorStop(1,   'rgba(0,0,0,0)');
    lctx.fillStyle = grad;
    lctx.fillRect(sx - rPx, sy - rPx, rPx * 2, rPx * 2);
    lctx.restore();
  }
  lctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(this._lightLayer, 0, 0);
}

_ensureLightLayer(w, h) {
  if (!this._lightLayer) {
    this._lightLayer = document.createElement('canvas');
    this._lightLayerCtx = this._lightLayer.getContext('2d');
  }
  if (this._lightLayer.width !== w || this._lightLayer.height !== h) {
    this._lightLayer.width = w;
    this._lightLayer.height = h;
  }
}
```

#### Tests

**Two layers of tests — both required.**

**Layer A: `tests/test_phase13_lighting_r1.py`** (pure Python
unit tests on the raycaster logic, translated from JS or exposed
via a small helper). Must fail on `HEAD^` and pass on `HEAD`:

```python
def test_raycast_polygon_expands_in_open_space():
    # Light in an empty 20x20 grid. Polygon has ~120 vertices
    # all at radius_cells * tile_size from the origin (±1 px).
    ...

def test_raycast_polygon_clipped_by_wall():
    # Single wall tile east of the light. Eastern vertices must
    # be < radius_cells * tile_size. Western vertices unaffected.
    ...

def test_raycast_polygon_hex_grid():
    # Same as above on a hex grid_type location.
    ...
```

**Layer B: `tests/e2e/test_phase13_lighting_r1.py`** (Playwright,
uses the live server + `_no_console_errors` fixture). Follow the
exact template from `tests/e2e/test_map_renders.py`:

```python
from playwright.sync_api import Page, expect

def test_light_polygon_is_smooth_not_staircase(gm_page: Page):
    """Place a light next to a wall, sample pixels along the
    light–wall boundary, assert the alpha falls off monotonically
    (no stair-step jumps > 60/255 between adjacent x-values)."""
    gm_page.locator('[data-tab="map"]').click()
    # ... seed a bv2 light + wall via API using live_server fixture
    gm_page.wait_for_timeout(500)
    alpha_strip = gm_page.evaluate("""({cx, cy, len}) => {
        const c = document.getElementById('map-canvas');
        const ctx = c.getContext('2d');
        const row = ctx.getImageData(cx, cy, len, 1).data;
        const out = [];
        for (let i = 3; i < row.length; i += 4) out.push(row[i]);
        return out;
    }""", {"cx": ..., "cy": ..., "len": 200})
    # Adjacent pixels must not jump > 60/255 (stair-step detection)
    for i in range(1, len(alpha_strip)):
        assert abs(alpha_strip[i] - alpha_strip[i-1]) < 60, \
            f"stair-step at x={i}: {alpha_strip[i-1]} → {alpha_strip[i]}"

def test_light_on_hex_grid_renders(gm_page: Page):
    """Same assertion on a hex-grid location. If hex isn't
    implemented yet the test MUST fail — do not skip it."""
    ...
```

The Playwright tests are **mandatory**. The unit tests alone
would have let the previous split regression through — only the
E2E `_no_console_errors` fixture caught it. Same class of bug is
likely here.

#### R1 exit criteria (ALL must be checked)

- [ ] `pytest tests/ -q --ignore=tests/e2e` — all green (88+
      pre-existing tests).
- [ ] `pytest tests/e2e -v --browser chromium` — all green,
      including the **new** R1 Playwright tests. The
      `_no_console_errors` autouse fixture must be active (it
      already is). Any JS error in any page fails the suite.
- [ ] At least 3 new unit tests (`test_phase13_lighting_r1.py`)
      AND at least 2 new Playwright tests
      (`test_phase13_lighting_r1.py` in `tests/e2e/`).
- [ ] **Proof of regression catch:** run `git stash && pytest
      tests/e2e/test_phase13_lighting_r1.py && git stash pop`.
      The stashed run MUST fail (test fails without the fix).
      The post-pop run MUST pass. Paste both outputs in chat.
- [ ] DevTools console screenshot on `/gm` Map tab — must be
      empty.
- [ ] Before/after visual screenshot of the torch beside a wall.
- [ ] Commit message: `Phase 13 REDO R1: polygon-based light shapes`.

---

### R2 — Coloured lights, bright/dim radii, additive blending
**Done — `f1d1bb5`**

**Goal:** lights tint their area with their `color_hex`.
Overlapping lights blend additively. Introduce `bright_radius_cells`
on the model.

#### Model migration

`app/models.py`, class `BV2Light` (around line 1390):

```python
# Add after radius_cells
bright_radius_cells: Mapped[float] = mapped_column(Float, default=0.0)
# 0.0 = auto (radius_cells * 0.5). >0 = explicit.
```

Migration:
- Add `bright_radius_cells FLOAT DEFAULT 0.0` to `bv2_lights`.
- Follow the project's existing migration pattern — look at the
  most recent migration script (probably `migrate_*.py` in project
  root) and mirror its idempotent pattern.

#### Endpoint update

`app/routers/builder_v2/lights.py`:
- `create_light` / `update_light` accept optional
  `bright_radius_cells` in the body, clamped `0 ≤ v ≤ radius_cells`.
- `ser_light` in `common.py` includes the new field.
- `app/routers/map/files.py::_build_state_from_bv2` lights dict
  includes `bright_radius_cells`.

Resolve auto-default on the wire, not in the model, so the client
always sees a real number:

```python
"bright_radius_cells": (li.bright_radius_cells
                        if li.bright_radius_cells and li.bright_radius_cells > 0
                        else li.radius_cells * 0.5),
```

#### Renderer refactor

The **blend strategy changes**. Previous approach: draw darkness
sheet, punch holes with `destination-out`. New approach:

1. Fill `lightLayer` with the darkness colour (black at full
   ambient, down to transparent at ambient=1).
2. For each light, draw a **coloured** radial gradient in a
   **second layer** with blend `lighter` (additive).
3. Composite that lights-layer onto the darkness layer with
   blend `screen` — bright areas reveal the map and tint it.
4. Draw the result onto the main `ctx` with blend `multiply`
   so the map's existing pixels are darkened/tinted, not replaced.

Two offscreen canvases needed: `_darkLayer` and `_lightLayer`.
Rename the existing `_lightLayer` carefully.

```js
_renderLightingOverlay(ctx) {
  const w = this.canvas.width, h = this.canvas.height;
  this._ensureLayer('dark', w, h);
  this._ensureLayer('light', w, h);
  const dctx = this._darkLayer.getContext('2d');
  const lctx = this._lightLayer.getContext('2d');

  // ── Darkness veil ──
  const ambient = this.ambientLight ?? 1.0;
  const darkAlpha = this.isIndoor ? 0.88 : Math.max(0, 1 - ambient);
  dctx.clearRect(0, 0, w, h);
  dctx.fillStyle = `rgba(0,0,0,${darkAlpha})`;
  dctx.fillRect(0, 0, w, h);

  // ── Light layer (additive) ──
  lctx.clearRect(0, 0, w, h);
  lctx.globalCompositeOperation = 'lighter';
  const blocksAt = this._makeBlocksAt();
  for (const light of this.lights) {
    this._drawOneLight(lctx, light, blocksAt);
  }
  lctx.globalCompositeOperation = 'source-over';

  // ── Subtract light from darkness ──
  dctx.globalCompositeOperation = 'destination-out';
  dctx.drawImage(this._lightLayer, 0, 0);
  dctx.globalCompositeOperation = 'source-over';

  // ── Composite onto the main canvas ──
  // Step A: darken the map where unlit.
  ctx.drawImage(this._darkLayer, 0, 0);
  // Step B: multiply the map by the coloured light (tints it).
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(this._lightLayer, 0, 0);
  ctx.restore();
}

_drawOneLight(lctx, light, blocksAt) {
  const gs = this.gridSize;
  const radius = light.radius_cells ?? 4;
  const bright = (light.bright_radius_cells && light.bright_radius_cells > 0)
      ? light.bright_radius_cells
      : radius * 0.5;
  const radiusPx = radius * gs;
  const cxWorld = (light.col + 0.5) * gs;
  const cyWorld = (light.row + 0.5) * gs;
  const poly = this._raycastPolygon(cxWorld, cyWorld, radiusPx, blocksAt, 120);
  const sx = cxWorld * this.scale + this.offsetX;
  const sy = cyWorld * this.scale + this.offsetY;
  const rPx = radiusPx * this.scale;
  const brightPx = bright * gs * this.scale;

  // Polygon clip (same as R1)
  lctx.save();
  lctx.beginPath();
  for (let i = 0; i < poly.length; i++) {
    const px = poly[i][0] * this.scale + this.offsetX;
    const py = poly[i][1] * this.scale + this.offsetY;
    if (i === 0) lctx.moveTo(px, py); else lctx.lineTo(px, py);
  }
  lctx.closePath();
  lctx.clip();

  // Colour gradient. Bright radius = full colour, dim = fade out.
  const rgb = _hexToRgb(light.color_hex || '#ffd9a0');
  const intensity = Math.min(1.5, light.intensity ?? 1.0);
  const a0 = 1.0 * intensity;
  const a1 = 0.5 * intensity;
  const grad = lctx.createRadialGradient(sx, sy, 0, sx, sy, rPx);
  const stopAtBright = Math.min(0.99, brightPx / rPx);
  grad.addColorStop(0,             `rgba(${rgb.r},${rgb.g},${rgb.b},${a0})`);
  grad.addColorStop(stopAtBright,  `rgba(${rgb.r},${rgb.g},${rgb.b},${a1})`);
  grad.addColorStop(1,             `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
  lctx.fillStyle = grad;
  lctx.fillRect(sx - rPx, sy - rPx, rPx * 2, rPx * 2);
  lctx.restore();
}

function _hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
```

#### Builder UI

`static/js/builder_v2/70-lights.js` modal:
- Add a slider "Bright radius" 0..radius. 0 = auto.
- Persist via the existing PATCH endpoint.

HTML: add the slider to `bv2-light-modal`. Follow the existing
markup style for radius/intensity inputs.

#### Tests

`tests/test_phase13_lighting_r2.py`:
- Model migration adds column with default 0.
- POST/PATCH accept and echo back `bright_radius_cells`.
- `_build_state_from_bv2` resolves the auto default (0 → radius/2).

#### R2 exit criteria (ALL must be checked)

- [ ] `pytest tests/ -q --ignore=tests/e2e` — all green.
- [ ] `pytest tests/e2e -v --browser chromium` — all green with
      `_no_console_errors` active. +4 new E2E tests that assert
      **pixel colour** (not just alpha) of a stone-floor cell
      warms when a coloured torch is placed over it, via
      `ctx.getImageData` reading the RGB channels.
- [ ] Migration script added and idempotent (safe to re-run).
      Test: `pytest tests/test_migration_bright_radius.py` green.
- [ ] Proof-of-regression-catch: `git stash` the migration +
      renderer changes, run the new E2E tests — all fail. Pop,
      run — all pass. Paste both in chat.
- [ ] DevTools console screenshot on `/gm` and `/player` — empty.
- [ ] Before/after visual: one torch, two-torch intersection,
      bright-radius slider change.
- [ ] Commit: `Phase 13 REDO R2: coloured lights with additive blend`.

---

### R3 — Animation, token vision, day/night
**Done — `b539c83`**

**Goal:** polish. Lights feel alive; darkness slider controls mood.

#### Animation

Add a single renderer-level RAF loop, started only when at least
one light has an animated `source_kind`:

```js
_startLightAnim() {
  if (this._lightRaf) return;
  const tick = () => {
    this._lightAnimPhase = (performance.now() / 1000);
    // Force a re-render only when needed. Throttle to ~30fps:
    if (!this._lightAnimFrame) {
      this._lightAnimFrame = true;
      requestAnimationFrame(() => {
        this._lightAnimFrame = false;
        this.render();
      });
    }
    this._lightRaf = requestAnimationFrame(tick);
  };
  this._lightRaf = requestAnimationFrame(tick);
}

_stopLightAnim() {
  if (this._lightRaf) cancelAnimationFrame(this._lightRaf);
  this._lightRaf = null;
}

// In setLights: start or stop the loop.
setLights(arr) {
  this.lights = arr || [];
  const animated = this.lights.some(l =>
    l.source_kind === 'torch' || l.source_kind === 'magic');
  if (animated) this._startLightAnim(); else this._stopLightAnim();
  this.render();
}
```

In `_drawOneLight`, perturb intensity/radius per source_kind:

```js
let intensityMod = 1.0, radiusMod = 1.0;
if (light.source_kind === 'torch') {
  // Value-noise flicker at ~8Hz, ±10%
  const n = Math.sin(this._lightAnimPhase * 8 + light.id * 1.7)
          * 0.5
          + Math.sin(this._lightAnimPhase * 13 + light.id * 0.3) * 0.5;
  intensityMod = 1 + n * 0.1;
} else if (light.source_kind === 'magic') {
  // Pulse at 2Hz, ±5% radius
  radiusMod = 1 + Math.sin(this._lightAnimPhase * 2 * Math.PI * 2 + light.id) * 0.05;
}
const intensity = Math.min(1.5, (light.intensity ?? 1.0) * intensityMod);
const radiusPx = radius * gs * radiusMod;
```

**Performance guard:** only animate while the map tab is visible.
Hook off `document.visibilitychange`.

#### Token-carried vision

Existing model field: `Character.sight_range_cells`.

In `_renderLightingOverlay`, after drawing static lights, iterate
over `this.tokens` and draw **colourless** additive light:

```js
for (const t of this.tokens) {
  if (!t.sight_range_cells || t.sight_range_cells <= 0) continue;
  const fake = {
    id: -t.character_id,
    col: Math.floor(t.x * this.mapWidth / this.gridSize),
    row: Math.floor(t.y * this.mapHeight / this.gridSize),
    radius_cells: t.sight_range_cells,
    bright_radius_cells: t.sight_range_cells * 0.5,
    color_hex: '#ffffff',
    intensity: 0.8,
    source_kind: 'sight',
  };
  this._drawOneLight(lctx, fake, blocksAt);
}
```

Players see the fog only where at least one token's sight polygon
covers it. GM still sees everything — `softFactor` already handles
that for the darkness layer.

#### Day/night slider

Already exists per-location as `ambient_light`. R3 action: make
sure the builder slider is *obviously visible* at the top of the
Light panel, add a global "Darkness" label, and verify the player
canvas updates live on WS `bv2.location_updated`.

No model changes. Just UX.

#### Tests

`tests/test_phase13_lighting_r3.py`:
- RAF loop starts only with animated sources.
- Token with `sight_range_cells > 0` produces an entry in the
  rendered light set (mock out `_drawOneLight` and spy).
- Darkness slider round-trips.

#### R3 exit criteria (ALL must be checked)

- [ ] `pytest tests/ -q --ignore=tests/e2e` — all green.
- [ ] `pytest tests/e2e -v --browser chromium` — all green with
      `_no_console_errors`. +3 new E2E tests:
      1. Torch flicker: sample the same pixel at `t=0ms` and
         `t=200ms`; alpha values must differ (animation is live).
      2. Magic pulse: same, at `t=0ms` vs `t=500ms`; radial
         coverage must differ.
      3. Token-vision: spawn a token with `sight_range_cells=5`
         in a dark room, assert the canvas has non-zero pixels in
         a ring around the token's world position.
- [ ] Animation loop stops when `document.hidden === true`. Unit
      test that covers the visibilitychange handler.
- [ ] Proof-of-regression-catch as in R1/R2.
- [ ] DevTools console empty.
- [ ] Before/after demo gif (or 2-3 screenshots) showing flicker,
      pulse, darkness slider.
- [ ] Commit: `Phase 13 REDO R3: animation + vision + darkness`.
- [ ] R3 also **deletes** `_renderLightingOverlay_legacy` from
      `lighting.js` — the legacy-keep was only for R1/R2 review.

---

## 5. Anti-fail rules

1. **Single renderer.** No second canvas layer on top of
   `map-canvas`. All changes inside the 8-module `MapCanvas` split.
   No new globals outside `_lightLayer` / `_darkLayer`.
2. **Canvas2D only.** No WebGL, no Pixi, no shaders, no external
   asset packs. If a shader is the only way to do an effect,
   skip the effect.
3. **No hex shortcuts.** Every new code path has to exercise
   both `grid_type` values. If a feature cannot work on hex,
   ship it for square only with an early-return guard
   *and* a `// TODO hex` — do not `console.warn` and move on.
4. **Performance budget.** Full re-render with 20 lights at
   2k × 2k canvas must stay under 16 ms on a mid-laptop. If
   profiling shows the raycaster is the hotspot, reduce
   `numRays` to 60 and document it. Do not cache polygons
   across frames unless lights + walls are unchanged.
5. **Do NOT add `?v=` cache-bust query strings.** The no-cache
   headers in `main.py` handle this for dev. An ordinary F5
   serves fresh JS. If you find yourself editing HTML just to
   bump a `?v=`, STOP — you are doing the wrong thing. (The
   old `scripts/cache_bust.py` still exists as a belt-and-
   suspenders measure, but it no longer matters.)
6. **Split-module syntax rule.** Every new method on `MapCanvas`
   goes inside the IIFE of its owning file as
   `MapCanvas.prototype.X = function () {...}`. **No** `get X()`
   getter syntax outside a `class {}` body — that is a
   `SyntaxError` in IIFE context and was the exact bug in the
   post-split hotfix. For computed properties, use
   `Object.defineProperty(MapCanvas.prototype, 'X', { get: ... })`
   in `index.js`.
7. **Test first, commit after.** Every round ends with
   `pytest tests/ -q` AND `pytest tests/e2e -v --browser chromium`
   green, both with `_no_console_errors` active. No merging while
   any test is red and no merging while DevTools console shows
   anything.
8. **Proof-of-regression-catch is mandatory.** Before saying
   "done", run the NEW tests against `HEAD^` (use `git stash`
   on your fix) and paste the FAILURE output. Then run against
   `HEAD` and paste the PASS output. If the stashed run passes,
   your test is broken. Fix the test, not the fix.
9. **Rollback-friendly commits.** Each round is exactly one
   commit. Never mix R1 + R2 into one commit. If R2 turns
   out buggy, we must be able to `git revert` just R2 and keep
   R1.

---

## 6. Handoff checklist for each round

Copy-paste this into the chat message when you say the round is
done. Cascade will reject the handoff if any line is missing or
unchecked.

- [ ] `pytest tests/ -q --ignore=tests/e2e` — X passed, 2 failed
      (pre-existing rarity + player-location tests only).
- [ ] `pytest tests/e2e -v --browser chromium` — Y passed
      (including the N new tests for this round) with
      `_no_console_errors` autouse fixture ACTIVE.
- [ ] Proof-of-regression: pasted `git stash` failure output AND
      post-pop pass output in chat.
- [ ] DevTools console screenshot on `/gm` Map tab — empty.
- [ ] DevTools console screenshot on `/player` Map view — empty.
- [ ] Before/after visual screenshot(s) of the feature shipped.
- [ ] Commit message matches the R1/R2/R3 template above.
- [ ] This doc updated with a "Done — <commit sha>" note next to
      the round section.

**If you cannot produce any item above, the round is not done.**
Do not say "done with minor caveat" — there is no such state.
Either it is done with every checkbox, or it is in progress.

---

## 7. Out-of-scope (document but do not do now)

- Wall types (glass blocks movement not light, terrain blocks
  movement not sight). Defer to Phase 14.
- Colour lights on tokens (magic sword glow). Defer.
- Shadow-casting from tokens themselves. Defer.
- Smoke/fog particle systems. Defer.
- Ambient occlusion under walls. Defer.

---

## 8. Contact

Blocked / unclear step → ping Cascade in chat before guessing.
The Phase 13 Pixi failure cost two days of back-and-forth because
the Kenney coordinates were guessed. Do not guess on this one.
