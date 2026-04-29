from playwright.sync_api import Page, expect


def test_gm_rolls_attack_damage_updates_hp(seeded_session, gm_page: Page):
    """3. GM opens combat tab."""
    gm_page.click("[data-tab='combat']")
    expect(gm_page.locator("#combat-panel")).to_be_visible()
