# Map Builder v2 — Handoff Document

> **Purpose.** This document hands off work on Map Builder v2 to the next
> AI. Phase 1 is fully complete; Phases 2–6 remain. The document contains
> **everything** you need: architecture, conventions, guidelines,
> per-phase step-by-step specs, testing patterns, common pitfalls.
>
> **Work carefully. Verify every step. Run tests after every change.**
> If something is unclear — **read the existing code** (Phase 1 is the
> best reference) rather than guessing.
>
> **Before starting your phase, open `docs/temp_fix.md` and apply
> every unmarked fix from the previous phase.** That file is the
> rolling fix log between phases. Skipping it means inheriting known
> bugs and silently regressing the project.

---

## 0. TL;DR — Rules You MUST Follow

1. **After any change**, run `.\dev.ps1 check` (ruff + pytest). Never
   declare a phase complete while tests are red.
2. **Never** delete legacy `app/routers/map_builder/` or
   `static/js/gm/18-map-builder.js` until Phase 6. We build **in parallel**.
3. **For every data mutation**, emit a WebSocket broadcast wrapped in
   try/except (see `app/routers/builder_v2/common.py:broadcast`).
4. **SQLite does NOT honor `ondelete=CASCADE`** without PRAGMA. Use
   explicit `db.execute(sa_delete(Child).where(Child.parent_id == ...))`
   like `maps.py:delete_map` and `locations.py:delete_location` already do.
5. **Every new endpoint needs a smoke test** in `tests/test_smoke.py`
   (pattern: `test_bv2_*`).
6. **Every Alembic migration** must be reversible (`downgrade()`).
7. **bv2 UI modules live only under `static/js/builder_v2/`**. Do not
   touch `static/js/gm/*` except `gm/01-core.js` (add new tab names to
   the flex-display list there if you add a new tab).
8. **No `prompt()`/`alert()` for new dialogs in Phase 2+** — use proper
   HTML modals. Phase 1 kept `prompt()` for speed; Phase 6 will replace
   those too.
9. **All code and comments in English.** Existing code mixes English
   with a few Russian comments; follow **English** style in new code.
10. **Never change the ID of an applied Alembic migration.** If you
    need to modify an already-applied migration, create a new `revision`
    instead — do not edit the old one.
11. **If you add a column to a model, you MUST also expose it through
    every serializer the frontend reads.** Grep for neighbouring fields
    (e.g. `vision_radius` or `base_speed_cells`) — the new field almost
    always belongs next to them. A column that exists only in the DB is
    dead weight: frontend consumers can't see it, and the next phase
    will ship blind. **Lesson from Phase 3:** `sight_range_cells` was
    added to `Character` and to the migration but not to
    `app/routers/map/files.py` token serializer nor to
    `app/routers/sessions.py:list_session_characters`, so the FOV layer
    had no way to read the per-character sight range. Always add a
    regression test that hits every endpoint that must include the
    field (see `test_bv2_sight_range_cells_exposed` for the pattern).
12. **Never duplicate server-side rule tables on the client.** The
    backend `TILE_DEFAULTS` in `app/routers/builder_v2/common.py` is the
    single source of truth for `blocks_movement` / `blocks_vision`.
    `ser_tile()` already emits those flags on every tile, so the client
    must read them off the tile object — **do not** hardcode a second
    copy of the rule (e.g. `type === 'wall' || type === 'pit'`). The
    only place a mirror is tolerable is `20-mapview.js:TILE_BLOCKS`,
    because `setTile()` needs defaults for the stub it creates before
    the server round-trips, and that mirror carries an explicit
    "keep in sync" comment. If you ever need to duplicate a server
    table on the client, follow that pattern and document the contract.
13. **Add a smoke test for every business rule the moment you add it.**
    Examples: "hidden entities don't auto-reveal for non-GM", "tiles
    outside bounds are silently skipped", "PATCH on nonexistent entity
    returns 404". If the rule is in the router, the test lives in
    `tests/test_smoke.py`. No exceptions — core rules without a test
    get silently regressed. **Lesson from Phase 3:** the
    `visible_to_players=False` filtering was implemented correctly but
    had no regression test; that gap is now covered by
    `test_bv2_visit_respects_visible_to_players`.

---

## 1. Project Architecture (what matters)

### 1.1. Stack
- **Backend:** FastAPI + SQLAlchemy async + Alembic + SQLite (aiosqlite).
- **Frontend:** vanilla JS (NO frameworks), Canvas 2D, flat `window.*`
  globals.
- **WS:** `ws://…/ws/{session_code}?token=…`, roles `gm` / `player`.
- **Tests:** `pytest-asyncio` + `httpx.AsyncClient` + ASGI transport.

