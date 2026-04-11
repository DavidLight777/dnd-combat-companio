# ⚔️ DnD Combat Companion

A local desktop web application for managing a custom tabletop RPG combat system.

## Quick Start

```bash
pip install -r requirements.txt
python main.py
```

The app will open automatically at `http://localhost:8000`.

## Features

- **Character Management** — Create, edit, duplicate, and delete characters with full stat blocks
- **Attack & Damage Rolls** — D20 attack rolls with named modifiers, auto-calculated attack bonus, and damage rolls
- **Incoming Damage Calculator** — Apply enemy damage with hit/miss tiers and damage reduction effects
- **HP Recovery** — Dice-based healing with configurable dice and manual HP adjustment
- **Character Effects** — Percent and flat damage reduction effects (armor, shields, etc.)
- **Enemy Damage Calculator** — Standalone panel to calculate damage dealt to enemies
- **Dice Roller** — Global utility for quick rolls
- **Calculation Log** — Last 20 calculations with timestamps
- **Data Export** — Download all character data as JSON
- **Keyboard Shortcuts** — Ctrl+1-9 for character switching, Escape to close panels

## Tech Stack

- **Backend:** Python 3.11+ / FastAPI / SQLAlchemy (async) / SQLite
- **Frontend:** Vanilla JS + CSS (single page app)
- **Database:** Auto-created at `./data/dnd_companion.db`
