// ════════════════════════════════════════════════════════
// Map canvas (main app side)
// Source: gm-app.js lines 2867–3376
// Globals shared via window.* and module-scope hoisting.
// ════════════════════════════════════════════════════════

// MAP
// ══════════════════════════════════════════════════════════════
let mapCanvas = null;
let mapGridEnabled = true;
let mapFogEnabled = false;
let mapFogPaintActive = false;
let gmBv2LocationId = null;

async function initMapCanvas() {
  const canvasEl = $('#map-canvas');
  if (!canvasEl || mapCanvas) return;
  // Phase 12 R1: load tile sprites before first render
  if (window.SpriteRegistry) await window.SpriteRegistry.load();
  mapCanvas = new MapCanvas(canvasEl, {
    role: 'gm',
    sessionCode: SESSION_CODE,
    onTokenMove: async (charId, x, y) => {
      await api.patch(`/api/map/token/${charId}`, { x, y });
      addLog('map', `Moved token ${charId} to (${x.toFixed(2)}, ${y.toFixed(2)})`);
    },
    onFogReveal: async (col, row) => {
      await api.post(`/api/map/${SESSION_CODE}/fog/reveal`, { cells: [[col, row]] });
    },
    onDrawingSaved: async (data) => {
      try {
        const res = await api.post(`/api/map/${SESSION_CODE}/drawings`, data);
        mapCanvas.drawings.push(res);
        mapCanvas.render();
        addLog('map', `Drawing added: ${data.drawing_type}`);
        if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
          ws.ws.send(JSON.stringify({ type: 'map.drawing_added', drawing: res }));
        }
      } catch { showToast('Failed to save drawing'); }
    },
    onMarkerCreate: (nx, ny) => openMarkerModal(nx, ny),
    onMarkerClick: (marker) => openMarkerModal(marker.x, marker.y, marker),
    onEraseMarker: async (marker) => {
      await api.del(`/api/map/markers/${marker.id}`);
      mapCanvas.markers = mapCanvas.markers.filter(m => m.id !== marker.id);
      mapCanvas.render();
      addLog('map', `Marker deleted: ${marker.label || marker.icon}`);
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({ type: 'map.marker_deleted', marker_id: marker.id }));
      }
    },
    onEraseDrawing: async (drawing) => {
      await api.del(`/api/map/drawings/${drawing.id}`);
      mapCanvas.drawings = mapCanvas.drawings.filter(d => d.id !== drawing.id);
      mapCanvas.render();
      addLog('map', 'Drawing erased');
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({ type: 'map.drawing_deleted', drawing_id: drawing.id }));
      }
    },
    onTokenClick: (token, shiftKey) => {
      // Shift+click on NPC token opens floating control panel
      if (shiftKey && token.is_npc) openNpcControlPanel(token.character_id);
    },
    onTokenRightClick: (token, cx, cy) => openTokenContextMenu(token, cx, cy),
    onDoorRightClick: (col, row, isOpen, cx, cy) => openDoorContextMenu(col, row, isOpen, cx, cy),
    onChestClick: (chest) => openChestModal(chest),
    onMapChestClick: (chest) => openBuilderChestModal(chest.col, chest.row, chest),
    onPortalClick: (portal) => openBuilderPortalModal(portal.col, portal.row, portal),
    onMapClick: (nx, ny) => {
      if (placingChest) {
        handleMapClickForChest(nx, ny);
      }
    },
    // Phase 5: wall/object placement. Finishes a drag-to-place
    // rectangle; the server normalises and broadcasts map.objects_updated,
    // which we listen for below to refresh the list.
    onObjectSaved: async (data) => {
      try {
        const res = await api.post(`/api/map/${SESSION_CODE}/objects`, {
          name: data.kind === 'wall' ? 'Wall' : 'Zone',
          kind: data.kind || 'wall',
          x1: data.x1, y1: data.y1, x2: data.x2, y2: data.y2,
          blocks_movement: true,
          blocks_vision: false,
          visible_to_players: true,
        });
        mapCanvas.mapObjects.push(res);
        mapCanvas.render();
        addLog('map', `Wall placed (${data.kind})`);
      } catch { showToast('Failed to place wall'); }
    },
  });
  // Phase 13 R2: Pixi lockstep bridge (cookie-gated)
  if (window.USE_PIXI && window.PixiMapRenderer) {
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:2';
    canvasEl.parentElement.appendChild(host);
    canvasEl.style.display = 'none';
    mapCanvas.useExternalRenderer = true;
    const pixi = new PixiMapRenderer(host, { role: 'gm', gridSize: 50 });
    window.__pixiRenderer = pixi;
    // Intercept setTiles / setGrid so Pixi stays in sync
    const origSetTiles = mapCanvas.setTiles.bind(mapCanvas);
    mapCanvas.setTiles = (tiles, gridType) => {
      origSetTiles(tiles, gridType);
      pixi.mapWidth = mapCanvas.mapWidth;
      pixi.mapHeight = mapCanvas.mapHeight;
      pixi.setTiles(tiles, gridType);
    };
    const origSetGrid = mapCanvas.setGrid.bind(mapCanvas);
    mapCanvas.setGrid = (size, enabled, type) => {
      origSetGrid(size, enabled, type);
      pixi.gridSize = size;
      pixi.setGridEnabled(enabled);
    };
  }
  loadMapState();
}

