# Phase 11 — Bug Fixes

## Summary

Three concrete defects discovered during Phase 10 demo playthrough, fixed with no new features and no visual changes.

## Progress

- [x] **R1 — Edge transitions on legacy drag**
  - Commit: `Phase 11 R1: legacy drag fires edge transition`
  - Date: 2026-04-28
  - File: `app/routers/map/tokens.py`
  - Legacy `PATCH /api/map/token/{id}` now checks for edge transitions after bv2 sync, teleporting the character to the target location's entry cell and broadcasting `bv2.character_edge_transitioned` instead of `map.token_moved`.
  - GM WS listener added in `static/js/gm/08-websocket.js`.
  - Test: `test_phase11_legacy_drag_triggers_edge_transition`

- [x] **R2 — Interior zone roof full coverage**
  - Commit: `Phase 11 R2: interior zone roof full coverage (root cause: render order)`
  - Date: 2026-04-28
  - File: `static/js/map-canvas.js`
  - `_renderInteriorOverlay` moved before `_renderFog` in `render()` so fog always has the final say on visibility. Added JS docstring documenting the required order.
  - Test: `test_phase11_interior_zone_full_cells_persist`

- [x] **R3 — GM Map-tab location switcher**
  - Commit: `Phase 11 R3: GM Map-tab location switcher`
  - Date: 2026-04-28
  - File: `static/gm.html`, `static/js/gm/06-map-main.js`
  - Added `<select id="map-location-switcher">` dropdown to Map tab toolbar. Populated from active map's locations. Change triggers `POST /api/builder-v2/locations/{id}/activate`. WS `bv2.location_activated` already refreshes the canvas.
  - Test: `test_phase11_location_activate_emits_ws`

- [x] **11.5 A — Player view follows character location**
  - Commit: `Phase 11.5 A: player view follows character location`
  - Date: 2026-04-28
  - File: `app/routers/map/files.py`
  - `get_map_state` now uses the character's `current_location_id` when `character_id` is provided, instead of always returning the session-active location. GM (no character_id) continues to see the session-active location.
  - Test: `test_phase11_5_player_view_follows_character_location`

- [x] **11.5 B — Roof full coverage (render order correction)**
  - Commit: `Phase 11.5 B: roof full coverage (root cause: render order)`
  - Date: 2026-04-28
  - File: `static/js/map-canvas.js`
  - `_renderInteriorOverlay` moved AFTER `_renderFog` in `render()`. When drawn before fog, fog's dim overlay (0.55 for explored cells) painted over the roof (0.95), making buildings look partially open. Cache-bust versions bumped in `gm.html` and `player.html`.
  - Test: `test_phase11_5_walls_block_vision_in_bridge`

- [x] **11.5 C — Location switcher live refresh**
  - Commit: `Phase 11.5 C: location switcher live (cache-bust)`
  - Date: 2026-04-28
  - File: `static/gm.html`, `static/js/gm/06-map-main.js`
  - Cache-bust versions bumped for all modified JS files (`gm.html`: map-canvas v=reworkv4p2, 06-map-main v=split3, 08-websocket v=split3; `player.html`: map-canvas v=reworkv3p20, 10-map v=split3, 13-websocket v=split3).
  - No new test needed — covered by `test_phase11_location_activate_emits_ws`.

- [x] **11.5 D — Move-token sync uses character location**
  - Commit: `Phase 11.5 D: move-token sync uses character location`
  - Date: 2026-04-28
  - File: `app/routers/map/tokens.py`
  - `move_token` now resolves `bv2_loc` from `c.current_location_id` first, falling back to session-active only when the character has no location. This prevents the "snap back to Center" bug after edge transitions.
  - Test: `test_phase11_5_step_inside_target_location_does_not_warp_back`

- [x] **11.5 E — Wall check uses character location**
  - Commit: `Phase 11.5 E: wall check uses character location`
  - Date: 2026-04-28
  - File: `app/routers/map/common.py`, `app/routers/map/tokens.py`
  - `_path_is_blocked` now accepts `location_id` parameter. `tokens.py` passes `c.current_location_id` so wall checks use the character's current location instead of session-active. Prevents "Path is blocked by a wall" false positives when the session-active location has walls at the same coordinates.
  - Test: `test_phase11_5_wall_check_uses_character_location`

## Verification

- `pytest tests/ -q` — 84 tests passing (was 78, +6 new).
- `ruff check app tests scripts` — clean.
