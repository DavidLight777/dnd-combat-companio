// ════════════════════════════════════════════════════════
// Map / battle grid (Phase 1)
// Source: player-app.js lines 1615-1926
// ════════════════════════════════════════════════════════

// MAP / BATTLE GRID  (Rework v3 Phase 1)
// ══════════════════════════════════════════════════════════════
// The player now has two canvases of the same map:
//   • `playerMainGrid` — always-on, embedded in the Main tab (primary view).
//   • `playerMapCanvas` — legacy modal, opened on demand for a fullscreen
//     look. Both are fed from a single `loadPlayerMapState()` so they
//     never drift; every WS map event fans out to both.
// Token click on the main grid selects it as the combat target (same
// `selectedTargetId` path as the old chip cards used), so the Actions
// panel keeps working without any changes downstream.
let playerMapCanvas = null;  // modal fullscreen
let playerMainGrid  = null;  // always-on, in Main tab
let _lastMapState   = null;  // cached for re-renders after tab switch

// Iterate both canvases in one place.
function _eachMapCanvas(fn) {
  if (playerMainGrid)  fn(playerMainGrid);
  if (playerMapCanvas) fn(playerMapCanvas);
}

// Apply a freshly fetched /api/map state to a canvas (or all of them).
async function _applyMapStateTo(canvas, state) {
  if (!canvas || !state) return;
  if (state.has_map && state.image_url) {
    try { await canvas.loadImage(state.image_url); } catch {}
    canvas.setGrid(state.grid_size, state.grid_enabled, state.grid_type || 'square');
    canvas.setFog(state.fog_enabled, state.revealed_cells);
  } else {
    // No map yet — still render an empty grid so the player sees the
    // spatial surface. Use floor tile_size / bounds if available.
    const tsz = state.active_floor_tile_size || 50;
    const cols = state.active_floor_cols || 40;
    const rows = state.active_floor_rows || 30;
    canvas.mapImage = null;
    canvas.mapWidth  = cols * tsz;
    canvas.mapHeight = rows * tsz;
    canvas.setGrid(tsz, true, state.active_floor_grid_type || 'square');
    canvas.setFog(false, []);
    canvas._autoFitIfChanged();
  }
  canvas.setTokens(state.tokens || []);
  canvas.setDrawings(state._drawings || canvas.drawings || []);
  canvas.setMarkers(state._markers  || canvas.markers  || []);
  // Phase 5: walls / zones. Filter server-side-hidden objects out
  // on the client too as a belt-and-suspenders measure (the GM may
  // flip visible_to_players).
  const objs = (state._objects || canvas.mapObjects || [])
    .filter(o => o.visible_to_players !== false);
  canvas.setObjects(objs);
  // Map Builder: tiles + traps from state (if loaded via /api/map/{code})
  canvas.setTiles(state.active_floor_tiles || {}, state.active_floor_grid_type || 'square');
  canvas.setTraps((state._traps || []).filter(t => !t.is_hidden));
  canvas.setMapChests(state._mapChests || []);
  canvas.setPortals(state._portals || []);
  // Phase 8: bv2 lighting + edges + ambient
  canvas.setAmbientLight(state.bv2_ambient_light ?? 1.0);
  canvas.setIndoor(state.bv2_is_indoor ?? false);
  canvas.setLights(state.bv2_lights || []);
  canvas.setEdges(state.bv2_edges || []);
  canvas.render();
}

