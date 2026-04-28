import os

BASE = os.path.join(os.path.dirname(__file__), "..")


def _read(path):
    with open(os.path.join(BASE, path), encoding="utf-8") as f:
        return f.read()


def test_phase13_pixi_renderer_has_token_methods():
    """10-renderer.js must contain setTokens, animateTokenTo, playFx."""
    text = _read("static/js/pixi/10-renderer.js")
    assert "setTokens(" in text
    assert "animateTokenTo(" in text
    assert "playFx(" in text
    assert "app.ticker.add(" in text


def test_phase13_pixi_renderer_has_drag_event():
    """Renderer must emit pixi:token-dropped on drag end."""
    text = _read("static/js/pixi/10-renderer.js")
    assert "pixi:token-dropped" in text
    assert "CustomEvent" in text


def test_phase13_gm_bridge_intercepts_tokens():
    """gm/06-map-main.js must intercept setTokens for Pixi."""
    text = _read("static/js/gm/06-map-main.js")
    assert "origSetTokens = mapCanvas.setTokens.bind(mapCanvas)" in text
    assert "pixi.setTokens(tokens)" in text
    assert "pixi.animateTokenTo(" in text


def test_phase13_player_bridge_intercepts_tokens():
    """player/10-map.js must intercept setTokens for Pixi."""
    text = _read("static/js/player/10-map.js")
    assert "origSetTokens = playerMainGrid.setTokens.bind(playerMainGrid)" in text
    assert "pixi.setTokens(tokens)" in text
    assert "pixi.animateTokenTo(" in text


def test_phase13_cache_bust_r3():
    """All changed files must carry ?v=13r3."""
    for html in ["static/gm.html", "static/player.html"]:
        text = _read(html)
        assert "?v=13r3" in text, f"{html} missing ?v=13r3"
        assert "?v=13r2" not in text, f"{html} still has old ?v=13r2"
