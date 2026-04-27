// ════════════════════════════════════════════════════════
// Item database + Card library
// Source: gm-app.js lines 3801–4577
// Globals shared via window.* and module-scope hoisting.
// ════════════════════════════════════════════════════════

// ITEM DATABASE
// ══════════════════════════════════════════════════════════════
let allItems = [];
let allCategories = [];
let editingItemId = null;
let tempBonuses = []; // bonuses being edited in modal
let tempDamageModes = []; // Rework v3: preset damage modes for the current weapon

const BONUS_TYPES = [
  {value: 'percent_damage_reduction', label: '% Damage Reduction'},
  {value: 'flat_damage_reduction', label: 'Flat Damage Reduction'},
  {value: 'stat_bonus', label: 'Stat Bonus'},
  {value: 'attack_bonus', label: 'Attack Bonus'},
  {value: 'damage_bonus', label: 'Damage Bonus'},
  {value: 'damage_dice_count', label: 'Damage Dice Count'},
  {value: 'damage_dice_type', label: 'Damage Dice Type'},
  {value: 'hp_bonus', label: 'HP Bonus'},
  {value: 'mana_bonus', label: 'Mana Bonus'},
  {value: 'initiative_bonus', label: 'Initiative Bonus'},
  {value: 'speed_bonus', label: 'Speed Bonus'},
  {value: 'custom', label: 'Custom'},
];

const STAT_NAMES = ['strength','dexterity','constitution','intelligence','wisdom','charisma'];

function bronzeToDisplay(bronze) {
  if (!bronze || bronze === 0) return '0';
  let r = bronze;
  const p = Math.floor(r / 1000); r %= 1000;
  const g = Math.floor(r / 100); r %= 100;
  const s = Math.floor(r / 10); r %= 10;
  const parts = [];
  if (p) parts.push(`<span style="color:#e0c97f">${p}P</span>`);
  if (g) parts.push(`<span class="price-gold">${g}G</span>`);
  if (s) parts.push(`<span class="price-silver">${s}S</span>`);
  if (r) parts.push(`<span class="price-bronze">${r}B</span>`);
  return parts.join(' ') || '0';
}
const copperToDisplay = bronzeToDisplay;

async function loadCategories() {
  try {
    allCategories = await api.get('/api/item-categories');
    // Populate filter dropdown
    const filterSel = $('#item-filter-category');
    const edSel = $('#item-ed-category');
    filterSel.innerHTML = '<option value="">All Categories</option>';
    edSel.innerHTML = '';
    for (const c of allCategories) {
      filterSel.innerHTML += `<option value="${c.id}">${c.icon} ${c.name}</option>`;
      edSel.innerHTML += `<option value="${c.id}">${c.icon} ${c.name}</option>`;
    }
  } catch { /* silent */ }
}

async function loadItems() {
  try {
    const params = new URLSearchParams();
    const search = $('#item-search').value.trim();
    const catId = $('#item-filter-category').value;
    const rarity = $('#item-filter-rarity').value;
    if (search) params.set('search', search);
    if (catId) params.set('category_id', catId);
    if (rarity) params.set('rarity', rarity);
    const qs = params.toString();
    allItems = await api.get(`/api/items${qs ? '?' + qs : ''}`);
    renderItemGrid();
  } catch (e) { console.error('loadItems error:', e); }
}

