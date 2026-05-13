# Knave Rules Foundation — Handoff + Multi-Laptop Workflow

## Purpose

This document is for another AI/developer continuing work on this project. It explains:

- What was implemented in the latest Knave-like rules foundation work.
- How to clone/setup the project on another laptop.
- How to work safely from two laptops using Git.
- What still needs to be implemented next.

## Repository

```powershell
git clone https://github.com/DavidLight777/dnd-combat-companio.git
```

Main branch:

```powershell
main
```

Latest pushed commit for this handoff:

```text
d22b565 Add Knave-like rules foundation
```

## Setup on a New Laptop

1. Install required tools:

```text
Git
Python
Node.js
VS Code or Windsurf
```

2. Clone the repository:

```powershell
git clone https://github.com/DavidLight777/dnd-combat-companio.git
```

3. Enter the project folder:

```powershell
cd dnd-combat-companio
```

4. Install Python dependencies if `requirements.txt` exists:

```powershell
pip install -r requirements.txt
```

5. Install Node dependencies if `package.json` exists:

```powershell
npm install
```

6. Apply database migrations:

```powershell
python -m alembic upgrade head
```

7. Start the app using the existing project command/workflow. If unsure, inspect `README`, `main.py`, and existing scripts.

## Required Git Workflow for Two Laptops

Before starting work on either laptop, always run:

```powershell
git pull --rebase origin main
```

After making changes:

```powershell
git status
git add -A
git commit -m "short clear description"
git pull --rebase origin main
git push origin main
```

Important rules:

- Always pull before editing.
- Always commit and push before switching laptops.
- Avoid editing the same files on both laptops at the same time.
- If conflicts appear during `pull --rebase`, resolve them manually, then run:

```powershell
git add -A
git rebase --continue
```

To abort a bad rebase:

```powershell
git rebase --abort
```

For safer parallel work, use feature branches:

```powershell
git checkout -b feature/some-work
git push -u origin feature/some-work
```

Then merge into `main` later.

## What Was Done

### 1. Backend `rules_system` Support

Added session-level ruleset support.

Files changed:

```text
app/models.py
app/schemas.py
app/routers/sessions.py
alembic/versions/k1n2a3v4e5r6_add_rules_system_to_sessions.py
```

Implemented:

- Added `Session.rules_system` with default `legacy`.
- Supported valid values:

```text
legacy
knave_like
```

- Added `rules_system` to session create/output schemas.
- Session creation can now set a rules system.
- Session settings endpoint can update `rules_system`.
- Backend broadcasts `session.rules_system_changed` via WebSocket.

### 2. GM Ruleset Selector

Files changed:

```text
static/gm.html
static/js/gm/01-core.js
static/js/gm/07-session-ops.js
static/js/gm/08-websocket.js
static/js/gm/20-init.js
```

Implemented:

- Added GM topbar dropdown:

```text
Legacy
Knave-like
```

- GM UI loads the current session ruleset.
- GM can switch ruleset with API PATCH.
- GM receives WebSocket updates when ruleset changes.
- `document.body.dataset.rulesSystem` is set for UI branching.

### 3. Player Ruleset Awareness

Files changed:

```text
static/player.html
static/js/player/01-core.js
static/js/player/13-websocket.js
static/js/player/30-init.js
```

Implemented:

- Player loads session info early.
- Player stores current ruleset in `sessionStorage.rules_system`.
- Player body gets `data-rules-system`.
- Player listens for `session.rules_system_changed`.

### 4. Lobby Knave-Like Character Creation Flow

File changed:

```text
static/lobby.html
```

Implemented Knave-like branch when session is `knave_like`:

- Race selection is skipped.
- Player enters optional profile/flavor fields.
- Character joins with no race.
- Rolls `3d6` for six characteristics.
- Allows one stat swap.
- Rolls physical HP and spiritual HP.
- Allows one HP reroll.
- Allows optional starting item proposal for GM approval.
- Finalizes character through Knave endpoint.

### 5. Backend Knave Wizard Endpoints

New file:

```text
app/routers/wizard/knave.py
```

Changed:

