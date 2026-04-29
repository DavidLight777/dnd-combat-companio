// ════════════════════════════════════════════════════════
// Chest modal + chest CRUD
// Source: gm-app.js lines 9590–10254
// Globals shared via window.* and module-scope hoisting.
// ════════════════════════════════════════════════════════

// UNIFIED CHEST MODAL (works for both legacy and builder chests)
// ══════════════════════════════════════════════════════════════
async function openUnifiedChestModal(chest, options = {}) {
  const type = options.type || 'builder'; // 'legacy' | 'builder'
  const isEdit = !!chest;
  const isLegacy = type === 'legacy';
  
  // Normalize items
  let chestItems = [];
  if (isEdit) {
    if (isLegacy) {
      chestItems = (chest.items || []).map(ci => ({
        _id: ci.id,
        item_id: ci.item_id,
        quantity: ci.quantity,
        item_name: ci.item_name || 'Unknown',
        item_type: 'item'
      }));
    } else {
      try { chestItems = JSON.parse(chest.items_json || '[]'); } catch { chestItems = []; }
    }
  }
  
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:420px;max-height:80vh;overflow-y:auto">
      <div class="modal-header">
        <h2>${isEdit ? '✏️ Edit' : '📦 New'} Chest</h2>
        <button class="btn-icon" id="uc-close">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="form-group"><label>Name</label><input type="text" id="uc-name" placeholder="Chest name" value="${isEdit ? chest.name : 'Chest'}"></div>
          <div class="form-group"><label>Icon</label><input type="text" id="uc-icon" value="${isEdit ? (chest.icon || '📦') : '📦'}" style="width:56px"></div>
        </div>
        <div class="form-group" style="margin-top:10px"><label>Description</label><textarea id="uc-desc" rows="2" placeholder="Description…">${isEdit ? (chest.description || '') : ''}</textarea></div>
        
        <div style="display:flex;gap:12px;align-items:center;margin-top:10px">
          <label style="font-size:0.72rem;color:var(--text-muted)"><input id="uc-hidden" type="checkbox" ${isEdit && (isLegacy ? !chest.is_revealed : chest.is_hidden) ? 'checked' : ''}> Hidden</label>
          ${!isLegacy ? `<label style="font-size:0.72rem;color:var(--text-muted)"><input id="uc-locked" type="checkbox" ${isEdit && chest.is_locked ? 'checked' : ''}> Locked</label>` : ''}
        </div>
        ${!isLegacy ? `
        <div style="display:flex;gap:6px;align-items:center;margin-top:6px">
          <label style="font-size:0.72rem;color:var(--text-muted)">Lock DC:</label>
          <input id="uc-lock-dc" type="number" value="${isEdit ? (chest.lock_dc || 10) : 10}" style="width:60px;background:var(--bg-surface-2);color:var(--text);border:1px solid var(--border);padding:4px;border-radius:var(--r-sm)">
        </div>` : ''}
        
        <div style="margin-top:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <h3 style="font-size:0.78rem;flex:1">Items inside</h3>
          </div>
          <div id="uc-items-list" style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px"></div>
          <div style="display:flex;gap:6px">
            <select id="uc-item-select" style="flex:1;background:var(--bg-surface-2);color:var(--text);border:1px solid var(--border);padding:4px;border-radius:var(--r-sm);font-size:0.75rem">
              <option value="">-- Select item --</option>
            </select>
            <input id="uc-item-qty" type="number" value="1" min="1" style="width:50px;background:var(--bg-surface-2);color:var(--text);border:1px solid var(--border);padding:4px;border-radius:var(--r-sm)">
            <button class="btn btn-ghost btn-xs" id="uc-add-item">+</button>
          </div>
          <div style="display:flex;gap:6px;margin-top:6px;align-items:center">
            <select id="uc-currency-type" style="background:var(--bg-surface-2);color:var(--text);border:1px solid var(--border);padding:4px;border-radius:var(--r-sm);font-size:0.75rem">
              <option value="gold">Gold</option>
              <option value="silver">Silver</option>
              <option value="bronze">Bronze</option>
            </select>
            <input id="uc-currency-qty" type="number" value="10" min="1" style="width:60px;background:var(--bg-surface-2);color:var(--text);border:1px solid var(--border);padding:4px;border-radius:var(--r-sm)">
            <button class="btn btn-ghost btn-xs" id="uc-add-currency">+ Currency</button>
          </div>
        </div>
        
        ${isLegacy && isEdit ? `
        <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" id="uc-reveal">👁 Reveal</button>
          <button class="btn btn-ghost btn-sm" id="uc-hide">🙈 Hide</button>
          <button class="btn btn-ghost btn-sm" id="uc-give">🎁 Give to Player</button>
        </div>` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost btn-sm" id="uc-cancel">Cancel</button>
        ${isEdit ? `<button class="btn btn-danger btn-sm" id="uc-delete">Delete</button>` : ''}
        <button class="btn btn-primary btn-sm" id="uc-save">${isEdit ? 'Save' : 'Create'} Chest</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  
  // Load items dropdown
  const itemSelect = overlay.querySelector('#uc-item-select');
  try {
    const items = await api.get('/api/items');
    (items || []).forEach(it => {
      const opt = document.createElement('option');
      opt.value = it.id;
      opt.textContent = it.name;
      itemSelect.appendChild(opt);
    });
  } catch (e) { console.error('Failed to load items', e); }
  
  // Render items list
  function renderItems() {
    const list = overlay.querySelector('#uc-items-list');
    if (!chestItems.length) {
      list.innerHTML = '<div style="font-size:0.78rem;color:var(--text-muted);padding:4px 0">No items in this chest.</div>';
      return;
    }
    list.innerHTML = chestItems.map((it, i) => `
      <div style="display:flex;align-items:center;gap:6px;padding:4px;background:var(--bg-surface-3);border-radius:var(--r-sm)">
        <span style="font-size:0.78rem;flex:1">${it.item_name || 'Unknown'} ×${it.quantity || 1}</span>
        <button class="btn btn-ghost btn-xs" data-remove="${i}" style="color:var(--accent-red)">🗑</button>
      </div>
    `).join('');
    list.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', () => {
        chestItems.splice(parseInt(btn.dataset.remove), 1);
        renderItems();
      });
    });
  }
  renderItems();
  
  // Add item
  overlay.querySelector('#uc-add-item').addEventListener('click', () => {
    const itemId = parseInt(itemSelect.value);
    if (!itemId) return;
    const itemName = itemSelect.options[itemSelect.selectedIndex].textContent;
    const qty = parseInt(overlay.querySelector('#uc-item-qty').value) || 1;
    chestItems.push({ item_id: itemId, quantity: qty, item_name: itemName, item_type: 'item' });
    renderItems();
  });
  
  // Add currency
  overlay.querySelector('#uc-add-currency').addEventListener('click', () => {
    const currencyType = overlay.querySelector('#uc-currency-type').value;
    const qty = parseInt(overlay.querySelector('#uc-currency-qty').value) || 1;
    chestItems.push({
      item_type: 'currency',
      currency_type: currencyType,
      quantity: qty,
      item_name: currencyType.charAt(0).toUpperCase() + currencyType.slice(1),
    });
    renderItems();
  });
  
  // Close / Cancel
  const close = () => overlay.remove();
  overlay.querySelector('#uc-close').addEventListener('click', close);
  overlay.querySelector('#uc-cancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  
  // Legacy actions
  if (isLegacy && isEdit) {
    overlay.querySelector('#uc-reveal').addEventListener('click', async () => {
      try {
        await api.patch(`/api/chests/${chest.id}/reveal`);
        showToast('Chest revealed');
        loadChests();
      } catch (e) { showToast('Error revealing chest'); }
    });
    overlay.querySelector('#uc-hide').addEventListener('click', async () => {
      try {
        await api.patch(`/api/chests/${chest.id}/hide`);
        showToast('Chest hidden');
        loadChests();
      } catch (e) { showToast('Error hiding chest'); }
    });
    overlay.querySelector('#uc-give').addEventListener('click', async () => {
      const playerId = prompt('Enter player character ID:');
      if (!playerId) return;
      try {
        const res = await api.post(`/api/chests/${chest.id}/give-to-player`, { player_id: parseInt(playerId) });
        showToast(`Gave ${res.transferred.length} items to player`);
        loadChests();
        refreshChars();
      } catch (e) { showToast('Error: ' + (e.message || 'Failed to transfer')); }
    });
  }
  
  // Delete
  if (isEdit) {
    overlay.querySelector('#uc-delete').addEventListener('click', async () => {
      if (!confirm('Delete this chest?')) return;
      try {
        if (isLegacy) {
          await api.del(`/api/chests/${chest.id}`);
          loadChests();
        } else {
          await api.del(`/api/map-builder/chests/${chest.id}`);
          if (builderCanvas) {
            builderCanvas.setMapChests((builderCanvas.mapChests || []).filter(c => c.id !== chest.id));
            builderCanvas.render();
          }
        }
        showToast('Chest deleted');
        close();
      } catch (e) { showToast('Failed to delete chest'); }
    });
  }
  
  // Save
  overlay.querySelector('#uc-save').addEventListener('click', async () => {
    const name = overlay.querySelector('#uc-name').value.trim() || 'Chest';
    const icon = overlay.querySelector('#uc-icon').value || '📦';
    const description = overlay.querySelector('#uc-desc').value || '';
    const isHidden = overlay.querySelector('#uc-hidden').checked;
    
    try {
      if (isLegacy) {
        // Legacy chest
        if (isEdit) {
          await api.put(`/api/chests/${chest.id}`, {
            name, description, icon,
            map_x: chest.map_x, map_y: chest.map_y
          });
          // Sync items: remove old, add new
          const oldItems = chest.items || [];
          const newItems = chestItems.filter(it => it.item_type === 'item');
          // Remove items not in new list
          for (const old of oldItems) {
            const stillThere = newItems.find(ni => ni.item_id === old.item_id && ni.quantity === old.quantity);
            if (!stillThere) {
              await api.del(`/api/chest-items/${old.id}`);
            }
          }
          // Add new items
          for (const it of newItems) {
            const exists = oldItems.find(oi => oi.item_id === it.item_id && oi.quantity === it.quantity);
            if (!exists) {
              await api.post(`/api/chests/${chest.id}/items`, { item_id: it.item_id, quantity: it.quantity });
            }
          }
          showToast('Chest updated');
          loadChests();
        } else {
          const newChest = await api.post(`/api/map/${SESSION_CODE}/chests`, {
            name, description, icon, map_x: 0.5, map_y: 0.5
          });
          for (const it of chestItems.filter(it => it.item_type === 'item')) {
            await api.post(`/api/chests/${newChest.id}/items`, { item_id: it.item_id, quantity: it.quantity });
          }
          showToast('Chest placed');
          loadChests();
        }
      } else {
        // Builder chest
        const payload = {
          name, items: chestItems,
          is_hidden: isHidden,
          visible_to_players: !isHidden,
          is_locked: overlay.querySelector('#uc-locked')?.checked || false,
          lock_dc: parseInt(overlay.querySelector('#uc-lock-dc')?.value) || 10,
        };
        if (isEdit) {
          await api.patch(`/api/map-builder/chests/${chest.id}`, payload);
          showToast('Chest updated');
        } else {
          await api.post(`/api/map-builder/${SESSION_CODE}/chests`, {
            ...payload,
            floor_id: currentFloorId,
            col: options.col || 0,
            row: options.row || 0,
          });
          showToast('Chest placed');
        }
        // Refresh builder canvas
        if (builderCanvas) {
          try {
            const chests = await api.get(`/api/map-builder/${SESSION_CODE}/chests`);
            builderCanvas.setMapChests((chests || []).filter(c => c.floor_id === currentFloorId));
            builderCanvas.render();
          } catch (e) { console.error('Failed to refresh chests', e); }
        }
      }
      close();
    } catch (e) { showToast('Failed to save chest: ' + (e.message || '')); }
  });
}

