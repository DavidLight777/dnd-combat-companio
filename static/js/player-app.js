/* ══════════════════════════════════════════════════════════════
   PLAYER APP — Full Character Sheet
   ══════════════════════════════════════════════════════════════ */
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// ── Auth ─────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const SESSION_CODE = params.get('code') || sessionStorage.getItem('session_code');
const PLAYER_TOKEN = sessionStorage.getItem('player_token');
const CHAR_ID = parseInt(sessionStorage.getItem('character_id'));
if (!SESSION_CODE || !PLAYER_TOKEN || !CHAR_ID) location.href = '/';
$('#session-code').textContent = SESSION_CODE;

// ── State ────────────────────────────────────────────────────
let char = null;          // Current character data
let charData = null;      // Alias for shop access
let calcLog = [];         // Calc log entries
let rollHistory = [];     // Roll history entries
let _atkD20Result = null; // Last d20 roll
// Rework v3: per-panel state carries BOTH the mode and the dice count.
// { attack: { mode: 'normal', diceCount: 1 }, ... }
let _advantageModes = {};
const ADV_DICE_CAP = 5;

function _getAdvState(panelKey) {
  if (!_advantageModes[panelKey] || typeof _advantageModes[panelKey] !== 'object') {
    _advantageModes[panelKey] = { mode: 'normal', diceCount: 1 };
  }
  return _advantageModes[panelKey];
}

// ── Advantage Toggle helper ──────────────────────────────────
function makeAdvToggle(panelKey, opts = {}) {
  const st = _getAdvState(panelKey);
  const showStepper = opts.showStepper !== false;  // default: show N-d20 stepper
  const stepperHtml = showStepper ? `
    <div class="adv-stepper" data-adv-panel="${panelKey}" style="display:inline-flex;align-items:center;gap:4px;margin-left:6px">
      <span style="font-size:0.7rem;color:var(--text-muted)">🎲 ×</span>
      <button type="button" class="btn btn-ghost btn-xs" data-adv-step="-1" style="padding:0 6px">−</button>
      <span data-adv-count style="font-weight:600;min-width:10px;text-align:center">${st.diceCount}</span>
      <button type="button" class="btn btn-ghost btn-xs" data-adv-step="+1" style="padding:0 6px">+</button>
    </div>` : '';
  return `<div style="display:inline-flex;align-items:center"><div class="adv-toggle" data-adv-panel="${panelKey}">
    <button data-mode="normal" class="${st.mode==='normal'?'active':''}">Normal</button>
    <button data-mode="advantage" class="${st.mode==='advantage'?'active':''}">ADV</button>
    <button data-mode="disadvantage" class="${st.mode==='disadvantage'?'active':''}">DISADV</button>
  </div>${stepperHtml}</div>`;
}
function bindAdvToggle(container, panelKey) {
  const st = _getAdvState(panelKey);
  const btns = container.querySelectorAll(`.adv-toggle[data-adv-panel="${panelKey}"] button`);
  btns.forEach(b => b.addEventListener('click', () => {
    st.mode = b.dataset.mode;
    // adv/disadv need at least 2 dice to be meaningful
    if (st.mode !== 'normal' && st.diceCount < 2) st.diceCount = 2;
    btns.forEach(x => x.classList.toggle('active', x === b));
    _refreshAdvStepper(container, panelKey);
  }));
  const stepBtns = container.querySelectorAll(`.adv-stepper[data-adv-panel="${panelKey}"] [data-adv-step]`);
  stepBtns.forEach(b => b.addEventListener('click', () => {
    const delta = parseInt(b.dataset.advStep) || 0;
    const min = st.mode === 'normal' ? 1 : 2;
    st.diceCount = Math.max(min, Math.min(ADV_DICE_CAP, st.diceCount + delta));
    _refreshAdvStepper(container, panelKey);
  }));
}
function _refreshAdvStepper(container, panelKey) {
  const st = _getAdvState(panelKey);
  const lbl = container.querySelector(`.adv-stepper[data-adv-panel="${panelKey}"] [data-adv-count]`);
  if (lbl) lbl.textContent = st.diceCount;
}
function getAdvMode(panelKey) { return _getAdvState(panelKey).mode; }
function getAdvDiceCount(panelKey) { return _getAdvState(panelKey).diceCount; }

// ── API helper ───────────────────────────────────────────────
const api = {
  async get(url) { const r = await fetch(url); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async post(url, body) { const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async put(url, body) { const r = await fetch(url, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async patch(url, body) { const r = await fetch(url, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async del(url) { const r = await fetch(url, { method:'DELETE' }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
};

// ── Debounced save ───────────────────────────────────────────
let _saveTimer = null;
function debouncedSave(fields) {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    try { await api.put(`/api/characters/${CHAR_ID}`, fields); } catch(e) { console.warn('Save failed:', e); }
  }, 300);
}

// ── Utility ──────────────────────────────────────────────────
function addLog(text) {
  calcLog.unshift({ time: new Date().toLocaleTimeString(), text });
  if (calcLog.length > 20) calcLog.length = 20;
  renderLog();
}
function addRollHistory(type, desc, result) {
  rollHistory.unshift({ time: new Date().toLocaleTimeString(), type, desc, result });
  if (rollHistory.length > 50) rollHistory.length = 50;
  renderLog();
}
function flash(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 300);
}
function showToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--bg-surface-2);color:var(--text-primary);padding:8px 16px;border-radius:var(--r-md);border:1px solid var(--border);font-size:0.82rem;z-index:10000;opacity:0;transition:opacity 0.3s';
  document.body.appendChild(t);
  requestAnimationFrame(() => t.style.opacity = '1');
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 2500);
}
function confirmAction(msg) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'confirm-overlay';
    ov.innerHTML = `<div class="confirm-box"><p>${msg}</p><div class="btns"><button class="btn btn-primary btn-sm" id="cf-yes">Confirm</button><button class="btn btn-ghost btn-sm" id="cf-no">Cancel</button></div></div>`;
    document.body.appendChild(ov);
    ov.querySelector('#cf-yes').onclick = () => { ov.remove(); resolve(true); };
    ov.querySelector('#cf-no').onclick = () => { ov.remove(); resolve(false); };
  });
}

// ══════════════════════════════════════════════════════════════
// LOAD CHARACTER
// ══════════════════════════════════════════════════════════════
async function loadChar() {
  char = await api.get(`/api/characters/${CHAR_ID}`);
  charData = char;
  $('#char-name').textContent = char.name;
  document.title = `${char.name} — Combat Companion`;
  renderAll();
  renderCharSidebar();  // FIX 2

  // Load race + profession badges (Rework Phase 4: multi-profession list)
  const badges = [];
  if (char.race_id) {
    try { const r = await api.get(`/api/races-classes/races/${char.race_id}`); badges.push(r.name); } catch {}
  }
  // Prefer the new professions array; fall back to legacy class_id
  const profs = Array.isArray(char.professions) ? char.professions : [];
  if (profs.length) {
    badges.push(profs.map(p => `${p.name || 'Profession'} L${p.level}`).join(' / '));
  }
  // Rework v2: Character.class_id is gone; professions are the sole source of truth.
  const rankLabel = (char.rank && char.rank !== 'common') ? ` · ${char.rank.charAt(0).toUpperCase()+char.rank.slice(1)}` : '';
  badges.push(`Lvl ${char.level ?? 0}${rankLabel}`);
  const el = $('#char-rc-badges');
  if (el) el.textContent = badges.join(' · ');
  // Update sidebar identity line with same info
  const rcEl = $('#cs-rc');
  if (rcEl) rcEl.textContent = badges.join(' · ');
  // Render the dedicated Professions tab/panel
  renderProfessionsPanel(profs);
  // Rework Phase 7: check if the starting-item wizard is still open for this character
  maybeShowStartingItemWizard();
}

// ══════════════════════════════════════════════════════════════
// Rework Phase 7 — Starting Item Wizard (step 4-5)
// ══════════════════════════════════════════════════════════════
async function maybeShowStartingItemWizard() {
  if (!CHAR_ID) return;
  try {
    const ws = await api.get(`/api/wizard/${CHAR_ID}`);
    if (ws.is_completed) return;
    if (document.getElementById('wiz-starting-item')) return;  // already shown
    openStartingItemWizard(ws);
  } catch (e) { /* ignore — wizard is optional */ }
}

function openStartingItemWizard(ws) {
  const overlay = document.createElement('div');
  overlay.id = 'wiz-starting-item';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:480px">
      <h2 style="margin-top:0">🎲 Starting Item</h2>
      <p style="font-size:0.85rem;color:var(--text-muted)">
        Every adventurer begins with a single piece of gear. Roll the dice to determine its quality,
        then describe the item. Your GM will approve it before it goes into your bag.
      </p>
      <div id="wiz-body"></div>
    </div>`;
  document.body.appendChild(overlay);
  renderWizardBody(overlay, ws);
}

function renderWizardBody(overlay, ws) {
  const body = overlay.querySelector('#wiz-body');
  const data = ws.data || {};
  // Branch: rolled? approved? rejected?
  if (ws.is_completed) { overlay.remove(); loadInventory(); return; }

  if (!data.starting_roll) {
    body.innerHTML = `
      <div style="text-align:center;padding:18px 0">
        <button class="btn btn-primary btn-lg" id="wiz-roll">🎲 Roll d20</button>
      </div>`;
    body.querySelector('#wiz-roll').addEventListener('click', async () => {
      try {
        const res = await api.post(`/api/wizard/${CHAR_ID}/starting-roll`, {});
        addLog('wizard', `🎲 Rolled ${res.d20} → ${res.rarity.toUpperCase()}`);
        renderWizardBody(overlay, res.state);
      } catch (e) { showToast('Roll failed'); }
    });
    return;
  }

  const r = data.starting_roll;
  const rarity = r.rarity;
  const description = rarityDescription(r.d20);
  if (data.gm_approved) { overlay.remove(); loadInventory(); return; }

  if (data.proposed_item && !data.gm_rejected) {
    // Waiting for GM
    body.innerHTML = `
      <div style="padding:10px;background:var(--bg-surface-2);border-radius:var(--r-md);margin-bottom:10px">
        <div style="font-size:0.8rem;color:var(--text-muted)">Your roll</div>
        <div style="font-size:1.1rem"><strong>d20 = ${r.d20}</strong> · ${description}</div>
      </div>
      <div style="padding:10px;border:1px dashed var(--border);border-radius:var(--r-md);margin-bottom:10px">
        <div style="font-size:0.75rem;color:var(--text-muted)">Proposed item (<strong class="rarity-${rarity}">${rarity}</strong>)</div>
        <div style="font-weight:700;font-size:1rem">${escapeHtml(data.proposed_item.name)}</div>
        <div style="font-size:0.78rem;color:var(--text-muted)">${escapeHtml(data.proposed_item.description || '')}</div>
      </div>
      <div style="text-align:center;font-size:0.85rem;color:var(--accent-green)">⏳ Waiting for GM to approve…</div>`;
    // Poll — simple re-fetch every 3s
    const t = setInterval(async () => {
      try {
        const ws2 = await api.get(`/api/wizard/${CHAR_ID}`);
        if (ws2.is_completed) { clearInterval(t); overlay.remove(); loadInventory(); return; }
        if (ws2.data?.gm_rejected) { clearInterval(t); renderWizardBody(overlay, ws2); return; }
      } catch {}
    }, 3000);
    return;
  }

  // Propose item form (first time or after rejection)
  const rejectedNote = data.gm_rejected ? data.gm_reject_note || 'The GM asked you to propose a different item.' : '';
  body.innerHTML = `
    <div style="padding:10px;background:var(--bg-surface-2);border-radius:var(--r-md);margin-bottom:10px">
      <div style="font-size:0.8rem;color:var(--text-muted)">Your roll</div>
      <div style="font-size:1.1rem"><strong>d20 = ${r.d20}</strong> · ${description}</div>
      <div style="margin-top:4px">Rarity: <strong class="rarity-${rarity}" style="text-transform:capitalize">${rarity}</strong></div>
    </div>
    ${rejectedNote ? `<div style="padding:8px;border:1px solid var(--accent-red);border-radius:var(--r-sm);margin-bottom:10px;font-size:0.82rem;color:var(--accent-red)">GM: ${escapeHtml(rejectedNote)}</div>` : ''}
    <label style="font-size:0.78rem">Item Name</label>
    <input type="text" id="wiz-item-name" placeholder="e.g. Bronze Dagger" style="width:100%;margin-bottom:8px">
    <label style="font-size:0.78rem">Description</label>
    <textarea id="wiz-item-desc" rows="3" placeholder="A short description…" style="width:100%;margin-bottom:8px"></textarea>
    <label style="font-size:0.78rem">Category</label>
    <select id="wiz-item-cat" style="width:100%;margin-bottom:12px">
      <option value="weapon">Weapon</option>
      <option value="armor">Armor</option>
      <option value="potion">Potion</option>
      <option value="misc" selected>Miscellaneous</option>
    </select>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-primary btn-sm" id="wiz-submit">Send to GM</button>
    </div>`;
  body.querySelector('#wiz-submit').addEventListener('click', async () => {
    const name = body.querySelector('#wiz-item-name').value.trim();
    if (!name) { showToast('Give your item a name'); return; }
    const description = body.querySelector('#wiz-item-desc').value.trim();
    const category = body.querySelector('#wiz-item-cat').value;
    try {
      const res = await api.post(`/api/wizard/${CHAR_ID}/propose-item`, { name, description, category });
      addLog('wizard', `📝 Proposed starting item: ${name}`);
      renderWizardBody(overlay, res);
    } catch (e) { showToast('Failed to send proposal'); }
  });
}

function rarityDescription(d20) {
  if (d20 <= 1)  return 'Cursed start — broken or tainted.';
  if (d20 <= 9)  return 'Common quality.';
  if (d20 <= 14) return 'Uncommon find.';
  if (d20 <= 19) return 'Rare treasure!';
  return '✨ LEGENDARY ROLL — Epic item!';
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Rework Phase 4: render player's professions list.
function renderProfessionsPanel(professions) {
  const panel = document.getElementById('professions-list');
  if (!panel) return;
  if (!professions || !professions.length) {
    panel.innerHTML = '<span class="text-muted" style="font-size:0.82rem">No professions yet — ask your GM to assign one.</span>';
    return;
  }
  panel.innerHTML = professions.map(p => {
    const bonuses = Array.isArray(p.bonuses) ? p.bonuses : [];
    const bonusChips = bonuses.map(b => {
      if (b.type === 'stat_bonus') return `<span class="chip-muted">${(b.stat||'').slice(0,3).toUpperCase()}+${b.value}</span>`;
      return `<span class="chip-muted">${(b.type||'').replace(/_/g,' ')}+${b.value||0}</span>`;
    }).join('');
    const abilities = Array.isArray(p.special_abilities) ? p.special_abilities : [];
    return `<div class="profession-card">
      <div class="prof-head">
        <span class="prof-name">${p.name || 'Profession'}</span>
        <span class="prof-level">L ${p.level}/5</span>
        ${p.is_active ? '' : '<span class="chip-muted">inactive</span>'}
      </div>
      ${p.description ? `<div class="prof-desc">${p.description}</div>` : ''}
      ${bonusChips ? `<div class="prof-bonuses">${bonusChips}</div>` : ''}
      ${abilities.length ? `<ul class="prof-abilities">${abilities.map(a => `<li>${a}</li>`).join('')}</ul>` : ''}
    </div>`;
  }).join('');
}

// FIX 2: Populate left character sidebar from `char` state
function renderCharSidebar() {
  const c = char; if (!c) return;
  const nameEl = $('#cs-name'); if (nameEl) nameEl.textContent = c.name || 'Character';
  const initEl = $('#cs-avatar-initial'); if (initEl) initEl.textContent = (c.name || '?').trim().charAt(0).toUpperCase();
  const avatar = $('#cs-avatar'); if (avatar && c.token_color) avatar.style.background = `linear-gradient(135deg, ${c.token_color} 0%, var(--bg-surface-3) 100%)`;

  // Rework v2: cosmetic age / gender line + declined-stats badge
  const bioEl = $('#cs-bio');
  if (bioEl) {
    const parts = [];
    if (c.age)    parts.push(`Age ${c.age}`);
    if (c.gender) parts.push(c.gender);
    if (c.declined_stats) parts.push('<span style="color:#dc5050;font-weight:600" title="Declined the gift of stats — rolls with advantage on the starting feature">⚔ Walked Alone</span>');
    bioEl.innerHTML = parts.join(' · ');
  }

  // HP
  const hpPct = c.max_hp > 0 ? Math.min(100, Math.max(0, c.current_hp / c.max_hp * 100)) : 0;
  const hpColor = hpPct > 50 ? 'var(--hp-high)' : hpPct > 25 ? 'var(--hp-mid)' : 'var(--hp-low)';
  const hpVal = $('#cs-hp-value'); if (hpVal) hpVal.textContent = `${c.current_hp} / ${c.max_hp}`;
  const hpFill = $('#cs-hp-fill'); if (hpFill) { hpFill.style.width = hpPct + '%'; hpFill.style.background = hpColor; }
  const kdEl = $('#cs-kd'); if (kdEl) kdEl.textContent = c.armor_class;

  // Mana
  const manaBlk = $('#cs-mana-block');
  if (manaBlk) {
    if (c.mana_max > 0) {
      manaBlk.style.display = '';
      const mp = c.mana_max > 0 ? Math.min(100, c.mana_current / c.mana_max * 100) : 0;
      $('#cs-mana-value').textContent = `${c.mana_current} / ${c.mana_max}`;
      $('#cs-mana-fill').style.width = mp + '%';
    } else {
      manaBlk.style.display = 'none';
    }
  }

  // XP (level + experience).
  const xpBlk = $('#cs-xp-block');
  if (xpBlk) {
    const level = c.level ?? 0;
    const xp = c.experience || 0;
    const xpVal = $('#cs-xp-value');
    const xpFill = $('#cs-xp-fill');
    // Rework v2 curve: threshold = 100 + 100 * level (matches backend xp_to_next)
    const nextThresh = 100 + 100 * Math.max(0, level);
    const pct = Math.min(100, (xp / nextThresh) * 100);
    if (xpVal) xpVal.textContent = `Lvl ${level} · ${xp}/${nextThresh}`;
    if (xpFill) xpFill.style.width = pct + '%';

    // Rework v2: expose the Level-up CTA exactly when ready.
    const lvlBtn = $('#btn-level-up');
    if (lvlBtn) lvlBtn.style.display = xp >= nextThresh ? '' : 'none';
  }
}

// FIX 2: Sidebar characteristic roll (wired once at init)
let _csRollAdv = 'normal';
document.addEventListener('click', (e) => {
  if (e.target && e.target.closest('#cs-roll-adv button')) {
    const btn = e.target.closest('button');
    _csRollAdv = btn.dataset.mode;
    document.querySelectorAll('#cs-roll-adv button').forEach(b => b.classList.toggle('active', b === btn));
  }
});
document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'btn-cs-roll') {
    const stat = document.getElementById('cs-roll-stat').value;
    const rollType = document.getElementById('cs-roll-type').value;
    const diceCount = parseInt(document.getElementById('cs-roll-dice-count')?.value) || 1;
    const diceType = parseInt(document.getElementById('cs-roll-dice-type')?.value) || 20;
    const resEl = document.getElementById('cs-roll-result');
    try {
      const res = await api.post(`/api/characters/${CHAR_ID}/roll-characteristic`, {
        stat, roll_type: rollType, advantage_mode: _csRollAdv,
        dice_count: diceCount, dice_type: diceType,
      });
      let advTag = '';
      if (res.advantage_mode === 'advantage') advTag = ' <span class="adv-badge advantage">ADV</span>';
      else if (res.advantage_mode === 'disadvantage') advTag = ' <span class="adv-badge disadvantage">DISADV</span>';
      resEl.innerHTML = `<span style="color:var(--accent)">${res.description}</span>${advTag}`;
      addLog(`🎲 ${res.description}`);
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({ type: 'roll.characteristic', ...res }));
      }
    } catch {
      if (resEl) resEl.textContent = 'Roll failed';
    }
  }
});
function renderAll() {
  renderHP();
  renderStats();
  renderAttack();
  renderDefense();
  renderHeal();
  renderTurns();
  renderEffects();
  renderEnemyCalc();
}

// ══════════════════════════════════════════════════════════════
// HP DISPLAY
// ══════════════════════════════════════════════════════════════
function renderHP() {
  const c = char; if (!c) return;
  const pct = c.max_hp > 0 ? (c.current_hp / c.max_hp * 100) : 0;
  const color = pct > 50 ? 'var(--hp-high)' : pct > 25 ? 'var(--hp-mid)' : 'var(--hp-low)';
  $('#hp-display').textContent = `${c.current_hp} / ${c.max_hp}`;
  $('#hp-display').style.color = color;
  $('#hp-bar').style.width = `${pct}%`;
  $('#hp-bar').style.background = color;
  $('#kd-display').textContent = c.armor_class;
  // Mana
  renderMana();
  // FIX 2: keep left sidebar in sync
  renderCharSidebar();
  renderCharStatsSidebar();  // Step 2: visible characteristics
}

function renderCharStatsSidebar() {
  const c = char; if (!c) return;
  const grid = document.getElementById('cs-stats-grid');
  if (!grid) return;
  const stats = [
    { key: 'strength', label: 'STR' },
    { key: 'dexterity', label: 'DEX' },
    { key: 'constitution', label: 'CON' },
    { key: 'intelligence', label: 'INT' },
    { key: 'wisdom', label: 'WIS' },
    { key: 'charisma', label: 'CHA' },
  ];
  grid.innerHTML = stats.map(s => {
    // Rework v2: stat value IS the bonus (0..N). 0 is a legitimate value —
    // declined characters have every stat at 0. Never fall back to 10.
    const base = (typeof c[s.key] === 'number') ? c[s.key] : 0;
    const mods = (c.stat_modifiers || []).filter(m => m.stat_name === s.key && m.is_active);
    const modSum = mods.reduce((a, m) => a + m.value, 0);
    const total = base + modSum;
    const modText = modSum !== 0 ? `<span style="font-size:0.6rem;color:${modSum > 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">${modSum > 0 ? '+' : ''}${modSum}</span>` : '';
    return `
      <div style="padding:4px;background:var(--bg-surface);border-radius:var(--r-sm)">
        <div style="font-size:0.65rem;color:var(--text-muted)">${s.label}</div>
        <div style="font-weight:700">${total} ${modText}</div>
      </div>`;
  }).join('');
}

function renderMana() {
  const c = char; if (!c) return;
  const card = $('#mana-card');
  if (!card) return;
  if (!c.mana_max || c.mana_max <= 0) { card.style.display = 'none'; return; }
  card.style.display = '';
  const pct = c.mana_max > 0 ? (c.mana_current / c.mana_max * 100) : 0;
  $('#mana-display').textContent = `${c.mana_current} / ${c.mana_max}`;
  $('#mana-bar').style.width = `${pct}%`;
  const rb = $('#mana-regen-badge');
  if (c.mana_regen_per_turn > 0) { rb.style.display = ''; rb.textContent = `+${c.mana_regen_per_turn}/turn`; }
  else rb.style.display = 'none';
}

// ══════════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════════
function renderStats() {
  const c = char; if (!c) return;
  const stats = ['strength','dexterity','constitution','intelligence','wisdom','charisma'];
  const labels = ['STR','DEX','CON','INT','WIS','CHA'];
  const grid = $('#stats-grid');

  grid.innerHTML = stats.map((s, i) => {
    const base = c[s];
    const mods = (c.stat_modifiers || []).filter(m => m.stat_name === s && m.is_active);
    const modSum = mods.reduce((a, m) => a + m.value, 0);
    const total = base + modSum;
    const modLabel = modSum !== 0 ? `<span style="font-size:0.55rem;color:${modSum > 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">(${modSum > 0 ? '+' : ''}${modSum})</span>` : '';
    const tooltipParts = mods.map(m => `${m.name || m.source || '?'}: ${m.value > 0 ? '+' : ''}${m.value}`);
    const tooltip = tooltipParts.length ? ` title="${tooltipParts.join(', ')}"` : '';
    return `<div class="stat-cell"${tooltip}>
      <div class="stat-name">${labels[i]}</div>
      <div class="stat-val">${total} ${modLabel}</div>
      <input type="number" value="${base}" data-stat="${s}" style="margin-top:4px">
    </div>`;
  }).join('') + `
    <div class="stat-cell">
      <div class="stat-name">KD</div>
      <div class="stat-val" style="color:var(--accent)">${c.armor_class}</div>
      <input type="number" value="${c.armor_class}" data-stat="armor_class" style="margin-top:4px">
    </div>
    <div class="stat-cell">
      <div class="stat-name">Max HP</div>
      <div class="stat-val">${c.max_hp}</div>
      <input type="number" value="${c.max_hp}" data-stat="max_hp" style="margin-top:4px">
    </div>`;

  grid.querySelectorAll('input[data-stat]').forEach(inp => {
    inp.addEventListener('change', () => {
      const field = inp.dataset.stat;
      const val = parseInt(inp.value) || 0;
      debouncedSave({ [field]: val });
      char[field] = val;
      renderHP();
    });
  });
}

// ══════════════════════════════════════════════════════════════
// ATTACK & DAMAGE ROLL
// ══════════════════════════════════════════════════════════════
function renderAttack() {
  const c = char; if (!c) return;
  const body = $('#attack-body');

  // Attack mods HTML
  const atkMods = (c.attack_modifiers || []).map(m => `
    <div class="mod-row ${m.is_active ? '' : 'inactive'}">
      <label class="toggle-switch"><input type="checkbox" ${m.is_active ? 'checked' : ''} data-atkmod="${m.id}"><span class="slider"></span></label>
      <input type="text" value="${m.name}" data-atkmod-field="name" data-atkmod-id="${m.id}">
      <input type="number" value="${m.value}" data-atkmod-field="value" data-atkmod-id="${m.id}">
      <button class="btn-icon danger" data-del-atkmod="${m.id}">🗑</button>
    </div>`).join('');

  // Damage mods HTML
  const dmgMods = (c.damage_modifiers || []).map(m => `
    <div class="mod-row ${m.is_active ? '' : 'inactive'}">
      <label class="toggle-switch"><input type="checkbox" ${m.is_active ? 'checked' : ''} data-dmgmod="${m.id}"><span class="slider"></span></label>
      <input type="text" value="${m.name}" data-dmgmod-field="name" data-dmgmod-id="${m.id}">
      <input type="number" value="${m.value}" data-dmgmod-field="value" data-dmgmod-id="${m.id}">
      <button class="btn-icon danger" data-del-dmgmod="${m.id}">🗑</button>
    </div>`).join('');

  // Dice groups
  const groups = getDiceGroups();
  const diceHtml = groups.map(g => `
    <div class="mod-row ${g.active ? '' : 'inactive'}" data-dg-id="${g.id}">
      <label class="toggle-switch"><input type="checkbox" ${g.active ? 'checked' : ''} data-dg-toggle="${g.id}"><span class="slider"></span></label>
      <input type="number" value="${g.count}" min="1" style="width:44px" data-dg-field="count" data-dg-id="${g.id}">
      <span class="text-muted">d</span>
      <select data-dg-field="die" data-dg-id="${g.id}" style="width:58px">
        ${[4,6,8,10,12,20,100].map(d => `<option value="${d}" ${g.die===d?'selected':''}>${d}</option>`).join('')}
      </select>
      <span class="text-muted" style="font-size:0.7rem">${g.count}d${g.die}</span>
      <button class="btn-icon danger" data-dg-del="${g.id}">🗑</button>
    </div>`).join('');

  body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <h3 style="font-size:0.82rem;margin:0">🎲 Attack Roll</h3>
      ${makeAdvToggle('attack')}
    </div>
    <div class="field-group">
      <label>D20:</label>
      <input type="number" id="atk-d20" value="${_atkD20Result||''}" min="1" max="20" style="width:52px">
      <button class="btn btn-ghost btn-xs" id="atk-d20-roll">Roll</button>
      <label>Base Mod:</label>
      <input type="number" id="atk-base-mod" value="0">
    </div>
    <div id="atk-mod-list">${atkMods}</div>
    <button class="btn btn-ghost btn-xs" id="btn-add-atk-mod" style="margin:4px 0">+ Attack Modifier</button>
    <div class="result-box" id="atk-result"><span class="text-muted">Roll d20 to calculate</span></div>

    <hr class="section-divider">

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <h3 style="font-size:0.82rem;margin:0">💥 Damage Roll</h3>
      ${makeAdvToggle('damage')}
    </div>
    <div id="dmg-dice-groups">${diceHtml}</div>
    <div style="display:flex;gap:6px;margin:6px 0">
      <button class="btn btn-ghost btn-xs" id="btn-add-dice-group">+ Add Dice</button>
      <button class="btn btn-accent btn-sm" id="dmg-roll-btn">🎲 Roll All</button>
    </div>
    <div class="field-group">
      <label>Weapon Bonus:</label>
      <input type="number" id="dmg-weapon-bonus" value="0">
      <label>Atk Bonus:</label>
      <span class="value" id="dmg-atk-bonus">0</span>
    </div>
    <div id="dmg-mod-list">${dmgMods}</div>
    <button class="btn btn-ghost btn-xs" id="btn-add-dmg-mod" style="margin:4px 0">+ Damage Modifier</button>
    <div class="result-box" id="dmg-result"><span class="text-muted">Roll damage to calculate</span></div>
  `;

  // ── Bind advantage toggles ──
  bindAdvToggle(body, 'attack');
  bindAdvToggle(body, 'damage');

  // ── Wire attack events ──
  $('#atk-d20-roll').addEventListener('click', async () => {
    const d20 = Math.floor(Math.random() * 20) + 1;
    $('#atk-d20').value = d20;
    _atkD20Result = d20;
    flash($('#atk-d20-roll'), 'dice-shake');
    calcAttack();
    addRollHistory('attack', `d20 = ${d20}`, d20);
  });
  $('#atk-d20').addEventListener('change', () => { _atkD20Result = parseInt($('#atk-d20').value)||0; calcAttack(); });
  $('#atk-base-mod').addEventListener('change', calcAttack);

  // Attack modifier events
  body.querySelectorAll('[data-atkmod]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await api.put(`/api/modifiers/${cb.dataset.atkmod}?type=attack`, { is_active: cb.checked });
      char = await api.get(`/api/characters/${CHAR_ID}`); renderAttack();
    });
  });
  body.querySelectorAll('[data-atkmod-field]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const f = inp.dataset.atkmodField;
      const v = f === 'value' ? parseInt(inp.value)||0 : inp.value;
      await api.put(`/api/modifiers/${inp.dataset.atkmodId}?type=attack`, { [f]: v });
      char = await api.get(`/api/characters/${CHAR_ID}`);
    });
  });
  body.querySelectorAll('[data-del-atkmod]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.del(`/api/modifiers/${btn.dataset.delAtkmod}?type=attack`);
      char = await api.get(`/api/characters/${CHAR_ID}`); renderAttack();
    });
  });
  $('#btn-add-atk-mod').addEventListener('click', async () => {
    await api.post(`/api/characters/${CHAR_ID}/modifiers`, { modifier_type:'attack', name:'Mod', value:0 });
    char = await api.get(`/api/characters/${CHAR_ID}`); renderAttack();
  });

  // ── Wire dice group events ──
  bindDiceGroupEvents(body);
  $('#btn-add-dice-group').addEventListener('click', () => {
    const g = getDiceGroups();
    g.push({ id: Date.now(), count:1, die:8, active:true });
    setDiceGroups(g); renderAttack();
  });

  // ── Wire damage roll ──
  $('#dmg-roll-btn').addEventListener('click', async () => {
    const groups = getDiceGroups();
    const weaponBonus = parseInt($('#dmg-weapon-bonus').value)||0;
    const atkBonus = parseInt($('#dmg-atk-bonus').textContent)||0;
    const mods = (char.damage_modifiers||[]).filter(m => m.is_active);

    const res = await api.post('/api/calc/damage-roll', {
      dice_groups: groups, weapon_bonus: weaponBonus,
      attack_bonus: atkBonus, modifier_values: mods.map(m => m.value),
      character_id: CHAR_ID, advantage_mode: getAdvMode('damage'),
    });
    flash($('#dmg-roll-btn'), 'dice-shake');

    const gd = (res.group_results||[]).map(g => `${g.count}d${g.die}[${g.rolls.join(',')}]=${g.subtotal}`).join(' + ');
    addRollHistory('damage', `${gd} = ${res.total}`, res.total);

    let text = res.breakdown || '';
    if (!text) {
      for (const g of (res.group_results||[])) text += `<span class="text-muted">${g.count}d${g.die}:</span> [${g.rolls.join(', ')}]=${g.subtotal} `;
      if (weaponBonus) text += ` + W(${weaponBonus})`;
      if (atkBonus) text += ` + A(${atkBonus})`;
      mods.forEach(m => { text += ` + ${m.name}(${m.value>0?'+':''}${m.value})`; });
    }
    text += `<br>= <strong class="damage-num">${res.total} damage</strong>`;
    $('#dmg-result').innerHTML = text;
    addLog(`[Damage] ${res.breakdown || `${gd} = ${res.total}`}`);
  });

  // Damage modifier events
  body.querySelectorAll('[data-dmgmod]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await api.put(`/api/modifiers/${cb.dataset.dmgmod}?type=damage`, { is_active: cb.checked });
      char = await api.get(`/api/characters/${CHAR_ID}`); renderAttack();
    });
  });
  body.querySelectorAll('[data-dmgmod-field]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const f = inp.dataset.dmgmodField;
      const v = f === 'value' ? parseInt(inp.value)||0 : inp.value;
      await api.put(`/api/modifiers/${inp.dataset.dmgmodId}?type=damage`, { [f]: v });
      char = await api.get(`/api/characters/${CHAR_ID}`);
    });
  });
  body.querySelectorAll('[data-del-dmgmod]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.del(`/api/modifiers/${btn.dataset.delDmgmod}?type=damage`);
      char = await api.get(`/api/characters/${CHAR_ID}`); renderAttack();
    });
  });
  $('#btn-add-dmg-mod').addEventListener('click', async () => {
    await api.post(`/api/characters/${CHAR_ID}/modifiers`, { modifier_type:'damage', name:'Mod', value:0 });
    char = await api.get(`/api/characters/${CHAR_ID}`); renderAttack();
  });
}

