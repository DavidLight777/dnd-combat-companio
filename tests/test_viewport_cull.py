"""Bug C — Viewport culling correctness.

On large maps, iterating every cell every frame is slow. The fix
computes a visible-cell rect from camera transform and iterates only
those cells. This test verifies the rect bounds are correct.
"""

import math


def visible_cell_rect(cols, rows, grid_size, scale, offset_x, offset_y,
                       canvas_w, canvas_h, is_hex=False):
    """Pure mirror of _visibleCellRect from 20-mapview.js."""
    min_x = -offset_x / scale
    min_y = -offset_y / scale
    max_x = (canvas_w - offset_x) / scale
    max_y = (canvas_h - offset_y) / scale
    gs = grid_size
    if is_hex:
        row_h = gs * math.sqrt(3) / 2
        return {
            "cMin": max(0, math.floor(min_x / gs) - 1),
            "cMax": min(cols - 1, math.ceil(max_x / gs) + 1),
            "rMin": max(0, math.floor(min_y / row_h) - 1),
            "rMax": min(rows - 1, math.ceil(max_y / row_h) + 1),
        }
    return {
        "cMin": max(0, math.floor(min_x / gs) - 1),
        "cMax": min(cols - 1, math.ceil(max_x / gs) + 1),
        "rMin": max(0, math.floor(min_y / gs) - 1),
        "rMax": min(rows - 1, math.ceil(max_y / gs) + 1),
    }


class TestViewportCullSquare:
    def test_origin_visible_rect(self):
        """At origin, the visible rect starts at 0 and doesn't exceed
        the canvas width in cells."""
        rect = visible_cell_rect(
            cols=200, rows=150, grid_size=60, scale=0.5,
            offset_x=0, offset_y=0,
            canvas_w=800, canvas_h=600,
        )
        assert rect["cMin"] == 0
        # 800 / (60 * 0.5) = 26.6, +1 padding = ~28
        assert rect["cMax"] <= 28
        assert rect["rMin"] == 0
        assert rect["rMax"] <= 21  # 600 / 30 = 20, +1

    def test_panned_far_right(self):
        """Camera panned far right — left columns should not render."""
        rect = visible_cell_rect(
            cols=200, rows=150, grid_size=60, scale=0.5,
            offset_x=-3000, offset_y=-2000,
            canvas_w=800, canvas_h=600,
        )
        assert rect["cMin"] > 80, (
            f"Expected cMin > 80 when panned -3000px, got {rect['cMin']}"
        )


class TestViewportCullHex:
    def test_origin_hex(self):
        rect = visible_cell_rect(
            cols=200, rows=150, grid_size=60, scale=0.5,
            offset_x=0, offset_y=0,
            canvas_w=800, canvas_h=600,
            is_hex=True,
        )
        assert rect["cMin"] == 0
        assert rect["cMax"] <= 28
        assert rect["rMin"] == 0
        # hex row height = 60 * sqrt(3)/2 ≈ 51.96
        # 600 / 0.5 = 1200 world px; 1200 / 51.96 ≈ 23.1, +1 padding ≈ 25
        assert rect["rMax"] <= 25

    def test_panned_far_right_hex(self):
        rect = visible_cell_rect(
            cols=200, rows=150, grid_size=60, scale=0.5,
            offset_x=-3000, offset_y=-2000,
            canvas_w=800, canvas_h=600,
            is_hex=True,
        )
        assert rect["cMin"] > 80, (
            f"Expected cMin > 80 for hex when panned -3000px, got {rect['cMin']}"
        )
