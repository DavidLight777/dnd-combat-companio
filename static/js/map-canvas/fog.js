(function () {
  MapCanvas.prototype.computeVisibleCells = function(originCol, originRow, range) {
    const MULT = [
      [1, 0, 0, 1], [0, 1, 1, 0], [0, 1, -1, 0], [-1, 0, 0, 1],
      [-1, 0, 0, -1], [0, -1, -1, 0], [0, -1, 1, 0], [1, 0, 0, -1],
    ];
    const _blocks = (c, r) => {
      const t = this.tiles[`${c},${r}`];
      return !!(t && t.blocks_vision);
    };
    const _cast = (cx, cy, row, start, end, radius, xx, xy, yx, yy, visible) => {
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
          if (start < rSlope) continue;
          else if (end > lSlope) break;
          else {
            if (dx * dx + dy * dy < radiusSq) visible.add(`${X},${Y}`);
            if (blocked) {
              if (_blocks(X, Y)) { nextStart = rSlope; continue; }
              else { blocked = false; start = nextStart; }
            } else {
              if (_blocks(X, Y) && j < radius) {
                blocked = true; nextStart = rSlope;
                _cast(cx, cy, j + 1, start, lSlope, radius, xx, xy, yx, yy, visible);
              }
            }
          }
        }
        if (blocked) break;
      }
    };
    const visible = new Set();
    visible.add(`${originCol},${originRow}`);
    for (let octant = 0; octant < 8; octant++) {
      const [xx, xy, yx, yy] = MULT[octant];
      _cast(originCol, originRow, 1, 1.0, 0.0, range, xx, xy, yx, yy, visible);
    }
    return visible;
  }


})();
