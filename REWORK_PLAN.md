# Combat Companion — Rework v2 (Character Creation & Core Mechanics)

> **Single source of truth.** Apr 18 2026. All previous phase notes in this
> document are superseded by what follows.

---

## 0. Principles

1. **No more Classes in character creation.** The old `classes` table and
   `Character.class_id` are removed from the lobby flow. In GM-land, the
   existing `classes` / `CharacterProfession` tables are renamed in the UI
   to **Professions** and are only assigned *after* the character exists.
2. **Existing characters wiped** on migration (destructive, confirmed).
3. **Everyone starts at level 0.** Stats default to **1**. Decline gives
   all stats **0** in exchange for advantage on the starting-feature roll.
4. **Stat value IS the roll bonus** (no ability modifiers). Ex: STR 4 → +4
   to every strength-based roll.
5. **One pool** for "особенность или умение". We extend the existing
   `Ability` table instead of creating a second table.
6. **Combat bottom-bar removed.** Normal/ADV/DISADV toggle, Attack button,
   Defend button, and initiative nameplates go away. Every combat action is
   done from the ACTIONS panel (already implemented).

---

## 1. Character Creation (6 lobby steps)

| # | Title | Player UI | Backend side-effect |
|---|---|---|---|
| 1 | **Identity** | session code, character name, age (int, optional), gender (free text, optional) | stored in pending `CharacterWizardState.data` |
| 2 | **Race** | grid of GM-configured races showing HP die, stat bonuses, description | selected race stored |
| 3 | **Starting Item** | roll d20 → **fixed** rarity (1 ⇒ Broken-Common, 2–9 Common, 10–14 Uncommon, 15–18 Rare, 19–20 Epic). Player fills the form. Weapon: dice count, dice type, hit_stat, damage_stat, damage_type, description. Consumable: effect (heal/buff/DoT), charges, description. Submit → **GM approval queue**. | `wizard.data.starting_item_proposal` |
| 4 | **Stat Choice** | two big buttons:<br>• **Accept** — all stats = 1<br>• **Decline** — all stats = 0 BUT the Step-5 feature roll is made with **advantage** (2d20 keep max) | `character.declined_stats = true/false`; stats written to the DB |
| 5 | **Feature Roll** | d20 (1d20 or 2d20-max based on Step 4) → rarity → d4 → one of the 4 pool entries GM placed in that rarity bucket | grants a `CharacterAbility` automatically (no approval) |
| 6 | **Finalize** | roll race's HP die → `max_hp = hp_dice_count × d(hp_die)`; `mana_max = 10`; `armor_class = 0`; `max_inventory_slots = 10 + 2 × CON` (CON 0 → 10, CON 1 → 12, +2 per CON). Show summary → **Enter Game**. | marks wizard `is_completed`; redirects to `/player`. Item still pending GM approval and appears after it. |

### d20 → rarity (fixed, max Epic)

| d20 | Rarity |
|---|---|
| 1 | Common (flagged *broken*) |
| 2 – 9 | Common |
| 10 – 14 | Uncommon |
| 15 – 18 | Rare |
| 19 – 20 | Epic |

### Level-up (per `update and fix.md`)

* Roll **one** HP die of the race → add to `max_hp` and `current_hp`.
* Choose **exactly one**:
  1. **+1 to two different stats** (each up by one), OR
  2. **Upgrade one existing feature** to the next rarity (auto d4 into the
     upgraded bucket of the GM pool).

XP table: first up needs 100, each next tier +100 (so L0→L1 = 100, L1→L2 =
200, …). Ranks advance per existing chain (>15 crosses rank at level 20).

### Advantage / Disadvantage

* **Advantage** = roll twice, keep higher.
* **Disadvantage** = roll twice, keep lower.
* Applied programmatically by the feature roll (Step 5) and by any ability
  effect saying so. **Never** toggleable by the player in combat UI.

---

## 2. Data-model changes

### 2.1 `Character`

| Field | Before | After |
|---|---|---|
| `class_id` | FK int | **dropped** |
| `strength..charisma` default | 2 | **1** |
| `armor_class` default | 10 | **0** |
| `mana_max` default | 0 | **10** |
| `age` | — | `int \| null` |
| `gender` | — | `str \| null` |
| `max_inventory_slots` | — | `int = 12` |
| `declined_stats` | — | `bool = false` |

### 2.2 `Race`

Add:
* `hp_die: int = 8`
* `hp_dice_count: int = 1`

### 2.3 `Ability` (unified pool)

Add:
* `rarity: str = "common"` — common / uncommon / rare / epic / legendary
* `is_in_starting_pool: bool = false`
* `max_uses: int | null` — null = infinite
* `is_conditional: bool = false` — flavor-only, no mechanic
* `conditional_text: str | null`

