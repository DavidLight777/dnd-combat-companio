"""No black rectangles visible on lit map — regression for Bug B."""
import requests


def test_no_black_rectangle_on_lit_map(gm_page):
    # Seed a simple map with a light via API
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
    # Activate location
    requests.post(f"{url}/api/builder-v2/locations/{loc_id}/activate")

    gm_page.click("[data-tab='map']")
    gm_page.wait_for_timeout(1500)

    pixel = gm_page.evaluate("""() => {
      const canvas = document.getElementById('bv2-canvas');
      if (!canvas) return null;
      const ctx = canvas.getContext('2d');
      const cx = Math.floor(canvas.width / 2);
      const cy = Math.floor(canvas.height / 2);
      const d = ctx.getImageData(cx - 20, cy - 20, 40, 40).data;
      let blackCount = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] < 5 && d[i+1] < 5 && d[i+2] < 5 && d[i+3] > 200) blackCount++;
      }
      return { blackCount, total: d.length / 4 };
    }""")
    assert pixel is not None
    black_ratio = pixel["blackCount"] / pixel["total"]
    assert black_ratio < 0.3, \
        f"Too many black pixels in lit area: {black_ratio:.1%} ({pixel})"
