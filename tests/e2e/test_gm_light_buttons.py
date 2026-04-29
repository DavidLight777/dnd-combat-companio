"""GM light brush buttons open the light modal."""
import requests


def test_torch_button_opens_modal(gm_page):
    # Seed a simple map with a location via API
    url = gm_page.url.split('/gm')[0]
    code = gm_page.url.split('code=')[1]
    r = requests.post(f"{url}/api/builder-v2/sessions/{code}/maps", json={"name": "M"})
    r.raise_for_status()
    map_id = r.json()["id"]
    r = requests.post(f"{url}/api/builder-v2/maps/{map_id}/locations",
                      json={"name": "L", "cols": 10, "rows": 10})
    r.raise_for_status()
    loc_id = r.json()["id"]

    # Open builder tab and select location
    gm_page.click("[data-tab='builder-v2']")
    gm_page.wait_for_timeout(1200)

    # Set current location directly so the light modal knows where to place
    gm_page.evaluate(f"""(locId) => {{
      if (window.bv2) window.bv2.currentLocId = locId;
    }}""", loc_id)
    gm_page.wait_for_timeout(200)

    # Click the Torch brush button
    gm_page.click(".bv2-light-brush[data-preset='torch']")
    gm_page.wait_for_timeout(200)

    # Verify brush is set
    brush = gm_page.evaluate("() => window.bv2 && window.bv2.brush")
    assert brush == "light:torch", f"Brush not set: {brush}"

    # Dispatch a synthetic mousedown on the canvas directly to ensure the event fires
    canvas = gm_page.locator("#bv2-canvas")
    canvas.wait_for(state="visible", timeout=5000)
    canvas.evaluate("""() => {
      const c = document.getElementById('bv2-canvas');
      if (!c) return 'no canvas';
      const rect = c.getBoundingClientRect();
      const e = new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, button: 0,
        offsetX: 30, offsetY: 30,
        clientX: rect.left + 30, clientY: rect.top + 30,
      });
      c.dispatchEvent(e);
      return 'dispatched';
    }""")
    gm_page.wait_for_timeout(1200)

    # Light modal must appear
    modal = gm_page.locator("#bv2-light-modal")
    assert modal.is_visible(), "Light modal did not open after clicking with torch brush"