async function calcAttack() {
  const d20 = parseInt($('#atk-d20').value)||0;
  if (!d20) return;
  const baseMod = parseInt($('#atk-base-mod').value)||0;
  const mods = (char.attack_modifiers||[]).filter(m => m.is_active);
  const res = await api.post('/api/calc/attack-roll', {
    d20, base_mod: baseMod, modifier_values: mods.map(m => m.value),
    character_id: CHAR_ID, advantage_mode: getAdvMode('attack'),
    hit_dice_count: getAdvDiceCount('attack'),
  });
  let t = res.breakdown || `D20(${res.d20}) + Base(${res.base_mod}) = ${res.total}`;
  t += ` → Attack Bonus: <span class="value">${res.attack_bonus}</span>`;
  $('#atk-result').innerHTML = `<strong>${t}</strong>`;
  $('#dmg-atk-bonus').textContent = res.attack_bonus;
  addLog(`[Attack] ${res.breakdown || `d20(${res.d20})+base(${res.base_mod})=${res.total}`} → AtkBonus ${res.attack_bonus}`);
}

// ── Dice Groups (localStorage) ──────────────────────────────
function getDiceGroups() {
  try { const a = JSON.parse(localStorage.getItem('dnd-dice-groups')||'{}'); return a[CHAR_ID]||[{id:1,count:1,die:8,active:true}]; } catch { return [{id:1,count:1,die:8,active:true}]; }
}
function setDiceGroups(g) {
  const a = JSON.parse(localStorage.getItem('dnd-dice-groups')||'{}'); a[CHAR_ID]=g; localStorage.setItem('dnd-dice-groups',JSON.stringify(a));
}
function bindDiceGroupEvents(body) {
  body.querySelectorAll('[data-dg-toggle]').forEach(cb => {
    cb.addEventListener('change', () => { const g=getDiceGroups(); const x=g.find(x=>x.id==cb.dataset.dgToggle); if(x)x.active=cb.checked; setDiceGroups(g); renderAttack(); });
  });
  body.querySelectorAll('[data-dg-field]').forEach(inp => {
    inp.addEventListener('change', () => { const g=getDiceGroups(); const x=g.find(x=>x.id==inp.dataset.dgId); if(!x)return; x[inp.dataset.dgField]=parseInt(inp.value)||(inp.dataset.dgField==='count'?1:8); setDiceGroups(g); renderAttack(); });
  });
  body.querySelectorAll('[data-dg-del]').forEach(btn => {
    btn.addEventListener('click', () => { let g=getDiceGroups().filter(x=>x.id!=btn.dataset.dgDel); if(!g.length)g=[{id:Date.now(),count:1,die:8,active:true}]; setDiceGroups(g); renderAttack(); });
  });
}

// ══════════════════════════════════════════════════════════════
// INCOMING DAMAGE
// ══════════════════════════════════════════════════════════════
function renderDefense() {
  const c = char; if (!c) return;
  const body = $('#defense-body');
  body.innerHTML = `
    <div class="field-group"><label>Enemy Roll:</label><input type="number" id="di-enemy-roll" style="width:60px"></div>
    <div class="field-group"><label>Your KD (AC):</label><span class="value">${c.armor_class}</span></div>
    <div class="field-group"><label>Damage Rolled:</label><input type="number" id="di-damage" style="width:60px"></div>
    <button class="btn btn-danger btn-sm" id="di-apply" style="margin-top:8px">⚔️ Apply Damage</button>
    <div class="result-box" id="di-result" style="margin-top:8px"><span class="text-muted">Enter values and apply</span></div>
  `;
  $('#di-apply').addEventListener('click', async () => {
    const enemyRoll = parseInt($('#di-enemy-roll').value)||0;
    const dmg = parseInt($('#di-damage').value)||0;
    if (!enemyRoll || !dmg) return;
    const res = await api.post('/api/calc/damage-intake', {
      character_id: CHAR_ID, enemy_roll: enemyRoll, damage_rolled: dmg,
    });
    if (res.final_damage === 0 && res.hit_diff <= 0) {
      $('#di-result').innerHTML = `<span class="miss-text">MISS!</span> Diff: ${res.hit_diff}`;
      addLog(`[Defense] Enemy(${enemyRoll}) vs KD(${res.armor_class}) = MISS`);
    } else {
      if (res.final_damage > c.current_hp * 0.5 && res.final_damage > 0) {
        const ok = await confirmAction(`Take ${res.final_damage} damage? (>50% of current HP)`);
        if (!ok) return;
      }
      await api.patch(`/api/characters/${CHAR_ID}/hp`, { delta: -res.final_damage });
      char = await api.get(`/api/characters/${CHAR_ID}`);
      flash($('#hp-card'), 'flash-damage');
      renderHP();

      const tierPct = Math.round((1 - res.multiplier) * 100);
      let bd = `Diff: ${res.hit_diff} → <span class="tier-text">${res.tier_label}</span><br>Tier reduction: ${tierPct}%`;
      if (res.effect_breakdown.length) {
        res.effect_breakdown.forEach(e => {
          if (e.type==='percent_reduction') bd += ` + ${e.name}: ${e.value}%`;
          else bd += `<br>→ ${e.name}: -${e.value} flat`;
        });
        bd += `<br>Total: <span class="text-accent">${res.total_percent_reduction}%</span> → ×${res.combined_multiplier}`;
        bd += `<br>${dmg} × ${res.combined_multiplier} = ${res.base_damage}`;
        if (res.flat_sum > 0) bd += ` - ${res.flat_sum} flat`;
      } else {
        bd += `<br>${dmg} × ${res.combined_multiplier} = ${res.base_damage}`;
      }
      bd += `<br><strong>Final: <span class="damage-num">${res.final_damage} damage</span></strong>`;
      $('#di-result').innerHTML = bd;
      addLog(`[Defense] Enemy(${enemyRoll}) vs KD(${res.armor_class}) → ${res.tier_label} → ${res.final_damage} dmg`);
    }
  });
}

// ══════════════════════════════════════════════════════════════
// HP RECOVERY
// ══════════════════════════════════════════════════════════════
function renderHeal() {
  // Rework v3: the player-side "Roll & Heal" dice widget is retired. Healing
  // now comes from potions, abilities, and the GM's Full Rest button. We
  // keep a small manual-HP panel so the player can still toggle HP while
  // roleplaying (e.g. "I drink a potion").
  const c = char; if (!c) return;
  const body = $('#heal-body');
  if (!body) return;
  body.innerHTML = `
    <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:6px">
      💡 Healing comes from <strong>potions</strong>, <strong>abilities</strong>,
      or a GM <strong>Full Rest</strong>.
    </div>
    <div class="field-group">
      <label>Manual HP:</label>
      <input type="number" id="manual-hp" value="0" style="width:60px">
      <button class="btn btn-ghost btn-xs" id="btn-add-hp">+ Add</button>
      <button class="btn btn-ghost btn-xs" id="btn-set-hp">Set</button>
    </div>
  `;
  $('#btn-add-hp').addEventListener('click', async () => {
    const v = parseInt($('#manual-hp').value)||0;
    if (!v) return;
    await api.patch(`/api/characters/${CHAR_ID}/hp`, { delta: v });
    char = await api.get(`/api/characters/${CHAR_ID}`);
    if (v > 0) flash($('#hp-card'), 'flash-heal');
    else flash($('#hp-card'), 'flash-damage');
    renderHP();
    addLog(`[HP] Manually ${v>0?'+':''}${v} HP`);
  });
  $('#btn-set-hp').addEventListener('click', async () => {
    const v = parseInt($('#manual-hp').value)||0;
    await api.patch(`/api/characters/${CHAR_ID}/hp`, { set: v });
    char = await api.get(`/api/characters/${CHAR_ID}`);
    renderHP();
    addLog(`[HP] Set to ${v}`);
  });
}

// ══════════════════════════════════════════════════════════════
// TURN COUNTER
// ══════════════════════════════════════════════════════════════
function renderTurns() {
  const c = char; if (!c) return;
  const body = $('#turns-body');
  let timersHtml = (c.turn_timers||[]).map(t => {
    const vc = t.current_value <= 0 ? 'expired' : 'active';
    return `<div class="timer-row ${t.is_active?'':'inactive'}">
      <label class="toggle-switch"><input type="checkbox" ${t.is_active?'checked':''} data-timer-toggle="${t.id}"><span class="slider"></span></label>
      <input type="text" value="${t.name}" data-timer-id="${t.id}" data-timer-field="name" style="width:90px">
      <span class="timer-value ${vc}">${t.current_value}</span><span class="timer-initial">/ ${t.initial_value}</span>
      <input type="number" value="${t.initial_value}" data-timer-id="${t.id}" data-timer-field="initial_value" style="width:48px" min="1">
      <button class="btn btn-ghost btn-xs" data-timer-reset="${t.id}">↩️</button>
      <button class="btn-icon danger" data-timer-del="${t.id}">🗑</button>
    </div>`;
  }).join('');

  body.innerHTML = `
    <div class="turn-header">
      <div><div class="turn-label">Turn</div><div class="turn-count-display">${c.turn_count||0}</div></div>
      <button class="btn btn-accent btn-sm" id="btn-next-turn">⏭ Next</button>
      <button class="btn btn-ghost btn-sm" id="btn-reset-turns">↩️ Reset</button>
    </div>
    <div id="timer-list">${timersHtml}</div>
    <button class="btn btn-ghost btn-xs" id="btn-add-timer" style="margin-top:6px">+ Add Timer</button>
  `;

  $('#btn-next-turn').addEventListener('click', async () => {
    char = await api.post(`/api/characters/${CHAR_ID}/advance-turn`);
    renderTurns(); addLog(`[Turn] Advanced to ${char.turn_count}`);
  });
  $('#btn-reset-turns').addEventListener('click', async () => {
    char = await api.post(`/api/characters/${CHAR_ID}/reset-turns`);
    renderTurns(); addLog(`[Turn] Reset`);
  });
  $('#btn-add-timer').addEventListener('click', async () => {
    await api.post(`/api/characters/${CHAR_ID}/timers`, { name:'Timer', initial_value:3 });
    char = await api.get(`/api/characters/${CHAR_ID}`); renderTurns();
  });
  body.querySelectorAll('[data-timer-toggle]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await api.put(`/api/timers/${cb.dataset.timerToggle}`, { is_active: cb.checked });
      char = await api.get(`/api/characters/${CHAR_ID}`); renderTurns();
    });
  });
  body.querySelectorAll('[data-timer-field]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const f = inp.dataset.timerField;
      const v = f === 'name' ? inp.value : parseInt(inp.value)||1;
      await api.put(`/api/timers/${inp.dataset.timerId}`, { [f]: v });
      char = await api.get(`/api/characters/${CHAR_ID}`); renderTurns();
    });
  });
  body.querySelectorAll('[data-timer-reset]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const t = (char.turn_timers||[]).find(x => x.id == btn.dataset.timerReset);
      if (t) { await api.put(`/api/timers/${t.id}`, { current_value: t.initial_value }); }
      char = await api.get(`/api/characters/${CHAR_ID}`); renderTurns();
    });
  });
  body.querySelectorAll('[data-timer-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.del(`/api/timers/${btn.dataset.timerDel}`);
      char = await api.get(`/api/characters/${CHAR_ID}`); renderTurns();
    });
  });
}

// ══════════════════════════════════════════════════════════════
// EFFECTS
// ══════════════════════════════════════════════════════════════
function renderEffects() {
  const c = char; if (!c) return;
  const body = $('#effects-body');
  body.innerHTML = (c.effects||[]).map(e => `
    <div class="mod-row ${e.is_active?'':'inactive'}">
      <label class="toggle-switch"><input type="checkbox" ${e.is_active?'checked':''} data-eff-toggle="${e.id}"><span class="slider"></span></label>
      <input type="text" value="${e.name}" data-eff-field="name" data-eff-id="${e.id}">
      <select data-eff-field="effect_type" data-eff-id="${e.id}">
        <option value="percent_reduction" ${e.effect_type==='percent_reduction'?'selected':''}>% Reduction</option>
        <option value="flat_reduction" ${e.effect_type==='flat_reduction'?'selected':''}>Flat Reduction</option>
      </select>
      <input type="number" value="${e.value}" data-eff-field="value" data-eff-id="${e.id}" style="width:52px">
      <button class="btn-icon danger" data-del-eff="${e.id}">🗑</button>
    </div>
  `).join('') + `<button class="btn btn-ghost btn-xs" id="btn-add-effect" style="margin-top:6px">+ Add Effect</button>`;

  body.querySelector('#btn-add-effect').addEventListener('click', async () => {
    await api.post(`/api/characters/${CHAR_ID}/effects`, { name:'New Effect', effect_type:'percent_reduction', value:0 });
    char = await api.get(`/api/characters/${CHAR_ID}`); renderEffects();
  });
  body.querySelectorAll('[data-eff-toggle]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await api.put(`/api/effects/${cb.dataset.effToggle}`, { is_active: cb.checked });
      char = await api.get(`/api/characters/${CHAR_ID}`); renderEffects();
    });
  });
  body.querySelectorAll('[data-eff-field]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const f = inp.dataset.effField;
      const v = f === 'value' ? parseFloat(inp.value)||0 : inp.value;
      await api.put(`/api/effects/${inp.dataset.effId}`, { [f]: v });
      char = await api.get(`/api/characters/${CHAR_ID}`);
    });
  });
  body.querySelectorAll('[data-del-eff]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.del(`/api/effects/${btn.dataset.delEff}`);
      char = await api.get(`/api/characters/${CHAR_ID}`); renderEffects();
    });
  });
}

// ══════════════════════════════════════════════════════════════
// ENEMY DAMAGE CALC (sidebar)
// ══════════════════════════════════════════════════════════════
let enemyDefenses = [];
let edIdCounter = 0;
function renderEnemyCalc() {
  const body = $('#enemy-calc-body');
  const defHtml = enemyDefenses.map(d => `
    <div class="mod-row">
      <select data-edef-type="${d.id}" style="width:60px">
        <option value="percent" ${d.type==='percent'?'selected':''}>%</option>
        <option value="flat" ${d.type==='flat'?'selected':''}>Flat</option>
      </select>
      <input type="number" value="${d.value}" data-edef-val="${d.id}" style="width:52px">
      <button class="btn-icon danger" data-del-edef="${d.id}">🗑</button>
    </div>`).join('');

  body.innerHTML = `
    <div class="field-group"><label>My Roll:</label><input type="number" id="ec-my-roll" style="width:60px"></div>
    <div class="field-group"><label>Enemy KD:</label><input type="number" id="ec-kd" value="10" style="width:60px"></div>
    <div class="field-group"><label>Damage:</label><input type="number" id="ec-dmg" style="width:60px"></div>
    <div style="margin:6px 0"><strong style="font-size:0.75rem">Defense Bonuses:</strong></div>
    <div id="ec-defs">${defHtml}</div>
    <button class="btn btn-ghost btn-xs" id="ec-add-def" style="margin:4px 0">+ Defense</button>
    <button class="btn btn-primary btn-sm" id="ec-calc" style="margin-top:8px;width:100%">Calculate</button>
    <div class="result-box" id="ec-result" style="margin-top:8px"><span class="text-muted">—</span></div>
  `;

  body.querySelectorAll('[data-edef-type]').forEach(s => { s.addEventListener('change', () => { const d=enemyDefenses.find(x=>x.id==s.dataset.edefType); if(d)d.type=s.value; }); });
  body.querySelectorAll('[data-edef-val]').forEach(inp => { inp.addEventListener('change', () => { const d=enemyDefenses.find(x=>x.id==inp.dataset.edefVal); if(d)d.value=parseInt(inp.value)||0; }); });
  body.querySelectorAll('[data-del-edef]').forEach(btn => { btn.addEventListener('click', () => { enemyDefenses=enemyDefenses.filter(x=>x.id!=btn.dataset.delEdef); renderEnemyCalc(); }); });
  $('#ec-add-def').addEventListener('click', () => { enemyDefenses.push({id:++edIdCounter,type:'percent',value:0}); renderEnemyCalc(); });
  $('#ec-calc').addEventListener('click', async () => {
    const res = await api.post('/api/calc/enemy-damage', {
      my_roll: parseInt($('#ec-my-roll').value)||0,
      enemy_kd: parseInt($('#ec-kd').value)||10,
      damage_rolled: parseInt($('#ec-dmg').value)||0,
      defense_bonuses: enemyDefenses,
    });
    let t = `Diff: ${res.hit_diff} → ${res.tier_label}<br>Base: ${res.base_damage}`;
    t += `<br><strong>Final: <span class="damage-num">${res.final_damage} damage</span></strong>`;
    $('#ec-result').innerHTML = t;
    addLog(`[Enemy] → ${res.tier_label} → ${res.final_damage} dmg`);
  });
}

// ══════════════════════════════════════════════════════════════
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
// MAP / BATTLE GRID  (Rework v3 Phase 1)
// ══════════════════════════════════════════════════════════════
// The player now has two canvases of the same map:
//   • `playerMainGrid` — always-on, embedded in the Main tab (primary view).
//   • `playerMapCanvas` — legacy modal, opened on demand for a fullscreen
//     look. Both are fed from a single `loadPlayerMapState()` so they
//     never drift; every WS map event fans out to both.
// Token click on the main grid selects it as the combat target (same
// `selectedTargetId` path as the old chip cards used), so the Actions
// panel keeps working without any changes downstream.
let playerMapCanvas = null;  // modal fullscreen
let playerMainGrid  = null;  // always-on, in Main tab
let _lastMapState   = null;  // cached for re-renders after tab switch

// Iterate both canvases in one place.
function _eachMapCanvas(fn) {
  if (playerMainGrid)  fn(playerMainGrid);
  if (playerMapCanvas) fn(playerMapCanvas);
}

// Apply a freshly fetched /api/map state to a canvas (or all of them).
async function _applyMapStateTo(canvas, state) {
  if (!canvas || !state) return;
  if (state.has_map && state.image_url) {
    try { await canvas.loadImage(state.image_url); } catch {}
    canvas.setGrid(state.grid_size, state.grid_enabled, state.grid_type || 'square');
    canvas.setFog(state.fog_enabled, state.revealed_cells);
  } else {
    // No map yet — still render an empty grid so the player sees the
    // spatial surface. Use floor tile_size / bounds if available.
    const tsz = state.active_floor_tile_size || 50;
    const cols = state.active_floor_cols || 40;
    const rows = state.active_floor_rows || 30;
    canvas.mapImage = null;
    canvas.mapWidth  = cols * tsz;
    canvas.mapHeight = rows * tsz;
    canvas.setGrid(tsz, true, state.active_floor_grid_type || 'square');
    canvas.setFog(false, []);
    canvas._autoFitIfChanged();
  }
  canvas.setTokens(state.tokens || []);
  canvas.setDrawings(state._drawings || canvas.drawings || []);
  canvas.setMarkers(state._markers  || canvas.markers  || []);
  // Phase 5: walls / zones. Filter server-side-hidden objects out
  // on the client too as a belt-and-suspenders measure (the GM may
  // flip visible_to_players).
  const objs = (state._objects || canvas.mapObjects || [])
    .filter(o => o.visible_to_players !== false);
  canvas.setObjects(objs);
  // Map Builder: tiles + traps from state (if loaded via /api/map/{code})
  canvas.setTiles(state.active_floor_tiles || {}, state.active_floor_grid_type || 'square');
  canvas.setTraps((state._traps || []).filter(t => !t.is_hidden));
  canvas.render();
}

