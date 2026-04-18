"""Stage 8 — Quest System tests."""
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

# Create session + players + NPC
r = requests.post(f"{BASE}/api/sessions/create", json={"name": "QuestTest"})
sess = r.json()
SID = sess["session_id"]
SCODE = sess["session_code"]
check("Session created", r.status_code == 200)

# Join 2 players
r1 = requests.post(f"{BASE}/api/sessions/join", json={"session_code": SCODE, "player_name": "Alice"})
r2 = requests.post(f"{BASE}/api/sessions/join", json={"session_code": SCODE, "player_name": "Bob"})
P1 = r1.json()["character_id"]
P2 = r2.json()["character_id"]
check("Players joined", r1.status_code == 200 and r2.status_code == 200)

# Create NPC
r = requests.post(f"{BASE}/api/sessions/{SCODE}/npc", json={
    "name": "Gandalf", "max_hp": 50
})
NPC_ID = r.json()["id"]
check("NPC created", r.status_code == 200)

# Give players some starting gold
requests.patch(f"{BASE}/api/characters/{P1}/currency", json={"delta": 500})
requests.patch(f"{BASE}/api/characters/{P2}/currency", json={"delta": 500})

# ── Quest Templates ──
print("\n── Quest Templates ──")
r = requests.post(f"{BASE}/api/quest-templates", json={
    "session_id": SID,
    "title": "Slay the Dragon",
    "description": "A fearsome dragon terrorizes the village.",
    "source_npc_id": NPC_ID,
    "reward_gold_copper": 1000,
    "reward_description": "1000 copper + legendary sword",
    "reward_is_hidden": True,
    "stages": [
        {"order": 1, "title": "Find the Cave", "description": "Locate the dragon's lair"},
        {"order": 2, "title": "Defeat the Dragon", "description": "Slay the beast"},
        {"order": 3, "title": "Return to Village", "description": "Bring proof of victory"},
    ],
    "is_multi_stage": True,
})
check("Create quest template 200", r.status_code == 200)
tpl = r.json()
check("Template has id", "id" in tpl)
check("Template title", tpl["title"] == "Slay the Dragon")
check("Template has 3 stages", len(tpl["stages"]) == 3)
check("Template reward hidden", tpl["reward_is_hidden"] == True)
check("Template has source NPC", tpl["source_npc_id"] == NPC_ID)

# Single-stage quest
r = requests.post(f"{BASE}/api/quest-templates", json={
    "session_id": SID,
    "title": "Deliver Letter",
    "description": "Simple delivery quest",
    "reward_gold_copper": 100,
    "reward_description": "100 copper",
    "reward_is_hidden": False,
    "stages": [],
    "is_multi_stage": False,
})
tpl2 = r.json()
check("Single-stage template created", r.status_code == 200)

# List templates
r = requests.get(f"{BASE}/api/quest-templates?session_id={SID}")
check("List templates", len(r.json()) == 2)

# Edit template
r = requests.put(f"{BASE}/api/quest-templates/{tpl['id']}", json={
    "session_id": SID,
    "title": "Slay the Dragon!",
    "description": tpl["description"],
    "source_npc_id": NPC_ID,
    "reward_gold_copper": 1000,
    "reward_description": "1000 copper + legendary sword",
    "reward_is_hidden": True,
    "stages": tpl["stages"],
    "is_multi_stage": True,
})
check("Edit template 200", r.status_code == 200)
check("Title updated", r.json()["title"] == "Slay the Dragon!")

# ── Assign Quest ──
print("\n── Assign Quest ──")
r = requests.post(f"{BASE}/api/quests/assign", json={
    "template_id": tpl["id"],
    "character_ids": [P1, P2],
})
check("Assign to 2 players 200", r.status_code == 200)
assigned = r.json()["assigned"]
check("Assigned 2 quests", len(assigned) == 2)
Q1 = assigned[0]["quest_id"]
Q2 = assigned[1]["quest_id"]

# Check player quests
r = requests.get(f"{BASE}/api/characters/{P1}/quests")
check("Player 1 has quest", len(r.json()) == 1)
pq = r.json()[0]
check("Quest is active", pq["status"] == "active")
check("Current stage 0", pq["current_stage"] == 0)
check("Source NPC name", pq["source_npc_name"] == "Gandalf")
check("Reward hidden", pq["reward_is_hidden"] == True)
check("Reward not revealed", pq["reward_revealed"] == False)
check("Stages enriched from template", len(pq["stages"]) == 3)
check("Stage 1 title", pq["stages"][0]["title"] == "Find the Cave")

