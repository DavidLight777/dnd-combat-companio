# Phase 13 R3 Hotfix B — Correct Kenney atlas coordinates

**Status:** assigned to Kimi, 2026-04-28.

## Bug

`scripts/pack_atlas.py` has wrong `(col, row)` values in `TILE_MAP`
(lines 34–50). Kimi guessed them by eyeballing `Preview.png`, but
the top of the Kenney roguelike sheet is items / UI icons, not
floor tiles.

Result on GM Map tab with `USE_PIXI=1`:
- Map renders coloured noise with horizontal stripes instead of
  recognisable stone / wood / wall tiles.
- Every backend tile type ends up resolving to whatever weapon /
  furniture sprite happens to be at the wrong source coordinate.

The crop formula `x = col * (TILE_SIZE + MARGIN)` is **correct** —
verified against `kenney_roguelike-rpg-pack/Spritesheet/spritesheetInfo.txt`
(`TILE 16 × 16`, `MARGIN 1`). Only the data in `TILE_MAP` is wrong.

## Source of truth

`kenney_roguelike-rpg-pack/Map/sample_indoor.tmx` is an official
Tiled map shipped with the pack. Its `Floor`, `Carpet`, `Objects`,
`Details` layers store base64+zlib-encoded gid arrays. Decoding
them gives the **actual** `(col, row)` coordinates of real floor /
wall / door tiles in the sheet.

Sheet metadata: `968 × 526 px`, tilesize `16`, spacing `1`,
firstgid `1` ⇒ effective columns = `(968 + 1) // (16 + 1) = 57`.

## Step-by-step

### 1. Inspection script

Create `scripts/inspect_kenney_atlas.py`:

```python
import base64, struct, zlib, xml.etree.ElementTree as ET
import os
from collections import Counter
from PIL import Image

TMX = "kenney_roguelike-rpg-pack/Map/sample_indoor.tmx"
SHEET = "kenney_roguelike-rpg-pack/Spritesheet/roguelikeSheet_transparent.png"
OUT = "scripts/_kenney_inspection"
TILE, MARGIN, SHEET_W = 16, 1, 968
COLS = (SHEET_W + MARGIN) // (TILE + MARGIN)   # = 57

os.makedirs(OUT, exist_ok=True)
sheet = Image.open(SHEET)

tree = ET.parse(TMX)
for layer in tree.getroot().findall("layer"):
    name = layer.get("name")
    raw = zlib.decompress(base64.b64decode(layer.find("data").text.strip()))
    gids = struct.unpack(f"<{len(raw)//4}I", raw)
    nonzero = [g - 1 for g in gids if g != 0]
    top = Counter(nonzero).most_common(8)
    print(f"\n[{name}] top 8 most-used gids -> (col,row):")
    for gid, count in top:
        col, row = gid % COLS, gid // COLS
        print(f"  gid={gid:5d}  ({col:2d},{row:2d})  used {count}x")
        x, y = col * (TILE + MARGIN), row * (TILE + MARGIN)
        crop = sheet.crop((x, y, x + TILE, y + TILE)).resize((128, 128), Image.NEAREST)
        crop.save(f"{OUT}/{name}_gid{gid}_col{col}_row{row}.png")

print(f"\nSaved previews -> {OUT}")
```

Run:
```
python scripts/inspect_kenney_atlas.py
```

Also run for the outdoor sample to cover grass / water / dirt:
just point `TMX` at `kenney_roguelike-rpg-pack/Map/sample_map.tmx`
and re-run.

### 2. Visually verify candidates

Open `scripts/_kenney_inspection/` in any image viewer. Each PNG is
a 128×128 upscale of one candidate tile, with its `(col, row)` in
the filename.

Pick coordinates whose preview clearly looks like:
- `floor_stone` — grey/dark stone floor
- `floor_wood` — wooden planks
- `floor_grass` — green grass
- `wall_stone` — stone wall block
- `wall_wood` — wooden wall block
- `door_closed`, `door_open` — door sprites
- `water`, `lava`, `pit`, `rough`, `cobble`, `dirt`, `sand`, `grass_short`

The `Floor` and `Carpet` layers will dominate the floor variants.
The `Objects` layer will give walls and doors. If a category isn't
present in `sample_indoor.tmx`, fall back to `sample_map.tmx` (the
outdoor sample) — same decoding, same script.

### 3. Update `TILE_MAP` in `scripts/pack_atlas.py`

Replace the dict at lines 34–50 with the verified coordinates.
**Do not** change `TILE_SIZE`, `MARGIN`, or the crop formula.

### 4. Regenerate atlas

```
python scripts/pack_atlas.py
```

Overwrites `static/assets/atlas/world.png` and `world.json`.

### 5. Visually verify `world.png`

Open `static/assets/atlas/world.png` in Preview / image viewer. Each
of the 15 frames should look like its name claims. Stone reads as
stone, wood as wood, etc. If any tile still looks like UI / weapon
artwork — wrong coords for that frame, redo step 2 for it.

### 6. Cache-bust the atlas URL

In `static/js/pixi/00-loader.js`:

```js
_sheet = await PIXI.Assets.load('/static/assets/atlas/world.json?v=13r3hot2');
```

Without this the browser will keep serving the old broken PNG/JSON
from cache.

### 7. Run tests

```
pytest tests/ -q
```

Must stay at **99 / 99 green**. `tests/test_phase13_atlas.py` only
checks frame count + PNG validity, so the existing assertions still
hold without changes.

### 8. Manual smoke-test

1. Restart server.
2. Hard reload GM tab (Ctrl+Shift+R) with `USE_PIXI=1` cookie set.
3. Open Map tab.
4. Confirm: tiles look like real stone / wood / wall / floor — no
   coloured noise, no horizontal stripes, no UI sprites.
5. Screenshot result and post in chat when handing in.

### 9. Commit

```
Phase 13 R3 hotfix B: correct Kenney atlas coords from Tiled sample
```

Files changed:
- `scripts/inspect_kenney_atlas.py` (new)
- `scripts/pack_atlas.py` (TILE_MAP only)
- `static/assets/atlas/world.png` (regenerated)
- `static/assets/atlas/world.json` (regenerated)
- `static/js/pixi/00-loader.js` (atlas URL cache-bust)
- `scripts/_kenney_inspection/` should be gitignored, NOT committed.

Add `scripts/_kenney_inspection/` to `.gitignore` if it isn't
already covered.

## Anti-fail rules

- **Never** guess coordinates by eyeballing `Preview.png`. The Tiled
  sample maps are the ground truth — use them.
- The decoded gid is **0-based** index into the sheet (after
  subtracting `firstgid=1`). Formula:
  `col = gid % 57`, `row = gid // 57`.
- If `inspect_kenney_atlas.py` prints a gid that maps to a tile that
  visually doesn't match what the layer name suggests (e.g. a "Floor"
  layer pointing at a chest sprite), check the layer's other top
  gids — Tiled samples often use 4–6 distinct floor tiles, not 1.
- Keep `inspect_kenney_atlas.py` in the repo. R5 (builder palette)
  will need to add more tile types and this script is the fastest
  way to find them.
