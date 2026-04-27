// ════════════════════════════════════════════════════════
// GM Level-Up modal
// Source: gm-app.js lines 2101–2559
// Globals shared via window.* and module-scope hoisting.
// ════════════════════════════════════════════════════════

// Fix 1 — GM Level-Up Choice Modal
// ══════════════════════════════════════════════════════════════
const _GM_RANK_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'divine'];

function openGmLevelUpModal(character) {
  if (document.getElementById('gm-lvlup-modal')) return;

  const level = character.level ?? 0;
  const xp = character.experience || 0;
  const thresh = 100 + 100 * Math.max(0, level);
  const rank = (character.rank || 'common').toLowerCase();
  const isRankUp = level >= 10;

  const hpCount = character.hp_dice_count || 1;
  const hpDie = character.hp_die || 8;
  const hpDieStr = `${hpCount}d${hpDie}`;

  let mode = 'attributes';  // 'attributes' | 'rank'
  let selectedAbilityId = null;

  const overlay = document.createElement('div');
  overlay.id = 'gm-lvlup-modal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg);width:90%;max-width:480px;padding:20px">
      <h3 style="margin:0 0 8px">⬆ ${isRankUp ? 'Rank Up' : 'Level Up'}: ${character.name}</h3>
      <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:12px">
        ${isRankUp ? '<strong>Level 10 reached!</strong> Rank will advance automatically.' : `Current: <strong>${rank}</strong> rank · Level ${level} · ${xp}/${thresh} XP`}
      </div>

      <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:12px;padding:8px;background:var(--bg-surface-3);border-radius:var(--r-sm)">
        🎲 HP ${hpDieStr} + spiritual HP + mana — always rolled
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <div class="gm-lvlup-choice ${mode==='attributes'?'selected':''}" data-mode="attributes" style="padding:12px;border:2px solid var(--border);border-radius:var(--r-md);cursor:pointer;transition:all .15s">
          <div style="font-weight:700;font-size:0.9rem;margin-bottom:4px">📈 +1 Attribute</div>
          <div style="font-size:0.75rem;color:var(--text-muted)">
            Gain 1 attribute point
          </div>
        </div>
        <div class="gm-lvlup-choice ${mode==='rank'?'selected':''}" data-mode="rank" style="padding:12px;border:2px solid var(--border);border-radius:var(--r-md);cursor:pointer;transition:all .15s">
          <div style="font-weight:700;font-size:0.9rem;margin-bottom:4px">⭐ Promote Ability Rank</div>
          <div style="font-size:0.75rem;color:var(--text-muted)">
            Increase ability rank
          </div>
        </div>
      </div>

      <div id="gm-ability-select" style="display:none;margin-bottom:12px">
        <label style="font-size:0.78rem">Select ability:</label>
        <select id="gm-lvlup-ability" style="width:100%;font-size:0.78rem;margin-top:4px">
          <option value="">— Choose ability —</option>
        </select>
      </div>

      <div id="gm-lvlup-error" style="color:var(--accent-red);font-size:0.78rem;min-height:14px;margin-bottom:8px"></div>

      <div style="display:flex;gap:6px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" id="gm-lvlup-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="gm-lvlup-confirm">Confirm</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#gm-lvlup-cancel').addEventListener('click', () => overlay.remove());

  const err = overlay.querySelector('#gm-lvlup-error');
  const confirmBtn = overlay.querySelector('#gm-lvlup-confirm');
  const abilityArea = overlay.querySelector('#gm-ability-select');
  const abilitySelect = overlay.querySelector('#gm-lvlup-ability');

  // Load character abilities
  (async () => {
    try {
      const abs = await api.get(`/api/characters/${character.id}/abilities`);
      const _RANKS = ['common','uncommon','rare','epic','legendary','mythic','divine'];
      abs.forEach(a => {
        const curRank = a.ability_rank || 'common';
        const idx = _RANKS.indexOf(curRank);
        const isMax = idx >= _RANKS.length - 1;
        const nextRank = isMax ? null : _RANKS[idx + 1];
        const opt = document.createElement('option');
        opt.value = a.character_ability_id;
        opt.textContent = `${a.name} (${curRank}${nextRank ? ' → ' + nextRank : ' — max'})`;
        if (isMax) opt.disabled = true;
        abilitySelect.appendChild(opt);
      });
    } catch {}
  })();

  overlay.querySelectorAll('.gm-lvlup-choice').forEach(card => {
    card.addEventListener('click', () => {
      mode = card.dataset.mode;
      overlay.querySelectorAll('.gm-lvlup-choice').forEach(c => {
        c.classList.toggle('selected', c === card);
        c.style.borderColor = c === card ? 'var(--accent)' : 'var(--border)';
        c.style.background = c === card ? 'rgba(96,165,250,0.08)' : '';
      });
      abilityArea.style.display = mode === 'rank' ? 'block' : 'none';
    });
  });

  // Set initial selection style
  const initialCard = overlay.querySelector(`[data-mode="${mode}"]`);
  if (initialCard) {
    initialCard.style.borderColor = 'var(--accent)';
    initialCard.style.background = 'rgba(96,165,250,0.08)';
  }

  confirmBtn.addEventListener('click', async () => {
    if (mode === 'rank') {
      selectedAbilityId = parseInt(abilitySelect.value);
      if (!selectedAbilityId) {
        err.textContent = 'Select an ability to promote';
        return;
      }
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Rolling…';
    const payload = { choice: mode };
    if (mode === 'ability') payload.ability_id = selectedAbilityId;

    try {
      const res = await api.post(`/api/characters/${character.id}/level-up`, payload);
      const hpGained = res.chosen?.hp_gained ?? '?';
      const attrPoints = res.attribute_points_available ?? '?';
      const abilityName = res.chosen?.ability_name || '';

      if (mode === 'attributes') {
        showToast(`Level ${res.level}! +${hpGained} HP · +1 point (total: ${attrPoints})`, 'accent');
        addLog('gm.lvl', `${character.name} → Lvl ${res.level} · +${hpGained} HP · +1 point`);
      } else {
        showToast(`Level ${res.level}! +${hpGained} HP · ⚡ ${abilityName} +1 level`, 'accent');
        addLog('gm.lvl', `${character.name} → Lvl ${res.level} · +${hpGained} HP · ${abilityName} upgraded`);
      }
      if (res.chosen?.rank_promoted) {
        addLog('gm.rank', `${character.name} auto-promoted to ${res.rank}!`);
      }
      overlay.remove();
      await refreshChars();
      renderCharDetail();
    } catch (e) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirm';
      let msg = 'Level up failed';
      try { const err = JSON.parse(e.message); msg = err.detail?.message || err.detail || msg; } catch {}
      err.textContent = msg;

      if (!confirm(`${msg}. Force level-up anyway?`)) return;
      try {
        const res = await api.post(`/api/characters/${character.id}/level-up`, { ...payload, force: true });
        overlay.remove();
        await refreshChars();
        renderCharDetail();
      } catch { showToast('Level up failed'); }
    }
  });
}