### 1.2. Layout
```
app/
  models.py                       # All SQLAlchemy models. bv2_* are at the end.
  database.py                     # Engine, get_session(), init_db() (+ legacy ALTERs).
  websocket_manager.py            # ConnectionManager.broadcast_to_session / send_to_gm.
  routers/
    builder_v2/                   # NEW builder. Everything touching bv2_* tables.
      __init__.py                 # Exports `router`, imports subroutes.
      common.py                   # router(prefix=/api/builder-v2), helpers, serializers,
                                  #   TILE_DEFAULTS (blocks_movement/vision registry),
                                  #   broadcast(), get_session_or_404().
      maps.py                     # Map CRUD + activate + cascade-delete.
      locations.py                # Location CRUD + activate + cascade-delete.
      tiles.py                    # PUT (replace-all) + PATCH (delta set/erase).
      entities.py   (Phase 2)     # Entity CRUD: chests/traps/portals/spawns/cover.
      fov.py        (Phase 3)     # FOV visit endpoint (server-side state).
      lights.py     (Phase 4)     # Light CRUD + character-carried light attach.
      edges.py      (Phase 5)     # Edge transitions (cross-location movement).
      library.py    (Phase 6)     # Snapshot save/load.
    map_builder/                  # LEGACY. DO NOT TOUCH.
alembic/versions/                 # Migrations. Last before bv2: 75be5262173a.
                                  # bv2 migration id: 4b807ffb72fe.
main.py                           # app.include_router(builder_v2_router)  ← already wired
static/
  gm.html                         # <button data-tab="builder-v2"> and
                                  # <div id="tab-builder-v2">. bv2 scripts are loaded
                                  # at end of <body> after legacy gm/*.
  css/gm.css                      # .bv2-brush styles (copied from .builder-brush).
  js/
    builder_v2/
      00-state.js                 # window.bv2 = { maps, locations, view, brush, ... }
      10-api.js                   # window.bv2.api: CRUD wrappers (api.get/post/put/patch/del).
      20-mapview.js               # class MapView — render + pan/zoom/paint.
                                  # 3 mode placeholders: 'edit' / 'gm-runtime' / 'player'.
      30-editor.js                # Controller: selectors, buttons, auto-save,
                                  # debounced flushSave(), HOTKEY_MAP.
      40-websocket.js             # ws.on('bv2.*', ...) handlers.
      50-entities.js  (Phase 2)   # Entity sidebar + placement + modal editors.
      60-fov.js       (Phase 3)   # Client-side FOV overlay.
      70-lights.js    (Phase 4)   # Light editor + runtime light rendering.
      80-edges.js     (Phase 5)   # Edge painter + transition preview.
      90-library.js   (Phase 6)   # Library modal + snapshot import/export.
    gm/                           # LEGACY GM panel. DO NOT TOUCH except 01-core.js.
    websocket-client.js           # Global `ws` singleton with ws.on(event, fn).
tests/test_smoke.py               # All smoke tests. bv2 block is at the end.
docs/BUILDER_V2_HANDOFF.md        # This file.
progress.txt                      # May or may not exist; use it as a scratch-pad
                                  # for multi-session work.
```

### 1.3. bv2_* tables (already created by migration `4b807ffb72fe`)

| Table | Purpose | Phase |
|---|---|---|
| `bv2_maps` | Story Map — container for Locations | 1 ✅ |
| `bv2_locations` | One playable area (room/area/floor) | 1 ✅ |
| `bv2_tiles` | One tile per cell, `(location_id, col, row)` unique | 1 ✅ |
| `bv2_entities` | chest / trap / portal / light_marker / npc_spawn / cover_zone / edge_marker — all via `entity_type` + `props_json` | 2 |
| `bv2_lights` | Light sources (static or carried by character) | 4 |
| `bv2_edges` | Edge transition (side, range, target_location_id + entry) | 5 |
| `bv2_visit_state` | Per-character FOW + discovered entity IDs | 3 |
| `bv2_library` | Snapshot Map + locations + entities | 6 |

### 1.4. Key abstractions

**Tile registry (`common.py:TILE_DEFAULTS`).** Single source of truth for
`blocks_movement` / `blocks_vision`. When adding a new tile type, also
add its defaults to this dict. Frontend visuals live in
`static/js/builder_v2/20-mapview.js:TILE_VISUAL`.

**Unified MapView.** One class renders the same scene in 3 modes:
- `edit` — builder (implemented in Phase 1).
- `gm-runtime` — GM watching live play (tiles + entities + NPC tokens).
- `player` — same as `gm-runtime`, but with FOV overlay and filtered
  out-of-sight entities.

**Event protocol.** All bv2 events are named `bv2.<resource>_<action>`
(`bv2.map_added`, `bv2.tiles_patched`, `bv2.entity_added`, …). Payload is
minimal: usually `{location_id, ...ids}`, and the client does a GET to
refresh. Do not try to cram full objects into WS events — it is harder
to maintain and more prone to desync.

**Auto-save.** In `30-editor.js:queueSave` → buffers into
`S.pendingSet/pendingErase` → debounced 500ms → `PATCH /tiles` with
`set[] + erase[]`. `S.suppressNextWs=true` for ~250ms so the user's own
echo does not re-render. **Reuse this pattern** in Phase 2+ for entities.

---

## 2. Work discipline (how I work — follow this)

### 2.1. Task workflow

1. **Understand.** Read the code around the task. Do not invent — look
   at how Phase 1 and neighboring legacy routers do it. Use
   `code_search` / `grep_search` / `read_file`.
