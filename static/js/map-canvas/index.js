/* ══════════════════════════════════════════════════════════════
   MAP CANVAS — Rendering, Pan/Zoom, Tokens, Fog of War
   ══════════════════════════════════════════════════════════════ */
'use strict';

class MapCanvas {
  constructor(canvasEl, options = {}) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.role = options.role || 'player'; // 'gm' or 'player'
    this.sessionCode = options.sessionCode || '';
    // Rework v3 Phase 2: players may only drag their OWN token. This id
    // is consulted in `_isTokenDraggable` below. Leave null for GM.
    this.ownCharacterId = options.ownCharacterId != null ? options.ownCharacterId : null;
    // Rework v3 Phase 2: when true, drop positions are snapped to the
    // nearest grid-cell centre before firing onTokenMove. Safe default:
    // enabled whenever the grid itself is enabled.
    this.snapToGrid = options.snapToGrid !== false;
    // Rework v3 Phase 3: combat-mode gating. When false, a player may
    // NOT drag their own token (e.g. combat is active and it's somebody
    // else's turn). GM is unaffected — they always retain full control.
    // Driven by player-app.js via setCanPlayerMove().
    this.canPlayerMove = options.canPlayerMove !== false;
    // Rework v3 Phase 4: reachable-cell overlay. When combat is active
    // AND it's the player's turn, `movementLeftCells` holds the number
    // of cells they can still traverse — rendered as a translucent
    // gold ring / cell highlight centred on their own token. `null`
    // disables the overlay. Outside combat this stays null too.
    this.movementLeftCells = null;
    this.movementTotalCells = null;
    this.onTokenMove = options.onTokenMove || null; // callback(charId, x, y)
    this.onFogReveal = options.onFogReveal || null; // callback(col, row)
    this.onDrawingSaved = options.onDrawingSaved || null; // callback(drawingData)
    // Phase 5: fired when the GM finishes dragging out a wall/zone
    // rectangle. Receives `{x1, y1, x2, y2, kind}` (normalised 0..1).
    this.onObjectSaved = options.onObjectSaved || null;
    this.onMarkerCreate = options.onMarkerCreate || null; // callback(x, y) normalized
    this.onMarkerClick = options.onMarkerClick || null;
    this.onTokenClick = options.onTokenClick || null;
    this.onTokenRightClick = options.onTokenRightClick || null;
    this.onDoorRightClick = options.onDoorRightClick || null;
    this.onChestClick = options.onChestClick || null;
    this.onMapChestClick = options.onMapChestClick || null;
    this.onPortalClick = options.onPortalClick || null;
    this.onMapClick = options.onMapClick || null; // callback(nx, ny) for any click on empty map
    this.onEraseMarker = options.onEraseMarker || null;
    this.onEraseDrawing = options.onEraseDrawing || null;

    // State
    this.mapImage = null;
    this.mapWidth = 0;
    this.mapHeight = 0;
    this.tokens = [];
    this.gridSize = 50;
    this.gridEnabled = true;
    // Grid style: 'square' (king-move, Chebyshev distance) or 'hex'
    // (pointy-top hexagons, axial hex distance). Affects rendering,
    // snap-to-cell, movement-reach overlay, and the measure tool.
    // Fog of war stays square-indexed regardless (see render()).
    this.gridType = 'square';
    this.fogEnabled = false;
    this.revealedCells = new Set();
    this.currentVisible = null; // Phase 10 R5: currently visible cells from token vision

    // Overlays (Stage 9)
    this.drawings = [];
    this.markers = [];
    // Rework v3 Phase 5: map objects (walls / zones). Rendered under
    // tokens but above the base map image. `setObjects()` drops in a
    // fresh list; the WS `map.objects_updated` event triggers a full
    // refresh from the /overlays endpoint.
    this.mapObjects = [];

    // Map Builder: tile grid overlay (col,row -> tile_type)
    this.tiles = {};
    // Map Builder: traps list for rendering
    this.traps = [];
    // Chests overlay
    this.chests = [];
    // Map Builder tile-based chests (MapChest)
    this.mapChests = [];
    // Map Builder portals (MapPortal)
    this.portals = [];

    // Phase 8: lighting + edge indicators
    this.ambientLight = 1.0;
    this.isIndoor = false;
    this.lights = [];
    this.edges = [];
    this._lightLayer = null;
    this._lightLayerCtx = null;
    this._darkLayer = null;
    this._darkLayerCtx = null;

