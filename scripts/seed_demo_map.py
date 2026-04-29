"""Seed the Riverside Village demo map.

Usage:
    python scripts/seed_demo_map.py

Env:
    DEMO_SESSION_CODE  default: DEMO01
"""
import asyncio
import os
import sys
from typing import Any

import httpx

BASE = "http://127.0.0.1:8000"
DEMO_SESSION_CODE = os.environ.get("DEMO_SESSION_CODE", "DEMO01")


class SeedError(Exception):
    pass


class MapExistsError(Exception):
    pass


# ── helpers ───────────────────────────────────────────────────

async def _ok(r: httpx.Response, msg: str) -> dict:
    if r.status_code >= 300:
        raise SeedError(f"FAIL {msg}: {r.status_code} {r.text[:200]}")
    return r.json()


async def _ensure_session(http: httpx.AsyncClient, code: str) -> int:
    r = await http.get(f"/api/sessions/{code}")
    if r.status_code == 200:
        return r.json()["id"]
    r = await http.post("/api/sessions/create", json={"name": "Demo Session", "code": code})
    data = await _ok(r, f"create session {code}")
    return data["session_id"]


async def _make_map(http: httpx.AsyncClient, session_code: str) -> int:
    r = await http.get(f"/api/builder-v2/sessions/{session_code}/maps")
    maps = (await _ok(r, "list maps"))
    for m in maps:
        if m["name"] == "Riverside Village":
            raise MapExistsError("Riverside Village already exists")
    r = await http.post(
        f"/api/builder-v2/sessions/{session_code}/maps",
        json={"name": "Riverside Village", "description": "5-location demo map"},
    )
    return (await _ok(r, "create map"))["id"]


async def _make_loc(http: httpx.AsyncClient, map_id: int, name: str, cols: int, rows: int,
                    ambient: float, indoor: bool) -> int:
    r = await http.post(
        f"/api/builder-v2/maps/{map_id}/locations",
        json={"name": name, "cols": cols, "rows": rows,
              "ambient_light": ambient, "is_indoor": indoor},
    )
    return (await _ok(r, f"create location {name}"))["id"]


async def _put_tiles(http: httpx.AsyncClient, loc_id: int, tiles: list[dict]):
    r = await http.put(
        f"/api/builder-v2/locations/{loc_id}/tiles",
        json={"tiles": tiles},
    )
    await _ok(r, f"put tiles {loc_id}")


async def _patch_tiles(http: httpx.AsyncClient, loc_id: int, set_tiles: list[dict]):
    r = await http.patch(
        f"/api/builder-v2/locations/{loc_id}/tiles",
        json={"set": set_tiles, "erase": []},
    )
    await _ok(r, f"patch tiles {loc_id}")


async def _make_light(http: httpx.AsyncClient, loc_id: int, col: int, row: int,
                      radius: float, color: str, intensity: float, kind: str,
                      bright: float | None = None):
    body = {
        "col": col, "row": row,
        "radius_cells": radius,
        "color_hex": color,
        "intensity": intensity,
        "source_kind": kind,
    }
    if bright is not None:
        body["bright_radius_cells"] = bright
    r = await http.post(f"/api/builder-v2/locations/{loc_id}/lights", json=body)
    await _ok(r, f"create light ({col},{row})")


async def _make_item(http: httpx.AsyncClient, name: str, **kwargs) -> int:
    r = await http.get("/api/items", params={"search": name})
    items = (await _ok(r, f"search item {name}"))
    for it in items:
        if it["name"] == name:
            return it["id"]
    body = {"name": name, "category": "misc", "rarity": "common", **kwargs}
    r = await http.post("/api/items", json=body)
    return (await _ok(r, f"create item {name}"))["id"]


async def _make_chest(http: httpx.AsyncClient, loc_id: int, col: int, row: int,
                      name: str, locked: bool, item_map: dict[str, int],
                      item_specs: list[tuple[str, int]]) -> int:
    r = await http.post(
        f"/api/builder-v2/locations/{loc_id}/chests",
        json={"col": col, "row": row, "name": name, "is_locked": locked},
    )
    data = await _ok(r, f"create chest {name}")
    entity_id = data["id"]
    for item_name, qty in item_specs:
        item_id = item_map[item_name]
        r = await http.post(
            f"/api/builder-v2/chests/{entity_id}/items",
            json={"item_id": item_id, "quantity": qty},
        )
        await _ok(r, f"add item {item_name} to chest {entity_id}")
    return entity_id


