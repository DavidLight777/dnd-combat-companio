# Demo Map — Riverside Village (5 Locations)

**Assigned to:** Kimi
**Author:** Cascade
**Date:** 2026-04-29

> **READ FIRST:** `docs/REAL_TESTING.md` — testing discipline applies here too.
> Every API endpoint you call must exist in `app/routers/builder_v2/`.
> If a route is missing, add a minimal one as part of the same commit.
> **Do NOT guess URLs.**

---

## Goal

Create a permanent, reusable demo map called **"Riverside Village"** that
exercises every builder_v2 feature: tiles, lights, chests, traps, NPC
spawns, edges between locations, dungeon descent, ambient lighting.

The map lives in a **global demo session** and is seeded by:

```bash
python scripts/seed_demo_map.py
```

Running the script twice must be **idempotent** — if "Riverside Village"
already exists in the session, exit 0 without duplicating anything.

---

## Seed Script

**File:** `scripts/seed_demo_map.py`

Rules:
1. Read session code from env var `DEMO_SESSION_CODE` (default: `"DEMO01"`).
2. If the session doesn't exist → create it (`name="Demo Session"`).
3. If `BV2Map` named `"Riverside Village"` already exists in that session → exit 0.
4. Create everything via **HTTP calls** to `http://localhost:8000` using
   `httpx.AsyncClient` — **not** direct SQLAlchemy inserts.
5. Verify each API response (assert `status_code < 300`), abort with a
   clear error message on failure.
6. Print a summary at the end (see format below).

### Output format

```
✓ Riverside Village created
  Session  : DEMO01
  Map ID   : <id>
  Locations: Village Square (#<id>), Tavern (#<id>),
             Market (#<id>), Dungeon Entrance (#<id>),
             Underground Dungeon (#<id>)
  Lights   : 10 created
  Chests   : 7 created
  NPCs     : 5 spawned
  Traps    : 2 placed
```

---

## Map Structure — 5 Locations

### Location 1 — Village Square (32×24, square grid)

**Tiles:**
- Perimeter (all edge col/row) = `wall`
- 3 doors (`type=door`, `is_open=True`): north side col 8, south col 16, east row 12
- Center area (col 12–19, row 8–15) = `floor`
- 2 pillars: (col 10, row 10) = wall, (col 21, row 10) = wall

**Lights:**
- Torch at entrance (col 8, row 1): `source_kind=torch`, `color_hex=#ffd9a0`, `radius_cells=5`
- Torch center (col 16, row 12): `source_kind=torch`, `color_hex=#ffd9a0`, `radius_cells=6`
- Magic lantern (col 20, row 20): `source_kind=magic`, `color_hex=#a0d4ff`, `radius_cells=4`

**Chests:**
- (col 3, row 3) — iron chest, `is_locked=True`, items: `["50 gold coins", "Village Map"]`
- (col 29, row 21) — wooden chest, items: `["Healing Potion", "Torch"]`

**Edges:**
- North col 14–17 → Location 2 (Tavern)
- East row 10–13 → Location 3 (Market)
- South col 14–17 → Location 5 (Dungeon Entrance)

**Settings:** `ambient_light=0.4`, `is_indoor=False`

---

### Location 2 — Tavern (20×16, square grid)

**Tiles:**
- Perimeter = `wall`
- 1 door south col 9 (back to village)
- Bar counter: col 2–7, row 2 = `wall` (barrier)
- Tables (floor + furniture entity): (col 10, row 5), (col 14, row 5),
  (col 10, row 10), (col 14, row 10)

**Lights:**
- Fireplace (col 1, row 8): `source_kind=torch`, `color_hex=#ff6b2b`, `radius_cells=4`, `intensity=1.3`
- Candle (col 10, row 4): `source_kind=torch`, `color_hex=#ffe0a0`, `radius_cells=2`
- Candle (col 14, row 9): `source_kind=torch`, `color_hex=#ffe0a0`, `radius_cells=2`

**NPCs (BV2NPCSpawn):**
- `"Barkeep Thor"` at (col 4, row 3):
  NpcTemplate `"Innkeeper"` — STR 12, CON 14, CHA 16, hp=20,
  `dialogue="Welcome, traveller!"`
