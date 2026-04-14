"""Stage 6 — Races & Classes tests."""
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

# ── Seed ──
print("\n── Seed Races & Classes ──")
r = requests.post(f"{BASE}/api/races-classes/seed")
check("Seed endpoint returns 200", r.status_code == 200)
data = r.json()
check("Races seeded", data["races_added"] >= 0)

# ── List Races ──
print("\n── List Races ──")
r = requests.get(f"{BASE}/api/races-classes/races")
races = r.json()
check("Races list not empty", len(races) >= 6)
elf = next((x for x in races if x["name"] == "Elf"), None)
check("Elf race exists", elf is not None)
check("Elf has DEX bonus", any(b["type"] == "stat_bonus" and b["stat"] == "dexterity" and b["value"] == 2 for b in elf["bonuses"]))

# ── List Classes ──
print("\n── List Classes ──")
r = requests.get(f"{BASE}/api/races-classes/classes")
classes = r.json()
check("Classes list not empty", len(classes) >= 6)
warrior = next((x for x in classes if x["name"] == "Warrior"), None)
check("Warrior class exists", warrior is not None)
check("Warrior hit_die = 10", warrior["hit_die"] == 10)
check("Warrior has HP bonus", any(b["type"] == "hp_bonus" for b in warrior["bonuses"]))

# ── CRUD Race ──
print("\n── Create Custom Race ──")
r = requests.post(f"{BASE}/api/races-classes/races", json={
    "name": "TestRace",
    "description": "A test race",
    "bonuses": [{"type": "stat_bonus", "stat": "wisdom", "value": 3}],
    "special_abilities": ["Night vision"],
})
check("Create race 200", r.status_code == 200)
test_race = r.json()
check("Race has id", "id" in test_race)
check("Race name matches", test_race["name"] == "TestRace")

# Update
r = requests.put(f"{BASE}/api/races-classes/races/{test_race['id']}", json={
    "name": "TestRaceUpdated",
    "description": "Updated",
    "bonuses": [{"type": "stat_bonus", "stat": "wisdom", "value": 5}],
    "special_abilities": ["Night vision", "Fire breath"],
    "is_available": False,
})
check("Update race 200", r.status_code == 200)
check("Race name updated", r.json()["name"] == "TestRaceUpdated")
check("Race hidden from players", r.json()["is_available"] == False)

# Delete
r = requests.delete(f"{BASE}/api/races-classes/races/{test_race['id']}")
check("Delete race 200", r.status_code == 200)

# ── CRUD Class ──
print("\n── Create Custom Class ──")
r = requests.post(f"{BASE}/api/races-classes/classes", json={
    "name": "TestClass",
    "description": "A test class",
    "bonuses": [{"type": "hp_bonus", "value": 10}],
    "special_abilities": ["Power strike"],
    "hit_die": 12,
})
check("Create class 200", r.status_code == 200)
test_class = r.json()
check("Class has id", "id" in test_class)
check("Class hit_die = 12", test_class["hit_die"] == 12)

# Delete
r = requests.delete(f"{BASE}/api/races-classes/classes/{test_class['id']}")
check("Delete class 200", r.status_code == 200)

# ── Join with Race + Class ──
print("\n── Join Session with Race + Class ──")
# Create session first
r = requests.post(f"{BASE}/api/sessions/create", json={"name": "Stage6Test"})
session = r.json()
session_code = session["session_code"]
check("Session created", r.status_code == 200)

# Join as Elf + Warrior
r = requests.post(f"{BASE}/api/sessions/join", json={
    "session_code": session_code,
    "player_name": "ElfWarrior",
    "race_id": elf["id"],
    "class_id": warrior["id"],
})
check("Join 200", r.status_code == 200)
join_data = r.json()
char_id = join_data["character_id"]

# Verify character has race/class applied
r = requests.get(f"{BASE}/api/characters/{char_id}")
ch = r.json()
check("Character has race_id", ch["race_id"] == elf["id"])
check("Character has class_id", ch["class_id"] == warrior["id"])
check("Character level = 1", ch["level"] == 1)
check("Character experience = 0", ch["experience"] == 0)

# Check HP bonus from Warrior (+5)
check("Max HP includes Warrior bonus (25)", ch["max_hp"] == 25)
check("Current HP includes Warrior bonus (25)", ch["current_hp"] == 25)

# Check stat modifiers from race/class
race_mods = [m for m in ch["stat_modifiers"] if m["source"] == "race"]
class_mods = [m for m in ch["stat_modifiers"] if m["source"] == "class"]
check("Has race stat modifiers", len(race_mods) > 0)
check("Has class stat modifiers", len(class_mods) > 0)
# Elf gives +2 DEX
dex_race_mod = [m for m in race_mods if m["stat_name"] == "dexterity"]
check("Elf DEX +2 modifier applied", len(dex_race_mod) == 1 and dex_race_mod[0]["value"] == 2)

# ── Level/XP Update ──
print("\n── Level/XP Update ──")
r = requests.patch(f"{BASE}/api/characters/{char_id}", json={"level": 5, "experience": 6500})
check("Patch level/xp 200", r.status_code == 200)
ch2 = r.json()
check("Level updated to 5", ch2["level"] == 5)
check("XP updated to 6500", ch2["experience"] == 6500)

# ── Join without Race/Class (backwards compat) ──
print("\n── Join without Race/Class ──")
r = requests.post(f"{BASE}/api/sessions/join", json={
    "session_code": session_code,
    "player_name": "PlainJoe",
})
check("Join without race/class 200", r.status_code == 200)
ch3 = requests.get(f"{BASE}/api/characters/{r.json()['character_id']}").json()
check("No race_id", ch3["race_id"] is None)
check("No class_id", ch3["class_id"] is None)
check("Standard HP 20", ch3["max_hp"] == 20)

print("\n" + "=" * 50)
print(f"Results: {passed}/{passed+failed} passed")
print("=" * 50)
