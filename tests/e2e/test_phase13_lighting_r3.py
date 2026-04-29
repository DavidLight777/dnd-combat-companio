from playwright.sync_api import Page


def _seed_torch_and_sample(page: Page, delay_ms: int):
    """Create a torch light, wait delay_ms, sample darkness-layer alpha
    in the dim zone.  Intensity flicker changes how much light is
    subtracted from the darkness, so the remaining darkness alpha varies."""
    return page.evaluate("""(delayMs) => {
        return new Promise(resolve => {
            const parent = document.createElement('div');
            parent.style.width = '600px';
            parent.style.height = '400px';
            parent.style.position = 'fixed';
            parent.style.top = '0';
            parent.style.left = '0';
            parent.style.zIndex = '-1';
            document.body.appendChild(parent);

            const c = document.createElement('canvas');
            c.style.width = '100%';
            c.style.height = '100%';
            parent.appendChild(c);

            const mc = new window.MapCanvas(c, {role: 'gm'});
            mc.canvas.width = 600;
            mc.canvas.height = 400;
            mc.mapWidth = 600;
            mc.mapHeight = 400;
            mc.gridSize = 50;
            mc.gridType = 'square';
            mc.tileGridType = 'square';
            mc.gridEnabled = false;
            mc.ambientLight = 0.2;

            mc.tiles = {"5,5": {type: 'floor', blocks_vision: false}};
            mc.setLights([{
                col: 5, row: 5,
                radius_cells: 4,
                bright_radius_cells: 2,
                color_hex: '#ffaa44',
                intensity: 1.0,
                source_kind: 'torch',
                id: 1,
            }]);

            setTimeout(() => {
                // Read the darkness layer directly — after destination-out
                // the alpha here is what remains of the darkness veil.
                const dctx = mc._darkLayer.getContext('2d');
                const d = dctx.getImageData(420, 275, 1, 1).data;
                resolve({a: d[3]});
            }, delayMs);
        });
    }""", delay_ms)


def test_torch_flicker_changes_pixel_over_time(gm_page: Page):
    """Torch flicker: sample the same pixel at t=0ms and t=200ms.
    The RGB values must differ because intensity is modulated."""
    gm_page.locator('[data-tab="map"]').click()
    gm_page.wait_for_timeout(500)

    alpha0 = _seed_torch_and_sample(gm_page, 0)
    alpha600 = _seed_torch_and_sample(gm_page, 600)

    # Darkness alpha should differ because flicker changes intensity
    assert abs(alpha0['a'] - alpha600['a']) >= 2, (
        f"Torch flicker expected darkness alpha change >=2, got {alpha0['a']} vs {alpha600['a']}"
    )


def _seed_magic_and_sample(page: Page, delay_ms: int):
    """Create a magic light, wait delay_ms, sample light-layer alpha
    at the edge.  Radius modulation moves the edge, so the same point
    may be inside (alpha>0) or outside (alpha=0) the light polygon."""
    return page.evaluate("""(delayMs) => {
        return new Promise(resolve => {
            const parent = document.createElement('div');
            parent.style.width = '600px';
            parent.style.height = '400px';
            parent.style.position = 'fixed';
            parent.style.top = '0';
            parent.style.left = '0';
            parent.style.zIndex = '-1';
            document.body.appendChild(parent);

            const c = document.createElement('canvas');
            c.style.width = '100%';
            c.style.height = '100%';
            parent.appendChild(c);

            const mc = new window.MapCanvas(c, {role: 'gm'});
            mc.canvas.width = 600;
            mc.canvas.height = 400;
            mc.mapWidth = 600;
            mc.mapHeight = 400;
            mc.gridSize = 50;
            mc.gridType = 'square';
            mc.tileGridType = 'square';
            mc.gridEnabled = false;
            mc.ambientLight = 0.2;

            mc.tiles = {"5,5": {type: 'floor', blocks_vision: false}};
            mc.setLights([{
                col: 5, row: 5,
                radius_cells: 3,
                bright_radius_cells: 1.5,
                color_hex: '#a855f7',
                intensity: 1.0,
                source_kind: 'magic',
                id: 2,
            }]);

            setTimeout(() => {
                // Read the light layer directly — radius modulation changes
                // whether this edge pixel is inside the gradient or not.
                const lctx = mc._lightLayer.getContext('2d');
                const d = lctx.getImageData(418, 275, 1, 1).data;
                resolve({a: d[3]});
            }, delayMs);
        });
    }""", delay_ms)