async function loadMapState() {
  try {
    const state = await api.get(`/api/map/${SESSION_CODE}`);
    gmBv2LocationId = state.bv2_active_location_id || null;
    initMapCanvas(); // ensure canvas object exists even if tab not yet open
    // bv2 bridge sets has_map=True even when no background image is
    // uploaded (image_url=""). Mirror the player-side guard so we
    // skip loadImage("") (which rejects) and fall through to the
    // empty-image branch that still renders tiles and tokens.
    if (state.has_map && state.image_url) {
      await mapCanvas.loadImage(state.image_url);
      const tsz = state.active_floor_tile_size || state.grid_size || 50;
      const gtype = state.active_floor_grid_type || state.grid_type || 'square';
      const cols = state.active_floor_cols || 40;
      const rows = state.active_floor_rows || 30;
      // Override natural image size with builder-defined play-area dimensions
      // so the grid aligns to the builder's tile_size × cols/rows bounds.
      mapCanvas.mapWidth = cols * tsz;
      mapCanvas.mapHeight = rows * tsz;
      mapCanvas.setGrid(tsz, state.grid_enabled, gtype);
      mapCanvas.setFog(state.fog_enabled, state.revealed_cells);
    } else {
      // No uploaded image — compute the play-area dimensions from the
      // active floor (if any) in a SINGLE assignment so `_autoFitIfChanged`
      // only fires once per refresh. Setting mapWidth/Height twice in one
      // refresh caused the camera to jump and broke mid-drag selections.
      const tsz  = state.active_floor_tile_size || state.grid_size || 50;
      const cols = state.active_floor_cols || 40;
      const rows = state.active_floor_rows || 30;
      mapCanvas.mapImage  = null;
      mapCanvas.gridSize  = tsz;
      mapCanvas.mapWidth  = cols * tsz;
      mapCanvas.mapHeight = rows * tsz;
      mapCanvas.setGrid(tsz, true, state.active_floor_grid_type || state.grid_type || 'square');
      mapCanvas.setFog(false, []);
      mapCanvas._autoFitIfChanged();
    }
    mapCanvas.setTokens(state.tokens || []);
    // Load overlays
    try {
      const overlays = await api.get(`/api/map/${SESSION_CODE}/overlays`);
      mapCanvas.setDrawings(overlays.drawings);
      mapCanvas.setMarkers(overlays.markers);
      // Phase 5: map objects (walls/zones).
      if (overlays.objects) mapCanvas.setObjects(overlays.objects);
      // Map Builder: traps
      if (overlays.traps) mapCanvas.setTraps(overlays.traps);
    } catch {}
    if (state.active_floor_tiles) {
      mapCanvas.setTiles(state.active_floor_tiles, state.active_floor_grid_type || 'square');
    }
    // Phase 8: bv2 lighting + edges (visible on both GM and player canvases)
    mapCanvas.setAmbientLight(state.bv2_ambient_light ?? 1.0);
    mapCanvas.setIndoor(state.bv2_is_indoor ?? false);
    mapCanvas.setLights(state.bv2_lights || []);
    mapCanvas.setEdges(state.bv2_edges || []);
    // Phase 9: interior zones
    mapCanvas.setInteriors(state.bv2_interiors || []);
    // Phase 10: lighting HUD
    const hud = document.getElementById('map-lighting-hud');
    if (hud) {
      const a = state.bv2_ambient_light ?? 1.0;
      const indoor = !!state.bv2_is_indoor;
      const lights = (state.bv2_lights || []).length;
      hud.textContent = `Lighting: ${indoor ? 'Indoor ' : ''}ambient ${a.toFixed(2)} · ${lights} light${lights === 1 ? '' : 's'}`;
    }
    // Phase 7: bv2 bridge already populated chests/portals when
    // active_floor_id is null. Only fetch legacy builder entities
    // for a legacy floor.
    try {
      const afid = state.active_floor_id;
      if (afid) {
        const allChests = await api.get(`/api/map-builder/${SESSION_CODE}/chests`);
        mapCanvas.setMapChests((allChests || []).filter(c => c.floor_id === afid));
        const allPortals = await api.get(`/api/map-builder/${SESSION_CODE}/portals`);
        mapCanvas.setPortals((allPortals || []).filter(p => p.floor_id === afid));
      } else if (!state.bv2_active_location_id) {
        mapCanvas.setMapChests([]);
        mapCanvas.setPortals([]);
      }
      // else: bv2-sourced; leave bridge data alone.
    } catch {}
    mapGridEnabled = state.grid_enabled;
    mapFogEnabled = state.fog_enabled;
    $('#btn-toggle-grid').textContent = `Grid: ${mapGridEnabled ? 'ON' : 'OFF'}`;
    $('#btn-toggle-fog').textContent = `Fog: ${mapFogEnabled ? 'ON' : 'OFF'}`;
    const styleBtn = $('#btn-grid-style');
    if (styleBtn) {
      const t = state.grid_type || 'square';
      styleBtn.textContent = t === 'hex' ? 'Style: ⬡ Hex' : 'Style: ▢ Square';
    }
    refreshLocationSwitcher();
  } catch { /* no map yet */ }
}