// ── Give Item Modal ─────────────────────────────────────────
function openGmGiveItemModal(charId) {
  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay-gm';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg);width:90%;max-width:500px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--bg-surface-2)">
        <h3 style="flex:1;font-size:0.9rem">Give Item</h3>
        <button class="btn-icon" id="gm-give-close">✕</button>
      </div>
      <div style="padding:12px">
        <input type="text" id="gm-give-search" placeholder="Search items..." style="width:100%;margin-bottom:8px">
        <div id="gm-give-list" style="max-height:50vh;overflow-y:auto"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#gm-give-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Load all items
  let allItems = [];
  (async () => {
    allItems = await api.get('/api/items');
    renderGiveList(allItems);
  })();

  overlay.querySelector('#gm-give-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderGiveList(allItems.filter(i => i.name.toLowerCase().includes(q)));
  });

  function renderGiveList(items) {
    const list = overlay.querySelector('#gm-give-list');
    list.innerHTML = items.map(i => `
      <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
        <span class="rarity-${i.rarity}" style="flex:1;font-size:0.82rem;font-weight:600">${i.name}</span>
        <span style="font-size:0.7rem;color:var(--text-muted)">${i.rarity}</span>
        <button class="btn btn-primary btn-xs" data-give-item="${i.id}">Give</button>
      </div>
    `).join('');

    list.querySelectorAll('[data-give-item]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.post(`/api/characters/${charId}/inventory`, { item_id: parseInt(btn.dataset.giveItem) });
        overlay.remove();
        loadGmCharInventory(charId);
        addLog('gm.inv', `Gave item #${btn.dataset.giveItem} to character #${charId}`);
      });
    });
  }
}

