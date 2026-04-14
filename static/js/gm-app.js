/* ══════════════════════════════════════════════════════════════
   GM APP — Session Management, Party Control, NPC Management
   ══════════════════════════════════════════════════════════════ */
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// ── Auth ─────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const SESSION_CODE = params.get('code') || sessionStorage.getItem('session_code');
const GM_TOKEN = sessionStorage.getItem('gm_token');
if (!SESSION_CODE || !GM_TOKEN) location.href = '/';
$('#session-code').textContent = SESSION_CODE;

// ── State ────────────────────────────────────────────────────
let characters = [];
let selectedCharId = null;

// ── API helper ───────────────────────────────────────────────
const api = {
  async get(u) { const r = await fetch(u); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async post(u, b) { const r = await fetch(u, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b) }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async put(u, b) { const r = await fetch(u, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b) }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async patch(u, b) { const r = await fetch(u, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(b) }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async del(u) { const r = await fetch(u, { method:'DELETE' }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
};

// ── Toast ────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

// ── Log ──────────────────────────────────────────────────────
function addLog(event, text) {
  const log = $('#event-log');
  const time = new Date().toLocaleTimeString();
  const div = document.createElement('div');
  div.className = 'entry';
  div.innerHTML = `<span class="time">[${time}]</span> <span class="event-name">${event}</span> ${text}`;
  log.prepend(div);
  while (log.children.length > 80) log.removeChild(log.lastChild);
}

// ══════════════════════════════════════════════════════════════
// TABS
// ══════════════════════════════════════════════════════════════
$$('.gm-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('.gm-tab').forEach(t => t.classList.remove('active'));
    $$('.tab-content').forEach(c => { c.classList.remove('active'); c.style.display = 'none'; });
    tab.classList.add('active');
    const panel = $(`#tab-${tab.dataset.tab}`);
    panel.classList.add('active');
    if (tab.dataset.tab === 'map') {
      panel.style.display = 'flex';
      initMapCanvas();
      if (mapCanvas) { mapCanvas._resize(); mapCanvas.render(); }
    } else {
      panel.style.display = 'block';
    }
  });
});
// Show default tab
$('#tab-detail').style.display = 'block';

// ══════════════════════════════════════════════════════════════
// COPY SESSION CODE
// ══════════════════════════════════════════════════════════════
$('#session-code').addEventListener('click', () => {
  navigator.clipboard.writeText(SESSION_CODE);
  showToast('Session code copied!');
});

// ══════════════════════════════════════════════════════════════
// LOAD CHARACTERS
// ══════════════════════════════════════════════════════════════
async function refreshChars() {
  characters = await api.get(`/api/sessions/${SESSION_CODE}/characters`);
  renderPartyList();
  $('#player-count').textContent = characters.filter(c => !c.is_npc).length;
  if (selectedCharId) renderCharDetail();
}

// ══════════════════════════════════════════════════════════════
// PARTY LIST (sidebar)
// ══════════════════════════════════════════════════════════════
function renderPartyList() {
  const list = $('#party-list');
  if (!characters.length) {
    list.innerHTML = '<p class="text-muted" style="font-size:0.8rem;padding:8px">Waiting for players...</p>';
    return;
  }
  list.innerHTML = characters.map(c => {
    const pct = c.max_hp > 0 ? (c.current_hp / c.max_hp * 100) : 0;
    const color = pct > 50 ? 'var(--hp-high)' : pct > 25 ? 'var(--hp-mid)' : 'var(--hp-low)';
    const badge = c.is_npc
      ? '<span class="cc-badge badge-npc">NPC</span>'
      : '<span class="cc-badge badge-player">Player</span>';
    const deadBadge = !c.is_alive ? ' <span class="cc-badge badge-dead">💀</span>' : '';
    const sel = c.id === selectedCharId ? ' selected' : '';
    const dead = !c.is_alive ? ' dead' : '';
    return `
      <div class="char-card${sel}${dead}" data-char-id="${c.id}">
        <div class="cc-top">
          <span class="cc-name">${c.name}</span>${badge}${deadBadge}
        </div>
        <div class="cc-info">
          <span>HP: ${c.current_hp}/${c.max_hp}</span>
          <span>KD: ${c.armor_class}</span>
        </div>
        <div class="hp-bar-container">
          <div class="hp-bar" style="width:${pct}%;background:${color}"></div>
        </div>
        <div class="cc-status-badges" data-sidebar-status="${c.id}" style="display:flex;flex-wrap:wrap;gap:2px;margin-top:3px"></div>
      </div>`;
  }).join('');

  // Load sidebar status badges
  characters.forEach(c => {
    (async () => {
      try {
        const effects = await api.get(`/api/characters/${c.id}/status-effects`);
        const el = list.querySelector(`[data-sidebar-status="${c.id}"]`);
        if (!el || !effects.length) return;
        el.innerHTML = effects.map(e => {
          const turns = e.remaining_turns !== null ? e.remaining_turns+'t' : '';
          return `<span style="background:${e.color}20;border:1px solid ${e.color};border-radius:3px;padding:0 3px;font-size:0.6rem" title="${e.name}">${e.icon}${turns}</span>`;
        }).join('');
      } catch {}
    })();
  });

  list.querySelectorAll('.char-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedCharId = parseInt(card.dataset.charId);
      renderPartyList();
      renderCharDetail();
      // Switch to detail tab
      $$('.gm-tab').forEach(t => t.classList.remove('active'));
      $$('.tab-content').forEach(c => c.classList.remove('active'));
      $('[data-tab="detail"]').classList.add('active');
      $('#tab-detail').classList.add('active');
    });
  });
}

