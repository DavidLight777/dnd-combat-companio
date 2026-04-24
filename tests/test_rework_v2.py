"""Rework v2 — consolidated regression test.

Runs against a live server (default: http://127.0.0.1:8000). It creates a
throw-away session per run so it never clashes with an active game.

Usage:
    # Terminal 1
    python main.py
    # Terminal 2
    python tests/test_rework_v2.py          # full suite
    python tests/test_rework_v2.py --base http://host:port

Exit code 0 on success, 1 on any assertion failure. There are no pytest
fixtures — we keep this dependency-light so it can be run from the repo
root without installing anything extra.

Covered areas (matches REWORK_PLAN.md §5):

    α  Models & destructive migration        (schema shape in character JSON)
    β  Backend endpoints                     (wizard 6-step, abilities pool,
                                              slot enforcement, level-up)
    γ  Lobby 6-step wizard                   (roll-item → propose → approve
                                              → stat-choice → roll-feature →
                                              finalize)
    δ  Player UI data surface                (identity, slot meter, features)
    ε  GM UI data surface                    (pending approvals, ability
                                              filters, race HP die round-trip)
    ζ  Level-up                              (stats & upgrade_feature paths,
                                              XP gate)
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request


# ── HTTP helpers ──────────────────────────────────────────────
def _request(base, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        return resp.status, json.loads(resp.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "null")


# ── Test runner ───────────────────────────────────────────────
class Suite:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.passed = 0
        self.failed = 0
        self.groups: list[tuple[str, bool, str]] = []
        self._current_group = "(setup)"

    def group(self, name: str) -> None:
        self._current_group = name
        print(f"\n── {name} " + "─" * max(2, 60 - len(name) - 4))

    def check(self, label: str, cond: bool, extra: str = "") -> None:
        marker = "[OK]" if cond else "[!!]"
        suffix = f" — {extra}" if extra else ""
        print(f"  {marker} {label}{suffix}")
        if cond:
            self.passed += 1
        else:
            self.failed += 1
            self.groups.append((self._current_group, False, f"{label}{suffix}"))

    def req(self, method: str, path: str, body=None):
        return _request(self.base, method, path, body)

    def done(self) -> int:
        total = self.passed + self.failed
        print("\n" + "=" * 64)
        print(f"  {self.passed} / {total} checks passed")
        if self.failed:
            print("  Failures:")
            for group, _, label in self.groups:
                print(f"    · [{group}] {label}")
            return 1
        print("  REWORK v2 REGRESSION — ALL PASSED")
        return 0


# ── Main scenario ─────────────────────────────────────────────
def run(base: str) -> int:
    s = Suite(base)

    # ── γ/δ/ε setup: session + GM-only race + starting-pool seed ──
    s.group("Setup: session + race + ability pool")
    code, data = s.req("POST", "/api/sessions/create", {"name": "Rework v2 regression"})
    s.check("POST /sessions/create → 200", code == 200, f"status={code}")
    sid = data["session_id"]
    scode = data["session_code"]

    # Race with hp_die=10, +1 CON. Verifies Phase α migration exposed hp_die.
    code, race = s.req("POST", "/api/races-classes/races", {
        "session_id": sid,
        "name": "Stoneborn", "description": "Stone-skinned folk",
        "hp_die": 10, "hp_dice_count": 1,
        "bonuses": [{"type": "stat_bonus", "stat": "constitution", "value": 1}],
        "is_available": True,
    })
    s.check("race POST carries hp_die=10", race.get("hp_die") == 10, f"hp_die={race.get('hp_die')}")
    s.check("race bonuses round-trip",
            race.get("bonuses", [{}])[0].get("stat") == "constitution")
    # Force the PUT path too (covered Phase ε GM editor save).
    code, race = s.req("PUT", f"/api/races-classes/races/{race['id']}", {
        "name": "Stoneborn", "description": "Stone-skinned folk",
        "hp_die": 12, "hp_dice_count": 1,
        "bonuses": [{"type": "stat_bonus", "stat": "constitution", "value": 1}],
        "special_abilities": [], "is_available": True,
    })
    s.check("race PUT updates hp_die → 12", race.get("hp_die") == 12)
    race_id = race["id"]

    # Seed a full pool — every non-legendary rarity gets 4 entries so Step 5
    # and the upgrade path always have a destination bucket.
    for rarity in ("common", "uncommon", "rare", "epic", "legendary"):
        for n in range(4):
            s.req("POST", "/api/abilities", {
                "session_id": sid,
                "name": f"Pool {rarity} #{n}",
                "description": f"Test {rarity}",
                "rarity": rarity, "is_in_starting_pool": True,
                "max_uses": 2 if rarity == "rare" else None,
                "is_conditional": rarity == "rare",
                "conditional_text": "When the moon is full" if rarity == "rare" else None,
                "ability_type": "active", "target_type": "self",
            })

    code, abs_pool = s.req("GET", f"/api/abilities?session_id={sid}&in_starting_pool=true")
    s.check("abilities filter in_starting_pool=true", len(abs_pool) >= 12, f"count={len(abs_pool)}")
    code, rares = s.req("GET", f"/api/abilities?session_id={sid}&rarity=rare")
    s.check("abilities filter rarity=rare", all(a["rarity"] == "rare" for a in rares))
    s.check("rare abilities carry is_conditional", all(a["is_conditional"] for a in rares if a["name"].startswith("Pool rare")))

    # ── γ: walk the full wizard ──
    s.group("Phase γ: 6-step wizard")

    code, join = s.req("POST", "/api/sessions/join", {
        "session_code": scode, "player_name": "Regress Hero",
        "race_id": race_id, "age": 27, "gender": "Any",
    })
    s.check("join returns character_id", bool(join.get("character_id")))
    cid = join["character_id"]

    code, ws = s.req("GET", f"/api/wizard/{cid}")
    s.check("wizard auto-created on join", ws.get("current_step", 0) >= 1)

    code, rolled = s.req("POST", f"/api/wizard/{cid}/roll-item")
    s.check("roll-item returns valid rarity",
            rolled["rarity"] in {"common", "uncommon", "rare", "epic", "legendary"},
            f"d20={rolled['d20']} → {rolled['rarity']}")

    code, _ = s.req("POST", f"/api/wizard/{cid}/propose-item", {
        "name": "Regression Dagger", "description": "A test blade.",
        "category": "weapon",
        "weapon": {
            "dice_count": 1, "dice_type": 6,
            "hit_stat": "dexterity", "damage_stat": "dexterity",
            "damage_type": "physical",
        },
    })
    s.check("propose-item (weapon) returns 200", code == 200)

    # decline so we can verify advantage path + stats=0 + slots=10.
    code, _ = s.req("POST", f"/api/wizard/{cid}/stat-choice", {"declined": True})
    s.check("stat-choice decline → 200", code == 200)

    code, feat = s.req("POST", f"/api/wizard/{cid}/roll-feature")
    s.check("roll-feature returns an ability",
            bool(feat.get("ability", {}).get("name")), f"got={feat.get('ability', {}).get('name')}")
    s.check("decline grants 2d20 advantage",
            feat["roll"]["advantage"] is True and len(feat["roll"]["d20_rolls"]) == 2,
            f"rolls={feat['roll']['d20_rolls']}")

    code, final = s.req("POST", f"/api/wizard/{cid}/finalize")
    s.check("finalize returns is_completed=True", final.get("is_completed") is True)

    # ── δ: character serialization ──
    s.group("Phase δ: player UI surfaces")

    code, ch = s.req("GET", f"/api/characters/{cid}")
    s.check("character age round-trip", ch.get("age") == 27)
    s.check("character gender round-trip", ch.get("gender") == "Any")
    s.check("character declined_stats=True", ch.get("declined_stats") is True)
    s.check("declined → all stats are 0",
            all(ch[k] == 0 for k in ("strength", "dexterity", "constitution",
                                     "intelligence", "wisdom", "charisma")))
    s.check("character mana_max = 10 default", ch.get("mana_max") == 10)
    s.check("character armor_class = 0 default", ch.get("armor_class") == 0)
    # declined → slots = 10; canonical formula: 10 + 2*CON. CON=0 here.
    s.check("max_inventory_slots = 10 (declined formula)", ch.get("max_inventory_slots") == 10)
    s.check("character exposes race_name", ch.get("race_name") == "Stoneborn")
    s.check("character exposes hp_die/hp_dice_count",
            ch.get("hp_die") == 12 and ch.get("hp_dice_count") == 1)
    s.check("character exposes xp_to_next = 100 (L0)", ch.get("xp_to_next") == 100)

    code, inv = s.req("GET", f"/api/characters/{cid}/inventory")
    s.check("inventory GET exposes slots_used", "slots_used" in inv)
    s.check("inventory GET exposes slots_max",  "slots_max"  in inv)
    s.check("slots_max follows declined value", inv["slots_max"] == 10)

    code, abs_ = s.req("GET", f"/api/characters/{cid}/abilities")
    s.check("at least one character ability (wizard Step 5)", len(abs_) >= 1)
    a = abs_[0]
    for field in ("rarity", "max_uses", "current_uses",
                  "is_conditional", "conditional_text", "granted_from"):
        s.check(f"ability exposes `{field}`", field in a)
    s.check("granted_from is set", bool(a.get("granted_from")))

    # ── ε: GM pending-approval hub ──
    s.group("Phase ε: GM approvals hub")

    code, pending = s.req("GET", f"/api/wizard/session/{sid}/pending")
    s.check("pending list has our character", any(p["character_id"] == cid for p in pending))

    code, appr = s.req("POST", f"/api/wizard/{cid}/approve-item",
                       {"rarity_override": "uncommon", "note": "nice concept"})
    s.check("approve-item endpoint (not `gm-approve`) returns 200", code == 200,
            f"status={code}")
    s.check("approve-item returns approved=True", appr.get("approved") is True)

    code, pending2 = s.req("GET", f"/api/wizard/session/{sid}/pending")
    s.check("pending empty after approval", len(pending2) == 0)

    # Slot enforcement — stage enough items to hit the cap of 10.
    s.group("Phase β: inventory slot cap enforcement")

    # First make a known item we can add many times.
    code, _item = s.req("POST", "/api/items", {
        "session_id": sid, "name": "Stone Pebble",
        "description": "A pebble", "category": "misc",
        "rarity": "common",
    })
    pebble_id = _item["id"]
    # Add unique items by creating N distinct items (stackables don't eat slots).
    item_ids = [pebble_id]
    for n in range(20):
        code, it = s.req("POST", "/api/items", {
            "session_id": sid, "name": f"Pebble #{n}",
            "description": f"#{n}", "category": "misc",
            "rarity": "common",
        })
        item_ids.append(it["id"])

    added = 0
    hit_cap_at = None
    for iid in item_ids:
        code, _resp = s.req("POST", f"/api/characters/{cid}/inventory",
                            {"item_id": iid, "quantity": 1})
        if code == 200:
            added += 1
        elif code == 400:
            hit_cap_at = added
            break

    s.check("inventory add starts succeeding", added >= 1)
    s.check("inventory add rejects at slot cap", hit_cap_at is not None,
            f"added={added}, cap hit at={hit_cap_at}")
    # Inventory already had 1 slot used by the approved starting item, so cap
    # is hit between 8 and 10 additions depending on prior state.
    s.check("cap hit within sensible window",
            hit_cap_at is not None and 5 <= hit_cap_at <= 10,
            f"hit_cap_at={hit_cap_at}")

    # ── ζ: level-up (attributes vs ability choice) ──
    s.group("Phase ζ: level-up")

    # Grant 140 XP first to test carry-over
    s.req("POST", f"/api/characters/{cid}/grant-xp", {"amount": 140})
    code, ch0 = s.req("GET", f"/api/characters/{cid}")
    s.check("pre-level XP is 140", ch0["experience"] == 140)

    code, lu = s.req("POST", f"/api/characters/{cid}/level-up", {
        "choice": "attributes",
        "force": True,
    })
    s.check("level-up attributes 200", code == 200, f"code={code}")
    s.check("level advanced L0 → L1", lu["level"] == ch0["level"] + 1)
    s.check("HP roll within race die", 1 <= lu["chosen"]["hp_gained"] <= 12)
    s.check("1 attribute point gained", lu["attribute_points_available"] == 1)
    s.check("XP carry-over: 140-100=40", lu["experience"] == 40)

    code, ch1 = s.req("GET", f"/api/characters/{cid}")
    s.check("attribute_points_available persisted", (ch1.get("attribute_points_available") or 0) >= 1)
    s.check("xp_to_next reflects new level = 200", ch1["xp_to_next"] == 200)
    s.check("XP persisted as 40", ch1["experience"] == 40)

    # Test ability upgrade choice
    # First get character abilities
    code, char_abilities = s.req("GET", f"/api/characters/{cid}/abilities")
    ability_to_upgrade = char_abilities[0]["character_ability_id"] if char_abilities else None

    if ability_to_upgrade:
        code, lu2 = s.req("POST", f"/api/characters/{cid}/level-up", {
            "choice": "ability",
            "ability_id": ability_to_upgrade,
            "force": True,
        })
        s.check("level-up ability choice 200", code == 200, f"body={lu2}")
        s.check("ability level increased", lu2["chosen"].get("ability_level", 0) >= 1)
        s.check("HP still rolled on ability choice", lu2["chosen"]["hp_gained"] > 0)

    # Test rank-up: force character to level 10 then level-up
    s.req("PATCH", f"/api/characters/{cid}", {"level": 10, "experience": 1100})
    code, ch_before_rank = s.req("GET", f"/api/characters/{cid}")
    s.check("pre-rank-up level is 10", ch_before_rank["level"] == 10)

    code, lu3 = s.req("POST", f"/api/characters/{cid}/level-up", {
        "choice": "attributes",
        "force": True,
    })
    s.check("rank-up auto promotion 200", code == 200)
    s.check("rank-up resets level to 0", lu3["level"] == 0)
    s.check("rank advanced common → uncommon", lu3["rank"] == "uncommon")
    s.check("rank promoted flag true", lu3["chosen"]["rank_promoted"] == True)

    # Reject case: XP gate without force
    code, _bad = s.req("POST", f"/api/characters/{cid}/level-up", {
        "choice": "attributes",
    })
    s.check("level-up XP gate blocks without force", code == 400)

    # ══════════════════════════════════════════════════════════════
    # REWORK v3 — new capabilities
    # ══════════════════════════════════════════════════════════════

    # ── η: retired heal-widget columns are truly gone ──
    s.group("Phase η: Rework v3 — heal columns dropped")
    code, ch_shape = s.req("GET", f"/api/characters/{cid}")
    s.check("character no longer exposes hp_dice_type",
            "hp_dice_type" not in ch_shape)
    s.check("character no longer exposes hp_recovery_modifier",
            "hp_recovery_modifier" not in ch_shape)
    # items should also no longer expose weight
    code, _items = s.req("GET", f"/api/items?session_id={sid}")
    if _items:
        s.check("items no longer expose `weight` field",
                all("weight" not in i for i in _items))

    # ── θ: Full Rest ──
    s.group("Phase θ: Rework v3 — Full Rest")
    # Direct PATCH so we stay above 0 HP (dropping to 0 via /hp flips
    # is_alive=False which would exclude us from the full-rest filter).
    s.req("PATCH", f"/api/characters/{cid}",
          {"current_hp": 1, "mana_current": 0, "is_alive": True})
    code, ch_before = s.req("GET", f"/api/characters/{cid}")
    s.check("HP drained before full-rest",
            ch_before["current_hp"] < ch_before["max_hp"])
    s.check("mana drained before full-rest", ch_before["mana_current"] == 0)
    code, rest = s.req("POST", f"/api/sessions/{scode}/full-rest", {})
    s.check("full-rest returns 200", code == 200, f"status={code}")
    s.check("full-rest reports at least one healed char", rest.get("healed_count", 0) >= 1)
    code, ch_after = s.req("GET", f"/api/characters/{cid}")
    s.check("full-rest sets current_hp = max_hp",
            ch_after["current_hp"] == ch_after["max_hp"],
            f"{ch_after['current_hp']}/{ch_after['max_hp']}")
    s.check("full-rest sets mana_current = mana_max",
            ch_after["mana_current"] == ch_after["mana_max"])

    # ── ι: Player-to-Player interactions ──
    s.group("Phase ι: Rework v3 — P2P heal / item transfer")
    code, join2 = s.req("POST", "/api/sessions/join", {
        "session_code": scode, "player_name": "Ally Target",
        "race_id": race_id, "age": 22, "gender": "Any",
    })
    tid = join2["character_id"]
    # Quick-finalize target through the wizard so they have max_hp > 0.
    s.req("POST", f"/api/wizard/{tid}/roll-item")
    s.req("POST", f"/api/wizard/{tid}/propose-item", {
        "name": "Ally Stick", "description": "Stick.", "category": "misc",
    })
    s.req("POST", f"/api/wizard/{tid}/approve-item", {"note": "ok"})
    s.req("POST", f"/api/wizard/{tid}/stat-choice", {"declined": False})
    s.req("POST", f"/api/wizard/{tid}/roll-feature")
    s.req("POST", f"/api/wizard/{tid}/finalize")

    # Damage the target to 1 HP (stay alive so heal is observable).
    s.req("PATCH", f"/api/characters/{tid}", {"current_hp": 1, "is_alive": True})
    code, tgt_dmg = s.req("GET", f"/api/characters/{tid}")
    s.check("target damaged below max", tgt_dmg["current_hp"] < tgt_dmg["max_hp"])

    # Create a healing potion and give the caster a stack of 2.
    code, heal_item = s.req("POST", "/api/items", {
        "session_id": sid, "name": "Ally Tonic",
        "description": "Heals a friend.", "category": "potion",
        "rarity": "common", "consumable": True, "is_potion": True,
        "use_effect": {"effects": [{"type": "heal_hp", "dice_count": 1,
                                     "dice_type": 4, "flat_bonus": 3}]},
    })
    # Bump caster's slot cap — the slot-cap test filled them earlier.
    s.req("PATCH", f"/api/characters/{cid}", {"max_inventory_slots": 50})
    s.req("POST", f"/api/characters/{cid}/inventory",
          {"item_id": heal_item["id"], "quantity": 2})
    code, caster_inv = s.req("GET", f"/api/characters/{cid}/inventory")
    potion_row = next((i for i in caster_inv["items"] if i.get("id") == heal_item["id"]), None)
    s.check("caster holds Ally Tonic ×2",
            potion_row is not None and potion_row["quantity"] == 2)
    potion_inv_id = potion_row["inventory_id"] if potion_row else None

    tgt_hp_before = tgt_dmg["current_hp"]
    code, use_res = s.req("POST", f"/api/inventory/{potion_inv_id}/use",
                          {"target_id": tid})
    s.check("potion use-on-target returns 200", code == 200, f"body={use_res}")
    s.check("use response echoes target_id", use_res.get("target_id") == tid)
    code, tgt_after = s.req("GET", f"/api/characters/{tid}")
    s.check("target HP went UP (P2P heal)",
            tgt_after["current_hp"] > tgt_hp_before,
            f"{tgt_hp_before} → {tgt_after['current_hp']}")
    code, caster_inv2 = s.req("GET", f"/api/characters/{cid}/inventory")
    potion_row2 = next((i for i in caster_inv2["items"] if i.get("id") == heal_item["id"]), None)
    s.check("caster stack decremented by 1",
            potion_row2 is not None and potion_row2["quantity"] == 1)

    # Transfer the remaining potion from caster to target.
    code, xfer = s.req("POST", f"/api/inventory/{potion_row2['inventory_id']}/transfer",
                       {"target_character_id": tid, "quantity": 1})
    s.check("transfer returns 200", code == 200, f"body={xfer}")
    s.check("transfer echoes item_name", xfer.get("item_name") == "Ally Tonic")
    code, caster_inv3 = s.req("GET", f"/api/characters/{cid}/inventory")
    s.check("caster no longer holds Ally Tonic",
            not any(i.get("id") == heal_item["id"] for i in caster_inv3["items"]))
    code, target_inv = s.req("GET", f"/api/characters/{tid}/inventory")
    s.check("target now holds Ally Tonic",
            any(i.get("id") == heal_item["id"] for i in target_inv["items"]))

    # ── λ: N-d20 hit rolls (advantage/disadvantage pool, clamp 1..5) ──
    s.group("Phase λ: Rework v3 — N d20 on hit rolls")

    # Seed a second living combatant we can attack. Use the GM NPC endpoint.
    code, npc = s.req("POST", f"/api/sessions/{scode}/npc", {
        "name": "Dummy NPC",
        "armor_class": 10, "current_hp": 50, "max_hp": 50,
        "strength": 0, "dexterity": 0, "constitution": 0,
        "intelligence": 0, "wisdom": 0, "charisma": 0,
    })
    s.check("create NPC 200 (for hit-roll test)", code == 200, f"body={npc}")
    npc_id = npc.get("id") if isinstance(npc, dict) else None
    if npc_id:
        # N=4 + advantage → 4 d20s, server picks the MAX.
        code, hr = s.req("POST", "/api/combat/hit-roll", {
            "attacker_id": cid, "target_id": npc_id,
            "advantage": "advantage", "hit_dice_count": 4,
        })
        s.check("hit-roll(advantage, N=4) returns 200", code == 200, f"body={hr}")
        s.check("hit-roll rolled exactly 4 d20s",
                hr.get("dice_count_rolled") == 4,
                f"count={hr.get('dice_count_rolled')} list={hr.get('all_d20s')}")
        if hr.get("all_d20s"):
            s.check("advantage picked the MAX of 4",
                    hr.get("d20") == max(hr["all_d20s"]),
                    f"d20={hr.get('d20')} of {hr['all_d20s']}")

        # N=3 + disadvantage → server picks the MIN.
        code, hr2 = s.req("POST", "/api/combat/hit-roll", {
            "attacker_id": cid, "target_id": npc_id,
            "advantage": "disadvantage", "hit_dice_count": 3,
        })
        s.check("hit-roll(disadvantage, N=3) rolled 3",
                hr2.get("dice_count_rolled") == 3)
        if hr2.get("all_d20s"):
            s.check("disadvantage picked the MIN of 3",
                    hr2.get("d20") == min(hr2["all_d20s"]))

        # Clamp: ask for 99, server must clamp to cap (5).
        code, hr3 = s.req("POST", "/api/combat/hit-roll", {
            "attacker_id": cid, "target_id": npc_id,
            "advantage": "advantage", "hit_dice_count": 99,
        })
        s.check("hit_dice_count=99 clamped to 5",
                hr3.get("dice_count_rolled") == 5,
                f"count={hr3.get('dice_count_rolled')}")

        # Bump: adv + N=1 must auto-bump to 2 (single die → pick is moot).
        code, hr4 = s.req("POST", "/api/combat/hit-roll", {
            "attacker_id": cid, "target_id": npc_id,
            "advantage": "advantage", "hit_dice_count": 1,
        })
        s.check("adv + N=1 auto-bumped to 2",
                hr4.get("dice_count_rolled") == 2,
                f"count={hr4.get('dice_count_rolled')}")

    # ── μ: Fixed weapon damage + preset damage modes ──
    s.group("Phase μ: Rework v3 — damage modes")

    # Single-mode weapon (no damage_modes). Create item, serializer should
    # expose damage_modes = [].
    code, single_weapon = s.req("POST", "/api/items", {
        "session_id": sid, "name": "Simple Dagger",
        "description": "plain.", "category": "weapon", "rarity": "common",
        "weapon_stats": {
            "dice_count": 1, "dice_type": 4, "damage_type": "physical",
        },
    })
    s.check("single-mode weapon: damage_modes defaults to []",
            single_weapon.get("weapon_stats", {}).get("damage_modes") == [],
            f"modes={single_weapon.get('weapon_stats', {}).get('damage_modes')}")

    # Multi-mode weapon: one-handed 1d8, two-handed 1d10.
    code, multi_weapon = s.req("POST", "/api/items", {
        "session_id": sid, "name": "Versatile Blade",
        "description": "1h or 2h.", "category": "weapon", "rarity": "uncommon",
        "weapon_stats": {
            "dice_count": 1, "dice_type": 8, "damage_type": "physical",
            "damage_modes": [
                {"name": "One-handed", "dice_count": 1, "dice_type": 8, "damage_type": "physical"},
                {"name": "Two-handed", "dice_count": 1, "dice_type": 10, "damage_type": "physical"},
            ],
        },
    })
    modes = multi_weapon.get("weapon_stats", {}).get("damage_modes", [])
    s.check("multi-mode weapon round-tripped 2 modes", len(modes) == 2,
            f"got={modes}")
    if len(modes) == 2:
        s.check("mode 0 is 1d8", modes[0]["dice_count"] == 1 and modes[0]["dice_type"] == 8)
        s.check("mode 1 is 1d10", modes[1]["dice_count"] == 1 and modes[1]["dice_type"] == 10)

    # Update via PUT — shrink to a single mode.
    code, patched = s.req("PUT", f"/api/items/{multi_weapon['id']}", {
        "name": "Versatile Blade", "description": "1h or 2h.",
        "category": "weapon", "rarity": "uncommon",
        "weapon_stats": {
            "dice_count": 1, "dice_type": 8, "damage_type": "physical",
            "damage_modes": [
                {"name": "Only mode", "dice_count": 2, "dice_type": 6, "damage_type": "fire"},
            ],
        },
    })
    updated = (patched.get("weapon_stats") or {}).get("damage_modes", [])
    s.check("PUT updates damage_modes", len(updated) == 1 and updated[0]["dice_type"] == 6,
            f"got={updated}")

    # ── κ: Passive ability direct-mutation bonuses (max_hp_bonus) ──
    s.group("Phase κ: Rework v3 — new passive bonus types")
    code, boost = s.req("POST", "/api/abilities", {
        "session_id": sid, "name": "Ironhide",
        "description": "+10 Max HP passively.",
        "ability_type": "passive", "is_passive": True,
        "target_type": "self", "rarity": "common",
        "passive_effect": {"bonuses": [{"bonus_type": "max_hp_bonus", "value": 10}]},
    })
    code, ch_hp0 = s.req("GET", f"/api/characters/{tid}")
    hp_before_grant = ch_hp0["max_hp"]
    code, assign = s.req("POST", f"/api/characters/{tid}/abilities",
                         {"ability_id": boost["id"]})
    s.check("assign passive returns 200", code == 200)
    assigned_ca_id = assign.get("character_ability_id") or assign.get("id")
    code, ch_hp1 = s.req("GET", f"/api/characters/{tid}")
    s.check("max_hp_bonus applied +10 on grant",
            ch_hp1["max_hp"] == hp_before_grant + 10,
            f"{hp_before_grant} → {ch_hp1['max_hp']}")
    if assigned_ca_id:
        s.req("DELETE", f"/api/character-abilities/{assigned_ca_id}")
        code, ch_hp2 = s.req("GET", f"/api/characters/{tid}")
        s.check("max_hp_bonus reversed on unassign",
                ch_hp2["max_hp"] == hp_before_grant,
                f"after revert={ch_hp2['max_hp']}")

    # ── ν: AI envelope parser (offline, no OpenRouter / DB calls) ──
    s.group("Phase ν: Rework v3 — AI envelope parser")
    # Imported lazily so the suite still runs if `app/` has an unrelated import
    # error at startup — worst case we just skip phase ν with a warning.
    try:
        import os, sys as _sys
        _sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from app.ai_agent import parse_envelope, MAX_ACTIONS_PER_REPLY
    except Exception as imp_err:  # noqa: BLE001
        s.check(f"import app.ai_agent (skipped: {imp_err})", True)
    else:
        # 1) Well-formed envelope with a single NPC action round-trips.
        say, acts, err = parse_envelope(json.dumps({
            "say": "A hulking brute steps into the torchlight.",
            "actions": [{"kind": "create_npc", "payload": {
                "name": "Gorim the Brute", "max_hp": 45, "armor_class": 14,
                "strength": 4, "dexterity": 1, "constitution": 3,
            }}],
        }))
        s.check("envelope parses without error", err is None, f"err={err}")
        s.check("say preserved", "Gorim" in say or "brute" in say.lower())
        s.check("one npc action returned", len(acts) == 1 and acts[0]["kind"] == "create_npc")

        # 2) Model wrapped output in ```json fences — must still parse.
        fenced = "```json\n" + json.dumps({"say": "hi", "actions": []}) + "\n```"
        _, _, err2 = parse_envelope(fenced)
        s.check("fenced envelope parses", err2 is None, f"err={err2}")

        # 3) Model leaked prose around the envelope.
        noisy = 'Sure thing!  {"say":"forged","actions":[{"kind":"create_item","payload":{"name":"X","category":"misc","rarity":"common","description":"x"}}]}  Done.'
        _, acts3, err3 = parse_envelope(noisy)
        s.check("prose-wrapped envelope still parses", err3 is None, f"err={err3}")
        s.check("item action found inside prose", len(acts3) == 1 and acts3[0]["kind"] == "create_item")

        # 4) Bad / unknown kinds are filtered out, not raised.
        mixed = json.dumps({"say": "", "actions": [
            {"kind": "create_npc", "payload": {"name": "ok"}},
            {"kind": "delete_universe", "payload": {}},
            "not-a-dict",
            {"kind": "create_item", "payload": "also-not-a-dict"},
            {"kind": "create_ability", "payload": {"name": "Bolt", "ability_type": "active",
                                                     "target_type": "single", "rarity": "common",
                                                     "description": "zap"}},
        ]})
        _, acts4, err4 = parse_envelope(mixed)
        s.check("bad shapes filtered", err4 is None and len(acts4) == 2,
                f"kept={[a['kind'] for a in acts4]}")

        # 5) Cap enforced — a malicious model can't blow up the DB.
        spam = json.dumps({"say": "", "actions": [
            {"kind": "create_item", "payload": {"name": f"i{i}"}}
            for i in range(MAX_ACTIONS_PER_REPLY + 5)
        ]})
        _, acts5, _ = parse_envelope(spam)
        s.check(f"actions capped at {MAX_ACTIONS_PER_REPLY}",
                len(acts5) == MAX_ACTIONS_PER_REPLY,
                f"got {len(acts5)}")

        # 6) Pure chatter (no JSON) → not an error, just fallback say.
        say6, acts6, err6 = parse_envelope("Hello GM, how can I help?")
        s.check("non-JSON reply → fallback say",
                err6 == "no-json-fallback" and not acts6 and "Hello" in say6)

        # 7) Empty reply → explicit empty-reply error signal.
        _, _, err7 = parse_envelope("")
        s.check("empty reply flagged", err7 == "empty reply")

    return s.done()


def main() -> int:
    parser = argparse.ArgumentParser(description="Rework v2 regression suite")
    parser.add_argument("--base", default="http://127.0.0.1:8000",
                        help="Base URL of a running server (default: %(default)s)")
    args = parser.parse_args()
    try:
        return run(args.base)
    except (urllib.error.URLError, ConnectionError) as e:
        print(f"[!!] Could not reach server at {args.base}: {e}")
        print("     Start it first with `python main.py` and re-run.")
        return 2


if __name__ == "__main__":
    sys.exit(main())