// ── Transaction History Modal ─────────────────────────────────
async function openTxHistoryModal(charId, charName) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg);width:90%;max-width:520px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--bg-surface-2)">
        <h3 style="flex:1;font-size:0.9rem">📜 Transaction History — ${charName}</h3>
        <button class="btn-icon" id="tx-close">✕</button>
      </div>
      <div id="tx-list" style="padding:12px;overflow-y:auto;flex:1;font-size:0.8rem"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#tx-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  try {
    const txs = await api.get(`/api/characters/${charId}/transactions`);
    const el = overlay.querySelector('#tx-list');
    if (!txs.length) { el.innerHTML = '<span class="text-muted">No transactions.</span>'; return; }
    el.innerHTML = txs.map(t => {
      const dir = t.to_character_id === charId ? '+' : '-';
      const color = dir === '+' ? 'var(--accent-green)' : 'var(--accent-red)';
      const c = t.currency;
      const amt = [c.platinum && c.platinum+'P', c.gold && c.gold+'G', c.silver && c.silver+'S', c.bronze && c.bronze+'B'].filter(Boolean).join(' ') || t.amount_bronze+'b';
      return `<div style="display:flex;gap:6px;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="color:${color};font-weight:700;width:18px">${dir}</span>
        <span style="flex:1">${amt}</span>
        <span style="color:var(--text-muted);font-size:0.7rem">${t.note || ''}</span>
        <span style="color:var(--text-muted);font-size:0.65rem">${new Date(t.timestamp).toLocaleTimeString()}</span>
      </div>`;
    }).join('');
  } catch { overlay.querySelector('#tx-list').innerHTML = '<span class="text-muted">Error loading.</span>'; }
}

// ── Merchant Preview ──────────────────────────────────────────
async function loadMerchantPreview(npcId) {
  const el = document.querySelector('#gm-merchant-preview');
  if (!el) return;
  try {
    const shop = await api.get(`/api/npc/${npcId}/shop`);
    if (!shop.items || !shop.items.length) {
      el.innerHTML = '<span class="text-muted">No shop items. Click ⚙️ to configure.</span>';
      return;
    }
    el.innerHTML = `<span style="color:var(--text-muted)">${shop.items.length} items in shop</span>`;
  } catch { el.innerHTML = ''; }
}

