// ════════════════════════════════════════════════════════════
// Map Builder v2 — Entity editor (Phase 7 typed tables).
// Sidebar brushes, placed-entity list, and modal CRUD.
// No JSON — every type has dedicated fields.
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
  const entSave = $('bv2-ent-save');
  const entCancel = $('bv2-ent-cancel');
  const entDelete = $('bv2-ent-delete');
  const entClose = $('bv2-entity-modal-close');

  // Typed sections (injected into modal body)
  let typedSectionEl = null;

  // ── Modal helpers ─────────────────────────────────────────
  function openModal() {
    modal.classList.remove('hidden');
  }
  function closeModal() {
    modal.classList.add('hidden');
    entIdEl.value = '';
    entTypeEl.value = '';
    if (typedSectionEl) {
      typedSectionEl.remove();
      typedSectionEl = null;
    }
  }

  function showError(msg) {
    alert(msg);
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
      btn.addEventListener('click', async () => {
        const ent = ents.find(x => x.id === parseInt(btn.dataset.editId, 10));
        if (ent) await openEntityModal(ent, 'edit');
      });
    });
    listEl.querySelectorAll('[data-del-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.delId, 10);
        if (!confirm('Delete this entity?')) return;
        try {
          await _deleteTyped(id);
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

  async function _deleteTyped(id) {
    const ent = (S.view && S.view.entities || []).find(e => e.id === id);
    const type = ent ? ent.entity_type : '';
    if (type === 'chest') await S.api.deleteChest(id);
    else if (type === 'trap') await S.api.deleteTrap(id);
    else if (type === 'portal') await S.api.deletePortal(id);
    else if (type === 'npc_spawn') await S.api.deleteNpcSpawn(id);
    else if (type === 'cover_zone') await S.api.deleteCoverZone(id);
    else await S.api.deleteEntity(id);
  }

  // ── Build typed form sections ─────────────────────────────

  function _createSection() {
    const body = modal.querySelector('.modal-body');
    if (typedSectionEl) typedSectionEl.remove();
    typedSectionEl = document.createElement('div');
    typedSectionEl.id = 'bv2-typed-section';
    body.appendChild(typedSectionEl);
    return typedSectionEl;
  }

  function _field(label, html) {
    return `<div class="form-group"><label>${label}</label>${html}</div>`;
  }

  function _sel(id, opts, val) {
    return `<select id="${id}" style="width:100%">${opts.map(o =>
      `<option value="${o.value}" ${o.value === val ? 'selected' : ''}>${o.label}</option>`).join('')}</select>`;
  }

  function _inp(id, val, type = 'text') {
    return `<input type="${type}" id="${id}" value="${val !== undefined ? escapeHtml(String(val)) : ''}" style="width:100%">`;
  }

  function _chk(id, checked) {
    return `<label style="flex-direction:row;gap:4px"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}> ${id.replace(/_/g, ' ')}</label>`;
  }

  function _buildChestForm(data) {
    const sec = _createSection();
    sec.innerHTML = [
      _field('Locked', _chk('bv2-chest-locked', data.is_locked)),
      _field('Lock DC', _inp('bv2-chest-lock-dc', data.lock_dc, 'number')),
      _field('Icon', _inp('bv2-chest-icon', data.icon)),
      _field('Opened', _chk('bv2-chest-opened', data.is_opened)),
      _field('Items', '<div id="bv2-chest-items"></div><div style="display:flex;gap:4px;margin-top:4px"><select id="bv2-chest-item-select" style="flex:1"><option value="">Loading items...</option></select><input type="number" id="bv2-chest-item-qty" value="1" min="1" style="width:50px"><button class="btn btn-primary btn-xs" id="bv2-chest-add-item">Add</button></div>'),
    ].join('');

    // Load items picker
    _loadItemOptions('bv2-chest-item-select');

    // Render existing items
    const itemsEl = $('bv2-chest-items');
    const items = data.items || [];
    function renderItems() {
      itemsEl.innerHTML = items.map((it, idx) =>
        `<div style="display:flex;align-items:center;gap:4px;padding:2px 0">${escapeHtml(it.name)} x${it.quantity} <button class="btn-icon btn-xs" data-rm-item="${it.id || idx}">🗑</button></div>`
      ).join('');
      itemsEl.querySelectorAll('[data-rm-item]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx2 = parseInt(btn.dataset.rmItem, 10);
          items.splice(idx2, 1);
          renderItems();
        });
      });
    }
    renderItems();

    $('bv2-chest-add-item')?.addEventListener('click', () => {
      const sel = $('bv2-chest-item-select');
      const qty = parseInt($('bv2-chest-item-qty').value, 10) || 1;
      const name = sel.options[sel.selectedIndex]?.text || '';
      const item_id = parseInt(sel.value, 10);
      if (!item_id) return;
      items.push({ id: items.length, item_id, name, quantity: qty });
      renderItems();
    });

    return { getPayload: () => {
      return {
        is_locked: $('bv2-chest-locked').checked,
        lock_dc: parseInt($('bv2-chest-lock-dc').value, 10) || 10,
        icon: $('bv2-chest-icon').value || 'chest',
        is_opened: $('bv2-chest-opened').checked,
        items: items.filter(i => i.item_id).map(i => ({ item_id: i.item_id, quantity: i.quantity })),
      };
    }};
  }

  function _buildTrapForm(data) {
    const sec = _createSection();
    const types = ['spike','dart','pit','fire','poison','magic','custom'];
    const dmgTypes = ['piercing','slashing','bludgeoning','fire','cold','lightning','poison','necrotic','radiant','psychic','acid','thunder','force'];
    const abilities = ['str','dex','con','int','wis','cha'];
    const triggers = ['on_enter','on_exit','proximity','manual'];
    sec.innerHTML = [
      _field('Trap type', _sel('bv2-trap-type', types.map(t => ({value:t,label:t})), data.trap_type)),
      _field('Damage dice', _inp('bv2-trap-dice', data.damage_dice)),
      _field('Damage type', _sel('bv2-trap-dmg-type', dmgTypes.map(t => ({value:t,label:t})), data.damage_type)),
      _field('DC Detect', _inp('bv2-trap-dc-detect', data.dc_detect, 'number')),
      _field('DC Disarm', _inp('bv2-trap-dc-disarm', data.dc_disarm, 'number')),
      _field('DC Save', _inp('bv2-trap-dc-save', data.dc_save, 'number')),
      _field('Save ability', _sel('bv2-trap-save-abil', abilities.map(t => ({value:t,label:t.toUpperCase()})), data.save_ability)),
      _field('Trigger mode', _sel('bv2-trap-trigger', triggers.map(t => ({value:t,label:t})), data.trigger_mode)),
      _field('Reset on trigger', _chk('bv2-trap-reset', data.reset_on_trigger)),
      _field('Triggered', _chk('bv2-trap-triggered', data.is_triggered)),
      _field('Disarmed', _chk('bv2-trap-disarmed', data.is_disarmed)),
    ].join('');
    return { getPayload: () => ({
      trap_type: $('bv2-trap-type').value,
      damage_dice: $('bv2-trap-dice').value || '1d6',
      damage_type: $('bv2-trap-dmg-type').value,
      dc_detect: parseInt($('bv2-trap-dc-detect').value, 10) || 12,
      dc_disarm: parseInt($('bv2-trap-dc-disarm').value, 10) || 12,
      dc_save: parseInt($('bv2-trap-dc-save').value, 10) || 12,
      save_ability: $('bv2-trap-save-abil').value,
      trigger_mode: $('bv2-trap-trigger').value,
      reset_on_trigger: $('bv2-trap-reset').checked,
      is_triggered: $('bv2-trap-triggered').checked,
      is_disarmed: $('bv2-trap-disarmed').checked,
    })};
  }

  function _buildPortalForm(data) {
    const sec = _createSection();
    // Build sibling location options
    const locs = (S.maps && S.maps.find(m => m.id === S.currentMapId)?.locations) || [];
    const locOpts = locs.map(l => ({ value: l.id, label: l.name || `Loc ${l.id}` }));
    locOpts.unshift({ value: '', label: 'None' });
    sec.innerHTML = [
      _field('Target location', _sel('bv2-portal-target-loc', locOpts, data.target_location_id || '')),
      _field('Target col', _inp('bv2-portal-target-col', data.target_col, 'number')),
      _field('Target row', _inp('bv2-portal-target-row', data.target_row, 'number')),
      _field('One way', _chk('bv2-portal-oneway', data.is_one_way)),
      _field('Label', _inp('bv2-portal-label', data.label)),
      _field('Active', _chk('bv2-portal-active', data.is_active !== false)),
    ].join('');
    return { getPayload: () => {
      const tid = $('bv2-portal-target-loc').value;
      return {
        target_location_id: tid ? parseInt(tid, 10) : null,
        target_col: parseInt($('bv2-portal-target-col').value, 10) || 0,
        target_row: parseInt($('bv2-portal-target-row').value, 10) || 0,
        is_one_way: $('bv2-portal-oneway').checked,
        label: $('bv2-portal-label').value || '',
        is_active: $('bv2-portal-active').checked,
      };
    }};
  }

  async function _buildNpcSpawnForm(data) {
    const sec = _createSection();
    const triggers = ['on_enter','on_activate','on_combat_start','manual'];
    // Phase 9: fetch NPC templates from the library and render as a dropdown
    let tplOptions = [];
    try {
      const tpls = await api.get(`/api/npc-library/templates?session_id=${SESSION_ID}`);
      tplOptions = (tpls || []).map(t => ({ value: t.id, label: t.name }));
    } catch (e) {
      console.error('bv2 failed to load NPC templates', e);
    }
    sec.innerHTML = [
      _field('NPC Template', _sel('bv2-npc-tpl-id', tplOptions, data.npc_template_id)),
      _field('Trigger', _sel('bv2-npc-trigger', triggers.map(t => ({value:t,label:t})), data.auto_spawn_trigger)),
      _field('Count', _inp('bv2-npc-count', data.spawn_count, 'number')),
      _field('Hostile', _chk('bv2-npc-hostile', data.is_hostile !== false)),
    ].join('');
    return { getPayload: () => ({
      npc_template_id: parseInt($('bv2-npc-tpl-id').value, 10) || 0,
      auto_spawn_trigger: $('bv2-npc-trigger').value,
      spawn_count: parseInt($('bv2-npc-count').value, 10) || 1,
      is_hostile: $('bv2-npc-hostile').checked,
    })};
  }

  function _buildCoverZoneForm(data) {
    const sec = _createSection();
    const levels = ['half','three_quarters','full'];
    const materials = ['wooden','stone','magical','natural'];
    sec.innerHTML = [
      _field('Cover level', _sel('bv2-cover-level', levels.map(t => ({value:t,label:t})), data.cover_level)),
      _field('Material', _sel('bv2-cover-material', materials.map(t => ({value:t,label:t})), data.material)),
      _field('Blocks LOS', _chk('bv2-cover-los', data.blocks_line_of_sight)),
      _field('Destructible', _chk('bv2-cover-destruct', data.is_destructible)),
      _field('Current HP', _inp('bv2-cover-hp', data.current_hp, 'number')),
      _field('Max HP', _inp('bv2-cover-max-hp', data.max_hp, 'number')),
      _field('Cells', '<div id="bv2-cover-cells" style="font-size:0.75rem"></div>'),
    ].join('');
    const cells = (data.cells || []).slice();
    function renderCells() {
      const el = $('bv2-cover-cells');
      el.innerHTML = cells.map((c, idx) =>
        `<span style="margin-right:8px">(${c.col},${c.row}) <button class="btn-icon btn-xs" data-rm-cell="${idx}">🗑</button></span>`
      ).join('');
      el.querySelectorAll('[data-rm-cell]').forEach(btn => {
        btn.addEventListener('click', () => {
          cells.splice(parseInt(btn.dataset.rmCell, 10), 1);
          renderCells();
        });
      });
    }
    renderCells();
    return { getPayload: () => ({
      cover_level: $('bv2-cover-level').value,
      material: $('bv2-cover-material').value,
      blocks_line_of_sight: $('bv2-cover-los').checked,
      is_destructible: $('bv2-cover-destruct').checked,
      current_hp: $('bv2-cover-hp').value === '' ? null : parseInt($('bv2-cover-hp').value, 10),
      max_hp: $('bv2-cover-max-hp').value === '' ? null : parseInt($('bv2-cover-max-hp').value, 10),
      cells: cells,
    })};
  }

  async function _loadItemOptions(selectId) {
    try {
      const items = await api.get('/api/items');
      const sel = $(selectId);
      if (!sel) return;
      sel.innerHTML = items.map(it => `<option value="${it.id}">${escapeHtml(it.name)}</option>`).join('');
    } catch (e) {
      console.error('load items', e);
    }
  }

  // ── Public: open modal ────────────────────────────────────
  async function openEntityModal(ent, mode, createOpts) {
    if (!S.currentLocId) { showError('Select a location first.'); return; }

    if (mode === 'delete' && ent) {
      if (confirm(`Delete ${ent.name || TYPE_LABELS[ent.entity_type] || ent.entity_type}?`)) {
        _deleteTyped(ent.id).catch(e => {
          console.error('bv2 deleteEntity', e);
          showError('Failed to delete entity');
        });
      }
      return;
    }

    const type = (mode === 'create') ? createOpts.entity_type : ent.entity_type;
    modalTitle.textContent = (mode === 'create' ? 'New ' : 'Edit ') + (TYPE_LABELS[type] || type);
    entTypeEl.value = type;
    entTypeDisplay.value = TYPE_LABELS[type] || type;

    if (mode === 'create') {
      entIdEl.value = '';
      entName.value = '';
      entCol.value = createOpts.col;
      entRow.value = createOpts.row;
      entVisible.checked = true;
    } else {
      entIdEl.value = ent.id;
      entName.value = ent.name || '';
      entCol.value = ent.col;
      entRow.value = ent.row;
      entVisible.checked = ent.visible_to_players !== false;
    }
    entDelete.style.display = (mode === 'create') ? 'none' : 'inline-flex';

    // Build typed form
    const data = (mode === 'edit' && ent) ? ent : {};
    let formApi = null;
    if (type === 'chest') formApi = _buildChestForm(data);
    else if (type === 'trap') formApi = _buildTrapForm(data);
    else if (type === 'portal') formApi = _buildPortalForm(data);
    else if (type === 'npc_spawn') formApi = await _buildNpcSpawnForm(data);
    else if (type === 'cover_zone') formApi = _buildCoverZoneForm(data);
    else {
      // Generic (light_marker etc.) — no typed section
      const sec = _createSection();
      sec.innerHTML = '<div style="color:var(--text-muted)">No extra fields for this type.</div>';
      formApi = { getPayload: () => ({}) };
    }

    modal._formApi = formApi;
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

    const base = { name, col, row, visible_to_players: visible };
    const extra = modal._formApi ? modal._formApi.getPayload() : {};

    try {
      if (id) {
        if (type === 'chest') await S.api.updateChest(id, { ...base, ...extra });
        else if (type === 'trap') await S.api.updateTrap(id, { ...base, ...extra });
        else if (type === 'portal') await S.api.updatePortal(id, { ...base, ...extra });
        else if (type === 'npc_spawn') await S.api.updateNpcSpawn(id, { ...base, ...extra });
        else if (type === 'cover_zone') await S.api.updateCoverZone(id, { ...base, ...extra });
        else await S.api.updateEntity(id, base);
      } else {
        if (!S.currentLocId) { showError('No location selected'); return; }
        if (type === 'chest') await S.api.createChest(S.currentLocId, { ...base, ...extra });
        else if (type === 'trap') await S.api.createTrap(S.currentLocId, { ...base, ...extra });
        else if (type === 'portal') await S.api.createPortal(S.currentLocId, { ...base, ...extra });
        else if (type === 'npc_spawn') await S.api.createNpcSpawn(S.currentLocId, { ...base, ...extra });
        else if (type === 'cover_zone') await S.api.createCoverZone(S.currentLocId, { ...base, ...extra });
        else await S.api.createEntity(S.currentLocId, { entity_type: type, ...base });
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
      await _deleteTyped(id);
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
