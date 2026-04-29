(function () {
  MapCanvas.prototype._hexSize = function() { return this.gridSize / Math.sqrt(3); }


  MapCanvas.prototype._axialToPixel = function(q, r) {
    const gs = this.gridSize;
    return {
      x: gs * (q + r / 2),
      y: gs * (Math.sqrt(3) / 2) * r,
    };
  }


  MapCanvas.prototype._pixelToAxial = function(px, py) {
    const s = this._hexSize();
    const q = (Math.sqrt(3) / 3 * px - py / 3) / s;
    const r = (2 / 3 * py) / s;
    return { q, r };
  }

  // Cube-round a fractional axial pair to the nearest integer hex.

  MapCanvas.prototype._hexRound = function(q, r) {
    const s = -q - r;
    let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
    const dq = Math.abs(rq - q);
    const dr = Math.abs(rr - r);
    const ds = Math.abs(rs - s);
    if (dq > dr && dq > ds)      rq = -rr - rs;
    else if (dr > ds)            rr = -rq - rs;
    // else rs would be adjusted but we don't use it.
    return { q: rq, r: rr };
  }


  MapCanvas.prototype._hexDistance = function(a, b) {
    return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
  }

  // Snap a normalised (0..1) coordinate pair to the nearest cell centre.
  // Returns the same pair unchanged if snapping is disabled or impossible.

  MapCanvas.prototype._snapNorm = function(nx, ny) {
    if (!this.snapToGrid || !this.gridEnabled) return { x: nx, y: ny };
    if (!this.mapWidth || !this.mapHeight || !this.gridSize) return { x: nx, y: ny };
    const px = nx * this.mapWidth;
    const py = ny * this.mapHeight;
    let sx, sy;
    if (this.gridType === 'hex') {
      const frac = this._pixelToAxial(px, py);
      const hex = this._hexRound(frac.q, frac.r);
      const centre = this._axialToPixel(hex.q, hex.r);
      sx = centre.x; sy = centre.y;
    } else {
      sx = (Math.floor(px / this.gridSize) + 0.5) * this.gridSize;
      sy = (Math.floor(py / this.gridSize) + 0.5) * this.gridSize;
    }
    return {
      x: Math.max(0, Math.min(1, sx / this.mapWidth)),
      y: Math.max(0, Math.min(1, sy / this.mapHeight)),
    };
  }


  MapCanvas.prototype._hexPath = function(ctx, cx, cy, size) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      // Pointy-top: first corner is straight up (−π/2 + 60°k).
      const a = -Math.PI / 2 + i * Math.PI / 3;
      const x = cx + size * Math.cos(a);
      const y = cy + size * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  // Render the full hex grid covering the map. We iterate (q, r) across
  // axial bounds computed from the four map corners, widened by one so
  // partial cells at the edges still get stroked.

})();