// Wrapper for builder chests
async function openBuilderChestModal(col, row, existingChest = null) {
  await openUnifiedChestModal(existingChest, { type: 'builder', col, row });
}

// Wrapper for legacy chests
function openChestModal(chest = null) {
  openUnifiedChestModal(chest, { type: 'legacy' });
}

async function openBuilderPortalModal(col, row, existingPortal = null) {
  const isEdit = !!existingPortal;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const mapOptions = (builderMaps || []).map(m => `<option value="${m.id}" ${isEdit && existingPortal.target_map_id == m.id ? 'selected' : ''}>${m.name}</option>`).join('');
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:360px">
      <h3>${isEdit ? '✏️ Edit' : '🌀 Place'} Portal</h3>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
        <input id="bp-name" placeholder="Portal name" value="${isEdit ? existingPortal.name : 'Portal'}" style="background:var(--bg-surface-2);color:var(--text);border:1px solid var(--border);padding:6px 8px;border-radius:var(--r-sm)">
        <label style="font-size:0.72rem;color:var(--text-muted)">Target Map</label>
        <select id="bp-target-map" style="background:var(--bg-surface-2);color:var(--text);border:1px solid var(--border);padding:6px;border-radius:var(--r-sm)">
          <option value="">None</option>
          ${mapOptions}
        </select>
        <label style="font-size:0.72rem;color:var(--text-muted)">Target Floor</label>
        <select id="bp-target-floor" style="background:var(--bg-surface-2);color:var(--text);border:1px solid var(--border);padding:6px;border-radius:var(--r-sm)">
          <option value="">None</option>
        </select>
        <div style="display:flex;gap:6px">
          <input id="bp-target-col" type="number" placeholder="Target Col" value="${isEdit ? existingPortal.target_col || 0 : 0}" style="flex:1;background:var(--bg-surface-2);color:var(--text);border:1px solid var(--border);padding:6px;border-radius:var(--r-sm)">
          <input id="bp-target-row" type="number" placeholder="Target Row" value="${isEdit ? existingPortal.target_row || 0 : 0}" style="flex:1;background:var(--bg-surface-2);color:var(--text);border:1px solid var(--border);padding:6px;border-radius:var(--r-sm)">
        </div>
        <div style="display:flex;gap:8px;margin-top:4px">
          ${isEdit ? `<button class="btn btn-danger btn-sm" id="bp-delete">Delete</button>` : ''}
          <button class="btn btn-ghost btn-sm" id="bp-cancel">Cancel</button>
          <button class="btn btn-primary btn-sm" id="bp-save">${isEdit ? 'Update' : 'Save'} Portal</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const targetMapSel = overlay.querySelector('#bp-target-map');
  const targetFloorSel = overlay.querySelector('#bp-target-floor');
  
  // Load target floors if editing
  if (isEdit && existingPortal.target_map_id) {
    try {
      const floors = await api.get(`/api/map-builder/maps/${existingPortal.target_map_id}/floors`);
      (floors || []).forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = f.name;
        if (existingPortal.target_floor_id == f.id) opt.selected = true;
        targetFloorSel.appendChild(opt);
      });
    } catch (e) { console.error('Failed to load target floors', e); }
  }
  
  targetMapSel.addEventListener('change', async () => {
    const mapId = parseInt(targetMapSel.value) || 0;
    targetFloorSel.innerHTML = '<option value="">None</option>';
    if (!mapId) return;
    try {
      const floors = await api.get(`/api/map-builder/maps/${mapId}/floors`);
      (floors || []).forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = f.name;
        targetFloorSel.appendChild(opt);
      });
    } catch (e) { console.error('Failed to load target floors', e); }
  });
  
  overlay.querySelector('#bp-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  
  if (isEdit) {
    overlay.querySelector('#bp-delete').addEventListener('click', async () => {
      if (!confirm('Delete this portal?')) return;
      try {
        await api.del(`/api/map-builder/portals/${existingPortal.id}`);
        showToast('Portal deleted');
        overlay.remove();
      } catch (e) { showToast('Failed to delete portal'); }
    });
  }
  
  overlay.querySelector('#bp-save').addEventListener('click', async () => {
    const payload = {
      floor_id: currentFloorId, col, row,
      name: overlay.querySelector('#bp-name').value || 'Portal',
      target_map_id: parseInt(targetMapSel.value) || null,
      target_floor_id: parseInt(targetFloorSel.value) || null,
      target_col: parseInt(overlay.querySelector('#bp-target-col').value) || 0,
      target_row: parseInt(overlay.querySelector('#bp-target-row').value) || 0,
    };
    try {
      if (isEdit) {
        await api.patch(`/api/map-builder/portals/${existingPortal.id}`, payload);
        showToast('Portal updated');
      } else {
        await api.post(`/api/map-builder/${SESSION_CODE}/portals`, payload);
        showToast('Portal placed');
      }
      overlay.remove();
    } catch (e) { showToast('Failed to save portal'); }
  });
}