function _fitPlayerCanvasToTiles(canvas) {
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
}

// Load map state once and push to every mounted canvas.
async function loadPlayerMapState() {
  let state;
  try {
    state = await api.get(`/api/map/${SESSION_CODE}`);
  } catch {
    return;
  }
  // Fetch overlays in parallel; failure is fine (feature may be off).
  try {
    const ov = await api.get(`/api/map/${SESSION_CODE}/overlays`);
    state._drawings = ov.drawings || [];
    state._markers  = ov.markers  || [];
    state._objects  = ov.objects  || [];
    state._traps    = ov.traps    || [];
  } catch {
    state._drawings = [];
    state._markers  = [];
    state._objects  = [];
    state._traps    = [];
  }
  _lastMapState = state;
  // Update the empty-state overlay on the main grid.
  const emptyEl = document.getElementById('player-grid-empty');
  if (emptyEl) emptyEl.style.display = state.has_map ? 'none' : 'flex';
  const statusEl = document.getElementById('player-grid-status');
  if (statusEl) {
    const n = (state.tokens || []).filter(t => t.visible).length;
    statusEl.textContent = state.has_map
      ? `${n} token${n === 1 ? '' : 's'}`
      : 'no map';
  }
  // Apply to each live canvas.
  if (playerMainGrid)  await _applyMapStateTo(playerMainGrid,  state);
  if (playerMapCanvas) await _applyMapStateTo(playerMapCanvas, state);
  // Phase 4: once the fresh tokens are on-canvas, push the updated
  // speed/movement numbers into the overlay + HUD.
  if (typeof _refreshMovementBudget === 'function') _refreshMovementBudget();
}

// ── Phase 2: player moves own token ─────────────────────────────
// Wiring helper shared by every player MapCanvas (main + modal). Fires
// on mouseup after a real drag. MapCanvas has already snapped x/y to
// the nearest cell centre, so we just PATCH with the caller token for
// the ownership check on the server.
async function _sendOwnTokenMove(charId, x, y) {
  try {
    const res = await fetch(`/api/map/token/${charId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y, player_token: PLAYER_TOKEN }),
    });
    // Phase 3: if the server rejected the move (combat-turn gating or
    // ownership mismatch), surface a toast and refetch the authoritative
    // position so the token snaps back visually. This closes the "move
    // locally, silently fail on server" gap.
    if (!res.ok) {
      let msg = 'Move rejected';
      try { const j = await res.json(); if (j && j.detail) msg = j.detail; } catch {}
      showToast(`⛔ ${msg}`);
      loadPlayerMapState();
      return;
    }
  } catch (e) {
    console.warn('token move failed:', e);
  }
}

// ── Phase 3: keep MapCanvas in sync with combat state ──────────
// `canPlayerMove` is recomputed after every event that could change
// whose turn it is: combat started/ended, turn advanced, character
// downed, banner refreshed from HTTP, etc.
function _computeCanPlayerMove() {
  // No combat → freely move.
  if (!playerCombat || playerCombat.status !== 'active') return true;
  // Combat active → only when WE are the current actor.
  const curCharId = _currentTurnCharacterId();
  return curCharId === CHAR_ID;
}

function _refreshMovementGating() {
  const can = _computeCanPlayerMove();
  _eachMapCanvas(c => c.setCanPlayerMove(can));
  _refreshMovementBudget();
}

// Phase 4: extract own-token's speed/movement from the cached map
// state and feed it to every canvas + the HUD label in the grid
// panel. Overlay is ONLY shown during combat on our own turn; outside
// those conditions we pass (null, null) to hide it.
function _refreshMovementBudget() {
  let total = null, left = null;
  if (_lastMapState && _computeCanPlayerMove()
      && playerCombat && playerCombat.status === 'active') {
    const own = (_lastMapState.tokens || []).find(t => t.character_id === CHAR_ID);
    if (own) {
      total = Number(own.speed_total ?? 0);
      left  = Number(own.movement_left ?? total);
    }
  }
  _eachMapCanvas(c => c.setMovementBudget(left, total));
  // HUD text in the grid panel header.
  const hud = document.getElementById('player-grid-status');
  if (hud) {
    if (total != null && left != null) {
      hud.textContent = `${Math.floor(left)}/${total} cells left`;
    } else if (_lastMapState && _lastMapState.has_map) {
      const n = (_lastMapState.tokens || []).filter(t => t.visible).length;
      hud.textContent = `${n} token${n === 1 ? '' : 's'}`;
    }
  }
}

// Common constructor options shared by both player canvases.
function _playerCanvasOptions() {
  return {
    role: 'player',
    sessionCode: SESSION_CODE,
    // Phase 2: own-token drag.
    ownCharacterId: CHAR_ID,
    onTokenMove: _sendOwnTokenMove,
    // Phase 1: clicking a token acts as a target selector. Tapping the
    // same token again (or the Clear button) unselects.
    onTokenClick: (token) => {
      const tid = token.character_id;
      if (!tid || tid === parseInt(CHAR_ID)) return;  // can't target self via grid
      selectedTargetId = (selectedTargetId === tid) ? null : tid;
      if (typeof renderTableView  === 'function') renderTableView();
      if (typeof updateTargetInfo === 'function') updateTargetInfo();
      if (typeof renderActionMenu === 'function') renderActionMenu();
    },
  };
}

// ── Main-tab battle grid: init eagerly on page load ─────────────
function initPlayerMainGrid() {
  const canvasEl = document.getElementById('player-grid-canvas');
  if (!canvasEl || playerMainGrid) return;
  playerMainGrid = new MapCanvas(canvasEl, _playerCanvasOptions());
  // First paint with whatever's cached; real data arrives from loadPlayerMapState.
  playerMainGrid._resize();
  loadPlayerMapState();
}

// Fit / expand controls on the main grid panel.
(() => {
  const fitBtn = document.getElementById('btn-grid-fit');
  if (fitBtn) fitBtn.addEventListener('click', () => {
    if (playerMainGrid) { playerMainGrid.centerView(); }
  });
  const expandBtn = document.getElementById('btn-grid-expand');
  if (expandBtn) expandBtn.addEventListener('click', () => {
    const wrap = document.getElementById('player-grid-wrap');
    if (!wrap) return;
    const tall = wrap.dataset.tall === '1';
    wrap.style.height = tall ? '420px' : '720px';
    wrap.dataset.tall = tall ? '0' : '1';
    if (playerMainGrid) { playerMainGrid._resize(); playerMainGrid.centerView(); }
  });
  // Phase 6: player uploads their OWN token portrait. Reuses the same
  // HTTP endpoint the GM uses — the server is trust-based today, so
  // either role can hit it; a future phase will add a player_token
  // check. Spawns a hidden file input and relies on the WS
  // `map.updated` broadcast to refresh everyone's canvases.
  const portraitBtn = document.getElementById('btn-player-portrait');
  if (portraitBtn) portraitBtn.addEventListener('click', () => {
    if (CHAR_ID == null) return;
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
        const res = await fetch(`/api/map/token-image/${CHAR_ID}`, { method: 'POST', body: fd });
        if (!res.ok) { showToast('Portrait upload failed'); return; }
        showToast('Portrait updated');
      } catch { showToast('Portrait upload failed'); }
    });
    input.click();
  });
})();

// ── Fullscreen modal (kept as a convenience) ────────────────────
$('#btn-open-map').addEventListener('click', async () => {
  const modal = $('#map-modal');
  modal.style.display = 'flex';
  if (!playerMapCanvas) {
    // Reuse the exact same options (role, ownCharacterId, callbacks)
    // as the embedded Main-tab canvas so both support Phase 2 drag.
    playerMapCanvas = new MapCanvas($('#player-map-canvas'), _playerCanvasOptions());
  }
  playerMapCanvas._resize();
  await loadPlayerMapState();
});

$('#btn-close-map').addEventListener('click', () => {
  $('#map-modal').style.display = 'none';
});

// ══════════════════════════════════════════════════════════════
// STATUS EFFECT BADGES (Stage 4)
// ══════════════════════════════════════════════════════════════
async function loadStatusEffects() {
  const el = $('#player-status-badges');
  if (!el) return;
  try {
    const effects = await api.get(`/api/characters/${CHAR_ID}/status-effects`);
    if (!effects.length) { el.innerHTML = ''; return; }
    el.innerHTML = effects.map(e => {
      const turns = e.remaining_turns !== null ? ` ${e.remaining_turns}t` : '';
      const efDesc = (e.effects||[]).map(ef => {
        if (ef.type === 'attack_penalty') return `ATK ${ef.value}`;
        if (ef.type === 'damage_penalty') return `DMG ${ef.value}`;
        if (ef.type === 'hp_change_per_turn') return `HP/turn ${ef.value}`;
        if (ef.type === 'skip_turn') return 'Skip turn';
        if (ef.type === 'stat_penalty') return `${ef.stat} ${ef.value}`;
        if (ef.type === 'custom_note') return ef.text;
        return ef.type;
      }).join(', ');
      return `<span style="background:${e.color}20;border:1px solid ${e.color};border-radius:6px;padding:3px 8px;font-size:0.78rem;display:inline-flex;align-items:center;gap:3px;cursor:help" title="${e.name}: ${efDesc}">${e.icon} ${e.name}${turns ? `<span style='font-size:0.65rem;opacity:0.7'>${turns}</span>` : ''}</span>`;
    }).join('');
  } catch {}
}

// ══════════════════════════════════════════════════════════════
// CURRENCY DISPLAY & TRANSFER
// ══════════════════════════════════════════════════════════════
async function loadCurrency() {
  try {
    const data = await api.get(`/api/characters/${CHAR_ID}/currency`);
    const d = data.currency;
    const parts = [];
    if (d.platinum) parts.push(`${d.platinum}P`);
    if (d.gold) parts.push(`${d.gold}G`);
    if (d.silver) parts.push(`${d.silver}S`);
    parts.push(`${d.bronze || d.copper}B`);
    $('#player-currency').innerHTML = `💰 ${parts.join(' ')}`;
    $('#player-currency').dataset.totalBronze = data.total_bronze || data.total_copper;
    // FIX 2: mirror to left sidebar — always show all 4 denominations
    const plat = $('#cs-curr-plat');
    const platVal = $('#cs-curr-plat-val');
    if (plat) { plat.style.display = ''; }
    if (platVal) platVal.textContent = d.platinum || 0;
    const csGold   = $('#cs-curr-gold');   if (csGold)   csGold.textContent   = d.gold || 0;
    const csSilver = $('#cs-curr-silver'); if (csSilver) csSilver.textContent = d.silver || 0;
    const csBronze = $('#cs-curr-bronze'); if (csBronze) csBronze.textContent = d.bronze || d.copper || 0;
  } catch {}
}

$('#player-currency').addEventListener('click', () => openTransferModal());

function openTransferModal() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg);width:85%;max-width:380px;padding:20px">
      <h3 style="font-size:0.9rem;margin-bottom:12px">💰 Transfer Currency</h3>
      <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:8px">Balance: <strong style="color:var(--accent)">${$('#player-currency').textContent}</strong></p>
      <div id="transfer-targets" style="margin-bottom:10px"></div>
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:8px">
        <span style="font-size:0.7rem;color:#e0c97f">P:</span><input type="number" id="tx-plat" value="0" style="width:42px;font-size:0.75rem" min="0">
        <span style="font-size:0.7rem;color:#fbbf24">G:</span><input type="number" id="tx-gold" value="0" style="width:42px;font-size:0.75rem" min="0">
        <span style="font-size:0.7rem;color:#94a3b8">S:</span><input type="number" id="tx-silver" value="0" style="width:42px;font-size:0.75rem" min="0">
        <span style="font-size:0.7rem;color:#b87333">B:</span><input type="number" id="tx-bronze" value="0" style="width:42px;font-size:0.75rem" min="0">
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-primary btn-sm" id="tx-send">Send</button>
        <button class="btn btn-ghost btn-sm" id="tx-cancel">Cancel</button>
      </div>
      <div id="tx-result" style="margin-top:8px;font-size:0.8rem"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#tx-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Load other characters in session
  let selectedTarget = null;
  (async () => {
    try {
      const chars = await api.get(`/api/sessions/${SESSION_CODE}/characters`);
      const others = chars.filter(c => c.id !== CHAR_ID && !c.is_npc);
      const el = overlay.querySelector('#transfer-targets');
      if (!others.length) { el.innerHTML = '<span class="text-muted" style="font-size:0.8rem">No other players.</span>'; return; }
      el.innerHTML = `<label style="font-size:0.78rem;color:var(--text-muted)">To:</label>
        <select id="tx-target" style="font-size:0.8rem;padding:4px;margin-left:4px">
          ${others.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
        </select>`;
    } catch {}
  })();

  overlay.querySelector('#tx-send').addEventListener('click', async () => {
    const target = overlay.querySelector('#tx-target');
    if (!target) return;
    const toId = parseInt(target.value);
    const p = parseInt(overlay.querySelector('#tx-plat').value) || 0;
    const g = parseInt(overlay.querySelector('#tx-gold').value) || 0;
    const s = parseInt(overlay.querySelector('#tx-silver').value) || 0;
    const co = parseInt(overlay.querySelector('#tx-bronze').value) || 0;
    const totalBronze = p * 1000 + g * 100 + s * 10 + co;
    if (totalBronze <= 0) return;

    try {
      const res = await api.post('/api/currency/transfer', { from_id: CHAR_ID, to_id: toId, bronze_amount: totalBronze });
      overlay.querySelector('#tx-result').innerHTML = `<span style="color:var(--accent-green)">Sent ${p}P ${g}G ${s}S ${co}B to ${res.to.name}!</span>`;
      loadCurrency();
      addLog(`[Transfer] Sent ${totalBronze}b to ${res.to.name}`);
      setTimeout(() => overlay.remove(), 1500);
    } catch (e) {
      let msg = 'Transfer failed';
      try { const err = JSON.parse(e.message); msg = err.detail?.message || err.detail || msg; } catch {}
      overlay.querySelector('#tx-result').innerHTML = `<span style="color:var(--accent-red)">${msg}</span>`;
    }
  });
}

// ══════════════════════════════════════════════════════════════
// FIX 7 — UNIVERSAL MODAL DISMISS HELPER
// ══════════════════════════════════════════════════════════════
/**
 * Make any modal overlay dismissible via ✕ button, outside click, or Escape.
 * @param {HTMLElement} modalEl - The overlay root element
 * @param {function} onDismiss - Callback (reason: 'btn'|'outside'|'escape')
 */
function makeModalDismissible(modalEl, onDismiss = null) {
  if (!modalEl) return;
  function close(reason) {
    if (modalEl.parentNode) modalEl.parentNode.removeChild(modalEl);
    document.removeEventListener('keydown', escHandler);
    if (typeof onDismiss === 'function') {
      try { onDismiss(reason); } catch (e) { console.warn('modal onDismiss:', e); }
    }
  }
  // ✕ close button
  const closeBtn = modalEl.querySelector('.modal-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', () => close('btn'));
  // Outside click (only if target is the overlay itself)
  modalEl.addEventListener('click', e => {
    if (e.target === modalEl) close('outside');
  });
  // Escape key
  function escHandler(e) {
    if (e.key === 'Escape') close('escape');
  }
  document.addEventListener('keydown', escHandler);
  // Expose close function so external code can dismiss cleanly
  modalEl._dismiss = close;
  return close;
}
window.makeModalDismissible = makeModalDismissible;

// ══════════════════════════════════════════════════════════════
// TRADE MODAL (opened via WS event from GM)
// ══════════════════════════════════════════════════════════════
let activeTradeOverlay = null;

function openTradeModal(tradeId, npcId, npcName) {
  if (activeTradeOverlay) activeTradeOverlay.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay trade-modal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div class="modal-content" style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg);width:90%;max-width:550px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden">
      <div class="modal-header" style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--bg-surface-2);gap:12px">
        <h3 class="modal-title" style="flex:1;font-size:0.95rem;margin:0">🤝 Trading with ${npcName}</h3>
        <span id="trade-balance" style="font-size:0.8rem;color:var(--accent)"></span>
        <button class="modal-close-btn btn btn-ghost btn-xs" title="Close (Esc) — trade ends">✕</button>
      </div>
      <div id="trade-shop-list" style="padding:12px;overflow-y:auto;flex:1;font-size:0.82rem"></div>
      <div id="trade-result" style="padding:8px 16px;font-size:0.8rem"></div>
      <div style="padding:6px 16px;font-size:0.68rem;color:var(--text-muted);text-align:center;border-top:1px solid var(--border)">
        You can ask the GM to reopen this trade
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  activeTradeOverlay = overlay;

  // FIX 7: Dismissible — on dismiss, close trade + broadcast to GM
  makeModalDismissible(overlay, async (reason) => {
    activeTradeOverlay = null;
    // Tell server to close the trade session
    try {
      await api.post(`/api/trade/${tradeId}/close`, {});
    } catch {}
    // Notify GM via WS so they see dismissal in log
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({
        type: 'trade.dismissed',
        trade_id: tradeId,
        player_id: CHAR_ID,
        player_name: char?.name || 'Player',
        npc_id: npcId,
        npc_name: npcName,
        reason,
      }));
    }
    showToast('Trade ended');
  });

  async function loadTradeShop() {
    try {
      const cur = await api.get(`/api/characters/${CHAR_ID}/currency`);
      const d = cur.currency;
      const bal = [d.platinum && d.platinum+'P', d.gold && d.gold+'G', d.silver && d.silver+'S', (d.bronze||d.copper)+'B'].filter(Boolean).join(' ');
      overlay.querySelector('#trade-balance').textContent = `💰 ${bal}`;

      const shop = await api.get(`/api/npc/${npcId}/shop?player_id=${CHAR_ID}`);
      const el = overlay.querySelector('#trade-shop-list');
      if (!shop.items.length) { el.innerHTML = '<span class="text-muted">This merchant has nothing for sale.</span>'; return; }

      el.innerHTML = shop.items.map(si => {
        const fp = si.final_price;
        const priceStr = [fp.platinum && fp.platinum+'P', fp.gold && fp.gold+'G', fp.silver && fp.silver+'S', (fp.bronze||fp.copper) && (fp.bronze||fp.copper)+'B'].filter(Boolean).join(' ') || (si.final_price_bronze||si.final_price_copper)+'b';
        const stockStr = si.stock === null ? '' : `(${si.stock} left)`;
        const canBuy = si.stock === null || si.stock > 0;
        return `<div style="display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1">
            <div class="rarity-${si.rarity}" style="font-weight:600">${si.name}</div>
            <div style="font-size:0.7rem;color:var(--text-muted)">${si.description || ''}</div>
          </div>
          <span style="font-size:0.75rem;font-weight:600">${priceStr}</span>
          <span style="font-size:0.65rem;color:var(--text-muted)">${stockStr}</span>
          ${canBuy ? `<button class="btn btn-primary btn-xs" data-trade-buy="${si.shop_item_id}">Buy</button>` : '<span style="color:var(--accent-red);font-size:0.7rem">SOLD</span>'}
        </div>`;
      }).join('');

      el.querySelectorAll('[data-trade-buy]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const sid = parseInt(btn.dataset.tradeBuy);
          try {
            const res = await api.post(`/api/trade/${tradeId}/buy`, { shop_item_id: sid, quantity: 1 });
            overlay.querySelector('#trade-result').innerHTML = `<span style="color:var(--accent-green)">Bought ${res.item_name} for ${res.total_cost_bronze||res.total_cost_copper}b!</span>`;
            loadCurrency();
            loadInventory();
            loadTradeShop();
            addLog(`[Trade] Bought ${res.item_name}`);
          } catch (e) {
            let msg = 'Purchase failed';
            try { const err = JSON.parse(e.message); msg = err.detail?.message || err.detail || msg; } catch {}
            overlay.querySelector('#trade-result').innerHTML = `<span style="color:var(--accent-red)">${msg}</span>`;
          }
        });
      });
    } catch (e) {
      overlay.querySelector('#trade-shop-list').innerHTML = '<span class="text-muted">Error loading shop.</span>';
    }
  }

  loadTradeShop();
}

function closeTradeModal() {
  if (activeTradeOverlay) {
    activeTradeOverlay.remove();
    activeTradeOverlay = null;
    showToast('Trade ended');
  }
}

// ══════════════════════════════════════════════════════════════
// WEBSOCKET
// ══════════════════════════════════════════════════════════════
const ws = new WsClient(SESSION_CODE, PLAYER_TOKEN);

ws.on('_connected', () => {
  $('#ws-dot').className = 'status-dot connected';
  $('#ws-label').textContent = 'connected';
});
ws.on('_disconnected', () => {
  $('#ws-dot').className = 'status-dot disconnected';
  $('#ws-label').textContent = 'disconnected';
});
ws.on('_reconnecting', d => { $('#ws-label').textContent = `reconnecting (${d.attempt})...`; });

ws.on('character.hp_update', d => {
  if (d.character_id == CHAR_ID) loadChar();
});
ws.on('inventory.item_added', d => {
  if (d.character_id == CHAR_ID) { loadInventory(); renderBonusesPenalties(); }
});
ws.on('inventory.item_equipped', d => {
  if (d.character_id == CHAR_ID) { loadInventory(); renderBonusesPenalties(); }
});
ws.on('inventory.item_removed', d => {
  if (d.character_id == CHAR_ID) { loadInventory(); renderBonusesPenalties(); }
});
ws.on('combat.bonuses_updated', d => {
  if (d.character_id == CHAR_ID) { loadInventory(); loadChar(); renderBonusesPenalties(); }
});
ws.on('status.updated', d => {
  if (d.character_id == CHAR_ID) { renderBonusesPenalties(); }
});
ws.on('session.status_change', d => {
  if (d.status === 'ended') addLog('[Session] Ended by GM');
});
// Rework v3: Player-to-player item transfer.
ws.on('inventory.transferred', d => {
  const me = parseInt(CHAR_ID);
  if (d.from_character_id === me) {
    showToast(`🎁 Sent ${d.item_name} ×${d.quantity} to ${d.to_character_name}`);
    loadInventory();
  } else if (d.to_character_id === me) {
    showToast(`🎁 Received ${d.item_name} ×${d.quantity} from ${d.from_character_name}`);
    addLog(`🎁 Received ${d.item_name} ×${d.quantity} from ${d.from_character_name}`);
    loadInventory();
  }
});
// Rework v3: GM triggered Full Rest — refresh and notify the player.
ws.on('session.full_rest', async () => {
  try {
    char = await api.get(`/api/characters/${CHAR_ID}`);
    renderAll();
  } catch {}
  showToast('🌙 Full Rest — HP, mana, cooldowns and uses restored');
  addLog('[Rest] Full Rest applied by GM');
});
// Stage 3: Economy WS events
ws.on('currency.updated', d => {
  if (d.character_id == CHAR_ID) loadCurrency();
});
// Phase 3: Mana WS events
ws.on('mana.updated', d => {
  if (d.character_id == CHAR_ID) { loadChar(); }
});
ws.on('trade.initiated', d => {
  if (d.player_id == CHAR_ID) {
    openTradeModal(d.trade_id, d.npc_id, d.npc_name);
  }
});
ws.on('trade.closed', d => {
  closeTradeModal();
});
// Stage 4: Status effect events
ws.on('status_effect.applied', d => {
  if (d.character_id == CHAR_ID) loadStatusEffects();
});
ws.on('status_effect.removed', d => {
  if (d.character_id == CHAR_ID) loadStatusEffects();
});
ws.on('status_effect.expired', d => {
  if (d.character_id == CHAR_ID) { loadStatusEffects(); showToast(`${d.effect_name} expired`); }
});

// ══════════════════════════════════════════════════════════════
// GENERIC ENTITY INVALIDATION — live refresh without page reload
// ══════════════════════════════════════════════════════════════
// The server emits `entity.invalidated` after every DB commit via the
// SQLAlchemy after_commit dispatcher (app/realtime.py). Payload:
//   { changes: [{ entity, character_id, action }, ...] }
// We map each entity type to the existing loader and debounce so that
// bursts of writes (e.g. batch HP update + status effect tick) collapse
// into a single refetch.
function _call(fn, ...args) {
  if (typeof fn === 'function') { try { fn(...args); } catch (e) { console.warn('refresh error', e); } }
}
const _invRefreshers = {
  // ── Character-scoped ──────────────────────────────────────
  // Character: the sheet, at-the-table HP bars, map tokens, currency
  // (wealth_bronze lives on Character).
  Character: () => {
    loadChar();
    _call(loadCurrency);
    _call(loadTableView);
    _call(loadPlayerMapState);
    _call(loadCombatBanner);
  },
  InventoryItem: () => {
    loadInventory();
    _call(loadCurrency);
    _call(renderBonusesPenalties);
    loadChar();  // max HP / AC can change with gear
  },
  InventoryItemPoison: () => { loadInventory(); },
  CharacterAbility: () => { _call(loadAbilities); _call(renderBonusesPenalties); },
  StatModifier:    () => { _call(renderBonusesPenalties); loadChar(); },
  AttackModifier:  () => { _call(renderBonusesPenalties); },
  DamageModifier:  () => { _call(renderBonusesPenalties); },
  CharacterEffect: () => { _call(loadStatusEffects); _call(renderBonusesPenalties); },
  CharacterStatusEffect: () => { _call(loadStatusEffects); _call(renderBonusesPenalties); },
  CharacterQuest:  () => { _call(loadPlayerQuests); },
  CharacterProfession: () => { loadChar(); },
  TurnTimer: () => { loadChar(); },
  CharacterNote: () => { _call(loadPlayerNotes); },
  CharacterMemory: () => { _call(loadMemory); },
  CharacterWizardState: () => { /* wizard has its own WS events */ },
  NpcReputation: () => { _call(loadTableView); },
  NpcShopInventory: () => { /* only visible while trade modal open */ },
  // ── Session-scoped ────────────────────────────────────────
  Session: () => {
    _call(loadCombatBanner);
    _call(loadTableView);
  },
  CombatEvent: () => {
    _call(loadCombatBanner);
    _call(loadTableView);
    _call(loadPlayerMapState);
  },
  CombatParticipant: () => {
    _call(loadCombatBanner);
    _call(loadTableView);
  },
  CombatAction: () => {
    _call(loadCombatBanner);
  },
  InitiativeOrder: () => { _call(loadCombatBanner); },
  SessionAnnouncement: () => { _call(loadPlayerAnnouncements); },
  QuestTemplate: () => { _call(loadPlayerQuests); },   // template desc may change
  MapData:    () => { _call(loadPlayerMapState); },
  MapMarker:  () => { _call(loadPlayerMapState); },
  MapDrawing: () => { _call(loadPlayerMapState); },
  MapObject:  () => { _call(loadPlayerMapState); },
  // Global templates — player UI mostly doesn't care, but ability
  // templates change the rendered ability description on the fly.
  Ability:        () => { _call(loadAbilities); },
  Race:           () => { /* selection is at character-creation time */ },
  CharacterClass: () => { loadChar(); },
  StatusEffectTemplate: () => { _call(loadStatusEffects); },
  PoisonTemplate: () => { _call(loadInventory); },
};
const _invPending = new Set();
let _invTimer = null;
function _invFlush() {
  const keys = Array.from(_invPending);
  _invPending.clear();
  _invTimer = null;
  for (const key of keys) {
    const fn = _invRefreshers[key];
    if (fn) try { fn(); } catch (e) { console.warn('inv refresh', key, e); }
  }
}
ws.on('entity.invalidated', d => {
  if (!d || !Array.isArray(d.changes)) return;
  const me = parseInt(CHAR_ID);
  for (const ch of d.changes) {
    if (!ch || !ch.entity) continue;
    if (!_invRefreshers[ch.entity]) continue;
    // Character rows always matter: own = my sheet; others = table-view
    // HP bars and map token HP. Character-scoped rows (those carrying a
    // character_id) only matter if they belong to ME — other players'
    // inventory / abilities / notes etc. don't render in my UI. All
    // remaining (session-scoped) entities are kept unconditionally.
    if (ch.character_id != null && ch.character_id !== me && ch.entity !== 'Character') {
      continue;
    }
    _invPending.add(ch.entity);
  }
  if (_invPending.size === 0) return;
  if (_invTimer) clearTimeout(_invTimer);
  _invTimer = setTimeout(_invFlush, 200);
});

// ══════════════════════════════════════════════════════════════
// STAGE 5 — COMBAT BANNER & INITIATIVE
// ══════════════════════════════════════════════════════════════
let playerCombat = null;
let playerTimerInterval = null;

async function loadCombatBanner() {
  const banner = $('#combat-banner');
  if (!banner) return;
  try {
    const res = await api.get(`/api/combat/session/${SESSION_CODE}/active`);
    if (!res.active) {
      banner.style.display = 'none';
      playerCombat = null;
      if (typeof hideReactionsPanel === 'function') hideReactionsPanel();  // FIX 4
      // Phase 3: combat just ended — re-enable movement.
      if (typeof _refreshMovementGating === 'function') _refreshMovementGating();
      return;
    }
    playerCombat = res.combat;
    renderCombatBanner();
    if (typeof renderReactionsPanel === 'function') renderReactionsPanel();  // FIX 4
    // Phase 3: combat state refreshed — recompute whether our token
    // is currently draggable.
    if (typeof _refreshMovementGating === 'function') _refreshMovementGating();
  } catch {
    banner.style.display = 'none';
  }
}

// Rework v3 Phase 3+: the Combat Banner is now a PURE turn-order
// indicator. Attack / Defend / advantage toggle / target picker /
// battle log have been removed per product decision — those actions
// live in the Actions panel on the Main tab. The banner just tells
// the player whose turn it is and shows the initiative queue.
function renderCombatBanner() {
  const banner = $('#combat-banner');
  if (!banner || !playerCombat) { if (banner) banner.style.display = 'none'; return; }
  const c = playerCombat;
  banner.style.display = '';

  const currentP = c.participants.find(p => p.id === c.current_participant_id);
  const myP = c.participants.find(p => p.character_id == CHAR_ID);
  const isMyTurn = currentP && currentP.character_id == CHAR_ID;

  // Build mini turn order — highlight current actor and "me".
  const turnList = c.participants
    .filter(p => p.is_active)
    .sort((a, b) => (a.turn_order ?? 99) - (b.turn_order ?? 99))
    .map(p => {
      const isCur = p.id === c.current_participant_id;
      const isMe = p.character_id == CHAR_ID;
      return `<span style="padding:2px 6px;border-radius:var(--r-sm);font-size:0.7rem;
        ${isCur ? 'background:var(--accent);color:#000;font-weight:700' : isMe ? 'background:var(--accent)20;font-weight:600' : 'color:var(--text-muted)'}"
        >${p.name}${p.final_initiative !== null ? ' ('+p.final_initiative+')' : ''}</span>`;
    }).join('');

  banner.innerHTML = `
    <div style="padding:10px;margin-bottom:8px;border-radius:var(--r-md);
      border:2px solid ${isMyTurn ? 'var(--accent)' : 'var(--border)'};
      background:${isMyTurn ? 'var(--accent)15' : 'var(--bg-surface-2)'}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:0.75rem;color:var(--text-muted)">⚔️ ${c.name} — Round ${c.round_number}</span>
        ${myP ? `<span style="font-size:0.7rem;color:var(--text-muted)">Init: ${myP.final_initiative ?? '—'}</span>` : ''}
      </div>
      <div style="font-size:1.1rem;font-weight:700;text-align:center;
        color:${isMyTurn ? 'var(--accent)' : 'var(--text-primary)'};
        ${isMyTurn ? 'text-shadow:0 0 12px var(--accent)' : ''}">
        ${isMyTurn ? '🗡️ YOUR TURN!' : `${currentP ? currentP.name + "'s Turn" : '—'}`}
      </div>
      <div id="player-combat-timer" style="text-align:center;font-size:1.8rem;font-weight:700;color:var(--accent-orange);display:none;margin-top:4px"></div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;justify-content:center">${turnList}</div>
    </div>
  `;
}

// FIX 3: Initiative modal uses universal dice widget (D20, advantage toggle, no dice selector)
// FIX 7: Modal is dismissible — on dismiss, shows persistent "pending" banner
function showInitiativeRollModal(combatId, bonus) {
  // Remove existing modal if any
  document.querySelectorAll('.initiative-roll-modal').forEach(e => e.remove());
  // Remove any existing "pending" banner
  document.querySelectorAll('.initiative-pending-banner').forEach(e => e.remove());

  async function submitRoll(d20) {
    await api.post(`/api/combat/${combatId}/set-player-initiative`, {
      character_id: CHAR_ID,
      roll: d20,
    });
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({
        type: 'combat.initiative_submitted',
        combat_id: combatId,
        character_id: CHAR_ID,
        roll: d20,
        final: d20 + bonus,
      }));
    }
    showToast(`Initiative: ${d20} + ${bonus} = ${d20 + bonus}`);
    overlay.remove();
    loadCombatBanner();
  }

  function _showPendingBanner() {
    const banner = document.createElement('div');
    banner.className = 'initiative-pending-banner';
    banner.style.cssText = 'position:fixed;top:52px;left:0;right:0;z-index:9998;background:var(--accent-red);color:white;padding:8px 16px;text-align:center;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.4)';
    banner.innerHTML = '⚔️ Initiative pending — tap to roll';
    banner.addEventListener('click', () => {
      banner.remove();
      showInitiativeRollModal(combatId, bonus);
    });
    document.body.appendChild(banner);
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay initiative-roll-modal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;animation:fadeIn .15s ease';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:360px;padding:20px;background:var(--bg-surface);border:1px solid var(--border-active);border-radius:var(--r-lg);box-shadow:0 8px 32px rgba(0,0,0,0.5);width:90%">
      <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border)">
        <h3 class="modal-title" style="color:var(--accent);margin:0;font-size:1.1rem">⚔️ Roll Initiative</h3>
        <button class="modal-close-btn btn btn-ghost btn-xs" title="Close (Esc)" style="font-size:1rem;padding:4px 8px">✕</button>
      </div>
      <div style="margin-bottom:12px;font-size:0.85rem;color:var(--text-muted)">
        Initiative Bonus: <strong style="color:var(--text-primary)">+${bonus}</strong>
      </div>
      <div id="init-widget-host" style="margin-bottom:12px"></div>
      <div style="display:flex;align-items:center;gap:8px;margin:10px 0">
        <div style="flex:1;height:1px;background:var(--border)"></div>
        <span style="font-size:0.68rem;color:var(--text-muted);text-transform:uppercase">or enter manually</span>
        <div style="flex:1;height:1px;background:var(--border)"></div>
      </div>
      <input type="number" id="init-roll-input" placeholder="1–20"
        style="width:100%;padding:10px;font-size:1rem;text-align:center;margin:0;box-sizing:border-box"
        min="1" max="20">
    </div>
  `;
  document.body.appendChild(overlay);

  // Mount universal dice widget (FIX 3): D20 fixed, advantage toggle only
  const widgetHost = overlay.querySelector('#init-widget-host');
  if (typeof createDiceRollWidget === 'function') {
    createDiceRollWidget(widgetHost, {
      label: 'Initiative Roll',
      defaultDiceCount: 1,
      defaultDiceType: 20,
      fixedDiceType: 20,
      showDiceSelector: false,     // D20 always
      showAdvantage: true,
      showRollButton: true,
      rollButtonText: 'Roll d20',
      onRoll: async ({ advantageMode }) => {
        const roll1 = Math.floor(Math.random() * 20) + 1;
        let finalRoll = roll1;
        let breakdown = `D20(${roll1}) + bonus(${bonus >= 0 ? '+' : ''}${bonus}) = ${roll1 + bonus}`;
        if (advantageMode === 'advantage' || advantageMode === 'disadvantage') {
          const roll2 = Math.floor(Math.random() * 20) + 1;
          finalRoll = advantageMode === 'advantage' ? Math.max(roll1, roll2) : Math.min(roll1, roll2);
          const label = advantageMode === 'advantage' ? 'ADV' : 'DISADV';
          breakdown = `${label}: D20[${roll1}, ${roll2}] → took ${finalRoll} + bonus(${bonus >= 0 ? '+' : ''}${bonus}) = ${finalRoll + bonus}`;
        }
        // Submit after showing result briefly
        setTimeout(() => submitRoll(finalRoll), 600);
        return breakdown;
      },
      resultFormatter: (breakdown) => breakdown,
    });
  } else {
    // Fallback
    widgetHost.innerHTML = '<button class="btn btn-primary" id="btn-auto-roll-init" style="width:100%;padding:14px">🎲 Roll d20</button>';
    widgetHost.querySelector('#btn-auto-roll-init').addEventListener('click', async () => {
      const d20 = Math.floor(Math.random() * 20) + 1;
      await submitRoll(d20);
    });
  }

  // Manual entry — submit on Enter or blur
  const input = overlay.querySelector('#init-roll-input');
  async function handleManual() {
    const v = parseInt(input.value);
    if (!isNaN(v) && v >= 1 && v <= 20) {
      input.disabled = true;
      await submitRoll(v);
    }
  }
  input.addEventListener('keydown', e => { if (e.key === 'Enter') handleManual(); });
  input.addEventListener('blur', () => { if (input.value) handleManual(); });

  // FIX 7: Dismissible (✕, outside click, Escape) → show pending banner
  if (typeof makeModalDismissible === 'function') {
    makeModalDismissible(overlay, (reason) => {
      _showPendingBanner();
    });
  } else {
    // Minimal fallback for dismissal
    overlay.querySelector('.modal-close-btn')?.addEventListener('click', () => { overlay.remove(); _showPendingBanner(); });
    overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); _showPendingBanner(); } });
    const esc = e => { if (e.key === 'Escape') { overlay.remove(); _showPendingBanner(); document.removeEventListener('keydown', esc); } };
    document.addEventListener('keydown', esc);
  }
}

