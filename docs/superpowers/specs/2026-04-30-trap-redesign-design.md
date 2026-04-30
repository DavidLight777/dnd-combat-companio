# Trap System Redesign — Design Spec

> **Date:** 2026-04-30
> **Status:** In Progress (brainstorming phase)
> **Scope:** BV2 Trap entity form, trigger logic, visibility, DoT integration

---

## 1. Form Redesign

### Hidden Fields
| Field | Reason |
|-------|--------|
| `col` / `row` | Determined by map click placement |
| `dc_detect` | GM controls visibility manually via toggle + narrative perception checks |

### New Field: Size (Square)
- **Type:** Select dropdown
- **Options:** 1×1, 2×2, 3×3, 4×4, 5×5, 6×6...
- **Rendering:** Filled coloured zone on the map grid
- **DB:** Add `size_cells` to `BV2Trap` (default 1)

### Simplified State Section
- **Keep:** `charges` (how many times trap can trigger)
- **Remove:** `charges_used`, `armed`, `disarmed`, `auto_reset`
- **Behaviour:**
  - Trap auto-deletes when charges reach 0
  - GM manually deletes if player disarms it

### DoT Effect (Replaces JSON blob)
Uses existing `StatusEffectTemplate` → `CharacterStatusEffect` mechanic.

| Setting | Source |
|---------|--------|
| Damage type (fire/poison/bleed/acid...) | `StatusEffectTemplate.damage_type` or custom |
| Damage dice per turn | New field or template reference |
| Duration (turns) | `CharacterStatusEffect.remaining_turns` |
| Save throw to end early | `StatusEffectTemplate` configurable |

### Damage Configuration
- **Options:**
  - Instant damage only (`damage_dice`)
  - DoT only (status effect)
  - Both simultaneously
- **UI:** Checkboxes or toggle group

---

## 2. Trigger Logic

### When Triggered
1. Check `charges > 0`
2. If `undodgeable = false` → show player "Dodge" modal
   - Roll: d20 + DEX vs trap DC (or AC? TBD)
   - On success: avoid all damage/effects
3. If dodge fails or `undodgeable = true`:
   - Roll instant damage (`damage_dice`)
   - Apply DoT status effect if configured
   - Decrement `charges`
   - If `charges == 0` → auto-delete trap
4. Broadcast `trap.triggered` WS event

### Trigger Condition
- `on_enter` — when player token moves onto trap cell(s)
- Current bug: trap does NOT fire when stepped on (needs fix)

---

## 3. Player Interactions

### Visibility
- When `visible_to_players = true` → player sees trap icon/zone on map
- Current bug: player does NOT see visible traps (needs fix)

### Right-Click Context Menu
- **Option:** "Disarm"
- **Roll:** d20 + DEX vs `dc_disarm`
- On success: GM notified, trap can be deleted manually
- On failure: nothing happens (or trap triggers? TBD)

---

## 4. Bugs to Fix

1. **Visibility bug** — player canvas does not render visible traps
2. **Trigger bug** — trap does not fire when stepped on

---

## 5. DB Changes (Alembic)

- `BV2Trap.size_cells` — Integer, default 1
- `BV2Trap.dot_template_id` → FK to `status_effect_templates.id` (nullable)
- Remove: `dc_detect` from form (may keep in DB for backwards compat)
- Potentially: `BV2Trap.dot_damage_dice`, `BV2Trap.dot_duration_turns` if not using template reference

---

## 6. Files to Touch

| Layer | Files |
|-------|-------|
| DB | `app/models.py`, Alembic migration |
| API | `app/routers/builder_v2/traps.py` |
| Trigger | `app/routers/builder_v2/edges.py` (grid move), `static/js/map-canvas/events.js` |
| GM Form | `static/js/builder_v2/50-entities.js`, `static/gm.html` |
| Player View | `static/js/map-canvas/render.js`, `static/js/player/10-map.js` |
| Player Disarm | `static/js/player/19-traps.js` or new file |
| Tests | `tests/test_trap_trigger.py`, `tests/e2e/test_trap_e2e.py` |

---

## 7. Chest Redesign (added 2026-04-30)

### Hidden Fields
| Field | Reason |
|-------|--------|
| `col` / `row` | Determined by map click placement, same as trap |

### Removed Fields
| Field | Reason |
|-------|--------|
| `is_opened` | Simplified logic: `!is_locked` = open |
| `icon` (Appearance) | Not needed |

### Lock Logic
- `is_locked = true` → player cannot open without lockpicking
- Player clicks chest → modal shows items inside
- If locked → same modal shows "Locked (DC X)" + "Pick Lock" button
- Lockpicking: d20 + DEX vs `lock_dc`
- On success → `is_locked = false` → player immediately sees contents
- GM can leave chest unlocked → players can open freely

