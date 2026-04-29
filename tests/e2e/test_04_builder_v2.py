from playwright.sync_api import Page, expect


def test_gm_builder_v2_paints_and_applies(seeded_session, gm_page: Page):
    """4. GM opens Builder v2 canvas."""
    gm_page.click("[data-tab='builder-v2']")
    expect(gm_page.locator("#bv2-canvas")).to_be_visible()
