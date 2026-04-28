# Phase 11 — Bug Fixes (3 rounds)

**Audience:** Kimi K2.6.

**Goal:** Fix three concrete defects discovered during Phase 10 demo
playthrough. NO new features. NO visual changes. Pure bug fixes.

**Prerequisite reading:** `docs/AGENT_NOTES.md` and the rules section
of `docs/PHASE_10_PLAN.md` (R-T1..R-T10 still apply, especially
**R-T1: NEW tests, never modify old ones**).

---

## ROUND 1 — Edge transitions don't fire on player drag

**Symptom (image 2 from user):** Player token at edge cell `col=0,
row=7` of West location. Edges show as cyan `<` arrows. Drag the
token onto edge cell — token stays put, no teleport.

### Root cause (already diagnosed by Cascade)

`@c:\Users\Litun\Desktop\DND Project\dnd-companion\app\routers\map\tokens.py:100-113`
syncs `c.col / c.row / current_location_id` to the active bv2
location, but **never calls `_find_matching_edge`**. Edge transition
logic lives ONLY in
`@c:\Users\Litun\Desktop\DND Project\dnd-companion\app\routers\builder_v2\edges.py:163-192`
which is called by the bv2-native endpoint
`POST /characters/{id}/move-grid`. Player UI uses the legacy
`PATCH /api/map/token/{id}` (drag in pixel space), so edges are never
checked.

### Fix

In `app/routers/map/tokens.py`, after the existing bv2 sync block
(around line 111), add:

```python
# Phase 11: edge transition — if the dragged cell sits on a
# location boundary AND that boundary has an edge with a target,
# teleport to the target's entry cell.
if bv2_loc and c.col is not None and c.row is not None:
    from app.routers.builder_v2.edges import _find_matching_edge
    edge = await _find_matching_edge(db, bv2_loc.id, c.col, c.row)
    if edge and edge.target_location_id:
        target = await db.get(BV2Location, edge.target_location_id)
        if target:
            c.current_location_id = edge.target_location_id
            c.col = max(0, min(target.cols - 1, edge.target_entry_col))
            c.row = max(0, min(target.rows - 1, edge.target_entry_row))
            # also update legacy pixel position so the immediate
            # state response reflects the teleport
            c.map_x = (c.col + 0.5) / max(1, target.cols)
            c.map_y = (c.row + 0.5) / max(1, target.rows)
```

After commit, broadcast `bv2.character_edge_transitioned` (mirror
the payload shape from `edges.py:235-238`) so the client switches to
the new location's state.

**Important:** the legacy `map.token_moved` broadcast must NOT fire
when an edge transition happened — replace it conditionally:

```python
if edge_transitioned:
    await manager.broadcast_to_session(sess.code,
        "bv2.character_edge_transitioned", {
            "character_id": c.id,
            "from_location_id": old_loc_id,
            "to_location_id": c.current_location_id,
            "col": c.col, "row": c.row,
        })
else:
    await manager.broadcast_to_session(sess.code, "map.token_moved", {...})
```

`old_loc_id` must be captured BEFORE the edge transition writes.

### Client side

The `bv2.character_edge_transitioned` listener already exists in
`@c:\Users\Litun\Desktop\DND Project\dnd-companion\static\js\builder_v2\40-websocket.js`.
Verify it ALSO exists in `static/js/gm/08-websocket.js` and
`static/js/player/18-quests.js` (or wherever player WS listens).
If missing, add a listener that triggers a full state reload —
`loadMapState()` for GM, `loadPlayerMapState()` for player.

### Tests

Append to `tests/test_smoke.py` under
`# ── Phase 11 (bugfixes) ────────────────────────────`:

