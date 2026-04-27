// ════════════════════════════════════════════════════════
// Log + Inventory (Stage 2)
// Source: player-app.js lines 1040-1362
// ════════════════════════════════════════════════════════

// LOG
// ══════════════════════════════════════════════════════════════
function renderLog() {
  const cl = $('#calc-log');
  cl.innerHTML = calcLog.map(e => `<div class="log-entry"><span class="log-time">${e.time}</span> ${e.text}</div>`).join('');
  const rl = $('#roll-history-log');
  rl.innerHTML = rollHistory.map(e => `<div class="log-entry"><span class="log-time">${e.time}</span> [${e.type}] ${e.desc} → <strong>${e.result}</strong></div>`).join('');
}

// Log tab switching
document.addEventListener('click', e => {
  if (!e.target.classList.contains('log-tab-btn')) return;
  $$('.log-tab-btn').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  const tab = e.target.dataset.logTab;
  $('#calc-log').style.display = tab === 'calc' ? '' : 'none';
  $('#roll-history-log').style.display = tab === 'rolls' ? '' : 'none';
});

// ══════════════════════════════════════════════════════════════
// INVENTORY — Stage 2 Enhanced
// ══════════════════════════════════════════════════════════════
const CATEGORY_ICONS = { weapon: '⚔️', armor: '🛡️', potion: '🧪', misc: '📦', quest: '📜' };
const SLOT_ICONS = {
  main_hand: '🗡️', off_hand: '🛡️', armor: '🥋', head: '⛑️',
  ring_1: '💍', ring_2: '💍', amulet: '📿', boots: '👢', gloves: '🧤', belt: '🎗️',
};
const SLOT_LABELS = {
  main_hand: 'Main Hand', off_hand: 'Off Hand', armor: 'Armor', head: 'Head',
  ring_1: 'Ring 1', ring_2: 'Ring 2', amulet: 'Amulet', boots: 'Boots', gloves: 'Gloves', belt: 'Belt',
};

let inventoryData = null;  // cached inventory response
let invFilter = 'all';
let invTab = 'bag';  // Rework Phase 3: 'bag' | 'equipped'

async function loadInventory() {
  if (!CHAR_ID) return;
  try {
    // Ask server for ALL items; client-side splits bag/equipped for snappy tab switching.
    inventoryData = await api.get(`/api/characters/${CHAR_ID}/inventory?tab=all`);
    const bagCount = $('#tab-count-bag');
    const eqCount = $('#tab-count-equipped');
    if (bagCount) bagCount.textContent = inventoryData.bag_count ?? '';
    if (eqCount)  eqCount.textContent  = inventoryData.equipped_count ?? '';

    // Rework v2: inventory slot meter
    const slotMeter    = $('#slot-meter');
    const slotMeterVal = $('#slot-meter-val');
    const used = inventoryData.slots_used ?? ((inventoryData.bag_count || 0) + (inventoryData.equipped_count || 0));
    const cap  = inventoryData.slots_max ?? 0;
    if (slotMeterVal) slotMeterVal.textContent = cap > 0 ? `${used} / ${cap}` : `${used} (∞)`;
    if (slotMeter) {
      slotMeter.classList.remove('slot-meter-warn','slot-meter-full');
      if (cap > 0) {
        if (used >= cap) {
          slotMeter.style.borderColor = 'var(--accent-red)';
          slotMeter.style.color = 'var(--accent-red)';
        } else if (used >= cap - 2) {
          slotMeter.style.borderColor = 'var(--accent-orange)';
          slotMeter.style.color = 'var(--accent-orange)';
        } else {
          slotMeter.style.borderColor = 'var(--border)';
          slotMeter.style.color = 'var(--text-muted)';
        }
      }
    }
    updateCurrencyDisplay(inventoryData.currency);
    renderEquipmentSlots(inventoryData.items);
    applyInvTab();  // layout is driven by invTab
    renderActionMenu();
  } catch(e) { console.warn('loadInventory:', e); }
}

// Rework Phase 3: switch between Bag and Equipped views.
function applyInvTab() {
  const items = (inventoryData && inventoryData.items) || [];
  const equipPanel = $('#equipment-panel');
  const filterTabs = $('#inv-filter-tabs');
  // Highlight active top-tab
  document.querySelectorAll('#inv-tab-bar .inv-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.invTab === invTab);
  });
  if (invTab === 'equipped') {
    if (equipPanel) equipPanel.style.display = '';
    if (filterTabs) filterTabs.style.display = 'none';
    const eqOnly = items.filter(i => i.is_equipped);
    renderInventoryGrid(eqOnly, { bypassFilter: true });
  } else {
    if (equipPanel) equipPanel.style.display = 'none';
    if (filterTabs) filterTabs.style.display = '';
    const bagOnly = items.filter(i => !i.is_equipped);
    renderInventoryGrid(bagOnly);
  }
}

