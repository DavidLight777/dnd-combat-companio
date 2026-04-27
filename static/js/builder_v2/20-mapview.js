// ════════════════════════════════════════════════════════════
// Map Builder v2 — unified MapView class.
//
// One class drives 3 visual modes: 'edit' (the builder), 'gm-runtime'
// (GM watching live play), 'player' (player with FOV — implemented in
// Phase 3). Phase 1 only renders 'edit'; the other modes are stubs that
// fall back to plain rendering.
// ════════════════════════════════════════════════════════════

(function () {
  // Visual config per tile_type. Keep colour / icon / outline in one
  // table so adding a new tile is a one-line change.
  const TILE_VISUAL = {
    floor: { color: 'rgba(60,60,65,0.45)' },
    wall:  { color: 'rgba(150,150,150,0.92)', hatch: true, outline: 'rgba(0,0,0,0.6)' },
    water: { color: 'rgba(40,90,150,0.75)' },
    lava:  { color: 'rgba(200,60,20,0.80)', glow: 'rgba(255,140,40,0.4)' },
    pit:   { color: 'rgba(15,15,15,0.92)' },
    door:  { color: 'rgba(140,80,40,0.78)', icon: '🚪' },
    rough: { color: 'rgba(110,80,50,0.55)' },
  };

  // MUST mirror server-side TILE_DEFAULTS in app/routers/builder_v2/common.py.
  // Only used as a fallback when the client paints a tile before the server
  // round-trips — once the server broadcast arrives, the real per-tile flags
  // from ser_tile() take over. Keep these two tables in sync on every change.
  const TILE_BLOCKS = {
    floor:  { blocks_movement: false, blocks_vision: false },
    wall:   { blocks_movement: true,  blocks_vision: true  },
    water:  { blocks_movement: true,  blocks_vision: false },
    lava:   { blocks_movement: true,  blocks_vision: false },
    pit:    { blocks_movement: true,  blocks_vision: true  },
    door:   { blocks_movement: false, blocks_vision: false },
    rough:  { blocks_movement: false, blocks_vision: false },
  };

  const ENTITY_VISUAL = {
    chest:       { icon: '🗃', color: '#d4a017' },
    trap:        { icon: '⚠', color: '#e74c3c' },
    portal:      { icon: '🌀', color: '#9b59b6' },
    npc_spawn:   { icon: '⊛', color: '#3498db' },
    cover_zone:  { icon: '⛑', color: '#2ecc71' },
    light_marker:{ icon: '💡', color: '#f1c40f' },
  };

  class MapView {
    constructor(canvasEl, opts = {}) {
      this.canvas = canvasEl;
      this.ctx = canvasEl.getContext('2d');
      this.mode = opts.mode || 'edit';

      // Location data
      this.location = null;             // server payload
      this.tiles = new Map();           // "col,row" -> tile object from ser_tile
      this.entities = [];               // Phase 2
      this.lights = [];                 // Phase 4

      // FOV state (Phase 3)
      this.visibleSet = null;           // Set<"col,row"> — currently visible
      this.exploredSet = null;          // Set<"col,row"> — ever explored

      // Camera
      this.scale = 1;
      this.offsetX = 0;
      this.offsetY = 0;

      // Interaction
      this._isPainting = false;
      this._isDragging = false;
      this._dragStart = { x: 0, y: 0 };
      this._lastPaintedKey = null;
      this._hoveredEntity = null;

      // Callbacks
      this.onPaint = opts.onPaint || null;       // (col,row,brush) => void
      this.onErase = opts.onErase || null;       // (col,row) => void
      this.getBrush = opts.getBrush || (() => 'floor');
      this.onEntityClick = opts.onEntityClick || null;  // (entity) => void
      this.onCellClick = opts.onCellClick || null;      // (col,row) => void  (for entity placement)

      this._bindEvents();
      this._fitToViewQueued = true;
      this.resize();
    }

    // ── Public API ────────────────────────────────────────────
    setMode(mode) {
      this.mode = mode;
      this.render();
    }

    setFOV(visibleSet, exploredSet) {
      this.visibleSet = visibleSet;
      this.exploredSet = exploredSet;
      this.render();
    }

    clearFOV() {
      this.visibleSet = null;
      this.exploredSet = null;
      this.render();
    }

    loadLocation(payload) {
      this.location = payload.location || payload;
      this.tiles = new Map();
      for (const t of (payload.tiles || [])) {
        // Store full server tile object so FOV (and future cost-map) can
        // read blocks_vision / blocks_movement straight from the backend
        // truth rather than duplicating the rules on the client.
        this.tiles.set(`${t.col},${t.row}`, t);
      }
      this.entities = payload.entities || [];
      this.lights = payload.lights || [];
      this._fitToViewQueued = true;
      this.render();
    }

    clearTiles() {
      this.tiles.clear();
      this.render();
    }

    setTile(col, row, tile_type) {
      // Build a stub tile object matching ser_tile() shape so FOV and
      // draw code have a single read path. The server broadcast will
      // replace this stub with the authoritative object.
      const blocks = TILE_BLOCKS[tile_type] || TILE_BLOCKS.floor;
      this.tiles.set(`${col},${row}`, {
        col, row, tile_type,
        blocks_movement: blocks.blocks_movement,
        blocks_vision:   blocks.blocks_vision,
      });
      this.render();
    }

    eraseTile(col, row) {
      this.tiles.delete(`${col},${row}`);
      this.render();
    }

    resize() {
      const p = this.canvas.parentElement;
      if (!p) return;
      this.canvas.width = p.clientWidth;
      this.canvas.height = p.clientHeight;
      if (this._fitToViewQueued) {
        this._fitToView();
        this._fitToViewQueued = false;
      }
      this.render();
    }

    // ── Coordinate conversion ─────────────────────────────────
    _gridSize() { return this.location?.tile_size ?? 50; }
    _cols()     { return this.location?.cols ?? 40; }
    _rows()     { return this.location?.rows ?? 30; }
    _isHex()    { return this.location?.grid_type === 'hex'; }

    _screenToTile(sx, sy) {
      const gs = this._gridSize();
      const mx = (sx - this.offsetX) / this.scale;
      const my = (sy - this.offsetY) / this.scale;
      if (this._isHex()) {
        const s = gs / Math.sqrt(3);
        const fq = (Math.sqrt(3) / 3 * mx - my / 3) / s;
        const fr = (2 / 3 * my) / s;
        // Round axial fractional to integer hex
        const fs = -fq - fr;
        let q = Math.round(fq), r = Math.round(fr), ss = Math.round(fs);
        const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(ss - fs);
        if (dq > dr && dq > ds) q = -r - ss;
        else if (dr > ds)       r = -q - ss;
        return { col: q, row: r };
      }
      return { col: Math.floor(mx / gs), row: Math.floor(my / gs) };
    }

    _inBounds(col, row) {
      return col >= 0 && row >= 0 && col < this._cols() && row < this._rows();
    }

    _tileCenterPx(col, row) {
      const gs = this._gridSize();
      if (this._isHex()) {
        return { x: gs * (col + row / 2), y: gs * (Math.sqrt(3) / 2 * row) };
      }
      return { x: (col + 0.5) * gs, y: (row + 0.5) * gs };
    }

    // ── Rendering ─────────────────────────────────────────────
    render() {
      const ctx = this.ctx;
      const w = this.canvas.width;
      const h = this.canvas.height;
      ctx.fillStyle = '#0a0908';
      ctx.fillRect(0, 0, w, h);
      if (!this.location) return;

      ctx.save();
      ctx.translate(this.offsetX, this.offsetY);
      ctx.scale(this.scale, this.scale);

      this._drawTiles(ctx);
      this._drawFOV(ctx);
      this._drawEntities(ctx);
      this._drawLighting(ctx);
      this._drawGrid(ctx);
      this._drawBoundary(ctx);

      ctx.restore();
    }

    _drawTiles(ctx) {
      const gs = this._gridSize();
      const isHex = this._isHex();
      const sqrt3 = Math.sqrt(3);
      const hexSize = gs / sqrt3;

      for (const [key, tile] of this.tiles) {
        const [c, r] = key.split(',').map(Number);
        const type = typeof tile === 'string' ? tile : tile.tile_type;
        const visual = TILE_VISUAL[type] || TILE_VISUAL.floor;
        const cx = isHex ? gs * (c + r / 2) : c * gs;
        const cy = isHex ? gs * (sqrt3 / 2 * r) : r * gs;

        if (isHex) {
          this._hexPath(ctx, cx, cy, hexSize - 1);
          ctx.fillStyle = visual.color;
          ctx.fill();
          if (visual.outline) {
            ctx.strokeStyle = visual.outline;
            ctx.lineWidth = 2 / this.scale;
            this._hexPath(ctx, cx, cy, hexSize - 1);
            ctx.stroke();
          }
        } else {
          ctx.fillStyle = visual.color;
          ctx.fillRect(cx + 0.5, cy + 0.5, gs - 1, gs - 1);
          if (visual.outline) {
            ctx.strokeStyle = visual.outline;
            ctx.lineWidth = 2 / this.scale;
            ctx.strokeRect(cx + 1, cy + 1, gs - 2, gs - 2);
          }
          if (visual.glow) {
            const grad = ctx.createRadialGradient(cx + gs / 2, cy + gs / 2, 0, cx + gs / 2, cy + gs / 2, gs);
            grad.addColorStop(0, visual.glow);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(cx, cy, gs, gs);
          }
          if (visual.icon) {
            ctx.font = `${gs * 0.55}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = '#fff';
            ctx.fillText(visual.icon, cx + gs / 2, cy + gs / 2);
          }
        }
      }
    }

    _drawFOV(ctx) {
      if (!this.visibleSet || !this.exploredSet) return;
      const gs = this._gridSize();
      const cols = this._cols();
      const rows = this._rows();
      const isHex = this._isHex();
      const sqrt3 = Math.sqrt(3);
      const hexSize = gs / sqrt3;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const key = `${c},${r}`;
          if (this.visibleSet.has(key)) continue;
          const cx = isHex ? gs * (c + r / 2) : c * gs;
          const cy = isHex ? gs * (sqrt3 / 2 * r) : r * gs;
          if (this.exploredSet.has(key)) {
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
          } else {
            ctx.fillStyle = '#000';
          }
          if (isHex) {
            this._hexPath(ctx, cx, cy, hexSize - 1);
            ctx.fill();
          } else {
            ctx.fillRect(cx, cy, gs, gs);
          }
        }
      }
    }

    _drawLighting(ctx) {
      if (!this.lights || !this.lights.length) return;
      const gs = this._gridSize();
      const cols = this._cols();
      const rows = this._rows();
      const isHex = this._isHex();
      const ambient = this.location?.ambient_light ?? 1.0;

      // Compute illumination per cell using FOVCalculator so walls block light.
      const illum = new Array(rows).fill(0).map(() => new Array(cols).fill(ambient));
      const fov = new bv2.FOVCalculator(this.location, this.tiles);
      for (const li of this.lights) {
        const reach = Math.max(1, Math.ceil(li.radius_cells));
        const lit = fov.compute(li.col, li.row, reach);
        for (const key of lit) {
          const [c, ro] = key.split(',').map(Number);
          const dx = c - li.col, dy = ro - li.row;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > li.radius_cells) continue;
          illum[ro][c] = Math.min(1.0, illum[ro][c] + li.intensity / (1 + dist));
        }
      }

      // Apply darkness overlay based on computed illumination
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const val = illum[r][c];
          if (val >= 0.7) continue;
          const cx = isHex ? gs * (c + r / 2) : c * gs;
          const cy = isHex ? gs * (Math.sqrt(3) / 2 * r) : r * gs;
          if (val < 0.2) {
            ctx.fillStyle = 'rgba(0,0,0,0.92)';
          } else {
            ctx.fillStyle = `rgba(0,0,0,${0.3 * (0.7 - val)})`;
          }
          if (isHex) {
            this._hexPath(ctx, cx, cy, gs / Math.sqrt(3) - 1);
            ctx.fill();
          } else {
            ctx.fillRect(cx, cy, gs, gs);
          }
        }
      }
    }

    _drawEntities(ctx) {
      const gs = this._gridSize();
      const isHex = this._isHex();
      for (const ent of this.entities) {
        // FOV filter: skip entities outside visibleSet unless permanently visible
        if (this.visibleSet && !this.visibleSet.has(`${ent.col},${ent.row}`)) {
          const permanent = ent.props && ent.props.is_opened === true;
          if (!permanent) continue;
        }
        const visual = ENTITY_VISUAL[ent.entity_type] || { icon: '?', color: '#fff' };
        const cx = isHex ? gs * (ent.col + ent.row / 2) : ent.col * gs;
        const cy = isHex ? gs * (Math.sqrt(3) / 2 * ent.row) : ent.row * gs;
        const centerX = cx + gs / 2;
        const centerY = cy + gs / 2;
        const radius = gs * 0.35;

        // Highlight if hovered
        if (this._hoveredEntity && this._hoveredEntity.id === ent.id) {
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius + 4, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.fill();
        }

        // Circle background
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fillStyle = visual.color;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 2 / this.scale;
        ctx.stroke();

        // Icon
        ctx.font = `${gs * 0.4}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(visual.icon, centerX, centerY);
      }
    }

    _drawGrid(ctx) {
      const gs = this._gridSize();
      const cols = this._cols();
      const rows = this._rows();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1 / this.scale;

      if (this._isHex()) {
        const sqrt3 = Math.sqrt(3);
        const size = gs / sqrt3;
        for (let r = -1; r <= rows + 1; r++) {
          for (let q = -1; q <= cols + 1; q++) {
            const cx = gs * (q + r / 2);
            const cy = gs * (sqrt3 / 2 * r);
            this._hexPath(ctx, cx, cy, size);
            ctx.stroke();
          }
        }
      } else {
        for (let c = 0; c <= cols; c++) {
          ctx.beginPath();
          ctx.moveTo(c * gs, 0);
          ctx.lineTo(c * gs, rows * gs);
          ctx.stroke();
        }
        for (let r = 0; r <= rows; r++) {
          ctx.beginPath();
          ctx.moveTo(0, r * gs);
          ctx.lineTo(cols * gs, r * gs);
          ctx.stroke();
        }
      }
    }

    _drawBoundary(ctx) {
      const gs = this._gridSize();
      const bw = this._cols() * gs;
      const bh = this._rows() * gs;
      // Dim outside-of-bounds
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(-10000, -10000, 20000, 10000);
      ctx.fillRect(-10000, bh, 20000, 10000);
      ctx.fillRect(-10000, 0, 10000, bh);
      ctx.fillRect(bw, 0, 10000, bh);
      ctx.strokeStyle = '#ffd56a';
      ctx.setLineDash([8 / this.scale, 6 / this.scale]);
      ctx.lineWidth = 2 / this.scale;
      ctx.strokeRect(0, 0, bw, bh);
      ctx.restore();
    }

    _hexPath(ctx, cx, cy, size) {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 3;
        const x = cx + size * Math.cos(a);
        const y = cy + size * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }

    _fitToView() {
      if (!this.location) return;
      const gs = this._gridSize();
      const bw = this._cols() * gs;
      const bh = this._rows() * gs;
      const pad = 20;
      const sx = (this.canvas.width  - pad * 2) / bw;
      const sy = (this.canvas.height - pad * 2) / bh;
      this.scale = Math.max(0.1, Math.min(2, Math.min(sx, sy)));
      this.offsetX = (this.canvas.width  - bw * this.scale) / 2;
      this.offsetY = (this.canvas.height - bh * this.scale) / 2;
    }

    // ── Interaction (edit mode only) ──────────────────────────
    _bindEvents() {
      const c = this.canvas;
      c.addEventListener('contextmenu', e => e.preventDefault());

      c.addEventListener('mousedown', e => {
        if (this.mode !== 'edit') return;
        if (e.button === 0) {
          const brush = this.getBrush();
          const ent = this._entityAtScreen(e.offsetX, e.offsetY);
          if (brush.startsWith('entity:')) {
            // Entity brush mode
            if (ent && e.shiftKey) {
              // Shift-click on entity = delete
              if (this.onEntityClick) this.onEntityClick(ent, 'delete');
            } else if (ent) {
              // Click on existing entity = edit
              if (this.onEntityClick) this.onEntityClick(ent, 'edit');
            } else {
              // Click on empty cell = place new entity
              const { col, row } = this._screenToTile(e.offsetX, e.offsetY);
              if (this._inBounds(col, row) && this.onCellClick) {
                this.onCellClick(col, row, brush.replace('entity:', ''));
              }
            }
          } else if (brush.startsWith('light:')) {
            // Light brush mode
            const { col, row } = this._screenToTile(e.offsetX, e.offsetY);
            if (this._inBounds(col, row) && typeof S.openLightModal === 'function') {
              S.openLightModal(null, 'create', { col, row, preset: brush.replace('light:', '') });
            }
          } else if (ent && !e.shiftKey) {
            // Non-entity brush clicking on entity = edit entity
            if (this.onEntityClick) this.onEntityClick(ent, 'edit');
          } else {
            // Normal tile painting
            this._isPainting = true;
            this._lastPaintedKey = null;
            this._paintAt(e.offsetX, e.offsetY);
          }
        } else {
          this._isDragging = true;
          this._dragStart = { x: e.offsetX - this.offsetX, y: e.offsetY - this.offsetY };
        }
      });

      c.addEventListener('mousemove', e => {
        if (this._isPainting) this._paintAt(e.offsetX, e.offsetY);
        else if (this._isDragging) {
          this.offsetX = e.offsetX - this._dragStart.x;
          this.offsetY = e.offsetY - this._dragStart.y;
          this.render();
        } else {
          const prev = this._hoveredEntity;
          this._hoveredEntity = this._entityAtScreen(e.offsetX, e.offsetY);
          if (prev !== this._hoveredEntity) this.render();
        }
      });

      c.addEventListener('mouseup', () => {
        this._isPainting = false;
        this._isDragging = false;
        this._lastPaintedKey = null;
      });
      c.addEventListener('mouseleave', () => {
        this._isPainting = false;
        this._isDragging = false;
      });

      c.addEventListener('wheel', e => {
        e.preventDefault();
        const zoom = e.deltaY < 0 ? 1.1 : 0.9;
        const newScale = Math.max(0.15, Math.min(5, this.scale * zoom));
        this.offsetX = e.offsetX - (e.offsetX - this.offsetX) * (newScale / this.scale);
        this.offsetY = e.offsetY - (e.offsetY - this.offsetY) * (newScale / this.scale);
        this.scale = newScale;
        this.render();
      }, { passive: false });

      window.addEventListener('resize', () => this.resize());
    }

    _entityAtScreen(sx, sy) {
      const gs = this._gridSize();
      const { col, row } = this._screenToTile(sx, sy);
      // Find entity at this cell (last one wins — they can overlap)
      for (let i = this.entities.length - 1; i >= 0; i--) {
        const ent = this.entities[i];
        if (ent.col === col && ent.row === row) return ent;
      }
      return null;
    }

    _paintAt(sx, sy) {
      const { col, row } = this._screenToTile(sx, sy);
      if (!this._inBounds(col, row)) return;
      const key = `${col},${row}`;
      // Don't re-fire onPaint for the same cell while dragging.
      if (key === this._lastPaintedKey) return;
      this._lastPaintedKey = key;

      const brush = this.getBrush();
      if (brush === 'erase') {
        this.eraseTile(col, row);
        if (this.onErase) this.onErase(col, row);
      } else {
        this.setTile(col, row, brush);
        if (this.onPaint) this.onPaint(col, row, brush);
      }
    }
  }

  window.bv2.MapView = MapView;
})();
