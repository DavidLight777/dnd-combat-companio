# Phase 11.5 — Hotfix Round (3 surgical fixes)

**Audience:** Kimi K2.6.

**Context:** Phase 11 closed backend correctness (3 tests pass) but
the user-facing flow still has 3 broken behaviours:

1. Player edge-transitions on the server but their canvas keeps
   showing the old location.
2. Building roof still shows partial (per user; needs verification
   after hard-reload).
3. GM location switcher feels like it requires page reload (similar
   diagnosis: hard-reload OR a missing client refresh hook).

**All three rules from `docs/AGENT_NOTES.md` and Phase 10 R-T1..R-T10
still apply.** Especially R-T1 (NEW tests), R-T3 (hard-reload).

---

## FIX A — Player view follows character.current_location_id

### Real root cause (diagnosed by Cascade)

`@c:\Users\Litun\Desktop\DND Project\dnd-companion\app\routers\map\files.py:432-455`
ALWAYS picks the **session-level active location**
(`BV2Location.is_active == True`) regardless of which character is
asking. After a player walks through an edge, their
`character.current_location_id` becomes the target location, but the
**session active location is unchanged**, so
`/api/map/{code}?character_id=X` returns the OLD location's bridge
state. The player's canvas reloads but to the same map.

This is also why image 1 ("Greenhollow West (active)" dropdown) shows
West as active to GM, while a player in Crypt would still receive
West data.

### Fix

In `app/routers/map/files.py` `get_map_state`, when `character_id` is
provided AND the character has a `current_location_id` pointing to a
valid location in this session's active map, use **that location**
instead of the session-level active.

```python
# After resolving bv2_map, BEFORE selecting the active location:
bv2_loc = None
if character_id:
    char = await db.get(Character, int(character_id))
    if char and char.current_location_id:
        cand = await db.get(BV2Location, char.current_location_id)
        # Defensive: must belong to this session's active map
        if cand and cand.map_id == bv2_map.id:
            bv2_loc = cand

if bv2_loc is None:
    # Existing path: session-level active location
    loc_q = await db.execute(
        select(BV2Location)
        .where(BV2Location.map_id == bv2_map.id)
        .where(BV2Location.is_active == True)
        .limit(1)
    )
    bv2_loc = loc_q.scalar_one_or_none()
    # ... existing fallback chain
```

**Critical:** GM never passes `character_id`, so GM continues to see
the session-active location (which is what the switcher controls).
Players follow their character.

### Tests

Add to `tests/test_smoke.py` Phase 11 section:

```python
@pytest.mark.asyncio
async def test_phase11_5_player_view_follows_character_location(
        client, session_code):
    """Player's GET /api/map/{code}?character_id=X returns the
    character's current_location_id, not the session-active one."""
    map_id = (await client.post(
        f"/api/builder-v2/sessions/{session_code}/maps",
        json={"name": "M"})).json()["id"]
    loc_a = (await client.post(
        f"/api/builder-v2/maps/{map_id}/locations",
        json={"cols": 8, "rows": 8})).json()["id"]
    loc_b = (await client.post(
        f"/api/builder-v2/maps/{map_id}/locations",
        json={"cols": 8, "rows": 8})).json()["id"]
    # Activate A at the SESSION level
    await client.post(f"/api/builder-v2/locations/{loc_a}/activate")
    # Place a character in B (NOT session-active)
    char_id = (await client.post("/api/sessions/join",
        json={"session_code": session_code,
              "player_name": "Walker"})).json()["character_id"]
    await client.post(
        f"/api/builder-v2/characters/{char_id}/move-grid",
        json={"location_id": loc_b, "col": 3, "row": 3})

    # GM (no character_id) sees A
    gm = (await client.get(f"/api/map/{session_code}")).json()
    assert gm["bv2_active_location_id"] == loc_a

    # Player (with character_id) sees B
    pl = (await client.get(
        f"/api/map/{session_code}?character_id={char_id}")).json()
    assert pl["bv2_active_location_id"] == loc_b
```

### Manual verification

1. Run `python scripts\seed_phase10_demo.py`.
2. Player joins, walks to East edge of Center → transitions to East.
3. **Player canvas immediately shows East** (the smithy interior
   layout, not the inn).
