# Phase 13 — PixiJS (WebGL) Renderer Migration

**Audience:** Kimi K2.6.

**Mandate:** Replace the Canvas2D renderer used by `map-canvas.js`
and `builder_v2/20-mapview.js` with a PixiJS-based renderer. Goal
is "Foundry-VTT-tier minimum": 60 FPS on 30×30 maps with 8 lights,
soft circular lighting, smooth pan/zoom, smooth token movement,
real Kenney sprites.

**Why.** Phase 12 left the app **slower and uglier** than before:
- Lighting has hard "ring" artifacts (gradient stops are wrong).
- Builder lags during wheel-zoom (no RAF coalescing, FOV recomputed
  per frame per light).
- Token movement freezes the map (no rAF loop driving interpolation).
- Sprites are programmatically-generated solid PNGs that look worse
  than the previous flat colours.

**Strategy.** **Parallel implementation with feature flag**, NOT
big-bang rewrite. Old Canvas2D stays alive every round; new Pixi
renderer is opt-in via `window.USE_PIXI` until parity is reached.

---

## RULES (non-negotiable)

Carry over **all R-T rules** from `docs/AGENT_NOTES.md`,
`docs/PHASE_10_PLAN.md`. In addition:

- **R-P1 (parallel).** Every round MUST leave the app fully working
  with `USE_PIXI=false` (default). Pixi is opt-in until the final
  round flips the default.
- **R-P2 (per-round runnable).** End of every round = `pytest tests/`
  green, app loads, GM and Player tabs render correctly with both
  `USE_PIXI=false` AND `USE_PIXI=true`.
- **R-P3 (no Canvas2D regressions).** You MUST NOT modify the
  existing `render()` codepath in `map-canvas.js` or
  `builder_v2/20-mapview.js` outside of:
    - adding a `useExternalRenderer` early-return guard at the top,
    - and adding a public `getCanvasElement()` accessor.
  All other Pixi work goes into NEW files.
- **R-P4 (asset hygiene).** Real Kenney Roguelike Pack PNGs
  ONLY — placeholder solid-colour PNGs are deleted. Atlas packed
  with `pixi-spritesheet` JSON, not loose files.
- **R-P5 (Pixi version pin).** Use **PixiJS v7.4.x** (stable, ~400 KB
  gzipped, mature ecosystem). NOT v8 (still in flux).
- **R-P6 (no PIXI globals leaked).** Pixi imported as ES module
  inside a single `pixi-renderer.js` boundary. No `window.PIXI`
  unless the CDN forces it (then namespace it as
  `window.__PIXI__` to avoid clobbering).

---

## SCOPE

**In scope:** GM map (`/gm`), Player map (`/player`), Builder map
(`/builder`). Pan, zoom, tokens, walls, doors, floors, lighting,
fog of war, interior zones, edges, drawings, FX, measure tool,
grid (GM-only), token portraits, HP rings.

**Out of scope (Phase 14+):** Ground textures with normal maps,
animated water/lava shaders, particle FX systems, dynamic shadows
behind tokens, multi-floor / parallax. We commit to **flat
sprites + radial lights + mask-based fog** — that is already
Foundry-tier.

---

## ROUND 1 — Stack, assets, asset pipeline

### 1.1 — Install PixiJS

**No npm — vendored.** Drop `pixi.min.js` v7.4.3 into
`static/vendor/pixi/pixi.min.js` (~410 KB). Add to base template
BEFORE any of our scripts:

```html
<script src="/static/vendor/pixi/pixi.min.js?v=13"></script>
```

Sanity check at end of round: `typeof PIXI === 'object' && PIXI.VERSION.startsWith('7.')`.

### 1.2 — Real assets

Download Kenney **Roguelike Pack** (CC0) once. Store the originals
under `assets-src/kenney-roguelike/` (gitignored). Pack into a
single atlas using a one-shot Python script:

```
scripts/pack_atlas.py
  → reads assets-src/kenney-roguelike/Tiles/*.png
  → writes static/assets/atlas/world.png + world.json
  → mapping: floor_stone, floor_wood, floor_grass, wall_stone,
    wall_wood, door_closed, door_open, water, lava, pit, rough,
    grass_short, dirt, sand, cobble  (15 entries minimum)
```

The script must use Pillow only (already a dep). Atlas resolution:
512×512, padding 2 px, no rotation.

**Delete** `static/assets/tiles/*.png` (the placeholder set) at
the end of this step.

### 1.3 — Loader boundary

Create `static/js/pixi/00-loader.js`:

```js
'use strict';
window.PixiAtlas = (() => {
  let _sheet = null;
  async function load() {
    if (_sheet) return _sheet;
    _sheet = await PIXI.Assets.load('/static/assets/atlas/world.json');
    return _sheet;
  }
  function tex(name) {
    if (!_sheet) throw new Error('PixiAtlas.load() not awaited yet');
    const t = _sheet.textures[name];
    if (!t) console.warn(`atlas miss: ${name}`);
    return t || PIXI.Texture.WHITE;
  }
  return { load, tex };
})();
```

### 1.4 — Test

`tests/test_phase13_atlas.py`:
- Asserts `static/assets/atlas/world.png` exists, is non-zero size,
  is a valid PNG (Pillow open).
- Asserts `world.json` is parseable, has `frames` dict with at least
  the 15 names above.
- Asserts `static/assets/tiles/*.png` is **gone** (cleanup verified).

### 1.5 — Manual verification

Open `/gm`, `/player`, `/builder`. App MUST behave identically to
pre-R1 (Pixi script loaded but not used). Console: no errors.

### 1.6 — Definition of done

- [ ] `pixi.min.js` present, version 7.4.x.
- [ ] `static/assets/atlas/world.{png,json}` exists with ≥15 frames.
- [ ] `scripts/pack_atlas.py` runnable: `python scripts/pack_atlas.py`.
- [ ] `static/js/pixi/00-loader.js` exposes `window.PixiAtlas`.
- [ ] `static/assets/tiles/*.png` placeholder set deleted.
- [ ] `pytest tests/test_phase13_atlas.py` green.
- [ ] Manual: app unchanged from user POV.
- [ ] Commit: `Phase 13 R1: Pixi stack + Kenney atlas`.

---

## ROUND 2 — Pixi static-world renderer (no interactivity yet)

Build the smallest possible Pixi renderer that draws the same
visual as the current `_drawTiles` + walls + grid, but in WebGL
using the atlas.

### 2.1 — Renderer skeleton

`static/js/pixi/10-renderer.js`:

```js
'use strict';
class PixiMapRenderer {
  constructor(hostEl) {
    this.host = hostEl;
    this.app = new PIXI.Application({
      resizeTo: hostEl,
      backgroundColor: 0x0a0908,
      antialias: false,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
    });
    hostEl.appendChild(this.app.view);

    // Layer hierarchy (z-order):
    //   world          (panned/zoomed)
    //     tilesLayer        — floors, walls, doors  (sprites, cached)
    //     gridLayer         — grid lines  (Graphics, GM only)
    //     overlaysLayer     — interior zones, drawings, measure
    //     tokensLayer       — character/NPC sprites + portraits
    //     fxLayer           — combat FX
    //   lightingLayer  (screen-space, blends with world)
    //   fogLayer       (screen-space, alpha mask)
    this.world = new PIXI.Container();
    this.tilesLayer = new PIXI.Container();
    this.gridLayer = new PIXI.Graphics();
    this.overlaysLayer = new PIXI.Container();
    this.tokensLayer = new PIXI.Container();
    this.fxLayer = new PIXI.Container();
    this.world.addChild(
      this.tilesLayer, this.gridLayer, this.overlaysLayer,
      this.tokensLayer, this.fxLayer);
    this.app.stage.addChild(this.world);

    this.lightingLayer = new PIXI.Container();
    this.app.stage.addChild(this.lightingLayer);

    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.gridSize = 50;
    this.role = 'player';
  }

  destroy() { this.app.destroy(true, { children: true, texture: false }); }

  setTiles(tilesMap, gridType) { /* R2.2 */ }
  setGridEnabled(on) { /* R2.3 */ }
  // setTokens, setLights, etc. arrive in later rounds.
}
window.PixiMapRenderer = PixiMapRenderer;
```

### 2.2 — Tiles → sprites

`setTiles(tilesMap, gridType)`:
- Clear `tilesLayer.children`.
- For each `[col,row] → tile`, push a `PIXI.Sprite(PixiAtlas.tex(name))`,
  position to `col*gs, row*gs`, size `gs × gs` (use `width/height`,
  not scale, so sprites tile crisply).
- Mapping (extend `TILE_VISUAL` server-side or duplicate in JS):
    - `floor` → `floor_stone`
    - `floor_wood` → `floor_wood`
    - `floor_grass` → `floor_grass`
    - `wall` → `wall_stone`
    - `door` open/closed → `door_open` / `door_closed`
    - `water` → `water`, etc.
