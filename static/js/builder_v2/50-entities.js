// ════════════════════════════════════════════════════════════
// Map Builder v2 — Entity editor (Phase 2).
// Sidebar brushes, placed-entity list, and modal CRUD.
// ════════════════════════════════════════════════════════════

(function () {
  const S = window.bv2;
  const ENTITY_TYPES = ['chest', 'trap', 'portal', 'npc_spawn', 'cover_zone', 'light_marker'];
  const TYPE_LABELS = {
    chest: 'Chest', trap: 'Trap', portal: 'Portal',
    npc_spawn: 'NPC Spawn', cover_zone: 'Cover', light_marker: 'Light',
  };

  // ── DOM refs ──────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const modal = $('bv2-entity-modal');
  const modalTitle = $('bv2-entity-modal-title');
  const entIdEl = $('bv2-ent-id');
  const entTypeEl = $('bv2-ent-type');
  const entTypeDisplay = $('bv2-ent-type-display');
  const entName = $('bv2-ent-name');
  const entCol = $('bv2-ent-col');
  const entRow = $('bv2-ent-row');
  const entVisible = $('bv2-ent-visible');
  const entProps = $('bv2-ent-props');
  const entSave = $('bv2-ent-save');
  const entCancel = $('bv2-ent-cancel');
  const entDelete = $('bv2-ent-delete');
  const entClose = $('bv2-entity-modal-close');

  // ── Modal helpers ─────────────────────────────────────────
  function openModal() {
    modal.classList.remove('hidden');
  }
  function closeModal() {
    modal.classList.add('hidden');
    entIdEl.value = '';
    entTypeEl.value = '';
  }

  function showError(msg) {
    alert(msg);  // Phase 1 style; Phase 6 will replace with HTML modal
  }

  // ── Render entity list ────────────────────────────────────
  function renderEntityList() {
    const listEl = $('bv2-entity-list');
    if (!listEl) return;
    const ents = (S.view && S.view.entities) || [];
    if (!ents.length) {
      listEl.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:4px 0">No entities</div>';
      return;
    }
    listEl.innerHTML = ents.map(ent => {
      const label = TYPE_LABELS[ent.entity_type] || ent.entity_type;
      return `<div style="display:flex;align-items:center;gap:4px;padding:3px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:0.9rem">${entIcon(ent.entity_type)}</span>
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(ent.name || label)}</span>
        <button class="btn-icon btn-xs" data-edit-id="${ent.id}" title="Edit">✎</button>
        <button class="btn-icon btn-xs" data-del-id="${ent.id}" title="Delete">🗑</button>
      </div>`;
    }).join('');

    listEl.querySelectorAll('[data-edit-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ent = ents.find(x => x.id === parseInt(btn.dataset.editId, 10));
        if (ent) openEntityModal(ent, 'edit');
      });
    });
    listEl.querySelectorAll('[data-del-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.delId, 10);
        if (!confirm('Delete this entity?')) return;
        try {
          await S.api.deleteEntity(id);
        } catch (e) {
          console.error('bv2 deleteEntity', e);
          showError('Failed to delete entity');
        }
      });
    });
  }

  function entIcon(type) {
    const map = {
      chest: '🗃', trap: '⚠', portal: '🌀',
      npc_spawn: '⊛', cover_zone: '⛑', light_marker: '💡',
    };
    return map[type] || '?';
  }

  // ── Public: open modal ────────────────────────────────────
  function openEntityModal(ent, mode, createOpts) {
    if (!S.currentLocId) { showError('Select a location first.'); return; }

    if (mode === 'delete' && ent) {
      if (confirm(`Delete ${ent.name || TYPE_LABELS[ent.entity_type] || ent.entity_type}?`)) {
        S.api.deleteEntity(ent.id).catch(e => {
          console.error('bv2 deleteEntity', e);
          showError('Failed to delete entity');
        });
      }
      return;
    }

    if (mode === 'create') {
      modalTitle.textContent = 'New ' + (TYPE_LABELS[createOpts.entity_type] || createOpts.entity_type);
      entIdEl.value = '';
      entTypeEl.value = createOpts.entity_type;
      entTypeDisplay.value = TYPE_LABELS[createOpts.entity_type] || createOpts.entity_type;
      entName.value = '';
      entCol.value = createOpts.col;
      entRow.value = createOpts.row;
      entVisible.checked = true;
      entProps.value = '{}';
      entDelete.style.display = 'none';
    } else {
      modalTitle.textContent = 'Edit ' + (TYPE_LABELS[ent.entity_type] || ent.entity_type);
      entIdEl.value = ent.id;
      entTypeEl.value = ent.entity_type;
      entTypeDisplay.value = TYPE_LABELS[ent.entity_type] || ent.entity_type;
      entName.value = ent.name || '';
      entCol.value = ent.col;
      entRow.value = ent.row;
      entVisible.checked = ent.visible_to_players !== false;
      entProps.value = JSON.stringify(ent.props || {}, null, 2);
      entDelete.style.display = 'inline-flex';
    }
    openModal();
  }

  // ── Save handler ──────────────────────────────────────────
  async function onSave() {
    const id = entIdEl.value ? parseInt(entIdEl.value, 10) : null;
    const type = entTypeEl.value;
    const name = entName.value.trim();
    let col = parseInt(entCol.value, 10);
    if (Number.isNaN(col)) col = 0;
    let row = parseInt(entRow.value, 10);
    if (Number.isNaN(row)) row = 0;
    const visible = entVisible.checked;

    let props = {};
    try {
      props = JSON.parse(entProps.value || '{}');
    } catch (e) {
      showError('Invalid JSON in Properties field');
      return;
    }

    try {
      if (id) {
        await S.api.updateEntity(id, { name, col, row, visible_to_players: visible, props });
      } else {
        if (!S.currentLocId) { showError('No location selected'); return; }
        await S.api.createEntity(S.currentLocId, {
          entity_type: type, name, col, row, visible_to_players: visible, props,
        });
      }
      closeModal();
    } catch (e) {
      console.error('bv2 saveEntity', e);
      showError('Failed to save entity: ' + (e.message || e));
    }
  }

  // ── Wire modal events ─────────────────────────────────────
  entSave?.addEventListener('click', onSave);
  entCancel?.addEventListener('click', closeModal);
  entClose?.addEventListener('click', closeModal);
  entDelete?.addEventListener('click', async () => {
    const id = entIdEl.value ? parseInt(entIdEl.value, 10) : null;
    if (!id) return;
    if (!confirm('Delete this entity?')) return;
    try {
      await S.api.deleteEntity(id);
      closeModal();
    } catch (e) {
      console.error('bv2 deleteEntity', e);
      showError('Failed to delete entity');
    }
  });
  modal?.addEventListener('click', e => {
    if (e.target === modal) closeModal();
  });

  // ── Refresh list when location loads ──────────────────────
  const origLoadLocation = S.loadLocation;
  S.loadLocation = async function (locId) {
    await origLoadLocation.call(this, locId);
    renderEntityList();
  };

  // Expose
  S.openEntityModal = openEntityModal;
  S.renderEntityList = renderEntityList;
})();
