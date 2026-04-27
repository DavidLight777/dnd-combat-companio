# Phase 7 — Bridge fix list (for K2.6 hand-off)

**Author:** Cascade, 2026-04-26
**Status:** PENDING — please apply in order, do not skip steps.
**Audience:** K2.6. You have many parameters and limited intuition.
This doc is **explicit on purpose**. Every file path is absolute.
Every code change has line anchors. Every test has a copy-paste
command. Do not improvise.

---

## 0. Hard rules — read before touching anything

1. **Do not invent.** If a snippet says "find this exact string and
   replace with this exact string", do that. Do not reformat, do not
   reorder fields, do not add comments unless the snippet has them.
2. **Do not refactor.** This is a surgical bug-fix pass, not a
   redesign. If you feel an urge to "improve" something nearby,
   stop.
3. **No JSON config.** Builder v2 entities are typed-tables-only.
   Never write `props_json`, `JSON.stringify`, `json.loads` in any
   bv2 entity flow. If you find yourself typing those — abort.
4. **No `or N` / `|| N` for numeric defaults.** Use
   `value if value is not None else N` in Python and `value ?? N` in
   JS. This rule is absolute. (Phase 6 lost two days to this.)
5. **TDD.** For every behaviour change in §2-§5, the matching test
   in §6 must:
   - exist and **fail** before your code change (run pytest, observe
     the documented assertion failure),
   - **pass** after your code change.
   If a test passes immediately on first run before your code change,
   the test is wrong. Tell the user. Do not silently proceed.
6. **Do not touch `static/js/map-canvas.js`.** It is 1700+ lines and
   not your problem. All bridging happens upstream of it.
7. **Run `.\dev.ps1 check` after every bug fix and confirm 55+
   tests still pass.** Do not let red bleed into the next bug.

---

## 1. The user's symptom (what we are fixing)

> *"Maps loaded from the library still don't show up on the player
> Map tab."*

After investigation, this single symptom decomposes into **four
independent bugs**. Fix them in the order below. Each one alone
would prevent the symptom; all four must be fixed for the full
journey to work.

---

## 2. Bug #1 — Player Map tab does not refresh on `bv2.*` activation

### 2.1. Root cause (verified by grep)

Grep for `bv2.` and `_activated` in `static/js/player/`:
**zero matches**. Same for `static/js/gm/`. Only the builder UI
itself listens for `bv2.location_activated` (in
`@c:\Users\Litun\Desktop\DND Project\dnd-companion\static\js\builder_v2\40-websocket.js:73`).

Backend WS broadcasts both `bv2.map_activated` and
`bv2.location_activated`, but **no consumer outside the builder
hears them**. The player Map tab caches `_lastMapState` and only
refreshes when the GM clicks something the legacy code already
handles. Activating a bv2 map silently does nothing on the
player's screen until they hard-reload.

### 2.2. Fix — file 1: `static/js/player/10-map.js`

**Find this exact line** (around line 318, the very end of the file):

```js
$('#btn-close-map').addEventListener('click', () => {
  $('#map-modal').style.display = 'none';
});
```

**Append directly after it** (do not reorder, do not wrap in IIFE):

```js
// Phase 7 bridge: refresh map when GM activates a bv2 map / location.
// The legacy `map.updated` event already triggers loadPlayerMapState
// elsewhere; we only add the bv2 events.
if (typeof ws !== 'undefined' && ws && typeof ws.on === 'function') {
  ws.on('bv2.map_activated',      () => { loadPlayerMapState(); });
  ws.on('bv2.location_activated', () => { loadPlayerMapState(); });
}
```

**Verification:** before the change, run `test_phase7_bridge_player_ws_refresh`
(see §6.1) — it must fail with the documented assertion. After the
change, it must pass.

### 2.3. Fix — file 2: `static/js/gm/06-map-main.js`

The GM also has a Map tab. Same problem. **Find** the section that
sets up WS listeners for map events. Grep for `ws.on('map.` inside
this file. Add — directly after the last `ws.on('map.…')` line in
the same block — these two listeners:

```js
ws.on('bv2.map_activated',      () => { if (typeof loadGmMapState === 'function') loadGmMapState(); });
ws.on('bv2.location_activated', () => { if (typeof loadGmMapState === 'function') loadGmMapState(); });
```

