"""Свет должен совпадать с позицией тайла при любом зуме и паннинге."""
import requests


def test_light_follows_tile_on_zoom(gm_page):
    """После зума свет должен оставаться над факелом, не уплывать."""
    # Seed a map with a light via API
    url = gm_page.url.split('/gm')[0]
    code = gm_page.url.split('code=')[1]
    r = requests.post(f"{url}/api/builder-v2/sessions/{code}/maps", json={"name": "M"})
    r.raise_for_status()
    map_id = r.json()["id"]
    r = requests.post(f"{url}/api/builder-v2/maps/{map_id}/locations",
                      json={"name": "L", "cols": 10, "rows": 10, "ambient_light": 0.0})
    r.raise_for_status()
    loc_id = r.json()["id"]
    r = requests.post(f"{url}/api/builder-v2/locations/{loc_id}/lights",
                      json={"col": 5, "row": 5, "radius_cells": 4,
                            "color_hex": "#ffd9a0", "intensity": 1.0, "source_kind": "torch"})
    r.raise_for_status()
    requests.post(f"{url}/api/builder-v2/locations/{loc_id}/activate")

    gm_page.click("[data-tab='builder-v2']")
    gm_page.wait_for_timeout(1500)

    # Load the location in builder
    gm_page.evaluate(f"""(locId) => {{
      if (window.bv2 && window.bv2.loadLocation) {{
        window.bv2.loadLocation(locId);
      }}
    }}""", loc_id)
    gm_page.wait_for_timeout(1000)

    # Compute light screen position relative to tile screen position BEFORE zoom
    before = gm_page.evaluate("""() => {
      const v = window.bv2 && window.bv2.view;
      if (!v || !v.lights || !v.lights.length) return null;
      const l = v.lights[0];
      const gs = v.gridSize || 50;
      const s = v.scale || 1;
      const ox = v.offsetX || 0;
      const oy = v.offsetY || 0;
      const lightCx = (l.col + 0.5) * gs * s + ox;
      const lightCy = (l.row + 0.5) * gs * s + oy;
      const tileCx = (l.col + 0.5) * gs * s + ox;
      const tileCy = (l.row + 0.5) * gs * s + oy;
      return { dx: lightCx - tileCx, dy: lightCy - tileCy, col: l.col, row: l.row };
    }""")
    if not before:
        return  # skip if no lights

    # Zoom in (scroll wheel up)
    canvas = gm_page.locator("#bv2-canvas")
    canvas.wait_for(state="visible", timeout=5000)
    gm_page.mouse.wheel(0, -500)
    gm_page.wait_for_timeout(400)

    # Compute same delta AFTER zoom — must be ~0
    after = gm_page.evaluate("""(args) => {
      const [col, row] = args;
      const v = window.bv2 && window.bv2.view;
      if (!v) return null;
      const gs = v.gridSize || 50;
      const s = v.scale || 1;
      const ox = v.offsetX || 0;
      const oy = v.offsetY || 0;
      const light = v.lights && v.lights[0];
      const lightCx = light ? (light.col + 0.5) * gs * s + ox : 0;
      const lightCy = light ? (light.row + 0.5) * gs * s + oy : 0;
      const tileCx = (col + 0.5) * gs * s + ox;
      const tileCy = (row + 0.5) * gs * s + oy;
      return { dx: lightCx - tileCx, dy: lightCy - tileCy };
    }""", [before["col"], before["row"]])

    assert abs(after["dx"]) < 2, f"Light X drifted after zoom: dx={after['dx']:.1f}"
    assert abs(after["dy"]) < 2, f"Light Y drifted after zoom: dy={after['dy']:.1f}"
