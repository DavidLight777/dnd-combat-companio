# DnD Combat Companion — AI Agent Instructions

> **Updated:** 2026-04-25
> **Context:** Read this file before any change. It contains hard-won facts not obvious from filenames.

---

## 1. Stack & Entrypoints

| Layer | Tech |
|-------|------|
| Backend | Python 3.11, FastAPI, SQLAlchemy 2.0 (async), SQLite (aiosqlite) |
| Frontend | Vanilla JS + CSS, single-page apps |
| Real-time | WebSocket (custom manager in `app/websocket_manager.py`) |
| DB migrations | Alembic ONLY — never `create_all()` for structural changes |
| Entry | `python main.py` → opens `http://localhost:8000` |

**Key files by size (agents must edit surgically):**
- `static/js/gm-app.js` — 510 KB, GM logic + BuilderCanvas
- `static/js/player-app.js` — 247 KB, player logic
- `static/js/map-canvas.js` — 66 KB, shared MapCanvas class (GM + Player)
- `app/models.py` — 77 KB, all 35+ tables
- `app/game_mechanics.py` — 45 KB, SACRED formulas
- `app/routers/` — 21 routers, largest: `combat_events.py`, `inventory.py`, `abilities.py`, `characters.py`, `map_builder.py`, `map.py`

**Page routes:**
- `/` → lobby (`static/lobby.html`)
- `/gm` → GM dashboard (`static/gm.html`)
- `/player` → Player view (`static/player.html`)

---

## 2. Critical Rules (DO NOT BREAK)

### 2.1 Database — Migrations
- **Always Alembic** for structural changes (new tables, FKs, renames).
- `app/database.py` does `create_all()` + lightweight `ALTER TABLE` fallbacks on boot for **column additions only**.
- **Never modify existing migration files**.
- SQLite Alembic quirk: `batch_alter_table` with unnamed `create_foreign_key` crashes. Name constraints explicitly (e.g., `fk_map_floors_map_id`).

```bash
python -m alembic revision --autogenerate -m "description"
python -m alembic upgrade head
```

### 2.2 Async SQLAlchemy — Identity Map Trap
- **Never** access relationships outside async context.
- **Never** use `selectinload()` if the object is already in the identity map.
- **Always** batch-load configs explicitly:

```python
# WRONG — selectinload fails on cached objects
result = await db.execute(
    select(CharacterAbility)
    .options(selectinload(CharacterAbility.ability).selectinload(Ability.rank_configs))
)

# CORRECT — explicit batch load
rc_result = await db.execute(
    select(AbilityRankConfig).where(AbilityRankConfig.ability_id.in_(ability_ids))
)
rc_map = {}
for rc in rc_result.scalars().all():
    rc_map.setdefault(rc.ability_id, []).append(rc)
```

### 2.3 SACRED Formulas
- File: `app/game_mechanics.py`
- **Do not touch** without explicit user permission.
- Includes: damage formulas, AC calculation, initiative, XP curves, HP rolls, rank promotion thresholds.

### 2.4 Ability Rank/Level System
- `AbilityRankConfig` and `AbilityLevelConfig` columns are typed nullable.
- `null` in a field means "inherit from previous tier or base".
- **Always** call `_resolve_ability()` with explicit config lists:

```python
resolved = _resolve_ability(
    ability, level, rank,
    level_configs=level_configs_list,
    rank_configs=rank_configs_list,
)
```
- **Never** pass only `ability` — `ability.rank_configs` is empty in async context.

### 2.5 Passive Bonuses Lifecycle
- On assign: `_apply_passive_bonuses()`
- On rank-up: `_remove_passive_bonuses()` → resolve → `_apply_resolved_passive_bonuses()`
- On unassign: `_remove_passive_bonuses()`

---

## 3. Map Builder Architecture (Not Obvious from Filenames)

### 3.1 Data Model
```
Session
  └── MapTemplate ("Dungeon") ← created per session
        └── MapFloor (Level 1, Level 2...) ← has tiles_json, image_url, grid_type, tile_size
              ├── MapTrap (col, row, dc_detect, damage_dice, is_hidden)
              ├── MapChest (col, row, items_json, is_hidden, is_locked, lock_dc)
              └── MapPortal (col, row, target_map_id, target_floor_id, target_col, target_row)

MapLibrary ← reusable templates, snapshotted from a session's floors
MapData ← active runtime state for the session (image_url, tiles_json, grid settings)
```

### 3.2 Activation Flow
- `activate_floor(floor_id)` copies the floor's **image + grid + tiles** into `MapData` and broadcasts `map.updated`.
- Traps, chests, portals are **NOT copied** into `MapData`. They are fetched dynamically from builder tables by `floor_id`.
- `loadMapState()` filters builder entities: `floor_id === active_floor_id`.

### 3.3 Two Chest Systems (Critical Distinction)
| Feature | Old `Chest` | New `MapChest` |
|---------|-------------|----------------|
| Coordinates | `map_x, map_y` (float 0..1) | `col, row` (integer tile indices) |
| API prefix | `/api/chests/...` | `/api/map-builder/.../chests` |
| Storage | `chests` table | `map_chests` table |
| Frontend render | `MapCanvas.chests` (legacy) | `MapCanvas.mapChests` (builder) |
| Usage | Legacy free-placement | Builder tile-bound |

