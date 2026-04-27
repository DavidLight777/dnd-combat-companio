# Phase 9 — Bugs + Lighting + Interior Zones + Character Bridge

**Hand-off to K2.6.** Single-round plan covering four tracks: library save/load bugs, location-map mixing, lighting visibility wiring, FOV-gated interior zones, and bv2 character/transition bridge.

---

## 0. Hard rules — read twice before touching code

1. **Investigate before implementing.** Every numbered bug below has a "Root cause (verified by X)" line. For NEW features, the first step is always "add a failing test" that pins down the expected behaviour.
2. **No `or N` / `|| N` for numeric defaults.** Python: `v if v is not None else N`. JS: `v ?? N`. Absolute rule.
3. **No `props_json` anywhere.** All bv2 entity detail lives in typed tables. If you catch yourself typing `JSON.stringify` or `json.loads` near bv2 entities, stop.
4. **No new legacy endpoints.** Everything goes under `/api/builder-v2/…`. Legacy `map-builder` router is frozen.
5. **Minimal upstream fixes.** If the bug is one line upstream, fix that one line. Do NOT fix downstream symptoms in three places.
6. **TDD everywhere.** For each bug: write failing test → fix → test passes. For each feature: tests written before impl, covering the happy path + at least one edge case.
7. **Do not touch `static/js/map-canvas.js`** for anything except narrow additions when the existing hooks cannot handle a feature. If an addition is needed, put it in its own small helper file under `static/js/bv2-canvas-extras.js` and keep `map-canvas.js` untouched.
8. **Run `.\dev.ps1 check` after every track.** Target: 61 existing + new tests all green. Document the count at the end of each track.
9. **Do not rename any existing function, route, model field, or WS event name.** Additions only.
10. **Do not refactor.** No "while I'm here, let me clean up…". One-shot, surgical.
11. **No emojis in code or comments** unless they already exist in the file.
12. **Every comment must add information.** No tautologies like `// set x to y`.

---

## 1. Scope overview

Four tracks, executed in this order:

| # | Track | What | Size |
|---|---|---|---|
| A | Bugs | Library save/load correctness, Builder dropdown mixing, character filtering | small, ~5 bugs |
| B | Lighting visibility | Builder UI for `ambient_light` + `is_indoor`, verify render path | small |
| C | Interior zones | New feature — FOV-gated sub-zones inside a Location (shops inside a village) | medium |
| D | Character/NPC bridge | Walk-transitions between Locations, NPC auto-spawn, Builder token preview | medium |

**At no point introduce Track B, C, or D behaviour into Track A changes.** Each track ships independently, tests green before moving on.

---

## 2. Track A — Library & Map bugs

### A.1 — `load-as-map` hardcodes the map name `"Loaded Map"`

**Root cause (verified):** `@c:\Users\Litun\Desktop\DND Project\dnd-companion\static\js\builder_v2\90-library.js:55` passes `name: 'Loaded Map'` unconditionally. The backend at `@c:\Users\Litun\Desktop\DND Project\dnd-companion\app\routers\builder_v2\library.py:192-193` uses `body.get("name") or snap.name`, so the client's hardcode wins. Every snapshot load → a new map called "Loaded Map" — user cannot distinguish them.

**Fix — client only:** remove the hardcode. Let the backend default to `snap.name`.

`@c:\Users\Litun\Desktop\DND Project\dnd-companion\static\js\builder_v2\90-library.js:55`:

```js
const resp = await S.api.loadSnapshot(id, { session_code: SESSION_CODE });
```

