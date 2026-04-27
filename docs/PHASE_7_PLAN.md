# Map Builder v2 — Phase 7 Plan

**Author:** previous Cascade session, 2026-04-26
**Status:** PENDING — handoff to next AI
**Prerequisites:** Phases 1-6 complete (✅), all fixes 6.1-6.5 applied (✅).
**Mandatory reading before starting:** `docs/temp_fix.md` — Standing rules
section, especially **S1 / S2 / S5 / S6** and the **Pre-phase grep checks**
block. They are not optional. Phase 6 violated S1 within hours of S1
being written; do not repeat that.

---

## 0. Context — what user reported and what I verified

User report (verbatim, translated):
1. *"I want to drag location boundaries freely in any direction."*
2. *"Hexagons break when I switch to them."* — screenshot shows hex
   cells overflowing the dashed yellow rectangle on the left and
   bottom in a parallelogram skew.
3. *"Builder has zero interaction with the Map tab — built maps don't
   load there, library load doesn't surface either."*

What I verified by reading the code:

- **#1 root cause:** there is NO canvas-level drag-handle UI in
  `static/js/builder_v2/`. Only sidebar number inputs in
  `30-editor.js:370-383` (`bv2-cols`, `bv2-rows`). Pure missing
  feature, not a bug.
- **#2 root cause:** `static/js/builder_v2/20-mapview.js`:
  - `_tileCenterPx(col, row)` line 185-186 uses pure **axial**
    coordinates: `x = gs*(col + row/2)`, `y = gs*(√3/2 * row)`.
  - This places hex centres on a **parallelogram**, not a rectangle.
  - `_drawBoundary` line 414-417 draws a **rectangle**
    `cols*gs × rows*gs`. Axial layout extends past the right edge
    by `(rows-1)*gs/2` and is cut short on the left by `0`. Pure
    geometric mismatch.
  - The legacy `static/js/map-canvas.js:464-582` uses the same axial
    formula but overlays on a fixed-size raster image, so the user
    never sees boundary mismatch there.
- **#3 root cause:** `app/routers/map/files.py:151-256`
  (`get_map_state`) reads only legacy tables: `MapData →
  active_floor_id → MapFloor`. There is no branch that checks
  `BV2Map.is_active` or pulls data from any `bv2_*` table.
  `BV2Map.is_active` flag exists (`app/models.py:1318`), the
  `POST /maps/{id}/activate` endpoint flips it
  (`maps.py:110-131`), but it is read by **nothing** outside the
  builder's own list view. `library/{id}/load-as-map`
  (`library.py:173-281`) creates `bv2_*` rows and emits
  `bv2.map_added`, never touches `MapData`. Result: the entire
  builder is an island disconnected from the player-facing
  `/api/map/{code}` payload.

This plan addresses all three. **#3 is the headline work** — the
other two combined are smaller than #3 alone.

---

## 1. Workflow ground rules — read before touching code

These supplement the Standing rules in `temp_fix.md`. Violating any
is grounds for the next AI to roll your changes back.

1. **TDD on every behaviour change.** Write the smoke test first,
   confirm it fails for the documented reason, *then* implement.
   Same protocol that caught Fix 6.1 (`ambient_light=0`) and Fix 6.5
   (dangling pointer).
2. **No new endpoints without serializer round-trip checks.** Every
   field you write to the DB must round-trip through GET. **S2** is
   the rule that caught Phase 5's `current_location_id` regression.
3. **Run all three Pre-phase greps before claiming the phase done.**
   `temp_fix.md` lists them explicitly in the Pre-phase grep checks
   subsection.
4. **One step at a time.** Order in §6 below is not a suggestion —
   each step depends on data from the previous one. Do not try to
   parallelise.
5. **No emojis in Python or test names.** English comments only.
6. **Phase 7 keeps the test count strictly increasing.** Current is
   45. Each new behaviour adds a smoke test; Phase 7 should land at
   ~52-54.

---

## 2. Step 1 — Free-drag boundary resize (smallest, do first to warm up)

### 2.1. Goal

When the GM has a location open in the builder, four edges and four
corners of the dashed yellow boundary become draggable. Dragging
**resizes** `cols` / `rows` live; the auto-save debounce in
`30-editor.js` already exists (`queueSettingsSave({ cols, rows })`)
and will persist the change. No new endpoint needed.

### 2.2. Files

- `static/js/builder_v2/20-mapview.js` — render handles, hit-test,
  drag state machine.
- `static/js/builder_v2/30-editor.js` — listen to a new
  `'bv2:bounds-resized'` custom event from MapView, push to
  `queueSettingsSave`. (Decoupled so MapView stays storage-agnostic.)
- `static/css/gm.css` — cursor styles for handle hover.

### 2.3. Implementation sketch

In `MapView`:

```js
// New state
this.boundsDrag = null;
// e.g. { edge: 'right' | 'bottom' | 'corner-br' | ..., startCols, startRows, startMx, startMy }

// In render(), after _drawBoundary(), also draw 8 handle squares.
_drawBoundsHandles(ctx) {
  const gs = this._gridSize();
  const w = this._cols() * gs, h = this._rows() * gs;
  const hs = 12 / this.scale;  // screen-space size, divided by scale because we're inside transform
  const positions = [
    ['e',  w,     h / 2],
    ['s',  w / 2, h],
    ['se', w,     h],
    // 'w', 'n', 'nw', 'ne', 'sw' optional — see §2.4 for negative-side semantics
  ];
  ctx.fillStyle = '#fbbf24';
  for (const [, x, y] of positions) ctx.fillRect(x - hs/2, y - hs/2, hs, hs);
}

// Hit-test a screen-space point against handles
_hitHandle(sx, sy) {
  // Convert screen → world, compare to handle positions, return edge id or null
}
```

Wire mousedown/mousemove/mouseup in the existing `_attachInteractions`:

```js
if (this.boundsDrag) {
  const { edge, startCols, startRows, startMx, startMy } = this.boundsDrag;
  const gs = this._gridSize();
  const dCol = Math.round((mx - startMx) / gs);
  const dRow = Math.round((my - startMy) / gs);
  if (edge.includes('e')) this.location.cols = Math.max(5, startCols + dCol);
  if (edge.includes('s')) this.location.rows = Math.max(5, startRows + dRow);
  // Render and emit
  this.render();
  this.canvas.dispatchEvent(new CustomEvent('bv2:bounds-resized', {
    detail: { cols: this.location.cols, rows: this.location.rows }
  }));
}
```