**Both systems coexist.** Do not conflate them.

### 3.4 Builder Canvas Patterns
- `BuilderCanvas` (in `gm-app.js`) is for the **Builder tab**.
- `MapCanvas` (in `map-canvas.js`) is for the **Map tab** (both GM and Player).
- During `saveBuilderTiles()`, set `_builderWsSuppressed = true` to prevent `map.tiles_updated` / `map.floor_updated` from resetting the canvas.

---

## 4. WebSocket Events

### Backend broadcasts
```
character.leveled_up
character.rank_promoted
ability.rank_promoted
quest.completed
chest.*
entity.invalidated          # all DB mutations (via realtime.py hooks)
map.updated
map.objects_updated
map.token_moved
map.floor_activated
map.tiles_updated
map.trap_added
map.chest_added / updated / deleted
map.portal_added / updated / deleted
```

### Frontend handlers (add in BOTH gm-app.js and player-app.js)
```javascript
// GM
ws.on('ability.rank_promoted', d => { ... });
ws.on('entity.invalidated', d => { refreshChars(); });

// Player
ws.on('ability.rank_promoted', d => {
  if (d.character_id == CHAR_ID) {
    showToast(`⭐ ${d.ability_name} promoted!`);
    loadAbilities();
    loadChar();
  }
});
```

---

## 5. Checklists

### After any Backend change
- [ ] `python tests/test_rework_v2.py` — must be 106/106 (requires running server)
- [ ] API endpoint works — test with curl/requests
- [ ] WS event is broadcast if mutation affects frontend
- [ ] Alembic migration created if models changed

### After any Frontend change
- [ ] **Ctrl+F5** hard refresh in browser
- [ ] Test **both GM and Player** sides
- [ ] Add WS handler in both `gm-app.js` and `player-app.js` if new event
- [ ] Call `loadXxx()` after mutations (e.g., `loadAbilities()` after rank-up)

### Testing rank configs manually
```python
import requests
resp = requests.get('http://localhost:8000/api/characters/{char_id}/abilities')
data = resp.json()
for ab in data:
    print(f"{ab['name']}: rank={ab['ability_rank']}, mana={ab['mana_cost']}, dmg={ab['damage_dice_count']}d{ab['damage_dice_type']}")
```

---

## 6. Key Frontend Functions

### player-app.js
```javascript
loadAbilities()       // fetch + render ability grid
renderAbilities()     // redraw ability cards
loadChar()            // fetch character sheet data
loadPlayerMapState()  // fetch map state + overlays + builder entities
```

### gm-app.js
```javascript
refreshChars()        // full character list refresh
renderCharDetail()    // redraw selected character panel
loadGmAbilities()     // GM ability library
loadMapState()        // fetch map + overlays + builder entities for active floor
saveBuilderTiles()    // persist BuilderCanvas tiles to DB (sets _builderWsSuppressed)
```

---

## 7. Debugging

| Symptom | Cause | Fix |
|---------|-------|-----|
| Backend ignores code changes | Server not restarted OR `__pycache__` stale | Kill python, clear `app/__pycache__` & `app/routers/__pycache__`, restart |
| Frontend ignores changes | Browser cache | Ctrl+F5 |
| `MissingGreenlet: greenlet_spawn` | Relationship access outside async | Batch-load with explicit query |
| Tests crash on startup | Windows encoding | `chcp 65001; $env:PYTHONIOENCODING="utf-8"` |
| Builder canvas resets after save | WS echo overwriting tiles | `_builderWsSuppressed = true` during save |
| Map shows wrong grid size | Using slider instead of floor setting | Map tab reads `active_floor_tile_size` |

---

## 8. Quick Commands

```bash
# Start server (opens browser automatically)
python main.py

# Tests — requires server running at 127.0.0.1:8000
chcp 65001
$env:PYTHONIOENCODING = "utf-8"
python tests/test_rework_v2.py

# Stop server (run stop-server.bat or kill python processes)
# IMPORTANT: Always clear __pycache__ after backend changes:
Remove-Item -Recurse -Force app\__pycache__, app\routers\__pycache__

# Migrations
python -m alembic revision --autogenerate -m "description"
python -m alembic upgrade head

# Current migration
python -m alembic current
```

---

## 9. Adding New Features — Minimal Paths

### New Character field
1. `app/models.py` → add column
2. Alembic migration
3. `app/routers/characters.py` → `_serialize_char()`
4. Frontend display if needed

### New API endpoint
1. Add to relevant router in `app/routers/`
2. Verify response format
3. Test with curl/requests
4. Add WS broadcast if mutation
5. Add WS handler in both frontend files

### New Builder entity (trap / chest / portal)
1. `app/models.py` → new model
2. Alembic migration
3. `app/routers/map_builder.py` → CRUD endpoints + WS broadcast
4. `static/js/map-canvas.js` → `setXxx()`, render in `_renderTiles()`, hit-test
5. `static/js/gm-app.js` → `openBuilderXxxModal()`
6. `static/js/gm-app.js` + `player-app.js` → fetch in map loader, WS handlers
7. `static/gm.html` → add brush button

---

> **Before starting work:** Read this file → run tests → verify server is up.
> 
> **Before finishing:** Run tests → check both GM and Player → Ctrl+F5 → verify WS events.