// ══════════════════════════════════════════════════════════════
// CHARACTER DETAIL (main area)
// ══════════════════════════════════════════════════════════════
async function renderCharDetail() {
  const area = $('#char-detail');
  if (!selectedCharId) {
    area.innerHTML = '<p class="text-muted">Select a character from the sidebar.</p>';
    return;
  }

  let c;
  try { c = await api.get(`/api/characters/${selectedCharId}`); }
  catch { area.innerHTML = '<p class="text-muted">Character not found.</p>'; return; }

  const pct = c.max_hp > 0 ? (c.current_hp / c.max_hp * 100) : 0;
  const hpColor = pct > 50 ? 'var(--hp-high)' : pct > 25 ? 'var(--hp-mid)' : 'var(--hp-low)';
  const stats = ['strength','dexterity','constitution','intelligence','wisdom','charisma'];
  const labels = ['STR','DEX','CON','INT','WIS','CHA'];

  const effectsHtml = (c.effects || []).map(e =>
    `<div class="mod-row ${e.is_active?'':'inactive'}">
      <label class="toggle-switch"><input type="checkbox" ${e.is_active?'checked':''} data-eff-toggle="${e.id}"><span class="slider"></span></label>
      <span style="flex:1;font-size:0.8rem">${e.name}</span>
      <span style="font-size:0.8rem;color:var(--text-muted)">${e.effect_type==='percent_reduction'?e.value+'%':'-'+e.value}</span>
    </div>`
  ).join('') || '<span class="text-muted" style="font-size:0.8rem">None</span>';

  area.innerHTML = `
    <div class="detail-panel">
      <div class="detail-header">
        <h2>${c.name} ${c.is_npc ? '<span class="cc-badge badge-npc">NPC</span>' : '<span class="cc-badge badge-player">Player</span>'} ${!c.is_alive?'<span class="cc-badge badge-dead">💀 DEAD</span>':''}</h2>
        ${c.is_npc ? `<button class="btn btn-danger btn-xs" id="btn-delete-char">Delete</button>` : ''}
      </div>
      <div class="detail-body">
        <!-- HP -->
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <span style="font-size:1.5rem;font-weight:700;color:${hpColor};font-variant-numeric:tabular-nums">${c.current_hp} / ${c.max_hp}</span>
          <span style="font-size:0.8rem;color:var(--text-muted)">KD: ${c.armor_class}</span>
          <div class="hp-bar-container" style="flex:1"><div class="hp-bar" style="width:${pct}%;background:${hpColor}"></div></div>
        </div>

        <!-- Quick HP -->
        <div class="action-row">
          <button class="btn btn-ghost btn-xs" data-hp-delta="-5">-5</button>
          <button class="btn btn-ghost btn-xs" data-hp-delta="-10">-10</button>
          <button class="btn btn-ghost btn-xs" data-hp-delta="-20">-20</button>
          <button class="btn btn-ghost btn-xs" data-hp-delta="-50">-50</button>
          <span style="width:8px"></span>
          <button class="btn btn-ghost btn-xs" data-hp-delta="5">+5</button>
          <button class="btn btn-ghost btn-xs" data-hp-delta="10">+10</button>
          <button class="btn btn-ghost btn-xs" data-hp-delta="20">+20</button>
          <button class="btn btn-ghost btn-xs" data-hp-delta="999" style="color:var(--accent-green)">Full</button>
        </div>
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:12px">
          <label style="font-size:0.78rem;color:var(--text-muted)">Custom:</label>
          <input type="number" id="gm-hp-custom" value="0" style="width:60px">
          <button class="btn btn-ghost btn-xs" id="gm-hp-add">+ Add</button>
          <button class="btn btn-ghost btn-xs" id="gm-hp-sub">- Sub</button>
          <button class="btn btn-ghost btn-xs" id="gm-hp-set">Set</button>
        </div>

        <hr class="section-divider">

        <!-- Stats -->
        <div class="stats-inline">
          ${stats.map((s,i) => `<div class="stat-inline"><div class="sl">${labels[i]}</div><div class="sv">${c[s]}</div></div>`).join('')}
          <div class="stat-inline"><div class="sl">KD</div><div class="sv" style="color:var(--accent)">${c.armor_class}</div></div>
        </div>

        <!-- Edit stats row -->
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
          ${stats.map((s,i) => `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">
            <span style="font-size:0.6rem;color:var(--text-muted)">${labels[i]}</span>
            <input type="number" value="${c[s]}" data-gm-stat="${s}" style="width:48px;font-size:0.78rem;padding:3px">
          </div>`).join('')}
          <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
            <span style="font-size:0.6rem;color:var(--text-muted)">KD</span>
            <input type="number" value="${c.armor_class}" data-gm-stat="armor_class" style="width:48px;font-size:0.78rem;padding:3px">
          </div>
          <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
            <span style="font-size:0.6rem;color:var(--text-muted)">MaxHP</span>
            <input type="number" value="${c.max_hp}" data-gm-stat="max_hp" style="width:48px;font-size:0.78rem;padding:3px">
          </div>
        </div>

        <hr class="section-divider">

        <!-- Effects -->
        <h3 style="font-size:0.82rem;margin-bottom:6px">Effects</h3>
        <div id="gm-effects">${effectsHtml}</div>

        <!-- Status Effects (Stage 4) -->
        <hr class="section-divider">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <h3 style="font-size:0.82rem;flex:1">⚡ Status Effects</h3>
          <button class="btn btn-primary btn-xs" id="btn-gm-add-status">+ Add Status</button>
          <button class="btn btn-ghost btn-xs" id="btn-gm-status-library">📚 Library</button>
        </div>
        <div id="gm-status-badges" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px"></div>

        <!-- Damage calc -->
        <hr class="section-divider">
        <h3 style="font-size:0.82rem;margin-bottom:6px">Apply Damage to ${c.name}</h3>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <label style="font-size:0.78rem;color:var(--text-muted)">Enemy Roll:</label>
          <input type="number" id="gm-di-enemy" style="width:56px">
          <label style="font-size:0.78rem;color:var(--text-muted)">Raw Dmg:</label>
          <input type="number" id="gm-di-dmg" style="width:56px">
          <button class="btn btn-danger btn-sm" id="btn-gm-apply-dmg">⚔️ Apply</button>
        </div>
        <div id="gm-dmg-result" style="margin-top:6px;font-size:0.82rem"></div>

        <!-- Currency Section -->
        <hr class="section-divider">
        <h3 style="font-size:0.82rem;margin-bottom:6px">💰 Currency</h3>
        <div id="gm-currency-display" style="font-size:0.85rem;margin-bottom:6px;font-weight:600;color:var(--accent)"></div>
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
          <span style="font-size:0.7rem;color:#e0c97f">P:</span><input type="number" id="gm-give-plat" value="0" style="width:42px;font-size:0.75rem" min="0">
          <span style="font-size:0.7rem;color:#fbbf24">G:</span><input type="number" id="gm-give-gold" value="0" style="width:42px;font-size:0.75rem" min="0">
          <span style="font-size:0.7rem;color:#94a3b8">S:</span><input type="number" id="gm-give-silver" value="0" style="width:42px;font-size:0.75rem" min="0">
          <span style="font-size:0.7rem;color:#b87333">C:</span><input type="number" id="gm-give-copper" value="0" style="width:42px;font-size:0.75rem" min="0">
          <button class="btn btn-primary btn-xs" id="btn-gm-give-currency">+ Give</button>
          <button class="btn btn-ghost btn-xs" id="btn-gm-take-currency">- Take</button>
        </div>
        <div style="display:flex;gap:4px;align-items:center;margin-bottom:8px">
          <span style="font-size:0.7rem;color:var(--text-muted)">Set total copper:</span>
          <input type="number" id="gm-gold-copper" value="${c.gold_copper || 0}" style="width:80px;font-size:0.75rem">
          <button class="btn btn-ghost btn-xs" id="btn-gm-set-gold">Set</button>
          <button class="btn btn-ghost btn-xs" id="btn-gm-tx-history" style="margin-left:auto">📜 History</button>
        </div>

        <!-- Inventory Section -->
        <hr class="section-divider">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <h3 style="font-size:0.82rem;flex:1">🎒 Inventory</h3>
          <label style="font-size:0.7rem;color:var(--text-muted)">Player can edit:</label>
          <label class="toggle-switch"><input type="checkbox" id="gm-can-edit-items" ${c.can_edit_own_items?'checked':''}><span class="slider"></span></label>
        </div>
        <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-xs" id="btn-gm-give-item">+ Give Item</button>
        </div>
        <div id="gm-char-inventory" style="font-size:0.8rem"></div>

        ${c.is_npc ? `
        <!-- Merchant Section (NPC only) -->
        <hr class="section-divider">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <h3 style="font-size:0.82rem;flex:1">🏪 Merchant</h3>
          <button class="btn btn-primary btn-xs" id="btn-gm-merchant-settings">⚙️ Shop Settings</button>
          <button class="btn btn-ghost btn-xs" id="btn-gm-initiate-trade">🤝 Initiate Trade</button>
        </div>
        <div id="gm-merchant-preview" style="font-size:0.8rem"></div>
        ` : ''}
      </div>
    </div>
  `;

  // ── Wire events ──
  // HP delta buttons
  area.querySelectorAll('[data-hp-delta]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const d = parseInt(btn.dataset.hpDelta);
      if (d === 999) await api.patch(`/api/characters/${c.id}/hp`, { set: c.max_hp });
      else await api.patch(`/api/characters/${c.id}/hp`, { delta: d });
      await refreshChars();
      addLog('gm.hp', `${c.name}: ${d===999?'Full Heal':d>0?'+'+d:d} HP`);
    });
  });
  // Custom HP
  $('#gm-hp-add').addEventListener('click', async () => { const v=parseInt($('#gm-hp-custom').value)||0; await api.patch(`/api/characters/${c.id}/hp`,{delta:v}); await refreshChars(); addLog('gm.hp',`${c.name}: +${v}`); });
  $('#gm-hp-sub').addEventListener('click', async () => { const v=parseInt($('#gm-hp-custom').value)||0; await api.patch(`/api/characters/${c.id}/hp`,{delta:-v}); await refreshChars(); addLog('gm.hp',`${c.name}: -${v}`); });
  $('#gm-hp-set').addEventListener('click', async () => { const v=parseInt($('#gm-hp-custom').value)||0; await api.patch(`/api/characters/${c.id}/hp`,{set:v}); await refreshChars(); addLog('gm.hp',`${c.name}: set ${v}`); });

  // Stat edits
  area.querySelectorAll('[data-gm-stat]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const f = inp.dataset.gmStat;
      const v = parseInt(inp.value) || 0;
      await api.put(`/api/characters/${c.id}`, { [f]: v });
      await refreshChars();
      addLog('gm.stat', `${c.name}: ${f}=${v}`);
    });
  });

  // Effect toggles
  area.querySelectorAll('[data-eff-toggle]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await api.put(`/api/effects/${cb.dataset.effToggle}`, { is_active: cb.checked });
      await refreshChars();
    });
  });

  // Delete NPC
  if (c.is_npc && area.querySelector('#btn-delete-char')) {
    area.querySelector('#btn-delete-char').addEventListener('click', async () => {
      if (!confirm(`Delete NPC "${c.name}"?`)) return;
      await api.del(`/api/characters/${c.id}`);
      selectedCharId = null;
      await refreshChars();
      renderCharDetail();
      addLog('gm.npc', `Deleted NPC: ${c.name}`);
    });
  }

  // Apply damage
  $('#btn-gm-apply-dmg').addEventListener('click', async () => {
    const er = parseInt($('#gm-di-enemy').value)||0;
    const dmg = parseInt($('#gm-di-dmg').value)||0;
    if (!er || !dmg) return;
    const res = await api.post('/api/calc/damage-intake', { character_id: c.id, enemy_roll: er, damage_rolled: dmg });
    if (res.final_damage > 0) {
      await api.patch(`/api/characters/${c.id}/hp`, { delta: -res.final_damage });
      await refreshChars();
    }
    const text = res.hit_diff <= 0
      ? `<span style="color:var(--text-muted);font-weight:700">MISS</span> (diff: ${res.hit_diff})`
      : `${res.tier_label} → <strong style="color:var(--accent-red)">${res.final_damage} damage</strong> applied`;
    $('#gm-dmg-result').innerHTML = text;
    addLog('gm.damage', `${c.name}: ${er} vs KD${c.armor_class} → ${res.final_damage} dmg`);
  });

  // ── Status Effects wiring ──
  loadStatusBadges(c.id);
  $('#btn-gm-add-status').addEventListener('click', () => openAddStatusModal(c.id, c.name));
  $('#btn-gm-status-library').addEventListener('click', () => openStatusLibraryModal());

  // ── Currency wiring ──
  // Load and display currency
  (async () => {
    try {
      const cur = await api.get(`/api/characters/${c.id}/currency`);
      const d = cur.currency;
      const parts = [];
      if (d.platinum) parts.push(`<span style="color:#e0c97f">${d.platinum}P</span>`);
      if (d.gold) parts.push(`<span style="color:#fbbf24">${d.gold}G</span>`);
      if (d.silver) parts.push(`<span style="color:#94a3b8">${d.silver}S</span>`);
      parts.push(`<span style="color:#b87333">${d.copper}C</span>`);
      $('#gm-currency-display').innerHTML = parts.join(' ') + ` <span style="font-size:0.7rem;color:var(--text-muted)">(${cur.total_copper}cp)</span>`;
    } catch {}
  })();

  // Give currency
  $('#btn-gm-give-currency').addEventListener('click', async () => {
    const p = parseInt($('#gm-give-plat').value) || 0;
    const g = parseInt($('#gm-give-gold').value) || 0;
    const s = parseInt($('#gm-give-silver').value) || 0;
    const co = parseInt($('#gm-give-copper').value) || 0;
    if (!p && !g && !s && !co) return;
    await api.post(`/api/characters/${c.id}/give-gold`, { platinum: p, gold: g, silver: s, copper: co });
    await refreshChars();
    addLog('gm.gold', `Gave ${c.name}: ${p}P ${g}G ${s}S ${co}C`);
  });

  // Take currency (negative give)
  $('#btn-gm-take-currency').addEventListener('click', async () => {
    const p = parseInt($('#gm-give-plat').value) || 0;
    const g = parseInt($('#gm-give-gold').value) || 0;
    const s = parseInt($('#gm-give-silver').value) || 0;
    const co = parseInt($('#gm-give-copper').value) || 0;
    if (!p && !g && !s && !co) return;
    await api.post(`/api/characters/${c.id}/give-gold`, { platinum: -p, gold: -g, silver: -s, copper: -co, note: 'GM deduction' });
    await refreshChars();
    addLog('gm.gold', `Took from ${c.name}: ${p}P ${g}G ${s}S ${co}C`);
  });

  // Set total copper
  $('#btn-gm-set-gold').addEventListener('click', async () => {
    const v = parseInt($('#gm-gold-copper').value) || 0;
    await api.put(`/api/characters/${c.id}`, { gold_copper: v });
    await refreshChars();
    addLog('gm.gold', `${c.name}: gold_copper = ${v}`);
  });

  // Transaction history
  $('#btn-gm-tx-history').addEventListener('click', () => openTxHistoryModal(c.id, c.name));

  // ── Inventory wiring ──
  // Can edit toggle
  $('#gm-can-edit-items').addEventListener('change', async () => {
    await api.put(`/api/characters/${c.id}`, { can_edit_own_items: $('#gm-can-edit-items').checked });
    addLog('gm.perm', `${c.name}: can_edit_own_items = ${$('#gm-can-edit-items').checked}`);
  });

  // Give item
  $('#btn-gm-give-item').addEventListener('click', () => {
    openGmGiveItemModal(c.id);
  });

  // ── Merchant wiring (NPC only) ──
  if (c.is_npc) {
    const merchantBtn = area.querySelector('#btn-gm-merchant-settings');
    const tradeBtn = area.querySelector('#btn-gm-initiate-trade');
    if (merchantBtn) merchantBtn.addEventListener('click', () => openMerchantSettingsModal(c.id, c.name));
    if (tradeBtn) tradeBtn.addEventListener('click', () => openInitiateTradeModal(c.id, c.name));
    loadMerchantPreview(c.id);
  }

  // Load inventory
  loadGmCharInventory(c.id);
}

