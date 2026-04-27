// ════════════════════════════════════════════════════════════
// Map Builder v2 — Library modal (Phase 6).
// Snapshot save/load UI.
// ════════════════════════════════════════════════════════════

(function () {
  const S = window.bv2;

  function $(id) { return document.getElementById(id); }

  let _libraryData = [];

  async function openLibraryModal() {
    const modal = $('bv2-library-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    await refreshLibraryList();
  }

  function closeLibraryModal() {
    const modal = $('bv2-library-modal');
    if (modal) modal.classList.add('hidden');
  }

  async function refreshLibraryList() {
    const listEl = $('bv2-library-list');
    if (!listEl) return;
    try {
      _libraryData = await S.api.listLibrary(SESSION_CODE);
    } catch (e) {
      console.error('bv2 listLibrary', e);
      _libraryData = [];
    }
    if (!_libraryData.length) {
      listEl.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:20px">No snapshots yet.</div>';
      return;
    }
    listEl.innerHTML = _libraryData.map(snap => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid var(--border)">
        <div style="font-size:2rem">🗺️</div>
        <div style="flex:1">
          <div style="font-weight:600">${escapeHtml(snap.name)}</div>
          <div style="font-size:0.7rem;color:var(--text-muted)">${escapeHtml(snap.description || '')}</div>
        </div>
        <button class="btn btn-primary btn-xs" data-load-id="${snap.id}">Load</button>
        <button class="btn btn-danger btn-xs" data-del-id="${snap.id}">🗑</button>
      </div>
    `).join('');

    listEl.querySelectorAll('[data-load-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.loadId, 10);
        if (!confirm('Load this snapshot as a new Map?')) return;
        try {
          await S.api.loadSnapshot(id, { session_code: SESSION_CODE, name: 'Loaded Map' });
          closeLibraryModal();
          if (typeof S.loadMaps === 'function') await S.loadMaps();
        } catch (e) {
          console.error('bv2 loadSnapshot', e);
          alert('Failed to load snapshot');
        }
      });
    });

    listEl.querySelectorAll('[data-del-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.delId, 10);
        if (!confirm('Delete this snapshot?')) return;
        try {
          await S.api.deleteSnapshot(id);
          await refreshLibraryList();
        } catch (e) {
          console.error('bv2 deleteSnapshot', e);
          alert('Failed to delete snapshot');
        }
      });
    });
  }

  async function onSaveCurrentMap() {
    if (!S.currentMapId) { alert('Select a Map first.'); return; }
    const name = prompt('Snapshot name:', S.maps.find(m => m.id === S.currentMapId)?.name || 'Snapshot');
    if (!name) return;
    try {
      await S.api.saveSnapshot({ map_id: S.currentMapId, name: name.trim(), description: '' });
      alert('Snapshot saved!');
    } catch (e) {
      console.error('bv2 saveSnapshot', e);
      alert('Failed to save snapshot');
    }
  }

  // Wire events
  document.addEventListener('click', e => {
    if (e.target.id === 'bv2-btn-library') openLibraryModal();
    if (e.target.id === 'bv2-btn-save-library') onSaveCurrentMap();
    if (e.target.id === 'bv2-library-modal-close') closeLibraryModal();
    if (e.target.id === 'bv2-library-cancel') closeLibraryModal();
  });

  const modalEl = $('bv2-library-modal');
  if (modalEl) {
    modalEl.addEventListener('click', e => {
      if (e.target === modalEl) closeLibraryModal();
    });
  }

  // Expose
  S.openLibraryModal = openLibraryModal;
})();