function _fitPlayerCanvasToTiles(canvas) {
  if (!canvas || !canvas.tiles) return;
  const keys = Object.keys(canvas.tiles);
  if (!keys.length) return;
  const gs = canvas.gridSize || 50;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  if (canvas.tileGridType === 'hex') {
    for (const k of keys) {
      const [c, r] = k.split(',').map(Number);
      // odd-r offset matching bv2 builder
      const xOff = (r & 1) ? gs / 2 : 0;
      const x = c * gs + xOff;
      const y = r * gs * (Math.sqrt(3) / 2);
      if (x < minX) minX = x; if (x > maxX) maxX = x + gs;
      if (y < minY) minY = y; if (y > maxY) maxY = y + gs;
    }
  } else {
    for (const k of keys) {
      const [c, r] = k.split(',').map(Number);
      const x = c * gs, y = r * gs;
      if (x < minX) minX = x; if (x > maxX) maxX = x + gs;
      if (y < minY) minY = y; if (y > maxY) maxY = y + gs;
    }
  }
  const pad = gs * 2;
  const bw = (maxX - minX) + pad * 2;
  const bh = (maxY - minY) + pad * 2;
  const sx = canvas.canvas.width / bw;
  const sy = canvas.canvas.height / bh;
  canvas.scale = Math.min(sx, sy);
  canvas.offsetX = -(minX - pad) * canvas.scale + (canvas.canvas.width - bw * canvas.scale) / 2;
  canvas.offsetY = -(minY - pad) * canvas.scale + (canvas.canvas.height - bh * canvas.scale) / 2;
}

// Load map state once and push to every mounted canvas.
async function loadPlayerMapState() {
  let state;
  try {
    const charParam = (CHAR_ID != null) ? `?character_id=${CHAR_ID}` : '';
    state = await api.get(`/api/map/${SESSION_CODE}${charParam}`);
  } catch {
    return;
  }
  // Fetch overlays in parallel; failure is fine (feature may be off).
  try {
    const ov = await api.get(`/api/map/${SESSION_CODE}/overlays`);
    state._drawings = ov.drawings || [];
    state._markers  = ov.markers  || [];
    state._objects  = ov.objects  || [];
    state._traps    = ov.traps    || [];
  } catch {
    state._drawings = [];
    state._markers  = [];
    state._objects  = [];
    state._traps    = [];
  }
  // Phase 7: bv2 bridge already populated _mapChests / _portals
  // when active_floor_id is null (bv2-sourced state). Only fetch
  // legacy map-builder chests/portals when a legacy floor is active.
  try {
    const afid = state.active_floor_id;
    if (afid) {
      const allChests = await api.get(`/api/map-builder/${SESSION_CODE}/chests`);
      state._mapChests = (allChests || []).filter(c => c.floor_id === afid && !c.is_hidden);
      const allPortals = await api.get(`/api/map-builder/${SESSION_CODE}/portals`);
      state._portals = (allPortals || []).filter(p => p.floor_id === afid);
    } else if (!state.bv2_active_location_id) {
      // No legacy floor AND no bv2 source — clear them.
      state._mapChests = [];
      state._portals = [];
    }
    // else: bv2-sourced; leave the bridge-provided arrays alone.
  } catch {
    if (!state.bv2_active_location_id) {
      state._mapChests = [];
      state._portals = [];
    }
  }
  _lastMapState = state;
  // Update the empty-state overlay on the main grid.
  const emptyEl = document.getElementById('player-grid-empty');
  if (emptyEl) emptyEl.style.display = state.has_map ? 'none' : 'flex';
  const statusEl = document.getElementById('player-grid-status');
  if (statusEl) {
    const n = (state.tokens || []).filter(t => t.visible).length;
    statusEl.textContent = state.has_map
      ? `${n} token${n === 1 ? '' : 's'}`
      : 'no map';
  }
  // Apply to each live canvas.
  if (playerMainGrid)  await _applyMapStateTo(playerMainGrid,  state);
  if (playerMapCanvas) await _applyMapStateTo(playerMapCanvas, state);
  // Phase 4: once the fresh tokens are on-canvas, push the updated
  // speed/movement numbers into the overlay + HUD.
  if (typeof _refreshMovementBudget === 'function') _refreshMovementBudget();
}