// ── GM Character Inventory Loading ──────────────────────────
async function loadGmCharInventory(charId) {
  const container = $('#gm-char-inventory');
  if (!container) return;
  try {
    const data = await api.get(`/api/characters/${charId}/inventory`);
    if (!data.items || !data.items.length) {
      container.innerHTML = '<span class="text-muted">No items in inventory.</span>';
      return;
    }
    container.innerHTML = data.items.map(i => {
      const eq = i.is_equipped ? '✅' : '';
      const slotLbl = i.equipped_slot ? ` [${i.equipped_slot}]` : '';
      const bonusesStr = (i.bonuses||[]).map(b => b.bonus_type === 'stat_bonus' ? `${b.stat_name}+${b.value}` : `${b.bonus_type.replace(/_/g,' ')}+${b.value}`).join(', ');
      return `<div class="mod-row" style="gap:6px">
        <span style="min-width:18px">${eq}</span>
        <span class="rarity-${i.rarity}" style="flex:1;font-weight:600">${i.name}</span>
        <span style="font-size:0.7rem;color:var(--text-muted)">x${i.quantity}${slotLbl}</span>
        ${bonusesStr ? `<span style="font-size:0.65rem;color:var(--accent-green)">${bonusesStr}</span>` : ''}
        <button class="btn btn-ghost btn-xs" data-gm-equip="${i.inventory_id}" data-gm-equipped="${i.is_equipped}">${i.is_equipped ? 'Unequip' : 'Equip'}</button>
        <button class="btn-icon danger" data-gm-remove-inv="${i.inventory_id}" title="Remove">🗑</button>
      </div>`;
    }).join('');

    // Equip/unequip
    container.querySelectorAll('[data-gm-equip]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const invId = btn.dataset.gmEquip;
        const isEq = btn.dataset.gmEquipped === 'true';
        if (isEq) {
          await api.patch(`/api/inventory/${invId}/equip`, { equip: false });
        } else {
          await api.patch(`/api/inventory/${invId}/equip`, { equip: true, slot: 'main_hand' });
        }
        loadGmCharInventory(charId);
      });
    });

    // Remove
    container.querySelectorAll('[data-gm-remove-inv]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.del(`/api/inventory/${btn.dataset.gmRemoveInv}`);
        loadGmCharInventory(charId);
      });
    });
  } catch(e) { container.innerHTML = '<span class="text-muted">Error loading inventory.</span>'; }
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
      const amt = [c.platinum && c.platinum+'P', c.gold && c.gold+'G', c.silver && c.silver+'S', c.copper && c.copper+'C'].filter(Boolean).join(' ') || t.amount_copper+'cp';
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
        <span style="font-size:0.7rem">Base: ${si.base_price_copper}cp</span>
        <input type="number" data-merch-stock="${si.shop_item_id}" value="${si.stock === null ? '' : si.stock}" placeholder="∞" style="width:50px;font-size:0.7rem" title="Stock">
        <input type="number" data-merch-price="${si.shop_item_id}" value="${si.final_price_copper}" placeholder="auto" style="width:60px;font-size:0.7rem" title="Price override (cp)">
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
          price_override_copper: price === '' ? null : parseInt(price),
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
        <span style="font-size:0.7rem;color:var(--text-muted)">${i.base_price_copper}cp</span>
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
          price_override_copper: price === '' ? null : parseInt(price),
        });
        overlay.remove();
        if (onDone) onDone();
      });
    });
  }
}

// ══════════════════════════════════════════════════════════════
// STAGE 4 — STATUS EFFECTS UI
// ══════════════════════════════════════════════════════════════

// ── Load Status Badges ───────────────────────────────────────
async function loadStatusBadges(charId) {
  const el = document.querySelector('#gm-status-badges');
  if (!el) return;
  try {
    const effects = await api.get(`/api/characters/${charId}/status-effects`);
    if (!effects.length) { el.innerHTML = '<span class="text-muted" style="font-size:0.75rem">None</span>'; return; }
    el.innerHTML = effects.map(e => {
      const turns = e.remaining_turns !== null ? `<span style="font-size:0.6rem;margin-left:2px">${e.remaining_turns}t</span>` : '';
      return `<span class="status-badge" style="background:${e.color}20;border:1px solid ${e.color};border-radius:var(--r-md);padding:2px 6px;font-size:0.75rem;display:inline-flex;align-items:center;gap:2px;cursor:pointer" data-status-id="${e.id}" title="${e.name}: ${(e.effects||[]).map(ef=>ef.type+'='+JSON.stringify(ef.value)).join(', ')}">${e.icon} ${e.name}${turns}<button class="btn-icon" style="font-size:0.6rem;margin-left:3px" data-remove-status="${e.id}">✕</button></span>`;
    }).join('');

    el.querySelectorAll('[data-remove-status]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        await api.del(`/api/status-effects/${btn.dataset.removeStatus}`);
        loadStatusBadges(charId);
        addLog('gm.status', `Removed status effect #${btn.dataset.removeStatus}`);
      });
    });
  } catch { el.innerHTML = ''; }
}