- For walls, also draw a 2-px south/east drop-shadow strip via a
  `PIXI.Graphics` rectangle with alpha 0.4 — unless the neighbour
  is also a wall. (Same logic as Phase 12 R3 but in Pixi.)
- After populating, **cache** the layer:
  `this.tilesLayer.cacheAsBitmap = true`. Pan/zoom now blits one
  texture instead of re-drawing 900 sprites.
- Invalidate cache on next `setTiles()` call by setting
  `cacheAsBitmap = false` first, then `true` again after rebuild.

### 2.3 — Grid

`setGridEnabled(on)` + `setGridStyle({color, width})`:
- If `role === 'player' || !on`, clear `gridLayer` and return.
- Otherwise stroke a Graphics grid covering `mapWidth × mapHeight`
  with `lineStyle(1/this.scale, color, 0.4)`.

### 2.4 — Pan/zoom

Wheel + drag bound directly on `this.app.view`:
- Wheel: scale `world.scale.set(newScale)`, anchor on cursor.
- Right-drag: translate `world.position`.
- All inputs go through a single `_apply()` method that updates
  `world.position` + `world.scale` once per frame via
  `this.app.ticker.addOnce(...)` style.

### 2.5 — Wire-up (parallel, opt-in)

In `templates/base.html` (or wherever `map-canvas.js` is included):

```html
{% if request.cookies.get('USE_PIXI') == '1' %}
  <script src="/static/js/pixi/00-loader.js?v=13"></script>
  <script src="/static/js/pixi/10-renderer.js?v=13"></script>
{% endif %}
```

In `static/js/gm/06-map-main.js` (and equivalents in player + builder):
- Detect `window.USE_PIXI = (document.cookie.includes('USE_PIXI=1'))`.
- If true and `PixiMapRenderer` exists:
    - Hide the Canvas2D `<canvas>` element.
    - Build a host `<div>` next to it.
    - Construct `new PixiMapRenderer(host)`, store as
      `window.__pixiRenderer`.
    - Forward the SAME data (tiles, grid) to it whenever the
      Canvas2D version is updated. Keep both running in lockstep
      this round so we can A/B compare.

### 2.6 — Test

`tests/test_phase13_pixi_smoke.py`:
- Static check only (no headless WebGL): asserts the new JS files
  exist and contain the expected exports
  (`window.PixiMapRenderer`, `setTiles`, `setGridEnabled`).
- Asserts the cookie-gated `<script>` block is present in the
  rendered HTML when cookie is set.

### 2.7 — Manual verification

1. `USE_PIXI=0` (default): everything works as before.
2. Set cookie `USE_PIXI=1` (DevTools → Application → Cookies),
   reload `/gm`. Canvas2D map is hidden, Pixi map shows the SAME
   tile layout, walls, grid (GM-only), pan with right-drag,
   zoom with wheel.
3. No tokens, no lights yet — those arrive in R3/R4.
4. Both `/player` and `/builder` work the same way under the cookie.
5. FPS: open DevTools Performance, record 5 s of zooming on a
   30×30 map. Average FPS ≥ 58.

### 2.8 — Definition of done

- [ ] `static/js/pixi/{00-loader,10-renderer}.js` created.
- [ ] Atlas loads, all expected frames available.
- [ ] Pixi static world renders identically to Canvas2D under cookie.
- [ ] Pan + zoom smooth, no Pixi-side console errors.
- [ ] FPS ≥ 58 on zoom storm test.
- [ ] `pytest -k phase13_pixi_smoke` green.
- [ ] Commit: `Phase 13 R2: Pixi static world renderer`.

---

## ROUND 3 — Tokens, drag, FX, drawings

### 3.1 — Tokens

`PixiMapRenderer.setTokens(tokens)`:
- For each token, get-or-create a child `PIXI.Container`
  in `tokensLayer` keyed by `character_id`. Container holds:
    - `bgCircle` (Graphics) — coloured fallback.
    - `portrait` (Sprite) — texture loaded from `token_image_url`
      via `PIXI.Assets.load(url)` (cached per URL by Pixi).
      `mask` it with a circle Graphics so the portrait is round.
    - `hpRing` (Graphics) — green > 50%, yellow > 25%, red ≤ 25%.
    - `label` (Text) — name initial when no portrait.
- On every `setTokens` call, diff: remove containers whose
  `character_id` no longer present, update positions, ring colours.

### 3.2 — Smooth movement

