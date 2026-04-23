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
const SESSION_ID = parseInt(sessionStorage.getItem('session_id')) || null;
if (!SESSION_CODE || !GM_TOKEN) location.href = '/';
$('#session-code').textContent = SESSION_CODE;

// ── State ────────────────────────────────────────────────────
let characters = [];
let selectedCharId = null;
let _gmAdvModes = {};  // per-panel advantage mode

// ── Advantage Toggle helper ──────────────────────────────────
function makeAdvToggle(panelKey) {
  _gmAdvModes[panelKey] = _gmAdvModes[panelKey] || 'normal';
  const cur = _gmAdvModes[panelKey];
  return `<div class="adv-toggle" data-adv-panel="${panelKey}">
    <button data-mode="normal" class="${cur==='normal'?'active':''}">Normal</button>
    <button data-mode="advantage" class="${cur==='advantage'?'active':''}">ADV</button>
    <button data-mode="disadvantage" class="${cur==='disadvantage'?'active':''}">DISADV</button>
  </div>`;
}
function bindAdvToggle(container, panelKey) {
  const btns = container.querySelectorAll(`.adv-toggle[data-adv-panel="${panelKey}"] button`);
  btns.forEach(b => b.addEventListener('click', () => {
    _gmAdvModes[panelKey] = b.dataset.mode;
    btns.forEach(x => x.classList.toggle('active', x === b));
  }));
}
function getAdvMode(panelKey) { return _gmAdvModes[panelKey] || 'normal'; }

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
  div.className = 'log-entry';
  // Determine category for filtering
  const catMap = {
    'combat': 'combat', 'initiative': 'combat', 'turn': 'combat', 'damage': 'combat', 'heal': 'combat', 'hp': 'combat',
    'gold': 'economy', 'currency': 'economy', 'trade': 'economy', 'buy': 'economy', 'sell': 'economy', 'economy': 'economy',
    'inventory': 'inventory', 'item': 'inventory', 'equip': 'inventory', 'unequip': 'inventory',
    'quest': 'quest',
    'map': 'map', 'marker': 'map', 'drawing': 'map', 'fog': 'map',
  };
  let cat = '';
  const evLower = event.toLowerCase();
  for (const [key, val] of Object.entries(catMap)) { if (evLower.includes(key)) { cat = val; break; } }
  div.dataset.logCat = cat;
  const icons = { combat: '⚔️', economy: '💰', inventory: '🎒', quest: '📜', map: '🗺️' };
  const icon = icons[cat] || '📋';
  div.innerHTML = `<span class="time">[${time}]</span> ${icon} <span class="event-name">${event}</span> ${text}`;
  log.prepend(div);
  while (log.children.length > 200) log.removeChild(log.lastChild);
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
    if (tab.dataset.tab === 'map' || tab.dataset.tab === 'builder') {
      panel.style.display = 'flex';
      if (tab.dataset.tab === 'map') {
        initMapCanvas();
        if (mapCanvas) { mapCanvas._resize(); mapCanvas.render(); }
      }
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
  renderNPCList();
  $('#player-count').textContent = characters.filter(c => !c.is_npc).length;
  if (selectedCharId) renderCharDetail();
  _updateAllNpcPanels();
}

// ══════════════════════════════════════════════════════════════
// PARTY LIST (sidebar)
// ══════════════════════════════════════════════════════════════
function renderPartyList() {
  const list = $('#party-list');
  const party = characters.filter(c => !c.is_npc);
  $('#party-count').textContent = party.length ? `(${party.length})` : '';
  if (!party.length) {
    list.innerHTML = '<p class="text-muted" style="font-size:0.8rem;padding:8px">Waiting for players...</p>';
    return;
  }
  list.innerHTML = party.map(c => {
    const pct = c.max_hp > 0 ? (c.current_hp / c.max_hp * 100) : 0;
    const color = pct > 50 ? 'var(--hp-high)' : pct > 25 ? 'var(--hp-mid)' : 'var(--hp-low)';
const deadBadge = !c.is_alive ? ' <span class="cc-badge badge-dead">💀</span>' : '';
    const sel = c.id === selectedCharId ? ' selected' : '';
    const dead = !c.is_alive ? ' dead' : '';
    const isPlaced = c.place_at_table || c.is_at_table;
    const timerRow = `
    <div class="cc-timer-row" style="display:flex;gap:3px;align-items:center;margin-top:3px" data-timer-char="${c.id}">
      <input type="number" value="2" min="1" max="30" step="1" style="width:36px;font-size:0.65rem;padding:1px 3px;text-align:center" data-timer-min="${c.id}">
      <span style="font-size:0.6rem;color:var(--text-muted)">min</span>
      <button class="btn btn-ghost" style="font-size:0.6rem;padding:1px 5px;line-height:1.2" data-send-timer="${c.id}">⏱</button>
    </div>`;
    return `
    <div class="char-card${sel}${dead}" data-char-id="${c.id}">
      <div class="cc-top">
        <span class="cc-name">${c.name}</span>${deadBadge}
      </div>
      <div class="cc-info">
        <div class="cc-line">
          <span class="hp-text">HP ${c.current_hp}/${c.max_hp}</span>
          <span class="hp-text">KD ${c.armor_class}</span>
        </div>
        <div class="cc-line" style="flex:1;min-width:0">
          <div class="hp-bar-container"><div class="hp-bar" style="width:${pct}%;background:${color}"></div></div>
        </div>
      </div>
      <div class="cc-status-badges" data-sidebar-status="${c.id}" style="display:flex;flex-wrap:wrap;gap:2px;margin-top:2px"></div>
      <div class="cc-actions" style="display:flex;gap:4px;align-items:center;margin-top:3px">
        <button class="btn btn-ghost btn-xs player-map-toggle" data-player="${c.id}" data-field="place_at_table" style="font-size:0.6rem;padding:1px 6px;${isPlaced?'background:var(--accent-green20);color:var(--accent-green);border-color:var(--accent-green)':''}" title="Toggle on map">
          ${isPlaced?'📍 Map':'📍 Place'}
        </button>
        <button class="btn btn-ghost btn-xs player-hp-toggle" data-player="${c.id}" data-field="show_hp_to_players" style="font-size:0.6rem;padding:1px 6px;${c.show_hp_to_players?'background:var(--accent20);color:var(--accent);border-color:var(--accent)':''}" title="Show HP to players">
          ${c.show_hp_to_players?'👁':'🔒'}
        </button>
      </div>
      ${timerRow}
    </div>`;
  }).join('');

  // Load sidebar status badges
  party.forEach(c => {
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
      renderNPCList();
      renderCharDetail();
      // Switch to detail tab
      $$('.gm-tab').forEach(t => t.classList.remove('active'));
      $$('.tab-content').forEach(c => c.classList.remove('active'));
      $('[data-tab="detail"]').classList.add('active');
      $('#tab-detail').classList.add('active');
    });
  });

  // Wire sidebar timer buttons
  list.querySelectorAll('[data-send-timer]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const charId = parseInt(btn.dataset.sendTimer);
      const minInput = list.querySelector(`[data-timer-min="${charId}"]`);
      const mins = parseFloat(minInput?.value) || 2;
      const secs = Math.round(mins * 60);
      sendPlayerTimer(charId, secs);
    });
  });
  list.querySelectorAll('[data-timer-min]').forEach(inp => {
    inp.addEventListener('click', e => e.stopPropagation());
  });

  // Wire player map-toggle and HP-toggle buttons
  list.querySelectorAll('.player-map-toggle, .player-hp-toggle').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const charId = parseInt(btn.dataset.player);
      const field = btn.dataset.field;
      const ch = characters.find(c => c.id === charId);
      if (!ch) return;
      const newValue = !(ch[field]);
      try {
        await api.patch(`/api/characters/${charId}/table-visibility`, { [field]: newValue });
        ch[field] = newValue;
        if (field === 'place_at_table' && newValue) {
          const tokenOnMap = mapCanvas?.tokens?.find(t => t.character_id === charId);
          const hasCoords = tokenOnMap && tokenOnMap.x != null && tokenOnMap.y != null;
          if (!hasCoords) {
            try {
              await api.patch(`/api/map/token/${charId}`, { x: 0.5, y: 0.5 });
              if (mapCanvas) mapCanvas.setTokens(mapCanvas.tokens.map(t => t.character_id === charId ? { ...t, x: 0.5, y: 0.5 } : t));
            } catch (mapErr) {
              console.warn('Auto-place token failed (no map uploaded yet?)', mapErr);
            }
          }
        }
        renderPartyList();
        showToast(`${ch.name}: ${field === 'place_at_table' ? (newValue ? 'placed on map' : 'removed from map') : (newValue ? 'HP visible' : 'HP hidden')}`);
      } catch (err) {
        showToast('Failed to update: ' + (err.message || ''));
      }
    });
  });
}

function renderNPCList() {
  const list = $('#npc-list');
  const npcs = characters.filter(c => c.is_npc);
  $('#npc-count').textContent = npcs.length ? `(${npcs.length})` : '';
  if (!npcs.length) {
    list.innerHTML = '<p class="text-muted" style="font-size:0.8rem;padding:8px">No NPCs</p>';
    return;
  }
  list.innerHTML = npcs.map(c => {
    const pct = c.max_hp > 0 ? (c.current_hp / c.max_hp * 100) : 0;
    const color = pct > 50 ? 'var(--hp-high)' : pct > 25 ? 'var(--hp-mid)' : 'var(--hp-low)';
    const deadBadge = !c.is_alive ? ' <span class="cc-badge badge-dead">💀</span>' : '';
    const sel = c.id === selectedCharId ? ' selected' : '';
    const dead = !c.is_alive ? ' dead' : '';
    const isPlaced = c.place_at_table || c.is_at_table;
    const showHp = c.show_hp_to_players;
    return `
      <div class="char-card${sel}${dead}" data-char-id="${c.id}">
        <div class="cc-top">
          <span class="cc-name">${c.name}</span>${deadBadge}
        </div>
        <div class="cc-info">
          <div class="cc-line">
            <span class="hp-text">HP ${c.current_hp}/${c.max_hp}</span>
            <span class="hp-text">KD ${c.armor_class}</span>
          </div>
          <div class="cc-line" style="flex:1;min-width:0">
            <div class="hp-bar-container"><div class="hp-bar" style="width:${pct}%;background:${color}"></div></div>
          </div>
        </div>
        <div class="cc-status-badges" data-sidebar-status="${c.id}" style="display:flex;flex-wrap:wrap;gap:2px;margin-top:2px"></div>
        <div class="cc-actions" style="display:flex;gap:4px;align-items:center;margin-top:3px">
          <button class="btn btn-ghost btn-xs npc-map-toggle" data-npc="${c.id}" data-field="place_at_table" style="font-size:0.6rem;padding:1px 6px;${isPlaced?'background:var(--accent-green20);color:var(--accent-green);border-color:var(--accent-green)':''}" title="Toggle on map">
            ${isPlaced?'📍 Map':'📍 Place'}
          </button>
          <button class="btn btn-ghost btn-xs npc-hp-toggle" data-npc="${c.id}" data-field="show_hp_to_players" style="font-size:0.6rem;padding:1px 6px;${showHp?'background:var(--accent20);color:var(--accent);border-color:var(--accent)':''}" title="Show HP to players">
            ${showHp?'👁':'🔒'}
          </button>
          <button class="btn btn-ghost btn-xs npc-panel-open" data-npc="${c.id}" style="font-size:0.6rem;padding:1px 6px;margin-left:auto" title="Open control panel">
            🎮
          </button>
        </div>
      </div>`;
  }).join('');

  // Load sidebar status badges
  npcs.forEach(c => {
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
      renderNPCList();
      renderCharDetail();
      $$('.gm-tab').forEach(t => t.classList.remove('active'));
      $$('.tab-content').forEach(c => c.classList.remove('active'));
      $('[data-tab="detail"]').classList.add('active');
      $('#tab-detail').classList.add('active');
    });
  });

  // Wire NPC map-toggle and HP-toggle buttons
  list.querySelectorAll('.npc-map-toggle, .npc-hp-toggle').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const npcId = parseInt(btn.dataset.npc);
      const field = btn.dataset.field;
      const npc = characters.find(c => c.id === npcId);
      if (!npc) return;

      const newValue = !(npc[field]);
      try {
        await api.patch(`/api/characters/${npcId}/table-visibility`, { [field]: newValue });
        npc[field] = newValue;

        // When placing on map, auto-seed token coordinates if missing
        if (field === 'place_at_table' && newValue) {
          const tokenOnMap = mapCanvas?.tokens?.find(t => t.character_id === npcId);
          const hasCoords = tokenOnMap && tokenOnMap.x != null && tokenOnMap.y != null;
          if (!hasCoords) {
            try {
              await api.patch(`/api/map/token/${npcId}`, { x: 0.5, y: 0.5 });
              if (mapCanvas) mapCanvas.setTokens(mapCanvas.tokens.map(t => t.character_id === npcId ? { ...t, x: 0.5, y: 0.5 } : t));
            } catch (mapErr) {
              console.warn('Auto-place token failed (no map uploaded yet?)', mapErr);
            }
          }
        }

        renderNPCList();
        showToast(`${npc.name}: ${field === 'place_at_table' ? (newValue ? 'placed on map' : 'removed from map') : (newValue ? 'HP visible' : 'HP hidden')}`);
      } catch (err) {
        showToast('Failed to update: ' + (err.message || ''));
      }
    });
  });

  // Wire NPC control-panel open button
  list.querySelectorAll('.npc-panel-open').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openNpcControlPanel(parseInt(btn.dataset.npc));
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

  // ── Shared HTML fragments ──
  const hpHtml = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
      <span style="font-size:1.5rem;font-weight:700;color:${hpColor};font-variant-numeric:tabular-nums">${c.current_hp} / ${c.max_hp}</span>
      <span style="font-size:0.8rem;color:var(--text-muted)">KD: ${c.armor_class}</span>
      <div class="hp-bar-container" style="flex:1"><div class="hp-bar" style="width:${pct}%;background:${hpColor}"></div></div>
    </div>
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
    </div>`;

  const manaHtml = c.mana_max > 0 ? (() => {
    const manaPct = c.mana_max > 0 ? (c.mana_current / c.mana_max * 100) : 0;
    return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
      <span style="font-size:1.1rem;font-weight:700;color:#60a5fa;font-variant-numeric:tabular-nums">🔮 ${c.mana_current} / ${c.mana_max}</span>
      ${c.mana_regen_per_turn ? `<span style="font-size:0.7rem;color:var(--text-muted)">+${c.mana_regen_per_turn}/turn</span>` : ''}
      <div style="flex:1;height:8px;border-radius:4px;background:var(--bg-surface-2);overflow:hidden"><div style="width:${manaPct}%;height:100%;background:#60a5fa;border-radius:4px;transition:width .3s"></div></div>
    </div>
    <div class="action-row" style="margin-bottom:8px">
      <button class="btn btn-ghost btn-xs" data-mana-delta="5">+5</button>
      <button class="btn btn-ghost btn-xs" data-mana-delta="10">+10</button>
      <button class="btn btn-ghost btn-xs" data-mana-delta="20">+20</button>
      <span style="width:8px"></span>
      <button class="btn btn-ghost btn-xs" data-mana-delta="-5">-5</button>
      <button class="btn btn-ghost btn-xs" data-mana-delta="-10">-10</button>
      <button class="btn btn-ghost btn-xs" data-mana-delta="-20">-20</button>
      <button class="btn btn-ghost btn-xs" data-mana-full="1" style="color:#60a5fa;margin-left:4px" title="Full mana restore">🔮 Full</button>
    </div>`;
  })() : '';

  const permanentBonusesHtml = (() => {
    const raceMods = (c.stat_modifiers || []).filter(m => m.source === 'race');
    const classMods = (c.stat_modifiers || []).filter(m => m.source === 'class');
    if (!raceMods.length && !classMods.length) return '';
    let html = '<div style="margin-bottom:8px">';
    html += '<h3 style="font-size:0.82rem;margin-bottom:6px">🏷️ Permanent Bonuses</h3>';
    if (raceMods.length) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px">';
      html += raceMods.map(m => `<span style="padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:600;background:#fbbf2420;border:1px solid #fbbf24;color:#fbbf24">${m.name || m.stat_name}: ${m.value > 0 ? '+' : ''}${m.value}</span>`).join('');
      html += '</div>';
    }
    if (classMods.length) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px">';
      html += classMods.map(m => `<span style="padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:600;background:#60a5fa20;border:1px solid #60a5fa;color:#60a5fa">${m.name || m.stat_name}: ${m.value > 0 ? '+' : ''}${m.value}</span>`).join('');
      html += '</div>';
    }
    html += '</div>';
    return html;
  })();

  const statsHtml = `
    <div class="stats-inline">
      ${stats.map((s,i) => {
        const base = c[s];
        const modSum = (c.stat_modifiers || []).filter(m => m.stat_name === s && m.is_active).reduce((a, m) => a + m.value, 0);
        const eff = base + modSum;
        const modLabel = modSum !== 0 ? ` <span style="font-size:0.55rem;color:${modSum > 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">(${modSum > 0 ? '+' : ''}${modSum})</span>` : '';
        return `<div class="stat-inline"><div class="sl">${labels[i]}</div><div class="sv">${eff}${modLabel}</div></div>`;
      }).join('')}
      <div class="stat-inline"><div class="sl">KD</div><div class="sv" style="color:var(--accent)">${c.armor_class}</div></div>
    </div>`;

  const editStatsHtml = `
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
      <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
        <span style="font-size:0.6rem;color:#60a5fa">MaxMP</span>
        <input type="number" value="${c.mana_max}" data-gm-stat="mana_max" style="width:48px;font-size:0.78rem;padding:3px">
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
        <span style="font-size:0.6rem;color:#60a5fa">MP/T</span>
        <input type="number" value="${c.mana_regen_per_turn}" data-gm-stat="mana_regen_per_turn" style="width:48px;font-size:0.78rem;padding:3px">
      </div>
    </div>`;

  const effectsSection = `
    <h3 style="font-size:0.82rem;margin-bottom:6px">Effects</h3>
    <div id="gm-effects">${effectsHtml}</div>`;

  const statusSection = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <h3 style="font-size:0.82rem;flex:1">⚡ Status Effects</h3>
      <button class="btn btn-primary btn-xs" id="btn-gm-add-status">+ Add Status</button>
      <button class="btn btn-ghost btn-xs" id="btn-gm-status-library">📚 Library</button>
    </div>
    <div id="gm-status-badges" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px"></div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="font-size:0.72rem;color:var(--text-muted)">Force Adv/Disadv:</span>
      <div class="adv-toggle" id="gm-force-adv-toggle">
        <button data-mode="normal" class="active">Normal</button>
        <button data-mode="advantage">ADV</button>
        <button data-mode="disadvantage">DISADV</button>
      </div>
    </div>`;

  const rollSection = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <h3 style="font-size:0.82rem;margin:0">🎲 Characteristic Roll</h3>
      ${makeAdvToggle('gm_char_roll')}
    </div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
      <select id="gm-roll-stat" style="font-size:0.78rem;width:110px">
        <option value="strength">Strength</option>
        <option value="dexterity">Dexterity</option>
        <option value="constitution">Constitution</option>
        <option value="intelligence">Intelligence</option>
        <option value="wisdom">Wisdom</option>
        <option value="charisma">Charisma</option>
      </select>
      <select id="gm-roll-type" style="font-size:0.78rem;width:120px">
        <option value="ability_check">Ability Check</option>
        <option value="saving_throw">Saving Throw</option>
        <option value="skill_check">Skill Check</option>
      </select>
      <button class="btn btn-secondary btn-xs" id="btn-gm-roll-char">🎲 Roll D20</button>
    </div>
    <div id="gm-roll-result" style="font-size:0.82rem;margin-bottom:8px"></div>`;

  const npcAttackHtml = c.is_npc ? `
    <hr class="section-divider">
    <h3 style="font-size:0.82rem;margin-bottom:6px">⚔️ NPC Attack</h3>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
      <label style="font-size:0.78rem;color:var(--text-muted)">Target:</label>
      <select id="npc-atk-target" style="font-size:0.78rem;min-width:120px"></select>
      <span id="npc-weapon-info" style="font-size:0.72rem;color:var(--text-muted)"></span>
    </div>

    <!-- STEP 1: HIT ROLL -->
    <div id="npc-atk-step1">
      <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:4px;font-weight:600">🎯 Step 1 — Roll to Hit (d20)</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:0.72rem;color:var(--text-muted)">Mode:</span>
        <div class="adv-toggle" id="npc-hit-adv">
          <button data-mode="disadvantage">Disadv</button>
          <button data-mode="normal" class="active">Normal</button>
          <button data-mode="advantage">Adv</button>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-npc-roll-attack" style="margin-left:auto">🎯 Roll Hit</button>
      </div>
    </div>

    <!-- STEP 2: DAMAGE ROLL (hidden until HIT) -->
    <div id="npc-atk-step2" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
      <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:4px;font-weight:600">💥 Step 2 — Roll Damage</div>
      <div id="npc-atk-widget-host" style="margin-bottom:6px"></div>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn btn-ghost btn-sm" id="btn-npc-cancel-dmg">Cancel</button>
        <button class="btn btn-primary btn-sm" id="btn-npc-roll-damage" style="margin-left:auto">💥 Roll Damage</button>
      </div>
    </div>

    <div id="npc-atk-result" style="font-size:0.8rem;margin:8px 0"></div>

    <!-- NPC Actions panel: Abilities / Potions / Items (like player's Action Menu) -->
    <hr class="section-divider">
    <h3 style="font-size:0.82rem;margin-bottom:6px">🎯 NPC Actions</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">
      <button class="btn btn-ghost btn-sm" id="btn-npc-act-ability" style="display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px">
        <span style="font-size:1.2rem">✨</span>
        <span style="font-size:0.72rem">Ability</span>
      </button>
      <button class="btn btn-ghost btn-sm" id="btn-npc-act-potion" style="display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px">
        <span style="font-size:1.2rem">🧪</span>
        <span style="font-size:0.72rem">Potion</span>
      </button>
      <button class="btn btn-ghost btn-sm" id="btn-npc-act-item" style="display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px">
        <span style="font-size:1.2rem">🎒</span>
        <span style="font-size:0.72rem">Use Item</span>
      </button>
      <button class="btn btn-ghost btn-sm" id="btn-npc-act-heal" style="display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px">
        <span style="font-size:1.2rem">❤️</span>
        <span style="font-size:0.72rem">Heal</span>
      </button>
    </div>
    <div id="npc-action-result" style="font-size:0.8rem;margin-bottom:8px"></div>
  ` : '';

  const dmgCalcHtml = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <h3 style="font-size:0.82rem;margin:0">Apply Damage to ${c.name}</h3>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <label style="font-size:0.78rem;color:var(--text-muted)">Enemy Roll:</label>
      <input type="number" id="gm-di-enemy" style="width:56px">
      <label style="font-size:0.78rem;color:var(--text-muted)">Raw Dmg:</label>
      <input type="number" id="gm-di-dmg" style="width:56px">
      <button class="btn btn-danger btn-sm" id="btn-gm-apply-dmg">⚔️ Apply</button>
    </div>
    <div id="gm-dmg-result" style="margin-top:6px;font-size:0.82rem"></div>`;

  const currencyHtml = `
    <h3 style="font-size:0.82rem;margin-bottom:6px">💰 Currency</h3>
    <div id="gm-currency-display" style="font-size:0.85rem;margin-bottom:6px;font-weight:600;color:var(--accent)"></div>
    <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
      <span style="font-size:0.7rem;color:#e0c97f">P:</span><input type="number" id="gm-give-plat" value="0" style="width:42px;font-size:0.75rem" min="0">
      <span style="font-size:0.7rem;color:#fbbf24">G:</span><input type="number" id="gm-give-gold" value="0" style="width:42px;font-size:0.75rem" min="0">
      <span style="font-size:0.7rem;color:#94a3b8">S:</span><input type="number" id="gm-give-silver" value="0" style="width:42px;font-size:0.75rem" min="0">
      <span style="font-size:0.7rem;color:#b87333">B:</span><input type="number" id="gm-give-bronze" value="0" style="width:42px;font-size:0.75rem" min="0">
      <button class="btn btn-primary btn-xs" id="btn-gm-give-currency">+ Give</button>
      <button class="btn btn-ghost btn-xs" id="btn-gm-take-currency">- Take</button>
    </div>
    <div style="display:flex;gap:4px;align-items:center;margin-bottom:8px">
      <span style="font-size:0.7rem;color:var(--text-muted)">Set total bronze:</span>
      <input type="number" id="gm-wealth-bronze" value="${c.wealth_bronze || c.gold_copper || 0}" style="width:80px;font-size:0.75rem">
      <button class="btn btn-ghost btn-xs" id="btn-gm-set-gold">Set</button>
      <button class="btn btn-ghost btn-xs" id="btn-gm-tx-history" style="margin-left:auto">📜 History</button>
    </div>`;

  const inventoryHtml = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <h3 style="font-size:0.82rem;flex:1">🎒 Inventory</h3>
      <label style="font-size:0.7rem;color:var(--text-muted)">Player can edit:</label>
      <label class="toggle-switch"><input type="checkbox" id="gm-can-edit-items" ${c.can_edit_own_items?'checked':''}><span class="slider"></span></label>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
      <button class="btn btn-primary btn-xs" id="btn-gm-give-item">+ Give Item</button>
    </div>
    <div id="gm-char-inventory" style="font-size:0.8rem"></div>`;

  const abilitiesAssignHtml = `
    <div style="margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:0.82rem;font-weight:700">✨ Abilities</span>
        <button class="btn btn-ghost btn-xs" id="btn-assign-ability">+ Assign</button>
      </div>
      <div id="npc-abilities-list" style="font-size:0.78rem"></div>
    </div>`;

  // ── NPC: 6-tab layout | Player: single scrollable view ──
  if (c.is_npc) {
    area.innerHTML = `
      <div class="detail-panel">
        <!-- NPC Header Bar (always visible) -->
        <div class="detail-header" style="flex-wrap:wrap;gap:6px">
          <h2 style="flex:1">${c.name} <span class="cc-badge badge-npc">NPC</span> ${!c.is_alive?'<span class="cc-badge badge-dead">💀 DEAD</span>':''}</h2>
          <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">
            <label style="font-size:0.7rem;display:flex;align-items:center;gap:3px;cursor:pointer" title="Token color">🎨 <input type="color" id="npc-token-color" value="${c.token_color||'#60a5fa'}" style="width:24px;height:20px;border:none;padding:0;cursor:pointer"></label>
            <label style="font-size:0.72rem;display:flex;align-items:center;gap:3px;cursor:pointer"><input type="checkbox" id="npc-place-table" ${c.place_at_table?'checked':''}> Table</label>
            <label style="font-size:0.72rem;display:flex;align-items:center;gap:3px;cursor:pointer"><input type="checkbox" id="npc-show-hp" ${c.show_hp_to_players?'checked':''}> HP</label>
            <button class="btn btn-danger btn-xs" id="btn-npc-kill" title="Kill/KO">💀</button>
            <button class="btn btn-danger btn-xs" id="btn-delete-char" title="Remove from session">🗑️</button>
          </div>
        </div>

        <!-- NPC Tab Bar -->
        <div class="npc-tab-bar" style="display:flex;gap:0;border-bottom:2px solid var(--border);overflow-x:auto;background:var(--bg-surface)">
          <button class="npc-tab active" data-npc-tab="stats">⚔️ Stats</button>
          <button class="npc-tab" data-npc-tab="inventory">🎒 Inv</button>
          <button class="npc-tab" data-npc-tab="status">⚡ Status</button>
          <button class="npc-tab" data-npc-tab="abilities">✨ Abilities</button>
          <button class="npc-tab" data-npc-tab="notes">📝 Notes</button>
          <button class="npc-tab" data-npc-tab="rolls">🎲 Rolls</button>
        </div>

        <div class="detail-body" style="padding-top:8px">
          <!-- Tab: Stats & Combat -->
          <div class="npc-tab-content active" data-npc-panel="stats">
            ${hpHtml}
            ${manaHtml}
            ${permanentBonusesHtml}
            ${statsHtml}
            ${editStatsHtml}
            ${npcAttackHtml}
            <hr class="section-divider">
            ${dmgCalcHtml}
          </div>

          <!-- Tab: Inventory -->
          <div class="npc-tab-content" data-npc-panel="inventory" style="display:none">
            ${inventoryHtml}
            ${currencyHtml}
            <hr class="section-divider">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <h3 style="font-size:0.82rem;flex:1">🏪 Merchant</h3>
              <button class="btn btn-primary btn-xs" id="btn-gm-merchant-settings">⚙️ Shop Settings</button>
              <button class="btn btn-ghost btn-xs" id="btn-gm-initiate-trade">🤝 Initiate Trade</button>
            </div>
            <div id="gm-merchant-preview" style="font-size:0.8rem"></div>
          </div>

          <!-- Tab: Status Effects -->
          <div class="npc-tab-content" data-npc-panel="status" style="display:none">
            ${effectsSection}
            <hr class="section-divider">
            ${statusSection}
          </div>

          <!-- Tab: Abilities -->
          <div class="npc-tab-content" data-npc-panel="abilities" style="display:none">
            ${abilitiesAssignHtml}
          </div>

          <!-- Tab: Turn Counter & Notes -->
          <div class="npc-tab-content" data-npc-panel="notes" style="display:none">
            <div style="margin-bottom:8px">
              <h3 style="font-size:0.82rem;margin-bottom:6px">🔄 Turn Counter</h3>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                <span style="font-size:1.2rem;font-weight:700;color:var(--accent);font-variant-numeric:tabular-nums" id="npc-turn-count">${c.turn_count||0}</span>
                <button class="btn btn-primary btn-xs" id="btn-npc-turn-inc">+1 Turn</button>
                <button class="btn btn-ghost btn-xs" id="btn-npc-turn-dec">-1</button>
                <button class="btn btn-ghost btn-xs" id="btn-npc-turn-reset" style="color:var(--accent-red)">Reset</button>
              </div>
            </div>
            <hr class="section-divider">
            <div style="margin-bottom:8px">
              <h3 style="font-size:0.82rem;margin-bottom:6px">📝 GM Notes</h3>
              <textarea id="npc-gm-notes" rows="8" style="width:100%;font-size:0.8rem;background:var(--bg-surface-2);border:1px solid var(--border);border-radius:var(--r-md);padding:8px;resize:vertical">${c.gm_notes||''}</textarea>
              <div style="display:flex;gap:6px;margin-top:4px">
                <button class="btn btn-primary btn-xs" id="btn-save-npc-notes">Save Notes</button>
                <button class="btn btn-ghost btn-xs" id="btn-preview-npc-notes">Preview</button>
              </div>
              <div id="npc-notes-preview" style="display:none;margin-top:6px;font-size:0.8rem;padding:8px;background:var(--bg-surface-2);border-radius:var(--r-md)"></div>
            </div>
            <hr class="section-divider">
            <div id="char-notes-section"></div>
          </div>

          <!-- Tab: Characteristic Rolls -->
          <div class="npc-tab-content" data-npc-panel="rolls" style="display:none">
            ${rollSection}
            <hr class="section-divider">
            <label style="display:flex;align-items:center;gap:4px;font-size:0.75rem;cursor:pointer">
              <input type="checkbox" id="npc-broadcast-rolls"> Broadcast rolls to players
            </label>
          </div>
        </div>
      </div>`;
  } else {
    // ── Player: original single-view layout ──
    area.innerHTML = `
      <div class="detail-panel">
<div class="detail-header" style="flex-wrap:wrap;gap:6px">
      <h2 style="flex:1">${c.name} <span class="cc-badge badge-player">Player</span> ${!c.is_alive?'<span class="cc-badge badge-dead">💀 DEAD</span>':''}</h2>
      <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">
        <label style="font-size:0.72rem;display:flex;align-items:center;gap:3px;cursor:pointer"><input type="checkbox" id="player-place-table" ${c.place_at_table?'checked':''}> Table</label>
        <label style="font-size:0.72rem;display:flex;align-items:center;gap:3px;cursor:pointer"><input type="checkbox" id="player-show-hp" ${c.show_hp_to_players?'checked':''}> HP</label>
      </div>
    </div>
        <div class="detail-body">
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap;font-size:0.78rem">
            <span id="gm-char-race" style="padding:2px 8px;border-radius:10px;background:var(--bg-surface-2);border:1px solid var(--border)">Race: <strong>${c.race_id ? '...' : 'None'}</strong></span>
            <span id="gm-char-class" style="padding:2px 8px;border-radius:10px;background:var(--bg-surface-2);border:1px solid var(--border)" title="Assigned in Professions panel">Profession: <strong>${Array.isArray(c.professions)&&c.professions.length ? c.professions.map(p=>p.name+' L'+p.level).join(' / ') : 'None'}</strong></span>
            <!-- Rework Phase 8: Level / Rank / XP progression badge -->
            <span id="gm-char-progression" style="padding:2px 8px;border-radius:10px;background:var(--bg-surface-2);border:1px solid var(--border)">
              <span title="Rank" style="text-transform:capitalize">${(c.rank||'common')}</span>
              · Lvl <strong>${c.level ?? 0}</strong>
              · XP <strong><span id="gm-char-xp">${c.experience || 0}</span></strong>/<span id="gm-char-xp-next">${100 + 100 * (c.level || 0)}</span>
              <button class="btn btn-ghost btn-xs" id="btn-grant-xp" style="padding:0 3px;margin-left:4px;font-size:0.65rem" title="Grant XP">+XP</button>
              <button class="btn btn-ghost btn-xs" id="btn-level-up" style="padding:0 3px;font-size:0.65rem" title="Level up">⬆</button>
              <button class="btn btn-ghost btn-xs" id="btn-rank-up" style="padding:0 3px;font-size:0.65rem" title="Rank up">★</button>
              <button class="btn btn-ghost btn-xs" id="btn-edit-xp" style="padding:0 3px;font-size:0.65rem" title="Set XP">✏️</button>
            </span>
          </div>
          ${hpHtml}
          ${manaHtml}
          ${abilitiesAssignHtml}
          <hr class="section-divider">
          ${permanentBonusesHtml}
          ${statsHtml}
          ${editStatsHtml}
          <hr class="section-divider">
          ${effectsSection}
          <hr class="section-divider">
          ${statusSection}
          <hr class="section-divider">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <h3 style="font-size:0.82rem;flex:1">⏱ Timer</h3>
          </div>
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
            <input type="number" id="gm-detail-timer-min" value="2" min="1" max="60" step="1" style="width:50px;font-size:0.8rem">
            <span style="font-size:0.75rem;color:var(--text-muted)">min</span>
            <button class="btn btn-primary btn-xs" id="btn-gm-detail-timer-start">▶ Start</button>
            <button class="btn btn-ghost btn-xs" id="btn-gm-detail-timer-pause" style="display:none">⏸ Pause</button>
            <button class="btn btn-ghost btn-xs" id="btn-gm-detail-timer-resume" style="display:none">▶ Resume</button>
            <button class="btn btn-danger btn-xs" id="btn-gm-detail-timer-stop" style="display:none">⏹ Stop</button>
          </div>
          <div id="gm-detail-timer-display" style="font-size:1.6rem;font-weight:700;color:var(--accent-orange);margin-bottom:8px;display:none;font-variant-numeric:tabular-nums"></div>
          <hr class="section-divider">
          ${rollSection}
          <hr class="section-divider">
          ${dmgCalcHtml}
          <hr class="section-divider">
          ${currencyHtml}
          <hr class="section-divider">
          ${inventoryHtml}
          <hr class="section-divider">
          <!-- Rework Phase 4: Professions panel -->
          <div class="gm-prof-section">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <h3 style="font-size:0.82rem;flex:1">🛡️ Professions <span class="text-muted" style="font-size:0.7rem">(multi)</span></h3>
              <button class="btn btn-primary btn-xs" id="btn-gm-prof-add">+ Add</button>
            </div>
            <div id="gm-char-professions" style="display:flex;flex-direction:column;gap:6px;min-height:20px"></div>
          </div>
          <hr class="section-divider">
          <div id="char-notes-section"></div>
        </div>
      </div>`;
  }

  // Rework Phase 4: load + wire professions panel for this character
  loadGmCharProfessions(c.id);
  const addProfBtn = area.querySelector('#btn-gm-prof-add');
  if (addProfBtn) addProfBtn.addEventListener('click', () => openGmAddProfessionModal(c.id));

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

  // Mana delta buttons
  area.querySelectorAll('[data-mana-delta]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const d = parseInt(btn.dataset.manaDelta);
      if (d > 0) await api.post(`/api/characters/${c.id}/restore-mana`, { amount: d });
      else await api.post(`/api/characters/${c.id}/spend-mana`, { cost: -d });
      await refreshChars();
      addLog('gm.mana', `${c.name}: ${d>0?'+'+d:d} Mana`);
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN)
        ws.ws.send(JSON.stringify({ type: 'mana.updated', character_id: c.id, mana_current: null, mana_max: c.mana_max }));
    });
  });
  area.querySelectorAll('[data-mana-full]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.post(`/api/characters/${c.id}/restore-mana`, { full: true });
      await refreshChars();
      addLog('gm.mana', `${c.name}: Full Mana`);
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN)
        ws.ws.send(JSON.stringify({ type: 'mana.updated', character_id: c.id, mana_current: null, mana_max: c.mana_max }));
    });
  });

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

  // Phase 7: NPC Tab switching
  if (c.is_npc) {
    area.querySelectorAll('.npc-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.npcTab;
        area.querySelectorAll('.npc-tab').forEach(t => t.classList.toggle('active', t === tab));
        area.querySelectorAll('.npc-tab-content').forEach(p => {
          p.style.display = p.dataset.npcPanel === target ? '' : 'none';
          p.classList.toggle('active', p.dataset.npcPanel === target);
        });
      });
    });

    // Kill/KO button
    const killBtn = area.querySelector('#btn-npc-kill');
    if (killBtn) {
      killBtn.addEventListener('click', async () => {
        if (!confirm(`Kill/KO ${c.name}?`)) return;
        await api.patch(`/api/characters/${c.id}/hp`, { set: 0 });
        await api.put(`/api/characters/${c.id}`, { is_alive: false });
        try {
          await api.post(`/api/characters/${c.id}/status-effects`, { name: 'Unconscious', icon: '💀', color: '#ef4444', effects: '[]', remaining_turns: -1 });
        } catch {}
        addLog('gm.npc', `${c.name}: KILLED/KO`);
        await refreshChars();
        if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
          ws.ws.send(JSON.stringify({ type: 'combat.character_downed', character_id: c.id, character_name: c.name }));
        }
      });
    }

    // Token color picker
    const colorPicker = area.querySelector('#npc-token-color');
    if (colorPicker) {
      colorPicker.addEventListener('change', async () => {
        await api.put(`/api/characters/${c.id}`, { token_color: colorPicker.value });
        addLog('gm.npc', `${c.name}: token color → ${colorPicker.value}`);
        if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
          ws.ws.send(JSON.stringify({ type: 'npc.token_color_changed', character_id: c.id, color: colorPicker.value }));
        }
      });
    }

    // GM Notes save
    const saveNotesBtn = area.querySelector('#btn-save-npc-notes');
    if (saveNotesBtn) {
      saveNotesBtn.addEventListener('click', async () => {
        const txt = area.querySelector('#npc-gm-notes').value;
        await api.put(`/api/characters/${c.id}`, { gm_notes: txt });
        showToast('Notes saved');
      });
    }
    const previewBtn = area.querySelector('#btn-preview-npc-notes');
    if (previewBtn) {
      previewBtn.addEventListener('click', () => {
        const preview = area.querySelector('#npc-notes-preview');
        const ta = area.querySelector('#npc-gm-notes');
        if (preview.style.display === 'none') {
          preview.style.display = '';
          preview.innerHTML = ta.value.replace(/\n/g, '<br>');
          previewBtn.textContent = 'Edit';
        } else {
          preview.style.display = 'none';
          previewBtn.textContent = 'Preview';
        }
      });
    }

    // NPC Attack section wiring
    const atkTarget = area.querySelector('#npc-atk-target');
    if (atkTarget) {
      // Populate targets (all session characters except this NPC)
      const sessionChars = characters.filter(ch => ch.id !== c.id && ch.is_alive);
      atkTarget.innerHTML = sessionChars.map(ch =>
        `<option value="${ch.id}">${ch.name}${ch.is_npc ? ' (NPC)' : ''} — KD:${ch.armor_class}</option>`
      ).join('');
      if (!sessionChars.length) atkTarget.innerHTML = '<option value="">No targets</option>';

      // Show weapon info; damage dice widget will mount after HIT (step 2)
      let weaponDefaults = { diceCount: c.attack_dice_count || 1, diceType: c.attack_dice_type || 6 };
      let hitAdvMode = 'normal';
      let dmgWidgetState = { diceCount: weaponDefaults.diceCount, diceType: weaponDefaults.diceType, advantageMode: 'normal' };
      let lastHitData = null; // stored after /hit-roll succeeds

      (async () => {
        try {
          const inv = await api.get(`/api/characters/${c.id}/inventory`);
          const mainHand = (inv.items||[]).find(i => i.is_equipped && i.equipped_slot === 'main_hand');
          const wInfo = area.querySelector('#npc-weapon-info');
          if (mainHand && wInfo) {
            wInfo.textContent = `🗡️ ${mainHand.name}`;
            const wst = mainHand.weapon_stats;
            if (wst) {
              weaponDefaults.diceCount = wst.dice_count || weaponDefaults.diceCount;
              weaponDefaults.diceType  = wst.dice_type  || weaponDefaults.diceType;
            }
          } else if (wInfo) {
            wInfo.textContent = `👊 Unarmed (${c.attack_dice_count||1}d${c.attack_dice_type||6})`;
          }
        } catch {}
      })();

      // Hit-mode adv toggle
      area.querySelectorAll('#npc-hit-adv button').forEach(b => {
        b.addEventListener('click', () => {
          area.querySelectorAll('#npc-hit-adv button').forEach(x => x.classList.toggle('active', x === b));
          hitAdvMode = b.dataset.mode;
        });
      });

      // Helper: mount damage dice widget in step 2
      const mountDmgWidget = () => {
        const host = area.querySelector('#npc-atk-widget-host');
        if (!host) return;
        host.innerHTML = '';
        if (typeof createDiceRollWidget === 'function') {
          createDiceRollWidget(host, {
            label: 'Damage Dice',
            defaultDiceCount: dmgWidgetState.diceCount,
            defaultDiceType:  dmgWidgetState.diceType,
            showDiceSelector: true,
            showAdvantage:    true,
            showRollButton:   false,
            onStateChange: (s) => { dmgWidgetState = s; },
          });
        } else {
          host.innerHTML = `
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <label style="font-size:0.72rem;color:var(--text-muted)">Dice:</label>
              <input type="number" id="npc-dmg-count" value="${dmgWidgetState.diceCount}" min="1" max="20" style="width:48px">
              <span>d</span>
              <select id="npc-dmg-type" style="width:60px">
                <option value="4">4</option><option value="6">6</option>
                <option value="8">8</option><option value="10">10</option>
                <option value="12">12</option><option value="20">20</option>
              </select>
              <div class="adv-toggle" id="npc-dmg-adv" style="margin-left:8px">
                <button data-mode="disadvantage">Disadv</button>
                <button data-mode="normal" class="active">Normal</button>
                <button data-mode="advantage">Adv</button>
              </div>
            </div>`;
          host.querySelector('#npc-dmg-type').value = dmgWidgetState.diceType;
          host.querySelector('#npc-dmg-count').addEventListener('input', e => {
            dmgWidgetState.diceCount = parseInt(e.target.value) || 1;
          });
          host.querySelector('#npc-dmg-type').addEventListener('change', e => {
            dmgWidgetState.diceType = parseInt(e.target.value) || 6;
          });
          host.querySelectorAll('#npc-dmg-adv button').forEach(b => {
            b.addEventListener('click', () => {
              host.querySelectorAll('#npc-dmg-adv button').forEach(x => x.classList.toggle('active', x === b));
              dmgWidgetState.advantageMode = b.dataset.mode;
            });
          });
        }
      };

      const resetAttackSteps = () => {
        area.querySelector('#npc-atk-step1').style.display = '';
        area.querySelector('#npc-atk-step2').style.display = 'none';
        const atkBtnEl = area.querySelector('#btn-npc-roll-attack');
        if (atkBtnEl) { atkBtnEl.disabled = false; atkBtnEl.textContent = '🎯 Roll Hit'; }
        lastHitData = null;
      };

      // STEP 1: Roll Hit button
      const atkBtn = area.querySelector('#btn-npc-roll-attack');
      if (atkBtn) {
        atkBtn.addEventListener('click', async () => {
          const targetId = parseInt(atkTarget.value);
          if (!targetId) { showToast('Select a target'); return; }
          const resultDiv = area.querySelector('#npc-atk-result');
          atkBtn.disabled = true;
          resultDiv.innerHTML = '<span style="color:var(--text-muted)">Rolling d20...</span>';
          try {
            const res = await api.post('/api/combat/hit-roll', {
              attacker_id: c.id, target_id: targetId,
              advantage: hitAdvMode,
            });
            lastHitData = { ...res, target_id: targetId };
            let html = '';
            if (res.hit) {
              html += `<div style="color:var(--accent-green);font-weight:700">${res.critical ? '🎯 CRITICAL HIT!' : '⚔️ HIT!'}</div>`;
            } else {
              html += `<div style="color:var(--text-muted);font-weight:700">${res.fumble ? '💨 FUMBLE!' : '🛡️ MISS'}</div>`;
            }
            html += `<div style="font-size:0.75rem">${res.hit_breakdown}</div>`;
            resultDiv.innerHTML = html;
            addLog('gm.combat', `${c.name} → ${res.target_name}: ${res.hit ? (res.critical ? 'CRIT' : 'HIT') : 'MISS'}`);

            // Broadcast hit result
            if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
              ws.ws.send(JSON.stringify({
                type: 'combat.hit_result',
                attacker_id: c.id, attacker_name: c.name,
                target_id: targetId, target_name: res.target_name,
                hit: res.hit, critical: res.critical, fumble: res.fumble,
                hit_breakdown: res.hit_breakdown,
              }));
            }

            if (res.hit) {
              if (res.pending_defense_id) {
                // Defense reaction: pause flow, show waiting indicator
                resultDiv.innerHTML += '<div style="margin-top:4px;color:var(--accent)">⏳ Waiting for target defense...</div>';
              } else {
                // Show step 2 — use server-suggested dice defaults (reflects equipped weapon)
                dmgWidgetState.diceCount = res.default_dice_count || weaponDefaults.diceCount;
                dmgWidgetState.diceType  = res.default_dice_type  || weaponDefaults.diceType;
                dmgWidgetState.advantageMode = 'normal';
                area.querySelector('#npc-atk-step1').style.display = 'none';
                area.querySelector('#npc-atk-step2').style.display = '';
                mountDmgWidget();
              }
            } else {
              atkBtn.disabled = false;
              atkBtn.textContent = '🎯 Re-roll Hit';
            }
          } catch (e) {
            atkBtn.disabled = false;
            resultDiv.innerHTML = `<span style="color:var(--accent-red)">${e?.body?.detail || 'Hit roll failed'}</span>`;
          }
        });
      }

      // STEP 2: Roll Damage button
      const dmgBtn = area.querySelector('#btn-npc-roll-damage');
      if (dmgBtn) {
        dmgBtn.addEventListener('click', async () => {
          if (!lastHitData || !lastHitData.hit) return;
          const targetId = lastHitData.target_id;
          const resultDiv = area.querySelector('#npc-atk-result');
          dmgBtn.disabled = true;
          try {
            const res = await api.post('/api/combat/damage-roll', {
              attacker_id: c.id, target_id: targetId,
              critical: !!lastHitData.critical,
              dice_count: dmgWidgetState.diceCount,
              dice_type:  dmgWidgetState.diceType,
              advantage:  dmgWidgetState.advantageMode || 'normal',
            });
            let html = '';
            if (lastHitData.critical) {
              html += `<div style="color:var(--accent-green);font-weight:700">🎯 CRITICAL HIT!</div>`;
            } else {
              html += `<div style="color:var(--accent-green);font-weight:700">⚔️ HIT!</div>`;
            }
            html += `<div style="font-size:0.75rem">${lastHitData.hit_breakdown}</div>`;
            html += `<div style="font-size:0.75rem;margin-top:3px">${res.damage_breakdown}</div>`;
            html += `<div style="font-size:0.75rem">${res.intake_breakdown}</div>`;
            html += `<div style="font-weight:600;margin-top:3px">${res.target_name}: <span style="color:var(--accent-red)">${res.final_damage} dmg</span> → ${res.target_hp_after} HP${res.target_downed ? ' 💀 DOWN!' : ''}</div>`;
            resultDiv.innerHTML = html;
            addLog('gm.combat', `${c.name} → ${res.target_name}: ${res.final_damage} dmg${res.target_downed ? ' (DOWN)' : ''}`);

            await refreshChars();
            if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
              ws.ws.send(JSON.stringify({
                type: 'combat.attack_result',
                attacker_id: c.id, attacker_name: c.name,
                target_id: targetId, target_name: res.target_name,
                hit: true, critical: !!lastHitData.critical,
                final_damage: res.final_damage, target_hp_after: res.target_hp_after,
              }));
            }
            // Reset back to step 1 for next attack
            setTimeout(resetAttackSteps, 2000);
          } catch (e) {
            dmgBtn.disabled = false;
            resultDiv.innerHTML += `<div style="color:var(--accent-red)">${e?.body?.detail || 'Damage roll failed'}</div>`;
          }
        });
      }

      // Cancel damage button — go back to step 1
      const cancelDmgBtn = area.querySelector('#btn-npc-cancel-dmg');
      if (cancelDmgBtn) cancelDmgBtn.addEventListener('click', resetAttackSteps);

      // ── NPC Actions wiring ──
      const actResEl = area.querySelector('#npc-action-result');
      const showActRes = (msg, color='var(--text-primary)') => {
        if (actResEl) actResEl.innerHTML = `<span style="color:${color}">${msg}</span>`;
      };

      // Ability
      const abBtn = area.querySelector('#btn-npc-act-ability');
      if (abBtn) abBtn.addEventListener('click', async () => {
        try {
          const abs = await api.get(`/api/characters/${c.id}/abilities`);
          const active = (abs || []).filter(a => a.ability_type !== 'passive');
          if (!active.length) { showActRes('No active abilities assigned.', 'var(--text-muted)'); return; }
          openNpcPickerModal('✨ Use Ability', active.map(a => ({
            id: a.character_ability_id,
            label: `${a.icon||'✨'} ${a.name}`,
            sub: (a.description || '') + (a.cooldown_remaining ? ` · ⏳ CD ${a.cooldown_remaining}` : ''),
            onPick: async () => {
              try {
                const res = await api.post(`/api/character-abilities/${a.character_ability_id}/use`, {});
                const msg = (res.results || []).join(' · ') || 'Ability used';
                showActRes(`✅ ${a.name}: ${msg}`, 'var(--accent-green)');
                addLog('gm.ability', `${c.name} used ${a.name}`);
                refreshChars();
              } catch(e) {
                let m='Ability failed'; try{const er=JSON.parse(e.message);m=er.detail?.message||er.detail||m;}catch{}
                showActRes('❌ ' + m, 'var(--accent-red)');
              }
            }
          })));
        } catch (e) { showActRes('❌ Failed to load abilities', 'var(--accent-red)'); }
      });

      // Potion
      const potBtn = area.querySelector('#btn-npc-act-potion');
      if (potBtn) potBtn.addEventListener('click', async () => {
        try {
          const inv = await api.get(`/api/characters/${c.id}/inventory`);
          const potions = (inv.items||[]).filter(i => i.is_potion);
          if (!potions.length) { showActRes('No potions in inventory.', 'var(--text-muted)'); return; }
          openNpcPickerModal('🧪 Use Potion', potions.map(p => ({
            id: p.inventory_id,
            label: `${p.potion_icon||'🧪'} ${p.name}`,
            sub: `x${p.quantity} · ${p.description||''}`,
            onPick: async () => {
              try {
                const res = await api.post(`/api/inventory/${p.inventory_id}/use`, {});
                const msg = res.breakdown || 'used';
                showActRes(`✅ ${p.name}: ${msg}`, 'var(--accent-green)');
                addLog('gm.potion', `${c.name} used ${p.name}`);
                refreshChars();
              } catch(e) {
                let m='Use failed'; try{const er=JSON.parse(e.message);m=er.detail?.message||er.detail||m;}catch{}
                showActRes('❌ ' + m, 'var(--accent-red)');
              }
            }
          })));
        } catch(e) { showActRes('❌ Failed to load potions', 'var(--accent-red)'); }
      });

      // Use Item (any consumable)
      const itBtn = area.querySelector('#btn-npc-act-item');
      if (itBtn) itBtn.addEventListener('click', async () => {
        try {
          const inv = await api.get(`/api/characters/${c.id}/inventory`);
          const usable = (inv.items||[]).filter(i => i.consumable || i.is_potion);
          if (!usable.length) { showActRes('No usable items in inventory.', 'var(--text-muted)'); return; }
          openNpcPickerModal('🎒 Use Item', usable.map(it => ({
            id: it.inventory_id,
            label: `${it.is_potion ? (it.potion_icon||'🧪') : '📦'} ${it.name}`,
            sub: `x${it.quantity} · ${it.description||''}`,
            onPick: async () => {
              try {
                const res = await api.post(`/api/inventory/${it.inventory_id}/use`, {});
                const msg = res.breakdown || 'used';
                showActRes(`✅ ${it.name}: ${msg}`, 'var(--accent-green)');
                addLog('gm.item', `${c.name} used ${it.name}`);
                refreshChars();
              } catch(e) {
                let m='Use failed'; try{const er=JSON.parse(e.message);m=er.detail?.message||er.detail||m;}catch{}
                showActRes('❌ ' + m, 'var(--accent-red)');
              }
            }
          })));
        } catch(e) { showActRes('❌ Failed to load inventory', 'var(--accent-red)'); }
      });

      // Quick Heal (full)
      const healBtn = area.querySelector('#btn-npc-act-heal');
      if (healBtn) healBtn.addEventListener('click', async () => {
        try {
          await api.put(`/api/characters/${c.id}`, { current_hp: c.max_hp, is_alive: true });
          showActRes(`✅ ${c.name} fully healed (${c.max_hp} HP)`, 'var(--accent-green)');
          addLog('gm.heal', `${c.name} fully healed by GM`);
          // Broadcast HP change so player UIs update
          if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
            ws.ws.send(JSON.stringify({
              type: 'character.hp_changed',
              character_id: c.id,
              current_hp: c.max_hp,
              max_hp: c.max_hp,
            }));
          }
          refreshChars();
        } catch(e) { showActRes('❌ Heal failed', 'var(--accent-red)'); }
      });
    }

    // Turn counter wiring
    const turnCountEl = area.querySelector('#npc-turn-count');
    const turnInc = area.querySelector('#btn-npc-turn-inc');
    const turnDec = area.querySelector('#btn-npc-turn-dec');
    const turnReset = area.querySelector('#btn-npc-turn-reset');
    if (turnInc) {
      const updateTurn = async (val) => {
        await api.put(`/api/characters/${c.id}`, { turn_count: Math.max(0, val) });
        if (turnCountEl) turnCountEl.textContent = Math.max(0, val);
        c.turn_count = Math.max(0, val);
      };
      turnInc.addEventListener('click', () => updateTurn((c.turn_count||0) + 1));
      turnDec.addEventListener('click', () => updateTurn((c.turn_count||0) - 1));
      turnReset.addEventListener('click', () => updateTurn(0));
    }

    // Broadcast rolls toggle wiring
    const broadcastChk = area.querySelector('#npc-broadcast-rolls');
    if (broadcastChk) {
      // Store on element for roll handler to read
      broadcastChk.__npcBroadcast = true;
    }
  }

  // Phase 6 / FIX 1: Place at Table / Show HP toggles — use dedicated endpoint
  // (server broadcasts `table.updated` to all session clients)
  const placeChk = area.querySelector('#npc-place-table');
  if (placeChk) {
    placeChk.addEventListener('change', async () => {
      try {
        await api.patch(`/api/characters/${c.id}/table-visibility`,
                        { is_at_table: placeChk.checked });
        addLog('gm.npc', `${c.name}: Place at Table = ${placeChk.checked}`);
      } catch (e) { showToast('Failed to update table visibility'); }
    });
  }
const showHpChk = area.querySelector('#npc-show-hp');
if (showHpChk) {
    showHpChk.addEventListener('change', async () => {
      try {
        await api.patch(`/api/characters/${c.id}/table-visibility`, { show_hp_to_players: showHpChk.checked });
        addLog('gm.npc', `${c.name}: Show HP = ${showHpChk.checked}`);
      } catch (e) { showToast('Failed to update HP visibility'); }
    });
  }

  // Player character: Place at Table / Show HP toggles
  const playerPlaceChk = area.querySelector('#player-place-table');
  if (playerPlaceChk) {
    playerPlaceChk.addEventListener('change', async () => {
      try {
        await api.patch(`/api/characters/${c.id}/table-visibility`, { place_at_table: playerPlaceChk.checked });
        c.place_at_table = playerPlaceChk.checked;
        if (playerPlaceChk.checked) {
          const tokenOnMap = mapCanvas?.tokens?.find(t => t.character_id === c.id);
          const hasCoords = tokenOnMap && tokenOnMap.x != null && tokenOnMap.y != null;
          if (!hasCoords) {
            try {
              await api.patch(`/api/map/token/${c.id}`, { x: 0.5, y: 0.5 });
              if (mapCanvas) mapCanvas.setTokens(mapCanvas.tokens.map(t => t.character_id === c.id ? { ...t, x: 0.5, y: 0.5 } : t));
            } catch (mapErr) { console.warn('Auto-place token failed', mapErr); }
          }
        }
        renderPartyList();
        showToast(`${c.name}: ${playerPlaceChk.checked ? 'placed on map' : 'removed from map'}`);
      } catch (e) { showToast('Failed to update table visibility'); }
    });
  }
  const playerShowHpChk = area.querySelector('#player-show-hp');
  if (playerShowHpChk) {
    playerShowHpChk.addEventListener('change', async () => {
      try {
        await api.patch(`/api/characters/${c.id}/table-visibility`, { show_hp_to_players: playerShowHpChk.checked });
        c.show_hp_to_players = playerShowHpChk.checked;
        renderPartyList();
        showToast(`${c.name}: HP ${playerShowHpChk.checked ? 'visible' : 'hidden'}`);
      } catch (e) { showToast('Failed to update HP visibility'); }
    });
  }

  // Phase 7: Ability assign + enhanced list
  const abList = area.querySelector('#npc-abilities-list');
  if (abList) {
    try {
      const cas = await api.get(`/api/characters/${c.id}/abilities`);
      if (cas.length) {
        abList.innerHTML = cas.map(a => {
          const onCd = a.cooldown_remaining > 0;
          const typeBadge = a.ability_type === 'passive' ? '<span style="font-size:0.6rem;background:#3b82f620;color:#60a5fa;padding:1px 5px;border-radius:8px">passive</span>' :
            a.ability_type === 'reaction' ? '<span style="font-size:0.6rem;background:#f59e0b20;color:#f59e0b;padding:1px 5px;border-radius:8px">reaction</span>' : '';
          const costParts = [];
          if (a.mana_cost) costParts.push(`🔮${a.mana_cost}`);
          if (a.hp_cost) costParts.push(`❤️${a.hp_cost}`);
          return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;padding:4px 8px;border-left:3px solid ${a.color||'#60a5fa'};background:var(--bg-surface-2);border-radius:var(--r-sm);${onCd?'opacity:0.5':''}">
            <span style="font-weight:600;font-size:0.78rem">${a.icon||'⚡'} ${a.name}</span>
            ${typeBadge}
            ${costParts.length ? `<span style="font-size:0.65rem;color:var(--text-muted)">${costParts.join(' ')}</span>` : ''}
            ${onCd ? `<span style="color:var(--accent-orange);font-size:0.65rem">⏳${a.cooldown_remaining}t</span>` : ''}
            ${a.cooldown_turns && !onCd ? `<span style="font-size:0.6rem;color:var(--text-muted)">CD:${a.cooldown_turns}t</span>` : ''}
            <span style="margin-left:auto;display:flex;gap:3px">
              ${a.ability_type !== 'passive' && !onCd ? `<button class="btn btn-primary btn-xs" data-use-ca="${a.character_ability_id}" data-use-name="${a.name}" style="font-size:0.6rem;padding:1px 6px">Use</button>` : ''}
              <button class="btn btn-ghost btn-xs" data-rm-ca="${a.character_ability_id}" style="color:var(--accent-red);font-size:0.65rem">✕</button>
            </span>
          </div>`;
        }).join('');
        abList.querySelectorAll('[data-rm-ca]').forEach(btn => {
          btn.addEventListener('click', async () => {
            await api.del(`/api/character-abilities/${btn.dataset.rmCa}`);
            renderCharDetail();
          });
        });
        abList.querySelectorAll('[data-use-ca]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const caId = btn.dataset.useCa;
            const abName = btn.dataset.useName;
            try {
              const res = await api.post(`/api/character-abilities/${caId}/use`, {});
              if (res.results) res.results.forEach(r => addLog('gm.ability', `${c.name} → ${abName}: ${r}`));
              await refreshChars();
              renderCharDetail();
            } catch (e) {
              const d = e?.body?.detail;
              showToast(typeof d === 'object' ? d.message : String(d || 'Failed'), 'error');
            }
          });
        });
      } else {
        abList.innerHTML = '<span class="text-muted">No abilities assigned</span>';
      }
    } catch { abList.innerHTML = '<span class="text-muted">—</span>'; }
  }
  const assignBtn = area.querySelector('#btn-assign-ability');
  if (assignBtn) {
    assignBtn.addEventListener('click', async () => {
      try {
        const all = await api.get(`/api/abilities?session_id=${SESSION_ID}`);
        if (!all.length) { showToast('No abilities created yet. Create one in GM Tools.'); return; }
        const names = all.map((a, i) => `${i+1}. ${a.name} (🔮${a.mana_cost})`).join('\n');
        const pick = prompt(`Assign ability:\n${names}\nEnter number:`);
        if (!pick) return;
        const ab = all[parseInt(pick) - 1];
        if (!ab) return;
        await api.post(`/api/characters/${c.id}/abilities`, { ability_id: ab.id });
        renderCharDetail();
        addLog('gm.ability', `Assigned ${ab.name} to ${c.name}`);
      } catch (e) { showToast(e?.body?.detail || 'Failed'); }
    });
  }

  // Characteristic Roll
  bindAdvToggle(area, 'gm_char_roll');
  $('#btn-gm-roll-char').addEventListener('click', async () => {
    const stat = $('#gm-roll-stat').value;
    const rollType = $('#gm-roll-type').value;
    try {
      const res = await api.post(`/api/characters/${c.id}/roll-characteristic`, {
        stat, roll_type: rollType, advantage_mode: getAdvMode('gm_char_roll'),
      });
      let advTag = '';
      if (res.advantage_mode === 'advantage') advTag = ' <span class="adv-badge advantage">ADV</span>';
      else if (res.advantage_mode === 'disadvantage') advTag = ' <span class="adv-badge disadvantage">DISADV</span>';
      $('#gm-roll-result').innerHTML = `<span style="color:var(--accent)">${res.description}</span>${advTag}`;
      addLog('gm.roll', res.description);
      addRollLogEntry(res);
      lastGmRollTime = Date.now();
      // Broadcast via WS (respect NPC broadcast toggle)
      const shouldBroadcast = c.is_npc ? (area.querySelector('#npc-broadcast-rolls')?.checked || false) : true;
      if (shouldBroadcast && ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({ type: 'roll.characteristic', ...res }));
      }
    } catch (e) {
      $('#gm-roll-result').textContent = 'Roll failed';
    }
  });

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
    $('#gm-dmg-result').innerHTML = text + (res.breakdown ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px">${res.breakdown}</div>` : '');
    addLog('gm.damage', `${c.name}: ${res.breakdown || `${er} vs KD${c.armor_class} → ${res.final_damage} dmg`}`);
  });

  // ── Detail Timer wiring (player only) ──
  if (!c.is_npc) {
    const startBtn = area.querySelector('#btn-gm-detail-timer-start');
    const pauseBtn = area.querySelector('#btn-gm-detail-timer-pause');
    const resumeBtn = area.querySelector('#btn-gm-detail-timer-resume');
    const stopBtn = area.querySelector('#btn-gm-detail-timer-stop');
    const timerDisplay = area.querySelector('#gm-detail-timer-display');
    const timerInput = area.querySelector('#gm-detail-timer-min');

    startBtn.addEventListener('click', () => {
      const mins = parseFloat(timerInput.value) || 2;
      const secs = Math.round(mins * 60);
      startDetailTimer(c.id, secs);
      sendPlayerTimer(c.id, secs);
    });
    pauseBtn.addEventListener('click', () => pauseDetailTimer());
    resumeBtn.addEventListener('click', () => resumeDetailTimer());
    stopBtn.addEventListener('click', () => {
      stopDetailTimer();
      sendPlayerTimerStop(c.id);
    });
    restoreDetailTimer();

    // Load race/class names
    if (c.race_id) {
      api.get(`/api/races-classes/races/${c.race_id}`).then(r => {
        const el = area.querySelector('#gm-char-race');
        if (el) el.innerHTML = `Race: <strong>${r.name}</strong>`;
      }).catch(() => {});
    }
    // Rework v2: Character.class_id is gone; professions panel handles this.

    // XP/Level edit
    const xpBtn = area.querySelector('#btn-edit-xp');
    if (xpBtn) {
      xpBtn.addEventListener('click', async () => {
        const newXp = prompt('Set experience:', c.experience || 0);
        if (newXp === null) return;
        const newLvl = prompt('Set level:', c.level ?? 0);
        if (newLvl === null) return;
        await api.patch(`/api/characters/${c.id}`, { experience: parseInt(newXp)||0, level: parseInt(newLvl)||0 });
        await refreshChars();
        renderCharDetail();
      });
    }

    // Rework Phase 8: Grant XP
    const grantBtn = area.querySelector('#btn-grant-xp');
    if (grantBtn) {
      grantBtn.addEventListener('click', async () => {
        const amt = prompt('Grant how much XP?', '50');
        if (amt === null) return;
        try {
          const res = await api.post(`/api/characters/${c.id}/grant-xp`, { amount: parseInt(amt, 10) || 0 });
          addLog('gm.xp', `${c.name}: +${amt} XP → ${res.experience}/${res.xp_to_next}`);
          await refreshChars();
          renderCharDetail();
        } catch (e) { showToast('Failed to grant XP'); }
      });
    }
    // Rework Phase 8: Level up
    const lvlUpBtn = area.querySelector('#btn-level-up');
    if (lvlUpBtn) {
      lvlUpBtn.addEventListener('click', async () => {
        try {
          const res = await api.post(`/api/characters/${c.id}/level-up`, {});
          addLog('gm.lvl', `${c.name} → Lvl ${res.level}`);
          await refreshChars();
          renderCharDetail();
        } catch (e) {
          let msg = 'Level up failed';
          try { const err = JSON.parse(e.message); msg = err.detail?.message || err.detail || msg; } catch {}
          if (!confirm(`${msg}. Force level-up anyway?`)) return;
          try {
            const res = await api.post(`/api/characters/${c.id}/level-up`, { force: true });
            addLog('gm.lvl', `${c.name} → Lvl ${res.level} (forced)`);
            await refreshChars();
            renderCharDetail();
          } catch { showToast('Level up failed'); }
        }
      });
    }
    // Rework Phase 8: Rank up
    const rankBtn = area.querySelector('#btn-rank-up');
    if (rankBtn) {
      rankBtn.addEventListener('click', async () => {
        if (!confirm(`Promote ${c.name} to the next rank?`)) return;
        try {
          const res = await api.post(`/api/characters/${c.id}/rank-up`, {});
          addLog('gm.rank', `${c.name} → Rank ${res.rank} (Lvl ${res.level})`);
          await refreshChars();
          renderCharDetail();
        } catch (e) {
          let msg = 'Rank up failed';
          try { const err = JSON.parse(e.message); msg = err.detail || msg; } catch {}
          showToast(msg);
        }
      });
    }
  }

  // ── Status Effects wiring ──
  loadStatusBadges(c.id);
  $('#btn-gm-add-status').addEventListener('click', () => openAddStatusModal(c.id, c.name));
  $('#btn-gm-status-library').addEventListener('click', () => openStatusLibraryModal());

  // ── Force Advantage toggle wiring ──
  (async () => {
    // Detect current forced adv/disadv from status penalties
    try {
      const pen = await api.get(`/api/characters/${c.id}/status-penalties`);
      let curMode = 'normal';
      if (pen.forced_advantage) curMode = 'advantage';
      else if (pen.forced_disadvantage) curMode = 'disadvantage';
      const btns = area.querySelectorAll('#gm-force-adv-toggle button');
      btns.forEach(b => b.classList.toggle('active', b.dataset.mode === curMode));
    } catch {}
  })();
  area.querySelectorAll('#gm-force-adv-toggle button').forEach(b => {
    b.addEventListener('click', async () => {
      const mode = b.dataset.mode;
      try {
        await api.post(`/api/characters/${c.id}/set-advantage`, { mode });
        area.querySelectorAll('#gm-force-adv-toggle button').forEach(x => x.classList.toggle('active', x === b));
        loadStatusBadges(c.id);
        addLog('gm.status', `Set ${c.name} → ${mode === 'normal' ? 'Normal' : mode.toUpperCase()}`);
        if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
          ws.ws.send(JSON.stringify({ type: 'status_effect.applied', character_id: c.id, name: `Forced ${mode}` }));
        }
      } catch (e) {
        showToast('Failed: ' + e.message);
      }
    });
  });

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
      parts.push(`<span style="color:#b87333">${d.bronze}B</span>`);
      $('#gm-currency-display').innerHTML = parts.join(' ') + ` <span style="font-size:0.7rem;color:var(--text-muted)">(${cur.total_bronze}b)</span>`;
    } catch {}
  })();

  // Give currency
  $('#btn-gm-give-currency').addEventListener('click', async () => {
    const p = parseInt($('#gm-give-plat').value) || 0;
    const g = parseInt($('#gm-give-gold').value) || 0;
    const s = parseInt($('#gm-give-silver').value) || 0;
    const co = parseInt($('#gm-give-bronze').value) || 0;
    if (!p && !g && !s && !co) return;
    await api.post(`/api/characters/${c.id}/give-gold`, { platinum: p, gold: g, silver: s, bronze: co });
    await refreshChars();
    addLog('gm.gold', `Gave ${c.name}: ${p}P ${g}G ${s}S ${co}B`);
  });

  // Take currency (negative give)
  $('#btn-gm-take-currency').addEventListener('click', async () => {
    const p = parseInt($('#gm-give-plat').value) || 0;
    const g = parseInt($('#gm-give-gold').value) || 0;
    const s = parseInt($('#gm-give-silver').value) || 0;
    const co = parseInt($('#gm-give-bronze').value) || 0;
    if (!p && !g && !s && !co) return;
    await api.post(`/api/characters/${c.id}/give-gold`, { platinum: -p, gold: -g, silver: -s, bronze: -co, note: 'GM deduction' });
    await refreshChars();
    addLog('gm.gold', `Took from ${c.name}: ${p}P ${g}G ${s}S ${co}B`);
  });

  // Set total bronze
  $('#btn-gm-set-gold').addEventListener('click', async () => {
    const v = parseInt($('#gm-wealth-bronze').value) || 0;
    await api.put(`/api/characters/${c.id}`, { wealth_bronze: v });
    await refreshChars();
    addLog('gm.gold', `${c.name}: wealth_bronze = ${v}`);
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

  // Load notes (Stage 10)
  loadCharNotes(c.id);
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
    // Rework Phase 3: split items into Bag (non-equipped) and Equipped sections.
    const renderRow = (i) => {
      const eq = i.is_equipped ? '✅' : '';
      const slotLbl = i.equipped_slot ? ` [${i.equipped_slot}]` : '';
      const bonusesStr = (i.bonuses||[]).map(b => b.bonus_type === 'stat_bonus' ? `${b.stat_name}+${b.value}` : `${b.bonus_type.replace(/_/g,' ')}+${b.value}`).join(', ');
      const isPotion = i.is_potion;
      const isConsumable = i.consumable;
      const showEquip = i.equippable && !isPotion;
      const showUse = isConsumable || isPotion;
      const icon = isPotion ? (i.potion_icon || '🧪') : '';
      const isWeapon = !!i.weapon_stats;
      return `<div class="mod-row" style="gap:6px">
        <span style="min-width:18px">${eq}${icon}</span>
        <span class="rarity-${i.rarity}" style="flex:1;font-weight:600">${i.name}</span>
        <span style="font-size:0.7rem;color:var(--text-muted)">x${i.quantity}${slotLbl}</span>
        ${bonusesStr ? `<span style="font-size:0.65rem;color:var(--accent-green)">${bonusesStr}</span>` : ''}
        ${showEquip ? `<button class="btn btn-ghost btn-xs" data-gm-equip="${i.inventory_id}" data-gm-equipped="${i.is_equipped}">${i.is_equipped ? 'Unequip' : 'Equip'}</button>` : ''}
        ${showUse ? `<button class="btn btn-primary btn-xs" data-gm-use="${i.inventory_id}" data-gm-use-name="${i.name}" title="Use on this character">${isPotion ? '🧪 Use' : 'Use'}</button>` : ''}
        ${isWeapon ? `<button class="btn btn-ghost btn-xs" data-gm-poison="${i.inventory_id}" title="Apply poison">💧</button>` : ''}
        <button class="btn btn-ghost btn-xs" data-gm-buyback="${i.inventory_id}" data-gm-buyback-price="${i.base_price_bronze||i.base_price_copper||0}" data-gm-buyback-name="${i.name}" title="Buy from player">💰</button>
        <button class="btn-icon danger" data-gm-remove-inv="${i.inventory_id}" title="Remove">🗑</button>
      </div>`;
    };
    const equipped = data.items.filter(i => i.is_equipped);
    const bag = data.items.filter(i => !i.is_equipped);
    const section = (title, count, rows, weight) => `
      <div class="inv-section" style="margin-bottom:8px">
        <div style="font-size:0.75rem;font-weight:600;color:var(--text-muted);margin-bottom:4px;display:flex;gap:8px;align-items:center">
          <span>${title} <span class="chip-muted">${count}</span></span>
          ${weight != null ? `<span style="margin-left:auto;font-weight:400">wt ${weight}</span>` : ''}
        </div>
        ${rows.length ? rows.join('') : '<span class="text-muted" style="font-size:0.75rem">— empty —</span>'}
      </div>`;
    container.innerHTML =
      section('⚔️ Equipped', equipped.length, equipped.map(renderRow), null) +
      section('🎒 Bag',      bag.length,      bag.map(renderRow),      data.total_weight_bag ?? data.total_weight);

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
    // Use consumable/potion (GM applies effect to the character)
    container.querySelectorAll('[data-gm-use]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const invId = btn.dataset.gmUse;
        const itemName = btn.dataset.gmUseName;
        if (!confirm(`Use "${itemName}" on this character?`)) return;
        try {
          const res = await api.post(`/api/inventory/${invId}/use`, {});
          const breakdown = res.breakdown || res.results?.join('; ') || 'applied';
          addLog('inventory.use', `${itemName} used → ${breakdown}`);
          showToast(`✅ ${itemName} used: ${breakdown}`);
          loadGmCharInventory(charId);
          // Refresh char detail to show new HP/mana
          if (selectedCharId === charId) renderCharDetail();
        } catch (e) {
          let msg = 'Use failed';
          try { const err = JSON.parse(e.message); msg = err.detail?.message || err.detail || msg; } catch {}
          showToast('❌ ' + msg);
        }
      });
    });
    // Buyback
    container.querySelectorAll('[data-gm-buyback]').forEach(btn => {
      btn.addEventListener('click', () => {
        const invId = parseInt(btn.dataset.gmBuyback);
        const basePrice = parseInt(btn.dataset.gmBuybackPrice) || 0;
        const itemName = btn.dataset.gmBuybackName;
        openGmBuybackModal(invId, itemName, basePrice, charId);
      });
    });
    // Rework Phase 5: Apply poison (GM)
    container.querySelectorAll('[data-gm-poison]').forEach(btn => {
      btn.addEventListener('click', () => openGmApplyPoisonModal(btn.dataset.gmPoison, charId));
    });
  } catch(e) { container.innerHTML = '<span class="text-muted">Error loading inventory.</span>'; }
}

// Rework Phase 5: GM-side poison application (mirrors player flow).
async function openGmApplyPoisonModal(inventoryId, charId) {
  let poisons = [];
  try { poisons = await api.get('/api/poison-templates'); } catch {}
  if (!poisons.length) {
    if (!confirm('No poisons yet. Create a sample poison now?')) return;
    try {
      await api.post('/api/poison-templates', {
        name: 'Basic Poison', damage_dice_count: 1, damage_dice_type: 4,
        damage_type: 'poison', default_charges: 3, default_turns_per_hit: 3,
      });
      poisons = await api.get('/api/poison-templates');
    } catch { showToast('Failed to create default poison'); return; }
  }
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
        <button class="btn btn-ghost btn-xs" id="gm-poison-remove" style="margin-left:6px">Remove</button>
      </div>` : ''}
      <label style="font-size:0.78rem">Poison</label>
      <select id="gm-poison-tpl" style="width:100%;margin-bottom:8px">
        ${poisons.map(p => `<option value="${p.id}">${p.icon} ${p.name} — ${p.damage_dice_count}d${p.damage_dice_type} ${p.damage_type}</option>`).join('')}
      </select>
      <div style="display:flex;gap:8px">
        <div style="flex:1">
          <label style="font-size:0.75rem">Charges</label>
          <input type="number" id="gm-poison-charges" min="1" max="50" value="${poisons[0].default_charges}" style="width:100%">
        </div>
        <div style="flex:1">
          <label style="font-size:0.75rem">Turns/hit</label>
          <input type="number" id="gm-poison-turns" min="1" max="20" value="${poisons[0].default_turns_per_hit}" style="width:100%">
        </div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" id="gm-poison-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="gm-poison-apply">Apply</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const sel = overlay.querySelector('#gm-poison-tpl');
  sel.addEventListener('change', () => {
    const p = poisons.find(x => x.id === parseInt(sel.value, 10));
    if (p) {
      overlay.querySelector('#gm-poison-charges').value = p.default_charges;
      overlay.querySelector('#gm-poison-turns').value = p.default_turns_per_hit;
    }
  });
  overlay.querySelector('#gm-poison-cancel').addEventListener('click', () => overlay.remove());
  const rm = overlay.querySelector('#gm-poison-remove');
  if (rm) rm.addEventListener('click', async () => {
    try { await api.del(`/api/inventory/${inventoryId}/apply-poison`); overlay.remove(); loadGmCharInventory(charId); addLog('gm.poison','Poison removed'); }
    catch { showToast('Failed to remove poison'); }
  });
  overlay.querySelector('#gm-poison-apply').addEventListener('click', async () => {
    const poison_template_id = parseInt(sel.value, 10);
    const charges = parseInt(overlay.querySelector('#gm-poison-charges').value, 10);
    const turns_per_hit = parseInt(overlay.querySelector('#gm-poison-turns').value, 10);
    try {
      await api.post(`/api/inventory/${inventoryId}/apply-poison`, { poison_template_id, charges, turns_per_hit });
      addLog('gm.poison', `Coated weapon with poison (${charges}x charges, ${turns_per_hit} turns/hit)`);
      overlay.remove();
      loadGmCharInventory(charId);
    } catch (e) { showToast(e?.message || 'Failed to apply poison'); }
  });
}

// ══════════════════════════════════════════════════════════════
// Rework Phase 4: GM Professions management
// ══════════════════════════════════════════════════════════════
async function loadGmCharProfessions(charId) {
  const container = document.querySelector('#gm-char-professions');
  if (!container) return;
  try {
    const list = await api.get(`/api/characters/${charId}/professions`);
    if (!list || !list.length) {
      container.innerHTML = '<span class="text-muted" style="font-size:0.78rem">No professions assigned.</span>';
      return;
    }
    container.innerHTML = list.map(p => {
      const bonuses = (p.bonuses||[]).map(b => {
        if (b.type === 'stat_bonus') return `${(b.stat||'').slice(0,3).toUpperCase()}+${b.value}`;
        return `${(b.type||'').replace(/_/g,' ')}+${b.value||0}`;
      }).join(' · ');
      return `<div class="mod-row" style="gap:6px;align-items:center">
        <span style="flex:1;font-weight:600">${p.name || 'Profession'}</span>
        <span style="font-size:0.7rem;color:var(--text-muted)">L ${p.level}/5</span>
        ${bonuses ? `<span style="font-size:0.65rem;color:var(--accent-green)">${bonuses}</span>` : ''}
        <input type="number" min="1" max="5" value="${p.level}" data-prof-level="${p.id}" style="width:48px;font-size:0.75rem">
        <button class="btn btn-ghost btn-xs" data-prof-save="${p.id}">Save</button>
        <button class="btn-icon danger" data-prof-delete="${p.id}" title="Remove">🗑</button>
      </div>`;
    }).join('');

    container.querySelectorAll('[data-prof-save]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cpId = btn.dataset.profSave;
        const lvlInput = container.querySelector(`[data-prof-level="${cpId}"]`);
        const level = Math.max(1, Math.min(5, parseInt(lvlInput?.value || '1', 10) || 1));
        try {
          await api.patch(`/api/characters/${charId}/professions/${cpId}`, { level });
          addLog('gm.prof', `Set profession level → ${level}`);
          loadGmCharProfessions(charId);
        } catch (e) { showToast('Failed to update profession'); }
      });
    });
    container.querySelectorAll('[data-prof-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cpId = btn.dataset.profDelete;
        if (!confirm('Remove this profession?')) return;
        try {
          await api.del(`/api/characters/${charId}/professions/${cpId}`);
          addLog('gm.prof', `Removed profession`);
          loadGmCharProfessions(charId);
        } catch (e) { showToast('Failed to remove profession'); }
      });
    });
  } catch (e) {
    container.innerHTML = '<span class="text-muted" style="font-size:0.78rem">Error loading professions.</span>';
  }
}

async function openGmAddProfessionModal(charId) {
  let classes = [];
  try { classes = await api.get('/api/races-classes/classes'); } catch { classes = []; }
  if (!classes.length) { showToast('No classes defined. Seed them first.'); return; }

  // Filter out classes the char already has
  let assigned = [];
  try { assigned = await api.get(`/api/characters/${charId}/professions`); } catch {}
  const taken = new Set((assigned||[]).map(p => p.class_id));
  const available = classes.filter(c => !taken.has(c.id));
  if (!available.length) { showToast('All available professions already assigned.'); return; }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:360px">
      <h3 style="margin-top:0">🛡️ Add Profession</h3>
      <label style="font-size:0.78rem">Class</label>
      <select id="gm-prof-new-class" style="width:100%;margin-bottom:8px">
        ${available.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
      </select>
      <label style="font-size:0.78rem">Starting Level</label>
      <input type="number" id="gm-prof-new-level" value="1" min="1" max="5" style="width:100%;margin-bottom:12px">
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" id="gm-prof-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="gm-prof-confirm">Add</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#gm-prof-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#gm-prof-confirm').addEventListener('click', async () => {
    const class_id = parseInt(overlay.querySelector('#gm-prof-new-class').value, 10);
    const level = Math.max(1, Math.min(5, parseInt(overlay.querySelector('#gm-prof-new-level').value, 10) || 1));
    try {
      await api.post(`/api/characters/${charId}/professions`, { class_id, level });
      addLog('gm.prof', `Added profession (class #${class_id}) L${level}`);
      overlay.remove();
      loadGmCharProfessions(charId);
    } catch (e) {
      showToast(e?.message || 'Failed to add profession');
    }
  });
}

// ── GM Buyback Modal ─────────────────────────────────────────
function openGmBuybackModal(invId, itemName, basePrice, charId) {
  let rem = basePrice;
  const sp = Math.floor(rem / 1000); rem %= 1000;
  const sg = Math.floor(rem / 100); rem %= 100;
  const ss = Math.floor(rem / 10); rem %= 10;
  const sb = rem;

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg);width:85%;max-width:360px;padding:20px">
      <h3 style="margin-bottom:10px">💰 Buy from Player: ${itemName}</h3>
      <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:8px">Base price: ${bronzeToDisplay(basePrice)}</p>
      <p style="font-size:0.75rem;margin-bottom:6px">Set buyback price:</p>
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:12px">
        <span style="font-size:0.7rem;color:#e0c97f">P</span><input type="number" id="bb-p" value="${sp}" min="0" style="width:48px;font-size:0.75rem">
        <span style="font-size:0.7rem;color:#fbbf24">G</span><input type="number" id="bb-g" value="${sg}" min="0" style="width:48px;font-size:0.75rem">
        <span style="font-size:0.7rem;color:#94a3b8">S</span><input type="number" id="bb-s" value="${ss}" min="0" style="width:48px;font-size:0.75rem">
        <span style="font-size:0.7rem;color:#b87333">B</span><input type="number" id="bb-b" value="${sb}" min="0" style="width:48px;font-size:0.75rem">
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-primary btn-sm" id="bb-confirm">Confirm Buyback</button>
        <button class="btn btn-ghost btn-sm" id="bb-cancel">Cancel</button>
      </div>
      <div id="bb-result" style="margin-top:8px;font-size:0.8rem"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#bb-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#bb-confirm').addEventListener('click', async () => {
    const p = parseInt(overlay.querySelector('#bb-p').value) || 0;
    const g = parseInt(overlay.querySelector('#bb-g').value) || 0;
    const s = parseInt(overlay.querySelector('#bb-s').value) || 0;
    const b = parseInt(overlay.querySelector('#bb-b').value) || 0;
    try {
      const res = await api.post('/api/inventory/gm-buyback', {
        inventory_item_id: invId, platinum: p, gold: g, silver: s, bronze: b
      });
      overlay.querySelector('#bb-result').innerHTML = `<span style="color:var(--accent-green)">Bought ${res.item_name} for ${res.price_display}!</span>`;
      addLog('gm.economy', `GM bought ${res.item_name} from ${res.character_name} for ${res.price_display}`);
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({ type: 'inventory.gm_buyback', character_id: charId, item_name: res.item_name, price_display: res.price_display }));
      }
      setTimeout(() => { overlay.remove(); loadGmCharInventory(charId); }, 800);
    } catch (e) {
      let msg = 'Buyback failed';
      try { const err = JSON.parse(e.message); msg = err.detail?.message || err.detail || msg; } catch {}
      overlay.querySelector('#bb-result').innerHTML = `<span style="color:var(--accent-red)">${msg}</span>`;
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
    const hp = parseInt($('#npc-hp').value) || 0;
    const kd = parseInt($('#npc-kd').value) || 0;
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
    onDrawingSaved: async (data) => {
      try {
        const res = await api.post(`/api/map/${SESSION_CODE}/drawings`, data);
        mapCanvas.drawings.push(res);
        mapCanvas.render();
        addLog('map', `Drawing added: ${data.drawing_type}`);
        if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
          ws.ws.send(JSON.stringify({ type: 'map.drawing_added', drawing: res }));
        }
      } catch { showToast('Failed to save drawing'); }
    },
    onMarkerCreate: (nx, ny) => openMarkerModal(nx, ny),
    onMarkerClick: (marker) => openMarkerModal(marker.x, marker.y, marker),
    onEraseMarker: async (marker) => {
      await api.del(`/api/map/markers/${marker.id}`);
      mapCanvas.markers = mapCanvas.markers.filter(m => m.id !== marker.id);
      mapCanvas.render();
      addLog('map', `Marker deleted: ${marker.label || marker.icon}`);
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({ type: 'map.marker_deleted', marker_id: marker.id }));
      }
    },
    onEraseDrawing: async (drawing) => {
      await api.del(`/api/map/drawings/${drawing.id}`);
      mapCanvas.drawings = mapCanvas.drawings.filter(d => d.id !== drawing.id);
      mapCanvas.render();
      addLog('map', 'Drawing erased');
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({ type: 'map.drawing_deleted', drawing_id: drawing.id }));
      }
    },
    onTokenClick: (token, shiftKey) => {
      // Shift+click on NPC token opens floating control panel
      if (shiftKey && token.is_npc) openNpcControlPanel(token.character_id);
    },
    onTokenRightClick: (token, cx, cy) => openTokenContextMenu(token, cx, cy),
    // Phase 5: wall/object placement. Finishes a drag-to-place
    // rectangle; the server normalises and broadcasts map.objects_updated,
    // which we listen for below to refresh the list.
    onObjectSaved: async (data) => {
      try {
        const res = await api.post(`/api/map/${SESSION_CODE}/objects`, {
          name: data.kind === 'wall' ? 'Wall' : 'Zone',
          kind: data.kind || 'wall',
          x1: data.x1, y1: data.y1, x2: data.x2, y2: data.y2,
          blocks_movement: true,
          blocks_vision: false,
          visible_to_players: true,
        });
        mapCanvas.mapObjects.push(res);
        mapCanvas.render();
        addLog('map', `Wall placed (${data.kind})`);
      } catch { showToast('Failed to place wall'); }
    },
  });
  loadMapState();
}

async function loadMapState() {
  try {
    const state = await api.get(`/api/map/${SESSION_CODE}`);
    initMapCanvas(); // ensure canvas object exists even if tab not yet open
    if (state.has_map) {
      await mapCanvas.loadImage(state.image_url);
      mapCanvas.setGrid(state.grid_size, state.grid_enabled, state.grid_type || 'square');
      mapCanvas.setFog(state.fog_enabled, state.revealed_cells);
    } else {
      // No uploaded image — compute the play-area dimensions from the
      // active floor (if any) in a SINGLE assignment so `_autoFitIfChanged`
      // only fires once per refresh. Setting mapWidth/Height twice in one
      // refresh caused the camera to jump and broke mid-drag selections.
      const tsz  = state.active_floor_tile_size || state.grid_size || 50;
      const cols = state.active_floor_cols || 40;
      const rows = state.active_floor_rows || 30;
      mapCanvas.mapImage  = null;
      mapCanvas.gridSize  = tsz;
      mapCanvas.mapWidth  = cols * tsz;
      mapCanvas.mapHeight = rows * tsz;
      mapCanvas.setGrid(tsz, true, state.active_floor_grid_type || state.grid_type || 'square');
      mapCanvas.setFog(false, []);
      mapCanvas._autoFitIfChanged();
    }
    mapCanvas.setTokens(state.tokens || []);
    // Load overlays
    try {
      const overlays = await api.get(`/api/map/${SESSION_CODE}/overlays`);
      mapCanvas.setDrawings(overlays.drawings);
      mapCanvas.setMarkers(overlays.markers);
      // Phase 5: map objects (walls/zones).
      if (overlays.objects) mapCanvas.setObjects(overlays.objects);
      // Map Builder: traps
      if (overlays.traps) mapCanvas.setTraps(overlays.traps);
    } catch {}
    if (state.active_floor_tiles) {
      mapCanvas.setTiles(state.active_floor_tiles, state.active_floor_grid_type || 'square');
    }
    mapGridEnabled = state.grid_enabled;
    mapFogEnabled = state.fog_enabled;
    $('#btn-toggle-grid').textContent = `Grid: ${mapGridEnabled ? 'ON' : 'OFF'}`;
    $('#btn-toggle-fog').textContent = `Fog: ${mapFogEnabled ? 'ON' : 'OFF'}`;
    $('#grid-size-slider').value = state.grid_size;
    $('#grid-size-label').textContent = state.grid_size;
    const styleBtn = $('#btn-grid-style');
    if (styleBtn) {
      const t = state.grid_type || 'square';
      styleBtn.textContent = t === 'hex' ? 'Style: ⬡ Hex' : 'Style: ▢ Square';
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
  // Rework v3 Phase 1: the upload endpoint auto-seeds token positions
  // for any character that had no placement yet, but we still need a
  // full `loadMapState()` so `setTokens` runs — `loadImage` alone
  // doesn't touch the tokens list, which is why the map appeared
  // completely empty right after the first upload.
  await loadMapState();
  addLog('map', `Map uploaded: ${file.name}`);
});
// NOTE: the `ws.on('map.updated', ...)` listener used to live here,
// but `ws` isn't declared until the WEBSOCKET section far below —
// touching it at this point crashed the whole script with a ReferenceError
// (TDZ), which silently disabled every later handler (buttons, tabs,
// table rendering, etc.). The listener is now registered alongside
// all the other `ws.on(...)` calls.

// Remove uploaded map
$('#btn-remove-map')?.addEventListener('click', async () => {
  if (!confirm('Remove the uploaded map image? (Builder floors, tokens and overlays will be kept.)')) return;
  try {
    const res = await fetch(`/api/map/${SESSION_CODE}/upload`, { method: 'DELETE' });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j && j.detail) msg = j.detail; } catch {}
      showToast('Remove failed: ' + msg);
      console.error('Remove map failed', res.status, msg);
      return;
    }
    const data = await res.json();
    if (mapCanvas) {
      mapCanvas.mapImage = null;
      mapCanvas._currentImageUrl = null;
    }
    await loadMapState();
    showToast(data.removed ? '🗑 Map removed' : 'No map to remove');
    addLog('map', 'Map image removed');
  } catch (e) {
    showToast('Remove failed: ' + (e.message || 'unknown'));
    console.error('Remove map exception', e);
  }
});

// Grid toggle
$('#btn-toggle-grid').addEventListener('click', async () => {
  mapGridEnabled = !mapGridEnabled;
  $('#btn-toggle-grid').textContent = `Grid: ${mapGridEnabled ? 'ON' : 'OFF'}`;
  mapCanvas.setGrid(mapCanvas.gridSize, mapGridEnabled, mapCanvas.gridType);
  await api.patch(`/api/map/${SESSION_CODE}/settings`, { grid_enabled: mapGridEnabled });
});

// Grid style toggle (square ↔ hex)
const _gridStyleBtn = $('#btn-grid-style');
if (_gridStyleBtn) {
  _gridStyleBtn.addEventListener('click', async () => {
    const next = (mapCanvas.gridType === 'hex') ? 'square' : 'hex';
    mapCanvas.setGrid(mapCanvas.gridSize, mapGridEnabled, next);
    _gridStyleBtn.textContent = next === 'hex' ? 'Style: ⬡ Hex' : 'Style: ▢ Square';
    try {
      await api.patch(`/api/map/${SESSION_CODE}/settings`, { grid_type: next });
    } catch (e) { console.warn('grid_type save failed', e); }
  });
}

// Grid size slider
$('#grid-size-slider').addEventListener('input', e => {
  const v = parseInt(e.target.value);
  $('#grid-size-label').textContent = v;
  if (mapCanvas) mapCanvas.setGrid(v, mapGridEnabled, mapCanvas.gridType);
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

// ── Stage 9: Drawing Toolbar ──────────────────────────────────
document.querySelectorAll('.map-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.map-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const mode = btn.dataset.mode || null;
    if (mapCanvas) mapCanvas.setDrawMode(mode);
    // If switching to draw mode, turn off fog paint
    if (mode) {
      mapFogPaintActive = false;
      $('#btn-fog-paint').style.background = '';
      $('#btn-fog-paint').style.color = '';
    }
  });
});

$('#draw-color')?.addEventListener('input', e => {
  if (mapCanvas) mapCanvas.drawColor = e.target.value;
});
$('#draw-width')?.addEventListener('input', e => {
  if (mapCanvas) mapCanvas.drawLineWidth = parseInt(e.target.value);
});
$('#draw-visible')?.addEventListener('change', e => {
  if (mapCanvas) mapCanvas.drawVisibleToPlayers = e.target.checked;
});
$('#btn-clear-drawings')?.addEventListener('click', async () => {
  if (!confirm('Clear all drawings from the map?')) return;
  await api.del(`/api/map/${SESSION_CODE}/drawings/all`);
  if (mapCanvas) { mapCanvas.drawings = []; mapCanvas.render(); }
  addLog('map', 'All drawings cleared');
  if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
    ws.ws.send(JSON.stringify({ type: 'map.drawing_deleted', all: true }));
  }
});

// Phase 5: wipe every wall/object in the current session.
$('#btn-clear-objects')?.addEventListener('click', async () => {
  if (!confirm('Clear all walls/objects from the map?')) return;
  await api.del(`/api/map/${SESSION_CODE}/objects/all`);
  if (mapCanvas) { mapCanvas.mapObjects = []; mapCanvas.render(); }
  addLog('map', 'All walls cleared');
});

// ── Marker Create/Edit Modal ──────────────────────────────────
function openMarkerModal(nx, ny, existing = null) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  const icons = ['📌', '⚠️', '🔒', '🏠', '⚔️', '💀', '🏰', '⭐', '🔥', '🌊', '🌲', '💎'];
  modal.innerHTML = `
    <div class="modal" style="width:340px">
      <h2 style="margin-bottom:10px">${existing ? 'Edit Marker' : 'Place Marker'}</h2>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
        ${icons.map(ic => `<button class="btn btn-ghost btn-xs marker-icon-pick" data-icon="${ic}" style="font-size:1.2rem;${(existing?.icon || '📌') === ic ? 'background:var(--accent);color:#0a0908' : ''}">${ic}</button>`).join('')}
      </div>
      <input type="text" id="marker-label" value="${existing?.label || ''}" placeholder="Label" style="width:100%;font-size:0.82rem;margin-bottom:6px">
      <textarea id="marker-desc" placeholder="Description" rows="2" style="width:100%;font-size:0.78rem;margin-bottom:6px">${existing?.description || ''}</textarea>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
        <input type="color" id="marker-color" value="${existing?.color || '#ff0000'}" style="width:30px;height:24px;border:none;cursor:pointer">
        <label style="font-size:0.72rem;display:flex;align-items:center;gap:4px">
          <input type="checkbox" id="marker-visible" ${existing?.visible_to_players ? 'checked' : ''}> Visible to players
        </label>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-primary btn-sm" id="btn-marker-save" style="flex:1">${existing ? 'Update' : 'Place'}</button>
        ${existing ? '<button class="btn btn-danger btn-sm" id="btn-marker-del">Delete</button>' : ''}
        <button class="btn btn-ghost btn-sm" id="btn-marker-close">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  let selectedIcon = existing?.icon || '📌';
  modal.querySelectorAll('.marker-icon-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.querySelectorAll('.marker-icon-pick').forEach(b => { b.style.background = ''; b.style.color = ''; });
      btn.style.background = 'var(--accent)'; btn.style.color = '#0a0908';
      selectedIcon = btn.dataset.icon;
    });
  });

  modal.querySelector('#btn-marker-close').addEventListener('click', () => modal.remove());
  modal.querySelector('#btn-marker-del')?.addEventListener('click', async () => {
    await api.del(`/api/map/markers/${existing.id}`);
    mapCanvas.markers = mapCanvas.markers.filter(m => m.id !== existing.id);
    mapCanvas.render();
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({ type: 'map.marker_deleted', marker_id: existing.id }));
    }
    modal.remove();
  });

  modal.querySelector('#btn-marker-save').addEventListener('click', async () => {
    const payload = {
      x: nx, y: ny,
      label: modal.querySelector('#marker-label').value.trim(),
      description: modal.querySelector('#marker-desc').value.trim(),
      icon: selectedIcon,
      color: modal.querySelector('#marker-color').value,
      visible_to_players: modal.querySelector('#marker-visible').checked,
      marker_type: 'custom',
    };
    try {
      let res;
      if (existing) {
        res = await api.put(`/api/map/markers/${existing.id}`, payload);
        const idx = mapCanvas.markers.findIndex(m => m.id === existing.id);
        if (idx >= 0) mapCanvas.markers[idx] = res;
      } else {
        res = await api.post(`/api/map/${SESSION_CODE}/markers`, payload);
        mapCanvas.markers.push(res);
      }
      mapCanvas.render();
      addLog('map', `Marker ${existing ? 'updated' : 'placed'}: ${res.label || res.icon}`);
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({ type: existing ? 'map.marker_updated' : 'map.marker_added', marker: res }));
      }
      modal.remove();
    } catch { showToast('Failed to save marker'); }
  });
}

// ── Token Right-Click Context Menu ────────────────────────────
function openTokenContextMenu(token, cx, cy) {
  // Remove any existing context menu
  document.querySelectorAll('.token-ctx-menu').forEach(el => el.remove());
  const menu = document.createElement('div');
  menu.className = 'token-ctx-menu';
  menu.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;background:var(--bg-surface-2);border:1px solid var(--border);border-radius:8px;padding:4px 0;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.4);min-width:160px`;
  // Phase 6: portrait upload / clear. Labels flip depending on whether
  // the token already has an image attached.
  const hasPortrait = !!token.token_image_url;
  menu.innerHTML = `
    <div class="ctx-item" data-action="edit" style="padding:6px 14px;font-size:0.78rem;cursor:pointer;display:flex;gap:6px;align-items:center">🎨 Edit Token</div>
    <div class="ctx-item" data-action="portrait" style="padding:6px 14px;font-size:0.78rem;cursor:pointer;display:flex;gap:6px;align-items:center">🖼️ ${hasPortrait ? 'Replace' : 'Upload'} Portrait</div>
    ${hasPortrait ? `<div class="ctx-item" data-action="portrait-clear" style="padding:6px 14px;font-size:0.78rem;cursor:pointer;display:flex;gap:6px;align-items:center">🗑️ Remove Portrait</div>` : ''}
    <div style="height:1px;background:var(--border);margin:2px 0"></div>
    ${token.is_npc ? `<div class="ctx-item" data-action="control-panel" style="padding:6px 14px;font-size:0.78rem;cursor:pointer;display:flex;gap:6px;align-items:center">🎮 Control Panel</div>` : ''}
    <div class="ctx-item" data-action="hide" style="padding:6px 14px;font-size:0.78rem;cursor:pointer;display:flex;gap:6px;align-items:center">${token.visible ? '👁️‍🗨️ Hide' : '👁️ Show'} on Map</div>
    <div class="ctx-item" data-action="remove" style="padding:6px 14px;font-size:0.78rem;cursor:pointer;display:flex;gap:6px;align-items:center">❌ Remove from Map</div>
    <div style="height:1px;background:var(--border);margin:2px 0"></div>
    <div class="ctx-item" data-action="select" style="padding:6px 14px;font-size:0.78rem;cursor:pointer;display:flex;gap:6px;align-items:center">📋 Select Character</div>
  `;
  document.body.appendChild(menu);

  // Hover styling
  menu.querySelectorAll('.ctx-item').forEach(item => {
    item.addEventListener('mouseenter', () => item.style.background = 'var(--accent)20');
    item.addEventListener('mouseleave', () => item.style.background = '');
  });

  const close = () => menu.remove();
  setTimeout(() => document.addEventListener('click', close, { once: true }), 10);

  menu.querySelectorAll('.ctx-item').forEach(item => {
    item.addEventListener('click', async () => {
      const action = item.dataset.action;
      if (action === 'edit') {
        openTokenEditModal(token);
      } else if (action === 'portrait') {
        // Phase 6: trigger a hidden file input and POST to the portrait
        // upload endpoint. The server broadcasts `map.updated` which
        // refreshes the canvas so the new face appears automatically.
        uploadTokenPortrait(token.character_id);
      } else if (action === 'portrait-clear') {
        if (!confirm('Remove portrait from this token?')) { close(); return; }
        try {
          await api.del(`/api/map/token-image/${token.character_id}`);
          addLog('map', `Portrait cleared for ${token.name}`);
        } catch { showToast('Failed to clear portrait'); }
      } else if (action === 'hide') {
        await api.patch(`/api/characters/${token.character_id}`, { is_visible_on_map: !token.visible });
        token.visible = !token.visible;
        mapCanvas.render();
      } else if (action === 'remove') {
        await api.patch(`/api/map/token/${token.character_id}`, { x: null, y: null });
        token.x = null; token.y = null;
        mapCanvas.render();
      } else if (action === 'control-panel') {
        openNpcControlPanel(token.character_id);
      } else if (action === 'select') {
        selectCharacter(token.character_id);
      }
      close();
    });
  });
}

// Phase 6: upload flow — spawns a temporary <input type=file>, sends
// the selected file to the portrait endpoint, and relies on the WS
// `map.updated` broadcast to refresh everyone's canvases.
function uploadTokenPortrait(characterId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.remove();
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await fetch(`/api/map/token-image/${characterId}`, { method: 'POST', body: fd });
      if (!res.ok) { showToast('Portrait upload failed'); return; }
      addLog('map', `Portrait uploaded for token ${characterId}`);
    } catch { showToast('Portrait upload failed'); }
  });
  input.click();
}

function openTokenEditModal(token) {
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="width:300px">
      <h2 style="margin-bottom:10px">Edit Token: ${token.name}</h2>
      <div style="margin-bottom:8px">
        <label style="font-size:0.72rem;color:var(--text-muted)">Color:</label>
        <input type="color" id="token-edit-color" value="${token.color || '#c08a2a'}" style="width:50px;height:28px;border:none;cursor:pointer">
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" id="btn-token-save" style="flex:1">Save</button>
        <button class="btn btn-ghost btn-sm" id="btn-token-cancel" style="flex:1">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#btn-token-cancel').addEventListener('click', () => modal.remove());
  modal.querySelector('#btn-token-save').addEventListener('click', async () => {
    const color = modal.querySelector('#token-edit-color').value;
    await api.patch(`/api/characters/${token.character_id}`, { token_color: color });
    token.color = color;
    mapCanvas.render();
    modal.remove();
  });
}

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
// FULL REST (Rework v3)
// ══════════════════════════════════════════════════════════════
$('#btn-full-rest')?.addEventListener('click', async () => {
  if (!confirm('🌙 Full Rest: restore HP, mana, cooldowns, and uses for every living player. Proceed?')) return;
  try {
    const res = await api.post(`/api/sessions/${SESSION_CODE}/full-rest`, {});
    const n = res?.healed_count ?? 0;
    showToast(`🌙 Full Rest applied — ${n} player${n === 1 ? '' : 's'} restored`);
    addLog('gm.rest', `Full Rest: ${n} players fully restored`);
    await refreshChars();
  } catch (e) {
    showToast(`Full Rest failed: ${e.message || e}`);
  }
});

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

// Rework v3 Phase 1: live refresh when somebody uploads/replaces the
// map or when a character is created/deleted (auto-seed in the map
// router gives every new token a default grid position). Safe guard
// around `loadMapState` — it may not be defined yet if this handler
// fires during an early reconnect.
ws.on('map.updated', () => {
  if (typeof loadMapState === 'function') loadMapState();
});
// Phase 5: map objects (walls) changed somewhere — refresh the
// overlays portion. We reuse `loadMapState` for simplicity; the extra
// tokens + fog reload are cheap.
ws.on('map.objects_updated', () => {
  if (typeof loadMapState === 'function') loadMapState();
});
// Rework v3 Phase 2: players now move their own tokens; apply the
// incremental position update instead of a full refetch so GM's view
// stays snappy during heavy combat.
ws.on('map.token_moved', d => {
  if (!d || d.character_id == null || !mapCanvas) return;
  const t = (mapCanvas.tokens || []).find(x => x.character_id === d.character_id);
  if (!t) return;
  if (d.x != null) t.x = d.x;
  if (d.y != null) t.y = d.y;
  if (d.visible != null) t.visible = d.visible;
  mapCanvas.render();
});

ws.on('session.state', data => {
  const s = data.session;
  $('#session-name').textContent = s.name;
  $('#session-status').textContent = s.status;
  $('#session-turn').textContent = s.turn_number;
  $('#connected-count').textContent = data.connected_count;
  addLog('session.state', `Loaded: ${s.name}`);
  refreshChars();
});

// ══════════════════════════════════════════════════════════════
// GENERIC ENTITY INVALIDATION — live refresh without page reload
// ══════════════════════════════════════════════════════════════
// Server emits `entity.invalidated` after every DB commit via the
// SQLAlchemy after_commit dispatcher (app/realtime.py). Payload:
//   { changes: [{ entity, character_id, action }, ...] }
// GM cares about almost everything — the party list / combat panel /
// quest panel should track any player's mutations. Each refresher is
// debounced so a flood of writes collapses into a single refetch.
function _gmCall(fn, ...args) {
  if (typeof fn === 'function') { try { fn(...args); } catch (e) { console.warn('gm refresh error', e); } }
}
const _gmInvRefreshers = {
  // ── Character-scoped ──────────────────────────────────────
  Character: () => {
    _gmCall(refreshChars);
    if (typeof activeCombat !== 'undefined' && activeCombat) _gmCall(loadCombatPanel);
    _gmCall(loadMapState);
  },
  // GM-side per-character inventory / notes / memory panels live in
  // modals that re-fetch on open. Refreshing the party list on these
  // mutations still helps because HP / slot counters live there.
  InventoryItem:       () => { _gmCall(refreshChars); },
  InventoryItemPoison: () => {},
  CharacterAbility:    () => { _gmCall(loadGmAbilities); _gmCall(refreshChars); },
  StatModifier:        () => { _gmCall(refreshChars); },
  AttackModifier:      () => { _gmCall(refreshChars); },
  DamageModifier:      () => { _gmCall(refreshChars); },
  CharacterEffect:     () => { _gmCall(refreshChars); },
  CharacterStatusEffect: () => { _gmCall(refreshChars); },
  CharacterQuest:      () => { _gmCall(loadQuests); },
  CharacterProfession: () => { _gmCall(refreshChars); },
  TurnTimer:           () => { _gmCall(refreshChars); },
  CharacterNote:       () => {},   // only visible in notes modal
  CharacterMemory:     () => {},   // only visible in memory modal
  CharacterWizardState:() => { _gmCall(loadWizardPending); },
  NpcReputation:       () => {},
  NpcShopInventory:    () => {},
  // ── Session-scoped ────────────────────────────────────────
  Session: () => { _gmCall(refreshChars); },
  CombatEvent: () => {
    _gmCall(refreshChars);
    _gmCall(loadCombatPanel);
    _gmCall(loadMapState);
  },
  CombatParticipant: () => {
    _gmCall(loadCombatPanel);
    _gmCall(refreshChars);
  },
  CombatAction: () => { _gmCall(loadCombatPanel); },
  InitiativeOrder: () => { _gmCall(loadCombatPanel); },
  SessionAnnouncement: () => { _gmCall(loadAnnouncements); },
  QuestTemplate: () => { _gmCall(loadQuests); },
  MapData:    () => { _gmCall(loadMapState); },
  MapMarker:  () => { _gmCall(loadMapState); },
  MapDrawing: () => { _gmCall(loadMapState); },
  MapObject:  () => { _gmCall(loadMapState); },
  NpcFolder:    () => { _gmCall(loadNpcLibrary); },
  NpcTemplate:  () => { _gmCall(loadNpcLibrary); },
  EventTemplate:() => { _gmCall(loadNpcLibrary); },
  ShopItem:     () => {},   // only visible in shop editor modal
  TradeSession: () => {},   // trade modals manage themselves
  // ── Global templates ──────────────────────────────────────
  Ability:        () => { _gmCall(loadGmAbilities); },
  Race:           () => { _gmCall(loadRacesClasses); },
  CharacterClass: () => { _gmCall(loadRacesClasses); },
  StatusEffectTemplate: () => {},
  PoisonTemplate:       () => {},
  EquipmentTemplate:    () => {},
};
const _gmInvPending = new Set();
let _gmInvTimer = null;
function _gmInvFlush() {
  const keys = Array.from(_gmInvPending);
  _gmInvPending.clear();
  _gmInvTimer = null;
  for (const key of keys) {
    const fn = _gmInvRefreshers[key];
    if (fn) try { fn(); } catch (e) { console.warn('gm inv refresh', key, e); }
  }
}
ws.on('entity.invalidated', d => {
  if (!d || !Array.isArray(d.changes)) return;
  for (const ch of d.changes) {
    if (ch && ch.entity && _gmInvRefreshers[ch.entity]) {
      _gmInvPending.add(ch.entity);
    }
  }
  if (_gmInvPending.size === 0) return;
  if (_gmInvTimer) clearTimeout(_gmInvTimer);
  _gmInvTimer = setTimeout(_gmInvFlush, 200);
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

// Rework Phase 7: GM-side starting-item approval
ws.on('wizard.update', data => {
  if (data && data.needs_gm_approve && data.character_id) {
    openGmWizardApprovalModal(data.character_id);
  }
});
ws.on('wizard.completed', data => {
  if (data && data.character_id) {
    addLog('wizard', `✅ Starting item approved for character #${data.character_id} (${data.rarity})`);
  }
});

async function openGmWizardApprovalModal(charId) {
  // Avoid duplicates
  if (document.getElementById(`gm-wiz-approve-${charId}`)) return;
  let ws_state;
  try { ws_state = await api.get(`/api/wizard/${charId}`); } catch { return; }
  const data = ws_state.data || {};
  if (!data.proposed_item || ws_state.is_completed) return;

  const char = characters.find(c => c.id === charId) || { name: `#${charId}` };
  const rarity = data.starting_roll?.rarity || 'common';
  const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

  const overlay = document.createElement('div');
  overlay.id = `gm-wiz-approve-${charId}`;
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:480px">
      <h2 style="margin-top:0">🎁 Starting-Item Approval</h2>
      <div style="font-size:0.88rem;margin-bottom:8px"><strong>${char.name}</strong> rolled
        <strong>d20 = ${data.starting_roll?.d20 ?? '?'}</strong> → proposed:</div>
      <div style="padding:10px;background:var(--bg-surface-2);border-radius:var(--r-md);margin-bottom:10px">
        <div style="font-weight:700;font-size:1rem">${data.proposed_item.name}</div>
        <div style="font-size:0.78rem;color:var(--text-muted);margin-top:4px">${data.proposed_item.description || '(no description)'}</div>
        <div style="font-size:0.72rem;margin-top:4px">Category: <strong>${data.proposed_item.category || 'misc'}</strong></div>
      </div>
      <label style="font-size:0.78rem">Rarity (override if needed)</label>
      <select id="gmw-rarity" style="width:100%;margin-bottom:8px">
        ${rarities.map(r => `<option value="${r}" ${r===rarity?'selected':''}>${r}</option>`).join('')}
      </select>
      <label style="font-size:0.78rem">GM note (optional)</label>
      <input type="text" id="gmw-note" placeholder="e.g. Nice concept" style="width:100%;margin-bottom:12px">
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" id="gmw-cancel">Close</button>
        <button class="btn btn-danger btn-sm" id="gmw-reject">Reject</button>
        <button class="btn btn-primary btn-sm" id="gmw-approve">Approve</button>
      </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#gmw-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#gmw-reject').addEventListener('click', async () => {
    const note = overlay.querySelector('#gmw-note').value.trim();
    try {
      await api.post(`/api/wizard/${charId}/reject-item`, { note });
      addLog('gm.wizard', `Rejected starting-item for ${char.name}`);
      overlay.remove();
      loadWizardPending();
    } catch { showToast('Failed to reject'); }
  });
  overlay.querySelector('#gmw-approve').addEventListener('click', async () => {
    const rarity_override = overlay.querySelector('#gmw-rarity').value;
    const note = overlay.querySelector('#gmw-note').value.trim();
    try {
      const res = await api.post(`/api/wizard/${charId}/approve-item`, { rarity_override, note });
      addLog('gm.wizard', `Approved starting-item for ${char.name} (${res.rarity})`);
      overlay.remove();
      loadWizardPending();
    } catch { showToast('Failed to approve'); }
  });
}

// ══════════════════════════════════════════════════════════════
// Rework v2 — Pending starting-item approvals (GM topbar badge)
// ══════════════════════════════════════════════════════════════
let _wizardPending = [];
async function loadWizardPending() {
  const btn   = document.getElementById('btn-wizard-pending');
  const badge = document.getElementById('wizard-pending-count');
  if (!btn || !badge) return;
  if (!SESSION_ID) { btn.style.display = 'none'; return; }
  try {
    _wizardPending = await api.get(`/api/wizard/session/${SESSION_ID}/pending`);
  } catch { _wizardPending = []; }
  if (!_wizardPending.length) {
    btn.style.display = 'none';
    return;
  }
  btn.style.display = 'inline-flex';
  badge.textContent = _wizardPending.length;
}

function openWizardPendingList() {
  if (!_wizardPending.length) return;
  // One pending → open the approval modal directly.
  if (_wizardPending.length === 1) {
    openGmWizardApprovalModal(_wizardPending[0].character_id);
    return;
  }
  // Multiple → picker list.
  if (document.getElementById('gm-wiz-pending-list')) return;
  const overlay = document.createElement('div');
  overlay.id = 'gm-wiz-pending-list';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:440px">
      <h2 style="margin-top:0">🎁 Pending Starting-Item Approvals</h2>
      <div style="display:flex;flex-direction:column;gap:6px;max-height:60vh;overflow-y:auto">
        ${_wizardPending.map(p => `
          <button class="btn btn-ghost btn-sm" data-wiz-pick="${p.character_id}"
                  style="justify-content:flex-start;text-align:left;padding:8px 10px">
            <div style="display:flex;flex-direction:column;gap:2px;width:100%">
              <div style="display:flex;align-items:center;gap:6px">
                <strong>${p.character_name}</strong>
                ${p.starting_roll ? `<span class="rarity-chip rarity-${p.starting_roll.rarity}">${p.starting_roll.rarity}</span>` : ''}
                ${p.wizard_completed ? '<span style="font-size:0.62rem;color:var(--accent-orange);margin-left:auto">in-game</span>' : ''}
              </div>
              <div style="font-size:0.72rem;color:var(--text-muted)">
                ${(p.proposed_item && p.proposed_item.name) || '(unnamed)'} —
                ${(p.proposed_item && p.proposed_item.category) || 'misc'}
              </div>
            </div>
          </button>
        `).join('')}
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:10px">
        <button class="btn btn-ghost btn-sm" id="gm-wiz-pending-close">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#gm-wiz-pending-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelectorAll('[data-wiz-pick]').forEach(b => {
    b.addEventListener('click', () => {
      const cid = parseInt(b.dataset.wizPick);
      overlay.remove();
      openGmWizardApprovalModal(cid);
    });
  });
}

// Wire topbar pending button
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-wizard-pending');
  if (btn) btn.addEventListener('click', openWizardPendingList);
});
// Refresh when any wizard event fires
ws.on('wizard.update',         () => loadWizardPending());
ws.on('wizard.item_approved',  () => loadWizardPending());
ws.on('wizard.item_rejected',  () => loadWizardPending());
ws.on('wizard.completed',      () => loadWizardPending());

// ══════════════════════════════════════════════════════════════
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

// ── Use Effects Editor ──
let tempUseEffects = [];
const USE_EFFECT_TYPES = [
  {value:'heal_hp', label:'Heal HP'},
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
    if (e.type === 'heal_hp' || e.type === 'damage') {
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

// Rework v3: the server now returns a parsed envelope
// ({reply, say, actions:[{kind, ok, id, name, error}], parse_error}).
// We render `say` in the bubble and render each action as its own card so
// the GM can see exactly what was created (or why it failed).
function _renderAIMessageText(div, content) {
  const safe = String(content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  div.innerHTML = safe
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

function _renderAIActionCard(action) {
  const card = document.createElement('div');
  card.className = 'ai-item-preview';
  const KIND_LABEL = {
    create_item: '📦 Item',
    create_npc: '🎭 NPC',
    create_ability: '✨ Ability',
  };
  const label = KIND_LABEL[action.kind] || action.kind;
  if (action.ok === false || action.error) {
    card.style.borderLeft = '3px solid var(--accent-red)';
    card.innerHTML = `<strong>${label}</strong> <span style="color:var(--accent-red)">failed</span><br>
      <span style="font-size:0.75rem;color:var(--text-muted)">${action.error || 'unknown error'}</span>`;
    return card;
  }
  const extras = [];
  if (action.rarity) extras.push(action.rarity);
  if (action.category) extras.push(action.category);
  if (action.max_hp) extras.push(`HP ${action.max_hp}`);
  if (action.armor_class) extras.push(`AC ${action.armor_class}`);
  if (action.ability_type) extras.push(action.ability_type);
  if (action.target_type) extras.push(action.target_type);
  card.innerHTML = `
    <div>✓ <strong>${label}</strong> created — <strong>${action.name || ''}</strong>
      ${extras.length ? `<span style="font-size:0.72rem;color:var(--text-muted)">(${extras.join(' · ')})</span>` : ''}
    </div>
    <div style="font-size:0.72rem;color:var(--text-muted)">id #${action.id}</div>`;
  return card;
}

function appendAIMessage(role, content, actions) {
  const container = $('#ai-messages');
  const div = document.createElement('div');
  div.className = `ai-msg ${role}`;

  if (role === 'assistant') {
    _renderAIMessageText(div, content || '');
    for (const a of (actions || [])) div.appendChild(_renderAIActionCard(a));
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
      // Prefer the parsed `say` for display. Fall back to raw reply if the
      // model failed to emit a valid envelope (parse_error != null).
      const text = res.say || res.reply || '';
      appendAIMessage('assistant', text, res.actions || []);
      // Toast any new items/NPCs so other GM panels refresh immediately.
      for (const a of (res.actions || [])) {
        if (a.ok === false || a.error) continue;
        if (a.kind === 'create_item')    { showToast(`📦 ${a.name} added`);   if (typeof loadItems     === 'function') loadItems();     }
        if (a.kind === 'create_npc')     { showToast(`🎭 ${a.name} spawned`); if (typeof loadCharacters === 'function') loadCharacters(); }
        if (a.kind === 'create_ability') { showToast(`✨ ${a.name} forged`);  if (typeof loadAbilities  === 'function') loadAbilities();  }
      }
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
    // Rework v3 prompts — the model is envelope-schema aware, so tell it
    // which kind of action we want (or none) instead of asking for free JSON.
    const prompts = {
      narrate: 'Narrate the current combat situation dramatically in <=300 chars. Emit no actions.',
      npc:     'Analyze the battlefield and suggest what each NPC should do this turn. Short bullets. Emit no actions.',
      item:    'Invent ONE creative fantasy item themed to this session and emit it via a single create_item action. Keep "say" under 200 chars.',
      summary: 'Summarize this session so far in <=400 chars (key events, damage, items, moments). Emit no actions.',
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
  if (res.active && res.combat.status === 'active') {
    activeCombat = res.combat;
    renderActiveCombat(panel);
  } else if (res.active && res.combat.status === 'preparing') {
    activeCombat = res.combat;
    renderPreparingCombat(panel);
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
        <h2>⚔️ ${c.name} <span class="cc-badge" style="background:var(--accent-orange)">Preparing</span> <span id="difficulty-badge" style="font-size:0.65rem"></span></h2>
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

  // Helper: sync checkboxes → API, refresh state
  async function syncParticipants() {
    const checked = [...panel.querySelectorAll('#combat-char-selector input:checked')].map(i => parseInt(i.value));
    const current = new Set(activeCombat.participants.map(p => p.character_id));
    const toAdd = checked.filter(id => !current.has(id));
    const toRemove = [...current].filter(id => !checked.includes(id));

    for (const id of toRemove) {
      await api.del(`/api/combat/${activeCombat.id}/participants/${id}`);
    }
    if (toAdd.length) {
      await api.post(`/api/combat/${activeCombat.id}/add-participants`, { character_ids: toAdd });
    }
    if (toAdd.length || toRemove.length) {
      const state = await api.get(`/api/combat/${activeCombat.id}/state`);
      activeCombat = state;
    }
  }

  // Auto-sync when checkbox changes
  panel.querySelectorAll('#combat-char-selector input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await syncParticipants();
      panel.querySelector('#combat-participants-list').innerHTML = renderParticipantRows(activeCombat);
      wireInitiativeInputs(panel, activeCombat);
      updateDifficultyBadge();
    });
  });

  // Initial difficulty badge
  updateDifficultyBadge();

  async function updateDifficultyBadge() {
    const badge = panel.querySelector('#difficulty-badge');
    if (!badge || !activeCombat) return;
    const parts = activeCombat.participants || [];
    const players = parts.filter(p => !p.is_npc).map(p => {
      const ch = characters.find(x => x.id === p.character_id);
      return { max_hp: ch?.max_hp ?? 0, armor_class: ch?.armor_class ?? 0, level: ch?.level ?? 0 };
    });
    const npcs = parts.filter(p => p.is_npc).map(p => {
      const ch = characters.find(x => x.id === p.character_id);
      return { max_hp: ch?.max_hp ?? 0, armor_class: ch?.armor_class ?? 0 };
    });
    if (!players.length || !npcs.length) { badge.textContent = ''; return; }
    try {
      const res = await api.post('/api/npc-library/encounter-difficulty', { players, npcs });
      const colors = { Trivial: '#888', Easy: '#4caf50', Medium: '#ff9800', Hard: '#f44336', Deadly: '#b71c1c' };
      const icons = { Trivial: '⚪', Easy: '🟢', Medium: '🟡', Hard: '🟠', Deadly: '🔴' };
      badge.innerHTML = `<span style="padding:2px 8px;border-radius:10px;background:${colors[res.difficulty]}20;color:${colors[res.difficulty]};font-weight:700">${icons[res.difficulty] || ''} ${res.difficulty}</span>`;
    } catch { badge.textContent = ''; }
  }

  // Update Participants button (still available as explicit sync)
  panel.querySelector('#btn-combat-update-participants').addEventListener('click', async () => {
    await syncParticipants();
    renderPreparingCombat(panel);
  });

  panel.querySelector('#btn-combat-roll-npc').addEventListener('click', async () => {
    await syncParticipants();
    if (!activeCombat.participants.some(p => p.is_npc)) {
      showToast('No NPC participants to roll for');
      return;
    }
    const res = await api.post(`/api/combat/${activeCombat.id}/roll-npc-initiative`);
    activeCombat = res.combat;
    panel.querySelector('#combat-participants-list').innerHTML = renderParticipantRows(activeCombat);
    wireInitiativeInputs(panel, activeCombat);
    addLog('gm.combat', `NPC initiative rolled: ${res.rolls.map(r => `${r.name}=${r.final}`).join(', ')}`);
  });

  panel.querySelector('#btn-combat-request-player-rolls').addEventListener('click', async () => {
    try { await syncParticipants(); } catch(e) { console.error('syncParticipants error:', e); }
    const playerParts = activeCombat.participants.filter(p => !p.is_npc);
    if (!playerParts.length) {
      showToast('No player participants');
      return;
    }
    const res = await api.post(`/api/combat/${activeCombat.id}/request-player-initiative`);
    if (res.sent_to && res.sent_to.length) {
      showToast(`Initiative request sent to ${res.sent_to.map(s => s.name).join(', ')}`);
    } else {
      showToast('No connected players to send to');
    }
  });

  panel.querySelector('#btn-combat-start').addEventListener('click', async () => {
    await syncParticipants();
    try {
      const res = await api.post(`/api/combat/${activeCombat.id}/start`);
      activeCombat = res;
      renderActiveCombat(panel);
      addLog('gm.combat', `Combat "${activeCombat.name}" started!`);
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({ type: 'combat.started', data: { combat_id: activeCombat.id } }));
      }
    } catch (e) {
      showToast('Cannot start: ensure all participants have initiative');
    }
  });

  // Manual initiative inputs
  wireInitiativeInputs(panel, activeCombat);
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
            <div style="margin-top:6px;display:flex;gap:6px;justify-content:center;align-items:center" id="combat-timer-controls">
              <label style="font-size:0.7rem;color:var(--text-muted)">Timer (min):</label>
              <input type="number" id="combat-timer-min" value="2" style="width:50px;font-size:0.75rem" min="1" max="30" step="1">
              <button class="btn btn-ghost btn-xs" id="btn-combat-timer-start">⏱ Start</button>
              <button class="btn btn-ghost btn-xs" id="btn-combat-timer-pause" style="display:none">⏸</button>
              <button class="btn btn-ghost btn-xs" id="btn-combat-timer-resume" style="display:none">▶</button>
              <button class="btn btn-danger btn-xs" id="btn-combat-timer-stop" style="display:none">⏹</button>
            </div>
            <div id="combat-timer-display" style="font-size:1.5rem;font-weight:700;color:var(--accent-orange);margin-top:4px;display:none;font-variant-numeric:tabular-nums"></div>
          ` : ''}
        </div>

        <!-- Action Panel (NPC turn = GM controls) -->
        ${currentP && currentP.is_npc ? `
        <div style="padding:10px;margin-bottom:12px;border-radius:var(--r-md);background:var(--bg-dark);border:1px solid var(--border)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <span style="font-size:0.75rem;color:var(--text-muted)">⚔️ Actions for ${currentP.name}</span>
            ${makeAdvToggle('gm_combat')}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-danger btn-sm" id="btn-combat-attack">⚔️ Attack</button>
            <button class="btn btn-accent btn-sm" id="btn-combat-defend">🛡️ Defend</button>
            <button class="btn btn-primary btn-sm" id="btn-combat-next-turn" style="flex:1;min-width:120px;font-size:1rem;padding:10px">⏭ Next Turn</button>
          </div>
          <div id="combat-target-panel" style="display:none;margin-top:10px"></div>
          <div id="combat-action-result" style="margin-top:8px;font-size:0.85rem"></div>
        </div>
        ` : `
        <!-- Player turn: just next turn button -->
        <div style="display:flex;gap:6px;margin-bottom:12px">
          <button class="btn btn-primary" id="btn-combat-next-turn" style="flex:1;font-size:1rem;padding:10px">⏭ Next Turn</button>
        </div>
        `}

        <!-- Turn Order -->
        <div style="font-size:0.8rem;font-weight:600;margin-bottom:6px">Turn Order:</div>
        <div id="combat-turn-order">${renderParticipantRows(c)}</div>

        <!-- Combat Action Log -->
        <div style="margin-top:12px">
          <div style="font-size:0.8rem;font-weight:600;margin-bottom:6px">⚔️ Battle Log</div>
          <div id="combat-action-log" style="max-height:200px;overflow-y:auto;font-size:0.78rem;background:var(--bg-dark);border-radius:var(--r-sm);padding:6px"></div>
        </div>

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

  // Wire Combat Timer
  const ctStartBtn = panel.querySelector('#btn-combat-timer-start');
  const ctPauseBtn = panel.querySelector('#btn-combat-timer-pause');
  const ctResumeBtn = panel.querySelector('#btn-combat-timer-resume');
  const ctStopBtn = panel.querySelector('#btn-combat-timer-stop');
  const ctDisplay = panel.querySelector('#combat-timer-display');
  const ctInput = panel.querySelector('#combat-timer-min');

  if (ctStartBtn && currentP) {
    ctStartBtn.addEventListener('click', () => {
      const mins = parseFloat(ctInput.value) || 2;
      const secs = Math.round(mins * 60);
      startGmCombatTimer(secs, currentP.character_id);
    });
    ctPauseBtn.addEventListener('click', () => pauseGmCombatTimer());
    ctResumeBtn.addEventListener('click', () => resumeGmCombatTimer());
    ctStopBtn.addEventListener('click', () => {
      stopGmCombatTimer();
      sendPlayerTimerStop(currentP.character_id);
    });
    // Restore timer if one was running
    restoreGmCombatTimer();
  }

  // Bind combat advantage toggle
  bindAdvToggle(panel, 'gm_combat');

  // Wire Attack Button (NPC turn)
  const atkBtn = panel.querySelector('#btn-combat-attack');
  if (atkBtn && currentP) {
    atkBtn.addEventListener('click', async () => {
      const targetPanel = panel.querySelector('#combat-target-panel');
      if (!targetPanel) return;
      try {
        const targets = await api.get(`/api/combat/${c.id}/targets/${currentP.character_id}`);
        if (!targets.length) { showToast('No valid targets'); return; }
        targetPanel.style.display = 'block';
        targetPanel.innerHTML = `
          <div style="font-size:0.75rem;font-weight:600;margin-bottom:6px">Select Target:</div>
          ${targets.map(t => `
            <div class="combat-target-card" data-id="${t.character_id}" style="cursor:pointer;padding:8px;margin-bottom:4px;border-radius:var(--r-sm);border:1px solid var(--border);display:flex;align-items:center;gap:8px;transition:background 0.2s">
              <div style="width:20px;height:20px;border-radius:50%;background:${t.token_color}"></div>
              <div style="flex:1">
                <div style="font-weight:600;font-size:0.85rem">${t.name}${t.is_npc ? ' <span style="color:var(--text-muted);font-size:0.6rem">NPC</span>' : ''}</div>
                <div style="font-size:0.7rem;color:var(--text-muted)">HP: ${t.current_hp}/${t.max_hp} | AC: ${t.armor_class}</div>
              </div>
              <div style="width:60px;height:6px;background:var(--bg-dark);border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${Math.round(t.current_hp/t.max_hp*100)}%;background:${t.current_hp/t.max_hp > 0.5 ? 'var(--hp-high)' : t.current_hp/t.max_hp > 0.25 ? 'var(--hp-mid)' : 'var(--hp-low)'}"></div>
              </div>
            </div>
          `).join('')}
        `;
        targetPanel.querySelectorAll('.combat-target-card').forEach(card => {
          card.addEventListener('mouseenter', () => card.style.background = 'var(--accent)15');
          card.addEventListener('mouseleave', () => card.style.background = '');
          card.addEventListener('click', async () => {
            const targetId = parseInt(card.dataset.id);
            try {
              const result = await api.post(`/api/combat/${c.id}/attack`, {
                attacker_id: currentP.character_id, target_id: targetId,
                advantage_mode: getAdvMode('gm_combat'),
              });
              targetPanel.style.display = 'none';
              const resEl = panel.querySelector('#combat-action-result');
              if (resEl) {
                const atk = result.attack_roll;
                const dmg = result.damage_roll;
                let html = `<div style="padding:8px;border-radius:var(--r-sm);border:1px solid `;
                if (atk.critical) html += `gold;background:#ffd70020"><b style="color:gold">🎯 CRITICAL!</b>`;
                else if (atk.fumble) html += `var(--accent-red);background:var(--accent-red)10"><b style="color:var(--accent-red)">💨 FUMBLE!</b>`;
                else if (atk.hit) html += `var(--accent-green);background:var(--accent-green)10"><b style="color:var(--accent-green)">⚔️ HIT!</b>`;
                else html += `var(--text-muted);background:var(--bg-dark)"><b style="color:var(--text-muted)">🛡️ MISS</b>`;
                html += `<div style="font-size:0.75rem;margin-top:4px">d20: ${atk.d20} + STR: ${atk.stat_mod} + Wpn: ${atk.weapon_bonus} + Items: ${atk.item_bonuses} = ${atk.total} vs AC ${atk.target_ac}</div>`;
                if (dmg) {
                  html += `<div style="font-size:0.75rem;margin-top:2px">Damage: [${dmg.dice_rolls.join(',')}] + STR: ${dmg.stat_mod} + Wpn: ${dmg.weapon_damage_bonus} = ${dmg.final_damage} damage</div>`;
                  html += `<div style="font-size:0.75rem">${result.target_name}: ${result.target_current_hp}/${result.target_max_hp} HP</div>`;
                  if (result.target_killed) html += `<div style="color:var(--accent-red);font-weight:700;margin-top:4px">💀 ${result.target_name} SLAIN!</div>`;
                }
                html += `</div>`;
                resEl.innerHTML = html;
              }
              // Add to log & broadcast
              addLog('gm.combat', result.description);
              appendCombatLogEntry(result);
              if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
                ws.ws.send(JSON.stringify({ type: 'combat.attack_result', data: result }));
                if (result.target_killed) {
                  ws.ws.send(JSON.stringify({ type: 'combat.character_killed', data: {
                    character_id: targetId, character_name: result.target_name, killed_by: currentP.name
                  }}));
                }
              }
              // Refresh turn order HP bars
              const state = await api.get(`/api/combat/${c.id}/state`);
              activeCombat = state;
              const toEl = panel.querySelector('#combat-turn-order');
              if (toEl) toEl.innerHTML = renderParticipantRows(activeCombat);
            } catch (e) { showToast('Attack error: ' + e.message); }
          });
        });
      } catch (e) { showToast('Error loading targets: ' + e.message); }
    });
  }

  // Wire Defend Button (NPC turn)
  const defBtn = panel.querySelector('#btn-combat-defend');
  if (defBtn && currentP) {
    defBtn.addEventListener('click', async () => {
      try {
        const result = await api.post(`/api/combat/${c.id}/defend`, { character_id: currentP.character_id });
        const resEl = panel.querySelector('#combat-action-result');
        if (resEl) {
          resEl.innerHTML = `<div style="padding:8px;border-radius:var(--r-sm);border:1px solid var(--accent);background:var(--accent)10">
            <b style="color:var(--accent)">🛡️ DEFENDING</b>
            <div style="font-size:0.75rem;margin-top:4px">${result.description}</div>
            <div style="font-size:0.75rem">New AC: ${result.new_ac}</div>
          </div>`;
        }
        addLog('gm.combat', result.description);
        appendCombatLogEntry({ description: result.description, attack_roll: { defend: true } });
        if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
          ws.ws.send(JSON.stringify({ type: 'combat.defend', data: result }));
        }
      } catch (e) { showToast('Defend error: ' + e.message); }
    });
  }

  // Load battle log
  loadCombatActionLog(c.id);
}

async function loadCombatActionLog(combatId) {
  const logEl = document.querySelector('#combat-action-log');
  if (!logEl) return;
  try {
    const actions = await api.get(`/api/combat/${combatId}/actions`);
    logEl.innerHTML = actions.length ? actions.map(a => {
      let color = 'var(--text-muted)';
      if (a.attack_roll?.critical) color = 'gold';
      else if (a.attack_roll?.hit) color = 'var(--accent-green)';
      else if (a.attack_roll?.fumble) color = 'var(--accent-red)';
      else if (a.action_type === 'defend') color = 'var(--accent)';
      return `<div style="padding:3px 0;border-bottom:1px solid var(--border);color:${color}">
        <span style="color:var(--text-muted);font-size:0.65rem">R${a.round_number}</span> ${a.description}
      </div>`;
    }).join('') : '<div style="color:var(--text-muted)">No actions yet</div>';
  } catch(e) { logEl.innerHTML = ''; }
}

function appendCombatLogEntry(result) {
  const logEl = document.querySelector('#combat-action-log');
  if (!logEl) return;
  let color = 'var(--text-muted)';
  const atk = result.attack_roll;
  if (atk?.critical) color = 'gold';
  else if (atk?.hit) color = 'var(--accent-green)';
  else if (atk?.fumble) color = 'var(--accent-red)';
  else if (atk?.defend) color = 'var(--accent)';
  const entry = document.createElement('div');
  entry.style.cssText = `padding:3px 0;border-bottom:1px solid var(--border);color:${color}`;
  entry.innerHTML = `<span style="color:var(--text-muted);font-size:0.65rem">R${activeCombat?.round_number || '?'}</span> ${result.description}`;
  logEl.prepend(entry);
}

function formatGmTimer(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Combat Timer (localStorage-backed) ──
function _saveCombatTimer(state) {
  if (state) localStorage.setItem('gm-combat-timer', JSON.stringify(state));
  else localStorage.removeItem('gm-combat-timer');
}
function _getCombatTimer() {
  try { return JSON.parse(localStorage.getItem('gm-combat-timer')); } catch { return null; }
}

function _setCombatTimerUI(running, paused) {
  const startBtn = document.querySelector('#btn-combat-timer-start');
  const pauseBtn = document.querySelector('#btn-combat-timer-pause');
  const resumeBtn = document.querySelector('#btn-combat-timer-resume');
  const stopBtn = document.querySelector('#btn-combat-timer-stop');
  const input = document.querySelector('#combat-timer-min');
  const display = document.querySelector('#combat-timer-display');
  if (!startBtn) return;
  if (running) {
    startBtn.style.display = 'none';
    input.style.display = 'none';
    stopBtn.style.display = '';
    display.style.display = '';
    pauseBtn.style.display = paused ? 'none' : '';
    resumeBtn.style.display = paused ? '' : 'none';
  } else {
    startBtn.style.display = '';
    input.style.display = '';
    pauseBtn.style.display = 'none';
    resumeBtn.style.display = 'none';
    stopBtn.style.display = 'none';
    display.style.display = 'none';
    display.style.animation = '';
  }
}

function _tickCombatTimer() {
  const st = _getCombatTimer();
  if (!st || st.paused) return;
  const elapsed = Math.floor((Date.now() - st.startedAt) / 1000);
  const remaining = Math.max(0, st.totalSeconds - elapsed);
  const display = document.querySelector('#combat-timer-display');
  if (!display) return;
  display.textContent = formatGmTimer(remaining);
  display.style.color = remaining <= 10 ? 'var(--accent-red)' : 'var(--accent-orange)';
  if (remaining <= 0) {
    clearInterval(combatTimerInterval);
    combatTimerInterval = null;
    display.textContent = '⏰ TIME UP!';
    display.style.animation = 'pulse 0.5s ease-in-out 3';
    _saveCombatTimer(null);
    setTimeout(() => _setCombatTimerUI(false, false), 4000);
  }
}

function startGmCombatTimer(seconds, charId) {
  if (combatTimerInterval) clearInterval(combatTimerInterval);
  _saveCombatTimer({ totalSeconds: seconds, startedAt: Date.now(), paused: false, charId });
  _setCombatTimerUI(true, false);
  _tickCombatTimer();
  combatTimerInterval = setInterval(_tickCombatTimer, 1000);

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

function pauseGmCombatTimer() {
  const st = _getCombatTimer();
  if (!st) return;
  if (combatTimerInterval) { clearInterval(combatTimerInterval); combatTimerInterval = null; }
  const elapsed = Math.floor((Date.now() - st.startedAt) / 1000);
  const remaining = Math.max(0, st.totalSeconds - elapsed);
  _saveCombatTimer({ ...st, totalSeconds: remaining, startedAt: Date.now(), paused: true });
  _setCombatTimerUI(true, true);
}

function resumeGmCombatTimer() {
  const st = _getCombatTimer();
  if (!st) return;
  _saveCombatTimer({ ...st, startedAt: Date.now(), paused: false });
  _setCombatTimerUI(true, false);
  _tickCombatTimer();
  combatTimerInterval = setInterval(_tickCombatTimer, 1000);
}

function stopGmCombatTimer() {
  if (combatTimerInterval) { clearInterval(combatTimerInterval); combatTimerInterval = null; }
  _saveCombatTimer(null);
  _setCombatTimerUI(false, false);
}

function restoreGmCombatTimer() {
  const st = _getCombatTimer();
  if (!st) return;
  if (st.paused) {
    const display = document.querySelector('#combat-timer-display');
    if (display) {
      display.textContent = formatGmTimer(st.totalSeconds);
      display.style.color = st.totalSeconds <= 10 ? 'var(--accent-red)' : 'var(--accent-orange)';
    }
    _setCombatTimerUI(true, true);
  } else {
    const elapsed = Math.floor((Date.now() - st.startedAt) / 1000);
    const remaining = st.totalSeconds - elapsed;
    if (remaining <= 0) {
      _saveCombatTimer(null);
      return;
    }
    _setCombatTimerUI(true, false);
    _tickCombatTimer();
    combatTimerInterval = setInterval(_tickCombatTimer, 1000);
  }
}

function sendPlayerTimer(charId, seconds) {
  if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
    ws.ws.send(JSON.stringify({
      type: 'gm.timer',
      character_id: charId,
      duration_seconds: seconds,
    }));
  }
  showToast(`Timer ${formatGmTimer(seconds)} sent to player`);
}

function sendPlayerTimerStop(charId) {
  if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
    ws.ws.send(JSON.stringify({
      type: 'gm.timer_stop',
      character_id: charId,
    }));
  }
}

// ── Detail panel timer (localStorage-backed) ──
let detailTimerInterval = null;

function _saveDetailTimer(state) {
  if (state) localStorage.setItem('gm-detail-timer', JSON.stringify(state));
  else localStorage.removeItem('gm-detail-timer');
}
function _getDetailTimer() {
  try { return JSON.parse(localStorage.getItem('gm-detail-timer')); } catch { return null; }
}

function _setDetailTimerUI(running, paused) {
  const startBtn = document.querySelector('#btn-gm-detail-timer-start');
  const pauseBtn = document.querySelector('#btn-gm-detail-timer-pause');
  const resumeBtn = document.querySelector('#btn-gm-detail-timer-resume');
  const stopBtn = document.querySelector('#btn-gm-detail-timer-stop');
  const input = document.querySelector('#gm-detail-timer-min');
  const display = document.querySelector('#gm-detail-timer-display');
  if (!startBtn) return;
  if (running) {
    startBtn.style.display = 'none';
    input.style.display = 'none';
    stopBtn.style.display = '';
    display.style.display = '';
    pauseBtn.style.display = paused ? 'none' : '';
    resumeBtn.style.display = paused ? '' : 'none';
  } else {
    startBtn.style.display = '';
    input.style.display = '';
    pauseBtn.style.display = 'none';
    resumeBtn.style.display = 'none';
    stopBtn.style.display = 'none';
    display.style.display = 'none';
    display.style.animation = '';
  }
}

function _tickDetailTimer() {
  const st = _getDetailTimer();
  if (!st || st.paused) return;
  const elapsed = Math.floor((Date.now() - st.startedAt) / 1000);
  const remaining = Math.max(0, st.totalSeconds - elapsed);
  const display = document.querySelector('#gm-detail-timer-display');
  if (!display) return;
  display.textContent = formatGmTimer(remaining);
  display.style.color = remaining <= 10 ? 'var(--accent-red)' : 'var(--accent-orange)';
  if (remaining <= 0) {
    clearInterval(detailTimerInterval);
    detailTimerInterval = null;
    display.textContent = '⏰ TIME UP!';
    display.style.animation = 'pulse 0.5s ease-in-out 3';
    _saveDetailTimer(null);
    setTimeout(() => _setDetailTimerUI(false, false), 4000);
  }
}

function startDetailTimer(charId, seconds) {
  if (detailTimerInterval) clearInterval(detailTimerInterval);
  _saveDetailTimer({ totalSeconds: seconds, startedAt: Date.now(), paused: false, charId });
  _setDetailTimerUI(true, false);
  _tickDetailTimer();
  detailTimerInterval = setInterval(_tickDetailTimer, 1000);
}

function pauseDetailTimer() {
  const st = _getDetailTimer();
  if (!st) return;
  if (detailTimerInterval) { clearInterval(detailTimerInterval); detailTimerInterval = null; }
  const elapsed = Math.floor((Date.now() - st.startedAt) / 1000);
  const remaining = Math.max(0, st.totalSeconds - elapsed);
  _saveDetailTimer({ ...st, totalSeconds: remaining, startedAt: Date.now(), paused: true });
  _setDetailTimerUI(true, true);
}

function resumeDetailTimer() {
  const st = _getDetailTimer();
  if (!st) return;
  _saveDetailTimer({ ...st, startedAt: Date.now(), paused: false });
  _setDetailTimerUI(true, false);
  _tickDetailTimer();
  detailTimerInterval = setInterval(_tickDetailTimer, 1000);
}

function stopDetailTimer() {
  if (detailTimerInterval) { clearInterval(detailTimerInterval); detailTimerInterval = null; }
  _saveDetailTimer(null);
  _setDetailTimerUI(false, false);
}

function restoreDetailTimer() {
  const st = _getDetailTimer();
  if (!st) return;
  if (st.paused) {
    const display = document.querySelector('#gm-detail-timer-display');
    if (display) {
      display.textContent = formatGmTimer(st.totalSeconds);
      display.style.color = st.totalSeconds <= 10 ? 'var(--accent-red)' : 'var(--accent-orange)';
    }
    _setDetailTimerUI(true, true);
  } else {
    const elapsed = Math.floor((Date.now() - st.startedAt) / 1000);
    const remaining = st.totalSeconds - elapsed;
    if (remaining <= 0) { _saveDetailTimer(null); return; }
    _setDetailTimerUI(true, false);
    _tickDetailTimer();
    detailTimerInterval = setInterval(_tickDetailTimer, 1000);
  }
}

// ══════════════════════════════════════════════════════════════
// FLOATING DICE ROLL LOG
// ══════════════════════════════════════════════════════════════
let rollLogEntries = [];
let rollLogCollapsed = false;
let rollLogUnread = 0;

function addRollLogEntry(data) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  rollLogEntries.unshift({ ...data, time });
  if (rollLogEntries.length > 50) rollLogEntries.pop();
  if (rollLogCollapsed) {
    rollLogUnread++;
    const badge = document.querySelector('#roll-log-count');
    if (badge) { badge.textContent = rollLogUnread; badge.style.display = 'inline'; }
  }
  renderRollLog();
}

function renderRollLog() {
  const body = document.querySelector('#roll-log-body');
  if (!body) return;
  if (!rollLogEntries.length) {
    body.innerHTML = '<div style="color:var(--text-muted);font-size:0.75rem;text-align:center;padding:12px 0">Rolls from players will appear here...</div>';
    return;
  }
  body.innerHTML = rollLogEntries.map(e => {
    const statColors = {
      strength: '#e53935', dexterity: '#43a047', constitution: '#fb8c00',
      intelligence: '#1e88e5', wisdom: '#8e24aa', charisma: '#e91e63',
    };
    const color = statColors[e.stat] || 'var(--accent)';
    const rollTypeLabel = (e.roll_type || '').replace(/_/g, ' ');
    const isNat20 = e.d20 === 20;
    const isNat1 = e.d20 === 1;
    const highlight = isNat20 ? 'background:#4caf5030;border-left:3px solid #4caf50' :
                      isNat1 ? 'background:#f4433630;border-left:3px solid #f44336' :
                      'border-left:3px solid var(--border)';
    return `
      <div style="padding:6px 8px;margin-bottom:4px;border-radius:var(--r-md);${highlight}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:700;font-size:0.82rem">${e.character_name || '?'}</span>
          <span style="font-size:0.6rem;color:var(--text-muted)">${e.time}</span>
        </div>
        <div style="font-size:0.75rem;margin-top:2px">
          <span style="color:${color};font-weight:600">${(e.stat || '').charAt(0).toUpperCase() + (e.stat || '').slice(1)}</span>
          <span style="color:var(--text-muted)"> ${rollTypeLabel}</span>
        </div>
        <div style="font-size:0.9rem;font-weight:700;margin-top:2px">
          D20(<span style="color:${isNat20 ? '#4caf50' : isNat1 ? '#f44336' : 'var(--text-primary)'}">${e.d20}</span>)
          ${e.modifier >= 0 ? '+' : ''}${e.modifier}
          = <span style="font-size:1rem;color:${color}">${e.total}</span>
          ${isNat20 ? ' <span style="color:#4caf50;font-size:0.7rem">NAT 20!</span>' : ''}
          ${isNat1 ? ' <span style="color:#f44336;font-size:0.7rem">NAT 1!</span>' : ''}
        </div>
      </div>
    `;
  }).join('');
}

// Toggle collapse
document.querySelector('#roll-log-header')?.addEventListener('click', () => {
  rollLogCollapsed = !rollLogCollapsed;
  const body = document.querySelector('#roll-log-body');
  const btn = document.querySelector('#roll-log-toggle');
  if (body) body.style.display = rollLogCollapsed ? 'none' : 'block';
  if (btn) btn.textContent = rollLogCollapsed ? '▲' : '▼';
  if (!rollLogCollapsed) {
    rollLogUnread = 0;
    const badge = document.querySelector('#roll-log-count');
    if (badge) badge.style.display = 'none';
  }
});

// WS listener for characteristic rolls (only from players, not GM's own)
let lastGmRollTime = 0;
ws.on('roll.characteristic', d => {
  if (d.description) {
    // Avoid duplicating GM's own rolls already added locally
    const isDuplicate = rollLogEntries.length > 0
      && rollLogEntries[0].character_id === d.character_id
      && rollLogEntries[0].d20 === d.d20
      && rollLogEntries[0].total === d.total
      && (Date.now() - lastGmRollTime) < 2000;
    if (!isDuplicate) {
      addLog('roll', d.description);
      addRollLogEntry(d);
    }
  }
});

// FIX 4: Free rolls from players appear in the GM's Roll Log
// (server only forwards here when private=false)
ws.on('roll.free_roll', d => {
  const who = d.character_name || `Character #${d.character_id}`;
  addLog('roll', `🎲 ${who}: ${d.breakdown}`);
});

// WS listeners for combat
ws.on('combat.initiative_submitted', d => {
  if (activeCombat) {
    showToast(`${d.character_id} submitted initiative: ${d.roll} (total: ${d.final})`);
    loadCombatPanel();
  }
});

// ══════════════════════════════════════════════════════════════
// Combat FX — mirror of the player-side helper. Plays hit / miss /
// crit / fumble / heal animations on the GM's map canvas whenever
// any combat resolution is broadcast. Two event shapes feed through:
// the legacy `combat.attack_result` where data might be either at
// top-level OR nested under `d.data` (see gm-app.js line 4438), and
// the newer flat shape used by the ability flow.
// ══════════════════════════════════════════════════════════════
function _playCombatFxFromPayloadGM(raw) {
  if (!raw) return;
  const d = raw.data && typeof raw.data === 'object' ? raw.data : raw;
  const targetId = d.target_id ?? d.defender_id;
  if (targetId == null || !mapCanvas) return;
  const dmg = d.final_damage ?? d.damage ?? null;
  const ar  = d.attack_roll || {};
  const hit = d.hit ?? ar.hit;
  const crit = d.critical ?? ar.critical;
  const fumble = d.fumble ?? ar.fumble;
  let type, text;
  if (fumble)       { type = 'fumble'; text = 'FUMBLE'; }
  else if (!hit)    { type = 'miss';   text = 'MISS'; }
  else if (crit)    { type = 'crit';   text = dmg != null ? `-${dmg}` : 'CRIT!'; }
  else              { type = 'hit';    text = dmg != null ? `-${dmg}` : 'HIT'; }
  mapCanvas.playFxOnCharacter(targetId, type, { text, screenShake: crit });
}

// Stage 11: Combat action WS events for GM
ws.on('combat.attack_result', d => {
  _playCombatFxFromPayloadGM(d);
  if (activeCombat) {
    showToast(`⚔️ ${d.attacker_name} → ${d.target_name}: ${d.attack_roll?.hit ? 'HIT' : 'MISS'}`);
    appendCombatLogEntry(d);
    loadCombatPanel();
  }
});
ws.on('combat.hit_result', d => {
  // Only fire FX for miss/fumble — a hit will also trigger an
  // attack_result with the damage, and we don't want to double-ring.
  if (d && !d.hit) _playCombatFxFromPayloadGM(d);
});
ws.on('combat.ability_result', d => {
  _playCombatFxFromPayloadGM(d);
  if (d && d.attacker_name && d.target_name) {
    showToast(`✨ ${d.attacker_name} → ${d.target_name}: ${d.critical ? 'CRIT!' : (d.hit ? 'HIT' : (d.fumble ? 'FUMBLE' : 'MISS'))}`);
  }
});
ws.on('combat.defend', d => {
  if (activeCombat) {
    showToast(`🛡️ ${d.character_name} defends`);
    appendCombatLogEntry({ description: d.description, attack_roll: { defend: true } });
    loadCombatPanel();
  }
});
ws.on('combat.character_killed', d => {
  if (activeCombat) {
    showToast(`💀 ${d.character_name} has been slain!`);
  }
});

// Auto-update open NPC floating panels on relevant WS events
ws.on('combat.attack_result', () => _updateAllNpcPanels());
ws.on('combat.hit_result', () => _updateAllNpcPanels());
ws.on('combat.ability_result', () => _updateAllNpcPanels());
ws.on('combat.defend', () => _updateAllNpcPanels());
ws.on('combat.defense_resolved', () => _updateAllNpcPanels());
ws.on('character.updated', () => _updateAllNpcPanels());
ws.on('map.updated', () => _updateAllNpcPanels());
ws.on('status.update', d => {
  if (d && d.character_id && npcPanels[d.character_id]) _loadNpcPanelStatuses(d.character_id);
});
ws.on('inventory.update', d => {
  if (d && d.character_id && npcPanels[d.character_id]) {
    _loadNpcPanelWeapon(d.character_id);
    _loadNpcPanelItems(d.character_id);
  }
});

// ══════════════════════════════════════════════════════════════
// DEFENSE REACTION SYSTEM (GM side)
// ══════════════════════════════════════════════════════════════
function showGmDefenseModal(data) {
  if (document.getElementById(`gm-defense-modal-${data.pending_defense_id}`)) return;
  const overlay = document.createElement('div');
  overlay.id = `gm-defense-modal-${data.pending_defense_id}`;
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:380px;text-align:center">
      <h3 style="margin-top:0">🛡️ Defense Reaction</h3>
      <div style="margin:8px 0;font-size:0.9rem">
        <strong>${data.attacker_name}</strong> attacks <strong>${data.target_name}</strong>!<br>
        <span style="color:var(--text-muted)">Roll: ${data.attack_total} vs AC ${data.target_ac}</span>
      </div>
      <!-- Dice mode + count (only applies to dodge/brace) -->
      <div id="gm-def-dice-ctrl" style="display:flex;align-items:center;gap:8px;justify-content:center;margin:10px 0;font-size:0.78rem">
        <span style="color:var(--text-muted)">Mode:</span>
        <div class="adv-toggle" id="gm-def-adv">
          <button data-mode="disadvantage">Disadv</button>
          <button data-mode="normal" class="active">Normal</button>
          <button data-mode="advantage">Adv</button>
        </div>
        <div style="display:inline-flex;align-items:center;gap:4px">
          <span style="color:var(--text-muted)">🎲×</span>
          <button type="button" class="btn btn-ghost btn-xs" id="gm-def-dice-minus" style="padding:0 6px">−</button>
          <span id="gm-def-dice-count" style="font-weight:600;min-width:12px;text-align:center">1</span>
          <button type="button" class="btn btn-ghost btn-xs" id="gm-def-dice-plus" style="padding:0 6px">+</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
        <button class="btn btn-primary btn-sm" id="gm-def-ac">🛡️ Accept on AC (${data.target_ac})</button>
        <button class="btn btn-ghost btn-sm" id="gm-def-dex">💨 Dodge (d20 + DEX)</button>
        <button class="btn btn-ghost btn-sm" id="gm-def-con">🧱 Brace (d20 + CON)</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // --- dice controls state ---
  let defState = { advantageMode: 'normal', diceCount: 1 };
  function _renderDefDice() {
    const host = overlay.querySelector('#gm-def-adv');
    if (!host) return;
    host.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === defState.advantageMode);
    });
    overlay.querySelector('#gm-def-dice-count').textContent = defState.diceCount;
  }
  overlay.querySelectorAll('#gm-def-adv button').forEach(b => {
    b.addEventListener('click', () => {
      defState.advantageMode = b.dataset.mode;
      if (defState.advantageMode !== 'normal' && defState.diceCount < 2) defState.diceCount = 2;
      _renderDefDice();
    });
  });
  overlay.querySelector('#gm-def-dice-minus').addEventListener('click', () => {
    const min = defState.advantageMode === 'normal' ? 1 : 2;
    defState.diceCount = Math.max(min, defState.diceCount - 1);
    _renderDefDice();
  });
  overlay.querySelector('#gm-def-dice-plus').addEventListener('click', () => {
    defState.diceCount = Math.min(20, defState.diceCount + 1);
    _renderDefDice();
  });

  async function resolve(mode) {
    overlay.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      const payload = { mode };
      if (mode !== 'ac') {
        payload.dice_count = defState.diceCount;
        payload.advantage = defState.advantageMode;
      }
      const res = await api.post(`/api/combat/defense/${data.pending_defense_id}/resolve`, payload);
      let msg = res.success
        ? `✅ Defense succeeded! ${res.defense_breakdown} ≥ ${res.attack_total}`
        : `❌ Defense failed. ${res.defense_breakdown} < ${res.attack_total}`;
      overlay.querySelector('.modal-content').innerHTML = `<div style="padding:12px;font-weight:700">${msg}</div>`;
      setTimeout(() => overlay.remove(), 1500);
    } catch (e) {
      const d = e?.body?.detail;
      overlay.querySelector('.modal-content').innerHTML = `<div style="color:var(--accent-red);padding:12px">${typeof d === 'object' ? (d.message || JSON.stringify(d)) : (d || 'Failed')}</div>`;
      setTimeout(() => overlay.remove(), 2000);
    }
  }

  overlay.querySelector('#gm-def-ac').addEventListener('click', () => resolve('ac'));
  overlay.querySelector('#gm-def-dex').addEventListener('click', () => resolve('dodge_dex'));
  overlay.querySelector('#gm-def-con').addEventListener('click', () => resolve('dodge_con'));
}

ws.on('combat.defense_request', d => {
  const target = characters.find(c => c.id === d.target_id);
  // If target is an NPC, GM must choose defense manually
  if (target && target.is_npc) {
    showGmDefenseModal(d);
  } else {
    // Player target — show a lightweight waiting toast
    showToast(`⏳ ${d.target_name} is choosing defense vs ${d.attacker_name}...`);
  }
});

ws.on('combat.defense_resolved', d => {
  document.querySelectorAll('.gm-defense-waiting-banner').forEach(e => e.remove());
  document.querySelectorAll(`.modal-overlay`).forEach(e => {
    if (e.id === `gm-defense-modal-${d.id}`) e.remove();
  });
  // Map FX
  if (typeof mapCanvas !== 'undefined' && mapCanvas) {
    mapCanvas.playFxOnCharacter(d.target_id, 'defended', {
      text: d.success ? 'DEFENDED!' : 'HIT',
      color: d.success ? '#48aaff' : '#ff4848',
    });
  }
  if (d.success) {
    showToast(`🛡️ ${d.target_name} defended against ${d.attacker_name}! ${d.defense_breakdown}`);
    addLog('gm.combat', `🛡️ Defense success: ${d.target_name} — ${d.defense_breakdown} vs ${d.attack_total}`);
  } else {
    showToast(`💥 ${d.target_name} failed defense vs ${d.attacker_name}. ${d.defense_breakdown}`);
    addLog('gm.combat', `💥 Defense failed: ${d.target_name} — ${d.defense_breakdown} vs ${d.attack_total}`);
  }

  // Resume NPC floating-panel attack flow (this NPC was the attacker)
  const ctx = npcPanels[d.attacker_id];
  if (ctx && ctx.hitData && ctx.hitData.pending_defense_id === d.id) {
    if (d.success) {
      // Defense succeeded → no damage step; reset panel UI
      const panelEl = ctx.el;
      const hitWrap = panelEl.querySelector(`[data-npc-panel-hit="${d.attacker_id}"]`);
      const dmgWrap = panelEl.querySelector(`[data-npc-panel-damage="${d.attacker_id}"]`);
      if (hitWrap) hitWrap.style.display = 'flex';
      if (dmgWrap) dmgWrap.style.display = 'none';
      _showNpcPanelResult(d.attacker_id, `<div style="color:var(--accent)">🛡️ ${d.target_name} defended (${d.defense_breakdown||''})</div>`);
      ctx.hitData = null;
    } else {
      // Defense failed → reveal damage step
      _revealDmgStep(ctx.el, d.attacker_id, ctx.hitData);
    }
  }
});

// FIX 7: Player dismissed a trade modal → log to GM's roll log
ws.on('trade.dismissed', d => {
  const name = d.player_name || `Player #${d.player_id}`;
  const npc  = d.npc_name || 'merchant';
  addLog('gm.trade', `🤝 ${name} dismissed the trade with ${npc}`);
  showToast(`${name} dismissed the trade`);
});

// ══════════════════════════════════════════════════════════════
// STAGE 6 — RACES & CLASSES MANAGER
// ══════════════════════════════════════════════════════════════
let rcRaces = [];
let rcClasses = [];

async function loadRacesClasses() {
  try {
    const [rr, cc] = await Promise.all([
      api.get('/api/races-classes/races'),
      api.get('/api/races-classes/classes'),
    ]);
    rcRaces = rr;
    rcClasses = cc;
  } catch { rcRaces = []; rcClasses = []; }
  renderRCList();
}

function bonusLabel(b) {
  if (b.type === 'stat_bonus') return `+${b.value} ${(b.stat||'').slice(0,3).toUpperCase()}`;
  if (b.type === 'hp_bonus') return `+${b.value} HP`;
  if (b.type === 'initiative_bonus') return `+${b.value} Init`;
  if (b.type === 'damage_bonus') return `+${b.value} Dmg`;
  if (b.type === 'attack_bonus') return `+${b.value} Atk`;
  return `${b.type}: ${b.value}`;
}

function renderRCList() {
  const rList = document.querySelector('#rc-races-list');
  const cList = document.querySelector('#rc-classes-list');
  if (!rList || !cList) return;

  rList.innerHTML = rcRaces.length ? rcRaces.map(r => `
    <div style="padding:8px;border:1px solid var(--border);border-radius:var(--r-md);margin-bottom:6px;background:var(--bg-surface-2)${!r.is_available?';opacity:0.5':''}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700;font-size:0.85rem">${r.name}</span>
        <div style="display:flex;gap:4px;align-items:center">
          <span style="font-size:0.62rem;padding:1px 6px;border-radius:10px;background:rgba(200,60,60,0.22);color:#ff9494;font-weight:700" title="HP die rolled at creation and every level-up">${r.hp_dice_count || 1}d${r.hp_die || 8}</span>
          <button class="btn btn-ghost btn-xs" data-edit-race="${r.id}">✏️</button>
          <button class="btn btn-ghost btn-xs" data-del-race="${r.id}" style="color:var(--accent-red)">🗑</button>
        </div>
      </div>
      <div style="font-size:0.7rem;color:var(--text-muted);margin:2px 0">${r.description}</div>
      <div>${(r.bonuses||[]).map(b => `<span style="display:inline-block;font-size:0.6rem;padding:1px 5px;border-radius:8px;background:var(--accent)20;color:var(--accent);margin-right:2px">${bonusLabel(b)}</span>`).join('')}</div>
      ${!r.is_available ? '<div style="font-size:0.6rem;color:var(--accent-red)">Hidden from players</div>' : ''}
    </div>
  `).join('') : '<span class="text-muted" style="font-size:0.8rem">No races. Click "Seed Defaults" or create one.</span>';

  // Rework v2: internal table still "classes" but UI reads "Professions"
  cList.innerHTML = rcClasses.length ? rcClasses.map(c => `
    <div style="padding:8px;border:1px solid var(--border);border-radius:var(--r-md);margin-bottom:6px;background:var(--bg-surface-2)${!c.is_available?';opacity:0.5':''}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700;font-size:0.85rem">${c.name}</span>
        <div style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-xs" data-edit-class="${c.id}">✏️</button>
          <button class="btn btn-ghost btn-xs" data-del-class="${c.id}" style="color:var(--accent-red)">🗑</button>
        </div>
      </div>
      <div style="font-size:0.7rem;color:var(--text-muted);margin:2px 0">${c.description}</div>
      <div>${(c.bonuses||[]).map(b => `<span style="display:inline-block;font-size:0.6rem;padding:1px 5px;border-radius:8px;background:var(--accent)20;color:var(--accent);margin-right:2px">${bonusLabel(b)}</span>`).join('')}</div>
      ${!c.is_available ? '<div style="font-size:0.6rem;color:var(--accent-red)">Hidden from players</div>' : ''}
    </div>
  `).join('') : '<span class="text-muted" style="font-size:0.8rem">No professions. Click "Seed Defaults" or create one.</span>';

  // Wire edit/delete
  rList.querySelectorAll('[data-edit-race]').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = rcRaces.find(x => x.id === parseInt(btn.dataset.editRace));
      if (r) openRCEditorModal('race', r);
    });
  });
  rList.querySelectorAll('[data-del-race]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this race?')) return;
      await api.del(`/api/races-classes/races/${btn.dataset.delRace}`);
      loadRacesClasses();
    });
  });
  cList.querySelectorAll('[data-edit-class]').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = rcClasses.find(x => x.id === parseInt(btn.dataset.editClass));
      if (c) openRCEditorModal('class', c);
    });
  });
  cList.querySelectorAll('[data-del-class]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this class?')) return;
      await api.del(`/api/races-classes/classes/${btn.dataset.delClass}`);
      loadRacesClasses();
    });
  });
}

function openRCEditorModal(kind, existing) {
  const isEdit = !!existing;
  const kindLabel = kind === 'race' ? 'Race' : 'Profession';   // Rework v2 UI rename
  const title = isEdit ? `Edit ${kindLabel}` : `Create ${kindLabel}`;
  const data = existing || { name: '', description: '', bonuses: [], special_abilities: [], is_available: true,
                             hp_die: 8, hp_dice_count: 1 };

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:480px">
      <div class="modal-header"><h3>${title}</h3><button class="modal-close">&times;</button></div>
      <div class="modal-body">
        <div class="form-group"><label>Name</label><input type="text" id="rc-ed-name" value="${data.name}"></div>
        <div class="form-group"><label>Description</label><textarea id="rc-ed-desc" rows="2" style="width:100%;resize:vertical">${data.description}</textarea></div>
        ${kind === 'race' ? `
          <div class="form-group" style="display:flex;gap:10px;align-items:flex-end">
            <div style="flex:1">
              <label title="Rolled at creation and on every level-up">HP Die</label>
              <select id="rc-ed-hpdie">
                ${[4,6,8,10,12].map(d => `<option value="${d}"${(data.hp_die||8)===d?' selected':''}>d${d}</option>`).join('')}
              </select>
            </div>
            <div style="flex:1">
              <label>HP Dice Count</label>
              <input type="number" id="rc-ed-hpcount" min="1" max="5" value="${data.hp_dice_count || 1}">
            </div>
          </div>` : ''}
        <div class="form-group">
          <label>Bonuses</label>
          <div id="rc-ed-bonuses"></div>
          <button class="btn btn-ghost btn-xs" id="rc-ed-add-bonus" style="margin-top:4px">+ Add Bonus</button>
        </div>
        <div class="form-group">
          <label>Special Abilities (text)</label>
          <div id="rc-ed-abilities"></div>
          <button class="btn btn-ghost btn-xs" id="rc-ed-add-ability" style="margin-top:4px">+ Add Ability</button>
        </div>
        <div class="form-group" style="display:flex;align-items:center;gap:8px">
          <label class="toggle-switch"><input type="checkbox" id="rc-ed-available" ${data.is_available?'checked':''}><span class="slider"></span></label>
          <span style="font-size:0.8rem">Available to players</span>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="rc-ed-cancel">Cancel</button>
        <button class="btn btn-primary" id="rc-ed-save">${isEdit ? 'Save' : 'Create'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const bonusCont = overlay.querySelector('#rc-ed-bonuses');
  const abilityCont = overlay.querySelector('#rc-ed-abilities');
  let bonuses = [...(data.bonuses || [])];
  let abilities = [...(data.special_abilities || [])];

  function renderBonuses() {
    bonusCont.innerHTML = bonuses.map((b, i) => `
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:3px">
        <select data-bi="${i}" data-field="type" style="font-size:0.75rem;width:120px">
          <option value="stat_bonus"${b.type==='stat_bonus'?' selected':''}>Stat Bonus</option>
          <option value="hp_bonus"${b.type==='hp_bonus'?' selected':''}>HP Bonus</option>
          <option value="initiative_bonus"${b.type==='initiative_bonus'?' selected':''}>Initiative</option>
          <option value="attack_bonus"${b.type==='attack_bonus'?' selected':''}>Attack</option>
          <option value="damage_bonus"${b.type==='damage_bonus'?' selected':''}>Damage</option>
        </select>
        ${b.type === 'stat_bonus' ? `<select data-bi="${i}" data-field="stat" style="font-size:0.75rem;width:90px">
          ${['strength','dexterity','constitution','intelligence','wisdom','charisma'].map(s => `<option value="${s}"${b.stat===s?' selected':''}>${s.slice(0,3).toUpperCase()}</option>`).join('')}
        </select>` : ''}
        <input type="number" data-bi="${i}" data-field="value" value="${b.value||0}" style="width:50px;font-size:0.75rem">
        <button class="btn btn-ghost btn-xs" data-remove-bonus="${i}" style="color:var(--accent-red)">✕</button>
      </div>
    `).join('');
    bonusCont.querySelectorAll('[data-bi]').forEach(el => {
      el.addEventListener('change', () => {
        const i = parseInt(el.dataset.bi);
        const f = el.dataset.field;
        bonuses[i][f] = f === 'value' ? parseInt(el.value) || 0 : el.value;
        if (f === 'type') renderBonuses();
      });
    });
    bonusCont.querySelectorAll('[data-remove-bonus]').forEach(btn => {
      btn.addEventListener('click', () => { bonuses.splice(parseInt(btn.dataset.removeBonus), 1); renderBonuses(); });
    });
  }

  function renderAbilities() {
    abilityCont.innerHTML = abilities.map((a, i) => `
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:3px">
        <input type="text" data-ai="${i}" value="${a}" style="flex:1;font-size:0.75rem">
        <button class="btn btn-ghost btn-xs" data-remove-ability="${i}" style="color:var(--accent-red)">✕</button>
      </div>
    `).join('');
    abilityCont.querySelectorAll('[data-ai]').forEach(el => {
      el.addEventListener('change', () => { abilities[parseInt(el.dataset.ai)] = el.value; });
    });
    abilityCont.querySelectorAll('[data-remove-ability]').forEach(btn => {
      btn.addEventListener('click', () => { abilities.splice(parseInt(btn.dataset.removeAbility), 1); renderAbilities(); });
    });
  }

  renderBonuses();
  renderAbilities();

  overlay.querySelector('#rc-ed-add-bonus').addEventListener('click', () => {
    bonuses.push({ type: 'stat_bonus', stat: 'strength', value: 1 });
    renderBonuses();
  });
  overlay.querySelector('#rc-ed-add-ability').addEventListener('click', () => {
    abilities.push('New ability');
    renderAbilities();
  });

  overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#rc-ed-cancel').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#rc-ed-save').addEventListener('click', async () => {
    const body = {
      name: overlay.querySelector('#rc-ed-name').value.trim(),
      description: overlay.querySelector('#rc-ed-desc').value.trim(),
      bonuses,
      special_abilities: abilities.filter(a => a.trim()),
      is_available: overlay.querySelector('#rc-ed-available').checked,
    };
    if (!body.name) return;

    if (kind === 'race') {
      body.hp_die = parseInt(overlay.querySelector('#rc-ed-hpdie')?.value) || 8;
      body.hp_dice_count = Math.max(1, Math.min(5, parseInt(overlay.querySelector('#rc-ed-hpcount')?.value) || 1));
    }

    if (isEdit) {
      await api.put(`/api/races-classes/${kind === 'race' ? 'races' : 'classes'}/${existing.id}`, body);
    } else {
      await api.post(`/api/races-classes/${kind === 'race' ? 'races' : 'classes'}`, body);
    }
    overlay.remove();
    loadRacesClasses();
  });
}

// ══════════════════════════════════════════════════════════════
// STAGE 8 — QUEST SYSTEM
// ══════════════════════════════════════════════════════════════
let questTemplates = [];
let activeQuests = [];

async function loadQuests() {
  try {
    const sess = await api.get(`/api/sessions/${SESSION_CODE}`);
    const [tpls, quests] = await Promise.all([
      api.get(`/api/quest-templates?session_id=${sess.id}`),
      api.get(`/api/quests/session/${SESSION_CODE}`),
    ]);
    questTemplates = tpls;
    activeQuests = quests;
    renderQuestTemplates();
    renderActiveQuests();
  } catch (e) { console.error('loadQuests error', e); }
}

function renderQuestTemplates() {
  const panel = $('#quest-templates-panel');
  if (!panel) return;
  if (!questTemplates.length) {
    panel.innerHTML = '<p class="text-muted" style="font-size:0.8rem">No quest templates yet. Click "+ Quest Template" to create one.</p>';
    return;
  }
  panel.innerHTML = questTemplates.map(t => {
    const stages = t.stages || [];
    const stageLabel = stages.length ? `${stages.length} stage${stages.length > 1 ? 's' : ''}` : 'No stages';
    return `
      <div style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--r-md);margin-bottom:6px;background:var(--bg-surface)">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <span style="font-weight:700;font-size:0.85rem">📜 ${t.title}</span>
            <span style="font-size:0.65rem;color:var(--text-muted);margin-left:6px">${stageLabel}</span>
            ${t.reward_is_hidden ? '<span style="font-size:0.6rem;color:var(--accent-orange);margin-left:4px">🔒 Hidden Reward</span>' : ''}
          </div>
          <div style="display:flex;gap:4px">
            <button class="btn btn-primary btn-xs" onclick="openQuestAssignModal(${t.id})">📤 Assign</button>
            <button class="btn btn-ghost btn-xs" onclick="openQuestEditorModal(${t.id})">✏️</button>
            <button class="btn btn-danger btn-xs" onclick="deleteQuestTemplate(${t.id})">🗑️</button>
          </div>
        </div>
        ${t.description ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px">${t.description.substring(0, 100)}${t.description.length > 100 ? '...' : ''}</div>` : ''}
        ${t.reward_description ? `<div style="font-size:0.7rem;margin-top:3px;color:var(--accent)">Reward: ${t.reward_is_hidden ? '???' : t.reward_description}</div>` : ''}
      </div>
    `;
  }).join('');
}

function renderActiveQuests() {
  const panel = $('#quest-active-panel');
  if (!panel) return;
  const active = activeQuests.filter(q => q.status === 'active');
  const completed = activeQuests.filter(q => q.status === 'completed');
  const failed = activeQuests.filter(q => q.status === 'failed');

  if (!activeQuests.length) {
    panel.innerHTML = '<p class="text-muted" style="font-size:0.8rem">No quests assigned yet.</p>';
    return;
  }

  let html = '';

  if (active.length) {
    html += '<div style="font-size:0.8rem;font-weight:700;margin-bottom:6px">Active Quests</div>';
    html += active.map(q => renderQuestRow(q)).join('');
  }

  if (completed.length) {
    html += `<details style="margin-top:10px"><summary style="font-size:0.8rem;font-weight:700;cursor:pointer;color:var(--accent)">✅ Completed (${completed.length})</summary>`;
    html += completed.map(q => renderQuestRow(q)).join('');
    html += '</details>';
  }

  if (failed.length) {
    html += `<details style="margin-top:10px"><summary style="font-size:0.8rem;font-weight:700;cursor:pointer;color:#f44336">❌ Failed (${failed.length})</summary>`;
    html += failed.map(q => renderQuestRow(q)).join('');
    html += '</details>';
  }

  panel.innerHTML = html;
}

function renderQuestRow(q) {
  const stagesCompleted = q.stages_completed || [];
  const statusColors = { active: 'var(--accent)', completed: '#4caf50', failed: '#f44336' };
  const statusIcons = { active: '🔵', completed: '✅', failed: '❌' };

  // Build stage chain if quest has stages (look up from template)
  const tpl = questTemplates.find(t => t.id === q.quest_template_id);
  const stages = tpl ? (tpl.stages || []) : [];

  let stageChain = '';
  if (stages.length > 0) {
    stageChain = stages.map((s, i) => {
      const done = stagesCompleted.includes(i);
      const current = i === q.current_stage && q.status === 'active';
      const style = done ? 'background:#4caf5030;color:#4caf50;border:1px solid #4caf50'
                   : current ? 'background:var(--accent)20;color:var(--accent);border:1px solid var(--accent)'
                   : 'background:var(--bg-surface-2);color:var(--text-muted);border:1px solid var(--border)';
      return `<span style="display:inline-block;padding:2px 6px;border-radius:8px;font-size:0.6rem;${style}" title="${s.title || ''}">${done ? '✓' : current ? '●' : '○'} ${i + 1}</span>`;
    }).join(' → ');
  }

  const buttons = q.status === 'active' ? `
    <div style="display:flex;gap:3px;margin-top:4px">
      ${stages.length > 0 ? `<button class="btn btn-ghost btn-xs" onclick="completeQuestStage(${q.id}, ${q.current_stage})">✅ Complete Stage ${q.current_stage + 1}</button>` : ''}
      <button class="btn btn-primary btn-xs" onclick="completeQuest(${q.id})">🏆 Complete Quest</button>
      <button class="btn btn-danger btn-xs" onclick="failQuest(${q.id})">❌ Fail</button>
    </div>
  ` : '';

  return `
    <div style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--r-md);margin-bottom:6px;background:var(--bg-surface);border-left:3px solid ${statusColors[q.status] || 'var(--border)'}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <span style="font-size:0.7rem;font-weight:700;color:var(--text-muted)">${q.character_name || ''}</span>
          <span style="font-weight:700;font-size:0.82rem;margin-left:6px">${statusIcons[q.status] || ''} ${q.title}</span>
        </div>
      </div>
      ${q.source_npc_name ? `<div style="font-size:0.7rem;color:var(--text-muted)">From: ${q.source_npc_name}</div>` : ''}
      ${stageChain ? `<div style="margin-top:4px;display:flex;gap:2px;align-items:center;flex-wrap:wrap">${stageChain}</div>` : ''}
      ${buttons}
    </div>
  `;
}

async function completeQuestStage(questId, stageIndex) {
  try {
    await api.patch(`/api/character-quests/${questId}/complete-stage`, { stage_index: stageIndex });
    addLog('gm.quest', `Completed stage ${stageIndex + 1} of quest #${questId}`);
    // WS broadcast
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({ type: 'quest.stage_completed', quest_id: questId, stage_index: stageIndex }));
    }
    loadQuests();
  } catch (e) { showToast('Failed to complete stage'); }
}

async function completeQuest(questId) {
  if (!confirm('Complete this quest and grant rewards?')) return;
  try {
    await api.patch(`/api/character-quests/${questId}/complete`, {});
    addLog('gm.quest', `Quest #${questId} completed!`);
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({ type: 'quest.completed', quest_id: questId }));
    }
    loadQuests();
  } catch (e) { showToast('Failed to complete quest'); }
}

async function failQuest(questId) {
  if (!confirm('Mark this quest as failed?')) return;
  try {
    await api.patch(`/api/character-quests/${questId}/fail`, {});
    addLog('gm.quest', `Quest #${questId} failed`);
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({ type: 'quest.failed', quest_id: questId }));
    }
    loadQuests();
  } catch (e) { showToast('Failed to mark quest as failed'); }
}

async function deleteQuestTemplate(tplId) {
  if (!confirm('Delete this quest template?')) return;
  try {
    await api.del(`/api/quest-templates/${tplId}`);
    loadQuests();
  } catch (e) { showToast('Failed to delete template'); }
}

function openQuestEditorModal(tplId = null) {
  const existing = tplId ? questTemplates.find(t => t.id === tplId) : null;
  const npcs = characters.filter(c => c.is_npc);

  let stages = existing ? (existing.stages || []) : [];

  function renderStageRows() {
    return stages.map((s, i) => `
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:4px">
        <span style="font-size:0.7rem;font-weight:700;width:20px">${i + 1}.</span>
        <input type="text" class="quest-stage-title" data-idx="${i}" value="${s.title || ''}" placeholder="Stage title" style="flex:1;font-size:0.78rem">
        <input type="text" class="quest-stage-desc" data-idx="${i}" value="${s.description || ''}" placeholder="Description" style="flex:2;font-size:0.78rem">
        <button class="btn btn-danger btn-xs" onclick="this.closest('div').remove(); document.querySelector('#quest-stage-list').querySelectorAll('.quest-stage-title').forEach((el,j) => el.closest('div').querySelector('span').textContent = (j+1)+'.')">×</button>
      </div>
    `).join('');
  }

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="width:520px;max-height:90vh;overflow-y:auto">
      <h2 style="margin-bottom:12px">${existing ? 'Edit' : 'Create'} Quest Template</h2>
      <div style="display:flex;flex-direction:column;gap:8px">
        <input type="text" id="qt-title" value="${existing ? existing.title : ''}" placeholder="Quest title" style="font-size:0.85rem;font-weight:700">
        <textarea id="qt-desc" placeholder="Description" rows="3" style="font-size:0.78rem">${existing ? existing.description : ''}</textarea>

        <label style="font-size:0.75rem;font-weight:600">Source NPC</label>
        <select id="qt-npc" style="font-size:0.78rem">
          <option value="">— None —</option>
          ${npcs.map(n => `<option value="${n.id}" ${existing && existing.source_npc_id === n.id ? 'selected' : ''}>${n.name}</option>`).join('')}
        </select>

        <label style="font-size:0.75rem;font-weight:600">Stages</label>
        <div id="quest-stage-list">${renderStageRows()}</div>
        <button class="btn btn-ghost btn-xs" id="btn-qt-add-stage" style="align-self:flex-start">+ Add Stage</button>

        <hr style="border-color:var(--border)">
        <label style="font-size:0.75rem;font-weight:600">Rewards</label>
        <div style="display:flex;gap:6px;align-items:center">
          <label style="font-size:0.72rem">Gold (copper):</label>
          <input type="number" id="qt-gold" value="${existing ? (existing.reward_gold_bronze ?? existing.reward_gold_copper ?? 0) : 0}" style="width:80px;font-size:0.78rem">
        </div>
        <input type="text" id="qt-reward-desc" value="${existing ? existing.reward_description : ''}" placeholder="Reward description (shown to player)" style="font-size:0.78rem">
        <label style="font-size:0.72rem;display:flex;align-items:center;gap:4px">
          <input type="checkbox" id="qt-hidden" ${existing && existing.reward_is_hidden ? 'checked' : ''}>
          Hidden reward (player sees "???")
        </label>

        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-primary btn-sm" id="btn-qt-save" style="flex:1">${existing ? 'Save' : 'Create'}</button>
          <button class="btn btn-ghost btn-sm" id="btn-qt-cancel" style="flex:1">Cancel</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#btn-qt-add-stage').addEventListener('click', () => {
    const list = modal.querySelector('#quest-stage-list');
    const idx = list.querySelectorAll('.quest-stage-title').length;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:4px;align-items:center;margin-bottom:4px';
    row.innerHTML = `
      <span style="font-size:0.7rem;font-weight:700;width:20px">${idx + 1}.</span>
      <input type="text" class="quest-stage-title" data-idx="${idx}" placeholder="Stage title" style="flex:1;font-size:0.78rem">
      <input type="text" class="quest-stage-desc" data-idx="${idx}" placeholder="Description" style="flex:2;font-size:0.78rem">
      <button class="btn btn-danger btn-xs" onclick="this.closest('div').remove()">×</button>
    `;
    list.appendChild(row);
  });

  modal.querySelector('#btn-qt-cancel').addEventListener('click', () => modal.remove());
  modal.querySelector('#btn-qt-save').addEventListener('click', async () => {
    const title = modal.querySelector('#qt-title').value.trim();
    if (!title) { showToast('Title required'); return; }
    const stageEls = modal.querySelectorAll('.quest-stage-title');
    const descEls = modal.querySelectorAll('.quest-stage-desc');
    const stagesData = [];
    stageEls.forEach((el, i) => {
      stagesData.push({ order: i + 1, title: el.value.trim(), description: descEls[i]?.value.trim() || '' });
    });

    const sess = await api.get(`/api/sessions/${SESSION_CODE}`);
    const payload = {
      session_id: sess.id,
      title,
      description: modal.querySelector('#qt-desc').value.trim(),
      source_npc_id: parseInt(modal.querySelector('#qt-npc').value) || null,
      reward_gold_bronze: parseInt(modal.querySelector('#qt-gold').value) || 0,
      reward_item_ids: [],
      reward_description: modal.querySelector('#qt-reward-desc').value.trim(),
      reward_is_hidden: modal.querySelector('#qt-hidden').checked,
      stages: stagesData,
      is_multi_stage: stagesData.length > 0,
    };

    try {
      if (existing) {
        await api.put(`/api/quest-templates/${existing.id}`, payload);
      } else {
        await api.post('/api/quest-templates', payload);
      }
      modal.remove();
      loadQuests();
    } catch (e) { showToast('Failed to save quest template'); }
  });
}

function openQuestAssignModal(tplId) {
  const tpl = questTemplates.find(t => t.id === tplId);
  if (!tpl) return;
  const players = characters.filter(c => !c.is_npc);

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="width:380px">
      <h2 style="margin-bottom:10px">Assign: ${tpl.title}</h2>
      <div style="font-size:0.78rem;margin-bottom:10px">Select players to receive this quest:</div>
      <div id="qa-players" style="display:flex;flex-direction:column;gap:4px;margin-bottom:12px">
        ${players.map(p => `
          <label style="display:flex;gap:6px;align-items:center;font-size:0.8rem;cursor:pointer">
            <input type="checkbox" value="${p.id}" checked> ${p.name}
          </label>
        `).join('')}
        ${!players.length ? '<span style="font-size:0.75rem;color:var(--text-muted)">No players in session</span>' : ''}
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" id="btn-qa-assign" style="flex:1">📤 Assign</button>
        <button class="btn btn-ghost btn-sm" id="btn-qa-cancel" style="flex:1">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#btn-qa-cancel').addEventListener('click', () => modal.remove());
  modal.querySelector('#btn-qa-assign').addEventListener('click', async () => {
    const checked = [...modal.querySelectorAll('#qa-players input:checked')].map(i => parseInt(i.value));
    if (!checked.length) { showToast('Select at least one player'); return; }
    try {
      const res = await api.post('/api/quests/assign', { template_id: tplId, character_ids: checked });
      addLog('gm.quest', `Assigned "${tpl.title}" to ${res.assigned.length} player(s)`);
      // WS notify each player
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        for (const a of res.assigned) {
          ws.ws.send(JSON.stringify({ type: 'quest.assigned', character_id: a.character_id, quest_title: tpl.title }));
        }
      }
      modal.remove();
      loadQuests();
    } catch (e) { showToast('Failed to assign quest'); }
  });
}

// Wire quest sub-tabs and buttons
document.querySelectorAll('.quest-sub').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.quest-sub').forEach(b => { b.classList.remove('active'); b.classList.add('btn-ghost'); });
    btn.classList.add('active');
    btn.classList.remove('btn-ghost');
    const sub = btn.dataset.qsub;
    $('#quest-active-panel').style.display = sub === 'active' ? 'block' : 'none';
    $('#quest-templates-panel').style.display = sub === 'templates' ? 'block' : 'none';
  });
});

$('#btn-quest-create')?.addEventListener('click', () => openQuestEditorModal());

// Quick Assign — choose template or create custom, then pick players
$('#btn-quest-assign-quick')?.addEventListener('click', () => openQuickAssignModal());

function openQuickAssignModal() {
  const players = characters.filter(c => !c.is_npc);
  if (!players.length) { showToast('No players in session'); return; }

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="width:480px;max-height:90vh;overflow-y:auto">
      <h2 style="margin-bottom:12px">📤 Assign Quest</h2>

      <!-- Source: template or custom -->
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <button class="btn btn-sm qa-src active" data-src="template" style="font-size:0.78rem">From Template</button>
        <button class="btn btn-sm btn-ghost qa-src" data-src="custom" style="font-size:0.78rem">Custom Quest</button>
      </div>

      <!-- Template picker -->
      <div id="qa-template-section">
        ${questTemplates.length ? `
          <select id="qa-tpl-select" style="width:100%;font-size:0.8rem;margin-bottom:8px">
            ${questTemplates.map(t => `<option value="${t.id}">${t.title} (${t.stages.length} stages)</option>`).join('')}
          </select>
          <div id="qa-tpl-preview" style="font-size:0.72rem;color:var(--text-muted);margin-bottom:10px"></div>
        ` : '<div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:10px">No templates. Create one first or use "Custom Quest".</div>'}
      </div>

      <!-- Custom quest fields -->
      <div id="qa-custom-section" style="display:none">
        <input type="text" id="qa-custom-title" placeholder="Quest title" style="width:100%;font-size:0.82rem;font-weight:700;margin-bottom:6px">
        <textarea id="qa-custom-desc" placeholder="Description" rows="2" style="width:100%;font-size:0.78rem;margin-bottom:6px"></textarea>
        <input type="text" id="qa-custom-npc" placeholder="Source NPC name (optional)" style="width:100%;font-size:0.78rem;margin-bottom:6px">
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <input type="number" id="qa-custom-gold" value="0" placeholder="Gold reward (copper)" style="width:100px;font-size:0.78rem">
          <input type="text" id="qa-custom-reward" placeholder="Reward description" style="flex:1;font-size:0.78rem">
        </div>
        <label style="font-size:0.72rem;display:flex;align-items:center;gap:4px;margin-bottom:8px">
          <input type="checkbox" id="qa-custom-hidden"> Hidden reward
        </label>
      </div>

      <!-- Player selection -->
      <div style="font-size:0.78rem;font-weight:700;margin-bottom:6px">Assign to:</div>
      <div id="qa-player-list" style="display:flex;flex-direction:column;gap:4px;margin-bottom:12px">
        <label style="font-size:0.75rem;cursor:pointer;display:flex;align-items:center;gap:4px;margin-bottom:4px">
          <input type="checkbox" id="qa-select-all" checked> <strong>Select All</strong>
        </label>
        ${players.map(p => `
          <label style="display:flex;gap:6px;align-items:center;font-size:0.8rem;cursor:pointer;padding-left:16px">
            <input type="checkbox" class="qa-player-cb" value="${p.id}" checked> ${p.name}
          </label>
        `).join('')}
      </div>

      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" id="btn-qa-go" style="flex:1">📤 Assign</button>
        <button class="btn btn-ghost btn-sm" id="btn-qa-close" style="flex:1">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Source tabs
  modal.querySelectorAll('.qa-src').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.querySelectorAll('.qa-src').forEach(b => { b.classList.remove('active'); b.classList.add('btn-ghost'); });
      btn.classList.add('active'); btn.classList.remove('btn-ghost');
      const src = btn.dataset.src;
      modal.querySelector('#qa-template-section').style.display = src === 'template' ? 'block' : 'none';
      modal.querySelector('#qa-custom-section').style.display = src === 'custom' ? 'block' : 'none';
    });
  });

  // Template preview
  const tplSelect = modal.querySelector('#qa-tpl-select');
  const preview = modal.querySelector('#qa-tpl-preview');
  function updatePreview() {
    if (!tplSelect || !preview) return;
    const t = questTemplates.find(x => x.id === parseInt(tplSelect.value));
    if (!t) { preview.textContent = ''; return; }
    preview.innerHTML = `${t.description ? t.description.substring(0, 120) : ''}<br>Reward: ${t.reward_is_hidden ? '🔒 Hidden' : (t.reward_description || 'None')}`;
  }
  tplSelect?.addEventListener('change', updatePreview);
  updatePreview();

  // Select all
  modal.querySelector('#qa-select-all')?.addEventListener('change', e => {
    modal.querySelectorAll('.qa-player-cb').forEach(cb => cb.checked = e.target.checked);
  });

  modal.querySelector('#btn-qa-close').addEventListener('click', () => modal.remove());

  modal.querySelector('#btn-qa-go').addEventListener('click', async () => {
    const checked = [...modal.querySelectorAll('.qa-player-cb:checked')].map(i => parseInt(i.value));
    if (!checked.length) { showToast('Select at least one player'); return; }

    const isCustom = modal.querySelector('.qa-src.active')?.dataset.src === 'custom';

    try {
      let payload;
      if (isCustom) {
        const title = modal.querySelector('#qa-custom-title').value.trim();
        if (!title) { showToast('Title required'); return; }
        payload = {
          character_ids: checked,
          title,
          description: modal.querySelector('#qa-custom-desc').value.trim(),
          source_npc_name: modal.querySelector('#qa-custom-npc').value.trim() || null,
          reward_gold_bronze: parseInt(modal.querySelector('#qa-custom-gold').value) || 0,
          reward_description: modal.querySelector('#qa-custom-reward').value.trim(),
          reward_is_hidden: modal.querySelector('#qa-custom-hidden').checked,
          stages: [],
          is_multi_stage: false,
        };
      } else {
        const tplId = parseInt(tplSelect?.value);
        if (!tplId) { showToast('Select a template'); return; }
        payload = { template_id: tplId, character_ids: checked };
      }

      const res = await api.post('/api/quests/assign', payload);
      const questTitle = isCustom ? payload.title : (questTemplates.find(t => t.id === payload.template_id)?.title || 'Quest');
      addLog('gm.quest', `Assigned "${questTitle}" to ${res.assigned.length} player(s)`);

      // WS notify
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        for (const a of res.assigned) {
          ws.ws.send(JSON.stringify({ type: 'quest.assigned', character_id: a.character_id, quest_title: questTitle }));
        }
      }

      modal.remove();
      showToast(`Quest assigned to ${res.assigned.length} player(s)!`);
      loadQuests();
    } catch (e) { showToast('Failed to assign quest'); }
  });
}


// ══════════════════════════════════════════════════════════════
// STAGE 7 — NPC LIBRARY
// ══════════════════════════════════════════════════════════════
let npcFolders = [];
let npcTemplates = [];
let npcEvents = [];

async function loadNpcLibrary() {
  if (!SESSION_ID) return;
  try {
    const [f, t, e] = await Promise.all([
      api.get(`/api/npc-library/folders?session_id=${SESSION_ID}`),
      api.get(`/api/npc-library/templates?session_id=${SESSION_ID}`),
      api.get(`/api/npc-library/events?session_id=${SESSION_ID}`),
    ]);
    npcFolders = f;
    npcTemplates = t;
    npcEvents = e;
  } catch { npcFolders = []; npcTemplates = []; npcEvents = []; }
  renderNpcLibrary();
}

function renderFolderTree(folders, depth = 0) {
  return folders.map(f => `
    <div style="margin-left:${depth * 16}px;margin-bottom:4px">
      <div style="display:flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--r-md);background:var(--bg-surface-2)">
        <span style="color:${f.color};font-size:1rem">📁</span>
        <span style="font-weight:700;font-size:0.82rem;flex:1">${f.name}</span>
        <span style="font-size:0.6rem;color:var(--text-muted)">${f.template_count} NPCs</span>
        <button class="btn btn-ghost btn-xs" data-edit-folder="${f.id}">✏️</button>
        <button class="btn btn-ghost btn-xs" data-del-folder="${f.id}" style="color:var(--accent-red)">🗑</button>
      </div>
      ${f.children && f.children.length ? renderFolderTree(f.children, depth + 1) : ''}
    </div>
  `).join('');
}

function renderNpcLibrary() {
  const tree = document.querySelector('#npc-folder-tree');
  const tList = document.querySelector('#npc-template-list');
  const eList = document.querySelector('#npc-event-list');
  if (!tree || !tList || !eList) return;

  // Folder tree
  tree.innerHTML = npcFolders.length ? renderFolderTree(npcFolders) : '<span class="text-muted" style="font-size:0.8rem">No folders.</span>';

  // Templates
  tList.innerHTML = npcTemplates.length ? npcTemplates.map(t => `
    <div style="padding:8px;border:1px solid var(--border);border-radius:var(--r-md);margin-bottom:6px;background:var(--bg-surface-2)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="width:12px;height:12px;border-radius:50%;background:${t.token_color};display:inline-block"></span>
          <span style="font-weight:700;font-size:0.85rem">${t.name}</span>
          ${t.is_merchant ? '<span style="font-size:0.6rem;padding:1px 5px;border-radius:8px;background:var(--accent)20;color:var(--accent)">Merchant</span>' : ''}
        </div>
        <div style="display:flex;gap:3px">
          <button class="btn btn-ghost btn-xs" data-spawn-tpl="${t.id}" title="Spawn">⚡</button>
          <button class="btn btn-ghost btn-xs" data-edit-tpl="${t.id}">✏️</button>
          <button class="btn btn-ghost btn-xs" data-del-tpl="${t.id}" style="color:var(--accent-red)">🗑</button>
        </div>
      </div>
      <div style="font-size:0.7rem;color:var(--text-muted)">${t.description || ''}</div>
      <div style="font-size:0.7rem;margin-top:2px">HP: ${t.max_hp} | KD: ${t.armor_class} | STR:${t.strength} DEX:${t.dexterity} CON:${t.constitution}</div>
    </div>
  `).join('') : '<span class="text-muted" style="font-size:0.8rem">No NPC templates.</span>';

  // Events
  eList.innerHTML = npcEvents.length ? npcEvents.map(e => {
    const entries = e.npc_template_ids || [];
    const summary = entries.map(en => {
      const tpl = npcTemplates.find(t => t.id === en.template_id);
      return `${tpl ? tpl.name : '?'} x${en.count}`;
    }).join(', ');
    return `
    <div style="padding:8px;border:1px solid var(--border);border-radius:var(--r-md);margin-bottom:6px;background:var(--bg-surface-2)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700;font-size:0.85rem">${e.name}</span>
        <div style="display:flex;gap:3px">
          <button class="btn btn-primary btn-xs" data-trigger-event="${e.id}" title="Trigger">⚡ Trigger</button>
          <button class="btn btn-ghost btn-xs" data-edit-event="${e.id}">✏️</button>
          <button class="btn btn-ghost btn-xs" data-del-event="${e.id}" style="color:var(--accent-red)">🗑</button>
        </div>
      </div>
      <div style="font-size:0.7rem;color:var(--text-muted)">${e.description || ''}</div>
      <div style="font-size:0.65rem;margin-top:2px">${summary || 'No NPCs configured'}</div>
    </div>`;
  }).join('') : '<span class="text-muted" style="font-size:0.8rem">No event templates.</span>';

  // Wire folder actions
  tree.querySelectorAll('[data-edit-folder]').forEach(btn => {
    btn.addEventListener('click', () => {
      const fId = parseInt(btn.dataset.editFolder);
      const flatFolders = flattenFolders(npcFolders);
      const fo = flatFolders.find(x => x.id === fId);
      if (fo) openFolderModal(fo);
    });
  });
  tree.querySelectorAll('[data-del-folder]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this folder?')) return;
      await api.del(`/api/npc-library/folders/${btn.dataset.delFolder}`);
      loadNpcLibrary();
    });
  });

  // Wire template actions
  tList.querySelectorAll('[data-spawn-tpl]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const count = parseInt(prompt('How many to spawn?', '1')) || 1;
      const res = await api.post(`/api/npc-library/templates/${btn.dataset.spawnTpl}/spawn`, { session_id: SESSION_ID, count });
      showToast(`Spawned ${res.spawned.length} NPC(s)`);
      refreshChars();
    });
  });
  tList.querySelectorAll('[data-edit-tpl]').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = npcTemplates.find(x => x.id === parseInt(btn.dataset.editTpl));
      if (t) openNpcTemplateModal(t);
    });
  });
  tList.querySelectorAll('[data-del-tpl]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this template?')) return;
      await api.del(`/api/npc-library/templates/${btn.dataset.delTpl}`);
      loadNpcLibrary();
    });
  });

  // Wire event actions
  eList.querySelectorAll('[data-trigger-event]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Trigger this event? NPCs will be spawned.')) return;
      const res = await api.post(`/api/npc-library/events/${btn.dataset.triggerEvent}/trigger`);
      showToast(`Event "${res.event_name}" triggered — ${res.spawned.length} NPC(s) spawned`);
      refreshChars();
    });
  });
  eList.querySelectorAll('[data-edit-event]').forEach(btn => {
    btn.addEventListener('click', () => {
      const e = npcEvents.find(x => x.id === parseInt(btn.dataset.editEvent));
      if (e) openEventModal(e);
    });
  });
  eList.querySelectorAll('[data-del-event]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this event?')) return;
      await api.del(`/api/npc-library/events/${btn.dataset.delEvent}`);
      loadNpcLibrary();
    });
  });
}

function flattenFolders(folders) {
  let result = [];
  for (const f of folders) {
    result.push(f);
    if (f.children) result = result.concat(flattenFolders(f.children));
  }
  return result;
}

// ── Folder Modal ──
function openFolderModal(existing) {
  const isEdit = !!existing;
  const data = existing || { name: '', color: '#888888', parent_folder_id: null };
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:380px">
      <div class="modal-header"><h3>${isEdit ? 'Edit' : 'Create'} Folder</h3><button class="modal-close">&times;</button></div>
      <div class="modal-body">
        <div class="form-group"><label>Name</label><input type="text" id="nf-name" value="${data.name}"></div>
        <div class="form-group"><label>Color</label><input type="color" id="nf-color" value="${data.color}"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="nf-cancel">Cancel</button>
        <button class="btn btn-primary" id="nf-save">${isEdit ? 'Save' : 'Create'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#nf-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#nf-save').addEventListener('click', async () => {
    const body = {
      session_id: SESSION_ID,
      name: overlay.querySelector('#nf-name').value.trim(),
      color: overlay.querySelector('#nf-color').value,
      parent_folder_id: data.parent_folder_id,
    };
    if (!body.name) return;
    if (isEdit) await api.put(`/api/npc-library/folders/${existing.id}`, body);
    else await api.post('/api/npc-library/folders', body);
    overlay.remove();
    loadNpcLibrary();
  });
}

// ── NPC Template Modal ──
function openNpcTemplateModal(existing) {
  const isEdit = !!existing;
  const d = existing || {
    // Rework v2: baseline 0 across the board — GM tunes per NPC.
    name: '', description: '', is_merchant: false, max_hp: 0, armor_class: 0,
    strength: 0, dexterity: 0, constitution: 0, intelligence: 0, wisdom: 0, charisma: 0,
    initiative_bonus: 0, token_color: '#e05252', default_equipment: [], shop_items: [], notes: '',
    folder_id: null,
  };
  const flatFolders = flattenFolders(npcFolders);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:520px;max-height:85vh;overflow-y:auto">
      <div class="modal-header"><h3>${isEdit ? 'Edit' : 'Create'} NPC Template</h3><button class="modal-close">&times;</button></div>
      <div class="modal-body">
        <div style="display:flex;gap:8px">
          <div class="form-group" style="flex:1"><label>Name</label><input type="text" id="nt-name" value="${d.name}"></div>
          <div class="form-group" style="width:60px"><label>Color</label><input type="color" id="nt-color" value="${d.token_color}" style="width:100%"></div>
        </div>
        <div class="form-group"><label>Description</label><textarea id="nt-desc" rows="2" style="width:100%">${d.description}</textarea></div>
        <div class="form-group">
          <label>Folder</label>
          <select id="nt-folder">
            <option value="">None</option>
            ${flatFolders.map(f => `<option value="${f.id}"${d.folder_id === f.id ? ' selected' : ''}>${f.name}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <div class="form-group" style="width:70px"><label>HP</label><input type="number" id="nt-hp" value="${d.max_hp}"></div>
          <div class="form-group" style="width:70px"><label>KD</label><input type="number" id="nt-ac" value="${d.armor_class}"></div>
          <div class="form-group" style="width:70px"><label>Init</label><input type="number" id="nt-init" value="${d.initiative_bonus}"></div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <div class="form-group" style="width:55px"><label>STR</label><input type="number" id="nt-str" value="${d.strength}"></div>
          <div class="form-group" style="width:55px"><label>DEX</label><input type="number" id="nt-dex" value="${d.dexterity}"></div>
          <div class="form-group" style="width:55px"><label>CON</label><input type="number" id="nt-con" value="${d.constitution}"></div>
          <div class="form-group" style="width:55px"><label>INT</label><input type="number" id="nt-int" value="${d.intelligence}"></div>
          <div class="form-group" style="width:55px"><label>WIS</label><input type="number" id="nt-wis" value="${d.wisdom}"></div>
          <div class="form-group" style="width:55px"><label>CHA</label><input type="number" id="nt-cha" value="${d.charisma}"></div>
        </div>
        <div class="form-group" style="display:flex;align-items:center;gap:8px">
          <label class="toggle-switch"><input type="checkbox" id="nt-merchant" ${d.is_merchant ? 'checked' : ''}><span class="slider"></span></label>
          <span style="font-size:0.8rem">Merchant NPC</span>
        </div>
        <div class="form-group"><label>Notes</label><textarea id="nt-notes" rows="2" style="width:100%">${d.notes}</textarea></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="nt-cancel">Cancel</button>
        <button class="btn btn-secondary" id="nt-ai-gen">🤖 Generate with AI</button>
        <button class="btn btn-primary" id="nt-save">${isEdit ? 'Save' : 'Create'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#nt-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#nt-ai-gen').addEventListener('click', () => openAINpcModal(overlay));
  overlay.querySelector('#nt-save').addEventListener('click', async () => {
    const body = {
      session_id: SESSION_ID,
      name: overlay.querySelector('#nt-name').value.trim(),
      description: overlay.querySelector('#nt-desc').value.trim(),
      folder_id: overlay.querySelector('#nt-folder').value ? parseInt(overlay.querySelector('#nt-folder').value) : null,
      max_hp: parseInt(overlay.querySelector('#nt-hp').value) || 0,
      armor_class: parseInt(overlay.querySelector('#nt-ac').value) || 0,
      initiative_bonus: parseInt(overlay.querySelector('#nt-init').value) || 0,
      strength: parseInt(overlay.querySelector('#nt-str').value) || 0,
      dexterity: parseInt(overlay.querySelector('#nt-dex').value) || 0,
      constitution: parseInt(overlay.querySelector('#nt-con').value) || 0,
      intelligence: parseInt(overlay.querySelector('#nt-int').value) || 0,
      wisdom: parseInt(overlay.querySelector('#nt-wis').value) || 0,
      charisma: parseInt(overlay.querySelector('#nt-cha').value) || 0,
      token_color: overlay.querySelector('#nt-color').value,
      is_merchant: overlay.querySelector('#nt-merchant').checked,
      notes: overlay.querySelector('#nt-notes').value.trim(),
      default_equipment: d.default_equipment || [],
      shop_items: d.shop_items || [],
    };
    if (!body.name) return;
    if (isEdit) await api.put(`/api/npc-library/templates/${existing.id}`, body);
    else await api.post('/api/npc-library/templates', body);
    overlay.remove();
    loadNpcLibrary();
  });
}

// ── Event Modal ──
function openEventModal(existing) {
  const isEdit = !!existing;
  const d = existing || { name: '', description: '', npc_template_ids: [], folder_id: null };
  let entries = [...(d.npc_template_ids || [])];

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:480px">
      <div class="modal-header"><h3>${isEdit ? 'Edit' : 'Create'} Event</h3><button class="modal-close">&times;</button></div>
      <div class="modal-body">
        <div class="form-group"><label>Name</label><input type="text" id="ev-name" value="${d.name}"></div>
        <div class="form-group"><label>Description</label><textarea id="ev-desc" rows="2" style="width:100%">${d.description}</textarea></div>
        <div class="form-group">
          <label>NPCs to spawn</label>
          <div id="ev-npc-list"></div>
          <button class="btn btn-ghost btn-xs" id="ev-add-npc" style="margin-top:4px">+ Add NPC</button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="ev-cancel">Cancel</button>
        <button class="btn btn-primary" id="ev-save">${isEdit ? 'Save' : 'Create'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  function renderEntries() {
    const cont = overlay.querySelector('#ev-npc-list');
    cont.innerHTML = entries.map((en, i) => `
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:3px">
        <select data-eni="${i}" data-field="template_id" style="flex:1;font-size:0.75rem">
          ${npcTemplates.map(t => `<option value="${t.id}"${en.template_id === t.id ? ' selected' : ''}>${t.name}</option>`).join('')}
        </select>
        <span style="font-size:0.75rem">x</span>
        <input type="number" data-eni="${i}" data-field="count" value="${en.count || 1}" style="width:50px;font-size:0.75rem" min="1">
        <button class="btn btn-ghost btn-xs" data-remove-entry="${i}" style="color:var(--accent-red)">✕</button>
      </div>
    `).join('');
    cont.querySelectorAll('[data-eni]').forEach(el => {
      el.addEventListener('change', () => {
        const i = parseInt(el.dataset.eni);
        const f = el.dataset.field;
        entries[i][f] = f === 'count' ? parseInt(el.value) || 1 : parseInt(el.value);
      });
    });
    cont.querySelectorAll('[data-remove-entry]').forEach(btn => {
      btn.addEventListener('click', () => { entries.splice(parseInt(btn.dataset.removeEntry), 1); renderEntries(); });
    });
  }
  renderEntries();

  overlay.querySelector('#ev-add-npc').addEventListener('click', () => {
    entries.push({ template_id: npcTemplates[0]?.id || 0, count: 1 });
    renderEntries();
  });
  overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#ev-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#ev-save').addEventListener('click', async () => {
    const body = {
      session_id: SESSION_ID,
      name: overlay.querySelector('#ev-name').value.trim(),
      description: overlay.querySelector('#ev-desc').value.trim(),
      npc_template_ids: entries,
      folder_id: d.folder_id,
    };
    if (!body.name) return;
    if (isEdit) await api.put(`/api/npc-library/events/${existing.id}`, body);
    else await api.post('/api/npc-library/events', body);
    overlay.remove();
    loadNpcLibrary();
  });
}

// Wire create buttons
document.querySelector('#btn-npc-create-folder')?.addEventListener('click', () => openFolderModal(null));
document.querySelector('#btn-npc-create-template')?.addEventListener('click', () => openNpcTemplateModal(null));
document.querySelector('#btn-npc-create-event')?.addEventListener('click', () => openEventModal(null));

// Wire seed, create buttons
document.querySelector('#btn-seed-rc')?.addEventListener('click', async () => {
  await api.post('/api/races-classes/seed');
  loadRacesClasses();
  showToast('Default races & classes seeded');
});
document.querySelector('#btn-create-race')?.addEventListener('click', () => openRCEditorModal('race', null));
document.querySelector('#btn-create-class')?.addEventListener('click', () => openRCEditorModal('class', null));

// ══════════════════════════════════════════════════════════════
// STAGE 10 — ANNOUNCEMENTS
// ══════════════════════════════════════════════════════════════
async function loadAnnouncements() {
  try {
    const list = await api.get(`/api/announcements/${SESSION_CODE}`);
    const el = $('#announcements-list');
    if (!el) return;
    if (!list.length) { el.innerHTML = '<p class="text-muted" style="font-size:0.8rem">No announcements yet.</p>'; return; }
    el.innerHTML = list.map(a => `
      <div style="padding:8px 10px;margin-bottom:6px;border-radius:var(--r-md);border:1px solid ${a.is_pinned ? 'var(--accent)' : 'var(--border)'};background:${a.is_pinned ? 'rgba(212,175,55,0.06)' : 'var(--bg-surface-2)'}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-weight:600;font-size:0.78rem">${a.is_pinned ? '📌 ' : ''}${a.author_name || 'GM'}</span>
          <span style="font-size:0.68rem;color:var(--text-muted)">${a.posted_at ? new Date(a.posted_at).toLocaleString() : ''}</span>
        </div>
        <div style="font-size:0.82rem;white-space:pre-wrap">${a.content}</div>
        <div style="display:flex;gap:4px;margin-top:6px;justify-content:flex-end">
          <button class="btn btn-ghost btn-xs" data-ann-pin="${a.id}" data-pinned="${a.is_pinned}">${a.is_pinned ? 'Unpin' : 'Pin'}</button>
          <button class="btn btn-ghost btn-xs" data-ann-del="${a.id}" style="color:var(--danger)">Delete</button>
        </div>
      </div>
    `).join('');
    el.querySelectorAll('[data-ann-pin]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.patch(`/api/announcements/${btn.dataset.annPin}/pin`, { is_pinned: btn.dataset.pinned !== 'true' });
        loadAnnouncements();
        if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
          ws.ws.send(JSON.stringify({ type: 'announcement.pinned', announcement_id: parseInt(btn.dataset.annPin) }));
        }
      });
    });
    el.querySelectorAll('[data-ann-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.del(`/api/announcements/${btn.dataset.annDel}`);
        loadAnnouncements();
        if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
          ws.ws.send(JSON.stringify({ type: 'announcement.deleted', announcement_id: parseInt(btn.dataset.annDel) }));
        }
      });
    });
  } catch (e) { console.error('loadAnnouncements', e); }
}

$('#btn-post-announce')?.addEventListener('click', async () => {
  const input = $('#announce-input');
  const content = input.value.trim();
  if (!content) return;
  const is_pinned = $('#announce-pin')?.checked || false;
  const a = await api.post(`/api/announcements/${SESSION_CODE}`, { content, is_pinned });
  input.value = '';
  if ($('#announce-pin')) $('#announce-pin').checked = false;
  loadAnnouncements();
  addLog('gm.announce', `Announcement posted: "${content.substring(0, 60)}..."`);
  if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
    ws.ws.send(JSON.stringify({ type: 'announcement.posted', announcement: a }));
  }
});

// ══════════════════════════════════════════════════════════════
// STAGE 10 — CHARACTER NOTES (GM side)
// ══════════════════════════════════════════════════════════════
async function loadCharNotes(charId) {
  const container = document.querySelector('#char-notes-section');
  if (!container) return;
  try {
    const notes = await api.get(`/api/notes/character/${charId}/all`);
    const playerNotes = notes.filter(n => !n.is_gm_note);
    const gmNotes = notes.filter(n => n.is_gm_note);
    container.innerHTML = `
      <div style="margin-bottom:8px;display:flex;align-items:center;gap:8px">
        <h4 style="font-size:0.82rem;flex:1">📝 Notes</h4>
        <button class="btn btn-primary btn-xs" id="btn-add-gm-note">+ GM Note</button>
      </div>
      ${gmNotes.length ? `<div style="margin-bottom:8px"><span style="font-size:0.72rem;color:var(--text-muted)">GM Notes (hidden from player):</span>
        ${gmNotes.map(n => `
          <div style="padding:6px 8px;margin:4px 0;background:rgba(212,175,55,0.08);border:1px solid var(--accent);border-radius:var(--r-sm)">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <strong style="font-size:0.78rem">${n.title || 'Untitled'}</strong>
              <div style="display:flex;gap:3px">
                <button class="btn btn-ghost btn-xs" data-edit-note="${n.id}">✏️</button>
                <button class="btn btn-ghost btn-xs" data-del-note="${n.id}" style="color:var(--danger)">🗑️</button>
              </div>
            </div>
            <div style="font-size:0.78rem;white-space:pre-wrap;margin-top:3px">${n.content}</div>
          </div>
        `).join('')}
      </div>` : ''}
      ${playerNotes.length ? `<div><span style="font-size:0.72rem;color:var(--text-muted)">Player Notes (read-only):</span>
        ${playerNotes.map(n => `
          <div style="padding:6px 8px;margin:4px 0;background:var(--bg-surface-2);border:1px solid var(--border);border-radius:var(--r-sm)">
            <strong style="font-size:0.78rem">${n.title || 'Untitled'}</strong>
            <div style="font-size:0.78rem;white-space:pre-wrap;margin-top:3px">${n.content}</div>
          </div>
        `).join('')}
      </div>` : '<p class="text-muted" style="font-size:0.75rem">No player notes.</p>'}
    `;
    container.querySelector('#btn-add-gm-note')?.addEventListener('click', () => openNoteModal(charId, null, true));
    container.querySelectorAll('[data-edit-note]').forEach(btn => {
      const note = notes.find(n => n.id === parseInt(btn.dataset.editNote));
      btn.addEventListener('click', () => openNoteModal(charId, note, true));
    });
    container.querySelectorAll('[data-del-note]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.del(`/api/notes/${btn.dataset.delNote}`);
        loadCharNotes(charId);
      });
    });
  } catch (e) { console.error('loadCharNotes', e); }
}

function openNoteModal(charId, existing, isGm) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="width:440px">
      <div class="modal-header"><h3>${existing ? 'Edit' : 'New'} ${isGm ? 'GM' : ''} Note</h3></div>
      <div class="modal-body">
        <label class="form-label">Title</label>
        <input type="text" id="note-title" value="${existing?.title || ''}" style="width:100%;margin-bottom:8px">
        <label class="form-label">Content</label>
        <textarea id="note-content" rows="6" style="width:100%;resize:vertical">${existing?.content || ''}</textarea>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost btn-sm" id="btn-note-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="btn-note-save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#btn-note-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#btn-note-save').addEventListener('click', async () => {
    const body = { title: overlay.querySelector('#note-title').value, content: overlay.querySelector('#note-content').value, is_gm_note: isGm };
    if (existing) await api.put(`/api/notes/${existing.id}`, body);
    else await api.post(`/api/notes/character/${charId}`, body);
    overlay.remove();
    loadCharNotes(charId);
  });
}

// ══════════════════════════════════════════════════════════════
// STAGE 10 — SESSION TIMER
// ══════════════════════════════════════════════════════════════
let sessionTimerRunning = false;
let sessionTimerBase = 0;
let sessionTimerStartedAt = null;
let sessionTimerInterval = null;

function formatTimer(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function updateTimerDisplay() {
  let total = sessionTimerBase;
  if (sessionTimerRunning && sessionTimerStartedAt) {
    total += Math.floor((Date.now() - sessionTimerStartedAt) / 1000);
  }
  const el = $('#session-timer-display');
  if (el) el.textContent = formatTimer(total);
}

function startTimerTick() {
  if (sessionTimerInterval) clearInterval(sessionTimerInterval);
  sessionTimerInterval = setInterval(updateTimerDisplay, 1000);
  updateTimerDisplay();
}

async function loadSessionTimer() {
  try {
    const t = await api.get(`/api/sessions/${SESSION_CODE}/timer`);
    sessionTimerBase = t.total_seconds || 0;
    sessionTimerRunning = t.running;
    if (t.running && t.started_at) {
      sessionTimerStartedAt = new Date(t.started_at).getTime();
      sessionTimerBase = (t.total_seconds || 0) - Math.floor((Date.now() - sessionTimerStartedAt) / 1000);
      if (sessionTimerBase < 0) sessionTimerBase = 0;
    } else {
      sessionTimerStartedAt = null;
    }
    const btn = $('#btn-timer-toggle');
    if (btn) btn.textContent = sessionTimerRunning ? '⏸' : '▶';
    startTimerTick();
  } catch (e) { console.error('loadSessionTimer', e); }
}

$('#btn-timer-toggle')?.addEventListener('click', async () => {
  if (sessionTimerRunning) {
    const t = await api.post(`/api/sessions/${SESSION_CODE}/timer/pause`);
    sessionTimerRunning = false;
    sessionTimerBase = t.total_seconds;
    sessionTimerStartedAt = null;
    $('#btn-timer-toggle').textContent = '▶';
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({ type: 'session.timer_paused', total_seconds: t.total_seconds }));
    }
  } else {
    const t = await api.post(`/api/sessions/${SESSION_CODE}/timer/start`);
    sessionTimerRunning = true;
    sessionTimerBase = 0;
    sessionTimerStartedAt = Date.now();
    sessionTimerBase = t.total_seconds - Math.floor((Date.now() - sessionTimerStartedAt) / 1000);
    $('#btn-timer-toggle').textContent = '⏸';
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({ type: 'session.timer_started', total_seconds: t.total_seconds }));
    }
  }
  updateTimerDisplay();
});

// ══════════════════════════════════════════════════════════════
// STAGE 10 — ENHANCED EVENT LOG (filter, search, export)
// ══════════════════════════════════════════════════════════════
let logFilter = 'all';
let logSearchTerm = '';

document.querySelectorAll('.log-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.log-filter-btn').forEach(b => { b.classList.remove('active'); b.classList.add('btn-ghost'); });
    btn.classList.add('active');
    btn.classList.remove('btn-ghost');
    logFilter = btn.dataset.logFilter;
    applyLogFilters();
  });
});

$('#log-search')?.addEventListener('input', e => {
  logSearchTerm = e.target.value.toLowerCase();
  applyLogFilters();
});

function applyLogFilters() {
  const log = $('#event-log');
  if (!log) return;
  const entries = log.querySelectorAll('.log-entry');
  entries.forEach(entry => {
    const cat = entry.dataset.logCat || '';
    const text = entry.textContent.toLowerCase();
    const matchFilter = logFilter === 'all' || cat.includes(logFilter);
    const matchSearch = !logSearchTerm || text.includes(logSearchTerm);
    entry.style.display = (matchFilter && matchSearch) ? '' : 'none';
  });
}

$('#btn-export-log')?.addEventListener('click', () => {
  const log = $('#event-log');
  if (!log) return;
  const entries = log.querySelectorAll('.log-entry');
  let text = `Event Log — Session ${SESSION_CODE}\nExported: ${new Date().toLocaleString()}\n${'='.repeat(50)}\n\n`;
  entries.forEach(entry => {
    if (entry.style.display !== 'none') {
      text += entry.textContent.trim() + '\n';
    }
  });
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `event-log-${SESSION_CODE}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

// ══════════════════════════════════════════════════════════════
// STAGE 10 — AI NPC GENERATION
// ══════════════════════════════════════════════════════════════
function openAINpcModal(templateModal) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '1100';
  overlay.innerHTML = `
    <div class="modal" style="width:500px">
      <div class="modal-header"><h3>🤖 Generate NPC with AI</h3></div>
      <div class="modal-body">
        <label class="form-label">Describe this NPC:</label>
        <textarea id="ai-npc-desc" rows="3" placeholder="An old bitter blacksmith who was once an adventurer, now retired..." style="width:100%;resize:vertical"></textarea>
        <div id="ai-npc-preview" style="margin-top:12px;display:none"></div>
        <div id="ai-npc-loading" style="display:none;text-align:center;padding:12px;color:var(--text-muted)">⏳ Generating...</div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost btn-sm" id="btn-ai-npc-close">Cancel</button>
        <button class="btn btn-secondary btn-sm" id="btn-ai-npc-retry" style="display:none">🔄 Retry</button>
        <button class="btn btn-primary btn-sm" id="btn-ai-npc-generate">✨ Generate</button>
        <button class="btn btn-primary btn-sm" id="btn-ai-npc-use" style="display:none">✅ Use This</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  let generatedNpc = null;

  overlay.querySelector('#btn-ai-npc-close').addEventListener('click', () => overlay.remove());

  async function doGenerate() {
    const desc = overlay.querySelector('#ai-npc-desc').value.trim();
    if (!desc) return;
    overlay.querySelector('#ai-npc-loading').style.display = 'block';
    overlay.querySelector('#ai-npc-preview').style.display = 'none';
    overlay.querySelector('#btn-ai-npc-generate').style.display = 'none';
    overlay.querySelector('#btn-ai-npc-retry').style.display = 'none';
    overlay.querySelector('#btn-ai-npc-use').style.display = 'none';

    try {
      const res = await api.post('/api/ai/generate-npc', { description: desc, session_code: SESSION_CODE });
      generatedNpc = res;
      const preview = overlay.querySelector('#ai-npc-preview');
      preview.style.display = 'block';
      preview.innerHTML = `
        <div style="padding:10px;background:var(--bg-surface-2);border-radius:var(--r-md);border:1px solid var(--border)">
          <h4 style="margin-bottom:6px">${res.name || 'NPC'}</h4>
          <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:6px">${res.description || ''}</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:0.75rem">
            <span>❤️ HP: ${res.max_hp ?? 0}</span><span>🛡️ AC: ${res.armor_class ?? 0}</span>
            <span>STR: ${res.strength ?? 0}</span><span>DEX: ${res.dexterity ?? 0}</span>
            <span>CON: ${res.constitution ?? 0}</span><span>INT: ${res.intelligence ?? 0}</span>
            <span>WIS: ${res.wisdom ?? 0}</span><span>CHA: ${res.charisma ?? 0}</span>
          </div>
          ${res.notes ? `<p style="font-size:0.75rem;margin-top:6px;color:var(--text-muted)">Notes: ${res.notes}</p>` : ''}
        </div>
      `;
      overlay.querySelector('#btn-ai-npc-retry').style.display = '';
      overlay.querySelector('#btn-ai-npc-use').style.display = '';
    } catch (e) {
      overlay.querySelector('#ai-npc-preview').style.display = 'block';
      overlay.querySelector('#ai-npc-preview').innerHTML = `<p style="color:var(--danger)">Failed: ${e.message}</p>`;
      overlay.querySelector('#btn-ai-npc-generate').style.display = '';
    }
    overlay.querySelector('#ai-npc-loading').style.display = 'none';
  }

  overlay.querySelector('#btn-ai-npc-generate').addEventListener('click', doGenerate);
  overlay.querySelector('#btn-ai-npc-retry').addEventListener('click', doGenerate);
  overlay.querySelector('#btn-ai-npc-use').addEventListener('click', () => {
    if (!generatedNpc || !templateModal) { overlay.remove(); return; }
    // Fill template modal fields
    const tm = templateModal;
    const setVal = (sel, val) => { const el = tm.querySelector(sel); if (el && val != null) el.value = val; };
    setVal('#nt-name', generatedNpc.name);
    setVal('#nt-desc', generatedNpc.description);
    setVal('#nt-hp', generatedNpc.max_hp);
    setVal('#nt-ac', generatedNpc.armor_class);
    setVal('#nt-str', generatedNpc.strength);
    setVal('#nt-dex', generatedNpc.dexterity);
    setVal('#nt-con', generatedNpc.constitution);
    setVal('#nt-int', generatedNpc.intelligence);
    setVal('#nt-wis', generatedNpc.wisdom);
    setVal('#nt-cha', generatedNpc.charisma);
    setVal('#nt-init', generatedNpc.initiative_bonus);
    setVal('#nt-notes', generatedNpc.notes);
    if (generatedNpc.is_merchant && tm.querySelector('#nt-merchant')) tm.querySelector('#nt-merchant').checked = true;
    overlay.remove();
  });
}

// ══════════════════════════════════════════════════════════════
// STAGE 10 — WS listeners for announcements & timer
// ══════════════════════════════════════════════════════════════
ws.on('announcement.posted', () => loadAnnouncements());
ws.on('announcement.pinned', () => loadAnnouncements());
ws.on('announcement.deleted', () => loadAnnouncements());
ws.on('session.timer_started', d => {
  sessionTimerRunning = true;
  sessionTimerStartedAt = Date.now();
  sessionTimerBase = (d.total_seconds || 0) - Math.floor((Date.now() - sessionTimerStartedAt) / 1000);
  $('#btn-timer-toggle').textContent = '⏸';
  startTimerTick();
});
ws.on('session.timer_paused', d => {
  sessionTimerRunning = false;
  sessionTimerBase = d.total_seconds || 0;
  sessionTimerStartedAt = null;
  $('#btn-timer-toggle').textContent = '▶';
  updateTimerDisplay();
});

// ══════════════════════════════════════════════════════════════
// PHASE 6 — GM ABILITY MANAGER
// ══════════════════════════════════════════════════════════════
let gmAbilities = [];
// Rework v2: filter state for the ability list
let _abFilter = { pool: false, rarity: '' };

async function loadGmAbilities() {
  try {
    gmAbilities = await api.get(`/api/abilities?session_id=${SESSION_ID}`);
    renderGmAbilities();
  } catch (e) { console.warn('loadGmAbilities:', e); }
}

// Wire ability filter controls once.
document.addEventListener('DOMContentLoaded', () => {
  const poolEl = document.getElementById('ab-filter-pool');
  const rarEl  = document.getElementById('ab-filter-rarity');
  if (poolEl) poolEl.addEventListener('change', () => { _abFilter.pool = poolEl.checked; renderGmAbilities(); });
  if (rarEl)  rarEl .addEventListener('change', () => { _abFilter.rarity = rarEl.value;   renderGmAbilities(); });
});

const _AB_ICONS = ['⚡','⚔️','🔥','❄️','☠️','✨','🛡️','💨','🌊','🌑','💀','🌿','🪄','💫','🌟','⭐','🔮','❤️','🎯','👁️'];
const _AB_DMGTYPES = ['physical','fire','ice','lightning','poison','holy','dark','arcane','custom'];
const _AB_STATS = ['strength','dexterity','constitution','intelligence','wisdom','charisma'];
// Rework v3: added restore_hp_by_die (rolls the race HP die for healing).
const _AB_EFF_TYPES = ['heal_hp','restore_hp_by_die','restore_mana','apply_status','stat_boost','remove_status','damage','summon_npc','teleport','custom'];
// Rework v3: passive bonus types available in the ability editor dropdown.
const _AB_PASSIVE_BONUS_TYPES = [
  { value: 'attack_bonus',           label: '⚔️  ATK Bonus'                  },
  { value: 'damage_bonus',           label: '💥  DMG Bonus'                  },
  { value: 'stat_bonus',             label: '📊  Stat Bonus'                 },
  { value: 'damage_reduction_flat',  label: '🛡  Dmg Reduction (flat)'       },
  { value: 'damage_reduction_pct',   label: '🛡  Dmg Reduction (%)'          },
  { value: 'max_hp_bonus',           label: '❤️  Max HP (+N)'                },
  { value: 'max_mana_bonus',         label: '🔮  Max Mana (+N)'              },
  { value: 'mana_regen_bonus',       label: '🔄  Mana Regen / turn (+N)'     },
  { value: 'hp_die_bonus',           label: '🎲  HP Die size (+N)'           },
  { value: 'hp_die_count_bonus',     label: '🎲  HP Dice count (+N)'         },
];

function renderGmAbilities() {
  const el = $('#gm-abilities-list');
  if (!el) return;

  // Rework v2: apply filters + starting-pool summary
  const filtered = gmAbilities.filter(a => {
    if (_abFilter.pool && !a.is_in_starting_pool) return false;
    if (_abFilter.rarity && (a.rarity || 'common') !== _abFilter.rarity) return false;
    return true;
  });
  const sumEl = document.getElementById('ab-pool-summary');
  if (sumEl) {
    const buckets = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
    gmAbilities.forEach(a => { if (a.is_in_starting_pool) buckets[a.rarity || 'common'] = (buckets[a.rarity || 'common'] || 0) + 1; });
    sumEl.innerHTML = 'Starting pool: ' +
      Object.entries(buckets).map(([r, n]) => `<span class="rarity-chip rarity-${r}" style="margin-left:4px">${r}: ${n}</span>`).join('');
  }

  if (!filtered.length) {
    el.innerHTML = !gmAbilities.length
      ? '<p class="text-muted">No abilities created yet. Click "+ New Ability" to add one.</p>'
      : '<p class="text-muted" style="font-size:0.8rem">No abilities match the current filter.</p>';
    return;
  }
  el.innerHTML = filtered.map(a => {
    const tags = (Array.isArray(a.tags) ? a.tags : []).map(t => `<span style="font-size:0.62rem;padding:1px 5px;border-radius:8px;background:var(--bg-surface-2);border:1px solid var(--border)">${t}</span>`).join('');
    const typeBadge = a.ability_type === 'passive' ? '🔵 Passive' : a.ability_type === 'reaction' ? '⚡ Reaction' : '🟢 Active';
    const targetIcon = { self:'🙂', single:'🎯', aoe:'💥', none:'—' }[a.target_type] || '';
    const effCount = (a.effect?.effects || []).length;
    const rarity = a.rarity || 'common';
    const rarityChip = `<span class="rarity-chip rarity-${rarity}">${rarity}</span>`;
    const poolChip   = a.is_in_starting_pool
      ? `<span title="In starting pool — can be granted by wizard Step 5" style="font-size:0.62rem;padding:1px 6px;border-radius:8px;background:rgba(192,138,42,0.2);color:var(--accent);font-weight:700">🎁 Pool</span>`
      : '';
    const usesChip   = a.max_uses
      ? `<span title="Max uses per grant" style="font-size:0.62rem;color:var(--accent-green);font-weight:600">⚡ ${a.max_uses}</span>`
      : '';
    const condChip   = a.is_conditional
      ? `<span title="${(a.conditional_text || 'GM discretion').replace(/"/g,'&quot;')}" style="font-size:0.62rem;color:var(--accent);font-style:italic;cursor:help">※ Cond</span>`
      : '';
    return `<div style="display:flex;align-items:stretch;gap:0;margin-bottom:6px;border-radius:var(--r-md);overflow:hidden;border:1px solid var(--border);background:var(--bg-surface)">
      <div style="width:4px;background:${a.color||'#60a5fa'}"></div>
      <div style="flex:1;padding:8px 10px">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:1.1rem">${a.icon||'⚡'}</span>
          <span style="font-weight:700;font-size:0.85rem">${a.name}</span>
          ${rarityChip}
          ${poolChip}
          ${usesChip}
          ${condChip}
          <span style="font-size:0.65rem;padding:1px 6px;border-radius:8px;background:var(--bg-surface-2);border:1px solid var(--border)">${typeBadge}</span>
          ${a.mana_cost ? `<span style="font-size:0.65rem;color:#60a5fa;font-weight:600">🔮 ${a.mana_cost}</span>` : ''}
          ${a.hp_cost ? `<span style="font-size:0.65rem;color:var(--accent-red);font-weight:600">❤️ ${a.hp_cost}</span>` : ''}
          ${a.cooldown_turns ? `<span style="font-size:0.65rem;color:var(--accent-orange)">⏳ ${a.cooldown_turns}t</span>` : ''}
          ${a.damage_dice_count ? `<span style="font-size:0.65rem">${a.damage_dice_count}d${a.damage_dice_type} ${a.damage_type}</span>` : ''}
          <span style="font-size:0.65rem">${targetIcon}</span>
          ${effCount ? `<span style="font-size:0.62rem;color:var(--text-muted)">${effCount} effects</span>` : ''}
        </div>
        ${tags ? `<div style="display:flex;gap:3px;margin-top:3px;flex-wrap:wrap">${tags}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:2px;padding:4px;justify-content:center">
        <button class="btn btn-ghost btn-xs" data-edit-ability="${a.id}" title="Edit">✏️</button>
        <button class="btn btn-ghost btn-xs" data-dup-ability="${a.id}" title="Duplicate">📋</button>
        <button class="btn btn-ghost btn-xs" data-assign-ability="${a.id}" title="Assign">👤</button>
        <button class="btn btn-ghost btn-xs" data-del-ability="${a.id}" style="color:var(--accent-red)" title="Delete">🗑️</button>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-edit-ability]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ab = gmAbilities.find(a => a.id == btn.dataset.editAbility);
      if (ab) showAbilityEditor(ab);
    });
  });
  el.querySelectorAll('[data-dup-ability]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.post(`/api/abilities/${btn.dataset.dupAbility}/duplicate`);
      loadGmAbilities();
    });
  });
  el.querySelectorAll('[data-assign-ability]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ab = gmAbilities.find(a => a.id == btn.dataset.assignAbility);
      if (!ab) return;
      const charNames = characters.map((c, i) => `${i+1}. ${c.name} ${c.is_npc?'(NPC)':'(Player)'}`).join('\n');
      const pick = prompt(`Assign "${ab.name}" to:\n${charNames}\nEnter numbers (comma-separated):`);
      if (!pick) return;
      const idxs = pick.split(',').map(s => parseInt(s.trim()) - 1).filter(i => i >= 0 && i < characters.length);
      for (const idx of idxs) {
        try {
          await api.post(`/api/characters/${characters[idx].id}/abilities`, { ability_id: ab.id });
        } catch {}
      }
      showToast(`Assigned ${ab.name} to ${idxs.length} character(s)`);
    });
  });
  el.querySelectorAll('[data-del-ability]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this ability?')) return;
      await api.del(`/api/abilities/${btn.dataset.delAbility}`);
      loadGmAbilities();
    });
  });
}

function showAbilityEditor(existing = null) {
  const d = existing || {};
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;justify-content:center;align-items:flex-start;padding:30px;overflow-y:auto';

  const tags = Array.isArray(d.tags) ? d.tags.join(', ') : '';
  const effects = d.effect?.effects || [];
  const passiveEff = d.passive_effect || {};

  overlay.innerHTML = `<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg);width:600px;max-width:95vw;padding:20px;max-height:90vh;overflow-y:auto">
    <h2 style="margin:0 0 12px;font-size:1rem">${existing ? 'Edit' : 'Create'} Ability</h2>

    <!-- Section 1: Identity -->
    <fieldset style="border:1px solid var(--border);border-radius:var(--r-md);padding:10px;margin-bottom:10px">
      <legend style="font-size:0.78rem;font-weight:700;padding:0 6px">🏷️ Identity</legend>
      <div style="display:flex;gap:8px;margin-bottom:6px">
        <div style="flex:1"><label style="font-size:0.72rem">Name</label><input id="ab-name" value="${d.name||''}" style="width:100%"></div>
        <div style="width:80px"><label style="font-size:0.72rem">Color</label><input id="ab-color" type="color" value="${d.color||'#60a5fa'}" style="width:100%;height:30px"></div>
      </div>
      <div style="margin-bottom:6px">
        <label style="font-size:0.72rem">Icon</label>
        <div id="ab-icon-grid" style="display:flex;flex-wrap:wrap;gap:4px">${_AB_ICONS.map(ic => `<button class="btn btn-ghost btn-xs ab-icon-pick ${ic===(d.icon||'⚡')?'active':''}" data-icon="${ic}" style="font-size:1.1rem;padding:2px 4px">${ic}</button>`).join('')}</div>
      </div>
      <div style="margin-bottom:6px"><label style="font-size:0.72rem">Flavor Text (shown to players)</label><textarea id="ab-flavor" rows="2" style="width:100%;font-size:0.78rem">${d.flavor_text||''}</textarea></div>
      <div style="margin-bottom:6px"><label style="font-size:0.72rem">GM Notes (hidden from players)</label><textarea id="ab-notes" rows="2" style="width:100%;font-size:0.78rem">${d.notes||''}</textarea></div>
      <div><label style="font-size:0.72rem">Tags (comma-separated)</label><input id="ab-tags" value="${tags}" style="width:100%"></div>
    </fieldset>

    <!-- Section 2: Type & Targeting -->
    <fieldset style="border:1px solid var(--border);border-radius:var(--r-md);padding:10px;margin-bottom:10px">
      <legend style="font-size:0.78rem;font-weight:700;padding:0 6px">⚙️ Type & Targeting</legend>
      <div style="display:flex;gap:12px;margin-bottom:6px">
        <label style="font-size:0.78rem"><input type="radio" name="ab-type" value="active" ${(d.ability_type||'active')==='active'?'checked':''}> Active</label>
        <label style="font-size:0.78rem"><input type="radio" name="ab-type" value="passive" ${d.ability_type==='passive'?'checked':''}> Passive</label>
        <label style="font-size:0.78rem"><input type="radio" name="ab-type" value="reaction" ${d.ability_type==='reaction'?'checked':''}> Reaction</label>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:6px">
        <label style="font-size:0.78rem"><input type="radio" name="ab-target" value="self" ${d.target_type==='self'?'checked':''}> Self</label>
        <label style="font-size:0.78rem"><input type="radio" name="ab-target" value="single" ${(d.target_type||'single')==='single'?'checked':''}> Single</label>
        <label style="font-size:0.78rem"><input type="radio" name="ab-target" value="aoe" ${d.target_type==='aoe'?'checked':''}> AoE</label>
        <label style="font-size:0.78rem"><input type="radio" name="ab-target" value="none" ${d.target_type==='none'?'checked':''}> None</label>
      </div>
      <div id="ab-aoe-row" style="display:${d.target_type==='aoe'?'flex':'none'};gap:6px;align-items:center;margin-bottom:6px">
        <label style="font-size:0.72rem">AoE Radius (cells):</label><input id="ab-aoe" type="number" value="${d.aoe_radius||3}" min="1" style="width:60px">
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <label style="font-size:0.72rem">Damage Type:</label>
        <select id="ab-dmgtype" style="font-size:0.78rem">${_AB_DMGTYPES.map(t => `<option value="${t}" ${t===(d.damage_type||'physical')?'selected':''}>${t}</option>`).join('')}</select>
        <input id="ab-custom-dmg" placeholder="Custom type name" value="${d.custom_damage_type||''}" style="width:120px;display:${d.damage_type==='custom'?'':'none'}">
      </div>
    </fieldset>

    <!-- Section 3: Costs & Cooldown -->
    <fieldset style="border:1px solid var(--border);border-radius:var(--r-md);padding:10px;margin-bottom:10px">
      <legend style="font-size:0.78rem;font-weight:700;padding:0 6px">💰 Costs & Cooldown</legend>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div><label style="font-size:0.72rem">🔮 Mana Cost</label><input id="ab-mana" type="number" value="${d.mana_cost||0}" min="0" style="width:60px"></div>
        <div><label style="font-size:0.72rem">❤️ HP Cost</label><input id="ab-hpcost" type="number" value="${d.hp_cost||0}" min="0" style="width:60px"></div>
        <div><label style="font-size:0.72rem">⏳ Cooldown (turns)</label><input id="ab-cd" type="number" value="${d.cooldown_turns||0}" min="0" style="width:60px"></div>
      </div>
      <div style="margin-top:6px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <label style="font-size:0.78rem"><input type="checkbox" id="ab-hitroll" ${d.requires_hit_roll?'checked':''}> Requires Hit Roll</label>
        <div id="ab-hitstat-row" style="display:${d.requires_hit_roll?'flex':'none'};gap:6px;align-items:center">
          <label style="font-size:0.72rem">Hit stat:</label>
          <select id="ab-hitstat" style="font-size:0.78rem">${_AB_STATS.map(s => `<option value="${s}" ${s===(d.hit_stat||'strength')?'selected':''}>${s.substring(0,3).toUpperCase()}</option>`).join('')}</select>
        </div>
        <!-- Rework v3 Phase 7: battle-grid range. 1 = touch/adjacent; higher = reach/ranged. -->
        <div style="display:flex;gap:6px;align-items:center" title="Max distance in battle-grid cells (1 = touch)">
          <label style="font-size:0.72rem">📏 Range (cells)</label>
          <input id="ab-range-cells" type="number" value="${d.range_cells ?? 1}" min="1" max="40" style="width:56px">
        </div>
      </div>
    </fieldset>

    <!-- Section 4: Damage -->
    <fieldset style="border:1px solid var(--border);border-radius:var(--r-md);padding:10px;margin-bottom:10px">
      <legend style="font-size:0.78rem;font-weight:700;padding:0 6px">🗡️ Damage</legend>
      <label style="font-size:0.78rem"><input type="checkbox" id="ab-has-dmg" ${d.damage_dice_count?'checked':''}> This ability deals damage</label>
      <div id="ab-dmg-fields" style="display:${d.damage_dice_count?'flex':'none'};gap:8px;margin-top:6px;flex-wrap:wrap;align-items:center">
        <input id="ab-ddc" type="number" value="${d.damage_dice_count||1}" min="1" style="width:50px">
        <span>d</span>
        <select id="ab-ddt" style="font-size:0.78rem">${[4,6,8,10,12,20].map(v => `<option value="${v}" ${v===(d.damage_dice_type||6)?'selected':''}>${v}</option>`).join('')}</select>
        <label style="font-size:0.72rem">Dmg stat:</label>
        <select id="ab-dmgstat" style="font-size:0.78rem"><option value="">None</option>${_AB_STATS.map(s => `<option value="${s}" ${s===(d.damage_stat||'strength')?'selected':''}>${s.substring(0,3).toUpperCase()}</option>`).join('')}</select>
      </div>
    </fieldset>

    <!-- Section 5: Effects Chain -->
    <fieldset style="border:1px solid var(--border);border-radius:var(--r-md);padding:10px;margin-bottom:10px">
      <legend style="font-size:0.78rem;font-weight:700;padding:0 6px">✨ Effects Chain</legend>
      <div id="ab-effects-list"></div>
      <button class="btn btn-ghost btn-xs" id="ab-add-effect" style="margin-top:4px">+ Add Effect</button>
    </fieldset>

    <!-- Rework v2 Section: Pool, Rarity, Uses, Conditional -->
    <fieldset style="border:1px solid var(--border);border-radius:var(--r-md);padding:10px;margin-bottom:10px">
      <legend style="font-size:0.78rem;font-weight:700;padding:0 6px">🎁 Starting Pool & Uses</legend>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
        <label style="font-size:0.72rem;display:flex;flex-direction:column;gap:2px">Rarity
          <select id="ab-rarity" style="font-size:0.78rem">
            ${['common','uncommon','rare','epic','legendary'].map(r => `<option value="${r}" ${r===(d.rarity||'common')?'selected':''}>${r}</option>`).join('')}
          </select>
        </label>
        <label style="font-size:0.78rem;display:flex;align-items:center;gap:4px">
          <input type="checkbox" id="ab-starting-pool" ${d.is_in_starting_pool?'checked':''}>
          🎁 In starting pool (d4-pickable by wizard)
        </label>
        <label style="font-size:0.72rem;display:flex;flex-direction:column;gap:2px" title="Leave blank or 0 for infinite uses.">Max Uses
          <input type="number" id="ab-max-uses" min="0" value="${d.max_uses ?? ''}" placeholder="∞" style="width:60px;font-size:0.78rem">
        </label>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <label style="font-size:0.78rem;display:flex;align-items:center;gap:4px">
          <input type="checkbox" id="ab-conditional" ${d.is_conditional?'checked':''}>
          ※ Conditional (flavor-only, no mechanics)
        </label>
        <input id="ab-conditional-text" type="text" placeholder="When condition X is met…" value="${(d.conditional_text||'').replace(/"/g,'&quot;')}"
               style="flex:1;font-size:0.78rem;display:${d.is_conditional?'':'none'}">
      </div>
    </fieldset>

    <!-- Section 6: Passive Effect (if passive type) -->
    <fieldset id="ab-passive-section" style="border:1px solid var(--border);border-radius:var(--r-md);padding:10px;margin-bottom:10px;display:${d.ability_type==='passive'?'block':'none'}">
      <legend style="font-size:0.78rem;font-weight:700;padding:0 6px">🔵 Passive Effect</legend>
      <div id="ab-passive-list"></div>
      <button class="btn btn-ghost btn-xs" id="ab-add-passive" style="margin-top:4px">+ Add Bonus</button>
    </fieldset>

    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button class="btn btn-ghost btn-sm" id="ab-cancel">Cancel</button>
      <button class="btn btn-primary btn-sm" id="ab-save">${existing ? 'Save Changes' : 'Create Ability'}</button>
    </div>
  </div>`;

  document.body.appendChild(overlay);

  // ── Wire icon picker ──
  let selectedIcon = d.icon || '⚡';
  overlay.querySelectorAll('.ab-icon-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.ab-icon-pick').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedIcon = btn.dataset.icon;
    });
  });

  // ── Toggle visibility based on radio/checkbox ──
  overlay.querySelectorAll('[name="ab-target"]').forEach(r => r.addEventListener('change', () => {
    overlay.querySelector('#ab-aoe-row').style.display = overlay.querySelector('[name="ab-target"]:checked').value === 'aoe' ? 'flex' : 'none';
  }));
  overlay.querySelectorAll('[name="ab-type"]').forEach(r => r.addEventListener('change', () => {
    overlay.querySelector('#ab-passive-section').style.display = overlay.querySelector('[name="ab-type"]:checked').value === 'passive' ? 'block' : 'none';
  }));
  overlay.querySelector('#ab-dmgtype').addEventListener('change', () => {
    overlay.querySelector('#ab-custom-dmg').style.display = overlay.querySelector('#ab-dmgtype').value === 'custom' ? '' : 'none';
  });
  overlay.querySelector('#ab-hitroll').addEventListener('change', () => {
    overlay.querySelector('#ab-hitstat-row').style.display = overlay.querySelector('#ab-hitroll').checked ? 'flex' : 'none';
  });
  overlay.querySelector('#ab-has-dmg').addEventListener('change', () => {
    overlay.querySelector('#ab-dmg-fields').style.display = overlay.querySelector('#ab-has-dmg').checked ? 'flex' : 'none';
  });
  // Rework v2: conditional-text shown only when conditional is on
  overlay.querySelector('#ab-conditional').addEventListener('change', () => {
    overlay.querySelector('#ab-conditional-text').style.display = overlay.querySelector('#ab-conditional').checked ? '' : 'none';
  });

  // ── Effects chain ──
  let editorEffects = [...effects];
  function renderEffectsEditor() {
    const el = overlay.querySelector('#ab-effects-list');
    if (!editorEffects.length) { el.innerHTML = '<span class="text-muted" style="font-size:0.72rem">No effects</span>'; return; }
    el.innerHTML = editorEffects.map((e, i) => {
      let fields = '';
      if (e.type === 'heal_hp' || e.type === 'damage') {
        fields = `<input type="number" data-ef="dice_count" value="${e.dice_count||1}" min="1" style="width:40px" placeholder="dc"> d <input type="number" data-ef="dice_type" value="${e.dice_type||6}" style="width:40px" placeholder="dt"> + <input type="number" data-ef="flat_bonus" value="${e.flat_bonus||0}" style="width:40px" placeholder="bonus">`;
      } else if (e.type === 'restore_mana') {
        fields = `Amount: <input type="number" data-ef="amount" value="${e.amount||0}" style="width:50px">`;
      } else if (e.type === 'restore_hp_by_die') {
        // Rework v3: rolls caster's race HP die for healing. Only flat bonus is tunable.
        fields = `<span style="color:var(--text-muted)" title="Rolls the caster's race HP die">🎲 race die</span> + <input type="number" data-ef="flat_bonus" value="${e.flat_bonus||0}" style="width:40px" placeholder="bonus">`;
      } else if (e.type === 'apply_status') {
        fields = `Template ID: <input type="number" data-ef="template_id" value="${e.template_id||''}" style="width:50px"> Duration: <input type="number" data-ef="duration_turns" value="${e.duration_turns||3}" style="width:40px">t`;
      } else if (e.type === 'stat_boost') {
        fields = `Stat: <select data-ef="stat">${_AB_STATS.map(s => `<option value="${s}" ${s===e.stat?'selected':''}>${s.substring(0,3)}</option>`).join('')}</select> Value: <input type="number" data-ef="value" value="${e.value||0}" style="width:40px"> Duration: <input type="number" data-ef="duration_turns" value="${e.duration_turns||3}" style="width:40px">t`;
      } else if (e.type === 'remove_status') {
        fields = `Status name: <input data-ef="status_name" value="${e.status_name||''}" style="width:100px">`;
      } else if (e.type === 'custom' || e.type === 'teleport') {
        fields = `Desc: <input data-ef="description" value="${e.description||''}" style="width:180px">`;
      } else if (e.type === 'summon_npc') {
        fields = `Template ID: <input type="number" data-ef="template_id" value="${e.template_id||''}" style="width:50px"> Count: <input type="number" data-ef="count" value="${e.count||1}" style="width:40px">`;
      }
      return `<div style="display:flex;gap:4px;align-items:center;margin-bottom:4px;font-size:0.72rem" data-eff-idx="${i}">
        <select data-ef-type style="font-size:0.72rem">${_AB_EFF_TYPES.map(t => `<option value="${t}" ${t===e.type?'selected':''}>${t}</option>`).join('')}</select>
        ${fields}
        <button class="btn btn-ghost btn-xs" data-rm-eff="${i}" style="color:var(--accent-red)">✕</button>
      </div>`;
    }).join('');

    // Wire type change
    el.querySelectorAll('[data-ef-type]').forEach(sel => {
      sel.addEventListener('change', () => {
        const idx = parseInt(sel.closest('[data-eff-idx]').dataset.effIdx);
        editorEffects[idx] = { type: sel.value };
        renderEffectsEditor();
      });
    });
    // Wire field changes
    el.querySelectorAll('[data-ef]').forEach(inp => {
      inp.addEventListener('change', () => {
        const idx = parseInt(inp.closest('[data-eff-idx]').dataset.effIdx);
        const key = inp.dataset.ef;
        const v = inp.type === 'number' ? (parseInt(inp.value)||0) : inp.value;
        editorEffects[idx][key] = v;
      });
    });
    // Wire remove
    el.querySelectorAll('[data-rm-eff]').forEach(btn => {
      btn.addEventListener('click', () => {
        editorEffects.splice(parseInt(btn.dataset.rmEff), 1);
        renderEffectsEditor();
      });
    });
  }
  renderEffectsEditor();
  overlay.querySelector('#ab-add-effect').addEventListener('click', () => {
    editorEffects.push({ type: 'damage', dice_count: 1, dice_type: 6, flat_bonus: 0 });
    renderEffectsEditor();
  });

  // ── Passive bonuses ──
  let passiveBonuses = passiveEff.bonuses || [];
  function renderPassiveEditor() {
    const el = overlay.querySelector('#ab-passive-list');
    if (!passiveBonuses.length) { el.innerHTML = '<span class="text-muted" style="font-size:0.72rem">No passive bonuses</span>'; return; }
    el.innerHTML = passiveBonuses.map((b, i) => {
      const opts = _AB_PASSIVE_BONUS_TYPES.map(t =>
        `<option value="${t.value}" ${b.bonus_type===t.value?'selected':''}>${t.label}</option>`
      ).join('');
      const needsStat = b.bonus_type === 'stat_bonus';
      const statOpts = _AB_STATS.map(s =>
        `<option value="${s}" ${s===(b.stat||'strength')?'selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`
      ).join('');
      return `<div style="display:flex;gap:4px;align-items:center;margin-bottom:3px;font-size:0.72rem;flex-wrap:wrap" data-pb-idx="${i}">
        <select data-pb="bonus_type" style="font-size:0.72rem">${opts}</select>
        <select data-pb="stat" style="font-size:0.72rem;display:${needsStat?'':'none'}">${statOpts}</select>
        Value: <input type="number" data-pb="value" value="${b.value||0}" style="width:60px">
        <button class="btn btn-ghost btn-xs" data-rm-pb="${i}" style="color:var(--accent-red)">✕</button>
    </div>`;
    }).join('');
    el.querySelectorAll('[data-pb]').forEach(inp => {
      inp.addEventListener('change', () => {
        const idx = parseInt(inp.closest('[data-pb-idx]').dataset.pbIdx);
        passiveBonuses[idx][inp.dataset.pb] = inp.type === 'number' ? (parseInt(inp.value)||0) : inp.value;
      });
    });
    el.querySelectorAll('[data-rm-pb]').forEach(btn => {
      btn.addEventListener('click', () => { passiveBonuses.splice(parseInt(btn.dataset.rmPb), 1); renderPassiveEditor(); });
    });
  }
  renderPassiveEditor();
  overlay.querySelector('#ab-add-passive').addEventListener('click', () => {
    passiveBonuses.push({ bonus_type: 'attack_bonus', value: 1 });
    renderPassiveEditor();
  });

  // ── Cancel / Save ──
  overlay.querySelector('#ab-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#ab-save').addEventListener('click', async () => {
    const hasDmg = overlay.querySelector('#ab-has-dmg').checked;
    const body = {
      name: overlay.querySelector('#ab-name').value.trim() || 'Ability',
      description: overlay.querySelector('#ab-flavor').value.trim(),
      session_id: SESSION_ID,
      icon: selectedIcon,
      color: overlay.querySelector('#ab-color').value,
      flavor_text: overlay.querySelector('#ab-flavor').value.trim() || null,
      notes: overlay.querySelector('#ab-notes').value.trim() || null,
      tags: overlay.querySelector('#ab-tags').value.split(',').map(s => s.trim()).filter(Boolean),
      ability_type: overlay.querySelector('[name="ab-type"]:checked')?.value || 'active',
      target_type: overlay.querySelector('[name="ab-target"]:checked')?.value || 'single',
      aoe_radius: overlay.querySelector('[name="ab-target"]:checked')?.value === 'aoe' ? (parseInt(overlay.querySelector('#ab-aoe').value)||3) : null,
      damage_type: overlay.querySelector('#ab-dmgtype').value,
      custom_damage_type: overlay.querySelector('#ab-dmgtype').value === 'custom' ? overlay.querySelector('#ab-custom-dmg').value : null,
      mana_cost: parseInt(overlay.querySelector('#ab-mana').value) || 0,
      hp_cost: parseInt(overlay.querySelector('#ab-hpcost').value) || 0,
      cooldown_turns: parseInt(overlay.querySelector('#ab-cd').value) || 0,
      requires_hit_roll: overlay.querySelector('#ab-hitroll').checked,
      hit_stat: overlay.querySelector('#ab-hitstat').value,
      // Rework v3 Phase 7: range in battle-grid cells (1 = touch / adjacent).
      range_cells: Math.max(1, parseInt(overlay.querySelector('#ab-range-cells').value) || 1),
      damage_stat: hasDmg ? overlay.querySelector('#ab-dmgstat').value : 'strength',
      damage_dice_count: hasDmg ? (parseInt(overlay.querySelector('#ab-ddc').value)||1) : null,
      damage_dice_type: hasDmg ? (parseInt(overlay.querySelector('#ab-ddt').value)||6) : null,
      is_passive: (overlay.querySelector('[name="ab-type"]:checked')?.value || 'active') === 'passive',
      passive_effect: passiveBonuses.length ? { bonuses: passiveBonuses } : null,
      effect: { effects: editorEffects },
      // Rework v2 — pool / rarity / uses / conditional
      rarity: overlay.querySelector('#ab-rarity').value || 'common',
      is_in_starting_pool: overlay.querySelector('#ab-starting-pool').checked,
      max_uses: (() => {
        const v = overlay.querySelector('#ab-max-uses').value;
        if (v === '' || v === null) return null;
        const n = parseInt(v);
        return (isNaN(n) || n <= 0) ? null : n;
      })(),
      is_conditional: overlay.querySelector('#ab-conditional').checked,
      conditional_text: overlay.querySelector('#ab-conditional-text').value.trim() || null,
    };

    try {
      if (existing) {
        await api.put(`/api/abilities/${existing.id}`, body);
      } else {
        await api.post('/api/abilities', body);
      }
      overlay.remove();
      loadGmAbilities();
    } catch (e) { showToast('Save failed: ' + (e.message || '')); }
  });
}

if ($('#btn-new-ability')) {
  $('#btn-new-ability').addEventListener('click', () => showAbilityEditor());
}

// ══════════════════════════════════════════════════════════════
// NPC Picker Modal (used by NPC Actions panel)
// ══════════════════════════════════════════════════════════════
function openNpcPickerModal(title, items) {
  if (!items || !items.length) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:9999';
  overlay.innerHTML = `
    <div class="modal-content" style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:16px;max-width:400px;width:90%;max-height:70vh;overflow-y:auto">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <h3 style="flex:1;margin:0;font-size:1rem">${title}</h3>
        <button class="btn-icon" id="npc-picker-close">✕</button>
      </div>
      <div id="npc-picker-items" style="display:flex;flex-direction:column;gap:6px">
        ${items.map((it, i) => `
          <button class="btn btn-ghost" data-pick="${i}" style="text-align:left;padding:8px 10px;display:flex;flex-direction:column;align-items:flex-start;gap:2px">
            <span style="font-weight:600">${it.label}</span>
            ${it.sub ? `<span style="font-size:0.72rem;color:var(--text-muted)">${it.sub}</span>` : ''}
          </button>
        `).join('')}
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#npc-picker-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('[data-pick]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.pick);
      close();
      if (items[idx] && items[idx].onPick) await items[idx].onPick();
    });
  });
}

// Wire table.updated WS event — refresh NPC list so map/hp toggles stay in sync
ws.on('table.updated', () => {
  renderNPCList();
});

// ══════════════════════════════════════════════════════════════
// NPC FLOATING CONTROL PANELS
// ══════════════════════════════════════════════════════════════
const npcPanels = {};

function getNpcPanelCount() { return Object.keys(npcPanels).length; }

function _makeNpcPanelHtml(npc) {
  const pct = npc.max_hp > 0 ? Math.round((npc.current_hp / npc.max_hp) * 100) : 0;
  const hpColor = pct > 50 ? 'var(--hp-high)' : pct > 25 ? 'var(--hp-mid)' : 'var(--hp-low)';
  return `
    <div class="npc-control-panel" data-npc-panel="${npc.id}" style="top:${60 + getNpcPanelCount()*12}px;left:${14 + getNpcPanelCount()*14}px">
      <div class="npc-panel-header">
        <span style="font-size:0.85rem">${npc.token_color ? '●' : '○'}</span>
        <span class="npc-panel-name">${npc.name}</span>
        <button class="npc-panel-close" title="Close">×</button>
      </div>
      <div class="npc-panel-body">
        <div class="npc-panel-hpbar"><div style="width:${pct}%;background:${hpColor}"></div></div>
        <div class="npc-panel-stats">
          <span>AC ${npc.armor_class}</span>
          <span>HP ${npc.current_hp}/${npc.max_hp}</span>
          <span style="flex:1;text-align:right">${!npc.is_alive ? '💀' : ''}</span>
        </div>
        <div class="npc-panel-statuses" data-npc-panel-statuses="${npc.id}" style="display:flex;flex-wrap:wrap;gap:2px;font-size:0.6rem"></div>

        <div style="border-top:1px solid var(--border);margin:2px 0"></div>

        <!-- WEAPON INFO -->
        <div class="npc-panel-weapon-info" data-npc-panel-weapon="${npc.id}" style="font-size:0.62rem;color:var(--text-muted)">
          <span>Loading weapon…</span>
        </div>

        <div style="font-size:0.62rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;font-weight:600">Target</div>
        <select class="npc-panel-target" data-npc-panel-target="${npc.id}" style="width:100%;font-size:0.7rem">
          <option value="">— select —</option>
        </select>

        <!-- ADVANTAGE TOGGLE (shared for hit & damage) -->
        <div style="display:flex;gap:0;border-radius:var(--r-sm);overflow:hidden;border:1px solid var(--border);height:22px" data-npc-panel-adv="${npc.id}">
          <button class="adv-btn" data-mode="normal" style="border:none;background:var(--bg-surface-3);color:var(--text-primary);padding:0 8px;cursor:pointer;font-size:0.6rem;font-weight:700">Normal</button>
          <button class="adv-btn" data-mode="advantage" style="border:none;background:var(--bg-surface-2);color:var(--text-muted);padding:0 8px;cursor:pointer;font-size:0.6rem">Adv</button>
          <button class="adv-btn" data-mode="disadvantage" style="border:none;background:var(--bg-surface-2);color:var(--text-muted);padding:0 8px;cursor:pointer;font-size:0.6rem">Dis</button>
        </div>

        <!-- STEP 1: HIT ROLL (with d20 dice count, e.g. multi-attack) -->
        <div data-npc-panel-hit="${npc.id}" style="display:flex;gap:4px;align-items:center">
          <label style="font-size:0.62rem;color:var(--text-muted)" title="Number of d20 to roll (best counts)">×</label>
          <input type="number" data-npc-panel-hit-count="${npc.id}" value="1" min="1" max="10" style="width:42px;font-size:0.72rem;text-align:center" title="d20 dice count">
          <button class="btn btn-primary btn-xs" data-npc-panel-roll-hit="${npc.id}" style="flex:1">⚔ Roll Hit</button>
        </div>

        <!-- STEP 2: DAMAGE (hidden until hit). Dice shown only for unarmed; mode selector for multi-mode weapons. -->
        <div data-npc-panel-damage="${npc.id}" style="display:none;flex-direction:column;gap:4px">
          <div data-npc-panel-dmg-modewrap="${npc.id}" style="display:none">
            <select data-npc-panel-dmg-mode="${npc.id}" style="width:100%;font-size:0.65rem"></select>
          </div>
          <div data-npc-panel-dmg-dicewrap="${npc.id}" style="display:none;align-items:center;gap:4px">
            <input type="number" data-npc-panel-dmg-count="${npc.id}" value="1" min="1" style="width:36px;font-size:0.65rem;text-align:center" title="Dice count">
            <select data-npc-panel-dmg-die="${npc.id}" style="font-size:0.65rem;flex:1">
              <option value="4">d4</option>
              <option value="6">d6</option>
              <option value="8" selected>d8</option>
              <option value="10">d10</option>
              <option value="12">d12</option>
              <option value="20">d20</option>
            </select>
          </div>
          <div data-npc-panel-dmg-readonly="${npc.id}" style="display:none;font-size:0.65rem;color:var(--text-muted);padding:2px 4px;background:var(--bg-surface-2);border-radius:3px"></div>
          <div style="display:flex;gap:4px">
            <button class="btn btn-primary btn-xs" data-npc-panel-roll-dmg="${npc.id}" style="flex:1">💥 Roll Damage</button>
            <button class="btn btn-ghost btn-xs" data-npc-panel-cancel-dmg="${npc.id}" style="padding:2px 6px">✕</button>
          </div>
        </div>

        <div class="npc-panel-result hidden" data-npc-panel-result="${npc.id}"></div>

        <!-- DEFEND -->
        <div style="border-top:1px solid var(--border);margin:2px 0"></div>
        <div class="npc-panel-actions">
          <button class="btn btn-ghost btn-xs npc-panel-def" data-npc="${npc.id}">🛡 Defend</button>
          <button class="btn btn-ghost btn-xs npc-panel-heal-btn" data-npc="${npc.id}">❤ Quick Heal</button>
        </div>
        <div data-npc-panel-heal-box="${npc.id}" style="display:none;flex-direction:column;gap:4px">
          <div style="display:flex;gap:4px;align-items:center">
            <input type="number" data-npc-panel-heal-input="${npc.id}" placeholder="HP" style="width:60px;font-size:0.7rem" min="0">
            <button class="btn btn-primary btn-xs" data-npc-panel-heal-ok="${npc.id}">Heal</button>
            <button class="btn btn-ghost btn-xs" data-npc-panel-heal-cancel="${npc.id}">✕</button>
          </div>
        </div>

        <!-- ABILITIES (inline list) -->
        <div style="border-top:1px solid var(--border);margin:2px 0"></div>
        <div style="font-size:0.62rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;font-weight:600">Abilities</div>
        <div data-npc-panel-abilities="${npc.id}" style="max-height:90px;overflow-y:auto;font-size:0.65rem;display:flex;flex-direction:column;gap:3px">
          <span style="color:var(--text-muted)">Loading…</span>
        </div>

        <!-- ITEMS (inline list) -->
        <div style="border-top:1px solid var(--border);margin:2px 0"></div>
        <div style="font-size:0.62rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;font-weight:600">Items</div>
        <div data-npc-panel-items="${npc.id}" style="max-height:70px;overflow-y:auto;font-size:0.65rem;display:flex;flex-direction:column;gap:3px">
          <span style="color:var(--text-muted)">Loading…</span>
        </div>
      </div>
    </div>`;
}

async function openNpcControlPanel(npcId) {
  if (npcPanels[npcId]) {
    // Already open — bring to front and refresh
    updateNpcControlPanel(npcId);
    const el = document.querySelector(`[data-npc-panel="${npcId}"]`);
    if (el) {
      el.style.zIndex = 300;
      Object.values(npcPanels).forEach(p => {
        if (p.id !== npcId) p.el.style.zIndex = 200;
      });
    }
    return;
  }
  const npc = characters.find(c => c.id === npcId);
  if (!npc || !npc.is_npc) return;

  const html = _makeNpcPanelHtml(npc);
  document.body.insertAdjacentHTML('beforeend', html);
  const el = document.querySelector(`[data-npc-panel="${npcId}"]`);
  npcPanels[npcId] = { id: npcId, el };

  // Draggable header
  const header = el.querySelector('.npc-panel-header');
  let dragOffX = 0, dragOffY = 0, dragging = false;
  header.addEventListener('mousedown', e => {
    dragging = true;
    const rect = el.getBoundingClientRect();
    dragOffX = e.clientX - rect.left;
    dragOffY = e.clientY - rect.top;
    el.style.zIndex = 300;
    Object.values(npcPanels).forEach(p => { if (p.id !== npcId) p.el.style.zIndex = 200; });
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    el.style.left = (e.clientX - dragOffX) + 'px';
    el.style.top = (e.clientY - dragOffY) + 'px';
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  // Close
  el.querySelector('.npc-panel-close').addEventListener('click', () => {
    el.remove();
    delete npcPanels[npcId];
  });

  // Populate target dropdown
  const targetSel = el.querySelector(`[data-npc-panel-target="${npcId}"]`);
  const aliveChars = characters.filter(c => c.is_alive && c.id !== npcId);
  targetSel.innerHTML = '<option value="">— select —</option>' +
    aliveChars.map(c => `<option value="${c.id}">${c.name} ${c.is_npc?'[NPC]':''}</option>`).join('');

  // Load weapon info, abilities, items, status effects
  _loadNpcPanelWeapon(npcId);
  _loadNpcPanelStatuses(npcId);
  _loadNpcPanelAbilities(npcId);
  _loadNpcPanelItems(npcId);

  // Wire actions
  _wireNpcPanelActions(el, npcId);
}

async function _loadNpcPanelStatuses(npcId) {
  const el = document.querySelector(`[data-npc-panel-statuses="${npcId}"]`);
  if (!el) return;
  try {
    const effects = await api.get(`/api/characters/${npcId}/status-effects`);
    if (!effects.length) { el.innerHTML = ''; return; }
    el.innerHTML = effects.map(e => {
      const turns = e.remaining_turns !== null ? e.remaining_turns+'t' : '';
      return `<span style="background:${e.color}20;border:1px solid ${e.color};border-radius:3px;padding:0 3px" title="${e.name}">${e.icon}${turns}</span>`;
    }).join('');
  } catch { el.innerHTML = ''; }
}

async function _loadNpcPanelWeapon(npcId) {
   const el = document.querySelector(`[data-npc-panel-weapon="${npcId}"]`);
   if (!el) return;
   try {
     const inv = await api.get(`/api/characters/${npcId}/inventory`);
     // Find equipped weapon (not just any equipped item)
     const weapon = (inv.items || []).find(i => i.is_equipped && i.category === 'weapon');
     if (weapon) {
       const ws = weapon.weapon_stats || {};
       const dmg = ws.dice_count && ws.dice_type ? `${ws.dice_count}d${ws.dice_type}` : '—';
       // Calculate damage bonus from item bonuses
       const dmgBonus = (weapon.bonuses || []).reduce((sum, b) => {
         return sum + (b.bonus_type === 'damage_bonus' ? b.value : 0);
       }, 0);
       const bonus = dmgBonus ? `+${dmgBonus}` : '';
       el.innerHTML = `<span style="color:var(--accent)">⚔ ${weapon.name}</span> · ${dmg}${bonus} · ${ws.weapon_range || ''}`;
     } else {
       el.innerHTML = `<span style="color:var(--text-muted)">No weapon equipped</span>`;
     }
 } catch (e) { el.innerHTML = ''; }
 }

async function _loadNpcPanelAbilities(npcId) {
    const el = document.querySelector(`[data-npc-panel-abilities="${npcId}"]`);
    if (!el) return;
    try {
      const abs = await api.get(`/api/characters/${npcId}/abilities`);
      // Validate we got an array
      if (!Array.isArray(abs)) {
        console.warn('Expected array for abilities, got:', abs);
        el.innerHTML = '<span style="color:var(--text-muted)">Invalid data</span>';
        return;
      }
     const active = abs.filter(a => !a.is_passive);
     if (!active.length) { 
       if (abs.length === 0) {
         el.innerHTML = '<span style="color:var(--text-muted)">No abilities assigned</span>';
       } else {
         const passiveCount = abs.filter(a => a.is_passive).length;
         el.innerHTML = `<span style="color:var(--text-muted)">${abs.length} abilities (${passiveCount} passive)</span>`;
       }
       return; 
     }
     el.innerHTML = active.map(a => {
       const onCd = (a.cooldown_remaining||0) > 0;
       const cdInfo = a.cooldown_turns ? `CD ${a.cooldown_turns}` : '';
       return `<div style="display:flex;align-items:center;gap:4px;padding:2px 4px;border-radius:4px;${onCd?'opacity:0.45':''}">
         <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${'✨'} ${a.name}</span>
         <span style="color:var(--text-muted);font-size:0.55rem">${cdInfo}</span>
         ${onCd ? `<span style="color:var(--text-muted);font-size:0.55rem">${a.cooldown_remaining}t</span>` : `<button class="btn btn-primary btn-xs" data-npc-panel-use-ability="${npcId}" data-ability="${a.character_ability_id}" style="font-size:0.55rem;padding:1px 5px">Use</button>`}
       </div>`;
     }).join('');
     // Wire inline ability buttons
     el.querySelectorAll('[data-npc-panel-use-ability]').forEach(btn => {
       btn.addEventListener('click', async () => {
         const aid = parseInt(btn.dataset.ability);
         btn.disabled = true;
         try {
           const res = await api.post(`/api/character-abilities/${aid}/use`, {});
           const msg = (res.results || []).join(' · ') || 'Ability used';
           _showNpcPanelResult(npcId, `<b>✅</b> ${msg}`);
           _loadNpcPanelAbilities(npcId);
           refreshChars();
         } catch(e) {
           let m='Ability failed'; try{const er=JSON.parse(e.message);m=er.detail?.message||er.detail||m;}catch{}
           _showNpcPanelResult(npcId, `<b>❌</b> ${m}`, true);
         } finally { btn.disabled = false; }
       });
     });
   } catch (e) {
     console.error('Error loading NPC abilities:', e);
     el.innerHTML = '<span style="color:var(--text-muted)">Error loading</span>';
   }
 }

async function _loadNpcPanelItems(npcId) {
   const el = document.querySelector(`[data-npc-panel-items="${npcId}"]`);
   if (!el) return;
   try {
     const inv = await api.get(`/api/characters/${npcId}/inventory`);
     // Validate inventory response structure
     if (!inv || !Array.isArray(inv.items)) {
       console.warn('Invalid inventory response:', inv);
       el.innerHTML = '<span style="color:var(--text-muted)">Invalid inventory data</span>';
       return;
     }
     const items = inv.items.filter(i => i.consumable || i.is_potion);
     if (!items.length) { 
       const totalItems = inv.items.length;
       el.innerHTML = totalItems === 0 
         ? '<span style="color:var(--text-muted)">No items in inventory</span>' 
         : `<span style="color:var(--text-muted)">${totalItems} items (none usable)</span>`;
       return; 
     }
     el.innerHTML = items.map(it => `<div style="display:flex;align-items:center;gap:4px;padding:2px 4px;border-radius:4px">
       <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${it.description||''}">${it.potion_icon||'🧪'} ${it.name}</span>
       <span style="color:var(--text-muted);font-size:0.55rem">x${it.quantity}</span>
       <button class="btn btn-primary btn-xs" data-npc-panel-use-item="${npcId}" data-inventory-id="${it.inventory_id}" style="font-size:0.55rem;padding:1px 5px">Use</button>
     </div>`).join('');
     // Wire inline item buttons
     el.querySelectorAll('[data-npc-panel-use-item]').forEach(btn => {
       btn.addEventListener('click', async () => {
         const iid = parseInt(btn.dataset.inventoryId);
         btn.disabled = true;
         try {
           const res = await api.post(`/api/inventory/${iid}/use`, {});
           _showNpcPanelResult(npcId, `<b>✅</b> ${res.breakdown||'used'}`);
           _loadNpcPanelItems(npcId);
           refreshChars();
         } catch(e) { 
           let errorMsg = 'Use failed';
           try {
             if (e.body && e.body.detail) errorMsg = e.body.detail;
             else if (typeof e === 'string') errorMsg = e;
           } finally {
             _showNpcPanelResult(npcId, `<b>❌</b> ${errorMsg}`, true);
           }
         } finally { 
           btn.disabled = false; 
         }
       });
     });
   } catch (e) {
     console.error('Error loading NPC items:', e);
     el.innerHTML = '<span style="color:var(--text-muted)">Error loading items</span>';
   }
 }

function updateNpcControlPanel(npcId) {
  const p = npcPanels[npcId];
  if (!p) return;
  const npc = characters.find(c => c.id === npcId);
  if (!npc) { p.el.remove(); delete npcPanels[npcId]; return; }
  const pct = npc.max_hp > 0 ? Math.round((npc.current_hp / npc.max_hp) * 100) : 0;
  const hpColor = pct > 50 ? 'var(--hp-high)' : pct > 25 ? 'var(--hp-mid)' : 'var(--hp-low)';
  const bar = p.el.querySelector('.npc-panel-hpbar > div');
  if (bar) { bar.style.width = pct + '%'; bar.style.background = hpColor; }
  const stats = p.el.querySelector('.npc-panel-stats');
  if (stats) stats.innerHTML = `<span>AC ${npc.armor_class}</span><span>HP ${npc.current_hp}/${npc.max_hp}</span><span style="flex:1;text-align:right">${!npc.is_alive ? '💀' : ''}</span>`;
  _loadNpcPanelStatuses(npcId);
  // Refresh target list
  const targetSel = p.el.querySelector(`[data-npc-panel-target="${npcId}"]`);
  if (targetSel) {
    const prev = targetSel.value;
    const aliveChars = characters.filter(c => c.is_alive && c.id !== npcId);
    targetSel.innerHTML = '<option value="">— select —</option>' +
      aliveChars.map(c => `<option value="${c.id}">${c.name} ${c.is_npc?'[NPC]':''}</option>`).join('');
    if ([...targetSel.options].some(o => o.value === prev)) targetSel.value = prev;
  }
  // Refresh abilities/items lists (cooldowns, quantities)
  _loadNpcPanelAbilities(npcId);
  _loadNpcPanelItems(npcId);
}

function _showNpcPanelResult(npcId, html, isError=false) {
  const resEl = document.querySelector(`[data-npc-panel-result="${npcId}"]`);
  if (!resEl) return;
  resEl.classList.remove('hidden');
  resEl.style.borderLeftColor = isError ? 'var(--accent-red)' : 'var(--accent)';
  resEl.innerHTML = html;
  setTimeout(() => { if (resEl) resEl.classList.add('hidden'); }, 5000);
}

function _getNpcPanelAdvMode(npcId) {
  const wrap = document.querySelector(`[data-npc-panel-adv="${npcId}"]`);
  if (!wrap) return 'normal';
  const active = wrap.querySelector('.adv-btn.active');
  return active ? active.dataset.mode : 'normal';
}
function _setNpcPanelAdvMode(npcId, mode) {
  const wrap = document.querySelector(`[data-npc-panel-adv="${npcId}"]`);
  if (!wrap) return;
  wrap.querySelectorAll('.adv-btn').forEach(b => {
    const isActive = b.dataset.mode === mode;
    b.classList.toggle('active', isActive);
    b.style.background = isActive ? 'var(--bg-surface-3)' : 'var(--bg-surface-2)';
    b.style.color = isActive ? (mode==='advantage'?'var(--accent-green)':mode==='disadvantage'?'var(--accent-red)':'var(--text-primary)') : 'var(--text-muted)';
    b.style.fontWeight = isActive ? '700' : '400';
  });
}
// Reveal the damage step, populating either the damage_modes selector,
// the read-only weapon-locked dice display, or the editable dice (unarmed).
function _revealDmgStep(el, npcId, hitData) {
  const hitWrap = el.querySelector(`[data-npc-panel-hit="${npcId}"]`);
  const dmgWrap = el.querySelector(`[data-npc-panel-damage="${npcId}"]`);
  if (hitWrap) hitWrap.style.display = 'none';
  if (dmgWrap) dmgWrap.style.display = 'flex';

  const modeWrap = el.querySelector(`[data-npc-panel-dmg-modewrap="${npcId}"]`);
  const modeSel  = el.querySelector(`[data-npc-panel-dmg-mode="${npcId}"]`);
  const diceWrap = el.querySelector(`[data-npc-panel-dmg-dicewrap="${npcId}"]`);
  const roWrap   = el.querySelector(`[data-npc-panel-dmg-readonly="${npcId}"]`);
  if (modeWrap) modeWrap.style.display = 'none';
  if (diceWrap) diceWrap.style.display = 'none';
  if (roWrap)   roWrap.style.display = 'none';

  const modes = Array.isArray(hitData.damage_modes) ? hitData.damage_modes : [];
  const isUnarmed = !hitData.weapon_name || hitData.weapon_name === 'Unarmed';
  const critMul = hitData.critical ? 2 : 1;

  if (modes.length) {
    if (modeSel) {
      modeSel.innerHTML = modes.map((m, i) =>
        `<option value="${i}">${m.label || `Mode ${i+1}`} · ${(m.dice_count||1)*critMul}d${m.dice_type||6}${m.damage_stat?` (${m.damage_stat.slice(0,3).toUpperCase()})`:''}</option>`
      ).join('');
    }
    if (modeWrap) modeWrap.style.display = '';
  } else if (isUnarmed) {
    if (diceWrap) diceWrap.style.display = 'flex';
    const dcEl = el.querySelector(`[data-npc-panel-dmg-count="${npcId}"]`);
    const dtEl = el.querySelector(`[data-npc-panel-dmg-die="${npcId}"]`);
    if (dcEl && hitData.default_dice_count) dcEl.value = hitData.default_dice_count;
    if (dtEl && hitData.default_dice_type) dtEl.value = hitData.default_dice_type;
  } else {
    // Locked weapon — surface editable count/die so GM can override (server now honors).
    if (diceWrap) diceWrap.style.display = 'flex';
    const dcEl = el.querySelector(`[data-npc-panel-dmg-count="${npcId}"]`);
    const dtEl = el.querySelector(`[data-npc-panel-dmg-die="${npcId}"]`);
    if (dcEl && hitData.default_dice_count) dcEl.value = hitData.default_dice_count;
    if (dtEl && hitData.default_dice_type) dtEl.value = hitData.default_dice_type;
    if (roWrap) {
      const dc = (hitData.default_dice_count || 1) * critMul;
      const dt = hitData.default_dice_type || 6;
      roWrap.style.display = '';
      roWrap.textContent = `${hitData.weapon_name} default: ${dc}d${dt}${hitData.critical?' (CRIT ×2)':''} — change to override`;
    }
  }
}

function _wireNpcPanelActions(el, npcId) {
  const advWrap = el.querySelector(`[data-npc-panel-adv="${npcId}"]`);
  if (advWrap) { _setNpcPanelAdvMode(npcId, 'normal'); advWrap.querySelectorAll('.adv-btn').forEach(b => b.addEventListener('click', () => _setNpcPanelAdvMode(npcId, b.dataset.mode))); }
  const hitWrap = el.querySelector(`[data-npc-panel-hit="${npcId}"]`);
  const dmgWrap = el.querySelector(`[data-npc-panel-damage="${npcId}"]`);
  const hitBtn = el.querySelector(`[data-npc-panel-roll-hit="${npcId}"]`);
  if (hitBtn) {
    hitBtn.addEventListener('click', async () => {
      const targetSel = el.querySelector(`[data-npc-panel-target="${npcId}"]`);
      const targetId = parseInt(targetSel?.value);
      if (!targetId) { _showNpcPanelResult(npcId, '<b>❌ Select a target first</b>', true); return; }
      const npc = characters.find(c => c.id === npcId);
      const target = characters.find(c => c.id === targetId);
      if (!npc || !target) return;
      hitBtn.disabled = true;
      try {
        const adv = _getNpcPanelAdvMode(npcId);
        const hitCountEl = el.querySelector(`[data-npc-panel-hit-count="${npcId}"]`);
        const hitDiceCount = Math.max(1, parseInt(hitCountEl?.value) || 1);
        const res = await api.post('/api/combat/hit-roll', { attacker_id: npcId, target_id: targetId, advantage: adv, hit_dice_count: hitDiceCount });
        // Cache hit context for the damage step (and for defense-resolve resume)
        if (npcPanels[npcId]) {
          npcPanels[npcId].hitData = res;
          npcPanels[npcId].targetId = targetId;
        }
        const color = res.hit ? (res.critical ? 'var(--accent-yellow)' : 'var(--accent-green)') : 'var(--accent-red)';
        const label = res.fumble ? '💨 FUMBLE' : res.critical ? '💥 CRITICAL' : res.hit ? '✅ HIT' : '❌ MISS';
        _showNpcPanelResult(npcId, `<div style="color:${color};font-weight:700">${label}</div><div style="font-size:0.62rem;color:var(--text-muted)">${res.hit_breakdown || ''}</div>`);
        if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
          ws.ws.send(JSON.stringify({ type: 'combat.hit_result', attacker_id: npcId, attacker_name: npc.name, target_id: targetId, target_name: target.name, hit: res.hit, critical: !!res.critical, fumble: !!res.fumble, hit_breakdown: res.hit_breakdown, total: res.total }));
        }
        if (res.hit) {
          if (res.pending_defense_id) {
            // Defense reaction is pending — wait for resolution.
            // combat.defense_resolved listener will reveal damage step (or close it on success).
            _showNpcPanelResult(npcId, `<div style="color:${color};font-weight:700">${label}</div><div style="font-size:0.62rem;color:var(--accent)">⏳ Waiting for ${target.name} to defend...</div>`);
          } else {
            // CRIT / fumble / no-defense path → reveal damage step
            _revealDmgStep(el, npcId, res);
          }
        }
      } catch (e) {
        let msg = e?.body?.detail?.message || e?.body?.detail || 'Attack failed';
        _showNpcPanelResult(npcId, `<b>❌</b> ${msg}`, true);
      } finally { hitBtn.disabled = false; }
    });
  }

  // ── STEP 2: Damage Roll ──
  const dmgBtn = el.querySelector(`[data-npc-panel-roll-dmg="${npcId}"]`);
  const cancelDmgBtn = el.querySelector(`[data-npc-panel-cancel-dmg="${npcId}"]`);
  if (cancelDmgBtn) {
    cancelDmgBtn.addEventListener('click', () => {
      hitWrap.style.display = 'flex';
      dmgWrap.style.display = 'none';
      if (npcPanels[npcId]) { npcPanels[npcId].hitData = null; }
    });
  }
  if (dmgBtn) {
    dmgBtn.addEventListener('click', async () => {
      const ctx = npcPanels[npcId] || {};
      const hitData = ctx.hitData;
      const targetId = ctx.targetId || parseInt(el.querySelector(`[data-npc-panel-target="${npcId}"]`)?.value);
      if (!targetId || !hitData) { _showNpcPanelResult(npcId, '<b>❌ Roll Hit first</b>', true); return; }
      const npc = characters.find(c => c.id === npcId);
      const target = characters.find(c => c.id === targetId);
      if (!npc || !target) return;
      const adv = _getNpcPanelAdvMode(npcId);
      // Body: critical from hitData; if NPC has weapon, server ignores dice_*; if unarmed-fallback, send overrides
      const body = {
        attacker_id: npcId, target_id: targetId,
        critical: !!hitData.critical, advantage: adv,
      };
      const modeSel = el.querySelector(`[data-npc-panel-dmg-mode="${npcId}"]`);
      if (modeSel && modeSel.value !== '') body.damage_mode_index = parseInt(modeSel.value);
      const dcEl = el.querySelector(`[data-npc-panel-dmg-count="${npcId}"]`);
      const dtEl = el.querySelector(`[data-npc-panel-dmg-die="${npcId}"]`);
      // Forward dice override; server honors when set (works for unarmed AND armed power-attacks)
      if (dcEl && dcEl.offsetParent !== null) body.dice_count = parseInt(dcEl.value) || 1;
      if (dtEl && dtEl.offsetParent !== null) body.dice_type = parseInt(dtEl.value) || 8;
      dmgBtn.disabled = true;
      try {
        const res = await api.post('/api/combat/damage-roll', body);
        const color = hitData.critical ? 'var(--accent-yellow)' : 'var(--accent-green)';
        _showNpcPanelResult(npcId, `
          <div style="color:${color};font-weight:700">💥 ${res.final_damage} DAMAGE${res.target_downed ? ' · 💀 DOWN' : ''}</div>
          <div style="font-size:0.62rem;color:var(--text-muted)">${res.damage_breakdown || ''}</div>
          <div style="font-size:0.62rem;color:var(--text-muted)">${res.intake_breakdown || ''}</div>
          <div style="font-size:0.62rem">${target.name}: HP ${res.target_hp_before}→<b>${res.target_hp_after}</b></div>
        `);
        if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
          ws.ws.send(JSON.stringify({
            type: 'combat.attack_result',
            attacker_id: npcId, attacker_name: npc.name,
            target_id: targetId, target_name: target.name,
            hit: true, critical: !!hitData.critical, fumble: false,
            final_damage: res.final_damage, target_hp_after: res.target_hp_after,
          }));
        }
        refreshChars();
        hitWrap.style.display = 'flex';
        dmgWrap.style.display = 'none';
        if (npcPanels[npcId]) { npcPanels[npcId].hitData = null; }
      } catch (e) {
        let msg = e?.body?.detail?.message || e?.body?.detail || 'Damage roll failed';
        _showNpcPanelResult(npcId, `<b>❌</b> ${msg}`, true);
      } finally { dmgBtn.disabled = false; }
    });
  }

  // Defend
  const defBtn = el.querySelector(`.npc-panel-def[data-npc="${npcId}"]`);
  if (defBtn) {
    defBtn.addEventListener('click', async () => {
      if (!activeCombat || activeCombat.status !== 'active') {
        _showNpcPanelResult(npcId, '<b>❌ No active combat</b>', true); return;
      }
      defBtn.disabled = true;
      try {
        const res = await api.post(`/api/combat/${activeCombat.id}/defend`, { character_id: npcId });
        _showNpcPanelResult(npcId, `<b>🛡 DEFENDING</b><div style="font-size:0.62rem;color:var(--text-muted)">New AC: ${res.new_ac}</div>`);
        if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
          ws.ws.send(JSON.stringify({ type: 'combat.defend', data: res }));
        }
      } catch (e) { _showNpcPanelResult(npcId, `<b>❌</b> ${e?.body?.detail || 'Defend failed'}`, true); }
      finally { defBtn.disabled = false; }
    });
  }

  // Heal expand / collapse
  const healToggle = el.querySelector(`.npc-panel-heal-btn[data-npc="${npcId}"]`);
  const healBox = el.querySelector(`[data-npc-panel-heal-box="${npcId}"]`);
  if (healToggle && healBox) {
    healToggle.addEventListener('click', () => {
      healBox.style.display = healBox.style.display === 'flex' ? 'none' : 'flex';
    });
    const healOk = el.querySelector(`[data-npc-panel-heal-ok="${npcId}"]`);
    const healCancel = el.querySelector(`[data-npc-panel-heal-cancel="${npcId}"]`);
    if (healCancel) healCancel.addEventListener('click', () => { healBox.style.display = 'none'; });
    if (healOk) {
      healOk.addEventListener('click', async () => {
        const input = el.querySelector(`[data-npc-panel-heal-input="${npcId}"]`);
        const amt = parseInt(input?.value) || 0;
        if (amt <= 0) return;
        const npc = characters.find(c => c.id === npcId);
        if (!npc) return;
        const newHp = Math.min(npc.max_hp, npc.current_hp + amt);
        try {
          await api.patch(`/api/characters/${npcId}`, { current_hp: newHp });
          _showNpcPanelResult(npcId, `<b>❤ Healed +${amt}</b> → HP ${newHp}/${npc.max_hp}`);
          healBox.style.display = 'none';
          refreshChars();
        } catch (e) { _showNpcPanelResult(npcId, `<b>❌</b> ${e?.body?.detail||'Heal failed'}`, true); }
      });
    }
  }
}

// Auto-update open panels when character data changes
function _updateAllNpcPanels() {
  Object.keys(npcPanels).forEach(id => updateNpcControlPanel(parseInt(id)));
}

// Wire open-panel from token shift+click and context menu
// NOTE: actual wiring is done inside map canvas init (onTokenClick / onTokenRightClick)

// ══════════════════════════════════════════════════════════════
// MAP BUILDER
// ══════════════════════════════════════════════════════════════
let builderCanvas = null;
let builderFloors = [];
let currentFloorId = null;

class BuilderCanvas {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.tileSize = 50; // match MapCanvas gridSize so tiles align
    this.tiles = {}; // "c,r" -> type (square) or "q,r" -> type (hex)
    this.offsetX = 0; this.offsetY = 0; this.scale = 1;
    this.brush = 'floor'; this.isPainting = false; this.isDragging = false;
    this.dragStart = {x:0,y:0};
    this.gridType = 'square'; // 'square' | 'hex'
    this.mapCols = 40;
    this.mapRows = 30;
    this._bindEvents(); this._resize();
  }
  setBounds(cols, rows) {
    this.mapCols = Math.max(1, parseInt(cols) || 40);
    this.mapRows = Math.max(1, parseInt(rows) || 30);
    this.render();
  }
  _inBounds(key) {
    if (this.gridType === 'hex') {
      // Treat the play area as the same pixel rectangle as square bounds
      // so hex walls paint inside a finite area. A hex is "in-bounds" if
      // its center falls inside (0,0)–(cols*gs, rows*gs).
      const [q, r] = key.split(',').map(Number);
      const p = this._axialToPixel(q, r);
      const mw = this.mapCols * this.tileSize;
      const mh = this.mapRows * this.tileSize;
      return p.x >= 0 && p.x < mw && p.y >= 0 && p.y < mh;
    }
    const [c, r] = key.split(',').map(Number);
    return c >= 0 && r >= 0 && c < this.mapCols && r < this.mapRows;
  }
  _resize() {
    const p = this.canvas.parentElement;
    if (!p) return;
    this.canvas.width = p.clientWidth; this.canvas.height = p.clientHeight;
    this.render();
  }
  setBrush(b) { this.brush = b; }
  setTiles(t) { this.tiles = t || {}; this.render(); }
  getTiles() { return { ...this.tiles }; }
  clear() { this.tiles = {}; this.render(); }
  setGridType(t) { this.gridType = (t === 'hex') ? 'hex' : 'square'; this.render(); }

  // ── Hex helpers (pointy-top axial) ───────────────────────────
  _hexSize() { return this.tileSize / Math.sqrt(3); }
  _axialToPixel(q, r) {
    const gs = this.tileSize;
    return { x: gs * (q + r / 2), y: gs * (Math.sqrt(3) / 2 * r) };
  }
  _pixelToAxial(px, py) {
    const s = this._hexSize();
    const q = (Math.sqrt(3) / 3 * px - py / 3) / s;
    const r = (2 / 3 * py) / s;
    return { q, r };
  }
  _hexRound(q, r) {
    const s = -q - r;
    let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
    const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    return { q: rq, r: rr };
  }
  _hexPath(ctx, cx, cy, size) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 3;
      const x = cx + size * Math.cos(a);
      const y = cy + size * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  _screenToTile(sx, sy) {
    const mx = (sx - this.offsetX) / this.scale;
    const my = (sy - this.offsetY) / this.scale;
    if (this.gridType === 'hex') {
      const frac = this._pixelToAxial(mx, my);
      const hex = this._hexRound(frac.q, frac.r);
      return { key: `${hex.q},${hex.r}`, q: hex.q, r: hex.r };
    }
    return { key: `${Math.floor(mx / this.tileSize)},${Math.floor(my / this.tileSize)}`, col: Math.floor(mx / this.tileSize), row: Math.floor(my / this.tileSize) };
  }
  render() {
    const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.translate(this.offsetX, this.offsetY); ctx.scale(this.scale, this.scale);
    const colors = { floor:'#333', wall:'#666', door:'#8B4513', water:'#1a4a6e', pit:'#111', stairs_up:'#b8860b', stairs_down:'#cd853f', trap:'#8b0000' };
    const icons = { door:'🚪', water:'💧', pit:'🕳', stairs_up:'⬆', stairs_down:'⬇', trap:'⚠' };

    if (this.gridType === 'hex') {
      const size = this._hexSize();
      const visibleW = w / this.scale, visibleH = h / this.scale;
      // Determine axial bounds from visible rect
      const corners = [
        this._pixelToAxial(-this.offsetX / this.scale, -this.offsetY / this.scale),
        this._pixelToAxial((-this.offsetX + w) / this.scale, -this.offsetY / this.scale),
        this._pixelToAxial(-this.offsetX / this.scale, (-this.offsetY + h) / this.scale),
        this._pixelToAxial((-this.offsetX + w) / this.scale, (-this.offsetY + h) / this.scale),
      ];
      let qMin = Infinity, qMax = -Infinity, rMin = Infinity, rMax = -Infinity;
      for (const c of corners) {
        if (c.q < qMin) qMin = c.q; if (c.q > qMax) qMax = c.q;
        if (c.r < rMin) rMin = c.r; if (c.r > rMax) rMax = c.r;
      }
      qMin = Math.floor(qMin) - 1; qMax = Math.ceil(qMax) + 1;
      rMin = Math.floor(rMin) - 1; rMax = Math.ceil(rMax) + 1;

      // Hex tiles
      for (let q = qMin; q <= qMax; q++) {
        for (let r = rMin; r <= rMax; r++) {
          const t = this.tiles[`${q},${r}`];
          if (!t) continue;
          const c = this._axialToPixel(q, r);
          ctx.fillStyle = colors[t] || '#333';
          this._hexPath(ctx, c.x, c.y, size - 1);
          ctx.fill();
          // Walls get bold outline + hatch so they read as solid barriers
          // (feature parity with the square-grid wall look).
          if (t === 'wall') {
            ctx.save();
            ctx.strokeStyle = 'rgba(0,0,0,0.6)';
            ctx.lineWidth = 2 / this.scale;
            this._hexPath(ctx, c.x, c.y, size - 1);
            ctx.stroke();
            ctx.beginPath();
            this._hexPath(ctx, c.x, c.y, size - 2);
            ctx.clip();
            ctx.strokeStyle = 'rgba(0,0,0,0.35)';
            ctx.lineWidth = 1 / this.scale;
            ctx.beginPath();
            for (let off = -size * 2; off < size * 2; off += 6) {
              ctx.moveTo(c.x + off - size,        c.y - size);
              ctx.lineTo(c.x + off + size,        c.y + size);
            }
            ctx.stroke();
            ctx.restore();
          }
          if (icons[t]) {
            ctx.font = `${this.tileSize * 0.45}px sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(icons[t], c.x, c.y);
          }
        }
      }
      // Hex grid
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1 / this.scale;
      for (let q = qMin; q <= qMax; q++) {
        for (let r = rMin; r <= rMax; r++) {
          const c = this._axialToPixel(q, r);
          this._hexPath(ctx, c.x, c.y, size);
          ctx.stroke();
        }
      }
      // Play-area boundary + outside dim (feature parity with square grid).
      {
        const bw = this.mapCols * this.tileSize;
        const bh = this.mapRows * this.tileSize;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(-10000, -10000, 20000, 10000 - 0); // above
        ctx.fillRect(-10000, bh,      20000, 10000);     // below
        ctx.fillRect(-10000, 0,       10000, bh);        // left
        ctx.fillRect(bw,     0,       10000, bh);        // right
        ctx.strokeStyle = '#ffd56a';
        ctx.setLineDash([8 / this.scale, 6 / this.scale]);
        ctx.lineWidth = 2 / this.scale;
        ctx.strokeRect(0, 0, bw, bh);
        ctx.restore();
      }
    } else {
      // Square grid
      const cols = Math.ceil(w / (this.tileSize * this.scale)) + 2;
      const rows = Math.ceil(h / (this.tileSize * this.scale)) + 2;
      const startCol = Math.floor(-this.offsetX / (this.tileSize * this.scale));
      const startRow = Math.floor(-this.offsetY / (this.tileSize * this.scale));
      for (let c = startCol; c < startCol + cols; c++) {
        for (let r = startRow; r < startRow + rows; r++) {
          const t = this.tiles[`${c},${r}`];
          if (!t) continue;
          const x = c * this.tileSize, y = r * this.tileSize;
          ctx.fillStyle = colors[t] || '#333';
          ctx.fillRect(x + 0.5, y + 0.5, this.tileSize - 1, this.tileSize - 1);
        }
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1 / this.scale;
      for (let c = startCol; c <= startCol + cols; c++) {
        ctx.beginPath(); ctx.moveTo(c * this.tileSize, startRow * this.tileSize);
        ctx.lineTo(c * this.tileSize, (startRow + rows) * this.tileSize); ctx.stroke();
      }
      for (let r = startRow; r <= startRow + rows; r++) {
        ctx.beginPath(); ctx.moveTo(startCol * this.tileSize, r * this.tileSize);
        ctx.lineTo((startCol + cols) * this.tileSize, r * this.tileSize); ctx.stroke();
      }
      for (let c = startCol; c < startCol + cols; c++) {
        for (let r = startRow; r < startRow + rows; r++) {
          const t = this.tiles[`${c},${r}`];
          if (!t || !icons[t]) continue;
          ctx.font = `${this.tileSize * 0.55}px sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(icons[t], (c + 0.5) * this.tileSize, (r + 0.5) * this.tileSize);
        }
      }
      // Boundary rectangle (play area)
      const bw = this.mapCols * this.tileSize;
      const bh = this.mapRows * this.tileSize;
      ctx.save();
      // Dim area outside bounds
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(-10000, -10000, 20000, 10000 - 0);            // above
      ctx.fillRect(-10000, bh,      20000, 10000);                // below
      ctx.fillRect(-10000, 0,       10000, bh);                   // left
      ctx.fillRect(bw,     0,       10000, bh);                   // right
      // Boundary stroke
      ctx.strokeStyle = '#ffd56a';
      ctx.setLineDash([8 / this.scale, 6 / this.scale]);
      ctx.lineWidth = 2 / this.scale;
      ctx.strokeRect(0, 0, bw, bh);
      ctx.restore();
    }
    ctx.restore();
  }
  _paintAt(sx, sy) {
    const tile = this._screenToTile(sx, sy);
    if (!this._inBounds(tile.key)) return;
    if (this.brush === 'erase') delete this.tiles[tile.key];
    else this.tiles[tile.key] = this.brush;
    this.render();
  }
  _bindEvents() {
    const c = this.canvas;
    c.addEventListener('mousedown', e => {
      if (e.button === 0) { this.isPainting = true; this._paintAt(e.offsetX, e.offsetY); }
      else { this.isDragging = true; this.dragStart = { x: e.offsetX - this.offsetX, y: e.offsetY - this.offsetY }; }
    });
    c.addEventListener('mousemove', e => {
      if (this.isPainting) this._paintAt(e.offsetX, e.offsetY);
      if (this.isDragging) { this.offsetX = e.offsetX - this.dragStart.x; this.offsetY = e.offsetY - this.dragStart.y; this.render(); }
    });
    c.addEventListener('mouseup', () => { this.isPainting = false; this.isDragging = false; });
    c.addEventListener('mouseleave', () => { this.isPainting = false; this.isDragging = false; });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const zoom = e.deltaY < 0 ? 1.1 : 0.9;
      const newScale = Math.max(0.2, Math.min(5, this.scale * zoom));
      this.offsetX = e.offsetX - (e.offsetX - this.offsetX) * (newScale / this.scale);
      this.offsetY = e.offsetY - (e.offsetY - this.offsetY) * (newScale / this.scale);
      this.scale = newScale; this.render();
    }, { passive: false });
    window.addEventListener('resize', () => this._resize());
  }
}

async function loadBuilder() {
  try { builderFloors = await api.get(`/api/map-builder/${SESSION_CODE}/floors`); } catch { builderFloors = []; }
  renderBuilderFloorSelect();
  if (builderFloors.length && !currentFloorId) currentFloorId = builderFloors[0].id;
  if (currentFloorId) await loadBuilderFloor(currentFloorId);
}

function renderBuilderFloorSelect() {
  const sel = document.getElementById('builder-floor-select');
  if (!sel) return;
  sel.innerHTML = builderFloors.map(f => `<option value="${f.id}" ${f.id === currentFloorId ? 'selected' : ''}>${f.name}</option>`).join('');
}

async function loadBuilderFloor(floorId) {
  const f = builderFloors.find(x => x.id === floorId);
  if (!f) return;
  currentFloorId = floorId;
  if (!builderCanvas) {
    const el = document.getElementById('builder-canvas');
    if (el) builderCanvas = new BuilderCanvas(el);
  }
  if (builderCanvas) {
    try { builderCanvas.setTiles(JSON.parse(f.tiles_json || '{}')); } catch { builderCanvas.setTiles({}); }
    builderCanvas.setGridType(f.grid_type || 'square');
    builderCanvas.tileSize = f.tile_size || 50;
    builderCanvas.setBounds(f.map_cols || 40, f.map_rows || 30);
    builderCanvas.render();
    builderCanvas._resize();
  }
  // Update toggle button text
  const gtBtn = document.getElementById('btn-builder-grid-type');
  if (gtBtn) gtBtn.textContent = (f.grid_type === 'hex') ? '⬡ Hex' : '▢ Square';
  // Update size slider to match saved tile_size
  const szInp = document.getElementById('builder-tile-size');
  const szLbl = document.getElementById('builder-tile-size-val');
  if (szInp) szInp.value = f.tile_size || 50;
  if (szLbl) szLbl.textContent = f.tile_size || 50;
  const colsInp = document.getElementById('builder-map-cols');
  const rowsInp = document.getElementById('builder-map-rows');
  if (colsInp) colsInp.value = f.map_cols || 40;
  if (rowsInp) rowsInp.value = f.map_rows || 30;
  renderBuilderFloorSelect();
}

async function createBuilderFloor(promptUser = true) {
  const name = promptUser
    ? prompt('Floor name:', 'Floor ' + (builderFloors.length + 1))
    : 'Floor ' + (builderFloors.length + 1);
  if (!name) return null;
  try {
    const f = await api.post(`/api/map-builder/${SESSION_CODE}/floors`, { name, sort_order: builderFloors.length });
    builderFloors.push(f); currentFloorId = f.id;
    renderBuilderFloorSelect(); await loadBuilderFloor(f.id);
    return f;
  } catch (e) {
    showToast('Create floor failed: ' + (e.message || 'unknown'));
    console.error('createBuilderFloor', e);
    return null;
  }
}

async function deleteBuilderFloor() {
  if (!currentFloorId) return;
  if (!confirm('Delete this floor?')) return;
  await api.del(`/api/map-builder/floors/${currentFloorId}`);
  builderFloors = builderFloors.filter(f => f.id !== currentFloorId);
  currentFloorId = builderFloors.length ? builderFloors[0].id : null;
  renderBuilderFloorSelect();
  if (currentFloorId) loadBuilderFloor(currentFloorId); else if (builderCanvas) builderCanvas.clear();
}

async function activateBuilderFloor() {
  // Auto-create a floor if user never made one
  if (!currentFloorId) {
    showToast('No floor — creating one...');
    const f = await createBuilderFloor(false);
    if (!f) return;
  }
  try {
    // Persist tiles + settings first
    if (builderCanvas) {
      await api.patch(`/api/map-builder/floors/${currentFloorId}/tiles`, { tiles: builderCanvas.getTiles() });
      await api.patch(`/api/map-builder/floors/${currentFloorId}`, {
        grid_type: builderCanvas.gridType,
        tile_size: builderCanvas.tileSize,
        map_cols: builderCanvas.mapCols,
        map_rows: builderCanvas.mapRows,
      }).catch(() => {});
      const ff = builderFloors.find(x => x.id === currentFloorId);
      if (ff) {
        ff.tiles_json = JSON.stringify(builderCanvas.getTiles());
        ff.tile_size = builderCanvas.tileSize;
        ff.grid_type = builderCanvas.gridType;
        ff.map_cols = builderCanvas.mapCols;
        ff.map_rows = builderCanvas.mapRows;
      }
    }
    await api.post(`/api/map-builder/floors/${currentFloorId}/activate`);
    builderFloors.forEach(f => f.is_active = (f.id === currentFloorId));
    renderBuilderFloorSelect();
    showToast('✅ Floor activated on Map');
    // Refresh the GM's Map tab immediately and auto-fit
    if (typeof loadMapState === 'function') {
      await loadMapState();
      if (mapCanvas) mapCanvas._fitToView();
    }
  } catch (e) {
    showToast('Activate failed: ' + (e.message || 'unknown error'));
    console.error('activateBuilderFloor', e);
  }
}

// Compute tile bounding box in map-pixel space and center MapCanvas on it.
function _fitMapToTiles(canvas) {
  if (!canvas || !canvas.tiles) return;
  const keys = Object.keys(canvas.tiles);
  if (!keys.length) return;
  const gs = canvas.gridSize || 50;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  if (canvas.tileGridType === 'hex') {
    for (const k of keys) {
      const [q, r] = k.split(',').map(Number);
      const x = gs * (q + r / 2), y = gs * (Math.sqrt(3) / 2 * r);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  } else {
    for (const k of keys) {
      const [c, r] = k.split(',').map(Number);
      const x = c * gs, y = r * gs;
      if (x < minX) minX = x; if (x > maxX) maxX = x + gs;
      if (y < minY) minY = y; if (y > maxY) maxY = y + gs;
    }
  }
  const pad = gs * 2;
  const bw = (maxX - minX) + pad * 2;
  const bh = (maxY - minY) + pad * 2;
  const sx = canvas.canvas.width / bw;
  const sy = canvas.canvas.height / bh;
  canvas.scale = Math.min(sx, sy);
  canvas.offsetX = -(minX - pad) * canvas.scale + (canvas.canvas.width - bw * canvas.scale) / 2;
  canvas.offsetY = -(minY - pad) * canvas.scale + (canvas.canvas.height - bh * canvas.scale) / 2;
  canvas.render();
}

async function saveBuilderTiles() {
  if (!builderCanvas) { showToast('Builder not ready'); return; }
  // Auto-create a floor if user never made one
  if (!currentFloorId) {
    showToast('No floor — creating one...');
    const f = await createBuilderFloor(false);
    if (!f) return;
  }
  try {
    // Persist metadata (bounds + tile_size + grid_type) FIRST so that
    // the subsequent `map.tiles_updated` broadcast sees a fresh local
    // cache — otherwise the WS handler can "reset" the bounds we just
    // typed in with the stale floor record.
    await api.patch(`/api/map-builder/floors/${currentFloorId}`, {
      grid_type: builderCanvas.gridType,
      tile_size: builderCanvas.tileSize,
      map_cols: builderCanvas.mapCols,
      map_rows: builderCanvas.mapRows,
    });
    // Update local cache immediately (don't wait for WS echo).
    const f = builderFloors.find(x => x.id === currentFloorId);
    if (f) {
      f.grid_type = builderCanvas.gridType;
      f.tile_size = builderCanvas.tileSize;
      f.map_cols  = builderCanvas.mapCols;
      f.map_rows  = builderCanvas.mapRows;
    }
    await api.patch(`/api/map-builder/floors/${currentFloorId}/tiles`, { tiles: builderCanvas.getTiles() });
    if (f) f.tiles_json = JSON.stringify(builderCanvas.getTiles());
    showToast('💾 Saved. Click ▶ Activate to show on Map');
  } catch (e) {
    showToast('Save failed: ' + (e.message || 'unknown error'));
    console.error('saveBuilderTiles', e);
  }
}

function openBuilderTrapModal(col, row) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:360px">
      <h3>⚠️ Place Trap</h3>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
        <input id="bt-name" placeholder="Trap name" value="Spike Trap" style="background:var(--bg-surface-2);color:var(--text);border:1px solid var(--border);padding:6px 8px;border-radius:var(--r-sm)">
        <textarea id="bt-desc" placeholder="Description" rows="2" style="background:var(--bg-surface-2);color:var(--text);border:1px solid var(--border);padding:6px 8px;border-radius:var(--r-sm)"></textarea>
        <div style="display:flex;gap:6px">
          <select id="bt-type" style="flex:1;background:var(--bg-surface-2);color:var(--text);border:1px solid var(--border);padding:6px;border-radius:var(--r-sm)">
            <option value="mechanical">Mechanical</option><option value="magical">Magical</option><option value="natural">Natural</option>
          </select>
          <select id="bt-trigger" style="flex:1;background:var(--bg-surface-2);color:var(--text);border:1px solid var(--border);padding:6px;border-radius:var(--r-sm)">
            <option value="pressure">Pressure</option><option value="proximity">Proximity</option><option value="tripwire">Tripwire</option><option value="spell">Spell</option>
          </select>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <label style="font-size:0.72rem;color:var(--text-muted)">Detect DC:</label>
          <input id="bt-dc-detect" type="number" value="10" style="width:60px;background:var(--bg-surface-2);color:var(--text);border:1px solid var(--border);padding:4px;border-radius:var(--r-sm)">
          <label style="font-size:0.72rem;color:var(--text-muted)">Disarm DC:</label>
          <input id="bt-dc-disarm" type="number" value="10" style="width:60px;background:var(--bg-surface-2);color:var(--text);border:1px solid var(--border);padding:4px;border-radius:var(--r-sm)">
        </div>
        <input id="bt-damage" placeholder="Damage dice (e.g. 2d6+3)" value="1d8" style="background:var(--bg-surface-2);color:var(--text);border:1px solid var(--border);padding:6px 8px;border-radius:var(--r-sm)">
        <div style="display:flex;gap:8px;margin-top:4px">
          <button class="btn btn-ghost btn-sm" id="bt-cancel">Cancel</button>
          <button class="btn btn-primary btn-sm" id="bt-save">Save Trap</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#bt-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#bt-save').addEventListener('click', async () => {
    const payload = {
      floor_id: currentFloorId, col, row,
      name: overlay.querySelector('#bt-name').value || 'Trap',
      description: overlay.querySelector('#bt-desc').value,
      trap_type: overlay.querySelector('#bt-type').value,
      trigger_type: overlay.querySelector('#bt-trigger').value,
      dc_detect: parseInt(overlay.querySelector('#bt-dc-detect').value) || 10,
      dc_disarm: parseInt(overlay.querySelector('#bt-dc-disarm').value) || 10,
      damage_dice: overlay.querySelector('#bt-damage').value,
      is_hidden: true,
    };
    try {
      await api.post(`/api/map-builder/${SESSION_CODE}/traps`, payload);
      showToast('Trap placed');
      overlay.remove();
    } catch (e) { showToast('Failed to place trap'); }
  });
}

// Builder wiring
document.addEventListener('DOMContentLoaded', () => {
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
  const trapBtn = document.getElementById('btn-place-trap');
  if (trapBtn) trapBtn.addEventListener('click', () => {
    if (!builderCanvas) return;
    const c = builderCanvas.canvas;
    const handler = async (e) => {
      const tile = builderCanvas._screenToTile(e.offsetX, e.offsetY);
      openBuilderTrapModal(tile.col, tile.row);
      c.removeEventListener('click', handler);
    };
    c.addEventListener('click', handler);
    showToast('Click a tile to place the trap');
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
  // Tab switch hook
  $$('.gm-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.dataset.tab === 'builder') {
        if (!builderCanvas) {
          const el = document.getElementById('builder-canvas');
          if (el) { builderCanvas = new BuilderCanvas(el); loadBuilder(); }
        } else { builderCanvas._resize(); }
      }
    });
  });
});

// Builder WS handlers
ws.on('map.floor_added', d => { if (!builderFloors.find(f => f.id === d.id)) { builderFloors.push(d); renderBuilderFloorSelect(); } });
ws.on('map.floor_updated', d => { const i = builderFloors.findIndex(f => f.id === d.id); if (i >= 0) builderFloors[i] = d; renderBuilderFloorSelect(); });
ws.on('map.floor_deleted', d => { builderFloors = builderFloors.filter(f => f.id !== d.floor_id); if (currentFloorId === d.floor_id) { currentFloorId = builderFloors[0]?.id || null; if (currentFloorId) loadBuilderFloor(currentFloorId); } renderBuilderFloorSelect(); });
ws.on('map.floor_activated', d => {
  builderFloors.forEach(f => f.is_active = (f.id === d.floor_id));
  renderBuilderFloorSelect();
  showToast(`Floor activated: ${d.name || ''}`);
  // Refresh GM Map tab and players so the new floor tiles appear
  if (typeof loadMapState === 'function') loadMapState();
});
ws.on('map.tiles_updated', d => {
  // Only refresh tiles, DON'T reload the whole floor — a reload would
  // pull stale `map_cols` / `map_rows` / `tile_size` from the local
  // `builderFloors` cache (which hasn't seen the newer floor PATCH
  // response yet) and visually "reset" the bounds the user just set.
  if (!d || currentFloorId !== d.floor_id || !builderCanvas) return;
  const f = builderFloors.find(x => x.id === d.floor_id);
  if (!f) return;
  try { builderCanvas.setTiles(JSON.parse(f.tiles_json || '{}')); } catch {}
});
ws.on('map.trap_added', d => { addLog('gm.map', `Trap added: ${d.name}`); });

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════
refreshChars();
loadInitiativeOrder();
loadAIHistory();
loadCategories().then(() => loadItems());
loadCombatPanel();
loadRacesClasses();
loadNpcLibrary();
loadQuests();
loadAnnouncements();
loadSessionTimer();
loadGmAbilities();
loadWizardPending();
loadBuilder();
loadMapState();
ws.connect();
