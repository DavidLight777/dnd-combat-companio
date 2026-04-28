# Phase 10 — Foundry-grade Map Polish

**Audience:** Kimi K2.6 (implementing partner). Cascade has done the
research; this document contains everything you need to implement the
phase end-to-end without re-investigating.

**Goal:** Close the remaining gaps that make our Map system feel
incomplete vs Forge/FoundryVTT: building roofs that actually hide
interiors, lights blocked by walls, per-token vision with persistent
fog, and a one-click "Building" UX that produces a closed structure.

---

## ⚠ MANDATORY READING — RULES YOU MUST FOLLOW

Before touching a single file, read `docs/AGENT_NOTES.md` end-to-end.
Every rule in there applies. The Phase 10 specific reinforcements:

### R-T1 — Tests are FIRST-CLASS, NEW for this phase

**This is the most violated rule. Read twice.**

- For every backend change you MUST add a **new** `pytest` test in
  `tests/test_smoke.py`. Do not modify existing tests to make them pass
  with new behaviour — that hides regressions. Add new tests under a
  clearly-marked Phase 10 section header:
  ```python
  # ── Phase 10 (Building tool / Vision / Shadow casting) ───────────
  ```
- For every JS algorithm (shadow casting, vision, building geometry)
  add a **new** `tests/test_<feature>.py` (server-side test that hits
  the endpoint or a small Node script run via `npm test` if absent —
  prefer Python tests calling the API).
- **Never delete or weaken** an existing test. If an existing test
  fails after your change, the existing behaviour is the contract;
  fix your implementation, not the test.
- Run `pytest tests/ -q` BEFORE and AFTER your change and confirm:
  - **before count == after count** for pre-existing tests passing.
  - new test count >= number of new behaviours added.
- Each new test should finish in <1s. Use existing fixtures `client`,
  `session_code`.
- Smoke test patterns (copy these):
  - End-to-end CRUD: see `test_bv2_full_edit_flow` (line ~220).
  - Bridge state shape: see `test_phase9_bridge_includes_interiors`
    (line ~1645).
  - Numeric-zero regression: see
    `test_bv2_location_ambient_light_zero_persists` (line ~700).

### R-T2 — Verify both GM and Player

`docs/AGENT_NOTES.md` RULE-1. After every visual change you MUST
manually verify in two browser tabs (or one tab + incognito), one as
GM and one as a player joined to the same session. Never declare done
based on GM-only screenshot.

### R-T3 — Hard-reload after JS edits

`docs/AGENT_NOTES.md` RULE-2. Browser caches `static/js/*.js`. After
ANY JS edit instruct the user (or remind yourself) to `Ctrl+Shift+R`
on every relevant tab. Stale JS is the #1 false-bug source.

### R-T4 — Tile data shape

`docs/AGENT_NOTES.md` RULE-3. Bridge sends tiles as
`{type, blocks_movement, blocks_vision, is_open}`. Legacy paths sent
strings. Anywhere you read `tiles[key]` use:
```js
const type = typeof raw === 'string' ? raw : (raw && raw.type) || 'floor';
```

### R-T5 — bv2 server-side rules

`docs/AGENT_NOTES.md` RULE-9. Map Builder v2 walls live ONLY in
`BV2Tile`. Do not assume `MapObject` reflects bv2 walls.
`_path_is_blocked` is patched. Anything new you add (e.g. shadow
casting on the server, vision check on the server) MUST consult
`BV2Tile.blocks_movement` / `blocks_vision`, NOT `MapObject`.

### R-T6 — RAF coalescing for hot paths

`docs/AGENT_NOTES.md` RULE-8. Any new mousemove-driven render must
go through `MapCanvas._requestRender()`, not `render()`.

### R-T7 — Numeric defaults

`docs/AGENT_NOTES.md` RULE-6. Never `value or default` /
`value || default` for fields where 0 is meaningful (radius,
intensity, ambient_light). Use `?? ` (JS) or `is not None else`
(Python).

### R-T8 — Single source of truth

If a feature exists once, do not duplicate it. We already have:
- `MapCanvas.computeVisibleCells(col, row, range)` in
  `static/js/map-canvas.js` — recursive shadowcasting on the game
  canvas.
- `bv2.FOVCalculator` in `static/js/builder_v2/60-fov.js` — same
  algorithm, used by the Builder preview.
- `BV2VisitState` table for persistent fog.
- `/api/builder-v2/locations/{id}/visit` for fog updates.
- `Character.vision_radius` (default 5) and `Character.sight_range_cells`
  (default 8) — already serialized in tokens.

