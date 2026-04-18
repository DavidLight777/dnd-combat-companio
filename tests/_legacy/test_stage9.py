"""Stage 9 — Map Enhancements: Markers, Drawings, Overlays"""
import requests, json, os, sys, random, string

BASE = "http://127.0.0.1:8000"
passed = failed = 0
SCODE = "TEST9_" + "".join(random.choices(string.ascii_uppercase, k=4))
SID = None
CHAR_ID = None

def check(label, cond):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ✅ {label}")
    else:
        failed += 1
        print(f"  ❌ {label}")

# ── Create session ──
print("── Setup ──")
r = requests.post(f"{BASE}/api/sessions/create", json={"name": "Test Stage 9"})
sess = r.json()
SID = sess["session_id"]
SCODE = sess["session_code"]
check("Session created", r.status_code == 200)

# Join a player
r = requests.post(f"{BASE}/api/sessions/join", json={"session_code": SCODE, "player_name": "Mapper"})
CHAR_ID = r.json()["character_id"]
check("Player joined", r.status_code == 200)

# ── Upload a test map (create a tiny PNG) ──
print("\n── Map Upload ──")
# Create a minimal 4x4 PNG
import struct, zlib
def make_png():
    width, height = 4, 4
    raw = b''
    for _ in range(height):
        raw += b'\x00' + b'\xff\x00\x00' * width  # red pixels
    def chunk(ctype, data):
        c = ctype + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')

png_data = make_png()
r = requests.post(f"{BASE}/api/map/{SCODE}/upload", files={"file": ("test.png", png_data, "image/png")})
check("Map uploaded", r.status_code == 200)
check("Has image_url", "image_url" in r.json())

# ── Get map state ──
print("\n── Map State ──")
r = requests.get(f"{BASE}/api/map/{SCODE}")
state = r.json()
check("Has map", state["has_map"] is True)
check("Tokens list", isinstance(state["tokens"], list))
check("Has remember_explored", "remember_explored" in state)
# Check tokens have vision_radius
if state["tokens"]:
    check("Token has vision_radius", "vision_radius" in state["tokens"][0])
else:
    check("Token has vision_radius (no tokens to check)", True)

# ── Create Markers ──
print("\n── Markers CRUD ──")
r = requests.post(f"{BASE}/api/map/{SCODE}/markers", json={
    "x": 0.5, "y": 0.5, "label": "Danger Zone", "description": "Watch out!",
    "icon": "⚠️", "color": "#ff0000", "visible_to_players": True, "marker_type": "danger"
})
check("Create marker 200", r.status_code == 200)
m1 = r.json()
check("Marker has id", "id" in m1)
check("Marker label", m1["label"] == "Danger Zone")
check("Marker x", m1["x"] == 0.5)
check("Marker visible", m1["visible_to_players"] is True)

# Create a hidden marker
r = requests.post(f"{BASE}/api/map/{SCODE}/markers", json={
    "x": 0.2, "y": 0.8, "label": "Secret Door", "icon": "🔒",
    "visible_to_players": False, "marker_type": "secret"
})
check("Create hidden marker", r.status_code == 200)
m2 = r.json()
check("Hidden marker not visible", m2["visible_to_players"] is False)

# Edit marker
r = requests.put(f"{BASE}/api/map/markers/{m1['id']}", json={"label": "Safe Zone", "color": "#00ff00"})
check("Edit marker 200", r.status_code == 200)
check("Marker label updated", r.json()["label"] == "Safe Zone")
check("Marker color updated", r.json()["color"] == "#00ff00")

# ── Create Drawings ──
print("\n── Drawings CRUD ──")
r = requests.post(f"{BASE}/api/map/{SCODE}/drawings", json={
    "drawing_type": "freehand",
    "points": [[0.1, 0.1], [0.2, 0.2], [0.3, 0.1]],
    "color": "#ff0000", "line_width": 3, "visible_to_players": True
})
check("Create freehand drawing", r.status_code == 200)
d1 = r.json()
check("Drawing has id", "id" in d1)
check("Drawing type", d1["drawing_type"] == "freehand")
check("Drawing points", len(d1["points"]) == 3)

