import requests
from playwright.sync_api import Page, expect


def test_trap_e2e_damage(seeded_session, gm_page: Page, page: Page):
    """Trap deals damage when player token steps on it."""
    url = seeded_session["url"]
    code = seeded_session["session_code"]

    # Join player
    join_resp = requests.post(
        f"{url}/api/sessions/join",
        json={"session_code": code, "player_name": "Hero", "race_id": None, "age": 25, "gender": "Male"},
    )
    assert join_resp.status_code == 200
    join_data = join_resp.json()
    player_token = join_data["player_token"]
    character_id = join_data["character_id"]

    # Set HP
    requests.patch(f"{url}/api/characters/{character_id}", json={"current_hp": 50, "max_hp": 50})

    # Create bv2 map + location + trap
    map_id = requests.post(f"{url}/api/builder-v2/sessions/{code}/maps", json={"name": "M"}).json()["id"]
    loc_id = requests.post(f"{url}/api/builder-v2/maps/{map_id}/locations", json={"cols": 10, "rows": 10}).json()["id"]
    requests.post(f"{url}/api/builder-v2/locations/{loc_id}/activate")

    requests.post(f"{url}/api/builder-v2/locations/{loc_id}/traps", json={
        "col": 3, "row": 3, "name": "Spike",
        "damage_dice": "1d4", "damage_type": "piercing",
        "undodgeable": True, "charges": 1,
    })

    # Place token first, then move onto trap
    requests.post(f"{url}/api/builder-v2/characters/{character_id}/move-grid", json={
        "location_id": loc_id, "col": 2, "row": 2,
    })
    requests.post(f"{url}/api/builder-v2/characters/{character_id}/move-grid", json={
        "col": 3, "row": 3,
    })

    # Assert HP dropped
    char = requests.get(f"{url}/api/characters/{character_id}").json()
    assert char["current_hp"] < 50
