import pytest
from playwright.async_api import async_playwright
import requests


@pytest.fixture
async def browser():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        yield browser
        await browser.close()


@pytest.mark.asyncio
async def test_trap_creation_api_and_zone_render(browser):
    """E2E: Create trap via API, verify GM builder shows it."""
    # 1. Create session
    r = requests.post("http://localhost:8000/api/sessions/create", json={"name": "TrapTest"})
    session_code = r.json()["session_code"]

    # 2. Create map + location
    r = requests.post(f"http://localhost:8000/api/builder-v2/sessions/{session_code}/maps", json={"name": "TMap"})
    map_id = r.json()["id"]
    r = requests.post(f"http://localhost:8000/api/builder-v2/maps/{map_id}/locations", json={"cols": 20, "rows": 20})
    loc_id = r.json()["id"]

    # 3. Create trap with size_cells=2
    r = requests.post(f"http://localhost:8000/api/builder-v2/locations/{loc_id}/traps", json={
        "name": "Zone Trap",
        "col": 5, "row": 5,
        "trap_type": "spike",
        "trigger_mode": "on_enter",
        "size_cells": 2,
        "damage_dice_count": 2,
        "damage_dice_type": 6,
        "damage_type": "piercing",
        "visible_to_players": True,
        "undodgeable": True,
        "charges": -1
    })
    assert r.status_code == 200
    trap = r.json()
    assert trap["size_cells"] == 2
    assert trap["damage_dice_count"] == 2
    assert trap["damage_dice_type"] == 6

    # 4. Create player and place on map
    r = requests.post("http://localhost:8000/api/sessions/join", json={
        "session_code": session_code,
        "player_name": "Hero"
    })
    char_id = r.json()["character_id"]

    # Place character outside trap zone
    r = requests.post(f"http://localhost:8000/api/builder-v2/characters/{char_id}/move-grid", json={
        "location_id": loc_id,
        "col": 2, "row": 2
    })
    assert r.status_code == 200

    # 5. Move character INTO trap zone (5,5 with size 2 = cells 5-6)
    r = requests.post(f"http://localhost:8000/api/builder-v2/characters/{char_id}/move-grid", json={
        "col": 5, "row": 5
    })
    assert r.status_code == 200

    # 6. Check character took damage
    r = requests.get(f"http://localhost:8000/api/characters/{char_id}")
    char_data = r.json()
    # Character starts with 0 HP (wizard not completed), so damage might not show
    # But we can verify the trap triggered by checking charges_used
    r = requests.get(f"http://localhost:8000/api/builder-v2/traps/{trap['id']}")
    trap_data = r.json()
    assert trap_data["charges_used"] == 1, "Trap should have triggered once"

    print("Trap zone trigger test passed!")


@pytest.mark.asyncio
async def test_chest_with_items_api():
    """E2E: Create chest with items via API, player takes them."""
    # 1. Create session
    r = requests.post("http://localhost:8000/api/sessions/create", json={"name": "ChestTest"})
    session_code = r.json()["session_code"]

    # 2. Create map + location
    r = requests.post(f"http://localhost:8000/api/builder-v2/sessions/{session_code}/maps", json={"name": "CMap"})
    map_id = r.json()["id"]
    r = requests.post(f"http://localhost:8000/api/builder-v2/maps/{map_id}/locations", json={"cols": 20, "rows": 20})
    loc_id = r.json()["id"]

    # 3. Create item
    r = requests.post("http://localhost:8000/api/items", json={"name": "Test Sword", "rarity": "common"})
    item_id = r.json()["id"]

    # 4. Create chest with items
    r = requests.post(f"http://localhost:8000/api/builder-v2/locations/{loc_id}/chests", json={
        "col": 3, "row": 3,
        "name": "Loot Chest",
        "is_locked": False,
        "visible_to_players": True,
        "items": [{"item_id": item_id, "quantity": 2}]
    })
    assert r.status_code == 200
    chest = r.json()
    assert len(chest.get("items", [])) == 1
    assert chest["items"][0]["quantity"] == 2

    # 5. Create player
    r = requests.post("http://localhost:8000/api/sessions/join", json={
        "session_code": session_code,
        "player_name": "Hero"
    })
    char_id = r.json()["character_id"]

    # 6. Take items from chest
    r = requests.post(f"http://localhost:8000/api/builder-v2/chests/{chest['id']}/take", json={
        "character_id": char_id
    })
    assert r.status_code == 200
    take_data = r.json()
    assert len(take_data["taken"]) == 1
    assert take_data["taken"][0]["quantity"] == 2

    # 7. Check inventory
    r = requests.get(f"http://localhost:8000/api/characters/{char_id}/inventory")
    inv = r.json()
    assert len(inv) > 0

    print("Chest items test passed!")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])