- `"Drunk Knight"` at (col 11, row 7):
  NpcTemplate `"Guard"` — STR 16, DEX 10, CON 15, hp=30, weapon: sword

**Chest:**
- (col 18, row 14) — locked chest, items: `["Cellar Key", "10 gold"]`

**Edges:**
- South col 8–10 → Location 1

**Settings:** `ambient_light=0.2`, `is_indoor=True`

---

### Location 3 — Market (28×20, square grid)

**Tiles:**
- Perimeter = `wall`
- 2 market stalls (wall strips): row 5 col 2–12, row 5 col 16–25
- 2 doors: west row 9 (to village), east row 9 (exit)

**Lights:**
- Lantern above stall 1 (col 6, row 4): `source_kind=magic`, `color_hex=#fff5c0`, `radius_cells=5`
- Lantern above stall 2 (col 20, row 4): `source_kind=magic`, `color_hex=#fff5c0`, `radius_cells=5`
- Lantern center (col 14, row 14): `source_kind=magic`, `color_hex=#fff5c0`, `radius_cells=5`

**NPCs:**
- `"Merchant Leya"` at (col 7, row 7):
  NpcTemplate `"Merchant"` — CHA 18, INT 14, hp=10, `is_merchant=True`,
  shop_items: `[Healing Potion 50gp, Torch 1gp, Rope 1gp]`

**Chests:**
- (col 1, row 1) — chest, items: `["Rare Potion of Speed"]`
- (col 26, row 18) — chest, items: `["Sapphire", "30 gold"]`

**Edges:**
- West row 8–10 → Location 1

**Settings:** `ambient_light=0.7`, `is_indoor=False`

---

### Location 4 — Underground Dungeon (24×18, square grid)

**Tiles:**
- Default = `wall` (solid rock — fill all cells first)
- Carved floor corridors:
  - Main corridor: col 2–22, row 8–10
  - Side chamber 1: col 2–8, row 3–7
  - Side chamber 2: col 16–22, row 11–16
  - Boss chamber: col 9–15, row 3–15
- 4 pillars in boss chamber: (col 10, row 4), (col 14, row 4),
  (col 10, row 14), (col 14, row 14) = `wall`

**Lights:**
- Magic crystal in boss chamber (col 12, row 9):
  `source_kind=magic`, `color_hex=#9b59b6`, `radius_cells=6`, `intensity=0.8`
- Torch at entrance (col 3, row 9):
  `source_kind=torch`, `color_hex=#ff8800`, `radius_cells=3`

**NPCs:**
- `"Skeleton Guard"` at (col 5, row 9):
  NpcTemplate `"Skeleton Guard"` — STR 14, DEX 14, CON 10, hp=18,
  special_abilities: `["Undead — immune to poison"]`
- `"BOSS — Necromancer Vork"` at (col 12, row 7):
  NpcTemplate `"Necromancer Boss"` — INT 18, WIS 14, CON 12, hp=80,
  special_abilities: `["Darkness Spell", "Raise Dead"]`, weapon: staff

**Traps (BV2Trap):**
- (col 6, row 9) — spike trap, `damage="2d6"`, `is_hidden=True`, `is_triggered=False`
- (col 18, row 9) — poison dart, `damage="1d4"`, `is_hidden=True`, `is_triggered=False`

**Chest:**
- (col 13, row 12) — legendary chest, `is_locked=True`,
  items: `["Artifact: Staff of Shadows", "Scroll of Resurrection", "200 gold", "Dragon Ruby"]`

**Edges:**
- North col 11–13 → Location 5 (up to dungeon entrance)

**Settings:** `ambient_light=0.0`, `is_indoor=True`

---

### Location 5 — Dungeon Entrance (16×12, square grid)

**Tiles:**
- Perimeter = `wall`
- Door north col 7 (to village square)
- Door south col 7 (to dungeon)
- Staircase down: col 6–9, row 8–10 = `floor` + entity `type=stairs_down`

