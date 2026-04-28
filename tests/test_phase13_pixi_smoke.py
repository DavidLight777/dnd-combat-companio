import json
import os

BASE = os.path.join(os.path.dirname(__file__), "..")


def _read(path):
    with open(os.path.join(BASE, path), encoding="utf-8") as f:
        return f.read()


def test_phase13_pixi_renderer_file_exists():
    """static/js/pixi/10-renderer.js must exist and export PixiMapRenderer."""
    text = _read("static/js/pixi/10-renderer.js")
    assert "class PixiMapRenderer" in text
    assert "window.PixiMapRenderer = PixiMapRenderer" in text
    assert "setTiles(" in text
    assert "setGridEnabled(" in text
    assert "cacheAsBitmap = true" in text


def test_phase13_pixi_loader_file_exists():
    """static/js/pixi/00-loader.js must exist and export PixiAtlas."""
    text = _read("static/js/pixi/00-loader.js")
    assert "window.PixiAtlas" in text
    assert "async function load(" in text
    assert "function tex(" in text


def test_phase13_gm_html_has_cookie_gate():
    """gm.html must conditionally load Pixi scripts via USE_PIXI cookie."""
    text = _read("static/gm.html")
    assert "window.USE_PIXI = document.cookie.includes('USE_PIXI=1')" in text
    assert "if (window.USE_PIXI)" in text
    assert "00-loader.js?v=13r2" in text
    assert "10-renderer.js?v=13r2" in text


def test_phase13_player_html_has_cookie_gate():
    """player.html must conditionally load Pixi scripts via USE_PIXI cookie."""
    text = _read("static/player.html")
    assert "window.USE_PIXI = document.cookie.includes('USE_PIXI=1')" in text
    assert "if (window.USE_PIXI)" in text
    assert "00-loader.js?v=13r2" in text
    assert "10-renderer.js?v=13r2" in text


def test_phase13_map_canvas_has_external_renderer_guard():
    """map-canvas.js render() must early-return when useExternalRenderer is set."""
    text = _read("static/js/map-canvas.js")
    assert "if (this.useExternalRenderer) return;" in text
    assert "getCanvasElement()" in text