async def _ensure_npc_template(http: httpx.AsyncClient, session_id: int, name: str, **kwargs) -> int:
    r = await http.get("/api/npc-library/templates", params={"session_id": session_id})
    tpls = (await _ok(r, f"list templates"))
    for t in tpls:
        if t["name"] == name:
            return t["id"]
    body = {"session_id": session_id, "name": name, **kwargs}
    r = await http.post("/api/npc-library/templates", json=body)
    return (await _ok(r, f"create template {name}"))["id"]


async def _make_npc_spawn(http: httpx.AsyncClient, loc_id: int, col: int, row: int,
                          name: str, template_id: int, hostile: bool = True):
    r = await http.post(
        f"/api/builder-v2/locations/{loc_id}/npc-spawns",
        json={
            "col": col, "row": row, "name": name,
            "npc_template_id": template_id,
            "auto_spawn_trigger": "on_enter",
            "spawn_count": 1,
            "has_spawned": False,
            "is_hostile": hostile,
        },
    )
    await _ok(r, f"create npc spawn {name}")


async def _make_trap(http: httpx.AsyncClient, loc_id: int, col: int, row: int,
                     name: str, trap_type: str, damage: str, visible: bool = True):
    r = await http.post(
        f"/api/builder-v2/locations/{loc_id}/traps",
        json={
            "col": col, "row": row, "name": name,
            "trap_type": trap_type, "damage_dice": damage,
            "damage_type": "piercing" if trap_type == "spike" else "poison",
            "visible_to_players": visible,
        },
    )
    await _ok(r, f"create trap {name}")


async def _make_edge(http: httpx.AsyncClient, loc_id: int, side: str, rs: int, re: int,
                     target_id: int, ec: int, er: int):
    r = await http.post(
        f"/api/builder-v2/locations/{loc_id}/edges",
        json={
            "side": side,
            "range_start": rs, "range_end": re,
            "target_location_id": target_id,
            "target_entry_col": ec, "target_entry_row": er,
        },
    )
    await _ok(r, f"create edge {loc_id}->{target_id}")


async def _make_entity(http: httpx.AsyncClient, loc_id: int, col: int, row: int,
                       entity_type: str, name: str, visible: bool = True):
    r = await http.post(
        f"/api/builder-v2/locations/{loc_id}/entities",
        json={"col": col, "row": row, "entity_type": entity_type,
              "name": name, "visible_to_players": visible},
    )
    await _ok(r, f"create entity {name}")


# ── tile generators ───────────────────────────────────────────

def _perimeter(cols: int, rows: int, tile_type: str = "wall") -> list[dict]:
    tiles = []
    for c in range(cols):
        tiles.append({"col": c, "row": 0, "tile_type": tile_type})
        tiles.append({"col": c, "row": rows - 1, "tile_type": tile_type})
    for r in range(1, rows - 1):
        tiles.append({"col": 0, "row": r, "tile_type": tile_type})
        tiles.append({"col": cols - 1, "row": r, "tile_type": tile_type})
    return tiles


def _rect(c0: int, r0: int, c1: int, r1: int, tile_type: str = "floor") -> list[dict]:
    return [{"col": c, "row": r, "tile_type": tile_type}
            for c in range(c0, c1 + 1) for r in range(r0, r1 + 1)]


# ── seed core ─────────────────────────────────────────────────