4. **GM canvas continues to show whatever GM has selected** in
   the location switcher.
5. The two views are now independent. Move the GM dropdown to West:
   GM sees West. Player still in East sees East. ✓

### Definition of done — Fix A
- [ ] `files.py:get_map_state` honours `character_id` for location.
- [ ] New test passes.
- [ ] Manual verification confirms player+GM diverge correctly.
- [ ] Commit: `Phase 11.5 A: player view follows character location`.

---

## FIX B — Roof partial: re-investigate after hard-reload

### Verify R-T3 first

Phase 11 R2 swapped render order in `_renderInteriorOverlay`. If the
user did NOT hard-reload (Ctrl+Shift+R), the browser served the OLD
JS and the swap had no effect. **Step 1 of this fix is mandatory:**

1. Tell the user to Ctrl+Shift+R both tabs (GM + Player).
2. Re-test the Inn building from the demo.
3. If roof now fully covers — Fix B is closed; document in commit
   message that R-T3 was the cause and add a CACHE BUST step
   (rename `static/js/map-canvas.js?v=N+1` in `gm.html` and
   `player.html` to force reload for ALL future users).

### If still broken after hard-reload

Run the diagnostic in DevTools console (player tab):

```js
// 1. Confirm zone has 12 cells
playerMapCanvas.interiors.forEach(z =>
  console.log(z.name, z.cells.length, z.cells));

// 2. Confirm tile data shape near the zone
Object.keys(playerMapCanvas.tiles)
  .filter(k => {
    const [c, r] = k.split(',').map(Number);
    return c >= 2 && c <= 7 && r >= 2 && r <= 6;
  })
  .forEach(k => console.log(k, playerMapCanvas.tiles[k]));

// 3. Confirm currentVisible doesn't reach into the building
console.log('currentVisible has any interior?',
  Array.from(playerMapCanvas.currentVisible || []).filter(k => {
    const [c, r] = k.split(',').map(Number);
    return c >= 3 && c <= 6 && r >= 3 && r <= 5;
  }));
```

Expected:
- (1) → "The Greenhollow Inn 12 [...]" with 12 cells.
- (2) → 30 entries (6×5 building + perimeter).
- (3) → `[]` (player vision shouldn't reach into a closed building).

Branch by output:

- **(1) returns < 12 cells** → bug in seed or backend serialization.
  Read the actual API response:
  `await fetch('/api/map/'+CODE+'?character_id='+CHAR_ID).then(r=>r.json()).then(s=>console.log(s.bv2_interiors))`.
  If interior cells are truncated server-side, fix
  `app/routers/builder_v2/locations.py` location-detail endpoint
  (or the bridge in `files.py`).

- **(3) returns >0** → vision is leaking into the building. Check
  walls' `blocks_vision` flag in the tile bridge:
  `state.bv2_tiles[key].blocks_vision`. If walls have
  `blocks_vision=false`, it's a tile-type config bug (default for
  `wall` type must be `true`).

- **All correct but still see floor** → render order didn't actually
  swap. Re-read `render()` and confirm `_renderInteriorOverlay`
  comes BEFORE `_renderFog`. If swap is correct, check that the zone
  overlay's alpha is 0.95 (not 0.45 — which is the GM preview).

### Tests

After diagnosis, the corresponding test goes in `test_smoke.py`:

- If seed/backend bug: a test that round-trips a 12-cell zone via
  the bridge and asserts 12 cells out (already exists from Phase 11
  R2; verify it actually checks the bridge, not just the
  interiors endpoint).
- If wall blocks_vision bug: assert the bridge sets
  `blocks_vision=true` for `wall` type.

```python
@pytest.mark.asyncio
async def test_phase11_5_walls_block_vision_in_bridge(client, session_code):
    """Wall tiles must round-trip with blocks_vision=true so the JS
    shadowcaster can use them."""
    map_id = (await client.post(
        f"/api/builder-v2/sessions/{session_code}/maps",
        json={"name": "M"})).json()["id"]
    loc_id = (await client.post(
        f"/api/builder-v2/maps/{map_id}/locations",
        json={"cols": 5, "rows": 5})).json()["id"]
    await client.patch(f"/api/builder-v2/locations/{loc_id}/tiles",
        json={"set": [{"col": 2, "row": 2, "tile_type": "wall"}],
              "erase": []})
    await client.post(f"/api/builder-v2/locations/{loc_id}/activate")
    state = (await client.get(f"/api/map/{session_code}")).json()
    tile = state["bv2_tiles"]["2,2"]
    assert tile["type"] == "wall"
    assert tile["blocks_vision"] is True
    assert tile["blocks_movement"] is True
```

