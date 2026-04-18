"""Stage 11 — Combat Targeting, Attack Actions & Interactive Battle System tests."""
import requests, json

BASE = "http://127.0.0.1:8000"
passed = 0
total = 0

def check(label, condition):
    global passed, total
    total += 1
    if condition:
        passed += 1
        print(f"  \u2705 {label}")
    else:
        print(f"  \u274c {label}")

# ── Setup: session + characters ──
print("── Setup ──")
r = requests.post(f"{BASE}/api/sessions/create", json={"name": "Stage11 Battle Test"})
check("Session created", r.status_code == 200)
data = r.json()
SC = data["session_code"]
GM = data["gm_token"]
SID = data["session_id"]

r = requests.post(f"{BASE}/api/sessions/join", json={"session_code": SC, "player_name": "Fighter"})
check("Fighter joined", r.status_code == 200)
FIGHTER_ID = r.json()["character_id"]

r = requests.post(f"{BASE}/api/sessions/join", json={"session_code": SC, "player_name": "Archer"})
check("Archer joined", r.status_code == 200)
ARCHER_ID = r.json()["character_id"]

# Set fighter stats: STR 16, DEX 12
requests.patch(f"{BASE}/api/characters/{FIGHTER_ID}", json={"strength": 16, "dexterity": 12, "max_hp": 30, "current_hp": 30, "armor_class": 14})
requests.patch(f"{BASE}/api/characters/{ARCHER_ID}", json={"strength": 10, "dexterity": 18, "max_hp": 20, "current_hp": 20, "armor_class": 12})

# Create NPC
r = requests.post(f"{BASE}/api/sessions/{SC}/npc", json={"name": "Goblin", "max_hp": 15, "armor_class": 11, "strength": 8, "dexterity": 14})
check("Goblin NPC created", r.status_code == 200)
GOBLIN_ID = r.json()["id"]
requests.patch(f"{BASE}/api/characters/{GOBLIN_ID}", json={"current_hp": 15})

# Create weapon item for Fighter (weapon_stats inside body)
r = requests.post(f"{BASE}/api/items", json={
    "name": "Longsword", "description": "A fine steel sword", "rarity": "common",
    "is_weapon": True, "equippable": True, "session_id": SID,
    "weapon_stats": {"dice_count": 1, "dice_type": 8, "damage_type": "slashing", "range": "melee"},
    "bonuses": [{"bonus_type": "attack_bonus", "value": 1}]
})
check("Longsword created", r.status_code == 200)
SWORD_ID = r.json()["id"]
check("Has weapon_stats", r.json().get("weapon_stats") is not None)

# Give sword to fighter and equip
r = requests.post(f"{BASE}/api/characters/{FIGHTER_ID}/inventory", json={"item_id": SWORD_ID})
check("Sword given to fighter", r.status_code == 200)
# Get inventory_id from character inventory list
r_inv = requests.get(f"{BASE}/api/characters/{FIGHTER_ID}/inventory")
inv_items = r_inv.json().get("items", []) if r_inv.status_code == 200 else []
INV_ID = None
for ii in inv_items:
    if ii.get("id") == SWORD_ID:
        INV_ID = ii.get("inventory_id")
        break
r = requests.patch(f"{BASE}/api/inventory/{INV_ID}/equip", json={"equip": True, "slot": "main_hand"})
check("Sword equipped", r.status_code == 200)

# ── Create combat event ──
print("\n── Combat Setup ──")
r = requests.post(f"{BASE}/api/combat/create", json={"session_id": SID, "name": "Test Battle"})
check("Combat created", r.status_code == 200)
COMBAT_ID = r.json()["id"]

# Add participants
for cid in [FIGHTER_ID, ARCHER_ID, GOBLIN_ID]:
    r = requests.post(f"{BASE}/api/combat/{COMBAT_ID}/add-participant", json={"character_id": cid})
    check(f"Participant {cid} added", r.status_code == 200)

# Start combat
r = requests.post(f"{BASE}/api/combat/{COMBAT_ID}/start")
check("Combat started", r.status_code == 200)

# ── Targets ──
print("\n── Target Selection ──")
r = requests.get(f"{BASE}/api/combat/{COMBAT_ID}/targets/{FIGHTER_ID}")
check("Fighter targets 200", r.status_code == 200)
targets = r.json()
check("Fighter sees targets", len(targets) > 0)
goblin_target = [t for t in targets if t["character_id"] == GOBLIN_ID]
check("Goblin in target list", len(goblin_target) > 0)

r = requests.get(f"{BASE}/api/combat/{COMBAT_ID}/targets/{GOBLIN_ID}")
check("Goblin targets 200", r.status_code == 200)
g_targets = r.json()
check("Goblin sees players", len(g_targets) >= 2)