2. **Plan.** Update `todo_list` — break the task into 4–8 steps.
3. **Execute one step at a time.** Mark `in_progress` → `completed`.
4. **After each file**, re-read it and mentally verify correctness.
5. **After each logical chunk** (endpoint + test + ws handler), run
   `.\dev.ps1 check`.
6. **At the end of a phase**, full test run, **restart the server**,
   and verify manually in the browser (MCP browser preview).

### 2.2. When I run tests

- After adding an endpoint → add a smoke test → run `pytest -q`.
- After any model or migration change → `alembic upgrade head` + verify
  via Python script (see §9.1).
- Before declaring a phase complete → `.\dev.ps1 check` must be green.

### 2.3. How I do Alembic

1. Add models to `app/models.py` (at the end, inside the `# MAP BUILDER V2`
   block).
2. `python -m alembic revision --autogenerate -m "description"`.
3. **Read the generated file by hand** — verify `upgrade()` does exactly
   what you expect, and `downgrade()` is the inverse.
4. `python -m alembic upgrade head`.
5. Verify via a throwaway script:
   ```python
   # _verify.py (do not commit)
   import sqlite3
   c = sqlite3.connect('data/combat_companion.db')
   cur = c.cursor()
   cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'bv2_%'")
   print([r[0] for r in cur.fetchall()])
   cur.execute('SELECT version_num FROM alembic_version')
   print('head:', cur.fetchone())
   ```
6. Delete `_verify.py`.

**Heads up:** PowerShell may return exit-code 1 on alembic runs because
INFO logs go to stderr. If stdout shows `Running upgrade ... -> ...,
<description>`, that is **success**. Always verify with a script.

### 2.4. How I write tests

Pattern: see `tests/test_smoke.py::test_bv2_full_edit_flow`. Rules:

- Use the existing fixtures `client` and `session_code`.
- One test = one logical scenario (create → read → update → delete).
- Assert **both** response shape **and** side effects (re-GET to verify).
- Out-of-bounds / invalid inputs → 200 with `set: 0` (silent skip) OR
  400 with a clear message; never allow a 500.
- 404 on missing IDs.
- Each test must run fast (<1s). If slow — optimize.

### 2.5. How I touch the frontend

- **Read the browser console** after every change. Try getting logs via
  `browser_preview`; if not possible, ask the user.
- **Do not over-engineer.** If adding a method to `MapView` is enough,
  do that instead of creating another class.
- **Hotkeys** work only while the builder-v2 tab is active (check
  `tab.classList.contains('active')`), so other screens are not broken.
- **Modals** — reuse existing containers in `gm.html` (search for
  `<div id="modal-*">`) or create a new one matching the same styling.

### 2.6. How I do WebSocket events

**Backend** (in the router):
```python
# Commit first, then broadcast. If broadcast fails, data is still in DB.
await db.commit()
await broadcast(sess_code, "bv2.entity_added", ser_entity(entity))
```

**Frontend** (in `40-websocket.js`):
```js
ws.on('bv2.entity_added', d => {
  if (S.currentLocId !== d.location_id) return;  // not our location
  if (S.suppressNextWs) return;                  // echo of our own action
  // Either merge into local state, or re-fetch.
  S.loadLocation(d.location_id);
});
```

---

## 3. Phase 2 — Entities

> **Goal.** On the Builder tab the GM can place chest / trap / portal /
> npc_spawn / cover_zone / light_marker entities. Each type has its own
> fields in `props_json`. In the runtime view (Map tab) they render on
> top of tiles and are clickable for the GM.

### 3.1. Backend

Create `app/routers/builder_v2/entities.py`. Register via import in
`__init__.py` (append to `from app.routers.builder_v2 import maps,
locations, tiles, entities`).

**Endpoints:**

| Method | Path | Purpose |
|---|---|---|
| GET | `/locations/{id}/entities` | List all entities in the location |
| POST | `/locations/{id}/entities` | Create an entity |
| PATCH | `/entities/{id}` | Update field(s) |
| DELETE | `/entities/{id}` | Delete |
| POST | `/entities/{id}/move` | Shortcut: `{col, row}` |

**Supported `entity_type` values:**

| Type | `props_json` shape | Notes |
|---|---|---|
| `chest` | `{loot_item_ids: [int], locked: bool, dc_unlock: int, is_opened: bool}` | Integrate with the existing `chests` API in Phase 2.5 |
| `trap` | `{trap_type, trigger, dc_detect, dc_disarm, damage_dice, damage_type, is_triggered, is_disarmed}` | |
| `portal` | `{target_location_id: int, target_col: int, target_row: int, one_way: bool}` | **Distinct from edges** — point teleport |
| `npc_spawn` | `{template_id: int, auto_spawn_on_activate: bool}` | Template from `npc_library` |
| `cover_zone` | `{cover_level: 'half'\|'three-quarters'\|'full', shape_cells: [[col,row], ...]}` | For combat bonuses — Phase 7+ |
| `light_marker` | `{}` (the real object lives in `bv2_lights`; this entity is just a visual marker in builder) | Consider dropping this type — see Phase 4 |

