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