**DO NOT** rewrite these. Reuse and extend.

### R-T9 — WebSocket parity

Any new mutation endpoint must broadcast a WS event AND have
listeners in BOTH `static/js/gm/08-websocket.js` AND
`static/js/player/18-quests.js` (or `player/10-map.js`). Otherwise
one side will go stale.

### R-T10 — Progress notes

Update `docs/AGENT_NOTES.md` with any new RULE you discover during
this phase. Do not bloat — append concise rules only when a real
pitfall is found.

---

## Architecture cheat-sheet (so you don't re-investigate)

### Backend (FastAPI / SQLAlchemy async)

| Concern | File | Key symbols |
|---|---|---|
| bv2 maps / locations CRUD | `app/routers/builder_v2/maps.py`, `locations.py` | `BV2Map`, `BV2Location` |
| bv2 tiles batch API | `app/routers/builder_v2/locations.py` PATCH `/locations/{id}/tiles` | accepts `{set: [...], erase: [...]}` |
| bv2 lights | `app/routers/builder_v2/lights.py` | `BV2Light` (col, row, radius_cells, intensity, color_hex, source_kind) |
| Interior zones | `app/routers/builder_v2/interiors.py` | `BV2InteriorZone`, `BV2InteriorCell`; reveal_mode in {`always`, `gm_only`, `on_enter`} |
| Per-character fog | `app/routers/builder_v2/fov.py` | `BV2VisitState`; `POST /locations/{id}/visit` writes, `GET` reads |
| Bridge to game state | `app/routers/map/files.py` `_build_state_from_bv2` | merges all bv2 data into legacy `/api/map/{code}` shape |
| Wall collision | `app/routers/map/common.py` `_path_is_blocked` | already reads BV2Tile (Phase 9 fix) |
| Token move | `app/routers/map/tokens.py` `move_token` | PATCH `/api/map/token/{id}`; already syncs map_x/y AND col/row |

### Frontend (vanilla JS modules)

| Concern | File | Key symbols |
|---|---|---|
| Game canvas (GM + Player Map tab) | `static/js/map-canvas.js` | class `MapCanvas`; `setLights/setInteriors/setEdges/setAmbientLight/setIndoor`; `_renderLightingOverlay`, `_renderInteriorOverlay`; `computeVisibleCells` |
| Builder canvas | `static/js/builder_v2/20-mapview.js` | class `MapView` (mode 'edit'); has its own light preview using `bv2.FOVCalculator` |
| FOVCalculator | `static/js/builder_v2/60-fov.js` | recursive shadowcasting; reads `tiles.get(key).blocks_vision` |
| Builder editor | `static/js/builder_v2/30-editor.js` | `setBrush`, paint loop, queueSave |
| Builder Zone tool | `static/js/builder_v2/95-interiors.js` | pendingCells, Enter saves |
| Builder Light tool | `static/js/builder_v2/70-lights.js` | modal-based |
| GM Map tab | `static/js/gm/06-map-main.js` `loadMapState` | calls `setLights/setInteriors/...` |
| Player Map tab | `static/js/player/10-map.js` `loadPlayerMapState` | same; also calls `/visit` on move |
| WS GM | `static/js/gm/08-websocket.js` | listens `map.token_moved`, `bv2.*` |
| WS Player | `static/js/player/18-quests.js` (yes, player WS lives here) | listens same |

### Existing reveal/fog model (do NOT break)

1. **Ambient + Indoor** — global per-location darkness in
   `_renderLightingOverlay`. GM gets `softFactor=0.35` preview.
2. **Lights** — per-light radial gradient that punches holes in the
   darkness layer via `globalCompositeOperation = 'destination-out'`.
   **Currently does NOT respect walls.** ← Phase 10 fixes this.
3. **Fog of war** — `revealedCells` set, populated from server
   `revealed_cells` (i.e. `BV2VisitState.explored_tiles_json`).
   Unrevealed cells get `rgba(0,0,0,1)` for players, `rgba(0,0,0,0.5)`
   for GM. **Currently passive — only cells the player has VISITED
   are revealed; "what is visible right now" is not computed.** ←
   Phase 10 fixes this with token vision.
4. **Interior zones** — `_renderInteriorOverlay`. `on_enter` reveals
   when a player token's `(floor(x*cols), floor(y*rows))` falls in
   `cellSet`. Door-peek covers cells reachable through open doors
   within 2 BFS steps; player must be ≤3 cells from an open boundary
   door for peek to activate.

---

## DELIVERABLES (in execution order)