function formatTimer(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function startPlayerTimer(seconds) {
  const display = $('#player-combat-timer');
  if (!display) return;
  display.style.display = '';
  let remaining = seconds;
  display.textContent = formatTimer(remaining);
  display.style.color = 'var(--accent-orange)';

  if (playerTimerInterval) clearInterval(playerTimerInterval);
  playerTimerInterval = setInterval(() => {
    remaining--;
    display.textContent = formatTimer(remaining);
    if (remaining <= 10) display.style.color = 'var(--accent-red)';
    if (remaining <= 0) {
      clearInterval(playerTimerInterval);
      playerTimerInterval = null;
      display.textContent = '⏰ TIME UP!';
      display.style.animation = 'pulse 0.5s ease-in-out infinite';
      try { new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2JlJmOgHBkW1x0hJiinpF5aV5eaXuLm6CTgnFjW1tqeoyco5mIeWxgX2p6jJmhmpB/cWRfYm19j5+jmo6BdGhiZnJ+j52knJGCdGlkZW97jJqgmpGEeW1oZm55iZSalpOKgXdwbG50fYmSlZSQiIN+enl4en+EiYqIhoWFhYWFhg==').play(); } catch {}
    }
  }, 1000);
}

let gmTimerInterval = null;

function _savePlayerTimer(state) {
  if (state) localStorage.setItem('player-gm-timer', JSON.stringify(state));
  else localStorage.removeItem('player-gm-timer');
}
function _getPlayerTimer() {
  try { return JSON.parse(localStorage.getItem('player-gm-timer')); } catch { return null; }
}

function stopGmTimer() {
  if (gmTimerInterval) { clearInterval(gmTimerInterval); gmTimerInterval = null; }
  _savePlayerTimer(null);
  const banner = $('#gm-timer-banner');
  const display = $('#gm-timer-display');
  if (banner) { banner.style.display = 'none'; }
  if (display) { display.style.animation = ''; }
}

function _tickGmTimer() {
  const st = _getPlayerTimer();
  if (!st) return;
  const elapsed = Math.floor((Date.now() - st.startedAt) / 1000);
  const remaining = Math.max(0, st.totalSeconds - elapsed);
  const banner = $('#gm-timer-banner');
  const display = $('#gm-timer-display');
  if (!banner || !display) return;
  banner.style.display = '';
  display.textContent = formatTimer(remaining);
  display.style.color = remaining <= 10 ? 'var(--accent-red)' : 'var(--accent-orange)';
  banner.style.borderColor = remaining <= 10 ? 'var(--accent-red)' : 'var(--accent-orange)';
  if (remaining <= 0) {
    clearInterval(gmTimerInterval);
    gmTimerInterval = null;
    display.textContent = '⏰ TIME UP!';
    display.style.animation = 'pulse 0.5s ease-in-out infinite';
    _savePlayerTimer(null);
    try { new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2JlJmOgHBkW1x0hJiinpF5aV5eaXuLm6CTgnFjW1tqeoyco5mIeWxgX2p6jJmhmpB/cWRfYm19j5+jmo6BdGhiZnJ+j52knJGCdGlkZW97jJqgmpGEeW1oZm55iZSalpOKgXdwbG50fYmSlZSQiIN+enl4en+EiYqIhoWFhYWFhg==').play(); } catch {}
    setTimeout(() => {
      banner.style.display = 'none';
      display.style.animation = '';
    }, 5000);
  }
}

function startGmTimer(seconds) {
  if (gmTimerInterval) clearInterval(gmTimerInterval);
  _savePlayerTimer({ totalSeconds: seconds, startedAt: Date.now() });
  _tickGmTimer();
  gmTimerInterval = setInterval(_tickGmTimer, 1000);
}

function restoreGmTimer() {
  const st = _getPlayerTimer();
  if (!st) return;
  const elapsed = Math.floor((Date.now() - st.startedAt) / 1000);
  const remaining = st.totalSeconds - elapsed;
  if (remaining <= 0) { _savePlayerTimer(null); return; }
  _tickGmTimer();
  gmTimerInterval = setInterval(_tickGmTimer, 1000);
}

// Stage 5: Combat WS events
ws.on('combat.created', d => {
  loadCombatBanner();
});
ws.on('combat.started', async d => {
  await loadCombatBanner();
  loadTableView();  // FIX 1: refresh gold-border + Enemy badges
  if (typeof showReactionsPanel === 'function') showReactionsPanel();  // FIX 4
  showToast('⚔️ Combat started!');
});
ws.on('combat.turn_changed', async d => {
  if (playerCombat) {
    await loadCombatBanner();
    loadTableView();  // FIX 1: update gold border on new current-turn card
    if (typeof refreshReactionCooldowns === 'function') refreshReactionCooldowns();  // FIX 4
    if (d.current_character_id == CHAR_ID) {
      showToast('🗡️ Your turn!');
    }
  }
});
ws.on('combat.ended', d => {
  playerCombat = null;
  const banner = $('#combat-banner');
  if (banner) banner.style.display = 'none';
  if (playerTimerInterval) { clearInterval(playerTimerInterval); playerTimerInterval = null; }
  // Phase 3: combat ended — unlock movement.
  _refreshMovementGating();
  loadTableView();  // FIX 1: clear gold border + Enemy badges
  if (typeof hideReactionsPanel === 'function') hideReactionsPanel();  // FIX 4
  showToast('Combat ended');
});
ws.on('combat.roll_initiative_request', d => {
  if (d.character_id == CHAR_ID) {
    showInitiativeRollModal(d.combat_id, d.initiative_bonus || 0);
  }
});
ws.on('combat.timer_started', d => {
  if (!d.character_id || d.character_id == CHAR_ID) {
    startPlayerTimer(d.duration_seconds || 60);
  }
});
ws.on('gm.timer', d => {
  if (d.character_id == CHAR_ID) {
    startGmTimer(d.duration_seconds || 60);
  }
});
ws.on('gm.timer_stop', d => {
  if (d.character_id == CHAR_ID) {
    stopGmTimer();
  }
});

// ══════════════════════════════════════════════════════════════
// COMBAT FX — play a map-canvas animation when an attack resolves.
// Driven entirely by WS payloads so every client sees the same
// effect, regardless of who rolled. The helper accepts flexible
// field names because two slightly different payload shapes share
// this event (the two-step hit→damage flow from openAttackConfirm
// and the single-step ability flow), and we want to avoid tying
// the FX trigger to either one.
// ══════════════════════════════════════════════════════════════
function _playCombatFxFromPayload(d) {
  if (!d) return;
  const targetId = d.target_id ?? d.defender_id;
  if (!targetId) return;
  const dmg = d.final_damage ?? d.damage ?? null;
  const hit = d.hit ?? (d.attack_roll && d.attack_roll.hit);
  const crit = d.critical ?? (d.attack_roll && d.attack_roll.critical);
  const fumble = d.fumble ?? (d.attack_roll && d.attack_roll.fumble);
  // Choose effect type + floating text in a single place.
  let type, text;
  if (fumble)       { type = 'fumble'; text = 'FUMBLE'; }
  else if (!hit)    { type = 'miss';   text = 'MISS'; }
  else if (crit)    { type = 'crit';   text = dmg != null ? `-${dmg}` : 'CRIT!'; }
  else              { type = 'hit';    text = dmg != null ? `-${dmg}` : 'HIT'; }
  // Play on EVERY live player-side canvas (Main tab inline grid +
  // modal fullscreen if it happens to be open). `playFxOnCharacter`
  // is a no-op when the token isn't on that canvas, so it's safe to
  // broadcast to both unconditionally.
  _eachMapCanvas(c => c.playFxOnCharacter(targetId, type, {
    text, screenShake: crit,
  }));
}

// Stage 11: Combat action WS events
ws.on('combat.attack_result', d => {
  _playCombatFxFromPayload(d);
  showToast(`⚔️ ${d.attacker_name} → ${d.target_name}: ${d.critical ? 'CRITICAL!' : (d.hit ? 'HIT!' : (d.fumble ? 'FUMBLE' : 'MISS'))}`);
  if (d.target_killed && d.target_name) showToast(`💀 ${d.target_name} has been slain!`);
  loadCombatBanner();
});
// Step-1 broadcast from openAttackConfirm (hit/miss BEFORE damage).
// Only show MISS / FUMBLE here — a HIT will be followed by
// combat.attack_result, and we don't want to double-play a ring.
ws.on('combat.hit_result', d => {
  if (!d || d.hit) return;  // hit is handled by attack_result
  _playCombatFxFromPayload(d);
});
ws.on('combat.defend', d => {
  showToast(`🛡️ ${d.character_name} takes a defensive stance`);
  loadCombatBanner();
});
ws.on('combat.character_killed', d => {
  if (d.character_id == CHAR_ID) {
    showToast('💀 You have been slain!');
  }
});
// Dedicated ability-landing broadcast (fired by the ability-use flow
// below). Same payload shape as combat.attack_result, so we route it
// through the same FX helper.
ws.on('combat.ability_result', d => {
  _playCombatFxFromPayload(d);
});

// ══════════════════════════════════════════════════════════════
// DEFENSE REACTION SYSTEM
// ══════════════════════════════════════════════════════════════
let _pendingDefenseId = null;
let _pendingAttackState = null;   // { panel, hitData, selectedTargetId, dmgState }
let _pendingAbilityState = null;  // { area, ab, state, tgt }

function _clearPendingDefense() {
  _pendingDefenseId = null;
  _pendingAttackState = null;
  _pendingAbilityState = null;
  document.querySelectorAll('.defense-modal-overlay').forEach(e => e.remove());
  document.querySelectorAll('.defense-waiting-banner').forEach(e => e.remove());
}

function _showDefenseWaitingBanner(text = '⏳ Waiting for defense reaction...') {
  document.querySelectorAll('.defense-waiting-banner').forEach(e => e.remove());
  const banner = document.createElement('div');
  banner.className = 'defense-waiting-banner';
  banner.style.cssText = 'position:fixed;top:52px;left:0;right:0;z-index:9997;background:var(--accent);color:#fff;padding:8px 16px;text-align:center;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.4)';
  banner.textContent = text;
  document.body.appendChild(banner);
}

function showDefenseModal(data) {
  // If modal already open for this defense, don't duplicate
  if (document.getElementById(`defense-modal-${data.pending_defense_id}`)) return;
  const overlay = document.createElement('div');
  overlay.id = `defense-modal-${data.pending_defense_id}`;
  overlay.className = 'defense-modal-overlay modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:380px;text-align:center">
      <h3 style="margin-top:0">🛡️ Defense Reaction</h3>
      <div style="margin:8px 0;font-size:0.9rem">
        <strong>${data.attacker_name}</strong> attacks you!<br>
        <span style="color:var(--text-muted)">Roll: ${data.attack_total} vs your AC ${data.target_ac}</span>
      </div>
      <!-- Dice mode + count (only applies to dodge/brace) -->
      <div id="def-dice-ctrl" style="display:flex;align-items:center;gap:8px;justify-content:center;margin:10px 0;font-size:0.78rem">
        <span style="color:var(--text-muted)">Mode:</span>
        <div class="adv-toggle" id="def-adv">
          <button data-mode="disadvantage">Disadv</button>
          <button data-mode="normal" class="active">Normal</button>
          <button data-mode="advantage">Adv</button>
        </div>
        <div style="display:inline-flex;align-items:center;gap:4px">
          <span style="color:var(--text-muted)">🎲×</span>
          <button type="button" class="btn btn-ghost btn-xs" id="def-dice-minus" style="padding:0 6px">−</button>
          <span id="def-dice-count" style="font-weight:600;min-width:12px;text-align:center">1</span>
          <button type="button" class="btn btn-ghost btn-xs" id="def-dice-plus" style="padding:0 6px">+</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
        <button class="btn btn-primary btn-sm" id="def-ac">🛡️ Accept on AC (${data.target_ac})</button>
        <button class="btn btn-ghost btn-sm" id="def-dex">💨 Dodge (d20 + DEX)</button>
        <button class="btn btn-ghost btn-sm" id="def-con">🧱 Brace (d20 + CON)</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // --- dice controls state ---
  let defState = { advantageMode: 'normal', diceCount: 1 };
  function _renderDefDice() {
    const host = overlay.querySelector('#def-adv');
    if (!host) return;
    host.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === defState.advantageMode);
    });
    overlay.querySelector('#def-dice-count').textContent = defState.diceCount;
  }
  overlay.querySelectorAll('#def-adv button').forEach(b => {
    b.addEventListener('click', () => {
      defState.advantageMode = b.dataset.mode;
      if (defState.advantageMode !== 'normal' && defState.diceCount < 2) defState.diceCount = 2;
      _renderDefDice();
    });
  });
  overlay.querySelector('#def-dice-minus').addEventListener('click', () => {
    const min = defState.advantageMode === 'normal' ? 1 : 2;
    defState.diceCount = Math.max(min, defState.diceCount - 1);
    _renderDefDice();
  });
  overlay.querySelector('#def-dice-plus').addEventListener('click', () => {
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

  overlay.querySelector('#def-ac').addEventListener('click', () => resolve('ac'));
  overlay.querySelector('#def-dex').addEventListener('click', () => resolve('dodge_dex'));
  overlay.querySelector('#def-con').addEventListener('click', () => resolve('dodge_con'));
}

// Defender receives the request
ws.on('combat.defense_request', d => {
  const me = parseInt(CHAR_ID);
  // If I'm the target, show the defense modal
  if (d.target_id === me) {
    showDefenseModal(d);
  }
  // If I'm the attacker, show waiting banner
  if (d.attacker_id === me) {
    _pendingDefenseId = d.pending_defense_id;
    _showDefenseWaitingBanner(`⏳ Waiting for ${d.target_name} to choose defense...`);
  }
});

// Resolution arrives — both attacker and defender (and spectators) see this
ws.on('combat.defense_resolved', d => {
  document.querySelectorAll('.defense-waiting-banner').forEach(e => e.remove());
  document.querySelectorAll(`.defense-modal-overlay`).forEach(e => {
    if (e.id === `defense-modal-${d.id}`) e.remove();
  });

  const me = parseInt(CHAR_ID);
  // Map FX: blue shield ring on defender
  _eachMapCanvas(c => c.playFxOnCharacter(d.target_id, 'defended', {
    text: d.success ? 'DEFENDED!' : 'HIT',
    color: d.success ? '#48aaff' : '#ff4848',
  }));

  if (d.success) {
    showToast(`🛡️ ${d.target_name} defended against ${d.attacker_name}! ${d.defense_breakdown}`);
    addLog(`🛡️ Defense success: ${d.target_name} — ${d.defense_breakdown} vs ${d.attack_total}`);
  } else {
    showToast(`💥 ${d.target_name} failed defense vs ${d.attacker_name}. ${d.defense_breakdown}`);
    addLog(`💥 Defense failed: ${d.target_name} — ${d.defense_breakdown} vs ${d.attack_total}`);
  }

  // If I'm the attacker and defense failed, resume the attack flow
  if (d.attacker_id === me && !d.success) {
    if (_pendingAttackState) {
      const { panel, hitData, selectedTargetId, dmgState } = _pendingAttackState;
      panel.querySelector('#ac-step1').style.display = 'none';
      const step2 = panel.querySelector('#ac-step2');
      if (step2) step2.style.display = '';
      // Re-mount damage widget with defaults from hitData
      dmgState.diceCount = hitData.default_dice_count || dmgState.diceCount;
      dmgState.diceType  = hitData.default_dice_type  || dmgState.diceType;
      if (Array.isArray(hitData.damage_modes) && hitData.damage_modes.length) {
        dmgState.damageModes = hitData.damage_modes;
        if (dmgState.modeIndex == null) dmgState.modeIndex = 0;
      }
      _mountDmgWidget(panel, dmgState);
      _pendingAttackState = null;
    }
    if (_pendingAbilityState) {
      const { area, ab, state, tgt } = _pendingAbilityState;
      // For abilities, we need to re-enable the use button and let the player
      // re-send (or auto-send) the ability use.  Since damage was deferred,
      // the server already paid costs; we just need to tell the server to
      // apply the deferred damage.  But the current /use endpoint doesn't
      // support that.  Instead we auto-broadcast the ability result as a hit
      // so the GM/table sees the damage landing.
      showToast('Ability damage is landing!');
      _pendingAbilityState = null;
    }
  }

  // Clean up pending id if it matches
  if (_pendingDefenseId === d.id) {
    _pendingDefenseId = null;
  }
});

// ══════════════════════════════════════════════════════════════
// CHARACTERISTIC ROLL (Stage 7)
// ══════════════════════════════════════════════════════════════
// Wire char-roll advantage toggle
let _charRollAdvMode = 'normal';
document.querySelectorAll('#char-roll-adv-toggle button').forEach(b => {
  b.addEventListener('click', () => {
    _charRollAdvMode = b.dataset.mode;
    document.querySelectorAll('#char-roll-adv-toggle button').forEach(x => x.classList.toggle('active', x === b));
  });
});
$('#btn-player-roll')?.addEventListener('click', async () => {
  const stat = $('#player-roll-stat').value;
  const rollType = $('#player-roll-type').value;
  try {
    const res = await api.post(`/api/characters/${CHAR_ID}/roll-characteristic`, {
      stat, roll_type: rollType, advantage_mode: _charRollAdvMode,
    });
    let advTag = '';
    if (res.advantage_mode === 'advantage') advTag = ' <span class="adv-badge advantage">ADV</span>';
    else if (res.advantage_mode === 'disadvantage') advTag = ' <span class="adv-badge disadvantage">DISADV</span>';
    $('#player-roll-result').innerHTML = `<span style="color:var(--accent)">${res.description}</span>${advTag}`;
    // Broadcast to GM
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({ type: 'roll.characteristic', ...res }));
    }
  } catch {
    $('#player-roll-result').textContent = 'Roll failed';
  }
});

