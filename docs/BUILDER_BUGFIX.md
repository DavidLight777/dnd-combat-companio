# Builder + Map bugfix sprint

**Assigned to:** Kimi
**Author:** Cascade
**Date:** 2026-04-28
**Estimated effort:** ~60 min total. Single PR, four commits.

> **STOP. READ FIRST: `docs/REAL_TESTING.md`.** Every bug below
> ships only when accompanied by a test that **failed before** your
> fix and **passes after**. Running pre-existing smoke tests is
> **not verification**. The previous round of these bugs was
> declared "done" with `pytest test_smoke.py -k bv2 → 42 passed`,
> none of which exercised any of the four fixes. Don't repeat that.

---

## 0. Context

User reports four concrete bugs in the Map Builder + Map view that
appear every time he uses the app. They've been there since hex
support landed in `builder_v2/20-mapview.js`. Diagnosed root causes
below — fixes are **mechanical and small**, no architecture change.

**Do this BEFORE the Stability Sprint** (`docs/STABILITY_SPRINT.md`).
These are the bugs the user feels every minute; everything else
can wait until they're gone.

---

## 1. Bug A — Hex grid: painted cells render in WRONG position

### Symptom

When a user switches a builder location to `grid_type='hex'` and
paints cells, the painted hexagons appear scattered in diagonal
streaks at displaced positions, not in the cell that was clicked.
Grid lines look fine; only the painted fills drift. The drift grows
with `row` index — top rows look right, bottom rows are way off.

### Root cause

`@c:\Users\Litun\Desktop\DND Project\dnd-companion\static\js\builder_v2\20-mapview.js`
mixes two incompatible hex coordinate systems:

| Function | Coord system | Result |
|---|---|---|
| `_tileCenterPx()` (lines 198–208) | **odd-r offset** | `(col + 0.5)*gs + xOff, (row + 0.5)*gs*sqrt3/2` where `xOff = (row & 1) ? gs/2 : 0` |
| `_screenToTile()` (lines 173–192) | **odd-r offset** (same) | matches `_tileCenterPx` |
| `_drawGrid()` for hex (lines 462–471) | **odd-r offset** (calls `_tileCenterPx`) | matches |
| `_drawTiles()` for hex (lines 247–248) | **AXIAL** | `gs * (c + r/2), gs * sqrt3/2 * r` — DIFFERENT MATH |
| `_drawFOV()` (299–300) | AXIAL | wrong |
| `_drawLighting()` (344–345) | AXIAL | wrong |
| `_drawEntities()` (371–372) | AXIAL | wrong |
| `_drawCharacters()` (408–409) | AXIAL | wrong |
| `_drawPendingZone()` (441–442) | AXIAL | wrong |

So clicks store the tile under odd-r offset coords. The grid line
for that cell is drawn at the right place. But the **fill** is
drawn at axial-system coords, which differ from odd-r by:
- `xOff_odd_r = (row & 1) ? gs/2 : 0` — flips every row
- `xOff_axial = gs * row / 2` — grows linearly with row

For `row=0` they happen to match. For `row=2` they're off by
`gs/2` to one direction. For `row=4`, off by `gs`. Etc.

That's exactly the "scattered streaks" the user sees.

The same bug also exists in `static/js/map-canvas.js` if you run a
hex map there — verify by grepping for the `c + r/2` pattern. If
it's there, fix it the same way (use odd-r offset everywhere).

### Fix

Replace all 6 axial-formula blocks in `20-mapview.js` with
`_tileCenterPx(c, r)` lookups. The center comes back in pixels;
adapt the call site to use centre instead of corner.

#### `_drawTiles` (lines 237–283)