The phase has **5 rounds**. Each round is a self-contained PR-sized
chunk. **Finish a round, run the full test suite, commit, then start
the next.** Do NOT mix rounds in one commit.

---

## ROUND 1 — Building tool (UX, fixes #3 from user complaint)

**User complaint:** "I built a building (walls, floor, roof, door) but
the player walks straight through where there's no wall, and the roof
doesn't show on player side."

**Root cause:** Zone tool requires manual wall-painting around the
zone AND requires Enter-to-save (often missed). User assumes Zone
auto-creates walls — it doesn't.

**Fix:** New `building` brush. Drag a rectangle → atomically:
1. Paint wall tiles on the **perimeter** (4 edges of the rectangle),
   minus a single door cell.
2. Paint floor tiles on the **interior** (cells strictly inside the
   perimeter).
3. Place a `door` tile at the centre of the user-chosen wall side
   (default: south/bottom).
4. Create an interior zone (`reveal_mode='on_enter'`,
   `kind='building'`) covering the interior cells.
5. Refresh canvas + broadcast WS so GM and player both see it.

### Spec

#### 1.1 — HTML (`static/gm.html`)

Add brush button next to the Zone button (around line 422):

```html
<button class="bv2-brush" data-brush="building"
        title="Building: drag rectangle = walls + floor + door + interior zone (B)">
  🏠<span>Building</span>
</button>
```

Add hotkey `B` to `HOTKEY_MAP` in `static/js/builder_v2/30-editor.js`.

Optional: a tiny preference UI (radio: door side N/E/S/W) in a new
`<div id="bv2-building-section">` that's only visible when brush is
`building`. Default: `S`. Skip this if it adds >50 lines; default to
south and document the hotkey to rotate (e.g. `[`/`]`).

#### 1.2 — Frontend rectangle-drag mode

In `static/js/builder_v2/20-mapview.js`:

- Add state: `this._buildingRect = null` (`{startCol, startRow, endCol, endRow}` while dragging).
- In `mousedown`, when `brush === 'building'`:
  - Capture start tile via `_screenToTile`.
  - Set `_buildingRect = {startCol, startRow, endCol, endRow}`.
  - Do NOT call `_paintAt`.
- In `mousemove`, while `_buildingRect`:
  - Update `endCol/endRow` from current screen → tile.
  - Call `this._requestRender()` (RULE-T6).
- In `mouseup`, when `_buildingRect` is set:
  - Compute normalized rect (`cMin/cMax/rMin/rMax`).
  - If `cMax - cMin < 2 || rMax - rMin < 2` → toast "Building must be at least 3×3" (or `alert`); clear rect.
  - Else fire `this.onBuildingDrag({cMin, rMin, cMax, rMax, doorSide: 's'})`.
  - Clear `_buildingRect`.
- Add a draw step in `render()` to overlay the pending rectangle:
  - Outline the perimeter cells with red dashed stroke.
  - Fill interior with `rgba(255,255,255,0.10)`.
  - Highlight the would-be door cell (centre of door side) in green.

#### 1.3 — 30-editor.js wiring

Wire `onBuildingDrag` in the `MapView` options:

```js
onBuildingDrag: async (rect) => {
  if (typeof S.commitBuilding === 'function') await S.commitBuilding(rect);
},
```

Implement `S.commitBuilding(rect)` in a new file
`static/js/builder_v2/96-building.js` (loaded after 95-interiors.js
in `gm.html` script tags). Logic:

```js
async function commitBuilding({cMin, rMin, cMax, rMax, doorSide}) {
  const setArr = [];
  // Perimeter walls
  for (let c = cMin; c <= cMax; c++) {
    setArr.push({col: c, row: rMin, tile_type: 'wall'});
    setArr.push({col: c, row: rMax, tile_type: 'wall'});
  }
  for (let r = rMin + 1; r < rMax; r++) {
    setArr.push({col: cMin, row: r, tile_type: 'wall'});
    setArr.push({col: cMax, row: r, tile_type: 'wall'});
  }
  // Interior floor
  const interiorCells = [];
  for (let c = cMin + 1; c < cMax; c++) {
    for (let r = rMin + 1; r < rMax; r++) {
      setArr.push({col: c, row: r, tile_type: 'floor'});
      interiorCells.push({col: c, row: r});
    }
  }
  // Door
  let doorCol, doorRow;
  if (doorSide === 'n') { doorCol = Math.floor((cMin + cMax) / 2); doorRow = rMin; }
  else if (doorSide === 'e') { doorCol = cMax; doorRow = Math.floor((rMin + rMax) / 2); }
  else if (doorSide === 'w') { doorCol = cMin; doorRow = Math.floor((rMin + rMax) / 2); }
  else { doorCol = Math.floor((cMin + cMax) / 2); doorRow = rMax; }
  // OVERRIDE the wall at the door cell
  const idx = setArr.findIndex(t => t.col === doorCol && t.row === doorRow);
  if (idx >= 0) setArr[idx] = {col: doorCol, row: doorRow, tile_type: 'door'};

  await S.api.patchTiles(S.currentLocId, setArr, []);
  const name = (prompt('Building name:', 'Building') || 'Building').trim();
  await S.api.createInterior(S.currentLocId, {
    name,
    kind: 'building',
    reveal_mode: 'on_enter',
    cells: interiorCells,
  });
  // Re-fetch location so the canvas reflects the new tiles + zone.
  await S.loadLocation(S.currentLocId);
  if (typeof S.refreshInteriorList === 'function') S.refreshInteriorList();
}
S.commitBuilding = commitBuilding;
```

