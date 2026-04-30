# Phase 17 — Map Objects, Lighting Fix, Token Restriction, Trap Overhaul

**Assigned to:** Kimi
**Author:** Cascade
**Date:** 2026-04-29

> **READ FIRST: `docs/REAL_TESTING.md`.** Rules apply without exception:
> 1. Every fix needs a test that FAILS before and PASSES after. No test = not done.
> 2. Do NOT add `?v=` cache-bust strings. No-cache headers in `main.py` already cover this.
> 3. After any backend change: restart server. After any JS change: hard-reload (Ctrl+Shift+R) BOTH GM and player tabs.
> 4. Verify BOTH GM and player sides after any map/canvas/WS change — they use different load paths.
> 5. Never use `||` for numeric defaults in JS — use `??`. Never use `or` for numeric defaults in Python — use `is not None else`.
> 6. WS events: every broadcast needs a matching listener in BOTH `static/js/gm/08-websocket.js` AND `static/js/player/10-map.js`.
> 7. Before saying "done": restart server → hard-reload GM → hard-reload Player → confirm visuals, drag, WS on both → no console errors.

---

## Root Cause Analysis (read before writing any code)

### Issue 1 — Chests / Portals / Traps not visible on map
`files.py` returns `_mapChests` and `_traps` in the `/api/map/{code}` bv2 response (lines 335-370).
**But `_portals` is completely absent from that response.**
`player/10-map.js:51` calls `canvas.setPortals(state._portals || [])` — gets `undefined → []`.
GM `06-map-main.js:172` fetches portals from the legacy `/api/map-builder/` endpoint — misses bv2 entirely.
Also verify: `BV2Entity` type `"portal"` exists in the builder, but check whether a `BV2Portal` or equivalent data record exists in `models.py`.

### Issue 2 — Ambient light is dark for player even at ambient=1.0
`lighting.js:84`: `darkAlpha = this.isIndoor ? 0.88 : Math.max(0, 1 - ambient)`.
At `ambient=1.0` → `darkAlpha=0` → no darkness. Correct.
**But:** `lighting.js:90-148` — for `role='player'` the code always draws `fillRect 'rgba(0,0,0,0.97)'` (line 104) when the token is found, ignoring `darkAlpha` completely.
When the player has no token on the map (line 143) → uses `darkAlpha` → at `ambient=1.0` the map is bright.
**Root cause candidate:** `ownCharacterId == null` or `own.x == null` → falls into `else` branch → full darkness.
Also: `fog_enabled = bool(character_id) and bool(revealed_cells)` — `revealed_cells` is empty until the player moves → fog system may not activate at all → `_renderLightingOverlay` may not be called. Check `render.js` for the call site.

### Issue 3 — Token movement: player can drag anywhere
`events.js` drop handler does not check distance against `movement_left`.
The `onTokenMove` callback fires with any target coordinates.
Fix: before calling `onTokenMove` in `events.js`, compute Chebyshev distance from current cell to drop cell and reject if `dist > own.movement_left` (skip check when `movement_left == null` = outside combat).

### Issue 4 — Trap architecture is outdated
Two trap models exist: `MapTrap` (legacy, floor-based) and `BV2Trap` (bv2 entity-based).
`files.py:255` calls `await db.get(BV2Trap, e.id)` — verify `BV2Trap` exists in `models.py` with correct schema.
The existing `BV2Trap` fields are minimal. New architecture needs: `damage_dice`, `damage_type`, `undodgeable`, `attack_bonus`, `dot_effect_json`, `charges`, `charges_used`, `is_armed`, `is_disarmed`, `dc_detect`, `dc_disarm`.

---

## Round 1 — Slider UI for New Light modal

### File: `static/js/builder_v2/70-lights.js`

In `openLightModal()`, replace `<input type="number">` with `<input type="range">` + inline value label for:
- `radius_cells` (0–20, step 0.5)
- `bright_radius_cells` (0–20, step 0.5)
- `intensity` (0–2, step 0.05)

Template for each field:
```html
<label>RADIUS (CELLS)
  <div style="display:flex;align-items:center;gap:8px">
    <input type="range" id="li-radius" min="0" max="20" step="0.5" value="4"
           style="flex:1" oninput="this.nextElementSibling.textContent=this.value">
    <span style="width:32px;text-align:right">4</span>
  </div>
</label>
```

Live preview: on `oninput` for any slider — if `S.view` exists — update the preview light in `S.view.lights` and call `S.view.render()`. Remove preview entry on modal close.