```js
_drawTiles(ctx) {
  const gs = this._gridSize();
  const isHex = this._isHex();
  const sqrt3 = Math.sqrt(3);
  const hexSize = gs / sqrt3;

  for (const [key, tile] of this.tiles) {
    const [c, r] = key.split(',').map(Number);
    const type = typeof tile === 'string' ? tile : tile.tile_type;
    const visual = TILE_VISUAL[type] || TILE_VISUAL.floor;

    if (isHex) {
      const ctr = this._tileCenterPx(c, r);
      this._hexPath(ctx, ctr.x, ctr.y, hexSize - 1);
      ctx.fillStyle = visual.color;
      ctx.fill();
      if (visual.outline) {
        ctx.strokeStyle = visual.outline;
        ctx.lineWidth = 2 / this.scale;
        this._hexPath(ctx, ctr.x, ctr.y, hexSize - 1);
        ctx.stroke();
      }
      // glow + icon for hex too — copy the square branch's visual
      // logic adapted to centre coords if you want feature parity.
      // Square branch already has glow + icon; either factor out or
      // duplicate. Keep simple — duplicate is fine for now.
    } else {
      const cx = c * gs, cy = r * gs;
      ctx.fillStyle = visual.color;
      ctx.fillRect(cx + 0.5, cy + 0.5, gs - 1, gs - 1);
      if (visual.outline) {
        ctx.strokeStyle = visual.outline;
        ctx.lineWidth = 2 / this.scale;
        ctx.strokeRect(cx + 1, cy + 1, gs - 2, gs - 2);
      }
      if (visual.glow) {
        const grad = ctx.createRadialGradient(cx + gs/2, cy + gs/2, 0, cx + gs/2, cy + gs/2, gs);
        grad.addColorStop(0, visual.glow);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(cx, cy, gs, gs);
      }
      if (visual.icon) {
        ctx.font = `${gs * 0.55}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(visual.icon, cx + gs/2, cy + gs/2);
      }
    }
  }
}
```

#### `_drawFOV` (lines 286–314)

```js
_drawFOV(ctx) {
  if (!this.visibleSet || !this.exploredSet) return;
  const gs = this._gridSize();
  const cols = this._cols(), rows = this._rows();
  const isHex = this._isHex();
  const hexSize = gs / Math.sqrt(3);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const key = `${c},${r}`;
      if (this.visibleSet.has(key)) continue;
      ctx.fillStyle = this.exploredSet.has(key) ? 'rgba(0,0,0,0.55)' : '#000';
      if (isHex) {
        const ctr = this._tileCenterPx(c, r);
        this._hexPath(ctx, ctr.x, ctr.y, hexSize - 1);
        ctx.fill();
      } else {
        ctx.fillRect(c * gs, r * gs, gs, gs);
      }
    }
  }
}
```

#### `_drawLighting` (lines 316–359), `_drawEntities` (361–401), `_drawCharacters` (403–427), `_drawPendingZone` (429–453)

Same pattern. Anywhere you see this:

```js
const cx = isHex ? gs * (c + r / 2) : c * gs;
const cy = isHex ? gs * (Math.sqrt(3) / 2 * r) : r * gs;
```

…replace the **hex branch** with a call to `_tileCenterPx`. Be
careful: in those functions `cx, cy` is sometimes used as a CORNER
(then `+ gs/2` is added later for centre). For hex you want the
CENTRE directly. Adjust subsequent code that adds `gs/2`.

Concretely: `_drawCharacters` does `const centerX = cx + gs / 2`.
For hex, `_tileCenterPx` already returns the centre, so:

```js
let centerX, centerY;
if (isHex) {
  const ctr = this._tileCenterPx(ch.col, ch.row);
  centerX = ctr.x; centerY = ctr.y;
} else {
  centerX = ch.col * gs + gs / 2;
  centerY = ch.row * gs + gs / 2;
}
```

Then drop the existing `cx, cy` lines.

### Verify

- Open builder v2, switch to hex, paint a cell at (5, 5). The
  painted hex must overlap exactly with the grid hex it was
  clicked on.
- Repeat at (5, 0), (5, 10), (5, 20). All must align.
- Verify FOV-darkening, entity icons, character tokens, and the
  lighting darkness layer all align with the grid hex.
- Switch back to square. Nothing should regress.

### Tests

Add `tests/test_builder_hex_coords.py`:

```python
def test_paint_then_render_hex_aligns():
    # Mock canvas. Place a hex location, paint (5, 7), render,
    # assert the rendered hex centre equals _tileCenterPx(5, 7).
    ...
