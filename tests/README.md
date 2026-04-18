# Tests

## Active: `test_rework_v2.py`

End-to-end regression for the Rework v2 schema and UI surfaces. Runs against
a **live server** (default `http://127.0.0.1:8000`), so do:

```powershell
# terminal 1
python main.py

# terminal 2
python tests/test_rework_v2.py
```

Exit code `0` on success, `1` on any assertion failure, `2` if the server is
unreachable.

Flags:
- `--base http://host:port` — point at a non-local server.

The suite creates a throw-away session per run (it does not touch existing
data). It covers:

- Destructive migration shape (character fields, race `hp_die`)
- Wizard 6-step flow including decline → advantage + slots = 10
- Player surfaces (`slots_used/slots_max`, uses counter, conditional text)
- GM approvals hub (`/wizard/session/{id}/pending`, `/approve-item`)
- Slot enforcement (400 when cap is hit)
- Level-up both paths (`stats`, `upgrade_feature`) and the XP gate

## Archived: `_legacy/`

Pre–Rework v2 stage-based tests. Kept for historical reference but NOT run
by the regression entrypoint. See `_legacy/README.md`.