```text
app/routers/wizard/__init__.py
app/routers/wizard/items.py
app/routers/sessions.py
```

Implemented endpoints:

```text
POST /api/wizard/{char_id}/knave/profile
POST /api/wizard/{char_id}/knave/roll-stats
POST /api/wizard/{char_id}/knave/swap-stats
POST /api/wizard/{char_id}/knave/roll-hp
POST /api/wizard/{char_id}/knave/reroll-hp
POST /api/wizard/{char_id}/knave/finalize
```

Implemented behavior:

- Knave endpoints only work in `knave_like` sessions.
- Stats are rolled as `3d6` totals.
- One stat swap is tracked in wizard state.
- HP uses physical `d6` and spiritual `d4`.
- One HP reroll is tracked.
- Finalize requires stats and HP rolled.
- Starting item proposal can be used without a rarity roll in Knave flow.

### 6. Ability Usage Policy / Knave Metadata Foundation

Files changed:

```text
app/models.py
app/routers/abilities/common.py
app/routers/abilities/templates.py
static/js/gm/16-abilities.js
alembic/versions/k2n3a4v5e6r7_knave_usage_and_achievements.py
```

Added to `Ability`:

```text
usage_policy
logic: JSON policy for limits such as per_turn, cooldown, per_rest, per_day, charges, duration

automation_level
logic: full, partial, narrative

knave_kind
logic: technique, spell, trait, reaction, ritual
```

GM Ability Editor now shows Knave-specific fields when ruleset is `knave_like`.

### 7. Achievement Foundation

Files added/changed:

```text
app/models.py
app/routers/achievements.py
main.py
alembic/versions/k2n3a4v5e6r7_knave_usage_and_achievements.py
```

Added models:

```text
AchievementTemplate
CharacterAchievement
```

Added router:

```text
/api/achievements
```

Implemented endpoints:

```text
GET /api/achievements/templates
POST /api/achievements/templates
GET /api/achievements/characters/{character_id}
POST /api/achievements/grant
DELETE /api/achievements/characters/{character_id}/{achievement_id}
```

Granting an achievement broadcasts:

```text
achievement.granted
```

### 8. Verification Already Run

The following checks passed before push:

```powershell
python -m compileall main.py app\models.py app\schemas.py app\routers\sessions.py app\routers\wizard app\routers\abilities app\routers\achievements.py
```

```powershell
node --check static/js/gm/01-core.js
node --check static/js/gm/16-abilities.js
node --check static/js/player/10-map.js
```

Alembic head checked:

```powershell
python -m alembic -c alembic.ini heads
```

Expected current head includes:

```text
k2n3a4v5e6r7
```

## Important Notes from Rebase

During push preparation, local branch was:

```text
ahead 25, behind 3
```

A `pull --rebase origin main` was performed and conflicts were resolved mainly in:

```text
static/gm.html
static/player.html
static/js/player/10-map.js
```

Resolved approach:

- Keep split `static/js/map-canvas/*` files.
- Keep Pixi cookie-gated loader blocks.
- Keep Knave cache-bust values for changed files:

```text
gm/01-core.js?v=knave1
gm/07-session-ops.js?v=knave1
gm/08-websocket.js?v=knave1
gm/16-abilities.js?v=knave1
gm/20-init.js?v=knave1
player/01-core.js?v=knave1
player/13-websocket.js?v=knave1
player/30-init.js?v=knave1
```

## What Still Needs To Be Done

### 1. Manual Browser Verification

Run the app and verify both GM and Player sides.

Checklist:

- Create or open a session.
- In GM topbar switch ruleset to `Knave-like`.
- Confirm no console errors.
- Confirm player receives ruleset change.
- Join from lobby as a new player.
- Verify Knave creation flow:

```text
Profile
3d6 stats
stat swap once
HP roll
HP reroll once
optional item proposal
finalize
enter player sheet
```

- Verify legacy session still uses old race/item/stat wizard.

### 2. Apply Migrations on Runtime Database

Run:

```powershell
python -m alembic upgrade head
```

If using a copied local `database.db`, make sure migrations are applied there too.

### 3. Finish Usage Policy Enforcement

