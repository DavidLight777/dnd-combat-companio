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

  // Phase 13 REDO R1 — polygon-based ray-cast lighting.
  MapCanvas.prototype._renderLightingOverlay = function(ctx) {
    const isGm = this.role === 'gm';
    const softFactor = isGm ? 0.35 : 1.0;
    const darkAlpha = (this.isIndoor
        ? 0.88
        : Math.max(0, 1 - (this.ambientLight ?? 1.0))) * softFactor;
    if (darkAlpha <= 0 && !this.lights.length) return;

    const w = this.canvas.width, h = this.canvas.height;
    this._ensureLightLayer(w, h);
    const lctx = this._lightLayerCtx;
    lctx.clearRect(0, 0, w, h);
    lctx.fillStyle = `rgba(0,0,0,${darkAlpha})`;
    lctx.fillRect(0, 0, w, h);

    if (!this.lights.length) {
      ctx.drawImage(this._lightLayer, 0, 0);
      return;
    }

    const gs = this.gridSize;
    const blocksAt = this._makeBlocksAt();

    lctx.globalCompositeOperation = 'destination-out';
    for (const light of this.lights) {
      const radius = light.radius_cells ?? 4;
      const radiusPx = radius * gs;
      const cxWorld = (light.col + 0.5) * gs;
      const cyWorld = (light.row + 0.5) * gs;
      const poly = this._raycastPolygon(cxWorld, cyWorld, radiusPx, blocksAt, 120);

      // World → screen
      const sx = cxWorld * this.scale + this.offsetX;
      const sy = cyWorld * this.scale + this.offsetY;
      const rPx = radiusPx * this.scale;

      // Build screen-space polygon path
      lctx.save();
      lctx.beginPath();
      for (let i = 0; i < poly.length; i++) {
        const px = poly[i][0] * this.scale + this.offsetX;
        const py = poly[i][1] * this.scale + this.offsetY;
        if (i === 0) lctx.moveTo(px, py); else lctx.lineTo(px, py);
      }
      lctx.closePath();
      lctx.clip();

      // Soft radial gradient inside the polygon
      const intensity = light.intensity ?? 1.0;
      const grad = lctx.createRadialGradient(sx, sy, 0, sx, sy, rPx);
      grad.addColorStop(0,   `rgba(0,0,0,${intensity * softFactor})`);
      grad.addColorStop(0.6, `rgba(0,0,0,${intensity * 0.5 * softFactor})`);
      grad.addColorStop(1,   'rgba(0,0,0,0)');
      lctx.fillStyle = grad;
      lctx.fillRect(sx - rPx, sy - rPx, rPx * 2, rPx * 2);
      lctx.restore();
    }
    lctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this._lightLayer, 0, 0);
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