// Builder wiring
document.addEventListener('DOMContentLoaded', () => {
  // Map selector
  const mapSel = document.getElementById('builder-map-select');
  if (mapSel) mapSel.addEventListener('change', e => {
    currentMapId = parseInt(e.target.value);
    loadBuilderMapFloors();
  });
  const newMapBtn = document.getElementById('btn-new-map');
  if (newMapBtn) newMapBtn.addEventListener('click', createBuilderMap);
  const delMapBtn = document.getElementById('btn-delete-map');
  if (delMapBtn) delMapBtn.addEventListener('click', deleteBuilderMap);
  const actMapBtn = document.getElementById('btn-activate-map');
  if (actMapBtn) actMapBtn.addEventListener('click', activateBuilderMap);

  // Floor selector
  const sel = document.getElementById('builder-floor-select');
  if (sel) sel.addEventListener('change', e => loadBuilderFloor(parseInt(e.target.value)));
  const newBtn = document.getElementById('btn-new-floor');
  if (newBtn) newBtn.addEventListener('click', createBuilderFloor);
  const delBtn = document.getElementById('btn-delete-floor');
  if (delBtn) delBtn.addEventListener('click', deleteBuilderFloor);
  const actBtn = document.getElementById('btn-activate-floor');
  if (actBtn) actBtn.addEventListener('click', activateBuilderFloor);
  const clearBtn = document.getElementById('btn-clear-tiles');
  if (clearBtn) clearBtn.addEventListener('click', () => { if (builderCanvas) builderCanvas.clear(); });
  const saveBtn = document.getElementById('btn-save-tiles');
  if (saveBtn) saveBtn.addEventListener('click', saveBuilderTiles);
  document.querySelectorAll('.builder-brush').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.builder-brush').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      if (builderCanvas) builderCanvas.setBrush(b.dataset.brush);
    });
  });
  // Tile size slider
  const szInp = document.getElementById('builder-tile-size');
  const szLbl = document.getElementById('builder-tile-size-val');
  if (szInp) szInp.addEventListener('input', () => {
    const v = parseInt(szInp.value) || 50;
    if (szLbl) szLbl.textContent = v;
    if (builderCanvas) { builderCanvas.tileSize = v; builderCanvas.render(); }
  });
  // Map bounds inputs — live preview + debounced auto-save
  const colsInp = document.getElementById('builder-map-cols');
  const rowsInp = document.getElementById('builder-map-rows');
  let _boundsSaveTimer = null;
  const applyBounds = () => {
    if (!builderCanvas) return;
    const c = Math.max(1, parseInt(colsInp?.value) || 40);
    const r = Math.max(1, parseInt(rowsInp?.value) || 30);
    builderCanvas.setBounds(c, r);
    // Debounce-save to server so bounds persist without pressing Save.
    if (!currentFloorId) return;
    clearTimeout(_boundsSaveTimer);
    _boundsSaveTimer = setTimeout(async () => {
      try {
        await api.patch(`/api/map-builder/floors/${currentFloorId}`, {
          map_cols: c, map_rows: r,
        });
        const f = builderFloors.find(x => x.id === currentFloorId);
        if (f) { f.map_cols = c; f.map_rows = r; }
      } catch (e) { console.warn('auto-save bounds failed', e); }
    }, 400);
  };
  if (colsInp) colsInp.addEventListener('input', applyBounds);
  if (rowsInp) rowsInp.addEventListener('input', applyBounds);
  // Grid type toggle
  const gtBtn = document.getElementById('btn-builder-grid-type');
  if (gtBtn) gtBtn.addEventListener('click', () => {
    if (!builderCanvas) return;
    const next = builderCanvas.gridType === 'square' ? 'hex' : 'square';
    builderCanvas.setGridType(next);
    gtBtn.textContent = next === 'hex' ? '⬡ Hex' : '▢ Square';
    // Save grid_type to current floor on server
    if (currentFloorId) {
      api.patch(`/api/map-builder/floors/${currentFloorId}`, { grid_type: next }).catch(() => {});
      const f = builderFloors.find(x => x.id === currentFloorId);
      if (f) f.grid_type = next;
    }
  });
  // Background image upload
  const bgUploadInput = document.getElementById('builder-bg-upload');
  const bgUploadBtn = document.getElementById('btn-builder-bg-upload');
  if (bgUploadBtn && bgUploadInput) {
    bgUploadBtn.addEventListener('click', () => bgUploadInput.click());
    bgUploadInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      let fid = currentFloorId;
      if (!fid && builderFloors.length) { fid = builderFloors[0].id; currentFloorId = fid; }
      if (!fid) { showToast('No floor to upload image to'); return; }
      try {
        const formData = new FormData();
        formData.append('file', file);
        const resp = await fetch(`/api/map-builder/floors/${fid}/upload-image`, { method: 'POST', body: formData });
        if (!resp.ok) { throw new Error(await resp.text()); }
        const data = await resp.json();
        if (data.url) {
          const f = builderFloors.find(x => x.id === fid);
          if (f) { f.image_path = data.path; f.image_url = data.url; }
          if (!builderCanvas) {
            const el = document.getElementById('builder-canvas');
            if (el) builderCanvas = new BuilderCanvas(el);
          }
          if (builderCanvas) {
            builderCanvas.setBackgroundImage(data.url);
            console.log('Builder background set to:', data.url);
          } else {
            console.error('Builder canvas not available after upload');
          }
          showToast('🖼 Background image uploaded');
        }
      } catch (err) {
        showToast('Upload failed: ' + (err.message || 'error'));
        console.error('upload image error:', err, 'floor_id:', fid);
      }
      bgUploadInput.value = '';
    });
  }
  // Remove background image
  const bgRemoveBtn = document.getElementById('btn-builder-bg-remove');
  if (bgRemoveBtn) {
    bgRemoveBtn.addEventListener('click', async () => {
      if (!currentFloorId) return;
      try {
        await api.patch(`/api/map-builder/floors/${currentFloorId}/image`, {
          image_path: null,
          image_url: null,
        });
        const f = builderFloors.find(x => x.id === currentFloorId);
        if (f) { f.image_path = null; f.image_url = null; }
        if (builderCanvas) builderCanvas.setBackgroundImage(null);
        showToast('🗑 Background image removed');
      } catch (err) {
        showToast('Remove failed: ' + (err.message || 'error'));
      }
    });
  }
  // Save to library
  const saveLibBtn = document.getElementById('btn-save-to-library');
  if (saveLibBtn) {
    saveLibBtn.addEventListener('click', saveToLibrary);
  }
  // Open library
  const openLibBtn = document.getElementById('btn-open-library');
  if (openLibBtn) {
    openLibBtn.addEventListener('click', openLibraryModal);
  }
  // Map tab floor switcher
  const mapFloorSel = document.getElementById('map-floor-select');
  if (mapFloorSel) {
    mapFloorSel.addEventListener('change', async (e) => {
      const fid = parseInt(e.target.value);
      try {
        await api.post(`/api/map-builder/floors/${fid}/activate`);
        _mapFloorsCache.forEach(f => f.is_active = (f.id === fid));
        await loadMapState();
        showToast('🔄 Floor switched');
      } catch (err) {
        showToast('Switch floor failed');
      }
    });
  }

  // Map tab — Load from Library. The legacy openLibraryModal /
  // loadLibraryMap helpers were removed when bv2 took over; route
  // this button to the bv2 library modal which already handles
  // load → activate-map → activate-location and broadcasts the
  // bv2.* events that loadMapState listens for.
  const mapLibBtn = document.getElementById('btn-map-load-library');
  if (mapLibBtn) {
    mapLibBtn.addEventListener('click', () => {
      if (window.bv2 && typeof window.bv2.openLibraryModal === 'function') {
        window.bv2.openLibraryModal();
      } else {
        showToast('Library not available');
      }
    });
  }
});