**Validate `entity_type`:** define `VALID_ENTITY_TYPES` as a set in
`common.py`, reject unknown values with HTTP 400.

**Broadcast events:**
- `bv2.entity_added` / `bv2.entity_updated` / `bv2.entity_deleted`  
  payload: `{location_id, entity_id, entity_type}` plus the serialized
  object for add/update.

**Cascade.** Entities are deleted alongside their location (already wired
in `locations.py:delete_location`).

### 3.2. Frontend

File: `static/js/builder_v2/50-entities.js`.

**UI:**
- Add another sidebar section — **Entities**, below Terrain.
- Entity brush buttons: `🗃 Chest`, `⚠ Trap`, `🌀 Portal`,
  `⊛ NPC Spawn`, `⛑ Cover`.
- When an entity brush is active, clicking a cell does **not** paint a
  tile — it opens a minimal modal: `Name`, type-specific fields, Save.
- A separate sidebar section — **Placed entities** (scrollable list
  with icon, name, ✎ Edit / 🗑 Delete buttons).
- Hotkeys: `8/9/0` for entity brushes (if useful). Erase mode for
  entities: shift-click on the entity → delete.

**MapView:**
- Add a method `drawEntities(ctx)` — called after `_drawTiles` and
  before `_drawGrid`.
- Draw: a colored circle (radius = `gridSize * 0.35`) + emoji in the
  center.
- Hover: highlight (store in `_hoveredEntity`).
- Click with an active non-entity brush → ignore the entity.

**Modals.** One generic `bv2-entity-modal` with a dynamic body driven
by `entity_type`. Don't spawn one modal per type. Use the dialog
pattern from `gm/02-characters.js` as a reference.

### 3.3. Tests (add to `tests/test_smoke.py`)

- `test_bv2_entity_crud` — create a chest, read, patch, delete.
- `test_bv2_entity_types_validated` — unknown type → 400.
- `test_bv2_entity_cascade_on_location_delete` — deleting a location
  removes its entities.
- `test_bv2_entity_move` — POST /move updates col/row.

### 3.4. Phase 2 acceptance criteria

- [ ] Can place 5 different entity types on a location.
- [ ] After page reload the entities persist.
- [ ] Second GM sees entities in real time via WS.
- [ ] Deleting a location removes its entities (smoke test).
- [ ] `.\dev.ps1 check` is green.
- [ ] Runtime view (Map tab) is **not required** to render entities in
      Phase 2 — may defer to Phase 3, but preferable if doable.

---

## 4. Phase 3 — FOV (Field of View) + Fog of War

> **Goal.** Each player sees only the part of the map their characters
> physically see. Everything else is either black (never explored) or
> dimmed (explored before but not currently visible).

### 4.1. Concept

Each cell has **3 states** per character:
1. **Unexplored.** Never seen → black.
2. **Explored but not currently visible.** Seen before → show static
   elements (tiles, walls, doors) at 50% dim, but **hide** NPCs,
   entities, trap triggers, live lights.
3. **Currently visible.** Character can see it right now → full bright
   render, entities visible.

**Compute FOV on the client** (simpler: no server load, instant response
to movement). Algorithm — **recursive shadowcasting**. Origin is the
position of **any of the player's own characters** in the location.
Max distance is `character.sight_range_cells` (add this field to the
`Character` model in Phase 3, default `8` indoor, `20` outdoor).

**Vision blockers:** `tile.blocks_vision == True` (walls, closed doors).
Door state (`open`/`closed`) lives in `entity.props.is_open` for
type=`door`, **or simpler** — in Phase 3 just treat any `tile.tile_type
== 'door'` as vision-transparent. Proper door handling lands in Phase 5
alongside edges.

### 4.2. Backend

Minimum backend work:
- Add `sight_range_cells: int` (default 8) to `Character` via Alembic
  (`add_column`).
- Endpoint **`POST /locations/{id}/visit`** — body: `{character_id,
  visible_cells: [[col,row], ...]}`.  
  Server:
  1. Finds/creates `BV2VisitState(character_id, location_id)`.
  2. Merges `explored_tiles_json` with the incoming cells.
  3. Returns merged `explored_tiles` + `discovered_entity_ids`.
  4. Broadcasts `bv2.visit_updated` with `{character_id,
     location_id}` — other clients can react (e.g., minimap).

**Auto-discovery of entities.** On `visit`, collect all entities whose
`(col,row)` falls inside `visible_cells`; merge their IDs into
`discovered_entity_ids_json`. If `entity.visible_to_players == False`
and the character is not a GM, **skip** it.

### 4.3. Frontend

File: `static/js/builder_v2/60-fov.js`.

**Class `FOVCalculator`:**
```js
class FOVCalculator {
  constructor(location, tiles) { this.loc = location; this.tiles = tiles; }
  compute(originCol, originRow, range) { ... returns Set<"col,row"> ... }
}
```

Use classic shadowcasting. Reference:
http://www.roguebasin.com/index.php/Shadow_casting (implement square
grid first; hex can wait).

