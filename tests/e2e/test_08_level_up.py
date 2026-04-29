from playwright.sync_api import Page, expect


def test_player_level_up(seeded_session, gm_page: Page):
    """8. Player join page loads wizard."""
    player = gm_page.context.new_page()
    player.goto(seeded_session["player_url"])
    player.fill("#join-code", seeded_session["session_code"])
    player.fill("#join-name", "Hero")
    player.fill("#join-age", "25")
    player.fill("#join-gender", "Male")
    player.click("#btn-join-next-1")
    expect(player.locator("#join-step-2")).to_be_visible()