async def seed_demo(http: httpx.AsyncClient, session_code: str) -> dict[str, Any]:
    session_id = await _ensure_session(http, session_code)
    try:
        map_id = await _make_map(http, session_code)
    except MapExistsError:
        return {"skipped": True}

    # ── locations ─────────────────────────────────────────────
    loc_vs = await _make_loc(http, map_id, "Village Square", 32, 24, 0.4, False)
    loc_tavern = await _make_loc(http, map_id, "Tavern", 20, 16, 0.2, True)
    loc_market = await _make_loc(http, map_id, "Market", 28, 20, 0.7, False)
    loc_dungeon = await _make_loc(http, map_id, "Underground Dungeon", 24, 18, 0.0, True)
    loc_entrance = await _make_loc(http, map_id, "Dungeon Entrance", 16, 12, 0.1, True)

    locs = {
        "Village Square": loc_vs,
        "Tavern": loc_tavern,
        "Market": loc_market,
        "Underground Dungeon": loc_dungeon,
        "Dungeon Entrance": loc_entrance,
    }

    # ── tiles ─────────────────────────────────────────────────
    # Village Square: perimeter wall, center floor, pillars, doors
    tiles_vs = _perimeter(32, 24, "wall")
    tiles_vs += _rect(12, 8, 19, 15, "floor")
    tiles_vs += [{"col": 10, "row": 10, "tile_type": "wall"},
                 {"col": 21, "row": 10, "tile_type": "wall"}]
    # doors will be patched after PUT
    await _put_tiles(http, loc_vs, tiles_vs)
    await _patch_tiles(http, loc_vs, [
        {"col": 8, "row": 0, "tile_type": "door", "is_open": True},
        {"col": 16, "row": 23, "tile_type": "door", "is_open": True},
        {"col": 31, "row": 12, "tile_type": "door", "is_open": True},
    ])

    # Tavern: perimeter wall, bar counter, tables as floor, door
    tiles_tavern = _perimeter(20, 16, "wall")
    tiles_tavern += _rect(2, 2, 7, 2, "wall")  # bar counter
    tiles_tavern += [{"col": 10, "row": 5, "tile_type": "floor"},
                     {"col": 14, "row": 5, "tile_type": "floor"},
                     {"col": 10, "row": 10, "tile_type": "floor"},
                     {"col": 14, "row": 10, "tile_type": "floor"}]
    await _put_tiles(http, loc_tavern, tiles_tavern)
    await _patch_tiles(http, loc_tavern, [
        {"col": 9, "row": 15, "tile_type": "door", "is_open": True},
    ])

    # Market: perimeter wall, stalls, doors
    tiles_market = _perimeter(28, 20, "wall")
    tiles_market += _rect(2, 5, 12, 5, "wall")
    tiles_market += _rect(16, 5, 25, 5, "wall")
    await _put_tiles(http, loc_market, tiles_market)
    await _patch_tiles(http, loc_market, [
        {"col": 0, "row": 9, "tile_type": "door", "is_open": True},
        {"col": 27, "row": 9, "tile_type": "door", "is_open": True},
    ])

    # Underground Dungeon: all wall, then carve corridors
    tiles_dungeon = _rect(0, 0, 23, 17, "wall")
    # main corridor
    tiles_dungeon += _rect(2, 8, 22, 10, "floor")
    # side chambers
    tiles_dungeon += _rect(2, 3, 8, 7, "floor")
    tiles_dungeon += _rect(16, 11, 22, 16, "floor")
    # boss chamber
    tiles_dungeon += _rect(9, 3, 15, 15, "floor")
    # pillars in boss chamber
    tiles_dungeon += [{"col": 10, "row": 4, "tile_type": "wall"},
                      {"col": 14, "row": 4, "tile_type": "wall"},
                      {"col": 10, "row": 14, "tile_type": "wall"},
                      {"col": 14, "row": 14, "tile_type": "wall"}]
    # entrance at north (connects to Dungeon Entrance)
    tiles_dungeon += _rect(11, 0, 13, 0, "floor")
    await _put_tiles(http, loc_dungeon, tiles_dungeon)

    # Dungeon Entrance: perimeter wall, doors, staircase floor
    tiles_entrance = _perimeter(16, 12, "wall")
    tiles_entrance += _rect(6, 8, 9, 10, "floor")
    await _put_tiles(http, loc_entrance, tiles_entrance)
    await _patch_tiles(http, loc_entrance, [
        {"col": 7, "row": 0, "tile_type": "door", "is_open": True},
        {"col": 7, "row": 11, "tile_type": "door", "is_open": True},
    ])

    # ── lights ────────────────────────────────────────────────
    # Village Square
    await _make_light(http, loc_vs, 8, 1, 5, "#ffd9a0", 1.0, "torch")
    await _make_light(http, loc_vs, 16, 12, 6, "#ffd9a0", 1.0, "torch")
    await _make_light(http, loc_vs, 20, 20, 4, "#a0d4ff", 1.0, "magic")

    # Tavern
    await _make_light(http, loc_tavern, 1, 8, 4, "#ff6b2b", 1.3, "torch")
    await _make_light(http, loc_tavern, 10, 4, 2, "#ffe0a0", 1.0, "torch")
    await _make_light(http, loc_tavern, 14, 9, 2, "#ffe0a0", 1.0, "torch")

    # Market
    await _make_light(http, loc_market, 6, 4, 5, "#fff5c0", 1.0, "magic")
    await _make_light(http, loc_market, 20, 4, 5, "#fff5c0", 1.0, "magic")
    await _make_light(http, loc_market, 14, 14, 5, "#fff5c0", 1.0, "magic")

    # Underground Dungeon
    await _make_light(http, loc_dungeon, 12, 9, 6, "#9b59b6", 0.8, "magic")
    await _make_light(http, loc_dungeon, 3, 9, 3, "#ff8800", 1.0, "torch")

    # Dungeon Entrance
    await _make_light(http, loc_entrance, 7, 2, 3, "#cc6600", 0.6, "torch")

    # ── items ─────────────────────────────────────────────────
    item_map: dict[str, int] = {}
    for name, kwargs in [
        ("Gold Coins", {"category": "misc"}),
        ("Village Map", {"category": "misc"}),
        ("Healing Potion", {"category": "potion", "is_potion": True, "consumable": True}),
        ("Torch", {"category": "misc"}),
        ("Cellar Key", {"category": "misc"}),
        ("Rare Potion of Speed", {"category": "potion", "is_potion": True, "consumable": True, "rarity": "rare"}),
        ("Sapphire", {"category": "misc", "rarity": "uncommon"}),
        ("Staff of Shadows", {"category": "weapon", "equippable": True, "rarity": "legendary"}),
        ("Scroll of Resurrection", {"category": "scroll", "consumable": True, "rarity": "epic"}),
        ("Dragon Ruby", {"category": "misc", "rarity": "legendary"}),
        ("50ft Rope", {"category": "misc"}),
        ("Sword", {"category": "weapon", "equippable": True}),
        ("Staff", {"category": "weapon", "equippable": True}),
    ]:
        item_map[name] = await _make_item(http, name, **kwargs)

    # ── chests ────────────────────────────────────────────────
    await _make_chest(http, loc_vs, 3, 3, "Iron Chest", True, item_map,
                      [("Gold Coins", 50), ("Village Map", 1)])
    await _make_chest(http, loc_vs, 29, 21, "Wooden Chest", False, item_map,
                      [("Healing Potion", 1), ("Torch", 1)])
    await _make_chest(http, loc_tavern, 18, 14, "Locked Chest", True, item_map,
                      [("Cellar Key", 1), ("Gold Coins", 10)])
    await _make_chest(http, loc_market, 1, 1, "Market Chest", False, item_map,
                      [("Rare Potion of Speed", 1)])
    await _make_chest(http, loc_market, 26, 18, "Hidden Chest", False, item_map,
                      [("Sapphire", 1), ("Gold Coins", 30)])
    await _make_chest(http, loc_dungeon, 13, 12, "Legendary Chest", True, item_map,
                      [("Staff of Shadows", 1), ("Scroll of Resurrection", 1),
                       ("Gold Coins", 200), ("Dragon Ruby", 1)])
    await _make_chest(http, loc_entrance, 1, 1, "Supply Chest", False, item_map,
                      [("50ft Rope", 1), ("Torch", 3)])

    # ── NPC templates ─────────────────────────────────────────
    tpl_innkeeper = await _ensure_npc_template(
        http, session_id, "Innkeeper",
        strength=12, constitution=14, charisma=16, max_hp=20,
        notes="Welcome, traveller!",
    )
    tpl_guard = await _ensure_npc_template(
        http, session_id, "Guard",
        strength=16, dexterity=10, constitution=15, max_hp=30,
        default_equipment=[item_map["Sword"]],
    )
    tpl_merchant = await _ensure_npc_template(
        http, session_id, "Merchant",
        charisma=18, intelligence=14, max_hp=10,
        is_merchant=True,
        shop_items=[
            {"item_id": item_map["Healing Potion"], "stock": 10, "price_override": 5000},
            {"item_id": item_map["Torch"], "stock": 20, "price_override": 100},
            {"item_id": item_map["50ft Rope"], "stock": 10, "price_override": 100},
        ],
    )
    tpl_skeleton = await _ensure_npc_template(
        http, session_id, "Skeleton Guard",
        strength=14, dexterity=14, constitution=10, max_hp=18,
        notes="Undead — immune to poison",
    )
    tpl_necro = await _ensure_npc_template(
        http, session_id, "Necromancer Boss",
        intelligence=18, wisdom=14, constitution=12, max_hp=80,
        notes="Darkness Spell, Raise Dead",
        default_equipment=[item_map["Staff"]],
    )

    # ── NPC spawns ────────────────────────────────────────────
    await _make_npc_spawn(http, loc_tavern, 4, 3, "Barkeep Thor", tpl_innkeeper, hostile=False)
    await _make_npc_spawn(http, loc_tavern, 11, 7, "Drunk Knight", tpl_guard, hostile=False)
    await _make_npc_spawn(http, loc_market, 7, 7, "Merchant Leya", tpl_merchant, hostile=False)
    await _make_npc_spawn(http, loc_dungeon, 5, 9, "Skeleton Guard", tpl_skeleton, hostile=True)
    await _make_npc_spawn(http, loc_dungeon, 12, 7, "BOSS — Necromancer Vork", tpl_necro, hostile=True)
    await _make_npc_spawn(http, loc_entrance, 7, 5, "Old Guard Drog", tpl_guard, hostile=False)

    # ── traps ─────────────────────────────────────────────────
    await _make_trap(http, loc_dungeon, 6, 9, "Spike Trap", "spike", "2d6", visible=False)
    await _make_trap(http, loc_dungeon, 18, 9, "Poison Dart", "dart", "1d4", visible=False)

    # ── entities (stairs, furniture) ──────────────────────────
    await _make_entity(http, loc_entrance, 8, 9, "stairs_down", "Staircase Down")
    for fc, fr in [(10, 5), (14, 5), (10, 10), (14, 10)]:
        await _make_entity(http, loc_tavern, fc, fr, "furniture", "Table")

    # ── edges ─────────────────────────────────────────────────
    # Village Square -> Tavern (north col 14-17)
    await _make_edge(http, loc_vs, "north", 14, 17, loc_tavern, 9, 15)
    # Tavern -> Village Square (south col 8-10)
    await _make_edge(http, loc_tavern, "south", 8, 10, loc_vs, 16, 0)
    # Village Square -> Market (east row 10-13)
    await _make_edge(http, loc_vs, "east", 10, 13, loc_market, 0, 9)
    # Market -> Village Square (west row 8-10)
    await _make_edge(http, loc_market, "west", 8, 10, loc_vs, 31, 12)
    # Village Square -> Dungeon Entrance (south col 14-17)
    await _make_edge(http, loc_vs, "south", 14, 17, loc_entrance, 7, 0)
    # Dungeon Entrance -> Village Square (north col 6-8)
    await _make_edge(http, loc_entrance, "north", 6, 8, loc_vs, 16, 23)
    # Dungeon Entrance -> Underground Dungeon (south col 6-8)
    await _make_edge(http, loc_entrance, "south", 6, 8, loc_dungeon, 12, 0)
    # Underground Dungeon -> Dungeon Entrance (north col 11-13)
    await _make_edge(http, loc_dungeon, "north", 11, 13, loc_entrance, 7, 11)

    # ── activate Village Square ───────────────────────────────
    await http.post(f"/api/builder-v2/locations/{loc_vs}/activate")

    return {
        "map_id": map_id,
        "locations": locs,
        "lights": 10,
        "chests": 7,
        "npc_spawns": 6,
        "traps": 2,
    }


async def main():
    async with httpx.AsyncClient(base_url=BASE, timeout=30.0) as http:
        result = await seed_demo(http, DEMO_SESSION_CODE)

    if result.get("skipped"):
        print("Already exists — skipping")
        sys.exit(0)

    locs = result["locations"]
    print("✓ Riverside Village created")
    print(f"  Session  : {DEMO_SESSION_CODE}")
    print(f"  Map ID   : {result['map_id']}")
    print(f"  Locations: Village Square (#{locs['Village Square']}), Tavern (#{locs['Tavern']}),")
    print(f"             Market (#{locs['Market']}), Dungeon Entrance (#{locs['Dungeon Entrance']}),")
    print(f"             Underground Dungeon (#{locs['Underground Dungeon']})")
    print(f"  Lights   : {result['lights']} created")
    print(f"  Chests   : {result['chests']} created")
    print(f"  NPCs     : {result['npc_spawns']} spawned")
    print(f"  Traps    : {result['traps']} placed")


if __name__ == "__main__":
    asyncio.run(main())