// ── Merchant Settings Modal ──────────────────────────────────
async function openMerchantSettingsModal(npcId, npcName) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg);width:90%;max-width:600px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--bg-surface-2)">
        <h3 style="flex:1;font-size:0.9rem">🏪 Merchant Settings — ${npcName}</h3>
        <button class="btn-icon" id="merch-close">✕</button>
      </div>
      <div style="display:flex;gap:0;border-bottom:1px solid var(--border)">
        <button class="btn btn-ghost btn-sm merch-tab active" data-merch-tab="shop" style="border-radius:0;flex:1">Shop Inventory</button>
        <button class="btn btn-ghost btn-sm merch-tab" data-merch-tab="reputation" style="border-radius:0;flex:1">Reputation</button>
      </div>
      <div id="merch-tab-shop" style="padding:12px;overflow-y:auto;flex:1">
        <div style="display:flex;gap:6px;margin-bottom:8px">
          <button class="btn btn-primary btn-xs" id="btn-merch-add-item">+ Add Item to Shop</button>
        </div>
        <div id="merch-shop-list" style="font-size:0.8rem"></div>
      </div>
      <div id="merch-tab-reputation" style="padding:12px;overflow-y:auto;flex:1;display:none">
        <div id="merch-rep-list" style="font-size:0.8rem"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#merch-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Tab switching
  overlay.querySelectorAll('.merch-tab').forEach(t => {
    t.addEventListener('click', () => {
      overlay.querySelectorAll('.merch-tab').forEach(b => b.classList.remove('active'));
      t.classList.add('active');
      const tab = t.dataset.merchTab;
      overlay.querySelector('#merch-tab-shop').style.display = tab === 'shop' ? '' : 'none';
      overlay.querySelector('#merch-tab-reputation').style.display = tab === 'reputation' ? '' : 'none';
    });
  });

  // Load shop items
  async function loadShopList() {
    const shop = await api.get(`/api/npc/${npcId}/shop`);
    const el = overlay.querySelector('#merch-shop-list');
    if (!shop.items.length) { el.innerHTML = '<span class="text-muted">Empty. Add items to the shop.</span>'; return; }
    el.innerHTML = shop.items.map(si => `
      <div style="display:flex;gap:6px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
        <span class="rarity-${si.rarity}" style="flex:1;font-weight:600;font-size:0.82rem">${si.name}</span>
        <span style="font-size:0.7rem;color:var(--text-muted)">Stock: ${si.stock === null ? '∞' : si.stock}</span>
        <span style="font-size:0.7rem">Base: ${si.base_price_bronze || si.base_price_copper}b</span>
        <input type="number" data-merch-stock="${si.shop_item_id}" value="${si.stock === null ? '' : si.stock}" placeholder="∞" style="width:50px;font-size:0.7rem" title="Stock">
        <input type="number" data-merch-price="${si.shop_item_id}" value="${si.final_price_bronze || si.final_price_copper}" placeholder="auto" style="width:60px;font-size:0.7rem" title="Price override (bronze)">
        <button class="btn btn-ghost btn-xs" data-merch-save="${si.shop_item_id}">💾</button>
        <button class="btn-icon danger" data-merch-del="${si.shop_item_id}" title="Remove">🗑</button>
      </div>
    `).join('');

    // Save edits
    el.querySelectorAll('[data-merch-save]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const sid = btn.dataset.merchSave;
        const stock = el.querySelector(`[data-merch-stock="${sid}"]`).value;
        const price = el.querySelector(`[data-merch-price="${sid}"]`).value;
        await api.patch(`/api/npc/${npcId}/shop/${sid}`, {
          stock: stock === '' ? null : parseInt(stock),
          price_override_bronze: price === '' ? null : parseInt(price),
        });
        loadShopList();
      });
    });

    // Delete
    el.querySelectorAll('[data-merch-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.del(`/api/npc/${npcId}/shop/${btn.dataset.merchDel}`);
        loadShopList();
      });
    });
  }

  // Add item button
  overlay.querySelector('#btn-merch-add-item').addEventListener('click', () => {
    openMerchAddItemModal(npcId, loadShopList);
  });

  // Load reputation list
  async function loadRepList() {
    const data = await api.get(`/api/npc/${npcId}/reputation`);
    const el = overlay.querySelector('#merch-rep-list');
    // Also get all player characters for adding
    const allChars = characters.filter(ch => !ch.is_npc);
    const repMap = {};
    data.reputations.forEach(r => { repMap[r.character_id] = r; });

    el.innerHTML = allChars.map(ch => {
      const r = repMap[ch.id];
      const val = r ? r.reputation_value : 0;
      const mult = (1.0 - val / 200.0).toFixed(2);
      return `<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="flex:1;font-size:0.82rem">${ch.name}</span>
        <input type="range" min="-100" max="100" value="${val}" data-rep-slider="${ch.id}" style="width:120px">
        <span data-rep-val="${ch.id}" style="font-size:0.8rem;font-weight:600;width:36px;text-align:center">${val}</span>
        <span style="font-size:0.7rem;color:var(--text-muted)">×${mult}</span>
        <button class="btn btn-ghost btn-xs" data-rep-save="${ch.id}">Set</button>
      </div>`;
    }).join('') || '<span class="text-muted">No players in session.</span>';

    // Slider live update
    el.querySelectorAll('[data-rep-slider]').forEach(sl => {
      sl.addEventListener('input', () => {
        el.querySelector(`[data-rep-val="${sl.dataset.repSlider}"]`).textContent = sl.value;
      });
    });

    // Save reputation
    el.querySelectorAll('[data-rep-save]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cid = btn.dataset.repSave;
        const val = parseInt(el.querySelector(`[data-rep-slider="${cid}"]`).value);
        await api.patch(`/api/npc/${npcId}/reputation/${cid}`, { reputation_value: val });
        addLog('gm.rep', `${npcName} reputation with #${cid} = ${val}`);
        loadRepList();
      });
    });
  }

  loadShopList();
  loadRepList();
}