#### 1.4 — gm.html script tag

Add after line that loads `95-interiors.js`:
```html
<script src="/static/js/builder_v2/96-building.js"></script>
```

#### 1.5 — Tests (R-T1)

In `tests/test_smoke.py` add new section `# ── Phase 10 Building tool ──`:

- `test_phase10_building_atomic_walls_floor_door_zone(client, session_code)`:
  - Create map + 20×15 location.
  - Simulate the building flow by calling the existing endpoints:
    1. PATCH `/locations/{id}/tiles` with the same `set` payload the
       JS would build (wall perimeter + interior floor + door).
    2. POST `/locations/{id}/interiors` with the interior cells.
  - Assert:
    - All perimeter cells exist as `wall` (and `blocks_movement=True`,
      `blocks_vision=True`).
    - Door cell exists as `door`, `blocks_movement=False`,
      `blocks_vision=False`.
    - Interior cells exist as `floor`.
    - Interior zone exists with matching cells, `kind='building'`,
      `reveal_mode='on_enter'`.
- `test_phase10_building_too_small_rejected_client_side`:
  - We cannot test the client validation in pytest, so document this
    as a JS-only concern in a test docstring and add a separate test
    that the **backend** still accepts a tiny "building" payload (it
    must — backend has no notion of "building"; only the brush does).
  - Skip if you don't want to add a no-op test; document instead.

Run before/after:
```
pytest tests/ -q
```

#### 1.6 — Manual verification

1. Hard-reload GM tab.
2. Builder → Map Builder v2 → select a location.
3. Click Building brush.
4. Drag a 6×4 rectangle.
5. Release → name prompt → enter.
6. Builder canvas immediately shows: walls on perimeter, floor inside,
   door at the centre of the south edge, interior zone painted.
7. Click "Apply to Game".
8. Hard-reload Player tab. Player Map tab should show:
   - Walls visible.
   - Building interior covered by black roof (zone overlay).
   - Door tile visible.
   - Player CANNOT walk through the wall tiles (try drag → 403 with
     "Path is blocked by a wall").
   - Player CAN walk through the door cell.
   - When player token enters an interior cell, the roof disappears
     for that player (and stays down while inside).

#### 1.7 — Definition of done (Round 1)

- [ ] All steps in 1.1–1.4 implemented.
- [ ] New tests pass; pre-existing test count unchanged.
- [ ] Manual verification on both GM and Player passes.
- [ ] `docs/AGENT_NOTES.md` updated only if a NEW pitfall was found.
- [ ] Single commit with message `Phase 10 R1: Building tool`.

---

## ROUND 2 — Lighting status visibility (UX, fixes "I don't see lighting working")

**User complaint:** "I never see lighting do anything."

**Root cause:** `Ambient=1.0` and `Indoor=false` produce
`darkAlpha = 0` → no overlay → map is fully bright. Controls exist
in `gm.html:386-389` but are tiny and never confirm "yes, lighting is
applied". Also no visible status on the Map tab.

**Fix:** Show effective lighting state both in Builder and on the
Map tab. Surface the values, not just sliders.

### Spec

#### 2.1 — Builder side

In `static/gm.html` near `bv2-loc-ambient-val`:

- Add a tiny status pill: `<div id="bv2-lighting-status">Bright</div>`
  that updates whenever ambient or indoor changes:
  - `ambient >= 0.85 && !indoor` → green "Bright".
  - `ambient < 0.85 && !indoor` → yellow "Dim (ambient=X.XX)".
  - `indoor` → blue "Indoor (dark)".
