"""Phase 10 demo seed: Greenhollow Village + Crypt.

Creates a 6-location playable world that exercises every Phase 10
feature (Building tool, lighting HUD, shadow casting, three-layer
fog, edge transitions, portals).

Usage:
    python scripts/seed_phase10_demo.py                     # new session
    python scripts/seed_phase10_demo.py --session BLADE-1234  # attach
    python scripts/seed_phase10_demo.py --session ... --reset
"""
import argparse
import asyncio
from typing import Any

import httpx

BASE = "http://127.0.0.1:8000"


def _building(c0, r0, c1, r1, door_side="s"):
    """Generate (set_tiles, interior_cells) for a rect building."""
    set_tiles = []
    interior = []
    for c in range(c0, c1 + 1):
        set_tiles.append({"col": c, "row": r0, "tile_type": "wall"})
        set_tiles.append({"col": c, "row": r1, "tile_type": "wall"})
    for r in range(r0 + 1, r1):
        set_tiles.append({"col": c0, "row": r, "tile_type": "wall"})
        set_tiles.append({"col": c1, "row": r, "tile_type": "wall"})
    for c in range(c0 + 1, c1):
        for r in range(r0 + 1, r1):
            set_tiles.append({"col": c, "row": r, "tile_type": "floor"})
            interior.append({"col": c, "row": r})
    if door_side == "s":
        dc, dr = (c0 + c1) // 2, r1
    elif door_side == "n":
        dc, dr = (c0 + c1) // 2, r0
    elif door_side == "e":
        dc, dr = c1, (r0 + r1) // 2
    else:
        dc, dr = c0, (r0 + r1) // 2
    for i, t in enumerate(set_tiles):
        if t["col"] == dc and t["row"] == dr:
            set_tiles[i] = {"col": dc, "row": dr, "tile_type": "door"}
            break
    return set_tiles, interior