In `30-editor.js`:

```js
S.view.canvas.addEventListener('bv2:bounds-resized', e => {
  const { cols, rows } = e.detail;
  document.getElementById('bv2-cols').value = cols;
  document.getElementById('bv2-rows').value = rows;
  queueSettingsSave({ cols, rows });
});
```

### 2.4. Negative-side handles (north / west) — design choice

User said *"in any direction"*. Two options:

- **A. (recommended)** Only support E / S / SE handles for now. Cols
  and rows are non-negative — dragging "north" or "west" would
  require shifting every existing tile by `+dCol` / `+dRow` on the
  server. That's a much bigger change touching `bv2_tiles`,
  `bv2_entities`, `bv2_lights`, `bv2_edges` (range_start/end) on
  every drag. Defer.
- **B.** Full 8-handle resize with origin shift. Adds an endpoint
  `POST /locations/{id}/translate {dCol, dRow}` that updates every
  child row's coordinates. Implementable but increases scope ~3×.

**Pick A** for Phase 7. Add a TODO note that B is a Phase 8 candidate.
Document the limit clearly in the GM-facing tooltip:
*"Drag the right or bottom edge to grow / shrink the location. To
shift content, use the toolbar's Move tool (Phase 8)."*

### 2.5. Test (smoke level)

There is no headless drag-test infrastructure in this repo. Skip the
JS unit test; cover this with **manual verification** in the
checklist (§7). The behaviour is purely client-side and the data path
already has full coverage via `PATCH /locations/{id}` smoke tests.

---

## 3. Step 2 — Hex grid no longer breaks the boundary

### 3.1. Root cause (confirmed by reading code)

`static/js/builder_v2/20-mapview.js:183-189`:

```@c:\Users\Litun\Desktop\DND Project\dnd-companion\static\js\builder_v2\20-mapview.js:183-189
    _tileCenterPx(col, row) {
      const gs = this._gridSize();
      if (this._isHex()) {
        return { x: gs * (col + row / 2), y: gs * (Math.sqrt(3) / 2 * row) };
      }
      return { x: (col + 0.5) * gs, y: (row + 0.5) * gs };
    }
```

`gs * (col + row/2)` is the axial → pixel formula. It produces a
**parallelogram** layout, not a rectangle. With `cols=40, rows=30`
the rightmost cell on row 29 has `x = gs * (39 + 14.5) = 53.5*gs`,
extending **way past** the right boundary at `40*gs`. Hence the
overflow visible in the user's screenshot.

`_drawBoundary` (line 414-417) draws a rectangle of `cols*gs ×
rows*gs`, which assumes a rectangular layout. Geometric mismatch.

### 3.2. Fix — switch hex to **odd-r offset coordinates**

Offset coordinates keep the rectangular `cols × rows` extent and
just stagger every other row by `gs/2`. This is the standard layout
for "I want a rectangular map of hex cells". Reference:
https://www.redblobgames.com/grids/hexagons/#coordinates-offset

Replace `_tileCenterPx`:

```js
_tileCenterPx(col, row) {
  const gs = this._gridSize();
  if (this._isHex()) {
    // odd-r pointy-top offset: every odd row shifts +gs/2 to the east
    const xOff = (row & 1) ? gs / 2 : 0;
    return {
      x: (col + 0.5) * gs + xOff,
      y: (row + 0.5) * gs * (Math.sqrt(3) / 2),
    };
  }
  return { x: (col + 0.5) * gs, y: (row + 0.5) * gs };
}
```

Replace `_screenToTile` hex branch:

```js
if (this._isHex()) {
  // Approximate: snap to nearest centre by brute search of 4 candidates.
  // Cost is O(1), accuracy is exact for hex offset.
  let best = null, bestD = Infinity;
  const targetRow = my / (gs * Math.sqrt(3) / 2);
  for (const dr of [-1, 0, 1]) {
    const row = Math.round(targetRow - 0.5) + dr;
    const xOff = (row & 1) ? gs / 2 : 0;
    const col = Math.round((mx - xOff) / gs - 0.5);
    const c = this._tileCenterPx(col, row);
    const d = (c.x - mx) ** 2 + (c.y - my) ** 2;
    if (d < bestD) { bestD = d; best = { col, row }; }
  }
  return best;
}
```

Replace `_drawBoundary` y extent for hex:

```js
const bw = this._cols() * gs + (this._rows() > 1 && this._isHex() ? gs / 2 : 0);
const bh = this._isHex()
  ? (this._rows() * gs * Math.sqrt(3) / 2 + gs * (1 - Math.sqrt(3) / 2))
  : this._rows() * gs;
```

(The `+ gs/2` on width handles the odd-row offset; the bh formula
accounts for the half-cell sticking out at the bottom of the
last row.)

### 3.3. Update `_drawGrid` for hex

If `_drawGrid` (or its hex sibling) iterates `q,r` axially, replace
with col,row offset iteration:

```js
for (let r = 0; r < this._rows(); r++) {
  for (let c = 0; c < this._cols(); c++) {
    const { x, y } = this._tileCenterPx(c, r);
    this._hexPath(ctx, x, y, gs / Math.sqrt(3));
    ctx.stroke();
  }
}
```

### 3.4. **CRITICAL** — backend already stores `(col, row)` as offset

The DB columns `bv2_tiles.col`, `bv2_tiles.row`,
`bv2_entities.col/row`, `bv2_lights.col/row` are integers with no
implicit coordinate-system claim. With offset coordinates they map
1:1 to (column, row) in the offset grid, same as square grid.

**User decision (2026-04-26):** NO migration of existing axial-coord
hex data. If any axial hex rows exist, their visual position will
shift after the fix — that is acceptable. Do not write a migration.
Do not warn the user in a tooltip. Just ship the fix.

### 3.5. Test (smoke)

Add to `tests/test_smoke.py` in the bv2 block:

```python
@pytest.mark.asyncio
async def test_bv2_location_hex_grid_persists(client, session_code):
    """grid_type='hex' must round-trip through PATCH/GET cleanly,
    and tile coordinates must accept the same (col, row) shape as square."""
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "M"})).json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 8, "rows": 6})).json()["id"]
    r = await client.patch(f"/api/builder-v2/locations/{loc_id}",
                           json={"grid_type": "hex"})
    assert r.status_code == 200
    assert r.json()["grid_type"] == "hex"
    # Paint a tile at the rightmost-bottom cell; must accept the same coord shape
    await client.patch(f"/api/builder-v2/locations/{loc_id}/tiles", json={
        "set": [{"col": 7, "row": 5, "tile_type": "wall"}], "erase": [],
    })
    full = (await client.get(f"/api/builder-v2/locations/{loc_id}")).json()
    assert any(t["col"] == 7 and t["row"] == 5 for t in full["tiles"])
```

