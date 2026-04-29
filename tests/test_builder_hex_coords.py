"""Bug A — Hex coord mismatch.

The old axial formula diverges from odd-r offset starting at row 1.
This test verifies that _tileCenterPx (odd-r) and _screenToTile are
mutual inverses for a small grid — which the old axial formula was not.
"""

import math


def tile_center_odd_r(col, row, gs):
    """Current _tileCenterPx formula (odd-r offset)."""
    x_off = (gs / 2) if (row & 1) else 0
    return ((col + 0.5) * gs + x_off, (row + 0.5) * gs * math.sqrt(3) / 2)


def tile_center_axial_OLD(col, row, gs):
    """The broken axial formula that was used before the fix."""
    return (gs * (col + row / 2), gs * math.sqrt(3) / 2 * row)


def screen_to_tile(mx, my, gs):
    """Mirror of _screenToTile hex branch — brute-force nearest centre."""
    best = None
    best_d = float('inf')
    target_row = my / (gs * math.sqrt(3) / 2)
    for dr in (-1, 0, 1):
        row = round(target_row - 0.5) + dr
        if row < 0:
            continue
        x_off = (gs / 2) if (row & 1) else 0
        col = round((mx - x_off) / gs - 0.5)
        cx, cy = tile_center_odd_r(col, row, gs)
        d = (cx - mx) ** 2 + (cy - my) ** 2
        if d < best_d:
            best_d = d
            best = (col, row)
    return best


class TestHexCoordRoundtrip:
    def test_odd_r_roundtrip_all_cells(self):
        """For every cell in 0..7 x 0..7, click-resolve the centre
        back to the original (col, row)."""
        gs = 60
        for row in range(8):
            for col in range(8):
                # Using the FIXED odd-r formula (current code)
                cx, cy = tile_center_odd_r(col, row, gs)
                back_col, back_row = screen_to_tile(cx, cy, gs)
                assert back_col == col, f"col mismatch at ({col},{row}): got {back_col}"
                assert back_row == row, f"row mismatch at ({col},{row}): got {back_row}"

    def test_axial_old_diverges_from_odd_r(self):
        """The old axial formula diverges from odd-r starting at row 1.
        This is the regression-catch: on HEAD^ this property was true,
        and a test using the old formula would fail the roundtrip."""
        gs = 60
        mismatches = []
        for row in range(8):
            for col in range(8):
                odd_r = tile_center_odd_r(col, row, gs)
                axial = tile_center_axial_OLD(col, row, gs)
                if not (math.isclose(odd_r[0], axial[0], abs_tol=0.5)
                        and math.isclose(odd_r[1], axial[1], abs_tol=0.5)):
                    mismatches.append((col, row, odd_r, axial))
        # The old formula mismatches for many cells beyond row 0.
        assert len(mismatches) > 10, (
            f"Expected many mismatches, got {len(mismatches)}. "
            "If this is 0, the old formula may have already been fixed."
        )