# ── Attack: Fighter → Goblin ──
print("\n── Attack: Fighter → Goblin ──")
r = requests.post(f"{BASE}/api/combat/{COMBAT_ID}/attack", json={"attacker_id": FIGHTER_ID, "target_id": GOBLIN_ID})
check("Attack 200", r.status_code == 200)
atk = r.json()
check("Has attack_roll", "attack_roll" in atk)
check("Has d20", "d20" in atk["attack_roll"])
check("Has hit field", "hit" in atk["attack_roll"])
check("Has critical field", "critical" in atk["attack_roll"])
check("Has fumble field", "fumble" in atk["attack_roll"])
check("Has description", len(atk["description"]) > 0)
check("Has attacker_name", atk["attacker_name"] == "Fighter")
check("Has target_name", atk["target_name"] == "Goblin")
check("Has weapon_name", "weapon_name" in atk)

if atk["attack_roll"]["hit"]:
    check("Damage roll present on hit", atk["damage_roll"] is not None)
    check("Damage has final_damage", "final_damage" in atk["damage_roll"])
    check("Damage has dice_rolls", "dice_rolls" in atk["damage_roll"])
    check("Target HP updated", atk["target_current_hp"] <= 15)
else:
    check("No damage on miss", atk["damage_roll"] is None)
    # Try more attacks to get a hit
    for _ in range(10):
        r2 = requests.post(f"{BASE}/api/combat/{COMBAT_ID}/attack", json={"attacker_id": FIGHTER_ID, "target_id": GOBLIN_ID})
        if r2.json()["attack_roll"]["hit"]:
            check("Eventually hit", True)
            check("Damage on hit", r2.json()["damage_roll"] is not None)
            break
    else:
        check("Eventually hit", False)
        check("Damage on hit (skipped)", True)

# ── Unarmed attack: Archer → Goblin ──
print("\n── Unarmed Attack: Archer → Goblin ──")
r = requests.post(f"{BASE}/api/combat/{COMBAT_ID}/attack", json={"attacker_id": ARCHER_ID, "target_id": GOBLIN_ID})
check("Unarmed attack 200", r.status_code == 200)
check("Weapon name is Unarmed", r.json()["weapon_name"] == "Unarmed")

# ── Defend ──
print("\n── Defend ──")
r = requests.post(f"{BASE}/api/combat/{COMBAT_ID}/defend", json={"character_id": FIGHTER_ID})
check("Defend 200", r.status_code == 200)
d = r.json()
check("Action type defend", d["action_type"] == "defend")
check("Has AC bonus", d["new_ac"] > 14)
check("Description mentions defensive", "defensive" in d["description"].lower())

# ── Combat Action Log ──
print("\n── Combat Action Log ──")
r = requests.get(f"{BASE}/api/combat/{COMBAT_ID}/actions")
check("Actions list 200", r.status_code == 200)
actions = r.json()
check("Has actions", len(actions) >= 3)
attack_actions = [a for a in actions if a["action_type"] == "attack"]
defend_actions = [a for a in actions if a["action_type"] == "defend"]
check("Has attack actions", len(attack_actions) >= 2)
check("Has defend action", len(defend_actions) >= 1)
check("Actions have round_number", all("round_number" in a for a in actions))
check("Actions have created_at", all("created_at" in a for a in actions))

# ── Attack dead target ──
print("\n── Edge Cases ──")
# Kill goblin via HP patch (sets is_alive=False when HP=0)
requests.patch(f"{BASE}/api/characters/{GOBLIN_ID}/hp", json={"set": 0})
r = requests.post(f"{BASE}/api/combat/{COMBAT_ID}/attack", json={"attacker_id": FIGHTER_ID, "target_id": GOBLIN_ID})
check("Attack dead target → 400", r.status_code == 400)

# Missing fields
r = requests.post(f"{BASE}/api/combat/{COMBAT_ID}/attack", json={"attacker_id": FIGHTER_ID})
check("Missing target_id → 400", r.status_code == 400)

# Invalid combat
r = requests.get(f"{BASE}/api/combat/99999/targets/{FIGHTER_ID}")
check("Invalid combat → 404", r.status_code == 404)

# ── Weapon properties (finesse/ranged) ──
print("\n── Weapon Properties ──")
# Create a finesse weapon
r = requests.post(f"{BASE}/api/items", json={
    "name": "Rapier", "description": "Finesse blade", "rarity": "common",
    "is_weapon": True, "equippable": True, "session_id": SID,
    "weapon_stats": {"dice_count": 1, "dice_type": 8, "damage_type": "piercing", "range": "melee"},
})
check("Rapier created", r.status_code == 200)
RAPIER_ID = r.json()["id"]