- Wire updates in `static/js/builder_v2/30-editor.js` where
  ambient/indoor handlers fire (around lines 421 and 434).

#### 2.2 — Game canvas (Map tab) HUD

In `static/gm.html` Map tab and `static/player.html` Map tab, add a
small status row in a corner of the canvas container:

```html
<div id="map-lighting-hud" style="position:absolute;top:8px;right:8px;
  background:rgba(0,0,0,0.55);color:#fff;padding:4px 8px;border-radius:4px;
  font-size:0.72rem;pointer-events:none;z-index:5"></div>
```

In `static/js/gm/06-map-main.js` and `static/js/player/10-map.js`,
after `setAmbientLight`/`setIndoor`/`setLights`, set the HUD text:

```js
const hud = document.getElementById('map-lighting-hud');
if (hud) {
  const a = state.bv2_ambient_light ?? 1.0;
  const indoor = !!state.bv2_is_indoor;
  const lights = (state.bv2_lights || []).length;
  hud.textContent = `Lighting: ${indoor ? 'Indoor ' : ''}ambient ${a.toFixed(2)} · ${lights} light${lights === 1 ? '' : 's'}`;
}
```

#### 2.3 — Tests (R-T1)

- `test_phase10_lighting_state_in_bridge(client, session_code)`:
  - Create map + location with `ambient_light=0.3`, `is_indoor=true`.
  - Add 2 lights via `POST /locations/{id}/lights`.
  - Activate map.
  - GET `/api/map/{code}` (no character_id → GM view).
  - Assert:
    - `bv2_ambient_light == 0.3`
    - `bv2_is_indoor == True`
    - `len(bv2_lights) == 2`
  - Note: the HUD is purely client-side, so we can't pytest it; a
    backend round-trip test is the right surrogate.

#### 2.4 — Manual verification

- Builder → set ambient=0.3 + Indoor → status pill turns blue
  "Indoor (dark)".
- Map tab → "Lighting: Indoor ambient 0.30 · 0 lights" appears in
  top-right.
- Add 2 lights → HUD updates to "· 2 lights".
- Player tab → same HUD shows.

#### 2.5 — Definition of done (Round 2)

- [ ] HUD visible on Builder, GM Map tab, Player Map tab.
- [ ] New test passes.
- [ ] Single commit `Phase 10 R2: Lighting status HUD`.

---

## ROUND 3 — Zone debug overlay (GM-only diagnostic)

**Problem:** Hard to debug "why isn't the roof showing/hiding".

**Fix:** GM sees a floating label over each zone with live
"X cells, Y players inside". Players never see this.

### Spec

#### 3.1 — `static/js/map-canvas.js` `_renderInteriorOverlay`

After computing `cellSet` and `hasPlayerInside` for a zone, when
`isGm`, also draw a label at the zone centroid. Re-use the existing
loop in `_renderInteriorOverlay` (around line 1860+); add:

```js
if (isGm) {
  const zCells = Array.from(cellSet).map(k => k.split(',').map(Number));
  if (zCells.length) {
    const cx = zCells.reduce((s, [c]) => s + c, 0) / zCells.length;
    const cy = zCells.reduce((s, [, r]) => s + r, 0) / zCells.length;
    const px = (cx + 0.5) * gs;
    const py = (cy + 0.5) * gs;
    let insideCount = 0;
    const cols = Math.ceil(this.mapWidth / gs);
    const rows = Math.ceil(this.mapHeight / gs);
    for (const t of this.tokens) {
      if (t.is_npc || !t.visible) continue;
      const tc = Math.floor(t.x * cols);
      const tr = Math.floor(t.y * rows);
      if (cellSet.has(`${tc},${tr}`)) insideCount++;
    }
    ctx.save();
    ctx.font = `${Math.max(10, gs * 0.28)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    const label = `${zone.name || 'Zone'} · ${cells.length}c · ${insideCount}in`;
    const w = ctx.measureText(label).width + 8;
    ctx.fillRect(px - w / 2, py - gs * 0.2, w, gs * 0.4);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, px, py);
    ctx.restore();
  }
}
```

#### 3.2 — Tests

There is no clean way to assert canvas text in pytest. Skip a
backend test for this; document in commit message that this is a
client-only diagnostic.

#### 3.3 — Manual verification

- GM Map tab with a zone: label visible at centroid, e.g.
  `Building · 12c · 0in`.
- Move a player token into the zone: label updates to
  `Building · 12c · 1in` (after WS map.token_moved triggers render).
- Player Map tab: NO label visible.

#### 3.4 — Definition of done (Round 3)

- [ ] GM sees label, player does not.
- [ ] Live updates on token move.
- [ ] Single commit `Phase 10 R3: Zone debug label (GM-only)`.

---

## ROUND 4 — Shadow-cast lights (CORE — fixes "lights bleed through walls")

**User complaint:** "Lights light up rooms next to them through walls."

**Root cause:** `_renderLightingOverlay` uses
`createRadialGradient` per light — a pure-distance fade with zero
wall awareness. Foundry uses ray-cast occlusion against wall
geometry. We use the cell-based equivalent: recursive shadowcasting,
which we ALREADY HAVE for the canvas (`computeVisibleCells`).

**Fix:** For each light, compute the lit cell set via
`computeVisibleCells(light.col, light.row, light.radius_cells)`,
then draw the punch-hole gradient ONLY in those cells.

### Spec

#### 4.1 — `static/js/map-canvas.js` `_renderLightingOverlay`

Replace the inner `for (const light of this.lights)` loop. New
algorithm:

1. Compute `litMap = Map<lightId, Set<"col,row">>` once per render
   (cache in `this._lightCache` keyed on
   `lights.length + tiles.size + scale + offsetX/Y`; invalidate
   whenever any of those change. Simplest: just recompute every
   render — `computeVisibleCells` is fast for radius ≤ 10).
2. For each light:
   - `const visibleSet = this.computeVisibleCells(light.col, light.row, Math.ceil(light.radius_cells));`
   - For each cell key in `visibleSet`:
     - Parse `[c, r]`.
     - Compute screen-space cell rect.
     - Compute distance from light centre in cells:
       `d = sqrt((c - light.col)^2 + (r - light.row)^2)`.
     - Compute alpha contribution:
       `alpha = max(0, 1 - d / light.radius_cells) * (light.intensity ?? 1.0) * softFactor`.
     - Punch-hole that cell with `rgba(0,0,0,alpha)` in
       `destination-out` mode.
3. Skip the global `createRadialGradient` path entirely.

**Important:** `computeVisibleCells` must read `blocks_vision` from
each tile. It already does (line 1056+ in `map-canvas.js`). Verify
and document.

If you observe ugly per-cell hard edges (because punch-out is
quantised), apply a post-blur step: render the lighting layer at
half resolution on `_lightLayer`, then `ctx.drawImage` it back at
full size with `imageSmoothingEnabled = true`. This naturally
softens the cell-grid look without breaking shadow boundaries.

#### 4.2 — Tests (R-T1)

In `tests/test_smoke.py` Phase 10 section:

- `test_phase10_shadowcast_light_blocked_by_wall(client, session_code)`:
  - Create 10×10 location.
  - Paint walls in a vertical line at col=5 from row=2..7.
  - Create a light at col=3, row=4, radius=5, intensity=1.
  - Activate map and GET `/api/map/{code}`.
  - Assert that the light payload is correctly returned (we cannot
    pytest the canvas; we test that the **inputs** to the shadow
    cast are persisted correctly).
  - This is mostly a smoke regression — the actual algorithm test is
    a JS unit test below.

- Add `tests/test_shadowcast.py` — pure-Python port of
  `MapCanvas.computeVisibleCells` for assertion. (See R-T8 — DON'T
  duplicate; instead, add a JS-side assertion at the bottom of
  `static/js/map-canvas.js` behind a `if (window.__bv2_dev_assertions)
  __runShadowcastTests();` flag, callable from a tiny e2e script.)

  **If a Python port is too much code, skip this test file and put a
  comment in the algorithm function: "Tested manually — see Phase 10
  R4 manual verification.")** Cascade prefers manual verification
  here over a duplicated implementation that drifts.

#### 4.3 — Manual verification

1. Builder → make a 10×10 floor location.
2. Paint a vertical wall at col=5.
3. Place a light at col=3, row=5 with radius=5.
4. Set ambient=0 (full darkness) + Indoor.
5. Apply.
6. GM Map tab: light illuminates cols 0..4 around the source. Cols
   6..9 (behind the wall) stay BLACK. There is no "leak" through
   the wall.
7. Knock a hole in the wall (set col=5,row=5 to floor). Light now
   visibly leaks one cell into col=6 (the door-like opening). The
   shadow gets a clean fan-out behind that gap.
8. Player Map tab: same behaviour.

#### 4.4 — Definition of done (Round 4)

- [ ] Lights respect wall tiles.
- [ ] Door tiles (open or unset) DO let light through.
- [ ] Performance ok at 4 lights × radius=6 (~30ms render).
- [ ] Single commit `Phase 10 R4: Shadow-cast lights`.

---

## ROUND 5 — Token vision + persistent fog (BIG — full Foundry parity feature)

**User complaint:** "Player can see what's inside a building without
entering."

**Root cause:** Player canvas applies fog only to cells the player
has explicitly visited (`revealedCells`). It does NOT compute what
is currently visible from the token's position. The interior zone
overlay is the only thing hiding interiors, and it has bugs (zone
not saved, etc.). Real fix: implement Foundry-style token vision.

### Spec

#### 5.1 — Compute "currently visible" client-side

In `static/js/player/10-map.js`, after the token has moved (and on
initial map load), compute `currentVisible = computeVisibleCells(
ownTokenCol, ownTokenRow, sight_range_cells)` for the player's own
token, using `playerMapCanvas.computeVisibleCells`.

Add a new field on `MapCanvas`:
- `this.currentVisible = null;` (Set or null).
- `setCurrentVisible(set) { this.currentVisible = set; this.render(); }`

In `_renderFogOverlay` (the place that uses `revealedCells`):
- For player canvas (role !== 'gm'):
  - **Currently visible cells** → fully clear (no overlay).
  - **Previously explored but NOT currently visible** → dim
    `rgba(0,0,0,0.55)`.
  - **Never explored** → fully black `rgba(0,0,0,1.0)`.
- For GM: leave existing behaviour (no fog).

**Crucial:** `currentVisible ⊆ explored`. After computing
`currentVisible`, merge it into `revealedCells` for instant
persistence (server is updated by the existing `/visit` POST).

#### 5.2 — Vision blockers respected

`computeVisibleCells` already reads `blocks_vision`. Walls (always),
closed doors (`blocks_vision=true` because `is_open=false`), and pits
all block vision automatically. Open doors do not.

**Important — interior zone roofs do NOT block vision** (a roof
hides what's inside from outside but doesn't physically block sight).
We do NOT add zones to `blocks_vision`. Instead, the existing
interior overlay covers them. Round 5 keeps this layered:

1. Token vision dims un-visible cells.
2. Interior zone covers cells the player hasn't ENTERED.
3. Fog covers cells never explored.

The three layers compose. Test that all three together produce the
expected behaviour:
- Outside the building, no zone overlay between player and door (door
  visible). Inside the building (from outside) zone roof covers the
  cells.
- Walking through the door, currentVisible reaches into the interior;
  zone overlay drops; revealedCells grows to include those cells.

#### 5.3 — Server persistence (already wired)

The existing `POST /api/builder-v2/locations/{id}/visit` accepts a
list of `[col, row]` pairs and unions them into
`BV2VisitState.explored_tiles_json`. `player/10-map.js:210` already
calls this on every move. Verify nothing is broken; do NOT change
the API.

#### 5.4 — GM toggle: "show what player X sees"

(Optional polish, can defer to Phase 11.)

#### 5.5 — Tests (R-T1)

- `test_phase10_visit_roundtrip_with_walls(client, session_code)`:
  - Create 10×10 location with walls at col=5 (vertical line).
  - Join a Scout character.
  - POST `/visit` with `visible_cells = [[0,5], [1,5], [2,5], [3,5], [4,5]]`.
    (Cells the JS shadowcaster would compute from a token at col=3,row=5.)
  - GET `/visit` → assert all 5 cells in `explored_tiles`.
  - POST again with `[[6,5], [7,5]]` (cells beyond the wall, which
    the JS shadowcaster would NOT include — the test verifies the
    backend stores whatever the client sends).
  - GET → assert union: 7 cells.
  - The shadowcaster correctness is a CLIENT concern, asserted by
    manual verification in 5.6.

- `test_phase10_visit_per_character_isolated(client, session_code)`:
  - Two characters in the same session, each POSTs different
    visible_cells.
  - GET each → each sees only their own cells.

#### 5.6 — Manual verification

1. Build a closed building per Round 1.
2. Player joins, token spawns outside the building.
3. Player Map tab: ambient is set to a non-bright value (or
   Indoor=true) so fog visualisation matters.
4. Move token towards the door:
   - Cells along the path light up (currentVisible).
   - Cells outside `sight_range_cells` are dim/black.
   - The interior of the building stays covered by the zone overlay.
5. Walk through the door:
   - Zone overlay drops for all interior cells the player CAN see.
   - Cells behind interior walls remain hidden.
6. Step back outside:
   - Cells just-walked-through stay dim (explored, not currently
     visible).
   - Zone overlay returns to cover the interior.
7. Verify GM still sees everything (no fog, soft zone preview).

#### 5.7 — Definition of done (Round 5)

- [ ] `computeVisibleCells` called on every player token move.
- [ ] Three-layer overlay (vision dim, zone roof, fog black) works
      together.
- [ ] Persistence via `/visit` survives a page refresh.
- [ ] Two new tests pass.
- [ ] Single commit `Phase 10 R5: Token vision + live fog`.

---

## OPEN-SOURCE REFERENCES (read these if stuck)

The user asked for Forge VTT references. Forge is hosted FoundryVTT;
Foundry source is **not open**. Use these instead:

1. **Albert Ford — Recursive Shadowcasting**
   `https://www.albertford.com/shadowcasting/`
   Best in class. Interactive visualisations. ~150 lines of JS.

