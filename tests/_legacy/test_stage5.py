"""Stage 5 — Combat & Initiative System tests."""
import requests

BASE = "http://localhost:8000"
SESSION_CODE = "DARK-9562"

# Get characters
chars = requests.get(f"{BASE}/api/sessions/{SESSION_CODE}/characters").json()
PLAYERS = [c for c in chars if not c["is_npc"] and c["is_alive"]]
NPCS = [c for c in chars if c["is_npc"] and c["is_alive"]]

# Ensure we have at least 1 player and 1 NPC
if not PLAYERS:
    print("ERROR: No alive players found"); exit(1)
if not NPCS:
    print("ERROR: No alive NPCs found"); exit(1)

# Heal player if needed
for p in PLAYERS:
    if p["current_hp"] < 10:
        requests.patch(f"{BASE}/api/characters/{p['id']}/hp", json={"set": 50})

PLAYER = PLAYERS[0]
NPC = NPCS[0]

# Get actual session id
sess_data = requests.get(f"{BASE}/api/sessions/{SESSION_CODE}").json()
SESSION_ID = sess_data.get("id", 1)

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

print("=" * 50)
print("── Create Combat ──")

r = requests.post(f"{BASE}/api/combat/create", json={"session_id": SESSION_ID, "name": "Test Ambush"})
d = r.json()
check("Create combat", r.status_code == 200 and d.get("name") == "Test Ambush", f"id={d.get('id')}")
COMBAT_ID = d["id"]

print("\n── Add Participants ──")

# Add multiple
char_ids = [PLAYER["id"], NPC["id"]]
if len(NPCS) > 1:
    char_ids.append(NPCS[1]["id"])
if len(PLAYERS) > 1:
    char_ids.append(PLAYERS[1]["id"])

r = requests.post(f"{BASE}/api/combat/{COMBAT_ID}/add-participants", json={"character_ids": char_ids})
d = r.json()
check("Add participants", r.status_code == 200 and len(d.get("added", [])) >= 2, f"added={d.get('added')}")

# Get state
r = requests.get(f"{BASE}/api/combat/{COMBAT_ID}/state")
d = r.json()
check("Get combat state", len(d["participants"]) >= 2, f"participants={len(d['participants'])}")

# Remove and re-add
if len(char_ids) > 2:
    r = requests.delete(f"{BASE}/api/combat/{COMBAT_ID}/participants/{char_ids[2]}")
    check("Remove participant", r.json().get("ok"))
    r = requests.post(f"{BASE}/api/combat/{COMBAT_ID}/add-participant", json={"character_id": char_ids[2]})
    check("Re-add participant", r.status_code == 200)

print("\n── Initiative ──")

# Roll NPC initiative
r = requests.post(f"{BASE}/api/combat/{COMBAT_ID}/roll-npc-initiative")
d = r.json()
check("Roll NPC initiative", r.status_code == 200 and len(d.get("rolls", [])) >= 1, f"rolls={d.get('rolls')}")

# Set player initiative
r = requests.post(f"{BASE}/api/combat/{COMBAT_ID}/set-player-initiative",
                  json={"character_id": PLAYER["id"], "roll": 15})
d = r.json()
check("Set player initiative", d.get("ok") and d.get("final") is not None, f"final={d.get('final')}")

# Set manual override
state = requests.get(f"{BASE}/api/combat/{COMBAT_ID}/state").json()
first_pid = state["participants"][0]["id"]
r = requests.post(f"{BASE}/api/combat/{COMBAT_ID}/set-manual-initiative",
                  json={"participant_id": first_pid, "final_initiative": 99})
check("Manual initiative override", r.json().get("ok") and r.json().get("final_initiative") == 99)

print("\n── Start Combat ──")

r = requests.post(f"{BASE}/api/combat/{COMBAT_ID}/start")
d = r.json()
check("Start combat", d.get("status") == "active", f"round={d.get('round_number')}")
check("Participants sorted by initiative", all(
    (d["participants"][i].get("turn_order") or 0) <= (d["participants"][i+1].get("turn_order") or 0)
    for i in range(len(d["participants"])-1)
), f"orders={[p['turn_order'] for p in d['participants']]}")
check("Current participant set", d.get("current_participant_id") is not None)

print("\n── Turn Advancement ──")

first_turn = d["current_participant_id"]
r = requests.post(f"{BASE}/api/combat/{COMBAT_ID}/next-turn")
d = r.json()
check("Next turn advances", d["combat"]["current_participant_id"] != first_turn,
      f"from={first_turn} to={d['combat']['current_participant_id']}")
check("Turn response has character name", d.get("current_character_name") is not None)

# Keep advancing to complete a round
state = d["combat"]
initial_round = state["round_number"]
n_parts = len(state["participants"])
for _ in range(n_parts + 1):  # +1 to ensure round increments
    r = requests.post(f"{BASE}/api/combat/{COMBAT_ID}/next-turn")
    d = r.json()
    if d["combat"]["round_number"] > initial_round:
        break

check("Round counter increments", d["combat"]["round_number"] > initial_round,
      f"round={d['combat']['round_number']}")

print("\n── Get Active Combat ──")

r = requests.get(f"{BASE}/api/combat/session/{SESSION_CODE}/active")
d = r.json()
check("Get active combat for session", d.get("active") and d["combat"]["id"] == COMBAT_ID)

print("\n── End Combat ──")

r = requests.post(f"{BASE}/api/combat/{COMBAT_ID}/end")
d = r.json()
check("End combat", d.get("ok") and d.get("status") == "ended")

# Verify ended
r = requests.get(f"{BASE}/api/combat/session/{SESSION_CODE}/active")
d = r.json()
check("No active combat after end", not d.get("active"))

print("\n" + "=" * 50)
print(f"Results: {passed}/{total} passed")
print("=" * 50)