### Definition of done — Fix B
- [ ] Hard-reload test done; cache-bust version bump applied.
- [ ] If still broken: diagnostic run, root cause documented in
      commit, fix applied to ONE layer.
- [ ] Manual verification: outside Inn → full roof; inside Inn →
      no roof.
- [ ] Commit: `Phase 11.5 B: roof full coverage (root cause: <X>)`.

---

## FIX C — Switcher must work without page reload

### Verify R-T3 first

Same drill — hard-reload before declaring this broken. Phase 11 R3
already wired `bv2.location_activated → loadMapState() →
refreshLocationSwitcher()`. If user observes "needs page reload",
the most likely cause is cache.

After hard-reload, the GM dropdown should:
1. Show all 6 locations of the demo map.
2. Highlight the active one with `(active)`.
3. On change, fire activate API, the WS broadcast triggers
   `loadMapState()`, which re-fetches AND re-runs
   `refreshLocationSwitcher()`.

### If still broken after hard-reload

Check in DevTools:

```js
// 1. Listener registered?
ws._handlers && ws._handlers['bv2.location_activated']

// 2. loadMapState calls refreshLocationSwitcher?
loadMapState.toString().includes('refreshLocationSwitcher')
```

Branch:

- **(1) empty array** → listener wasn't registered. Verify the file
  loaded the listener block; check load order in `gm.html`.
- **(2) false** → `loadMapState` was modified but NOT to call the
  switcher refresh. Add the call.

### Player canvas live-refresh on GM switch

**Important UX consideration:** when GM switches their selector to
location X, do players follow?

**Answer (per Fix A architecture):** NO. Players follow THEIR
character's `current_location_id`. The GM switcher is purely the
GM's view. If the GM wants to teleport a player to a different
location, that's a separate action (existing
`POST /api/builder-v2/characters/{id}/move-grid` with `location_id`).

Document this in the commit message for Fix C so future Cascade
doesn't "fix" it.

### Tests

Phase 11 R3's existing test
(`test_phase11_location_activate_emits_ws`) covers the activate API.
No new test needed unless a regression is found in Step 2 above.

### Definition of done — Fix C
- [ ] Hard-reload validated; if still broken, root cause documented.
- [ ] If listener was missing or unwired, fixed.
- [ ] Manual: GM dropdown change → canvas reloads in <500ms with no
      page refresh.
- [ ] Player view does NOT follow GM switcher (intended).
- [ ] Commit: `Phase 11.5 C: location switcher live (cache-bust)`.

---

## FIX D — Move-token sync must use character's location, not session-active

### Real symptom (reported by user)

After a player edge-transitions to West and the canvas correctly
loads West (Fix A working), the very next step **teleports them
back to Center**. Reproducible: walk east edge → see West for one
frame → take any step → snap back to Center.

### Root cause (diagnosed by Cascade)

`@c:\Users\Litun\Desktop\DND Project\dnd-companion\app\routers\map\tokens.py:95-113`:

```python
bv2_loc = (await db.execute(
    select(BV2Location)
    .where(BV2Location.map_id == bv2_map.id)
    .where(BV2Location.is_active == True)        # ← session-active!
)).scalar_one_or_none()
if bv2_loc and new_x is not None and new_y is not None:
    c.col = ...int(new_x * bv2_loc.cols)         # ← scaled to Center's grid
    c.row = ...int(new_y * bv2_loc.rows)
    c.current_location_id = bv2_loc.id           # ← OVERWRITES West with Center
```

The bv2 sync ALWAYS resolves `bv2_loc` to the session-active
location (Center). Then it (1) scales pixel coords to Center's grid
dimensions and (2) overwrites the character's `current_location_id`
back to Center on every move. Phase 11 R1's edge check then runs
against Center coords (which don't match West's edges), so the
character stays in Center.

