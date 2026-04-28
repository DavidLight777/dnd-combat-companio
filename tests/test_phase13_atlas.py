import json
import os

from PIL import Image

BASE = os.path.join(os.path.dirname(__file__), "..")


def test_phase13_atlas_png_valid():
    """Atlas PNG exists, is non-empty, and is a valid image."""
    path = os.path.join(BASE, "static", "assets", "atlas", "world.png")
    assert os.path.exists(path), f"missing {path}"
    assert os.path.getsize(path) > 0
    img = Image.open(path)
    assert img.format == "PNG"
    assert img.size == (512, 512)


def test_phase13_atlas_json_valid():
    """Atlas JSON is parseable and has >=15 frames."""
    path = os.path.join(BASE, "static", "assets", "atlas", "world.json")
    assert os.path.exists(path), f"missing {path}"
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    assert "frames" in data
    frames = data["frames"]
    required = {
        "floor_stone", "floor_wood", "floor_grass",
        "wall_stone", "wall_wood", "door_closed", "door_open",
        "water", "lava", "pit", "rough",
        "grass_short", "dirt", "sand", "cobble",
    }
    missing = required - set(frames.keys())
    assert not missing, f"missing frames: {missing}"
    assert len(frames) >= 15


def test_phase13_placeholder_tiles_deleted():
    """Placeholder solid-colour PNGs from Phase 12 are gone."""
    tiles_dir = os.path.join(BASE, "static", "assets", "tiles")
    if os.path.isdir(tiles_dir):
        pngs = [f for f in os.listdir(tiles_dir) if f.endswith(".png")]
        assert pngs == [], f"placeholder tiles still present: {pngs}"
