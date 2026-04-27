// ════════════════════════════════════════════════════════════
// Map Builder v2 — editor controller. Wires together selectors,
// brushes, auto-save and the Apply button.
// ════════════════════════════════════════════════════════════

(function () {
  const S = window.bv2;
  const SAVE_DEBOUNCE_MS = 500;

  // ── Save indicator ────────────────────────────────────────
  function setIndicator(text, kind) {
    if (!S.saveIndicator) return;
    S.saveIndicator.textContent = text;
    S.saveIndicator.style.color = (
      kind === 'error' ? 'var(--accent-red)' :
      kind === 'ok'    ? 'var(--accent-green)' :
      'var(--text-muted)'
    );
  }

  // ── Auto-save loop ────────────────────────────────────────
  function queueSave(col, row, brush) {
    if (!S.currentLocId) return;
    const key = `${col},${row}`;
    if (brush === 'erase') {
      S.pendingSet.delete(key);
      S.pendingErase.add(key);
    } else {
      S.pendingErase.delete(key);
      S.pendingSet.set(key, brush);
    }
    setIndicator('● unsaved', '');
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  }

  async function flushSave() {
    if (!S.currentLocId) return;
    if (!S.pendingSet.size && !S.pendingErase.size) return;

    const setArr = [...S.pendingSet.entries()].map(([k, t]) => {
      const [col, row] = k.split(',').map(Number);
      return { col, row, tile_type: t };
    });
    const eraseArr = [...S.pendingErase].map(k => {
      const [col, row] = k.split(',').map(Number);
      return { col, row };
    });

    // Reset queues *before* the await — if more strokes happen while
    // the request is in flight they should accumulate as a fresh batch.
    S.pendingSet.clear();
    S.pendingErase.clear();

    setIndicator('saving…', '');
    S.suppressNextWs = true;
    try {
      await S.api.patchTiles(S.currentLocId, setArr, eraseArr);
      setIndicator('✓ saved', 'ok');
    } catch (e) {
      console.error('bv2 save failed', e);
      setIndicator('save failed', 'error');
      // Re-queue so the user doesn't lose their strokes
      for (const t of setArr) S.pendingSet.set(`${t.col},${t.row}`, t.tile_type);
      for (const t of eraseArr) S.pendingErase.add(`${t.col},${t.row}`);
    } finally {
      // Allow the WS event from the next mutation to come through
      setTimeout(() => { S.suppressNextWs = false; }, 250);
    }
  }

  // ── Map list ──────────────────────────────────────────────
  async function loadMaps() {
    try {
      S.maps = await S.api.listMaps();
    } catch (e) {
      console.error('bv2 listMaps', e);
      S.maps = [];
    }
    renderMapSelect();
    if (S.maps.length && !S.currentMapId) {
      // Prefer active, else first
      const active = S.maps.find(m => m.is_active);
      S.currentMapId = (active || S.maps[0]).id;
    }
    if (S.currentMapId) await loadLocations();
    else updateEmptyMsg();
  }

  function renderMapSelect() {
    const sel = document.getElementById('bv2-map-select');
    if (!sel) return;
    if (!S.maps.length) {
      sel.innerHTML = '<option disabled>— no maps —</option>';
      return;
    }
    sel.innerHTML = S.maps.map(m =>
      `<option value="${m.id}" ${m.id === S.currentMapId ? 'selected' : ''}>${escapeHtml(m.name)}${m.is_active ? ' ★' : ''}</option>`
    ).join('');
  }

  // ── Locations ─────────────────────────────────────────────
  async function loadLocations() {
    if (!S.currentMapId) { S.locations = []; renderLocSelect(); return; }
    try {
      S.locations = await S.api.listLocs(S.currentMapId);
    } catch (e) {
      console.error('bv2 listLocs', e);
      S.locations = [];
    }
    renderLocSelect();
    if (S.locations.length) {
      // Prefer active for this map, else current selection if still valid, else first
      const active = S.locations.find(l => l.is_active);
      const stillValid = S.locations.find(l => l.id === S.currentLocId);
      const target = active || stillValid || S.locations[0];
      await loadLocation(target.id);
    } else {
      S.currentLocId = null;
      S.view && S.view.loadLocation({ location: null, tiles: [] });
      updateEmptyMsg();
    }
  }

  function renderLocSelect() {
    const sel = document.getElementById('bv2-loc-select');
    if (!sel) return;
    if (!S.locations.length) {
      sel.innerHTML = '<option disabled>— no locations —</option>';
      return;
    }
    sel.innerHTML = S.locations.map(l =>
      `<option value="${l.id}" ${l.id === S.currentLocId ? 'selected' : ''}>${escapeHtml(l.name)}${l.is_active ? ' ▶' : ''}</option>`
    ).join('');
  }

  async function loadLocation(locId) {
    S.currentLocId = locId;
    // Cancel pending save from the previous location — new location, fresh state.
    clearTimeout(S.saveTimer);
    S.pendingSet.clear();
    S.pendingErase.clear();
    setIndicator('', '');
    try {
      const payload = await S.api.getLoc(locId);
      S.view.loadLocation(payload);
      // Sync sidebar inputs with loaded settings
      const loc = payload.location;
      const ts = document.getElementById('bv2-tile-size');
      const tsv = document.getElementById('bv2-tile-size-val');
      const c = document.getElementById('bv2-cols');
      const r = document.getElementById('bv2-rows');
      const gtBtn = document.getElementById('bv2-btn-grid-type');
      if (ts)  ts.value = loc.tile_size;
      if (tsv) tsv.textContent = loc.tile_size;
      if (c)   c.value = loc.cols;
      if (r)   r.value = loc.rows;
      if (gtBtn) gtBtn.textContent = loc.grid_type === 'hex' ? '⬡ Hex Grid' : '▢ Square Grid';
      updateEmptyMsg();
      renderLocSelect();
    } catch (e) {
      console.error('bv2 getLoc', e);
    }
  }

  function updateEmptyMsg() {
    const el = document.getElementById('bv2-empty-msg');
    if (!el) return;
    el.style.display = S.currentLocId ? 'none' : 'flex';
  }

  // ── Map mutations ─────────────────────────────────────────
  async function createMap() {
    const name = prompt('Map name:', 'New Map');
    if (!name) return;
    try {
      const m = await S.api.createMap({ name: name.trim() });
      S.maps.push(m);
      S.currentMapId = m.id;
      S.currentLocId = null;
      renderMapSelect();
      // Auto-create first location so the user can start drawing right away
      await createLocation(/*silent*/ true);
    } catch (e) {
      console.error('bv2 createMap', e);
      alert('Failed to create map: ' + (e.message || e));
    }
  }

  async function deleteCurrentMap() {
    if (!S.currentMapId) return;
    const m = S.maps.find(x => x.id === S.currentMapId);
    if (!confirm(`Delete map "${m?.name || ''}" and all its locations?`)) return;
    try {
      await S.api.deleteMap(S.currentMapId);
      S.maps = S.maps.filter(x => x.id !== S.currentMapId);
      S.currentMapId = S.maps[0]?.id || null;
      S.currentLocId = null;
      renderMapSelect();
      if (S.currentMapId) await loadLocations();
      else { S.locations = []; renderLocSelect(); updateEmptyMsg(); S.view && S.view.loadLocation({ location: null, tiles: [] }); }
    } catch (e) {
      console.error('bv2 deleteMap', e);
    }
  }

  // ── Location mutations ────────────────────────────────────
  async function createLocation(silent) {
    if (!S.currentMapId) {
      alert('Create a Map first.');
      return;
    }
    const defaultName = `Location ${S.locations.length + 1}`;
    const name = silent ? defaultName : prompt('Location name:', defaultName);
    if (!name) return;
    try {
      const loc = await S.api.createLoc(S.currentMapId, { name: name.trim() });
      S.locations.push(loc);
      S.currentLocId = loc.id;
      renderLocSelect();
      await loadLocation(loc.id);
    } catch (e) {
      console.error('bv2 createLoc', e);
      alert('Failed to create location: ' + (e.message || e));
    }
  }

  async function deleteCurrentLocation() {
    if (!S.currentLocId) return;
    const loc = S.locations.find(x => x.id === S.currentLocId);
    if (!confirm(`Delete location "${loc?.name || ''}"?`)) return;
    try {
      await S.api.deleteLoc(S.currentLocId);
      S.locations = S.locations.filter(x => x.id !== S.currentLocId);
      S.currentLocId = S.locations[0]?.id || null;
      renderLocSelect();
      if (S.currentLocId) await loadLocation(S.currentLocId);
      else { S.view.loadLocation({ location: null, tiles: [] }); updateEmptyMsg(); }
    } catch (e) {
      console.error('bv2 deleteLoc', e);
    }
  }

  async function applyToGame() {
    if (!S.currentLocId) { alert('No location selected.'); return; }
    // Make sure pending strokes hit the server first
    await flushSave();
    try {
      await S.api.activateLoc(S.currentLocId);
      // Mark active in local state
      S.locations.forEach(l => { l.is_active = (l.id === S.currentLocId); });
      S.maps.forEach(m => { m.is_active = (m.id === S.currentMapId); });
      renderMapSelect();
      renderLocSelect();
      setIndicator('▶ applied to game', 'ok');
    } catch (e) {
      console.error('bv2 applyToGame', e);
      setIndicator('apply failed', 'error');
    }
  }

  // ── Settings (cols / rows / tile size / grid type) ────────
  let _settingsTimer = null;
  function queueSettingsSave(patch) {
    if (!S.currentLocId) return;
    clearTimeout(_settingsTimer);
    _settingsTimer = setTimeout(async () => {
      try {
        const updated = await S.api.updateLoc(S.currentLocId, patch);
        // Reflect server-clamped values back into local state + view
        const idx = S.locations.findIndex(l => l.id === updated.id);
        if (idx >= 0) S.locations[idx] = updated;
        S.view.location = updated;
        S.view.render();
      } catch (e) { console.error('bv2 update loc settings', e); }
    }, 350);
  }

  // ── Brush selection + hotkeys ─────────────────────────────
  function setBrush(b) {
    S.brush = b;
    document.querySelectorAll('.bv2-brush').forEach(el => {
      el.classList.toggle('active', el.dataset.brush === b);
    });
  }

  const HOTKEY_MAP = {
    '1': 'floor', '2': 'wall', '3': 'water', '4': 'lava',
    '5': 'pit', '6': 'door', '7': 'rough', 'e': 'erase', 'E': 'erase',
  };

  function onHotkey(e) {
    // Only react when the Builder v2 tab is active
    const tab = document.getElementById('tab-builder-v2');
    if (!tab || !tab.classList.contains('active')) return;
    if (e.target.matches('input, textarea, select')) return;
    const key = HOTKEY_MAP[e.key];
    if (key) { setBrush(key); e.preventDefault(); }
  }

  // ── Public init ───────────────────────────────────────────
  async function init() {
    const canvas = document.getElementById('bv2-canvas');
    if (!canvas) return;
    if (S.view) { S.view.resize(); return; }   // already inited

    S.saveIndicator = document.getElementById('bv2-save-indicator');

    S.view = new S.MapView(canvas, {
      mode: 'edit',
      getBrush: () => S.brush,
      onPaint: (col, row, brush) => queueSave(col, row, brush),
      onErase: (col, row)        => queueSave(col, row, 'erase'),
      onEntityClick: (ent, action) => {
        if (typeof S.openEntityModal === 'function') {
          if (action === 'delete') S.openEntityModal(ent, 'delete');
          else S.openEntityModal(ent, 'edit');
        }
      },
      onCellClick: (col, row, entityType) => {
        if (typeof S.openEntityModal === 'function') {
          S.openEntityModal(null, 'create', { col, row, entity_type: entityType });
        }
      },
    });

    // Brushes
    document.querySelectorAll('.bv2-brush').forEach(el => {
      el.addEventListener('click', () => setBrush(el.dataset.brush));
    });

    // Selectors
    document.getElementById('bv2-map-select')?.addEventListener('change', async e => {
      S.currentMapId = parseInt(e.target.value, 10);
      S.currentLocId = null;
      await loadLocations();
    });
    document.getElementById('bv2-loc-select')?.addEventListener('change', async e => {
      const id = parseInt(e.target.value, 10);
      await loadLocation(id);
    });

    // Buttons
    document.getElementById('bv2-btn-new-map')   ?.addEventListener('click', createMap);
    document.getElementById('bv2-btn-delete-map')?.addEventListener('click', deleteCurrentMap);
    document.getElementById('bv2-btn-new-loc')   ?.addEventListener('click', () => createLocation(false));
    document.getElementById('bv2-btn-delete-loc')?.addEventListener('click', deleteCurrentLocation);
    document.getElementById('bv2-btn-apply')     ?.addEventListener('click', applyToGame);
    document.getElementById('bv2-btn-clear')     ?.addEventListener('click', async () => {
      if (!S.currentLocId) return;
      if (!confirm('Clear ALL tiles on this location?')) return;
      try {
        await S.api.replaceTiles(S.currentLocId, []);
        S.view.clearTiles();
        setIndicator('cleared', 'ok');
      } catch (e) { console.error('bv2 clear', e); }
    });

    // Grid settings
    document.getElementById('bv2-tile-size')?.addEventListener('input', e => {
      let v = parseInt(e.target.value, 10);
      if (Number.isNaN(v)) v = 50;
      document.getElementById('bv2-tile-size-val').textContent = v;
      if (S.view.location) {
        S.view.location.tile_size = v;
        S.view.render();
      }
      queueSettingsSave({ tile_size: v });
    });
    document.getElementById('bv2-cols')?.addEventListener('input', e => {
      let v = parseInt(e.target.value, 10);
      if (Number.isNaN(v)) v = 40;
      v = Math.max(5, v);
      if (S.view.location) { S.view.location.cols = v; S.view.render(); }
      queueSettingsSave({ cols: v });
    });
    document.getElementById('bv2-rows')?.addEventListener('input', e => {
      let v = parseInt(e.target.value, 10);
      if (Number.isNaN(v)) v = 30;
      v = Math.max(5, v);
      if (S.view.location) { S.view.location.rows = v; S.view.render(); }
      queueSettingsSave({ rows: v });
    });
    document.getElementById('bv2-btn-grid-type')?.addEventListener('click', e => {
      if (!S.view.location) return;
      const next = S.view.location.grid_type === 'hex' ? 'square' : 'hex';
      S.view.location.grid_type = next;
      e.target.textContent = next === 'hex' ? '⬡ Hex Grid' : '▢ Square Grid';
      S.view.render();
      queueSettingsSave({ grid_type: next });
    });

    // Bounds resize from canvas drag handles
    S.view.canvas.addEventListener('bv2:bounds-resized-done', async e => {
      const { cols, rows, shift_col, shift_row } = e.detail;
      document.getElementById('bv2-cols').value = cols;
      document.getElementById('bv2-rows').value = rows;
      // Phase 8: negative-direction resize requires server-side shift.
      if (shift_col || shift_row) {
        try {
          await api.post(`/api/builder-v2/locations/${S.currentLocId}/shift`, {
            delta_col: shift_col,
            delta_row: shift_row,
          });
        } catch (err) {
          console.error('bv2 shift failed', err);
        }
      }
      queueSettingsSave({ cols, rows });
    });

    // Hotkeys
    document.addEventListener('keydown', onHotkey);

    // Initial load
    await loadMaps();
    setBrush(S.brush);
  }

  // Load on tab activation. Other gm tabs lazy-load their data the first
  // time the user clicks them — same here.
  document.addEventListener('click', e => {
    const tab = e.target.closest('.gm-tab');
    if (!tab || tab.dataset.tab !== 'builder-v2') return;
    // Defer one frame so the tab content is visible before we measure canvas
    requestAnimationFrame(() => init());
  });

  // Expose for WS module + debugging
  S.init = init;
  S.loadMaps = loadMaps;
  S.loadLocations = loadLocations;
  S.loadLocation = loadLocation;
  S.flushSave = flushSave;
})();
