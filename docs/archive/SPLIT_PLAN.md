# Plan: Split Large Frontend Files into Modules

## Context

`gm-app.js` (10,273 lines) was already split into **20 modules** under
`static/js/gm/` using **Variant B** (multiple `<script>` tags + shared
script-scope globals, no ES modules). The same approach must be used for the
remaining large files.

**Reference completed split:** `static/js/gm/01-core.js` … `20-init.js` and
`static/gm.html` lines 796–819.

## Targets (in priority order)

| File | Lines | Priority | Notes |
|------|-------|----------|-------|
| `static/js/player-app.js` | **4996** | **HIGH** | Same approach as gm-app.js |
| `static/js/gm/02-characters.js` | 1614 | MEDIUM | Already split once; can sub-split if needed later |
| `static/js/map-canvas.js` | 1624 | LOW | Single ES class — DO NOT split for now (would require refactor) |

Only do **player-app.js** in this pass. Others can be addressed later.

---

## Approach (mandatory)

### 1. Variant B — multi-script + shared globals

- All split files are loaded as plain `<script src="...">` tags in `static/player.html` (no `type="module"`).
- Top-level `let` / `const` / `function` in non-module scripts share the same **script scope** across all `<script>` tags. They see each other automatically — no `import`/`export` needed.
- **Critical rule**: do **NOT** introduce duplicate top-level names across split files. The duplicate-check script catches this.

### 2. Cut by section comment headers

The source file is already organized with section banners like:

```js
// ══════════════════════════════════════════════════════════════
// SECTION NAME
// ══════════════════════════════════════════════════════════════
```

Use these as the natural cut points. Line numbers were captured below.

### 3. Programmatic split, not manual edits

Manual `edit` calls on a 5000-line file are slow and error-prone.
**Use a Python script** that:
- reads the source,
- slices by line ranges,
- writes each chunk to a new file with a header comment,
- prints the `<script>` tags to paste into the HTML.

Then delete the source file and the helper script.

### 4. Verify before declaring success

After splitting, run **two checks**:
- `node --check <file>` on every output module → must all pass.
- A duplicate-name scanner → must report zero collisions.

Only delete the original file once **both** pass.

---

## Step-by-step instructions

### Step 1 — Create the splitter script

Create `_split_player.py` at the repo root (`dnd-companion/`):