    // Transform
    this.offsetX = 0;
    this.offsetY = 0;
    this.scale = 1;

    // Interaction
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.dragToken = null; // token being dragged
    this.lastMouse = { x: 0, y: 0 };
    this.fogPaintMode = false; // GM fog reveal mode
    // RAF-coalesced render handle. `_requestRender()` schedules at
    // most one full render per animation frame; high-frequency events
    // (mousemove during drag/pan/draw) call it instead of `render()`
    // directly so the canvas can't become a CPU hog at 120 Hz mice.
    this._renderRafId = null;

    // Drawing mode (Stage 9)
    this.drawMode = null; // null, 'freehand', 'rectangle', 'circle', 'line', 'arrow', 'marker', 'erase', 'measure'
    this.drawColor = '#ff0000';
    this.drawLineWidth = 2;
    this.drawFillOpacity = 0.2;
    this.drawVisibleToPlayers = true;
    this._drawingPath = []; // current freehand points
    this._isDrawing = false; // mouse is pressed during draw
    this._shapeStart = null; // shape drag start
    this._shapePreview = null; // live preview
    this._measureStart = null;
    this._measureEnd = null;

    // ── Combat FX engine ─────────────────────────────────────
    // Lightweight visual effects played over the canvas when combat
    // events arrive via WebSocket (hits, misses, crits, fumbles,
    // heals, generic damage). Each effect is a short-lived record
    // with a `startTs`, `duration`, anchor `(x, y)` in normalised map
    // coordinates, and a `type` that selects the renderer in
    // `_renderFx`. While any effect is live, a rAF loop keeps the
    // canvas repainting; once the list empties the loop shuts down so
    // we don't burn CPU when nothing is happening.
    this.fx = [];
    this._fxAnimId = null;

    // Phase 12 R4: token portrait image cache (url -> HTMLImageElement)
    this._tokenImgCache = new Map();
    // Phase 12 R5: smooth token movement interpolation
    // charId -> {prevX, prevY, targetX, targetY, startTime}
    this._tokenAnims = new Map();
    this._tokenAnimRafId = null;