Visual correctness is verified manually; this test only ensures the
backend is grid-type-agnostic, which it already is.

---

## 4. Step 3 — Builder ↔ Map bridge (the big work)

### 4.1. Goal

When a GM activates a `BV2Map` (and within it, an active
`BV2Location`), `GET /api/map/{session_code}` returns a payload that
makes the player Map tab render that location, **without changing
any frontend code**. All bv2 → legacy translation happens server-side.

This means: paint a wall in builder → player sees a wall on their
map within one WS event. Load a snapshot from library → player
immediately sees the loaded location.

### 4.2. Why server-side translation, not new endpoints / new client code

- Player canvas (`static/js/map-canvas.js`,
  `static/js/player/10-map.js`) already handles tiles, tokens,
  drawings, markers, walls, traps, chests, portals, fog. It is well-
  tested and large (1700+ LOC). Re-implementing or forking it is
  weeks of work and creates two render paths that drift.
- The legacy MapFloor → state shape is already proven to work end-
  to-end. We only need to fill it from `bv2_*` rows when a bv2 map
  is the active one.
- WS events are already plumbed (`map.tile_painted`,
  `map.token_moved`, etc.). Reuse them — see §4.6.

### 4.3. Server-side changes — `app/routers/map/files.py`

Modify `get_map_state` (currently lines 151-256). New logic:

```python
# Pseudocode — read top-down
async def get_map_state(session_code, db):
    # ... existing session/map_data lookup ...

    # Phase 7: bv2 takes precedence when there is an active bv2 map.
    bv2_map_q = await db.execute(
        select(BV2Map)
        .where(BV2Map.session_id == session.id)
        .where(BV2Map.is_active == True)
    )
    bv2_map = bv2_map_q.scalar_one_or_none()

    bv2_loc = None
    if bv2_map:
        loc_q = await db.execute(
            select(BV2Location)
            .where(BV2Location.map_id == bv2_map.id)
            .where(BV2Location.is_active == True)
            .limit(1)
        )
        bv2_loc = loc_q.scalar_one_or_none()
        # Fallback: first location by sort_order if none active
        if not bv2_loc:
            loc_q = await db.execute(
                select(BV2Location)
                .where(BV2Location.map_id == bv2_map.id)
                .order_by(BV2Location.sort_order)
                .limit(1)
            )
            bv2_loc = loc_q.scalar_one_or_none()

    if bv2_loc:
        return await _build_state_from_bv2(session, bv2_map, bv2_loc, chars, db)

    # ... existing legacy MapFloor path ...
```

Add a new helper:

```python
async def _build_state_from_bv2(session, bv2_map, loc, chars, db):
    tiles_q = await db.execute(select(BV2Tile).where(BV2Tile.location_id == loc.id))
    tiles_rows = tiles_q.scalars().all()
    entities_q = await db.execute(
        select(BV2Entity).where(BV2Entity.location_id == loc.id)
    )
    entities = entities_q.scalars().all()

    # Convert tiles to the dict shape MapCanvas.setTiles() expects:
    # { "col,row": { type, blocks_movement, blocks_vision } }
    tile_map = {
        f"{t.col},{t.row}": {
            "type": t.tile_type,
            "blocks_movement": bool(t.blocks_movement),
            "blocks_vision":  bool(t.blocks_vision),
        }
        for t in tiles_rows
    }

    # Convert entities to legacy lists. Filter visible_to_players for
    # the public payload — there is also a /api/map/gm/{code} variant
    # if needed; for now keep the GM-vs-player split in WS gating.
    traps   = [_entity_to_trap(e)   for e in entities if e.entity_type == 'trap']
    chests  = [_entity_to_chest(e)  for e in entities if e.entity_type == 'chest']
    portals = [_entity_to_portal(e) for e in entities if e.entity_type == 'portal']

    # Tokens: convert bv2 (col, row) to normalised pixel for tokens
    # whose current_location_id matches this location.
    tokens = []
    cols = max(1, loc.cols)
    rows = max(1, loc.rows)
    for c in chars:
        if c.current_location_id != loc.id:
            continue  # skip tokens not on this location
        # offset coords for hex; same formula as MapView._tileCenterPx
        if loc.grid_type == 'hex':
            xpx = (c.col + 0.5) + (0.5 if c.row % 2 else 0.0)
            x_norm = xpx / (cols + 0.5)
            y_norm = (c.row + 0.5) * (math.sqrt(3) / 2) / (rows * math.sqrt(3) / 2)
        else:
            x_norm = (c.col + 0.5) / cols
            y_norm = (c.row + 0.5) / rows
        tokens.append({
            "character_id": c.id, "name": c.name, "is_npc": c.is_npc,
            "x": x_norm, "y": y_norm,
            # ... copy the rest from existing legacy token dict ...
            "bv2_location_id": c.current_location_id,
            "bv2_col": c.col, "bv2_row": c.row,
        })

    return {
        "has_map": True,
        "image_url": loc.background_image_url or "",
        "image_width":  loc.cols * loc.tile_size,
        "image_height": loc.rows * loc.tile_size,
        "grid_size":    loc.tile_size,
        "grid_enabled": True,
        "grid_type":    loc.grid_type,
        "fog_enabled":  False,  # bv2 uses its own visit_state, not legacy fog
        "remember_explored": True,
        "revealed_cells": [],
        "tokens":  tokens,
        "active_floor_id": None,           # signal: this is bv2-sourced
        "active_floor_name": loc.name,
        "active_floor_tiles": tile_map,
        "active_floor_grid_type": loc.grid_type,
        "active_floor_tile_size": loc.tile_size,
        "active_floor_cols": loc.cols,
        "active_floor_rows": loc.rows,
        "active_map_id": bv2_map.id,
        "active_map_name": bv2_map.name,
        "_traps":  traps,
        "_mapChests": chests,
        "_portals": portals,
        # bv2-specific keys for future client features
        "bv2_active_location_id": loc.id,
        "bv2_ambient_light": float(loc.ambient_light)
                             if loc.ambient_light is not None else 1.0,
        "bv2_is_indoor": bool(loc.is_indoor),
    }
```

