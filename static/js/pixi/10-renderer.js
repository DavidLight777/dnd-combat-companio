'use strict';

/**
 * PixiMapRenderer — Phase 13 R2
 * WebGL-based map renderer.  Replaces Canvas2D draw path when
 * USE_PIXI=1 cookie is set.  Keeps pan/zoom, tiles, grid, but NO
 * tokens / lights / fog yet (R3/R4).
 */
class PixiMapRenderer {
  constructor(hostEl, opts = {}) {
    this.host = hostEl;
    this.role = opts.role || 'player';
    this.gridSize = opts.gridSize || 50;
    this.mapWidth = opts.mapWidth || 0;
    this.mapHeight = opts.mapHeight || 0;

    this.app = new PIXI.Application({
      resizeTo: hostEl,
      backgroundColor: 0x0a0908,
      antialias: false,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    hostEl.appendChild(this.app.view);

    // Layer hierarchy (z-order bottom→top)
    this.world = new PIXI.Container();
    this.tilesLayer = new PIXI.Container();
    this.gridLayer = new PIXI.Graphics();
    this.overlaysLayer = new PIXI.Container();
    this.tokensLayer = new PIXI.Container();
    this.fxLayer = new PIXI.Container();
    this.world.addChild(
      this.tilesLayer, this.gridLayer, this.overlaysLayer,
      this.tokensLayer, this.fxLayer);
    this.app.stage.addChild(this.world);

    this.lightingLayer = new PIXI.Container();
    this.app.stage.addChild(this.lightingLayer);

    this._scale = 1;
    this._offsetX = 0;
    this._offsetY = 0;
    this._tilesMap = {};
    this._gridEnabled = false;

    this._bindInputs();
  }

  destroy() {
    this.app.destroy(true, { children: true, texture: false });
  }

  // ── View transform ──────────────────────────────────────────
  _applyTransform() {
    this.world.scale.set(this._scale);
    this.world.position.set(this._offsetX, this._offsetY);
  }

  setView(offsetX, offsetY, scale) {
    this._offsetX = offsetX;
    this._offsetY = offsetY;
    this._scale = scale;
    this._applyTransform();
  }

  // ── Tiles ───────────────────────────────────────────────────
  /**
   * Build sprites from the atlas for every tile in tilesMap.
   * After populate sets cacheAsBitmap = true so pan/zoom blits
   * one texture instead of re-drawing N sprites.
   */
  setTiles(tilesMap, gridType) {
    if (gridType === 'hex') {
      // Hex grid stays Canvas2D in Phase 13 (documented limitation)
      console.warn('PixiMapRenderer: hex grid not supported, skipping');
      return;
    }

    this._tilesMap = tilesMap || {};
    const tl = this.tilesLayer;
    tl.cacheAsBitmap = false;
    tl.removeChildren();

    const gs = this.gridSize;
    const mw = this.mapWidth || this.app.screen.width;
    const mh = this.mapHeight || this.app.screen.height;

    const _getTex = (type, raw) => {
      if (!window.PixiAtlas) return PIXI.Texture.WHITE;
      if (type === 'door') {
        const isOpen = (typeof raw === 'object' && raw && raw.is_open);
        return window.PixiAtlas.tex(isOpen ? 'door_open' : 'door_closed');
      }
      const t = window.PixiAtlas.tex(type);
      return (t && t !== PIXI.Texture.WHITE) ? t : window.PixiAtlas.tex('floor_stone');
    };

    for (const [key, raw] of Object.entries(this._tilesMap)) {
      const type = typeof raw === 'string' ? raw : (raw && raw.type) || 'floor';
      const [col, row] = key.split(',').map(Number);
      const px = col * gs, py = row * gs;
      if (px < 0 || py < 0 || px >= mw || py >= mh) continue;

      const tex = _getTex(type, raw);
      const sp = new PIXI.Sprite(tex);
      sp.x = px;
      sp.y = py;
      sp.width = gs;
      sp.height = gs;
      tl.addChild(sp);
    }

    // Wall drop-shadows (same logic as Phase 12 R3)
    const g = new PIXI.Graphics();
    g.beginFill(0x000000, 0.35);
    for (const [key, raw] of Object.entries(this._tilesMap)) {
      const type = typeof raw === 'string' ? raw : (raw && raw.type) || 'floor';
      if (type !== 'wall') continue;
      const [col, row] = key.split(',').map(Number);
      const px = col * gs, py = row * gs;

      const south = this._tilesMap[`${col},${row + 1}`];
      const southType = typeof south === 'string' ? south : (south && south.type) || 'floor';
      if (southType !== 'wall') {
        g.drawRect(px, py + gs - 2, gs, 2);
      }

      const east = this._tilesMap[`${col + 1},${row}`];
      const eastType = typeof east === 'string' ? east : (east && east.type) || 'floor';
      if (eastType !== 'wall') {
        g.drawRect(px + gs - 2, py, 2, gs);
      }
    }
    g.endFill();
    tl.addChild(g);

    tl.cacheAsBitmap = true;
  }

  // ── Grid ────────────────────────────────────────────────────
  setGridEnabled(on) {
    this._gridEnabled = on;
    this._drawGrid();
  }

  setGridStyle({ color = 0x888888, alpha = 0.4, width = 1 } = {}) {
    this._gridColor = color;
    this._gridAlpha = alpha;
    this._gridWidth = width;
    this._drawGrid();
  }

  _drawGrid() {
    const g = this.gridLayer;
    g.clear();
    if (this.role === 'player' || !this._gridEnabled) return;

    const gs = this.gridSize;
    const mw = this.mapWidth || this.app.screen.width;
    const mh = this.mapHeight || this.app.screen.height;

    g.lineStyle(this._gridWidth / this._scale, this._gridColor, this._gridAlpha);
    for (let x = 0; x <= mw; x += gs) {
      g.moveTo(x, 0);
      g.lineTo(x, mh);
    }
    for (let y = 0; y <= mh; y += gs) {
      g.moveTo(0, y);
      g.lineTo(mw, y);
    }
  }

  // ── Pan / Zoom inputs ───────────────────────────────────────
  _bindInputs() {
    const view = this.app.view;
    let dragging = false;
    let lastX = 0, lastY = 0;

    view.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = view.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const worldX = (mx - this._offsetX) / this._scale;
      const worldY = (my - this._offsetY) / this._scale;

      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.2, Math.min(5, this._scale * factor));

      this._offsetX = mx - worldX * newScale;
      this._offsetY = my - worldY * newScale;
      this._scale = newScale;
      this._applyTransform();
      this._drawGrid();
    }, { passive: false });

    view.addEventListener('pointerdown', (e) => {
      if (e.button === 2) { // right-drag = pan
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        view.setPointerCapture(e.pointerId);
      }
    });

    view.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      this._offsetX += dx;
      this._offsetY += dy;
      lastX = e.clientX;
      lastY = e.clientY;
      this._applyTransform();
    });

    view.addEventListener('pointerup', (e) => {
      if (dragging) {
        dragging = false;
        view.releasePointerCapture(e.pointerId);
      }
    });

    view.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ── Public helpers used by bridge ───────────────────────────
  resizeToHost() {
    // PIXI.Application resizeTo handles this automatically
  }

  clear() {
    this.tilesLayer.removeChildren();
    this.gridLayer.clear();
    this.tokensLayer.removeChildren();
    this.overlaysLayer.removeChildren();
    this.fxLayer.removeChildren();
  }
}

window.PixiMapRenderer = PixiMapRenderer;