If the function name is different (grep `loadMapState\|refreshMap`
in the same file to find it), substitute the real name. **Do not
guess** — open the file, read, then edit.

---

## 3. Bug #2 — `loadPlayerMapState` wipes out bv2 chests and portals

### 3.1. Root cause (verified by reading code)

`@c:\Users\Litun\Desktop\DND Project\dnd-companion\static\js\player\10-map.js:115-130`:

```js
const afid = state.active_floor_id;
if (afid) {
  const allChests = await api.get(`/api/map-builder/${SESSION_CODE}/chests`);
  state._mapChests = (allChests || []).filter(c => c.floor_id === afid && !c.is_hidden);
  const allPortals = await api.get(`/api/map-builder/${SESSION_CODE}/portals`);
  state._portals = (allPortals || []).filter(p => p.floor_id === afid);
} else {
  state._mapChests = [];
  state._portals = [];
}
```

The bv2 bridge in `app/routers/map/files.py` returns
`active_floor_id: None` on purpose (it's the signal "this state
came from bv2, not legacy MapFloor"). The bridge **already
populated** `state._mapChests` and `state._portals` from typed
tables. This client code then sees `afid` is null, falls into the
`else` branch, and **clobbers them with empty arrays**.

Net effect: chests and portals built in the v2 builder never reach
the player canvas, even when activation works.

### 3.2. Fix — `static/js/player/10-map.js`

**Replace** the entire block at lines 115-130 (the `try { ... }
catch { ... }` that fetches `/api/map-builder/.../chests`) with:

```js
  // Phase 7: bv2 bridge already populated _mapChests / _portals
  // when active_floor_id is null (bv2-sourced state). Only fetch
  // legacy map-builder chests/portals when a legacy floor is active.
  try {
    const afid = state.active_floor_id;
    if (afid) {
      const allChests = await api.get(`/api/map-builder/${SESSION_CODE}/chests`);
      state._mapChests = (allChests || []).filter(c => c.floor_id === afid && !c.is_hidden);
      const allPortals = await api.get(`/api/map-builder/${SESSION_CODE}/portals`);
      state._portals = (allPortals || []).filter(p => p.floor_id === afid);
    } else if (!state.bv2_active_location_id) {
      // No legacy floor AND no bv2 source — clear them.
      state._mapChests = [];
      state._portals = [];
    }
    // else: bv2-sourced; leave the bridge-provided arrays alone.
  } catch {
    if (!state.bv2_active_location_id) {
      state._mapChests = [];
      state._portals = [];
    }
  }
```

The key change: the `else` branch now **only clears** when neither
a legacy floor nor a bv2 location is active. When bv2 is the
source, we leave the bridge's data intact.

### 3.3. Same bug, mirror file: `static/js/gm/06-map-main.js`

Grep that file for the exact same pattern (`active_floor_id` check
+ `_mapChests = []` in else). If found, apply the same fix using
the same conditional `!state.bv2_active_location_id` guard. If
**not** found, the GM page uses a different code path — leave it.

---

## 4. Bug #3 — Library "Load" button does not auto-activate the new map

### 4.1. Root cause (verified)

`@c:\Users\Litun\Desktop\DND Project\dnd-companion\static\js\builder_v2\90-library.js:52-62`:

```js
const id = parseInt(btn.dataset.loadId, 10);
if (!confirm('Load this snapshot as a new Map?')) return;
try {
  await S.api.loadSnapshot(id, { session_code: SESSION_CODE, name: 'Loaded Map' });
  closeLibraryModal();
  if (typeof S.loadMaps === 'function') await S.loadMaps();
} catch (e) {
  console.error('bv2 loadSnapshot', e);
  alert('Failed to load snapshot');
}
```

The backend `load-as-map` endpoint creates the new map with
`is_active=False` (intentional — see
`@c:\Users\Litun\Desktop\DND Project\dnd-companion\app\routers\builder_v2\library.py:195`).
The UI then refreshes the map list and stops. **No call to
`activateMap`. No call to `activateLoc`.** Players still see the
previous active map (or nothing).

### 4.2. Fix — `static/js/builder_v2/90-library.js`

**Replace** the body of the try block (the four lines starting with
`await S.api.loadSnapshot`) with:

```js
      const resp = await S.api.loadSnapshot(id, { session_code: SESSION_CODE, name: 'Loaded Map' });
      const newMapId = resp && resp.map_id;
      closeLibraryModal();
      if (typeof S.loadMaps === 'function') await S.loadMaps();
      // Phase 7: auto-activate the loaded map and its first location
      // so players see it immediately. Skip silently if the snapshot
      // happened to be empty.
      if (newMapId) {
        try {
          await S.api.activateMap(newMapId);
          const locs = await S.api.listLocs(newMapId);
          if (Array.isArray(locs) && locs.length > 0) {
            await S.api.activateLoc(locs[0].id);
          }
        } catch (e2) {
          console.error('bv2 auto-activate after load', e2);
        }
      }
```

**Note:** `S.api.activateMap`, `S.api.activateLoc`, and
`S.api.listLocs` already exist in
`@c:\Users\Litun\Desktop\DND Project\dnd-companion\static\js\builder_v2\10-api.js:15-23`.
Do **not** add new API helpers; use these.

### 4.3. Why we activate map AND location

Phase 7 backend bridge has a fallback in
`@c:\Users\Litun\Desktop\DND Project\dnd-companion\app\routers\map\files.py`:
if no location is `is_active=True`, it picks the first by
`sort_order`. That fallback works in the test suite but is fragile
for the user (no explicit "selected" location → harder to debug).
Setting an explicit active location removes ambiguity.

---

## 5. Bug #4 — Hex auto-fit on player canvas still uses axial coords

### 5.1. Root cause

`@c:\Users\Litun\Desktop\DND Project\dnd-companion\static\js\player\10-map.js:69-75`:

```js
if (canvas.tileGridType === 'hex') {
  for (const k of keys) {
    const [q, r] = k.split(',').map(Number);
    const x = gs * (q + r / 2), y = gs * (Math.sqrt(3) / 2 * r);
    ...
```

Phase 7 switched bv2 hex to **odd-r offset coordinates**
everywhere else (see
`@c:\Users\Litun\Desktop\DND Project\dnd-companion\static\js\builder_v2\20-mapview.js:_tileCenterPx`).
This auto-fit function still uses axial. With a bv2 hex map active,
the auto-fit will compute wrong bounds → camera centres on the
wrong area.

### 5.2. Fix — `static/js/player/10-map.js`

**Replace** the `if (canvas.tileGridType === 'hex')` block (lines
69-75) with:

```js
  if (canvas.tileGridType === 'hex') {
    for (const k of keys) {
      const [c, r] = k.split(',').map(Number);
      // odd-r offset matching bv2 builder
      const xOff = (r & 1) ? gs / 2 : 0;
      const x = c * gs + xOff;
      const y = r * gs * (Math.sqrt(3) / 2);
      if (x < minX) minX = x; if (x > maxX) maxX = x + gs;
      if (y < minY) minY = y; if (y > maxY) maxY = y + gs;
    }
  }
```

Note both the formula change and the addition of `+ gs` on `maxX` /
`maxY` to include the cell's full size in the bounds (the original
square branch already does this — the hex branch was missing it).