### Test: `tests/e2e/test_light_modal_sliders.py`
- Open builder, click "New Light"
- Set radius slider to 8 via JS `dispatchEvent(new Event('input'))`
- Assert the value label shows "8"
- Save → `GET /api/builder-v2/locations/{id}/lights` → assert `radius_cells == 8`

### Verification checklist
- Hard-reload GM tab after JS change
- Open New Light modal → drag all three sliders → confirm canvas updates live (no page reload needed)

---

## Round 2 — Fix Map Objects Visibility (Chests, Portals, Traps)

### Step A — Backend: add `_portals` to `/api/map/{code}` bv2 response

**`app/routers/map/files.py`** — in the bv2 state builder function (around line 218–370),
after the `chests` block add a `portals` block:

```python
# Portals (BV2 entities of type "portal")
portals = []
for e in entities:
    if e.entity_type != "portal":
        continue
    portals.append({
        "id": e.id,
        "x": (e.col + 0.5) / cols,
        "y": (e.row + 0.5) / rows,
        "col": e.col,
        "row": e.row,
        "name": e.name or "Portal",
        "visible_to_players": e.visible_to_players,
    })
```

Add `"_portals": portals` to the `return` dict.

### Step B — Frontend: consume `_portals` and `_traps` from bv2 state

**`static/js/gm/06-map-main.js`** — in the bv2 state block (where `bv2_active_location_id` is set),
add after existing `setAmbientLight` / `setLights` calls:
```js
if (state._portals) mapCanvas.setPortals(state._portals);
if (state._traps)   mapCanvas.setTraps(state._traps);
```
Currently portals are only fetched for legacy floors (lines 168–176). Add the bv2 branch.

**`static/js/player/10-map.js`** — `state._portals` and `state._traps` are already consumed on lines 49–51.
After Step A these will be populated. No JS change needed — but verify with the test below.

### Test: `tests/e2e/test_map_objects_visible.py`
```python
# Fails BEFORE: _portals missing from API response → canvas.portals.length == 0
# Passes AFTER: _portals present → canvas.portals.length > 0
```
- Create bv2 location, add chest entity + portal entity via builder API
- `GET /api/map/{code}` → assert `_mapChests` and `_portals` are non-empty
- In player page: evaluate `playerMainGrid.portals.length > 0` → assert True
- In GM page: evaluate `mapCanvas.portals.length > 0` → assert True

### Verification checklist
- Restart server (Python changed)
- Hard-reload both tabs
- Place a chest in builder → switch to Map tab (no reload) → chest icon must appear on GM canvas
- Same for portal entity

---

## Round 3 — Fix Ambient Light for Player + GM Map-Lock Toggle

### Step A — Diagnose and fix ambient light for player

**Root cause to verify first** — add a single `console.log` in `player/10-map.js` `applyStateToCanvas`:
```js
console.log('[lighting] ownCharacterId=', canvas.ownCharacterId,
            'token=', (canvas.tokens||[]).find(t=>t.character_id===canvas.ownCharacterId));
```
Open player tab → open map → check console. If `ownCharacterId` is null or token has `x == null`,
that is why the `else` branch fires and the whole map goes dark.

**Fix in `static/js/map-canvas/lighting.js` line 104** — use `darkAlpha` for unexplored instead of hardcoded `0.97`:
```js
// Before:
dctx.fillStyle = 'rgba(0,0,0,0.97)';
// After (unexplored is always darkest but respects ambient):
const unexploredAlpha = Math.max(darkAlpha, 0.85);
dctx.fillStyle = `rgba(0,0,0,${unexploredAlpha})`;
```

**Fix in `player/10-map.js`** — ensure `canvas.ownCharacterId` is set before the first render,
and that tokens are pushed to the canvas before `render()` is called.

Remove the debug `console.log` once confirmed.

### Step B — GM toggle: "Block map for players"

**`app/models.py`** — add field to `Session`:
```python
map_locked_for_players: Mapped[bool] = mapped_column(Boolean, default=False, server_default='0')
```

**Alembic migration** — add `map_locked_for_players` column to `sessions`.

**`app/routers/sessions.py`** — add to the existing PATCH settings endpoint:
```python
if "map_locked_for_players" in body:
    session.map_locked_for_players = bool(body["map_locked_for_players"])
```
Also include it in the GET session response.

**`static/gm.html`** — add button in Map tab toolbar:
```html
<button id="btn-map-lock" class="btn btn-ghost btn-sm">🗺 Map: ON</button>
```

