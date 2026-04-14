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
    this.onTokenMove = options.onTokenMove || null; // callback(charId, x, y)
    this.onFogReveal = options.onFogReveal || null; // callback(col, row)
    this.onDrawingSaved = options.onDrawingSaved || null; // callback(drawingData)
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
    this.fogEnabled = false;
    this.revealedCells = new Set();

    // Overlays (Stage 9)
    this.drawings = [];
    this.markers = [];

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

    this._bindEvents();
    this._resize();
  }

  // ── Load map image ──────────────────────────────────────────
  loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.mapImage = img;
        this.mapWidth = img.naturalWidth;
        this.mapHeight = img.naturalHeight;
        this._fitToView();
        this.render();
        resolve();
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  setTokens(tokens) {
    this.tokens = tokens;
    this.render();
  }

  setGrid(size, enabled) {
    this.gridSize = size;
    this.gridEnabled = enabled;
    this.render();
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
    const cursors = { freehand: 'crosshair', rectangle: 'crosshair', circle: 'crosshair', line: 'crosshair', arrow: 'crosshair', marker: 'cell', erase: 'pointer', measure: 'crosshair' };
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

    // Grid
    if (this.gridEnabled && this.mapWidth > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 0.5 / this.scale;
      const gs = this.gridSize;
      for (let x = 0; x <= this.mapWidth; x += gs) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.mapHeight); ctx.stroke();
      }
      for (let y = 0; y <= this.mapHeight; y += gs) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.mapWidth, y); ctx.stroke();
      }
    }

    // Drawings (Stage 9)
    for (const d of this.drawings) {
      if (!d.visible_to_players && this.role !== 'gm') continue;
      this._renderDrawing(ctx, d);
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
      // Distance label
      const dx = ex - sx, dy = ey - sy;
      const distPx = Math.sqrt(dx * dx + dy * dy);
      const distCells = (this.gridSize > 0) ? (distPx / this.gridSize).toFixed(1) : distPx.toFixed(0);
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

    // Tokens
    for (const t of this.tokens) {
      if (!t.visible && this.role !== 'gm') continue;
      if (t.x == null || t.y == null) continue;
      const px = t.x * this.mapWidth;
      const py = t.y * this.mapHeight;
      const radius = (this.gridSize / 2) * 0.8;

      // Circle
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fillStyle = t.color || '#c08a2a';
      ctx.globalAlpha = t.is_alive ? 1 : 0.4;
      ctx.fill();

      // Border
      ctx.strokeStyle = t.is_npc ? 'rgba(138,74,191,0.8)' : 'rgba(255,255,255,0.6)';
      ctx.lineWidth = t.is_npc ? 2 / this.scale : 1.5 / this.scale;
      if (t.is_npc) ctx.setLineDash([3 / this.scale, 3 / this.scale]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Initials
      const initials = t.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.max(10, radius * 0.8)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initials, px, py);

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
        } else if (['rectangle', 'circle', 'line', 'arrow'].includes(this.drawMode)) {
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

      // Token drag (GM only)
      if (this.role === 'gm' && !this.drawMode) {
        const token = this._hitToken(m.x, m.y);
        if (token) {
          this.dragToken = token;
          this.isDragging = false;
          this.dragStart = { x: sx, y: sy };
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
      if (['rectangle', 'circle', 'line', 'arrow'].includes(this.drawMode) && this._shapeStart) {
        this._shapePreview = {
          drawing_type: this.drawMode,
          points: [this._shapeStart, [n.x, n.y]],
          color: this.drawColor,
          line_width: this.drawLineWidth,
          fill_opacity: this.drawFillOpacity,
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
      if (['rectangle', 'circle', 'line', 'arrow'].includes(this.drawMode) && this._shapeStart) {
        const rect2 = c.getBoundingClientRect();
        const sx2 = e.clientX - rect2.left, sy2 = e.clientY - rect2.top;
        const m2 = this._screenToMap(sx2, sy2);
        const n2 = this._mapToNormalized(m2.x, m2.y);
        if (this.onDrawingSaved) {
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
        if (this.onTokenMove) {
          this.onTokenMove(this.dragToken.character_id, this.dragToken.x, this.dragToken.y);
        }
        this.dragToken = null;
      }
      this.isDragging = false;
    });

    c.addEventListener('mouseleave', () => {
      if (this.dragToken) {
        if (this.onTokenMove) this.onTokenMove(this.dragToken.character_id, this.dragToken.x, this.dragToken.y);
        this.dragToken = null;
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
    this.render();
  }
}