function updateCurrencyDisplay(c) {
  if (!c) return;
  const pe = $('#curr-plat');
  if (c.platinum > 0) { pe.style.display = ''; pe.querySelector('strong').textContent = c.platinum; }
  else { pe.style.display = 'none'; }
  $('#curr-gold').querySelector('strong').textContent = c.gold;
  $('#curr-silver').querySelector('strong').textContent = c.silver;
  $('#curr-copper').querySelector('strong').textContent = c.bronze || c.copper;
}

function renderEquipmentSlots(items) {
  const grid = $('#equip-slots-grid');
  const slots = inventoryData?.equipment_slots || Object.keys(SLOT_LABELS);
  const equippedBySlot = {};
  for (const it of items) {
    if (it.is_equipped && it.equipped_slot) equippedBySlot[it.equipped_slot] = it;
  }

  grid.innerHTML = slots.map(slot => {
    const item = equippedBySlot[slot];
    const filled = item ? 'filled' : '';
    const rClass = item ? `rarity-${item.rarity}` : '';
    return `<div class="equip-slot ${filled}" data-slot="${slot}" title="${SLOT_LABELS[slot] || slot}">
      <div class="slot-label">${SLOT_LABELS[slot] || slot}</div>
      ${item
        ? `<div class="slot-item-name ${rClass}">${item.name}</div>`
        : `<div class="slot-empty">${SLOT_ICONS[slot] || '·'}</div>`
      }
    </div>`;
  }).join('');

  // Click slot → show item detail or unequip
  grid.querySelectorAll('.equip-slot').forEach(el => {
    el.addEventListener('click', async () => {
      const slot = el.dataset.slot;
      const item = equippedBySlot[slot];
      if (item) {
        if (await confirmAction(`Unequip ${item.name} from ${SLOT_LABELS[slot]}?`)) {
          await api.patch(`/api/inventory/${item.inventory_id}/equip`, { equip: false });
          // UX: auto-switch to Bag so the unequipped item is visible immediately.
          invTab = 'bag';
          loadInventory();
        }
      }
    });
  });
}

function filterItems(items) {
  if (invFilter === 'all') return items;
  // FIX 6: potion filter matches both is_potion flag and legacy "potion" category
  if (invFilter === 'potion') return items.filter(i => i.is_potion || i.category === 'potion');
  return items.filter(i => i.category === invFilter);
}