// ── Phase 2: player moves own token ─────────────────────────────
// Wiring helper shared by every player MapCanvas (main + modal). Fires
// on mouseup after a real drag. MapCanvas has already snapped x/y to
// the nearest cell centre, so we just PATCH with the caller token for
// the ownership check on the server.
async function _sendOwnTokenMove(charId, x, y) {
  try {
    const res = await fetch(`/api/map/token/${charId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y, player_token: PLAYER_TOKEN }),
    });
    // Phase 3: if the server rejected the move (combat-turn gating or
    // ownership mismatch), surface a toast and refetch the authoritative
    // position so the token snaps back visually. This closes the "move
    // locally, silently fail on server" gap.
    if (!res.ok) {
      let msg = 'Move rejected';
      try { const j = await res.json(); if (j && j.detail) msg = j.detail; } catch {}
      showToast(`⛔ ${msg}`);
      loadPlayerMapState();
      return;
    }
  } catch (e) {
    console.warn('token move failed:', e);
    return;
  }

  // Phase 8: update FOV via bv2 visit endpoint after a successful move.
  if (_lastMapState && _lastMapState.bv2_active_location_id && CHAR_ID != null) {
    try {
      const locId = _lastMapState.bv2_active_location_id;
      const cols = _lastMapState.active_floor_cols || 1;
      const rows = _lastMapState.active_floor_rows || 1;
      const col = Math.min(cols - 1, Math.max(0, Math.floor(x * cols)));
      const row = Math.min(rows - 1, Math.max(0, Math.floor(y * rows)));
      const ownToken = (_lastMapState.tokens || []).find(t => t.character_id === CHAR_ID);
      const sight = ownToken ? (ownToken.sight_range_cells ?? 8) : 8;
      let visibleSet = new Set();
      if (playerMainGrid && playerMainGrid.computeVisibleCells) {
        visibleSet = playerMainGrid.computeVisibleCells(col, row, sight);
      }
      const visibleCells = Array.from(visibleSet).map(s => s.split(',').map(Number));
      await fetch(`/api/builder-v2/locations/${locId}/visit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character_id: CHAR_ID, visible_cells: visibleCells }),
      });
      // Merge into local revealedCells for instant UI feedback.
      _eachMapCanvas(c => {
        if (c.revealedCells) {
          for (const key of visibleSet) c.revealedCells.add(key);
          c.render();
        }
      });
    } catch (e) {
      console.warn('bv2 visit update failed:', e);
    }
  }
}

// ── Phase 3: keep MapCanvas in sync with combat state ──────────
// `canPlayerMove` is recomputed after every event that could change
// whose turn it is: combat started/ended, turn advanced, character
// downed, banner refreshed from HTTP, etc.
function _computeCanPlayerMove() {
  // No combat → freely move.
  if (!playerCombat || playerCombat.status !== 'active') return true;
  // Combat active → only when WE are the current actor.
  const curCharId = _currentTurnCharacterId();
  return curCharId === CHAR_ID;
}

function _refreshMovementGating() {
  const can = _computeCanPlayerMove();
  _eachMapCanvas(c => c.setCanPlayerMove(can));
  _refreshMovementBudget();
}

// Phase 4: extract own-token's speed/movement from the cached map
// state and feed it to every canvas + the HUD label in the grid
// panel. Overlay is ONLY shown during combat on our own turn; outside
// those conditions we pass (null, null) to hide it.
function _refreshMovementBudget() {
  let total = null, left = null;
  if (_lastMapState && _computeCanPlayerMove()
      && playerCombat && playerCombat.status === 'active') {
    const own = (_lastMapState.tokens || []).find(t => t.character_id === CHAR_ID);
    if (own) {
      total = Number(own.speed_total ?? 0);
      left  = Number(own.movement_left ?? total);
    }
  }
  _eachMapCanvas(c => c.setMovementBudget(left, total));
  // HUD text in the grid panel header.
  const hud = document.getElementById('player-grid-status');
  if (hud) {
    if (total != null && left != null) {
      hud.textContent = `${Math.floor(left)}/${total} cells left`;
    } else if (_lastMapState && _lastMapState.has_map) {
      const n = (_lastMapState.tokens || []).filter(t => t.visible).length;
      hud.textContent = `${n} token${n === 1 ? '' : 's'}`;
    }
  }
}

