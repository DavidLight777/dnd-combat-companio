// ════════════════════════════════════════════════════════
// Core: helpers, tabs, party list, refreshChars
// Source: gm-app.js lines 1–395
// Globals shared via window.* and module-scope hoisting.
// ════════════════════════════════════════════════════════

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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── Toast ────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
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
    if (tab.dataset.tab === 'map' || tab.dataset.tab === 'builder' || tab.dataset.tab === 'builder-v2') {
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
        ${c.spiritual_max_hp > 0 ? `
        <div class="cc-line" style="margin-top:4px">
          <span class="hp-text" style="font-size:0.7rem;color:#a855f7">👻 ${c.spiritual_hp}/${c.spiritual_max_hp}</span>
        </div>` : ''}
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
          ${c.spiritual_max_hp > 0 ? `
          <div class="cc-line" style="margin-top:4px">
            <span class="hp-text" style="font-size:0.7rem;color:#a855f7">👻 ${c.spiritual_hp}/${c.spiritual_max_hp}</span>
          </div>` : ''}
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