### 5.3. Out of scope right now

Do **not** change the hex rendering inside
`static/js/map-canvas.js`. That file may also use axial coords
internally for hex tiles — that is a Phase 8 concern for the
player-side hex renderer. We are only fixing **auto-fit camera
math** here, which is the only place the bv2 mismatch causes
visible misbehaviour.

---

## 6. Tests — write these BEFORE fixing the corresponding bug

All tests go in
`@c:\Users\Litun\Desktop\DND Project\dnd-companion\tests\test_smoke.py`.
Append at the end of the file. Use `pytest -k <name>` to run a
single one.

### 6.1. Test for Bug #1 (WS refresh)

**Skip.** WS plumbing on the player browser cannot be tested with
the current pytest harness (no headless browser). Verify Bug #1
manually:

1. Open two browser windows: GM at `/gm/{code}`, player at
   `/player/{code}`.
2. Player opens Map tab. Note "no map" empty-state.
3. GM activates a bv2 map+location.
4. **Within ~1 second**, the player Map tab must transition from
   "no map" to showing the map. If the player has to refresh
   manually, Bug #1 is not fixed.

### 6.2. Test for Bug #2 (chests not wiped) — **BACKEND** test only

The wipe is client-side, but we can verify the server payload is
correct so the client has something to keep:

