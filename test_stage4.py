"""Stage 4 — Status Effects & Equipment Templates tests."""
import requests, json

BASE = "http://localhost:8000"
SESSION_CODE = "DARK-9562"

# Get a character and an NPC
chars = requests.get(f"{BASE}/api/sessions/{SESSION_CODE}/characters").json()
CHAR = next(c for c in chars if not c["is_npc"])
NPC = next(c for c in chars if c["is_npc"])
CHAR_ID = CHAR["id"]
NPC_ID = NPC["id"]

passed = 0
total = 0

def check(name, cond, info=""):
    global passed, total
    total += 1
    if cond:
        passed += 1
        print(f"  ✅ {name}" + (f" — {info}" if info else ""))
    else:
        print(f"  ❌ {name}" + (f" — {info}" if info else ""))

print("=" * 40)
print("── Status Effect Templates ──")

# Create "Poisoned" template
r = requests.post(f"{BASE}/api/status-templates", json={
    "name": "Poisoned",
    "description": "Toxin coursing through veins",
    "icon": "🤢",
    "color": "#00ff00",
    "effects": [
        {"type": "hp_change_per_turn", "value": -5},
        {"type": "attack_penalty", "value": -2},
    ],
    "default_duration": 3,
})
d = r.json()
check("Create Poisoned template", r.status_code == 200 and d.get("name") == "Poisoned", f"id={d.get('id')}")
POISON_ID = d.get("id")

# Create "Stunned" template (skip_turn)
r = requests.post(f"{BASE}/api/status-templates", json={
    "name": "Stunned",
    "description": "Cannot act",
    "icon": "💫",
    "color": "#ffcc00",
    "effects": [{"type": "skip_turn", "value": True}],
    "default_duration": 1,
})
d = r.json()
check("Create Stunned template", r.status_code == 200 and d.get("name") == "Stunned")
STUN_ID = d.get("id")

# List templates
r = requests.get(f"{BASE}/api/status-templates")
d = r.json()
check("List templates", r.status_code == 200 and len(d) >= 2, f"count={len(d)}")

# Update template
r = requests.put(f"{BASE}/api/status-templates/{POISON_ID}", json={"description": "Deadly poison"})
d = r.json()
check("Update template", d.get("description") == "Deadly poison")

print("\n── Apply Status Effects ──")

# Apply Poisoned to character
r = requests.post(f"{BASE}/api/characters/{CHAR_ID}/status-effects", json={
    "template_id": POISON_ID,
    "remaining_turns": 3,
})
d = r.json()
check("Apply Poisoned to character", r.status_code == 200 and d.get("name") == "Poisoned", f"id={d.get('id')}")
POISON_EFF_ID = d.get("id")

# Apply custom effect
r = requests.post(f"{BASE}/api/characters/{CHAR_ID}/status-effects", json={
    "custom_name": "Burning",
    "custom_icon": "🔥",
    "custom_color": "#ff4400",
    "custom_effects": [{"type": "hp_change_per_turn", "value": -3}],
    "remaining_turns": 2,
})
d = r.json()
check("Apply custom Burning", r.status_code == 200 and d.get("name") == "Burning")
BURN_EFF_ID = d.get("id")

# List active effects
r = requests.get(f"{BASE}/api/characters/{CHAR_ID}/status-effects")
d = r.json()
check("List active effects", len(d) >= 2, f"count={len(d)}")

# Get aggregated penalties
r = requests.get(f"{BASE}/api/characters/{CHAR_ID}/status-penalties")
d = r.json()
check("Aggregated penalties — attack_penalty=-2", d.get("attack_penalty") == -2, f"penalties={d}")
check("Aggregated penalties — hp_change=-8", d.get("hp_change_per_turn") == -8, f"hp_change={d.get('hp_change_per_turn')}")

print("\n── Process Turn Effects ──")

# Get current HP
char_data = requests.get(f"{BASE}/api/characters/{CHAR_ID}").json()
old_hp = char_data["current_hp"]

# Process turn effects
r = requests.post(f"{BASE}/api/characters/{CHAR_ID}/process-turn-effects")
d = r.json()
check("Process turn effects", r.status_code == 200, f"events={len(d.get('events', []))}")
check("HP decreased by 8", d.get("total_hp_change") == -8, f"hp_change={d.get('total_hp_change')}")
check("Current HP correct", d.get("current_hp") == max(0, old_hp - 8), f"hp={d.get('current_hp')}")

# Check durations decremented
r = requests.get(f"{BASE}/api/characters/{CHAR_ID}/status-effects")
effects = r.json()
poison = next((e for e in effects if e["name"] == "Poisoned"), None)
burn = next((e for e in effects if e["name"] == "Burning"), None)
check("Poison remaining=2 after 1 turn", poison and poison.get("remaining_turns") == 2, f"remaining={poison.get('remaining_turns') if poison else 'N/A'}")
check("Burning remaining=1 after 1 turn", burn and burn.get("remaining_turns") == 1, f"remaining={burn.get('remaining_turns') if burn else 'N/A'}")

# Process another turn — Burning should expire
r = requests.post(f"{BASE}/api/characters/{CHAR_ID}/process-turn-effects")
d = r.json()
expired = d.get("expired_effects", [])
check("Burning expired after 2nd turn", any(e["name"] == "Burning" for e in expired), f"expired={expired}")

# Only Poison left
r = requests.get(f"{BASE}/api/characters/{CHAR_ID}/status-effects")
effects = r.json()
check("Only Poison remains", len(effects) == 1 and effects[0]["name"] == "Poisoned")

print("\n── Remove Effect ──")

r = requests.delete(f"{BASE}/api/status-effects/{effects[0]['id']}")
d = r.json()
check("Remove Poison", d.get("ok") is True)

r = requests.get(f"{BASE}/api/characters/{CHAR_ID}/status-effects")
check("No effects remain", len(r.json()) == 0)

print("\n── Equipment Templates ──")

# Get items
items = requests.get(f"{BASE}/api/items").json()
item_ids = [items[0]["id"]] if items else []
if len(items) > 1:
    item_ids.append(items[1]["id"])

# Create equipment template
r = requests.post(f"{BASE}/api/equipment-templates", json={
    "name": "Goblin Kit",
    "item_ids": item_ids,
})
d = r.json()
check("Create Equipment Template", r.status_code == 200 and d.get("name") == "Goblin Kit", f"id={d.get('id')}")
ET_ID = d.get("id")

# List templates
r = requests.get(f"{BASE}/api/equipment-templates")
check("List Equipment Templates", len(r.json()) >= 1)

# Apply to NPC
r = requests.post(f"{BASE}/api/equipment-templates/{ET_ID}/apply", json={"character_id": NPC_ID})
if r.status_code == 200:
    d = r.json()
    check("Apply Equipment Template to NPC", d.get("ok") is True, f"added={d.get('items_added')}")
else:
    check("Apply Equipment Template to NPC", False, f"status={r.status_code} body={r.text[:300]}")

# Delete template
r = requests.delete(f"{BASE}/api/equipment-templates/{ET_ID}")
check("Delete Equipment Template", r.json().get("ok") is True)

# Delete status templates
requests.delete(f"{BASE}/api/status-templates/{POISON_ID}")
requests.delete(f"{BASE}/api/status-templates/{STUN_ID}")

print("\n" + "=" * 40)
print(f"Results: {passed}/{total} passed")
print("=" * 40)
