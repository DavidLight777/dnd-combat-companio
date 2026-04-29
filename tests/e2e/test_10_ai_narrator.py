from playwright.sync_api import Page, expect


def test_ai_narrator_generates(seeded_session, gm_page: Page):
    """10. AI sidebar is visible on GM page."""
    expect(gm_page.locator("#ai-sidebar")).to_be_visible()
    expect(gm_page.locator("#ai-input")).to_be_visible()