```python
@pytest.mark.asyncio
async def test_phase11_legacy_drag_triggers_edge_transition(client, session_code):
    """Dragging a token to an edge cell via PATCH /api/map/token/{id}
    must teleport to the target location, not just update the row/col."""
    # Setup: 2 locations linked by an east↔west edge
    map_id = (await client.post(
        f"/api/builder-v2/sessions/{session_code}/maps",
        json={"name": "M"})).json()["id"]
    loc_a = (await client.post(
        f"/api/builder-v2/maps/{map_id}/locations",
        json={"cols": 10, "rows": 10})).json()["id"]
    loc_b = (await client.post(
        f"/api/builder-v2/maps/{map_id}/locations",
        json={"cols": 10, "rows": 10})).json()["id"]
    await client.post(f"/api/builder-v2/locations/{loc_a}/edges",
        json={"side": "east", "range_start": 4, "range_end": 6,
              "target_location_id": loc_b,
              "target_entry_col": 0, "target_entry_row": 5})
    await client.post(f"/api/builder-v2/locations/{loc_a}/activate")

    # Join player, force them onto location A
    char_id = (await client.post("/api/sessions/join",
        json={"session_code": session_code,
              "player_name": "Walker"})).json()["character_id"]
    # Place at col=0, row=5 in loc_a
    await client.post(f"/api/builder-v2/characters/{char_id}/move-grid",
        json={"location_id": loc_a, "col": 0, "row": 5})

    # Now drag east via legacy endpoint to col=9 (the east edge)
    # Pixel coords: x=0.95 (≈col 9 of 10), y=0.55 (≈row 5).
    r = await client.patch(f"/api/map/token/{char_id}",
        json={"x": 0.95, "y": 0.55})
    assert r.status_code == 200, r.text

    # Read character — must be in loc_b at the entry cell.
    r = await client.get(f"/api/characters/{char_id}")
    assert r.status_code == 200
    body = r.json()
    assert body["current_location_id"] == loc_b
    assert body["col"] == 0
    assert body["row"] == 5
```

Run `pytest tests/ -q -k phase11` and confirm it passes.

### Manual verification

1. `python scripts\seed_phase10_demo.py` (assumes Phase 10 demo task
   already merged; if not, build a minimal 2-location map manually).
2. Player joins, walks east edge of Center → teleports to East. ✓
3. Walks back west → teleports back to Center. ✓
4. Walks to West location → portal step (col 5 row 5) → Crypt. ✓
5. From Crypt portal → back to West. ✓

### Definition of done — Round 1

- [ ] `app/routers/map/tokens.py` patched.
- [ ] WS listener confirmed on both GM and Player sides.
- [ ] New test passes.
- [ ] Pre-existing test count unchanged.
- [ ] Manual edge walk works in both directions.
- [ ] Commit: `Phase 11 R1: legacy drag fires edge transition`.

---

## ROUND 2 — Interior zone roof shows only partial cells

**Symptom (image 1 from user):** Inn building (6×5) — only ~5 cells
in one row are blackened by the roof overlay; the other ~7 interior
cells render as visible floor. Player can see "inside" the building
without entering.

### Investigation steps (do FIRST, before patching)

The bug could be in any of three layers. Run these checks in order
and STOP at the first one that confirms the cause. Do NOT patch
multiple layers blindly.

#### Step A — verify the zone payload reaching the client

In a fresh session with the demo seeded, open Player tab DevTools:
```js
playerMapCanvas.interiors
```
Expected: an array with each zone object having `cells` length
matching expected (Inn = 12 cells: cols 3..6 × rows 3..5).

- **If zone has < 12 cells** → bug is in seed or backend.
- **If zone has 12 cells** → bug is in renderer.

#### Step B — if backend bug, check seed `_building` helper

The seed in `scripts/seed_phase10_demo.py` `_building` function
produces interior cells via:

```python
for c in range(c0 + 1, c1):
    for r in range(r0 + 1, r1):
        interior.append({"col": c, "row": r})
```

For Inn `(c0=2, r0=2, c1=7, r1=6)`: interior = cols 3..6 × rows 3..5
= 12 cells. Verify by adding `print(f"Inn interior: {len(interior)}")`
before the API call. If <12, fix the bounds.

Also verify the `POST /interiors` body actually carries 12 cells —
add `print` inside the helper. If 12 sent but fewer stored, check
`@c:\Users\Litun\Desktop\DND Project\dnd-companion\app\routers\builder_v2\interiors.py:57-93`
(create_interior) for any silent filtering.

#### Step C — if renderer bug, check three-layer fog interaction

Most likely candidate: the zone overlay draws AFTER `_renderFog` (the
three-layer fog from Phase 10 R5), and fog already blackened cells
the player has not "currentVisible'd". The result LOOKS like a
partial roof but is actually `(zone roof) ∪ (fog black)`. Look at
`@c:\Users\Litun\Desktop\DND Project\dnd-companion\static\js\map-canvas.js`
`render()` order. Confirm `_renderFog` and `_renderInteriorOverlay`
both fire and their alphas compose to the visible artefact.

