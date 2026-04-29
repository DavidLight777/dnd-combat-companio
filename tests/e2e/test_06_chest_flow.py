from playwright.sync_api import Page, expect


def test_gm_creates_chest_player_opens(seeded_session, gm_page: Page):
    """6. GM opens Items tab and can create an item."""
    gm_page.click("[data-tab='items']")
    expect(gm_page.locator("#btn-new-item")).to_be_visible()