**MapView mode='player' / 'gm-runtime':**
- Add `setFOV(visibleSet, exploredSet)`.
- In `render()`, add a third pass after tiles and before entities:
  for each cell outside `visibleSet`:
  - if in `exploredSet` → overlay `rgba(0,0,0,0.55)`.
  - otherwise → fill solid `#000`.
- Entities are skipped in the draw loop if their `(col,row)` is outside
  `visibleSet`, unless the entity is "permanently visible" (e.g. an
  opened chest where `props.is_opened==True` stays in explored).

**In the Map tab (runtime):** when a character moves (WS event
`character_moved`), recompute FOV from the new position and send
`POST /visit`.

### 4.4. Tests

- `test_bv2_visit_persists` — POST /visit → GET /locations/{id}/visit?character_id= → explored is present.
- `test_bv2_visit_merges_not_replaces` — two sequential POSTs with
  different cells → explored = union.
- `test_bv2_visit_discovers_entities_in_visible_cells` — an entity in a
  visible cell appears in `discovered_entity_ids`.

### 4.5. Acceptance criteria

- [ ] Player client sees only FOV of its character.
- [ ] Leaving a room leaves it in explored but dimmed.
- [ ] GM sees everything (GM mode = full visibility).
- [ ] FOV is blocked by walls correctly.
- [ ] Performance: a 40×30 location renders in <16ms (60fps).

---

## 5. Phase 4 — Lighting

> **Goal.** Locations have `ambient_light` (0..1). If `is_indoor=True`
> and ambient is low — it's dark. Light sources (torches, lamps,
> magical light) create bright circles. In dark areas a character may
> not see even cells that are within their FOV.

### 5.1. Concept

**Illumination per cell** = max(`ambient`, sum of all lights within
radius with 1/r falloff).

Visually:
- `illum >= 0.7` → full render, no darkness overlay.
- `0.2 <= illum < 0.7` → subtle overlay `rgba(0,0,0, 0.3 * (0.7-illum))`.
- `illum < 0.2` → nearly black.

A character **sees FOV only** where `illum >= 0.1` (otherwise, even if
the cell is in line of sight, it is too dark). Exception — darkvision
(race trait `darkvision_cells`) — FOV works there even at illum=0.

### 5.2. Backend

**Endpoints in `lights.py`:**
- `GET /locations/{id}/lights`
- `POST /locations/{id}/lights` — placed light (col, row, radius,
  color, intensity, kind).
- `PATCH /lights/{id}`
- `DELETE /lights/{id}`
- `POST /characters/{id}/lights` — attach carried light (torch etc);
  `location_id` comes from the character's current location.
- `DELETE /characters/{id}/lights/{light_id}`.

**Events:** `bv2.light_added/updated/deleted`. When a character with an
attached light moves, auto re-broadcast `bv2.light_updated`.

**Cascade:** already handled for location; for character — add a
similar chain in the character delete path (but only if you're certain
it is safe — see §0.2).

### 5.3. Frontend

File: `static/js/builder_v2/70-lights.js`.

In the builder: sidebar section **Lights** → buttons `🔥 Place torch`,
`💡 Place lamp`, `✨ Magic light` (different radius/color presets).

In MapView: method `drawLighting(ctx)` after entities. For each cell
compute illum (formula above) and overlay. Cache the grid in
`this._illumCache` (invalidate when lights/ambient change).

In player mode: `setFOV` now accepts `fovSet` **and** `lightMap` (Map
`"col,row"` → illum). Cells with illum<0.1 not covered by
`character.darkvision_cells` → render as temporarily unseen.

### 5.4. Tests

- `test_bv2_light_crud`
- `test_bv2_light_affects_visibility` (unit-ish — a cell far from any
  source should have illum≈ambient; adjacent to source — illum≈1).
- `test_bv2_character_carried_light_moves` (optional, Phase 4 polish).

### 5.5. Acceptance criteria

- [ ] A dark indoor location (ambient=0.1) — player sees only what their
      torch illuminates.
- [ ] Multiple lights stack (sum with cap at 1.0, not max).
- [ ] Lamps of different colors blend naturally.
- [ ] Darkvision works (monster/elf sees FOV in the dark).

---

## 6. Phase 5 — Edge Transitions

> **Goal.** When a character reaches the edge of a location they
> automatically move to the connected location. Open-world mechanic:
> multiple locations are joined via directions (north ↔ south, etc.)
> rather than via point portals.

### 6.1. Concept

`BV2Edge` — a slice of one side of a location (`side` +
`range_start..range_end`). On character movement: if
`character.moved_to` lands on a cell where `(col==cols-1 and
side='east')` etc., and a matching edge exists, the server moves the
character to `target_location_id` at `target_entry_col/row`.

### 6.2. Backend

**`edges.py`:**
- `GET /locations/{id}/edges`
- `POST /locations/{id}/edges` — body: `{side, range_start, range_end,
  target_location_id, target_entry_col, target_entry_row}`
- `PATCH /edges/{id}` / `DELETE /edges/{id}`

**Integration with movement.** Legacy
`app/routers/map.py:move_character` is where this has to plug in. The
algorithm:

