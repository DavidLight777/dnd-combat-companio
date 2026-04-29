from playwright.sync_api import Page, expect


def _seed_coloured_light_canvas(page: Page, grid_type: str):
    """Instantiate MapCanvas, seed an orange torch on a stone floor,
    and return the RGBA of a pixel directly under the light centre."""
    return page.evaluate("""(gridType) => {
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
        mc.gridType = gridType;
        mc.tileGridType = gridType;
        mc.gridEnabled = false;
        mc.ambientLight = 0.2;

        // Stone floor under the light
        const key = gridType === 'hex' ? '0,0' : '5,5';
        mc.tiles = {};
        mc.tiles[key] = {type: 'floor', blocks_vision: false};

        // Orange torch
        const light = gridType === 'hex'
            ? {col: 0, row: 0, radius_cells: 4, bright_radius_cells: 2, color_hex: '#ffaa44', intensity: 1.0}
            : {col: 5, row: 5, radius_cells: 4, bright_radius_cells: 2, color_hex: '#ffaa44', intensity: 1.0};
        mc.setLights([light]);
        mc.render();

        const ctx = c.getContext('2d');
        const sx = gridType === 'hex' ? 25 : 275;
        const sy = gridType === 'hex' ? 25 : 275;
        const d = ctx.getImageData(sx, sy, 1, 1).data;
        return {r: d[0], g: d[1], b: d[2], a: d[3]};
    }""", grid_type)


def test_coloured_torch_warms_floor_square(gm_page: Page):
    """An orange torch on a stone floor should tint the pixel orange
    (R high, G medium, B low) instead of monochrome dark."""
    gm_page.locator('[data-tab="map"]').click()
    gm_page.wait_for_timeout(500)
    rgba = _seed_coloured_light_canvas(gm_page, 'square')
    # Orange means R > G > B
    assert rgba['r'] > rgba['b'], f"Expected orange tint (R>B), got {rgba}"
    assert rgba['g'] > rgba['b'], f"Expected orange tint (G>B), got {rgba}"
    # The pixel should NOT be pure grey (R≈G≈B).  Require at least 15 diff.
    assert abs(rgba['r'] - rgba['g']) > 15, f"Expected colour tint, got grey {rgba}"


def test_coloured_torch_warms_floor_hex(gm_page: Page):
    """Same on hex grid."""
    gm_page.locator('[data-tab="map"]').click()
    gm_page.wait_for_timeout(500)
    rgba = _seed_coloured_light_canvas(gm_page, 'hex')
    assert rgba['r'] > rgba['b'], f"Expected orange tint (R>B), got {rgba}"
    assert rgba['g'] > rgba['b'], f"Expected orange tint (G>B), got {rgba}"
    # Hex cells render slightly darker; allow smaller colour diff
    assert abs(rgba['r'] - rgba['g']) > 5, f"Expected colour tint, got grey {rgba}"


def _seed_two_torch_canvas(page: Page):
    """Two overlapping torches of different colours — additive blend
    should produce a mixed colour in the overlap region."""
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
        mc.setLights([
            {col: 4, row: 5, radius_cells: 4, bright_radius_cells: 2, color_hex: '#ff0000', intensity: 1.0},
            {col: 6, row: 5, radius_cells: 4, bright_radius_cells: 2, color_hex: '#00ff00', intensity: 1.0},
        ]);
        mc.render();

        const ctx = c.getContext('2d');
        // Sample midway between the two lights (overlap region)
        const d = ctx.getImageData(275, 275, 1, 1).data;
        return {r: d[0], g: d[1], b: d[2], a: d[3]};
    }""")


def test_two_torch_overlap_additive_blend(gm_page: Page):
    """Red + green torches overlapping should produce yellow-ish tint
    in the overlap (both R and G elevated)."""
    gm_page.locator('[data-tab="map"]').click()
    gm_page.wait_for_timeout(500)
    rgba = _seed_two_torch_canvas(gm_page)
    # In additive blend, overlap should have both R and G significantly > B
    assert rgba['r'] > 20, f"Expected red contribution in overlap, got {rgba}"
    assert rgba['g'] > 20, f"Expected green contribution in overlap, got {rgba}"
    assert rgba['b'] < rgba['r'], f"Expected yellow-ish (R>G>B), got {rgba}"
    assert rgba['b'] < rgba['g'], f"Expected yellow-ish (R>G>B), got {rgba}"


def _seed_bright_radius_canvas(page: Page, bright_radius: float):
    """A light with different bright_radius — the inner core should be
    brighter (more colour, less darkness) than the dim edge."""
    return page.evaluate("""(brightRadius) => {
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
            radius_cells: 6,
            bright_radius_cells: brightRadius,
            color_hex: '#ffaa44',
            intensity: 1.0,
        }]);
        mc.render();

        const ctx = c.getContext('2d');
        const core = ctx.getImageData(275, 275, 1, 1).data;
        const edge = ctx.getImageData(375, 275, 1, 1).data;
        return {
            coreR: core[0], coreG: core[1], coreB: core[2],
            edgeR: edge[0], edgeG: edge[1], edgeB: edge[2],
        };
    }""", bright_radius)


def test_bright_radius_core_brighter_than_edge(gm_page: Page):
    """A torch with bright_radius=2 should have a warmer core than
    the dim edge at radius=6."""
    gm_page.locator('[data-tab="map"]').click()
    gm_page.wait_for_timeout(500)
    data = _seed_bright_radius_canvas(gm_page, 2.0)
    # Core should be more orange (higher R) than edge
    assert data['coreR'] > data['edgeR'], (
        f"Core should be warmer than edge: core={data['coreR']}, edge={data['edgeR']}"
    )