// ── Add Item to Merchant Shop ────────────────────────────────
function openMerchAddItemModal(npcId, onDone) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg);width:85%;max-width:480px;max-height:70vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border)">
        <h3 style="flex:1;font-size:0.85rem">Add Item to Shop</h3>
        <button class="btn-icon" id="merch-add-close">✕</button>
      </div>
      <div style="padding:10px">
        <input type="text" id="merch-add-search" placeholder="Search items..." style="width:100%;margin-bottom:6px">
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <label style="font-size:0.7rem">Stock:</label>
          <input type="number" id="merch-add-stock" placeholder="∞" style="width:60px;font-size:0.75rem">
          <label style="font-size:0.7rem">Price (cp):</label>
          <input type="number" id="merch-add-price" placeholder="auto" style="width:70px;font-size:0.75rem">
        </div>
        <div id="merch-add-list" style="max-height:40vh;overflow-y:auto;font-size:0.8rem"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#merch-add-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  let items = [];
  (async () => { items = await api.get('/api/items'); renderList(items); })();

  overlay.querySelector('#merch-add-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderList(items.filter(i => i.name.toLowerCase().includes(q)));
  });

  function renderList(filtered) {
    const el = overlay.querySelector('#merch-add-list');
    el.innerHTML = filtered.map(i => `
      <div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border)">
        <span class="rarity-${i.rarity}" style="flex:1;font-size:0.8rem;font-weight:600">${i.name}</span>
        <span style="font-size:0.7rem;color:var(--text-muted)">${i.base_price_bronze || i.base_price_copper}b</span>
        <button class="btn btn-primary btn-xs" data-add-shop="${i.id}">Add</button>
      </div>
    `).join('');

    el.querySelectorAll('[data-add-shop]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const stock = overlay.querySelector('#merch-add-stock').value;
        const price = overlay.querySelector('#merch-add-price').value;
        await api.post(`/api/npc/${npcId}/shop`, {
          item_id: parseInt(btn.dataset.addShop),
          stock: stock === '' ? null : parseInt(stock),
          price_override_bronze: price === '' ? null : parseInt(price),
        });
        overlay.remove();
        if (onDone) onDone();
      });
    });
  }
}

// ══════════════════════════════════════════════════════════════