Note the **S1 trap** in the snippet above (`loc.ambient_light is not
None else 1.0`) — do not write `loc.ambient_light or 1.0`. This is
the fourth file where this exact bug almost reappeared.

### 4.4. Helpers `_entity_to_trap` / `_chest` / `_portal`

These adapt `bv2_entities.props_json` to the legacy list shapes. For
each entity type, produce **only** the fields the existing
MapCanvas reader expects. Look at how legacy `traps`, `chests`,
`portals` are populated in `app/routers/map/files.py` and adjacent
files (likely there are dedicated routers).

**Required fields per legacy list (verify by grep before
implementing):**

- `_traps`: `id`, `x`, `y`, `is_hidden`, `damage_dice`, `name`. The
  `is_hidden` flag = `not entity.visible_to_players`.
- `_mapChests`: `id`, `x`, `y`, `name`, `icon`. (Might need to read
  related `Chest` table — depends on whether bv2 chest entities
  link to a real `Chest` row or just store everything in props_json.
  This is a design decision: see §4.7.)
- `_portals`: `id`, `x`, `y`, `target_*`. Mostly maps cleanly from
  props_json keys.

`x` / `y` here are normalised 0..1 coordinates. Use the same
`_tileCenterPx`-style formula as in §4.3 token conversion, then
divide by `cols * tile_size` / `rows * tile_size`.

### 4.5. Activation behaviour — what `is_active` actually means

After Phase 7, **`BV2Map.is_active=True` for a session means: the
players see this map**. There must be exactly one active map per
session. Currently `POST /maps/{id}/activate` (`maps.py:110-131`)
already enforces "one active per session" by setting all others to
False — keep that.

But: the **active location** within the active map is selected by
`BV2Location.is_active=True`. There is already `POST
/locations/{id}/activate` (`locations.py:170+`) — confirm it does
the same one-active-at-a-time pattern. If not, fix it.

### 4.6. WS broadcasts — make the player's map tab refresh

Currently builder edits emit `bv2.tile_painted`, `bv2.entity_added`,
etc. on the session WS channel. The player's Map tab listens for
**legacy** events: `map.tile_painted`, `map.token_moved`,
`map.fog_updated`, etc.

Two integration options:

- **A. Rebroadcast in the bv2 routers.** When painting a tile and
  the active location is the painted one, emit *both* `bv2.tile_painted`
  *and* `map.tile_painted` so the player canvas updates.
- **B. Generalise the player WS handler** to also listen to
  `bv2.*` events.

**Pick A** — server-side emission. The player codebase (`map-canvas.js`,
`player/10-map.js`) is huge; do not touch it. The server already
has `broadcast()` in `app/routers/builder_v2/common.py`; just call
it twice when the change touches the active location:

```python
# In tiles.py after tile upsert:
await broadcast(session_code, "bv2.tile_painted", payload)
if location_is_active(loc, db):
    await broadcast(session_code, "map.tile_painted", legacy_payload)
```

Implement `location_is_active` once and reuse. Apply the same
double-emit pattern to entity create/update/delete and light
changes. The pattern is repetitive; consider a small helper:

```python
async def emit_map_change(session_code: str, ev: str, body: dict, *,
                          loc, db):
    """Always emit the bv2.* event. If `loc` is the session's active
    bv2 location, also emit the legacy map.* mirror."""
    await broadcast(session_code, f"bv2.{ev}", body)
    if await _is_active_location(loc, db):
        await broadcast(session_code, f"map.{ev}", _legacy_shape(ev, body))
```

### 4.7. Typed entity detail tables — NO JSON ALLOWED (user mandate)

**User decision (2026-04-26), verbatim and binding:**

> *"Chests and similar tools must be fully configurable internally.
> No JSON. For a chest — pick an item from the DB. For a trap —
> pick the trap type, damage dice, damage type. Portal, NPC, cover
> — same. I absolutely forbid JSON configuration. Only maximally
> elaborated tools."*

This is a hard rule. `bv2_entities.props_json` must be **deleted**
as a configuration surface. Every entity type gets a dedicated
typed detail table with real columns and real FKs. Phase 7 cannot
close until this is done — the bridge in §4.4 reads from these new
tables, not from `props_json`.

#### 4.7.1. Schema (one detail table per entity type, 1:1 with `bv2_entities`)

Add these tables in `app/models.py`, all in one new alembic
migration (`bv2_entity_detail_tables`). Every detail table shares
the same FK pattern:

```python
entity_id: Mapped[int] = mapped_column(
    ForeignKey("bv2_entities.id", ondelete="CASCADE"),
    primary_key=True,   # enforces 1:1 with parent entity
)
```

The `entity_id` is both PK and FK — guarantees one detail row per
entity, cascades on entity delete. S5 compliance: entity delete
cascades, but you must still add explicit `sa_delete` for each
detail table in `delete_entity` and in location / map cascade (see
§4.7.6). Run the **incoming-arrows grep** after adding these.

**`BV2Chest` (detail for `entity_type == 'chest'`):**

```python
class BV2Chest(Base):
    __tablename__ = "bv2_chests"
    entity_id: Mapped[int] = mapped_column(
        ForeignKey("bv2_entities.id", ondelete="CASCADE"), primary_key=True
    )
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    lock_dc: Mapped[int] = mapped_column(Integer, default=10)
    icon: Mapped[str] = mapped_column(String(20), default="chest")
    is_opened: Mapped[bool] = mapped_column(Boolean, default=False)
    # Items live in a join table — see BV2ChestItem below.


class BV2ChestItem(Base):
    __tablename__ = "bv2_chest_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    chest_entity_id: Mapped[int] = mapped_column(
        ForeignKey("bv2_chests.entity_id", ondelete="CASCADE"), nullable=False
    )
    item_id: Mapped[int] = mapped_column(
        ForeignKey("items.id", ondelete="CASCADE"), nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, default=1)
```

`items.id` is the existing global Item table
(`app/models.py` — grep `class Item`). Reuse it; do not duplicate.

**`BV2Trap`:**

