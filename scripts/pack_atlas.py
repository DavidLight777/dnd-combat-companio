#!/usr/bin/env python3
"""Pack selected Kenney Roguelike tiles into a PixiJS spritesheet atlas.

Usage:
    python scripts/pack_atlas.py

Reads:
    kenney_roguelike-rpg-pack/Spritesheet/roguelikeSheet_transparent.png

Writes:
    static/assets/atlas/world.png
    static/assets/atlas/world.json

Requires Pillow only (already a project dependency).
"""
import json
import os

from PIL import Image

# ── Config ──────────────────────────────────────────────────
SRC_SHEET = "kenney_roguelike-rpg-pack/Spritesheet/roguelikeSheet_transparent.png"
OUT_DIR = "static/assets/atlas"
OUT_PNG = os.path.join(OUT_DIR, "world.png")
OUT_JSON = os.path.join(OUT_DIR, "world.json")

TILE_SIZE = 16       # px
MARGIN = 1           # px between tiles in source sheet
PADDING = 2          # px between tiles in output atlas
ATLAS_SIZE = 512     # px

# (col, row) on the source sheet → frame name
# Coordinates chosen by inspecting Preview.png / Sample1.png.
TILE_MAP = {
    "floor_grass":  (0, 0),
    "dirt":         (1, 0),
    "sand":         (2, 0),
    "floor_stone":  (3, 0),
    "floor_wood":   (4, 0),
    "cobble":       (5, 0),
    "grass_short":  (6, 0),
    "wall_stone":   (0, 2),
    "wall_wood":    (1, 2),
    "door_closed":  (0, 4),
    "door_open":    (1, 4),
    "water":        (0, 6),
    "lava":         (1, 6),
    "pit":          (2, 6),
    "rough":        (3, 6),
}


def main():
    src = Image.open(SRC_SHEET).convert("RGBA")
    tiles: dict[str, Image.Image] = {}

    for name, (col, row) in TILE_MAP.items():
        x = col * (TILE_SIZE + MARGIN)
        y = row * (TILE_SIZE + MARGIN)
        tile = src.crop((x, y, x + TILE_SIZE, y + TILE_SIZE))
        tiles[name] = tile
        print(f"  {name:15s}  <-  sheet ({col:2d},{row:2d})  @ ({x:4d},{y:4d})")

    # Pack into atlas (simple row-major, no bin-packing needed for 15 tiles)
    atlas = Image.new("RGBA", (ATLAS_SIZE, ATLAS_SIZE), (0, 0, 0, 0))
    frames: dict[str, dict] = {}
    x = PADDING
    y = PADDING
    max_h = 0
    for name, tile in tiles.items():
        w, h = tile.size
        if x + w + PADDING > ATLAS_SIZE:
            x = PADDING
            y += max_h + PADDING
            max_h = 0
        atlas.paste(tile, (x, y))
        frames[name] = {
            "frame": {"x": x, "y": y, "w": w, "h": h},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h},
            "sourceSize": {"w": w, "h": h},
        }
        x += w + PADDING
        max_h = max(max_h, h)

    os.makedirs(OUT_DIR, exist_ok=True)
    atlas.save(OUT_PNG)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(
            {
                "frames": frames,
                "meta": {
                    "image": "world.png",
                    "format": "RGBA8888",
                    "size": {"w": ATLAS_SIZE, "h": ATLAS_SIZE},
                    "scale": 1,
                },
            },
            f,
            indent=2,
        )

    print(f"\nWrote {len(frames)} frames -> {OUT_PNG} + {OUT_JSON}")


if __name__ == "__main__":
    main()