```python
@pytest.mark.asyncio
async def test_phase7_bridge_payload_keeps_bv2_chests_with_null_active_floor_id(client, session_code):
    """The bv2 bridge must return _mapChests with active_floor_id=None.
    The client uses active_floor_id=None as a signal to NOT wipe the
    bridge-provided chests."""
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "M"})).json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 10, "rows": 10})).json()["id"]
    r = await client.post(f"/api/builder-v2/locations/{loc_id}/chests", json={
        "col": 5, "row": 5, "name": "Loot", "is_locked": False, "is_opened": True,
    })
    ent_id = r.json()["id"]
    await client.post(f"/api/builder-v2/maps/{map_id}/activate", json={})
    await client.post(f"/api/builder-v2/locations/{loc_id}/activate", json={})
    state = (await client.get(f"/api/map/{session_code}")).json()
    # Critical assertions for Bug #2:
    assert state["active_floor_id"] is None, \
        "bv2-sourced state must signal active_floor_id=None"
    assert state["bv2_active_location_id"] == loc_id, \
        "bv2 source marker must be set"
    assert any(c["name"] == "Loot" for c in state.get("_mapChests", [])), \
        "bridge must populate _mapChests; the client trusts this"
```

This test should already pass after Phase 7 backend work. If it
**fails on first run**, the bug is in the backend bridge, not the
client. Do not proceed to the client fix until backend is green.

### 6.3. Test for Bug #3 (auto-activate on library load)

```python
@pytest.mark.asyncio
async def test_phase7_library_load_then_activate_via_ui_flow(client, session_code):
    """Verify the backend supports the auto-activate-after-load flow
    that the client now performs. The client calls loadSnapshot ->
    activateMap -> activateLoc; this test exercises the same
    sequence and asserts /api/map surfaces the new map."""
    # Build + save a snapshot
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "Original"})).json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 6, "rows": 6})).json()["id"]
    await client.patch(f"/api/builder-v2/locations/{loc_id}/tiles", json={
        "set": [{"col": 1, "row": 1, "tile_type": "wall"}], "erase": [],
    })
    snap_id = (await client.post("/api/builder-v2/library/save-from-map",
                                 json={"map_id": map_id, "name": "Snap"})).json()["id"]
    # Load (UI step 1)
    new_map_id = (await client.post(f"/api/builder-v2/library/{snap_id}/load-as-map",
                                    json={"session_code": session_code,
                                          "name": "Loaded"})).json()["map_id"]
    # Auto-activate map (UI step 2 — this is what 90-library.js will now do)
    await client.post(f"/api/builder-v2/maps/{new_map_id}/activate", json={})
    # Auto-activate first location (UI step 3)
    locs = (await client.get(f"/api/builder-v2/maps/{new_map_id}/locations")).json()
    assert len(locs) > 0, "loaded snapshot must include at least one location"
    await client.post(f"/api/builder-v2/locations/{locs[0]['id']}/activate", json={})
    # Player view sees it immediately
    state = (await client.get(f"/api/map/{session_code}")).json()
    assert state["bv2_active_location_id"] == locs[0]["id"]
    assert "1,1" in state["active_floor_tiles"]
```

### 6.4. No backend test for Bug #4

Hex auto-fit math is purely client-side. Verify manually:

1. Create a bv2 location with `grid_type='hex'` and at least 5
   walls on different rows.
2. Activate it.
3. On the player Map tab, click "Fit". The viewport must centre on
   the painted region with reasonable padding.

---

## 7. Order of execution — strict

Do this exactly:

1. **Append §6.2 test.** Run `.\dev.ps1 check`. It should pass
   (Phase 7 already shipped this functionality). If it fails, stop
   and report.
2. **Append §6.3 test.** Run `.\dev.ps1 check`. It should also pass
   (this is just a sequence the test can already execute today).
   If it fails, stop and report.
3. **Apply §3.2** (client chest-wipe fix in
   `static/js/player/10-map.js`). Tests still green; manual
   verification of bug #2 deferred to §8.
4. **Apply §3.3** if the same pattern exists in
   `static/js/gm/06-map-main.js`. Grep first.
