// ════════════════════════════════════════════════════════
// P2P target picker modal
// Source: player-app.js lines 1363-1614
// ════════════════════════════════════════════════════════

// Rework v3: shared P2P target picker modal.
// Returns a Promise<Character | null>. Options:
//   excludeSelf  — drop the caster from the list (default true)
//   aliveOnly    — only characters where is_alive=true (default true)
//   playersOnly  — exclude NPCs (for Give-item flow)
// ══════════════════════════════════════════════════════════════
async function openP2PTargetPicker(opts = {}) {
  const { title = 'Select target', excludeSelf = true,
          aliveOnly = true, playersOnly = false } = opts;
  let chars = [];
  try { chars = await api.get(`/api/sessions/${SESSION_CODE}/characters`); } catch {}
  const list = chars.filter(c => {
    if (excludeSelf && c.id == CHAR_ID) return false;
    if (aliveOnly && c.is_alive === false) return false;
    if (playersOnly && c.is_npc) return false;
    return true;
  });
  if (!list.length) { showToast('No valid targets available'); return null; }

  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-content" style="max-width:380px">
        <h3 style="margin-top:0">${title}</h3>
        <div style="display:flex;flex-direction:column;gap:6px;max-height:60vh;overflow-y:auto">
          ${list.map(c => `
            <button class="btn btn-ghost btn-sm p2p-target" data-id="${c.id}"
              style="display:flex;align-items:center;gap:8px;justify-content:flex-start">
              <span style="width:14px;height:14px;border-radius:50%;background:${c.token_color || '#888'}"></span>
              <span style="flex:1;text-align:left">
                <strong>${c.name}</strong>
                ${c.is_npc ? '<span style="font-size:0.62rem;color:var(--text-muted)">NPC</span>' : ''}
              </span>
              <span style="font-size:0.72rem;color:var(--text-muted)">
                ${c.current_hp ?? '?'}/${c.max_hp ?? '?'} HP
              </span>
            </button>
          `).join('')}
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:10px">
          <button class="btn btn-ghost btn-sm" data-cancel>Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('.p2p-target').forEach(b => {
      b.addEventListener('click', () => {
        const id = parseInt(b.dataset.id);
        const chosen = list.find(c => c.id === id) || null;
        overlay.remove();
        resolve(chosen);
      });
    });
    overlay.querySelector('[data-cancel]').addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });
  });
}

// Rework Phase 5: player-side poison selection modal.
async function openApplyPoisonModal(inventoryId) {
  let poisons = [];
  try { poisons = await api.get('/api/poison-templates'); } catch {}
  if (!poisons.length) { showToast('No poisons available. Ask GM to create one.'); return; }
  // Current coat (if any)
  let current = null;
  try { current = await api.get(`/api/inventory/${inventoryId}/applied-poison`); } catch {}

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:420px">
      <h3 style="margin-top:0">💧 Apply Poison</h3>
      ${current ? `<div style="margin-bottom:10px;font-size:0.8rem;color:var(--accent-green)">
        Current: ${current.template?.icon||''} ${current.template?.name||''} —
        ${current.charges_remaining} charges · ${current.turns_per_hit} turn(s)/hit
        <button class="btn btn-ghost btn-xs" id="poison-remove" style="margin-left:6px">Remove</button>
      </div>` : ''}
      <label style="font-size:0.78rem">Poison</label>
      <select id="poison-new-tpl" style="width:100%;margin-bottom:8px">
        ${poisons.map(p => `<option value="${p.id}">${p.icon} ${p.name} — ${p.damage_dice_count}d${p.damage_dice_type} ${p.damage_type}</option>`).join('')}
      </select>
      <div style="display:flex;gap:8px">
        <div style="flex:1">
          <label style="font-size:0.75rem">Charges</label>
          <input type="number" id="poison-new-charges" min="1" max="50" value="${poisons[0].default_charges}" style="width:100%">
        </div>
        <div style="flex:1">
          <label style="font-size:0.75rem">Turns/hit</label>
          <input type="number" id="poison-new-turns" min="1" max="20" value="${poisons[0].default_turns_per_hit}" style="width:100%">
        </div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" id="poison-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="poison-apply">Apply</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Keep defaults synced with selected poison
  const sel = overlay.querySelector('#poison-new-tpl');
  sel.addEventListener('change', () => {
    const p = poisons.find(x => x.id === parseInt(sel.value, 10));
    if (p) {
      overlay.querySelector('#poison-new-charges').value = p.default_charges;
      overlay.querySelector('#poison-new-turns').value = p.default_turns_per_hit;
    }
  });

  overlay.querySelector('#poison-cancel').addEventListener('click', () => overlay.remove());
  const rm = overlay.querySelector('#poison-remove');
  if (rm) rm.addEventListener('click', async () => {
    try {
      await api.del(`/api/inventory/${inventoryId}/apply-poison`);
      showToast('Poison removed');
      overlay.remove();
      loadInventory();
    } catch (e) { showToast('Failed to remove poison'); }
  });
  overlay.querySelector('#poison-apply').addEventListener('click', async () => {
    const poison_template_id = parseInt(sel.value, 10);
    const charges = parseInt(overlay.querySelector('#poison-new-charges').value, 10);
    const turns_per_hit = parseInt(overlay.querySelector('#poison-new-turns').value, 10);
    try {
      await api.post(`/api/inventory/${inventoryId}/apply-poison`, { poison_template_id, charges, turns_per_hit });
      showToast('💧 Weapon coated with poison');
      overlay.remove();
      loadInventory();
    } catch (e) { showToast(e?.message || 'Failed to apply poison'); }
  });
}