`animateTokenTo(charId, x, y)`:
- Store `{prev, target, t0}` in `_tokenAnims`.
- Use `app.ticker` (not your own rAF) — register a per-frame handler
  that lerps every entry with `easeOutCubic`, removes done entries.
  Pixi's ticker drives at the display refresh rate, fixing the
  Phase 12 freeze.

### 3.3 — Token drag

`pointerdown` on a token container starts drag mode (sets
`token.alpha = 0.6`, `cursor = 'grabbing'`); `pointermove` updates
position; `pointerup` snaps to grid centre and emits a custom DOM
event `pixi:token-dropped` with `{character_id, col, row}` so the
existing GM/Player JS can call the move API unchanged.

### 3.4 — FX, drawings, measure

Port the Canvas2D `_renderFx`, drawings, measure-tool overlays into
`overlaysLayer` and `fxLayer` Graphics objects. Update once per frame
inside the ticker. Reuse the same data structures
(`this.fx`, `this.drawings`, …).

### 3.5 — Tests

`tests/test_phase13_pixi_tokens.py`: static checks for the new
methods on the renderer + the `pixi:token-dropped` event name in
both `gm/06-map-main.js` and `player/10-map.js`.

### 3.6 — Manual verification

With `USE_PIXI=1`:
1. GM sees all tokens with portraits where `token_image_url` is set;
   coloured circles + initial otherwise.
2. HP rings change colour after a damage roll.
3. Drag a token in GM tab → token follows pointer smoothly → drop →
   server move call fires → Player tab sees token slide to the new
   cell over ~200 ms (animation visible, NOT teleport).
4. Cast Magic Missile (or any combat action with FX) — radial
   shock-wave shows over the target.

### 3.7 — Definition of done

- [ ] Tokens render with portraits + HP rings.
- [ ] Drag works, server round-trip works, Player sees animation.
- [ ] FX, drawings, measure ported.
- [ ] Pan+zoom still ≥ 58 FPS with 30 tokens visible.
- [ ] Commit: `Phase 13 R3: Pixi tokens, drag, FX`.

---

## ROUND 4 — Lighting + fog + interiors (the visual win)

### 4.1 — Lighting via mask + radial sprites

The trick that makes Foundry look the way it does:
1. Create a `darknessSprite` = full-canvas black `PIXI.Sprite`
   covering the world bounds, alpha = `1 - ambient_light`
   (or `0.88` indoors).
2. Create a `lightContainer` with `blendMode = ERASE`. For each
   light source, add a radial-gradient sprite (precomputed once
   in R4.0 below) sized to `radius_cells * 2 * gs`, positioned
   at the light, then **masked by the light's FOV polygon**.
3. The FOV polygon is a `PIXI.Graphics` triangle-fan built from
   the visible-cell set returned by the existing `computeVisibleCells`
   (server-side or client-side BV2 FOV — reuse).
4. Composite: `darknessSprite` + `lightContainer` (ERASE) → the
   lit area becomes transparent with a smooth radial falloff.
   Walls cleanly cut light because the FOV polygon stops there.

### 4.0 — Radial gradient texture (one-time bake)

In `00-loader.js`:

```js
function _bakeRadial() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  // MONOTONIC falloff — fixes the Phase 12 ring artifact.
  grad.addColorStop(0.00, 'rgba(255,255,255,1.00)');
  grad.addColorStop(0.50, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1.00, 'rgba(255,255,255,0.00)');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  return PIXI.Texture.from(c);
}
```

Cache as `PixiAtlas.radialTex`. Reused for every light.

### 4.2 — Fog of war

Same technique, second mask layer:
- `fogSprite` — full-canvas black, `alpha = 1.0`.
- For every revealed cell, add a small white square at that cell
  to a `revealedMask` Graphics with `blendMode = ERASE`.
- Currently-visible cells punch with `alpha = 1.0`;
  previously-explored cells punch with `alpha = 0.55` (so they
  show dim).

### 4.3 — Interiors

Roof = full-coverage rectangle in `overlaysLayer` per zone, alpha
0.95 for player when `reveal_mode === 'gm_only'` and player is
NOT inside; otherwise hidden. GM always sees alpha 0.25 as preview.

### 4.4 — Tests

`tests/test_phase13_lighting.py`: static check that
`pixi/10-renderer.js` references `radialTex`, `darknessSprite`,
`lightContainer.blendMode = 'erase'`. Plus an existing-test
assertion that lighting payloads still pass through the bridge.

### 4.5 — Manual verification (KEY MILESTONE)