let _mapFloorsCache = [];

async function loadMapFloorsForTab() {
  if (!SESSION_CODE) return;
  try {
    const state = await api.get(`/api/map/${SESSION_CODE}`);
    const activeMapId = state.active_map_id;
    if (!activeMapId) return;
    const floors = await api.get(`/api/map-builder/maps/${activeMapId}/floors`);
    _mapFloorsCache = floors;
    const sel = document.getElementById('map-floor-select');
    if (sel) {
      sel.innerHTML = floors.map(f =>
        `<option value="${f.id}" ${f.is_active ? 'selected' : ''}>${f.name}${f.is_active ? ' ★' : ''}</option>`
      ).join('');
    }
  } catch (e) { console.error('loadMapFloorsForTab', e); }
}


// NOTE: the `ws.on('map.updated', ...)` listener used to live here,
// but `ws` isn't declared until the WEBSOCKET section far below —
// touching it at this point crashed the whole script with a ReferenceError
// (TDZ), which silently disabled every later handler (buttons, tabs,
// table rendering, etc.). The listener is now registered alongside
// all the other `ws.on(...)` calls.

// Remove uploaded map
$('#btn-remove-map')?.addEventListener('click', async () => {
  if (!confirm('Remove the uploaded map image? (Builder floors, tokens and overlays will be kept.)')) return;
  try {
    const res = await fetch(`/api/map/${SESSION_CODE}/upload`, { method: 'DELETE' });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j && j.detail) msg = j.detail; } catch {}
      showToast('Remove failed: ' + msg);
      console.error('Remove map failed', res.status, msg);
      return;
    }
    const data = await res.json();
    if (mapCanvas) {
      mapCanvas.mapImage = null;
      mapCanvas._currentImageUrl = null;
    }
    await loadMapState();
    showToast(data.removed ? '🗑 Map removed' : 'No map to remove');
    addLog('map', 'Map image removed');
  } catch (e) {
    showToast('Remove failed: ' + (e.message || 'unknown'));
    console.error('Remove map exception', e);
  }
});

// Grid toggle
$('#btn-toggle-grid').addEventListener('click', async () => {
  mapGridEnabled = !mapGridEnabled;
  $('#btn-toggle-grid').textContent = `Grid: ${mapGridEnabled ? 'ON' : 'OFF'}`;
  mapCanvas.setGrid(mapCanvas.gridSize, mapGridEnabled, mapCanvas.gridType);
  await api.patch(`/api/map/${SESSION_CODE}/settings`, { grid_enabled: mapGridEnabled });
});