// ── Add Status Modal ─────────────────────────────────────────
async function openAddStatusModal(charId, charName) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg);width:85%;max-width:420px;max-height:75vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border)">
        <h3 style="flex:1;font-size:0.88rem">⚡ Add Status to ${charName}</h3>
        <button class="btn-icon" id="as-close">✕</button>
      </div>
      <div style="padding:10px">
        <div style="font-size:0.78rem;font-weight:600;margin-bottom:6px">From Templates:</div>
        <div id="as-template-list" style="max-height:200px;overflow-y:auto;margin-bottom:10px;font-size:0.8rem"></div>
        <hr class="section-divider">
        <div style="font-size:0.78rem;font-weight:600;margin-bottom:6px">Custom Effect:</div>
        <div style="display:flex;gap:4px;margin-bottom:4px;align-items:center">
          <input type="text" id="as-custom-name" placeholder="Name" style="flex:1;font-size:0.78rem">
          <input type="text" id="as-custom-icon" value="⚡" style="width:32px;font-size:0.78rem;text-align:center">
          <input type="color" id="as-custom-color" value="#ff6b6b" style="width:28px;height:28px;padding:1px">
        </div>
        <div style="display:flex;gap:4px;margin-bottom:4px;align-items:center">
          <label style="font-size:0.7rem;color:var(--text-muted)">Duration (turns):</label>
          <input type="number" id="as-custom-turns" placeholder="∞" style="width:50px;font-size:0.78rem">
        </div>
        <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:4px">Effects (JSON): [{type, value}]</div>
        <textarea id="as-custom-effects" rows="2" style="width:100%;font-size:0.72rem;font-family:monospace" placeholder='[{"type":"attack_penalty","value":-2}]'></textarea>
        <button class="btn btn-primary btn-xs" id="as-custom-apply" style="margin-top:6px">Apply Custom</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#as-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Load templates
  const templates = await api.get('/api/status-templates');
  const el = overlay.querySelector('#as-template-list');
  if (!templates.length) { el.innerHTML = '<span class="text-muted">No templates. Create one in Library.</span>'; }
  else {
    el.innerHTML = templates.map(t => {
      const effs = (t.effects||[]).map(e => `${e.type}=${JSON.stringify(e.value)}`).join(', ');
      return `<div style="display:flex;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:1rem">${t.icon}</span>
        <span style="flex:1;font-weight:600;color:${t.color}">${t.name}</span>
        <span style="font-size:0.65rem;color:var(--text-muted)">${effs}</span>
        <input type="number" data-tmpl-turns="${t.id}" value="${t.default_duration||''}" placeholder="∞" style="width:40px;font-size:0.7rem" title="Duration">
        <button class="btn btn-primary btn-xs" data-apply-tmpl="${t.id}">Apply</button>
      </div>`;
    }).join('');

    el.querySelectorAll('[data-apply-tmpl]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tid = parseInt(btn.dataset.applyTmpl);
        const turnsInput = el.querySelector(`[data-tmpl-turns="${tid}"]`);
        const turns = turnsInput.value === '' ? null : parseInt(turnsInput.value);
        await api.post(`/api/characters/${charId}/status-effects`, { template_id: tid, remaining_turns: turns });
        overlay.remove();
        loadStatusBadges(charId);
        const tmpl = templates.find(t => t.id === tid);
        addLog('gm.status', `Applied ${tmpl ? tmpl.name : 'status'} to ${charName}`);
      });
    });
  }

  // Custom apply
  overlay.querySelector('#as-custom-apply').addEventListener('click', async () => {
    const name = overlay.querySelector('#as-custom-name').value.trim();
    if (!name) return;
    let effects = [];
    try { effects = JSON.parse(overlay.querySelector('#as-custom-effects').value || '[]'); } catch {}
    const turns = overlay.querySelector('#as-custom-turns').value;
    await api.post(`/api/characters/${charId}/status-effects`, {
      custom_name: name,
      custom_icon: overlay.querySelector('#as-custom-icon').value,
      custom_color: overlay.querySelector('#as-custom-color').value,
      custom_effects: effects,
      remaining_turns: turns === '' ? null : parseInt(turns),
    });
    overlay.remove();
    loadStatusBadges(charId);
    addLog('gm.status', `Applied custom "${name}" to ${charName}`);
  });
}

// ── Status Library Modal ─────────────────────────────────────
async function openStatusLibraryModal() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg);width:90%;max-width:560px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--bg-surface-2)">
        <h3 style="flex:1;font-size:0.9rem">📚 Status Effect Library</h3>
        <button class="btn btn-primary btn-xs" id="sl-create" style="margin-right:8px">+ Create New</button>
        <button class="btn-icon" id="sl-close">✕</button>
      </div>
      <div id="sl-list" style="padding:12px;overflow-y:auto;flex:1;font-size:0.8rem"></div>
      <div id="sl-editor" style="display:none;padding:12px;border-top:1px solid var(--border)"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#sl-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  async function loadList() {
    const templates = await api.get('/api/status-templates');
    const el = overlay.querySelector('#sl-list');
    if (!templates.length) { el.innerHTML = '<span class="text-muted">No templates yet.</span>'; return; }
    el.innerHTML = templates.map(t => {
      const effs = (t.effects||[]).map(e => `<code style="font-size:0.65rem">${e.type}=${JSON.stringify(e.value)}</code>`).join(' ');
      return `<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:1.1rem">${t.icon}</span>
        <div style="flex:1">
          <div style="font-weight:600;color:${t.color}">${t.name}</div>
          <div style="font-size:0.7rem;color:var(--text-muted)">${t.description || ''}</div>
          <div>${effs}</div>
        </div>
        <span style="font-size:0.7rem;color:var(--text-muted)">${t.default_duration ? t.default_duration+'t' : '∞'}</span>
        <button class="btn btn-ghost btn-xs" data-sl-edit="${t.id}">✏️</button>
        <button class="btn-icon danger" data-sl-del="${t.id}">🗑</button>
      </div>`;
    }).join('');

    el.querySelectorAll('[data-sl-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.del(`/api/status-templates/${btn.dataset.slDel}`);
        loadList();
      });
    });

    el.querySelectorAll('[data-sl-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = templates.find(x => x.id === parseInt(btn.dataset.slEdit));
        if (t) showEditor(t);
      });
    });
  }

  function showEditor(t = null) {
    const ed = overlay.querySelector('#sl-editor');
    ed.style.display = '';
    ed.innerHTML = `
      <div style="font-size:0.8rem;font-weight:600;margin-bottom:6px">${t ? 'Edit' : 'New'} Template</div>
      <div style="display:flex;gap:4px;margin-bottom:4px">
        <input type="text" id="sl-name" value="${t ? t.name : ''}" placeholder="Name" style="flex:1;font-size:0.78rem">
        <input type="text" id="sl-icon" value="${t ? t.icon : '⚡'}" style="width:32px;font-size:0.78rem;text-align:center">
        <input type="color" id="sl-color" value="${t ? t.color : '#ff6b6b'}" style="width:28px;height:28px">
      </div>
      <input type="text" id="sl-desc" value="${t ? t.description : ''}" placeholder="Description" style="width:100%;font-size:0.78rem;margin-bottom:4px">
      <div style="display:flex;gap:4px;margin-bottom:4px;align-items:center">
        <label style="font-size:0.7rem">Default duration:</label>
        <input type="number" id="sl-duration" value="${t && t.default_duration ? t.default_duration : ''}" placeholder="∞" style="width:50px;font-size:0.78rem">
      </div>
      <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:2px">Effects JSON:</div>
      <textarea id="sl-effects" rows="3" style="width:100%;font-size:0.72rem;font-family:monospace">${t ? JSON.stringify(t.effects, null, 1) : '[]'}</textarea>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="btn btn-primary btn-xs" id="sl-save">${t ? 'Update' : 'Create'}</button>
        <button class="btn btn-ghost btn-xs" id="sl-cancel">Cancel</button>
      </div>
    `;

    ed.querySelector('#sl-cancel').addEventListener('click', () => { ed.style.display = 'none'; });
    ed.querySelector('#sl-save').addEventListener('click', async () => {
      const data = {
        name: ed.querySelector('#sl-name').value.trim(),
        description: ed.querySelector('#sl-desc').value,
        icon: ed.querySelector('#sl-icon').value,
        color: ed.querySelector('#sl-color').value,
        default_duration: ed.querySelector('#sl-duration').value === '' ? null : parseInt(ed.querySelector('#sl-duration').value),
      };
      try { data.effects = JSON.parse(ed.querySelector('#sl-effects').value || '[]'); } catch { data.effects = []; }

      if (t) {
        await api.put(`/api/status-templates/${t.id}`, data);
      } else {
        await api.post('/api/status-templates', data);
      }
      ed.style.display = 'none';
      loadList();
    });
  }

  overlay.querySelector('#sl-create').addEventListener('click', () => showEditor(null));
  loadList();
}

