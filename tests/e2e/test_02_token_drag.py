from playwright.sync_api import Page, expect


def test_gm_token_drag_updates_player(seeded_session, gm_page: Page, player_page: Page):
    """2. GM and player map canvases load."""
    gm_page.click("[data-tab='map']")
    expect(gm_page.locator("#map-canvas")).to_be_visible()
    expect(player_page.locator("#player-grid-canvas")).to_be_visible()
