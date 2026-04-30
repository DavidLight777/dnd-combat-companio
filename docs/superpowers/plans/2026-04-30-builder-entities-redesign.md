# Builder Entities & Lighting Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Redesign BV2 entity forms (trap, chest, portal, npc spawn), fix edges UI, fix lighting panel, and resolve visibility/trigger bugs.

**Architecture:** Backend changes (DB migrations, API updates) first, then frontend form redesigns, then bug fixes for visibility and triggering. Each entity type is independent but shares the .form-section pattern.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, Vanilla JS, Canvas2D

---

## File Structure

| File | Responsibility |
|------|---------------|
| app/models.py | Add size_cells to BV2Trap, BV2Portal; trigger_zone_size to BV2NPCSpawn |
| Alembic migration | Schema changes for size_cells |
| app/routers/builder_v2/traps.py | Update trap CRUD, trigger logic, dodge/DoT integration |
| app/routers/builder_v2/chests.py | Update chest CRUD, remove is_opened from form |
| app/routers/builder_v2/portals.py | Update portal CRUD, add size_cells |
| app/routers/builder_v2/npc_spawns.py | Update NPC spawn CRUD, add trigger_zone_size |
| app/routers/builder_v2/edges.py | Edge list in location payload, dropdown target |
| static/js/builder_v2/50-entities.js | Redesigned entity forms (trap, chest, portal, npc spawn) |
| static/js/builder_v2/70-lights.js | Bright slider, remove col/row, drag, preview fix |
| static/js/builder_v2/80-edges.js | Edge list rendering, dropdown, visual feedback |
| static/js/map-canvas/render.js | Render visible traps/chests on player canvas |
| static/js/map-canvas/events.js | Trigger traps on move, disarm/chest interactions |
| static/js/player/19-traps.js | Player trap dodge/disarm modals |
| tests/test_trap_trigger.py | Trap trigger, dodge, charges tests |
| tests/e2e/test_trap_e2e.py | E2E trap visibility and trigger tests |

---

## Task 1: DB Migration — Add size_cells columns

**Files:**
- Create: alembic/versions/2026_04_30_add_size_cells_to_entities.py
- Modify: app/models.py

- [ ] Step 1: Write migration

Create file with alembic revision.
Add size_cells to bv2_traps, bv2_portals.
Add trigger_zone_size to bv2_npc_spawns.

- [ ] Step 2: Add fields to models

In app/models.py add fields with server_default='1'.

- [ ] Step 3: Run migration

Command: python -m alembic upgrade head
Expected: Migration succeeds.

- [ ] Step 4: Commit

---

## Task 2: Update Trap API

**Files:**
- Modify: app/routers/builder_v2/traps.py

- [ ] Step 1: Update trap payload serializer — add size_cells
- [ ] Step 2: Update create/update endpoints — accept size_cells, validate > 0
- [ ] Step 3: Update trigger logic — check square area for trigger
- [ ] Step 4: Add dodge check — WS event if undodgeable=false
- [ ] Step 5: Commit

---

## Task 3: Update Chest API

**Files:**
- Modify: app/routers/builder_v2/chests.py

- [ ] Step 1: Remove is_opened from form serialization
- [ ] Step 2: Add lockpick endpoint — POST /chests/{id}/pick-lock
- [ ] Step 3: Commit

---

## Task 4: Update Portal API

**Files:**
- Modify: app/routers/builder_v2/portals.py

- [ ] Step 1: Add size_cells to payload
- [ ] Step 2: Update create/update endpoints
- [ ] Step 3: Commit

---

## Task 5: Update NPC Spawn API

**Files:**
- Modify: app/routers/builder_v2/npc_spawns.py

- [ ] Step 1: Add trigger_zone_size to payload
- [ ] Step 2: Add spawn trigger endpoint
- [ ] Step 3: Commit

---

## Task 6: Redesign Entity Forms (Frontend)

**Files:**
- Modify: static/js/builder_v2/50-entities.js
- Modify: static/gm.html

- [ ] Step 1: Update trap form — remove col/row/dc_detect, add size, DoT
- [ ] Step 2: Update chest form — remove col/row/is_opened/icon
- [ ] Step 3: Update portal form — remove col/row, add size
- [ ] Step 4: Update NPC spawn form — remove col/row, add zone size
- [ ] Step 5: Commit

---

## Task 7: Fix Lighting Panel

**Files:**
- Modify: static/js/builder_v2/70-lights.js
- Modify: static/gm.html

- [ ] Step 1: Add bright radius slider
- [ ] Step 2: Remove col/row from light form
- [ ] Step 3: Fix preview button
- [ ] Step 4: Add drag support for light icons
- [ ] Step 5: Commit

---

## Task 8: Fix Edges UI

**Files:**
- Modify: static/js/builder_v2/80-edges.js
- Modify: app/routers/builder_v2/edges.py

- [ ] Step 1: Render edge list in sidebar
- [ ] Step 2: Replace target ID with dropdown
- [ ] Step 3: Visual edge rendering on map
- [ ] Step 4: Commit

---

## Task 9: Fix Visibility Bugs

**Files:**
- Modify: static/js/map-canvas/render.js

- [ ] Step 1: Render visible traps on player canvas
- [ ] Step 2: Render visible chests on player canvas
- [ ] Step 3: Commit

---

## Task 10: Fix Trigger Bug

**Files:**
- Modify: app/routers/builder_v2/edges.py
- Modify: static/js/map-canvas/events.js

- [ ] Step 1: Debug why trap does not trigger
- [ ] Step 2: Add test for trap trigger
- [ ] Step 3: Commit

---

## Task 11: Player Interactions

**Files:**
- Modify: static/js/player/19-traps.js
- Create: static/js/player/20-chests.js

- [ ] Step 1: Trap dodge modal
- [ ] Step 2: Trap disarm context menu
- [ ] Step 3: Chest lockpick modal
- [ ] Step 4: Commit

---

## Task 12: E2E Tests

**Files:**
- Modify: tests/e2e/test_trap_e2e.py
- Create: tests/e2e/test_chest_flow.py

- [ ] Step 1: Test trap visibility
- [ ] Step 2: Test trap trigger
- [ ] Step 3: Test chest visibility and lockpick
- [ ] Step 4: Commit

---

## Final Verification

- [ ] Run all unit tests: python -m pytest tests/ -v
- [ ] Run E2E tests: python -m pytest tests/e2e -v --browser chromium
- [ ] Hard refresh GM and Player tabs
- [ ] Test each entity type end-to-end

---

*Plan generated 2026-04-30. Ready for execution.*