// ── Initiate Trade Modal ─────────────────────────────────────
function openInitiateTradeModal(npcId, npcName) {
  const players = characters.filter(ch => !ch.is_npc);
  if (!players.length) { showToast('No players in session'); return; }

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg);width:80%;max-width:360px;padding:20px">
      <h3 style="font-size:0.9rem;margin-bottom:12px">🤝 Initiate Trade with ${npcName}</h3>
      <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:8px">Select a player:</p>
      <div id="trade-player-list" style="display:flex;flex-direction:column;gap:6px">
        ${players.map(p => `<button class="btn btn-ghost btn-sm" data-trade-player="${p.id}" style="text-align:left">${p.name}</button>`).join('')}
      </div>
      <button class="btn btn-ghost btn-xs" id="trade-cancel" style="margin-top:12px">Cancel</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#trade-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelectorAll('[data-trade-player]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const playerId = parseInt(btn.dataset.tradePlayer);
      const res = await api.post('/api/trade/initiate', { npc_id: npcId, player_id: playerId });
      overlay.remove();
      addLog('gm.trade', `Trade initiated: ${npcName} ↔ player #${playerId} (trade #${res.trade_id})`);
      // Broadcast WS event
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({
          type: 'trade.initiated',
          trade_id: res.trade_id,
          npc_id: npcId,
          npc_name: npcName,
          player_id: playerId,
        }));
      }
      showToast(`Trade #${res.trade_id} started`);
    });
  });
}

// ══════════════════════════════════════════════════════════════
// NPC CREATION
// ══════════════════════════════════════════════════════════════
$('#btn-show-npc-form').addEventListener('click', () => {
  const area = $('#npc-form-area');
  if (!area.classList.contains('hidden')) { area.classList.add('hidden'); return; }
  area.classList.remove('hidden');
  area.innerHTML = `
    <div class="npc-form">
      <div class="form-row"><label>Name:</label><input type="text" id="npc-name" placeholder="Goblin"></div>
      <div class="form-row">
        <label>HP:</label><input type="number" id="npc-hp" value="20" style="width:56px">
        <label>KD:</label><input type="number" id="npc-kd" value="10" style="width:56px">
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-primary btn-sm" id="btn-create-npc">Create NPC</button>
        <button class="btn btn-ghost btn-sm" id="btn-cancel-npc">Cancel</button>
      </div>
    </div>
  `;
  $('#btn-create-npc').addEventListener('click', async () => {
    const name = $('#npc-name').value.trim() || 'NPC';
    const hp = parseInt($('#npc-hp').value) || 20;
    const kd = parseInt($('#npc-kd').value) || 10;
    await api.post(`/api/sessions/${SESSION_CODE}/npc`, { name, is_npc: true, max_hp: hp, armor_class: kd });
    area.classList.add('hidden');
    await refreshChars();
    addLog('gm.npc', `Created NPC: ${name} (HP:${hp} KD:${kd})`);
  });
  $('#btn-cancel-npc').addEventListener('click', () => area.classList.add('hidden'));
});

// ══════════════════════════════════════════════════════════════
// AOE DAMAGE
// ══════════════════════════════════════════════════════════════
$('#btn-aoe-damage').addEventListener('click', async () => {
  const er = parseInt($('#aoe-enemy-roll').value) || 0;
  const dmg = parseInt($('#aoe-damage').value) || 0;
  if (!er || !dmg) return;

  const players = characters.filter(c => !c.is_npc && c.is_alive);
  const results = [];
  for (const p of players) {
    const res = await api.post('/api/calc/damage-intake', { character_id: p.id, enemy_roll: er, damage_rolled: dmg });
    if (res.final_damage > 0) await api.patch(`/api/characters/${p.id}/hp`, { delta: -res.final_damage });
    results.push({ name: p.name, damage: res.final_damage, tier: res.tier_label });
  }
  await refreshChars();
  const lines = results.map(r => `${r.name}: ${r.tier} → ${r.damage} dmg`).join('<br>');
  $('#aoe-result').innerHTML = lines || '<span class="text-muted">No living players</span>';
  addLog('gm.aoe', `AoE ${er}/${dmg} → ${results.map(r=>r.name+':'+r.damage).join(', ')}`);
});

// ══════════════════════════════════════════════════════════════
// MAP
// ══════════════════════════════════════════════════════════════
let mapCanvas = null;
let mapGridEnabled = true;
let mapFogEnabled = false;
let mapFogPaintActive = false;

function initMapCanvas() {
  const canvasEl = $('#map-canvas');
  if (!canvasEl || mapCanvas) return;
  mapCanvas = new MapCanvas(canvasEl, {
    role: 'gm',
    sessionCode: SESSION_CODE,
    onTokenMove: async (charId, x, y) => {
      await api.patch(`/api/map/token/${charId}`, { x, y });
      addLog('map', `Moved token ${charId} to (${x.toFixed(2)}, ${y.toFixed(2)})`);
    },
    onFogReveal: async (col, row) => {
      await api.post(`/api/map/${SESSION_CODE}/fog/reveal`, { cells: [[col, row]] });
    },
  });
  loadMapState();
}

async function loadMapState() {
  try {
    const state = await api.get(`/api/map/${SESSION_CODE}`);
    if (state.has_map) {
      await mapCanvas.loadImage(state.image_url);
      mapCanvas.setGrid(state.grid_size, state.grid_enabled);
      mapCanvas.setFog(state.fog_enabled, state.revealed_cells);
      mapCanvas.setTokens(state.tokens);
      mapGridEnabled = state.grid_enabled;
      mapFogEnabled = state.fog_enabled;
      $('#btn-toggle-grid').textContent = `Grid: ${mapGridEnabled ? 'ON' : 'OFF'}`;
      $('#btn-toggle-fog').textContent = `Fog: ${mapFogEnabled ? 'ON' : 'OFF'}`;
      $('#grid-size-slider').value = state.grid_size;
      $('#grid-size-label').textContent = state.grid_size;
    }
  } catch { /* no map yet */ }
}

// Map upload
document.addEventListener('change', async e => {
  if (e.target.id !== 'map-upload') return;
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`/api/map/${SESSION_CODE}/upload`, { method: 'POST', body: fd });
  if (!res.ok) { showToast('Upload failed'); return; }
  const data = await res.json();
  await mapCanvas.loadImage(data.image_url);
  addLog('map', `Map uploaded: ${file.name}`);
});

// Grid toggle
$('#btn-toggle-grid').addEventListener('click', async () => {
  mapGridEnabled = !mapGridEnabled;
  $('#btn-toggle-grid').textContent = `Grid: ${mapGridEnabled ? 'ON' : 'OFF'}`;
  mapCanvas.setGrid(mapCanvas.gridSize, mapGridEnabled);
  await api.patch(`/api/map/${SESSION_CODE}/settings`, { grid_enabled: mapGridEnabled });
});

// Grid size slider
$('#grid-size-slider').addEventListener('input', e => {
  const v = parseInt(e.target.value);
  $('#grid-size-label').textContent = v;
  if (mapCanvas) mapCanvas.setGrid(v, mapGridEnabled);
});
$('#grid-size-slider').addEventListener('change', async e => {
  await api.patch(`/api/map/${SESSION_CODE}/settings`, { grid_size: parseInt(e.target.value) });
});

// Fog toggle
$('#btn-toggle-fog').addEventListener('click', async () => {
  mapFogEnabled = !mapFogEnabled;
  $('#btn-toggle-fog').textContent = `Fog: ${mapFogEnabled ? 'ON' : 'OFF'}`;
  await api.patch(`/api/map/${SESSION_CODE}/settings`, { fog_enabled: mapFogEnabled });
  mapCanvas.fogEnabled = mapFogEnabled;
  mapCanvas.render();
});

// Fog paint
$('#btn-fog-paint').addEventListener('click', () => {
  mapFogPaintActive = !mapFogPaintActive;
  $('#btn-fog-paint').style.background = mapFogPaintActive ? 'var(--accent)' : '';
  $('#btn-fog-paint').style.color = mapFogPaintActive ? '#0a0908' : '';
  if (mapCanvas) mapCanvas.setFogPaintMode(mapFogPaintActive);
});

// Reveal all
$('#btn-fog-reveal-all').addEventListener('click', async () => {
  await api.post(`/api/map/${SESSION_CODE}/fog/reveal-all`, {});
  mapFogEnabled = false;
  $('#btn-toggle-fog').textContent = 'Fog: OFF';
  if (mapCanvas) { mapCanvas.fogEnabled = false; mapCanvas.revealedCells.clear(); mapCanvas.render(); }
  addLog('map', 'Fog of war revealed all');
});

// Reset fog
$('#btn-fog-reset').addEventListener('click', async () => {
  await api.post(`/api/map/${SESSION_CODE}/fog/reset`, {});
  mapFogEnabled = true;
  $('#btn-toggle-fog').textContent = 'Fog: ON';
  if (mapCanvas) { mapCanvas.fogEnabled = true; mapCanvas.revealedCells.clear(); mapCanvas.render(); }
  addLog('map', 'Fog of war reset');
});

// Center
$('#btn-center-map').addEventListener('click', () => {
  if (mapCanvas) mapCanvas.centerView();
});