1. Demo seed loaded. `/gm` with `USE_PIXI=1`:
    - Centre map, indoor=false, ambient 0.4 → outside is dim,
      torch lights show smooth circles fading to dark, **no rings,
      no banding**.
    - Walls cleanly cut light at the wall edge.
    - Open a door → light pours through.
2. `/player` joined as a PC:
    - FOV active: areas not currently in any token's vision are
      black; previously-seen areas are dim grey; currently-seen
      areas full-bright (modulated by lighting).
    - Walking into a building reveals interior; stepping back hides
      it again (roof returns).
3. FPS during heavy interaction (8 lights, 5 tokens moving, fog
   updating) ≥ 58.

### 4.6 — Definition of done

- [ ] Smooth circular lights, no rings, no banding.
- [ ] FOV polygon cuts light correctly at walls.
- [ ] Fog of war renders correctly per role.
- [ ] Interior zones reveal/hide per spec.
- [ ] FPS ≥ 58 in stress scene.
- [ ] Commit: `Phase 13 R4: Pixi lighting + fog + interiors`.

---

## ROUND 5 — Builder migration

Builder uses a different code path (`builder_v2/20-mapview.js`) but
the same atlas + renderer. Subclass or wrap:

`static/js/pixi/20-builder-renderer.js`:
- Extends `PixiMapRenderer` with brush preview, building rect
  preview, entity drawing, bounds handles, pending-zone overlay.
- Same `USE_PIXI` cookie gates the integration in
  `builder_v2/20-mapview.js`.

Manual verification: paint walls, drag building rect, place
lights/entities, switch between square/hex grid types
(hex stays Canvas2D for now — Pixi hex grid is Phase 14).

Definition of done:
- [ ] Builder paints, edits, saves, loads with `USE_PIXI=1`.
- [ ] No regressions in `pytest tests/`.
- [ ] Commit: `Phase 13 R5: Pixi builder renderer`.

---

## ROUND 6 — Flip default + remove Canvas2D dead code (LATER)

Only after the user has spent at least one full session on the demo
seed with `USE_PIXI=1` and confirms parity + perf:

- Flip default: `USE_PIXI=1` unless cookie says `=0`.
- After one more session: delete the legacy Canvas2D render paths
  from `map-canvas.js` and `builder_v2/20-mapview.js`. Keep the
  files (they still own input handling / state) but route all
  drawing through Pixi.

This round happens in a SEPARATE session and is NOT part of the
initial Kimi handoff.

---

## RISK REGISTER

| Risk | Mitigation |
|---|---|
| Pixi v7 breaking change vs v8 | Pinned to 7.4.x, vendored locally. |
| Atlas miss for unknown tile_type | `PixiAtlas.tex()` returns WHITE + console.warn — visible but non-fatal. |
| Memory leak from token textures | Use `PIXI.Assets.load`'s cache; on `setTokens` diff, call `texture.destroy()` only for tokens that disappear. |
| Mobile / low-end GPUs | `antialias: false`, `resolution = devicePixelRatio` capped at 2. |
| Hex grids | Out of scope for Phase 13 — falls back to Canvas2D when `gridType === 'hex'` (early-return in renderer). |
| Player can't see WS updates while Pixi initializes | Renderer construction is synchronous; only `PixiAtlas.load()` is async — front it with a "Loading map…" overlay until resolved. |

---

## TEST PLAN SUMMARY

New test files (NEVER modify existing tests — R-T1):
- `tests/test_phase13_atlas.py` — atlas + cleanup.
- `tests/test_phase13_pixi_smoke.py` — JS file presence + exports.
- `tests/test_phase13_pixi_tokens.py` — token methods + drop-event name.
- `tests/test_phase13_lighting.py` — lighting wiring constants.

These are static / file-presence tests. Real WebGL behaviour is
verified manually since headless WebGL is too brittle for CI.

---

## CACHE BUSTING

Every JS edit bumps the `?v=` query on its `<script>` tag. Use
`?v=13r1`, `?v=13r2`, etc., one bump per round, applied to ALL
edited files in that round.

---

## FINAL DELIVERABLE

A user session in which:
1. `/gm` opens, demo seed loads in < 2 s.
2. Lighting looks like Forge-VTT — soft, monotone falloff, walls
   block light cleanly.
3. Tokens slide between cells over 200 ms when a player moves.
4. Pan + zoom never drops below 58 FPS on 30×30.
5. Builder paints walls without lag, wheel-zoom is smooth.
6. Player view shows fog of war + lighting correctly, building
   roof reveals/hides on entry.
7. Console: 0 errors. `pytest tests/` green.

Then — and only then — Phase 13 is done.