```python
class BV2Trap(Base):
    __tablename__ = "bv2_traps"
    entity_id: Mapped[int] = mapped_column(
        ForeignKey("bv2_entities.id", ondelete="CASCADE"), primary_key=True
    )
    # Enum kept in Python, stored as string for simplicity:
    # 'spike' | 'dart' | 'pit' | 'fire' | 'poison' | 'magic' | 'custom'
    trap_type: Mapped[str] = mapped_column(String(20), default="spike")
    # Dice notation as a plain string: '2d6', '1d8+3', etc.
    # Validate with a regex at the router layer — no JSON.
    damage_dice: Mapped[str] = mapped_column(String(20), default="1d6")
    # 'piercing' | 'slashing' | 'bludgeoning' | 'fire' | 'cold' |
    # 'lightning' | 'poison' | 'necrotic' | 'radiant' | 'psychic' |
    # 'acid' | 'thunder' | 'force'
    damage_type: Mapped[str] = mapped_column(String(20), default="piercing")
    dc_detect:  Mapped[int] = mapped_column(Integer, default=12)
    dc_disarm:  Mapped[int] = mapped_column(Integer, default=12)
    dc_save:    Mapped[int] = mapped_column(Integer, default=12)
    save_ability: Mapped[str] = mapped_column(String(10), default="dex")
    is_triggered: Mapped[bool] = mapped_column(Boolean, default=False)
    is_disarmed:  Mapped[bool] = mapped_column(Boolean, default=False)
    trigger_mode: Mapped[str] = mapped_column(String(20), default="on_enter")
    # 'on_enter' | 'on_exit' | 'proximity' | 'manual'
    reset_on_trigger: Mapped[bool] = mapped_column(Boolean, default=False)
```

Validation at router layer: `damage_dice` must match
`^(\d+)d(\d+)([+-]\d+)?$`; enum fields must be in their allowed
sets. Reject with 422 otherwise. No silent coercion.

**`BV2Portal`:**

```python
class BV2Portal(Base):
    __tablename__ = "bv2_portals"
    entity_id: Mapped[int] = mapped_column(
        ForeignKey("bv2_entities.id", ondelete="CASCADE"), primary_key=True
    )
    target_location_id: Mapped[int | None] = mapped_column(
        ForeignKey("bv2_locations.id", ondelete="SET NULL"), nullable=True
    )
    target_col: Mapped[int] = mapped_column(Integer, default=0)
    target_row: Mapped[int] = mapped_column(Integer, default=0)
    is_one_way: Mapped[bool] = mapped_column(Boolean, default=False)
    requires_key_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("items.id", ondelete="SET NULL"), nullable=True
    )
    label: Mapped[str] = mapped_column(Text, default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
```

Note two incoming-FK-to-`bv2_locations` cleanups required (target
location) and one incoming to `items`. See §4.7.6.

**`BV2NPCSpawn`:**

```python
class BV2NPCSpawn(Base):
    __tablename__ = "bv2_npc_spawns"
    entity_id: Mapped[int] = mapped_column(
        ForeignKey("bv2_entities.id", ondelete="CASCADE"), primary_key=True
    )
    npc_template_id: Mapped[int] = mapped_column(
        ForeignKey("npc_templates.id", ondelete="CASCADE"), nullable=False
    )
    # 'on_enter' | 'on_activate' | 'on_combat_start' | 'manual'
    auto_spawn_trigger: Mapped[str] = mapped_column(String(20), default="on_enter")
    spawn_count: Mapped[int] = mapped_column(Integer, default=1)
    has_spawned: Mapped[bool] = mapped_column(Boolean, default=False)
    is_hostile: Mapped[bool] = mapped_column(Boolean, default=True)
```

Grep existing NPC template table name before writing — might be
`npc_templates` or `npc_library`. Use the real one.

**`BV2CoverZone`:**

Cover zones span multiple cells. Model as detail row + child
`cells` table, **not** as a JSON array of pairs.

```python
class BV2CoverZone(Base):
    __tablename__ = "bv2_cover_zones"
    entity_id: Mapped[int] = mapped_column(
        ForeignKey("bv2_entities.id", ondelete="CASCADE"), primary_key=True
    )
    # 'half' | 'three_quarters' | 'full'
    cover_level: Mapped[str] = mapped_column(String(20), default="half")
    # 'wooden' | 'stone' | 'magical' | 'natural'
    material: Mapped[str] = mapped_column(String(20), default="wooden")
    blocks_line_of_sight: Mapped[bool] = mapped_column(Boolean, default=False)
    is_destructible: Mapped[bool] = mapped_column(Boolean, default=False)
    current_hp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_hp:     Mapped[int | None] = mapped_column(Integer, nullable=True)


class BV2CoverCell(Base):
    __tablename__ = "bv2_cover_cells"
    __table_args__ = (UniqueConstraint(
        "zone_entity_id", "col", "row", name="uq_bv2_cover_cell"
    ),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    zone_entity_id: Mapped[int] = mapped_column(
        ForeignKey("bv2_cover_zones.entity_id", ondelete="CASCADE"), nullable=False
    )
    col: Mapped[int] = mapped_column(Integer, nullable=False)
    row: Mapped[int] = mapped_column(Integer, nullable=False)
```

#### 4.7.2. Delete `props_json` from `bv2_entities`

In the same alembic migration:

```python
op.drop_column('bv2_entities', 'props_json')
```

There is no fallback path. If the migration fails on existing dev
data, drop the existing `bv2_entities` rows (dev-only; user
confirmed they have no production data worth preserving at this
stage). **Do not** write JSON-to-column migration logic — the user
explicitly forbade JSON-based flows.

#### 4.7.3. New endpoints per entity type (CRUD + detail)

For each entity type, split the current generic
`POST /locations/{id}/entities` into a typed path:

- `POST   /locations/{loc_id}/chests`            → creates BV2Entity + BV2Chest
- `PATCH  /chests/{entity_id}`                    → updates chest-specific fields
- `POST   /chests/{entity_id}/items`             → adds a BV2ChestItem
- `PATCH  /chests/{entity_id}/items/{item_row}`  → changes quantity
- `DELETE /chests/{entity_id}/items/{item_row}`
- `GET    /chests/{entity_id}`                    → full detail incl. items joined

Same pattern for `/traps`, `/portals`, `/npc-spawns`, `/cover-zones`.
For cover zones, `cells` gets its own subresource:
`POST /cover-zones/{id}/cells` / `DELETE .../cells/{col}/{row}`.

Keep the existing `POST /locations/{id}/entities` endpoint **only**
for trivial types (`decor`, `waypoint`, `note`) that have no
detail row. Trying to create a typed entity through the generic
endpoint must fail with 400.