async def seed_demo(http: httpx.AsyncClient, session_code: str) -> dict[str, Any]:
    """Build the world. Returns dict with all created location IDs."""
    map_r = await http.post(
        f"/api/builder-v2/sessions/{session_code}/maps",
        json={"name": "Greenhollow"},
    )
    map_r.raise_for_status()
    map_id = map_r.json()["id"]

    async def make_loc(name, cols, rows, amb, indoor):
        r = await http.post(
            f"/api/builder-v2/maps/{map_id}/locations",
            json={"cols": cols, "rows": rows},
        )
        r.raise_for_status()
        loc_id = r.json()["id"]
        await http.patch(
            f"/api/builder-v2/locations/{loc_id}",
            json={"name": name, "ambient_light": amb, "is_indoor": indoor},
        )
        return loc_id

    center = await make_loc("Greenhollow Center", 20, 20, 1.0, False)
    north = await make_loc("Greenhollow North", 15, 15, 0.85, False)
    east = await make_loc("Greenhollow East", 15, 15, 0.6, False)
    south = await make_loc("Greenhollow South", 15, 15, 0.85, False)
    west = await make_loc("Greenhollow West", 15, 15, 0.5, False)
    crypt = await make_loc("Crypt of Greenhollow", 12, 12, 0.05, True)

    async def floor_all(loc_id, cols, rows):
        tiles = [
            {"col": c, "row": r, "tile_type": "floor"}
            for c in range(cols)
            for r in range(rows)
        ]
        await http.patch(
            f"/api/builder-v2/locations/{loc_id}/tiles",
            json={"set": tiles, "erase": []},
        )

    for lid, cols, rows in [
        (center, 20, 20),
        (north, 15, 15),
        (east, 15, 15),
        (south, 15, 15),
        (west, 15, 15),
        (crypt, 12, 12),
    ]:
        await floor_all(lid, cols, rows)

    async def build(loc_id, name, c0, r0, c1, r1, door_side="s"):
        tiles, interior = _building(c0, r0, c1, r1, door_side)
        await http.patch(
            f"/api/builder-v2/locations/{loc_id}/tiles",
            json={"set": tiles, "erase": []},
        )
        await http.post(
            f"/api/builder-v2/locations/{loc_id}/interiors",
            json={
                "name": name,
                "kind": "building",
                "reveal_mode": "on_enter",
                "cells": interior,
            },
        )

    # Center: Inn + Shop
    await build(center, "The Greenhollow Inn", 2, 2, 7, 6, "s")
    await build(center, "General Store", 12, 12, 15, 15, "n")
    # North: Farmhouse
    await build(north, "Old Farmhouse", 4, 4, 8, 7, "s")
    # East: Smithy
    await build(east, "Smithy", 3, 3, 8, 7, "s")
    # South: Guard House
    await build(south, "Guard House", 4, 4, 8, 8, "n")
    # West: Chapel
    await build(west, "Old Chapel", 3, 3, 8, 8, "s")
    # Crypt: 3 rooms
    await build(crypt, "Crypt Room A", 1, 1, 4, 4, "e")
    await build(crypt, "Crypt Room B", 6, 1, 8, 3, "s")
    await build(crypt, "Crypt Room C", 7, 6, 10, 8, "w")

    async def light(loc_id, c, r, radius, intensity, kind="torch"):
        await http.post(
            f"/api/builder-v2/locations/{loc_id}/lights",
            json={
                "col": c,
                "row": r,
                "radius_cells": radius,
                "intensity": intensity,
                "color_hex": "#ffd9a0",
                "source_kind": kind,
            },
        )

    await light(east, 5, 5, 3, 1.5, "torch")
    await light(west, 5, 5, 2, 1.0, "torch")
    await light(crypt, 1, 1, 4, 1.0, "torch")
    await light(crypt, 5, 5, 4, 1.0, "torch")
    await light(crypt, 9, 2, 4, 1.0, "torch")
    await light(crypt, 10, 9, 4, 1.0, "torch")

    async def edge(loc_id, side, rs, re, target_id, ec, er):
        await http.post(
            f"/api/builder-v2/locations/{loc_id}/edges",
            json={
                "side": side,
                "range_start": rs,
                "range_end": re,
                "target_location_id": target_id,
                "target_entry_col": ec,
                "target_entry_row": er,
            },
        )

    await edge(center, "north", 9, 11, north, 7, 14)
    await edge(north, "south", 7, 9, center, 10, 0)
    await edge(center, "east", 9, 11, east, 0, 7)
    await edge(east, "west", 7, 9, center, 19, 10)
    await edge(center, "south", 9, 11, south, 7, 0)
    await edge(south, "north", 7, 9, center, 10, 19)
    await edge(center, "west", 9, 11, west, 14, 7)
    await edge(west, "east", 7, 9, center, 0, 10)

    async def portal(loc_id, c, r, name, target_loc, target_c, target_r, label):
        e = (
            await http.post(
                f"/api/builder-v2/locations/{loc_id}/entities",
                json={"entity_type": "portal", "col": c, "row": r, "name": name},
            )
        ).json()
        await http.post(
            "/api/builder-v2/portals",
            json={
                "entity_id": e["id"],
                "target_location_id": target_loc,
                "target_col": target_c,
                "target_row": target_r,
                "label": label,
                "is_one_way": False,
                "is_active": True,
            },
        )
        return e["id"]

    await portal(west, 7, 7, "Stairs Down", crypt, 1, 10, "Stairs down to Crypt")
    await portal(crypt, 1, 10, "Stairs Up", west, 7, 7, "Climb back up")

    await http.post(f"/api/builder-v2/locations/{center}/activate")

    return {
        "map_id": map_id,
        "center": center,
        "north": north,
        "east": east,
        "south": south,
        "west": west,
        "crypt": crypt,
    }


async def _main(argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--session", default=None)
    parser.add_argument("--reset", action="store_true")
    parser.add_argument("--base", default=BASE)
    args = parser.parse_args(argv)

    async with httpx.AsyncClient(base_url=args.base, timeout=30.0) as http:
        if args.session is None:
            r = await http.post(
                "/api/sessions/create",
                json={"gm_name": "DemoGM", "name": "Phase 10 Demo"},
            )
            r.raise_for_status()
            sess_code = r.json()["session_code"]
            print(f"Created session: {sess_code}")
        else:
            sess_code = args.session
            if args.reset:
                maps = (
                    await http.get(f"/api/builder-v2/sessions/{sess_code}/maps")
                ).json()
                for m in maps:
                    await http.delete(f"/api/builder-v2/maps/{m['id']}")

        ids = await seed_demo(http, sess_code)
        print(f"Seeded world: {ids}")
        print(f"\n→ GM URL:     {args.base}/gm?code={sess_code}")
        print(f"→ Player URL: {args.base}/?code={sess_code}")


if __name__ == "__main__":
    import sys

    asyncio.run(_main(sys.argv[1:]))