// Grid style toggle (square ↔ hex)
const _gridStyleBtn = $('#btn-grid-style');
if (_gridStyleBtn) {
  _gridStyleBtn.addEventListener('click', async () => {
    const next = (mapCanvas.gridType === 'hex') ? 'square' : 'hex';
    mapCanvas.setGrid(mapCanvas.gridSize, mapGridEnabled, next);
    _gridStyleBtn.textContent = next === 'hex' ? 'Style: ⬡ Hex' : 'Style: ▢ Square';
    try {
      await api.patch(`/api/map/${SESSION_CODE}/settings`, { grid_type: next });
    } catch (e) { console.warn('grid_type save failed', e); }
  });
}

// Fog toggle
$('#btn-toggle-fog').addEventListener('click', async () => {
  mapFogEnabled = !mapFogEnabled;
  $('#btn-toggle-fog').textContent = `Fog: ${mapFogEnabled ? 'ON' : 'OFF'}`;
  await api.patch(`/api/map/${SESSION_CODE}/settings`, { fog_enabled: mapFogEnabled });
  mapCanvas.fogEnabled = mapFogEnabled;
  mapCanvas.render();
});

// Fog paint
$('#btn-fog-paint').addEventListener('click', () => {
  mapFogPaintActive = !mapFogPaintActive;
  $('#btn-fog-paint').style.background = mapFogPaintActive ? 'var(--accent)' : '';
  $('#btn-fog-paint').style.color = mapFogPaintActive ? '#0a0908' : '';
  if (mapCanvas) mapCanvas.setFogPaintMode(mapFogPaintActive);
});

// Reveal all
$('#btn-fog-reveal-all').addEventListener('click', async () => {
  await api.post(`/api/map/${SESSION_CODE}/fog/reveal-all`, {});
  mapFogEnabled = false;
  $('#btn-toggle-fog').textContent = 'Fog: OFF';
  if (mapCanvas) { mapCanvas.fogEnabled = false; mapCanvas.revealedCells.clear(); mapCanvas.render(); }
  addLog('map', 'Fog of war revealed all');
});

// Reset fog
$('#btn-fog-reset').addEventListener('click', async () => {
  await api.post(`/api/map/${SESSION_CODE}/fog/reset`, {});
  mapFogEnabled = true;
  $('#btn-toggle-fog').textContent = 'Fog: ON';
  if (mapCanvas) { mapCanvas.fogEnabled = true; mapCanvas.revealedCells.clear(); mapCanvas.render(); }
  addLog('map', 'Fog of war reset');
});

// Center
$('#btn-center-map').addEventListener('click', () => {
  if (mapCanvas) mapCanvas.centerView();
});

// ── Stage 9: Drawing Toolbar ──────────────────────────────────
document.querySelectorAll('.map-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.map-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const mode = btn.dataset.mode || null;
    if (mapCanvas) mapCanvas.setDrawMode(mode);
    // If switching to draw mode, turn off fog paint
    if (mode) {
      mapFogPaintActive = false;
      $('#btn-fog-paint').style.background = '';
      $('#btn-fog-paint').style.color = '';
    }
  });
});

$('#draw-color')?.addEventListener('input', e => {
  if (mapCanvas) mapCanvas.drawColor = e.target.value;
});
$('#draw-width')?.addEventListener('input', e => {
  if (mapCanvas) mapCanvas.drawLineWidth = parseInt(e.target.value);
});
$('#draw-visible')?.addEventListener('change', e => {
  if (mapCanvas) mapCanvas.drawVisibleToPlayers = e.target.checked;
});
$('#btn-clear-drawings')?.addEventListener('click', async () => {
  if (!confirm('Clear all drawings from the map?')) return;
  await api.del(`/api/map/${SESSION_CODE}/drawings/all`);
  if (mapCanvas) { mapCanvas.drawings = []; mapCanvas.render(); }
  addLog('map', 'All drawings cleared');
  if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
    ws.ws.send(JSON.stringify({ type: 'map.drawing_deleted', all: true }));
  }
});

