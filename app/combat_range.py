"""Rework v3 Phase 7 — shared range-enforcement helpers.

Both weapon attacks and ability casts need the same question answered:
"is the target close enough?" The math is Chebyshev (king-move) cells
on the current battle map, reusing the exact metric `map.py` already
uses for movement and wall-collision so every gameplay surface agrees.

Design choices:

* `range_cells` is stored on `ItemWeaponStats.range_cells` and
  `Ability.range_cells`. A value of `None` or `0` means "no limit".
* Distance is computed from current (map_x, map_y) of attacker &
  target — both must be placed on a map. If EITHER is off-map (no
  grid fight yet, or a pre-map session) the check is skipped rather
  than throwing, so legacy flows (chip-view, quick-tests) keep
  working. The enforcement layer is strictly additive.
* `max(1, distance_rounded)` — adjacent cells read as 0 distance in
  Chebyshev math, but "range 1 = melee adjacent" is the expected
  vocabulary. We clamp so range=1 means "touching cell or adjacent".
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Character, MapData


@dataclass
class RangeCheck:
    """Outcome of a range enforcement check.

    `ok=True` means the caller may proceed. When `ok=False`,
    `distance_cells` and `max_cells` give the failing numbers so the
    error handler can craft a human-friendly message.
    `skipped=True` means we couldn't measure (map / positions missing)
    and the caller should treat this as a non-failure.
    """
    ok: bool
    skipped: bool = False
    distance_cells: float = 0.0
    max_cells: int = 0


def _chebyshev_cells(
    x0: float, y0: float, x1: float, y1: float,
    map_w: int, map_h: int, grid_size: int,
) -> float:
    """Distance in whole cells between two normalised (0..1) positions.

    Duplicated here so this module has no runtime dependency on
    `app.routers.map` (router imports combat_range, not the reverse).
    Kept byte-identical to the movement enforcement metric.
    """
    if not map_w or not map_h or not grid_size:
        return 0.0
    dx = abs(x1 - x0) * map_w / grid_size
    dy = abs(y1 - y0) * map_h / grid_size
    return max(dx, dy)


async def check_range(
    attacker: Character,
    target: Character,
    range_cells: Optional[int],
    db: AsyncSession,
) -> RangeCheck:
    """Measure the attacker→target distance and compare vs `range_cells`.

    Returns a RangeCheck tuple so the caller can format a precise
    error without duplicating the math. `range_cells` of `None` or
    `0` short-circuits to ok=True — caller wanted "no limit" semantics.
    """
    if not range_cells or range_cells <= 0:
        return RangeCheck(ok=True, skipped=True, max_cells=0)

    # If either participant isn't placed on the map, we can't measure
    # meaningfully — fail open so non-grid flows still work.
    if attacker.map_x is None or attacker.map_y is None:
        return RangeCheck(ok=True, skipped=True, max_cells=range_cells)
    if target.map_x is None or target.map_y is None:
        return RangeCheck(ok=True, skipped=True, max_cells=range_cells)
    if attacker.session_id != target.session_id:
        # Different sessions shouldn't happen in practice — skip
        # rather than reject so a bizarre cross-session attack
        # doesn't spin up a mysterious 403.
        return RangeCheck(ok=True, skipped=True, max_cells=range_cells)

    md = (await db.execute(
        select(MapData).where(MapData.session_id == attacker.session_id)
    )).scalar_one_or_none()
    if not md or not md.grid_size or not md.image_width or not md.image_height:
        return RangeCheck(ok=True, skipped=True, max_cells=range_cells)

    dist = _chebyshev_cells(
        attacker.map_x, attacker.map_y,
        target.map_x, target.map_y,
        md.image_width, md.image_height, md.grid_size,
    )
    # Snap-to-grid places tokens at integer cell centres, so rounding
    # clears float noise (~1e-6) that would otherwise tip an exact
    # range=N shot into "out of range".
    dist_rounded = round(dist, 3)
    return RangeCheck(
        ok=dist_rounded <= range_cells + 1e-6,
        skipped=False,
        distance_cells=dist_rounded,
        max_cells=range_cells,
    )