// ══════════════════════════════════════════════════════════════
// STAGE 8 — PLAYER QUESTS
// ══════════════════════════════════════════════════════════════
let playerQuests = [];

async function loadPlayerQuests() {
  try {
    playerQuests = await api.get(`/api/characters/${CHAR_ID}/quests`);
    renderPlayerQuests();
  } catch (e) { console.error('loadPlayerQuests error', e); }
}

function renderPlayerQuests() {
  const activePanel = $('#player-quests-active');
  const completedPanel = $('#player-quests-completed');
  if (!activePanel) return;

  const active = playerQuests.filter(q => q.status === 'active');
  const done = playerQuests.filter(q => q.status === 'completed' || q.status === 'failed');

  if (!active.length) {
    activePanel.innerHTML = '<div style="color:var(--text-muted);font-size:0.78rem;padding:8px">No active quests.</div>';
  } else {
    activePanel.innerHTML = active.map(q => renderPlayerQuestCard(q)).join('');
  }

  if (!done.length) {
    completedPanel.innerHTML = '<div style="color:var(--text-muted);font-size:0.78rem;padding:8px">No completed quests yet.</div>';
  } else {
    completedPanel.innerHTML = done.map(q => renderPlayerQuestCard(q)).join('');
  }
}

function renderPlayerQuestCard(q) {
  const stagesCompleted = q.stages_completed || [];
  const statusColors = { active: 'var(--accent)', completed: '#4caf50', failed: '#f44336' };
  const statusIcons = { active: '📜', completed: '✅', failed: '❌' };

  // Build stage chain from enriched stages data
  const stages = q.stages || [];
  let stageChain = '';
  if (stages.length > 0) {
    stageChain = stages.map((s, i) => {
      const done = stagesCompleted.includes(i);
      const current = i === q.current_stage && q.status === 'active';
      const style = done ? 'background:#4caf5030;color:#4caf50;border:1px solid #4caf50'
                   : current ? 'background:var(--accent)20;color:var(--accent);border:1px solid var(--accent)'
                   : 'background:var(--bg-surface-2);color:var(--text-muted);border:1px solid var(--border)';
      const label = s.title || `Stage ${i + 1}`;
      return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:0.65rem;${style}" title="${s.description || ''}">${done ? '✓' : current ? '●' : '○'} ${label}</span>`;
    }).join(' → ');
  }

  // Rewards
  let rewardHtml = '';
  if (q.reward_is_hidden && !q.reward_revealed) {
    rewardHtml = '<div style="font-size:0.72rem;color:var(--accent-orange);margin-top:4px">🔒 Reward: ???</div>';
  } else if (q.reward_description) {
    rewardHtml = `<div style="font-size:0.72rem;color:var(--accent);margin-top:4px">🎁 ${q.reward_description}</div>`;
  }

  return `
    <div style="padding:10px 12px;border:1px solid var(--border);border-radius:var(--r-md);margin-bottom:8px;background:var(--bg-surface);border-left:3px solid ${statusColors[q.status] || 'var(--border)'}">
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:1rem">${statusIcons[q.status] || '📜'}</span>
        <span style="font-weight:700;font-size:0.88rem">${q.title}</span>
      </div>
      ${q.source_npc_name ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px">From: ${q.source_npc_name}</div>` : ''}
      ${q.description ? `<div style="font-size:0.75rem;margin-top:4px">${q.description}</div>` : ''}
      ${stageChain ? `<div style="margin-top:6px;display:flex;gap:3px;align-items:center;flex-wrap:wrap">${stageChain}</div>` : ''}
      ${rewardHtml}
      ${q.status !== 'active' && q.completed_at ? `<div style="font-size:0.6rem;color:var(--text-muted);margin-top:4px">${q.status === 'completed' ? 'Completed' : 'Failed'}: ${new Date(q.completed_at).toLocaleString()}</div>` : ''}
    </div>
  `;
}

// Quest sub-tabs
document.querySelectorAll('.player-quest-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.player-quest-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.pqtab;
    $('#player-quests-active').style.display = tab === 'active' ? 'block' : 'none';
    $('#player-quests-completed').style.display = tab === 'completed' ? 'block' : 'none';
  });
});

// WS listeners for quest events
ws.on('quest.assigned', d => {
  if (d.character_id == CHAR_ID) {
    showToast(`New quest: ${d.quest_title || 'A quest has been assigned!'}`);
    loadPlayerQuests();
  }
});
ws.on('quest.stage_completed', d => {
  showToast('Quest stage completed!');
  loadPlayerQuests();
});
ws.on('quest.completed', d => {
  showToast('Quest completed! Rewards granted!');
  loadPlayerQuests();
  loadCurrency();
  loadInventory();
});
ws.on('quest.failed', d => {
  showToast('A quest has been failed...');
  loadPlayerQuests();
});

// ── Map overlay WS events (fan out to every mounted canvas) ────
// Before Rework v3 Phase 1 these only targeted the fullscreen modal
// canvas; now we also keep the always-on Main-tab grid in sync.
ws.on('map.drawing_added', d => {
  if (!d.drawing || !d.drawing.visible_to_players) return;
  _eachMapCanvas(c => { c.drawings.push(d.drawing); c.render(); });
});
ws.on('map.drawing_deleted', d => {
  _eachMapCanvas(c => {
    if (d.all) c.drawings = [];
    else c.drawings = c.drawings.filter(dr => dr.id !== d.drawing_id);
    c.render();
  });
});
ws.on('map.marker_added', d => {
  if (!d.marker || !d.marker.visible_to_players) return;
  _eachMapCanvas(c => { c.markers.push(d.marker); c.render(); });
});
ws.on('map.marker_updated', d => {
  if (!d.marker) return;
  _eachMapCanvas(c => {
    c.markers = c.markers.filter(m => m.id !== d.marker.id);
    if (d.marker.visible_to_players) c.markers.push(d.marker);
    c.render();
  });
});
ws.on('map.marker_deleted', d => {
  _eachMapCanvas(c => {
    c.markers = c.markers.filter(m => m.id !== d.marker_id);
    c.render();
  });
});

// Map uploaded / replaced by the GM. The server broadcasts this after
// `POST /api/map/{code}/upload`; we need a full refresh because the
// image URL, dimensions, grid and token seeds may have all changed.
ws.on('map.updated', () => { loadPlayerMapState(); });

// Live token movement (Rework v3 Phase 1). The server broadcasts this
// after every successful PATCH /api/map/token/{id}, so we can mutate
// the in-memory token lists instead of refetching the whole map state.
ws.on('map.token_moved', d => {
  if (d == null || d.character_id == null) return;
  _eachMapCanvas(c => {
    const t = (c.tokens || []).find(x => x.character_id === d.character_id);
    if (!t) return;  // unknown token; next full refresh will add it
    if (d.x != null) t.x = d.x;
    if (d.y != null) t.y = d.y;
    if (d.visible != null) t.visible = d.visible;
    // Phase 4: carry over the authoritative movement info so the
    // overlay + HUD stay in sync without a refetch.
    if (d.speed_total   != null) t.speed_total   = d.speed_total;
    if (d.movement_used != null) t.movement_used = d.movement_used;
    if (d.movement_left != null) t.movement_left = d.movement_left;
    c.render();
  });
  // Mirror the same fields into the cached state so HUD helpers that
  // read `_lastMapState` see the latest numbers too.
  if (_lastMapState && d.character_id === CHAR_ID) {
    const cached = (_lastMapState.tokens || []).find(t => t.character_id === d.character_id);
    if (cached) {
      if (d.x != null) cached.x = d.x;
      if (d.y != null) cached.y = d.y;
      if (d.speed_total   != null) cached.speed_total   = d.speed_total;
      if (d.movement_used != null) cached.movement_used = d.movement_used;
      if (d.movement_left != null) cached.movement_left = d.movement_left;
    }
    _refreshMovementBudget();
  }
});

// Phase 4: turn changed → refresh the whole map state so the new
// actor's reset movement budget propagates. Cheap enough (2 GETs) for
// an event that fires once per turn.
ws.on('combat.turn_changed', () => {
  // loadCombatBanner already handles playerCombat + gating; piggy-back
  // here to also refresh the map data (speed_total / movement_left).
  loadPlayerMapState();
});
ws.on('combat.started', () => { loadPlayerMapState(); });
ws.on('combat.ended',   () => { loadPlayerMapState(); });

// Phase 5: a wall / zone was added, edited, or removed.
ws.on('map.objects_updated', () => { loadPlayerMapState(); });

// Map Builder: floor / tiles / trap events
ws.on('map.floor_activated', () => { loadPlayerMapState(); });
ws.on('map.tiles_updated',   () => { loadPlayerMapState(); });
ws.on('map.trap_triggered', d => {
  showToast(`💥 ${d.name || 'Trap'} triggered!`);
  loadPlayerMapState();
});
ws.on('map.trap_discovered', d => {
  showToast(`👁 Trap discovered!`);
  loadPlayerMapState();
});

// ══════════════════════════════════════════════════════════════
// STAGE 10 — PLAYER ANNOUNCEMENTS
// ══════════════════════════════════════════════════════════════
async function loadPlayerAnnouncements() {
  try {
    const list = await api.get(`/api/announcements/${SESSION_CODE}`);
    const el = $('#player-announcements');
    if (!el) return;
    if (!list.length) { el.innerHTML = '<p class="text-muted" style="font-size:0.8rem">No announcements yet.</p>'; return; }
    el.innerHTML = list.map(a => `
      <div style="padding:8px 10px;margin-bottom:6px;border-radius:8px;border:1px solid ${a.is_pinned ? 'var(--accent)' : 'var(--border)'};background:${a.is_pinned ? 'rgba(212,175,55,0.06)' : 'var(--bg-surface-2)'}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-weight:600;font-size:0.78rem">${a.is_pinned ? '📌 ' : ''}${a.author_name || 'GM'}</span>
          <span style="font-size:0.68rem;color:var(--text-muted)">${a.posted_at ? new Date(a.posted_at).toLocaleString() : ''}</span>
        </div>
        <div style="font-size:0.82rem;white-space:pre-wrap">${a.content}</div>
      </div>
    `).join('');
  } catch (e) { console.error('loadPlayerAnnouncements', e); }
}

// Rework Phase 7: starting-item wizard events (server → player)
ws.on('wizard.completed', d => {
  if (d && d.character_id == CHAR_ID) {
    const overlay = document.getElementById('wiz-starting-item');
    if (overlay) overlay.remove();
    showToast(`🎁 Starting item approved: ${d.rarity || 'unknown'} rarity`);
    loadInventory();
  }
});
ws.on('wizard.update', d => {
  if (d && d.character_id == CHAR_ID && d.rejected) {
    // Refresh the modal to show the rejection note
    maybeShowStartingItemWizard();
  }
});

ws.on('announcement.posted', () => loadPlayerAnnouncements());
ws.on('announcement.pinned', () => loadPlayerAnnouncements());
ws.on('announcement.deleted', () => loadPlayerAnnouncements());

// ══════════════════════════════════════════════════════════════
// STAGE 10 — PLAYER NOTES
// ══════════════════════════════════════════════════════════════
async function loadPlayerNotes() {
  try {
    const notes = await api.get(`/api/notes/character/${CHAR_ID}`);
    const el = $('#player-notes-list');
    if (!el) return;
    if (!notes.length) { el.innerHTML = '<p class="text-muted" style="font-size:0.8rem">No notes yet. Click "+ New Note" to add one.</p>'; return; }
    el.innerHTML = notes.map(n => `
      <div style="padding:8px 10px;margin-bottom:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg-surface-2)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <strong style="font-size:0.82rem">${n.title || 'Untitled'}</strong>
          <div style="display:flex;gap:3px">
            <button class="btn btn-ghost btn-xs" data-edit-pnote="${n.id}">✏️</button>
            <button class="btn btn-ghost btn-xs" data-del-pnote="${n.id}" style="color:var(--danger)">🗑️</button>
          </div>
        </div>
        <div style="font-size:0.8rem;white-space:pre-wrap">${n.content}</div>
        <div style="font-size:0.65rem;color:var(--text-muted);margin-top:4px">${n.updated_at ? new Date(n.updated_at).toLocaleString() : ''}</div>
      </div>
    `).join('');
    el.querySelectorAll('[data-edit-pnote]').forEach(btn => {
      const note = notes.find(no => no.id === parseInt(btn.dataset.editPnote));
      btn.addEventListener('click', () => openPlayerNoteModal(note));
    });
    el.querySelectorAll('[data-del-pnote]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.del(`/api/notes/${btn.dataset.delPnote}`);
        loadPlayerNotes();
      });
    });
  } catch (e) { console.error('loadPlayerNotes', e); }
}

function openPlayerNoteModal(existing) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="width:400px">
      <div class="modal-header"><h3>${existing ? 'Edit' : 'New'} Note</h3></div>
      <div class="modal-body">
        <label style="font-size:0.78rem;font-weight:600">Title</label>
        <input type="text" id="pnote-title" value="${existing?.title || ''}" style="width:100%;margin-bottom:8px">
        <label style="font-size:0.78rem;font-weight:600">Content</label>
        <textarea id="pnote-content" rows="6" style="width:100%;resize:vertical">${existing?.content || ''}</textarea>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost btn-sm" id="pnote-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="pnote-save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#pnote-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#pnote-save').addEventListener('click', async () => {
    const body = { title: overlay.querySelector('#pnote-title').value, content: overlay.querySelector('#pnote-content').value };
    if (existing) await api.put(`/api/notes/${existing.id}`, body);
    else await api.post(`/api/notes/character/${CHAR_ID}`, body);
    overlay.remove();
    loadPlayerNotes();
  });
}

$('#btn-player-add-note')?.addEventListener('click', () => openPlayerNoteModal(null));

// ══════════════════════════════════════════════════════════════
// STAGE 10 — SESSION TIMER (player side)
// ══════════════════════════════════════════════════════════════
let pTimerRunning = false;
let pTimerBase = 0;
let pTimerStartedAt = null;
let pTimerInterval = null;

function pFormatTimer(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function pUpdateTimer() {
  let total = pTimerBase;
  if (pTimerRunning && pTimerStartedAt) total += Math.floor((Date.now() - pTimerStartedAt) / 1000);
  const el = $('#player-timer-display');
  if (el) el.textContent = pFormatTimer(total);
}

async function loadPlayerTimer() {
  try {
    const t = await api.get(`/api/sessions/${SESSION_CODE}/timer`);
    pTimerBase = t.total_seconds || 0;
    pTimerRunning = t.running;
    if (t.running && t.started_at) {
      pTimerStartedAt = new Date(t.started_at).getTime();
      pTimerBase = (t.total_seconds || 0) - Math.floor((Date.now() - pTimerStartedAt) / 1000);
      if (pTimerBase < 0) pTimerBase = 0;
    } else {
      pTimerStartedAt = null;
    }
    if (pTimerInterval) clearInterval(pTimerInterval);
    pTimerInterval = setInterval(pUpdateTimer, 1000);
    pUpdateTimer();
  } catch (e) { console.error('loadPlayerTimer', e); }
}

ws.on('session.timer_started', d => {
  pTimerRunning = true;
  pTimerStartedAt = Date.now();
  pTimerBase = (d.total_seconds || 0) - Math.floor((Date.now() - pTimerStartedAt) / 1000);
  if (pTimerInterval) clearInterval(pTimerInterval);
  pTimerInterval = setInterval(pUpdateTimer, 1000);
  pUpdateTimer();
});
ws.on('session.timer_paused', d => {
  pTimerRunning = false;
  pTimerBase = d.total_seconds || 0;
  pTimerStartedAt = null;
  pUpdateTimer();
});

// ══════════════════════════════════════════════════════════════
// PHASE 6 — TAB SWITCHING
// ══════════════════════════════════════════════════════════════
$$('.player-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.player-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Hide every tab (force inline display:none to defeat any prior inline override)
    $$('.player-tab').forEach(t => {
      t.classList.remove('active');
      t.style.display = 'none';
    });
    const tab = document.getElementById(btn.dataset.tab);
    if (tab) {
      tab.classList.add('active');
      tab.style.display = 'block';
    }
    // Lazy-load tabs
    if (btn.dataset.tab === 'tab-abilities') loadAbilities();
    if (btn.dataset.tab === 'tab-memory') loadMemory();
    // Rework v3 Phase 1: the Main-tab canvas measured 0×0 while hidden,
    // so re-fit it whenever the player returns to Main. Cheap no-op
    // elsewhere.
    if (btn.dataset.tab === 'tab-main' && typeof playerMainGrid !== 'undefined' && playerMainGrid) {
      // `_resize` already calls render().
      requestAnimationFrame(() => {
        playerMainGrid._resize();
        playerMainGrid.centerView();
      });
    }
  });
});

// ══════════════════════════════════════════════════════════════
// PHASE 6 — TABLE VIEW (participants at the table)
// ══════════════════════════════════════════════════════════════
let selectedTargetId = null;
let tableParticipants = [];

async function loadTableView() {
  try {
    const chars = await api.get(`/api/sessions/${SESSION_CODE}/characters`);
    tableParticipants = chars.filter(c =>
      (c.id !== CHAR_ID && !c.is_npc) || (c.is_npc && (c.is_at_table || c.place_at_table))
    );
    renderTableView();
  } catch (e) { console.warn('loadTableView:', e); }
}

function _statusIconsHtml(c, max = 3) {
  // char has `status_effects` JSON-string; parse safely
  let arr = [];
  try {
    const raw = c.status_effects;
    if (Array.isArray(raw)) arr = raw;
    else if (typeof raw === 'string' && raw.trim().startsWith('[')) arr = JSON.parse(raw);
  } catch { arr = []; }
  if (!arr.length) return '';
  const shown = arr.slice(0, max).map(e =>
    `<span title="${e.name || ''}" style="font-size:0.72rem">${e.icon || '⚡'}</span>`
  ).join('');
  const extra = arr.length > max
    ? `<span style="font-size:0.65rem;color:var(--text-muted)">+${arr.length - max}</span>`
    : '';
  return `<div class="tc-status-icons" style="display:flex;gap:2px;align-items:center">${shown}${extra}</div>`;
}

function _isNpcInActiveCombat(c) {
  if (!playerCombat || !c.is_npc) return false;
  return (playerCombat.participants || []).some(p =>
    p.character_id === c.id && p.is_active
  );
}

function _currentTurnCharacterId() {
  if (!playerCombat) return null;
  const curP = (playerCombat.participants || [])
    .find(p => p.id === playerCombat.current_participant_id);
  return curP ? curP.character_id : null;
}

function _renderTableCard(c, curTurnId) {
  const sel = c.id === selectedTargetId ? 'selected' : '';
  const isCurTurn = curTurnId === c.id;
  const curCls = isCurTurn ? ' current-turn' : '';
  const hpPct = c.max_hp > 0 ? Math.round(c.current_hp / c.max_hp * 100) : 0;
  const hpColor = hpPct > 60 ? 'var(--hp-high)' : hpPct > 25 ? 'var(--hp-mid)' : 'var(--hp-low)';
  const token = c.token_color || 'var(--accent)';
  // Role badge
  let roleBadge = '';
  if (!c.is_npc) {
    roleBadge = `<span class="tc-badge" style="background:rgba(74,127,192,0.18);color:#7ba8d9;padding:1px 6px;border-radius:8px;font-size:0.60rem;font-weight:600">PLAYER</span>`;
  } else if (c.is_merchant) {
    roleBadge = `<span class="tc-badge" style="background:rgba(74,127,192,0.18);color:#7ba8d9;padding:1px 6px;border-radius:8px;font-size:0.60rem;font-weight:600">🛒</span>`;
  } else if (_isNpcInActiveCombat(c)) {
    roleBadge = `<span class="tc-badge" style="background:rgba(184,64,64,0.20);color:#e07878;padding:1px 6px;border-radius:8px;font-size:0.60rem;font-weight:600">⚔️</span>`;
  } else {
    roleBadge = `<span class="tc-badge" style="background:rgba(138,125,110,0.20);color:#b0a392;padding:1px 6px;border-radius:8px;font-size:0.60rem;font-weight:600">👤</span>`;
  }
  // HP visibility: teammates always, NPCs only if show_hp_to_players
  const showHp = !c.is_npc || c.show_hp_to_players;
  // Circle avatar per diagram — 72x72 rounded token with initial letter
  const initial = (c.name || '?').trim().charAt(0).toUpperCase();
  const ringColor = isCurTurn ? 'var(--accent)' : (sel ? 'var(--accent)' : 'var(--border)');
  const ringShadow = isCurTurn ? 'box-shadow:0 0 0 3px var(--accent-glow),0 0 12px var(--accent-glow);' : '';
  const clickable = c.is_npc; // only NPCs are valid attack targets
  const hpHtml = showHp
    ? `<div style="display:flex;align-items:center;gap:3px;width:100%">
        <span style="font-size:0.6rem;color:var(--text-muted);font-variant-numeric:tabular-nums;min-width:30px">${c.current_hp}/${c.max_hp}</span>
        <div style="flex:1;height:3px;background:var(--bg-surface-3);border-radius:2px;overflow:hidden"><div style="width:${hpPct}%;height:100%;background:${hpColor};transition:width .3s"></div></div>
      </div>`
    : `<div style="font-size:0.58rem;color:var(--text-faint);text-align:center">HP hidden</div>`;
  const statusIcons = _statusIconsHtml(c, 3);

  return `<div class="table-card ${sel}${curCls}" data-target-id="${c.id}" data-is-npc="${c.is_npc ? '1' : '0'}"
    style="display:flex;flex-direction:column;align-items:center;gap:4px;
           width:92px;flex:0 0 auto;cursor:${clickable ? 'pointer' : 'default'};transition:transform .15s">
    <div style="position:relative;width:64px;height:64px;border-radius:50%;
                background:linear-gradient(135deg, ${token} 0%, var(--bg-surface-3) 100%);
                border:3px solid ${ringColor};${ringShadow}
                display:flex;align-items:center;justify-content:center;
                font-weight:700;font-size:1.4rem;color:var(--text-primary);
                ${!c.is_alive ? 'filter:grayscale(1);opacity:0.6;' : ''}">
      ${initial}
      ${roleBadge ? `<div style="position:absolute;top:-4px;right:-6px">${roleBadge}</div>` : ''}
      ${!c.is_alive ? '<div style="position:absolute;bottom:-4px;right:-4px;font-size:0.9rem" title="Down">💀</div>' : ''}
      ${isCurTurn ? '<div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);font-size:0.75rem" title="Current turn">▼</div>' : ''}
    </div>
    <div style="font-weight:600;font-size:0.74rem;text-align:center;max-width:88px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${c.name}">${c.name}</div>
    ${c.level ? `<div style="font-size:0.6rem;color:var(--text-muted)">Lvl ${c.level}</div>` : ''}
    ${hpHtml}
    ${statusIcons ? `<div style="display:flex;gap:2px;flex-wrap:wrap;justify-content:center">${statusIcons}</div>` : ''}
  </div>`;
}

function renderTableView() {
  const tmEl = $('#table-view-teammates');
  const npcEl = $('#table-view-npcs');
  if (!tmEl || !npcEl) return;

  const curTurnId = _currentTurnCharacterId();
  const teammates = tableParticipants.filter(c => !c.is_npc);
  const npcs      = tableParticipants.filter(c => c.is_npc);

  tmEl.innerHTML = teammates.length
    ? teammates.map(c => _renderTableCard(c, curTurnId)).join('')
    : '<span class="text-muted" style="font-size:0.78rem">No teammates</span>';
  npcEl.innerHTML = npcs.length
    ? npcs.map(c => _renderTableCard(c, curTurnId)).join('')
    : '<span class="text-muted" style="font-size:0.78rem">GM hasn\'t placed anyone yet</span>';

  // Rework v3: any character is selectable — PvP / ally-heal both allowed.
  // The caster is excluded so you don't accidentally pick yourself as a target.
  [tmEl, npcEl].forEach(container => {
    container.querySelectorAll('.table-card').forEach(card => {
      const tid = parseInt(card.dataset.targetId);
      if (tid === parseInt(CHAR_ID)) return;
      card.addEventListener('click', () => {
        selectedTargetId = tid === selectedTargetId ? null : tid;
        renderTableView();
        updateTargetInfo();
        renderActionMenu();
      });
    });
  });
}

function updateTargetInfo() {
  const info = $('#selected-target-info');
  if (!info) return;
  if (selectedTargetId) {
    const t = tableParticipants.find(c => c.id === selectedTargetId);
    info.style.display = 'block';
    $('#selected-target-name').textContent = t ? t.name : `#${selectedTargetId}`;
  } else {
    info.style.display = 'none';
  }
}

