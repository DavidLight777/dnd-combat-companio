# Map Builder v2 — Per-Phase Fix Log

> **Purpose.** This file is a rolling list of fixes that must be
> applied **before the next phase starts**. Each phase review may
> append a new section here. Older sections stay as a history log
> with their `✅ APPLIED on YYYY-MM-DD` marker — do not delete them,
> the lessons are part of the project record.
>
> **Workflow:**
> 1. Read the most recent unapplied section.
> 2. Apply every fix in order — each fix lists exact files, lines,
>    and copy-paste code.
> 3. Run `.\dev.ps1 check` after each fix; commit only when green.
> 4. Tick the verification checklist at the bottom of the section.
> 5. Append `✅ APPLIED on <date>` to the section heading.
> 6. Then — and only then — start the next phase.
>
> **Do not skip fixes. Do not move on without ticking the checklist.**
> Every item is a real bug or a regression guard. The "Lessons" block
> in each section explains *why* the bug happened so you stop
> reproducing the same mistake.
>
> **Anti-pattern alert:** read the **standing rules** at the very
> bottom of this file *before* starting any phase. Three phases in a
> row (3, 4, 5) hit the **same** read-path bug — the rules below name
> each anti-pattern explicitly so you can break the streak.

---

## Phase 4 — Lighting — Fix List ✅ APPLIED on 2026-04-26

Archived. All five fixes (`||`→`??`, FOV-routed lighting, carried-light
caveat, two new smoke tests, handoff caveats block) were applied as
specified. Bonus: the same `||` server-side bug in
`ser_location.ambient_light` was caught and fixed in the same pass.
See `docs/BUILDER_V2_HANDOFF.md` §13 "Phase 4 caveats" for the
permanent record.

---

## Phase 5 — Edge Transitions — Fix List ✅ APPLIED on 2026-04-26

Four bugs were caught in live verification of the Phase 5 review.
Two are HIGH-priority (data corruption / breaks core UX), one is
the **third repeat** of the same anti-pattern from Phases 3 and 4
(see standing rules), one is a low-severity validation hole.

### Fix 5.1 — First-placement on an edge cell instantly teleports (HIGH)

**File:** `app/routers/builder_v2/edges.py`
**Function:** `move_character_grid`
**Lines:** ~204-218 (the body that handles `location_id`).

**Live evidence:**
```
POST /move-grid {"location_id": A, "col": 9, "row": 5}
→ response: {"location_id": B, "col": 3, "row": 3}
```
GM tries to **place** an NPC at the doorway of room A; instead the
NPC instantly walks through into room B. Breaks first-placement,
breaks `setLocation` UX, breaks any tool that wants to spawn at the
threshold.

**Root cause.** `old_loc_id` is captured **after** the new location
was assigned, so the edge check runs on the freshly-set destination.

**Fix.** Treat presence of `"location_id"` in the body as an
*explicit placement* and skip the edge-transition pass for that
single call:

```python
is_placement = "location_id" in body
if is_placement:
    character.current_location_id = int(body["location_id"])

old_loc_id = character.current_location_id
character.col = new_col
character.row = new_row

# Only check edges on real movement, not on placement.
if old_loc_id and not is_placement:
    edge = await _find_matching_edge(db, old_loc_id, new_col, new_row)
    if edge and edge.target_location_id:
        # Verify the target still exists (see Fix 5.2 — never trust
        # a dangling FK on SQLite).
        target = await db.get(BV2Location, edge.target_location_id)
        if target:
            character.current_location_id = edge.target_location_id
            character.col = edge.target_entry_col
            character.row = edge.target_entry_row
```

**Regression test.** Append to `tests/test_smoke.py` after
`test_bv2_edge_transition_on_move`:

```python
@pytest.mark.asyncio
async def test_bv2_first_placement_does_not_trigger_edge(client, session_code):
    """Setting location_id + col/row in one move-grid call must
    *place* the character, never transition through an edge that
    happens to cover the placement cell. Regression for the
    `old_loc_id` capture-after-assignment bug."""
    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    a = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"cols": 10, "rows": 10})).json()["id"]
    b = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"cols": 10, "rows": 10})).json()["id"]

    await client.post(f"/api/builder-v2/locations/{a}/edges", json={
        "side": "east", "range_start": 0, "range_end": 9,
        "target_location_id": b, "target_entry_col": 3, "target_entry_row": 3,
    })

    r = await client.post("/api/sessions/join", json={
        "session_code": session_code, "player_name": "P",
    })
    char_id = r.json()["character_id"]

    # Place directly on the east edge (col=9). MUST stay in A.
    r = await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
        "location_id": a, "col": 9, "row": 5,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["location_id"] == a, f"placement teleported into {data['location_id']}"
    assert (data["col"], data["row"]) == (9, 5)
```

---

### Fix 5.2 — Dangling `target_location_id` after location delete (HIGH)

**File:** `app/routers/builder_v2/locations.py`
**Function:** `delete_location`
**Lines:** ~147-152 (the explicit cascade block).

**Live evidence:**
```
DELETE /locations/{B} → 200
GET    /locations/{A}/edges → [{ target_location_id: B (deleted) }]
POST   /move-grid → character now at location_id=B (ghost row)
```
Standing **Rule 4** says SQLite ignores `ondelete=SET NULL` without
PRAGMA. The model declares `target_location_id` with `ondelete="SET
NULL"` but nothing actually nullifies it on delete. So edges in
location A keep pointing at the deleted B; characters that walk
through them end up in a phantom location whose row no longer
exists.

**Fix — incoming-edge cleanup in `delete_location`.** Right before
`db.delete(loc)`, add the inbound nullify (or delete — pick one;
nullify is friendlier so the GM keeps the segment shape and can
re-target it later):

```python
from sqlalchemy import update as sa_update   # at top of file already? add if missing

# ... existing outbound cleanup of edges OWNED by this location:
await db.execute(sa_delete(BV2Edge).where(BV2Edge.location_id == location_id))

# NEW: nullify edges in OTHER locations that target this one.
await db.execute(
    sa_update(BV2Edge)
    .where(BV2Edge.target_location_id == location_id)
    .values(target_location_id=None, target_entry_col=0, target_entry_row=0)
)
```

**Defensive secondary fix in `move-grid`.** Even with the cleanup
above, third-party DB writes or a future bug could re-introduce a
dangling FK. So *always* verify the target exists before
transitioning (see the `await db.get(BV2Location, ...)` guard
inside Fix 5.1's snippet — keep that guard even after this fix
lands).