5. **Apply §5.2** (hex auto-fit fix in
   `static/js/player/10-map.js`). Tests still green.
6. **Apply §4.2** (auto-activate on library load in
   `static/js/builder_v2/90-library.js`). Tests still green.
7. **Apply §2.2** (player WS listeners).
8. **Apply §2.3** (GM WS listeners).
9. Run `.\dev.ps1 check`. Confirm test count is **57** (55 + 2
   new). All green.
10. Run all three Pre-phase greps from `temp_fix.md` standing rules
    (S1 Python, S1 JS, S5a, S5b). Zero matches required for S1; no
    new incoming arrows added so S5 is unchanged.

---

## 8. Manual verification (after all code changes)

In the user's words: *"карта не выгружается с библиотеки в map"*.
The full manual journey that must work:

1. GM opens builder, builds a small map (3-4 walls, 1 chest with
   item, 1 trap, 1 portal).
2. GM saves snapshot to library.
3. GM closes builder, opens player tab in another browser.
4. Player Map tab: empty state ("no map").
5. GM opens library modal, clicks "Load" on the snapshot.
6. **WITHOUT any further action**, player Map tab transitions from
   "no map" to the loaded map within ~1 second:
   - tiles visible (the 3-4 walls)
   - chest visible with its name
   - trap visible (assuming `visible_to_players=True` was set)
   - portal visible
7. GM opens builder, paints another wall on the active location.
8. **Within ~1 second**, the new wall appears on the player canvas
   (this validates the WS rebroadcast, which Phase 7 already
   shipped).

If any of steps 6 or 8 fail, capture browser console + WS network
trace and tell the user. Do **not** retry by adding more code paths.

---

## 9. Anti-patterns — explicit blocklist for K2.6

You will be tempted to do these. Do not.

- **Do not** add `props_json` anywhere. The column is gone from the
  DB. Phase 7 deleted it deliberately.
- **Do not** rewrite `static/js/map-canvas.js`. Don't even open it.
  All bridging happens in `app/routers/map/files.py` (server) and
  `static/js/player/10-map.js` (state-application client).
- **Do not** add new endpoints. Every fix in this doc reuses
  existing endpoints (`activateMap`, `activateLoc`, `listLocs`,
  `loadSnapshot`).
- **Do not** rename `loadPlayerMapState`, `_applyMapStateTo`,
  `_lastMapState`. They are referenced from many other files.
- **Do not** add a polling timer (`setInterval` to refresh
  `/api/map`). The fix is event-driven WS listeners. A polling
  fallback hides bugs.
- **Do not** auto-deactivate other maps in `loadSnapshot`. The
  backend `activate_map` endpoint already does that
  (`@c:\Users\Litun\Desktop\DND Project\dnd-companion\app\routers\builder_v2\maps.py:136-141`).
  Calling it once is enough.
- **Do not** swallow errors silently. The catches in §2.2 / §4.2
  log to console — keep that. If you find an existing `catch {}`
  empty block in this fix's surface area, leave it; do not "improve"
  it.
- **Do not** touch the alembic migration list, models, or any
  Python file outside `app/routers/map/files.py` (which we are not
  modifying anyway in this fix).
- **Do not** change test counts in `BUILDER_V2_HANDOFF.md` to a
  number you have not actually seen pytest report. Run the tests,
  read the number, write that number.

---

## 10. When done

1. Update test counter in
   `@c:\Users\Litun\Desktop\DND Project\dnd-companion\docs\BUILDER_V2_HANDOFF.md`
   from `55` to whatever pytest actually reports (expected: 57).
2. Append a "Phase 7 — Bridge Fix Applied" section to
   `@c:\Users\Litun\Desktop\DND Project\dnd-companion\docs\temp_fix.md`,
   following the format of "Phase 7 — Fix List ✅ APPLIED on
   2026-04-26" already in that file. List exactly the four bugs
   from §2-§5 with their file:line citations and the fixes applied.
3. Tell the user: *"Bridge fix applied. 57/57 tests green. Manual
   verification in §8 needed."*

If at any point a test that was green before goes red, **stop**.
Revert your last change. Tell the user which step broke and what
the test output says. Do not "try the next thing" hoping it
self-corrects.

— End of fix doc.