// Phase 5: wipe every wall/object in the current session.
$('#btn-clear-objects')?.addEventListener('click', async () => {
  if (!confirm('Clear all walls/objects from the map?')) return;
  await api.del(`/api/map/${SESSION_CODE}/objects/all`);
  if (mapCanvas) { mapCanvas.mapObjects = []; mapCanvas.render(); }
  addLog('map', 'All walls cleared');
});

// ── Marker Create/Edit Modal ──────────────────────────────────
function openMarkerModal(nx, ny, existing = null) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  const icons = ['📌', '⚠️', '🔒', '🏠', '⚔️', '💀', '🏰', '⭐', '🔥', '🌊', '🌲', '💎'];
  modal.innerHTML = `
    <div class="modal" style="width:340px">
      <h2 style="margin-bottom:10px">${existing ? 'Edit Marker' : 'Place Marker'}</h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        ${icons.map(ic => `<button class="btn btn-ghost btn-xs marker-icon-pick" data-icon="${ic}" style="font-size:1.2rem;${(existing?.icon || '📌') === ic ? 'background:var(--accent);color:#0a0908' : ''}">${ic}</button>`).join('')}
      </div>
      <input type="text" id="marker-label" value="${existing?.label || ''}" placeholder="Label" style="width:100%;font-size:0.82rem;margin-bottom:6px">
      <textarea id="marker-desc" placeholder="Description" rows="2" style="width:100%;font-size:0.78rem;margin-bottom:6px">${existing?.description || ''}</textarea>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <input type="color" id="marker-color" value="${existing?.color || '#ff0000'}" style="width:30px;height:24px;border:none;cursor:pointer">
        <label style="font-size:0.72rem;display:flex;align-items:center;gap:4px">
          <input type="checkbox" id="marker-visible" ${existing?.visible_to_players ? 'checked' : ''}> Visible to players
        </label>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-primary btn-sm" id="btn-marker-save" style="flex:1">${existing ? 'Update' : 'Place'}</button>
        ${existing ? '<button class="btn btn-danger btn-sm" id="btn-marker-del">Delete</button>' : ''}
        <button class="btn btn-ghost btn-sm" id="btn-marker-close">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  let selectedIcon = existing?.icon || '📌';
  modal.querySelectorAll('.marker-icon-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.querySelectorAll('.marker-icon-pick').forEach(b => { b.style.background = ''; b.style.color = ''; });
      btn.style.background = 'var(--accent)'; btn.style.color = '#0a0908';
      selectedIcon = btn.dataset.icon;
    });
  });

  modal.querySelector('#btn-marker-close').addEventListener('click', () => modal.remove());
  modal.querySelector('#btn-marker-del')?.addEventListener('click', async () => {
    await api.del(`/api/map/markers/${existing.id}`);
    mapCanvas.markers = mapCanvas.markers.filter(m => m.id !== existing.id);
    mapCanvas.render();
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({ type: 'map.marker_deleted', marker_id: existing.id }));
    }
    modal.remove();
  });

  modal.querySelector('#btn-marker-save').addEventListener('click', async () => {
    const payload = {
      x: nx, y: ny,
      label: modal.querySelector('#marker-label').value.trim(),
      description: modal.querySelector('#marker-desc').value.trim(),
      icon: selectedIcon,
      color: modal.querySelector('#marker-color').value,
      visible_to_players: modal.querySelector('#marker-visible').checked,
      marker_type: 'custom',
    };
    try {
      let res;
      if (existing) {
        res = await api.put(`/api/map/markers/${existing.id}`, payload);
        const idx = mapCanvas.markers.findIndex(m => m.id === existing.id);
        if (idx >= 0) mapCanvas.markers[idx] = res;
      } else {
        res = await api.post(`/api/map/${SESSION_CODE}/markers`, payload);
        mapCanvas.markers.push(res);
      }
      mapCanvas.render();
      addLog('map', `Marker ${existing ? 'updated' : 'placed'}: ${res.label || res.icon}`);
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({ type: existing ? 'map.marker_updated' : 'map.marker_added', marker: res }));
      }
      modal.remove();
    } catch { showToast('Failed to save marker'); }
  });
}

// ── Token Right-Click Context Menu ────────────────────────────
function openTokenContextMenu(token, cx, cy) {
  // Remove any existing context menu
  document.querySelectorAll('.token-ctx-menu').forEach(el => el.remove());
  const menu = document.createElement('div');
  menu.className = 'token-ctx-menu';
  menu.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;background:var(--bg-surface-2);border:1px solid var(--border);border-radius:8px;padding:4px 0;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.4);min-width:160px`;
  // Phase 6: portrait upload / clear. Labels flip depending on whether
  // the token already has an image attached.
  const hasPortrait = !!token.token_image_url;
  menu.innerHTML = `
    <div class="ctx-item" data-action="edit" style="padding:6px 14px;font-size:0.78rem;cursor:pointer;display:flex;gap:6px;align-items:center">🎨 Edit Token</div>
    <div class="ctx-item" data-action="portrait" style="padding:6px 14px;font-size:0.78rem;cursor:pointer;display:flex;gap:6px;align-items:center">🖼️ ${hasPortrait ? 'Replace' : 'Upload'} Portrait</div>
    ${hasPortrait ? `<div class="ctx-item" data-action="portrait-clear" style="padding:6px 14px;font-size:0.78rem;cursor:pointer;display:flex;gap:6px;align-items:center">🗑️ Remove Portrait</div>` : ''}
    <div style="height:1px;background:var(--border);margin:2px 0"></div>
    ${token.is_npc ? `<div class="ctx-item" data-action="control-panel" style="padding:6px 14px;font-size:0.78rem;cursor:pointer;display:flex;gap:6px;align-items:center">🎮 Control Panel</div>` : ''}
    <div class="ctx-item" data-action="hide" style="padding:6px 14px;font-size:0.78rem;cursor:pointer;display:flex;gap:6px;align-items:center">${token.visible ? '👁️‍🗨️ Hide' : '👁️ Show'} on Map</div>
    <div class="ctx-item" data-action="remove" style="padding:6px 14px;font-size:0.78rem;cursor:pointer;display:flex;gap:6px;align-items:center">❌ Remove from Map</div>
    <div style="height:1px;background:var(--border);margin:2px 0"></div>
    <div class="ctx-item" data-action="select" style="padding:6px 14px;font-size:0.78rem;cursor:pointer;display:flex;gap:6px;align-items:center">📋 Select Character</div>
  `;
  document.body.appendChild(menu);

  // Hover styling
  menu.querySelectorAll('.ctx-item').forEach(item => {
    item.addEventListener('mouseenter', () => item.style.background = 'var(--accent)20');
    item.addEventListener('mouseleave', () => item.style.background = '');
  });

  const close = () => menu.remove();
  setTimeout(() => document.addEventListener('click', close, { once: true }), 10);

  menu.querySelectorAll('.ctx-item').forEach(item => {
    item.addEventListener('click', async () => {
      const action = item.dataset.action;
      if (action === 'edit') {
        openTokenEditModal(token);
      } else if (action === 'portrait') {
        // Phase 6: trigger a hidden file input and POST to the portrait
        // upload endpoint. The server broadcasts `map.updated` which
        // refreshes the canvas so the new face appears automatically.
        uploadTokenPortrait(token.character_id);
      } else if (action === 'portrait-clear') {
        if (!confirm('Remove portrait from this token?')) { close(); return; }
        try {
          await api.del(`/api/map/token-image/${token.character_id}`);
          addLog('map', `Portrait cleared for ${token.name}`);
        } catch { showToast('Failed to clear portrait'); }
      } else if (action === 'hide') {
        await api.patch(`/api/characters/${token.character_id}`, { is_visible_on_map: !token.visible });
        token.visible = !token.visible;
        mapCanvas.render();
      } else if (action === 'remove') {
        await api.patch(`/api/map/token/${token.character_id}`, { x: null, y: null });
        token.x = null; token.y = null;
        mapCanvas.render();
      } else if (action === 'control-panel') {
        openNpcControlPanel(token.character_id);
      } else if (action === 'select') {
        selectCharacter(token.character_id);
      }
      close();
    });
  });
}