### 2.4 `CharacterAbility`

Add:
* `current_uses: int | null` — mirrors `max_uses` at grant time

### 2.5 `CharacterClass` — renamed to "Profession" at the UI level

Keep the ORM class name (internal plumbing) but in lobby/UI:
* Lobby never shows "class" anywhere.
* GM tab renamed "Classes" → "Professions".

### 2.6 Destructive migration

On the migration:
* `DELETE FROM sessions;` (cascades characters, wizard state, inventory,
  character_abilities, character_professions, combat state, etc.).
* All static catalogs (items, races, abilities, classes/profession
  templates, poisons, shops) are kept.

---

## 3. Backend endpoints

### 3.1 `POST /api/sessions/join`

* Remove `class_id` from request. Add `age`, `gender`.
* Always create Character with `strength..charisma = 1` (final decline
  happens in wizard Step 4, which zeroes them out).
* Always atomically create `CharacterWizardState`.

### 3.2 `/api/wizard/{character_id}/…`

| Endpoint | Purpose |
|---|---|
| `GET /api/wizard/{id}` | Current state |
| `POST /api/wizard/{id}/propose-item` | Step 3 submit (rarity from server d20) |
| `POST /api/wizard/{id}/approve-item` | GM approves (creates `Item` + `InventoryItem`) |
| `POST /api/wizard/{id}/reject-item` | GM rejects with note; player retries |
| `POST /api/wizard/{id}/stat-choice` | body `{declined: bool}`; writes stats and advances step |
| `POST /api/wizard/{id}/roll-feature` | Server d20 (2d20-max if declined) → rarity → d4 → picks from `Ability` pool; grants `CharacterAbility` |
| `POST /api/wizard/{id}/finalize` | Rolls HP die of race, computes max_hp/mana/AC/slots, marks wizard done |

### 3.3 `/api/races-classes/races` GET/POST/PUT

Add `hp_die`, `hp_dice_count` in body + response.

### 3.4 `/api/abilities` GET/POST/PUT

Add the 5 new fields.

### 3.5 `/api/characters/{id}/level-up`

```json
{"choice": "stats",          "stat_a": "strength", "stat_b": "dexterity"}
{"choice": "upgrade_feature","character_ability_id": 17}
```
Rolls race HP die server-side, applies the choice atomically.

### 3.6 `/api/abilities/use/{cab_id}`

Uses counter: reject when `current_uses == 0`, decrement otherwise.

### 3.7 Inventory slot enforcement

`POST /api/characters/{id}/inventory/add` — 400 when slots full.

---

## 4. Frontend changes

### 4.1 `static/lobby.html` — full rewrite to §1 (6 steps).

### 4.2 `static/player.html` + `player-app.js`

Delete:
* `.action-bar` (Normal/ADV/DISADV + Attack + Defend)
* The nameplates row next to the turn banner

Keep:
* ACTIONS panel (weapon attack / ability use / dice roller)
* Initiative list as an ordered column in the combat tab

Add:
* Inventory slot meter (`used / max`)
* Features panel with uses-remaining counter
* Identity block (age/gender) on character sheet header

### 4.3 `static/gm.html` + `gm-app.js`

* Rename "Classes" tab → "Professions" everywhere player-facing.
* Race editor: HP die dropdown.
* Abilities editor: 5 new fields + "Starting Pool" filter.
* Wizard approval modal surfaces pending item proposals.

---

## 5. Phased execution

Stop and verify after each phase.

* **α — Schema & models.** Migration + model update + default fixes.
* **β — Backend endpoints.** Wizard rewrite, races/abilities/level-up,
  slot enforcement.
* **γ — Lobby rewrite.** 6-step wizard per §1.
* **δ — Player UI.** Strip combat bar, add slot meter, feature uses.
* **ε — GM UI.** Rename Professions, race HP die, abilities pool.
* **ζ — Level-up UI.** Roll HP + pick stats/upgrade modal.
* **η — Regression & docs.** Author `tests/test_rework_v2.py`, remove dead
  legacy tests.

---

## 6. Open micro-questions (defaults applied)

| # | Question | Default now in effect |
|---|---|---|
| Q1 | Race stat bonuses on top of 0 if declined? | **Yes** — Dwarf decliner with +1 STR still ends at STR 1. |
| Q2 | GM approval UX for proposed item — approve-as-is vs edit-then-approve? | **Edit-then-approve**: modal is editable. |
| Q3 | Can a feature override race HP die? | **Not now** — races only. Add `hp_die_override` later if needed. |
| Q4 | `max_uses` reset policy? | **Total uses**, no auto-reset. GM resets manually. |
| Q5 | Age/gender affect mechanics? | **Cosmetic only.** |
| Q6 | Keep a "basic attack" quick button in ACTIONS panel? | **Yes** — "Attack with equipped weapon" stays there. |