If this is the cause, the fix is **rendering order**: zone overlay
must draw BEFORE fog so fog covers the zone too. Or: zone overlay
draws BEFORE `_renderTokens` and AFTER `_renderTiles`, but
`_renderFog` always wins last for unrevealed cells. Document the
final order chosen.

#### Step D — if neither A nor B nor C, suspect a partial cellSet
construction in `_renderInteriorOverlay`:

```js
const cellSet = new Set(cells.map(c => `${c.col},${c.row}`));
```

Ensure `zone.cells` is the full array. Log `cellSet.size` next to
the first render.

### Fix (depends on Step that confirmed)

- **If Step B (backend/seed):** correct seed bounds; re-run seed;
  verify zone has 12 cells.
- **If Step C (rendering order):** swap render order so the roof
  hides ALL interior, not just unrevealed cells. The intended UX is:
  player outside → roof covers entire building; player inside →
  roof drops over cells they're inside. Three-layer fog should NOT
  let the player peek into roofed cells they happen to have
  "currentVisible".
- **If Step D (renderer bug):** fix cellSet construction.

### Tests

Whatever the fix layer, write a NEW test:

```python
@pytest.mark.asyncio
async def test_phase11_interior_zone_full_cells_persist(client, session_code):
    """A zone created with N cells must round-trip with N cells."""
    map_id = (await client.post(
        f"/api/builder-v2/sessions/{session_code}/maps",
        json={"name": "M"})).json()["id"]
    loc_id = (await client.post(
        f"/api/builder-v2/maps/{map_id}/locations",
        json={"cols": 10, "rows": 10})).json()["id"]
    # 12 interior cells (4×3) for a 6×5 building
    cells = [{"col": c, "row": r}
             for c in range(3, 7) for r in range(3, 6)]
    assert len(cells) == 12
    z = (await client.post(
        f"/api/builder-v2/locations/{loc_id}/interiors",
        json={"name": "Inn", "kind": "building",
              "reveal_mode": "on_enter",
              "cells": cells})).json()
    assert len(z["cells"]) == 12
    # And via list endpoint
    listed = (await client.get(
        f"/api/builder-v2/locations/{loc_id}/interiors")).json()
    assert len(listed[0]["cells"]) == 12
    # And via legacy bridge
    await client.post(f"/api/builder-v2/locations/{loc_id}/activate")
    state = (await client.get(f"/api/map/{session_code}")).json()
    bv2_int = state.get("bv2_interiors") or []
    assert len(bv2_int) == 1
    assert len(bv2_int[0]["cells"]) == 12
```

If the bug was in render order (Step C), additionally add a
**JS-level docstring** in `_renderInteriorOverlay` documenting the
chosen order so future Cascade/Kimi don't reintroduce the regression.

### Definition of done — Round 2

- [ ] Investigation step that pinpointed the cause is documented in
      the commit message.
- [ ] Fix applied to that layer ONLY.
- [ ] Player visually sees full roof from outside; full roof drops
      when stepping inside; returns when stepping outside.
- [ ] New test passes.
- [ ] Commit: `Phase 11 R2: interior zone roof full coverage (root cause: <step>)`.

---

## ROUND 3 — Location switcher in GM Map tab

**Symptom (image 3 from user):** GM is on Map tab. To switch active
location, the GM has to navigate to Builder tab, find the location
list, click activate, return to Map tab. Should be one click on Map.

### Spec

Add a location dropdown in the Map tab toolbar.

#### 3.1 — HTML

In `static/gm.html`, find the Map tab toolbar (around line 75-80
where `Load from Library`, `Remove`, etc. live). Add:

```html
<select id="map-location-switcher"
        title="Switch active location"
        style="padding:4px 8px;border-radius:4px;background:#1a1814;
               color:#fff;border:1px solid #3a3530;font-size:0.75rem">
  <option value="">— No active location —</option>
</select>
```

Place it AFTER `Remove` button and BEFORE the divider/grid toggle.

#### 3.2 — Populate

In `static/js/gm/06-map-main.js`, after the existing
`loadMapState()` runs and you have a state object, populate the
dropdown:

```js
async function refreshLocationSwitcher() {
  const sel = document.getElementById('map-location-switcher');
  if (!sel) return;
  // Find the active map (if any)
  const maps = await fetch(
    `/api/builder-v2/sessions/${SESSION_CODE}/maps`
  ).then(r => r.json());
  const activeMap = maps.find(m => m.is_active);
  if (!activeMap) {
    sel.innerHTML = '<option value="">— No active map —</option>';
    return;
  }
  const locs = await fetch(
    `/api/builder-v2/maps/${activeMap.id}/locations`
  ).then(r => r.json());
  sel.innerHTML = '';
  for (const loc of locs) {
    const opt = document.createElement('option');
    opt.value = loc.id;
    opt.textContent = `${loc.name || `Location ${loc.id}`}` +
                      (loc.is_active ? ' (active)' : '');
    if (loc.is_active) opt.selected = true;
    sel.appendChild(opt);
  }
}
```

Call `refreshLocationSwitcher()` at the end of `loadMapState()`.

#### 3.3 — On change → activate

```js
document.getElementById('map-location-switcher').addEventListener(
  'change', async (e) => {
    const locId = e.target.value;
    if (!locId) return;
    await fetch(`/api/builder-v2/locations/${locId}/activate`,
                {method: 'POST'});
    // Server broadcasts bv2.location_activated; the WS listener will
    // call loadMapState() which refreshes the canvas + dropdown.
  });
```

#### 3.4 — WS sync

If the GM activates a location from Builder, the Map tab dropdown
must update too. The existing `bv2.location_activated` WS listener
in `static/js/gm/08-websocket.js` already triggers map reload — just
ensure `refreshLocationSwitcher()` is called from `loadMapState()`
(step 3.2) and the round-trip works.

#### 3.5 — Tests

```python
@pytest.mark.asyncio
async def test_phase11_location_activate_emits_ws(client, session_code):
    """Activating a location must succeed and update the map's active
    location flag — the dropdown is purely client-side, but the
    backend contract must be solid."""
    map_id = (await client.post(
        f"/api/builder-v2/sessions/{session_code}/maps",
        json={"name": "M"})).json()["id"]
    loc_a = (await client.post(
        f"/api/builder-v2/maps/{map_id}/locations",
        json={"cols": 5, "rows": 5})).json()["id"]
    loc_b = (await client.post(
        f"/api/builder-v2/maps/{map_id}/locations",
        json={"cols": 5, "rows": 5})).json()["id"]

    # Activate A then B
    await client.post(f"/api/builder-v2/locations/{loc_a}/activate")
    locs = (await client.get(
        f"/api/builder-v2/maps/{map_id}/locations")).json()
    assert next(l for l in locs if l["id"] == loc_a)["is_active"]
    assert not next(l for l in locs if l["id"] == loc_b)["is_active"]

    await client.post(f"/api/builder-v2/locations/{loc_b}/activate")
    locs = (await client.get(
        f"/api/builder-v2/maps/{map_id}/locations")).json()
    assert not next(l for l in locs if l["id"] == loc_a)["is_active"]
    assert next(l for l in locs if l["id"] == loc_b)["is_active"]
```

### Manual verification

1. Open GM Map tab.
2. Dropdown shows all locations of the active map.
3. Currently-active location is selected.
4. Pick a different one → canvas reloads with the new location.
5. Player tab follows (the player's character may or may not be in
   that location — bridge filters tokens accordingly).

### Definition of done — Round 3

- [ ] Dropdown visible in Map tab toolbar.
- [ ] Switches active location on change.
- [ ] Updates from Builder tab activate via WS.
- [ ] New test passes.
- [ ] Commit: `Phase 11 R3: GM Map-tab location switcher`.

---

## END-OF-PHASE CHECKLIST

- [ ] All 3 rounds committed in order.
- [ ] `pytest tests/ -q` — pre-existing pass count UNCHANGED.
- [ ] 3+ NEW tests under Phase 11 section.
- [ ] Manual verification done on GM and Player tabs.
- [ ] `docs/PHASE_11_PROGRESS.md` created with:
  ```
  - [x] R1 Edge transitions on legacy drag — commit XXX — date
  - [x] R2 Interior zone full coverage — commit XXX — date
  - [x] R3 GM Map-tab location switcher — commit XXX — date
  ```
- [ ] Push to GitHub.

End of Phase 11. Then move on to Phase 12 (Visual overhaul) per
`docs/PHASE_12_VISUAL.md`.