**Lights:**
- Dim torch (col 7, row 2): `source_kind=torch`, `color_hex=#cc6600`, `radius_cells=3`, `intensity=0.6`

**NPCs:**
- `"Old Guard Drog"` at (col 7, row 5):
  Reuse NpcTemplate `"Guard"` (already created in Tavern),
  `dialogue="Don't go down there, traveller. Only death awaits."`

**Chest:**
- (col 1, row 1) — chest, items: `["50ft Rope", "Torch x3"]`

**Edges:**
- North col 6–8 → Location 1 (Village Square)
- South col 6–8 → Location 4 (Underground Dungeon)

**Settings:** `ambient_light=0.1`, `is_indoor=True`

---

## NPC Templates to Create

Create these via `POST /api/npc-library/templates` before spawning:

| Template name        | Key stats                                    | Notes              |
|----------------------|----------------------------------------------|--------------------|
| `Innkeeper`          | STR 12, CON 14, CHA 16, hp=20               | friendly           |
| `Guard`              | STR 16, DEX 10, CON 15, hp=30, sword        | reused in loc 5    |
| `Merchant`           | CHA 18, INT 14, hp=10, `is_merchant=True`   | has shop           |
| `Skeleton Guard`     | STR 14, DEX 14, CON 10, hp=18               | undead, no poison  |
| `Necromancer Boss`   | INT 18, WIS 14, CON 12, hp=80, staff        | boss               |

Check existing templates first — if `"Guard"` already exists, reuse its id.

---

## Tests

**File:** `tests/test_demo_map_seed.py`

All 5 tests via `httpx` / `client` fixture against live server.
Run seed script before the test suite (or call it inside a session-scoped
fixture).

```python
def test_seed_script_is_idempotent():
    """Run seed twice — second run exits without duplicating rows.
    Map count for session DEMO01 must remain 1 after two runs."""
    ...

def test_all_5_locations_exist():
    """After seed, the map has exactly 5 locations with the expected names."""
    expected = {
        "Village Square", "Tavern", "Market",
        "Dungeon Entrance", "Underground Dungeon"
    }
    ...

def test_dungeon_is_fully_dark():
    """Underground Dungeon location has ambient_light == 0.0."""
    ...

def test_boss_chest_has_4_items():
    """The legendary chest in the boss chamber contains exactly 4 items."""
    ...

def test_edges_connect_all_locations():
    """The edge graph is connected — every location is reachable
    from Village Square by following edges."""
    ...
```

All 5 tests must be green:

```
pytest tests/test_demo_map_seed.py -v
```

---

## Exit Criteria

- [ ] `python scripts/seed_demo_map.py` completes without errors on a fresh DB.
- [ ] Running it a second time prints `"Already exists — skipping"` and exits 0.
- [ ] `pytest tests/ -q --ignore=tests/e2e` — all green (109 + 5 new = 114 passed).
- [ ] DevTools console on `/gm` after seed — empty (no JS errors).
- [ ] Map is visible in the Builder V2 tab with all 5 locations navigable via edges.
- [ ] At least one light flickers (torch animation) and one pulses (magic).
- [ ] Commit: `feat: seed Riverside Village demo map (5 locations)`

---

## Anti-fail Rules

1. **Check routes before calling.** Look in `app/routers/builder_v2/` for the
   actual endpoint paths. Never guess. If a route doesn't exist, add it.
2. **Tiles as batch.** Use `PUT /api/builder-v2/locations/{id}/tiles` with
   a list payload — don't POST one tile at a time.
3. **NpcTemplate reuse.** Check if the template exists before creating.
   Use `GET /api/npc-library/templates` and filter by name.
4. **Edges are directional pairs.** Create both directions (A→B and B→A)
   or verify the model handles bidirectionality automatically.
5. **No SQLAlchemy in the seed script.** HTTP only. The script must work
   when the server is on a different machine.
6. **Don't invent item models.** Chest items are stored as JSON strings
   in the `items` field — match the schema used by existing chest endpoints.

---

## Contact

Blocked on a missing endpoint or unclear schema → check `app/routers/builder_v2/`
source first, then ping Cascade before guessing.
