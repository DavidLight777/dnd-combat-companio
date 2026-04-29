from playwright.sync_api import Page, expect


def test_gm_map_tab_renders_canvas(gm_page: Page):
    """Click the Map tab. After ≤2s the canvas must contain
    non-empty rendered pixels."""
    gm_page.locator('[data-tab="map"]').click()
    canvas = gm_page.locator('#map-canvas')
    expect(canvas).to_be_visible(timeout=2000)
    # Wait for async map state to load and render
    gm_page.wait_for_timeout(1500)
    # Read canvas pixel data via JS — assert at least one
    # non-transparent pixel exists.
    has_pixels = gm_page.evaluate("""() => {
        const c = document.getElementById('map-canvas');
        if (!c || !c.width || !c.height) return false;
        const ctx = c.getContext('2d');
        const img = ctx.getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; i < img.length; i += 4) {
            if (img[i] > 0) return true;   // any non-transparent
        }
        return false;
    }""")
    assert has_pixels, "Canvas exists but is fully transparent"


def test_gm_map_canvas_has_size(gm_page: Page):
    gm_page.locator('[data-tab="map"]').click()
    size = gm_page.evaluate("""() => {
        const c = document.getElementById('map-canvas');
        return { w: c.width, h: c.height };
    }""")
    assert size["w"] > 0 and size["h"] > 0, f"canvas is {size}"


def test_player_map_renders(player_page: Page):
    """Same for player main-tab grid canvas."""
    # Wait for async map state to load
    player_page.wait_for_timeout(1500)
    canvas = player_page.locator('#player-grid-canvas')
    expect(canvas).to_be_visible(timeout=2000)
    has_pixels = player_page.evaluate("""() => {
        const c = document.getElementById('player-grid-canvas');
        if (!c || !c.width || !c.height) return false;
        const ctx = c.getContext('2d');
        const img = ctx.getImageData(0, 0, c.width, c.height).data;
        for (let i = 3; i < img.length; i += 4) if (img[i] > 0) return true;
        return false;
    }""")
    assert has_pixels