---

## 7. Safety

* Migration is destructive. Run it once after the user says go.
* Keep a git commit right before `α` runs so rollback is trivial.

---

## 8. Rework v3 — delta on top of v2 ✅ SHIPPED

Follow-up pass driven by user feedback after playing with v2. Everything
below is now merged and exercised by `tests/test_rework_v2.py` (75/75 OK).

### Schema (alembic `r3a0b1c2d3e4`, `r4a0b1c2d3e4`)

* Dropped `items.weight` — inventory is purely slot-based now.
* Dropped `characters.hp_dice_count`, `hp_dice_type`, `hp_recovery_modifier`
  — retired with the "Roll & Heal" widget.
* Dropped `classes.hit_die` — professions never consumed it; HP die is
  race-only. (Migration `r4a0b1c2d3e4`.)
* Added `item_weapon_stats.damage_modes` (JSON TEXT) — optional preset
  damage alternatives (e.g. one-handed 1d8 / two-handed 1d10). Empty list
  = single-mode weapon. Players cannot freeform dice anymore; they pick
  a preset. (Migration `r4a0b1c2d3e4`.)

### Attack hit roll — N d20s

* `game_mechanics.apply_advantage` now accepts `dice_count` (1..5).
  `normal` takes the first roll; `advantage` takes the max of N; `disadvantage`
  takes the min of N. Adv/disadv with N=1 is auto-bumped to N=2.
* `calculate_combat_attack` forwards `dice_count` from endpoints.
* `POST /api/combat/hit-roll`, `/execute-attack`, `/combat/{id}/attack`,
  `/calc/attack-roll` all accept `hit_dice_count`. Response exposes
  `all_d20s` and `dice_count_rolled` for transparency.
* Player attack modal: Step 1 now has a `🎲 × [N]` stepper next to
  Disadv / Normal / Adv. "Player combat attack" card and calc panels
  pass `hit_dice_count` as well.

### Damage dice locked to weapon

* Player-facing `POST /api/combat/damage-roll` ignores free-form
  `dice_count` / `dice_type`. The player picks `damage_mode_index` from
  `weapon.damage_modes`; if the weapon has no modes, dice are exactly
  those on the weapon. Invalid index → 400.
* GM item editor grew a "Damage Modes" section that accepts any number
  of presets (name / dice / type / optional stat override). Leaving it
  empty = single-mode weapon (the existing Dice row above is authoritative).
* Player Step 2 UI no longer shows free-form inputs. Single-mode weapons
  display a read-only "Damage: 1d6 (fixed by weapon)" line. Multi-mode
  weapons show a dropdown of the presets.

### AI — full rewrite (envelope protocol + dispatcher)

* Before: `/api/ai/chat` returned free-form text. The GM client regex-matched
  any `{"name":"..."}` blob and POSTed it to `/api/items` — so "make me a
  bandit NPC" silently created an **item** row, and items themselves had
  almost no fields (no stats, no bonuses, no weapon dice, no damage modes).
* Now the AI speaks a strict envelope:
  ```json
  { "say": "<short>", "actions": [ {"kind":"...","payload":{...}} ] }
  ```
  with `kind ∈ create_item | create_npc | create_ability`. The server
  validates every action via the new **in-process dispatcher** (`ai_agent.py`:
  `_dispatch_create_item` / `_dispatch_create_npc` / `_dispatch_create_ability`)
  which writes real DB rows with full schema: bonuses, weapon_stats +
  damage_modes, use_effect, passive_effect, requires_hit_roll, etc. Every
  AI-created row is tagged `created_by_ai=true`.
* `ai_system_prompt.txt` rewritten from 15 lines to a complete but compact
  (~800-token) schema reference: three action kinds, full enum lists for
  category / rarity / bonus_type / damage_type / effect-type / target_type,
  examples for offensive vs healing vs passive abilities, and behaviour
  rules (one clarifying question on ambiguous requests, one action per
  emitted NPC, no markdown fences).
* `build_game_context` trimmed from "every stat + inventory + 10 log lines"
  to "players L/HP, NPCs L/HP, last 3 combat-log lines". Saves ~200-400
  tokens per turn of conversation on a busy session.
* Conversation history truncated 20 → 14 entries (same rationale).
* `/api/ai/generate-npc` kept for backward compatibility but now fed by the
  same envelope prompt, so the returned payload is always the richer
  `create_npc` shape. Preserves original 500 / 502 / 504 semantics.
* GM panel (`static/js/gm-app.js`): regex matching removed. The chat bubble
  shows the parsed `say`; each action becomes its own card
  ("✓ 🎭 NPC created — Gorim (HP 45 · AC 14)"), failed actions render in
  red with the dispatcher error. Relevant list-views (`loadItems`, etc.)
  auto-refresh when an action succeeds, and a toast announces each new row.