2. **Roguebasin FOV using recursive shadowcasting**
   `http://www.roguebasin.com/index.php/FOV_using_recursive_shadowcasting`
   Original algorithm.

3. **Red Blob Games — 2D Visibility**
   `https://www.redblobgames.com/articles/visibility/`
   Polygon-based ray casting (what Foundry actually does for
   non-grid worlds).

4. **MapTool source**
   `https://github.com/RPTools/maptool`
   Open-source Java VTT with vision blocking + topology. Look at
   `net.rptools.maptool.client.MapTool` and the FogUtil class.

5. **Mythic Table source**
   `https://github.com/Mythic-Table/mythic-table`
   Web-based open-source VTT. Less mature on lighting but useful for
   Vue/Pixi reference.

Our existing `static/js/builder_v2/60-fov.js` already implements
algorithm #1 (recursive shadowcasting). Reuse it.

---

## END-OF-PHASE CHECKLIST (mandatory before declaring Phase 10 done)

1. [ ] All 5 rounds committed in order.
2. [ ] `pytest tests/ -q` — pre-existing tests pass count UNCHANGED.
3. [ ] At least 4 NEW tests added (one per round 1, 2, 4, 5; Round 3
       is client-only).
4. [ ] GM and Player both manually verified per round.
5. [ ] `docs/AGENT_NOTES.md` updated with any new RULE found
       (numbered RULE-10+).