```python
# after updating col/row, before commit
edge = await _find_matching_edge(db, character.current_location_id,
                                 new_col, new_row)
if edge and edge.target_location_id:
    character.current_location_id = edge.target_location_id
    character.col = edge.target_entry_col
    character.row = edge.target_entry_row
    await broadcast(session_code, "bv2.character_edge_transitioned", {
        "character_id": character.id,
        "from_location_id": old_loc_id,
        "to_location_id": edge.target_location_id,
    })
```

**IMPORTANT:** this is the **only** place we **modify legacy code** as
part of bv2. Do it carefully: run the existing movement tests and make
sure nothing breaks.

### 6.3. Frontend

File: `static/js/builder_v2/80-edges.js`.

In the builder: a dedicated tool mode "Edge paint" — click on an edge
→ a segment is drawn in pixels with handles (drag → change the range).
On release, a modal opens: "Connect to → [location select] → entry
(col, row)".

In the runtime Map tab: when a character crosses an edge, fade-out →
swap location → fade-in. Use the existing WS event
`bv2.location_activated` for the player (note: this varies by person —
the server must `send_to_token` for the specific character, not
broadcast).

### 6.4. Tests

- `test_bv2_edge_crud`
- `test_bv2_edge_transition_on_move` — create two locations + edge,
  trigger a move manually, assert the character switched location.

### 6.5. Acceptance criteria

- [ ] In builder you can draw an edge and link to another location.
- [ ] A character crossing an edge switches location in runtime.
- [ ] A player sees only their own location (not where other characters
      are).
- [ ] GM sees **all** characters across all locations (switchable via
      loc-select in Map tab — new UX, may defer to Phase 6).

---

## 7. Phase 6 — Library + Polish + Legacy Removal

> **Goal.** Close all remaining loose ends. Persist locations to a
> library for reuse. Remove legacy. Polish UX.

### 7.1. Library

**Snapshot** = JSON with everything in a Map: all locations + all
tiles + all entities + all lights + all edges. **No** visit_state, **no**
`is_active` flags.

**Endpoints (`library.py`):**
- `GET /library` — list of snapshots (global + current session).
- `POST /library/save-from-map` — `{map_id, name, description}` →
  snapshot.
- `POST /library/{id}/load-as-map` — `{session_code, name}` → creates a
  new Map with all contents.
- `DELETE /library/{id}`.

