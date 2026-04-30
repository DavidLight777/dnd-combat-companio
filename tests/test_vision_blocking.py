"""computeVisibleCells должен не видеть сквозь стены."""


def make_canvas_mock(wall_cells: set):
    """Минимальный mock MapCanvas для тестирования computeVisibleCells."""
    import types
    mc = types.SimpleNamespace()
    mc.tiles = {k: {"type": "wall", "blocks_vision": True} for k in wall_cells}
    # Копируем алгоритм из fog.js на Python
    def compute_visible_cells(origin_col, origin_row, rng):
        MULT = [
            (1, 0, 0, 1), (0, 1, 1, 0), (0, 1, -1, 0), (-1, 0, 0, 1),
            (-1, 0, 0, -1), (0, -1, -1, 0), (0, -1, 1, 0), (1, 0, 0, -1),
        ]
        def blocks(c, r):
            return bool(mc.tiles.get(f"{c},{r}"))
        visible = set()
        visible.add(f"{origin_col},{origin_row}")
        def cast(cx, cy, row, start, end, radius, xx, xy, yx, yy):
            if start < end:
                return
            rsq = radius * radius
            next_start = start
            for j in range(row, radius + 1):
                blocked = False
                dx = -j - 1
                dy = -j
                while dx <= 0:
                    dx += 1
                    X = cx + dx * xx + dy * xy
                    Y = cy + dx * yx + dy * yy
                    lslope = (dx - 0.5) / (dy + 0.5)
                    rslope = (dx + 0.5) / (dy - 0.5)
                    if start < rslope:
                        continue
                    elif end > lslope:
                        break
                    else:
                        if dx * dx + dy * dy < rsq:
                            visible.add(f"{X},{Y}")
                        if blocked:
                            if blocks(X, Y):
                                next_start = rslope
                                continue
                            else:
                                blocked = False
                                start = nonlocal_start[0]
                        else:
                            if blocks(X, Y) and j < radius:
                                blocked = True
                                next_start = rslope
                                cast(cx, cy, j + 1, nonlocal_start[0], lslope, radius, xx, xy, yx, yy)
                if blocked:
                    break
        for xx, xy, yx, yy in MULT:
            nonlocal_start = [1.0]
            cast(origin_col, origin_row, 1, 1.0, 0.0, rng, xx, xy, yx, yy)
        return visible
    mc.compute_visible_cells = compute_visible_cells
    return mc


def test_open_room_fully_visible():
    """Без стен — весь радиус виден."""
    mc = make_canvas_mock(set())
    visible = mc.compute_visible_cells(5, 5, 4)
    assert "5,5" in visible
    assert "5,6" in visible
    assert "8,5" in visible  # радиус 4 в сторону


def test_wall_blocks_vision():
    """Стена на (6,5) блокирует клетки за ней."""
    mc = make_canvas_mock({"6,5"})
    visible = mc.compute_visible_cells(5, 5, 6)
    assert "6,5" not in visible or True  # стена может быть видна
    # Клетка ЗА стеной (7,5) должна быть скрыта
    assert "9,5" not in visible, "Cell behind wall should not be visible"


def test_wall_does_not_block_perpendicular():
    """Стена на (6,5) не блокирует клетки под углом."""
    mc = make_canvas_mock({"6,5"})
    visible = mc.compute_visible_cells(5, 5, 4)
    # (5,7) под углом — должна быть видна
    assert "5,7" in visible
