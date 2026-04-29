from playwright.sync_api import Page, expect


def test_gm_ends_turn_next_initiative(seeded_session, gm_page: Page):
    """9. GM opens initiative tab."""
    gm_page.click("[data-tab='initiative']")
    expect(gm_page.locator("#initiative-order")).to_be_visible()
    expect(gm_page.locator("#btn-roll-initiative")).to_be_visible()