**UI:** a modal with a grid of previews (thumbnail — easiest way:
canvas-toDataURL snapshot of the first location, or keep an emoji
placeholder if that's too much work).

### 7.2. Legacy Removal

**Order:**
1. Confirm Phases 2–5 fully work.
2. **Data migration?** No, we do not port data from legacy. Existing
   sessions keep using the old builder until the GM creates a new
   bv2 map.
3. Remove `map_builder` imports from `main.py`.
4. Remove `app/routers/map_builder/`.
5. Remove `static/js/gm/18-map-builder.js`.
6. Remove the legacy tab `<button data-tab="builder">...(legacy)</button>`
   and `<div id="tab-builder">...</div>` in gm.html.
7. Rename bv2 tab from "Builder" back to "Builder" (it already says
   that — just verify).
8. Migration to drop legacy tables (`map_templates`, `map_floors`,
   `map_traps`, `map_chests`, etc.) — **carefully**. Provide a
   `downgrade` path that recreates them empty so rollback works. Or
   leave the tables in place and mark them as deprecated in docs.
9. Run ALL tests. Legacy-endpoint tests — delete or rewrite to use bv2.

### 7.3. Polish

- Replace `prompt()`/`alert()` in `30-editor.js` with HTML modals.
- Keyboard: Ctrl+Z undo (snapshot into `S.undoStack`, cap 50 items).
- Copy/Paste tile region (drag-select → copy → paste).
- Mini-map in the canvas corner.
- Background image upload (store in `/data/maps/`, save path in
  `location.background_image_url`).
- Export a single location to library without its parent map.

### 7.4. Phase 6 acceptance criteria

- [ ] Legacy fully removed (grep `map_builder` and `18-map-builder` —
      only hits in git history).
- [ ] Library save/load works — snapshot one session, load in another,
      layout is restored.
- [ ] Undo/redo works.
- [ ] All prompt/alert calls replaced.
- [ ] `.\dev.ps1 check` is green.
- [ ] Manual test: full playthrough — create a Map, 3 Locations joined
      by edges, place entities + lights + FOV → player sees it all
      correctly.

---

## 8. Testing cookbook

### 8.1. Running

```powershell
# Single file:
python -m pytest tests/test_smoke.py -q

# A specific test:
python -m pytest tests/test_smoke.py::test_bv2_full_edit_flow -q -s

# Everything + lint:
.\dev.ps1 check
```

### 8.2. Test pattern

```python
@pytest.mark.asyncio
async def test_bv2_<feature>(client, session_code):
    """One-line description."""
    # 1. Setup: create prerequisites
    r = await client.post(f"/api/builder-v2/sessions/{session_code}/maps",
                          json={"name": "M"})
    map_id = r.json()["id"]

    # 2. Exercise: the thing we're testing
    r = await client.post(f"/api/builder-v2/maps/{map_id}/locations", json={})
    loc_id = r.json()["id"]

    # 3. Assert: response shape AND side effects via re-GET
    r = await client.get(f"/api/builder-v2/maps/{map_id}/locations")
    assert len(r.json()) == 1
    assert r.json()[0]["id"] == loc_id
```

### 8.3. What NOT to do in tests

- Do not mock `broadcast()` — it already no-ops on WS errors, and tests
  don't bring up a WS server.
- Do not `time.sleep()` — only `await`.
- Keep each test under 40 lines. Split if longer.

---

## 9. Debugging recipes

### 9.1. Inspect the DB

```python
# Don't try to inline this in PowerShell (quoting gets mangled) — use a file:
# _check.py
import sqlite3
c = sqlite3.connect('data/combat_companion.db')
cur = c.cursor()
cur.execute('SELECT * FROM bv2_maps LIMIT 10')
for r in cur.fetchall(): print(r)
```

### 9.2. List all bv2 routes

```python
from main import app
for r in app.routes:
    if hasattr(r, 'path') and '/builder-v2' in r.path:
        method = list(r.methods or set())[0] if r.methods else '?'
        print(f"{method:6} {r.path}")
```

### 9.3. Server won't start (port busy)

```powershell
.\dev.ps1 stop
Start-Sleep -Seconds 1
python main.py
```

### 9.4. WS events not arriving on the frontend

1. In Network → WS tab — is the WS connection open?
2. In `static/js/websocket-client.js` — is `ws.on('bv2.xxx', ...)`
   registered BEFORE the server sends the event? (i.e., script is
   loaded.)
3. In `40-websocket.js` there is `if (!window.ws) return;` — this
   branch fires if bv2 scripts load before `websocket-client.js`.
   Check the `<script>` order in gm.html.

### 9.5. Alembic autogenerate produced nothing

- Probably head is already applied and no new models exist.
- Check `python -m alembic current`.
- Maybe the model is not imported into `app/models.py` at all (a model
  must inherit `Base` from `app.database`).

---

## 10. Coding conventions (match this style)

### 10.1. Python

- No `from __future__ import annotations` — the project targets 3.11+.
- Type hints: `str | None`, `list[dict]`, `dict[str, int]`.
- Docstrings **only** at module level and on complex functions. Simple
  CRUD endpoints — one-liner or none.
- Don't import `typing.Optional` / `typing.List` — use pipe and `list`.
- Imports: sort via ruff. `from app...` is local; stdlib/third-party
  above.
- Comments **in English**, focused and minimal. Don't state the obvious.
- No emoji in Python code (icons for UI are fine).

### 10.2. JavaScript

- IIFE wrapper per module to keep globals clean:
  ```js
  (function () {
    const S = window.bv2;
    // module code
  })();
  ```
- Only these globals: `window.bv2`, `window.ws`, `window.api`,
  `SESSION_CODE`.
- Avoid `async/await` where strict sync is required (paint loop stays
  sync).
- Arrow functions for callbacks; named functions for class methods.
- Keep semicolons. No bare `eslint --fix --allow-empty` style.
- Use short `//` comments for non-obvious logic; skip JSDoc for trivial
  methods.

### 10.3. HTML

- Inline styles are fine for one-off narrow spots. Reusable → move to
  CSS.
- Prefer `data-*` attributes for hooks over `id=` when reasonable.

### 10.4. SQL / Alembic

- All bv2 tables must start with the prefix `bv2_`.
- FKs always take `ondelete="..."` (`"CASCADE"` or `"SET NULL"`), even
  though SQLite ignores them — it documents intent and works in
  Postgres.
- Indexes on FKs and on `(session_id, ...)` / `(location_id, col, row)`.
  **Add in later phases:** `Index("ix_bv2_entities_location",
  "location_id")`. Not critical now — SQLite tables are small.

---

## 11. "Task complete" checklist

Before telling the user "done":

- [ ] All new endpoints have smoke tests.
- [ ] `.\dev.ps1 check` → All checks passed.
- [ ] Started the server (`python main.py`) — no startup exceptions.
- [ ] Opened the browser preview → the tab opens, main flow works.
- [ ] Browser console is clean (no red errors).
- [ ] Network tab: no 404/500 from bv2 requests.
- [ ] Updated this document (mark the phase as ✅).
- [ ] Wrote a short summary for the user: what was done, what works,
      what to verify.

---

## 12. How to communicate with the user

- **Be brief.** After a long chunk of work — a 3–5 line summary plus a
  list of critical changes.
- **Always show the expected verification flow** (create Map → create
  Location → paint a wall → verify that…).
- **No emoji in chat messages** unless the user explicitly asks. In
  code (UI icons) — fine.
- **Do not apologize for long output.** The user saw it streaming.
- **Do not re-tell what you did.** The user saw it. Give the outcome +
  next steps + questions (if any).

---

## 13. Current status

- **Phase 1 (Maps + Locations + Tiles + auto-save + activate):** ✅ DONE.
- **Phase 2 (Entities):** ✅ DONE.
- **Phase 3 (FOV + Fog of War):** ✅ DONE — see caveats below.
- **Phase 4 (Lighting):** ✅ DONE.
- **Phase 5 (Edge transitions):** ✅ DONE.
- **Phase 6 (Library + Polish + Legacy removal):** ✅ DONE.

### Phase 2 caveats

- **`PATCH /entities/{id}` uses replace semantics for `props`**, not
  shallow merge. The whole `props` object is overwritten on every
  PATCH. The frontend sends the entire JSON back from the modal so
  the UX hides this, but a partial PATCH (e.g. `{"props":
  {"is_disarmed": true}}`) will drop every other key. If you need
  shallow merge later, do it explicitly in `entities.py:update_entity`
  and add a regression test for both behaviours.
- **`S.suppressNextWs` is not set in entity endpoints**, so the GM
  who creates/patches/deletes an entity receives their own WS echo
  and triggers a redundant `GET /locations/{id}`. Harmless on
  localhost but wasteful — Phase 6 polish should wrap each
  `S.api.*Entity(...)` call with the same suppress pattern Phase 1
  uses for tiles.
- **Tile-brush click on a cell that already has an entity opens the
  entity editor instead of painting the tile.** Intentional UX, but
  document it in onboarding/help text.

### Phase 3 caveats

- **FOV runtime wiring is deferred to Phase 5/6.** `FOVCalculator`,
  `MapView.setFOV/clearFOV/_drawFOV`, the `POST /visit` endpoint,
  the `bv2.visit_updated` WS event, and the entity FOV filter are
  all in place — but **nothing currently calls them**. Until the
  legacy `Map` tab is unified with `MapView` (Phase 6) or an explicit
  runtime hook is added, FOV is dormant. When you wire it, the
  trigger should be the `character_moved` WS event:
  ```js
  ws.on('character_moved', d => {
    const fov = new bv2.FOVCalculator(view.location, view.tiles);
    const visible = fov.compute(d.col, d.row, d.sight_range_cells);
    bv2.api.visitLocation(d.location_id, d.character_id, [...visible].map(k => k.split(',').map(Number)));
    view.setFOV(visible, mergedExploredFromVisitState);
  });
  ```
- **`sight_range_cells` is now exposed in two places.** If you add a
  third character serializer, also add the field there — the
  `test_bv2_sight_range_cells_exposed` regression covers both
  current endpoints.
- **`MapView.tiles` now stores full server tile objects**, not bare
  `tile_type` strings. `setTile()` builds a stub matching `ser_tile()`
  shape using the local `TILE_BLOCKS` mirror; `_drawTiles` reads
  `tile.tile_type` off the object; FOV reads `tile.blocks_vision`
  directly. If you change the shape of `ser_tile()`, update the stub
  in `setTile()` to match.

### Phase 4 caveats

- **`ambient_light = 0` was previously coerced to `1.0` on the
  client.** Fixed by switching `||` to `??`. If you add a similar
  numeric default anywhere, use `??` — `||` is a foot-gun for any
  field whose valid range includes `0` (intensity, radius, opacity,
  alpha, threshold, …).
- **Lights now respect `blocks_vision`** because `_drawLighting`
  routes every source through `FOVCalculator.compute`. Do not
  re-introduce a free-form 2r×2r block — that bypasses walls and
  silently breaks dark-room gameplay.
- **Carried lights (`location_id IS NULL`) are stored and broadcast
  but not yet rendered** — `get_location_full` only fetches
  `location_id == X`. Wire them in Phase 5/6 by either extending
  the location payload with a `carried_lights` array (server
  computes from session membership) or by listening to
  `character_moved` WS and pushing positioned light objects into
  `view.lights` on the client.
- **`PATCH /lights/{id}` silently ignores `col`/`row` for carried
  lights** (where `location_id IS NULL`) because the bounds-clamp
  needs a location. This is intentional — carried lights track
  their character's position — but if you later allow lights to
  switch type (carried ↔ static) in one PATCH, also handle the
  `location_id` transition explicitly.

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
  `target_location_index -> new_location_id` after creating each
  fresh location. If you change the locations-list ordering
  (currently `ORDER BY sort_order`), every old snapshot in the
  library breaks immediately. Bump a `snapshot_schema_version`
  field if you do.
- **Legacy `app/routers/map_builder/` and
  `static/js/gm/18-map-builder.js` are gone.** Do not resurrect
  them — every feature has a builder-v2 equivalent. The single
  legacy hook left is `static/js/gm/01-core.js` adding
  `'builder-v2'` to the flex-tab list.

Last migration: `865bbdab5232_add_bv2_character_grid_position_fields.py`.  
Tests in `tests/test_smoke.py`: 45 (24 are bv2).  
Legacy code: not touched outside `static/js/gm/01-core.js` (single-line
flex-tab addition) and `app/routers/map/files.py` +
`app/routers/sessions.py` (one-field additions for `sight_range_cells`
in Phase 3).

**Recommended next step:** start Phase 4 with backend `lights.py` +
smoke tests, **before** the frontend. When backend is green → move to
frontend. That is my usual sequencing.

Good luck. If anything is unclear — read the matching Phase 1 file as
a reference.
