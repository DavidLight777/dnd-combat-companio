# Phase 9 — Round 2 (cleanup + finish)

**Hand-off to K2.6 round 2.** Round 1 closed 80% of Phase 9. This plan finishes the remaining 20%: one runtime bug, one helper extraction, two UX features explicitly listed as incomplete in the round-1 status report.

---

## 0. Hard rules

All §0 rules from `docs/PHASE_9_PLAN.md` still apply. Specifically:
- TDD where reasonable (D.2-extract gets a test, UI tasks get manual verification only).
- Minimal upstream fixes — no opportunistic refactors.
- No anti-patterns (`props_json`, hardcoded numerics, `or N` defaults, etc.).
- Run `.\dev.ps1 check` after every task. Target: still **68 passing minimum** after each, growing to **70+** by the end (D.2-extract test, optional door-peek test).

---

## 1. Tasks — execute in order

### Task R1 — Fix `SESSION_CODE` → `SESSION_ID` in NPC template dropdown

**Severity:** runtime bug — dropdown is silently empty, blocks the entire D.2 NPC auto-spawn flow because users cannot pick a template.

**File:** `@c:\Users\Litun\Desktop\DND Project\dnd-companion\static\js\builder_v2\50-entities.js:256`

**Change:**

```js
// before
const tpls = await api.get(`/api/npc-library/templates?session_id=${SESSION_CODE}`);

// after
const tpls = await api.get(`/api/npc-library/templates?session_id=${SESSION_ID}`);
```

**Why:** `/api/npc-library/templates` accepts `session_id: int` (see `@app/routers/npc_library.py:202-203`). `SESSION_CODE` is the session string (e.g. `"IRON-9803"`); `SESSION_ID` is the integer global declared in `@static/js/gm/01-core.js:19`. All other consumers (`gm/05-npc-sidebar.js:17`, `gm/14-npc-library.js:18`) already use `SESSION_ID`.

**Verify:** open the bv2 builder, place an `npc_spawn` entity, open its edit modal — the "NPC Template" dropdown must list all session NPC templates by name.

No test required (UI surface).

---

### Task R2 — Extract `spawn_npc_from_template` helper, de-duplicate seeding

**Severity:** anti-pattern violation logged in round-1 review. Plan §D.2 (line 378 of `docs/PHASE_9_PLAN.md`) explicitly: *"Never duplicate the seeding logic."* Round-1 inlined ~50 lines into `activate_location` that already exist in `npc_library.spawn_from_template`.

**Step 1 — create the helper.** New file `@c:\Users\Litun\Desktop\DND Project\dnd-companion\app\routers\builder_v2\spawns.py`:

```python
"""Shared NPC spawn helper — used by legacy /api/npc-library/templates/{id}/spawn
and by the bv2 activate_location auto-spawn hook. Keep these two callsites in
sync by funnelling them through this single function.
"""

import json

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Character, InventoryItem, NpcShopInventory, NpcTemplate


async def spawn_npc_from_template(
    db: AsyncSession,
    template: NpcTemplate,
    *,
    session_id: int,
    count: int = 1,
    location_id: int | None = None,
    col: int | None = None,
    row: int | None = None,
) -> list[Character]:
    """Spawn `count` Character rows from `template`. Returns the created
    characters (already flushed but NOT committed — caller commits).

    `location_id`/`col`/`row` set bv2 grid placement when provided; legacy
    callers that put NPCs on the legacy MapFloor leave them None.
    """
    spawned: list[Character] = []
    for i in range(count):
        suffix = f" #{i+1}" if count > 1 else ""
        char = Character(
            session_id=session_id,
            name=f"{template.name}{suffix}",
            is_npc=True,
            is_gm_controlled=True,
            max_hp=template.max_hp,
            current_hp=template.max_hp,
            spiritual_max_hp=template.spiritual_max_hp,
            spiritual_hp=template.spiritual_max_hp,
            mana_max=template.mana_max,
            mana_current=template.mana_max,
            armor_class=template.armor_class,
            strength=template.strength,
            dexterity=template.dexterity,
            constitution=template.constitution,
            intelligence=template.intelligence,
            wisdom=template.wisdom,
            charisma=template.charisma,
            initiative_bonus=template.initiative_bonus,
            token_color=template.token_color,
            notes=template.notes,
            current_location_id=location_id,
            col=(col if col is not None else 0),
            row=(row if row is not None else 0),
        )
        db.add(char)
        await db.flush()

        equipment_ids = json.loads(template.default_equipment) if template.default_equipment else []
        for item_id in equipment_ids:
            db.add(InventoryItem(
                character_id=char.id, item_id=item_id, quantity=1, is_equipped=True,
            ))

        if template.is_merchant:
            shop_items = json.loads(template.shop_items) if template.shop_items else []
            for si in shop_items:
                db.add(NpcShopInventory(
                    npc_id=char.id,
                    item_id=si.get("item_id"),
                    stock=si.get("stock"),
                    price_override_copper=si.get("price_override"),
                ))

        spawned.append(char)
    return spawned
```

