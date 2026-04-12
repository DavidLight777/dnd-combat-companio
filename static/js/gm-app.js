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
    $$('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    $(`#tab-${tab.dataset.tab}`).classList.add('active');
  });
});

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
      </div>`;
  }).join('');

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
// INIT
// ══════════════════════════════════════════════════════════════
refreshChars();
loadInitiativeOrder();
ws.connect();
