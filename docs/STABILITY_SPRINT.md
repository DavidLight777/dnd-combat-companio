# Stability Sprint — pre-Phase 13 REDO

**Assigned to:** Kimi
**Author:** Cascade
**Date:** 2026-04-28
**Estimated effort:** 1–2 days of Kimi-time (6 small tasks of ~20–60 min each)

> **STOP. READ FIRST: `docs/REAL_TESTING.md`.** Every step below
> ships only when accompanied by tests that **failed before** your
> change and **pass after**. Running pre-existing smoke tests is
> **not verification**. If you skip this rule, the work will be
> rejected regardless of how clean the refactor looks.

---

## 0. Why this sprint exists

Phase 13 (Pixi + Kenney) failed with multiple hotfix rounds. Root
cause was **not** the Pixi code — it was the surrounding ecosystem
that made every fix slow to verify:

- Manual cache-bust strings (`?v=split1`, `?v=13r3hotfix`) caused
  half the "still broken" reports — the code was correct, the
  browser served stale JS/PNG.
- No E2E tests — every fix was verified by clicking through the UI
  by hand, which missed regressions in adjacent flows.
- Two render paths (Canvas2D + Pixi) and two builders (v1 + v2)
  drifted out of sync; a fix in one didn't apply to the other.
- `map-canvas.js` is 2200 lines doing 9 different things; touching
  one corner broke a far corner.

Before we start `PHASE_13_REDO_LIGHTING.md`, we fix **the
foundation**, so the next round of work isn't fighting the same
class of issues.

**Each step below ends with a commit. No mixing.** Order matters —
do them in sequence, not in parallel.

There is also `docs/BUILDER_BUGFIX.md` with 4 concrete user-facing
bugs (hex coord mismatch, thick grid, big-map lag, slow delete).
Do **BUILDER_BUGFIX first**, then this sprint, because users feel
those bugs every time they open the builder.

---

## 1. Step 1 — Auto cache-bust based on file hash

**Time:** ~30 min.
**Why first:** every subsequent step edits JS files; without auto
cache-bust we keep playing whack-a-mole with `?v=...` strings.

### Approach

Build-time script that rewrites HTML script tags with a hash of the
file's contents.

#### Implementation

Create `scripts/cache_bust.py`:

```python
"""Rewrite ?v=... query strings on <script src> and <link href> to
match the current file's hash. Run before committing or as a
pre-commit hook.

Walks static/gm.html and static/player.html, finds every
src="/static/.../file.js?v=..." or href="/static/.../file.css?v=..."
and replaces the version with a short hash of the referenced
file's contents.
"""
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
HTML_FILES = [STATIC / "gm.html", STATIC / "player.html", STATIC / "lobby.html"]

PATTERN = re.compile(
    r'(src|href)="(/static/[^"?]+\.(?:js|css))(?:\?v=[^"]*)?"'
)

def file_hash(rel_path: str) -> str:
    p = ROOT / rel_path.lstrip("/")
    if not p.exists():
        return "missing"
    return hashlib.sha1(p.read_bytes()).hexdigest()[:8]

def rewrite(html_path: Path) -> int:
    if not html_path.exists():
        return 0
    text = html_path.read_text(encoding="utf-8")
    changed = 0
    def repl(m):
        nonlocal changed
        attr, src = m.group(1), m.group(2)
        h = file_hash(src)
        new = f'{attr}="{src}?v={h}"'
        if new != m.group(0):
            changed += 1
        return new
    new_text = PATTERN.sub(repl, text)
    if changed:
        html_path.write_text(new_text, encoding="utf-8")
    return changed

def main():
    total = 0
    for f in HTML_FILES:
        n = rewrite(f)
        print(f"{f.name}: {n} tags updated")
        total += n
    print(f"Total: {total}")

if __name__ == "__main__":
    main()
```

#### Wire it into the dev loop

Add to `main.py` near startup, only if `AUTO_CACHE_BUST` env var
is unset or set to `1`:

```python
import os, subprocess, sys
if os.getenv("AUTO_CACHE_BUST", "1") == "1":
    try:
        subprocess.run([sys.executable, "scripts/cache_bust.py"], check=False)
    except Exception as e:
        print(f"cache_bust skipped: {e}")
```