// ── Slot Selector ───────────────────────────────────────────
function openSlotSelector(inventoryId) {
  const modal = $('#slot-selector-modal');
  const grid = $('#slot-selector-grid');
  const slots = inventoryData?.equipment_slots || Object.keys(SLOT_LABELS);

  // Find occupied slots
  const occupiedSlots = {};
  if (inventoryData) {
    for (const it of inventoryData.items) {
      if (it.is_equipped && it.equipped_slot) occupiedSlots[it.equipped_slot] = it.name;
    }
  }

  grid.innerHTML = slots.map(slot => {
    const occ = occupiedSlots[slot];
    return `<button class="slot-selector-btn ${occ ? 'occupied' : ''}" data-pick-slot="${slot}">
      <span class="slot-icon">${SLOT_ICONS[slot] || '📦'}</span>
      <span>${SLOT_LABELS[slot] || slot}</span>
      ${occ ? `<span style="font-size:0.65rem;color:var(--text-muted)">(${occ})</span>` : ''}
    </button>`;
  }).join('');

  modal.style.display = 'flex';

  // Wire slot picks
  grid.querySelectorAll('[data-pick-slot]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const slot = btn.dataset.pickSlot;
      await api.patch(`/api/inventory/${inventoryId}/equip`, { equip: true, slot });
      modal.style.display = 'none';
      // UX: jump to Equipped so the player sees the item land in its slot.
      invTab = 'equipped';
      loadInventory();
    });
  });
}

$('#slot-modal-close').addEventListener('click', () => {
  $('#slot-selector-modal').style.display = 'none';
});
$('#slot-selector-modal').addEventListener('click', e => {
  if (e.target === $('#slot-selector-modal')) $('#slot-selector-modal').style.display = 'none';
});

// ── Filter Tabs ─────────────────────────────────────────────
$$('.inv-filter').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.inv-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    invFilter = btn.dataset.invFilter;
    // Rework Phase 3: always re-render via applyInvTab so bag/equipped split is respected
    applyInvTab();
  });
});

// Rework Phase 3: Bag / Equipped top-level tabs
$$('.inv-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    invTab = btn.dataset.invTab || 'bag';
    applyInvTab();
  });
});

// ── Shop ─────────────────────────────────────────────────────
$('#btn-open-shop').addEventListener('click', async () => {
  try {
    const data = await api.get(`/api/shop/${SESSION_CODE}`);
    if (!data.items || !data.items.length) {
      showToast('Shop is empty or closed');
      return;
    }
    showShopModal(data.items);
  } catch { showToast('Shop not available'); }
});

function showShopModal(items) {
  const overlay = document.createElement('div');
  overlay.className = 'shop-overlay';
  overlay.innerHTML = `
    <div class="shop-panel">
      <div class="shop-header">
        <h2>🛒 Shop</h2>
        <span style="font-size:0.78rem;color:var(--text-muted)">Your Gold: <strong style="color:var(--accent)">${charData.gold || 0}</strong></span>
        <button class="btn btn-ghost btn-sm shop-close">✕</button>
      </div>
      <div class="shop-body">
        ${items.map(i => {
          const icon = CATEGORY_ICONS[i.category] || '📦';
          return `<div class="shop-item">
            <span>${icon}</span>
            <span class="si-name rarity-${i.rarity}">${i.name}</span>
            <span style="font-size:0.7rem;color:var(--text-muted)">${i.rarity}</span>
            <span class="si-price">${i.price}g</span>
            ${i.stock === 0 ? '<span style="color:var(--accent-red);font-size:0.7rem">OUT</span>' : `<button class="btn btn-primary btn-xs" data-buy-shop="${i.shop_item_id}">Buy</button>`}
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('.shop-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelectorAll('[data-buy-shop]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const res = await api.post(`/api/shop/${SESSION_CODE}/buy`, { shop_item_id: parseInt(btn.dataset.buyShop), character_id: CHAR_ID });
        showToast(`Bought ${res.item_name}! Gold: ${res.gold_remaining}`);
        overlay.remove();
        await loadChar();
        loadInventory();
      } catch (e) { showToast('Purchase failed: ' + e.message); }
    });
  });
}

// ══════════════════════════════════════════════════════════════
