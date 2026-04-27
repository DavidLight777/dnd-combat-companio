// ════════════════════════════════════════════════════════════
// Map Builder v2 — FOV Calculator (Phase 3).
// Recursive shadowcasting for square grids.
// Reference: http://www.roguebasin.com/index.php/Shadow_casting
// ════════════════════════════════════════════════════════════

(function () {
  // Multipliers for transforming coordinates into 8 octants.
  const MULT = [
    [1, 0, 0, 1],   // 0
    [0, 1, 1, 0],   // 1
    [0, 1, -1, 0],  // 2
    [-1, 0, 0, 1],  // 3
    [-1, 0, 0, -1], // 4
    [0, -1, -1, 0], // 5
    [0, -1, 1, 0],  // 6
    [1, 0, 0, -1],  // 7
  ];

  function _castLight(cx, cy, row, start, end, radius, xx, xy, yx, yy, visible, blocksFn) {
    if (start < end) return;
    const radiusSq = radius * radius;
    let nextStart = start;
    for (let j = row; j <= radius; j++) {
      let blocked = false;
      let dx = -j - 1;
      let dy = -j;
      while (dx <= 0) {
        dx += 1;
        const X = cx + dx * xx + dy * xy;
        const Y = cy + dx * yx + dy * yy;
        const lSlope = (dx - 0.5) / (dy + 0.5);
        const rSlope = (dx + 0.5) / (dy - 0.5);
        if (start < rSlope) {
          continue;
        } else if (end > lSlope) {
          break;
        } else {
          if (dx * dx + dy * dy < radiusSq) {
            visible.add(`${X},${Y}`);
          }
          if (blocked) {
            if (blocksFn(X, Y)) {
              nextStart = rSlope;
              continue;
            } else {
              blocked = false;
              start = nextStart;
            }
          } else {
            if (blocksFn(X, Y) && j < radius) {
              blocked = true;
              nextStart = rSlope;
              _castLight(cx, cy, j + 1, start, lSlope, radius, xx, xy, yx, yy, visible, blocksFn);
            }
          }
        }
      }
      if (blocked) break;
    }
  }

  class FOVCalculator {
    constructor(location, tiles) {
      this.loc = location;
      this.tiles = tiles; // Map "col,row" -> server tile object (ser_tile shape)
    }

    _blocksVision(col, row) {
      // MapView.tiles stores the full server tile object (shape: ser_tile),
      // so the authoritative `blocks_vision` flag comes straight from the
      // backend TILE_DEFAULTS registry. Never re-encode that rule table
      // here — if you add a new blocking tile type, update the registry
      // in app/routers/builder_v2/common.py:TILE_DEFAULTS only.
      const t = this.tiles.get(`${col},${row}`);
      if (!t) return false;
      return !!t.blocks_vision;
    }

    compute(originCol, originRow, range) {
      const visible = new Set();
      visible.add(`${originCol},${originRow}`);

      for (let octant = 0; octant < 8; octant++) {
        const [xx, xy, yx, yy] = MULT[octant];
        _castLight(
          originCol, originRow,
          1, 1.0, 0.0,
          range,
          xx, xy, yx, yy,
          visible,
          (c, r) => this._blocksVision(c, r)
        );
      }
      return visible;
    }
  }

  window.bv2.FOVCalculator = FOVCalculator;
})();
