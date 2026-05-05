from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_player_unexplored_darkness_uses_ambient_without_floor():
    js = (ROOT / "static" / "js" / "map-canvas" / "lighting.js").read_text(encoding="utf-8")
    assert "const unexploredAlpha = darkAlpha;" in js
    assert "Math.max(darkAlpha, 0.85)" not in js


def test_full_outdoor_light_skips_explored_darkness_artifact():
    js = (ROOT / "static" / "js" / "map-canvas" / "lighting.js").read_text(encoding="utf-8")
    assert "if (darkAlpha > 0)" in js
    assert "rgba(0,0,0,0.55)" in js


def test_player_trap_accept_hit_calls_builder_v2_endpoint():
    js = (ROOT / "static" / "js" / "player" / "19-traps.js").read_text(encoding="utf-8")
    assert "/api/builder-v2/traps/${d.trap_id}/dodge" in js
    assert "force_hit: true" in js
    assert "/api/traps/${d.trap_id}/dodge" not in js
    assert "if (e.target === overlay) overlay.remove()" not in js


def test_player_bv2_traps_not_overwritten_by_legacy_overlays():
    js = (ROOT / "static" / "js" / "player" / "10-map.js").read_text(encoding="utf-8")
    assert "if (!state.bv2_active_location_id) state._traps = ov.traps || [];" in js
    assert "if (!state.bv2_active_location_id) state._traps = [];" in js


def test_player_chests_and_portals_call_builder_v2_endpoints():
    js = (ROOT / "static" / "js" / "player" / "19-chest-portal.js").read_text(encoding="utf-8")
    core_js = (ROOT / "static" / "js" / "character-sheet-core.js").read_text(encoding="utf-8")
    assert "/api/builder-v2/chests/${chest.id}/pick-lock" in js
    assert "/api/builder-v2/chests/${chestId}/take" in js
    assert "/api/builder-v2/portals/${portal.id}/use" in js
    assert "createD20RollForm" in core_js
    assert "idPrefix: 'pc-lock'" in js
    assert "ability, advantage_mode, d20_count" in js
    assert "/api/chests/${chest.id}/pick-lock" not in js
    assert "/api/map-builder/portals/${portal.id}/use" not in js


def test_player_trap_disarm_action_is_wired():
    traps_js = (ROOT / "static" / "js" / "player" / "19-traps.js").read_text(encoding="utf-8")
    core_js = (ROOT / "static" / "js" / "character-sheet-core.js").read_text(encoding="utf-8")
    map_js = (ROOT / "static" / "js" / "player" / "10-map.js").read_text(encoding="utf-8")
    events_js = (ROOT / "static" / "js" / "map-canvas" / "events.js").read_text(encoding="utf-8")
    assert "/api/builder-v2/traps/${trap.id}/disarm" in traps_js
    assert "createD20RollForm" in core_js
    assert "idPrefix: 'tp-disarm'" in traps_js
    assert "ability, advantage_mode, d20_count" in traps_js
    assert "onTrapClick: (trap) => openPlayerTrapModal(trap)" in map_js
    assert "if (trap && this.onTrapClick)" in events_js


def test_sidebar_uses_shared_d20_roll_form():
    html = (ROOT / "static" / "player.html").read_text(encoding="utf-8")
    sidebar_js = (ROOT / "static" / "js" / "player" / "02-starting-wizard.js").read_text(encoding="utf-8")
    advanced_js = (ROOT / "static" / "js" / "player" / "17-char-roll.js").read_text(encoding="utf-8")
    assert "character-sheet-core.js" in html
    assert "id=\"cs-roll-widget-host\"" in html
    assert "id=\"player-roll-widget-host\"" in html
    assert "createD20RollForm" in sidebar_js
    assert "idPrefix: 'cs-roll'" in sidebar_js
    assert "createD20RollForm" in advanced_js
    assert "idPrefix: 'player-roll'" in advanced_js
    assert "roll-characteristic" in sidebar_js


def test_player_map_objects_hidden_outside_line_of_sight():
    render_js = (ROOT / "static" / "js" / "map-canvas" / "render.js").read_text(encoding="utf-8")
    events_js = (ROOT / "static" / "js" / "map-canvas" / "events.js").read_text(encoding="utf-8")
    assert "MapCanvas.prototype._isCellVisibleToPlayer" in render_js
    assert "if (!this._isCellVisibleToPlayer(ch.col, ch.row)) continue;" in render_js
    assert "if (!this._isCellVisibleToPlayer(t.col, t.row)) continue;" in render_js
    assert "if (!this._isCellVisibleToPlayer(p.col, p.row)) continue;" in render_js
    assert "this._isCellVisibleToPlayer(ch.col, ch.row)" in events_js