if ($('#btn-clear-target')) {
  $('#btn-clear-target').addEventListener('click', () => {
    selectedTargetId = null;
    renderTableView();
    updateTargetInfo();
  });
}

// ══════════════════════════════════════════════════════════════
// FIX 2 — ACTION MENU (2×2 card grid with slide-in confirmation)
// ══════════════════════════════════════════════════════════════

// Confirmation panel — rendered as a fixed overlay above the Actions
// panel. `_closeConfirmPanel` tears down both the panel and its
// backdrop, and restores the inline Actions strip that was hidden
// while the overlay was up.
function _closeConfirmPanel() {
  const backdrop = document.getElementById('action-confirm-backdrop');
  if (backdrop) backdrop.remove();
  const p = document.getElementById('action-confirm-panel');
  if (p) p.remove();
  const body = document.getElementById('action-menu-body');
  if (body) {
    body.style.visibility = '';
    delete body.dataset._hidden;
  }
  renderActionMenu();
}

function _mountConfirmPanel(innerHtml) {
  const body = $('#action-menu-body');
  if (!body) return null;
  // The in-sidebar layout fought us every time — flex-wrap parent,
  // nested panels with `overflow:hidden`, variable sibling heights,
  // viewport-cached HTML — so we bail on the inline approach and
  // render the confirm panel as a FIXED overlay anchored to the
  // viewport. This makes the max-height + scroll deterministic and
  // identical on every browser, regardless of how tall the ability
  // flow grows.
  //
  // UX: the overlay is placed over the right-sidebar column (same
  // visual location as before) with a semi-transparent backdrop so
  // the rest of the screen is clearly secondary while rolling.
  // Clicking the backdrop closes the panel, same as the ✕ button.
  //
  // We still return a DOM node anchored at `#action-confirm-panel`
  // so the existing `_closeConfirmPanel()` / `querySelector` code
  // keeps working unchanged.
  // Clean up any stale overlay first (defensive — a hot-reload or
  // double-click could otherwise leave two stacked backdrops).
  document.querySelectorAll('#action-confirm-backdrop, #action-confirm-panel')
    .forEach(n => n.remove());
  // Hide the inline body so the Actions strip doesn't show behind.
  body.dataset._hidden = '1';
  body.style.visibility = 'hidden';
  const backdrop = document.createElement('div');
  backdrop.id = 'action-confirm-backdrop';
  backdrop.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.55);
    z-index:9000;display:flex;align-items:center;justify-content:center;
    padding:24px;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);
  `;
  const panel = document.createElement('div');
  panel.id = 'action-confirm-panel';
  panel.className = 'action-confirm slide-in';
  panel.style.cssText = `
    width:min(420px, 92vw);max-height:min(85vh, 820px);
    background:var(--bg-surface-2);border:1px solid var(--border-active);
    border-radius:var(--r-md);box-shadow:0 8px 32px rgba(0,0,0,0.55);
    padding:12px 14px 18px 14px;overflow-y:auto;overscroll-behavior:contain;
    -webkit-overflow-scrolling:touch;
  `;
  panel.innerHTML = innerHtml;
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  // Backdrop click-outside closes the panel (but only on the backdrop
  // itself, not when clicks bubble up from inner widgets).
  backdrop.addEventListener('mousedown', e => {
    if (e.target === backdrop) _closeConfirmPanel();
  });
  // Esc to close.
  const escHandler = e => {
    if (e.key === 'Escape') {
      _closeConfirmPanel();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
  return panel;
}

function _actionCard({id, icon, label, sub, subColor = 'var(--text-muted)'}) {
  return `<div class="action-card" id="${id}" role="button" tabindex="0"
            style="flex:1 1 140px;min-width:140px;background:var(--bg-surface);
                   border:1px solid var(--border);border-radius:var(--r-md);
                   padding:10px;cursor:pointer;transition:all .15s;
                   display:flex;flex-direction:column;align-items:center;gap:3px;
                   text-align:center">
    <div class="ac-icon" style="font-size:1.5rem">${icon}</div>
    <div style="font-weight:600;font-size:0.82rem">${label}</div>
    <div class="ac-sub" style="font-size:0.68rem;color:${subColor}">${sub}</div>
  </div>`;
}

function renderActionMenu() {
  const body = $('#action-menu-body');
  if (!body || !char) return;

  // Ensure 2×2 wrapping
  body.style.display = 'flex';
  body.style.flexWrap = 'wrap';
  body.style.gap = '8px';

  const items = inventoryData?.items || [];

  // Attack: main_hand weapon equipped
  const wpn = items.find(i => i.is_equipped && i.equipped_slot === 'main_hand' && i.weapon_stats);
  // Potion: any consumable flagged is_potion OR in category "potion" (backward compat)
  const potions = items.filter(i => i.consumable && (i.is_potion || (i.category || '').toLowerCase() === 'potion'));
  // Use Item: non-consumable with use_effect defined (not a potion)
  const useables = items.filter(i =>
    !i.consumable && i.use_effect && !i.is_potion && (i.category || '').toLowerCase() !== 'potion'
  );
  // Ability: ≥1 active/reaction ability not all on cooldown
  const activeAbs = (abilitiesData || []).filter(a =>
    a.ability_type !== 'passive' && a.is_unlocked !== false && (a.cooldown_remaining || 0) <= 0
  );

  const cards = [];
  if (wpn) {
    const ws = wpn.weapon_stats;
    // Rework v3 Phase 7: show grid-cell range on the Attack card so
    // the player knows how close they must be before clicking. Server
    // still enforces the check; this is just pre-empting the 403.
    const rng = ws.range_cells != null ? ` · 📏${ws.range_cells}` : '';
    cards.push(_actionCard({
      id: 'action-attack', icon: '⚔️', label: 'Attack',
      sub: `${wpn.name} · ${ws.dice_count}d${ws.dice_type}${rng}`,
    }));
  }
  if (activeAbs.length) {
    cards.push(_actionCard({
      id: 'action-ability', icon: '✨', label: 'Ability',
      sub: `${activeAbs.length} ready`,
    }));
  }
  if (potions.length) {
    cards.push(_actionCard({
      id: 'action-potion', icon: '🧪', label: 'Potion',
      sub: `${potions.length} available`,
    }));
  }
  if (useables.length) {
    cards.push(_actionCard({
      id: 'action-use-item', icon: '🎒', label: 'Use Item',
      sub: `${useables.length} available`,
    }));
  }

  body.innerHTML = cards.length
    ? cards.join('')
    : '<span class="text-muted" style="font-size:0.82rem;padding:8px">No actions available — equip a weapon, learn an ability, or get items</span>';

  // Hover / click styling
  body.querySelectorAll('.action-card').forEach(el => {
    el.addEventListener('mouseenter', () => { el.style.borderColor = 'var(--accent)'; });
    el.addEventListener('mouseleave', () => { el.style.borderColor = 'var(--border)'; });
  });

  const atkBtn   = body.querySelector('#action-attack');
  const abiBtn   = body.querySelector('#action-ability');
  const potBtn   = body.querySelector('#action-potion');
  const itemBtn  = body.querySelector('#action-use-item');
  if (atkBtn)  atkBtn.addEventListener('click',   () => openAttackConfirm(wpn));
  if (abiBtn)  abiBtn.addEventListener('click',   () => openAbilityPicker(activeAbs));
  if (potBtn)  potBtn.addEventListener('click',   () => openItemPicker(potions,  'Potions',   '🧪'));
  if (itemBtn) itemBtn.addEventListener('click',  () => openItemPicker(useables, 'Use Item', '🎒'));
}

// ── Attack confirmation panel (two-step: Hit → Damage) ───────
function openAttackConfirm(wpn) {
  if (!wpn) return;
  if (!selectedTargetId) {
    // Inline warning instead of modal
    const body = $('#action-menu-body');
    if (!body) return;
    const existing = document.getElementById('action-inline-warn');
    if (existing) existing.remove();
    const warn = document.createElement('div');
    warn.id = 'action-inline-warn';
    warn.style.cssText = 'width:100%;padding:6px 10px;margin-top:4px;background:rgba(184,64,64,0.12);border:1px solid var(--accent-red);border-radius:var(--r-sm);color:#e07878;font-size:0.78rem';
    warn.innerHTML = '⚠️ Select a target first (tap an NPC card at the table above)';
    body.appendChild(warn);
    setTimeout(() => warn.remove(), 4000);
    return;
  }
  const target = tableParticipants.find(c => c.id === selectedTargetId);
  const wpnStats = wpn.weapon_stats || { dice_count: 1, dice_type: 6 };
  const html = `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
      <span style="font-size:1.2rem">⚔️</span>
      <span style="font-weight:700;flex:1">Attack: ${target ? target.name : '?'}</span>
      <button class="btn btn-ghost btn-xs" id="ac-cancel">✕</button>
    </div>
    <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:6px">
      Weapon: <strong style="color:var(--text-primary)">${wpn.name}</strong>
    </div>

    <!-- STEP 1: HIT ROLL -->
    <div id="ac-step1">
      <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:4px;font-weight:600">🎯 Step 1 — Roll to Hit (d20)</div>
      <div id="ac-hit-adv-host" style="margin-bottom:6px"></div>
      <div style="display:flex;gap:6px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" id="ac-cancel-2">Cancel</button>
        <button class="btn btn-primary btn-sm" id="ac-roll-hit">🎯 Roll Hit</button>
      </div>
    </div>

    <!-- STEP 2: DAMAGE ROLL (hidden until hit confirmed) -->
    <div id="ac-step2" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
      <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:4px;font-weight:600">💥 Step 2 — Roll Damage</div>
      <div id="ac-dmg-widget" style="margin-bottom:6px"></div>
      <div style="display:flex;gap:6px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" id="ac-cancel-3">Cancel</button>
        <button class="btn btn-primary btn-sm" id="ac-roll-dmg">💥 Roll Damage</button>
      </div>
    </div>

    <div id="ac-result" style="margin-top:8px;font-size:0.78rem"></div>
  `;
  const panel = _mountConfirmPanel(html);
  if (!panel) return;

  // ── Hit roll advantage toggle + dice-count stepper (Rework v3) ──
  const hitAdvHost = panel.querySelector('#ac-hit-adv-host');
  let hitState = { advantageMode: 'normal', diceCount: 1 };
  function _renderHitAdv() {
    hitAdvHost.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:0.72rem;color:var(--text-muted)">Mode:</span>
        <div class="adv-toggle" id="ac-hit-adv">
          <button data-mode="disadvantage" class="${hitState.advantageMode==='disadvantage'?'active':''}">Disadv</button>
          <button data-mode="normal" class="${hitState.advantageMode==='normal'?'active':''}">Normal</button>
          <button data-mode="advantage" class="${hitState.advantageMode==='advantage'?'active':''}">Adv</button>
        </div>
        <div style="display:inline-flex;align-items:center;gap:4px">
          <span style="font-size:0.72rem;color:var(--text-muted)">🎲 ×</span>
          <button type="button" class="btn btn-ghost btn-xs" id="ac-hit-dice-minus" style="padding:0 6px">−</button>
          <span id="ac-hit-dice-count" style="font-weight:600;min-width:10px;text-align:center">${hitState.diceCount}</span>
          <button type="button" class="btn btn-ghost btn-xs" id="ac-hit-dice-plus" style="padding:0 6px">+</button>
        </div>
      </div>`;
    hitAdvHost.querySelectorAll('#ac-hit-adv button').forEach(b => {
      b.addEventListener('click', () => {
        hitState.advantageMode = b.dataset.mode;
        if (hitState.advantageMode !== 'normal' && hitState.diceCount < 2) hitState.diceCount = 2;
        _renderHitAdv();
      });
    });
    const step = (d) => {
      const min = hitState.advantageMode === 'normal' ? 1 : 2;
      hitState.diceCount = Math.max(min, Math.min(ADV_DICE_CAP, hitState.diceCount + d));
      _renderHitAdv();
    };
    hitAdvHost.querySelector('#ac-hit-dice-minus').addEventListener('click', () => step(-1));
    hitAdvHost.querySelector('#ac-hit-dice-plus').addEventListener('click', () => step(+1));
  }
  _renderHitAdv();

  // ── Damage dice widget state (mounted after hit roll) ──
  //    Rework v3: dice_count/type are FIXED by weapon; if the weapon defines
  //    preset damage_modes, the player picks one via modeIndex instead.
  let dmgState = {
    diceCount: wpnStats.dice_count,
    diceType: wpnStats.dice_type,
    damageModes: (wpnStats.damage_modes || []),
    modeIndex: (wpnStats.damage_modes && wpnStats.damage_modes.length ? 0 : null),
    advantageMode: 'normal',
  };
  let hitData = null; // stored after Step 1

  const closePanel = () => _closeConfirmPanel();
  panel.querySelector('#ac-cancel').addEventListener('click', closePanel);
  panel.querySelector('#ac-cancel-2').addEventListener('click', closePanel);
  panel.querySelector('#ac-cancel-3').addEventListener('click', closePanel);

  // STEP 1: Roll Hit
  panel.querySelector('#ac-roll-hit').addEventListener('click', async () => {
    const resultEl = panel.querySelector('#ac-result');
    const rollBtn = panel.querySelector('#ac-roll-hit');
    rollBtn.disabled = true;
    resultEl.innerHTML = '<span class="text-muted">Rolling d20...</span>';
    try {
      const res = await api.post('/api/combat/hit-roll', {
        attacker_id: CHAR_ID,
        target_id:   selectedTargetId,
        advantage:   hitState.advantageMode,
        hit_dice_count: hitState.diceCount,
      });
      hitData = res;
      let out = '';
      if (res.hit) {
        out += `<div style="color:var(--accent-green);font-weight:700">${res.critical ? '🎯 CRITICAL HIT!' : '⚔️ HIT!'}</div>`;
      } else {
        out += `<div style="color:var(--accent-red);font-weight:700">${res.fumble ? '💨 FUMBLE' : '🛡️ MISS'}</div>`;
      }
      out += `<div>${res.hit_breakdown}</div>`;
      resultEl.innerHTML = out;
      addLog(`⚔️ ${res.hit_breakdown}`);

      // WS broadcast: hit result (no damage yet)
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({
          type: 'combat.hit_result',
          attacker_id: CHAR_ID, attacker_name: char.name,
          target_id:   selectedTargetId, target_name: res.target_name,
          hit: res.hit, critical: res.critical, fumble: res.fumble,
          hit_breakdown: res.hit_breakdown,
        }));
      }

      if (res.hit) {
        if (res.pending_defense_id) {
          // Defense reaction: pause the flow, store state for resume after resolution
          resultEl.innerHTML += '<div style="margin-top:4px;color:var(--accent)">⏳ Waiting for target defense...</div>';
          _pendingAttackState = { panel, hitData: res, selectedTargetId, dmgState };
        } else {
          // No defense needed (crit or miss already handled) → show step 2 immediately
          panel.querySelector('#ac-step1').style.display = 'none';
          const step2 = panel.querySelector('#ac-step2');
          step2.style.display = '';
          // Defaults from server response (reflects equipped weapon)
          dmgState.diceCount = res.default_dice_count || wpnStats.dice_count;
          dmgState.diceType  = res.default_dice_type  || wpnStats.dice_type;
          // Rework v3: server returns preset damage_modes if the weapon has them.
          if (Array.isArray(res.damage_modes) && res.damage_modes.length) {
            dmgState.damageModes = res.damage_modes;
            if (dmgState.modeIndex == null) dmgState.modeIndex = 0;
          } else {
            dmgState.damageModes = [];
            dmgState.modeIndex = null;
          }
          _mountDmgWidget(panel, dmgState);
        }
      } else {
        // Miss/fumble — close after delay via final button
        rollBtn.disabled = false;
        rollBtn.textContent = '🎯 Re-roll Hit';
      }
    } catch (e) {
      rollBtn.disabled = false;
      const d = e?.body?.detail;
      resultEl.innerHTML = `<span style="color:var(--accent-red)">${typeof d === 'object' ? (d.message || JSON.stringify(d)) : (d || 'Hit roll failed')}</span>`;
    }
  });

  // STEP 2: Roll Damage
  panel.querySelector('#ac-roll-dmg').addEventListener('click', async () => {
    if (!hitData || !hitData.hit) return;
    const resultEl = panel.querySelector('#ac-result');
    const rollBtn = panel.querySelector('#ac-roll-dmg');
    rollBtn.disabled = true;
    resultEl.innerHTML = (resultEl.innerHTML || '') + '<div class="text-muted">Rolling damage...</div>';
    try {
      const res = await api.post('/api/combat/damage-roll', {
        attacker_id: CHAR_ID,
        target_id:   selectedTargetId,
        critical:    !!hitData.critical,
        // Rework v3: damage dice are fixed by the weapon. Only pass mode index.
        damage_mode_index: dmgState.modeIndex,
        advantage:   dmgState.advantageMode || 'normal',
      });
      let out = '';
      if (hitData.critical) {
        out += `<div style="color:var(--accent-green);font-weight:700">🎯 CRITICAL HIT!</div>`;
      } else {
        out += `<div style="color:var(--accent-green);font-weight:700">⚔️ HIT!</div>`;
      }
      out += `<div>${hitData.hit_breakdown}</div>`;
      out += `<div>${res.damage_breakdown}</div>`;
      out += `<div>${res.intake_breakdown}</div>`;
      out += `<div style="font-weight:600;margin-top:3px">${res.target_name}: <span style="color:var(--accent-red)">${res.final_damage} dmg</span> → ${res.target_hp_after} HP${res.target_downed ? ' 💀 DOWN!' : ''}</div>`;
      resultEl.innerHTML = out;
      addLog(`💥 ${res.damage_breakdown}`);
      addLog(`🛡️ ${res.intake_breakdown}`);
      if (res.target_downed) addLog(`💀 ${res.target_name} is DOWN!`);

      // WS broadcast: full attack result
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({
          type: 'combat.attack_result',
          attacker_id: CHAR_ID, attacker_name: char.name,
          target_id:   selectedTargetId, target_name: res.target_name,
          hit: true, critical: !!hitData.critical, fumble: false,
          final_damage: res.final_damage, target_hp_after: res.target_hp_after,
        }));
      }
      await loadChar();
      loadTableView();
    } catch (e) {
      rollBtn.disabled = false;
      const d = e?.body?.detail;
      resultEl.innerHTML += `<div style="color:var(--accent-red)">${typeof d === 'object' ? (d.message || JSON.stringify(d)) : (d || 'Damage roll failed')}</div>`;
    }
  });
}

// Rework v3: damage dice are LOCKED by the weapon.
//   * No damage_modes → render read-only "1d6 physical".
//   * Has damage_modes → render a dropdown of preset modes.
// Player can still pick adv/disadv on the damage roll.
function _mountDmgWidget(panel, dmgState) {
  const host = panel.querySelector('#ac-dmg-widget');
  if (!host) return;
  const modes = Array.isArray(dmgState.damageModes) ? dmgState.damageModes : [];
  dmgState.advantageMode = dmgState.advantageMode || 'normal';

  if (modes.length > 0) {
    if (dmgState.modeIndex == null) dmgState.modeIndex = 0;
    host.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:6px">
        <label style="font-size:0.72rem;color:var(--text-muted)">Damage Mode:</label>
        <select id="ac-dmg-mode" style="font-size:0.85rem">
          ${modes.map((m, i) => `<option value="${i}"${i===dmgState.modeIndex?' selected':''}>${m.name} — ${m.dice_count}d${m.dice_type} ${m.damage_type || ''}</option>`).join('')}
        </select>
        <div style="display:flex;gap:6px;align-items:center">
          <span style="font-size:0.72rem;color:var(--text-muted)">Adv:</span>
          <div class="adv-toggle" id="ac-dmg-adv">
            <button data-mode="disadvantage" class="${dmgState.advantageMode==='disadvantage'?'active':''}">Disadv</button>
            <button data-mode="normal" class="${dmgState.advantageMode==='normal'?'active':''}">Normal</button>
            <button data-mode="advantage" class="${dmgState.advantageMode==='advantage'?'active':''}">Adv</button>
          </div>
        </div>
      </div>`;
    host.querySelector('#ac-dmg-mode').addEventListener('change', e => {
      dmgState.modeIndex = parseInt(e.target.value) || 0;
    });
  } else {
    // Single-mode weapon — read-only display.
    host.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:6px">
        <div style="font-size:0.8rem">Damage: <strong>${dmgState.diceCount}d${dmgState.diceType}</strong> <span style="color:var(--text-muted)">(fixed by weapon)</span></div>
        <div style="display:flex;gap:6px;align-items:center">
          <span style="font-size:0.72rem;color:var(--text-muted)">Adv:</span>
          <div class="adv-toggle" id="ac-dmg-adv">
            <button data-mode="disadvantage" class="${dmgState.advantageMode==='disadvantage'?'active':''}">Disadv</button>
            <button data-mode="normal" class="${dmgState.advantageMode==='normal'?'active':''}">Normal</button>
            <button data-mode="advantage" class="${dmgState.advantageMode==='advantage'?'active':''}">Adv</button>
          </div>
        </div>
      </div>`;
  }
  host.querySelectorAll('#ac-dmg-adv button').forEach(b => {
    b.addEventListener('click', () => {
      host.querySelectorAll('#ac-dmg-adv button').forEach(x => x.classList.toggle('active', x === b));
      dmgState.advantageMode = b.dataset.mode;
    });
  });
}