```

Or, simpler, a JS-only test: stub `ctx`, call `view.setTile(5, 7)`,
intercept `_hexPath` calls, assert (cx, cy) == odd-r centre.

### Commit

`BUILDER_BUGFIX 1: align hex render coords with click coords`

---

## 2. Bug B — Grid lines look ridiculously thick when zoomed out

### Symptom

On a large map auto-fitted to the screen, the grid is so dense that
the visible canvas looks like a solid grey/white texture instead
of a grid (Image 3 in user's report).

### Root cause

In `_drawGrid` (line 460):

```js
ctx.lineWidth = 1 / this.scale;
```

This is correct math: after `ctx.scale(scale)`, a world-unit line
width of `1/scale` renders as **exactly 1 screen pixel**. But when
the user zooms way out (`scale ≈ 0.05`), each cell is only ~3
screen pixels and the 1-pixel line eats most of that area.

### Fix — LOD-based grid suppression

In `_drawGrid`, early-return if cell-on-screen size is too small:

```js
_drawGrid(ctx) {
  const gs = this._gridSize();
  const cellPx = gs * this.scale;
  // If a cell renders smaller than 6px on screen, the grid is
  // visual noise, not information. Skip it. User can still zoom in.
  if (cellPx < 6) return;

  const cols = this._cols();
  const rows = this._rows();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1 / this.scale;
  // ... rest unchanged
}
```

Tweak the threshold (6px) to taste. Below 4px is definitely too
small. Above 12px probably feels too aggressive.

### Verify

- Open a 200x150 map in builder. Grid auto-disappears at fit-to-view.
- Zoom in (mouse wheel up). Grid reappears once each cell crosses
  the threshold.

### Commit

`BUILDER_BUGFIX 2: hide grid when cells render under 6px`

---

## 3. Bug C — Big maps lag while panning / zooming

### Symptom

On large maps (~150×100+), pan/zoom feels sluggish. Mouse wheel
zoom drops below 30 fps.

### Root cause

`_drawGrid` (hex branch), `_drawFOV`, `_drawLighting` all iterate
**every** cell of the map every frame:

```js
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    // ...
  }
}
```

For 200×150 = 30,000 cells per frame. For hex grid, each cell also
issues a 6-vertex `_hexPath` + `stroke` → 180,000 path operations
per frame. That's the lag.

### Fix — viewport culling

Compute the visible cell rect from camera transform, iterate only
those cells (+ 1 row/col padding for off-screen cells whose
geometry pokes into view):

```js
_visibleCellRect() {
  // World-space rect of the canvas
  const minX = -this.offsetX / this.scale;
  const minY = -this.offsetY / this.scale;
  const maxX = (this.canvas.width  - this.offsetX) / this.scale;
  const maxY = (this.canvas.height - this.offsetY) / this.scale;
  const gs = this._gridSize();
  if (this._isHex()) {
    const rowH = gs * Math.sqrt(3) / 2;
    return {
      cMin: Math.max(0, Math.floor(minX / gs) - 1),
      cMax: Math.min(this._cols() - 1, Math.ceil(maxX / gs) + 1),
      rMin: Math.max(0, Math.floor(minY / rowH) - 1),
      rMax: Math.min(this._rows() - 1, Math.ceil(maxY / rowH) + 1),
    };
  }
  return {
    cMin: Math.max(0, Math.floor(minX / gs) - 1),
    cMax: Math.min(this._cols() - 1, Math.ceil(maxX / gs) + 1),
    rMin: Math.max(0, Math.floor(minY / gs) - 1),
    rMax: Math.min(this._rows() - 1, Math.ceil(maxY / gs) + 1),
  };
}
```

Then in `_drawGrid` (hex), `_drawFOV`, `_drawLighting`:

```js
const rect = this._visibleCellRect();
for (let r = rect.rMin; r <= rect.rMax; r++) {
  for (let c = rect.cMin; c <= rect.cMax; c++) {
    // ...
  }
}
```

For square grid lines, change the line loop to:

```js
for (let c = rect.cMin; c <= rect.cMax + 1; c++) {
  ctx.beginPath();
  ctx.moveTo(c * gs, rect.rMin * gs);
  ctx.lineTo(c * gs, (rect.rMax + 1) * gs);
  ctx.stroke();
}
// rows similarly
```

### Verify

- Open a 200×150 map. Pan with mouse, watch the framerate (Chrome
  DevTools Performance tab or the Frames panel). Should stay
  ≥ 60 fps.
- Confirm no visual artifacts at the edge of the visible area —
  if you see a column of empty grid where there should be cells,
  bump the +1 padding to +2.

### Commit

`BUILDER_BUGFIX 3: viewport-cull grid + fog + lighting iteration`

---

## 4. Bug D — Map deletion takes multiple clicks

### Symptom

User clicks "Delete map" on a large map. UI freezes for ~5–10s.
User assumes the click didn't register and clicks again. Second
click hits a confirm dialog or a partially-deleted state. Deletion
"only works after several attempts."

### Root cause

In `@c:\Users\Litun\Desktop\DND Project\dnd-companion\static\js\builder_v2\30-editor.js:211–225`:

```js
async function deleteCurrentMap() {
  if (!S.currentMapId) return;
  const m = S.maps.find(x => x.id === S.currentMapId);
  if (!confirm(`Delete map "${m?.name || ''}" and all its locations?`)) return;
  try {
    await S.api.deleteMap(S.currentMapId);
    // ...
  }
}
```

No in-flight guard. No button-disable. No spinner. While the await
is pending the user can re-click the button and trigger a second
DELETE on the same id.

The slowness itself is partly justified: the map cascades to N
locations × M tiles × K entities. For huge maps this is real
backend work. We address both.

### Fix — UI guard

```js
async function deleteCurrentMap() {
  if (!S.currentMapId) return;
  if (S._deletingMap) return;          // re-entry guard
  const m = S.maps.find(x => x.id === S.currentMapId);
  if (!confirm(`Delete map "${m?.name || ''}" and all its locations?`)) return;

  S._deletingMap = true;
  const btn = document.getElementById('bv2-btn-delete-map');
  if (btn) {
    btn.disabled = true;
    btn._originalText = btn.textContent;
    btn.textContent = 'Deleting…';
  }
  try {
    await S.api.deleteMap(S.currentMapId);
    S.maps = S.maps.filter(x => x.id !== S.currentMapId);
    S.currentMapId = S.maps[0]?.id || null;
    S.currentLocId = null;
    renderMapSelect();
    if (S.currentMapId) await loadLocations();
    else {
      S.locations = [];
      renderLocSelect();
      updateEmptyMsg();
      S.view && S.view.loadLocation({ location: null, tiles: [] });
    }
  } catch (e) {
    console.error('bv2 deleteMap', e);
    alert('Failed to delete map: ' + (e.message || e));
  } finally {
    S._deletingMap = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn._originalText || 'Delete map';
    }
  }
}
```

Apply the same pattern to `deleteCurrentLocation` (line 249) — it
has the same race.

### Fix — backend bulk delete (optional speedup)

`@c:\Users\Litun\Desktop\DND Project\dnd-companion\app\routers\builder_v2\maps.py` (or wherever `delete_map` lives — grep
`@router.delete("/maps/{map_id}")`). If it currently does ORM
cascade, add an explicit bulk delete:

```python
from sqlalchemy import delete

