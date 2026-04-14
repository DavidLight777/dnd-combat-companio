"""Stage 7 — NPC Library, Events, Dice Rolling, Encounter Difficulty tests."""
import requests

BASE = "http://localhost:8000"
passed = 0
failed = 0

def check(label, condition):
    global passed, failed
    if condition:
        print(f"  ✅ {label}")
        passed += 1
    else:
        print(f"  ❌ {label}")
        failed += 1

print("=" * 50)

# Create test session
r = requests.post(f"{BASE}/api/sessions/create", json={"name": "Stage7Test"})
session = r.json()
SESSION_ID = session["session_id"]
SESSION_CODE = session["session_code"]
check("Session created", r.status_code == 200)

# ── NPC Folders ──
print("\n── NPC Folders ──")
r = requests.post(f"{BASE}/api/npc-library/folders", json={
    "session_id": SESSION_ID, "name": "Forest Goblins", "color": "#33aa33"
})
check("Create folder 200", r.status_code == 200)
folder = r.json()
check("Folder has id", "id" in folder)
check("Folder name", folder["name"] == "Forest Goblins")
check("Folder color", folder["color"] == "#33aa33")

# Nested folder
r = requests.post(f"{BASE}/api/npc-library/folders", json={
    "session_id": SESSION_ID, "name": "Elite Goblins", "color": "#ff5500",
    "parent_folder_id": folder["id"],
})
check("Create nested folder 200", r.status_code == 200)
nested = r.json()
check("Nested folder parent", nested["parent_folder_id"] == folder["id"])

# List folders (tree)
r = requests.get(f"{BASE}/api/npc-library/folders?session_id={SESSION_ID}")
folders = r.json()
check("List folders returns root", len(folders) == 1)
check("Root has child", len(folders[0]["children"]) == 1)

# Edit folder
r = requests.put(f"{BASE}/api/npc-library/folders/{folder['id']}", json={
    "session_id": SESSION_ID, "name": "Goblin Camp", "color": "#22bb22"
})
check("Edit folder 200", r.status_code == 200)
check("Folder renamed", r.json()["name"] == "Goblin Camp")

# ── NPC Templates ──
print("\n── NPC Templates ──")
r = requests.post(f"{BASE}/api/npc-library/templates", json={
    "session_id": SESSION_ID,
    "folder_id": folder["id"],
    "name": "Goblin Warrior",
    "description": "A fierce goblin",
    "max_hp": 15,
    "armor_class": 12,
    "strength": 14,
    "dexterity": 12,
    "initiative_bonus": 1,
    "token_color": "#44aa44",
})
check("Create template 200", r.status_code == 200)
tpl = r.json()
check("Template has id", "id" in tpl)
check("Template name", tpl["name"] == "Goblin Warrior")
check("Template HP", tpl["max_hp"] == 15)
check("Template folder", tpl["folder_id"] == folder["id"])

# Create a second template
r = requests.post(f"{BASE}/api/npc-library/templates", json={
    "session_id": SESSION_ID,
    "name": "Goblin Archer",
    "max_hp": 10,
    "armor_class": 11,
    "dexterity": 16,
    "initiative_bonus": 3,
})
tpl2 = r.json()
check("Second template created", r.status_code == 200)

# List templates
r = requests.get(f"{BASE}/api/npc-library/templates?session_id={SESSION_ID}")
check("List templates", len(r.json()) == 2)

# List templates filtered by folder
r = requests.get(f"{BASE}/api/npc-library/templates?session_id={SESSION_ID}&folder_id={folder['id']}")
check("List templates by folder", len(r.json()) == 1)

# ── Spawn NPCs ──
print("\n── Spawn NPCs from Template ──")
r = requests.post(f"{BASE}/api/npc-library/templates/{tpl['id']}/spawn", json={
    "session_id": SESSION_ID, "count": 3
})
check("Spawn 200", r.status_code == 200)
spawned = r.json()["spawned"]
check("Spawned 3 NPCs", len(spawned) == 3)
check("NPC #1 name", spawned[0]["name"] == "Goblin Warrior #1")
check("NPC #2 name", spawned[1]["name"] == "Goblin Warrior #2")

# Verify spawned character has correct stats
r = requests.get(f"{BASE}/api/characters/{spawned[0]['id']}")
npc = r.json()
check("Spawned NPC is_npc", npc["is_npc"] == True)
check("Spawned NPC HP", npc["max_hp"] == 15)
check("Spawned NPC AC", npc["armor_class"] == 12)
check("Spawned NPC STR", npc["strength"] == 14)
check("Spawned NPC color", npc["token_color"] == "#44aa44")