(Omit the `name` field entirely. The backend falls back to the snapshot's stored name.)

**Test:** add to `tests/test_smoke.py`:

```python
@pytest.mark.asyncio
async def test_phase9_load_as_map_preserves_snapshot_name(client, session_code):
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "Village Alpha"})).json()["id"]
    await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={"cols": 6, "rows": 6})
    snap_id = (await client.post("/api/builder-v2/library/save-from-map",
                                 json={"map_id": map_id, "name": "Village Snap"})).json()["id"]
    new_id = (await client.post(f"/api/builder-v2/library/{snap_id}/load-as-map",
                                json={"session_code": session_code})).json()["map_id"]
    maps = (await client.get(f"/api/builder-v2/sessions/{session_code}/maps")).json()
    new_map = next(m for m in maps if m["id"] == new_id)
    assert new_map["name"] == "Village Snap"
```

### A.2 — Builder Location dropdown shows locations from previously selected map

**Root cause (verified):** `@c:\Users\Litun\Desktop\DND Project\dnd-companion\static\js\builder_v2\30-editor.js:176-183` — when the user creates a new map, the code does `S.maps.push(m); S.currentMapId = m.id;` then immediately calls `createLocation(silent)` which reads `S.locations.length` for the default name and does `S.locations.push(loc)`. The old map's `S.locations` array is never cleared. Result: new map gets name `Location {oldCount+1}` and its dropdown shows the old map's entries merged with the new one until the next network refetch overrides.

**Fix:** reset state arrays before auto-creating the first location.

`@c:\Users\Litun\Desktop\DND Project\dnd-companion\static\js\builder_v2\30-editor.js:176-184`, replace exactly:

```js
      const m = await S.api.createMap({ name: name.trim() });
      S.maps.push(m);
      S.currentMapId = m.id;
      S.currentLocId = null;
      renderMapSelect();
      // Auto-create first location so the user can start drawing right away
      await createLocation(/*silent*/ true);
```

with:

```js
      const m = await S.api.createMap({ name: name.trim() });
      S.maps.push(m);
      S.currentMapId = m.id;
      S.currentLocId = null;
      // Clear stale locations from the previously selected map before
      // auto-creating the first location — otherwise createLocation picks
      // a default name like "Location 4" using the old map's count and
      // the dropdown shows old entries until the next refetch.
      S.locations = [];
      renderMapSelect();
      renderLocSelect();
      await createLocation(/*silent*/ true);
```

**Test:** covered by manual verification in §8.2 below. No automated test — pure client state.

### A.3 — Snapshot save sometimes captures an empty map

**Root cause (hypothesis, verify first):** The user reported saving a non-empty map and getting an empty snapshot. The most likely cause is that `S.currentMapId` points to a DIFFERENT map than what's visible in the canvas — for example, because the map was just created (A.2) and state is half-updated.

**Step 1 (diagnosis):** add defensive logging in `onSaveCurrentMap`:

`@c:\Users\Litun\Desktop\DND Project\dnd-companion\static\js\builder_v2\90-library.js:95`, expand the function:

```js
  async function onSaveCurrentMap() {
    if (!S.currentMapId) { alert('Select a Map first.'); return; }
    // Flush any pending tile strokes so the snapshot sees them on disk.
    if (typeof S.flushSave === 'function') {
      try { await S.flushSave(); } catch {}
    }
    const m = S.maps.find(x => x.id === S.currentMapId);
    const name = prompt('Snapshot name:', m?.name || 'Snapshot');
    if (!name) return;
    try {
      const snap = await S.api.saveSnapshot({
        map_id: S.currentMapId, name: name.trim(), description: ''
      });
      console.info('[bv2] snapshot saved', { map_id: S.currentMapId, snap });
      alert('Snapshot saved!');
    } catch (e) {
      console.error('bv2 saveSnapshot', e);
      alert('Failed to save snapshot');
    }
  }
```

**Step 2 (expose flushSave):** inside the IIFE at `30-editor.js`, at the bottom where other functions are attached to `S`, add `S.flushSave = flushSave;` (grep for similar `S.xxx = xxx` attachments to find the spot).

**Step 3 (backend test):** write a test that exactly mirrors the user flow — creates a map, paints tiles via PATCH, saves snapshot, loads it, asserts tiles are present.

```python
@pytest.mark.asyncio
async def test_phase9_save_and_load_preserves_tiles(client, session_code):
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "Painted"})).json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 8, "rows": 8})).json()["id"]
    tiles = [{"col": c, "row": 0, "tile_type": "wall"} for c in range(5)]
    await client.patch(f"/api/builder-v2/locations/{loc_id}/tiles",
                       json={"set": tiles, "erase": []})
    snap_id = (await client.post("/api/builder-v2/library/save-from-map",
                                 json={"map_id": map_id, "name": "PaintedSnap"})).json()["id"]
    new_id = (await client.post(f"/api/builder-v2/library/{snap_id}/load-as-map",
                                json={"session_code": session_code})).json()["map_id"]
    locs = (await client.get(f"/api/builder-v2/maps/{new_id}/locations")).json()
    assert len(locs) == 1
    full = (await client.get(f"/api/builder-v2/locations/{locs[0]['id']}")).json()
    assert len(full["tiles"]) == 5
    assert all(t["tile_type"] == "wall" for t in full["tiles"])
```

If this test passes on first run, the bug is user-timing (fix is the `flushSave` above — ensures pending paints are committed before snapshotting). If it fails, the bug is in `_snapshot_map` or `load_as_map` — then K2.6 must debug it and add an additional fix.

### A.4 — `/api/builder-v2/sessions/{code}/maps` may not exist under that exact path

**Action:** grep `@c:\Users\Litun\Desktop\DND Project\dnd-companion\app\routers\builder_v2\maps.py` for the route decorator. Adjust the test URLs in A.1/A.3 to match the actual paths. Do not guess.

### A.5 — Library modal should refresh after a successful save

**Root cause:** no UI feedback right now. User has to re-open the modal to see the new snapshot.

**Fix:** inside `onSaveCurrentMap` (after successful save), call `refreshLibraryList()` if the modal is visible. Use `document.getElementById('bv2-library-modal').classList.contains('hidden')` to check.

---

## 3. Track B — Lighting visibility

### B.1 — Builder has NO UI for `ambient_light` or `is_indoor`

**Root cause (verified by grep on `gm.html`):** zero matches for "ambient", "indoor", "is_indoor" inside `@c:\Users\Litun\Desktop\DND Project\dnd-companion\static\gm.html`. The `BV2Location` model has these fields and the PATCH endpoint accepts them, but there's no input surface. Default `ambient_light=1.0` means no darkness is ever rendered — user reports "не вижу освещения", that's why.

**Fix — UI additions.** In `gm.html`, find the section with `id="bv2-loc-select"` (the Location block in the bv2 panel). Directly BELOW the Location selector and ABOVE `bv2-btn-apply`, inject a new settings row:

```html
<div style="padding:6px 0;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
  <label style="flex:1 0 100%;font-size:0.7rem;color:var(--text-muted)">Ambient light</label>
  <input id="bv2-loc-ambient" type="range" min="0" max="1" step="0.05" value="1" style="flex:1">
  <span id="bv2-loc-ambient-val" style="width:32px;font-size:0.7rem">1.00</span>
  <label style="flex:1 0 100%;font-size:0.7rem;margin-top:4px;display:flex;gap:4px;align-items:center">
    <input id="bv2-loc-indoor" type="checkbox"> Indoor (heavy darkness fallback)
  </label>
</div>
```

Put the exact surrounding markup boundaries in your edit (use a unique anchor like `id="bv2-btn-apply"`). Do **not** add a new section wrapper, just insert inside the existing `.sidebar-section` block.

**Wire-up — `30-editor.js`:** add event handlers that save on change via the existing `queueSettingsSave` pipeline. Grep for `queueSettingsSave` to see the pattern; the new handlers should dispatch the same PATCH with `{ambient_light: parseFloat(...)}` or `{is_indoor: el.checked}`.

**Initial render** — when a location loads (`loadLocation`), populate these inputs from `S.view.location.ambient_light` and `S.view.location.is_indoor`. Grep for `loadLocation` in `30-editor.js` and `20-mapview.js` to find the right spot (look for where other settings-inputs are synced after `S.view.loadLocation(...)`).

### B.2 — Verify the lighting overlay actually paints

Open the page, set `ambient_light=0.3` and `is_indoor=true` on a location, switch player view. You should see a dark overlay.

**If you do:** ship B as-is.

**If you don't:** debug with browser devtools. The overlay is `_renderLightingOverlay` in `map-canvas.js` — it's called from `render()`. Check:

- `this.role === 'player'` — GM is excluded by design.
- `state.bv2_ambient_light` is actually in the `/api/map/{code}` response.
- `canvas.ambientLight` is actually being set (via `setAmbientLight`).

Do NOT change `_renderLightingOverlay`'s internals — if data doesn't reach it, the fix is in the bridge or the state-application in `static/js/player/10-map.js`.

### B.3 — GM soft-preview of darkness (REQUIRED, user-confirmed)

Right now `_renderLightingOverlay` hard-returns for GM role (`@static/js/map-canvas.js:1699`). GM cannot see the effect of ambient < 1 or indoor=true — this must be fixed so the GM gets visual feedback while building.

**Implementation:**

1. Remove the hard `return` for GM role. Replace with:
   ```js
   const isGm = this.role === 'gm';
   const softFactor = isGm ? 0.35 : 1.0;  // GM sees a dimmed preview
   ```
2. Multiply `darkAlpha` by `softFactor` when computing the outer darkness pass AND when computing the destination-out light holes (so the GM sees light sources as subtly bright regions against a subtly dark background — enough feedback to tune).
3. Do NOT enable fog-of-war cells for GM. GM always sees all tiles regardless of revealed set. The preview is ONLY the ambient/indoor darkness overlay.

**Test (manual):** set ambient=0.2 indoor=true on a location, open Map tab as GM — the canvas should look noticeably dimmer with a subtle torch glow at each light marker, but all walls/tiles remain visible.

Do NOT add a separate `previewLighting` canvas option. The `role === 'gm'` check is sufficient — GM always gets the soft preview, player always gets the full dark.

---

## 4. Track C — Interior Zones (rooms/shops inside a Location)

### C.1 — Model

**New table** `BV2InteriorZone`:

- `id`: int PK
- `location_id`: FK → `bv2_locations.id`, ON DELETE CASCADE
- `name`: str (max 120), default "Interior"
- `kind`: str — `"building" | "cave" | "room"`. Default `"building"`.
- `ambient_light_override`: float | null (when a character is inside, replace the location's ambient)
- `reveal_mode`: str — `"on_enter"` (default) | `"always"` | `"gm_only"`
- `created_at`: datetime

**New table** `BV2InteriorCell`:

- `id`: int PK
- `zone_id`: FK → `bv2_interior_zones.id`, ON DELETE CASCADE
- `col`: int
- `row`: int
- UNIQUE(`zone_id`, `col`, `row`)

**Migration:** add via alembic. Follow the existing alembic pattern (look at `@c:\Users\Litun\Desktop\DND Project\dnd-companion\alembic\versions` for recent migrations). Autogenerate, then review and commit.

### C.2 — Endpoints

All under `/api/builder-v2`:

- `GET /locations/{loc_id}/interiors` → list zones with their cells
- `POST /locations/{loc_id}/interiors` → body: `{name, kind, ambient_light_override, reveal_mode, cells: [{col,row}, ...]}`. Returns the created zone with its cells.
- `PATCH /interiors/{zone_id}` → body: any of `{name, kind, ambient_light_override, reveal_mode}`. Tiles are replaced via a separate endpoint.
- `PUT /interiors/{zone_id}/cells` → body: `{cells: [{col,row}]}` — full replacement.
- `DELETE /interiors/{zone_id}` → cascade deletes cells.

WS events: `bv2.interior_added`, `bv2.interior_updated`, `bv2.interior_deleted` — payload `{location_id, zone_id}`.

### C.3 — Bridge integration

In `_build_state_from_bv2` (`@c:\Users\Litun\Desktop\DND Project\dnd-companion\app\routers\map\files.py`), add a new field in the returned dict:

```python
"bv2_interiors": interiors,
```

where `interiors` is built like:

```python
interiors_q = await db.execute(
    select(BV2InteriorZone).where(BV2InteriorZone.location_id == loc.id)
)
zones = interiors_q.scalars().all()
interiors = []
for z in zones:
    cells_q = await db.execute(
        select(BV2InteriorCell).where(BV2InteriorCell.zone_id == z.id)
    )
    interiors.append({
        "id": z.id, "name": z.name, "kind": z.kind,
        "reveal_mode": z.reveal_mode,
        "ambient_light_override": z.ambient_light_override,
        "cells": [{"col": c.col, "row": c.row} for c in cells_q.scalars().all()],
    })
```

### C.4 — Client reveal logic

Extend `map-canvas.js` (addition only, no refactor):

- New state: `this.interiors = []`, setter `setInteriors(arr)`.
- In the render pipeline, AFTER `_renderLightingOverlay` and BEFORE the "Tokens" loop, add `_renderInteriorOverlay(ctx)`.
- For each interior zone:
  - Compute set of cells: `new Set(cells.map(c => \`${c.col},${c.row}\`))`.
  - If `reveal_mode === "gm_only"` and `this.role !== "gm"`: fill those cells with `rgba(0,0,0,1.0)` (fully blocked).
  - If `reveal_mode === "always"`: skip (no overlay).
  - If `reveal_mode === "on_enter"` (strict "building with a roof" model — user-confirmed):
    - Determine whether a friendly token is currently inside any of those cells. Use `this.tokens.filter(t => !t.is_npc && t.visible)` — match via grid coords derived from `t.x * cols`, `t.y * rows` (round-half-down to match how tokens are placed).
    - **If no player token is inside:** fill cells with `rgba(0,0,0,0.95)` for players, `rgba(0,0,0,0.45)` for GM (soft preview). Interior is fully hidden — a building with a closed roof.
    - **Door peek (REQUIRED, user-confirmed):** if the zone has one or more door tiles on its boundary (`tile_type === 'door'` AND the tile sits on a cell adjacent both to an interior cell and to an outside cell) AND the door is **open** (`is_open === true`), then for each player token within 3 cells of the open door render a 2-cell-deep cone of interior cells through the doorway by NOT overlaying those cells in the darkness pass. GM always sees this cone regardless of standing position.
    - **Door `is_open` state:** add a new nullable column `is_open` to `BV2Tile` (default `True` in the ORM, stored as `False` only when GM explicitly closes a door). GM toggles via a right-click context-menu item "Toggle door" on door tiles in the builder. Persist per-tile. Door peek works only when `is_open === true`.
    - **If any player token is inside the zone:** reveal — fill nothing for the zone's interior cells, then apply `ambient_light_override` if set (a warm cone-cut in the lighting overlay, mirroring `_renderLightingOverlay`'s destination-out approach but scoped to this zone's cells).
    - **Re-close on exit (strict, user-confirmed):** the moment no player is inside, the zone re-hides on the next render. Do NOT persist interior discovery. Filter interior cells out of the `BV2VisitState` explored_tiles merge — `remember_explored` applies only to cells OUTSIDE every interior zone on the location.

### C.5 — Builder UI

Add an "Interior" terrain button to the TERRAIN panel in `gm.html` (same place as Floor/Wall/Water) labelled "Zone". When selected, painting doesn't create tiles — it creates an in-progress interior zone. Enter-key commits it (prompt for name). Zones appear as a collapsed list under TERRAIN with name + edit/delete buttons.

This is deliberately minimal UX. Polish in Phase 10.

### C.6 — Tests

In `tests/test_smoke.py`:

```python
@pytest.mark.asyncio
async def test_phase9_interior_zone_crud(client, session_code):
    ...create map+loc, POST /interiors with 4 cells, GET list, PATCH, DELETE...

@pytest.mark.asyncio
async def test_phase9_bridge_includes_interiors(client, session_code):
    ...create zone, activate map/loc, GET /api/map/{code}, assert
    state["bv2_interiors"] has the zone with cells...
```

---

## 5. Track D — Character/NPC bridge

### D.1 — Walk-transitions between Locations on the same Map

User flow: Location1 has an edge tile at column 39. Walking a character onto col 39 should teleport them to Location5 at the edge's `target_entry_col/row`.

**Root cause check:** `@c:\Users\Litun\Desktop\DND Project\dnd-companion\app\routers\builder_v2\edges.py` — `move-grid` endpoint exists but does it detect edge crossings and forward to the target location? Grep it, read, decide:

- If yes: verify it broadcasts `bv2.location_activated` for the player's character so the client canvas re-fetches.
- If no: add edge-detection logic into `move-grid`. After updating `character.col/row`, query edges where `side` matches the character's moving direction and the new col/row is within `range_start..range_end`. If match: set `character.current_location_id = edge.target_location_id`, `character.col = edge.target_entry_col`, `character.row = edge.target_entry_row`. Commit. Broadcast a new event `bv2.character_transitioned {character_id, from_location_id, to_location_id, col, row}`.

**Client:** the player canvas must listen for `bv2.character_transitioned` (in `static/js/player/10-map.js`) and if the transitioned character is `CHAR_ID`, re-fetch the map state. If it's someone else's char but on our current location, also re-fetch (they disappeared).

**Test:** full round-trip — place char on edge cell, POST move-grid, assert character.current_location_id switched and col/row are target_entry.

### D.2 — NPC auto-spawn on location enter

`BV2NPCSpawn` already exists with `auto_spawn_trigger`. Implement the `on_enter` trigger:

When `/locations/{id}/activate` is called (`@c:\Users\Litun\Desktop\DND Project\dnd-companion\app\routers\builder_v2\locations.py`), after activating:

```python
spawns_q = await db.execute(
    select(BV2Entity, BV2NPCSpawn)
    .join(BV2NPCSpawn, BV2NPCSpawn.entity_id == BV2Entity.id)
    .where(BV2Entity.location_id == location_id)
    .where(BV2NPCSpawn.auto_spawn_trigger == "on_enter")
    .where(BV2NPCSpawn.has_spawned.is_(False))
)
for ent, spawn in spawns_q.all():
    # Create Character rows from template
    # Set current_location_id, col, row from ent
    # Mark spawn.has_spawned = True
    ...
```

Use the existing NPC-template → Character seeding logic (grep `npc_template` + `Character(` in the codebase to find it — the legacy map-builder already uses `NPCLibrary` / NPC templates to spawn characters). User confirmed NPC templates already exist in the DB; the task here is wiring the bv2 builder to that same library.

If no helper function exists (only inline code in legacy): extract a single `spawn_npc_from_template(db, template_id, *, session_id, location_id, col, row, count=1)` helper in a new file `app/routers/builder_v2/spawns.py` and call it from both the legacy spot and the new bv2 `activate_location` hook. Never duplicate the seeding logic.

### D.2b — Builder UI for `npc_spawn` entity MUST list templates from the NPC library

When the GM places an `npc_spawn` entity in the bv2 builder, the edit modal must show a dropdown populated from the existing NPC library endpoint (grep `GET /api/.../npc` or `npc-library` in the legacy code to find it). Storing `npc_template_id` as a raw int textbox is NOT acceptable — user explicitly required the builder to be "связан с библиотекой npc".

Add the dropdown to the npc_spawn edit modal in `static/js/builder_v2/*` (grep for existing entity-edit modals — likely in `40-entities.js` or similar). Options: `<option value="${t.id}">${t.name}</option>`. On load, preselect the stored `npc_template_id`.

**Test:** create NPCSpawn with `on_enter`, activate the location, assert N characters created with correct location_id/col/row, spawn.has_spawned flipped.

### D.3 — Builder canvas shows character tokens

Currently the builder preview canvas shows only tiles and entities, not live character positions. GM wants to see where players are while building.

In `static/js/builder_v2/20-mapview.js`, after `loadLocation`, fetch characters for this location:

```js
const chars = await api.get(`/api/characters/session/${SESSION_CODE}?current_location_id=${location.id}`);
```

(Check whether that query param is supported — if not, filter client-side.)

Render as small token circles at `(col, row)` with the character's `token_color`. Read-only, no drag (drag is Phase 10).

### D.4 — Exclude non-active-location characters from bridge tokens

Already fixed — see `@c:\Users\Litun\Desktop\DND Project\dnd-companion\app\routers\map\files.py:174` — the `if c.current_location_id != loc.id: continue` line. Verify with a test:

```python
@pytest.mark.asyncio
async def test_phase9_bridge_excludes_chars_from_other_locations(client, session_code):
    ...create two locations, put char A on loc1 and char B on loc2,
    activate loc1, GET /api/map, assert only char A is in tokens...
```

---

## 6. Testing summary

Target after Phase 9: **72 tests** (61 baseline + A:4 + C:2 + D:2 + room for one or two more you add while debugging).

After each track, run `.\dev.ps1 check`, record the count in `docs/temp_fix.md` as "Phase 9 — Track X: N tests, all green".

---

## 7. Execution order — do not deviate

1. **Track A** first — tiny bugs, unblocks the user's immediate complaint about library.
   - A.1 → test → A.2 → manual test → A.3 → test → A.5
   - Run `.\dev.ps1 check` — target ~64 tests
2. **Track B** next — user-visible lighting.
   - B.1 UI → B.2 verify → (optional B.3)
   - No new automated tests; manual verification via `§8.3`.
3. **Track C** — the big new feature.
   - Model + migration → endpoints → bridge field → client render → UI
   - Tests alongside each endpoint. Target after track: ~68 tests.
4. **Track D** — character/NPC flow.
   - D.4 test first (probably passes) → D.1 transitions → D.2 NPC spawn → D.3 builder tokens
   - Target after track: ~72 tests.

At the end of the whole plan, run the **Pre-phase greps** from project standing rules (S1 Python, S1 JS, S5a, S5b) and confirm zero new violations.

---

## 8. Manual verification — full journey

This is the single scenario the user will click through to decide whether Phase 9 is "done". Do not declare completion until every step below works on a fresh browser reload.

### 8.1 Library save/load

1. GM opens builder. Creates "Village A", adds Location "Plaza" (5x5 painted). Creates Location "Storage" (3x3 painted).
2. Clicks **Save Snapshot** → names it "Village A". Alert confirms saved.
3. Opens Library modal. Sees "Village A" in list.
4. Clicks **Load**. Modal closes.
5. Map dropdown now contains "Village A (★)" as the newly-loaded and auto-activated map — **not** "Loaded Map".
6. Switches to Map tab. Walls from Plaza are visible.
7. Switches back to Builder. Selects Location dropdown. Sees "Plaza" and "Storage" for Village A. **Does not see** locations from unrelated maps.

### 8.2 Location-map separation

1. GM creates "Village B" (empty). Map dropdown switches to B.
2. Location dropdown shows only "Location 1" (auto-created), NOT "Plaza" or "Storage".
3. GM switches back to Village A. Location dropdown again shows only "Plaza" and "Storage".

### 8.3 Lighting

1. On Plaza, ambient slider to 0.3. Indoor checkbox checked.
2. Apply to Game.
3. Player tab. Map shows noticeable darkness overlay.
4. Return to Builder. Plaza ambient slider reflects 0.3, checkbox reflects checked (persisted).

### 8.4 Interior zones

1. Builder → Plaza. Select "Zone" terrain. Paint a 3x3 rectangle inside the plaza. Name it "Shop".
2. Apply to Game.
3. Player tab (character NOT inside the 3x3 area): shop cells are covered with darkness / ??? outline.
4. Walk character into one of the shop cells. Shop reveals — tiles/entities inside are now visible.
5. Walk back out. Shop becomes covered again (if `reveal_mode=on_enter` is the strict default — if `remember_explored=True` is respected, shop stays revealed; decide with user at step 4 whether to persist).

### 8.5 Transitions

1. Builder → Plaza → paint an edge with target "Storage".
2. Apply to Game.
3. Player tab (char on Plaza). Walk onto the edge cell.
4. After move-grid HTTP completes, player map re-loads showing the Storage location, char at the target entry cell.

### 8.6 NPC spawn

1. Builder → Plaza → place an `npc_spawn` entity with an NPC template ID and `auto_spawn_trigger=on_enter`, `spawn_count=2`.
2. Apply to Game.
3. Verify: 2 new Character rows exist with `current_location_id=Plaza.id`, `is_npc=True`, and `col/row` equal to the spawn entity's cell.
4. Player tab: 2 NPC tokens visible.
5. Re-activate Plaza a second time → no duplicate spawn (has_spawned=True).

---

## 9. Anti-patterns — explicit blocklist

- **Do not** add `props_json` to any bv2 table. Phase 7 deleted it deliberately.
- **Do not** create a "rooms" concept as a separate Location. User explicitly requested interiors as sub-zones on the same Location.
- **Do not** use polling (`setInterval`) to refresh the player canvas. Every update must be WS-driven.
- **Do not** auto-activate maps from the backend on snapshot load. The client does that via two explicit API calls after load (existing behaviour).
- **Do not** rewrite `map-canvas.js`. Additions go through new setters + a new `_renderInteriorOverlay` helper inside the same file. Maximum 60 new lines in that file across the whole phase.
- **Do not** consolidate legacy and bv2 libraries into one UI. Leave the Map tab's "Load from Library" pointing to bv2 only (already fixed), and don't touch the legacy library.
- **Do not** skip `flushSave()` in `onSaveCurrentMap`. That's an observable user bug.
- **Do not** swallow errors silently. The existing `} catch {}` blocks stay; new catches must `console.error`.
- **Do not** change any WS event name. Add new ones (`bv2.interior_*`, `bv2.character_transitioned`), never rename.
- **Do not** change the test counter in `docs/BUILDER_V2_HANDOFF.md` to a number you haven't seen pytest actually report.

---

## 10. Done definition

Phase 9 is complete when ALL of the following are true:

- [ ] `.\dev.ps1 check` shows ~72 tests green, ruff clean.
- [ ] Manual scenario §8.1 through §8.6 all pass on one fresh browser reload.
- [ ] `docs/BUILDER_V2_HANDOFF.md` updated: new test count, new Phase 9 section listing interior-zone model, walk-transition behaviour, NPC on_enter semantics.
- [ ] `docs/temp_fix.md` appended with a Phase 9 changelog listing every file modified and the corresponding bug/feature reference (A.1, B.1, C.3, etc.).
- [ ] No files outside Phase 9 scope modified. Git diff should be localised to:
  - `app/models.py` (new tables)
  - `app/routers/builder_v2/*.py` (new endpoints, transition logic, spawn logic)
  - `app/routers/map/files.py` (bridge field)
  - `alembic/versions/xxx.py` (new migration)
  - `static/gm.html` (new UI widgets, minimal)
  - `static/js/builder_v2/*.js` (state resets, UI wiring)
  - `static/js/map-canvas.js` (narrow additions only)
  - `static/js/player/10-map.js` (one new WS listener)
  - `tests/test_smoke.py` (new tests)
  - `docs/*` (handoff + fix log)

If you cannot make all of these true in one pass, STOP, write down exactly which criterion failed and why, tell the user, and wait for direction. Do not partial-ship silently.

---

## 11. User-confirmed decisions (do not re-ask)

- **Interior reveal when player exits:** strict re-close. "Здание = крыша, человек не видит внутри пока не зайдёт". Do NOT persist interior discovery via `remember_explored`.
- **Door peek:** if a tile on the interior boundary is `tile_type='door'` and `is_open=True`, players within 3 cells of the door see a 2-cell-deep cone of interior cells through it. Implement `BV2Tile.is_open` column + GM toggle UI.
- **B.3 GM soft preview:** REQUIRED, not optional. Implement as part of Track B.
- **NPC templates:** already exist in DB. The work is to wire the bv2 `npc_spawn` builder modal to the existing NPC library dropdown AND to reuse the existing template→Character seeding helper. See D.2 and D.2b.

— End of plan.