Each new endpoint has its own Pydantic request/response model in
`app/schemas.py`. NO `dict` / `Any` bodies. Typed fields or nothing.

#### 4.7.4. Serializer contract (S2 compliance)

Every field you write through one of the new endpoints must be
readable through the matching GET. Concretely:

- `ser_entity(e)` in `common.py` must detect `e.entity_type` and
  join the matching detail row, returning one flat dict with all
  typed fields (not `{"type": "chest", "props": {...}}` — the
  flat shape is what the frontend forms will bind to directly).
- For chests, include the full `items` array via a SELECT join on
  `bv2_chest_items` and `items`.
- For cover zones, include the full `cells` array.

Add a dedicated test per type verifying round-trip (write every
field → GET → assert every field). Same protocol as Fix 6.2.

#### 4.7.5. Sidebar UI — typed forms, one per entity type

In `static/js/builder_v2/50-entities.js` (or adjacent file — grep
the current entity panel), replace the generic "entity → props JSON"
form with five dedicated forms:

- **Chest form:** name, locked toggle + DC input, icon select,
  item-picker widget (dropdown fed by `GET /api/items`, quantity
  number input, add button, list of added items with remove).
- **Trap form:** type select (7 options), damage_dice text (with
  inline regex validator), damage_type select, three DC number
  inputs, save-ability select, trigger-mode select, reset toggle.
- **Portal form:** target-location select (dropdown of sibling
  locations in the same map), target col/row number inputs (with
  a "pick on canvas" button that temporarily switches the canvas
  into target-picking mode), one-way toggle, label text,
  required-key-item select (nullable).
- **NPC spawn form:** npc-template select (dropdown of
  `GET /api/npc-templates`), trigger select, count number,
  hostile toggle.
- **Cover form:** cover-level select, material select,
  blocks-LOS toggle, destructible toggle (reveals HP inputs when
  on), and a canvas-paint mode for adding/removing cells.

Use `shadcn/ui`-equivalent components the project already has in
`static/css/gm.css`. Do **not** introduce a new component library.

No field on any of these forms writes to or reads from a JSON
string. If you catch yourself typing `JSON.stringify`, stop —
you're violating the user mandate.

#### 4.7.6. S5 cleanup additions (incoming arrows for the new tables)

The new detail tables introduce several new `ondelete` contracts.
Enumerate **every** incoming arrow and add explicit cleanup. This
is where Fix 6.5 came from — do not repeat that miss.

- `bv2_portals.target_location_id → bv2_locations.id` (SET NULL):
  in `delete_location`, add `sa_update(BV2Portal)` to nullify
  `target_location_id` where it matches the deleted location.
- `bv2_portals.requires_key_item_id → items.id` (SET NULL): in
  `delete_item` (wherever items are deleted), add the matching
  nullify. If the project has no item-delete endpoint yet, skip
  this one and document the gap in Phase 7 caveats.
- `bv2_npc_spawns.npc_template_id → npc_templates.id` (CASCADE):
  grep for the npc-template delete endpoint and confirm the whole
  `BV2Entity` (parent of `BV2NPCSpawn`) gets deleted too — not
  just the detail row. If only the detail row cascades, add
  explicit `sa_delete(BV2Entity)` where there's a matching
  npc_spawn detail.
- `bv2_chest_items.item_id → items.id` (CASCADE): same audit —
  deleting an item should remove the chest-item row (already
  CASCADE). Do not delete the chest entity itself.
- All five detail tables' `entity_id → bv2_entities.id` (CASCADE):
  confirmed by the schema; no extra work.
- All detail tables must be cleaned up in `delete_location` and
  `delete_map` cascades — add five more `sa_delete` statements to
  each, keyed on
  `entity_id.in_(select(BV2Entity.id).where(location_id == ...))`.

Run the Pre-phase S5a + S5b greps **twice**: once after adding the
new models, once after writing all the new delete endpoints.

#### 4.7.7. Bridge in §4.4 reads from typed tables now

`_entity_to_chest` / `_entity_to_trap` / `_entity_to_portal` in
§4.4 must JOIN the matching detail table, not parse `props_json`.
For chests, also join `bv2_chest_items` and `items` so the player
payload has `{ name, items: [{name, quantity, icon}, ...] }`.

For the player payload, surface only visible / non-hidden fields.
A trap with `is_triggered=False` and the parent
`BV2Entity.visible_to_players=False` must not appear in `_traps`
at all. A chest with `is_opened=False` must not list its items in
the public payload (items only appear after the player interacts
and the GM permits). Each of these gates needs a test assertion.

#### 4.7.8. Test plan for §4.7 (minimum coverage)

Add one smoke test per entity type verifying full round-trip:

- `test_bv2_chest_full_config_roundtrip` — create chest, lock it,
  add two items with quantities, GET, assert every field.
- `test_bv2_trap_full_config_roundtrip` — create trap with custom
  dice / type / three DCs, GET, assert every field. Include a
  negative-path assertion: invalid damage_dice `"banana"` → 422.
- `test_bv2_portal_full_config_roundtrip` — create portal pointing
  to a sibling location with a key item requirement, GET, assert.
- `test_bv2_portal_target_nullified_on_target_delete` — S5b
  regression (this is exactly the Fix 6.5 shape).
- `test_bv2_npc_spawn_full_config_roundtrip` — create spawn with
  template pick, trigger, count, GET, assert.
- `test_bv2_cover_zone_multi_cell_roundtrip` — create zone, add
  3 cells, remove 1, GET, assert 2 remain.

Plus one integration test exercising the bridge in §4.4:
`test_bv2_chest_with_items_appears_in_player_map_state` — create a
chest with items, activate the location, GET `/api/map/{code}`,
assert the chest appears in `_mapChests` with its name and items.

Total new tests from §4.7: **~7**. Combined with §3.5 (1) and §4.8
(2) the Phase 7 test delta is **~10**. Final count: 45 + 10 = **~55**.

### 4.8. Tests

Add to `tests/test_smoke.py`:

```python
@pytest.mark.asyncio
async def test_bv2_active_map_surfaces_on_legacy_map_endpoint(client, session_code):
    """Activating a bv2 map+location must make /api/map/{code} return
    bv2-sourced state instead of legacy MapFloor data."""
    # Create a bv2 map + location with one painted wall and one chest entity
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "BV2"})).json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 10, "rows": 10})).json()["id"]
    await client.patch(f"/api/builder-v2/locations/{loc_id}/tiles", json={
        "set": [{"col": 3, "row": 3, "tile_type": "wall",
                 "blocks_movement": True, "blocks_vision": True}],
        "erase": [],
    })
    await client.post(f"/api/builder-v2/locations/{loc_id}/entities", json={
        "entity_type": "chest", "col": 5, "row": 5, "name": "Goldie",
    })

    # Before activation: /api/map should NOT see bv2 data.
    state = (await client.get(f"/api/map/{session_code}")).json()
    assert state.get("bv2_active_location_id") is None

    # Activate map and location
    await client.post(f"/api/builder-v2/maps/{map_id}/activate", json={})
    await client.post(f"/api/builder-v2/locations/{loc_id}/activate", json={})

    # Now /api/map should be bv2-sourced
    state = (await client.get(f"/api/map/{session_code}")).json()
    assert state["has_map"] is True
    assert state["bv2_active_location_id"] == loc_id
    assert state["active_floor_tile_size"] == 50
    assert state["active_floor_grid_type"] == "square"
    assert "3,3" in state["active_floor_tiles"]
    assert state["active_floor_tiles"]["3,3"]["type"] == "wall"
    assert state["active_floor_tiles"]["3,3"]["blocks_vision"] is True
    assert any(c["name"] == "Goldie" for c in state.get("_mapChests", []))


@pytest.mark.asyncio
async def test_bv2_library_load_then_activate_surfaces(client, session_code):
    """Full user journey: build → save snapshot → load as new map →
    activate → players see it on /api/map. This is exactly the bug the
    user reported (#3)."""
    # Build a map with one wall
    map_id = (await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                                json={"name": "Original"})).json()["id"]
    loc_id = (await client.post(f"/api/builder-v2/maps/{map_id}/locations",
                                json={"cols": 6, "rows": 6})).json()["id"]
    await client.patch(f"/api/builder-v2/locations/{loc_id}/tiles", json={
        "set": [{"col": 0, "row": 0, "tile_type": "wall"}], "erase": [],
    })

    # Save → load → get the new map id
    snap_id = (await client.post("/api/builder-v2/library/save-from-map",
                                 json={"map_id": map_id, "name": "Snap"})).json()["id"]
    new_map_id = (await client.post(f"/api/builder-v2/library/{snap_id}/load-as-map",
                                    json={"session_code": session_code,
                                          "name": "Loaded"})).json()["map_id"]
    new_loc_id = (await client.get(
        f"/api/builder-v2/maps/{new_map_id}/locations")).json()[0]["id"]

    # Activate the LOADED map
    await client.post(f"/api/builder-v2/maps/{new_map_id}/activate", json={})
    await client.post(f"/api/builder-v2/locations/{new_loc_id}/activate", json={})

    # Players see it
    state = (await client.get(f"/api/map/{session_code}")).json()
    assert state["bv2_active_location_id"] == new_loc_id
    assert "0,0" in state["active_floor_tiles"]
```

Both tests must fail before §4.3 is implemented (TDD proof) and pass
after.

---

## 5. Step 4 — Player-side rendering of new bv2 features (DEFER)

**Out of scope for Phase 7.** These features are on the bv2 backend
already and visible in the builder, but no Phase 7 work is required
to render them on the player canvas:

- Lighting (`bv2_lights` + `ambient_light`) — player canvas has no
  lighting model. Phase 7 ships ambient + light data in the payload
  (see §4.3 final fields). Phase 8 wires the renderer.
- FOV / fog of war (`bv2_visit_state`) — payload exposes
  `bv2_active_location_id`; Phase 8 hooks the visit endpoint to
  player movement and overlays the canvas accordingly.
- Edges as visual indicators — already function as movement
  triggers via `POST /character-grid-move`. Visual hint on the
  player canvas is Phase 8.

Document these explicitly in the handoff caveats so the next AI
doesn't think they're broken.

---

## 6. Implementation order — strict, do not parallelise

Phase 7 is now substantially larger than the original draft
because §4.7 grew from "option B, deferred" to "full typed-table
rework". Order reflects that. Do not skip ahead.

**Group A — entity tables (the new §4.7 work; do FIRST):**

1. **A1.** Write all ~7 new smoke tests from §4.7.8 first. They
   will fail because the endpoints and tables don't exist yet.
   Commit them as-is. This is the TDD proof they catch the bug.
2. **A2.** Add the new models from §4.7.1 in `app/models.py`.
3. **A3.** Generate one alembic migration containing: all new
   tables **AND** `drop_column('bv2_entities', 'props_json')`. If
   the migration fails on existing dev data, `TRUNCATE
   bv2_entities` first (dev-only step, confirm with user again
   before running).
4. **A4.** Add typed CRUD endpoints (§4.7.3) per entity type with
   Pydantic models in `app/schemas.py`. Router files:
   `app/routers/builder_v2/{chests,traps,portals,npc_spawns,cover_zones}.py`.
   Register all five in the builder_v2 `__init__.py`.
5. **A5.** Update `ser_entity` in
   `app/routers/builder_v2/common.py` to join and flatten the
   matching detail row per type. Verify round-trip tests from A1
   now pass one-by-one as you implement each type.
6. **A6.** Add S5 cleanup (§4.7.6) in `delete_entity`,
   `delete_location`, `delete_map`, and any item/npc-template
   delete endpoints. Run the S5a + S5b greps. Fix any incoming
   arrows you missed.
7. **A7.** Rewrite the sidebar forms (§4.7.5) — five typed forms
   replacing the old generic one. No JSON anywhere.

**Group B — bridge (§4, mostly unchanged but now reads typed tables):**

8. **B1.** Write the two §4.8 bridge tests + the
   `test_bv2_chest_with_items_appears_in_player_map_state` integration
   test. Verify they fail with assertions like
   `state.get("bv2_active_location_id") is None`.
9. **B2.** Implement §4.3 + §4.4 in `app/routers/map/files.py`.
   `_entity_to_chest/trap/portal` now JOIN the new detail tables
   (not `props_json` — that column no longer exists).
10. **B3.** Implement §4.6 (WS rebroadcast). Verify manually in
    browser: paint a wall in builder while a player is on the Map
    tab; wall appears within ~100 ms.

**Group C — hex + drag (small, independent):**

11. **C1.** Write §3.5 hex test, confirm green (backend is already
    grid-type-agnostic).
12. **C2.** Apply §3.2 / §3.3 hex fixes in
    `static/js/builder_v2/20-mapview.js`. Manually verify: switch
    to hex → no overflow; click the visually-rightmost hex on each
    row → paints `col = cols-1`; switching back to square realigns.
