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

    this._bindEvents();
    this._resize();
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

  // Convenience: find the token for a character_id and play FX there.
  playFxOnCharacter(charId, type, opts = {}) {
    if (charId == null) return;
    const t = (this.tokens || []).find(tk => tk.character_id === charId);
    if (!t || t.x == null || t.y == null) return;
    this.playFx(type, t.x, t.y, opts);
  }

  _triggerScreenShake(intensity) {
    // Prefer the closest positioned ancestor of the canvas so the
    // shake doesn't move the whole page (which is jarring when the
    // sidebar/character sheet is also visible). Falls back to <body>.
    const host = this.canvas.closest('.battle-panel')
              || this.canvas.closest('.panel')
              || document.body;
    const cls = intensity === 'hard' ? 'fx-shake-hard' : 'fx-shake-soft';
    host.classList.remove('fx-shake-soft', 'fx-shake-hard');
    // Force reflow so the animation restarts if a previous one is
    // still running (reapplying the same class is a no-op otherwise).
    void host.offsetWidth;
    host.classList.add(cls);
    setTimeout(() => host.classList.remove(cls),
               intensity === 'hard' ? 520 : 320);
  }

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
  loadImage(url) {
    // Skip redundant reload: same URL keeps current pan/zoom intact.
    if (this._currentImageUrl === url && this.mapImage) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.mapImage = img;
        this.mapWidth = img.naturalWidth;
        this.mapHeight = img.naturalHeight;
        this._currentImageUrl = url;
        this._fitToView();
        this.render();
        resolve();
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  setTokens(tokens) {
    // If the user is currently dragging a token, merge the incoming
    // server data instead of wholesale replacement.  Preserving the
    // dragged object's x/y stops the token from snapping back to its
    // old position on every WS refresh.
    if (this.dragToken && tokens && tokens.length) {
      const byId = new Map(tokens.map(t => [t.character_id, t]));
      this.tokens = this.tokens.map(oldT => {
        const incoming = byId.get(oldT.character_id);
        if (!incoming) return oldT;
        if (oldT === this.dragToken) {
          // Keep live drag coordinates; update everything else.
          return Object.assign({}, incoming, { x: oldT.x, y: oldT.y });
        }
        return { ...incoming };
      });
      // Append any brand-new tokens that weren't in the old array.
      const oldIds = new Set(this.tokens.map(t => t.character_id));
      for (const t of tokens) {
        if (!oldIds.has(t.character_id)) this.tokens.push({ ...t });
      }
    } else {
      this.tokens = tokens || [];
    }
    this.render();
  }

  // Phase 5: drop-in replacement of the wall/object list.
  setObjects(objects) {
    this.mapObjects = Array.isArray(objects) ? objects : [];
    this.render();
  }

  setTiles(tiles, gridType = 'square') {
    this.tiles = tiles || {};
    this.tileGridType = gridType;
    this.render();
  }

  setTraps(traps) {
    this.traps = traps || [];
    this.render();
  }

  // Phase 6: lazy cache of HTMLImageElement objects keyed by URL.
  // `setTokens` doesn't prefetch — the image is loaded the first time
  // we try to render that token, then re-render is triggered when the
  // load completes.
  _getTokenImage(url) {
    if (!url) return null;
    if (!this._tokenImgCache) this._tokenImgCache = new Map();
    const cached = this._tokenImgCache.get(url);
    if (cached) return cached;
    const img = new Image();
    img.onload = () => { this.render(); };
    img.onerror = () => {
      // Mark broken so we don't keep retrying on every frame.
      img._broken = true;
      this.render();
    };
    img.src = url;
    this._tokenImgCache.set(url, img);
    return img;
  }

  // ── Phase 2 helpers ────────────────────────────────────────
  // Can the current user drag this token? GM can drag anything; a
  // player may only drag the token whose character_id matches their
  // own. Future phases layer additional rules on top (e.g. combat-turn
  // gating in Phase 3, speed budget in Phase 4) — keep them here.
  _isTokenDraggable(token) {
    if (!token) return false;
    if (this.role === 'gm') return true;
    if (this.role === 'player' && this.ownCharacterId != null) {
      // Phase 3: combat-mode gating blocks drag when it isn't our turn.
      if (!this.canPlayerMove) return false;
      return token.character_id === this.ownCharacterId;
    }
    return false;
  }

  // Phase 3: toggled from player-app.js whenever combat state changes.
  // Setter rather than a raw assignment so we can also refresh the
  // cursor / visual hint without the caller having to remember to
  // re-render.
  setCanPlayerMove(can) {
    const next = !!can;
    if (this.canPlayerMove === next) return;
    this.canPlayerMove = next;
    this.render();
  }

  // Phase 4: feed the reachable-cell overlay with the authoritative
  // numbers from the server. Pass `(null, null)` to hide the overlay
  // (e.g. combat ended or not our turn).
  setMovementBudget(left, total) {
    const a = left == null ? null : Math.max(0, Number(left));
    const b = total == null ? null : Math.max(0, Number(total));
    if (this.movementLeftCells === a && this.movementTotalCells === b) return;
    this.movementLeftCells = a;
    this.movementTotalCells = b;
    this.render();
  }

  // ── Hex grid math (pointy-top, axial q/r) ──────────────────
  // Convention: hex_width = gridSize, so axial size s = gridSize / √3.
  // This gives cells the same perceived width as a square cell of
  // identical gridSize — the "Size" slider keeps meaning the same
  // thing when the GM flips the style toggle.
  _hexSize() { return this.gridSize / Math.sqrt(3); }

  _axialToPixel(q, r) {
    const gs = this.gridSize;
    return {
      x: gs * (q + r / 2),
      y: gs * (Math.sqrt(3) / 2) * r,
    };
  }

  _pixelToAxial(px, py) {
    const s = this._hexSize();
    const q = (Math.sqrt(3) / 3 * px - py / 3) / s;
    const r = (2 / 3 * py) / s;
    return { q, r };
  }

  // Cube-round a fractional axial pair to the nearest integer hex.
  _hexRound(q, r) {
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

  _hexDistance(a, b) {
    return (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;
  }

  // Snap a normalised (0..1) coordinate pair to the nearest cell centre.
  // Returns the same pair unchanged if snapping is disabled or impossible.
  _snapNorm(nx, ny) {
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

  setGrid(size, enabled, type) {
    this.gridSize = size;
    this.gridEnabled = enabled;
    if (type === 'hex' || type === 'square') this.gridType = type;
    this.render();
  }

  // Draw a single pointy-top hexagon outline centred on (cx, cy).
  _hexPath(ctx, cx, cy, size) {
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
  _renderHexGrid(ctx) {
    const size = this._hexSize();
    const w = this.mapWidth, h = this.mapHeight;
    // Axial bounds from the four map corners.
    const corners = [
      this._pixelToAxial(0, 0),
      this._pixelToAxial(w, 0),
      this._pixelToAxial(0, h),
      this._pixelToAxial(w, h),
    ];
    let qMin = Infinity, qMax = -Infinity, rMin = Infinity, rMax = -Infinity;
    for (const c of corners) {
      if (c.q < qMin) qMin = c.q;
      if (c.q > qMax) qMax = c.q;
      if (c.r < rMin) rMin = c.r;
      if (c.r > rMax) rMax = c.r;
    }
    qMin = Math.floor(qMin) - 1; qMax = Math.ceil(qMax) + 1;
    rMin = Math.floor(rMin) - 1; rMax = Math.ceil(rMax) + 1;
    // Clip hex strokes to the map rectangle so edge hexes don't spill
    // out over the canvas background.
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    for (let r = rMin; r <= rMax; r++) {
      for (let q = qMin; q <= qMax; q++) {
        const c = this._axialToPixel(q, r);
        this._hexPath(ctx, c.x, c.y, size);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // Reachable-cell overlay in hex mode. Centred on the player's token
  // in pixel space; draws a filled+stroked hex for every cell within
  // `reach` hex-distance of the containing hex (excluding own cell).
  _renderReachHex(ctx, px, py, reach) {
    const size = this._hexSize();
    const frac = this._pixelToAxial(px, py);
    const ownHex = this._hexRound(frac.q, frac.r);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.mapWidth, this.mapHeight);
    ctx.clip();
    for (let dq = -reach; dq <= reach; dq++) {
      const dr1 = Math.max(-reach, -dq - reach);
      const dr2 = Math.min(reach, -dq + reach);
      for (let dr = dr1; dr <= dr2; dr++) {
        if (dq === 0 && dr === 0) continue;
        const q = ownHex.q + dq, r = ownHex.r + dr;
        const c = this._axialToPixel(q, r);
        // Skip hexes whose centre is outside the map rect.
        if (c.x < 0 || c.y < 0 || c.x > this.mapWidth || c.y > this.mapHeight) continue;
        this._hexPath(ctx, c.x, c.y, size);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  setFog(enabled, revealedCells) {
    this.fogEnabled = enabled;
    this.revealedCells = new Set((revealedCells || []).map(c => `${c[0]},${c[1]}`));
    this.render();
  }

  setFogPaintMode(on) {
    this.fogPaintMode = on;
    if (on) this.drawMode = null;
    this.canvas.style.cursor = on ? 'crosshair' : 'default';
  }

  setDrawings(drawings) { this.drawings = drawings || []; this.render(); }
  setMarkers(markers) { this.markers = markers || []; this.render(); }

  setDrawMode(mode) {
    this.drawMode = mode;
    this.fogPaintMode = false;
    this._drawingPath = [];
    this._isDrawing = false;
    this._shapeStart = null;
    this._shapePreview = null;
    this._measureStart = null;
    this._measureEnd = null;
    const cursors = { freehand: 'crosshair', rectangle: 'crosshair', circle: 'crosshair', line: 'crosshair', arrow: 'crosshair', marker: 'cell', erase: 'pointer', measure: 'crosshair', 'obj-wall': 'crosshair' };
    this.canvas.style.cursor = cursors[mode] || 'default';
  }

  // ── Rendering ─────────────────────────────────────────────
  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    // Map image
    if (this.mapImage) {
      ctx.drawImage(this.mapImage, 0, 0, this.mapWidth, this.mapHeight);
    }

    // Map Builder: render tiles
    this._renderTiles(ctx);

    // Grid
    //
    // Many user-uploaded maps come with a square grid already baked
    // into the texture. At the old opacity (0.12) the canvas overlay
    // was invisible under that texture, which made the hex toggle
    // look like "squares still showing". Two fixes applied here:
    //   1) In hex mode, paint a faint dark wash over the image so the
    //      baked squares recede and the hex lines can dominate.
    //   2) Stroke the grid in TWO passes — a dark outline + a bright
    //      inner line — so it stays legible on any background, bright
    //      or dark, without squinting.
    if (this.gridEnabled && this.mapWidth > 0) {
      if (this.gridType === 'hex' && this.mapImage) {
        // Dim the baked-in texture just enough for the hex overlay
        // to read clearly. 18% black is invisible on dark maps and
        // softens busy light maps without killing detail.
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(0, 0, this.mapWidth, this.mapHeight);
        ctx.restore();
      }
      const gs = this.gridSize;
      const outerW = 2.5 / this.scale;
      const innerW = 1.2 / this.scale;
      const drawTwice = (drawFn) => {
        ctx.save();
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = outerW;
        drawFn();
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.lineWidth = innerW;
        drawFn();
        ctx.restore();
      };
      if (this.gridType === 'hex') {
        drawTwice(() => this._renderHexGrid(ctx));
      } else {
        drawTwice(() => {
          for (let x = 0; x <= this.mapWidth; x += gs) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.mapHeight); ctx.stroke();
          }
          for (let y = 0; y <= this.mapHeight; y += gs) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.mapWidth, y); ctx.stroke();
          }
        });
      }
    }

    // Drawings (Stage 9)
    for (const d of this.drawings) {
      if (!d.visible_to_players && this.role !== 'gm') continue;
      this._renderDrawing(ctx, d);
    }

    // Phase 5: map objects (walls / zones). Rendered below tokens and
    // markers so walkable highlights / selection rings sit on top.
    for (const o of this.mapObjects) {
      if (!o.visible_to_players && this.role !== 'gm') continue;
      this._renderMapObject(ctx, o);
    }

    // Markers (Stage 9)
    for (const m of this.markers) {
      if (!m.visible_to_players && this.role !== 'gm') continue;
      this._renderMarker(ctx, m);
    }

    // Shape preview
    if (this._shapePreview) {
      this._renderDrawing(ctx, this._shapePreview);
    }

    // Freehand preview
    if (this._drawingPath.length > 1) {
      ctx.beginPath();
      ctx.moveTo(this._drawingPath[0][0] * this._mw, this._drawingPath[0][1] * this._mh);
      for (let i = 1; i < this._drawingPath.length; i++) {
        ctx.lineTo(this._drawingPath[i][0] * this._mw, this._drawingPath[i][1] * this._mh);
      }
      ctx.strokeStyle = this.drawColor;
      ctx.lineWidth = this.drawLineWidth / this.scale;
      ctx.stroke();
    }

    // Measure preview
    if (this._measureStart && this._measureEnd) {
      const sx = this._measureStart[0] * this._mw, sy = this._measureStart[1] * this._mh;
      const ex = this._measureEnd[0] * this._mw, ey = this._measureEnd[1] * this._mh;
      ctx.beginPath();
      ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
      ctx.strokeStyle = '#00ff88';
      ctx.lineWidth = 2 / this.scale;
      ctx.setLineDash([6 / this.scale, 4 / this.scale]);
      ctx.stroke();
      ctx.setLineDash([]);
      // Distance label — metric matches the active grid style.
      let distCells;
      if (this.gridSize > 0) {
        if (this.gridType === 'hex') {
          const a = this._pixelToAxial(sx, sy);
          const b = this._pixelToAxial(ex, ey);
          distCells = this._hexDistance(a, b).toFixed(1);
        } else {
          const dx = Math.abs(ex - sx), dy = Math.abs(ey - sy);
          distCells = (Math.max(dx, dy) / this.gridSize).toFixed(1);
        }
      } else {
        distCells = '0';
      }
      const midX = (sx + ex) / 2, midY = (sy + ey) / 2;
      ctx.fillStyle = '#00ff88';
      ctx.font = `bold ${14 / this.scale}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`${distCells} cells`, midX, midY - 8 / this.scale);
    }

    // Fog of war
    if (this.fogEnabled && this.mapWidth > 0) {
      const gs = this.gridSize;
      const cols = Math.ceil(this.mapWidth / gs);
      const rows = Math.ceil(this.mapHeight / gs);
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const key = `${c},${r}`;
          if (!this.revealedCells.has(key)) {
            if (this.role === 'gm') {
              ctx.fillStyle = 'rgba(0,0,0,0.5)';
            } else {
              ctx.fillStyle = 'rgba(0,0,0,0.95)';
            }
            ctx.fillRect(c * gs, r * gs, gs, gs);
          }
        }
      }
    }

    // Phase 4: reachable-cell overlay for the player's own token.
    // Drawn BEFORE the tokens so it sits underneath them. Only active
    // when role=player, the player owns a specific token that's
    // visible on the canvas, and a non-null movement budget was
    // provided — which is equivalent to "it's our turn in combat".
    if (this.role === 'player'
        && this.ownCharacterId != null
        && this.movementLeftCells != null
        && this.movementLeftCells > 0
        && this.gridEnabled
        && this.gridSize > 0
        && this.mapWidth > 0) {
      const own = this.tokens.find(t => t.character_id === this.ownCharacterId);
      if (own && own.x != null && own.y != null) {
        const reach = Math.floor(this.movementLeftCells);
        ctx.save();
        ctx.fillStyle = 'rgba(255,215,96,0.12)';
        ctx.strokeStyle = 'rgba(255,215,96,0.45)';
        ctx.lineWidth = 1 / this.scale;
        if (this.gridType === 'hex') {
          this._renderReachHex(ctx, own.x * this.mapWidth, own.y * this.mapHeight, reach);
        } else {
          const gs = this.gridSize;
          const cx = Math.floor(own.x * this.mapWidth / gs);
          const cy = Math.floor(own.y * this.mapHeight / gs);
          for (let dx = -reach; dx <= reach; dx++) {
            for (let dy = -reach; dy <= reach; dy++) {
              if (dx === 0 && dy === 0) continue;
              const col = cx + dx, row = cy + dy;
              const px0 = col * gs, py0 = row * gs;
              if (px0 < 0 || py0 < 0 || px0 >= this.mapWidth || py0 >= this.mapHeight) continue;
              ctx.fillRect(px0, py0, gs, gs);
              ctx.strokeRect(px0 + 0.5 / this.scale, py0 + 0.5 / this.scale, gs - 1 / this.scale, gs - 1 / this.scale);
            }
          }
        }
        ctx.restore();
      }
    }

    // Tokens
    for (const t of this.tokens) {
      if (!t.visible && this.role !== 'gm') continue;
      if (t.x == null || t.y == null) continue;
      const px = t.x * this.mapWidth;
      const py = t.y * this.mapHeight;
      const radius = (this.gridSize / 2) * 0.8;

      // Phase 6: if a portrait image is available AND loaded, render
      // it clipped to the token circle. Otherwise fall back to the
      // old coloured disc + initials path below.
      const portrait = this._getTokenImage(t.token_image_url);
      const hasPortrait = portrait && portrait.complete && portrait.naturalWidth > 0 && !portrait._broken;

      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.globalAlpha = t.is_alive ? 1 : 0.4;
      if (hasPortrait) {
        ctx.save();
        ctx.clip();
        // Cover-fit: aspect-preserving, centred, fills the circle.
        const iw = portrait.naturalWidth, ih = portrait.naturalHeight;
        const side = radius * 2;
        const scale = Math.max(side / iw, side / ih);
        const dw = iw * scale, dh = ih * scale;
        ctx.drawImage(portrait, px - dw / 2, py - dh / 2, dw, dh);
        ctx.restore();
      } else {
        ctx.fillStyle = t.color || '#c08a2a';
        ctx.fill();
      }

      // Border
      ctx.strokeStyle = t.is_npc ? 'rgba(138,74,191,0.8)' : 'rgba(255,255,255,0.6)';
      ctx.lineWidth = t.is_npc ? 2 / this.scale : 1.5 / this.scale;
      if (t.is_npc) ctx.setLineDash([3 / this.scale, 3 / this.scale]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Phase 3: visual "my turn / locked" indicator on the player's
      // own token. Gold ring when they CAN move, muted grey-dashed
      // ring when they can't. GM and other players don't see either.
      if (this.role === 'player' && this.ownCharacterId != null
          && t.character_id === this.ownCharacterId) {
        ctx.beginPath();
        ctx.arc(px, py, radius + 4 / this.scale, 0, Math.PI * 2);
        if (this.canPlayerMove) {
          ctx.strokeStyle = 'rgba(255,215,96,0.9)';  // gold
          ctx.lineWidth = 2.5 / this.scale;
          ctx.setLineDash([]);
        } else {
          ctx.strokeStyle = 'rgba(180,180,180,0.7)'; // muted
          ctx.lineWidth = 1.5 / this.scale;
          ctx.setLineDash([4 / this.scale, 4 / this.scale]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Initials — only shown when there's no portrait to occupy the
      // disc. Skipping them when a face is rendered prevents an ugly
      // "AB" overlay on top of a real image.
      if (!hasPortrait) {
        const initials = t.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.max(10, radius * 0.8)}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(initials, px, py);
      }

      // HP bar under token
      if (t.max_hp > 0) {
        const barW = radius * 2;
        const barH = 3 / this.scale;
        const barX = px - radius;
        const barY = py + radius + 2 / this.scale;
        const pct = t.current_hp / t.max_hp;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = pct > 0.5 ? '#4a9c5d' : pct > 0.25 ? '#c09a2a' : '#b84040';
        ctx.fillRect(barX, barY, barW * pct, barH);
      }

      ctx.globalAlpha = 1;
    }

    // Combat FX — drawn last so they sit above every token and HP
    // bar. The loop in `_startFxLoop` keeps calling render() while
    // any effect is alive, giving us a smooth ~60fps animation
    // without the rest of the scene having to be rebuilt by hand.
    this._renderFx(ctx);

    ctx.restore();
  }

  get _mw() { return this.mapWidth || this.canvas.width; }
  get _mh() { return this.mapHeight || this.canvas.height; }

  // ── Coordinate conversion ─────────────────────────────────
  _screenToMap(sx, sy) {
    return {
      x: (sx - this.offsetX) / this.scale,
      y: (sy - this.offsetY) / this.scale,
    };
  }

  _mapToNormalized(mx, my) {
    const w = this.mapWidth || this.canvas.width;
    const h = this.mapHeight || this.canvas.height;
    return {
      x: w > 0 ? mx / w : 0,
      y: h > 0 ? my / h : 0,
    };
  }

  _screenToGrid(sx, sy) {
    const m = this._screenToMap(sx, sy);
    return { col: Math.floor(m.x / this.gridSize), row: Math.floor(m.y / this.gridSize) };
  }

  _fitToView() {
    if (!this.mapWidth) return;
    const scaleX = this.canvas.width / this.mapWidth;
    const scaleY = this.canvas.height / this.mapHeight;
    this.scale = Math.min(scaleX, scaleY) * 0.95;
    this.offsetX = (this.canvas.width - this.mapWidth * this.scale) / 2;
    this.offsetY = (this.canvas.height - this.mapHeight * this.scale) / 2;
  }

  centerView() { this._fitToView(); this.render(); }

  // ── Hit test token ────────────────────────────────────────
  _hitToken(mx, my) {
    const radius = (this.gridSize / 2) * 0.8;
    for (let i = this.tokens.length - 1; i >= 0; i--) {
      const t = this.tokens[i];
      if (t.x == null || t.y == null) continue;
      const px = t.x * this.mapWidth;
      const py = t.y * this.mapHeight;
      const dx = mx - px, dy = my - py;
      if (dx * dx + dy * dy <= radius * radius) return t;
    }
    return null;
  }

  // ── Events ────────────────────────────────────────────────
  _bindEvents() {
    const c = this.canvas;

    c.addEventListener('mousedown', e => {
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const m = this._screenToMap(sx, sy);
      const n = this._mapToNormalized(m.x, m.y);

      // Drawing modes (Stage 9)
      if (this.drawMode && this.role === 'gm') {
        e.preventDefault();
        if (this.drawMode === 'freehand') {
          this._drawingPath = [[n.x, n.y]];
          this._isDrawing = true;
          return;
        } else if (['rectangle', 'circle', 'line', 'arrow', 'obj-wall'].includes(this.drawMode)) {
          this._shapeStart = [n.x, n.y];
          return;
        } else if (this.drawMode === 'marker') {
          if (this.onMarkerCreate) this.onMarkerCreate(n.x, n.y);
          return;
        } else if (this.drawMode === 'erase') {
          const marker = this._hitMarker(m.x, m.y);
          if (marker) { if (this.onEraseMarker) this.onEraseMarker(marker); return; }
          const drawing = this._hitDrawing(m.x, m.y);
          if (drawing) { if (this.onEraseDrawing) this.onEraseDrawing(drawing); return; }
          return;
        } else if (this.drawMode === 'measure') {
          this._measureStart = [n.x, n.y];
          this._measureEnd = null;
          return;
        }
      }

      // Fog paint mode (GM only)
      if (this.fogPaintMode && this.role === 'gm') {
        const g = this._screenToGrid(sx, sy);
        if (this.onFogReveal) this.onFogReveal(g.col, g.row);
        const key = `${g.col},${g.row}`;
        this.revealedCells.add(key);
        this.render();
        return;
      }

      // Token drag — Rework v3 Phase 2: GM can drag anybody; player can
      // drag only their own token. `_isTokenDraggable` centralises the
      // rule so future phases (combat-turn gating, speed limits) extend
      // it in one place.
      if (!this.drawMode) {
        const token = this._hitToken(m.x, m.y);
        if (token && this._isTokenDraggable(token)) {
          this.dragToken = token;
          this.isDragging = false;
          this.dragStart = { x: sx, y: sy };
          // Phase 2: remember where the drag started so mouseup can
          // suppress the PATCH if the user didn't actually move.
          this._dragStartPos = { x: token.x, y: token.y };
          return;
        }
      }

      // Pan
      this.isDragging = true;
      this.dragStart = { x: sx - this.offsetX, y: sy - this.offsetY };
    });

    c.addEventListener('mousemove', e => {
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      this.lastMouse = { x: sx, y: sy };
      const m = this._screenToMap(sx, sy);
      const n = this._mapToNormalized(m.x, m.y);

      // Drawing modes
      if (this.drawMode === 'freehand' && this._isDrawing && this._drawingPath.length > 0) {
        this._drawingPath.push([n.x, n.y]);
        this.render();
        return;
      }
      if (['rectangle', 'circle', 'line', 'arrow', 'obj-wall'].includes(this.drawMode) && this._shapeStart) {
        // Phase 5: walls share the preview buffer with the normal
        // rectangle drawing; the hatched look comes from actually
        // committing an object in onObjectSaved, but the live preview
        // is a plain outlined rect so the GM sees the footprint.
        this._shapePreview = {
          drawing_type: this.drawMode === 'obj-wall' ? 'rectangle' : this.drawMode,
          points: [this._shapeStart, [n.x, n.y]],
          color: this.drawMode === 'obj-wall' ? '#8a4abf' : this.drawColor,
          line_width: this.drawLineWidth,
          fill_opacity: this.drawMode === 'obj-wall' ? 0.45 : this.drawFillOpacity,
        };
        this.render();
        return;
      }
      if (this.drawMode === 'measure' && this._measureStart) {
        this._measureEnd = [n.x, n.y];
        this.render();
        return;
      }

      if (this.dragToken) {
        this.dragToken.x = Math.max(0, Math.min(1, n.x));
        this.dragToken.y = Math.max(0, Math.min(1, n.y));
        this.render();
        return;
      }
      if (this.isDragging) {
        this.offsetX = sx - this.dragStart.x;
        this.offsetY = sy - this.dragStart.y;
        this.render();
      }
    });

    c.addEventListener('mouseup', e => {
      // Finish freehand
      if (this.drawMode === 'freehand' && this._isDrawing) {
        this._isDrawing = false;
        if (this._drawingPath.length > 1 && this.onDrawingSaved) {
          this.onDrawingSaved({
            drawing_type: 'freehand', points: this._drawingPath,
            color: this.drawColor, line_width: this.drawLineWidth,
            fill_opacity: this.drawFillOpacity, visible_to_players: this.drawVisibleToPlayers,
          });
        }
        this._drawingPath = [];
        this.render();
        return;
      }
      // Finish shape
      if (['rectangle', 'circle', 'line', 'arrow', 'obj-wall'].includes(this.drawMode) && this._shapeStart) {
        const rect2 = c.getBoundingClientRect();
        const sx2 = e.clientX - rect2.left, sy2 = e.clientY - rect2.top;
        const m2 = this._screenToMap(sx2, sy2);
        const n2 = this._mapToNormalized(m2.x, m2.y);
        if (this.drawMode === 'obj-wall') {
          // Phase 5: emit a normalised AABB (callers normalise-and-swap
          // inverted rects on the server anyway, but doing it here too
          // keeps the signature tidy).
          const x1 = Math.min(this._shapeStart[0], n2.x);
          const y1 = Math.min(this._shapeStart[1], n2.y);
          const x2 = Math.max(this._shapeStart[0], n2.x);
          const y2 = Math.max(this._shapeStart[1], n2.y);
          if (this.onObjectSaved && (x2 - x1) > 1e-4 && (y2 - y1) > 1e-4) {
            this.onObjectSaved({ x1, y1, x2, y2, kind: 'wall' });
          }
        } else if (this.onDrawingSaved) {
          this.onDrawingSaved({
            drawing_type: this.drawMode, points: [this._shapeStart, [n2.x, n2.y]],
            color: this.drawColor, line_width: this.drawLineWidth,
            fill_opacity: this.drawFillOpacity, visible_to_players: this.drawVisibleToPlayers,
          });
        }
        this._shapeStart = null;
        this._shapePreview = null;
        return;
      }
      // Finish measure
      if (this.drawMode === 'measure') {
        this._measureStart = null;
        this._measureEnd = null;
        this.render();
        return;
      }

      if (this.dragToken) {
        // Rework v3 Phase 2: snap the live drag position to the nearest
        // grid-cell centre before committing. We also compare against
        // `_dragStartPos` (captured on mousedown) and suppress the
        // callback for a pure click-with-no-movement — otherwise every
        // tap on the own token would PATCH the server with unchanged
        // coordinates and round-trip a WS echo for nothing.
        const snapped = this._snapNorm(this.dragToken.x, this.dragToken.y);
        this.dragToken.x = snapped.x;
        this.dragToken.y = snapped.y;
        const moved = !this._dragStartPos
          || Math.abs(this._dragStartPos.x - snapped.x) > 1e-4
          || Math.abs(this._dragStartPos.y - snapped.y) > 1e-4;
        if (moved && this.onTokenMove) {
          this.onTokenMove(this.dragToken.character_id, snapped.x, snapped.y);
        }
        this.render();
        this.dragToken = null;
        this._dragStartPos = null;
      }
      this.isDragging = false;
    });

    c.addEventListener('mouseleave', () => {
      if (this.dragToken) {
        const snapped = this._snapNorm(this.dragToken.x, this.dragToken.y);
        this.dragToken.x = snapped.x;
        this.dragToken.y = snapped.y;
        const moved = !this._dragStartPos
          || Math.abs(this._dragStartPos.x - snapped.x) > 1e-4
          || Math.abs(this._dragStartPos.y - snapped.y) > 1e-4;
        if (moved && this.onTokenMove) {
          this.onTokenMove(this.dragToken.character_id, snapped.x, snapped.y);
        }
        this.render();
        this.dragToken = null;
        this._dragStartPos = null;
      }
      this.isDragging = false;
      this._isDrawing = false;
      this._drawingPath = [];
      this._shapeStart = null;
      this._shapePreview = null;
    });

    // Zoom
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const zoom = e.deltaY < 0 ? 1.1 : 0.9;
      const newScale = Math.max(0.1, Math.min(10, this.scale * zoom));
      this.offsetX = mx - (mx - this.offsetX) * (newScale / this.scale);
      this.offsetY = my - (my - this.offsetY) * (newScale / this.scale);
      this.scale = newScale;
      this.render();
    }, { passive: false });

    // Touch support
    let lastTouchDist = 0;
    c.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDist = Math.sqrt(dx * dx + dy * dy);
      } else if (e.touches.length === 1) {
        const rect = c.getBoundingClientRect();
        const sx = e.touches[0].clientX - rect.left;
        const sy = e.touches[0].clientY - rect.top;
        this.isDragging = true;
        this.dragStart = { x: sx - this.offsetX, y: sy - this.offsetY };
      }
    }, { passive: true });

    c.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (lastTouchDist > 0) {
          const zoom = dist / lastTouchDist;
          this.scale = Math.max(0.1, Math.min(10, this.scale * zoom));
          this.render();
        }
        lastTouchDist = dist;
      } else if (e.touches.length === 1 && this.isDragging) {
        const rect = c.getBoundingClientRect();
        const sx = e.touches[0].clientX - rect.left;
        const sy = e.touches[0].clientY - rect.top;
        this.offsetX = sx - this.dragStart.x;
        this.offsetY = sy - this.dragStart.y;
        this.render();
      }
    }, { passive: false });

    c.addEventListener('touchend', () => {
      this.isDragging = false;
      lastTouchDist = 0;
    });

    // Click for token/marker info
    c.addEventListener('click', e => {
      if (this.fogPaintMode || this.drawMode) return;
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const m = this._screenToMap(sx, sy);
      // Check marker click
      const marker = this._hitMarker(m.x, m.y);
      if (marker && this.onMarkerClick) { this.onMarkerClick(marker); return; }
      const token = this._hitToken(m.x, m.y);
      if (token && this.onTokenClick) this.onTokenClick(token);
    });

    // Right-click for token context menu (GM only)
    c.addEventListener('contextmenu', e => {
      if (this.role !== 'gm') return;
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const m = this._screenToMap(sx, sy);
      const token = this._hitToken(m.x, m.y);
      if (token && this.onTokenRightClick) {
        this.onTokenRightClick(token, e.clientX, e.clientY);
      }
    });

    // Resize
    window.addEventListener('resize', () => this._resize());
  }

  // ── Map Builder tile rendering ─────────────────────────────
  _renderTiles(ctx) {
    if (!this.tiles || !Object.keys(this.tiles).length) return;
    const colors = {
      floor: 'rgba(90,90,90,0.55)',
      wall:  'rgba(160,160,160,0.85)',
      door:  'rgba(160,82,45,0.75)',
      water: 'rgba(30,80,130,0.70)',
      pit:   'rgba(30,30,30,0.85)',
      stairs_up:   'rgba(200,160,20,0.70)',
      stairs_down: 'rgba(220,150,60,0.70)',
      trap:  'rgba(180,0,0,0.75)',
    };
    const icons = { door:'🚪', water:'💧', pit:'🕳', stairs_up:'⬆', stairs_down:'⬇', trap:'⚠' };
    const gs = this.gridSize;
    const mw = this.mapWidth || this.canvas.width;
    const mh = this.mapHeight || this.canvas.height;

    if (this.tileGridType === 'hex') {
      const size = gs / Math.sqrt(3);
      const _axialToPixel = (q, r) => ({ x: gs * (q + r / 2), y: gs * (Math.sqrt(3) / 2 * r) });
      const _hexPath = (cx, cy, sz) => {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = -Math.PI / 2 + i * Math.PI / 3;
          ctx.lineTo(cx + sz * Math.cos(a), cy + sz * Math.sin(a));
        }
        ctx.closePath();
      };
      // Tiles
      for (const [key, type] of Object.entries(this.tiles)) {
        const [q, r] = key.split(',').map(Number);
        const c = _axialToPixel(q, r);
        if (c.x < -gs || c.y < -gs || c.x > mw + gs || c.y > mh + gs) continue;
        ctx.fillStyle = colors[type] || colors.floor;
        _hexPath(c.x, c.y, size - 1);
        ctx.fill();
        if (icons[type]) {
          ctx.font = `${gs * 0.4}px sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(icons[type], c.x, c.y);
        }
      }
      // Traps in hex
      for (const t of (this.traps || [])) {
        const c = _axialToPixel(t.col, t.row);
        if (c.x < -gs || c.y < -gs || c.x > mw + gs || c.y > mh + gs) continue;
        if (this.role !== 'gm' && t.is_hidden) continue;
        ctx.fillStyle = 'rgba(255,69,0,0.6)';
        _hexPath(c.x, c.y, size - 2);
        ctx.fill();
        ctx.font = `${gs * 0.4}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(t.is_triggered ? '💥' : t.is_disarmed ? '🔒' : '⚠', c.x, c.y);
      }
    } else {
      // Square grid
      for (const [key, type] of Object.entries(this.tiles)) {
        const [col, row] = key.split(',').map(Number);
        const px = col * gs, py = row * gs;
        if (px < 0 || py < 0 || px >= mw || py >= mh) continue;
        ctx.fillStyle = colors[type] || colors.floor;
        ctx.fillRect(px + 0.5, py + 0.5, gs - 1, gs - 1);
        if (icons[type]) {
          ctx.font = `${gs * 0.55}px sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(icons[type], px + gs / 2, py + gs / 2);
        }
      }
      // Traps (square)
      for (const t of (this.traps || [])) {
        const px = t.col * gs, py = t.row * gs;
        if (px < 0 || py < 0 || px >= mw || py >= mh) continue;
        if (this.role !== 'gm' && t.is_hidden) continue;
        ctx.fillStyle = 'rgba(255,69,0,0.6)';
        ctx.fillRect(px + 1, py + 1, gs - 2, gs - 2);
        ctx.font = `${gs * 0.5}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(t.is_triggered ? '💥' : t.is_disarmed ? '🔒' : '⚠', px + gs / 2, py + gs / 2);
      }
    }
  }

  // ── Render a saved/preview drawing ──────────────────────────
  _renderDrawing(ctx, d) {
    const pts = d.points || [];
    if (!pts.length) return;
    const mw = this._mw, mh = this._mh;
    ctx.save();
    ctx.strokeStyle = d.color || '#ff0000';
    ctx.lineWidth = (d.line_width || 2) / this.scale;
    ctx.globalAlpha = 1;

    if (d.drawing_type === 'freehand' && pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0] * mw, pts[0][1] * mh);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * mw, pts[i][1] * mh);
      ctx.stroke();
    } else if (d.drawing_type === 'rectangle' && pts.length >= 2) {
      const x1 = pts[0][0] * mw, y1 = pts[0][1] * mh;
      const x2 = pts[1][0] * mw, y2 = pts[1][1] * mh;
      ctx.beginPath();
      ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      ctx.globalAlpha = d.fill_opacity || 0.2;
      ctx.fillStyle = d.color || '#ff0000';
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
    } else if (d.drawing_type === 'circle' && pts.length >= 2) {
      const cx = pts[0][0] * mw, cy = pts[0][1] * mh;
      const ex = pts[1][0] * mw, ey = pts[1][1] * mh;
      const r = Math.sqrt((ex - cx) ** 2 + (ey - cy) ** 2);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.globalAlpha = d.fill_opacity || 0.2;
      ctx.fillStyle = d.color || '#ff0000';
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.stroke();
    } else if ((d.drawing_type === 'line' || d.drawing_type === 'arrow') && pts.length >= 2) {
      const x1 = pts[0][0] * mw, y1 = pts[0][1] * mh;
      const x2 = pts[1][0] * mw, y2 = pts[1][1] * mh;
      ctx.beginPath();
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.stroke();
      if (d.drawing_type === 'arrow') {
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const hl = 12 / this.scale;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - hl * Math.cos(angle - 0.4), y2 - hl * Math.sin(angle - 0.4));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - hl * Math.cos(angle + 0.4), y2 - hl * Math.sin(angle + 0.4));
        ctx.stroke();
      }
    }

    // Label
    if (d.label && pts.length >= 1) {
      const lx = pts[0][0] * mw, ly = pts[0][1] * mh - 6 / this.scale;
      ctx.fillStyle = d.color || '#ff0000';
      ctx.font = `${11 / this.scale}px Inter, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(d.label, lx, ly);
    }
    ctx.restore();
  }

  // ── Render a map object (Phase 5) ─────────────────────────────
  // Axis-aligned rectangle in normalised coords. Walls render as a
  // translucent solid fill plus a hatching stroke so they read as
  // "dense" even at small sizes; non-wall "zone" objects are just a
  // soft tint.
  _renderMapObject(ctx, o) {
    const mw = this._mw, mh = this._mh;
    const x = o.x1 * mw;
    const y = o.y1 * mh;
    const w = (o.x2 - o.x1) * mw;
    const h = (o.y2 - o.y1) * mh;
    if (w <= 0 || h <= 0) return;
    ctx.save();
    const color = o.color || '#8a4abf';
    // Fill.
    ctx.globalAlpha = o.kind === 'wall' ? 0.6 : 0.28;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    // Border.
    ctx.globalAlpha = 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 / this.scale;
    ctx.strokeRect(x, y, w, h);
    // Hatch pattern for walls.
    if (o.kind === 'wall') {
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1 / this.scale;
      const step = Math.max(8, this.gridSize / 3);
      ctx.beginPath();
      for (let d = -h; d < w; d += step) {
        ctx.moveTo(x + d,       y);
        ctx.lineTo(x + d + h,   y + h);
      }
      ctx.stroke();
    }
    // Optional label for the GM — small corner tag.
    if (this.role === 'gm' && o.name && o.name !== 'Wall') {
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${10 / this.scale}px Inter, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(o.name, x + 3 / this.scale, y + 3 / this.scale);
    }
    ctx.restore();
  }

  // ── Render a marker ───────────────────────────────────────────
  _renderMarker(ctx, m) {
    const px = m.x * this._mw, py = m.y * this._mh;
    const size = 20 / this.scale;
    ctx.save();
    // GM sees hidden markers as semi-transparent
    if (!m.visible_to_players && this.role === 'gm') ctx.globalAlpha = 0.5;
    ctx.font = `${size}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(m.icon || '📌', px, py);
    if (m.label) {
      ctx.fillStyle = m.color || '#ff0000';
      ctx.font = `bold ${10 / this.scale}px Inter, sans-serif`;
      ctx.fillText(m.label, px, py + size * 0.7);
    }
    ctx.restore();
  }

  // ── Hit test marker ─────────────────────────────────────────
  _hitMarker(mx, my) {
    const hitR = 15 / this.scale;
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      const px = m.x * this._mw, py = m.y * this._mh;
      if (Math.abs(mx - px) < hitR && Math.abs(my - py) < hitR) return m;
    }
    return null;
  }

  // ── Hit test drawing ────────────────────────────────────────
  _hitDrawing(mx, my) {
    const hitR = 10 / this.scale;
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      const pts = d.points || [];
      for (const p of pts) {
        const px = p[0] * this._mw, py = p[1] * this._mh;
        if (Math.abs(mx - px) < hitR && Math.abs(my - py) < hitR) return d;
      }
    }
    return null;
  }

  _resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    this.canvas.width = parent.clientWidth;
    this.canvas.height = parent.clientHeight;
    if (this.scale === 0) this._fitToView();
    this.render();
  }
}
