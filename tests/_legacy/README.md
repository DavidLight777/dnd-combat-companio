# Legacy stage tests (pre-Rework v2)

These were written against the pre–Rework v2 schema and API surface:

- `Character.class_id`, stat defaults of `2`, `armor_class=10`, `mana_max=0`
- The one-shot character-creation flow (no wizard, no GM approval)
- Classes (instead of professions) on character join
- Abilities without rarity / starting pool / uses

After the destructive Rework v2 migration (Apr 18 2026) almost every one
of these tests is broken by construction (schema assertions fail, hard-coded
character IDs no longer exist, etc.). They are **not** auto-discovered by
pytest and are kept here for historical reference only.

The replacement regression file is `tests/test_rework_v2.py`. It spins up a
fresh session each run, walks the full 6-step wizard, and asserts the new
invariants end-to-end.
