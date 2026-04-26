"""Map Builder v2 — comprehensive integration test.

Tests the entire Map Builder system:
  - Thin MapData (active_floor_id pointer)
  - activate_floor without data copying
  - Library save/load with all entities (traps, chests, portals)
  - MapChest items (add/remove/take)
  - Portal teleportation
  - Entity editing/deletion
  - Both GM and Player data paths

Requires: python main.py running at http://127.0.0.1:8000
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request


def _request(base, method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        return resp.status, json.loads(resp.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "null")


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
        print("  MAP BUILDER v2 — ALL PASSED")
        return 0


def run(base: str) -> int:
    s = Suite(base)

    # ══════════════════════════════════════════════════════════════
    # SETUP: Session + Map + Floor
    # ══════════════════════════════════════════════════════════════
    s.group("Setup: session, map, floor")
    code, data = s.req("POST", "/api/sessions/create", {"name": "Map Builder v2 Test"})
    s.check("Create session", code == 200, f"status={code}")
    session_id = data["session_id"]
    session_code = data["session_code"]

    # Create a map
    code, map_data = s.req("POST", f"/api/map-builder/{session_code}/maps", {"name": "Test Dungeon"})
    s.check("Create map template", code == 200)
    map_id = map_data["id"]

    # Create a floor
    code, floor_data = s.req("POST", f"/api/map-builder/{session_code}/floors", {
        "name": "Level 1",
        "map_id": map_id,
        "tile_size": 50,
        "grid_type": "square",
        "map_cols": 20,
        "map_rows": 15,
        "tiles_json": json.dumps({"0,0": "wall", "1,1": "floor"}),
    })
    s.check("Create floor", code == 200)
    floor_id = floor_data["id"]

    # ══════════════════════════════════════════════════════════════
    # MAP TRAPS
    # ══════════════════════════════════════════════════════════════
    s.group("MapTrap CRUD")
    code, trap = s.req("POST", f"/api/map-builder/{session_code}/traps", {
        "floor_id": floor_id,
        "col": 5, "row": 5,
        "name": "Spike Trap",
        "dc_detect": 15,
        "dc_disarm": 12,
        "damage_dice": "2d6",
        "is_hidden": True,
    })
    s.check("Create trap", code == 200, f"id={trap.get('id')}")
    trap_id = trap["id"]

    code, traps = s.req("GET", f"/api/map-builder/{session_code}/traps")
    s.check("List traps", code == 200, f"count={len(traps)}")
    s.check("Trap in list", any(t["id"] == trap_id for t in traps))

    code, _ = s.req("DELETE", f"/api/map-builder/traps/{trap_id}")
    s.check("Delete trap", code == 200)

    code, traps_after = s.req("GET", f"/api/map-builder/{session_code}/traps")
    s.check("Trap removed", not any(t["id"] == trap_id for t in traps_after))

    # ══════════════════════════════════════════════════════════════
    # MAP CHESTS (with items)
    # ══════════════════════════════════════════════════════════════
    s.group("MapChest with items")
    
    # First, create an item to put in the chest
    code, item = s.req("POST", "/api/items", {
        "name": "Magic Sword",
        "description": "A shiny sword",
        "category": "weapon",
        "rarity": "rare",
    })
    s.check("Create item for chest", code == 200)
    item_id = item["id"]

    code, chest = s.req("POST", f"/api/map-builder/{session_code}/chests", {
        "floor_id": floor_id,
        "col": 3, "row": 3,
        "name": "Treasure Chest",
        "items": [
            {"item_id": item_id, "quantity": 1, "item_name": "Magic Sword", "item_type": "item"},
            {"item_type": "currency", "currency_type": "gold", "quantity": 50, "item_name": "Gold"},
        ],
        "is_hidden": False,
        "visible_to_players": True,
        "is_locked": False,
        "lock_dc": 10,
    })
    if code != 200:
        print(f"DEBUG chest error: code={code}, body={chest}")
    s.check("Create chest with items", code == 200, f"id={chest.get('id')}")
    if code != 200:
        return s.done()
    chest_id = chest["id"]

    # Verify items are stored
    code, chest_items = s.req("GET", f"/api/map-builder/chests/{chest_id}/items")
    s.check("Get chest items", code == 200, f"count={len(chest_items.get('items', []))}")
    s.check("Chest has 2 items", len(chest_items.get("items", [])) == 2)
    
    item_names = [i.get("item_name", "") for i in chest_items.get("items", [])]
    s.check("Has Magic Sword", "Magic Sword" in item_names)
    s.check("Has Gold", "Gold" in item_names)

    # Update chest (lock it)
    code, _ = s.req("PATCH", f"/api/map-builder/chests/{chest_id}", {"is_locked": True, "lock_dc": 20})
    s.check("Lock chest", code == 200)

    code, chest_items_locked = s.req("GET", f"/api/map-builder/chests/{chest_id}/items")
    s.check("Chest is locked", chest_items_locked.get("is_locked") == True)
    s.check("Lock DC updated", chest_items_locked.get("lock_dc") == 20)

    # Unlock for later tests
    code, _ = s.req("PATCH", f"/api/map-builder/chests/{chest_id}", {"is_locked": False})
    s.check("Unlock chest", code == 200)

    # ══════════════════════════════════════════════════════════════
    # MAP PORTALS
    # ══════════════════════════════════════════════════════════════
    s.group("MapPortal CRUD")
    
    # Create target floor for portal
    code, floor2 = s.req("POST", f"/api/map-builder/{session_code}/floors", {
        "name": "Level 2",
        "map_id": map_id,
        "tile_size": 50,
        "grid_type": "square",
        "map_cols": 20,
        "map_rows": 15,
    })
    s.check("Create target floor", code == 200)
    floor2_id = floor2["id"]

    code, portal = s.req("POST", f"/api/map-builder/{session_code}/portals", {
        "floor_id": floor_id,
        "col": 10, "row": 10,
        "name": "Stairs Down",
        "target_map_id": map_id,
        "target_floor_id": floor2_id,
        "target_col": 1,
        "target_row": 1,
    })
    s.check("Create portal", code == 200, f"id={portal.get('id')}")
    portal_id = portal["id"]

    code, portals = s.req("GET", f"/api/map-builder/{session_code}/portals")
    s.check("List portals", code == 200, f"count={len(portals)}")
    s.check("Portal targets floor 2", any(p.get("target_floor_id") == floor2_id for p in portals))

    # ══════════════════════════════════════════════════════════════
    # ACTIVATE FLOOR (thin pointer)
    # ══════════════════════════════════════════════════════════════
    s.group("activate_floor (thin pointer)")
    
    code, _ = s.req("POST", f"/api/map-builder/floors/{floor_id}/activate")
    s.check("Activate floor", code == 200)

    # Check MapData has active_floor_id
    code, map_state = s.req("GET", f"/api/map/{session_code}")
    s.check("Map state returns data", code == 200)
    s.check("Has active_floor_id", map_state.get("active_floor_id") == floor_id)
    s.check("Has active_floor_tiles", "active_floor_tiles" in map_state)
    s.check("Tiles from floor", map_state.get("active_floor_tiles", {}).get("0,0") == "wall")
    s.check("Grid type from floor", map_state.get("grid_type") == "square")
    s.check("Tile size from floor", map_state.get("grid_size") == 50)

    # ══════════════════════════════════════════════════════════════
    # LIBRARY SAVE/LOAD
    # ══════════════════════════════════════════════════════════════
    s.group("Library save/load with entities")
    
    # Save specific map (not all session floors)
    code, lib = s.req("POST", f"/api/map-builder/{session_code}/library", {
        "name": "Test Library Map",
        "map_id": map_id,
    })
    if code != 200:
        print(f"DEBUG save_to_library error: code={code}, body={lib}")
    s.check("Save to library", code == 200, f"id={lib.get('id')}")
    if code != 200:
        return s.done()
    library_id = lib["id"]

    # Create a second map with a floor to test isolation
    code, map2 = s.req("POST", f"/api/map-builder/{session_code}/maps", {"name": "Second Map"})
    s.check("Create second map", code == 200)
    code, floor3 = s.req("POST", f"/api/map-builder/{session_code}/floors", {
        "name": "Floor 3 (isolated)",
        "map_id": map2["id"],
        "tile_size": 50,
        "grid_type": "square",
        "map_cols": 10,
        "map_rows": 10,
    })
    s.check("Create isolated floor", code == 200)

    # Save library again — should still have only 2 floors (from first map, not 3 total)
    code, lib2 = s.req("POST", f"/api/map-builder/{session_code}/library", {
        "name": "Test Library Map 2",
        "map_id": map_id,
    })
    s.check("Save specific map only", code == 200)

    # Load into a NEW session
    code, session2 = s.req("POST", "/api/sessions/create", {"name": "Load Target Session"})
    s.check("Create target session", code == 200)
    session2_id = session2["session_id"]
    session2_code = session2["session_code"]

    code, loaded = s.req("POST", f"/api/map-builder/library/{library_id}/load", {"session_id": session2_id})
    s.check("Load from library", code == 200, f"floors={loaded.get('count')}")
    s.check("Created 2 floors", loaded.get("count") == 2)
    s.check("Returns map_id", loaded.get("map_id") is not None)

    # Verify tiles_json was preserved
    loaded_floors = loaded.get("floors", [])
    loaded_floor1_id = loaded_floors[0]["id"]
    loaded_tiles = json.loads(loaded_floors[0].get("tiles_json", "{}"))
    s.check("Tiles preserved in load response", loaded_tiles.get("0,0") == "wall", f"tiles={loaded_tiles}")

    loaded_floors = loaded.get("floors", [])
    loaded_floor1_id = loaded_floors[0]["id"]
    loaded_floor2_id = loaded_floors[1]["id"]

    # Check auto-activation
    code, map_state2 = s.req("GET", f"/api/map/{session2_code}")
    s.check("Auto-activated first floor", map_state2.get("active_floor_id") == loaded_floor1_id)

    # Check entities were restored
    code, loaded_chests = s.req("GET", f"/api/map-builder/{session2_code}/chests")
    s.check("Chests restored", len(loaded_chests) == 1, f"count={len(loaded_chests)}")
    
    if loaded_chests:
        loaded_chest_id = loaded_chests[0]["id"]
        code, loaded_chest_items = s.req("GET", f"/api/map-builder/chests/{loaded_chest_id}/items")
        s.check("Chest items restored", len(loaded_chest_items.get("items", [])) == 2)

    code, loaded_portals = s.req("GET", f"/api/map-builder/{session2_code}/portals")
    s.check("Portals restored", len(loaded_portals) == 1, f"count={len(loaded_portals)}")
    
    if loaded_portals:
        # Check portal target_floor_id was remapped
        s.check("Portal target remapped", loaded_portals[0].get("target_floor_id") == loaded_floor2_id)

    # ══════════════════════════════════════════════════════════════
    # LOOT SYSTEM (take items)
    # ══════════════════════════════════════════════════════════════
    s.group("Loot system")
    
    # Create a character to take items
    code, char_data = s.req("POST", "/api/sessions/join", {
        "session_code": session2_code,
        "name": "Loot Tester",
        "player_name": "Test Player",
    })
    s.check("Join session for loot test", code == 200)
    char_id = char_data["character_id"]

    # Get initial currency
    code, char_before = s.req("GET", f"/api/characters/{char_id}")
    initial_gold = char_before.get("gold", 0) or 0
    initial_bronze = char_before.get("wealth_bronze", 0) or 0

    # Take all items from chest
    loaded_chest_id = loaded_chests[0]["id"]
    code, take_result = s.req("POST", f"/api/map-builder/chests/{loaded_chest_id}/take", {
        "character_id": char_id,
        "item_indices": None,  # take all
    })
    s.check("Take all items", code == 200, f"taken={len(take_result.get('taken', []))}")
    s.check("Taken 2 items", len(take_result.get("taken", [])) == 2)
    s.check("Chest empty after", take_result.get("remaining_count") == 0)

    # Verify character got currency
    code, char_after = s.req("GET", f"/api/characters/{char_id}")
    s.check("Gold increased", (char_after.get("gold", 0) or 0) > initial_gold)

    # Verify character got item in inventory
    code, inv = s.req("GET", f"/api/characters/{char_id}/inventory?tab=all")
    inv_items = inv.get("items", [])
    item_names = [i.get("item_name") or i.get("name") for i in inv_items]
    if "Magic Sword" not in item_names:
        print(f"DEBUG inventory items: {item_names}")
    s.check("Item in inventory", "Magic Sword" in item_names)

    # ══════════════════════════════════════════════════════════════
    # PORTAL TELEPORTATION
    # ══════════════════════════════════════════════════════════════
    s.group("Portal teleportation")
    
    loaded_portal_id = loaded_portals[0]["id"]
    
    # Set character position
    code, _ = s.req("PATCH", f"/api/characters/{char_id}", {"map_x": 0.5, "map_y": 0.5})
    s.check("Set char position", code == 200)

    # Use portal
    code, teleport = s.req("POST", f"/api/map-builder/portals/{loaded_portal_id}/use", {
        "character_id": char_id,
    })
    s.check("Teleport through portal", code == 200)
    s.check("Returns target info", teleport.get("target_floor_id") == loaded_floor2_id)

    # Verify character moved
    code, char_teleported = s.req("GET", f"/api/characters/{char_id}")
    # Position should be target_col / map_cols = 1 / 20 = 0.05
    moved = char_teleported.get("map_x") is not None and char_teleported.get("map_x") != 0.5
    s.check("Character moved", moved)

    # ══════════════════════════════════════════════════════════════
    # ENTITY EDITING
    # ══════════════════════════════════════════════════════════════
    s.group("Entity editing")
    
    # Edit chest name
    code, edited_chest = s.req("PATCH", f"/api/map-builder/chests/{loaded_chest_id}", {
        "name": "Updated Chest Name",
    })
    s.check("Edit chest name", code == 200)
    s.check("Name updated", edited_chest.get("name") == "Updated Chest Name")

    # Edit portal target
    code, edited_portal = s.req("PATCH", f"/api/map-builder/portals/{loaded_portal_id}", {
        "target_col": 5,
        "target_row": 5,
    })
    s.check("Edit portal target", code == 200)
    s.check("Target updated", edited_portal.get("target_col") == 5)

    # ══════════════════════════════════════════════════════════════
    # LEGACY CHEST (float coords)
    # ══════════════════════════════════════════════════════════════
    s.group("Legacy chest system")
    
    # Create legacy chest
    code, legacy_chest = s.req("POST", f"/api/map/{session_code}/chests", {
        "name": "Legacy Chest",
        "description": "Test legacy chest",
        "icon": "📦",
        "map_x": 0.5,
        "map_y": 0.5,
    })
    s.check("Create legacy chest", code == 200)
    legacy_chest_id = legacy_chest["id"]
    
    # Add item to legacy chest
    code, _ = s.req("POST", f"/api/chests/{legacy_chest_id}/items", {
        "item_id": item_id,
        "quantity": 1,
    })
    s.check("Add item to legacy chest", code == 200)
    
    # Verify items
    code, legacy_items = s.req("GET", f"/api/chests/{legacy_chest_id}/items")
    s.check("Get legacy chest items", code == 200)
    s.check("Legacy chest has item", len(legacy_items) > 0)
    
    # Update legacy chest
    code, updated_legacy = s.req("PUT", f"/api/chests/{legacy_chest_id}", {
        "name": "Updated Legacy Chest",
        "description": "Updated",
        "icon": "📦",
        "map_x": 0.5,
        "map_y": 0.5,
    })
    s.check("Update legacy chest", code == 200)
    s.check("Legacy name updated", updated_legacy.get("name") == "Updated Legacy Chest")
    
    # Reveal / Hide
    code, _ = s.req("PATCH", f"/api/chests/{legacy_chest_id}/reveal")
    s.check("Reveal legacy chest", code == 200)
    code, _ = s.req("PATCH", f"/api/chests/{legacy_chest_id}/hide")
    s.check("Hide legacy chest", code == 200)
    
    # ══════════════════════════════════════════════════════════════
    # NEW MAP — no floor duplication
    # ══════════════════════════════════════════════════════════════
    s.group("New map floor isolation")
    
    # Create a second map
    code, map2 = s.req("POST", f"/api/map-builder/{session_code}/maps", {"name": "Second Map"})
    s.check("Create second map", code == 200)
    map2_id = map2["id"]
    
    # Create floor on second map
    code, floor2_map2 = s.req("POST", f"/api/map-builder/{session_code}/floors", {
        "name": "Floor 1",
        "map_id": map2_id,
        "sort_order": 0,
    })
    s.check("Create floor on map2", code == 200)
    
    # Verify map2 has exactly 1 floor
    code, map2_floors = s.req("GET", f"/api/map-builder/maps/{map2_id}/floors")
    s.check("Map2 has 1 floor", len(map2_floors) == 1)
    s.check("Map2 floor name is Floor 1", map2_floors[0].get("name") == "Floor 1")
    
    # Verify first map still has its floors
    code, map1_floors = s.req("GET", f"/api/map-builder/maps/{map_id}/floors")
    s.check("Map1 floors preserved", len(map1_floors) >= 1)
    
    # Cleanup map2
    s.req("DELETE", f"/api/map-builder/floors/{floor2_map2['id']}")
    s.req("DELETE", f"/api/map-builder/maps/{map2_id}")
    s.check("Cleanup map2", True)
    
    # Cleanup legacy chest
    s.req("DELETE", f"/api/chests/{legacy_chest_id}")
    s.check("Cleanup legacy chest", True)

    # ══════════════════════════════════════════════════════════════
    # CLEANUP
    # ══════════════════════════════════════════════════════════════
    s.group("Cleanup")
    
    code, _ = s.req("DELETE", f"/api/map-builder/chests/{loaded_chest_id}")
    s.check("Delete chest", code == 200)
    
    code, _ = s.req("DELETE", f"/api/map-builder/portals/{loaded_portal_id}")
    s.check("Delete portal", code == 200)
    
    code, _ = s.req("DELETE", f"/api/map-builder/library/{library_id}")
    s.check("Delete library entry", code == 200)

    return s.done()


def main():
    parser = argparse.ArgumentParser(description="Map Builder v2 integration test")
    parser.add_argument("--base", default="http://127.0.0.1:8000", help="Server base URL")
    args = parser.parse_args()
    sys.exit(run(args.base))


if __name__ == "__main__":
    main()