This is the dual to Fix A. Fix A made the **read** path honour
character's location; Fix D makes the **write** path do the same.

### Fix

In `tokens.py`, prefer the character's own location:

```python
# Phase 11.5 D: sync against the character's current location, not
# session-active. Fall back to session-active only when the character
# has no location yet (first placement).
bv2_loc = None
if c.current_location_id:
    bv2_loc = await db.get(BV2Location, c.current_location_id)
    # Defensive: must belong to this session's active map
    if bv2_loc and bv2_loc.map_id != bv2_map.id:
        bv2_loc = None
if bv2_loc is None:
    bv2_loc = (await db.execute(
        select(BV2Location)
        .where(BV2Location.map_id == bv2_map.id)
        .where(BV2Location.is_active == True)
    )).scalar_one_or_none()

if bv2_loc and new_x is not None and new_y is not None:
    cols = max(1, bv2_loc.cols)
    rows = max(1, bv2_loc.rows)
    c.col = max(0, min(cols - 1, int(new_x * cols)))
    c.row = max(0, min(rows - 1, int(new_y * rows)))
    c.current_location_id = bv2_loc.id   # idempotent now
```

Then the existing Phase 11 R1 edge-transition block runs against
**West's** geometry (since `bv2_loc` is now West), so an edge in West
can fire correctly when the player walks BACK to Center via West's
east border.

### Test

```python
@pytest.mark.asyncio
async def test_phase11_5_step_inside_target_location_does_not_warp_back(
        client, session_code):
    """After an edge transition, taking a step inside the new location
    must NOT reset the character's current_location_id to session-active."""
    map_id = (await client.post(
        f"/api/builder-v2/sessions/{session_code}/maps",
        json={"name": "M"})).json()["id"]
    loc_a = (await client.post(
        f"/api/builder-v2/maps/{map_id}/locations",
        json={"cols": 10, "rows": 10})).json()["id"]
    loc_b = (await client.post(
        f"/api/builder-v2/maps/{map_id}/locations",
        json={"cols": 8, "rows": 8})).json()["id"]
    # A is session-active; B is where the character will live
    await client.post(f"/api/builder-v2/locations/{loc_a}/activate")

    char_id = (await client.post("/api/sessions/join",
        json={"session_code": session_code,
              "player_name": "Walker"})).json()["character_id"]
    # Place character in B (NOT session-active)
    await client.post(
        f"/api/builder-v2/characters/{char_id}/move-grid",
        json={"location_id": loc_b, "col": 4, "row": 4})

    # Take a step via legacy drag (mid-cell of B)
    # Pixel coords for col=5, row=5 in 8x8: (5.5/8, 5.5/8) ≈ (0.6875, 0.6875)
    await client.patch(f"/api/map/token/{char_id}",
                       json={"x": 0.6875, "y": 0.6875})

    # Character must STILL be in B, at col=5 row=5 of B's grid
    body = (await client.get(f"/api/characters/{char_id}")).json()
    assert body["current_location_id"] == loc_b, \
        f"step warped character to {body['current_location_id']} (expected {loc_b})"
    assert body["col"] == 5
    assert body["row"] == 5
```

### Manual verification

1. Player edge-transitions Center → West (already works after Fix A).
2. Player takes a step inside West.
3. **Player stays in West**, token moves one cell. ✓
4. Player walks west-to-east across West, hits east edge → returns to
   Center. ✓
5. Round-trip Center↔West freely without snap-back.

### Definition of done — Fix D
- [ ] `tokens.py` resolves `bv2_loc` from character first.
- [ ] New test passes (`pytest -k step_inside_target`).
- [ ] Manual: walk inside West for 5+ steps, never snap back to Center.
- [ ] Commit: `Phase 11.5 D: move-token sync uses character location`.

---

## FIX E — Wall collision must use character's location, not session-active

### Real symptom (reported by user, image with "Path is blocked by a wall")

After Fix D lands, the player can take a step in West and stays in
West. BUT sometimes the step is rejected with `403 "Path is blocked
by a wall"` even when the target cell is clearly open floor. The
rejection is **positional** — some cells work, some don't.

