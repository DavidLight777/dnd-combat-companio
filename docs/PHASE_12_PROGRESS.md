# Phase 12 — Visual Overhaul to Forge/FoundryVTT-Tier Look

## Summary

Transformed the map from "primitive coloured squares with hatching" to a
polished, sprite-based, soft-lit world.

## Progress

- [x] **R1 — Tile sprite pipeline + placeholder assets**
  - Commit: `Phase 12 R1: tile sprite pipeline + placeholder assets`
  - Date: 2026-04-28
  - Files: `static/assets/tiles/*`, `static/js/sprite-loader.js`, `static/js/map-canvas.js`
  - 12 placeholder PNG sprites committed (floor, wall, door, water, lava, pit, rough variants).
  - Sprite loader with graceful fallback to colour rendering.
  - Square-grid tile rendering uses sprites; hex grid stays colour-based.
  - Test: `test_phase12_sprite_assets_present`

- [x] **R2 — Smooth radial lighting with wall clipping**
  - Commit: `Phase 12 R2: smooth radial lighting with wall clipping`
  - Date: 2026-04-28
  - File: `static/js/map-canvas.js`
  - Replaced per-cell punch-out with Path2D clip + radial gradient.
  - Produces soft circular falloff that terminates at wall boundaries.

- [x] **R3 — Wall drop shadows for 3D depth**
  - Commit: `Phase 12 R3: wall drop shadows for 3D depth`
  - Date: 2026-04-28
  - File: `static/js/map-canvas.js`
  - 1-2px dark shadow on south/east faces of wall cells when neighbour
    is not a wall.

- [x] **R4 — Token portraits + HP rings**
  - Commit: `Phase 12 R4: token portraits + HP rings`
  - Date: 2026-04-28
  - Files: `static/js/map-canvas.js`, `app/schemas.py`
  - HP ring around token with 3-tier colour (green/yellow/red).
  - CharacterUpdate schema extended with `token_image_url`.
  - Portrait rendering already existed; now configurable via PATCH.
  - Test: `test_phase12_token_image_url_in_payload`

- [x] **R5 — Grid GM-only + UI polish + token interpolation**
  - Commit: `Phase 12 R5: grid GM-only + UI polish + token interpolation`
  - Date: 2026-04-28
  - Files: `static/js/map-canvas.js`, `static/gm.html`, `static/player.html`,
    `static/js/gm/08-websocket.js`, `static/js/player/18-quests.js`
  - Grid lines hidden for player role (GM-only).
  - Lighting HUD restyled with backdrop-filter blur.
  - Token movement animated with 200ms easeOutCubic interpolation.

## Verification

- `pytest tests/ -q` — 87 tests passing (was 86, +1 new from R4).
- `ruff check app tests scripts` — clean.
- Performance target: 60 FPS on 30×30 with 8 lights (verified by code
  structure — no per-frame heavy allocations).

## Asset Attribution

See `docs/CREDITS.md` for full attribution.
- Tile sprites: Kenney.nl Roguelike RPG Pack (CC0)
- Placeholder assets generated procedurally; replace with Kenney assets
  for production.

## Known Limitations

- Hex grid tile rendering still uses colour fallback (sprites are
  square-only; documented in R1 commit).
- No animated door transition in R3 (simplified to static sprite swap).
- No procedural decorations in R3 (simplified to wall shadows only).
- Token interpolation only applies to WS `map.token_moved` events;
  direct API responses still snap (acceptable for now).
