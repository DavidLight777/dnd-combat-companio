(function () {
  MapCanvas.prototype._screenToMap = function(sx, sy) {
    return {
      x: (sx - this.offsetX) / this.scale,
      y: (sy - this.offsetY) / this.scale,
    };
  }


  MapCanvas.prototype._mapToNormalized = function(mx, my) {
    const w = this.mapWidth || this.canvas.width;
    const h = this.mapHeight || this.canvas.height;
    return {
      x: w > 0 ? mx / w : 0,
      y: h > 0 ? my / h : 0,
    };
  }


  MapCanvas.prototype._screenToGrid = function(sx, sy) {
    const m = this._screenToMap(sx, sy);
    return { col: Math.floor(m.x / this.gridSize), row: Math.floor(m.y / this.gridSize) };
  }

  // Phase 8: recursive shadowcasting for square grids.
  // Returns a Set of "col,row" strings.

  MapCanvas.prototype._fitToView = function() {
    if (!this.mapWidth) return;
    const scaleX = this.canvas.width / this.mapWidth;
    const scaleY = this.canvas.height / this.mapHeight;
    this.scale = Math.min(scaleX, scaleY) * 0.95;
    this.offsetX = (this.canvas.width - this.mapWidth * this.scale) / 2;
    this.offsetY = (this.canvas.height - this.mapHeight * this.scale) / 2;
    this._lastFitKey = `${this.mapWidth}x${this.mapHeight}x${this._currentImageUrl || ''}`;
  }

  // Fit only if the map dimensions or loaded image actually changed
  // since the last fit (or if we've never fitted). Prevents camera
  // jumps on every state refresh triggered by token moves.

  MapCanvas.prototype._autoFitIfChanged = function() {
    if (!this.mapWidth) return;
    const key = `${this.mapWidth}x${this.mapHeight}x${this._currentImageUrl || ''}`;
    if (this._lastFitKey === key && this.scale > 0) return;
    this._fitToView();
  }


  MapCanvas.prototype.centerView = function() { this._fitToView(); this.render(); }

  // ── Hit test token ────────────────────────────────────────

  MapCanvas.prototype._hitToken = function(mx, my) {
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


  MapCanvas.prototype._hitChest = function(mx, my) {
    if (!this.chests || !this.chests.length) return null;
    const size = this.gridSize * 0.6;
    for (let i = this.chests.length - 1; i >= 0; i--) {
      const ch = this.chests[i];
      if (!ch.is_revealed && this.role !== 'gm') continue;
      if (ch.map_x == null || ch.map_y == null) continue;
      const px = ch.map_x * this.mapWidth;
      const py = ch.map_y * this.mapHeight;
      const half = size / 2;
      if (mx >= px - half && mx <= px + half && my >= py - half && my <= py + half) return ch;
    }
    return null;
  }


  MapCanvas.prototype._hitMapChest = function(mx, my) {
    if (!this.mapChests || !this.mapChests.length) return null;
    const gs = this.gridSize;
    for (let i = this.mapChests.length - 1; i >= 0; i--) {
      const ch = this.mapChests[i];
      if (this.role !== 'gm' && ch.is_hidden) continue;
      const px = ch.col * gs, py = ch.row * gs;
      if (mx >= px && mx <= px + gs && my >= py && my <= py + gs) return ch;
    }
    return null;
  }


  MapCanvas.prototype._hitPortal = function(mx, my) {
    if (!this.portals || !this.portals.length) return null;
    const gs = this.gridSize;
    for (let i = this.portals.length - 1; i >= 0; i--) {
      const p = this.portals[i];
      const px = p.col * gs, py = p.row * gs;
      if (mx >= px && mx <= px + gs && my >= py && my <= py + gs) return p;
    }
    return null;
  }

  // ── Events ────────────────────────────────────────────────

  MapCanvas.prototype._bindEvents = function() {
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
        this._requestRender();
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
        this._requestRender();
        return;
      }
      if (this.drawMode === 'measure' && this._measureStart) {
        this._measureEnd = [n.x, n.y];
        this._requestRender();
        return;
      }

      if (this.dragToken) {
        this.dragToken.x = Math.max(0, Math.min(1, n.x));
        this.dragToken.y = Math.max(0, Math.min(1, n.y));
        this._requestRender();
        return;
      }
      if (this.isDragging) {
        this.offsetX = sx - this.dragStart.x;
        this.offsetY = sy - this.dragStart.y;
        this._requestRender();
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
      // Check chest click
      const chest = this._hitChest(m.x, m.y);
      if (chest && this.onChestClick) { this.onChestClick(chest); return; }
      // Check mapChest click
      const mapChest = this._hitMapChest(m.x, m.y);
      if (mapChest && this.onMapChestClick) { this.onMapChestClick(mapChest); return; }
      // Check portal click
      const portal = this._hitPortal(m.x, m.y);
      if (portal && this.onPortalClick) { this.onPortalClick(portal); return; }
      const token = this._hitToken(m.x, m.y);
      if (token && this.onTokenClick) { this.onTokenClick(token, e.shiftKey); return; }
      // If nothing was clicked, fire onMapClick with normalized coords
      const n = this._mapToNormalized(m.x, m.y);
      if (this.onMapClick) this.onMapClick(n.x, n.y);
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
      } else if (this.onDoorRightClick) {
        const g = this._screenToGrid(sx, sy);
        const key = `${g.col},${g.row}`;
        const tile = this.tiles ? this.tiles[key] : null;
        if (tile && tile.type === 'door') {
          this.onDoorRightClick(g.col, g.row, !!tile.is_open, e.clientX, e.clientY);
        }
      }
    });

    // Resize
    window.addEventListener('resize', () => this._resize());
  }

  // ── Map Builder tile rendering ─────────────────────────────

  MapCanvas.prototype._hitMarker = function(mx, my) {
    const hitR = 15 / this.scale;
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      const px = m.x * this._mw, py = m.y * this._mh;
      if (Math.abs(mx - px) < hitR && Math.abs(my - py) < hitR) return m;
    }
    return null;
  }

  // ── Hit test drawing ────────────────────────────────────────

  MapCanvas.prototype._hitDrawing = function(mx, my) {
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


})();
