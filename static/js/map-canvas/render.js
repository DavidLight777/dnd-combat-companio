(function () {
  MapCanvas.prototype._renderHexGrid = function(ctx) {
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

  MapCanvas.prototype._renderReachHex = function(ctx, px, py, reach) {
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


  MapCanvas.prototype.render = function() {
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
    } else if (this.mapWidth > 0 && this.mapHeight > 0) {
      // No image: paint the bounded play area as a dark canvas
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, this.mapWidth, this.mapHeight);
    }

    // Map Builder: render tiles
    this._renderTiles(ctx);

    // Boundary outline when no image (GM-defined play area)
    if (!this.mapImage && this.mapWidth > 0 && this.mapHeight > 0) {
      ctx.save();
      ctx.strokeStyle = '#ffd56a';
      ctx.setLineDash([8 / this.scale, 6 / this.scale]);
      ctx.lineWidth = 2 / this.scale;
      ctx.strokeRect(0, 0, this.mapWidth, this.mapHeight);
      ctx.restore();
    }

    // Grid — visible to both GM and player (thin overlay).
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
      const isPlayer = this.role === 'player';
      const outerW = isPlayer ? 0.8 / this.scale : 2.5 / this.scale;
      const innerW = isPlayer ? 0.3 / this.scale : 1.2 / this.scale;
      const drawTwice = (drawFn) => {
        ctx.save();
        ctx.strokeStyle = isPlayer ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.55)';
        ctx.lineWidth = outerW;
        drawFn();
        ctx.strokeStyle = isPlayer ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.75)';
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

    // Phase 8: edge transition indicators
    this._renderEdges(ctx);

    // Drawings (Stage 9)
    for (const d of this.drawings) {
      if (!d.visible_to_players && this.role !== 'gm') continue;
      this._renderDrawing(ctx, d);
    }

    // Phase 5: map objects (walls / zones). Rendered below tokens and
    // markers so walkable highlights / selection rings sit on top.
    for (const o of this.mapObjects) {
      if (!o.visible_to_players && this.role !== 'gm') continue;
      // builder_wall mirrors a Builder tile already rendered by
      // _renderTiles — skip to avoid double-drawing.
      if (o.kind === 'builder_wall') continue;
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
    // Phase 15 Round 3: player fog is unified inside _renderLightingOverlay.
    // Only GM gets the old fog preview here.
    if (this.fogEnabled && this.mapWidth > 0 && this.role === 'gm') {
      const gs = this.gridSize;
      const cols = Math.ceil(this.mapWidth / gs);
      const rows = Math.ceil(this.mapHeight / gs);
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          const key = `${c},${r}`;
          if (!this.revealedCells.has(key)) {
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillRect(c * gs, r * gs, gs, gs);
          }
        }
      }
    }

    // Phase 9: interior zone overlay — drawn AFTER fog so the roof
    // hides interior cells even if they are "explored" in the fog.
    // Without this ordering, fog's dim overlay (0.55) would paint
    // over the roof (0.95) and make the building look partially open.
    this._renderInteriorOverlay(ctx);

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

    // Phase 12 R5: interpolate animated token positions
    const now = performance.now();
    for (const [charId, anim] of this._tokenAnims) {
      const t = (this.tokens || []).find(tok => tok.character_id === charId);
      if (!t) { this._tokenAnims.delete(charId); continue; }
      const elapsed = now - anim.startTime;
      const duration = 200;
      if (elapsed >= duration) {
        t.x = anim.targetX;
        t.y = anim.targetY;
        this._tokenAnims.delete(charId);
      } else {
        const p = elapsed / duration;
        const ease = 1 - Math.pow(1 - p, 3); // easeOutCubic
        t.x = anim.prevX + (anim.targetX - anim.prevX) * ease;
        t.y = anim.prevY + (anim.targetY - anim.prevY) * ease;
      }
    }

    // Tokens
    for (const t of this.tokens) {
      if (!t.visible && this.role !== 'gm') continue;
      if (t.x == null || t.y == null) continue;
      // Phase 15 Round 2: hide enemy tokens outside player vision
      if (this.role === 'player' && t.is_npc && this.currentVisible) {
        const gs = this.gridSize || 50;
        const col = Math.floor(t.x * this.mapWidth / gs);
        const row = Math.floor(t.y * this.mapHeight / gs);
        if (!this.currentVisible.has(`${col},${row}`)) continue; // not visible
      }
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

      // Phase 12 R4: HP ring around token (3-tier colour)
      if (t.max_hp > 0) {
        const hpFrac = Math.max(0, Math.min(1,
          (t.current_hp ?? 1) / Math.max(1, t.max_hp ?? 1)));
        ctx.lineWidth = 3;
        ctx.strokeStyle = hpFrac > 0.5 ? '#4caf50'
                        : hpFrac > 0.25 ? '#ffc107'
                        : '#f44336';
        ctx.beginPath();
        ctx.arc(px, py, radius + 2, -Math.PI / 2,
                -Math.PI / 2 + Math.PI * 2 * hpFrac);
        ctx.stroke();
      }

      // HP bar under token (kept for compatibility)
      if (t.max_hp > 0) {
        const barW = radius * 2;
        const barH = 3 / this.scale;
        const barX = px - radius;
        const barY = py + radius + 4 / this.scale;
        const pct = t.current_hp / t.max_hp;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(barX, barY, barW, barH);
        ctx.fillStyle = pct > 0.5 ? '#4a9c5d' : pct > 0.25 ? '#c09a2a' : '#b84040';
        ctx.fillRect(barX, barY, barW * pct, barH);
      }

      ctx.globalAlpha = 1;
    }

    // Ghost preview token during player drag (doesn't reveal FOV)
    if (this.role === 'player' && this._ghostTokenPos) {
      const gx = this._ghostTokenPos.x * this.mapWidth;
      const gy = this._ghostTokenPos.y * this.mapHeight;
      const r = (this.gridSize / 2) * 0.8;
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.arc(gx, gy, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,215,96,0.7)';
      ctx.lineWidth = 2 / this.scale;
      ctx.setLineDash([4 / this.scale, 4 / this.scale]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Chests (rendered under tokens but above map)
    if (this.chests && this.chests.length) {
      for (const ch of this.chests) {
        if (!ch.is_revealed && this.role !== 'gm') continue;
        if (ch.map_x == null || ch.map_y == null) continue;
        const px = ch.map_x * this.mapWidth;
        const py = ch.map_y * this.mapHeight;
        const size = this.gridSize * 0.6;
        ctx.save();
        ctx.translate(px, py);
        // Draw chest box
        ctx.fillStyle = ch.is_revealed ? '#8B4513' : '#555';
        ctx.fillRect(-size/2, -size/2, size, size);
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 1.5 / this.scale;
        ctx.strokeRect(-size/2, -size/2, size, size);
        // Lid line
        ctx.beginPath();
        ctx.moveTo(-size/2, -size/4);
        ctx.lineTo(size/2, -size/4);
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 1 / this.scale;
        ctx.stroke();
        // Lock
        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.arc(0, 0, size/8, 0, Math.PI*2);
        ctx.fill();
        // Label
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${Math.max(8, size*0.35)}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('📦', 0, -size/3);
        ctx.restore();
      }
    }

    // Combat FX — drawn last so they sit above every token and HP
    // bar. The loop in `_startFxLoop` keeps calling render() while
    // any effect is alive, giving us a smooth ~60fps animation
    // without the rest of the scene having to be rebuilt by hand.
    this._renderFx(ctx);

    // Phase 15: lighting overlay drawn in WORLD space (inside save/restore)
    this._renderLightingOverlay(ctx);

    ctx.restore();
  }

  // ── Coordinate conversion ─────────────────────────────────

  MapCanvas.prototype._renderTiles = function(ctx) {
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
      for (const [key, raw] of Object.entries(this.tiles)) {
        const type = typeof raw === 'string' ? raw : (raw && raw.type) || 'floor';
        const [q, r] = key.split(',').map(Number);
        const c = _axialToPixel(q, r);
        if (c.x < -gs || c.y < -gs || c.x > mw + gs || c.y > mh + gs) continue;
        ctx.fillStyle = colors[type] || colors.floor;
        _hexPath(c.x, c.y, size - 1);
        ctx.fill();
        // Walls: bold outline + diagonal hatch so they read as solid
        // barriers (matches the square-grid wall style).
        if (type === 'wall') {
          ctx.save();
          ctx.strokeStyle = 'rgba(0,0,0,0.6)';
          ctx.lineWidth = 2 / this.scale;
          _hexPath(c.x, c.y, size - 1);
          ctx.stroke();
          _hexPath(c.x, c.y, size - 2);
          ctx.clip();
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.lineWidth = 1 / this.scale;
          ctx.beginPath();
          for (let off = -size * 2; off < size * 2; off += 6) {
            ctx.moveTo(c.x + off - size, c.y - size);
            ctx.lineTo(c.x + off + size, c.y + size);
          }
          ctx.stroke();
          ctx.restore();
        }
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
      // MapChests in hex
      for (const ch of (this.mapChests || [])) {
        const c = _axialToPixel(ch.col, ch.row);
        if (c.x < -gs || c.y < -gs || c.x > mw + gs || c.y > mh + gs) continue;
        if (this.role !== 'gm' && ch.is_hidden) continue;
        ctx.fillStyle = 'rgba(139,69,19,0.75)';
        _hexPath(c.x, c.y, size - 2);
        ctx.fill();
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 1.5 / this.scale;
        _hexPath(c.x, c.y, size - 2);
        ctx.stroke();
        ctx.font = `${gs * 0.4}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('📦', c.x, c.y);
      }
      // Portals in hex
      for (const p of (this.portals || [])) {
        const c = _axialToPixel(p.col, p.row);
        if (c.x < -gs || c.y < -gs || c.x > mw + gs || c.y > mh + gs) continue;
        ctx.fillStyle = 'rgba(153,50,204,0.6)';
        _hexPath(c.x, c.y, size - 2);
        ctx.fill();
        ctx.font = `${gs * 0.4}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🌀', c.x, c.y);
      }
    } else {
      // Square grid — Phase 12 R1: sprite-first with colour fallback
      const _getSprite = (type, raw) => {
        const reg = window.SpriteRegistry;
        if (!reg) return null;
        if (type === 'door') {
          const isOpen = (typeof raw === 'object' && raw && raw.is_open);
          return reg.get(isOpen ? 'door_open' : 'door_closed');
        }
        return reg.get(type) || null;
      };
      for (const [key, raw] of Object.entries(this.tiles)) {
        const type = typeof raw === 'string' ? raw : (raw && raw.type) || 'floor';
        const [col, row] = key.split(',').map(Number);
        const px = col * gs, py = row * gs;
        if (px < 0 || py < 0 || px >= mw || py >= mh) continue;
        const sprite = _getSprite(type, raw);
        if (sprite) {
          ctx.drawImage(sprite, px, py, gs, gs);
        } else {
          // Fallback to solid colour when sprites aren't loaded
          ctx.fillStyle = colors[type] || colors.floor;
          ctx.fillRect(px + 0.5, py + 0.5, gs - 1, gs - 1);
        }
      }
      // Phase 12 R3: wall drop-shadow for 3D depth
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      for (const [key, raw] of Object.entries(this.tiles)) {
        const type = typeof raw === 'string' ? raw : (raw && raw.type) || 'floor';
        if (type !== 'wall') continue;
        const [col, row] = key.split(',').map(Number);
        const px = col * gs, py = row * gs;
        const southKey = `${col},${row + 1}`;
        const south = this.tiles[southKey];
        const southType = typeof south === 'string' ? south : (south && south.type) || 'floor';
        if (southType !== 'wall') {
          ctx.fillRect(px, py + gs - 2, gs, 2);  // south shadow
        }
        const eastKey = `${col + 1},${row}`;
        const east = this.tiles[eastKey];
        const eastType = typeof east === 'string' ? east : (east && east.type) || 'floor';
        if (eastType !== 'wall') {
          ctx.fillRect(px + gs - 2, py, 2, gs);  // east shadow
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
      // MapChests (square)
      for (const ch of (this.mapChests || [])) {
        const px = ch.col * gs, py = ch.row * gs;
        if (px < 0 || py < 0 || px >= mw || py >= mh) continue;
        if (this.role !== 'gm' && ch.is_hidden) continue;
        ctx.fillStyle = 'rgba(139,69,19,0.75)';
        ctx.fillRect(px + 1, py + 1, gs - 2, gs - 2);
        ctx.strokeStyle = '#FFD700';
        ctx.lineWidth = 1.5 / this.scale;
        ctx.strokeRect(px + 1, py + 1, gs - 2, gs - 2);
        ctx.font = `${gs * 0.5}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('📦', px + gs / 2, py + gs / 2);
      }
      // Portals (square)
      for (const p of (this.portals || [])) {
        const px = p.col * gs, py = p.row * gs;
        if (px < 0 || py < 0 || px >= mw || py >= mh) continue;
        ctx.fillStyle = 'rgba(153,50,204,0.6)';
        ctx.fillRect(px + 1, py + 1, gs - 2, gs - 2);
        ctx.font = `${gs * 0.5}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🌀', px + gs / 2, py + gs / 2);
      }
    }
  }

  // ── Phase 8: edge transition visual indicators ──────────────

  MapCanvas.prototype._renderEdges = function(ctx) {
    if (!this.edges || !this.edges.length) return;
    const gs = this.gridSize;
    const cols = Math.ceil(this.mapWidth / gs);
    const rows = Math.ceil(this.mapHeight / gs);
    ctx.save();
    ctx.strokeStyle = 'rgba(0,210,255,0.7)';
    ctx.fillStyle = 'rgba(0,210,255,0.35)';
    ctx.lineWidth = 2 / this.scale;
    for (const e of this.edges) {
      const rs = e.range_start ?? 0;
      const re = e.range_end ?? rs;
      if (e.side === 'north') {
        const y = 0;
        for (let c = rs; c <= re; c++) {
          const x = c * gs;
          ctx.beginPath();
          ctx.moveTo(x + gs * 0.2, y + gs * 0.35);
          ctx.lineTo(x + gs * 0.5, y + gs * 0.05);
          ctx.lineTo(x + gs * 0.8, y + gs * 0.35);
          ctx.stroke();
        }
      } else if (e.side === 'south') {
        const y = rows * gs;
        for (let c = rs; c <= re; c++) {
          const x = c * gs;
          ctx.beginPath();
          ctx.moveTo(x + gs * 0.2, y - gs * 0.35);
          ctx.lineTo(x + gs * 0.5, y - gs * 0.05);
          ctx.lineTo(x + gs * 0.8, y - gs * 0.35);
          ctx.stroke();
        }
      } else if (e.side === 'west') {
        const x = 0;
        for (let r = rs; r <= re; r++) {
          const y = r * gs;
          ctx.beginPath();
          ctx.moveTo(x + gs * 0.35, y + gs * 0.2);
          ctx.lineTo(x + gs * 0.05, y + gs * 0.5);
          ctx.lineTo(x + gs * 0.35, y + gs * 0.8);
          ctx.stroke();
        }
      } else if (e.side === 'east') {
        const x = cols * gs;
        for (let r = rs; r <= re; r++) {
          const y = r * gs;
          ctx.beginPath();
          ctx.moveTo(x - gs * 0.35, y + gs * 0.2);
          ctx.lineTo(x - gs * 0.05, y + gs * 0.5);
          ctx.lineTo(x - gs * 0.35, y + gs * 0.8);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  // ── Phase 8: lighting overlay ───────────────────────────────
  // Phase 9: GM gets a soft preview (0.35x darkness) so they can
  // tune ambient light / indoor settings while building.

  MapCanvas.prototype._renderInteriorOverlay = function(ctx) {
    if (!this.interiors || !this.interiors.length) return;
    const gs = this.gridSize;
    const isGm = this.role === 'gm';
    for (const zone of this.interiors) {
      if (zone.reveal_mode === 'always') continue;
      const cells = zone.cells || [];
      if (!cells.length) continue;
      const cellSet = new Set(cells.map(c => `${c.col},${c.row}`));

      // Phase 9 Round 2: door peek — compute cells revealed through open doors
      const peekCells = new Set();
      if (this.tiles) {
        const boundaryDoors = [];
        for (const [key, tile] of Object.entries(this.tiles)) {
          if (tile.type !== 'door' || !tile.is_open) continue;
          const [dc, dr] = key.split(',').map(Number);
          let hasIn = false, hasOut = false;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nk = `${dc + dx},${dr + dy}`;
              if (cellSet.has(nk)) hasIn = true;
              else hasOut = true;
            }
          }
          if (hasIn && hasOut) boundaryDoors.push({ col: dc, row: dr });
        }

        let shouldPeek = isGm;
        if (!isGm && boundaryDoors.length) {
          const cols = Math.ceil(this.mapWidth / gs);
          const rows = Math.ceil(this.mapHeight / gs);
          for (const t of this.tokens) {
            if (t.is_npc || !t.visible) continue;
            const tc = Math.floor(t.x * cols);
            const tr = Math.floor(t.y * rows);
            for (const d of boundaryDoors) {
              if (Math.max(Math.abs(tc - d.col), Math.abs(tr - d.row)) <= 3) {
                shouldPeek = true;
                break;
              }
            }
            if (shouldPeek) break;
          }
        }

        if (shouldPeek) {
          for (const d of boundaryDoors) {
            const startKey = `${d.col},${d.row}`;
            const visited = new Set([startKey]);
            if (cellSet.has(startKey)) peekCells.add(startKey);
            const queue = [{ col: d.col, row: d.row, depth: 0 }];
            while (queue.length) {
              const cur = queue.shift();
              if (cur.depth >= 2) continue;
              for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                  if (dx === 0 && dy === 0) continue;
                  const nc = cur.col + dx, nr = cur.row + dy;
                  const nk = `${nc},${nr}`;
                  if (visited.has(nk)) continue;
                  visited.add(nk);
                  if (!cellSet.has(nk)) continue;
                  peekCells.add(nk);
                  queue.push({ col: nc, row: nr, depth: cur.depth + 1 });
                }
              }
            }
          }
        }
      }

      if (zone.reveal_mode === 'gm_only' && !isGm) {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,1.0)';
        for (const key of cellSet) {
          if (peekCells.has(key)) continue;
          const [c, r] = key.split(',').map(Number);
          ctx.fillRect(c * gs, r * gs, gs, gs);
        }
        ctx.restore();
        continue;
      }
      let hasPlayerInside = false;
      if (!isGm) {
        const cols = Math.ceil(this.mapWidth / gs);
        const rows = Math.ceil(this.mapHeight / gs);
        for (const t of this.tokens) {
          if (t.is_npc || !t.visible) continue;
          const tc = Math.floor(t.x * cols);
          const tr = Math.floor(t.y * rows);
          if (cellSet.has(`${tc},${tr}`)) { hasPlayerInside = true; break; }
        }
      }
      if (!hasPlayerInside && !isGm) {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.95)';
        for (const key of cellSet) {
          if (peekCells.has(key)) continue;
          const [c, r] = key.split(',').map(Number);
          ctx.fillRect(c * gs, r * gs, gs, gs);
        }
        ctx.restore();
      } else if (!hasPlayerInside && isGm) {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        for (const key of cellSet) {
          if (peekCells.has(key)) continue;
          const [c, r] = key.split(',').map(Number);
          ctx.fillRect(c * gs, r * gs, gs, gs);
        }
        ctx.restore();
      }
      // Phase 10 R3: GM debug label
      if (isGm) {
        const zCells = Array.from(cellSet).map(k => k.split(',').map(Number));
        if (zCells.length) {
          const cx = zCells.reduce((s, [c]) => s + c, 0) / zCells.length;
          const cy = zCells.reduce((s, [, r]) => s + r, 0) / zCells.length;
          const px = (cx + 0.5) * gs;
          const py = (cy + 0.5) * gs;
          let insideCount = 0;
          const cols = Math.ceil(this.mapWidth / gs);
          const rows = Math.ceil(this.mapHeight / gs);
          for (const t of this.tokens) {
            if (t.is_npc || !t.visible) continue;
            const tc = Math.floor(t.x * cols);
            const tr = Math.floor(t.y * rows);
            if (cellSet.has(`${tc},${tr}`)) insideCount++;
          }
          ctx.save();
          ctx.font = `${Math.max(10, gs * 0.28)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          const label = `${zone.name || 'Zone'} · ${cells.length}c · ${insideCount}in`;
          const w = ctx.measureText(label).width + 8;
          ctx.fillRect(px - w / 2, py - gs * 0.2, w, gs * 0.4);
          ctx.fillStyle = '#fff';
          ctx.fillText(label, px, py);
          ctx.restore();
        }
      }
    }
  }

  // ── Render a saved/preview drawing ──────────────────────────

  MapCanvas.prototype._renderDrawing = function(ctx, d) {
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

  MapCanvas.prototype._renderMapObject = function(ctx, o) {
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

  MapCanvas.prototype._renderMarker = function(ctx, m) {
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

})();
