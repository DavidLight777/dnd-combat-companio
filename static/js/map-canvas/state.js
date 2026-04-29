(function () {
  MapCanvas.prototype.loadImage = function(url) {
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


  MapCanvas.prototype.setTokens = function(tokens) {
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

  MapCanvas.prototype.setObjects = function(objects) {
    this.mapObjects = Array.isArray(objects) ? objects : [];
    this.render();
  }


  MapCanvas.prototype.setTiles = function(tiles, gridType = 'square') {
    this.tiles = tiles || {};
    this.tileGridType = gridType;
    this.render();
  }


  MapCanvas.prototype.setTraps = function(traps) {
    this.traps = traps || [];
    this.render();
  }


  MapCanvas.prototype.setChests = function(chests) {
    this.chests = chests || [];
    this.render();
  }


  MapCanvas.prototype.setMapChests = function(chests) {
    this.mapChests = chests || [];
    this.render();
  }


  MapCanvas.prototype.setPortals = function(portals) {
    this.portals = portals || [];
    this.render();
  }


  MapCanvas.prototype.setAmbientLight = function(v) { this.ambientLight = (v != null ? v : 1.0); this.render(); }

  MapCanvas.prototype.setIndoor = function(v) { this.isIndoor = !!v; this.render(); }

  MapCanvas.prototype.setLights = function(arr) { this.lights = arr || []; this.render(); }

  MapCanvas.prototype.setEdges = function(arr) { this.edges = arr || []; this.render(); }

  MapCanvas.prototype.setInteriors = function(arr) { this.interiors = arr || []; this.render(); }

  // Phase 6: lazy cache of HTMLImageElement objects keyed by URL.
  // `setTokens` doesn't prefetch — the image is loaded the first time
  // we try to render that token, then re-render is triggered when the
  // load completes.

  MapCanvas.prototype._getTokenImage = function(url) {
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

  MapCanvas.prototype._isTokenDraggable = function(token) {
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

  MapCanvas.prototype.setCanPlayerMove = function(can) {
    const next = !!can;
    if (this.canPlayerMove === next) return;
    this.canPlayerMove = next;
    this.render();
  }

  // Phase 4: feed the reachable-cell overlay with the authoritative
  // numbers from the server. Pass `(null, null)` to hide the overlay
  // (e.g. combat ended or not our turn).

  MapCanvas.prototype.setMovementBudget = function(left, total) {
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

  MapCanvas.prototype.setGrid = function(size, enabled, type) {
    this.gridSize = size;
    this.gridEnabled = enabled;
    if (type === 'hex' || type === 'square') this.gridType = type;
    this.render();
  }

  // Draw a single pointy-top hexagon outline centred on (cx, cy).

  MapCanvas.prototype.setFog = function(enabled, revealedCells) {
    this.fogEnabled = enabled;
    const cells = (revealedCells || []).map(c => {
      if (typeof c === 'string') return c;
      return `${c[0]},${c[1]}`;
    });
    this.revealedCells = new Set(cells);
    this.render();
  }


  MapCanvas.prototype.setCurrentVisible = function(set) {
    this.currentVisible = set || null;
    this.render();
  }


  MapCanvas.prototype.setFogPaintMode = function(on) {
    this.fogPaintMode = on;
    if (on) this.drawMode = null;
    this.canvas.style.cursor = on ? 'crosshair' : 'default';
  }


  MapCanvas.prototype.setDrawings = function(drawings) { this.drawings = drawings || []; this.render(); }

  MapCanvas.prototype.setMarkers = function(markers) { this.markers = markers || []; this.render(); }


  MapCanvas.prototype.setDrawMode = function(mode) {
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

  // RAF coalescing: high-frequency callers schedule a render through
  // this helper. Multiple calls inside one animation frame collapse
  // into a single full redraw on the next frame.

  MapCanvas.prototype._requestRender = function() {
    if (this._renderRafId != null) return;
    this._renderRafId = requestAnimationFrame(() => {
      this._renderRafId = null;
      this.render();
    });
  }

  // ── Rendering ─────────────────────────────────────────────

  MapCanvas.prototype._resize = function() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    this.canvas.width = parent.clientWidth;
    this.canvas.height = parent.clientHeight;
    if (this.scale === 0) this._fitToView();
    this.render();
  }
})();