function renderItemGrid() {
  const grid = $('#item-grid');
  if (!allItems.length) {
    grid.innerHTML = '<div class="item-grid-empty">No items found. Click "+ New Item" to create one.</div>';
    return;
  }
  grid.innerHTML = allItems.map(item => {
    const bonusTags = (item.bonuses || []).map(b => {
      let label = b.bonus_type.replace(/_/g, ' ');
      if (b.stat_name) label = `${b.stat_name} +${b.value}`;
      else label = `${label} ${b.value > 0 ? '+' : ''}${b.value}`;
      return `<span class="ic-bonus-tag">${label}</span>`;
    }).join('');
    const weaponLine = item.weapon_stats
      ? `<div class="ic-weapon">⚔️ ${item.weapon_stats.dice_count}d${item.weapon_stats.dice_type} ${item.weapon_stats.damage_type}${item.weapon_stats.range ? ' · ' + item.weapon_stats.range : ''}</div>`
      : '';
    const tags = (item.tags || []).map(t => `<span class="ic-bonus-tag">#${t}</span>`).join('');
    return `
      <div class="item-card rarity-border-${item.rarity}" data-item-id="${item.id}">
        <div class="ic-top">
          <span class="ic-icon">${item.category_icon}</span>
          <span class="ic-name rarity-${item.rarity}">${item.name}</span>
          <span class="rarity-badge ${item.rarity}">${item.rarity}</span>
        </div>
        <div class="ic-desc">${item.description || ''}</div>
        <div class="ic-meta">
          <span class="ic-price price-display">${bronzeToDisplay(item.base_price_bronze || item.base_price_copper)}</span>
          ${item.equippable ? '<span>📎 Equip</span>' : ''}
          ${item.consumable ? '<span>🧪 Use</span>' : ''}
          ${item.mana_cost ? `<span style="color:#60a5fa">🔮${item.mana_cost}</span>` : ''}
        </div>
        ${weaponLine}
        <div class="ic-bonuses">${bonusTags}${tags}</div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.item-card').forEach(card => {
    card.addEventListener('click', () => openItemEditor(parseInt(card.dataset.itemId)));
  });
}

// ── Item Editor Modal ──
function openItemEditor(itemId = null) {
  editingItemId = itemId;
  const modal = $('#item-modal');
  modal.classList.remove('hidden');

  if (itemId) {
    const item = allItems.find(i => i.id === itemId);
    if (!item) return;
    $('#item-modal-title').textContent = 'Edit Item';
    $('#item-ed-name').value = item.name;
    $('#item-ed-desc').value = item.description || '';
    if (item.category_id) $('#item-ed-category').value = item.category_id;
    $('#item-ed-rarity').value = item.rarity;
    const _bp = item.base_price_bronze || item.base_price_copper || 0;
    let _rem = _bp;
    $('#item-ed-price-p').value = Math.floor(_rem / 1000); _rem %= 1000;
    $('#item-ed-price-g').value = Math.floor(_rem / 100); _rem %= 100;
    $('#item-ed-price-s').value = Math.floor(_rem / 10); _rem %= 10;
    $('#item-ed-price-b').value = _rem;
    $('#item-ed-price').value = _bp;
    $('#item-ed-equippable').checked = item.equippable && !item.is_potion;
    $('#item-ed-equippable').disabled = !!item.is_potion;
    $('#item-ed-consumable').checked = item.consumable;
    // FIX 6: potion identity
    $('#item-ed-is-potion').checked = !!item.is_potion;
    $('#potion-identity-section').classList.toggle('hidden', !item.is_potion);
    _setPotionIcon(item.potion_icon || '🧪');
    $('#item-ed-mana-cost').value = item.mana_cost || 0;
    $('#item-ed-tags').value = (item.tags || []).join(', ');
    // Weapon stats
    const isWeapon = !!item.weapon_stats;
    $('#item-ed-is-weapon').checked = isWeapon;
    $('#weapon-stats-section').classList.toggle('hidden', !isWeapon);
    if (isWeapon) {
      $('#item-ed-wdice-count').value = item.weapon_stats.dice_count;
      $('#item-ed-wdice-type').value = item.weapon_stats.dice_type;
      $('#item-ed-wdmg-type').value = item.weapon_stats.damage_type;
      $('#item-ed-wrange').value = item.weapon_stats.range || '';
      // Rework v3 Phase 7: grid-cell range (1 = melee, higher = ranged).
      $('#item-ed-wrange-cells').value = item.weapon_stats.range_cells ?? 1;
      // Rework Phase 2: which stat contributes the +bonus for hit / damage
      $('#item-ed-whitstat').value = item.weapon_stats.hit_stat || 'strength';
      $('#item-ed-wdmgstat').value = item.weapon_stats.damage_stat ?? 'strength';
      // Rework v3: preset damage modes (optional)
      tempDamageModes = Array.isArray(item.weapon_stats.damage_modes)
        ? item.weapon_stats.damage_modes.map(m => ({ ...m }))
        : [];
    } else {
      tempDamageModes = [];
    }
    renderDamageModeEditor();
    tempBonuses = (item.bonuses || []).map(b => ({...b}));
    // Use effects
    const ue = item.use_effect;
    tempUseEffects = (ue && ue.effects) ? ue.effects.map(e => ({...e})) : [];
    $('#use-effects-section').classList.toggle('hidden', !item.consumable);
    renderUseEffectEditor();
    $('#btn-delete-item').classList.remove('hidden');
  } else {
    $('#item-modal-title').textContent = 'New Item';
    $('#item-ed-name').value = '';
    $('#item-ed-desc').value = '';
    $('#item-ed-rarity').value = 'common';
    $('#item-ed-price').value = 0;
    $('#item-ed-equippable').checked = false;
    $('#item-ed-consumable').checked = false;
    $('#item-ed-mana-cost').value = 0;
    $('#item-ed-tags').value = '';
    $('#item-ed-is-weapon').checked = false;
    $('#weapon-stats-section').classList.add('hidden');
    $('#use-effects-section').classList.add('hidden');
    // FIX 6: reset potion identity for new items
    $('#item-ed-is-potion').checked = false;
    $('#potion-identity-section').classList.add('hidden');
    _setPotionIcon('🧪');
    tempBonuses = [];
    tempUseEffects = [];
    tempDamageModes = [];
    renderUseEffectEditor();
    renderDamageModeEditor();
    $('#btn-delete-item').classList.add('hidden');
  }
  renderBonusEditor();
}

function closeItemModal() {
  $('#item-modal').classList.add('hidden');
  editingItemId = null;
  tempBonuses = [];
}

function renderBonusEditor() {
  const list = $('#bonus-editor-list');
  if (!tempBonuses.length) {
    list.innerHTML = '<div style="font-size:0.78rem;color:var(--text-muted);padding:4px 0">No bonuses. Click "+ Add Bonus".</div>';
    return;
  }
  list.innerHTML = tempBonuses.map((b, i) => {
    const typeOptions = BONUS_TYPES.map(t =>
      `<option value="${t.value}" ${t.value === b.bonus_type ? 'selected' : ''}>${t.label}</option>`
    ).join('');
    const showStat = b.bonus_type === 'stat_bonus';
    const statOptions = STAT_NAMES.map(s =>
      `<option value="${s}" ${s === b.stat_name ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`
    ).join('');
    return `<div class="bonus-row" data-bonus-idx="${i}">
      <select class="bonus-type-select" data-field="bonus_type">${typeOptions}</select>
      <select class="bonus-stat-select" data-field="stat_name" style="${showStat ? '' : 'display:none'}">${statOptions}</select>
      <input type="number" class="bonus-value-input" data-field="value" value="${b.value}" step="any">
      <label style="font-size:0.7rem;white-space:nowrap"><input type="checkbox" data-field="is_conditional" ${b.is_conditional ? 'checked' : ''}> Cond.</label>
      <button class="btn-icon danger" data-remove-bonus="${i}" title="Remove">🗑️</button>
    </div>`;
  }).join('');

  // Wire events
  list.querySelectorAll('.bonus-row').forEach(row => {
    const idx = parseInt(row.dataset.bonusIdx);
    row.querySelector('[data-field="bonus_type"]').addEventListener('change', e => {
      tempBonuses[idx].bonus_type = e.target.value;
      row.querySelector('[data-field="stat_name"]').style.display = e.target.value === 'stat_bonus' ? '' : 'none';
    });
    row.querySelector('[data-field="stat_name"]').addEventListener('change', e => {
      tempBonuses[idx].stat_name = e.target.value;
    });
    row.querySelector('[data-field="value"]').addEventListener('change', e => {
      tempBonuses[idx].value = parseFloat(e.target.value) || 0;
    });
    row.querySelector('[data-field="is_conditional"]').addEventListener('change', e => {
      tempBonuses[idx].is_conditional = e.target.checked;
    });
    row.querySelector('[data-remove-bonus]').addEventListener('click', () => {
      tempBonuses.splice(idx, 1);
      renderBonusEditor();
    });
  });
}

async function saveItem() {
  const tagsRaw = $('#item-ed-tags').value.trim();
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
  const body = {
    name: $('#item-ed-name').value.trim() || 'Item',
    description: $('#item-ed-desc').value.trim(),
    category_id: parseInt($('#item-ed-category').value) || null,
    category: (allCategories.find(c => c.id === parseInt($('#item-ed-category').value))?.name || 'Misc').toLowerCase(),
    rarity: $('#item-ed-rarity').value,
    base_price_bronze: (parseInt($('#item-ed-price-p').value)||0)*1000 + (parseInt($('#item-ed-price-g').value)||0)*100 + (parseInt($('#item-ed-price-s').value)||0)*10 + (parseInt($('#item-ed-price-b').value)||0),
    equippable: $('#item-ed-equippable').checked,
    consumable: $('#item-ed-consumable').checked,
    mana_cost: parseInt($('#item-ed-mana-cost').value) || 0,
    tags: JSON.stringify(tags),
    bonuses: tempBonuses.map(b => ({
      bonus_type: b.bonus_type,
      stat_name: b.bonus_type === 'stat_bonus' ? b.stat_name : null,
      value: b.value,
      is_conditional: b.is_conditional || false,
      condition_description: b.condition_description || null,
    })),
  };
  // FIX 6: potion identity fields
  body.is_potion = $('#item-ed-is-potion').checked;
  body.potion_icon = $('#item-ed-potion-icon').value || '🧪';
  // Potions are always consumable and NEVER equippable
  if (body.is_potion) { body.consumable = true; body.equippable = false; }
  if (tempUseEffects.length > 0) {
    body.use_effect = { effects: tempUseEffects };
  } else {
    body.use_effect = null;
  }
  if ($('#item-ed-is-weapon').checked) {
    body.weapon_stats = {
      dice_count: parseInt($('#item-ed-wdice-count').value) || 1,
      dice_type: parseInt($('#item-ed-wdice-type').value) || 6,
      damage_type: $('#item-ed-wdmg-type').value || 'physical',
      range: $('#item-ed-wrange').value.trim() || null,
      // Rework v3 Phase 7: cell-range the server enforces against the battle map.
      range_cells: Math.max(1, parseInt($('#item-ed-wrange-cells').value) || 1),
      // Rework Phase 2: stat-bonus sources for hit / damage rolls
      hit_stat: $('#item-ed-whitstat').value || 'strength',
      damage_stat: $('#item-ed-wdmgstat').value || null,
      // Rework v3: optional preset damage modes (empty list = single-mode weapon)
      damage_modes: tempDamageModes.map(m => ({
        name: (m.name || '').trim() || `${m.dice_count}d${m.dice_type}`,
        dice_count: parseInt(m.dice_count) || 1,
        dice_type: parseInt(m.dice_type) || 6,
        damage_type: m.damage_type || 'physical',
        damage_stat: m.damage_stat || null,
      })),
    };
  }

  try {
    if (editingItemId) {
      await api.put(`/api/items/${editingItemId}`, body);
      // Update bonuses: delete all existing, re-add
      const existing = allItems.find(i => i.id === editingItemId);
      if (existing) {
        for (const b of existing.bonuses || []) {
          await api.del(`/api/item-bonuses/${b.id}`);
        }
      }
      for (const b of body.bonuses) {
        await api.post(`/api/items/${editingItemId}/bonuses`, b);
      }
      showToast(`Item "${body.name}" updated`);
    } else {
      await api.post('/api/items', body);
      showToast(`Item "${body.name}" created`);
    }
    closeItemModal();
    await loadItems();
  } catch (e) {
    showToast('Error: ' + e.message);
  }
}

async function deleteItem() {
  if (!editingItemId) return;
  const item = allItems.find(i => i.id === editingItemId);
  if (!confirm(`Delete "${item?.name || 'item'}"?`)) return;
  try {
    await api.del(`/api/items/${editingItemId}`);
    showToast(`Item deleted`);
    closeItemModal();
    await loadItems();
  } catch (e) { showToast('Error: ' + e.message); }
}

// ── FIX 6: Potion Icon Picker ──
const POTION_ICONS = ['🧪','🫧','💊','🍶','🧴','🔮','🌿','💉'];

function _setPotionIcon(icon) {
  const hidden = document.getElementById('item-ed-potion-icon');
  if (hidden) hidden.value = icon || '🧪';
  const picker = document.getElementById('potion-icon-picker');
  if (!picker) return;
  if (!picker.childElementCount) {
    // Populate picker grid on first render
    picker.innerHTML = POTION_ICONS.map(ic => `
      <button type="button" class="potion-ic" data-ic="${ic}"
              style="width:30px;height:30px;border-radius:var(--r-sm);
                     background:var(--bg-surface);border:1px solid var(--border);
                     cursor:pointer;font-size:1rem;padding:0;line-height:1">${ic}</button>`).join('');
    picker.querySelectorAll('.potion-ic').forEach(btn => {
      btn.addEventListener('click', () => _setPotionIcon(btn.dataset.ic));
    });
  }
  // Highlight current selection
  picker.querySelectorAll('.potion-ic').forEach(btn => {
    const active = btn.dataset.ic === (icon || '🧪');
    btn.style.borderColor = active ? 'var(--accent)' : 'var(--border)';
    btn.style.background = active ? 'var(--bg-surface-3)' : 'var(--bg-surface)';
  });
}

// Toggle potion identity section + auto-consumable when is_potion is checked
const _ipChk = document.getElementById('item-ed-is-potion');
if (_ipChk) {
  _ipChk.addEventListener('change', e => {
    const on = e.target.checked;
    document.getElementById('potion-identity-section')?.classList.toggle('hidden', !on);
    if (on) {
      // Potions are always consumable — reflect immediately
      const cons = document.getElementById('item-ed-consumable');
      if (cons && !cons.checked) {
        cons.checked = true;
        document.getElementById('use-effects-section')?.classList.remove('hidden');
      }
      // Potions cannot be equipped — disable & uncheck
      const eq = document.getElementById('item-ed-equippable');
      if (eq) { eq.checked = false; eq.disabled = true; }
      _setPotionIcon(document.getElementById('item-ed-potion-icon')?.value || '🧪');
    } else {
      const eq = document.getElementById('item-ed-equippable');
      if (eq) eq.disabled = false;
    }
  });
}

// ══════════════════════════════════════════════════════════════
// CARD LIBRARY
// ══════════════════════════════════════════════════════════════
let allCards = [];
let editingCardId = null;
let pendingCardImage = null;

async function loadCards() {
  if (!SESSION_ID) return;
  try {
    const search = $('#card-search').value.trim();
    const type = $('#card-filter-type').value;
    let url = `/api/cards?session_id=${SESSION_ID}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    if (type) url += `&type=${encodeURIComponent(type)}`;
    allCards = await api.get(url);
    renderCardGrid();
  } catch (e) { console.error('loadCards error:', e); }
}

function renderCardGrid() {
  const grid = $('#card-grid');
  if (!allCards.length) {
    grid.innerHTML = '<div class="item-grid-empty">No cards found. Click "+ New Card" to create one.</div>';
    return;
  }
  grid.innerHTML = allCards.map(card => {
    const typeIcon = { character: '👤', location: '📍', item: '⚔️', custom: '🔮' }[card.card_type] || '🃏';
    const hasImage = card.image_url ? `<div style="margin-top:6px;max-height:120px;overflow:hidden;border-radius:var(--r-sm)"><img src="${card.image_url}" style="width:100%;height:auto"></div>` : '';
    return `
      <div class="item-card" data-card-id="${card.id}">
        <div class="ic-top">
          <span class="ic-icon">${typeIcon}</span>
          <span class="ic-name">${card.name}</span>
          <span style="font-size:0.6rem;color:var(--text-muted);text-transform:capitalize">${card.card_type}</span>
        </div>
        <div class="ic-desc">${card.description || ''}</div>
        ${hasImage}
      </div>`;
  }).join('');

  grid.querySelectorAll('[data-card-id]').forEach(card => {
    card.addEventListener('click', () => openCardEditor(parseInt(card.dataset.cardId)));
  });
}

function openCardEditor(cardId = null) {
  editingCardId = cardId;
  const modal = $('#card-modal');
  modal.classList.remove('hidden');
  pendingCardImage = null;

  if (cardId) {
    const card = allCards.find(c => c.id === cardId);
    if (!card) return;
    $('#card-modal-title').textContent = 'Edit Card';
    $('#card-ed-name').value = card.name;
    $('#card-ed-type').value = card.card_type;
    $('#card-ed-desc').value = card.description || '';
    $('#card-ed-data').value = JSON.stringify(card.card_data || {}, null, 2);
    if (card.image_url) {
      $('#card-preview-img').src = card.image_url;
      $('#card-preview-img').style.display = 'block';
      $('#card-no-image').style.display = 'none';
    } else {
      $('#card-preview-img').style.display = 'none';
      $('#card-no-image').style.display = 'block';
    }
    $('#btn-delete-card').classList.remove('hidden');
  } else {
    $('#card-modal-title').textContent = 'New Card';
    $('#card-ed-name').value = '';
    $('#card-ed-type').value = 'character';
    $('#card-ed-desc').value = '';
    $('#card-ed-data').value = '{}';
    $('#card-preview-img').style.display = 'none';
    $('#card-no-image').style.display = 'block';
    $('#btn-delete-card').classList.add('hidden');
  }
}

function closeCardModal() {
  $('#card-modal').classList.add('hidden');
  editingCardId = null;
  pendingCardImage = null;
}

async function saveCard() {
  const name = $('#card-ed-name').value.trim();
  if (!name) { showToast('Name is required'); return; }

  let cardData = {};
  try {
    cardData = JSON.parse($('#card-ed-data').value || '{}');
  } catch { cardData = {}; }

  const payload = {
    session_id: SESSION_ID,
    name: name,
    description: $('#card-ed-desc').value,
    card_type: $('#card-ed-type').value,
    card_data: cardData,
  };

  try {
    let card;
    if (editingCardId) {
      card = await api.put(`/api/cards/${editingCardId}`, payload);
    } else {
      card = await api.post('/api/cards', payload);
    }

    if (pendingCardImage) {
      const formData = new FormData();
      formData.append('file', pendingCardImage);
      await fetch(`/api/cards/${card.id}/upload-image`, {
        method: 'POST',
        body: formData,
      });
    }

    showToast(editingCardId ? 'Card updated' : 'Card created');
    closeCardModal();
    loadCards();
  } catch (e) {
    showToast('Error: ' + (e.message || 'Failed to save card'));
  }
}

async function deleteCard() {
  if (!editingCardId) return;
  if (!confirm('Delete this card?')) return;
  try {
    await api.del(`/api/cards/${editingCardId}`);
    showToast('Card deleted');
    closeCardModal();
    loadCards();
  } catch (e) {
    showToast('Error: ' + (e.message || 'Failed to delete card'));
  }
}

// ── Card Library event listeners ──
$('#btn-new-card').addEventListener('click', () => openCardEditor());
$('#btn-refresh-cards').addEventListener('click', loadCards);
$('#btn-close-card-modal').addEventListener('click', closeCardModal);
$('#btn-cancel-card').addEventListener('click', closeCardModal);
$('#btn-save-card').addEventListener('click', saveCard);
$('#btn-delete-card').addEventListener('click', deleteCard);
$('#card-search').addEventListener('input', debounce(loadCards, 300));
$('#card-filter-type').addEventListener('change', loadCards);

$('#card-image-upload').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  pendingCardImage = file;
  const reader = new FileReader();
  reader.onload = ev => {
    $('#card-preview-img').src = ev.target.result;
    $('#card-preview-img').style.display = 'block';
    $('#card-no-image').style.display = 'none';
  };
  reader.readAsDataURL(file);
});

// ── Use Effects Editor ──
let tempUseEffects = [];
const USE_EFFECT_TYPES = [
  {value:'heal_hp', label:'Heal HP'},
  {value:'heal_spirit', label:'Heal Spirit HP'},
  {value:'restore_mana', label:'Restore Mana'},
  {value:'apply_status', label:'Apply Status'},
  {value:'stat_boost', label:'Stat Boost'},
  {value:'remove_status', label:'Remove Status'},
  {value:'damage', label:'Damage (self)'},
  {value:'custom', label:'Custom'},
];

function _formatUseEffectPreview(e) {
  if (e.type === 'heal_hp') {
    const parts = [];
    if (e.dice_count && e.dice_type) parts.push(`${e.dice_count}d${e.dice_type}`);
    if (e.flat_bonus) parts.push(`${e.flat_bonus > 0 ? '+' : ''}${e.flat_bonus}`);
    return `❤️ Heal ${parts.join(' ') || '0'} HP`;
  }
  if (e.type === 'heal_spirit') {
    const parts = [];
    if (e.dice_count && e.dice_type) parts.push(`${e.dice_count}d${e.dice_type}`);
    if (e.flat_bonus) parts.push(`${e.flat_bonus > 0 ? '+' : ''}${e.flat_bonus}`);
    return `👻 Heal ${parts.join(' ') || '0'} Spirit HP`;
  }
  if (e.type === 'damage') {
    const parts = [];
    if (e.dice_count && e.dice_type) parts.push(`${e.dice_count}d${e.dice_type}`);
    if (e.flat_bonus) parts.push(`${e.flat_bonus > 0 ? '+' : ''}${e.flat_bonus}`);
    return `💥 Damage ${parts.join(' ') || '0'}`;
  }
  if (e.type === 'restore_mana') return `🔮 Restore ${e.amount || 0} Mana`;
  if (e.type === 'apply_status') return `✨ Apply status #${e.template_id || '?'} for ${e.duration_turns || 0} turns`;
  if (e.type === 'stat_boost') return `📊 ${(e.stat || '?').toUpperCase()} ${e.value > 0 ? '+' : ''}${e.value || 0} for ${e.duration_turns || 0} turns`;
  if (e.type === 'remove_status') return `🧹 Remove "${e.status_name || '?'}"`;
  if (e.type === 'custom') return `📝 ${e.description || 'Custom effect'}`;
  return e.type;
}

function renderUseEffectEditor() {
  const list = $('#use-effect-editor-list');
  if (!tempUseEffects.length) {
    list.innerHTML = '<div style="font-size:0.78rem;color:var(--text-muted);padding:4px 0">No effects. Click "+ Add Effect".</div>';
    return;
  }
  list.innerHTML = tempUseEffects.map((e, i) => {
    const typeOpts = USE_EFFECT_TYPES.map(t =>
      `<option value="${t.value}" ${t.value === e.type ? 'selected' : ''}>${t.label}</option>`
    ).join('');
    let fields = '';
    if (e.type === 'heal_hp' || e.type === 'heal_spirit' || e.type === 'damage') {
      fields = `<input type="number" data-ue-field="dice_count" value="${e.dice_count||1}" min="1" style="width:40px" title="Dice count">d<input type="number" data-ue-field="dice_type" value="${e.dice_type||4}" min="1" style="width:40px" title="Dice type">+<input type="number" data-ue-field="flat_bonus" value="${e.flat_bonus||0}" style="width:40px" title="Flat bonus">`;
    } else if (e.type === 'restore_mana') {
      fields = `<label style="font-size:0.7rem">Amount:</label><input type="number" data-ue-field="amount" value="${e.amount||0}" style="width:50px">`;
    } else if (e.type === 'apply_status') {
      fields = `<label style="font-size:0.7rem">Template ID:</label><input type="number" data-ue-field="template_id" value="${e.template_id||''}" style="width:50px"><label style="font-size:0.7rem">Turns:</label><input type="number" data-ue-field="duration_turns" value="${e.duration_turns||3}" style="width:40px">`;
    } else if (e.type === 'stat_boost') {
      const statOpts = STAT_NAMES.map(s => `<option value="${s}" ${s===e.stat?'selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`).join('');
      fields = `<select data-ue-field="stat">${statOpts}</select><input type="number" data-ue-field="value" value="${e.value||0}" style="width:40px" title="Value"><label style="font-size:0.7rem">Turns:</label><input type="number" data-ue-field="duration_turns" value="${e.duration_turns||3}" style="width:40px">`;
    } else if (e.type === 'remove_status') {
      fields = `<label style="font-size:0.7rem">Name:</label><input type="text" data-ue-field="status_name" value="${e.status_name||''}" style="width:100px" placeholder="Poisoned">`;
    } else if (e.type === 'custom') {
      fields = `<input type="text" data-ue-field="description" value="${e.description||''}" style="width:160px" placeholder="Effect description">`;
    }
    const preview = _formatUseEffectPreview(e);
    const isFirst = i === 0;
    const isLast = i === tempUseEffects.length - 1;
    return `<div class="ue-row" data-ue-idx="${i}" style="padding:6px;background:var(--bg-surface-2);border-radius:var(--r-sm);margin-bottom:6px;border-left:3px solid #a855f7">
      <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-bottom:4px">
        <select class="ue-type-select" style="font-size:0.75rem">${typeOpts}</select>
        ${fields}
        <button class="btn-icon" data-ue-up="${i}" title="Move up" ${isFirst?'disabled style="opacity:0.3"':''}>⬆️</button>
        <button class="btn-icon" data-ue-down="${i}" title="Move down" ${isLast?'disabled style="opacity:0.3"':''}>⬇️</button>
        <button class="btn-icon danger" data-remove-ue="${i}" title="Remove">🗑️</button>
      </div>
      <div style="font-size:0.7rem;color:var(--accent);padding-left:2px">→ ${preview}</div>
    </div>`;
  }).join('');

  list.querySelectorAll('.ue-row').forEach(row => {
    const idx = parseInt(row.dataset.ueIdx);
    row.querySelector('.ue-type-select').addEventListener('change', ev => {
      tempUseEffects[idx] = {type: ev.target.value};
      renderUseEffectEditor();
    });
    row.querySelectorAll('[data-ue-field]').forEach(inp => {
      inp.addEventListener('change', () => {
        const f = inp.dataset.ueField;
        const v = inp.type === 'number' ? (parseFloat(inp.value)||0) : inp.value;
        tempUseEffects[idx][f] = v;
        renderUseEffectEditor();  // refresh preview
      });
    });
    const rmBtn = row.querySelector('[data-remove-ue]');
    if (rmBtn) rmBtn.addEventListener('click', () => { tempUseEffects.splice(idx,1); renderUseEffectEditor(); });
    // Reorder
    const upBtn = row.querySelector('[data-ue-up]');
    if (upBtn && idx > 0) upBtn.addEventListener('click', () => {
      [tempUseEffects[idx-1], tempUseEffects[idx]] = [tempUseEffects[idx], tempUseEffects[idx-1]];
      renderUseEffectEditor();
    });
    const downBtn = row.querySelector('[data-ue-down]');
    if (downBtn && idx < tempUseEffects.length - 1) downBtn.addEventListener('click', () => {
      [tempUseEffects[idx], tempUseEffects[idx+1]] = [tempUseEffects[idx+1], tempUseEffects[idx]];
      renderUseEffectEditor();
    });
  });
}

// ── Wire Item DB Events ──
$('#btn-new-item').addEventListener('click', () => openItemEditor(null));
$('#btn-close-item-modal').addEventListener('click', closeItemModal);
$('#btn-cancel-item').addEventListener('click', closeItemModal);
$('#btn-save-item').addEventListener('click', saveItem);
$('#btn-delete-item').addEventListener('click', deleteItem);
$('#btn-add-bonus').addEventListener('click', () => {
  tempBonuses.push({bonus_type: 'stat_bonus', stat_name: 'strength', value: 0, is_conditional: false});
  renderBonusEditor();
});
$('#item-ed-is-weapon').addEventListener('change', e => {
  $('#weapon-stats-section').classList.toggle('hidden', !e.target.checked);
});

// ── Rework v3: damage modes editor ──
const _DMG_TYPES_DM = ['physical','fire','ice','lightning','poison','magic','necrotic','radiant'];
const _STATS_DM = ['strength','dexterity','constitution','intelligence','wisdom','charisma'];
function renderDamageModeEditor() {
  const host = $('#item-ed-dmodes');
  if (!host) return;
  if (!tempDamageModes.length) {
    host.innerHTML = '<div style="font-size:0.72rem;color:var(--text-muted);padding:2px 0">No modes — weapon uses the fixed Dice above.</div>';
    return;
  }
  host.innerHTML = tempDamageModes.map((m, i) => `
    <div class="dmg-mode-row" data-dm-idx="${i}" style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;padding:4px;background:var(--bg-surface-2);border-radius:var(--r-sm)">
      <input type="text" data-df="name" value="${m.name || ''}" placeholder="Mode name (e.g. Two-handed)" style="flex:1;min-width:130px;font-size:0.75rem">
      <input type="number" data-df="dice_count" value="${m.dice_count || 1}" min="1" max="20" style="width:42px;font-size:0.75rem">
      <span style="font-size:0.72rem">d</span>
      <input type="number" data-df="dice_type" value="${m.dice_type || 6}" min="2" max="100" style="width:44px;font-size:0.75rem">
      <select data-df="damage_type" style="font-size:0.72rem;width:90px">
        ${_DMG_TYPES_DM.map(t => `<option value="${t}"${t===(m.damage_type||'physical')?' selected':''}>${t}</option>`).join('')}
      </select>
      <select data-df="damage_stat" style="font-size:0.72rem;width:74px" title="Stat override (optional)">
        <option value=""${!m.damage_stat?' selected':''}>—</option>
        ${_STATS_DM.map(s => `<option value="${s}"${s===m.damage_stat?' selected':''}>${s.slice(0,3).toUpperCase()}</option>`).join('')}
      </select>
      <button type="button" class="btn btn-ghost btn-xs" data-dm-remove="${i}" style="color:var(--accent-red)">✕</button>
    </div>
  `).join('');
  host.querySelectorAll('.dmg-mode-row').forEach(row => {
    const idx = parseInt(row.dataset.dmIdx);
    row.querySelectorAll('[data-df]').forEach(inp => {
      inp.addEventListener('change', () => {
        const f = inp.dataset.df;
        let v = inp.value;
        if (f === 'dice_count' || f === 'dice_type') v = parseInt(v) || (f === 'dice_count' ? 1 : 6);
        if (f === 'damage_stat' && v === '') v = null;
        tempDamageModes[idx][f] = v;
      });
    });
    const rm = row.querySelector('[data-dm-remove]');
    if (rm) rm.addEventListener('click', () => {
      tempDamageModes.splice(idx, 1);
      renderDamageModeEditor();
    });
  });
}
if ($('#item-ed-add-dmode')) {
  $('#item-ed-add-dmode').addEventListener('click', () => {
    tempDamageModes.push({
      name: '',
      dice_count: parseInt($('#item-ed-wdice-count').value) || 1,
      dice_type: parseInt($('#item-ed-wdice-type').value) || 6,
      damage_type: $('#item-ed-wdmg-type').value || 'physical',
      damage_stat: null,
    });
    renderDamageModeEditor();
  });
}
$('#item-ed-consumable').addEventListener('change', e => {
  $('#use-effects-section').classList.toggle('hidden', !e.target.checked);
});
$('#btn-add-use-effect').addEventListener('click', () => {
  tempUseEffects.push({type: 'heal_hp', dice_count: 2, dice_type: 4, flat_bonus: 2});
  renderUseEffectEditor();
});

// Filters
let itemSearchTimer = null;
$('#item-search').addEventListener('input', () => {
  clearTimeout(itemSearchTimer);
  itemSearchTimer = setTimeout(loadItems, 300);
});
$('#item-filter-category').addEventListener('change', loadItems);
$('#item-filter-rarity').addEventListener('change', loadItems);

// ── Category Modal ──
$('#btn-new-category').addEventListener('click', () => {
  $('#category-modal').classList.remove('hidden');
  $('#cat-ed-name').value = '';
  $('#cat-ed-icon').value = '📦';
});
$('#btn-close-cat-modal').addEventListener('click', () => $('#category-modal').classList.add('hidden'));
$('#btn-cancel-cat').addEventListener('click', () => $('#category-modal').classList.add('hidden'));
$('#btn-save-cat').addEventListener('click', async () => {
  const name = $('#cat-ed-name').value.trim();
  if (!name) return;
  try {
    await api.post('/api/item-categories', {name, icon: $('#cat-ed-icon').value.trim() || '📦'});
    showToast(`Category "${name}" created`);
    $('#category-modal').classList.add('hidden');
    await loadCategories();
  } catch (e) { showToast('Error: ' + e.message); }
});

// Close modals on overlay click
$('#item-modal').addEventListener('click', e => { if (e.target === $('#item-modal')) closeItemModal(); });
$('#category-modal').addEventListener('click', e => { if (e.target === $('#category-modal')) $('#category-modal').classList.add('hidden'); });

// ══════════════════════════════════════════════════════════════