Place this BEFORE `app = FastAPI(...)` so it runs on every server
start.

#### Tests

`tests/test_cache_bust.py`:

```python
import re
import tempfile
from pathlib import Path
from scripts.cache_bust import rewrite, file_hash, PATTERN

def test_rewrite_inserts_hash(tmp_path: Path):
    js = tmp_path / "static" / "js" / "foo.js"
    js.parent.mkdir(parents=True)
    js.write_text("console.log('hi')")
    html = tmp_path / "page.html"
    html.write_text('<script src="/static/js/foo.js?v=old"></script>')
    # Monkeypatch ROOT
    import scripts.cache_bust as cb
    cb.ROOT = tmp_path
    n = rewrite(html)
    assert n == 1
    text = html.read_text()
    assert "?v=" in text
    assert "?v=old" not in text

def test_rewrite_idempotent(tmp_path: Path):
    # second run on same file must produce 0 changes
    ...
```

#### Exit

- `python scripts/cache_bust.py` updates all script tags.
- Server start auto-runs it.
- Tests green.
- Commit: `Stability 01: auto cache-bust based on file hash`.

---

## 2. Step 2 — Kill builder v1

**Time:** ~30 min.
**Why second:** removes a whole class of "v1 vs v2 drift" bugs and
~1500 lines of dead code.

### Approach

Builder v1 was retired in Phase 11 in favour of `builder_v2/*`. The
v1 code still ships and `loadBuilder()` is still called from
`static/js/gm/20-init.js:21`. Dead loaders are a confusion source.

#### Files to delete

Audit and delete unconditionally:
- Any `builder.html` partial / template
- `static/js/gm/builder*` files that aren't `builder_v2`
- Legacy `app/routers/map_builder/*` endpoints if no longer used
- Tests `tests/test_map_builder*` if only covering v1
- `BuilderCanvas` references in `static/js/gm/19-chests.js` (lines
  ~542–558)
- `loadBuilder()` call in `static/js/gm/20-init.js:21`

Keep `builder_v2/*` and its endpoints `app/routers/builder_v2/*`.

**How to find dead refs:** grep for `loadBuilder`, `BuilderCanvas`,
`builder-canvas` (HTML id), `/api/map-builder` (legacy endpoint
prefix). If a hit is inside `builder_v2/*` it's fine; otherwise
delete.

**Caution:** the user's seed scripts and demo data may still hit
`/api/map-builder/*`. Grep `scripts/seed_*.py` for these. Either
update the seed to use `/api/builder-v2/*` or keep the legacy
endpoints alive but mark them clearly.

#### Tests