**Step 2 — wire `npc_library.spawn_from_template` (legacy) to the helper.**

`@c:\Users\Litun\Desktop\DND Project\dnd-companion\app\routers\npc_library.py:276-332`:

Replace the inline per-iteration body with a single call:

```python
from app.routers.builder_v2.spawns import spawn_npc_from_template

@router.post("/templates/{template_id}/spawn")
async def spawn_from_template(template_id: int, body: SpawnBody, db: AsyncSession = Depends(get_session)):
    t = await db.get(NpcTemplate, template_id)
    if not t:
        raise HTTPException(404, "Template not found")

    chars = await spawn_npc_from_template(db, t, session_id=body.session_id, count=body.count)
    spawned = [{"id": c.id, "name": c.name} for c in chars]
    await db.commit()
    # … keep the existing broadcast block exactly as-is …
```

**Step 3 — wire `activate_location` (bv2) to the helper.**

`@c:\Users\Litun\Desktop\DND Project\dnd-companion\app\routers\builder_v2\locations.py:391-443`:

Replace the inlined Character/InventoryItem/NpcShopInventory creation with:

```python
from app.routers.builder_v2.spawns import spawn_npc_from_template

# inside the spawns_q loop:
for ent, spawn in spawns_q.all():
    t = await db.get(NpcTemplate, spawn.npc_template_id)
    if not t:
        continue
    if not m:
        # Defensive: locations should always have a parent map; if not,
        # skip rather than write a wrong session_id.
        continue
    await spawn_npc_from_template(
        db, t,
        session_id=m.session_id,
        count=spawn.spawn_count,
        location_id=location_id,
        col=ent.col,
        row=ent.row,
    )
    spawn.has_spawned = True
```

This also fixes the round-1 logical bug `session_id=m.session_id if m else loc.map_id` (writing a `bv2_maps` PK into a `sessions` FK).

**Step 4 — remove now-unused imports** from `locations.py`: `InventoryItem`, `NpcShopInventory` (and `json` if only used for spawn). Run `.\dev.ps1 check` — ruff will flag unused imports if left behind.

**Step 5 — test.** Add to `tests/test_smoke.py`:

```python
@pytest.mark.asyncio
async def test_phase9_spawn_helper_dedupes_seeding(client, session_id, gm_token):
    # Create an NPC template
    tpl = (await client.post("/api/npc-library/templates",
        json={"session_id": session_id, "name": "Goblin",
              "max_hp": 10, "armor_class": 12,
              "strength": 8, "dexterity": 14, "constitution": 10,
              "intelligence": 6, "wisdom": 8, "charisma": 6,
              "spiritual_max_hp": 0, "mana_max": 0, "initiative_bonus": 0,
              "token_color": "#666"})).json()

    # Legacy path
    legacy = (await client.post(f"/api/npc-library/templates/{tpl['id']}/spawn",
        json={"session_id": session_id, "count": 2})).json()
    assert len(legacy["spawned"]) == 2

    # bv2 path — create map, location, npc_spawn entity, activate
    # … (build fixtures as in existing test_phase9_npc_auto_spawn_on_enter) …
    # Assert 2 characters created with correct location_id/col/row.
```

If a similar test for bv2-spawn already exists, just verify both paths still pass after the refactor — no need for a new combined test.

---

### Task R3 — Builder UI for interior zone painting (C.5 from main plan)

**Severity:** UX gap — round 1 noted "Interior zones can only be created via API/tests". User asked for buildings as paintable zones.

**Goal:** GM clicks a "Zone" button in the TERRAIN panel, drags across cells to define a zone, names it, sees it appear as an item in a "Interior Zones" list with edit/delete buttons.

**File:** `@c:\Users\Litun\Desktop\DND Project\dnd-companion\static\gm.html` — find the existing TERRAIN panel block (anchored by `id="bv2-brush-floor"` or similar). Add a new button:

```html
<button id="bv2-brush-zone" class="bv2-brush" title="Interior zone (building/cave)">
  <span class="brush-icon" style="background:rgba(255,200,80,0.35);border:1.5px dashed #ffa726">▦</span>
  <span class="brush-label">Zone</span>
</button>
```

Also add a list container below the TERRAIN panel:

```html
<div id="bv2-interior-list" class="bv2-section" style="display:none">
  <div class="bv2-section-title">Interior Zones</div>
  <div id="bv2-interior-list-items"></div>
</div>
```

**File:** new `static/js/builder_v2/95-interiors.js` (loaded after `90-library.js`). Wire:

- Click on `#bv2-brush-zone` → enter "zone-paint" mode (similar pattern to existing brush selection in `30-editor.js`). While in this mode, single-click adds/removes a cell from a pending zone set; rendered as a yellow dashed overlay on the canvas (use `S.view.setPendingZone(cells)` — add this setter to the canvas wrapper, narrow addition).
- Press Enter / click "Save Zone" → prompt for name, POST `/api/builder-v2/locations/{loc_id}/interiors` with `{name, kind: "building", reveal_mode: "on_enter", cells: [...]}`. On success: clear pending, refresh list.
- Render `#bv2-interior-list-items` from `S.view.location.interiors` (need to expose it — ensure `getLocationFull` response includes interiors; if not yet, add to the response in `app/routers/builder_v2/locations.py` `get_location_full`).
- Edit/Delete buttons per zone.

**Manual verification (mandatory before declaring done):**

1. Open bv2 builder, select Location, click "Zone" brush.
2. Click 9 cells in a 3x3 area. They show with a dashed yellow outline.
3. Press Enter, name it "Shop". Modal/prompt accepts.
4. The new zone appears in the Interior Zones list.
5. Click Apply to Game → switch to Map tab → the 3x3 area is darkened (player view; GM sees soft preview).
6. Place a player character via legacy character flow → walk into the zone → it reveals.

Do NOT mark this task done if step 6 fails.

---

### Task R4 — Door peek (C.4 from main plan)

**Severity:** UX gap — round 1 left this with "no GM right-click toggle UI and no 2-cell-deep cone peek". User explicitly described this behaviour.

**Step 1 — GM toggle UI.**

In `@c:\Users\Litun\Desktop\DND Project\dnd-companion\static\js\map-canvas.js`, the existing right-click handler (grep for `contextmenu` and `role !== 'gm'`) currently shows a token context menu. Extend it to also detect when the right-click target cell has a tile of `tile_type === 'door'` and add a menu item "Toggle door (open/closed)".

When clicked, send `PATCH /api/builder-v2/locations/{loc_id}/tiles` with `set: [{col, row, tile_type: "door", is_open: !current}]`. The existing tiles PATCH endpoint already accepts `is_open` since round 1 added the column.

**Verification: read the existing tiles PATCH endpoint** (grep `@app/routers/builder_v2/locations.py` for `patch_tiles` or similar) and confirm it persists `is_open`. If not — add it. This must work before Step 2.

**Step 2 — peek render.**

In `@c:\Users\Litun\Desktop\DND Project\dnd-companion\static\js\map-canvas.js`, function `_renderInteriorOverlay` (added in round 1):

For each interior zone in `on_enter` mode where no player is inside:

1. Compute boundary doors: tiles where `tile_type === 'door' && is_open === true`, AND the door's `(col, row)` is adjacent to at least one cell IN the zone AND at least one cell OUTSIDE the zone.
2. For each open boundary door, find any player token whose grid distance to the door is ≤ 3 cells (Chebyshev or Manhattan — pick Chebyshev to match the rest of bv2 vision math; verify by grepping existing distance helpers).
3. If a qualifying player exists for that door, compute the peek cone: BFS from the door 2 cells INTO the zone, collecting up to ~6 interior cells. Add those to a `peekCells` set.
4. When painting the dark overlay over zone cells, SKIP cells that are in `peekCells`.
5. GM-side: always include peek cells regardless of distance (so the GM sees what the players see-or-could-see).

**Step 3 — manual verification.**

1. Builder: paint a 4x4 zone "Shop". Paint a `door` tile on the boundary at (col_X, row_Y).
2. By default door is `is_open=true` (per the round-1 ORM default).
3. Apply to Game. Place player character 2 cells outside the door.
4. Player view: the 4x4 shop is dark, EXCEPT for the 2-cell deep slice through the doorway closest to the player.
5. GM: right-click the door tile → "Toggle door". Player view: peek slice closes; the entire zone is dark again.
6. Toggle back → peek reopens.

**Tests (optional but recommended).** A non-UI smoke test for the boundary-door detection helper if you extract it as a pure function. Skip if the logic stays inline in the renderer.

---

## 2. Order of execution

R1 (1 min) → R2 (~30 min, mostly mechanical + 1 test) → R3 (medium, ~1h UX) → R4 (medium, ~1h UX + render math).

After **each** task, run `.\dev.ps1 check` and report the test count before moving on.

---

## 3. Done definition

- [ ] R1: dropdown lists templates by name in the bv2 npc_spawn modal.
- [ ] R2: `spawn_npc_from_template` exists in `app/routers/builder_v2/spawns.py`. `npc_library.spawn_from_template` and `activate_location` both call it. Inline seeding code removed from both. Tests still green (≥ 69 passing — old D.2 test + new R2 test).
- [ ] R3: GM can paint, name, save, edit, delete an interior zone via the builder UI without touching curl/Postman.
- [ ] R4: door peek works in both directions (open → peek visible, closed → peek hides). GM toggle persists across reloads.
- [ ] `docs/temp_fix.md` appended with a "Phase 9 Round 2" section listing every file modified.
- [ ] `docs/BUILDER_V2_HANDOFF.md` updated test count.
- [ ] `.\dev.ps1 check` clean.

If any item cannot be made true in this round, STOP, document why, and report. Do not partial-ship.

— End of plan.