**Regression test:**

```python
@pytest.mark.asyncio
async def test_bv2_location_delete_nullifies_incoming_edges(client, session_code):
    """Deleting a target location must nullify edges in other
    locations that point to it. Otherwise SQLite keeps a dangling
    FK and `move-grid` teleports characters into ghost rows."""
    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    a = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"cols": 10, "rows": 10})).json()["id"]
    b = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"cols": 10, "rows": 10})).json()["id"]

    r = await client.post(f"/api/builder-v2/locations/{a}/edges", json={
        "side": "east", "range_start": 0, "range_end": 9,
        "target_location_id": b, "target_entry_col": 3, "target_entry_row": 3,
    })
    edge_id = r.json()["id"]

    r = await client.delete(f"/api/builder-v2/locations/{b}")
    assert r.status_code == 200

    r = await client.get(f"/api/builder-v2/locations/{a}/edges")
    edges = r.json()
    assert len(edges) == 1
    assert edges[0]["id"] == edge_id
    assert edges[0]["target_location_id"] is None
```

---

### Fix 5.3 — `current_location_id` / `col` / `row` not exposed via any GET endpoint (HIGH — third repeat of the same anti-pattern)

**Read this carefully — this is the third time in three phases that
a write path was added without the matching read path.** Phase 3
hid `sight_range_cells`. Phase 4 hid carried lights. Phase 5 hides
the character grid position. The standing rules at the bottom of
this file have a dedicated section on this; re-read it after applying
the fix.

**Symptom.** A player refreshes the browser. The frontend has no
way to ask "where is my character on the bv2 grid?" — neither
`/api/sessions/{code}/characters` nor `/api/map/{code}` returns
`current_location_id`, `col`, or `row`. The WS event
`bv2.character_moved` only fires *during* movement; on initial
connect there is no state to bootstrap from.