- All existing tests still green after deletion. Any test that fails
  was testing v1; delete it (don't "fix" it).
- Manual: GM tab still shows Builder (v2) in the sidebar and it
  works.

#### Exit

- All v1 builder files gone.
- `pytest tests/ -q` green.
- Commit: `Stability 02: remove retired Builder v1`.

---

## 3. Step 3 — Split `map-canvas.js`

**Time:** ~60 min (the biggest of the six).
**Why third:** lighting redo (next sprint) edits this file heavily;
splitting it first means lighting changes are isolated.

### Target structure

```
static/js/map-canvas/
  index.js          (~50 lines)  — `class MapCanvas` shell + setup
  render.js         (~600 lines) — main `render()` + draw helpers
  state.js          (~400 lines) — setTiles/setTokens/setFog/setLights/...
  events.js         (~400 lines) — pointer/wheel handlers, drag
  lighting.js       (~250 lines) — _renderLightingOverlay (R1 will rewrite)
  hex-math.js       (~150 lines) — hex pixel/grid conversions
  token-anim.js     (~200 lines) — animateTokenTo + interpolation
  fog.js            (~150 lines) — computeVisibleCells + fog draw
```

### Approach

This is **mechanical**. Steps:

1. Create the new directory.
2. For each chunk above: copy the relevant block out of
   `map-canvas.js`, paste into the new file. Methods stay as
   `MapCanvas.prototype.X` patches:

   ```js
   // map-canvas/lighting.js
   (function () {
     MapCanvas.prototype._renderLightingOverlay = function (ctx) { ... };
     MapCanvas.prototype._ensureLightLayer = function (...) { ... };
   })();
   ```

3. `map-canvas/index.js` declares the class with constructor +
   shared fields, exports it as `window.MapCanvas`.
4. Replace the single `<script src="/static/js/map-canvas.js">` in
   both HTML files with **eight script tags in dependency order**:

   ```html
   <script src="/static/js/map-canvas/index.js"></script>
   <script src="/static/js/map-canvas/state.js"></script>
   <script src="/static/js/map-canvas/render.js"></script>
   <script src="/static/js/map-canvas/events.js"></script>
   <script src="/static/js/map-canvas/lighting.js"></script>
   <script src="/static/js/map-canvas/hex-math.js"></script>
   <script src="/static/js/map-canvas/token-anim.js"></script>
   <script src="/static/js/map-canvas/fog.js"></script>
   ```

   Order matters: `index.js` must declare `class MapCanvas` first.
   The other files only patch `MapCanvas.prototype`.

5. Delete the old `map-canvas.js`.

### Anti-fail

- **Do this in one commit.** If you split in two commits, the
  intermediate state has duplicated code = real risk of bugs.
- **Run all tests after the split.** No method should be missing.
  If a test fails because a method is `undefined`, you forgot to
  import the chunk that defines it.
- **No behavioural changes** in this step. Pure file-shuffle.
  Renaming methods, "improving" them, etc. — forbidden. Save that
  for the next sprint.

#### Exit

- 8 small files instead of 1 monster.
- All 99 tests pass without modification.
- Manual: GM map renders, player map renders, drag works, fog
  works, lighting works.
- Commit: `Stability 03: split map-canvas.js into modules`.

---

## 4. Step 4 — Unify Player main map + Player modal map

**Time:** ~30 min.
**Why fourth:** they're literally two `new MapCanvas(...)` instances
holding parallel state and drift bugs.

### Current code

`static/js/player/10-map.js` has two construction sites:

- `playerMainGrid = new MapCanvas(...)` — embedded in tab (~line 309)
- `playerMapCanvas = new MapCanvas(...)` — modal full-screen (~line 369)

Both subscribe to the same WS events but each holds its own copy of
tokens / tiles / fog. When state goes through one of them, the
other has to re-sync, and bugs creep in when one path is forgotten.

### Approach — option A (recommended)

**Use one canvas DOM node, move it between containers when modal
opens/closes.**

```js
function openMapModal() {
  const modalSlot = $('#player-map-canvas-slot');
  modalSlot.appendChild(canvasEl);   // detach from main, attach to modal
  playerMainGrid._resize();          // re-fit
}

function closeMapModal() {
  const mainSlot = $('#player-main-map-slot');
  mainSlot.appendChild(canvasEl);
  playerMainGrid._resize();
}
```

Delete the second `MapCanvas` instance entirely. State has one
source of truth.

### Approach — option B (if A breaks event handlers)

Two canvases, one shared `MapState` object that both render from.
More work; only do this if A actually fails.

### Tests

- All tests green.
- Manual: open Map modal on Player view, close it, see same fog/
  tokens. Move a token via WS, both views show same state (because
  there's only one).

### Exit

- One `MapCanvas` instance for the player.
- Commit: `Stability 04: unify player main + modal map canvases`.

---

## 5. Step 5 — Playwright E2E for top 10 user flows

**Time:** ~90 min (writing tests is mostly typing, but careful).
**Why last:** this is the safety net. With it in place, future
changes break loudly the moment they break.

### Setup

```bash
pip install playwright pytest-playwright
playwright install chromium
```

Add `tests/e2e/` directory. Pattern:

```python
# tests/e2e/conftest.py
import pytest
from playwright.sync_api import Page

@pytest.fixture
def gm_page(page: Page, live_server) -> Page:
    page.goto(f"{live_server.url}/gm?code=TEST-1234")
    return page
```

`live_server` fixture must spin up a real uvicorn on a random port
with a fresh seeded DB. Look at how existing tests do `TestClient`
and adapt — likely you need to start uvicorn in a thread, point it
at an in-memory or temp SQLite, run the demo seed, return its URL.

### The 10 flows

In order of user impact:

1. GM creates a session, copies invite code, player joins.
2. GM places a token, drags it, player sees it move via WS.
3. GM rolls attack on a token, damage applies, HP updates on player.
4. GM opens Builder v2, paints floor tiles, applies to game.
5. Player opens Map modal, fog of war updates as token moves.
6. GM creates a chest with items, player opens it, items transfer.
7. GM places a light, player sees lit area. (Will be richer after
   PHASE_13_REDO_LIGHTING.)
8. Player levels up — wizard runs, stats update.
9. GM ends turn → next character's initiative starts.
10. AI Narrator generates a description (mock the API call).

Each flow = one `tests/e2e/test_<flow>.py` file with one function.
Use `page.locator("[data-testid=...]")` selectors. **If a button
has no `data-testid` yet — add it in this sprint.** That alone is
worth its weight.

### Documentation

Add to README:

```bash
pytest tests/                  # unit + integration
pytest tests/e2e -k chromium   # E2E
```

If there's a CI file (`.github/workflows/*.yml`), add an E2E job.

### Exit

- 10 E2E tests in `tests/e2e/`, all green.
- README documents how to run them.
- Commit: `Stability 05: Playwright E2E for top 10 flows`.

---

## 6. Step 6 — Regression discipline rule (documentation only)

**Time:** ~5 min. No code.

Add to `docs/CONTRIBUTING.md` (create if missing) the rule:

> **Every bug fix must include at least one new test that would
> have caught the bug before the fix.** No exceptions. The PR
> description should link the new test to the bug it covers.

This is the ongoing rule that keeps regression count low forever.
With Step 5's E2E framework in place, even UI bugs are now testable.

Commit: `Stability 06: regression-test discipline doc`.

---

## 7. Final handoff

After all 6 commits:

```bash
git log --oneline | head -7
# stability_06: regression-test discipline doc
# stability_05: Playwright E2E for top 10 flows
# stability_04: unify player main + modal map canvases
# stability_03: split map-canvas.js into modules
# stability_02: remove retired Builder v1
# stability_01: auto cache-bust based on file hash
```

Run:

```bash
pytest tests/ -q                  # → all green, count > 99
pytest tests/e2e/ -q              # → 10 green
python scripts/cache_bust.py      # → no-op (already up to date)
```

Post the test count + a short note in chat. Then we start
`PHASE_13_REDO_LIGHTING.md` Round 1 on **stable ground**.

---

## 8. Anti-fail rules

1. **One step = one commit.** Never bundle.
2. **No behavioural changes** outside of fixes for actual breaks.
   Steps 2 and 3 must produce a project that behaves identically
   to before, just cleaner.
3. **Run full test suite between every step.** If anything goes
   red after step N, don't proceed to step N+1. Fix it.
4. **If a step uncovers a bug that's not in scope** (e.g. while
   splitting `map-canvas.js` you notice `setFog` has a typo), file
   it as a TODO comment, don't fix it inside this commit. Then fix
   it in a separate follow-up commit so the diff stays reviewable.
5. **Cascade reviews each commit before the next starts.** Post
   the commit hash + a one-line summary in chat. Don't pile up.

---

## 9. Out-of-scope

Things tempting to do during this sprint but **don't**:
- Rewriting any algorithms (lighting, fog, raycasting). That's
  `PHASE_13_REDO_LIGHTING.md`.
- Renaming endpoints / models. Renames cascade — too risky inside a
  stability sprint.
- Adding new features ("while I'm here let me add X").
- Touching the AI/Narrator code. Separate domain, leave it alone.
- Adding TypeScript / build tools / npm. We stay vanilla JS.

---

## 10. Order of operations across all docs

1. **`docs/BUILDER_BUGFIX.md`** — fix the 4 user-visible builder
   bugs first. Quick wins, ~80 lines of edits.
2. **`docs/STABILITY_SPRINT.md`** (this doc) — 6 steps to clean
   foundation.
3. **`docs/PHASE_13_REDO_LIGHTING.md`** — proper Foundry-grade
   lighting on stable ground.

Do not start any later doc until the previous one is fully shipped
and verified.
