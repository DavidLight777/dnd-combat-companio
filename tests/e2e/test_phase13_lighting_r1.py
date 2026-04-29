from playwright.sync_api import Page, expect


def _seed_lighting_canvas(page: Page, grid_type: str):
    """Programmatically instantiate a MapCanvas, seed a light + wall,
    and return the alpha of a pixel that sits *inside* the wall cell
    but beyond the wall's near edge.

    With the old cell-based clip-path, the wall cell itself is included
    in the visible set, so the pixel is lit (low alpha).
    With the new ray-cast polygon, the ray stops at the wall edge, so
    the pixel remains dark (high alpha).
    """
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
        // Override auto-resize so we have predictable dimensions
        mc.canvas.width = 600;
        mc.canvas.height = 400;
        mc.mapWidth = 600;
        mc.mapHeight = 400;
        mc.gridSize = 50;
        mc.gridType = gridType;
        mc.tileGridType = 'hex';   // draw tiles as hexes so wall tile doesn't paint a square over our sample
        mc.gridEnabled = false;
        mc.ambientLight = 0.2;     // ensures darkAlpha > 0

        // Only set the wall tile — nothing else should be drawn
        const wallKey = gridType === 'hex' ? '2,0' : '8,5';
        mc.tiles = {};
        mc.tiles[wallKey] = {type: 'wall', blocks_vision: true};

        // Light positioned so its radius reaches the wall cell
        const light = gridType === 'hex'
            ? {col: 0, row: 0, radius_cells: 4, intensity: 1.0}
            : {col: 5, row: 5, radius_cells: 4, intensity: 1.0};
        mc.setLights([light]);
        mc.render();

        // In R2 the darkness lives on _darkLayer and light is subtracted
        // from it with destination-out.  A pixel inside the wall cell
        // should still be dark (high alpha) because the ray-cast polygon
        // stops at the wall edge and does not punch a hole there.
        const dctx = mc._darkLayer.getContext('2d');
        const sx = gridType === 'hex' ? 101 : 401;
        const sy = gridType === 'hex' ? 0  : 275;
        const d = dctx.getImageData(sx, sy, 1, 1).data;
        return d[3]; // alpha channel
    }""", grid_type)


def test_light_polygon_clips_at_wall_edge_not_cell_center(gm_page: Page):
    """Square grid: pixel inside the wall cell must stay dark because
    the ray-cast polygon stops at the wall edge."""
    gm_page.locator('[data-tab="map"]').click()
    gm_page.wait_for_timeout(500)
    alpha = _seed_lighting_canvas(gm_page, 'square')
    assert alpha > 60, (
        f"Expected dark pixel inside wall cell (alpha > 60) with ray-cast lighting, got {alpha}. "
        "If this is low, the old cell-based clip-path may still be active."
    )


def test_light_on_hex_grid_renders(gm_page: Page):
    """Hex grid: same assertion — the ray-cast polygon must respect
    hex-grid wall cells."""
    gm_page.locator('[data-tab="map"]').click()
    gm_page.wait_for_timeout(500)
    alpha = _seed_lighting_canvas(gm_page, 'hex')
    assert alpha > 60, (
        f"Expected dark pixel inside wall cell (alpha > 60) on hex grid, got {alpha}."
    )