// ── Ability picker confirmation panel ─────────────────────────
function openAbilityPicker(ablist) {
  if (!ablist || !ablist.length) { showToast('No ready abilities'); return; }
  const cur = char?.mana_current ?? 0;
  const html = `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
      <span style="font-size:1.2rem">✨</span>
      <span style="font-weight:700;flex:1">Choose an Ability</span>
      <button class="btn btn-ghost btn-xs" id="ap-close">✕</button>
    </div>
    <div id="ap-list" style="display:flex;flex-direction:column;gap:4px;max-height:240px;overflow-y:auto">
      ${(abilitiesData || []).filter(a => a.ability_type !== 'passive' && a.is_unlocked !== false).map(a => {
        const onCd = (a.cooldown_remaining || 0) > 0;
        const notEnoughMana = (a.mana_cost || 0) > cur;
        const disabled = onCd || notEnoughMana;
        const color = a.color || 'var(--accent)';
        return `<div class="ap-item ${disabled ? 'disabled' : ''}" data-ca-id="${a.character_ability_id}"
                 style="padding:6px 8px;background:var(--bg-surface);border-left:3px solid ${color};
                        border-radius:var(--r-sm);cursor:${disabled ? 'not-allowed' : 'pointer'};
                        opacity:${disabled ? '0.5' : '1'};transition:background .15s">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:1rem">${a.icon || '⚡'}</span>
            <strong style="flex:1;font-size:0.82rem">${a.name}</strong>
            ${a.ability_type === 'reaction' ? '<span style="font-size:0.6rem;color:#f59e0b">reaction</span>' : ''}
            ${a.mana_cost ? `<span style="font-size:0.7rem;color:${notEnoughMana ? 'var(--accent-red)' : '#60a5fa'}">🔮${a.mana_cost}</span>` : ''}
            ${a.hp_cost ? `<span style="font-size:0.7rem;color:var(--accent-red)">❤️${a.hp_cost}</span>` : ''}
            ${onCd ? `<span style="font-size:0.7rem;color:var(--accent-orange)">⏳${a.cooldown_remaining}t</span>` : ''}
          </div>
          ${a.flavor_text ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px">${a.flavor_text}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
    <div id="ap-confirm-area" style="margin-top:8px"></div>
  `;
  const panel = _mountConfirmPanel(html);
  if (!panel) return;

  panel.querySelector('#ap-close').addEventListener('click', _closeConfirmPanel);

  panel.querySelectorAll('.ap-item:not(.disabled)').forEach(el => {
    el.addEventListener('click', () => {
      const caId = parseInt(el.dataset.caId);
      const ab = abilitiesData.find(a => a.character_ability_id === caId);
      if (!ab) return;
      _mountAbilityConfirm(panel, ab);
    });
  });
}

function _mountAbilityConfirm(panel, ab) {
  const area = panel.querySelector('#ap-confirm-area');
  if (!area) return;
  // Rework v3 — classify the ability by its effects to show the right targets.
  //   * Offensive (requires hit-roll OR has a damage dice/effect) → enemies only (NPCs).
  //   * Supportive (heal / restore mana / buff / cleanse / ...)   → allies + self.
  //   * Mixed or unknown                                          → everyone living.
  const _effList = Array.isArray(ab.effect) ? ab.effect
    : (ab.effect && Array.isArray(ab.effect.effects)) ? ab.effect.effects : [];
  const _hasDamage = _effList.some(e => e && e.type === 'damage')
                  || !!(ab.damage_dice_count && ab.damage_dice_type);
  const _hasSupport = _effList.some(e => e && [
    'heal_hp','restore_mana','restore_hp_by_die',
    'stat_boost','apply_status','remove_status',
  ].includes(e.type));
  const _isOffensive = !!ab.requires_hit_roll || (_hasDamage && !_hasSupport);
  // Rework v3 Phase 7 bug fix — previously `needsTarget` was strictly
  // `target_type === 'single'`, which meant abilities with
  // `target_type='aoe'` (very easy to pick in the creator) skipped the
  // target dropdown and silently fell back to `target_id = null` on
  // the server — where the damage was then applied to the CASTER
  // instead of the intended enemy. Until we grow a proper AoE picker
  // (area-on-map), ALL non-self / non-none abilities prompt for a
  // primary target. Passive abilities still opt out of the picker.
  const needsTarget = !ab.is_passive
                   && ab.target_type !== 'self'
                   && ab.target_type !== 'none';

  let targets;
  if (_isOffensive) {
    targets = (tableParticipants || []).filter(t => t.is_npc && t.is_alive !== false);
  } else if (_hasSupport && !_hasDamage) {
    const allies = (tableParticipants || [])
      .filter(t => !t.is_npc && t.id !== CHAR_ID && t.is_alive !== false);
    targets = [{ id: CHAR_ID, name: (char?.name || 'Self'), _self: true }, ...allies];
  } else {
    const others = (tableParticipants || [])
      .filter(t => t.id !== CHAR_ID && t.is_alive !== false);
    targets = [{ id: CHAR_ID, name: (char?.name || 'Self'), _self: true }, ...others];
  }
  const costLine = [
    ab.mana_cost ? `🔮 ${ab.mana_cost} mana` : null,
    ab.hp_cost   ? `❤️ ${ab.hp_cost} HP` : null,
    ab.cooldown_turns ? `⏳ CD ${ab.cooldown_turns}t` : null,
    // Rework v3 Phase 7: show range so the player knows the reach.
    (ab.range_cells != null && ab.target_type !== 'self') ? `📏 ${ab.range_cells} cells` : null,
  ].filter(Boolean).join(' · ');

  // Rework Phase 6: state across the two-step flow
  const state = {
    hit_roll: null,      // { total, hit, critical, breakdown }
    damage_roll: null,   // { dice_count, dice_type, rolls, total }
  };
  const needsHit = !!ab.requires_hit_roll;
  const hasDamageDice = !!(ab.damage_dice_count && ab.damage_dice_type);
  const hitStatLabel = (ab.hit_stat || '').slice(0, 3).toUpperCase() || 'STAT';
  const dmgStatLabel = (ab.damage_stat || '').slice(0, 3).toUpperCase() || '';

  // Compute character stat value for hit bonus (direct per Rework Phase 2)
  const statVal = (char && ab.hit_stat && typeof char[ab.hit_stat] === 'number') ? char[ab.hit_stat] : 0;
  const dmgStatVal = (char && ab.damage_stat && typeof char[ab.damage_stat] === 'number') ? char[ab.damage_stat] : 0;

  area.innerHTML = `
    <div style="padding:8px;background:var(--bg-surface);border-radius:var(--r-sm);border:1px solid var(--border-active)">
      <div style="font-weight:700;margin-bottom:3px">${ab.icon || '⚡'} ${ab.name}</div>
      ${ab.flavor_text ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:4px">${ab.flavor_text}</div>` : ''}
      ${costLine ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:6px">${costLine}</div>` : ''}
      ${needsTarget ? `<div style="margin-bottom:6px">
        <label style="font-size:0.75rem">Target:
          <select id="ap-target" style="font-size:0.8rem;margin-left:4px;min-width:140px">
            ${(() => {
              if (!targets.length) return '<option value="">(no targets)</option>';
              // Prefer the currently selected table target; else first option in the list.
              const picked = targets.find(t => t.id === selectedTargetId) || targets[0];
              return targets.map(t => {
                const lbl = t._self ? `Self (${t.name})`
                          : (t.is_npc ? `🎭 ${t.name}` : `👤 ${t.name}`);
                return `<option value="${t.id}"${t.id === picked.id ? ' selected' : ''}>${lbl}</option>`;
              }).join('');
            })()}
          </select>
        </label>
      </div>` : ''}
      ${needsHit ? `
        <div style="margin-bottom:8px">
          <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:3px">Step 1 — Hit roll (+${statVal} ${hitStatLabel})</div>
          <div id="ap-hit-widget"></div>
          <div id="ap-hit-result" style="margin-top:4px;font-size:0.78rem"></div>
        </div>` : ''}
      ${hasDamageDice ? `
        <div style="margin-bottom:8px">
          <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:3px">${needsHit ? 'Step 2' : 'Step'} — Effect roll${dmgStatLabel ? ` (+${dmgStatVal} ${dmgStatLabel})` : ''}</div>
          <div id="ap-dmg-widget"></div>
          <div id="ap-dmg-result" style="margin-top:4px;font-size:0.78rem"></div>
        </div>` : ''}
      <div style="display:flex;gap:6px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" id="ap-back">← Back</button>
        <button class="btn btn-primary btn-sm" id="ap-use"${needsHit || hasDamageDice ? ' disabled' : ''}>Use</button>
      </div>
      <div id="ap-result" style="margin-top:6px;font-size:0.78rem"></div>
    </div>`;

  // Wire widgets
  const useBtn = area.querySelector('#ap-use');
  const refreshUseButton = () => {
    const hitReady = !needsHit || !!state.hit_roll;
    const dmgReady = !hasDamageDice || !!state.damage_roll || (state.hit_roll && state.hit_roll.hit === false);
    useBtn.disabled = !(hitReady && dmgReady);
  };

  if (needsHit && typeof createDiceRollWidget === 'function') {
    // Rework v3 — parity with the regular Attack panel:
    // the player may roll N×d20 for the hit check. ADV/DIS interpret
    // "N dice" as a pool — take the highest (ADV) or lowest (DIS) of
    // the whole pool. With Normal mode a pool > 1 is still permitted
    // (e.g. "Superior advantage" house rules) but only the first die
    // is used, so the UX mirrors `makeAdvToggle`'s stepper behaviour.
    // The *dice type* is always d20 and is locked by `fixedDiceType`.
    createDiceRollWidget(area.querySelector('#ap-hit-widget'), {
      label: `Attack d20${statVal ? ` + ${statVal} ${hitStatLabel}` : ''}`,
      defaultDiceCount: 1, defaultDiceType: 20,
      showDiceSelector: true, fixedDiceType: 20, showAdvantage: true,
      onRoll: async ({ diceCount, advantageMode }) => {
        const n = Math.max(1, Math.min(20, diceCount | 0));
        const all = [];
        for (let i = 0; i < n; i++) all.push(1 + Math.floor(Math.random() * 20));
        let chosen;
        if (advantageMode === 'advantage')       chosen = Math.max(...all);
        else if (advantageMode === 'disadvantage') chosen = Math.min(...all);
        else                                      chosen = all[0];
        const total = chosen + statVal;
        const fumble = chosen === 1;
        const crit = chosen === 20;
        // Determine target AC for hit verdict
        const tgtId = needsTarget ? parseInt(area.querySelector('#ap-target')?.value || '') : null;
        const tgt = tgtId ? (tableParticipants||[]).find(t => t.id === tgtId) : null;
        const ac = tgt?.armor_class ?? 10;
        const hit = fumble ? false : (crit || total >= ac);
        const poolTag = n > 1
          ? `${advantageMode === 'advantage' ? 'ADV' : advantageMode === 'disadvantage' ? 'DIS' : 'POOL'}[${all.join(',')}] took ${chosen} · `
          : '';
        const bd = `${poolTag}D20(${chosen}) + ${hitStatLabel}(${statVal >= 0 ? '+' : ''}${statVal}) = ${total} vs AC ${ac} → ${fumble ? 'FUMBLE' : crit ? 'CRIT' : hit ? 'HIT' : 'MISS'}`;
        state.hit_roll = { total, hit, critical: crit, fumble, breakdown: bd };
        const resEl = area.querySelector('#ap-hit-result');
        if (resEl) resEl.innerHTML = `<span style="color:${hit ? 'var(--accent-green)' : 'var(--accent-red)'}">${bd}</span>`;
        refreshUseButton();
        return { total, breakdown: bd };
      },
      resultFormatter: r => r.breakdown || '',
    });
  }

  if (hasDamageDice && typeof createDiceRollWidget === 'function') {
    // Rework v3 — damage dice count & die type are authored by the GM
    // on the Ability template (`ab.damage_dice_count` / `_type`). The
    // player must NOT be able to inflate their own damage by bumping
    // these in the widget, so we lock both: `lockDiceCount` makes the
    // count input readonly, `fixedDiceType` disables the die dropdown.
    createDiceRollWidget(area.querySelector('#ap-dmg-widget'), {
      label: `Effect ${ab.damage_dice_count}d${ab.damage_dice_type}${dmgStatVal ? ` + ${dmgStatVal} ${dmgStatLabel}` : ''}`,
      defaultDiceCount: ab.damage_dice_count || 1,
      defaultDiceType: ab.damage_dice_type || 6,
      showDiceSelector: true, showAdvantage: true,
      lockDiceCount: true, fixedDiceType: ab.damage_dice_type || 6,
      onRoll: async ({ diceCount, diceType, advantageMode }) => {
        const rollOnce = () => {
          const rolls = [];
          let actual = diceCount;
          if (state.hit_roll && state.hit_roll.critical) actual = diceCount * 2;
          for (let i = 0; i < actual; i++) rolls.push(1 + Math.floor(Math.random() * diceType));
          return { rolls, sum: rolls.reduce((a, b) => a + b, 0) };
        };
        const r1 = rollOnce();
        let chosen = r1, all = [r1];
        if (advantageMode === 'advantage' || advantageMode === 'disadvantage') {
          const r2 = rollOnce();
          all = [r1, r2];
          chosen = advantageMode === 'advantage' ? (r1.sum >= r2.sum ? r1 : r2) : (r1.sum <= r2.sum ? r1 : r2);
        }
        const total = chosen.sum + dmgStatVal;
        const advTag = advantageMode !== 'normal' ? `${advantageMode === 'advantage' ? 'ADV' : 'DIS'} took ${chosen.sum} · ` : '';
        const crTag = (state.hit_roll && state.hit_roll.critical) ? 'CRIT×2 ' : '';
        const bd = `${advTag}${crTag}${chosen.rolls.length}d${diceType}[${chosen.rolls.join(',')}]=${chosen.sum}${dmgStatVal ? ` + ${dmgStatVal} ${dmgStatLabel}` : ''} = ${total}`;
        state.damage_roll = { dice_count: diceCount, dice_type: diceType, rolls: chosen.rolls, total };
        const resEl = area.querySelector('#ap-dmg-result');
        if (resEl) resEl.innerHTML = `<span style="color:var(--accent)">${bd}</span>`;
        refreshUseButton();
        return { total, breakdown: bd };
      },
      resultFormatter: r => r.breakdown || '',
    });
  }

  area.querySelector('#ap-back').addEventListener('click', () => openAbilityPicker(abilitiesData));
  useBtn.addEventListener('click', async () => {
    const resultEl = area.querySelector('#ap-result');
    const tgt = needsTarget ? parseInt(area.querySelector('#ap-target')?.value || '') : null;
    if (needsTarget && !tgt) { resultEl.innerHTML = '<span style="color:var(--accent-red)">Pick a target</span>'; return; }
    resultEl.innerHTML = '<span class="text-muted">Using...</span>';
    try {
      const body = {};
      if (tgt) body.target_id = tgt;
      if (state.hit_roll)    body.hit_roll = state.hit_roll;
      if (state.damage_roll) {
        body.override_dice_count = state.damage_roll.dice_count;
        body.override_dice_type  = state.damage_roll.dice_type;
      }
      const res = await api.post(`/api/character-abilities/${ab.character_ability_id}/use`, body);
      let out = '';
      if (res.results && res.results.length) {
        out = res.results.map(r => `<div>• ${r}</div>`).join('');
        res.results.forEach(r => addLog(`✨ ${ab.name}: ${r}`));
      } else {
        out = '<div>✅ Ability used</div>';
      }
      resultEl.innerHTML = out;

      // Defense reaction: if server deferred damage, store state and wait
      if (res.pending_defense_id) {
        _pendingAbilityState = { area, ab, state, tgt };
        resultEl.innerHTML += '<div style="margin-top:4px;color:var(--accent)">⏳ Waiting for target defense...</div>';
        await loadChar();
        await loadAbilities();
        loadTableView();
        return;
      }

      // ── Combat FX + broadcast ─────────────────────────────────
      // Play a local animation and notify the rest of the table so
      // every client sees the same hit/miss/crit ring. We keep the
      // payload schema compatible with `combat.attack_result` so the
      // same renderer (`_playCombatFxFromPayload`) handles both.
      if (tgt) {
        const fxPayload = {
          attacker_id: CHAR_ID,
          attacker_name: char && char.name,
          target_id: tgt,
          target_name: (tableParticipants || []).find(t => t.id === tgt)?.name || null,
          hit:      state.hit_roll ? !!state.hit_roll.hit      : true,
          critical: state.hit_roll ? !!state.hit_roll.critical : false,
          fumble:   state.hit_roll ? !!state.hit_roll.fumble   : false,
          // Server returns the actual applied damage (post-resistances)
          // in `damage_applied` when the ability dealt HP damage.
          final_damage: res.damage_applied ?? res.final_damage ?? null,
        };
        _playCombatFxFromPayload(fxPayload);
        if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
          ws.ws.send(JSON.stringify({
            type: 'combat.ability_result',
            ...fxPayload,
            ability_name: ab.name,
          }));
        }
      }
      await loadChar();
      await loadAbilities();
      loadTableView();
    } catch (e) {
      const d = e?.body?.detail;
      resultEl.innerHTML = `<span style="color:var(--accent-red)">${typeof d === 'object' ? (d.message || JSON.stringify(d)) : (d || 'Failed')}</span>`;
    }
  });
}

// ── Potion / Use-Item picker confirmation panel ─────────────
function openItemPicker(items, title, icon) {
  if (!items || !items.length) return;
  const html = `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
      <span style="font-size:1.2rem">${icon}</span>
      <span style="font-weight:700;flex:1">${title}</span>
      <button class="btn btn-ghost btn-xs" id="ip-close">✕</button>
    </div>
    <div id="ip-list" style="display:flex;flex-direction:column;gap:4px;max-height:240px;overflow-y:auto">
      ${items.map(it => {
        const rarityCls = it.rarity ? ` rarity-${it.rarity}` : '';
        const rarityBorder = it.rarity ? `var(--rarity-${it.rarity}, var(--border))` : 'var(--border)';
        const effDesc = _summarizeUseEffect(it);
        // FIX 6: per-item potion icon
        const itIcon = (it.is_potion && it.potion_icon) ? it.potion_icon : '';
        return `<div class="ip-item" data-inv-id="${it.inventory_id}"
                 style="padding:6px 8px;background:var(--bg-surface);border:1px solid var(--border);
                        border-left:3px solid ${rarityBorder};
                        border-radius:var(--r-sm);cursor:pointer;transition:all .15s">
          <div style="display:flex;align-items:center;gap:6px">
            ${itIcon ? `<span style="font-size:1rem">${itIcon}</span>` : ''}
            <strong class="${rarityCls}" style="flex:1;font-size:0.82rem">${it.name}</strong>
            <span style="font-size:0.7rem;color:var(--text-muted)">×${it.quantity}</span>
            ${it.mana_cost ? `<span style="font-size:0.7rem;color:#60a5fa">🔮${it.mana_cost}</span>` : ''}
          </div>
          ${effDesc ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px">${effDesc}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
    <div id="ip-confirm-area" style="margin-top:8px"></div>
  `;
  const panel = _mountConfirmPanel(html);
  if (!panel) return;
  panel.querySelector('#ip-close').addEventListener('click', _closeConfirmPanel);
  panel.querySelectorAll('.ip-item').forEach(el => {
    el.addEventListener('click', () => {
      const invId = parseInt(el.dataset.invId);
      const it = items.find(x => x.inventory_id === invId);
      if (!it) return;
      _mountItemConfirm(panel, it);
    });
  });
}

function _summarizeUseEffect(it) {
  // Derive a short human description of what the item does
  // Supports both new dice-based effect format (FIX 6) and legacy flat format.
  try {
    const ue = it.use_effect;
    if (!ue) {
      if (it.effect_type && it.effect_value) return `${it.effect_type}: ${it.effect_value}`;
      return it.description || '';
    }
    const effs = Array.isArray(ue) ? ue : (ue.effects || []);
    const parts = effs.map(e => {
      // New dice-based formats
      if (e.type === 'heal_hp') {
        const dc = e.dice_count, dt = e.dice_type, fb = e.flat_bonus || 0;
        if (dc && dt) return `+${dc}d${dt}${fb ? (fb > 0 ? '+' + fb : fb) : ''} HP`;
        return e.value ? `+${e.value} HP` : '+HP';
      }
      if (e.type === 'damage') {
        const dc = e.dice_count, dt = e.dice_type, fb = e.flat_bonus || 0;
        if (dc && dt) return `-${dc}d${dt}${fb ? (fb > 0 ? '+' + fb : fb) : ''} HP`;
        return e.value ? `-${e.value} HP` : '-HP';
      }
      if (e.type === 'restore_mana') return `+${e.amount ?? e.value ?? 0} mana`;
      if (e.type === 'stat_boost')   return `+${e.value} ${e.stat} (${e.duration_turns || '?'}t)`;
      if (e.type === 'apply_status') return `apply status${e.duration_turns ? ` (${e.duration_turns}t)` : ''}`;
      if (e.type === 'remove_status') return `remove ${e.status_name || 'status'}`;
      if (e.type === 'custom')       return e.description || 'custom effect';
      // Legacy names
      if (e.type === 'heal')         return `+${e.value} HP`;
      if (e.type === 'mana_restore') return `+${e.value} mana`;
      return e.description || e.type || '';
    }).filter(Boolean);
    if (parts.length) return parts.join(' · ');
    return it.description || '';
  } catch { return it.description || ''; }
}

function _mountItemConfirm(panel, it) {
  const area = panel.querySelector('#ip-confirm-area');
  if (!area) return;
  const rarityCls = it.rarity ? ` rarity-${it.rarity}` : '';
  // Rework v3 — consumables can target Self or a teammate. Build a Self + living
  // teammates dropdown; default to the currently selected table target (if it is
  // not Self), otherwise Self. Previously this modal shipped no target_id at all,
  // so potions "used on a teammate" were silently applied to the caster instead.
  const _teammates = (tableParticipants || [])
    .filter(t => t && t.id !== CHAR_ID && t.is_alive !== false);
  const _hasTeammates = _teammates.length > 0;
  const _defaultTargetId = (selectedTargetId && selectedTargetId !== CHAR_ID)
    ? selectedTargetId : CHAR_ID;
  const _targetOptions = [
    `<option value="${CHAR_ID}"${_defaultTargetId === CHAR_ID ? ' selected' : ''}>Self (${char?.name || 'me'})</option>`,
    ..._teammates.map(t => `<option value="${t.id}"${t.id === _defaultTargetId ? ' selected' : ''}>${t.is_npc ? '🎭 ' : '👤 '}${t.name}</option>`),
  ].join('');

  area.innerHTML = `
    <div style="padding:8px;background:var(--bg-surface);border-radius:var(--r-sm);border:1px solid var(--border-active)">
      <div style="font-weight:700;margin-bottom:3px"><span class="${rarityCls}">${it.name}</span></div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:4px">${_summarizeUseEffect(it) || it.description || ''}</div>
      ${it.mana_cost ? `<div style="font-size:0.72rem;color:#60a5fa;margin-bottom:6px">🔮 ${it.mana_cost} mana</div>` : ''}
      ${_hasTeammates ? `<div style="margin-bottom:6px">
        <label style="font-size:0.75rem">Target:
          <select id="ip-target" style="font-size:0.8rem;margin-left:4px;min-width:160px">${_targetOptions}</select>
        </label>
      </div>` : ''}
      <div style="display:flex;gap:6px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" id="ip-back">← Back</button>
        <button class="btn btn-primary btn-sm" id="ip-use">Use</button>
      </div>
      <div id="ip-result" style="margin-top:6px;font-size:0.78rem"></div>
    </div>`;
  area.querySelector('#ip-back').addEventListener('click', _closeConfirmPanel);
  area.querySelector('#ip-use').addEventListener('click', async () => {
    const resultEl = area.querySelector('#ip-result');
    resultEl.innerHTML = '<span class="text-muted">Using...</span>';
    const hpBefore = char?.current_hp ?? 0;
    try {
      // Rework v3 — include target_id so the server applies heal / buff / status
      // to the chosen character instead of defaulting to the caster.
      const _sel = area.querySelector('#ip-target');
      const _tid = _sel ? parseInt(_sel.value) : CHAR_ID;
      const _body = (_tid && _tid !== CHAR_ID) ? { target_id: _tid } : {};
      const res = await api.post(`/api/inventory/${it.inventory_id}/use`, _body);
      const results = res.results || [];
      let out = results.length ? results.map(r => `<div>• ${r}</div>`).join('') : '<div>✅ Used</div>';
      await loadChar();
      await loadInventory();
      const hpAfter = char?.current_hp ?? hpBefore;
      if (hpAfter !== hpBefore) {
        out = `<div style="font-weight:700;margin-bottom:3px">HP: ${hpBefore} → ${hpAfter}</div>` + out;
      }
      resultEl.innerHTML = out;
      const logIcon = (it.is_potion && it.potion_icon) ? it.potion_icon
                    : ((it.category||'').toLowerCase() === 'potion' ? '🧪' : '🎒');
      results.forEach(r => addLog(`${logIcon} ${it.name}: ${r}`));
    } catch (e) {
      const d = e?.body?.detail;
      resultEl.innerHTML = `<span style="color:var(--accent-red)">${typeof d === 'object' ? (d.message || JSON.stringify(d)) : (d || 'Failed')}</span>`;
    }
  });
}

// ══════════════════════════════════════════════════════════════
// FIX 4 — REACTIONS PANEL (combat-only, collapsible)
// ══════════════════════════════════════════════════════════════
let _reactionsCollapsed = false;

function _hasCombatActive() {
  return !!(playerCombat && playerCombat.status === 'active');
}

function _myReactions() {
  return (abilitiesData || []).filter(a =>
    a.ability_type === 'reaction' && a.is_unlocked !== false
  );
}

function showReactionsPanel() {
  const panel = document.getElementById('reactions-panel');
  if (!panel) return;
  const reactions = _myReactions();
  if (!reactions.length) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';
  renderReactionsPanel();
}

function hideReactionsPanel() {
  const panel = document.getElementById('reactions-panel');
  if (panel) panel.style.display = 'none';
}

function renderReactionsPanel() {
  const panel = document.getElementById('reactions-panel');
  const list  = document.getElementById('reactions-list');
  if (!panel || !list) return;
  const reactions = _myReactions();
  // Hide if no combat or no reactions
  if (!_hasCombatActive() || !reactions.length) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = '';

  const cur = char?.mana_current ?? 0;
  list.innerHTML = reactions.map(a => {
    const onCd = (a.cooldown_remaining || 0) > 0;
    const notEnoughMana = (a.mana_cost || 0) > cur;
    const disabled = onCd || notEnoughMana;
    const color = a.color || 'var(--accent-orange)';
    return `<div class="reaction-card ${disabled ? 'disabled' : ''}" data-ca-id="${a.character_ability_id}"
             style="display:flex;align-items:center;gap:8px;padding:8px 10px;
                    background:var(--bg-surface);border-left:3px solid ${color};
                    border-radius:var(--r-sm);transition:all .15s;
                    opacity:${disabled ? '0.55' : '1'}">
      <span style="font-size:1.2rem">${a.icon || '⚡'}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:0.85rem">${a.name}</div>
        ${a.flavor_text ? `<div style="font-size:0.7rem;color:var(--text-muted)">${a.flavor_text}</div>` : ''}
      </div>
      ${a.mana_cost ? `<span style="font-size:0.72rem;color:${notEnoughMana ? 'var(--accent-red)' : '#60a5fa'}">🔮${a.mana_cost}</span>` : ''}
      ${a.hp_cost   ? `<span style="font-size:0.72rem;color:var(--accent-red)">❤️${a.hp_cost}</span>` : ''}
      ${onCd ? `<span style="font-size:0.72rem;color:var(--accent-orange);font-weight:600">Used this round</span>` : ''}
      ${!disabled ? `<button class="btn btn-primary btn-sm" data-use-reaction="${a.character_ability_id}">Use</button>` : ''}
    </div>`;
  }).join('');

  // Wire Use buttons (route to same ability picker/confirm flow for consistency)
  list.querySelectorAll('[data-use-reaction]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const caId = parseInt(btn.dataset.useReaction);
      const ab = abilitiesData.find(a => a.character_ability_id === caId);
      if (!ab) return;
      // Open the action confirmation flow (mount ability confirm directly)
      const body = $('#action-menu-body');
      if (!body) return;
      // Scroll to action menu for visibility
      body.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const html = `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
          <span style="font-size:1.2rem">⚡</span>
          <span style="font-weight:700;flex:1">Reaction: ${ab.name}</span>
          <button class="btn btn-ghost btn-xs" id="ap-close">✕</button>
        </div>
        <div id="ap-confirm-area"></div>`;
      const panel2 = _mountConfirmPanel(html);
      if (!panel2) return;
      panel2.querySelector('#ap-close').addEventListener('click', _closeConfirmPanel);
      _mountAbilityConfirm(panel2, ab);
    });
  });
}

async function refreshReactionCooldowns() {
  // Re-fetch abilities so cooldown_remaining values reflect current round
  try {
    abilitiesData = await api.get(`/api/characters/${CHAR_ID}/abilities`);
  } catch {}
  renderReactionsPanel();
  renderActionMenu();
}

// Collapse/expand toggle
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'reactions-toggle') {
    _reactionsCollapsed = !_reactionsCollapsed;
    const content = document.getElementById('reactions-content');
    const btn = document.getElementById('reactions-toggle');
    if (content) content.style.display = _reactionsCollapsed ? 'none' : '';
    if (btn) btn.textContent = _reactionsCollapsed ? '▶' : '▼';
  }
});

