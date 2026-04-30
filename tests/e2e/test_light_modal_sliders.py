"""Light modal uses range sliders instead of number inputs."""
import requests
from playwright.sync_api import Page


def test_light_modal_has_range_sliders(gm_page: Page):
    """The New Light modal must use range sliders for radius/bright/intensity."""
    url = gm_page.url.split('/gm')[0]
    code = gm_page.url.split('code=')[1]

    # Seed a location
    r = requests.post(f"{url}/api/builder-v2/sessions/{code}/maps", json={"name": "SliderTest"})
    r.raise_for_status()
    map_id = r.json()["id"]
    r = requests.post(f"{url}/api/builder-v2/maps/{map_id}/locations",
                      json={"name": "L", "cols": 10, "rows": 10})
    r.raise_for_status()
    loc_id = r.json()["id"]
    requests.post(f"{url}/api/builder-v2/locations/{loc_id}/activate")

    gm_page.click("[data-tab='builder-v2']")
    gm_page.wait_for_timeout(800)
    gm_page.evaluate(f"""(locId) => {{
      if (window.bv2 && window.bv2.loadLocation) window.bv2.loadLocation(locId);
    }}""", loc_id)
    gm_page.wait_for_timeout(600)

    # Open New Light modal via JS (simulate clicking a light brush then canvas)
    gm_page.evaluate("""() => {
      if (window.bv2 && window.bv2.openLightModal) {
        window.bv2.openLightModal(null, 'create', { col: 5, row: 5, preset: 'torch' });
      }
    }""")
    gm_page.wait_for_timeout(200)

    # Assert inputs are range sliders
    result = gm_page.evaluate("""() => {
      const radiusInput = document.getElementById('bv2-light-radius');
      const brightInput = document.getElementById('bv2-light-bright');
      const intensityInput = document.getElementById('bv2-light-intensity');
      return {
        radiusType: radiusInput?.type,
        brightType: brightInput?.type,
        intensityType: intensityInput?.type,
        radiusMin: radiusInput?.min,
        radiusMax: radiusInput?.max,
        intensityMin: intensityInput?.min,
        intensityMax: intensityInput?.max,
      };
    }""")

    assert result["radiusType"] == "range", f"Expected radius type=range, got {result['radiusType']}"
    assert result["brightType"] == "range", f"Expected bright type=range, got {result['brightType']}"
    assert result["intensityType"] == "range", f"Expected intensity type=range, got {result['intensityType']}"

    # Set radius slider to 8
    gm_page.evaluate("""() => {
      const slider = document.getElementById('bv2-light-radius');
      slider.value = '8';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }""")
    gm_page.wait_for_timeout(100)

    # Check value label shows 8
    label = gm_page.evaluate("""() => {
      const slider = document.getElementById('bv2-light-radius');
      const label = slider?.parentElement?.querySelector('span');
      return label ? label.textContent : null;
    }""")
    assert label == "8", f"Expected radius label '8', got {label}"

    # Save
    gm_page.click("#bv2-light-save")
    gm_page.wait_for_timeout(400)

    # Verify via API
    lights_r = requests.get(f"{url}/api/builder-v2/locations/{loc_id}/lights")
    lights = lights_r.json()
    assert len(lights) > 0, "No light created"
    assert lights[0]["radius_cells"] == 8, f"Expected radius_cells=8, got {lights[0]['radius_cells']}"