// ══════════════════════════════════════════════════════════════
// INITIATIVE
// ══════════════════════════════════════════════════════════════
$('#btn-roll-initiative').addEventListener('click', async () => {
  try {
    const res = await api.post(`/api/initiative/${SESSION_CODE}/roll-all`, {});
    renderInitiativeOrder(res.order.map((r, i) => ({
      order: i, character_id: r.character_id, name: r.name,
      roll_result: r.total, is_current_turn: false,
    })));
    addLog('initiative', `Rolled: ${res.order.map(r => `${r.name}(${r.total})`).join(', ')}`);
  } catch (e) { showToast('Error: ' + e.message); }
});

$('#btn-start-combat').addEventListener('click', async () => {
  try {
    const res = await api.post(`/api/initiative/${SESSION_CODE}/start-combat`, {});
    $('#session-status').textContent = res.status;
    $('#session-turn').textContent = res.turn_number;
    addLog('combat', `Combat started! Turn 1`);
    loadInitiativeOrder();
  } catch (e) { showToast('Error: ' + e.message); }
});

$('#btn-next-turn').addEventListener('click', async () => {
  try {
    const res = await api.post(`/api/initiative/${SESSION_CODE}/next-turn`, {});
    $('#session-turn').textContent = res.turn_number;
    addLog('combat', `Turn → ${res.character_name} (round ${res.turn_number})`);
    loadInitiativeOrder();
  } catch (e) { showToast('Error: ' + e.message); }
});

$('#btn-end-combat').addEventListener('click', async () => {
  if (!confirm('End combat?')) return;
  try {
    await api.post(`/api/initiative/${SESSION_CODE}/end-combat`, {});
    $('#session-status').textContent = 'waiting';
    $('#session-turn').textContent = '0';
    $('#initiative-order').innerHTML = '<p class="text-muted">Roll initiative to begin.</p>';
    addLog('combat', 'Combat ended');
  } catch (e) { showToast('Error: ' + e.message); }
});

async function loadInitiativeOrder() {
  try {
    const res = await api.get(`/api/initiative/${SESSION_CODE}/order`);
    renderInitiativeOrder(res.order);
    if (res.turn_number) $('#session-turn').textContent = res.turn_number;
  } catch { /* no initiative yet */ }
}