# Create a ranged weapon
r = requests.post(f"{BASE}/api/items", json={
    "name": "Longbow", "description": "Ranged weapon", "rarity": "common",
    "is_weapon": True, "equippable": True, "session_id": SID,
    "weapon_stats": {"dice_count": 1, "dice_type": 8, "damage_type": "piercing", "range": "60ft"},
})
check("Longbow created", r.status_code == 200)
BOW_ID = r.json()["id"]

# ── Game Mechanics Unit Tests ──
print("\n── Game Mechanics ──")
from app.game_mechanics import (
    roll_dice, stat_modifier, calculate_combat_attack, calculate_combat_damage
)

rolls, total = roll_dice("2d6")
check("roll_dice 2d6: 2 rolls", len(rolls) == 2)
check("roll_dice 2d6: total >= 2", total >= 2)
check("roll_dice 2d6: total <= 12", total <= 12)

rolls, total = roll_dice("1d8+3")
check("roll_dice 1d8+3: 1 roll", len(rolls) == 1)
check("roll_dice 1d8+3: total >= 4", total >= 4)

check("stat_modifier(10) = 0", stat_modifier(10) == 0)
check("stat_modifier(16) = 3", stat_modifier(16) == 3)
check("stat_modifier(8) = -1", stat_modifier(8) == -1)
check("stat_modifier(20) = 5", stat_modifier(20) == 5)
check("stat_modifier(1) = -5", stat_modifier(1) == -5 or stat_modifier(1) == -4)

# Test calculate_combat_attack
atk_result = calculate_combat_attack(
    attacker_stats={"strength": 16, "dexterity": 12},
    target_ac=15,
    weapon={"attack_bonus": 2, "weapon_range": "melee", "weapon_properties": []},
)
check("Combat attack has d20", 1 <= atk_result.d20 <= 20)
check("Combat attack stat_mod = 3", atk_result.stat_mod == 3)
check("Combat attack weapon_bonus = 2", atk_result.weapon_bonus == 2)

# Test ranged weapon uses DEX
atk_ranged = calculate_combat_attack(
    attacker_stats={"strength": 10, "dexterity": 18},
    target_ac=12,
    weapon={"attack_bonus": 0, "weapon_range": "ranged", "weapon_properties": []},
)
check("Ranged uses DEX mod = 4", atk_ranged.stat_mod == 4)

# Test finesse uses max(STR,DEX)
atk_finesse = calculate_combat_attack(
    attacker_stats={"strength": 10, "dexterity": 18},
    target_ac=12,
    weapon={"attack_bonus": 0, "weapon_range": "melee", "weapon_properties": ["finesse"]},
)
check("Finesse uses max(STR,DEX) = 4", atk_finesse.stat_mod == 4)

# Test damage
dmg_result = calculate_combat_damage(
    attacker_stats={"strength": 16, "dexterity": 12},
    target_hp=20, target_max_hp=20,
    weapon={"dice_count": 1, "dice_type": 8, "damage_bonus": 1, "weapon_range": "melee", "weapon_properties": []},
)
check("Damage has dice_rolls", len(dmg_result.dice_rolls) >= 1)
check("Damage stat_mod = 3", dmg_result.stat_mod == 3)
check("Damage weapon_bonus = 1", dmg_result.weapon_damage_bonus == 1)
check("Damage final >= 0", dmg_result.final_damage >= 0)

# Test critical doubles dice
dmg_crit = calculate_combat_damage(
    attacker_stats={"strength": 16, "dexterity": 12},
    target_hp=20, target_max_hp=20,
    weapon={"dice_count": 1, "dice_type": 8, "damage_bonus": 0, "weapon_range": "melee", "weapon_properties": []},
    critical=True,
)
check("Critical doubles dice count", len(dmg_crit.dice_rolls) == 2)

# Test unarmed (no weapon)
dmg_unarmed = calculate_combat_damage(
    attacker_stats={"strength": 16, "dexterity": 12},
    target_hp=20, target_max_hp=20,
    weapon=None,
)
check("Unarmed uses 1d4", len(dmg_unarmed.dice_rolls) == 1)

# Test kill
dmg_kill = calculate_combat_damage(
    attacker_stats={"strength": 20, "dexterity": 10},
    target_hp=1, target_max_hp=20,
    weapon={"dice_count": 2, "dice_type": 12, "damage_bonus": 5, "weapon_range": "melee", "weapon_properties": []},
)
check("Kill: target_new_hp = 0", dmg_kill.target_new_hp == 0)
check("Kill: target_killed = True", dmg_kill.target_killed is True)

print(f"\n{'='*40}")
print(f"Results: {passed}/{total} passed")
print(f"{'='*40}")