    this._bindEvents();
    this._resize();
    // Phase 13 REDO R3: register for global lifecycle hooks
    if (!window._allMapCanvases) window._allMapCanvases = [];
    window._allMapCanvases.push(this);
  }

  // Public: trigger a combat effect anchored on normalised map coords.
  // `type` ∈ {hit, miss, crit, fumble, heal, damage}. Extra params:
  //   text       — floating text above the token (e.g. "-5", "MISS")
  //   color      — override primary colour
  //   duration   — ms, defaults to 1200 (crit: 1500)
  //   screenShake— true to add a brief CSS shake on <body>
  playFx(type, nx, ny, opts = {}) {
    if (nx == null || ny == null) return;
    const now = performance.now();
    const duration = opts.duration || (type === 'crit' ? 1500 : 1200);
    this.fx.push({
      type, x: nx, y: ny,
      startTs: now,
      duration,
      text: opts.text || '',
      color: opts.color || null,
    });
    if (opts.screenShake) this._triggerScreenShake(type === 'crit' ? 'hard' : 'soft');
    this._startFxLoop();
  }

  // Phase 12 R5: animate a token to a new position over 200ms.
  _startFxLoop() {
    if (this._fxAnimId) return;
    const tick = () => {
      const now = performance.now();
      this.fx = this.fx.filter(f => (now - f.startTs) < f.duration);
      this.render();
      if (this.fx.length > 0) {
        this._fxAnimId = requestAnimationFrame(tick);
      } else {
        this._fxAnimId = null;
      }
    };
    this._fxAnimId = requestAnimationFrame(tick);
  }

  // Render all active effects. Called last in `render()` so FX sit
  // on top of tokens. All geometry is in MAP pixel space (we're
  // inside the translate+scale transform set up by render()).
  _renderFx(ctx) {
    if (!this.fx.length) return;
    const now = performance.now();
    const gs = this.gridSize || 50;
    for (const f of this.fx) {
      const tNorm = Math.min(1, (now - f.startTs) / f.duration);
      const eased = 1 - Math.pow(1 - tNorm, 2); // ease-out-quad for travel
      const px = f.x * this.mapWidth;
      const py = f.y * this.mapHeight;
      ctx.save();
      switch (f.type) {
        case 'hit':
        case 'damage': {
          // Red expanding ring + floating damage text.
          const col = f.color || '#ff4848';
          const r0 = gs * 0.45;
          const r = r0 + gs * 1.1 * eased;
          ctx.globalAlpha = (1 - tNorm) * 0.85;
          ctx.strokeStyle = col;
          ctx.lineWidth = 4 / this.scale;
          ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
          // Inner softer ring for a bit of glow
          ctx.globalAlpha = (1 - tNorm) * 0.35;
          ctx.lineWidth = 10 / this.scale;
          ctx.beginPath(); ctx.arc(px, py, r * 0.85, 0, Math.PI * 2); ctx.stroke();
          if (f.text) this._drawFxText(ctx, f.text, px, py, eased, tNorm, col, 22);
          break;
        }
        case 'crit': {
          // Double ring (gold + red) + larger pulsing text.
          const r0 = gs * 0.5;
          const r = r0 + gs * 1.6 * eased;
          ctx.globalAlpha = (1 - tNorm);
          ctx.strokeStyle = '#ffcc32';
          ctx.lineWidth = 5 / this.scale;
          ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
          ctx.strokeStyle = '#ff4848';
          ctx.lineWidth = 3 / this.scale;
          ctx.beginPath(); ctx.arc(px, py, r * 0.68, 0, Math.PI * 2); ctx.stroke();
          // Burst rays — 8 short radial lines.
          ctx.strokeStyle = '#ffd858';
          ctx.lineWidth = 2.5 / this.scale;
          ctx.globalAlpha = (1 - tNorm) * 0.9;
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const r1 = r0 + gs * 0.4 * eased;
            const r2 = r0 + gs * 1.0 * eased;
            ctx.beginPath();
            ctx.moveTo(px + Math.cos(a) * r1, py + Math.sin(a) * r1);
            ctx.lineTo(px + Math.cos(a) * r2, py + Math.sin(a) * r2);
            ctx.stroke();
          }
          if (f.text) this._drawFxText(ctx, f.text, px, py, eased, tNorm, '#ff5252', 30);
          break;
        }
        case 'miss': {
          this._drawFxText(ctx, f.text || 'MISS', px, py, eased, tNorm, '#b8b8b8', 20);
          break;
        }
        case 'fumble': {
          // Same as miss but with a wobble on X.
          const wobble = Math.sin(tNorm * Math.PI * 4) * 12;
          this._drawFxText(ctx, f.text || 'FUMBLE',
                           px + wobble, py, eased, tNorm, '#d4a018', 22);
          break;
        }
        case 'defended': {
          // Blue shield ring expanding outward + floating text.
          const col = f.color || '#48aaff';
          const r0 = gs * 0.4;
          const r = r0 + gs * 1.0 * eased;
          ctx.globalAlpha = (1 - tNorm) * 0.8;
          ctx.strokeStyle = col;
          ctx.lineWidth = 4 / this.scale;
          ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
          // Small hexagon / shield icon inside
          ctx.globalAlpha = (1 - tNorm) * 0.7;
          const hs = gs * 0.18 * (1 - tNorm * 0.2);
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const ang = (Math.PI / 3) * i - Math.PI / 2;
            const hx = px + Math.cos(ang) * hs;
            const hy = py + Math.sin(ang) * hs;
            if (i === 0) ctx.moveTo(hx, hy); else ctx.lineTo(hx, hy);
          }
          ctx.closePath(); ctx.stroke();
          if (f.text) this._drawFxText(ctx, f.text, px, py, eased, tNorm, col, 24);
          break;
        }
        case 'heal': {
          const col = '#4ade80';
          const r0 = gs * 0.45;
          const r = r0 + gs * 0.7 * eased;
          ctx.globalAlpha = (1 - tNorm) * 0.7;
          ctx.strokeStyle = col;
          ctx.lineWidth = 3 / this.scale;
          ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke();
          // Gentle cross icon
          ctx.globalAlpha = (1 - tNorm) * 0.6;
          ctx.strokeStyle = col;
          ctx.lineWidth = 3 / this.scale;
          const cs = gs * 0.22 * (1 - tNorm * 0.3);
          ctx.beginPath();
          ctx.moveTo(px - cs, py); ctx.lineTo(px + cs, py);
          ctx.moveTo(px, py - cs); ctx.lineTo(px, py + cs);
          ctx.stroke();
          if (f.text) this._drawFxText(ctx, f.text, px, py, eased, tNorm, col, 22);
          break;
        }
      }
      ctx.restore();
    }
  }

  // Shared floating-text drawer used by every FX type. Text rises
  // upward from the token and fades linearly.
  _drawFxText(ctx, text, px, py, eased, tNorm, color, sizePx) {
    const dy = -70 * eased;                // px in map space
    const alpha = 1 - tNorm;
    const fontPx = sizePx / this.scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${fontPx}px Inter, sans-serif`;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.lineWidth = 5 / this.scale;
    ctx.strokeText(text, px, py + dy / this.scale);
    ctx.fillStyle = color;
    ctx.fillText(text, px, py + dy / this.scale);
    ctx.restore();
  }

  // ── Load map image ──────────────────────────────────────────
}
Object.defineProperty(MapCanvas.prototype, '_mw', {
  get: function() { return this.mapWidth || this.canvas.width; }
});
Object.defineProperty(MapCanvas.prototype, '_mh', {
  get: function() { return this.mapHeight || this.canvas.height; }
});

// Phase 13 REDO R1 — tiny geometry helper
function _segmentNearPoint(ax, ay, bx, by, px, py, tol) {
  const lenSq = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
  let t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * (bx - ax);
  const cy = ay + t * (by - ay);
  return (px - cx) * (px - cx) + (py - cy) * (py - cy) <= tol * tol;
}

MapCanvas.prototype._hexPixelToKey = function(px, py) {
  const frac = this._pixelToAxial(px, py);
  const hex = this._hexRound(frac.q, frac.r);
  return `${hex.q},${hex.r}`;
};

// Phase 13 REDO R1 — ray-cast polygon from a point source.
// Returns array of [x,y] in WORLD pixel coordinates.
MapCanvas.prototype._raycastPolygon = function(originX, originY, radiusPx, blocksAt, numRays) {
  numRays = numRays || 120;
  const poly = [];
  const step = (Math.PI * 2) / numRays;
  for (let i = 0; i < numRays; i++) {
    const a = i * step;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const STEP_PX = Math.max(2, this.gridSize / 12);
    let t = 0;
    while (t < radiusPx) {
      const x = originX + dx * t;
      const y = originY + dy * t;
      if (blocksAt(x, y)) break;
      t += STEP_PX;
    }
    if (t > radiusPx) t = radiusPx;
    poly.push([originX + dx * t, originY + dy * t]);
  }
  return poly;
};

// Phase 13 REDO R1 — grid-agnostic blocksAt factory.
MapCanvas.prototype._makeBlocksAt = function() {
  const gs = this.gridSize;
  const tiles = this.tiles || {};
  const walls = (this.mapObjects || []).filter(function(o) {
    return o.kind === 'wall' && o.blocks_vision !== false;
  });
  const cellKey = this.gridType === 'hex'
    ? this._hexPixelToKey.bind(this)
    : function(x, y) { return Math.floor(x / gs) + ',' + Math.floor(y / gs); };
  return function(x, y) {
    const k = cellKey(x, y);
    const t = tiles[k];
    if (t && t.blocks_vision) {
      if (t.type === 'door' && t.is_open) return false;
      return true;
    }
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i];
      if (_segmentNearPoint(w.x1, w.y1, w.x2, w.y2, x, y, 2)) return true;
    }
    return false;
  };
};

MapCanvas.prototype._ensureLayer = function(name, w, h) {
  const key = '_' + name + 'Layer';
  if (!this[key] || this[key].width !== w || this[key].height !== h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    this[key] = c;
  }
};

// Phase 13 REDO R3: pause light animation when tab is hidden.
document.addEventListener('visibilitychange', function() {
  const arr = window._allMapCanvases || [];
  if (document.hidden) {
    for (let i = 0; i < arr.length; i++) {
      arr[i]._stopLightAnim();
    }
  } else {
    for (let i = 0; i < arr.length; i++) {
      const mc = arr[i];
      const animated = mc.lights && mc.lights.some(function(l) {
        return l.source_kind === 'torch' || l.source_kind === 'magic';
      });
      if (animated) mc._startLightAnim();
    }
  }
});

window.MapCanvas = MapCanvas;