# ── Complete Stages ──
print("\n── Complete Stages ──")
r = requests.patch(f"{BASE}/api/character-quests/{Q1}/complete-stage", json={"stage_index": 0})
check("Complete stage 1", r.status_code == 200)
check("Stage 0 in completed", 0 in r.json()["stages_completed"])
check("Current stage advanced", r.json()["current_stage"] == 1)

r = requests.patch(f"{BASE}/api/character-quests/{Q1}/complete-stage", json={"stage_index": 1})
check("Complete stage 2", r.status_code == 200)
check("Stages completed = [0, 1]", r.json()["stages_completed"] == [0, 1])

# ── Complete Quest ──
print("\n── Complete Quest ──")
# Get gold before
r_gold = requests.get(f"{BASE}/api/characters/{P1}")
gold_before = r_gold.json().get("gold_copper", 0)

r = requests.patch(f"{BASE}/api/character-quests/{Q1}/complete", json={})
check("Complete quest 200", r.status_code == 200)
check("Status completed", r.json()["status"] == "completed")
check("Reward revealed", r.json()["reward_revealed"] == True)
check("Completed_at set", r.json()["completed_at"] is not None)

# Verify gold was added
r_gold2 = requests.get(f"{BASE}/api/characters/{P1}")
gold_after = r_gold2.json().get("gold_copper", 0)
check("Gold reward granted", gold_after == gold_before + 1000)

# ── Fail Quest ──
print("\n── Fail Quest ──")
r = requests.patch(f"{BASE}/api/character-quests/{Q2}/fail", json={})
check("Fail quest 200", r.status_code == 200)
check("Status failed", r.json()["status"] == "failed")

# ── Cannot complete/fail non-active ──
print("\n── Edge Cases ──")
r = requests.patch(f"{BASE}/api/character-quests/{Q1}/complete", json={})
check("Cannot complete completed quest (400)", r.status_code == 400)

r = requests.patch(f"{BASE}/api/character-quests/{Q2}/fail", json={})
check("Cannot fail failed quest (400)", r.status_code == 400)

# ── Assign single-stage quest ──
print("\n── Single-stage Quest ──")
r = requests.post(f"{BASE}/api/quests/assign", json={
    "template_id": tpl2["id"],
    "character_ids": [P1],
})
check("Assign single-stage 200", r.status_code == 200)
Q3 = r.json()["assigned"][0]["quest_id"]

# Complete directly (no stages)
r = requests.patch(f"{BASE}/api/character-quests/{Q3}/complete", json={})
check("Complete single-stage directly", r.status_code == 200)
check("Single-stage completed", r.json()["status"] == "completed")
check("Single-stage reward visible", r.json()["reward_revealed"] == True)

# ── Custom Quest (no template) ──
print("\n── Custom Quest ──")
r = requests.post(f"{BASE}/api/quests/assign", json={
    "character_ids": [P1, P2],
    "title": "Ad-hoc Mission",
    "description": "A quick custom quest",
    "source_npc_name": "Mystery NPC",
    "reward_gold_copper": 50,
    "reward_description": "50 copper",
    "stages": [{"order": 1, "title": "Do the thing", "description": ""}],
})
check("Custom quest assigned 200", r.status_code == 200)
check("Custom assigned to 2", len(r.json()["assigned"]) == 2)

# ── Session Quests (GM view) ──
print("\n── GM Session Quests ──")
r = requests.get(f"{BASE}/api/quests/session/{SCODE}")
check("GM session quests 200", r.status_code == 200)
quests = r.json()
check("Total quests in session", len(quests) >= 4)
check("Quests have character_name", all("character_name" in q for q in quests))

# ── Cleanup ──
print("\n── Cleanup ──")
r = requests.delete(f"{BASE}/api/quest-templates/{tpl['id']}")
check("Delete template 200", r.status_code == 200)
r = requests.delete(f"{BASE}/api/quest-templates/{tpl2['id']}")
check("Delete template 2", r.status_code == 200)

print("\n" + "=" * 50)
print(f"Results: {passed}/{passed+failed} passed")
print("=" * 50)