// ══════════════════════════════════════════════════════════════
// CHESTS
// ══════════════════════════════════════════════════════════════
let allChests = [];
let editingChestId = null;
let placingChest = false;

async function loadChests() {
  if (!SESSION_CODE) return;
  try {
    allChests = await api.get(`/api/map/${SESSION_CODE}/chests`);
    if (mapCanvas) mapCanvas.setChests(allChests);
  } catch (e) { console.error('loadChests error:', e); }
}

// Legacy chest button handlers
$('#btn-place-chest').addEventListener('click', () => {
  openUnifiedChestModal(null, { type: 'legacy' });
});
$('#btn-list-chests').addEventListener('click', () => {
  if (!allChests.length) { showToast('No chests'); return; }
  openUnifiedChestModal(allChests[0], { type: 'legacy' });
});

// Chest WS handlers
ws.on('chest.placed', () => loadChests());
ws.on('chest.revealed', () => loadChests());
ws.on('chest.hidden', () => loadChests());
ws.on('chest.updated', () => loadChests());
ws.on('chest.items_transferred', d => {
  showToast(`${d.player_name} looted ${d.items.length} items from a chest`);
  loadChests();
  refreshChars();
});

// Builder WS handlers
ws.on('map.floor_added', d => { if (!builderFloors.find(f => f.id === d.id)) { builderFloors.push(d); renderBuilderFloorSelect(); } });
ws.on('map.floor_updated', d => {
  if (_builderWsSuppressed) return;
  const i = builderFloors.findIndex(f => f.id === d.id);
  if (i >= 0) {
    // Merge — preserve local tiles_json because the server response
    // may carry stale tiles if a separate /tiles PATCH is in-flight.
    builderFloors[i] = { ...builderFloors[i], ...d, tiles_json: builderFloors[i].tiles_json };
  }
  renderBuilderFloorSelect();
});
ws.on('map.floor_deleted', d => { builderFloors = builderFloors.filter(f => f.id !== d.floor_id); if (currentFloorId === d.floor_id) { currentFloorId = builderFloors[0]?.id || null; if (currentFloorId) loadBuilderFloor(currentFloorId); } renderBuilderFloorSelect(); });
ws.on('map.floor_activated', d => {
  builderFloors.forEach(f => f.is_active = (f.id === d.floor_id));
  renderBuilderFloorSelect();
  showToast(`Floor activated: ${d.name || ''}`);
  // Refresh GM Map tab and players so the new floor tiles appear
  if (typeof loadMapState === 'function') loadMapState();
});
ws.on('map.tiles_updated', d => {
  if (_builderWsSuppressed) return;
  if (!d || currentFloorId !== d.floor_id || !builderCanvas) return;
  const f = builderFloors.find(x => x.id === d.floor_id);
  if (!f) return;
  try {
    const parsed = JSON.parse(f.tiles_json || '{}');
    // Avoid unnecessary re-render if local canvas already matches.
    const currentKeys = Object.keys(builderCanvas.tiles).sort().join(',');
    const parsedKeys = Object.keys(parsed).sort().join(',');
    if (currentKeys !== parsedKeys) {
      builderCanvas.setTiles(parsed);
    }
  } catch {}
});
ws.on('map.trap_added', d => { addLog('gm.map', `Trap added: ${d.name}`); });

// ══════════════════════════════════════════════════════════════