function renderInitiativeOrder(order) {
  const el = $('#initiative-order');
  if (!order || !order.length) {
    el.innerHTML = '<p class="text-muted">No initiative order.</p>';
    return;
  }
  el.innerHTML = order.map(o => {
    const pct = o.max_hp > 0 ? (o.current_hp / o.max_hp * 100) : 100;
    const hpColor = pct > 50 ? 'var(--hp-high)' : pct > 25 ? 'var(--hp-mid)' : 'var(--hp-low)';
    const active = o.is_current_turn ? 'border-color:var(--accent);box-shadow:0 0 0 1px var(--accent),0 0 8px var(--accent-glow)' : '';
    const dead = o.is_alive === false ? 'opacity:0.4;' : '';
    const badge = o.is_npc ? '<span class="cc-badge badge-npc">NPC</span>' : '';
    return `<div class="char-card" style="${active}${dead}margin-bottom:4px">
      <div class="cc-top">
        <span style="font-weight:700;font-size:1.1rem;color:var(--accent);width:28px">${o.order + 1}</span>
        <span class="cc-name">${o.name}</span>${badge}
        <span style="font-size:0.78rem;color:var(--text-muted)">Roll: ${o.roll_result}</span>
      </div>
      ${o.max_hp ? `<div class="hp-bar-container" style="margin-top:4px"><div class="hp-bar" style="width:${pct}%;background:${hpColor}"></div></div>
      <span style="font-size:0.72rem;color:var(--text-muted)">${o.current_hp}/${o.max_hp}</span>` : ''}
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════
// END SESSION
// ══════════════════════════════════════════════════════════════
$('#btn-end-session').addEventListener('click', async () => {
  if (!confirm('End this session? All players will be disconnected.')) return;
  await api.patch(`/api/sessions/${SESSION_CODE}/status`, { gm_token: GM_TOKEN, status: 'ended' });
  ws.disconnect();
  location.href = '/';
});

// ══════════════════════════════════════════════════════════════
// WEBSOCKET
// ══════════════════════════════════════════════════════════════
const ws = new WsClient(SESSION_CODE, GM_TOKEN);

ws.on('_connected', () => {
  $('#ws-dot').className = 'status-dot connected';
  $('#ws-label').textContent = 'connected';
  addLog('system', 'WebSocket connected');
});
ws.on('_disconnected', () => {
  $('#ws-dot').className = 'status-dot disconnected';
  $('#ws-label').textContent = 'disconnected';
  addLog('system', 'WebSocket disconnected');
});
ws.on('_reconnecting', d => { $('#ws-label').textContent = `reconnecting (${d.attempt})...`; });

ws.on('session.state', data => {
  const s = data.session;
  $('#session-name').textContent = s.name;
  $('#session-status').textContent = s.status;
  $('#session-turn').textContent = s.turn_number;
  $('#connected-count').textContent = data.connected_count;
  addLog('session.state', `Loaded: ${s.name}`);
  refreshChars();
});

ws.on('session.player_joined', data => {
  $('#connected-count').textContent = data.connected_count;
  addLog('session.player_joined', `${data.role} joined (${data.connected_count} online)`);
  refreshChars();
});

ws.on('session.player_disconnected', data => {
  $('#connected-count').textContent = data.connected_count;
  addLog('session.player_disconnected', `${data.role} left (${data.connected_count} online)`);
});

ws.on('*', (event, data) => {
  if (event.startsWith('_') || event === 'session.state') return;
  if (event !== 'session.player_joined' && event !== 'session.player_disconnected') {
    addLog(event, JSON.stringify(data).substring(0, 120));
  }
});

// ══════════════════════════════════════════════════════════════
// ITEM DATABASE
// ══════════════════════════════════════════════════════════════
let allItems = [];
let allCategories = [];
let editingItemId = null;
let tempBonuses = []; // bonuses being edited in modal

const BONUS_TYPES = [
  {value: 'percent_damage_reduction', label: '% Damage Reduction'},
  {value: 'flat_damage_reduction', label: 'Flat Damage Reduction'},
  {value: 'stat_bonus', label: 'Stat Bonus'},
  {value: 'attack_bonus', label: 'Attack Bonus'},
  {value: 'damage_bonus', label: 'Damage Bonus'},
  {value: 'damage_dice_count', label: 'Damage Dice Count'},
  {value: 'damage_dice_type', label: 'Damage Dice Type'},
  {value: 'hp_bonus', label: 'HP Bonus'},
  {value: 'initiative_bonus', label: 'Initiative Bonus'},
  {value: 'speed_bonus', label: 'Speed Bonus'},
  {value: 'custom', label: 'Custom'},
];

const STAT_NAMES = ['strength','dexterity','constitution','intelligence','wisdom','charisma'];

function copperToDisplay(copper) {
  if (!copper || copper === 0) return '0';
  let r = copper;
  const p = Math.floor(r / 1000); r %= 1000;
  const g = Math.floor(r / 100); r %= 100;
  const s = Math.floor(r / 10); r %= 10;
  const parts = [];
  if (p) parts.push(`<span style="color:#e0c97f">${p}P</span>`);
  if (g) parts.push(`<span class="price-gold">${g}G</span>`);
  if (s) parts.push(`<span class="price-silver">${s}S</span>`);
  if (r) parts.push(`<span class="price-copper">${r}C</span>`);
  return parts.join(' ') || '0';
}

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
          <span class="ic-price price-display">${copperToDisplay(item.base_price_copper)}</span>
          ${item.weight ? `<span>${item.weight}lb</span>` : ''}
          ${item.equippable ? '<span>📎 Equip</span>' : ''}
          ${item.consumable ? '<span>🧪 Use</span>' : ''}
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
    $('#item-ed-price').value = item.base_price_copper || 0;
    $('#item-ed-weight').value = item.weight || 0;
    $('#item-ed-equippable').checked = item.equippable;
    $('#item-ed-consumable').checked = item.consumable;
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
    }
    tempBonuses = (item.bonuses || []).map(b => ({...b}));
    $('#btn-delete-item').classList.remove('hidden');
  } else {
    $('#item-modal-title').textContent = 'New Item';
    $('#item-ed-name').value = '';
    $('#item-ed-desc').value = '';
    $('#item-ed-rarity').value = 'common';
    $('#item-ed-price').value = 0;
    $('#item-ed-weight').value = 0;
    $('#item-ed-equippable').checked = false;
    $('#item-ed-consumable').checked = false;
    $('#item-ed-tags').value = '';
    $('#item-ed-is-weapon').checked = false;
    $('#weapon-stats-section').classList.add('hidden');
    tempBonuses = [];
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
    base_price_copper: parseInt($('#item-ed-price').value) || 0,
    weight: parseFloat($('#item-ed-weight').value) || 0,
    equippable: $('#item-ed-equippable').checked,
    consumable: $('#item-ed-consumable').checked,
    tags: JSON.stringify(tags),
    bonuses: tempBonuses.map(b => ({
      bonus_type: b.bonus_type,
      stat_name: b.bonus_type === 'stat_bonus' ? b.stat_name : null,
      value: b.value,
      is_conditional: b.is_conditional || false,
      condition_description: b.condition_description || null,
    })),
  };
  if ($('#item-ed-is-weapon').checked) {
    body.weapon_stats = {
      dice_count: parseInt($('#item-ed-wdice-count').value) || 1,
      dice_type: parseInt($('#item-ed-wdice-type').value) || 6,
      damage_type: $('#item-ed-wdmg-type').value || 'physical',
      range: $('#item-ed-wrange').value.trim() || null,
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
// AI CHAT
// ══════════════════════════════════════════════════════════════
let aiSending = false;

$('#ai-sidebar-toggle').addEventListener('click', () => {
  $('#ai-sidebar').classList.toggle('collapsed');
});

async function loadAIHistory() {
  try {
    const data = await api.get(`/api/ai/history/${SESSION_CODE}`);
    const container = $('#ai-messages');
    container.innerHTML = '';
    for (const msg of data.messages) {
      appendAIMessage(msg.role, msg.content);
    }
    container.scrollTop = container.scrollHeight;
  } catch { /* silent */ }
}

function appendAIMessage(role, content) {
  const container = $('#ai-messages');
  const div = document.createElement('div');
  div.className = `ai-msg ${role}`;

  if (role === 'assistant') {
    // Try to detect JSON item in the response
    const jsonMatch = content.match(/\{[^{}]*"name"\s*:\s*"[^"]+"/s);
    let itemJson = null;
    if (jsonMatch) {
      try {
        // Find the full JSON object
        const start = content.indexOf(jsonMatch[0]);
        let depth = 0, end = start;
        for (let i = start; i < content.length; i++) {
          if (content[i] === '{') depth++;
          if (content[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
        }
        itemJson = JSON.parse(content.substring(start, end));
      } catch { itemJson = null; }
    }

    // Simple markdown rendering
    let html = content.replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
    div.innerHTML = html;

    if (itemJson && itemJson.name) {
      const preview = document.createElement('div');
      preview.className = 'ai-item-preview';
      preview.innerHTML = `
        <strong>${itemJson.name}</strong> (${itemJson.rarity || 'common'} ${itemJson.category || 'misc'})<br>
        ${itemJson.description || ''}<br>
        Price: ${itemJson.base_price || 0}g${itemJson.effect_type ? ` · ${itemJson.effect_type}: ${itemJson.effect_value}` : ''}
        <br><button class="btn btn-primary btn-xs ai-add-item-btn">+ Add to Database</button>
      `;
      preview.querySelector('.ai-add-item-btn').addEventListener('click', async () => {
        try {
          await api.post('/api/items', itemJson);
          showToast(`Item "${itemJson.name}" added to database!`);
          preview.querySelector('.ai-add-item-btn').textContent = '✓ Added';
          preview.querySelector('.ai-add-item-btn').disabled = true;
        } catch (e) { showToast('Failed to add item: ' + e.message); }
      });
      div.appendChild(preview);
    }
  } else {
    div.textContent = content;
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function sendAIMessage(msg) {
  if (aiSending || !msg.trim()) return;
  aiSending = true;
  appendAIMessage('user', msg);
  $('#ai-input').value = '';
  $('#btn-ai-send').textContent = '...';
  $('#btn-ai-send').disabled = true;

  try {
    const res = await api.post('/api/ai/chat', { session_code: SESSION_CODE, message: msg });
    if (res.error) {
      appendAIMessage('assistant', `⚠️ ${res.error}`);
    } else {
      appendAIMessage('assistant', res.reply);
    }
  } catch (e) {
    appendAIMessage('assistant', `⚠️ Error: ${e.message}`);
  }
  aiSending = false;
  $('#btn-ai-send').textContent = 'Send';
  $('#btn-ai-send').disabled = false;
}

$('#btn-ai-send').addEventListener('click', () => sendAIMessage($('#ai-input').value));
$('#ai-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAIMessage($('#ai-input').value); }
});

// Quick action buttons
$$('[data-ai-quick]').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.aiQuick;
    const prompts = {
      narrate: 'Describe the current combat situation dramatically. Set the scene for the players.',
      npc: 'Based on the current game state, what should the NPCs do on their turn? Consider their health, position, and tactical options.',
      item: 'Generate a creative fantasy item appropriate for the current session. Respond with a JSON object in the item creation format.',
      summary: 'Summarize everything that has happened in this session so far. Include key events, damage dealt, items used, and notable moments.',
    };
    if (prompts[action]) sendAIMessage(prompts[action]);
  });
});

// ══════════════════════════════════════════════════════════════
// STAGE 5 — COMBAT TAB
// ══════════════════════════════════════════════════════════════
let activeCombat = null;
let combatTimerInterval = null;

async function loadCombatPanel() {
  const panel = document.querySelector('#combat-panel');
  if (!panel) return;

  // Check for active combat
  const res = await api.get(`/api/combat/session/${SESSION_CODE}/active`);
  if (res.active) {
    activeCombat = res.combat;
    renderActiveCombat(panel);
  } else {
    activeCombat = null;
    renderCombatSetup(panel);
  }
}

function renderCombatSetup(panel) {
  panel.innerHTML = `
    <div class="detail-panel">
      <div class="detail-header">
        <h2>⚔️ Combat Manager</h2>
      </div>
      <div class="detail-body">
        <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center">
          <input type="text" id="combat-name" placeholder="Combat name (e.g. Ambush at the bridge)" style="flex:1">
          <button class="btn btn-primary btn-sm" id="btn-create-combat">🗡️ New Combat</button>
        </div>
        <p class="text-muted" style="font-size:0.8rem">No active combat. Create one to begin.</p>
      </div>
    </div>
  `;
  panel.querySelector('#btn-create-combat').addEventListener('click', async () => {
    const name = panel.querySelector('#combat-name').value.trim() || 'Combat';
    const sess = await api.get(`/api/sessions/${SESSION_CODE}`);
    const res = await api.post('/api/combat/create', { session_id: sess.id, name });
    activeCombat = res;
    renderPreparingCombat(panel);
    addLog('gm.combat', `Combat "${name}" created`);
    // Broadcast
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({ type: 'combat.created', data: { combat_id: res.id, name } }));
    }
  });
}

function renderPreparingCombat(panel) {
  const c = activeCombat;
  const allChars = characters;
  const partIds = new Set(c.participants.map(p => p.character_id));

  panel.innerHTML = `
    <div class="detail-panel">
      <div class="detail-header">
        <h2>⚔️ ${c.name} <span class="cc-badge" style="background:var(--accent-orange)">Preparing</span></h2>
      </div>
      <div class="detail-body">
        <div style="font-size:0.8rem;font-weight:600;margin-bottom:6px">Add Participants:</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px" id="combat-char-selector">
          ${allChars.map(ch => {
            const inCombat = partIds.has(ch.id);
            const label = ch.is_npc ? 'NPC' : 'Player';
            return `<label style="display:flex;gap:4px;align-items:center;padding:4px 8px;border:1px solid var(--border);border-radius:var(--r-md);font-size:0.78rem;cursor:pointer;${inCombat?'background:var(--accent)20;border-color:var(--accent)':''}">
              <input type="checkbox" value="${ch.id}" ${inCombat?'checked':''} ${!ch.is_alive?'disabled':''}>
              ${ch.name} <span style="font-size:0.65rem;color:var(--text-muted)">(${label})</span>
              ${!ch.is_alive?'💀':''}
            </label>`;
          }).join('')}
        </div>
        <button class="btn btn-ghost btn-xs" id="btn-combat-update-participants" style="margin-bottom:12px">Update Participants</button>

        <hr class="section-divider">
        <div style="font-size:0.8rem;font-weight:600;margin-bottom:6px">Participants & Initiative:</div>
        <div id="combat-participants-list" style="margin-bottom:10px">${renderParticipantRows(c)}</div>

        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
          <button class="btn btn-primary btn-sm" id="btn-combat-roll-npc">🎲 Roll NPC Initiative</button>
          <button class="btn btn-ghost btn-sm" id="btn-combat-request-player-rolls">📣 Request Player Rolls</button>
        </div>

        <hr class="section-divider">
        <button class="btn btn-primary btn-sm" id="btn-combat-start" style="width:100%">▶ Start Combat</button>
      </div>
    </div>
  `;

  // Wire buttons
  panel.querySelector('#btn-combat-update-participants').addEventListener('click', async () => {
    const checked = [...panel.querySelectorAll('#combat-char-selector input:checked')].map(i => parseInt(i.value));
    const current = new Set(c.participants.map(p => p.character_id));
    const toAdd = checked.filter(id => !current.has(id));
    const toRemove = [...current].filter(id => !checked.includes(id));

    for (const id of toRemove) {
      await api.del(`/api/combat/${c.id}/participants/${id}`);
    }
    if (toAdd.length) {
      await api.post(`/api/combat/${c.id}/add-participants`, { character_ids: toAdd });
    }
    const state = await api.get(`/api/combat/${c.id}/state`);
    activeCombat = state;
    renderPreparingCombat(panel);
  });

  panel.querySelector('#btn-combat-roll-npc').addEventListener('click', async () => {
    const res = await api.post(`/api/combat/${c.id}/roll-npc-initiative`);
    activeCombat = res.combat;
    panel.querySelector('#combat-participants-list').innerHTML = renderParticipantRows(activeCombat);
    addLog('gm.combat', `NPC initiative rolled: ${res.rolls.map(r => `${r.name}=${r.final}`).join(', ')}`);
  });

  panel.querySelector('#btn-combat-request-player-rolls').addEventListener('click', () => {
    const playerParts = c.participants.filter(p => !p.is_npc);
    const bonuses = {};
    playerParts.forEach(p => { bonuses[String(p.character_id)] = p.initiative_bonus; });
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({
        type: 'combat.roll_initiative_request',
        combat_id: c.id,
        player_ids: playerParts.map(p => p.character_id),
        bonuses,
      }));
    }
    showToast('Initiative roll request sent to players');
  });

  panel.querySelector('#btn-combat-start').addEventListener('click', async () => {
    try {
      const res = await api.post(`/api/combat/${c.id}/start`);
      activeCombat = res;
      renderActiveCombat(panel);
      addLog('gm.combat', `Combat "${c.name}" started!`);
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({ type: 'combat.started', data: { combat_id: c.id } }));
      }
    } catch (e) {
      showToast('Cannot start: ensure all participants have initiative');
    }
  });

  // Manual initiative inputs
  wireInitiativeInputs(panel, c);
}

function renderParticipantRows(c) {
  if (!c.participants.length) return '<span class="text-muted" style="font-size:0.78rem">No participants yet.</span>';
  return c.participants.map(p => {
    const hpPct = p.max_hp > 0 ? (p.current_hp / p.max_hp * 100) : 0;
    const hpColor = hpPct > 50 ? 'var(--hp-high)' : hpPct > 25 ? 'var(--hp-mid)' : 'var(--hp-low)';
    const badge = p.is_npc ? '<span style="font-size:0.6rem;color:var(--text-muted)">NPC</span>' : '<span style="font-size:0.6rem;color:var(--accent)">Player</span>';
    const isCurrent = c.current_participant_id === p.id;
    return `<div style="display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);${isCurrent?'background:var(--accent)10;border-left:3px solid var(--accent);padding-left:5px':''}">
      <span style="font-size:0.9rem;min-width:28px;text-align:center;font-weight:700;color:${isCurrent?'var(--accent)':'var(--text-muted)'}">${p.final_initiative !== null ? p.final_initiative : '—'}</span>
      <div style="flex:1">
        <div style="font-size:0.8rem;font-weight:600">${p.name} ${badge}</div>
        <div class="hp-bar-container" style="height:4px;margin-top:2px"><div class="hp-bar" style="width:${hpPct}%;background:${hpColor}"></div></div>
      </div>
      <span style="font-size:0.7rem;color:var(--text-muted)">${p.current_hp}/${p.max_hp}</span>
      <input type="number" data-init-pid="${p.id}" value="${p.final_initiative !== null ? p.final_initiative : ''}" placeholder="Init" style="width:48px;font-size:0.75rem;text-align:center" title="Manual initiative">
    </div>`;
  }).join('');
}

function wireInitiativeInputs(panel, c) {
  panel.querySelectorAll('[data-init-pid]').forEach(input => {
    input.addEventListener('change', async () => {
      const pid = parseInt(input.dataset.initPid);
      const val = parseInt(input.value);
      if (isNaN(val)) return;
      await api.post(`/api/combat/${c.id}/set-manual-initiative`, { participant_id: pid, final_initiative: val });
    });
  });
}

function renderActiveCombat(panel) {
  const c = activeCombat;
  const currentP = c.participants.find(p => p.id === c.current_participant_id);

  panel.innerHTML = `
    <div class="detail-panel">
      <div class="detail-header">
        <h2>⚔️ ${c.name} <span class="cc-badge" style="background:var(--accent-green)">Active</span> <span style="font-size:0.8rem;color:var(--text-muted)">Round ${c.round_number}</span></h2>
        <button class="btn btn-danger btn-sm" id="btn-combat-end">⏹ End Combat</button>
      </div>
      <div class="detail-body">
        <!-- Current Turn Banner -->
        <div style="padding:10px;margin-bottom:12px;border-radius:var(--r-md);background:var(--accent)15;border:2px solid var(--accent);text-align:center">
          <div style="font-size:0.75rem;color:var(--text-muted)">Current Turn</div>
          <div style="font-size:1.2rem;font-weight:700;color:var(--accent)">${currentP ? currentP.name : '—'}</div>
          ${currentP && !currentP.is_npc ? `
            <div style="margin-top:6px;display:flex;gap:6px;justify-content:center;align-items:center">
              <label style="font-size:0.7rem;color:var(--text-muted)">Timer:</label>
              <input type="number" id="combat-timer-sec" value="30" style="width:50px;font-size:0.75rem" min="5" max="300">
              <button class="btn btn-ghost btn-xs" id="btn-combat-timer">⏱ Start Timer</button>
            </div>
            <div id="combat-timer-display" style="font-size:1.5rem;font-weight:700;color:var(--accent-orange);margin-top:4px;display:none"></div>
          ` : ''}
        </div>

        <!-- Next Turn Button -->
        <button class="btn btn-primary" id="btn-combat-next-turn" style="width:100%;margin-bottom:12px;font-size:1rem;padding:10px">⏭ Next Turn</button>

        <!-- Turn Order -->
        <div style="font-size:0.8rem;font-weight:600;margin-bottom:6px">Turn Order:</div>
        <div id="combat-turn-order">${renderParticipantRows(c)}</div>

        <!-- Turn Events -->
        <div id="combat-events" style="margin-top:8px;font-size:0.78rem"></div>
      </div>
    </div>
  `;

  // Wire Next Turn
  panel.querySelector('#btn-combat-next-turn').addEventListener('click', async () => {
    const res = await api.post(`/api/combat/${c.id}/next-turn`);
    activeCombat = res.combat;
    renderActiveCombat(panel);

    // Show events
    const evEl = panel.querySelector('#combat-events');
    if (evEl && res.turn_end_events && res.turn_end_events.length) {
      evEl.innerHTML = res.turn_end_events.map(e => {
        if (e.type === 'hp_change') return `<div style="color:var(--accent-red)">💔 ${e.character_name}: ${e.hp_change} HP (${e.sources.map(s=>s.name).join(', ')})</div>`;
        if (e.type === 'status_effect.expired') return `<div style="color:var(--accent-orange)">✨ ${e.character_name}: ${e.effect_name} expired</div>`;
        return '';
      }).join('');
    }
    if (res.skipped && res.skipped.length) {
      const skText = res.skipped.map(s => `⏭ ${s.name} skipped (${s.reason})`).join('<br>');
      if (evEl) evEl.innerHTML += skText;
    }

    addLog('gm.combat', `Turn: ${res.current_character_name} (Round ${res.combat.round_number})`);
    // Broadcast
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({ type: 'combat.turn_changed', data: {
        combat_id: c.id,
        current_character_id: res.current_character_id,
        current_character_name: res.current_character_name,
        round_number: res.combat.round_number,
      }}));
    }
  });

  // Wire End Combat
  panel.querySelector('#btn-combat-end').addEventListener('click', async () => {
    await api.post(`/api/combat/${c.id}/end`);
    activeCombat = null;
    addLog('gm.combat', `Combat ended`);
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({ type: 'combat.ended', data: { combat_id: c.id } }));
    }
    loadCombatPanel();
  });

  // Wire Timer
  const timerBtn = panel.querySelector('#btn-combat-timer');
  if (timerBtn && currentP) {
    timerBtn.addEventListener('click', () => {
      const sec = parseInt(panel.querySelector('#combat-timer-sec').value) || 30;
      startCombatTimer(panel, sec, currentP.character_id);
    });
  }
}

function startCombatTimer(panel, seconds, charId) {
  const display = panel.querySelector('#combat-timer-display');
  if (!display) return;
  display.style.display = '';
  let remaining = seconds;
  display.textContent = remaining + 's';

  if (combatTimerInterval) clearInterval(combatTimerInterval);
  combatTimerInterval = setInterval(() => {
    remaining--;
    display.textContent = remaining + 's';
    if (remaining <= 5) display.style.color = 'var(--accent-red)';
    if (remaining <= 0) {
      clearInterval(combatTimerInterval);
      display.textContent = '⏰ TIME UP!';
      display.style.animation = 'pulse 0.5s ease-in-out 3';
    }
  }, 1000);

  // Send timer to player
  if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
    ws.ws.send(JSON.stringify({
      type: 'combat.timer_started',
      player_id: charId,
      duration_seconds: seconds,
      combat_id: activeCombat ? activeCombat.id : null,
    }));
  }
}

// WS listeners for combat
ws.on('combat.initiative_submitted', d => {
  if (activeCombat) {
    showToast(`${d.character_id} submitted initiative: ${d.roll} (total: ${d.final})`);
    loadCombatPanel();
  }
});

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════
refreshChars();
loadInitiativeOrder();
loadAIHistory();
loadCategories().then(() => loadItems());
loadCombatPanel();
ws.connect();