**`static/js/gm/06-map-main.js`** — wire button:
```js
$('#btn-map-lock')?.addEventListener('click', async () => {
  mapLockedForPlayers = !mapLockedForPlayers;
  $('#btn-map-lock').textContent = `🗺 Map: ${mapLockedForPlayers ? 'LOCKED 🔒' : 'ON'}`;
  $('#btn-map-lock').classList.toggle('btn-danger', mapLockedForPlayers);
  await api.patch(`/api/sessions/${SESSION_CODE}/settings`,
                  { map_locked_for_players: mapLockedForPlayers });
  // WS broadcast so player sees it instantly
});
```

**`app/routers/websocket.py`** — add routing for `map.lock_changed` event.

**`static/js/player/10-map.js`** — WS listener:
```js
ws.on('map.lock_changed', d => {
  const panel = document.getElementById('player-map-panel');
  if (!panel) return;
  panel.classList.toggle('map-locked', !!d.locked);
  // Optionally show a toast: "Map access locked by GM"
});
```

**CSS** — add `.map-locked` rule that overlays a dark message over the canvas.

### Test: `tests/e2e/test_map_lock.py`
```python
# Fails BEFORE: no map_locked_for_players field → 422 on PATCH
# Passes AFTER: PATCH succeeds, WS fires, player panel gets .map-locked class
```
- GM PATCH `map_locked_for_players=true`
- Assert player page: `document.getElementById('player-map-panel').classList.contains('map-locked')`

### Test: `tests/test_ambient_light_player.py` (unit)
- Verify that `_renderLightingOverlay` is called when `fog_enabled=False` and `ambient < 1.0`
- Verify that `unexploredAlpha` follows `darkAlpha` when `ambient=1.0`

### Verification checklist
- Restart server (models + routes changed)
- Hard-reload both tabs
- GM: set ambient=1.0 in builder → switch to Map tab → player map must not be fully black
- GM: click "Block map" → player must see locked overlay immediately (no reload)

---

## Round 4 — Token Movement Restriction

### Root cause
`events.js` mouseup handler calls `this.onTokenMove` with any drop coordinates. No distance check.

### Fix: `static/js/map-canvas/events.js`

Save drag start position on mousedown:
```js
// in the token mousedown branch:
this._dragStartX = t.x;
this._dragStartY = t.y;
```

Before calling `this.onTokenMove(...)` in mouseup, add for `role='player'` only:
```js
if (this.role === 'player') {
  const own = (this.tokens || []).find(t => t.character_id === this.dragToken?.character_id);
  if (own && own.movement_left != null) {
    const gs = this.gridSize ?? 50;
    const startCol = Math.floor(this._dragStartX * this.mapWidth / gs);
    const startRow = Math.floor(this._dragStartY * this.mapHeight / gs);
    const endCol   = Math.floor(dropX * this.mapWidth / gs);
    const endRow   = Math.floor(dropY * this.mapHeight / gs);
    // Chebyshev distance (diagonal = 1 cell)
    const dist = Math.max(Math.abs(endCol - startCol), Math.abs(endRow - startRow));
    if (dist > own.movement_left + 0.5) {
      own.x = this._dragStartX;
      own.y = this._dragStartY;
      this.render();
      this._showMovementError(`Not enough movement (need ${dist}, have ${Math.floor(own.movement_left)})`);
      return;
    }
  }
}
```

Add `_showMovementError` method to `MapCanvas.prototype` in `token-anim.js`:
```js
MapCanvas.prototype._showMovementError = function(msg) {
  const el = document.createElement('div');
  el.className = 'map-movement-error';
  el.textContent = msg;
  Object.assign(el.style, {
    position:'absolute', bottom:'60px', left:'50%', transform:'translateX(-50%)',
    background:'rgba(200,50,50,0.9)', color:'#fff', padding:'6px 14px',
    borderRadius:'6px', pointerEvents:'none', zIndex:'999', fontSize:'0.85rem'
  });
  this.canvas.parentElement?.style?.setProperty('position', 'relative');
  this.canvas.parentElement?.appendChild(el);
  setTimeout(() => el.remove(), 2000);
};
```

**Rule:** restriction only applies to `role='player'`. GM is never restricted. Outside combat (`movement_left == null`) player moves freely.