**Fix part 1 — token serializer.**
File: `app/routers/map/files.py`, ~line 197 (the `tokens.append({...})`
block already used for Phase 3's `sight_range_cells`):

```python
tokens.append({
    "character_id": c.id, "name": c.name, "is_npc": c.is_npc,
    "x": c.map_x, "y": c.map_y,
    "color": c.token_color, "visible": c.is_visible_on_map,
    "current_hp": c.current_hp, "max_hp": c.max_hp, "is_alive": c.is_alive,
    "vision_radius": c.vision_radius,
    "sight_range_cells": c.sight_range_cells,
    "speed_total": speed_total,
    "movement_used": float(c.movement_used_this_turn or 0.0),
    "movement_left": max(0.0, speed_total - float(c.movement_used_this_turn or 0.0)),
    "token_image_url": c.token_image_url,
    # NEW — Phase 5 grid position:
    "bv2_location_id": c.current_location_id,
    "bv2_col": c.col,
    "bv2_row": c.row,
})
```

Use the `bv2_` prefix to keep the legacy `x`/`y` (pixel-space token
coordinates) clearly separated from the new grid coordinates.

**Fix part 2 — session character list.**
File: `app/routers/sessions.py`, the dict literal in
`list_session_characters` (~line 222). Add the same three fields:

```python
return [
    {
        "id": c.id,
        "name": c.name,
        # ... existing fields ...
        "sight_range_cells": c.sight_range_cells,
        "bv2_location_id": c.current_location_id,
        "bv2_col": c.col,
        "bv2_row": c.row,
    }
    for c in chars
]
```

**Regression test:**

```python
@pytest.mark.asyncio
async def test_bv2_character_grid_position_exposed(client, session_code):
    """current_location_id / col / row must be present on every
    character-serialising endpoint the frontend reads. If this
    fails, the frontend has no way to bootstrap grid state on
    refresh — only WS movement events would carry the info, which
    is not enough for initial render."""
    r = await client.post("/api/sessions/join", json={
        "session_code": session_code, "player_name": "P",
    })
    char_id = r.json()["character_id"]

    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 10, "rows": 10})).json()["id"]

    await client.post(f"/api/builder-v2/characters/{char_id}/move-grid", json={
        "location_id": loc_id, "col": 4, "row": 7,
    })

    # 1. /api/sessions/{code}/characters
    r = await client.get(f"/api/sessions/{session_code}/characters")
    me = next(x for x in r.json() if x["id"] == char_id)
    assert me["bv2_location_id"] == loc_id
    assert me["bv2_col"] == 4
    assert me["bv2_row"] == 7

    # 2. /api/map/{code} token serialiser
    r = await client.get(f"/api/map/{session_code}")
    mine = next(t for t in r.json()["tokens"] if t["character_id"] == char_id)
    assert mine["bv2_location_id"] == loc_id
    assert mine["bv2_col"] == 4
    assert mine["bv2_row"] == 7
```

---

### Fix 5.4 — `range_end` clamp off-by-one and inverted ranges allowed (LOW)

**File:** `app/routers/builder_v2/edges.py`
**Functions:** `create_edge` (~line 58-60) and `update_edge` (~109-112).

**Live evidence:**
```
POST /edges {"side": "north", "range_start": 0, "range_end": 9999} on a cols=10 location
→ stored: range_end=10
```
Valid columns are `0..cols-1=9`, so `range_end=10` covers a cell
that does not exist. Cosmetic, but `_find_matching_edge` will never
fire for that phantom cell anyway. Worse: `range_start=9,
range_end=0` is silently accepted, producing an edge that matches
nothing.

**Fix.** Replace the clamp lines in both endpoints with:

```python
max_range = (loc.cols if side in ("north", "south") else loc.rows) - 1
range_start = max(0, min(max_range, int(body.get("range_start", 0))))
range_end   = max(range_start,
                  min(max_range, int(body.get("range_end", max_range))))
```

The `max(range_start, ...)` floor on `range_end` makes inverted
ranges impossible. Apply the same pattern in `update_edge` after
both `range_start` and `range_end` have been read off `body` —
clamp `range_end` against the (possibly updated) `range_start`,
not against zero.

**Regression test:**

```python
@pytest.mark.asyncio
async def test_bv2_edge_range_clamping(client, session_code):
    """range_end must clamp to cols-1 / rows-1 (not cols / rows),
    and range_end must never end up below range_start."""
    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps", json={"name": "M"})
    map_id = r.json()["id"]
    a = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"cols": 10, "rows": 8})).json()["id"]
    b = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                           json={"cols": 10, "rows": 8})).json()["id"]

    # Out-of-bounds end on cols=10 north edge -> max valid is 9.
    r = await client.post(f"/api/builder-v2/locations/{a}/edges", json={
        "side": "north", "range_start": 0, "range_end": 9999,
        "target_location_id": b,
    })
    assert r.json()["range_end"] == 9

    # Inverted -> end floored to start.
    r = await client.post(f"/api/builder-v2/locations/{a}/edges", json={
        "side": "east", "range_start": 5, "range_end": 0,
        "target_location_id": b,
    })
    assert r.json()["range_end"] >= r.json()["range_start"]
```

---

### Fix 5.5 — Update the handoff `§13 Phase 5 caveats`

After fixes 5.1–5.4 are green, append a new caveats block to
`docs/BUILDER_V2_HANDOFF.md` immediately after `### Phase 4 caveats`:

```markdown
### Phase 5 caveats

- **`POST /move-grid` with `location_id` is treated as placement,
  not movement.** Edge transitions are skipped for that single
  call. If you ever extend the endpoint, keep the
  `is_placement = "location_id" in body` guard or the GM cannot
  spawn a token on a doorway cell.
- **Location deletion nullifies incoming edges** (SQL `UPDATE ...
  SET target_location_id = NULL`). The `ondelete="SET NULL"` in
  the model is *advisory only* on SQLite — the explicit
  `sa_update` in `delete_location` is what actually does the work.
  If you remove that statement, dangling FKs come back instantly.
- **Grid position is exposed under `bv2_*` keys**
  (`bv2_location_id`, `bv2_col`, `bv2_row`) in both
  `/api/sessions/{code}/characters` and `/api/map/{code}` token
  payloads. Do **not** reuse the legacy `x` / `y` fields — those
  are pixel-space token coordinates from the legacy Map Builder
  and have unrelated semantics. If you add a third character
  serializer, also add the three `bv2_*` keys; the
  `test_bv2_character_grid_position_exposed` regression covers
  the two existing endpoints.
- **Edge ranges are inclusive on both ends** and clamped to
  `[0, cols-1]` / `[0, rows-1]`. Inverted ranges (`start > end`)
  are rejected at clamp time by flooring `end` against `start`.
```

Also bump the test counter in §13 to whatever `dev.ps1 check`
reports after the four new tests are added (should be `40 + 4 = 44`).

---

### Verification checklist (tick before marking section APPLIED)

- [ ] Fix 5.1 applied; first-placement test green; manual check:
      drop a token at the cell of a defined edge → token stays put.
- [ ] Fix 5.2 applied; incoming-edges-nullify test green; defensive
      `db.get(BV2Location, ...)` guard kept inside `move-grid`.
- [ ] Fix 5.3 applied to **both** `routers/map/files.py` and
      `routers/sessions.py`; `test_bv2_character_grid_position_exposed`
      green.
- [ ] Fix 5.4 applied to **both** `create_edge` and `update_edge`;
      clamp test green.
- [ ] Fix 5.5 — Phase 5 caveats block appended to handoff §13;
      test counter bumped.
- [ ] `.\dev.ps1 check` is green with **44** passing tests.
- [ ] Browser sanity-check: place a character on the grid → refresh
      the page → the character is still drawn at the same cell
      (this exercises Fix 5.3 end-to-end through the JS layer).

When all ticks land → append `✅ APPLIED on <date>` to the section
heading at the top of this section. Then start Phase 6.

---

## Phase 6 — Library + Polish + Legacy Removal — Fix List ✅ APPLIED on 2026-04-26

The legacy-removal pass landed cleanly (deleted directories,
import cleanup, tab removed, smoke test trimmed, `dev.ps1 check`
green at 44/44). The Library backend / frontend also work — but
the existing roundtrip test only covers the trivial case (1
location, 1 wall tile, 1 chest), which is **why** the bug below
slipped through. This is exactly the failure mode rule **S6** warns
about: a passing test that doesn't actually verify the rule it
claims to.

### Fix 6.1 — `ambient_light = 0` lost during snapshot save (HIGH — fourth repeat of S1)

**File:** `app/routers/builder_v2/library.py`
**Function:** `_snapshot_map`
**Line:** ~43

**Live evidence (Cascade ran a multi-feature roundtrip probe):**
```
Original:  ambient_light = 0.0
Loaded:    ambient_light = 1.0   ← coerced
```
GM creates a pitch-black cave, saves to library, loads it back —
the cave is now bright daylight. Same bug as Phase 4 Fix 4.1, third
copy of `or 1.0` in a third file. Standing rule **S1** was added in
this very document **hours before** Phase 6 shipped, and was
violated by the first new serializer the next agent wrote.

**Root cause snippet:**
```python
"ambient_light": float(loc.ambient_light or 1.0),
```

`0 or 1.0` → `1.0`. JS `||` and Python `or` both evaluate `0` as
falsy.

**Fix.** Match the form already used in `common.py:ser_location`
(also `as` form `is not None`):

```python
"ambient_light": float(loc.ambient_light) if loc.ambient_light is not None else 1.0,
```

While you're in this file, also clean up the two cosmetic siblings
on lines ~64-65 (no live data loss today, but the pattern is wrong
and will bite the next time the fallback differs from the natural
zero):

```python
# BEFORE:
"radius_cells": float(li.radius_cells or 0.0),
"intensity":   float(li.intensity or 0.0),

# AFTER:
"radius_cells": float(li.radius_cells) if li.radius_cells is not None else 0.0,
"intensity":   float(li.intensity)     if li.intensity     is not None else 0.0,
```

If the verbosity bothers you, add a tiny helper at the top of
`library.py` and use it everywhere — but **never** use `or` for
numeric defaults again:

```python
def _f(v, default: float) -> float:
    return float(v) if v is not None else float(default)
```

### Fix 6.2 — Snapshot test is too shallow (S6 violation)

**File:** `tests/test_smoke.py`
**Function:** `test_bv2_library_save_and_load`

The current test only verifies tiles + entities for a single
location. Eight roundtrip behaviours go unchecked, including the
exact one (`ambient_light = 0`) that contained the bug above.
**Replace** the existing test body with the expanded version
below — it is the same shape, just exercising every snapshot
field in one pass:

```python
@pytest.mark.asyncio
async def test_bv2_library_save_and_load(client, session_code):
    """Full roundtrip: every snapshot field must survive
    save → load, including ambient_light=0 (S1 regression),
    multi-location edges (target_location_index resolution),
    lights (all fields), hidden entities (visible_to_players=False),
    and cross-session loading."""
    # Build a map with: 2 locations, dark indoor, wall tile,
    # coloured torch, hidden trap, edge linking A → B.
    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                          json={"name": "Original"})
    map_id = r.json()["id"]

    a = (await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={
        "cols": 10, "rows": 10, "ambient_light": 0.0, "is_indoor": True,
    })).json()["id"]
    b = (await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={
        "cols": 12, "rows": 8,
    })).json()["id"]

    await client.patch(f"/api/builder-v2/locations/{a}/tiles", json={
        "set": [{"col": 1, "row": 1, "tile_type": "wall"}], "erase": [],
    })
    await client.post(f"/api/builder-v2/locations/{a}/lights", json={
        "col": 3, "row": 3, "radius_cells": 4.5, "color_hex": "#ff0000",
        "intensity": 1.5, "source_kind": "torch",
    })
    await client.post(f"/api/builder-v2/locations/{a}/entities", json={
        "entity_type": "trap", "col": 5, "row": 5,
        "visible_to_players": False, "name": "Hidden Trap",
    })
    await client.post(f"/api/builder-v2/locations/{a}/edges", json={
        "side": "east", "range_start": 2, "range_end": 5,
        "target_location_id": b, "target_entry_col": 1, "target_entry_row": 1,
    })

    # Save → list → load
    r = await client.post("/api/builder-v2/library/save-from-map",
                          json={"map_id": map_id, "name": "Snap"})
    assert r.status_code == 200, r.text
    snap_id = r.json()["id"]

    r = await client.get(f"/api/builder-v2/library?session_code={session_code}")
    assert any(s["id"] == snap_id for s in r.json())

    r = await client.post(f"/api/builder-v2/library/{snap_id}/load-as-map",
                          json={"session_code": session_code, "name": "Loaded"})
    assert r.status_code == 200, r.text
    new_map_id = r.json()["map_id"]

    new_locs = (await client.get(f"/api/builder-v2/maps/{new_map_id}/locations")).json()
    assert len(new_locs) == 2
    new_a, new_b = new_locs[0]["id"], new_locs[1]["id"]

    # ── Location A: verify every field ──
    full_a = (await client.get(f"/api/builder-v2/locations/{new_a}")).json()
    loc = full_a["location"]
    assert loc["ambient_light"] == 0.0, "S1 regression: ambient_light=0 coerced"
    assert loc["is_indoor"] is True
    assert loc["cols"] == 10 and loc["rows"] == 10

    # Tile
    assert len(full_a["tiles"]) == 1
    assert full_a["tiles"][0]["tile_type"] == "wall"

    # Light — every persisted field
    assert len(full_a["lights"]) == 1
    li = full_a["lights"][0]
    assert li["radius_cells"] == 4.5
    assert li["color_hex"] == "#ff0000"
    assert li["intensity"] == 1.5
    assert li["source_kind"] == "torch"
    assert li["col"] == 3 and li["row"] == 3

    # Entity — visible_to_players=False must persist (hidden trap)
    assert len(full_a["entities"]) == 1
    e = full_a["entities"][0]
    assert e["entity_type"] == "trap"
    assert e["name"] == "Hidden Trap"
    assert e["visible_to_players"] is False

    # Edge — target_location_index resolved to the new B id
    edges = (await client.get(f"/api/builder-v2/locations/{new_a}/edges")).json()
    assert len(edges) == 1
    assert edges[0]["side"] == "east"
    assert edges[0]["range_start"] == 2 and edges[0]["range_end"] == 5
    assert edges[0]["target_location_id"] == new_b
    assert edges[0]["target_entry_col"] == 1 and edges[0]["target_entry_row"] == 1

    # ── Cross-session load (library is portable across sessions) ──
    r = await client.post("/api/sessions/create",
                          json={"gm_name": "OtherGM", "name": "OtherSession"})
    other_code = r.json()["session_code"]
    r = await client.post(f"/api/builder-v2/library/{snap_id}/load-as-map",
                          json={"session_code": other_code, "name": "Cross"})
    assert r.status_code == 200

    # ── Error handling ──
    r = await client.post("/api/builder-v2/library/99999/load-as-map",
                          json={"session_code": session_code, "name": "X"})
    assert r.status_code == 404

    # Cleanup
    r = await client.delete(f"/api/builder-v2/library/{snap_id}")
    assert r.status_code == 200
```

This test stays at one named function (no count creep), but every
roundtrip field is now asserted. After applying it, run
`.\dev.ps1 check` — it should fail on the `ambient_light` assert,
proving the test catches Bug 6.1. Then apply Fix 6.1 and re-run —
should be 44 green.

### Fix 6.3 — Dead two-pass edge serialization (cosmetic)

**File:** `app/routers/builder_v2/library.py`
**Function:** `_snapshot_map`
**Lines:** ~70-112

The current code queries edges twice, builds a partial list with
`target_location_index: None` placeholders, then has a literal
`pass` block (~89-93) that does nothing, then re-queries and
rebuilds the same list. The first pass + the `pass` block are
leftover from a refactor and can be deleted — only the second pass
matters.

**Fix.** Replace lines ~70-112 with a single edge-serialization
pass placed after the `loc_id_to_index` map is built:

```python
# In the per-location loop above, do NOT serialize edges.
# Instead leave a placeholder list and fill it after the
# `loc_id_to_index` map is known:
loc_data["edges"] = []   # filled in the second pass
locations.append(loc_data)

# After the per-location loop:
loc_id_to_index = {}
locs_r2 = await db.execute(
    select(BV2Location)
    .where(BV2Location.map_id == map_id)
    .order_by(BV2Location.sort_order)
)
all_locs = locs_r2.scalars().all()
for idx, loc in enumerate(all_locs):
    loc_id_to_index[loc.id] = idx

edges_r = await db.execute(
    select(BV2Edge).where(BV2Edge.location_id.in_(loc_id_to_index.keys()))
)
for e in edges_r.scalars().all():
    idx = loc_id_to_index[e.location_id]
    locations[idx]["edges"].append({
        "side": e.side,
        "range_start": e.range_start,
        "range_end": e.range_end,
        "target_location_index": loc_id_to_index.get(e.target_location_id),
        "target_entry_col": e.target_entry_col,
        "target_entry_row": e.target_entry_row,
    })

return {"locations": locations}
```

No behaviour change, just one DB roundtrip removed and the
mysterious empty `pass` block gone.

### Fix 6.4 — Update the handoff `§13 Phase 6 caveats`

After the fixes are green, append this block to
`docs/BUILDER_V2_HANDOFF.md` immediately after `### Phase 5
caveats`:

```markdown
### Phase 6 caveats

- **Library snapshots are portable across sessions.** A snapshot
  saved in session A can be loaded into session B via
  `POST /library/{id}/load-as-map` with the new session's
  `session_code`. The new Map is created in the target session
  and broadcast on its WS channel. Snapshots with `session_id`
  and snapshots with `session_id IS NULL` (global/shared) both
  work. If you ever add ownership checks, do not break the
  global-snapshot path.
- **`load-as-map` does a deep copy by value, not by reference.**
  Editing the original Map after a load does NOT propagate to the
  loaded Map (and vice-versa). This is intentional — snapshots are
  immutable templates. If you ever want a "linked instance" feature,
  add it as a separate endpoint, do not change `load-as-map`.
- **`target_location_index` is a 0-based index into the snapshot's
  `locations` array**, not a database id. The loader maps
  `target_location_index → new_location_id` after creating each
  fresh location. If you change the locations-list ordering
  (currently `ORDER BY sort_order`), every old snapshot in the
  library breaks immediately. Bump a `snapshot_schema_version`
  field if you do.
- **Legacy `app/routers/map_builder/` and
  `static/js/gm/18-map-builder.js` are gone.** Do not resurrect
  them — every feature has a builder-v2 equivalent. The single
  legacy hook left is `static/js/gm/01-core.js` adding
  `'builder-v2'` to the flex-tab list.
```

Bump the test counter line in §13 to whatever `dev.ps1 check`
reports after the expanded test (still 44 — the test count is
unchanged because Fix 6.2 *replaces* an existing test rather than
adding a new one; only the assertions inside grow).

### Verification checklist

- [x] Fix 6.1 applied; `or 1.0` and the two `or 0.0` siblings
      replaced with `is not None` form. Optional: add the `_f`
      helper if the file has more numeric serializers.
- [x] Fix 6.2 — replace `test_bv2_library_save_and_load` with the
      expanded version above. Run `.\dev.ps1 check` BEFORE
      applying Fix 6.1 to confirm the new test catches the bug
      (it should fail on the `ambient_light` assert). Then apply
      6.1 → re-run → 44 green.
- [x] Fix 6.3 — dead-code two-pass edge serializer cleaned up;
      manual sanity check by running the expanded library test
      (it covers cross-location edges).
- [x] Fix 6.4 — Phase 6 caveats appended to handoff §13.
- [x] `.\dev.ps1 check` is green with **44** tests passing.
- [x] Browser sanity: build a map with a dark indoor location
      (`ambient_light=0`), torch, hidden trap, edge to second
      location → save snapshot → delete original map → load
      snapshot in same session → confirm everything round-trips
      pixel-for-pixel including the dark cave.

When all ticks land → mark this section
`✅ APPLIED on <date>`. Phase 6 closure is complete.

### Lesson from Phase 6 — S1 was violated within hours of being written

The standing rule **S1** ("never use `or`/`||` for numeric
defaults") was added to this very file before Phase 6 started, and
was violated by the **first** new serializer Phase 6 shipped. This
proves that "read the rules" is not enough — agents do not
internalize prose rules under workload. From now on, **enforce S1
mechanically before declaring any phase done:**

```powershell
# Run from repo root. Should return ZERO matches in app/ (tests
# may legitimately use `or` in literal data fixtures, so scope
# the check to source files only).
rg -nP "\b(or|or)\s+[0-9]+\.?[0-9]*\b" app/routers/builder_v2/
rg -nP "\|\|\s*[0-9]+\.?[0-9]*\b" static/js/builder_v2/
```

If either returns matches, fix every hit before declaring the
phase done. This grep is now a permanent step in the verification
checklist for *every* future phase. It would have flagged Bug 6.1
in two seconds.

---

## Phase 6 — Fix 6.5 — dangling `characters.current_location_id` on location delete ✅ APPLIED on 2026-04-26

Caught by an independent verification pass **after** Fixes 6.1–6.4
were marked ✅. Proves the Pre-phase grep check for **S5** works —
when run properly. The first pass missed this one target of the
"for each `ondelete=`, confirm matching explicit cleanup" rule.

### Evidence

`app/models.py:92-94`:

```@c:\Users\Litun\Desktop\DND Project\dnd-companion\app\models.py:92-94
    current_location_id: Mapped[int | None] = mapped_column(
        ForeignKey("bv2_locations.id", ondelete="SET NULL"), nullable=True
    )
```

`ondelete="SET NULL"` is declared, **but**:
- `app/routers/builder_v2/locations.py:delete_location` has explicit
  `sa_update` for `BV2Edge.target_location_id` only — no touch of
  `Character.current_location_id`.
- `app/routers/builder_v2/maps.py:delete_map` cascades children but
  likewise never nullifies `Character.current_location_id`.

SQLite does not enforce FK `ON DELETE SET NULL` by default (same
reason S5 exists at all). Result: after a GM deletes a location that
a character is standing in, `characters.current_location_id` points
to a dead row. Next `POST /character-grid-move` will call
`db.get(BV2Location, char.current_location_id)` → `None` → either a
404 or a broken `_find_entity_location` call in `edges.py`.

### Repro (backend only, no UI needed)

```
1. POST /api/builder-v2/sessions/{code}/maps                  → map_id
2. POST /api/builder-v2/maps/{map_id}/locations               → loc_id
3. PATCH /api/characters/{char_id} (current_location_id=loc_id, col=1, row=1)
   -- or use the edges `place-character` flow --
4. DELETE /api/builder-v2/locations/{loc_id}
5. GET /api/characters/{char_id}
   → current_location_id is STILL loc_id (dangling)           ← BUG
6. POST /api/builder-v2/characters/{char_id}/grid-move ...
   → 500 / 404 depending on which branch hits first
```

### Fix

**File:** `app/routers/builder_v2/locations.py` in
`delete_location`, next to the existing `sa_update(BV2Edge)` block
(~line 153-157).

```python
from app.models import Character  # add to top of file if missing
# ... inside delete_location, after the existing BV2Edge sa_update:
await db.execute(
    sa_update(Character)
    .where(Character.current_location_id == location_id)
    .values(current_location_id=None)
)
```

**File:** `app/routers/builder_v2/maps.py` in `delete_map`, before
deleting child locations (so the character pointer clears while the
location ids are still resolvable, or do it as a subquery — either
works, subquery is one statement):

```python
from app.models import Character, BV2Location
from sqlalchemy import update as sa_update, select as sa_select

await db.execute(
    sa_update(Character)
    .where(
        Character.current_location_id.in_(
            sa_select(BV2Location.id).where(BV2Location.map_id == map_id)
        )
    )
    .values(current_location_id=None)
)
```

Do this **before** the existing cascade-delete of locations so the
update window still sees the rows. If the current delete order is
already "null refs → delete children → delete parent", insert the
new update as the first statement in the delete chain.

### Regression test (mandatory — S6)

Add to `tests/test_smoke.py`, in the bv2 block (extend the existing
`test_bv2_location_cascade_delete` if present, otherwise new test):

```python
@pytest.mark.asyncio
async def test_bv2_location_delete_nullifies_character_pointer(client, session_code):
    """S5: deleting a bv2 location must NULL out characters.current_location_id
    (SQLite ignores ON DELETE SET NULL)."""
    # Create map + location
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "M"})).json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 5, "rows": 5})).json()["id"]

    # Create a character and place them in the location
    char_id = (await client.post(f"/api/characters?session_code={session_code}",
                                 json={"name": "Tester", "is_npc": False})).json()["id"]
    await client.patch(f"/api/characters/{char_id}",
                       json={"current_location_id": loc_id, "col": 1, "row": 1})

    # Sanity: pointer is set
    assert (await client.get(f"/api/characters/{char_id}")).json()["current_location_id"] == loc_id

    # Delete the location
    r = await client.delete(f"/api/builder-v2/locations/{loc_id}")
    assert r.status_code == 200

    # Pointer must be cleared, not dangling
    after = (await client.get(f"/api/characters/{char_id}")).json()
    assert after["current_location_id"] is None, \
        "S5 regression: characters.current_location_id left dangling after location delete"

    # Same guarantee when the whole map is deleted
    loc_id2 = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                 json={"cols": 5, "rows": 5})).json()["id"]
    await client.patch(f"/api/characters/{char_id}",
                       json={"current_location_id": loc_id2, "col": 2, "row": 2})
    await client.delete(f"/api/builder-v2/maps/{map_id}")
    after2 = (await client.get(f"/api/characters/{char_id}")).json()
    assert after2["current_location_id"] is None, \
        "S5 regression: map delete did not clear character pointer to child location"
```

Adjust the character-creation payload / endpoint names to match
your actual router (the character router may use a different POST
path — grep `@router.post` in `app/routers/characters.py` before
writing). The assertion semantics are the contract; the plumbing
around them is free to change.

### Verification checklist

- [x] Fix 6.5 applied in `locations.py` (single `sa_update`).
- [x] Fix 6.5 applied in `maps.py` (subquery `sa_update` before
      location cascade).
- [x] Regression test added and passing. Run it **before** the fix
      to confirm it actually fails on the dangling pointer (TDD
      proof the test catches the bug, same protocol as Fix 6.2).
- [x] `.\dev.ps1 check` green with **45** tests (one new).
- [x] Re-run the full Pre-phase grep suite — all still zero.

### Lesson — how this slipped through

Pre-phase grep check **S5** is intentionally two-step:

1. `rg -n "ondelete=" app/models.py` → list every FK cleanup
   contract.
2. For **each** match, open the matching `delete_X` endpoint and
   confirm there is an explicit `sa_delete` / `sa_update` against
   that referencing table.

Step 1 takes 2 seconds. Step 2 takes ~30 seconds and is the only
step that actually catches bugs. On the Phase 6 close-out pass,
step 2 was run for the FKs *declared inside bv2 tables* (edges,
tiles, entities, lights, visit_state, library) but skipped for FKs
*pointing from non-bv2 tables into bv2 tables* — of which
`Character.current_location_id` is the only one. Add this to the
grep protocol:

> After listing every `ondelete=`, grep the **referenced** table
> name too. `rg "bv2_locations" app/models.py` lists every incoming
> arrow. Each incoming arrow is a cleanup obligation on whichever
> delete endpoint owns the target row.

This is now a permanent refinement of rule **S5** in the Standing
rules section below.

---

## Standing rules — read before every phase

These rules are extracted from real bugs caught in Phases 2-6. Each
rule names the anti-pattern explicitly. If you cannot remember which
rule maps to which past bug, re-read the matching `### Phase N
caveats` block in `docs/BUILDER_V2_HANDOFF.md` §13.

### Pre-phase grep checks (MANDATORY before marking ✅)

Prose rules do not stop bugs — Phase 6 violated S1 within hours of
S1 being written. Run **all** of these greps from the repo root
before declaring any phase done. They take five seconds total:

```powershell
# S1 — numeric defaults via `or` / `||`
rg -nP "\b or\s+[0-9]+\.?[0-9]*\b" app/routers/builder_v2/
rg -nP "\|\|\s*[0-9]+\.?[0-9]*\b"  static/js/builder_v2/

# S5a — outgoing FKs: `ondelete=` declared but no explicit cleanup
rg -n  "ondelete="                  app/models.py
# For each match, confirm the owning delete_X endpoint has
# sa_delete / sa_update against that table.

# S5b — INCOMING FKs: every bv2_ table that is a FK target.
# This step was missed in Phase 6 and cost Fix 6.5.
rg -n  "bv2_locations"              app/models.py
rg -n  "bv2_maps"                   app/models.py
# etc for each bv2_ table. Each hit OUTSIDE the table's own
# definition is an incoming arrow, which means the delete endpoint
# for THAT table owes a cleanup against the referencing table.

# S2 — new model field that no GET returns
# After adding a field to app/models.py, grep for the field name
# in app/routers/. If it appears in only one file (the writer),
# the read path is missing.
```

Zero matches on the S1 greps is required to ship a phase. If the
S5 grep finds an `ondelete` without explicit cleanup, add the
cleanup before shipping.

### S1. Numeric defaults: use `??`, never `||` (JS) and never `or` (Py)

**JS:** `x ?? default` falls back only on `null` / `undefined`.
`x || default` *also* falls back on `0`, `""`, `false`, `NaN`.

**Python:** `x if x is not None else default` is the safe form.
`x or default` is the foot-gun.

**Rule.** For *any* numeric or boolean field whose valid range
includes `0` / `False`, never use `||` / `or`. This includes:
`ambient_light`, `intensity`, `radius`, `range_start`, `opacity`,
`alpha`, `threshold`, `min_dc`, `damage_dice_count`, anything that
naturally bottoms out at zero. **Caught:** Phase 4 `ambient_light=0`
twice (client + server).

### S2. New write path → matching read path → regression test

**The bug:** every phase since 3 has shipped a model field, a write
endpoint, and a WS broadcast — but no GET endpoint that exposes the
field to the client.

| Phase | Write path | Forgotten read path |
|-------|-----------|---------------------|
| 3     | `Character.sight_range_cells` + migration | `/api/map/{code}` & `/api/sessions/{code}/characters` |
| 4     | `BV2Light` with `location_id IS NULL` (carried) | `get_location_full` does not include them |
| 5     | `Character.{current_location_id, col, row}` + `move-grid` | both character serializers (again) |

**Rule.** Before declaring a phase done, mentally trace **one full
round-trip** for every new field:

1. Server stores X (model + migration ✓ + write endpoint ✓).
2. Which GET endpoint returns X to the client?
3. Which JS code reads X out of the response?
4. If a player **refreshes the browser**, can the frontend rebuild
   the relevant UI from scratch using only GET endpoints (no WS
   replay)?

If step 2 or 4 has no answer, the feature is dead code. Add the
read path **and** a regression test that hits every endpoint that
must include the field (template:
`test_bv2_character_grid_position_exposed` in Fix 5.3).

### S3. Re-use existing primitives before writing new geometry/loops

**The bug:** Phase 4 reinvented a 2r×2r blast-radius loop instead
of calling `FOVCalculator.compute`. Result: walls leaked light.

**Rule.** When you need *"all cells reachable from (c,r) within
`r` cells respecting the map"* — the answer is
`FOVCalculator.compute`. Same primitive for vision, light, AOE,
sound. Look at what already exists in `static/js/builder_v2/` and
in `app/routers/builder_v2/` before writing a fresh nested loop.

### S4. Server is source of truth for tile rules; client mirrors only when forced

**The bug:** Phase 3 had `_blocksVision` hardcoding
`type === 'wall' || type === 'pit'` instead of reading
`tile.blocks_vision` off the server-provided object.

**Rule.** Tile flags (`blocks_vision`, `blocks_movement`, future
cost / opacity / friction) live in `TILE_DEFAULTS` server-side.
`ser_tile()` already emits them per tile. The client must read them
off the tile object — not duplicate the rule table. The single
allowed mirror is `20-mapview.js:TILE_BLOCKS`, used only for stub
tiles created by `setTile()` before the server round-trips, and
that mirror carries an explicit "MUST mirror server-side" comment.
If you ever need a second mirror, follow the same pattern and
document why.

### S5. SQLite ignores `ondelete=CASCADE` / `SET NULL` — always cascade explicitly

**The bug:** Phase 5 declared `BV2Edge.target_location_id` with
`ondelete="SET NULL"` and assumed the database would honour it.
SQLite does not without a `PRAGMA foreign_keys=ON` setup, so dangling
FKs survived `DELETE /locations`.

**Rule.** Every `delete_X` endpoint must explicitly clean up children
**and** any rows that point *to* the deleted entity. Pattern:

```python
# Children we own:
await db.execute(sa_delete(Child).where(Child.parent_id == id))
# Rows in OTHER tables pointing at us — nullify or delete:
await db.execute(sa_update(Other).where(Other.target_id == id)
                 .values(target_id=None))
```

Always pair the cleanup with a regression test that creates the
inbound link, deletes the target, and verifies the inbound row is
nullified or gone.

### S6. Add the smoke test in the same commit as the business rule

**The bug:** Phase 3 had `visible_to_players=False` filtering
working correctly but no test — would have regressed silently.
Phase 5 had clamp / 404 / cascade logic with similar gaps.

**Rule.** Every business rule gets a smoke test the moment it
lands. If you cannot describe the rule in one sentence, you cannot
test it; if you cannot test it, do not ship it. The smoke-test file
is `tests/test_smoke.py`, naming pattern `test_bv2_*`.

### S7. Caveats first, then ✅ DONE

**The bug:** Phase 4 was marked ✅ DONE in §13 *before* its bugs
were discovered and added here.

**Rule.** A phase is not done while there are unmarked entries in
`temp_fix.md` for it. Workflow: review → caveats added to handoff →
fixes added to `temp_fix.md` → fixes applied → checklist ticked →
✅ APPLIED tag → only then mark the phase ✅ DONE in handoff §13.

---

---

## Phase 7 — Bridge + Hex + Drag — Fix List ✅ APPLIED on 2026-04-26

No critical bugs were discovered during Phase 7 implementation.
Two test-level adjustments were made:

1. **NPC template test payload** — `session_id` must be an `int`, not
   `None`, matching the `TemplateBody` Pydantic schema.
2. **Chest bridge test** — chest must have `is_opened=True` for items
   to appear in the public player payload (by design in §4.7.7).

Both were caught by the standard TDD run-before-fix protocol and
required no code changes outside the test file.

### Verification checklist

- [x] Group A (typed entity tables): 6 new models, 5 router modules,
      `props_json` dropped, S5 cleanup added, all 7 roundtrip tests green.
- [x] Group B (bridge): `_build_state_from_bv2` in `map/files.py`,
      legacy WS rebroadcast for tiles/entities/lights, 3 bridge tests green.
- [x] Group C (hex + drag): odd-r offset fix in `20-mapview.js`,
      E/S/SE drag handles with `bv2:bounds-resized-done` event.
- [x] `.

dev.ps1 check` green with **55** tests passing.
- [x] Pre-phase grep S1 (Python + JS): zero matches.
- [x] Pre-phase grep S5a + S5b: all incoming arrows have explicit cleanup.

---

## Phase 8 — Player Lighting + FOV + Edges + Negative Resize — Fix List ✅ APPLIED on 2026-04-26

### Fix 8.1 — `setFog` string format mismatch (MEDIUM)

**File:** `static/js/map-canvas.js`  
**Function:** `setFog`

The bv2 bridge returns `revealed_cells` as a list of `"col,row"` strings,
but `setFog` destructured every element as `c[0],c[1]` assuming `[col,row]`
arrays. Passing a string would produce `c[0]=="1"`, `c[1]==","`, breaking
the Set and rendering zero revealed cells.

**Fix.** Accept both formats:

```javascript
const cells = (revealedCells || []).map(c => {
  if (typeof c === 'string') return c;
  return `${c[0]},${c[1]}`;
});
this.revealedCells = new Set(cells);
```

### Fix 8.2 — `S.api.post` does not exist (LOW)

**File:** `static/js/builder_v2/30-editor.js`

`window.bv2.api` only exposes named methods (`createMap`, `patchTiles`,
etc.). Calling `S.api.post` throws `TypeError: S.api.post is not a function`.

**Fix.** Use the global `api.post` directly:

```javascript
await api.post(`/api/builder-v2/locations/${S.currentLocId}/shift`, { ... });
```

### Fix 8.3 — `_sendOwnTokenMove` missing `return` in catch block (LOW)

**File:** `static/js/player/10-map.js`

If the `PATCH /api/map/token` request threw (network failure), the catch
block logged but did not return. Execution fell through to the Phase 8
visit POST, which would run with stale/invalid coordinates.

**Fix.** Add `return;` after `console.warn('token move failed:', e);`.

### Verification checklist

- [x] Bridge payload exposes `bv2_lights`, `bv2_edges`, and per-character
      `revealed_cells` via optional `character_id` query param.
- [x] `MapCanvas` renders lighting overlay (`destination-out` radial
      gradients) and edge indicators for all sides.
- [x] Player token drag triggers client-side FOV + `POST /visit` update.
- [x] Negative-direction resize (N/W/NW) shifts content via new
      `POST /locations/{id}/shift` endpoint before saving bounds.
- [x] `ruff check app tests` green; `pytest tests/test_smoke.py` reports
      **61** tests passing.

---

## Phase 9 — Bugs + Lighting + Interior Zones + Character Bridge — Fix List ✅ APPLIED on 2026-04-27

### Fix 9.1 — `load-as-map` hardcodes snapshot name (MEDIUM)

**File:** `static/js/builder_v2/90-library.js`  
**Fix:** Remove `name: 'Loaded Map'` from the `loadSnapshot` call.

### Fix 9.2 — Builder Location dropdown shows stale entries (MEDIUM)

**File:** `static/js/builder_v2/30-editor.js`  
**Fix:** Reset `S.locations = []` before auto-creating the first location on map creation.

### Fix 9.3 — Snapshot save misses pending tiles (MEDIUM)

**File:** `static/js/builder_v2/90-library.js`  
**Fix:** Call `S.flushSave()` before `saveSnapshot`; refresh library list on success.

### Fix 9.4 — `models.py` truncated by end-of-file edit (CRITICAL)

**Root cause:** `edit()` matching the final lines of `models.py` replaced the entire tail,
dropping all Phase 7 typed entity tables.  
**Fix:** Restore from git, then use a unique anchor (`zone_entity_id`) instead of the
very last line when appending new models.

### Fix 9.5 — Alembic autogenerate on stale DB schema (MEDIUM)

**Root cause:** `data/combat_companion.db` had an `alembic_version` row pointing to a
deleted migration (`38310716b6f7`). Autogenerate saw missing tables and generated
drop/create chaos.  
**Fix:** Manually update `alembic_version` to the real head (`d928752f9387`), then
write the migration by hand (only add new tables + column).

### Phase 9 incomplete items (blocking nothing, noted for Phase 10)

- **Interior zone builder UI (C.5):** No "Zone" terrain brush. Zones must be created
  via API/tests for now.
- **Door peek (C.4):** `BV2Tile.is_open` column exists, but no GM toggle UI and no
  cone-of-sight peek logic in `_renderInteriorOverlay`.

### Verification checklist

- [x] Track A (library/bugs): 2 tests, all green.
- [x] Track B (lighting): ambient slider + indoor checkbox in builder; GM soft preview.
- [x] Track C (interiors): model + migration + endpoints + bridge + client overlay;
      2 tests green.
- [x] Track D (character/NPC): edge transition test, NPC spawn test, builder token
      preview, NPC template dropdown in spawn modal; 3 tests green.
- [x] `ruff check app tests` green; `pytest tests/test_smoke.py` reports **68** tests passing.

---

## Phase 9 Round 2 — Cleanup — Fix List ✅ APPLIED on 2026-04-27

### Fix R1 — `SESSION_CODE` vs `SESSION_ID` in NPC template fetch (MEDIUM)

**File:** `static/js/builder_v2/50-entities.js`  
**Fix:** Use `SESSION_ID` (int) for `/api/npc-library/templates` query param.

### Fix R2 — Duplicate NPC spawn seeding logic (MEDIUM)

**File:** `app/routers/builder_v2/spawns.py` (new), `app/routers/npc_library.py`,
`app/routers/builder_v2/locations.py`  
**Fix:** Extract `spawn_npc_from_template` shared helper; both legacy and bv2
spawn paths use it.

### Fix R3 — Interior zone builder painting UI (MEDIUM)

**Files:** `static/js/builder_v2/20-mapview.js`, `30-editor.js`, `95-interiors.js` (new),
`static/gm.html`, `app/routers/builder_v2/locations.py`  
**Fix:** Zone brush button paints pending cells; Enter saves via
`POST /locations/{id}/interiors`. List shows existing zones with delete.

### Fix R4 — Door peek toggle + render (MEDIUM)

**Files:** `app/routers/builder_v2/common.py`, `app/routers/builder_v2/tiles.py`,
`app/routers/map/files.py`, `static/js/map-canvas.js`, `static/js/gm/06-map-main.js`  
**Fix:** `ser_tile` and bridge payload expose `is_open`. `patch_tiles` accepts
`is_open`. GM right-click on door tile toggles open/closed. `_renderInteriorOverlay`
BFS-computes a 2-cell-deep peek slice through open boundary doors; players see
it within 3 cells, GM always sees it.

### Verification checklist

- [x] R1: NPC template dropdown populates correctly in builder spawn modal.
- [x] R2: `test_phase9_spawn_helper_dedupes_seeding` passes; no drift between
      legacy and bv2 spawn paths.
- [x] R3: Zone brush paints pending cells; Enter saves; list refreshes.
- [x] R4: Door toggle persists and surfaces on legacy map endpoint;
      `_renderInteriorOverlay` skips peek cells.
- [x] `ruff check app tests` green; `pytest tests/test_smoke.py` reports **70**
      tests passing.

---

*End of file. New phases get appended above this standing-rules
block; the rules block stays at the bottom as a permanent reference.*