```python
"""Split static/js/player-app.js into modules under static/js/player/."""
import pathlib

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / "static" / "js" / "player-app.js"
OUT_DIR = ROOT / "static" / "js" / "player"
OUT_DIR.mkdir(exist_ok=True)

# Sections — verified against player-app.js section banners.
# Format: (filename, start_line_inclusive, end_line_exclusive_or_None_for_EOF, label)
MODULES = [
    ("01-core.js",            1,    176, "Core: globals, helpers, loadChar, starting item wizard prelude"),
    ("02-starting-wizard.js", 176,  439, "Starting Item Wizard (Phase 7 steps 4-5)"),
    ("03-hp-stats.js",        439,  566, "HP display + Stats panel"),
    ("04-attack.js",          566,  785, "Attack & damage roll"),
    ("05-damage-recovery.js", 785,  880, "Incoming damage + HP recovery"),
    ("06-turn-effects.js",    880,  994, "Turn counter + effects"),
    ("07-enemy-calc.js",      994,  1040, "Enemy damage calc sidebar"),
    ("08-log-inventory.js",   1040, 1363, "Log + Inventory (Stage 2)"),
    ("09-target-picker.js",   1363, 1615, "P2P target picker modal"),
    ("10-map.js",             1615, 1927, "Map / battle grid (Phase 1)"),
    ("11-status-currency.js", 1927, 2044, "Status badges + currency display/transfer"),
    ("12-modals-trade.js",    2044, 2189, "Modal dismiss helper + trade modal"),
    ("13-websocket.js",       2189, 2381, "WebSocket + entity invalidation"),
    ("14-combat-banner.js",   2381, 2727, "Stage 5: combat banner + initiative"),
    ("15-combat-fx.js",       2727, 2789, "Combat FX animations"),
    ("16-defense.js",         2789, 2974, "Defense reaction system"),
    ("17-char-roll.js",       2974, 3005, "Characteristic roll (Stage 7)"),
    ("18-quests.js",          3005, 3226, "Stage 8: player quests"),
    ("19-chest-portal.js",    3226, 3343, "Chest & portal interaction"),
    ("20-stage10.js",         3343, 3505, "Stage 10: announcements, notes, timer"),
    ("21-tabs.js",            3505, 3538, "Phase 6: tab switching"),
    ("22-table-view.js",      3538, 3692, "Phase 6: table view"),
    ("23-action-menu.js",     3692, 4604, "FIX 2: action menu (2x2 grid)"),
    ("24-reactions.js",       4604, 4718, "FIX 4: reactions panel"),
    ("25-bonuses.js",         4718, 4788, "Phase 6: bonuses & penalties"),
    ("26-abilities.js",       4788, 4891, "Phase 6: abilities tab"),
    ("27-memory.js",          4891, 5036, "Phase 6: memory tab"),
    ("28-free-roll.js",       5036, 5107, "FIX 4: free dice roll widget"),
    ("29-level-up.js",        5107, 5281, "Fix 1: level-up choice modal"),
    ("30-init.js",            5281, None, "Final init() — MUST be last"),
]

def main():
    text = SRC.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    n = len(lines)
    print(f"Source: {SRC} ({n} lines)")
    for fname, start, end, label in MODULES:
        end_real = end if end is not None else n + 1
        chunk = "".join(lines[start - 1: end_real - 1])
        header = (
            "// ════════════════════════════════════════════════════════\n"
            f"// {label}\n"
            f"// Source: player-app.js lines {start}-{end_real - 1}\n"
            "// ════════════════════════════════════════════════════════\n\n"
        )
        (OUT_DIR / fname).write_text(header + chunk, encoding="utf-8")
        print(f"  wrote {fname:25s} {end_real - start:5d} lines")
    print("\n--- Paste into player.html (replace single player-app.js script tag):")
    for fname, _, _, _ in MODULES:
        print(f'  <script src="/static/js/player/{fname}?v=split1"></script>')

if __name__ == "__main__":
    main()
```

**Important about line ranges:**
- The numbers above were captured from the current state of `player-app.js`.
- **Re-verify them before running** by running this command and comparing:
  ```powershell
  python -c "lines=open('static/js/player-app.js',encoding='utf-8').read().splitlines(); [print(f'{i+2:>5}: {lines[i+1][3:]}') for i,l in enumerate(lines) if l.startswith('// ═') and i+1<len(lines) and lines[i+1].startswith('// ') and not lines[i+1].startswith('// ═')]"
  ```
- If section line numbers shifted (file edited since this plan was written), update `MODULES` accordingly.

### Step 2 — Run the splitter

```powershell
Set-Location "<repo>\dnd-companion"
python _split_player.py
```

Confirm output: 30 files written, sum of all line counts = 4996 (or whatever the current total is).

### Step 3 — Syntax-check every output

```powershell
Set-Location "static\js\player"
Get-ChildItem *.js | ForEach-Object {
  $r = node --check $_.FullName 2>&1
  if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: $($_.Name)" -ForegroundColor Red; Write-Host $r }
  else { Write-Host "OK:   $($_.Name)" -ForegroundColor Green }
}
```

**All 30 must report OK.** If any fail, the cut likely landed mid-statement
(e.g. inside a function body). Fix: shift the section boundary up or down by
a few lines until each module is syntactically self-contained.

### Step 4 — Check duplicate top-level names

Create `_check_dupes_player.py`:

```python
import re, pathlib
from collections import defaultdict

GM_DIR = pathlib.Path(__file__).parent / "static" / "js" / "player"
files = sorted(GM_DIR.glob("*.js"))
LET_CONST = re.compile(r'^(?:let|const)\s+([A-Za-z_$][\w$]*)\s*[=;,]')
FUNC = re.compile(r'^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(')

names = defaultdict(list)
for fp in files:
    for i, line in enumerate(fp.read_text(encoding="utf-8").splitlines(), 1):
        m = LET_CONST.match(line)
        if m: names[m.group(1)].append((fp.name, i, 'let/const'))
        m = FUNC.match(line)
        if m: names[m.group(1)].append((fp.name, i, 'function'))

dupes = {n: locs for n, locs in names.items() if len(locs) > 1}
if not dupes:
    print("OK: no top-level name collisions")
else:
    print(f"COLLISIONS ({len(dupes)}):")
    for n, locs in sorted(dupes.items()):
        print(f"  {n}:")
        for fn, ln, kind in locs:
            print(f"    {kind:10s} {fn}:{ln}")
```

Run it. **Output must be `OK: no top-level name collisions`.** If any
collisions appear:
- Pick one occurrence to keep, remove the redeclaration in the other file (it's almost always a `let` that was repeated by accident).
- Or move the declaration into `01-core.js` if it's truly shared.

### Step 5 — Update `static/player.html`

Find the line:

```html
<script src="/static/js/player-app.js?v=..."></script>
```

Replace with the 30 `<script>` tags printed by the splitter. **Order
matters** — keep the numeric order; `30-init.js` MUST be last. Do not
reorder casually: `init.js` calls functions defined in earlier modules.

### Step 6 — Cleanup

Once syntax-check + duplicate-check pass and the page loads in the browser
without console errors:

```powershell
Remove-Item "static\js\player-app.js"
Remove-Item "_split_player.py"
Remove-Item "_check_dupes_player.py"
```

### Step 7 — Smoke-test in the browser

Open the player page, watch DevTools Console:
- No "Uncaught ReferenceError: <fn> is not defined" → success.
- If any: the function is referenced before its module loads. Either move the calling code later, or move the function into an earlier module.

---

## Common pitfalls (learned from gm-app.js split)

1. **Cuts inside a function body** → `node --check` fails. Always cut on blank lines or section banners.
2. **Top-level `addEventListener` on DOM elements** — these run at load time. The DOM element must exist when the script runs. Since all scripts are at the bottom of `<body>`, this is fine.
3. **`let X` in two files** → SyntaxError at load. The duplicate scanner catches this.
4. **`init()` IIFE at the very end** of player-app.js (`(async function init() { ... })()`) must go in the LAST module so all other modules' top-level code has already executed.
5. **Do NOT use `type="module"`** — the codebase relies on shared script-scope globals. Switching to ES modules would require adding `import`/`export` to hundreds of references.

---

## What NOT to split (for now)

- **`map-canvas.js`** — it's a single `class MapCanvas` (1624 lines). Splitting requires refactoring into mixins or composition. Leave alone.
- **`character-sheet-core.js`** (343 lines) — small enough, ignore.
- **`websocket-client.js`** (79 lines) — ignore.
- **`gm/02-characters.js`** (1614 lines) — already inside the `gm/` split. Sub-splitting is a future task; not urgent.

---

## Definition of done

- [ ] `static/js/player/` directory contains ~30 numbered files.
- [ ] `static/js/player-app.js` deleted.
- [ ] `static/player.html` updated with the new script tags.
- [ ] `node --check` passes for every file.
- [ ] Duplicate-name scanner reports zero collisions.
- [ ] Player page loads in the browser without console errors.
- [ ] Helper Python scripts (`_split_player.py`, `_check_dupes_player.py`) deleted.

If any console errors appear during smoke test, fix them by moving code
between modules (preserving load order). Do not regress to a single file.
