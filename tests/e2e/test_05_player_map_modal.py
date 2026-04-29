from playwright.sync_api import Page, expect


def test_player_map_modal_opens(seeded_session, gm_page: Page, player_page: Page):
    """5. Player opens Map modal."""
    player_page.click("#btn-open-map")
    expect(player_page.locator("#map-modal")).to_be_visible()
    player_page.click("#btn-close-map")
    expect(player_page.locator("#map-modal")).to_be_hidden()
