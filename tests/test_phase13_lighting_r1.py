"""Phase 13 REDO R1 — unit tests for the ray-cast polygon logic.

These tests mirror the JS _raycastPolygon behaviour in pure Python
so we can assert geometry correctness without a browser.
"""

import math


def _raycast_polygon(origin_x, origin_y, radius_px, blocks_at, num_rays=120, grid_size=50):
    """Python mirror of MapCanvas.prototype._raycastPolygon."""
    poly = []
    step = (math.pi * 2) / num_rays
    step_px = max(2, grid_size / 12)
    for i in range(num_rays):
        a = i * step
        dx = math.cos(a)
        dy = math.sin(a)
        t = 0
        while t < radius_px:
            x = origin_x + dx * t
            y = origin_y + dy * t
            if blocks_at(x, y):
                break
            t += step_px
        if t > radius_px:
            t = radius_px
        poly.append((origin_x + dx * t, origin_y + dy * t))
    return poly


def _make_blocks_at(tiles, grid_size=50, grid_type="square"):
    """Python mirror of MapCanvas.prototype._makeBlocksAt (simplified)."""
    def cell_key(x, y):
        if grid_type == "hex":
            # Simplified hex-round for testing purposes.
            # Real JS uses _pixelToAxial + _hexRound.
            # Here we just do a rough axial round based on pointy-top layout.
            size = grid_size / math.sqrt(3)
            q = (math.sqrt(3) / 3 * x - y / 3) / size
            r = (2 / 3 * y) / size
            s = -q - r
            rq, rr, rs = round(q), round(r), round(s)
            dq, dr, ds = abs(rq - q), abs(rr - r), abs(rs - s)
            if dq > dr and dq > ds:
                rq = -rr - rs
            elif dr > ds:
                rr = -rq - rs
            return f"{rq},{rr}"
        return f"{math.floor(x / grid_size)},{math.floor(y / grid_size)}"

    def blocks_at(x, y):
        k = cell_key(x, y)
        t = tiles.get(k)
        if t and t.get("blocks_vision"):
            if t.get("type") == "door" and t.get("is_open"):
                return False
            return True
        return False

    return blocks_at


class TestRaycastPolygonOpenSpace:
    def test_polygon_expands_to_full_radius(self):
        """Light in an empty grid: every vertex should be at radius (± step)."""
        gs = 50
        radius = 4
        origin = (2.5 * gs, 2.5 * gs)
        blocks = _make_blocks_at({}, gs)
        poly = _raycast_polygon(*origin, radius * gs, blocks, num_rays=120, grid_size=gs)
        assert len(poly) == 120
        for x, y in poly:
            dist = math.hypot(x - origin[0], y - origin[1])
            # Allow one marching step of overshoot/undershoot
            assert radius * gs - 5 <= dist <= radius * gs + 5, f"dist={dist}"

    def test_polygon_is_convex_in_open_space(self):
        """In open space the polygon should roughly surround the origin."""
        gs = 50
        origin = (2.5 * gs, 2.5 * gs)
        poly = _raycast_polygon(*origin, 200, lambda _x, _y: False, grid_size=gs)
        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        assert min(xs) < origin[0] < max(xs)
        assert min(ys) < origin[1] < max(ys)


class TestRaycastPolygonClippedByWall:
    def test_eastern_ray_clipped_by_wall(self):
        """A wall directly east of the light should clip the eastward ray.
        We use a 3-cell-tall wall so diagonal rays cannot tunnel through."""
        gs = 50
        origin = (2.5 * gs, 2.5 * gs)
        # Vertical wall at col=3 spanning rows 1..3
        tiles = {
            "3,1": {"type": "wall", "blocks_vision": True},
            "3,2": {"type": "wall", "blocks_vision": True},
            "3,3": {"type": "wall", "blocks_vision": True},
        }
        blocks = _make_blocks_at(tiles, gs)
        poly = _raycast_polygon(*origin, 4 * gs, blocks, num_rays=120, grid_size=gs)
        # Vertex 0 corresponds to angle 0 (exactly east).
        east_vertex = poly[0]
        # The wall face is at x = 3*gs = 150.  Allow a few px tolerance.
        assert east_vertex[0] < 3 * gs + 10, (
            f"Eastward vertex {east_vertex[0]} should be clipped by wall"
        )

    def test_western_ray_unaffected(self):
        """The westward ray (angle π) should still reach full radius."""
        gs = 50
        origin = (2.5 * gs, 2.5 * gs)
        tiles = {
            "3,1": {"type": "wall", "blocks_vision": True},
            "3,2": {"type": "wall", "blocks_vision": True},
            "3,3": {"type": "wall", "blocks_vision": True},
        }
        blocks = _make_blocks_at(tiles, gs)
        poly = _raycast_polygon(*origin, 4 * gs, blocks, num_rays=120, grid_size=gs)
        # Vertex 60 corresponds to angle π (exactly west).
        west_vertex = poly[60]
        assert west_vertex[0] <= origin[0] - 4 * gs + 5


class TestRaycastPolygonHexGrid:
    def test_hex_open_space_reaches_radius(self):
        """Hex grid: no walls means full radius."""
        gs = 50
        origin = (2.5 * gs, 2.5 * gs)
        blocks = _make_blocks_at({}, gs, grid_type="hex")
        poly = _raycast_polygon(*origin, 4 * gs, blocks, num_rays=120, grid_size=gs)
        assert len(poly) == 120
        for x, y in poly:
            dist = math.hypot(x - origin[0], y - origin[1])
            assert 4 * gs - 5 <= dist <= 4 * gs + 5

    def test_hex_wall_clips_rays(self):
        """Hex grid: a wall tile north-east of origin should clip some rays."""
        gs = 50
        origin = (2.5 * gs, 2.5 * gs)
        # Use axial q=3, r=1 as the wall key.  In our simplified hex key this blocks NE sector.
        tiles = {"3,1": {"type": "wall", "blocks_vision": True}}
        blocks = _make_blocks_at(tiles, gs, grid_type="hex")
        poly = _raycast_polygon(*origin, 4 * gs, blocks, num_rays=120, grid_size=gs)
        # At least one vertex should be shorter than full radius (the NE quadrant)
        dists = [math.hypot(x - origin[0], y - origin[1]) for x, y in poly]
        assert any(d < 4 * gs - 10 for d in dists), "Expected some clipped rays on hex grid"
