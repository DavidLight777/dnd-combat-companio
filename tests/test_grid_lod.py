"""Bug B — Thick lines at low zoom (LOD threshold).

When zoomed far out, cells render smaller than 6 px and the grid
becomes visual noise. The fix adds an early-return guard in _drawGrid.
This test mirrors that guard logic.
"""


def would_draw_grid(grid_size, scale, threshold=6):
    """Pure mirror of the _drawGrid early-return guard.
    Returns True if the grid should be drawn, False if suppressed."""
    cell_px = grid_size * scale
    return cell_px >= threshold


def test_grid_hidden_when_cells_under_6px():
    """At scale=0.05 with gs=60, each cell is 3px — grid should hide."""
    assert would_draw_grid(60, 0.05) is False


def test_grid_visible_when_cells_over_6px():
    """At scale=0.2 with gs=60, each cell is 12px — grid should show."""
    assert would_draw_grid(60, 0.2) is True


def test_grid_at_exact_threshold():
    """At exactly 6px the grid should still be visible (>=)."""
    assert would_draw_grid(60, 0.1) is True  # 60 * 0.1 = 6


def test_grid_just_below_threshold():
    """Just under 6px should hide."""
    assert would_draw_grid(60, 0.099) is False  # 5.94 px