6. [ ] Hard-reload reminder issued to user with each JS-touching round.
7. [ ] No regressions: walk through every existing builder feature
       (paint floor/wall/water/door, place chest/trap/portal, edge
       transition, paint zone via Z hotkey) and confirm still works.
8. [ ] Push to GitHub: `git push origin main` from
       `c:\Users\Litun\Desktop\DND Project\dnd-companion`.

---

## PROGRESS TRACKING

Update `docs/PHASE_10_PROGRESS.md` (create it on Round 1 start) with
one line per completed round:

```
- [x] R1 Building tool — commit 0123abc — 2026-04-28
- [x] R2 Lighting HUD — commit 0123def — ...
- [ ] R3 Zone debug label —
- [ ] R4 Shadow-cast lights —
- [ ] R5 Token vision + fog —
```

Don't bloat. One line per round. Cascade reads this on next session
to know where you stopped.

---

## SCOPE EXCLUSIONS (do NOT do these in Phase 10)

These are tempting but out of scope. Defer to Phase 11+:

- Vector-wall geometry (we stay cell-based).
- Multi-floor / elevation.
- Day/night cycles, timed light extinguishing.
- Per-token light sources held in inventory (torch held by player).
- Token-emitted light (token IS a light source).
- GM "see as player" toggle.
- AI/NPC vision (NPCs use legacy logic; this phase is player-facing).
- Animated lights (flicker, pulse).
- Coloured lighting tints (color_hex is stored but only alpha is
  used; full RGB blending is a non-trivial canvas refactor).

Document any scope creep request from the user as "Phase 11 candidate"
in `docs/AGENT_NOTES.md`.

---

## QUESTIONS YOU MUST ASK USER BEFORE STARTING (if any unclear)

If anything below is unclear, ASK. Do not guess.

1. Door side default: confirm `south` is fine, or add a hotkey
   (`[`/`]`) to rotate before commit.
2. Building name prompt: blocking `prompt()` is fine for v1?
   Alternative is a tiny inline modal. Default: `prompt()`.
3. Light radius behaviour with intensity > 1: clamp to 1 or boost?
   Default: clamp to 1.

**If user is silent — proceed with the defaults above. Document
choice in commit message.**

---

End of Phase 10 plan. ~5 sessions of work. Good luck.
