# Archived documentation

These documents describe completed refactors and historical decisions.
Kept for reference but not actively maintained.

## Contents

- **`BACKEND_SPLIT_REPORT.md`** — Full report of the backend router split
  refactor (2026-04-26). Documents how `combat_events.py`, `abilities.py`,
  `map_builder.py`, `inventory.py`, `characters.py`, `map.py`, `wizard.py`,
  and `economy.py` were split into modular packages. Includes a follow-up
  improvement plan (smoke tests, ruff config, dev.ps1, etc.).

- **`SPLIT_PLAN.md`** — Original plan for splitting `static/js/player-app.js`
  (~5000 lines) into modules under `static/js/player/`. Executed.

- **`USER_REQUESTS_LOG.md`** — Historical log of user requests and decisions
  during the rework v3 phase. Useful context for understanding why some
  features exist.

## Live documents (in repo root)

- **`README.md`** — Project entry point
- **`MECHANICS.md`** — Game mechanics reference (live)
- **`EVENTS.md`** — WebSocket event protocol (live)
