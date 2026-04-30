(function () {
  function _hexToRgb(hex) {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  // Phase 15 Round 1 — world-space lighting (no manual offset/scale).
  // Phase 13 REDO R2 — coloured additive lighting with bright/dim radii.
  // Phase 13 REDO R3 — animation perturbation added.
  MapCanvas.prototype._drawOneLight = function(lctx, light, blocksAt) {
    const gs = this.gridSize;
    const radius = light.radius_cells ?? 4;
    const bright = (light.bright_radius_cells && light.bright_radius_cells > 0)
        ? light.bright_radius_cells
        : radius * 0.5;
    let radiusPx = radius * gs;

    // World-space center (NO offsetX/offsetY — we are inside ctx.save/translate)
    const cxWorld = (light.col + 0.5) * gs;
    const cyWorld = (light.row + 0.5) * gs;

    // Phase 13 REDO R3: perturb intensity / radius per source_kind.
    let intensityMod = 1.0, radiusMod = 1.0;
    const phase = this._lightAnimPhase || 0;
    if (light.source_kind === 'torch') {
      // Value-noise flicker at ~8Hz, ±10%
      const n = Math.sin(phase * 8 + light.id * 1.7) * 0.5
              + Math.sin(phase * 13 + light.id * 0.3) * 0.5;
      intensityMod = 1 + n * 0.1;
    } else if (light.source_kind === 'magic') {
      // Pulse at 2Hz, ±5% radius
      radiusMod = 1 + Math.sin(phase * 2 * Math.PI * 2 + light.id) * 0.05;
    }
    const intensity = Math.min(1.5, (light.intensity ?? 1.0) * intensityMod);
    radiusPx = radiusPx * radiusMod;

    const poly = this._raycastPolygon(cxWorld, cyWorld, radiusPx, blocksAt, 120);

    // All coords in world space (no scale/offset needed — lctx NOT transformed)
    const rPx = isFinite(radiusPx) && radiusPx > 0 ? radiusPx : 1;
    const brightPx = isFinite(bright) && bright > 0 ? bright * gs : 0;

    lctx.save();
    lctx.beginPath();
    for (let i = 0; i < poly.length; i++) {
      if (i === 0) lctx.moveTo(poly[i][0], poly[i][1]);
      else lctx.lineTo(poly[i][0], poly[i][1]);
    }
    lctx.closePath();
    lctx.clip();

    // Colour gradient. Bright radius = full colour, dim = fade out.
    const rgb = _hexToRgb(light.color_hex || '#ffd9a0');
    const a0 = 1.0 * intensity;
    const a1 = 0.5 * intensity;
    const grad = lctx.createRadialGradient(cxWorld, cyWorld, 0, cxWorld, cyWorld, rPx);
    const stopAtBright = rPx > 0 ? Math.min(0.99, brightPx / rPx) : 0;
    grad.addColorStop(0,            `rgba(${rgb.r},${rgb.g},${rgb.b},${a0})`);
    grad.addColorStop(stopAtBright, `rgba(${rgb.r},${rgb.g},${rgb.b},${a1})`);
    grad.addColorStop(1,            `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
    lctx.fillStyle = grad;
    lctx.fillRect(cxWorld - rPx, cyWorld - rPx, rPx * 2, rPx * 2);
    lctx.restore();
  };

  MapCanvas.prototype._renderLightingOverlay = function(ctx) {
    // w/h in world space (map size, not canvas size)
    const w = this.mapWidth || this.canvas.width;
    const h = this.mapHeight || this.canvas.height;
    if (w === 0 || h === 0) return;

    // Ensure offscreen layers match MAP size, not canvas size
    this._ensureLayer('dark', w, h);
    this._ensureLayer('light', w, h);
    const dctx = this._darkLayer.getContext('2d');
    const lctx = this._lightLayer.getContext('2d');

    // ── Darkness veil ──
    const ambient = this.ambientLight ?? 1.0;
    const darkAlpha = this.isIndoor ? 0.88 : Math.max(0, 1 - ambient);
    dctx.clearRect(0, 0, w, h);

    const gs = this.gridSize || 50;

    // Phase 15 Round 4: player vision — smooth gradient (same pipeline as GM)
    if (this.role === 'player' && this.ownCharacterId != null) {
      const own = (this.tokens || []).find(t => t.character_id === this.ownCharacterId);
      if (own && own.x != null) {
        const col = Math.floor(own.x * this.mapWidth / gs);
        const row = Math.floor(own.y * this.mapHeight / gs);
        const visionRange = own.sight_range_cells || 8;

        // Keep cell-accurate visibility for NPC hiding logic
        const visSet = this.computeVisibleCells(col, row, visionRange);
        this.currentVisible = visSet;
        if (!this.revealedCells) this.revealedCells = new Set();
        for (const key of visSet) this.revealedCells.add(key);

        // Layer 1: unexplored darkness (respects ambient light)
        const unexploredAlpha = Math.max(darkAlpha, 0.85);
        dctx.fillStyle = `rgba(0,0,0,${unexploredAlpha})`;
        dctx.fillRect(0, 0, w, h);

        // Layer 2: grey for explored but not currently visible (cell-accurate is fine here)
        for (const key of this.revealedCells) {
          if (visSet.has(key)) continue;
          const [c, r] = key.split(',').map(Number);
          dctx.fillStyle = 'rgba(0,0,0,0.55)';
          dctx.fillRect(c * gs, r * gs, gs, gs);
        }

        // Layer 3: punch a SMOOTH radial gradient for the visible area
        // This replaces the pixelated clearRect approach with the same
        // ray-cast polygon + radial gradient used by GM lighting.
        const cxWorld = (col + 0.5) * gs;
        const cyWorld = (row + 0.5) * gs;
        const radiusPx = visionRange * gs;
        const blocksAt = this._makeBlocksAt();
        const poly = this._raycastPolygon(cxWorld, cyWorld, radiusPx, blocksAt, 180);

        dctx.globalCompositeOperation = 'destination-out';
        dctx.save();
        dctx.beginPath();
        for (let i = 0; i < poly.length; i++) {
          if (i === 0) dctx.moveTo(poly[i][0], poly[i][1]);
          else dctx.lineTo(poly[i][0], poly[i][1]);
        }
        dctx.closePath();
        dctx.clip();
        // Radial gradient: fully clear at centre, fades to ~20% transparent at edge
        const grad = dctx.createRadialGradient(cxWorld, cyWorld, 0, cxWorld, cyWorld, radiusPx);
        grad.addColorStop(0,    'rgba(0,0,0,1)');   // full erase at centre
        grad.addColorStop(0.75, 'rgba(0,0,0,1)');   // solid visible zone
        grad.addColorStop(1,    'rgba(0,0,0,0)');   // soft edge fade
        dctx.fillStyle = grad;
        dctx.fillRect(cxWorld - radiusPx, cyWorld - radiusPx, radiusPx * 2, radiusPx * 2);
        dctx.restore();
        dctx.globalCompositeOperation = 'source-over';
      } else {
        dctx.fillStyle = `rgba(0,0,0,${darkAlpha})`;
        dctx.fillRect(0, 0, w, h);
      }
    } else {
      dctx.fillStyle = `rgba(0,0,0,${darkAlpha})`;
      dctx.fillRect(0, 0, w, h);
    }

    const hasLights = this.lights.length > 0;
    const hasTokenVision = (this.tokens || []).some(function(t) {
      return t.sight_range_cells && t.sight_range_cells > 0;
    });

    if (!hasLights && !hasTokenVision) {
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

    // Phase 13 REDO R3: token-carried vision as colourless lights
    for (const t of this.tokens) {
      if (!t.sight_range_cells || t.sight_range_cells <= 0) continue;
      const fake = {
        id: -t.character_id,
        col: Math.floor(t.x * this.mapWidth / gs),
        row: Math.floor(t.y * this.mapHeight / gs),
        radius_cells: t.sight_range_cells,
        bright_radius_cells: t.sight_range_cells * 0.5,
        color_hex: '#ffffff',
        intensity: 0.8,
        source_kind: 'sight',
      };
      this._drawOneLight(lctx, fake, blocksAt);
    }

    lctx.globalCompositeOperation = 'source-over';

    // ── Subtract light from darkness ──
    dctx.globalCompositeOperation = 'destination-out';
    dctx.drawImage(this._lightLayer, 0, 0);
    dctx.globalCompositeOperation = 'source-over';

    // ── Composite onto the main canvas ──
    ctx.drawImage(this._darkLayer, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(this._lightLayer, 0, 0);
    ctx.restore();
  }

  // Phase 13 REDO R3 — RAF animation loop for light sources.
  MapCanvas.prototype._startLightAnim = function() {
    if (this._lightRaf) return;
    const tick = () => {
      this._lightAnimPhase = performance.now() / 1000;
      // Throttle re-render to ~30fps to avoid CPU hogging.
      if (!this._lightAnimFramePending) {
        this._lightAnimFramePending = true;
        requestAnimationFrame(() => {
          this._lightAnimFramePending = false;
          this.render();
        });
      }
      this._lightRaf = requestAnimationFrame(tick);
    };
    this._lightRaf = requestAnimationFrame(tick);
  }

  MapCanvas.prototype._stopLightAnim = function() {
    if (this._lightRaf) {
      cancelAnimationFrame(this._lightRaf);
      this._lightRaf = null;
    }
    this._lightAnimFramePending = false;
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
