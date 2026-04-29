import re
from pathlib import Path

SRC = Path("static/js/map-canvas.js")
OUT_DIR = Path("static/js/map-canvas")
OUT_DIR.mkdir(exist_ok=True)

content = SRC.read_text(encoding="utf-8")

# Find all method start positions: lines that start with "  word("
method_starts = [(m.start(), m.group(1)) for m in re.finditer(r'^  (\w+)\(', content, re.MULTILINE)]

if not method_starts:
    print("No methods found")
    exit(1)

# Extract header (before first method)
first_method_pos = method_starts[0][0]
header = content[:first_method_pos]

method_blocks = []
for i, (pos, name) in enumerate(method_starts):
    end_pos = method_starts[i+1][0] if i+1 < len(method_starts) else len(content)
    block = content[pos:end_pos]
    method_blocks.append((name, block))

# Define which methods go to which file
FILE_MAP = {
    "index.js": ["constructor", "playFx", "_startFxLoop", "_renderFx", "_drawFxText"],
    "token-anim.js": ["animateTokenTo", "playFxOnCharacter", "_triggerScreenShake"],
    "hex-math.js": ["_hexSize", "_axialToPixel", "_pixelToAxial", "_hexRound", "_hexDistance", "_snapNorm", "_hexPath"],
    "state.js": [
        "loadImage", "setTokens", "setObjects", "setTiles", "setTraps",
        "setChests", "setMapChests", "setPortals", "setAmbientLight",
        "setIndoor", "setLights", "setEdges", "setInteriors",
        "_getTokenImage", "_isTokenDraggable", "setCanPlayerMove",
        "setMovementBudget", "setGrid", "setFog", "setCurrentVisible",
        "setFogPaintMode", "setDrawings", "setMarkers", "setDrawMode",
        "_requestRender", "_resize"
    ],
    "fog.js": ["computeVisibleCells"],
    "render.js": [
        "render", "_renderTiles", "_renderHexGrid", "_renderReachHex",
        "_renderEdges", "_renderInteriorOverlay", "_renderDrawing",
        "_renderMapObject", "_renderMarker"
    ],
    "lighting.js": ["_renderLightingOverlay"],
    "events.js": [
        "_screenToMap", "_mapToNormalized", "_screenToGrid",
        "_fitToView", "_autoFitIfChanged", "centerView",
        "_hitToken", "_hitChest", "_hitMapChest", "_hitPortal",
        "_hitMarker", "_hitDrawing", "_bindEvents"
    ],
}

method_to_file = {}
for fname, methods in FILE_MAP.items():
    for mn in methods:
        method_to_file[mn] = fname

def to_prototype(name, block):
    # Replace leading "  name(" with "  MapCanvas.prototype.name = function("
    return re.sub(r'^  (\w+)(\()', r'  MapCanvas.prototype.\1 = function\2', block, count=1)

# Write files
for fname, methods in FILE_MAP.items():
    blocks = []
    for name, p in method_blocks:
        if method_to_file.get(name) == fname:
            if fname == "index.js":
                blocks.append(p)
            else:
                blocks.append(to_prototype(name, p))
    if not blocks:
        continue
    if fname == "index.js":
        body = header + "".join(blocks)
        # Ensure class is closed with a final }
        body = body.rstrip() + "\n}\n"
    else:
        body = "(function () {\n" + "\n".join(blocks) + "\n})();\n"
    
    path = OUT_DIR / fname
    path.write_text(body, encoding="utf-8")
    print(f"{fname}: {len(blocks)} methods")

# Check for unassigned
for name, _ in method_blocks:
    if name not in method_to_file:
        print(f"WARNING: unassigned method {name}")

print("Done.")
