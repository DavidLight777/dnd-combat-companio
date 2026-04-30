// ════════════════════════════════════════════════════════════
// Map Builder v2 — Light editor (Phase 4 + Phase 17 redesign).
// Floating draggable panel with sectioned layout and Preview button.
// ════════════════════════════════════════════════════════════

(function () {
  const S = window.bv2;

  const LIGHT_PRESETS = {
    torch:  { radius_cells: 4, color_hex: '#ffaa44', intensity: 1.0 },
    lamp:   { radius_cells: 6, color_hex: '#ffd9a0', intensity: 1.2 },
    magic:  { radius_cells: 5, color_hex: '#a855f7', intensity: 1.5 },
  };

  const PRESET_LABELS = {
    torch: 'Place torch',
    lamp:  'Place lamp',
    magic: 'Magic light',
  };

  // ── DOM helpers ───────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function openPanel() {
    const p = $('bv2-light-panel');
    if (p) p.classList.remove('hidden');
  }
  function closePanel() {
    const p = $('bv2-light-panel');
    if (p) p.classList.add('hidden');
    // Remove preview light
    if (_previewLightId && S.view && S.view.lights) {
      S.view.lights = S.view.lights.filter(l => l.id !== _previewLightId);
      _previewLightId = null;
      S.view.render();
    }
  }
  let _previewLightId = null;

  function _syncSliderLabels() {
    ['bv2-light-radius', 'bv2-light-bright', 'bv2-light-intensity'].forEach(id => {
      const el = $(id);
      if (el && el.nextElementSibling) el.nextElementSibling.textContent = el.value;
    });
  }

  function _updateLightPreview() {
    if (!S.view || !S.view.lights) return;
    const col = parseInt($('bv2-light-col').value, 10) || 0;
    const row = parseInt($('bv2-light-row').value, 10) || 0;
    const radius = parseFloat($('bv2-light-radius').value) ?? 4;
    const bright = parseFloat($('bv2-light-bright').value) ?? 0;
    const intensity = parseFloat($('bv2-light-intensity').value) ?? 1;
    const color = $('bv2-light-color').value || '#ffd9a0';
    const kind = $('bv2-light-kind').value || 'torch';

    if (!_previewLightId) _previewLightId = -Date.now();
    const existing = S.view.lights.find(l => l.id === _previewLightId);
    const payload = {
      id: _previewLightId,
      col, row,
      radius_cells: radius,
      bright_radius_cells: bright,
      intensity,
      color_hex: color,
      source_kind: kind,
    };
    if (existing) {
      Object.assign(existing, payload);
    } else {
      S.view.lights.push(payload);
    }
    S.view.render();
  }

  // ── Draggable panel ───────────────────────────────────────
  function _makeDraggable() {
    const panel = $('bv2-light-panel');
    const header = $('bv2-light-panel-header');
    if (!panel || !header) return;
    let isDragging = false, startX, startY, rect;
    header.addEventListener('mousedown', e => {
      isDragging = true;
      rect = panel.getBoundingClientRect();
      startX = e.clientX - rect.left;
      startY = e.clientY - rect.top;
      header.style.cursor = 'grabbing';
    });
    document.addEventListener('mousemove', e => {
      if (!isDragging) return;
      panel.style.left = (e.clientX - startX) + 'px';
      panel.style.top = (e.clientY - startY) + 'px';
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
      isDragging = false;
      header.style.cursor = 'grab';
    });
  }
  _makeDraggable();

  function showError(msg) { alert(msg); }

  // ── Render placed lights list ─────────────────────────────
  function renderLightList() {
    const listEl = $('bv2-light-list');
    if (!listEl) return;
    const lights = (S.view && S.view.lights) || [];
    if (!lights.length) {
      listEl.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:4px 0">No lights</div>';
      return;
    }
    listEl.innerHTML = lights.map(li => {
      const kind = li.source_kind || 'light';
      return `<div style="display:flex;align-items:center;gap:4px;padding:3px 0;border-bottom:1px solid var(--border)">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${li.color_hex}"></span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${kind} (${li.radius_cells})</span>
        <button class="btn-icon btn-xs" data-edit-light="${li.id}" title="Edit">✎</button>
        <button class="btn-icon btn-xs" data-del-light="${li.id}" title="Delete">🗑</button>
      </div>`;
    }).join('');

    listEl.querySelectorAll('[data-edit-light]').forEach(btn => {
      btn.addEventListener('click', () => {
        const li = lights.find(x => x.id === parseInt(btn.dataset.editLight, 10));
        if (li) openLightPanel(li, 'edit');
      });
    });
    listEl.querySelectorAll('[data-del-light]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.delLight, 10);
        if (!confirm('Delete this light?')) return;
        try { await S.api.deleteLight(id); } catch (e) {
          console.error('bv2 deleteLight', e);
          showError('Failed to delete light');
        }
      });
    });
  }

  // ── Public: open panel ────────────────────────────────────
  function openLightPanel(li, mode, createOpts) {
    if (!S.currentLocId) { showError('Select a location first.'); return; }

    const panel = $('bv2-light-panel');
    const title = $('bv2-light-panel-title');
    const lightIdEl = $('bv2-light-id');
    const colEl = $('bv2-light-col');
    const rowEl = $('bv2-light-row');
    const radiusEl = $('bv2-light-radius');
    const brightEl = $('bv2-light-bright');
    const colorEl = $('bv2-light-color');
    const intensityEl = $('bv2-light-intensity');
    const kindEl = $('bv2-light-kind');
    const deleteBtn = $('bv2-light-delete');

    if (mode === 'create') {
      title.textContent = 'New Light';
      lightIdEl.value = '';
      colEl.value = createOpts.col;
      rowEl.value = createOpts.row;
      const preset = LIGHT_PRESETS[createOpts.preset] || LIGHT_PRESETS.torch;
      radiusEl.value = preset.radius_cells;
      brightEl.value = '0';
      colorEl.value = preset.color_hex;
      intensityEl.value = preset.intensity;
      kindEl.value = createOpts.preset;
      if (deleteBtn) deleteBtn.style.display = 'none';
    } else {
      title.textContent = 'Edit Light';
      lightIdEl.value = li.id;
      colEl.value = li.col;
      rowEl.value = li.row;
      radiusEl.value = li.radius_cells;
      brightEl.value = (li.bright_radius_cells != null ? li.bright_radius_cells : 0);
      colorEl.value = li.color_hex;
      intensityEl.value = li.intensity;
      kindEl.value = li.source_kind;
      if (deleteBtn) deleteBtn.style.display = 'inline-flex';
    }
    _syncSliderLabels();
    panel.classList.remove('hidden');
  }

  // ── Save handler ──────────────────────────────────────────
  async function onSaveLight() {
    const id = $('bv2-light-id').value ? parseInt($('bv2-light-id').value, 10) : null;
    let col = parseInt($('bv2-light-col').value, 10);
    if (Number.isNaN(col)) col = 0;
    let row = parseInt($('bv2-light-row').value, 10);
    if (Number.isNaN(row)) row = 0;
    let radius = parseFloat($('bv2-light-radius').value);
    if (Number.isNaN(radius)) radius = 4;
    let bright = parseFloat($('bv2-light-bright').value);
    if (Number.isNaN(bright)) bright = 0;
    let intensity = parseFloat($('bv2-light-intensity').value);
    if (Number.isNaN(intensity)) intensity = 1.0;
    const body = {
      col: col,
      row: row,
      radius_cells: radius,
      bright_radius_cells: bright,
      color_hex: $('bv2-light-color').value || '#ffd9a0',
      intensity: intensity,
      source_kind: $('bv2-light-kind').value || 'torch',
    };
    try {
      if (id) {
        await S.api.updateLight(id, body);
        const idx = (S.view.lights || []).findIndex(l => l.id === id);
        if (idx >= 0) S.view.lights[idx] = { ...S.view.lights[idx], ...body, id };
      } else {
        if (!S.currentLocId) { showError('No location selected'); return; }
        const created = await S.api.createLight(S.currentLocId, body);
        if (created && created.id) {
          S.view.lights = S.view.lights || [];
          S.view.lights.push({ ...body, id: created.id });
        }
      }
      if (S.view) S.view.render();
      closePanel();
    } catch (e) {
      console.error('bv2 saveLight', e);
      showError('Failed to save light: ' + (e.message || e));
    }
  }

  // ── Wire panel events ─────────────────────────────────────
  document.addEventListener('click', e => {
    if (e.target.id === 'bv2-light-save') onSaveLight();
    if (e.target.id === 'bv2-light-cancel') closePanel();
    if (e.target.id === 'bv2-light-panel-close') closePanel();
    if (e.target.id === 'bv2-light-preview') _updateLightPreview();
    if (e.target.id === 'bv2-light-delete') {
      const id = $('bv2-light-id').value ? parseInt($('bv2-light-id').value, 10) : null;
      if (!id) return;
      if (!confirm('Delete this light?')) return;
      S.api.deleteLight(id).then(() => closePanel()).catch(e => {
        console.error('bv2 deleteLight', e);
        showError('Failed to delete light');
      });
    }
  });

  // Slider labels sync (no live preview)
  ['bv2-light-radius', 'bv2-light-bright', 'bv2-light-intensity', 'bv2-light-color'].forEach(id => {
    const el = $(id);
    if (el) el.addEventListener('input', () => { _syncSliderLabels(); });
  });

  // ── Wire brush buttons ────────────────────────────────────
  document.addEventListener('click', e => {
    const btn = e.target.closest('.bv2-light-brush');
    if (!btn) return;
    const preset = btn.dataset.preset;
    S.brush = `light:${preset}`;
    document.querySelectorAll('.bv2-light-brush').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  // ── Ambient light slider ─────────────────────────────────
  const ambientSlider = $('bv2-ambient-slider');
  const ambientVal = $('bv2-ambient-val');
  if (ambientSlider) {
    ambientSlider.addEventListener('input', () => {
      if (ambientVal) ambientVal.textContent = parseFloat(ambientSlider.value).toFixed(2);
      if (S.view && S.view.location) {
        S.view.location.ambient_light = parseFloat(ambientSlider.value);
        S.view.render();
      }
    });
    ambientSlider.addEventListener('change', async () => {
      if (!S.currentLocId) return;
      const val = parseFloat(ambientSlider.value);
      try {
        await S.api.updateLoc(S.currentLocId, { ambient_light: val });
      } catch (e) {
        console.error('bv2 ambient update', e);
      }
    });
  }

  // ── Refresh list when location loads ──────────────────────
  const origLoadLocation = S.loadLocation;
  S.loadLocation = async function (locId) {
    await origLoadLocation.call(this, locId);
    renderLightList();
    try {
      const loc = await S.api.getLoc(locId);
      if (ambientSlider && loc.ambient_light != null) {
        ambientSlider.value = loc.ambient_light;
        if (ambientVal) ambientVal.textContent = parseFloat(loc.ambient_light).toFixed(2);
      }
    } catch (e) {
      // ignore
    }
  };

  // Expose
  S.openLightModal = openLightPanel;
  S.renderLightList = renderLightList;
})();