Currently `usage_policy` is stored and editable, but not fully enforced during ability use.

Need to implement:

- Per turn limits.
- Cooldowns.
- Per rest/per day limits.
- Charges.
- Duration tracking.
- Reset rules for rest/day/session.
- UI display for remaining uses.

Likely files to inspect:

```text
app/routers/abilities/use.py
app/routers/abilities/character_ab.py
static/js/player/26-abilities.js
static/js/gm/16-abilities.js
```

### 4. Integrate Achievements in UI

Backend exists, but GM/player UI is not complete.

Need to add:

- Player Achievements tab/panel.
- GM achievement template management UI.
- GM grant/remove achievement UI per character.
- Player toast/list refresh on `achievement.granted`.
- Apply achievement effects to stat/combat calculations where systemic.

Likely files:

```text
static/player.html
static/js/player/*
static/gm.html
static/js/gm/*
app/game_mechanics.py
app/routers/characters/*
```

### 5. Effect Engine Expansion

The existing app already supports JSON effects for items/abilities/statuses. The next AI should extend this carefully.

Need to support systemic effect types such as:

```text
damage_reduction_pct by damage_type
damage_reduction_flat by damage_type
radius / aoe targeting parameters
duration_turns
conditional trigger metadata
attack/damage modifiers by source/type
```

Do not automate purely narrative spells. Use:

```text
automation_level = narrative
```

for narrative-only abilities.

Likely files:

```text
app/game_mechanics.py
app/routers/combat_events/attack.py
app/routers/abilities/use.py
app/routers/inventory/character_inv.py
app/routers/status_effects.py
```

### 6. GM-Approved Player-Created Abilities

Not finished yet.

Need to implement:

- GM grants permission to a player to propose an ability/technique/spell.
- Player proposal form.
- GM approval/rejection flow.
- Approved proposal creates an `Ability` or assigns to character.
- Proposal should support `usage_policy`, `automation_level`, `knave_kind`, and JSON effects.

Reuse existing starting item proposal/approval pattern in:

```text
app/routers/wizard/items.py
app/routers/wizard/gm.py
static/js/gm/08-websocket.js
static/lobby.html
```

### 7. Knave Character Sheet Polish

Need to adapt display for Knave-like sessions:

- Hide/de-emphasize race.
- Hide/de-emphasize rarity/level where not useful.
- Show Knave profile fields from wizard data.
- Show spiritual HP clearly.
- Show inventory slots based on Knave logic.
- Show techniques/spells with usage policy.

### 8. Tests to Add

Recommended tests:

- API test: create session with `rules_system=knave_like`.
- API test: update rules system.
- API test: Knave stat roll cannot reroll twice.
- API test: Knave stat swap cannot happen twice.
- API test: Knave HP reroll cannot happen twice.
- API test: Knave finalize requires stats + HP.
- API test: achievements grant/list/delete.
- API test: ability CRUD persists `usage_policy`, `automation_level`, `knave_kind`.

## Safety Rules for Next AI

- Do not remove legacy rules behavior.
- Do not remove rarity/level fields globally; only hide or de-emphasize them in Knave UI.
- Do not hardcode a single spell list.
- Do not automate narrative-only effects.
- Prefer extending existing JSON effect structure instead of creating a parallel system unless absolutely necessary.
- After JS changes, update cache-bust query strings or remind user to hard reload.
- After Python model changes, create Alembic migrations.
- After migrations, run:

```powershell
python -m alembic heads
python -m compileall main.py app
```

- Before pushing:

```powershell
git status
git pull --rebase origin main
git push origin main
```

## Current Completion Status

Completed:

- Backend ruleset field and migration.
- GM ruleset selector.
- Player ruleset awareness.
- Lobby Knave branch.
- Knave wizard API.
- Ability metadata/usage policy storage foundation.
- Achievement backend foundation.
- Git commit and push to GitHub.

Remaining:

- Full manual browser verification.
- Usage policy enforcement.
- Achievement UI and effect application.
- Player-created ability proposal/approval flow.
- Combat/effect engine expansion for typed reductions and conditional systemic effects.
- Knave character sheet polish.
- Automated tests for the new foundation.
