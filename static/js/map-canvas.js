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

    // State
    this.mapImage = null;
    this.mapWidth = 0;
    this.mapHeight = 0;
    this.tokens = [];
    this.gridSize = 50;
    this.gridEnabled = true;
    this.fogEnabled = false;
    this.revealedCells = new Set();

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
    this.canvas.style.cursor = on ? 'crosshair' : 'default';
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

  // ── Coordinate conversion ─────────────────────────────────
  _screenToMap(sx, sy) {
    return {
      x: (sx - this.offsetX) / this.scale,
      y: (sy - this.offsetY) / this.scale,
    };
  }

  _mapToNormalized(mx, my) {
    return {
      x: this.mapWidth > 0 ? mx / this.mapWidth : 0,
      y: this.mapHeight > 0 ? my / this.mapHeight : 0,
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
      if (this.role === 'gm') {
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

      if (this.dragToken) {
        const m = this._screenToMap(sx, sy);
        const n = this._mapToNormalized(m.x, m.y);
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

    // Click for token info
    c.addEventListener('click', e => {
      if (this.fogPaintMode) return;
      const rect = c.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const m = this._screenToMap(sx, sy);
      const token = this._hitToken(m.x, m.y);
      if (token && this.onTokenClick) this.onTokenClick(token);
    });

    // Resize
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    this.canvas.width = parent.clientWidth;
    this.canvas.height = parent.clientHeight;
    this.render();
  }
}
