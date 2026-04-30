# Phase 17 Round 5 — Trap System Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend `BV2Trap` model, add auto-trigger on token move, GM editor UI, player WS toast.

**Architecture:** `BV2Entity` (type=trap) + `BV2Trap` record. `check_trap_trigger()` called from `tokens.py` after grid move. Damage via `roll_dice()`, DoT via `apply_status_effect()`. WS broadcast `trap.triggered`.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, Vanilla JS, Canvas2D.

---

### Task 1: Extend BV2Trap model + Alembic migration

**Files:**
- Modify: `app/models.py`
- Create: `alembic/versions/..._extend_bv2_traps.py`

- [ ] **Step 1: Add columns to `BV2Trap`**
  - `undodgeable: Mapped[bool]` (default=False)
  - `attack_bonus: Mapped[int]` (default=0)
  - `dot_effect_json: Mapped[str|None]` (nullable Text)
  - `charges: Mapped[int]` (default=1, -1=∞)
  - `charges_used: Mapped[int]` (default=0)
  - `is_armed: Mapped[bool]` (default=True)

- [ ] **Step 2: Generate & apply Alembic migration**

### Task 2: Backend trap trigger logic

**Files:**
- Create: `app/routers/builder_v2/traps.py`
- Modify: `app/routers/map/tokens.py`
- Modify: `app/routers/builder_v2/__init__.py`

- [ ] **Step 3: Write `check_trap_trigger()`**
  - Query `BV2Entity` type="trap" at character (col,row)
  - Load `BV2Trap`
  - Skip if `!is_armed || is_disarmed || (charges!=-1 && charges_used>=charges)`
  - If `!undodgeable`: roll d20+attack_bonus vs character AC
  - If miss: broadcast `trap.triggered` with `missed=true`
  - If hit: `roll_dice(damage_dice)` → apply to `current_hp`
  - If `dot_effect_json`: create `CharacterStatusEffect`
  - Increment `charges_used`; if exhausted → `is_armed=false`
  - Broadcast `trap.triggered` with full payload

- [ ] **Step 4: Wire into `tokens.py`**
  - After successful bv2 grid move (`move-grid` endpoint), call `check_trap_trigger()`

- [ ] **Step 5: Add router to `builder_v2/__init__.py`**

### Task 3: GM trap editor UI

**Files:**
- Modify: `static/js/builder_v2/50-entities.js`

- [ ] **Step 6: Extend trap entity modal**
  - Inputs: damage_dice, damage_type (select), undodgeable (checkbox), attack_bonus (range -5..+10), charges (number, -1=∞), dc_detect, dc_disarm
  - DoT sub-form: dice, type, turns
  - PATCH to new endpoint `PATCH /api/builder-v2/entities/{id}/trap`

### Task 4: Player WS handler

**Files:**
- Create: `static/js/player/19-traps.js`
- Modify: `static/player.html`
- Modify: `static/js/gm/08-websocket.js`

- [ ] **Step 7: Create `19-traps.js`**
  - `ws.on('trap.triggered', d => { ... })`
  - Show toast with damage/miss/DoT info
  - Update HP display

- [ ] **Step 8: Load `19-traps.js` in `player.html`**

- [ ] **Step 9: Add GM WS handler in `08-websocket.js`**
  - Log trap trigger to GM event log

### Task 5: Tests

**Files:**
- Create: `tests/test_trap_trigger.py`
- Create: `tests/e2e/test_trap_e2e.py`

- [ ] **Step 10: Unit test `test_trap_triggers_and_deals_damage`**
  - Undodgeable trap, charges=2. Step twice → HP drops each time. 3rd step → no HP change, is_armed=false.

- [ ] **Step 11: Unit test `test_trap_misses_on_low_roll`**
  - Mock randint to 1 → assert missed=true, HP unchanged.

- [ ] **Step 12: E2E test `test_trap_e2e_damage`**
  - Create trap entity, set undodgeable=true, damage_dice="1d4"
  - Move token onto trap cell via API
  - Assert HP decreased.

### Verification
- [ ] Restart server, hard-reload GM + Player
- [ ] Place trap in builder, move player onto it → toast with damage
- [ ] Run full E2E suite: no regressions