def test_magic_pulse_changes_edge_over_time(gm_page: Page):
    """Magic pulse: sample the light edge at t=0ms and t=500ms.
    The radius modulation should change the alpha/colour at the edge."""
    gm_page.locator('[data-tab="map"]').click()
    gm_page.wait_for_timeout(500)

    alpha0 = _seed_magic_and_sample(gm_page, 0)
    alpha400 = _seed_magic_and_sample(gm_page, 400)

    # Light-layer alpha at the edge should differ because radius changes
    assert abs(alpha0['a'] - alpha400['a']) >= 1, (
        f"Magic pulse expected edge alpha change >=1, got {alpha0['a']} vs {alpha400['a']}"
    )


def _seed_token_vision(page: Page):
    """Spawn a token with sight_range_cells=5 in a dark room
    (ambient_light=0). Return pixel data around the token."""
    return page.evaluate("""() => {
        const parent = document.createElement('div');
        parent.style.width = '600px';
        parent.style.height = '400px';
        parent.style.position = 'fixed';
        parent.style.top = '0';
        parent.style.left = '0';
        parent.style.zIndex = '-1';
        document.body.appendChild(parent);

        const c = document.createElement('canvas');
        c.style.width = '100%';
        c.style.height = '100%';
        parent.appendChild(c);

        const mc = new window.MapCanvas(c, {role: 'player'});
        mc.canvas.width = 600;
        mc.canvas.height = 400;
        mc.mapWidth = 600;
        mc.mapHeight = 400;
        mc.gridSize = 50;
        mc.gridType = 'square';
        mc.tileGridType = 'square';
        mc.gridEnabled = false;
        mc.ambientLight = 0.0;  // pitch black

        // Dark room, no lights
        mc.setLights([]);
        // Token in centre with sight_range_cells=5
        mc.setTokens([{
            character_id: 1,
            name: 'Hero',
            x: 0.4583,  // 275 / 600
            y: 0.4583,
            color: '#c08a2a',
            visible: true,
            is_alive: true,
            sight_range_cells: 5,
        }]);
        mc.render();

        const ctx = c.getContext('2d');
        // Sample ring around token (approx 2 cells away = 100px)
        const d = ctx.getImageData(375, 275, 1, 1).data;
        return {r: d[0], g: d[1], b: d[2], a: d[3]};
    }""")


def test_token_vision_reveals_dark_room(gm_page: Page):
    """A token with sight_range_cells=5 in ambient=0 should still
    illuminate the area around itself (non-zero pixels)."""
    gm_page.locator('[data-tab="map"]').click()
    gm_page.wait_for_timeout(500)

    rgba = _seed_token_vision(gm_page)
    # In pitch black without token vision this pixel would be ~0.
    # With sight range 5 it should be visible (some non-zero colour).
    total = rgba['r'] + rgba['g'] + rgba['b']
    assert total > 10, (
        f"Token vision expected non-zero pixels in dark room, got {rgba}"
    )


def test_animation_stops_on_tab_hidden(gm_page: Page):
    """When document.hidden becomes true, the RAF loop should stop."""
    gm_page.locator('[data-tab="map"]').click()
    gm_page.wait_for_timeout(500)

    result = gm_page.evaluate("""() => {
        const parent = document.createElement('div');
        parent.style.width = '600px';
        parent.style.height = '400px';
        parent.style.position = 'fixed';
        parent.style.top = '0';
        parent.style.left = '0';
        document.body.appendChild(parent);

        const c = document.createElement('canvas');
        parent.appendChild(c);

        const mc = new window.MapCanvas(c, {role: 'gm'});
        mc.canvas.width = 600;
        mc.canvas.height = 400;
        mc.mapWidth = 600;
        mc.mapHeight = 400;
        mc.gridSize = 50;
        mc.gridType = 'square';
        mc.ambientLight = 0.2;

        mc.setLights([{
            col: 5, row: 5,
            radius_cells: 4,
            color_hex: '#ffaa44',
            intensity: 1.0,
            source_kind: 'torch',
            id: 99,
        }]);

        const hadRafBefore = !!mc._lightRaf;
        // Simulate tab hidden
        Object.defineProperty(document, 'hidden', {
            value: true, writable: true, configurable: true
        });
        document.dispatchEvent(new Event('visibilitychange'));
        const hasRafAfter = !!mc._lightRaf;

        // Restore
        Object.defineProperty(document, 'hidden', {
            value: false, writable: true, configurable: true
        });
        document.dispatchEvent(new Event('visibilitychange'));

        return {hadRafBefore, hasRafAfter};
    }""")

    assert result['hadRafBefore'] is True, "Expected RAF to be running with torch"
    assert result['hasRafAfter'] is False, "Expected RAF to stop when tab hidden"