* Offline regression phase **ν** in `tests/test_rework_v2.py` exercises
  `parse_envelope` against seven hostile inputs (fenced, prose-wrapped,
  wrong shapes, spam over `MAX_ACTIONS_PER_REPLY`, empty, non-JSON, valid).

### P2P targeting — UI fixes

* Potion / Use-Item picker (`_mountItemConfirm`) previously shipped an
  empty body to `POST /api/inventory/{id}/use`, so consumables silently
  applied to the caster even when the player had a teammate selected at
  the table. It now renders a **Target** dropdown (Self + living
  teammates), defaults to the currently selected table target, and
  forwards `target_id`.
* Ability picker (`_mountAbilityConfirm`) used to hard-filter targets to
  `is_npc` only, making heal / buff / cleanse abilities impossible to aim
  at an ally. The list is now derived from the ability's effects:
  offensive (requires hit-roll or has a damage effect) → NPCs only;
  supportive (heal_hp, restore_mana, restore_hp_by_die, stat_boost,
  apply_status, remove_status) → Self + allies; mixed/unknown → every
  living participant + Self.

### Backend

* `app/websocket_manager.py` — added a `broadcast(session_id, msg)` shim so
  legacy callers (`wizard`, `professions`, `poisons`, `combat_events`) no
  longer silently fail. GM approval toasts are back.
* `app/routers/sessions.py` — new `POST /api/sessions/{code}/full-rest`:
  restores HP, mana, cooldowns, and `current_uses` on every living player;
  broadcasts `session.full_rest`.
* `app/routers/inventory.py` — `POST /api/inventory/{id}/use` accepts
  `{target_id}`, applies heal / mana / buff / debuff to the target. Mana
  cost always stays on the caster.
* `app/routers/inventory.py` — new `POST /api/inventory/{id}/transfer`:
  hands an item to another player; respects slot cap; broadcasts
  `inventory.transferred`.
* `app/routers/abilities.py` — `POST /api/character-abilities/{id}/use`
  honors `target_id` for `heal_hp`, `restore_mana`, `apply_status`,
  `stat_boost`, `remove_status` (previously self-only). New active effect
  `restore_hp_by_die` rolls the caster's race HP die. Passive bonus
  editor gained 5 new types: `max_hp_bonus`, `max_mana_bonus`,
  `mana_regen_bonus`, `hp_die_bonus`, `hp_die_count_bonus`. `max_hp_bonus`
  et al. mutate the character directly and are reversed on unassign.
* `app/routers/characters.py` — level-up HP roll now consults
  `hp_die_bonus` / `hp_die_count_bonus` stat modifiers. Fixed
  `/roll-characteristic` fallback from `10` → `0`.

### Dead-code cleanup

* Removed legacy top-level duplicates: `models.py`, `database.py`,
  `routers/` (characters/effects/modifiers), `debug_buy.py`, empty
  `*.db` files, `static/app.js`, `static/index.html`.

### Frontend

* `static/lobby.html` — Weight (kg) input removed from Step 3.
* `static/player.html`, `player-app.js`:
  * Weight display & "Roll & Heal" dice widget removed.
  * Sidebar stats grid no longer falls back to `10` when a stat is `0`.
  * Inventory card actions gained **💊 Use on…** and **🎁 Give** buttons.
  * Shared `openP2PTargetPicker()` modal (excludes self, filters NPCs
    / alive as needed).
  * WS listeners for `session.full_rest` and `inventory.transferred`
    refresh state + toast.
* `static/gm.html`, `gm-app.js`:
  * Topbar **🌙 Full Rest** button.
  * Item editor Weight input removed.
  * Ability editor: 10 passive bonus types (was 5), new active
    `restore_hp_by_die`.
  * Every D&D-era `|| 10` / `|| 20` default wiped from NPC creation,
    difficulty estimator, AI NPC preview.
  * Quest gold field sent as `reward_gold_bronze` (was silently
    zeroed as `_copper`).
  * Dead `class_id` fallbacks removed (Character.class_id is gone).

### Design defaults chosen during v3 planning

| # | Question | Default |
|---|---|---|
| V3-1 | Heal mechanic outside combat? | **Potions / abilities / GM Full Rest only.** No per-char heal-dice widget. |
| V3-2 | Full Rest scope? | **HP = max, mana = max, cooldowns = 0, uses = max_uses.** Status effects untouched. NPCs untouched. |
| V3-3 | Player-to-Player restrictions? | **None.** Any session member is a valid target. PvP allowed. No range, no combat-only, no GM approval. |
| V3-4 | Item weight? | **Gone.** Inventory is slot-based. |