### Test: `tests/e2e/test_token_movement_restriction.py`
```python
# Fails BEFORE: token lands at 5-cell distance even with movement_left=2
# Passes AFTER: token snaps back to start
```
- Start combat, set player `movement_left=2` via API
- Simulate drag to a cell 5 steps away via Playwright
- Assert token position is unchanged (still at original cell)
- Also assert: outside combat (movement_left=None) drag 5 cells succeeds

### Verification checklist
- Hard-reload both tabs
- In combat with movement_left=2: drag player token 3 cells → should fail with error
- Drag 1 cell → should succeed
- Outside combat: drag anywhere → should succeed

---

## Round 5 — Trap System Overhaul

### New architecture
Traps live as `BV2Entity` (type `"trap"`) + a linked `BV2Trap` record (same `id` as FK to `bv2_entities`).

**First: check `models.py` for existing `BV2Trap`.** If it has minimal fields, ALTER it.
If it doesn't exist, create it.

### Step A — Extend/create `BV2Trap` model + Alembic migration

```python
class BV2Trap(Base):
    __tablename__ = "bv2_traps"

    id: Mapped[int] = mapped_column(ForeignKey("bv2_entities.id", ondelete="CASCADE"), primary_key=True)

    # Damage
    damage_dice: Mapped[str] = mapped_column(Text, default="1d6")      # e.g. "2d6+3"
    damage_type: Mapped[str] = mapped_column(String(30), default="piercing")

    # Attack vs AC (or skip AC check entirely)
    undodgeable: Mapped[bool] = mapped_column(Boolean, default=False, server_default='0')
    attack_bonus: Mapped[int] = mapped_column(Integer, default=0)

    # DoT effect (poison, acid, etc.) — reuses existing status effect system
    # Format: {"dice": "1d4", "type": "poison", "turns": 3, "status_template_id": null}
    dot_effect_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Charges: -1 = infinite
    charges: Mapped[int] = mapped_column(Integer, default=1)
    charges_used: Mapped[int] = mapped_column(Integer, default=0)

    # State
    is_armed: Mapped[bool] = mapped_column(Boolean, default=True, server_default='1')
    is_disarmed: Mapped[bool] = mapped_column(Boolean, default=False, server_default='0')

    # Detection / disarm DCs
    dc_detect: Mapped[int] = mapped_column(Integer, default=12)
    dc_disarm: Mapped[int] = mapped_column(Integer, default=14)
```

Alembic migration: `ALTER TABLE bv2_traps ADD COLUMN ...` for new fields (use `server_default` for all Boolean/Integer additions to avoid NOT NULL errors on existing rows).

### Step B — Auto-trigger on token move

**`app/routers/map/tokens.py`** — after position update, before broadcast:
```python
if bv2_loc and c.col is not None and c.row is not None and not edge_transitioned:
    from app.routers.builder_v2.traps import check_trap_trigger
    await check_trap_trigger(db, bv2_loc, c, sess)
```

**`app/routers/builder_v2/traps.py`** — new file:
```python
async def check_trap_trigger(db, loc, character, session):
    """Fire trap if character stepped on its cell."""
    # 1. Find BV2Entity type="trap" at (character.col, character.row) in this location
    # 2. Load BV2Trap by entity.id
    # 3. If not trap.is_armed or trap.is_disarmed: return
    # 4. If trap.charges != -1 and trap.charges_used >= trap.charges: return
    #
    # 5. Attack roll (unless undodgeable):
    #    hit_roll = random.randint(1, 20) + trap.attack_bonus
    #    if hit_roll < character.armor_class: miss — broadcast trap.triggered(missed=True); return
    #
    # 6. Damage: use existing roll_dice(trap.damage_dice) from game_mechanics.py
    #    Apply damage to character.current_hp (same pattern as combat_actions.py)
    #
    # 7. DoT: if trap.dot_effect_json, create CharacterStatusEffect using the template
    #    (reuse apply_status_effect logic from status_effects.py)
    #
    # 8. Update trap: charges_used += 1; if charges != -1 and charges_used >= charges: is_armed = False
    # 9. await db.commit()
    #
    # 10. Broadcast "trap.triggered":
    #     { character_id, trap_id, trap_name, damage, damage_type, hit, missed,
    #       new_hp, max_hp, dot_applied, dot_name, dot_turns }
```

### Step C — GM editor UI for trap entity

**`static/js/builder_v2/50-entities.js`** — extend the trap entity modal with:

```
[ Name ] [ damage_dice input ] [ damage_type select: piercing/slashing/fire/poison/acid/... ]
[ Charges: number (-1=∞) ] [ ☐ Undodgeable ] [ attack_bonus: range -5..+10 ]
[ DC Detect: range 5..25 ] [ DC Disarm: range 5..25 ]
[ DoT Effect (optional):
    dice: __  type: __  turns: __ ]
[ ☐ Armed ] [ Save ] [ Reveal to players ] [ Disarm ] [ Delete ]
```

Sliders for `dc_detect`, `dc_disarm`, `attack_bonus`.

PATCH to `PATCH /api/builder-v2/entities/{id}/trap` (new endpoint) to update BV2Trap fields.
Or extend existing entity PATCH to forward trap-specific fields.

### Step D — GM buttons: Reveal and Disarm

In the entity/trap sidebar add:
- **Reveal** → `PATCH /api/builder-v2/entities/{id}` with `{ visible_to_players: true }` → WS `bv2.entity_updated`
- **Disarm** → `PATCH /api/builder-v2/entities/{id}/trap` with `{ is_disarmed: true }` → WS `trap.disarmed`

### Step E — Player WS handler

**`static/js/player/19-traps.js`** (new file, loaded in `player.html`):
```js
ws.on('trap.triggered', d => {
  if (d.character_id !== CHAR_ID) return;
  if (d.missed) {
    showToast(`⚠️ Trap! It missed you (${d.trap_name})`);
  } else {
    showToast(`⚠️ TRAP! ${d.trap_name} dealt ${d.damage} ${d.damage_type} damage!`);
    if (d.dot_applied) showToast(`☠️ ${d.dot_name} applied (${d.dot_turns} turns)`);
    renderHP(d.new_hp, d.max_hp);
  }
});
```

**`static/js/gm/08-websocket.js`** — add listener for `trap.triggered` to log it in GM event log.

### Tests

**`tests/test_trap_trigger.py`** (unit — fails before, passes after):
```python
# test_trap_triggers_and_deals_damage — undodgeable trap, charges=2
#   Step on it twice → HP decreases each time, charges_used increments
#   Step on it 3rd time → HP unchanged, is_armed=False
# test_trap_misses_on_low_roll — dodgeable trap with high AC character
#   Mock randint to return 1 → assert missed=True, HP unchanged
# test_trap_dot_applies_status — trap with dot_effect_json
#   After trigger → CharacterStatusEffect row exists for the character
```

**`tests/e2e/test_trap_e2e.py`** (fails before, passes after):
- Create trap entity at cell (3,3), `undodgeable=True`, `damage_dice="1d4"`
- GET character HP baseline
- PATCH token to (3,3) via API
- GET character HP → assert it decreased
- PATCH token to (3,3) again (second charge) → HP decreases again
- PATCH token to (3,3) a 3rd time (charges exhausted) → HP unchanged

### Verification checklist
- Restart server (new migration + new router)
- Hard-reload both tabs
- Builder: place trap, set damage_dice="2d6", undodgeable=ON, charges=1
- Move player token onto trap cell → player sees toast with damage
- Trap disappears from map after 1 charge

---

## Execution order

```
Round 1 → Round 2 → Round 3 → Round 4 → Round 5
```

Each round = separate report with full `pytest` output.
The "done" checklist for each round:
```
1. New test file listed
2. pytest before-fix: FAILED
3. pytest after-fix:  PASSED
4. Full suite: no regressions
5. Manual verify: GM tab + Player tab both checked
```

---

## Files changed (summary)

| File | Round |
|------|-------|
| `static/js/builder_v2/70-lights.js` | 1 |
| `app/routers/map/files.py` | 2 |
| `static/js/gm/06-map-main.js` | 2, 3 |
| `static/js/player/10-map.js` | 2, 3 |
| `static/js/map-canvas/lighting.js` | 3 |
| `static/js/map-canvas/token-anim.js` | 4 |
| `app/models.py` | 3, 5 |
| `app/routers/sessions.py` | 3 |
| `app/routers/websocket.py` | 3, 5 |
| `static/gm.html` | 3 |
| `static/js/map-canvas/events.js` | 4 |
| `app/routers/map/tokens.py` | 5 |
| `app/routers/builder_v2/traps.py` | 5 (new) |
| `static/js/builder_v2/50-entities.js` | 5 |
| `static/js/player/19-traps.js` | 5 (new) |
| `static/js/gm/08-websocket.js` | 5 |
| `static/player.html` | 5 (new script tag) |
| Alembic migration | 3, 5 |