// Common constructor options shared by both player canvases.
function _playerCanvasOptions() {
  return {
    role: 'player',
    sessionCode: SESSION_CODE,
    // Phase 2: own-token drag.
    ownCharacterId: CHAR_ID,
    onTokenMove: _sendOwnTokenMove,
    // Phase 1: clicking a token acts as a target selector. Tapping the
    // same token again (or the Clear button) unselects.
    onTokenClick: (token) => {
      const tid = token.character_id;
      if (!tid || tid === parseInt(CHAR_ID)) return;  // can't target self via grid
      selectedTargetId = (selectedTargetId === tid) ? null : tid;
      if (typeof renderTableView  === 'function') renderTableView();
      if (typeof updateTargetInfo === 'function') updateTargetInfo();
      if (typeof renderActionMenu === 'function') renderActionMenu();
    },
    onMapChestClick: (chest) => openPlayerChestModal(chest),
    onPortalClick: (portal) => openPlayerPortalModal(portal),
  };
}

// ── Main-tab battle grid: init eagerly on page load ─────────────
function initPlayerMainGrid() {
  const canvasEl = document.getElementById('player-grid-canvas');
  if (!canvasEl || playerMainGrid) return;
  playerMainGrid = new MapCanvas(canvasEl, _playerCanvasOptions());
  // First paint with whatever's cached; real data arrives from loadPlayerMapState.
  playerMainGrid._resize();
  loadPlayerMapState();
}

// Fit / expand controls on the main grid panel.
(() => {
  const fitBtn = document.getElementById('btn-grid-fit');
  if (fitBtn) fitBtn.addEventListener('click', () => {
    if (playerMainGrid) { playerMainGrid.centerView(); }
  });
  const expandBtn = document.getElementById('btn-grid-expand');
  if (expandBtn) expandBtn.addEventListener('click', () => {
    const wrap = document.getElementById('player-grid-wrap');
    if (!wrap) return;
    const tall = wrap.dataset.tall === '1';
    wrap.style.height = tall ? '420px' : '720px';
    wrap.dataset.tall = tall ? '0' : '1';
    if (playerMainGrid) { playerMainGrid._resize(); playerMainGrid.centerView(); }
  });
  // Phase 6: player uploads their OWN token portrait. Reuses the same
  // HTTP endpoint the GM uses — the server is trust-based today, so
  // either role can hit it; a future phase will add a player_token
  // check. Spawns a hidden file input and relies on the WS
  // `map.updated` broadcast to refresh everyone's canvases.
  const portraitBtn = document.getElementById('btn-player-portrait');
  if (portraitBtn) portraitBtn.addEventListener('click', () => {
    if (CHAR_ID == null) return;
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
        const res = await fetch(`/api/map/token-image/${CHAR_ID}`, { method: 'POST', body: fd });
        if (!res.ok) { showToast('Portrait upload failed'); return; }
        showToast('Portrait updated');
      } catch { showToast('Portrait upload failed'); }
    });
    input.click();
  });
})();

// ── Fullscreen modal (kept as a convenience) ────────────────────
$('#btn-open-map').addEventListener('click', async () => {
  const modal = $('#map-modal');
  modal.style.display = 'flex';
  if (!playerMapCanvas) {
    // Reuse the exact same options (role, ownCharacterId, callbacks)
    // as the embedded Main-tab canvas so both support Phase 2 drag.
    playerMapCanvas = new MapCanvas($('#player-map-canvas'), _playerCanvasOptions());
  }
  playerMapCanvas._resize();
  await loadPlayerMapState();
});

$('#btn-close-map').addEventListener('click', () => {
  $('#map-modal').style.display = 'none';
});

// Phase 7 bridge: refresh map when GM activates a bv2 map / location.
// The legacy `map.updated` event already triggers loadPlayerMapState
// elsewhere; we only add the bv2 events.
if (typeof ws !== 'undefined' && ws && typeof ws.on === 'function') {
  ws.on('bv2.map_activated',      () => { loadPlayerMapState(); });
  ws.on('bv2.location_activated', () => { loadPlayerMapState(); });
}

// ══════════════════════════════════════════════════════════════