// Phase 9 Round 2: door toggle context menu (GM only)
function openDoorContextMenu(col, row, isOpen, cx, cy) {
  document.querySelectorAll('.token-ctx-menu').forEach(el => el.remove());
  const menu = document.createElement('div');
  menu.className = 'token-ctx-menu';
  menu.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;background:var(--bg-surface-2);border:1px solid var(--border);border-radius:8px;padding:4px 0;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.4);min-width:160px`;
  menu.innerHTML = `
    <div class="ctx-item" data-action="toggle" style="padding:6px 14px;font-size:0.78rem;cursor:pointer;display:flex;gap:6px;align-items:center">${isOpen ? 'Close Door' : 'Open Door'}</div>
  `;
  document.body.appendChild(menu);
  menu.querySelectorAll('.ctx-item').forEach(item => {
    item.addEventListener('mouseenter', () => item.style.background = 'var(--accent)20');
    item.addEventListener('mouseleave', () => item.style.background = '');
  });
  const close = () => menu.remove();
  setTimeout(() => document.addEventListener('click', close, { once: true }), 10);
  menu.querySelectorAll('.ctx-item').forEach(item => {
    item.addEventListener('click', async () => {
      const action = item.dataset.action;
      if (action === 'toggle' && gmBv2LocationId) {
        const key = `${col},${row}`;
        const nextOpen = !isOpen;
        try {
          await api.patch(`/api/builder-v2/locations/${gmBv2LocationId}/tiles`, {
            set: [{ col, row, tile_type: 'door', is_open: nextOpen }],
            erase: [],
          });
          if (mapCanvas && mapCanvas.tiles && mapCanvas.tiles[key]) {
            mapCanvas.tiles[key].is_open = nextOpen;
          }
          mapCanvas.render();
          addLog('map', `Door ${col},${row} ${nextOpen ? 'opened' : 'closed'}`);
        } catch { showToast('Failed to toggle door'); }
      }
      close();
    });
  });
}

// Phase 6: upload flow — spawns a temporary <input type=file>, sends
// the selected file to the portrait endpoint, and relies on the WS
// `map.updated` broadcast to refresh everyone's canvases.
function uploadTokenPortrait(characterId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(`/api/map/token-image/${characterId}`, { method: 'POST', body: fd });
      if (!res.ok) { showToast('Portrait upload failed'); return; }
      addLog('map', `Portrait uploaded for token ${characterId}`);
    } catch { showToast('Portrait upload failed'); }
  });
  input.click();
}

function openTokenEditModal(token) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="width:300px">
      <h2 style="margin-bottom:10px">Edit Token: ${token.name}</h2>
      <div style="margin-bottom:8px">
        <label style="font-size:0.72rem;color:var(--text-muted)">Color:</label>
        <input type="color" id="token-edit-color" value="${token.color || '#c08a2a'}" style="width:50px;height:28px;border:none;cursor:pointer">
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" id="btn-token-save" style="flex:1">Save</button>
        <button class="btn btn-ghost btn-sm" id="btn-token-cancel" style="flex:1">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#btn-token-cancel').addEventListener('click', () => modal.remove());
  modal.querySelector('#btn-token-save').addEventListener('click', async () => {
    const color = modal.querySelector('#token-edit-color').value;
    await api.patch(`/api/characters/${token.character_id}`, { token_color: color });
    token.color = color;
    mapCanvas.render();
    modal.remove();
  });
}

// Phase 11 R3: location switcher dropdown in Map tab toolbar.
async function refreshLocationSwitcher() {
  const sel = document.getElementById('map-location-switcher');
  if (!sel) return;
  try {
    const maps = await api.get(`/api/builder-v2/sessions/${SESSION_CODE}/maps`);
    const activeMap = maps.find(m => m.is_active);
    if (!activeMap) {
      sel.innerHTML = '<option value="">— No active map —</option>';
      return;
    }
    const locs = await api.get(`/api/builder-v2/maps/${activeMap.id}/locations`);
    sel.innerHTML = '';
    for (const loc of locs) {
      const opt = document.createElement('option');
      opt.value = loc.id;
      opt.textContent = (loc.name || `Location ${loc.id}`) +
                        (loc.is_active ? ' (active)' : '');
      if (loc.is_active) opt.selected = true;
      sel.appendChild(opt);
    }
  } catch { /* no bv2 data yet */ }
}

// Wire the switcher — activating a location broadcasts
// bv2.location_activated which already triggers loadMapState().
document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('map-location-switcher');
  if (!sel) return;
  sel.addEventListener('change', async (e) => {
    const locId = e.target.value;
    if (!locId) return;
    await api.post(`/api/builder-v2/locations/${locId}/activate`);
  });
});

// ══════════════════════════════════════════════════════════════