13. **C3.** Implement §2.3 drag-resize (E / S / SE handles only).
    Manual browser test.

**Final:**

14. `.\dev.ps1 check` must report **~55** tests (45 + ~10), all
    green.
15. Run **all three** Pre-phase greps (S1 Python, S1 JS, S5a, S5b).
    Zero matches required on S1. Every incoming FK must have an
    explicit cleanup.
16. Update the test counter in `BUILDER_V2_HANDOFF.md` (currently
    45) and add a Phase 7 caveats section to §13.
17. Add a "Phase 7 — Fix List" section to `temp_fix.md` for any
    bugs found during implementation, same format as Phases 4-6.

---

## 7. Verification checklist

Mark each `[x]` only when independently verified — manually for the
UI items, automatically for the API items.

**Step 1 — Free-drag bounds (§2):**
- [ ] Hovering the right edge of the dashed yellow rectangle changes
      the cursor to `ew-resize`.
- [ ] Hovering the bottom edge → `ns-resize`.
- [ ] Hovering the bottom-right corner → `nwse-resize`.
- [ ] Dragging right grows `cols` by ~1 per `tile_size` pixels of
      drag (subject to scale).
- [ ] After releasing, sidebar `cols` input value updates and
      auto-save kicks in (~500 ms debounce).
- [ ] Cannot drag below `cols >= 5` / `rows >= 5`.

**Step 2 — Hex (§3):**
- [ ] `test_bv2_location_hex_grid_persists` is added and green.
- [ ] Switching grid_type to hex no longer leaks cells past the
      yellow boundary on any side.
- [ ] Clicking the visually-rightmost hex on each row paints
      `col=cols-1` (not `cols+something`).
- [ ] Switching back to square does not desync the boundary.

**Step 3 — Builder→Map bridge (§4):**
- [ ] `test_bv2_active_map_surfaces_on_legacy_map_endpoint` and
      `test_bv2_library_load_then_activate_surfaces` are added and
      green.
- [ ] Both tests **fail** with the documented assertion before §4.3
      is implemented (TDD proof, screenshot the failure).
- [ ] Manual: open a player browser tab on the Map view; in another
      tab open builder, paint a wall. Player tab updates within 1 s.
- [ ] Manual: save a map to library, delete the original, load
      snapshot → new map appears in builder list, activate it → player
      Map tab now shows the loaded location.
- [ ] `.\dev.ps1 check` reports **47** tests (or more) all green.
- [ ] Pre-phase grep S1 (Python + JS): zero matches.
- [ ] Pre-phase grep S5a + S5b: every `ondelete` and every incoming
      arrow has explicit cleanup.
- [ ] No `console.error` logs on a typical session walkthrough.

**Documentation:**
- [ ] `BUILDER_V2_HANDOFF.md` §13 has a new "Phase 7 caveats" block
      describing: (a) the bv2/legacy map data fork in
      `get_map_state`, (b) the offset-coord switch for hex, (c)
      deferred player-side rendering of light/FOV/edges.
- [ ] `BUILDER_V2_HANDOFF.md` test counter line bumped from 45 to
      whatever the final count is.
- [ ] `temp_fix.md` gets a new "Phase 7 — Bridge — Fix List" section
      detailing any bugs discovered during implementation, in the
      same format as Phases 4-6.

---

## 8. Out of scope — do **not** do these in Phase 7

- Player-side lighting render (Phase 8)
- Player-side FOV overlay from `bv2_visit_state` (Phase 8)
- Visual indicators of edges on the player canvas (Phase 8)
- Negative-direction (north / west) bound resize with content shift
  (Phase 8 — see §2.4 option B)
- Migrating existing axial-coord hex tiles (user confirmed not
  needed; accept the visual shift)
- Rewriting / replacing `static/js/map-canvas.js` — leave it alone.
  All bv2 integration happens server-side in `get_map_state`.

### In scope, previously thought deferred — moved IN by user mandate

- **Full typed-table rework of `bv2_entities`** (§4.7). No JSON
  config for any entity type. Chests, traps, portals, npc spawns,
  cover zones each get their own table, their own CRUD endpoints,
  their own typed sidebar form.
- **Item-picker UI in chest form** reading from the existing
  global `items` table. This is not Phase 8 loot interaction — it
  is GM-side configuration of what the chest *contains*.
- **Trap damage rolls** configured via typed fields (dice string +
  damage type enum). Actual runtime roll-on-trigger is still Phase 8.
- **Portal targeting** via typed FK to `bv2_locations` (nullable)
  plus col / row. Runtime teleport behaviour is Phase 8.
- **NPC spawn configuration** via typed FK to `npc_templates`.
  Runtime spawn trigger is Phase 8.

---

## 9. Lessons from Phases 1-6 the next AI must NOT relearn

These are condensed from `temp_fix.md` Standing rules. They will
bite again if ignored.

1. **S1.** Never use `or` / `||` for numeric defaults. Phase 6 did
   this and broke `ambient_light=0` snapshots. The Phase 7 §4.3
   payload contains `bv2_ambient_light` — write it correctly the
   first time using `is not None else …`.
2. **S2.** Every new payload field must be readable through the
   matching GET. The §4.3 payload introduces `bv2_active_location_id`,
   `bv2_ambient_light`, `bv2_is_indoor` — verify all three appear in
   the test's `state.json()` assertions.
3. **S5b.** The §4.3 work introduces a new "active map" lookup. If
   you ever add a delete flow that nullifies it, run the **incoming
   arrows** grep, not just the outgoing one. Fix 6.5 cost a whole
   extra round trip because incoming-arrows step was skipped.
4. **S6.** The `_build_state_from_bv2` function has a lot of
   branches (square vs hex, hidden vs visible entities, tokens on
   this location vs others). **Each branch needs a test assertion**
   — not just one happy-path test. Phase 6 Fix 6.2 covers exactly
   this anti-pattern.
5. **TDD.** Write §4.8 tests **before** §4.3, run them, see them
   fail with the documented reason, then implement. Same protocol
   as Fix 6.5. If the test passes immediately on first run with no
   implementation, your test is wrong, not the code.
6. **One step at a time.** §6 ordering is dependency-ordered. If
   you implement §4.6 (WS rebroadcast) before §4.3 (state build),
   the WS payload shape is wrong.

Good luck. — Cascade, 2026-04-26