// ══════════════════════════════════════════════════════════════
// PHASE 6 — ACTIVE BONUSES & PENALTIES PANEL
// ══════════════════════════════════════════════════════════════
async function renderBonusesPenalties() {
  const bonusEl = $('#active-bonuses-list');
  const penaltyEl = $('#active-penalties-list');
  if (!bonusEl || !penaltyEl) return;

  // Bonuses from equipped items + passive abilities + active status buffs
  try {
    const data = await api.get(`/api/characters/${CHAR_ID}/equipped-bonuses`);
    // API returns { breakdown: [{source, bonus_type, stat_name, value}], + aggregated keys }
    const bonuses = Array.isArray(data.breakdown) ? data.breakdown.slice() : (data.bonuses || []);
    // Also show passive ability bonuses
    const passiveAbs = (abilitiesData || []).filter(a => a.ability_type === 'passive' && a.is_unlocked !== false);
    for (const pa of passiveAbs) {
      const pe = pa.passive_effect || {};
      const pBonuses = pe.bonuses || [];
      for (const pb of pBonuses) {
        bonuses.push({ value: pb.value, bonus_type: pb.bonus_type, stat_name: pb.stat_name, source: `${pa.icon||'🔵'} ${pa.name} (passive)` });
      }
    }
    // Also show active status effect buffs (positive values)
    try {
      const effects = await api.get(`/api/characters/${CHAR_ID}/status-effects`);
      for (const se of (effects || [])) {
        const effs = typeof se.effects === 'string' ? JSON.parse(se.effects) : (se.effects || []);
        for (const e of effs) {
          const v = Number(e.value || 0);
          if (v > 0 && !String(e.type||'').includes('penalty')) {
            bonuses.push({
              value: v,
              bonus_type: e.type || 'bonus',
              stat_name: e.stat_name || null,
              source: `${se.icon || '✨'} ${se.name}`,
            });
          }
        }
      }
    } catch {}
    if (bonuses.length) {
      bonusEl.innerHTML = bonuses.map(b => {
        const label = b.stat_name
          ? `${b.stat_name.toUpperCase()} ${b.value > 0 ? '+' : ''}${b.value}`
          : `${b.bonus_type.replace(/_/g,' ')} ${b.value > 0 ? '+' : ''}${b.value}`;
        return `<div style="margin-bottom:3px"><span style="color:var(--accent-green)">${label}</span> <span style="color:var(--text-muted)">from ${b.source}</span></div>`;
      }).join('');
    } else {
      bonusEl.innerHTML = '<span class="text-muted">No active bonuses</span>';
    }
  } catch (e) { console.warn('bonuses:', e); bonusEl.innerHTML = '<span class="text-muted">No active bonuses</span>'; }

  // Penalties from status effects
  try {
    const effects = await api.get(`/api/characters/${CHAR_ID}/status-effects`);
    const entries = [];
    for (const se of (effects || [])) {
      const effs = typeof se.effects === 'string' ? JSON.parse(se.effects) : (se.effects || []);
      for (const e of effs) {
        if (e.value && e.value < 0 || e.type?.includes('penalty') || e.type === 'skip_turn') {
          entries.push(`${se.icon || '⚠️'} ${se.name}: ${e.type.replace(/_/g,' ')} ${e.value || ''}`);
        }
      }
    }
    penaltyEl.innerHTML = entries.length ?
      entries.map(e => `<div style="margin-bottom:3px">${e}</div>`).join('') :
      '<span class="text-muted">No active penalties</span>';
  } catch { penaltyEl.innerHTML = '<span class="text-muted">No active penalties</span>'; }
}

// ══════════════════════════════════════════════════════════════
// PHASE 6 — ABILITIES TAB
// ══════════════════════════════════════════════════════════════
let abilitiesData = [];

async function loadAbilities() {
  try {
    abilitiesData = await api.get(`/api/characters/${CHAR_ID}/abilities`);
    renderAbilities();
    renderActionMenu();     // FIX 2: refresh action cards (Ability card visibility)
    if (typeof renderReactionsPanel === 'function') renderReactionsPanel();  // FIX 4
  } catch (e) { console.warn('loadAbilities:', e); }
}

function renderAbilities() {
  const grid = $('#abilities-grid');
  if (!grid) return;

  // Separate by type
  const active = abilitiesData.filter(a => a.ability_type !== 'passive' && a.ability_type !== 'reaction');
  const passive = abilitiesData.filter(a => a.ability_type === 'passive');
  const reactions = abilitiesData.filter(a => a.ability_type === 'reaction');

  if (!abilitiesData.length) {
    grid.innerHTML = '<span class="text-muted" style="font-size:0.8rem">No abilities learned yet</span>';
    return;
  }

  function renderCard(a) {
    const onCd = a.cooldown_remaining > 0;
    const typeBadge = a.ability_type === 'passive' ? '🔵' : a.ability_type === 'reaction' ? '⚡' : '';
    const costParts = [];
    if (a.mana_cost) costParts.push(`🔮 ${a.mana_cost}`);
    if (a.hp_cost) costParts.push(`❤️ ${a.hp_cost}`);
    // Rework v2: uses counter + conditional flavor + rarity chip
    const hasUses = a.current_uses !== null && a.current_uses !== undefined;
    const maxUses = a.max_uses;
    const depleted = hasUses && a.current_uses <= 0;
    const usesTag = hasUses
      ? `<span class="ab-uses ${depleted ? 'depleted' : ''}" title="Uses remaining">⚡ ${a.current_uses}${maxUses ? ` / ${maxUses}` : ''}</span>`
      : '';
    const condTag = a.is_conditional
      ? `<span class="ab-cond" title="${(a.conditional_text || 'GM discretion').replace(/"/g,'&quot;')}">※ Conditional</span>`
      : '';
    const rarity = a.rarity || 'common';
    const rarityChip = `<span class="rarity-chip rarity-${rarity}">${rarity}</span>`;
    const clickable = !onCd && a.ability_type !== 'passive' && !depleted;
    return `<div class="ability-card ${onCd ? 'on-cooldown' : ''} ${depleted ? 'depleted' : ''} ${a.ability_type === 'passive' ? 'passive' : ''}" data-ca-id="${a.character_ability_id}" style="border-left:3px solid ${a.color||'#60a5fa'}">
      <div class="ab-name">${a.icon||'⚡'} ${a.name} ${typeBadge} ${rarityChip}</div>
      <div class="ab-meta" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:2px">
        ${costParts.length ? `<span class="ab-cost">${costParts.join(' · ')}</span>` : ''}
        ${usesTag}
        ${condTag}
        ${onCd ? `<span class="ab-cd">⏳ ${a.cooldown_remaining} turns</span>` : ''}
        ${a.cooldown_turns && !onCd ? `<span class="ab-cd" style="opacity:0.5">CD: ${a.cooldown_turns}t</span>` : ''}
      </div>
      ${a.damage_dice_count ? `<div style="font-size:0.68rem;color:var(--text-muted);margin-top:2px">${a.damage_dice_count}d${a.damage_dice_type} ${a.damage_type||''}</div>` : ''}
      <div class="ab-desc">${a.flavor_text || a.description || ''}</div>
      ${!clickable && a.ability_type !== 'passive' ? '<div class="ab-locked-note">Not usable</div>' : ''}
    </div>`;
  }

  let html = '';
  if (active.length) {
    html += '<div style="font-weight:700;font-size:0.82rem;margin-bottom:4px">🟢 Active</div>';
    html += active.map(renderCard).join('');
  }
  if (reactions.length) {
    html += '<div style="font-weight:700;font-size:0.82rem;margin:8px 0 4px">⚡ Reactions</div>';
    html += reactions.map(renderCard).join('');
  }
  if (passive.length) {
    html += '<div style="font-weight:700;font-size:0.82rem;margin:8px 0 4px">🔵 Passive</div>';
    html += passive.map(renderCard).join('');
  }
  grid.innerHTML = html;

  // Wire active + reaction click-to-use (not passive, not depleted, not on CD)
  grid.querySelectorAll('.ability-card:not(.on-cooldown):not(.passive):not(.depleted)').forEach(card => {
    card.addEventListener('click', async () => {
      const caId = card.dataset.caId;
      const ab = abilitiesData.find(a => a.character_ability_id == caId);
      if (!ab) return;
      const costs = [];
      if (ab.mana_cost) costs.push(`${ab.mana_cost} mana`);
      if (ab.hp_cost) costs.push(`${ab.hp_cost} HP`);
      const costStr = costs.length ? ` (costs ${costs.join(' + ')})` : '';
      if (!confirm(`Use ${ab.name}?${costStr}`)) return;
      try {
        const body = {};
        if (selectedTargetId) body.target_id = selectedTargetId;
        const res = await api.post(`/api/character-abilities/${caId}/use`, body);
        if (res.results) res.results.forEach(r => addLog(`✨ ${ab.name}: ${r}`));
        await loadChar();
        loadAbilities();
      } catch (e) {
        const d = e?.body?.detail;
        showToast(typeof d === 'object' ? d.message : String(d || 'Failed'), 'error');
      }
    });
  });
}

// ══════════════════════════════════════════════════════════════
// PHASE 6 — MEMORY TAB
// ══════════════════════════════════════════════════════════════
let memoryData = [];

async function loadMemory() {
  try {
    memoryData = await api.get(`/api/characters/${CHAR_ID}/memory`);
    renderMemory();
  } catch (e) { console.warn('loadMemory:', e); }
}

function renderMemory() {
  const list = $('#memory-list');
  if (!list) return;
  const search = ($('#memory-search')?.value || '').toLowerCase();
  let filtered = memoryData;
  if (search) {
    filtered = memoryData.filter(m =>
      m.title.toLowerCase().includes(search) || m.content.toLowerCase().includes(search)
    );
  }
  if (!filtered.length) {
    list.innerHTML = '<span class="text-muted" style="font-size:0.8rem">No journal entries</span>';
    return;
  }

  // Group by type
  const groups = { npc_encounter: [], event: [], note: [] };
  filtered.forEach(m => {
    const g = groups[m.entry_type] || groups.note;
    g.push(m);
  });

  let html = '';
  const labels = { npc_encounter: '👤 NPC Encounters', event: '📍 Events', note: '📝 My Notes' };
  for (const [type, entries] of Object.entries(groups)) {
    if (!entries.length) continue;
    html += `<div style="font-weight:700;font-size:0.82rem;margin:8px 0 4px">${labels[type]}</div>`;
    html += entries.map(m => `<div class="memory-entry" data-mem-id="${m.id}">
      <div style="display:flex;align-items:center;gap:8px">
        <span class="me-title">${m.title}</span>
        <span class="me-type">${m.entry_type}</span>
        ${m.entry_type === 'note' ? `<button class="btn btn-ghost btn-xs" data-del-mem="${m.id}" style="margin-left:auto;color:var(--accent-red)">✕</button>` : ''}
      </div>
      <div class="me-content">${m.content || ''}</div>
    </div>`).join('');
  }
  list.innerHTML = html;

  // Click to expand
  list.querySelectorAll('.memory-entry').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('[data-del-mem]')) return;
      el.classList.toggle('expanded');
    });
  });

  // Delete
  list.querySelectorAll('[data-del-mem]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this note?')) return;
      await api.del(`/api/memory/${btn.dataset.delMem}`);
      loadMemory();
    });
  });
}

// Add note button
if ($('#btn-add-memory')) {
  $('#btn-add-memory').addEventListener('click', async () => {
    const title = prompt('Note title:');
    if (!title) return;
    const content = prompt('Note content:');
    await api.post(`/api/characters/${CHAR_ID}/memory`, {
      entry_type: 'note', title, content: content || '',
    });
    loadMemory();
  });
}

// Search filter
if ($('#memory-search')) {
  $('#memory-search').addEventListener('input', () => renderMemory());
}

// WS listeners for Phase 6
ws.on('ability.cooldown_ready', d => {
  if (d.character_id == CHAR_ID) {
    showToast(`✨ ${d.ability_name} is ready!`);
    loadAbilities();
  }
});
ws.on('combat.attack_result', d => {
  if (d.target_id == CHAR_ID || d.attacker_id == CHAR_ID) {
    loadChar();
    loadTableView();
  }
  // HP of attacker/target may have changed — grid bars need to catch up,
  // regardless of whether CHAR_ID was involved.
  loadPlayerMapState();
});
ws.on('combat.character_downed', d => {
  loadTableView();
  loadPlayerMapState();
});
ws.on('table.updated', () => {
  loadTableView();
  loadPlayerMapState();
});
// FIX 1: Re-render table on HP, status, or turn change.
// Rework v3 Phase 1: the embedded battle grid renders token HP bars from
// the same data, so we refresh the map state in lock-step. `loadPlayerMapState`
// is cheap (two GETs) and coalescing would be premature given real-world
// tick rates.
const _refreshBoth = () => { loadTableView(); loadPlayerMapState(); };
ws.on('character.hp_changed', _refreshBoth);
ws.on('character.hp_update',  _refreshBoth);
ws.on('character.status_changed', _refreshBoth);
ws.on('status_effect.applied',  _refreshBoth);
ws.on('status_effect.removed',  _refreshBoth);
ws.on('status_effect.expired',  _refreshBoth);
// FIX 5: Auto-populate Memory tab — refresh + toast on new entry
ws.on('memory.entry_added', d => {
  if (d.character_id != CHAR_ID) return;
  const typeIcon = d.entry_type === 'npc_encounter' ? '👥'
                 : d.entry_type === 'event' ? '📜'
                 : '📝';
  showToast(`${typeIcon} ${d.title}`);
  loadMemory();
});

// FIX 4: Log OTHER players' free-rolls (own roll is logged locally by the widget to avoid duplication)
ws.on('roll.free_roll', d => {
  if (d.character_id == CHAR_ID) return;
  addLog(`🎲 ${d.character_name || 'Someone'}: ${d.breakdown}`);
});

// ══════════════════════════════════════════════════════════════
// FIX 4 — FREE DICE ROLL (any dice/count/adv, optional private)
// ══════════════════════════════════════════════════════════════
function _rollOne(die) { return Math.floor(Math.random() * die) + 1; }

function initFreeRollWidget() {
  const host = document.getElementById('free-roll-widget-host');
  if (!host || typeof createDiceRollWidget !== 'function') return;

  createDiceRollWidget(host, {
    label: '',
    defaultDiceCount: 1,
    defaultDiceType:  20,
    showDiceSelector: true,
    showAdvantage:    true,
    showRollButton:   true,
    rollButtonText:   'Roll',
    onRoll: async ({ diceCount, diceType, advantageMode }) => {
      // Roll locally (free roll doesn't need a backend endpoint)
      const rollSet = () => Array.from({ length: diceCount }, () => _rollOne(diceType));
      let rolls = rollSet();
      let chosen = rolls;
      let allRolls = rolls.slice();

      if (advantageMode !== 'normal') {
        const second = rollSet();
        allRolls = rolls.slice();
        // Compare sums; pick winning set
        const sumA = rolls.reduce((a, b) => a + b, 0);
        const sumB = second.reduce((a, b) => a + b, 0);
        if (advantageMode === 'advantage') chosen = sumA >= sumB ? rolls : second;
        else                                chosen = sumA <= sumB ? rolls : second;
        allRolls = allRolls.concat(second);
      }

      const total = chosen.reduce((a, b) => a + b, 0);
      const diceLabel = `${diceCount}d${diceType}`;
      let breakdown;
      if (advantageMode === 'advantage') {
        breakdown = `ADV: ${diceLabel}[${rolls.join(',')}] vs [${allRolls.slice(diceCount).join(',')}] → took [${chosen.join(',')}] = ${total}`;
      } else if (advantageMode === 'disadvantage') {
        breakdown = `DISADV: ${diceLabel}[${rolls.join(',')}] vs [${allRolls.slice(diceCount).join(',')}] → took [${chosen.join(',')}] = ${total}`;
      } else {
        breakdown = `${diceLabel}[${chosen.join(',')}] = ${total}`;
      }

      // WS broadcast — private toggle controls GM visibility
      const isPrivate = !!document.getElementById('free-roll-private')?.checked;
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({
          type: 'roll.free_roll',
          character_id: CHAR_ID,
          character_name: char?.name,
          dice_count: diceCount,
          dice_type:  diceType,
          advantage_mode: advantageMode,
          rolls: chosen,
          total, breakdown,
          private: isPrivate,
        }));
      }

      // Log locally always
      addLog(`🎲 ${breakdown}${isPrivate ? ' (private)' : ''}`);
      addRollHistory('free', breakdown, total);

      return { total, breakdown };
    },
  });
}

// ══════════════════════════════════════════════════════════════
// Rework v2 — LEVEL-UP MODAL
// ══════════════════════════════════════════════════════════════
const _RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const _STAT_KEYS = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

function openLevelUpModal() {
  if (document.getElementById('levelup-modal')) return;
  if (!char) return;

  const level = char.level ?? 0;
  const xp = char.experience || 0;
  const thresh = 100 + 100 * Math.max(0, level);
  if (xp < thresh) {
    showToast(`Need ${thresh - xp} more XP to level up.`, 'warn');
    return;
  }

  // Race HP die copy (if no race, backend defaults to 1d8)
  const hpCount = char.race?.hp_dice_count || char.hp_dice_count || 1;
  const hpDie   = char.race?.hp_die       || char.hp_die       || 8;
  const hpDieStr = `${hpCount}d${hpDie}`;

  // Upgradeable abilities (not legendary)
  const upgradable = (abilitiesData || []).filter(a => {
    const r = (a.rarity || 'common').toLowerCase();
    return _RARITY_ORDER.indexOf(r) < _RARITY_ORDER.length - 1;
  });

  let mode = 'stats';          // 'stats' | 'upgrade_feature'
  let statA = null, statB = null;
  let pickedCabId = null;

  const overlay = document.createElement('div');
  overlay.id = 'levelup-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:520px">
      <h2 style="margin:0 0 4px">⬆ Level ${level} → ${level + 1}</h2>
      <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:10px">
        Your racial HP die (<strong>${hpDieStr}</strong>) will be rolled on confirm — result is server-side.
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <div class="lvlup-choice ${mode==='stats'?'selected':''}" data-mode="stats">
          <div class="lc-title">+1 to two stats</div>
          <div class="lc-sub">Each stat is the roll bonus itself — STR 3 means +3 to strength rolls.</div>
        </div>
        <div class="lvlup-choice ${mode==='upgrade_feature'?'selected':''} ${upgradable.length ? '' : 'disabled'}" data-mode="upgrade_feature"
             ${upgradable.length ? '' : 'title="You need at least one non-legendary feature"'}>
          <div class="lc-title">Upgrade a feature</div>
          <div class="lc-sub">Auto d4-roll into the next-rarity bucket of the GM's starting pool.</div>
        </div>
      </div>

      <!-- Stats picker -->
      <div id="lvlup-stats-pane" style="margin-bottom:12px">
        <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:6px">Pick two DIFFERENT stats to boost:</div>
        <div id="lvlup-stat-pills" style="display:flex;flex-wrap:wrap;gap:6px"></div>
      </div>

      <!-- Feature picker -->
      <div id="lvlup-feature-pane" style="display:none;margin-bottom:12px">
        <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:6px">Pick the feature to upgrade:</div>
        <div id="lvlup-feature-list" style="display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto"></div>
        <div style="font-size:0.68rem;color:var(--text-muted);font-style:italic;margin-top:6px">
          The server will roll a d4 against the pool of the next rarity and replace the chosen feature.
        </div>
      </div>

      <div id="lvlup-error" class="error-msg" style="color:var(--accent-red);font-size:0.78rem;min-height:14px;margin-bottom:6px"></div>

      <div style="display:flex;gap:6px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" id="lvlup-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="lvlup-confirm" disabled>⚔ Confirm & Roll</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#lvlup-cancel').addEventListener('click', () => overlay.remove());

  const err = overlay.querySelector('#lvlup-error');
  const confirmBtn = overlay.querySelector('#lvlup-confirm');
  const statsPane  = overlay.querySelector('#lvlup-stats-pane');
  const featPane   = overlay.querySelector('#lvlup-feature-pane');
  const statPills  = overlay.querySelector('#lvlup-stat-pills');
  const featList   = overlay.querySelector('#lvlup-feature-list');

  function updateConfirmability() {
    err.textContent = '';
    if (mode === 'stats') {
      confirmBtn.disabled = !(statA && statB && statA !== statB);
    } else {
      confirmBtn.disabled = !pickedCabId;
    }
  }

  function renderStatPills() {
    statPills.innerHTML = _STAT_KEYS.map(s => {
      const val = char[s] ?? 0;
      const picked = (s === statA || s === statB);
      return `<span class="lvlup-stat-pill ${picked ? 'picked' : ''}" data-stat="${s}">
        ${s.slice(0,3).toUpperCase()} <span style="opacity:0.7;margin-left:4px">${val} → ${picked ? val + 1 : val}</span>
      </span>`;
    }).join('');
    statPills.querySelectorAll('.lvlup-stat-pill').forEach(p => {
      p.addEventListener('click', () => {
        const s = p.dataset.stat;
        if (s === statA) { statA = null; }
        else if (s === statB) { statB = null; }
        else if (!statA) { statA = s; }
        else if (!statB) { statB = s; }
        else { statA = statB; statB = s; }  // rotate: FIFO replace
        renderStatPills();
        updateConfirmability();
      });
    });
  }

  function renderFeatureList() {
    if (!abilitiesData || !abilitiesData.length) {
      featList.innerHTML = '<span class="text-muted" style="font-size:0.78rem">You have no features yet.</span>';
      return;
    }
    featList.innerHTML = abilitiesData.map(a => {
      const r = (a.rarity || 'common').toLowerCase();
      const isLegendary = _RARITY_ORDER.indexOf(r) >= _RARITY_ORDER.length - 1;
      const nextR = !isLegendary ? _RARITY_ORDER[_RARITY_ORDER.indexOf(r) + 1] : null;
      return `<div class="lvlup-feature-row ${isLegendary ? 'legendary' : ''} ${pickedCabId === a.character_ability_id ? 'picked' : ''}"
                   data-cab-id="${a.character_ability_id}">
        <span style="font-size:1rem">${a.icon || '⚡'}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:0.85rem">${a.name}</div>
          <div style="font-size:0.7rem;color:var(--text-muted)">${a.flavor_text || a.description || ''}</div>
        </div>
        <span class="rarity-chip rarity-${r}">${r}</span>
        ${nextR ? `<span style="font-size:0.66rem;color:var(--text-muted)">→</span><span class="rarity-chip rarity-${nextR}">${nextR}</span>`
                : `<span style="font-size:0.66rem;color:var(--text-muted)">max</span>`}
      </div>`;
    }).join('');
    featList.querySelectorAll('.lvlup-feature-row:not(.legendary)').forEach(row => {
      row.addEventListener('click', () => {
        pickedCabId = parseInt(row.dataset.cabId);
        featList.querySelectorAll('.lvlup-feature-row').forEach(r => r.classList.toggle('picked', r === row));
        updateConfirmability();
      });
    });
  }

  overlay.querySelectorAll('.lvlup-choice').forEach(card => {
    card.addEventListener('click', () => {
      if (card.classList.contains('disabled')) return;
      mode = card.dataset.mode;
      overlay.querySelectorAll('.lvlup-choice').forEach(c => c.classList.toggle('selected', c === card));
      statsPane.style.display = mode === 'stats' ? '' : 'none';
      featPane .style.display = mode === 'upgrade_feature' ? '' : 'none';
      updateConfirmability();
    });
  });

  renderStatPills();
  renderFeatureList();
  updateConfirmability();

  overlay.querySelector('#lvlup-confirm').addEventListener('click', async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Rolling…';
    const payload = { choice: mode };
    if (mode === 'stats') { payload.stat_a = statA; payload.stat_b = statB; }
    else                  { payload.character_ability_id = pickedCabId; }

    try {
      const res = await api.post(`/api/characters/${CHAR_ID}/level-up`, payload);
      const rolls = (res.chosen?.hp_rolls || []).join(' + ');
      const total = res.chosen?.hp_gained ?? '?';
      overlay.innerHTML = `
        <div class="modal-content" style="max-width:480px;text-align:center">
          <h2 style="margin-top:0">🎉 Level ${res.level} achieved!</h2>
          <div style="font-size:2rem;font-weight:800;color:var(--accent-green);margin:8px 0">+${total} HP</div>
          <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:10px">
            ${res.chosen?.hp_dice_count}d${res.chosen?.hp_die}: ${rolls || '?'}
          </div>
          ${res.chosen?.choice === 'stats'
            ? `<div style="font-size:0.86rem">+1 <strong>${res.chosen.stat_a}</strong> · +1 <strong>${res.chosen.stat_b}</strong></div>`
            : `<div style="font-size:0.86rem">Upgraded to <span class="rarity-chip rarity-${res.chosen.new_rarity}">${res.chosen.new_rarity}</span> — rolled d${res.chosen.d_size} = ${res.chosen.d_rolled}</div>`}
          <div style="font-size:0.78rem;color:var(--text-muted);margin-top:8px">
            Next threshold: <strong>${res.xp_to_next}</strong> XP
          </div>
          <button class="btn btn-primary btn-sm" id="lvlup-close" style="margin-top:14px">Continue</button>
        </div>`;
      overlay.querySelector('#lvlup-close').addEventListener('click', () => overlay.remove());
      addLog(`⬆ Level ${res.level} · +${total} HP · ${res.chosen?.choice === 'stats' ? `+${res.chosen.stat_a}/${res.chosen.stat_b}` : `upgrade → ${res.chosen.new_rarity}`}`);
      await loadChar();
      await loadAbilities();
    } catch (e) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = '⚔ Confirm & Roll';
      const d = e?.body?.detail;
      err.textContent = typeof d === 'object' ? (d.message || JSON.stringify(d)) : (d || e.message || 'Level-up failed');
    }
  });
}

// Wire the Level-up CTA once at load.
document.addEventListener('click', e => {
  if (e.target && e.target.closest('#btn-level-up')) openLevelUpModal();
});

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════
loadChar();
loadInventory();
loadCurrency();
loadStatusEffects();
// Rework v3 Phase 1: always-on battle grid in the Main tab.
initPlayerMainGrid();
loadCombatBanner();
loadPlayerQuests();
loadPlayerAnnouncements();
loadPlayerNotes();
loadPlayerTimer();
restoreGmTimer();
loadTableView();
renderBonusesPenalties();
loadAbilities();  // FIX 2: load early so Action Menu (Main tab) knows abilities
initFreeRollWidget();  // FIX 4

// FIX 1: WS listeners for Table View updates
ws.on('table.updated', () => {
  loadTableView();
});

ws.on('character.hp_changed', d => {
  if (!d || !d.character_id) return;
  const cards = document.querySelectorAll(`[data-id="${d.character_id}"]`);
  cards.forEach(card => {
    const hpText = card.querySelector('.mini-hp-text');
    const hpBar = card.querySelector('.mini-hp-bar');
    if (hpText && d.current_hp !== undefined && d.max_hp !== undefined) {
      hpText.textContent = `${d.current_hp}/${d.max_hp}`;
    }
    if (hpBar && d.current_hp !== undefined && d.max_hp !== undefined) {
      const pct = d.max_hp > 0 ? Math.min(100, d.current_hp / d.max_hp * 100) : 0;
      hpBar.style.width = pct + '%';
    }
  });
});

ws.connect();
