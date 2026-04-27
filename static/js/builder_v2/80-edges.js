// ════════════════════════════════════════════════════════════
// Map Builder v2 — Edge editor (Phase 5).
// Tool for drawing edge transitions between locations.
// ════════════════════════════════════════════════════════════

(function () {
  const S = window.bv2;

  // ── State ─────────────────────────────────────────────────
  let _edgeDrag = null;  // {startCol, startRow, side, startPx}

  // ── Helpers ───────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function openModal() {
    const m = $('bv2-edge-modal');
    if (m) m.classList.remove('hidden');
  }
  function closeModal() {
    const m = $('bv2-edge-modal');
    if (m) m.classList.add('hidden');
  }

  function showError(msg) { alert(msg); }

  // ── Render edge list ──────────────────────────────────────
  function renderEdgeList() {
    const listEl = $('bv2-edge-list');
    if (!listEl) return;
    // Edges are not stored separately on the client; they come with location payload.
    // For now we stub this until the backend includes edges in get_location_full.
    listEl.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:4px 0">Edge list deferred to Phase 6</div>';
  }

  // ── Public: open modal ────────────────────────────────────
  function openEdgeModal(opts) {
    if (!S.currentLocId) { showError('Select a location first.'); return; }
    const sideEl = $('bv2-edge-side');
    const rangeStartEl = $('bv2-edge-range-start');
    const rangeEndEl = $('bv2-edge-range-end');
    const targetLocEl = $('bv2-edge-target-loc');
    const targetColEl = $('bv2-edge-target-col');
    const targetRowEl = $('bv2-edge-target-row');

    if (sideEl) sideEl.value = opts.side || 'east';
    if (rangeStartEl) rangeStartEl.value = opts.range_start ?? 0;
    if (rangeEndEl) rangeEndEl.value = opts.range_end ?? 1;
    if (targetLocEl) targetLocEl.value = opts.target_location_id || '';
    if (targetColEl) targetColEl.value = opts.target_entry_col ?? 0;
    if (targetRowEl) targetRowEl.value = opts.target_entry_row ?? 0;

    openModal();
  }

  // ── Save handler ──────────────────────────────────────────
  async function onSaveEdge() {
    let rs = parseInt($('bv2-edge-range-start').value, 10);
    if (Number.isNaN(rs)) rs = 0;
    let re = parseInt($('bv2-edge-range-end').value, 10);
    if (Number.isNaN(re)) re = 1;
    let tid = parseInt($('bv2-edge-target-loc').value, 10);
    if (Number.isNaN(tid)) tid = null;
    let tc = parseInt($('bv2-edge-target-col').value, 10);
    if (Number.isNaN(tc)) tc = 0;
    let tr = parseInt($('bv2-edge-target-row').value, 10);
    if (Number.isNaN(tr)) tr = 0;
    const body = {
      side: $('bv2-edge-side').value,
      range_start: rs,
      range_end: re,
      target_location_id: tid,
      target_entry_col: tc,
      target_entry_row: tr,
    };
    try {
      await S.api.createEdge(S.currentLocId, body);
      closeModal();
    } catch (e) {
      console.error('bv2 saveEdge', e);
      showError('Failed to save edge: ' + (e.message || e));
    }
  }

  // ── Wire modal events ─────────────────────────────────────
  document.addEventListener('click', e => {
    if (e.target.id === 'bv2-edge-save') onSaveEdge();
    if (e.target.id === 'bv2-edge-cancel') closeModal();
    if (e.target.id === 'bv2-edge-modal-close') closeModal();
  });

  const modalEl = $('bv2-edge-modal');
  if (modalEl) {
    modalEl.addEventListener('click', e => {
      if (e.target === modalEl) closeModal();
    });
  }

  // ── Wire edge brush ───────────────────────────────────────
  document.addEventListener('click', e => {
    const btn = e.target.closest('.bv2-edge-brush');
    if (!btn) return;
    S.brush = 'edge';
    document.querySelectorAll('.bv2-edge-brush').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });

  // ── Expose ────────────────────────────────────────────────
  S.openEdgeModal = openEdgeModal;
  S.renderEdgeList = renderEdgeList;
})();
