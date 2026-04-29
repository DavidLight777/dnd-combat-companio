// ════════════════════════════════════════════════════════════
// Map Builder v2 — Interior zone painting (Phase 9 Round 2).
// Zone brush: click cells to paint a pending zone, Enter to save.
// ════════════════════════════════════════════════════════════

(function () {
  const S = window.bv2;

  function $(id) { return document.getElementById(id); }

  let _pendingCells = [];
  let _isZoneMode = false;

  function _setZoneMode(on) {
    _isZoneMode = on;
    if (!on) {
      _pendingCells = [];
      if (S.view) S.view.setPendingZone([]);
    }
    const section = $('bv2-interior-section');
    if (section) section.style.display = on ? 'block' : 'none';
    // Highlight the Interiors panel header for 2s when Zone is selected
    const header = section && section.querySelector('div');
    if (header) {
      header.classList.remove('zone-highlight');
      if (on) {
        void header.offsetWidth; // force reflow
        header.classList.add('zone-highlight');
        setTimeout(() => header.classList.remove('zone-highlight'), 2000);
      }
    }
  }

  function toggleZoneCell(col, row) {
    const idx = _pendingCells.findIndex(c => c.col === col && c.row === row);
    if (idx >= 0) {
      _pendingCells.splice(idx, 1);
    } else {
      _pendingCells.push({ col, row });
    }
    if (S.view) S.view.setPendingZone(_pendingCells);
  }

  async function savePendingZone() {
    if (!_pendingCells.length) return;
    const name = prompt('Zone name:', 'Building');
    if (!name) return;
    try {
      await S.api.createInterior(S.currentLocId, {
        name: name.trim(),
        kind: 'building',
        reveal_mode: 'on_enter',
        cells: _pendingCells,
      });
      _pendingCells = [];
      if (S.view) S.view.setPendingZone([]);
      await refreshInteriorList();
    } catch (e) {
      console.error('bv2 save zone', e);
      alert('Failed to save zone');
    }
  }

  async function deleteZone(id) {
    if (!confirm('Delete this interior zone?')) return;
    try {
      await S.api.deleteInterior(id);
      await refreshInteriorList();
    } catch (e) {
      console.error('bv2 delete zone', e);
    }
  }

  async function refreshInteriorList() {
    const listEl = $('bv2-interior-list');
    if (!listEl) return;
    let zones = [];
    try {
      if (S.currentLocId) {
        zones = await S.api.listInteriors(S.currentLocId);
      }
    } catch (e) {
      console.error('bv2 list interiors', e);
    }
    if (!zones.length) {
      listEl.innerHTML = '<div style="color:var(--text-muted);padding:4px 0">No zones</div>';
      return;
    }
    listEl.innerHTML = zones.map(z => `
      <div style="display:flex;align-items:center;gap:4px;padding:3px 0;border-bottom:1px solid var(--border)">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(z.name)} (${z.cells.length})</span>
        <button class="btn-icon btn-xs" data-del-zone="${z.id}" title="Delete">🗑</button>
      </div>
    `).join('');
    listEl.querySelectorAll('[data-del-zone]').forEach(btn => {
      btn.addEventListener('click', () => deleteZone(parseInt(btn.dataset.delZone, 10)));
    });
  }

  // Listen for brush changes to enter/exit zone mode
  const _origSetBrush = S.setBrush;
  S.setBrush = function (brush) {
    _setZoneMode(brush === 'zone');
    return _origSetBrush(brush);
  };

  // Enter key saves pending zone
  document.addEventListener('keydown', e => {
    if (_isZoneMode && e.key === 'Enter') {
      e.preventDefault();
      savePendingZone();
    }
  });

  // Expose for 30-editor.js onPaint intercept
  S.toggleZoneCell = toggleZoneCell;
  S.refreshInteriorList = refreshInteriorList;

  // Refresh list when a location loads
  const _origLoadLocation = S.loadLocation;
  S.loadLocation = async function (locId) {
    const result = await _origLoadLocation(locId);
    await refreshInteriorList();
    return result;
  };
})();