# ── Event Templates ──
print("\n── Event Templates ──")
r = requests.post(f"{BASE}/api/npc-library/events", json={
    "session_id": SESSION_ID,
    "name": "Goblin Ambush",
    "description": "Goblins attack from the trees!",
    "npc_template_ids": [
        {"template_id": tpl["id"], "count": 2},
        {"template_id": tpl2["id"], "count": 1},
    ],
})
check("Create event 200", r.status_code == 200)
event = r.json()
check("Event has id", "id" in event)
check("Event name", event["name"] == "Goblin Ambush")
check("Event has 2 NPC entries", len(event["npc_template_ids"]) == 2)

# Trigger event
r = requests.post(f"{BASE}/api/npc-library/events/{event['id']}/trigger")
check("Trigger event 200", r.status_code == 200)
triggered = r.json()
check("Event name in response", triggered["event_name"] == "Goblin Ambush")
check("Triggered 3 NPCs total", len(triggered["spawned"]) == 3)

# ── Dice Rolling ──
print("\n── Dice Rolling by Characteristic ──")
# Join a player first
r = requests.post(f"{BASE}/api/sessions/join", json={
    "session_code": SESSION_CODE, "player_name": "TestRoller"
})
char_id = r.json()["character_id"]

r = requests.post(f"{BASE}/api/characters/{char_id}/roll-characteristic", json={
    "stat": "strength",
    "roll_type": "ability_check",
})
check("Roll characteristic 200", r.status_code == 200)
roll = r.json()
check("Roll has d20", 1 <= roll["d20"] <= 20)
check("Roll has total", roll["total"] == roll["d20"] + roll["modifier"])
check("Roll has description", "rolled" in roll["description"])
check("Roll stat correct", roll["stat"] == "strength")

# Saving throw
r = requests.post(f"{BASE}/api/characters/{char_id}/roll-characteristic", json={
    "stat": "dexterity",
    "roll_type": "saving_throw",
})
check("Saving throw 200", r.status_code == 200)
check("Saving throw description", "Saving Throw" in r.json()["description"])

# Invalid stat
r = requests.post(f"{BASE}/api/characters/{char_id}/roll-characteristic", json={
    "stat": "invalid_stat",
    "roll_type": "ability_check",
})
check("Invalid stat returns 400", r.status_code == 400)

# ── Encounter Difficulty ──
print("\n── Encounter Difficulty Calculator ──")
r = requests.post(f"{BASE}/api/npc-library/encounter-difficulty", json={
    "players": [
        {"max_hp": 25, "armor_class": 14, "level": 3},
        {"max_hp": 20, "armor_class": 12, "level": 2},
    ],
    "npcs": [
        {"max_hp": 15, "armor_class": 12},
        {"max_hp": 15, "armor_class": 12},
        {"max_hp": 15, "armor_class": 12},
        {"max_hp": 10, "armor_class": 11},
    ],
})
check("Difficulty calc 200", r.status_code == 200)
diff = r.json()
check("Has difficulty rating", diff["difficulty"] in ["Trivial", "Easy", "Medium", "Hard", "Deadly"])
check("Has ratio", "ratio" in diff)
check("Has party_power", "party_power" in diff)
check("Has enemy_power", "enemy_power" in diff)

# Verify calculation: party_power = (25+14*2) + (20+12*2) = 53 + 44 = 97
# enemy_power = 3*(15+12*2) + (10+11*2) = 3*39 + 32 = 117 + 32 = 149
# ratio = 149/97 ≈ 1.54 → Deadly
check("4 goblins vs 2 players is Hard or Deadly", diff["difficulty"] in ["Hard", "Deadly"])

# Cleanup: delete folder (should cascade to nested)
print("\n── Cleanup ──")
r = requests.delete(f"{BASE}/api/npc-library/folders/{folder['id']}")
check("Delete folder 200", r.status_code == 200)

# Delete event
r = requests.delete(f"{BASE}/api/npc-library/events/{event['id']}")
check("Delete event 200", r.status_code == 200)

# Delete template
r = requests.delete(f"{BASE}/api/npc-library/templates/{tpl2['id']}")
check("Delete template 200", r.status_code == 200)

print("\n" + "=" * 50)
print(f"Results: {passed}/{passed+failed} passed")
print("=" * 50)
