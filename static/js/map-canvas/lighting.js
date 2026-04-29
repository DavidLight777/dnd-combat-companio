(function () {
  // Phase 13 REDO R1 — legacy cell-based lighting (kept for reference).
  // TODO: delete in R3 final.
  MapCanvas.prototype._renderLightingOverlay_legacy = function(ctx) {
    const isGm = this.role === 'gm';
    const softFactor = isGm ? 0.35 : 1.0;
    const darkAlpha = (this.isIndoor ? 0.88 : Math.max(0, 1 - (this.ambientLight ?? 1.0))) * softFactor;
    if (darkAlpha <= 0 && !this.lights.length) return;

    const w = this.canvas.width;
    const h = this.canvas.height;
    if (!this._lightLayer) {
      this._lightLayer = document.createElement('canvas');
      this._lightLayerCtx = this._lightLayer.getContext('2d');
    }
    this._lightLayer.width = w;
    this._lightLayer.height = h;
    const lctx = this._lightLayerCtx;

    lctx.clearRect(0, 0, w, h);
    lctx.fillStyle = `rgba(0,0,0,${darkAlpha})`;
    lctx.fillRect(0, 0, w, h);

    if (this.lights.length) {
      lctx.globalCompositeOperation = 'destination-out';
      const gs = this.gridSize;
      for (const light of this.lights) {
        const radius = light.radius_cells ?? 4;
        const intensity = light.intensity ?? 1.0;
        const visibleSet = this.computeVisibleCells(light.col, light.row, Math.ceil(radius));

        const path = new Path2D();
        for (const key of visibleSet) {
          const [c, r] = key.split(',').map(Number);
          const sx = c * gs * this.scale + this.offsetX;
          const sy = r * gs * this.scale + this.offsetY;
          const sz = gs * this.scale;
          path.rect(sx, sy, sz + 1, sz + 1);
        }

        lctx.save();
        lctx.clip(path);
        const cx = (light.col + 0.5) * gs * this.scale + this.offsetX;
        const cy = (light.row + 0.5) * gs * this.scale + this.offsetY;
        const rPx = radius * gs * this.scale;
        const grad = lctx.createRadialGradient(cx, cy, 0, cx, cy, rPx);
        grad.addColorStop(0,   `rgba(0,0,0,${intensity * softFactor})`);
        grad.addColorStop(0.6, `rgba(0,0,0,${intensity * 0.5 * softFactor})`);
        grad.addColorStop(1,   'rgba(0,0,0,0)');
        lctx.fillStyle = grad;
        lctx.fillRect(cx - rPx, cy - rPx, rPx * 2, rPx * 2);
        lctx.restore();
      }
      lctx.globalCompositeOperation = 'source-over';
    }

    ctx.drawImage(this._lightLayer, 0, 0);
  }

  function _hexToRgb(hex) {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  // Phase 13 REDO R2 — coloured additive lighting with bright/dim radii.
  MapCanvas.prototype._drawOneLight = function(lctx, light, blocksAt) {
    const gs = this.gridSize;
    const radius = light.radius_cells ?? 4;
    const bright = (light.bright_radius_cells && light.bright_radius_cells > 0)
        ? light.bright_radius_cells
        : radius * 0.5;
    const radiusPx = radius * gs;
    const cxWorld = (light.col + 0.5) * gs;
    const cyWorld = (light.row + 0.5) * gs;
    const poly = this._raycastPolygon(cxWorld, cyWorld, radiusPx, blocksAt, 120);
    const sx = cxWorld * this.scale + this.offsetX;
    const sy = cyWorld * this.scale + this.offsetY;
    const rPx = radiusPx * this.scale;
    const brightPx = bright * gs * this.scale;

    // Polygon clip
    lctx.save();
    lctx.beginPath();
    for (let i = 0; i < poly.length; i++) {
      const px = poly[i][0] * this.scale + this.offsetX;
      const py = poly[i][1] * this.scale + this.offsetY;
      if (i === 0) lctx.moveTo(px, py); else lctx.lineTo(px, py);
    }
    lctx.closePath();
    lctx.clip();

    // Colour gradient. Bright radius = full colour, dim = fade out.
    const rgb = _hexToRgb(light.color_hex || '#ffd9a0');
    const intensity = Math.min(1.5, light.intensity ?? 1.0);
    const a0 = 1.0 * intensity;
    const a1 = 0.5 * intensity;
    const grad = lctx.createRadialGradient(sx, sy, 0, sx, sy, rPx);
    const stopAtBright = Math.min(0.99, brightPx / rPx);
    grad.addColorStop(0,             `rgba(${rgb.r},${rgb.g},${rgb.b},${a0})`);
    grad.addColorStop(stopAtBright,  `rgba(${rgb.r},${rgb.g},${rgb.b},${a1})`);
    grad.addColorStop(1,             `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
    lctx.fillStyle = grad;
    lctx.fillRect(sx - rPx, sy - rPx, rPx * 2, rPx * 2);
    lctx.restore();
  };

  MapCanvas.prototype._renderLightingOverlay = function(ctx) {
    const w = this.canvas.width, h = this.canvas.height;
    if (w === 0 || h === 0) return;
    this._ensureLayer('dark', w, h);
    this._ensureLayer('light', w, h);
    const dctx = this._darkLayer.getContext('2d');
    const lctx = this._lightLayer.getContext('2d');

    // ── Darkness veil ──
    const ambient = this.ambientLight ?? 1.0;
    const darkAlpha = this.isIndoor ? 0.88 : Math.max(0, 1 - ambient);
    dctx.clearRect(0, 0, w, h);
    dctx.fillStyle = `rgba(0,0,0,${darkAlpha})`;
    dctx.fillRect(0, 0, w, h);

    if (!this.lights.length) {
      ctx.drawImage(this._darkLayer, 0, 0);
      return;
    }

    // ── Light layer (additive) ──
    lctx.clearRect(0, 0, w, h);
    lctx.globalCompositeOperation = 'lighter';
    const blocksAt = this._makeBlocksAt();
    for (const light of this.lights) {
      this._drawOneLight(lctx, light, blocksAt);
    }
    lctx.globalCompositeOperation = 'source-over';

    // ── Subtract light from darkness ──
    dctx.globalCompositeOperation = 'destination-out';
    dctx.drawImage(this._lightLayer, 0, 0);
    dctx.globalCompositeOperation = 'source-over';

    // ── Composite onto the main canvas ──
    // Step A: darken the map where unlit.
    ctx.drawImage(this._darkLayer, 0, 0);
    // Step B: multiply the map by the coloured light (tints it).
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this._lightLayer, 0, 0);
    ctx.restore();
  }

  // ── Phase 9: interior zone overlay ──────────────────────────
  // Covers interior cells based on reveal_mode:
  //   gm_only  -> black for players, visible for GM
  //   always   -> no overlay
  //   on_enter -> hidden until a player token steps inside.
  // GM always sees a soft preview (lower alpha).
  //
  // RENDER ORDER NOTE (Phase 11.5 B): this MUST be called AFTER
  // `_renderFog` in `render()`. If it runs before fog, the fog's
  // dim overlay (0.55 for explored cells) paints over the roof
  // (0.95) and makes the building look partially open.

})();