### Root cause (diagnosed by Cascade)

`@c:\Users\Litun\Desktop\DND Project\dnd-companion\app\routers\map\common.py:165-197`
in `_path_is_blocked`:

```python
bv2_loc = (await db.execute(
    select(BV2Location)
    .where(BV2Location.map_id == bv2_map_row.id)
    .where(BV2Location.is_active == True)    # ← session-active!
)).scalar_one_or_none()
if bv2_loc:
    tile_rows = (await db.execute(
        select(BV2Tile)
        .where(BV2Tile.location_id == bv2_loc.id)
        .where(BV2Tile.blocks_movement == True)
    )).scalars().all()
    # ... builds bv2_blocked_cells from SESSION-ACTIVE location's walls
cols = max(1, bv2_loc.cols) if bv2_loc else 1  # ← CENTER's dimensions
rows_count = max(1, bv2_loc.rows) if bv2_loc else 1
```

The wall-check pulls tiles from the session-active location (Center,
20×20) and scales the incoming `new_x/new_y` to Center's grid. When
the player is in West (15×15) and tries to step, the coords get
re-interpreted in Center's coordinate system. If Center happens to
have a wall at that re-scaled cell (which it does — the Inn occupies
cols 2-7 rows 2-6), the step is rejected as "wall".

This is the **third sibling** of Fix A and Fix D. All three stem
from the same architectural assumption that "session-active
location = where everyone is". That assumption was true in Phase
5-10 but broke once players can be in different locations.

### Fix

Add an optional `location_id` parameter to `_path_is_blocked` and
thread the character's `current_location_id` through from every
caller.

**Step 1** — `app/routers/map/common.py`:

```python
async def _path_is_blocked(
    session_id: int, x0: float, y0: float, x1: float, y1: float,
    db: AsyncSession,
    location_id: int | None = None,    # ← NEW
) -> bool:
    ...
    bv2_loc = None
    if location_id is not None:
        bv2_loc = await db.get(BV2Location, location_id)
        # Defensive: must belong to this session's active map
        if bv2_loc:
            bv2_map_row = await db.get(BV2Map, bv2_loc.map_id)
            if not bv2_map_row or bv2_map_row.session_id != session_id:
                bv2_loc = None

    if bv2_loc is None:
        # Fallback: session-active location (pre-11.5 behaviour for
        # callers that don't know the character).
        bv2_map_row = (await db.execute(
            select(BV2Map)
            .where(BV2Map.session_id == session_id)
            .where(BV2Map.is_active == True)
        )).scalar_one_or_none()
        if bv2_map_row:
            bv2_loc = (await db.execute(
                select(BV2Location)
                .where(BV2Location.map_id == bv2_map_row.id)
                .where(BV2Location.is_active == True)
            )).scalar_one_or_none()

    # ...rest unchanged
```

**Step 2** — `app/routers/map/tokens.py` line ~53 (pre-move wall check):

```python
if await _path_is_blocked(
        c.session_id, c.map_x or 0.0, c.map_y or 0.0,
        new_x or 0.0, new_y or 0.0, db,
        location_id=c.current_location_id):   # ← NEW
    raise HTTPException(403, "Path is blocked by a wall")
```

**Step 3** — grep for ALL other callers of `_path_is_blocked` and
pass the character's location where one exists. Likely candidates:
- `app/routers/combat/*.py` (attack range / movement during combat).
- `app/routers/builder_v2/*.py` (probably none but verify).

For any caller that doesn't have a character handy (e.g. a GM-issued
teleport), omit the parameter — falls back to session-active which
is the intended behaviour for GM ops.

### Test