### Player Visibility
- When `visible_to_players = true` → player sees chest icon on map
- Current bug: player does NOT see visible chests (same as trap visibility bug)

---

## 8. Portal Redesign (added 2026-04-30)

### Hidden Fields
| Field | Reason |
|-------|--------|
| `col` / `row` | Determined by map click placement |

### New Field: Size (Square)
- Portal occupies an area (square N×N) on the map
- **Options:** 1×1, 2×2, 3×3, 4×4, 5×5...
- **Rendering:** Filled coloured zone or portal icon/label on the map
- **DB:** Add `size_cells` to `BV2Portal` (default 1)
- Any tile inside the area acts as a portal trigger

### Destination
- Target location (dropdown)
- Target col/row (entry point in destination)
- One-way toggle (is_one_way)
- Optional key item requirement

---

## 9. NPC Spawn Redesign (added 2026-04-30)

### Hidden Fields
| Field | Reason |
|-------|--------|
| `col` / `row` | Determined by map click placement |

### New: Spawn Settings
- **Trigger zone size:** Square N×N (select: 1×1, 2×2, 3×3, 4×4, 5×5...)
- **Rendering for GM:** Highlighted trigger zone on map
- **Rendering for players:** Zone is invisible; NPCs are invisible until triggered

### Spawn Points
- GM selects NPC template from library
- GM sets `spawn_count` (how many NPCs to spawn)
- GM clicks individual cells inside trigger zone to define exact spawn positions
- Spawn positions are visible to GM immediately (ghost markers)

### Trigger Logic
- When any player token enters the trigger zone:
  - NPCs spawn instantly at the pre-defined spawn points
  - NPCs become visible to all players
  - NPCs are added to GM's character list (sidebar)
  - GM can control them manually
- **Combat:** NPCs appear in GM's combat panel but combat must be started manually by GM
- NPCs remain on the map permanently after spawning (even if players leave zone)

### Visibility
- Before trigger: only GM sees trigger zone and spawn markers
- After trigger: all players see spawned NPCs on map and in table view

---

## 10. Edge Fixes (added 2026-04-30)

### Current Problems
1. **Edge list not rendered** — `80-edges.js` line 31: "Edge list deferred to Phase 6" — GM cannot see created edges
2. **Target Location ID input** — requires knowing numeric ID; should be dropdown with location names
3. **Range Start/End** — unclear indices; should support visual drag-selection on map edge
4. **No visual feedback on map** — edges invisible in builder canvas; GM cannot see where transitions are
5. **Modal uses plain inputs** — not integrated with `.form-section` pattern

### Fixes Needed
- Render edge list in sidebar (`#bv2-edge-list`) with edit/delete buttons
- Replace "Target Location ID" with dropdown of all locations in current map
- Visual edge rendering on map: arrow/chevron on boundary cells showing transition direction
- When edge brush active, highlight edge cells on hover
- Integrate edge modal with `.form-section` styling

---

## 11. Lighting Redesign (added 2026-04-30)

### Light Panel Changes
- **Bright radius** — добавить slider в Light panel (рядом с Radius/Intensity)
- **Убрать col/row** из формы New Light — свет ставится только кликом на карту
- **Перемещение** — зажать ЛКМ на иконке света и тащить
- **Fix Preview** — кнопка Preview должна работать (сейчас не работает)

### Light Icon on Map
- При создании света на карте появляется иконка 1×1 (💡 или круг с цветом света)
- Иконка кликабельна → открывает Edit Light panel
- Видна только GM (в builder)
- DB: lights уже имеют col/row, нужно только отрисовать иконку в MapView

### Ambient + Indoor
- Оставить как есть
- Ambient = общий уровень света локации
- Indoor = форсирует тёмный режим внутри зданий
- Стены блокируют ambient снаружи → внутри здания свои факелы

---

## 12. Summary of All Changes

| # | Feature | Key Changes |
|---|---------|-------------|
| 1 | 🪤 Trap | Size, Dodge, DoT, Disarm, Visibility fix, Trigger fix |
| 2 | 📦 Chest | Lockpick, Visibility fix, Remove State/Appearance |
| 3 | 🌀 Portal | Size (area), Remove col/row |
| 4 | 👻 NPC Spawn | Trigger zone, Spawn points, Visibility |
| 5 | 🔗 Edges | List, Dropdown, Visual feedback |
| 6 | 💡 Lighting | Bright slider, Remove col/row, Drag, Icon, Preview fix |

---

*Approved for implementation planning.*