function renderInventoryGrid(items, opts = {}) {
  const grid = $('#inventory-grid');
  const filtered = opts.bypassFilter ? items : filterItems(items);
  if (!filtered || !filtered.length) {
    grid.innerHTML = '<span class="text-muted" style="font-size:0.8rem">No items.</span>';
    return;
  }
  grid.innerHTML = filtered.map(i => {
    const icon = (i.is_potion && i.potion_icon) ? i.potion_icon : (CATEGORY_ICONS[i.category] || '📦');
    const eq = i.is_equipped ? ' equipped' : '';
    // Bonuses summary
    let bonusText = '';
    if (i.bonuses && i.bonuses.length) {
      bonusText = i.bonuses.map(b => {
        if (b.bonus_type === 'stat_bonus') return `${b.stat_name} +${b.value}`;
        return b.bonus_type.replace(/_/g,' ') + (b.value >= 0 ? ' +' : ' ') + b.value;
      }).join(', ');
    }
    // Weapon stats
    let weaponText = '';
    if (i.weapon_stats) {
      const ws = i.weapon_stats;
      weaponText = `${ws.dice_count}d${ws.dice_type} ${ws.damage_type}${ws.range ? ' · ' + ws.range : ''}`;
    }

    return `<div class="inv-card${eq}" data-inv-id="${i.inventory_id}" data-item-id="${i.id}" style="border-left:3px solid var(--rarity-${i.rarity}, var(--border))">
      ${i.is_equipped ? `<span class="equip-badge">${i.equipped_slot ? SLOT_LABELS[i.equipped_slot] || i.equipped_slot : 'EQ'}</span>` : ''}
      <span class="inv-qty">x${i.quantity}</span>
      <div><span class="inv-icon">${icon}</span><span class="inv-name rarity-${i.rarity}">${i.name}</span></div>
      <div class="inv-meta">${i.rarity}</div>
      ${bonusText ? `<div class="inv-bonuses">${bonusText}</div>` : ''}
      ${weaponText ? `<div class="inv-weapon-stats">⚔️ ${weaponText}</div>` : ''}
      <div class="inv-desc">${i.description || ''}</div>
      <div class="inv-actions">
        ${i.equippable ? `<button class="btn btn-ghost btn-xs" data-inv-equip="${i.inventory_id}" data-is-equipped="${i.is_equipped}">${i.is_equipped ? 'Unequip' : 'Equip'}</button>` : ''}
        ${i.consumable ? `<button class="btn btn-ghost btn-xs" data-inv-use="${i.inventory_id}">${i.mana_cost ? '🔮'+i.mana_cost+' ' : ''}Use</button>` : ''}
        ${i.consumable ? `<button class="btn btn-ghost btn-xs" data-inv-use-on="${i.inventory_id}" title="Use on another character">💊 Use on…</button>` : ''}
        ${i.weapon_stats ? `<button class="btn btn-ghost btn-xs" data-inv-poison="${i.inventory_id}" title="Apply poison">💧 Poison</button>` : ''}
        <button class="btn btn-ghost btn-xs" data-inv-give="${i.inventory_id}" title="Give to another player">🎁 Give</button>
        <button class="btn btn-ghost btn-xs" data-inv-drop="${i.inventory_id}" style="color:var(--accent-red)">Drop</button>
      </div>
    </div>`;
  }).join('');

  // Toggle expand
  grid.querySelectorAll('.inv-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      card.classList.toggle('expanded');
    });
  });

  // Equip/Unequip
  grid.querySelectorAll('[data-inv-equip]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const invId = btn.dataset.invEquip;
      const isEquipped = btn.dataset.isEquipped === 'true';
      if (isEquipped) {
        await api.patch(`/api/inventory/${invId}/equip`, { equip: false });
        // UX: auto-switch to the destination tab so the card visibly
        // "moves" without the player having to flip tabs manually.
        invTab = 'bag';
        loadInventory();
      } else {
        openSlotSelector(invId);
      }
    });
  });

  // Use consumable
  grid.querySelectorAll('[data-inv-use]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const invId = btn.dataset.invUse;
      const card = btn.closest('.inv-card');
      const itemName = card?.querySelector('.inv-name')?.textContent || 'item';
      if (!confirm(`Use ${itemName}?`)) return;
      try {
        const res = await api.post(`/api/inventory/${invId}/use`, {});
        if (res.results && res.results.length) {
          res.results.forEach(r => addLog(`🧪 ${itemName}: ${r}`));
        } else if (res.result) {
          addLog(res.result);
        }
        await loadChar();
        loadInventory();
      } catch (e) {
        const detail = e?.body?.detail || e?.message || 'Failed';
        if (typeof detail === 'object' && detail.message) showToast(detail.message, 'error');
        else showToast(String(detail), 'error');
      }
    });
  });

  // Drop
  grid.querySelectorAll('[data-inv-drop]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.inv-card');
      const name = card?.querySelector('.inv-name')?.textContent || 'item';
      if (await confirmAction(`Drop ${name}?`)) {
        await api.del(`/api/inventory/${btn.dataset.invDrop}`);
        loadInventory();
      }
    });
  });

  // Rework Phase 5: Apply poison to weapon
  grid.querySelectorAll('[data-inv-poison]').forEach(btn => {
    btn.addEventListener('click', () => openApplyPoisonModal(btn.dataset.invPoison));
  });

  // Rework v3: Use consumable on another character
  grid.querySelectorAll('[data-inv-use-on]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const invId = btn.dataset.invUseOn;
      const card = btn.closest('.inv-card');
      const itemName = card?.querySelector('.inv-name')?.textContent || 'item';
      const target = await openP2PTargetPicker({
        title: `💊 Use ${itemName} on…`,
        excludeSelf: true,
        aliveOnly: true,
      });
      if (!target) return;
      try {
        const res = await api.post(`/api/inventory/${invId}/use`, { target_id: target.id });
        (res.results || []).forEach(r => addLog(`🧪 ${itemName} → ${target.name}: ${r}`));
        showToast(`🧪 Used ${itemName} on ${target.name}`);
        await loadChar();
        loadInventory();
      } catch (e) {
        const detail = e?.body?.detail || e?.message || 'Failed';
        showToast(typeof detail === 'object' ? detail.message : String(detail), 'error');
      }
    });
  });

  // Rework v3: Give item to another player
  grid.querySelectorAll('[data-inv-give]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const invId = btn.dataset.invGive;
      const card = btn.closest('.inv-card');
      const itemName = card?.querySelector('.inv-name')?.textContent || 'item';
      const qtyStr = card?.querySelector('.inv-qty')?.textContent || 'x1';
      const stackQty = Math.max(1, parseInt(qtyStr.replace(/\D/g, '')) || 1);
      const target = await openP2PTargetPicker({
        title: `🎁 Give ${itemName} to…`,
        excludeSelf: true,
        playersOnly: true,
        aliveOnly: true,
      });
      if (!target) return;
      let qty = 1;
      if (stackQty > 1) {
        const raw = prompt(`How many ${itemName} to give ${target.name}? (1-${stackQty})`, '1');
        if (raw === null) return;
        qty = Math.max(1, Math.min(stackQty, parseInt(raw) || 1));
      }
      try {
        await api.post(`/api/inventory/${invId}/transfer`, {
          target_character_id: target.id, quantity: qty,
        });
        showToast(`🎁 Sent ${itemName} ×${qty} to ${target.name}`);
        addLog(`🎁 Gave ${itemName} ×${qty} to ${target.name}`);
        loadInventory();
      } catch (e) {
        const detail = e?.body?.detail || e?.message || 'Failed';
        showToast(typeof detail === 'object' ? detail.message : String(detail), 'error');
      }
    });
  });
}

// ══════════════════════════════════════════════════════════════