```python
@pytest.mark.asyncio
async def test_phase11_5_wall_check_uses_character_location(client, session_code):
    """A character in Location B must not be blocked by walls that exist
    in the session-active Location A (where they are NOT standing)."""
    map_id = (await client.post(
        f"/api/builder-v2/sessions/{session_code}/maps",
        json={"name": "M"})).json()["id"]
    # Location A (session-active) — 10x10 with a wall at (5, 5)
    loc_a = (await client.post(
        f"/api/builder-v2/maps/{map_id}/locations",
        json={"cols": 10, "rows": 10})).json()["id"]
    await client.patch(f"/api/builder-v2/locations/{loc_a}/tiles",
        json={"set": [{"col": 5, "row": 5, "tile_type": "wall"}],
              "erase": []})
    await client.post(f"/api/builder-v2/locations/{loc_a}/activate")
    # Location B — 10x10, no walls, character lives here
    loc_b = (await client.post(
        f"/api/builder-v2/maps/{map_id}/locations",
        json={"cols": 10, "rows": 10})).json()["id"]

    char_id = (await client.post("/api/sessions/join",
        json={"session_code": session_code,
              "player_name": "Walker"})).json()["character_id"]
    # Place in B at col=4 row=5
    await client.post(
        f"/api/builder-v2/characters/{char_id}/move-grid",
        json={"location_id": loc_b, "col": 4, "row": 5})

    # Drag to col=5 row=5 in B (same coords as the wall in A)
    # Pixel: 5.5/10 = 0.55
    r = await client.patch(f"/api/map/token/{char_id}",
                           json={"x": 0.55, "y": 0.55})
    # Must succeed, NOT 403
    assert r.status_code == 200, \
        f"step rejected: {r.status_code} {r.text}"
    body = (await client.get(f"/api/characters/{char_id}")).json()
    assert body["col"] == 5 and body["row"] == 5
    assert body["current_location_id"] == loc_b
```

### Manual verification

1. Player in West (15×15) walks freely in any direction.
2. Walks into West's Chapel wall — correctly blocked. ✓
3. Walks through Chapel's open door — passes through. ✓
4. Walks to a cell in West where Center would have a wall (e.g. the
   Inn at cols 2-7 rows 2-6 of Center) — **not blocked**, since
   West has no wall there. ✓

### Definition of done — Fix E
- [ ] `_path_is_blocked` accepts `location_id` kwarg.
- [ ] `tokens.py` passes `c.current_location_id`.
- [ ] All other callers audited; any with a character pass it too.
- [ ] New test passes (`pytest -k wall_check_uses_character`).
- [ ] Manual: "Path is blocked by a wall" only triggers when there's
      an actual wall in the player's CURRENT location.
- [ ] Commit: `Phase 11.5 E: wall check uses character location`.

---

## ARCHITECTURAL NOTE (add to `docs/AGENT_NOTES.md`)

After this phase, append RULE-11:

```
## RULE-11: GM and Player views are independent.

`get_map_state` returns DIFFERENT locations for GM (no character_id,
session-active) vs Player (character_id passed, character's
current_location_id). Edge transitions move the character but NOT the
session-active. The GM's location switcher controls ONLY the GM's view.

To force a player to a location, use
`POST /api/builder-v2/characters/{id}/move-grid` with `location_id`.
```

---

## CACHE BUST CHECKLIST

For both GM and Player HTML, bump the version query string on every
JS file Phase 11.5 touches:

```html
<!-- BEFORE -->
<script src="/static/js/map-canvas.js?v=15"></script>
<!-- AFTER -->
<script src="/static/js/map-canvas.js?v=16"></script>
```

This forces every connected client to drop the cached old JS.
Apply to: `map-canvas.js`, `gm/06-map-main.js`, `gm/08-websocket.js`,
`player/10-map.js`, `player/13-websocket.js`.

Add a note to `docs/AGENT_NOTES.md` if not already there:

```
## RULE-12: Cache-bust JS files on every behavioural change.

Bump the `?v=N` query string in BOTH gm.html and player.html script
tags. This is the ONLY reliable way to force connected clients to
reload modified JS without asking the user to Ctrl+Shift+R.
```

---

## END-OF-PHASE CHECKLIST

- [ ] All 3 fixes committed in order.
- [ ] `pytest tests/ -q` — pre-existing 81 pass, +2 new tests
      (Fix A and Fix B if applicable).
- [ ] Manual verification on GM and Player.
- [ ] `docs/AGENT_NOTES.md` updated with RULE-11 and RULE-12.
- [ ] Cache-bust applied to relevant `?v=N` script tags.
- [ ] `docs/PHASE_11_PROGRESS.md` updated with three new lines.
- [ ] Push to GitHub.

After this lands, proceed to `docs/PHASE_12_VISUAL.md`.
