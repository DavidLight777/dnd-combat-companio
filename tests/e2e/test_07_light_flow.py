from playwright.sync_api import Page, expect


def test_gm_places_light(seeded_session, gm_page: Page):
    """7. GM opens Builder v2."""
    gm_page.click("[data-tab='builder-v2']")
    expect(gm_page.locator("#bv2-canvas")).to_be_visible()