@router.delete("/maps/{map_id}")
async def delete_map(map_id: int, db: AsyncSession = Depends(get_session)):
    m = await db.get(BV2Map, map_id)
    if not m:
        raise HTTPException(404, "Map not found")
    # Collect locations
    locs_q = await db.execute(select(BV2Location.id).where(BV2Location.map_id == map_id))
    loc_ids = [r[0] for r in locs_q.all()]
    if loc_ids:
        # Bulk delete child rows; ORM cascade is per-row and slow.
        await db.execute(delete(BV2Tile).where(BV2Tile.location_id.in_(loc_ids)))
        await db.execute(delete(BV2Entity).where(BV2Entity.location_id.in_(loc_ids)))
        await db.execute(delete(BV2Light).where(BV2Light.location_id.in_(loc_ids)))
        await db.execute(delete(BV2Edge).where(BV2Edge.location_id.in_(loc_ids)))
        # Add other child tables: BV2InteriorZone, BV2InteriorCell, BV2VisitState, BV2Chest, BV2Trap, BV2ChestItem
        await db.execute(delete(BV2Location).where(BV2Location.id.in_(loc_ids)))
    await db.delete(m)
    await db.commit()
    return {"ok": True}
```

Be **exhaustive** with the child tables — a missed table = orphan
rows that break later. Cross-check with `app/models.py` for every
model that has `location_id` or `map_id` FK.

### Verify

- Click delete on a small map → finishes in <1s, button never sticks.
- Click delete on a large map (200×150, fully painted) → finishes
  in <3s now (was 5–10s). Button stays disabled the whole time.
- Try to spam-click during deletion → only the first click does
  anything.

### Commit

`BUILDER_BUGFIX 4: guard delete buttons + bulk SQL cascade`

---

## 5. Anti-fail rules

1. **One bug = one commit.** Four commits, four diffs, four
   reviewable changes.
2. **Verify the hex coord fix on a real seed.** The user's
   `seed_phase10_demo.py` already creates a map with a few
   locations; switch one to `grid_type='hex'` and paint cells.
   Eyeball alignment before committing.
3. **Cache-bust.** Bump the `?v=` on `builder_v2/20-mapview.js`
   and `builder_v2/30-editor.js` in `static/gm.html`. Otherwise the
   user's browser will keep serving old broken code and you'll
   look like the bug isn't fixed.
4. **No scope creep.** The user explicitly asked for these four
   bugs. Do not also "fix" anything else you notice. File new
   bugs in a follow-up note, don't sneak them in.

---

## 6. Done criteria

- All four commits land on the branch.
- `pytest tests/ -q` green (count ≥ 99, ideally with new
  `test_builder_hex_coords.py` adding +1).
- Manual smoke-test on the user's seed:
  - GM tab → Builder v2 → switch to hex → paint cells → no streaks.
  - Same map → square mode → grid stays sharp at any zoom.
  - 200×150 map → pan smoothly at 60 fps.
  - Delete that 200×150 map → finishes once, button sticks during.
- Cache-bust bumped.
- Screenshot of clean hex-mode painting in chat.
