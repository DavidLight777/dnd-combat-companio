// ════════════════════════════════════════════════════════
// Core: globals, helpers, loadChar, starting item wizard prelude
// Source: player-app.js lines 1-175
// ════════════════════════════════════════════════════════

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
let rulesSystem = sessionStorage.getItem('rules_system') || 'legacy';
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
async function loadSessionInfo() {
  try {
    const s = await api.get(`/api/sessions/${SESSION_CODE}`);
    rulesSystem = s.rules_system || 'legacy';
    sessionStorage.setItem('rules_system', rulesSystem);
    document.body.dataset.rulesSystem = rulesSystem;
    return s;
  } catch {
    document.body.dataset.rulesSystem = rulesSystem;
    return null;
  }
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
  try {
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
    const attrPoints = char.attribute_points_available || 0;
    const attrLabel = attrPoints > 0 ? ` · ${attrPoints} point${attrPoints > 1 ? 's' : ''}` : '';
    badges.push(`Lvl ${char.level ?? 0}${rankLabel}${attrLabel}`);
    const el = $('#char-rc-badges');
    if (el) el.textContent = badges.join(' · ');
    // Update sidebar identity line with same info
    const rcEl = $('#cs-rc');
    if (rcEl) rcEl.textContent = badges.join(' · ');
    // Render the dedicated Professions tab/panel
    renderProfessionsPanel(profs);
    // Rework Phase 7: check if the starting-item wizard is still open for this character
    maybeShowStartingItemWizard();
  } catch (e) {
    console.error('loadChar failed:', e);
    showToast('Failed to load character: ' + (e.message || 'unknown error'));
  }
}

// ══════════════════════════════════════════════════════════════
