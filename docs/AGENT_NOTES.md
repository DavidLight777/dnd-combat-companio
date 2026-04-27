# Agent Notes — Recurring Rules & Pitfalls

Lightweight checklist Cascade must consult before declaring a UI/runtime
fix done. Keep entries terse. Add new ones whenever a bug repeats or
slips through.

---

## RULE-1 — Always verify both GM and Player sides

Every fix that touches Map / canvas / WS / character data MUST be
verified on **both** roles independently:

- GM tab (`static/gm.html` → `static/js/gm/*`)
- Player tab (`static/player.html` → `static/js/player/*`)

Even when both roles share `static/js/map-canvas.js`, they often have:
- Different cached JS bundles in different browser tabs.
- Different state load paths (`loadMapState` vs `loadPlayerMapState`).
- Role-gated render branches (`this.role !== 'gm'` filters).
- Different fog / visibility filters server-side.

**Definition of done:** screenshot or explicit confirmation on both.

## RULE-2 — Hard-reload reminder when JS changes

Browser "Clear cache" is unreliable for `.js` files served without
no-cache headers. After every JS edit, instruct the user to:

- `Ctrl+Shift+R` on each open tab, OR
- Open in Incognito, OR
- DevTools → Network → "Disable cache" while DevTools is open.

If user reports "still broken" after JS edit → first thing to suspect
is stale JS. Ask for `F12 → Sources → static/js/<file>.js` content
verification.

## RULE-3 — Tile data shape: bridge sends objects, legacy sends strings

`/api/map/{code}` from `_build_state_from_bv2` returns
`active_floor_tiles[key] = {type, blocks_movement, blocks_vision, is_open}`.
Legacy paths historically sent `active_floor_tiles[key] = "wall"`
(string).

Any consumer iterating tiles MUST normalize:
```js
const type = typeof raw === 'string' ? raw : (raw && raw.type) || 'floor';
```

Anti-pattern: `for (const [key, type] of Object.entries(tiles))`
treating value as string — silently coerces walls/doors to floor color.

## RULE-4 — bv2 vs legacy character position fields

Two parallel coord systems exist on `Character`:

- Legacy: `map_x`, `map_y` (normalized 0..1) — written by
  `PATCH /api/map/token/{id}`.
- bv2: `col`, `row`, `current_location_id` — read by
  `_build_state_from_bv2` for token rendering.

Any endpoint that moves a token MUST update **both** when an active
bv2 location exists, otherwise tokens snap back / vanish on next state
load.

## RULE-5 — Activation-gated bridge

`_build_state_from_bv2` only runs when:
- `BV2Map.is_active == True` for the session.
- AND a `BV2Location` exists (active or first by sort_order).

If neither — bridge silent-falls-through to legacy state. Symptoms:
empty Map tab, "Apply to Game wasn't pressed". Auto-activation happens
on:
- Library load (`90-library.js:62-72`).
- Manual `Apply to Game` button (`bv2-btn-apply`).

## RULE-6 — Numeric defaults

Never `value or default` or `value || default` for numeric fields —
zero is a valid value. Use:
- Python: `value if value is not None else default`
- JS: `value ?? default`

Affected hot-spots: `ambient_light`, `intensity`, `radius_cells`,
`speed_total`, `movement_used`, etc.

## RULE-8 — RAF-coalesce high-frequency renders

`mousemove` fires at 60–120 Hz on modern hardware. Calling a full
`render()` per event = lag with multiple overlays (lighting, interior,
edges, drawings, FX). Hot paths (drag, pan, freehand draw, shape
preview, measure) MUST go through `MapCanvas._requestRender()` which
coalesces to one redraw per animation frame. `mouseup` / commit paths
keep calling `render()` directly so the final state lands immediately.

When adding a new live-preview interaction: route through
`_requestRender()`, not `render()`.

## RULE-9 — bv2 data is NOT synced into legacy game-logic tables

Map Builder v1 used to mirror walls/pits into `MapObject` rows via
`map_builder._sync_builder_walls_to_objects`, so legacy gameplay code
(`_path_is_blocked`, FOV, etc.) just had to read `MapObject`. **Map
Builder v2 has no such sync.** Walls live in `BV2Tile` only.

Whenever you add or audit any *server-side* gameplay rule that
historically read `MapObject` / `MapData`, you MUST extend it to also
consult the active `BV2Map` + `BV2Location` and its `BV2Tile` rows.

Known consumers that needed this:
- `_path_is_blocked` (wall collision) — patched.
- `move_token` token position fields — patched (RULE-4).

Known suspects that may still be legacy-only (audit before relying):
- FOV / vision blocking on the server side.
- Combat range / line-of-sight checks.
- AI / NPC movement helpers.

## RULE-7 — WebSocket refresh path

Map-mutating events MUST broadcast a WS event AND the client MUST have
a listener that re-fetches state. Existing wirings:

- Server broadcasts: `bv2.map_activated`, `bv2.location_activated`,
  `map.updated`, `map.token_moved`, etc.
- Listeners:
  - GM: `static/js/gm/08-websocket.js`.
  - Player: `static/js/player/10-map.js` (bottom of file).

When adding a new mutation endpoint: broadcast → both listeners updated.

---

## Verification checklist (run before "done")

1. [ ] Restart server if Python changed.
2. [ ] Hard-reload GM tab.
3. [ ] Hard-reload Player tab.
4. [ ] GM Map tab: tiles visible (not pale), tokens visible, drag persists.
5. [ ] Player Map tab: same as GM but with role-appropriate filters.
6. [ ] WS event triggers refresh on both roles.
7. [ ] No console errors (F12) on either side.
