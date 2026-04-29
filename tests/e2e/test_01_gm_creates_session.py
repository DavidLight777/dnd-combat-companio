from playwright.sync_api import Page, expect


def test_gm_creates_session_and_player_joins(seeded_session, gm_page: Page, page: Page):
    """1. GM opens GM page, player joins via invite code."""
    expect(gm_page.locator("#session-code")).to_be_visible()

    player = page.context.new_page()
    player.goto(seeded_session["player_url"])
    player.fill("#join-code", seeded_session["session_code"])
    player.fill("#join-name", "Hero")
    player.fill("#join-age", "25")
    player.fill("#join-gender", "Male")
    player.click("#btn-join-next-1")
    expect(player.locator("#join-step-2")).to_be_visible()
