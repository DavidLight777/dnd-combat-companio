"""Builder live preview: ambient slider updates canvas immediately."""
import requests
from playwright.sync_api import Page


def test_ambient_slider_live_preview(gm_page: Page):
    """Moving the ambient slider instantly updates the builder canvas."""
    url = gm_page.url.split('/gm')[0]
    code = gm_page.url.split('code=')[1]

    # Seed a map with a location via API
    r = requests.post(f"{url}/api/builder-v2/sessions/{code}/maps", json={"name": "Preview"})
    r.raise_for_status()
    map_id = r.json()["id"]

    r = requests.post(
        f"{url}/api/builder-v2/maps/{map_id}/locations",
        json={"name": "Room", "cols": 10, "rows": 10, "ambient_light": 0.5}
    )
    r.raise_for_status()
    loc_id = r.json()["id"]
    requests.post(f"{url}/api/builder-v2/locations/{loc_id}/activate")

    # Open builder tab and load location
    gm_page.click("[data-tab='builder-v2']")
    gm_page.wait_for_timeout(1000)
    gm_page.evaluate(f"""(locId) => {{
      if (window.bv2 && window.bv2.loadLocation) {{
        window.bv2.loadLocation(locId);
      }}
    }}""", loc_id)
    gm_page.wait_for_timeout(800)

    # Verify initial ambient
    before = gm_page.evaluate("""() => {
      const v = window.bv2 && window.bv2.view;
      return v && v.location ? v.location.ambient_light : null;
    }""")
    assert before == 0.5, f"Expected initial ambient 0.5, got {before}"

    # Set slider to 0.0 via JS (simulates user dragging)
    gm_page.evaluate("""() => {
      const slider = document.getElementById('bv2-ambient-slider');
      if (!slider) return { error: 'no slider' };
      slider.value = '0';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      return { ok: true };
    }""")

    gm_page.wait_for_timeout(200)

    # Check that location ambient updated immediately
    after = gm_page.evaluate("""() => {
      const v = window.bv2 && window.bv2.view;
      return v && v.location ? v.location.ambient_light : null;
    }""")

    assert after == 0.0, f"Expected ambient 0.0 after slider, got {after}"