# Rectangle
r = requests.post(f"{BASE}/api/map/{SCODE}/drawings", json={
    "drawing_type": "rectangle",
    "points": [[0.3, 0.3], [0.6, 0.6]],
    "color": "#0000ff", "fill_opacity": 0.3
})
check("Create rectangle", r.status_code == 200)
d2 = r.json()
check("Rectangle fill_opacity", d2["fill_opacity"] == 0.3)

# Circle
r = requests.post(f"{BASE}/api/map/{SCODE}/drawings", json={
    "drawing_type": "circle",
    "points": [[0.5, 0.5], [0.7, 0.5]],
    "color": "#00ff00"
})
check("Create circle", r.status_code == 200)

# Arrow
r = requests.post(f"{BASE}/api/map/{SCODE}/drawings", json={
    "drawing_type": "arrow",
    "points": [[0.1, 0.9], [0.9, 0.1]],
    "color": "#ffff00"
})
check("Create arrow", r.status_code == 200)

# ── Get Overlays ──
print("\n── Overlays ──")
r = requests.get(f"{BASE}/api/map/{SCODE}/overlays")
check("Get overlays 200", r.status_code == 200)
ov = r.json()
check("Has markers", len(ov["markers"]) >= 2)
check("Has drawings", len(ov["drawings"]) >= 4)

# ── Delete drawing ──
print("\n── Delete Drawing ──")
r = requests.delete(f"{BASE}/api/map/drawings/{d1['id']}")
check("Delete drawing 200", r.status_code == 200)
r = requests.get(f"{BASE}/api/map/{SCODE}/overlays")
check("Drawing removed", len(r.json()["drawings"]) == 3)

# ── Delete marker ──
print("\n── Delete Marker ──")
r = requests.delete(f"{BASE}/api/map/markers/{m2['id']}")
check("Delete marker 200", r.status_code == 200)
r = requests.get(f"{BASE}/api/map/{SCODE}/overlays")
check("Marker removed", len(r.json()["markers"]) == 1)

# ── Clear all drawings ──
print("\n── Clear All Drawings ──")
r = requests.delete(f"{BASE}/api/map/{SCODE}/drawings/all")
check("Clear all drawings 200", r.status_code == 200)
r = requests.get(f"{BASE}/api/map/{SCODE}/overlays")
check("All drawings cleared", len(r.json()["drawings"]) == 0)
check("Markers still exist", len(r.json()["markers"]) == 1)

# ── Map Settings: remember_explored ──
print("\n── Map Settings ──")
r = requests.patch(f"{BASE}/api/map/{SCODE}/settings", json={"remember_explored": False})
check("Update remember_explored", r.status_code == 200)
r = requests.get(f"{BASE}/api/map/{SCODE}")
check("remember_explored is False", r.json()["remember_explored"] is False)

# ── Token vision_radius ──
print("\n── Vision Radius ──")
r = requests.get(f"{BASE}/api/map/{SCODE}")
tokens = r.json()["tokens"]
player_tok = [t for t in tokens if t["character_id"] == CHAR_ID]
check("Player token found", len(player_tok) == 1)
check("Default vision_radius = 5", player_tok[0]["vision_radius"] == 5)

# ── Edge cases ──
print("\n── Edge Cases ──")
r = requests.post(f"{BASE}/api/map/FAKECODE/markers", json={"x": 0.5, "y": 0.5})
check("Marker on invalid session 404", r.status_code == 404)

r = requests.put(f"{BASE}/api/map/markers/99999", json={"label": "nope"})
check("Edit nonexistent marker 404", r.status_code == 404)

r = requests.delete(f"{BASE}/api/map/drawings/99999")
check("Delete nonexistent drawing 404", r.status_code == 404)

# ── Cleanup ──
print("\n── Cleanup ──")
r = requests.delete(f"{BASE}/api/map/markers/{m1['id']}")
check("Final marker cleanup", r.status_code == 200)

print(f"\n{'='*40}")
print(f"Results: {passed}/{passed+failed} passed")
print(f"{'='*40}")
sys.exit(0 if failed == 0 else 1)
