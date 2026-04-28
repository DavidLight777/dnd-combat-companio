# Phase 12 — Visual Overhaul to Forge/FoundryVTT-Tier Look

**Audience:** Kimi K2.6.

**Goal:** Transform the map from "primitive coloured squares with
hatching" to a polished, sprite-based, soft-lit world that resembles
hosted FoundryVTT (https://eu.forge-vtt.com/) maps.

**Constraints (decided by user):**
- Approach: **(a) sprite assets** (CC0 set baked into repo) — NOT
  procedural.
- Renderer: **(a) Canvas2D** — NOT a PixiJS rewrite.
- Phase split: bug-fixes (Phase 11) come FIRST, then this phase.
- Grid lines: **GM-only** (player sees no grid).
- Performance: **60 FPS** target on 30×30 maps with 8 lights.
- Token portraits: **use `token_image_url`** when set, else fallback
  to coloured circle with initial.

**Prerequisite reading:** `docs/AGENT_NOTES.md` rules section,
`docs/PHASE_10_PLAN.md` rules section. **All R-T rules apply**,
especially R-T1 (NEW tests, never modify existing).

---

## ROUND 1 — Asset pipeline + tile textures

### 1.1 — Pick the asset pack

Use **Kenney.nl Roguelike RPG Pack** (CC0, free).
Download URL: `https://kenney.nl/assets/roguelike-rpg-pack`.

Place sprites under `static/assets/tiles/`. Required files (all 16×16
or 32×32 PNG; pick one consistent size — recommend **32×32**):

```
static/assets/tiles/
  floor_stone.png      (used for tile_type='floor' default)
  floor_wood.png       (variant; use in indoor zones)
  floor_grass.png      (variant; outdoor open ground)
  wall_stone.png       (tile_type='wall')
  wall_wood.png        (variant)
  door_closed.png      (tile_type='door' is_open=false)
  door_open.png        (tile_type='door' is_open=true)
  water.png            (tile_type='water')
  lava.png             (tile_type='lava')
  pit.png              (tile_type='pit')
  rough.png            (tile_type='rough')
  fog_pattern.png      (subtle texture for fog of war)
```

Total size budget: **<3 MB**. If Kenney files are too small visually
at our scale, look at **OpenGameArt's "32x32 Dungeon Tileset"** by
Buch (also CC0, larger sprites).

**Commit the assets to the repo.** Do NOT lazy-load from CDN —
offline reliability matters for a self-hosted game.

### 1.2 — Sprite loader

New file `static/js/sprite-loader.js`:

```js
// Loads a registry of named sprites, returns a Promise that resolves
// when ALL are decoded. Cache the resulting HTMLImageElements.
const SPRITE_REGISTRY = {
  floor:        '/static/assets/tiles/floor_stone.png',
  floor_wood:   '/static/assets/tiles/floor_wood.png',
  floor_grass:  '/static/assets/tiles/floor_grass.png',
  wall:         '/static/assets/tiles/wall_stone.png',
  door_closed:  '/static/assets/tiles/door_closed.png',
  door_open:    '/static/assets/tiles/door_open.png',
  water:        '/static/assets/tiles/water.png',
  lava:         '/static/assets/tiles/lava.png',
  pit:          '/static/assets/tiles/pit.png',
  rough:        '/static/assets/tiles/rough.png',
};

const _sprites = {};
let _loadPromise = null;

function loadSprites() {
  if (_loadPromise) return _loadPromise;
  _loadPromise = Promise.all(Object.entries(SPRITE_REGISTRY).map(
    ([key, url]) => new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { _sprites[key] = img; resolve(); };
      img.onerror = () => {
        console.warn(`sprite ${key} failed to load — fallback to color`);
        _sprites[key] = null;
        resolve();
      };
      img.src = url;
    })
  ));
  return _loadPromise;
}

window.SpriteRegistry = {
  load: loadSprites,
  get: (key) => _sprites[key] || null,
  has: (key) => !!_sprites[key],
};
```

Load it BEFORE `map-canvas.js` in both `gm.html` and `player.html`:
```html
<script src="/static/js/sprite-loader.js"></script>
```

Bootstrap: in both pages, before instantiating `MapCanvas`,
`await window.SpriteRegistry.load()`. If sprites fail (offline or
404), the loader resolves null and `_drawTiles` falls back to the
existing colour rendering — NO crash.

### 1.3 — Tile rendering

In `static/js/map-canvas.js` `_drawTiles` (or the equivalent
function — find the loop that fills coloured rects per tile), replace
the colour-fill path:

```js
// OLD (kept as fallback):
// ctx.fillStyle = TILE_COLOR[tile.type];
// ctx.fillRect(x, y, gs, gs);

// NEW:
const sprite = window.SpriteRegistry?.get(tile.type) ||
               window.SpriteRegistry?.get('floor');  // fallback
if (sprite) {
  ctx.drawImage(sprite, x, y, gs, gs);
} else {
  ctx.fillStyle = TILE_COLOR[tile.type] || '#3a3530';
  ctx.fillRect(x, y, gs, gs);
}
```

Doors: pick `door_open` or `door_closed` based on `tile.is_open`.

The diagonal-hatch wall pattern (`createPattern` etc.) — REMOVE
entirely. The wall sprite handles its own visual.

### 1.4 — Tests

```python
@pytest.mark.asyncio
async def test_phase12_sprite_assets_present(client):
    """Each registered sprite path resolves to a real file (200 OK)."""
    sprites = [
        "floor_stone.png", "floor_wood.png", "floor_grass.png",
        "wall_stone.png", "door_closed.png", "door_open.png",
        "water.png", "lava.png", "pit.png", "rough.png",
    ]
    for name in sprites:
        r = await client.get(f"/static/assets/tiles/{name}")
        assert r.status_code == 200, f"missing sprite: {name}"
        assert int(r.headers.get("content-length", "0")) > 0
```

### Manual verification

- Open Map tab. Floor cells render as stone texture, walls as solid
  stone bricks, doors as wood-and-iron icons.
- Toggle a door open in Builder → sprite changes immediately.
- Performance: still 60 FPS at 30×30.

### Definition of done — R1
- [ ] Assets committed to `static/assets/tiles/`.
- [ ] Sprite loader loads cleanly; failures fall back to colour.
- [ ] Tile rendering uses sprites with colour fallback.
- [ ] New test passes.
- [ ] Commit: `Phase 12 R1: tile sprite pipeline + Kenney assets`.

---

## ROUND 2 — Smooth lighting (no more hard cell edges)

**Current state:** Lights paint quantised cell-grid shadows because
`_renderLightingOverlay` punches each visible cell as a square.
Result looks like a cellular automaton, not a torch. Foundry has
soft circular falloff with hard wall shadows — we need the same.

### Algorithm

Per light:
1. Compute the **visible cell set** via `computeVisibleCells` (already
   correct — this respects walls).
2. Build a **clipping polygon** from those cells: trace the outline
   of the union of all visible cells. Use a marching-squares-style
   walk OR simply create a Path2D with one rect per visible cell
   and rely on canvas's even-odd union.
3. **Clip to that polygon** via `ctx.clip(path)`.
4. Inside the clip, draw a **smooth radial gradient** centred at the
   light:
   ```js
   const grad = lctx.createRadialGradient(
     cx, cy, 0,
     cx, cy, radius_cells * gs);
   grad.addColorStop(0, `rgba(0,0,0,${intensity})`);
   grad.addColorStop(0.7, `rgba(0,0,0,${intensity * 0.5})`);
   grad.addColorStop(1, 'rgba(0,0,0,0)');
   lctx.fillStyle = grad;
   lctx.fillRect(0, 0, w, h);
   ```
5. Reset clip.

This produces **smooth radial light** that **terminates exactly at
wall boundaries** — Foundry-quality without WebGL.

### Optional softening

Render the lighting layer to a half-resolution offscreen canvas, then
`ctx.drawImage(layer, 0, 0, w, h)` with `imageSmoothingEnabled=true`.
The natural bilinear interpolation softens the wall-shadow boundary
by 1-2 px which kills the few remaining pixel artefacts.

### Implementation

Replace the inner loop of `_renderLightingOverlay` (the punch-out
`for (const key of visibleSet)` loop). Pseudo-code:

```js
for (const light of this.lights) {
  const visibleSet = this.computeVisibleCells(
    light.col, light.row, Math.ceil(light.radius_cells));

  // Build clip path
  const path = new Path2D();
  for (const key of visibleSet) {
    const [c, r] = key.split(',').map(Number);
    path.rect(c * gs, r * gs, gs, gs);
  }

  lctx.save();
  lctx.clip(path);
  const cx = (light.col + 0.5) * gs;
  const cy = (light.row + 0.5) * gs;
  const radius = light.radius_cells * gs;
  const grad = lctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  const intensity = light.intensity ?? 1.0;
  grad.addColorStop(0,   `rgba(0,0,0,${intensity * softFactor})`);
  grad.addColorStop(0.6, `rgba(0,0,0,${intensity * 0.5 * softFactor})`);
  grad.addColorStop(1,   'rgba(0,0,0,0)');
  lctx.globalCompositeOperation = 'destination-out';
  lctx.fillStyle = grad;
  lctx.fillRect(0, 0, w, h);
  lctx.restore();
}
lctx.globalCompositeOperation = 'source-over';
```

### Tests

Lighting is purely visual; no clean pytest target. Document in commit:
"Visual change only — verified manually per Phase 12 R2 checklist".

### Manual verification

1. Crypt with 4 torches and `ambient=0.05 indoor`.
2. Each torch creates a SMOOTH circle of light, not a stair-stepped
   one.
3. Behind a wall: sharp shadow boundary, no light leaks through.
4. Two torches in same room: their light pools blend smoothly.
5. FPS: still 60 on 30×30 with 8 lights (use Chrome FPS counter).

### Definition of done — R2
- [ ] `_renderLightingOverlay` rewritten with clip-path + gradient.
- [ ] Hard cell edges gone.
- [ ] Walls still cast crisp shadows.
- [ ] FPS budget met.
- [ ] Commit: `Phase 12 R2: smooth radial lighting with wall clipping`.

---

## ROUND 3 — Wall + door styling pass

### 3.1 — Wall shadow drop

After rendering wall sprites, draw a 1-2 px dark shadow on the
SOUTH and EAST faces of each wall to give 3D depth. Use:

```js
ctx.fillStyle = 'rgba(0,0,0,0.35)';
ctx.fillRect(x, y + gs - 2, gs, 2);  // south
ctx.fillRect(x + gs - 2, y, 2, gs);  // east
```

Skip if neighbour cell is also a wall.

### 3.2 — Door states

Already covered in R1 (sprite swap). Add a brief animation when door
toggles open: scale from 0% to 100% over 200ms. Use a per-tile
`_doorAnimStart[key] = performance.now()` and interpolate in
`_drawTiles`.

### 3.3 — Decorations

Optional: place tiny grass tufts / cobblestone variations randomly
on floor cells to break monotony. Use a deterministic hash
`(col * 73 + row * 113) % 100 < 15` to place variants.

### Definition of done — R3
- [ ] Walls have drop shadows.
- [ ] Doors animate on toggle.
- [ ] Optional decoration variations applied.
- [ ] Commit: `Phase 12 R3: wall + door styling`.

---

## ROUND 4 — Token portraits + HP rings

### 4.1 — Portrait rendering

In `_drawTokens` (or wherever tokens render), replace the coloured
circle when `token.token_image_url` is set:

```js
if (token.token_image_url) {
  const img = this._tokenImgCache.get(token.token_image_url);
  if (img && img.complete) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  } else if (!img) {
    const newImg = new Image();
    newImg.onload = () => this._requestRender();
    newImg.src = token.token_image_url;
    this._tokenImgCache.set(token.token_image_url, newImg);
  }
}
```

Cache per-URL `HTMLImageElement` in `this._tokenImgCache = new Map()`
(initialise in constructor).

### 4.2 — HP ring

Around the portrait, draw an arc representing `current_hp / max_hp`:

```js
const hpFrac = Math.max(0, Math.min(1,
  (token.current_hp ?? 1) / Math.max(1, token.max_hp ?? 1)));
ctx.lineWidth = 3;
ctx.strokeStyle = hpFrac > 0.5 ? '#4caf50'
                : hpFrac > 0.25 ? '#ffc107'
                : '#f44336';
ctx.beginPath();
ctx.arc(cx, cy, r + 2, -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * hpFrac);
ctx.stroke();
```

### 4.3 — Fallback

If `token_image_url` is missing or fails, keep the existing coloured
circle with initial. Don't break the UI.

### Tests

```python
@pytest.mark.asyncio
async def test_phase12_token_image_url_in_payload(client, session_code):
    """token_image_url and HP fields must surface on the map state
    response so the canvas can render portraits + rings."""
    char_id = (await client.post("/api/sessions/join",
        json={"session_code": session_code,
              "player_name": "Hero"})).json()["character_id"]
    # Set a portrait url
    await client.patch(f"/api/characters/{char_id}",
                       json={"token_image_url": "/static/portraits/test.png"})
    state = (await client.get(f"/api/map/{session_code}")).json()
    tok = next(t for t in state["tokens"] if t["character_id"] == char_id)
    assert tok["token_image_url"] == "/static/portraits/test.png"
    assert "current_hp" in tok and "max_hp" in tok
```

### Manual verification

- Set a character's portrait URL → token shows the image.
- HP ring colour changes as HP drops.
- Character with no portrait → coloured circle as before.

### Definition of done — R4
- [ ] Portrait rendering with cache + circular clip.
- [ ] HP ring with 3-tier colour.
- [ ] Fallback intact.
- [ ] Test passes.
- [ ] Commit: `Phase 12 R4: token portraits + HP rings`.

---

## ROUND 5 — Grid GM-only + UI polish

### 5.1 — Grid hide for player

In `static/js/map-canvas.js` find the grid-line rendering loop. Wrap
it:

```js
if (this.role === 'gm') {
  // existing grid rendering
}
```

Player canvas: no grid lines at all. Cells flow seamlessly into each
other. This is the single biggest visual upgrade for player
perspective.

### 5.2 — Optional grid toggle for GM

The existing "Grid: ON/OFF" toggle in the toolbar already controls
this. Verify it still works for GM after the role-gate. Player has no
toggle.

### 5.3 — Lighting HUD restyling

Phase 10 R2 added a stark black box. Restyle to match Forge: subtle
backdrop-filter blur, rounded corners, small icon:

```css
#map-lighting-hud {
  background: rgba(0,0,0,0.45);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 0.75rem;
  font-weight: 500;
}
```

### 5.4 — Smooth token movement

When a token moves (WS `map.token_moved`), interpolate its position
over 200ms instead of snapping. Add per-token
`{prevX, prevY, targetX, targetY, animStart}` and ease in
`_drawTokens`. Use `easeOutCubic` for snappy-but-smooth feel.

### Tests

UI changes — no clean pytest target.

### Manual verification

- Player tab: no grid lines visible. Floor textures flow.
- GM tab: grid lines visible (and toggleable).
- HUD looks polished, not utilitarian.
- Tokens glide between cells, don't snap.

### Definition of done — R5
- [ ] Grid hidden for player role.
- [ ] HUD restyled.
- [ ] Token movement animated.
- [ ] Commit: `Phase 12 R5: grid GM-only + UI polish + token interpolation`.

---

## SCOPE EXCLUSIONS (Phase 13+)

Do NOT do these in Phase 12:

- Vector wall geometry (we stay cell-based; sprites are enough).
- WebGL / PixiJS migration.
- Procedural map generation.
- Animated lighting (flicker, pulse) — only the door open/close
  animation in R3.
- Per-token light sources (held torches).
- Coloured light tinting (color_hex stored, but only alpha blends in
  this phase).
- Day/night cycle.
- Custom asset uploader for the GM.
- Hex grid sprite support (we still support hex layouts but sprites
  are square-only; document this in commit).

These belong to Phase 13 if the user wants them.

---

## END-OF-PHASE CHECKLIST

- [ ] All 5 rounds committed in order.
- [ ] `pytest tests/ -q` — pre-existing pass count unchanged; +3 new
      tests for Phase 12.
- [ ] Manual verification for all 5 rounds done on GM and Player.
- [ ] Performance verified: 60 FPS on 30×30 + 8 lights (Chrome
      DevTools Performance tab → Frames lane).
- [ ] `docs/PHASE_12_PROGRESS.md` created with one line per round.
- [ ] Asset licence + attribution added to `docs/CREDITS.md`
      (Kenney / CC0 / OpenGameArt source URL + author name).
- [ ] Push to GitHub.

---

## ASSET ATTRIBUTION TEMPLATE

Create `docs/CREDITS.md`:

```markdown
# Credits

## Tile sprites
- Source: Kenney.nl Roguelike RPG Pack
- URL: https://kenney.nl/assets/roguelike-rpg-pack
- License: CC0 1.0 (Public Domain)
- Author: Kenney Vleugels (kenney.nl)

## Algorithms
- Recursive shadowcasting: Albert Ford
  https://www.albertford.com/shadowcasting/
- 2D visibility: Red Blob Games
  https://www.redblobgames.com/articles/visibility/
```

---

End of Phase 12 plan. ~5-7 sessions of work depending on asset
fidelity desired.
