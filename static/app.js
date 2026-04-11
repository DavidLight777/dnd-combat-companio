/* ═══════════════════════════════════════════════════════════════
   DnD Combat Companion — Frontend Application
   ═══════════════════════════════════════════════════════════════ */

// ── State ─────────────────────────────────────────────────────
let characters = [];
let activeCharId = null;
let calcLog = [];
let diceHistory = [];
let rollHistory = []; // full roll history with timestamps

// Enemy calc sidebar state (persists across character switches, resets on reload)
let enemyDefenses = [];
let enemyDefenseIdCounter = 0;

// ── Undo stack ───────────────────────────────────────────────
const undoStack = []; // { description, undo: async () => {} }
const UNDO_MAX = 15;
function pushUndo(description, undoFn) {
  undoStack.push({ description, undo: undoFn });
  if (undoStack.length > UNDO_MAX) undoStack.shift();
}
async function performUndo() {
  if (!undoStack.length) return;
  const action = undoStack.pop();
  try { await action.undo(); } catch (e) { console.warn('Undo failed:', e); }
  await refreshChar();
  renderAll();
  renderTabs();
  showUndoToast(`Undone: ${action.description}`);
}
function showUndoToast(msg) {
  document.querySelectorAll('.undo-toast').forEach(t => t.remove());
  const toast = document.createElement('div');
  toast.className = 'undo-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

// ── SVG Icon system ──────────────────────────────────────────
const ICONS = {
  swords: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/><path d="M14.5 6.5L18 3h3v3l-3.5 3.5"/><path d="M5 14l4 4"/><path d="M7 17l-3 3"/></svg>',
  shield: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  heart: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  clock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  sparkles: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z"/></svg>',
  scroll: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h12a2 2 0 002-2v-2H10v2a2 2 0 01-2 2zm0 0a2 2 0 01-2-2V5a2 2 0 012-2h12v16"/></svg>',
  target: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
  dice: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="3"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/><circle cx="16" cy="8" r="1.5" fill="currentColor"/><circle cx="8" cy="16" r="1.5" fill="currentColor"/><circle cx="16" cy="16" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>',
  chart: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  settings: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
  download: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  undo: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 105.64-11.36L1 10"/></svg>',
  explosion: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
};
function icon(name, size) {
  const s = size || 16;
  return (ICONS[name] || '').replace(/width="16"/g, `width="${s}"`).replace(/height="16"/g, `height="${s}"`);
}

// ── Sound engine (Web Audio API, no files) ───────────────────
const SFX = { enabled: true };
function initAudio() {
  try { SFX.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { SFX.enabled = false; }
}
function playSound(type) {
  if (!SFX.enabled || !SFX.ctx) return;
  const ctx = SFX.ctx;
  if (ctx.state === 'suspended') ctx.resume();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.value = 0.12;
  const now = ctx.currentTime;
  if (type === 'dice') {
    osc.type = 'square'; osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.start(now); osc.stop(now + 0.2);
  } else if (type === 'hit') {
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.start(now); osc.stop(now + 0.25);
  } else if (type === 'heal') {
    osc.type = 'sine'; osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.start(now); osc.stop(now + 0.3);
  } else if (type === 'turn') {
    osc.type = 'triangle'; osc.frequency.setValueAtTime(600, now);
    osc.frequency.setValueAtTime(800, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.start(now); osc.stop(now + 0.2);
  } else if (type === 'click') {
    osc.type = 'sine'; osc.frequency.setValueAtTime(1000, now);
    gain.gain.value = 0.06;
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.start(now); osc.stop(now + 0.05);
  } else if (type === 'undo') {
    osc.type = 'sine'; osc.frequency.setValueAtTime(600, now);
    osc.frequency.exponentialRampToValueAtTime(300, now + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.start(now); osc.stop(now + 0.2);
  }
}

// ── Roll history ─────────────────────────────────────────────
function addRollHistory(type, description, result) {
  rollHistory.unshift({ time: timeStr(), type, description, result, charName: getChar()?.name || '?' });
  if (rollHistory.length > 50) rollHistory.pop();
}

// ── Avatar & Color constants ─────────────────────────────────
const AVATARS = ['⚔️','🛡️','🏹','🔮','🗡️','🪄','🔥','❄️','⚡','🌿','💀','🐉'];
const CHAR_COLORS = [
  '#c0832a', '#b84040', '#4a9c5d', '#3b82c4', '#9b59b6',
  '#e67e22', '#1abc9c', '#e74c8a', '#6c5ce7', '#fd7979',
];
function getCharMeta(charId) {
  const saved = JSON.parse(localStorage.getItem('dnd-char-meta') || '{}');
  return saved[charId] || { avatar: '⚔️', color: '#c0832a' };
}
function setCharMeta(charId, meta) {
  const saved = JSON.parse(localStorage.getItem('dnd-char-meta') || '{}');
  saved[charId] = { ...saved[charId], ...meta };
  localStorage.setItem('dnd-char-meta', JSON.stringify(saved));
}

// ── API helpers ───────────────────────────────────────────────
const api = {
  async get(url) { const r = await fetch(url); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async post(url, body) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async put(url, body) { const r = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async patch(url, body) { const r = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async del(url) { const r = await fetch(url, { method: 'DELETE' }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
};

// ── Utilities ─────────────────────────────────────────────────
function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }
function timeStr() { const d = new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
function getChar() { return characters.find(c => c.id === activeCharId); }
function initials(name) { return name.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2); }

function addLog(text) {
  calcLog.unshift({ time: timeStr(), text });
  if (calcLog.length > 20) calcLog.pop();
  renderLog();
}

function flash(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 500);
}

// Select all text on focus for number/text inputs
document.addEventListener('focusin', e => {
  if (e.target.matches('input[type="number"], input[type="text"]')) {
    setTimeout(() => e.target.select(), 0);
  }
});

// ── Confirm dialog ────────────────────────────────────────────
function confirmAction(msg) {
  return new Promise(resolve => {
    $('#confirm-msg').textContent = msg;
    $('#confirm-dialog').classList.remove('hidden');
    const yes = $('#confirm-yes');
    const no = $('#confirm-no');
    function cleanup() { $('#confirm-dialog').classList.add('hidden'); yes.replaceWith(yes.cloneNode(true)); no.replaceWith(no.cloneNode(true)); }
    $('#confirm-yes').onclick = () => { cleanup(); resolve(true); };
    $('#confirm-no').onclick = () => { cleanup(); resolve(false); };
  });
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initAudio();
  // Load sound preference
  SFX.enabled = localStorage.getItem('dnd-sound') !== 'off';
  // Inject SVG icons into icon-* spans
  document.querySelectorAll('[class^="icon-"]').forEach(el => {
    const name = el.className.replace('icon-', '');
    if (ICONS[name]) el.innerHTML = icon(name);
  });
  // Undo button
  const undoBtn = document.getElementById('btn-undo');
  if (undoBtn) undoBtn.addEventListener('click', () => { playSound('undo'); performUndo(); });
  await loadCharacters();
  setupTopbar();
  setupDiceRoller();
  setupSettings();
  setupKeyboardShortcuts();
  renderEnemyCalc();
  if (characters.length === 0) {
    showWelcome();
  } else {
    switchTo(characters[0].id);
  }
});

async function loadCharacters() {
  characters = await api.get('/api/characters');
}

function showWelcome() {
  $('#welcome-screen').classList.remove('hidden');
  $('#main-layout').classList.add('hidden');
  renderTabs();
}

function hideWelcome() {
  $('#welcome-screen').classList.add('hidden');
  $('#main-layout').classList.remove('hidden');
}

// ── Top Bar ───────────────────────────────────────────────────
function setupTopbar() {
  // New character
  $('#btn-add-char').onclick = async () => {
    const name = prompt('Character name:');
    if (!name || !name.trim()) return;
    const c = await api.post('/api/characters', { name: name.trim() });
    characters.push(c);
    switchTo(c.id);
  };

  // Welcome create
  $('#welcome-create').onclick = async () => {
    const name = $('#welcome-name').value.trim();
    if (!name) return;
    const c = await api.post('/api/characters', { name });
    characters.push(c);
    hideWelcome();
    switchTo(c.id);
  };
  $('#welcome-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('#welcome-create').click(); });

  // Export
  $('#btn-export').onclick = async () => {
    const data = await api.get('/api/characters');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dnd_companion_export.json';
    a.click();
  };

  // Save battle state
  $('#btn-save-battle').onclick = async () => {
    const data = await api.get('/api/characters');
    const name = prompt('Battle save name:', `Battle ${new Date().toLocaleString()}`);
    if (!name) return;
    const saves = JSON.parse(localStorage.getItem('dnd-battle-saves') || '[]');
    saves.unshift({ name, date: new Date().toISOString(), characters: data });
    if (saves.length > 10) saves.pop();
    localStorage.setItem('dnd-battle-saves', JSON.stringify(saves));
    playSound('click');
    showUndoToast(`Battle saved: ${name}`);
  };

  // Load battle state
  $('#btn-load-battle').onclick = () => {
    const saves = JSON.parse(localStorage.getItem('dnd-battle-saves') || '[]');
    if (!saves.length) { alert('No saved battles found.'); return; }
    showBattleLoadModal(saves);
  };
}

// ── Tabs ──────────────────────────────────────────────────────
function renderTabs() {
  const container = $('#character-tabs');
  container.innerHTML = '';
  characters.forEach((c, idx) => {
    const meta = getCharMeta(c.id);
    const tab = document.createElement('div');
    tab.className = 'tab' + (c.id === activeCharId ? ' active' : '') + (c.current_hp <= 0 ? ' unconscious' : '');
    tab.style.setProperty('--char-accent', meta.color);
    tab.innerHTML = `
      <div class="avatar" style="background:${meta.color}">${meta.avatar}</div>
      <span>${c.name}</span>
      <span class="skull">💀</span>
      <span class="tab-menu" data-id="${c.id}">⋮</span>
    `;
    tab.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-menu')) return;
      playSound('click');
      switchTo(c.id);
    });
    // Context menu
    tab.querySelector('.tab-menu').addEventListener('click', (e) => {
      e.stopPropagation();
      showTabMenu(c.id, e.target);
    });
    container.appendChild(tab);
  });
  // Apply active character color globally
  if (activeCharId) {
    const meta = getCharMeta(activeCharId);
    document.documentElement.style.setProperty('--char-accent', meta.color);
  }
}

function showTabMenu(charId, anchor) {
  // Remove existing
  document.querySelectorAll('.ctx-menu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.innerHTML = `
    <button data-action="rename">✏️ Rename</button>
    <button data-action="avatar">🎭 Avatar & Color</button>
    <button data-action="duplicate">📋 Duplicate</button>
    <button data-action="delete" class="danger-text">🗑️ Delete</button>
  `;
  anchor.parentElement.appendChild(menu);

  menu.querySelector('[data-action="rename"]').onclick = async () => {
    menu.remove();
    const c = characters.find(x => x.id === charId);
    const name = prompt('New name:', c.name);
    if (!name || !name.trim()) return;
    const updated = await api.put(`/api/characters/${charId}`, { name: name.trim() });
    Object.assign(c, updated);
    renderTabs();
    if (charId === activeCharId) renderAll();
  };

  menu.querySelector('[data-action="avatar"]').onclick = () => {
    menu.remove();
    showAvatarPicker(charId);
  };

  menu.querySelector('[data-action="duplicate"]').onclick = async () => {
    menu.remove();
    const src = characters.find(x => x.id === charId);
    const dup = await api.post('/api/characters', {
      name: src.name + ' (copy)', armor_class: src.armor_class, max_hp: src.max_hp,
      current_hp: src.current_hp, strength: src.strength, dexterity: src.dexterity,
      constitution: src.constitution, intelligence: src.intelligence, wisdom: src.wisdom,
      charisma: src.charisma, hp_dice_count: src.hp_dice_count, hp_dice_type: src.hp_dice_type,
      hp_recovery_modifier: src.hp_recovery_modifier,
    });
    characters.push(dup);
    switchTo(dup.id);
  };

  menu.querySelector('[data-action="delete"]').onclick = async () => {
    menu.remove();
    const ok = await confirmAction('Delete this character permanently?');
    if (!ok) return;
    await api.del(`/api/characters/${charId}`);
    characters = characters.filter(x => x.id !== charId);
    if (characters.length === 0) {
      activeCharId = null;
      showWelcome();
    } else if (activeCharId === charId) {
      switchTo(characters[0].id);
    } else {
      renderTabs();
    }
  };

  // Close on outside click
  setTimeout(() => {
    const handler = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('click', handler); } };
    document.addEventListener('click', handler);
  }, 0);
}

// ── Avatar & Color Picker ────────────────────────────────────
function showAvatarPicker(charId) {
  // Remove existing
  document.querySelectorAll('#avatar-picker-modal').forEach(m => m.remove());
  const meta = getCharMeta(charId);
  const overlay = document.createElement('div');
  overlay.id = 'avatar-picker-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header"><h3>🎭 Avatar & Color</h3><button class="btn-close" id="avatar-picker-close">✕</button></div>
      <div class="modal-body">
        <label>Avatar</label>
        <div class="avatar-grid">
          ${AVATARS.map(a => `<div class="avatar-option ${a === meta.avatar ? 'selected' : ''}" data-av="${a}">${a}</div>`).join('')}
        </div>
        <label>Accent Color</label>
        <div class="color-grid">
          ${CHAR_COLORS.map(c => `<div class="color-swatch ${c === meta.color ? 'selected' : ''}" data-clr="${c}" style="background:${c}"></div>`).join('')}
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-accent btn-sm" id="avatar-picker-save">Save</button>
        <button class="btn btn-ghost btn-sm" id="avatar-picker-cancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  let selAvatar = meta.avatar;
  let selColor = meta.color;

  overlay.querySelectorAll('.avatar-option').forEach(el => {
    el.addEventListener('click', () => {
      overlay.querySelectorAll('.avatar-option').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      selAvatar = el.dataset.av;
    });
  });
  overlay.querySelectorAll('.color-swatch').forEach(el => {
    el.addEventListener('click', () => {
      overlay.querySelectorAll('.color-swatch').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected');
      selColor = el.dataset.clr;
    });
  });
  overlay.querySelector('#avatar-picker-save').onclick = () => {
    setCharMeta(charId, { avatar: selAvatar, color: selColor });
    overlay.remove();
    renderTabs();
  };
  overlay.querySelector('#avatar-picker-cancel').onclick = () => overlay.remove();
  overlay.querySelector('#avatar-picker-close').onclick = () => overlay.remove();
}

// ── Battle Load Modal ────────────────────────────────────────
function showBattleLoadModal(saves) {
  document.querySelectorAll('#battle-load-modal').forEach(m => m.remove());
  const overlay = document.createElement('div');
  overlay.id = 'battle-load-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:450px">
      <div class="modal-header"><h3>📂 Load Battle</h3><button class="btn-close" id="battle-load-close">✕</button></div>
      <div class="modal-body" style="max-height:300px;overflow-y:auto">
        ${saves.map((s, i) => `
          <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--color-surface-3);border-radius:var(--radius-sm);margin-bottom:4px">
            <div style="flex:1">
              <div style="font-weight:600;font-size:0.85rem">${s.name}</div>
              <div style="font-size:0.7rem;color:var(--color-text-faint)">${new Date(s.date).toLocaleString()} · ${s.characters.length} chars</div>
            </div>
            <button class="btn btn-accent btn-xs" data-load-idx="${i}">Load</button>
            <button class="btn btn-ghost btn-xs text-danger" data-del-save="${i}">✕</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#battle-load-close').onclick = () => overlay.remove();

  overlay.querySelectorAll('[data-load-idx]').forEach(btn => {
    btn.onclick = async () => {
      const save = saves[parseInt(btn.dataset.loadIdx)];
      const ok = await confirmAction(`Load "${save.name}"? This will overwrite current HP/turn values for matching characters.`);
      if (!ok) return;
      // Restore HP and turn_count for each matching character
      for (const saved of save.characters) {
        const existing = characters.find(c => c.name === saved.name);
        if (existing) {
          await api.patch(`/api/characters/${existing.id}/hp`, { set: saved.current_hp });
          if (saved.turn_count !== undefined) {
            await api.put(`/api/characters/${existing.id}`, { turn_count: saved.turn_count });
          }
        }
      }
      await loadCharacters();
      if (activeCharId) await switchTo(activeCharId);
      overlay.remove();
      playSound('click');
      showUndoToast(`Battle loaded: ${save.name}`);
    };
  });

  overlay.querySelectorAll('[data-del-save]').forEach(btn => {
    btn.onclick = () => {
      saves.splice(parseInt(btn.dataset.delSave), 1);
      localStorage.setItem('dnd-battle-saves', JSON.stringify(saves));
      overlay.remove();
      if (saves.length) showBattleLoadModal(saves);
    };
  });
}

// ── Switch character ──────────────────────────────────────────
async function switchTo(id) {
  activeCharId = id;
  // Refresh character data
  try {
    const fresh = await api.get(`/api/characters/${id}`);
    const idx = characters.findIndex(c => c.id === id);
    if (idx >= 0) characters[idx] = fresh;
  } catch (e) { /* use cached */ }
  hideWelcome();
  renderTabs();
  renderAll();
}

function renderAll() {
  renderStats();
  renderAttackDamage();
  renderDamageIntake();
  renderHPRecovery();
  renderTurnCounter();
  renderEffects();
  renderLog();
}

// ══════════════════════════════════════════════════════════════
// STATS PANEL
// ══════════════════════════════════════════════════════════════
function renderStats() {
  const c = getChar();
  if (!c) return;
  const statNames = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
  const body = $('#stats-body');
  const scrollEl = $('.main-area');
  const savedScroll = scrollEl ? scrollEl.scrollTop : 0;

  const hpPct = c.max_hp > 0 ? (c.current_hp / c.max_hp) * 100 : 0;
  const hpClass = hpPct > 50 ? 'high' : hpPct > 25 ? 'mid' : 'low';
  const hpColor = hpPct > 50 ? 'var(--color-hp-high)' : hpPct > 25 ? 'var(--color-hp-mid)' : 'var(--color-hp-low)';

  let html = `
    <div class="stat-card hp-card" id="hp-card">
      <div class="hp-display">
        <div class="hp-numbers">
          <input type="number" id="current-hp-input" value="${c.current_hp}" min="0" max="${c.max_hp}" style="width:70px;font-size:1.4rem;font-weight:700;color:${hpColor};background:transparent;border:1px solid var(--color-border)" data-tooltip="Current HP — click to edit">
          <span class="text-muted"> / </span>
          <input type="number" class="stat-input" data-field="max_hp" value="${c.max_hp}" min="1" style="width:70px;font-size:1.2rem;font-weight:700" data-tooltip="Max HP">
        </div>
        <div class="hp-bar-wrap"><div class="hp-bar ${hpClass}" style="width:${hpPct}%"></div></div>
      </div>
      <div class="field-group">
        <label data-tooltip="Armor Class (КД)">KD (AC):</label>
        <input type="number" class="stat-input" data-field="armor_class" value="${c.armor_class}" min="0">
      </div>
    </div>
  `;

  html += '<div class="stats-grid">';
  for (const stat of statNames) {
    const mods = (c.stat_modifiers || []).filter(m => m.stat_name === stat);
    const activeSum = mods.filter(m => m.is_active).reduce((s, m) => s + m.value, 0);
    const effective = c[stat] + activeSum;

    let modsHtml = '';
    for (const m of mods) {
      modsHtml += `
        <div class="stat-mod-row ${m.is_active ? '' : 'inactive'}">
          <label class="toggle-switch"><input type="checkbox" ${m.is_active ? 'checked' : ''} data-mod-id="${m.id}" data-mod-type="stat"><span class="slider"></span></label>
          <input type="text" class="mod-name" value="${m.name}" data-mod-id="${m.id}" data-mod-type="stat" data-mod-field="name" style="width:60px;font-size:0.7rem">
          <input type="number" value="${m.value}" data-mod-id="${m.id}" data-mod-type="stat" data-mod-field="value" style="width:40px;font-size:0.7rem">
          <button class="btn-icon danger" data-del-mod="${m.id}" data-del-type="stat" title="Delete">🗑</button>
        </div>`;
    }

    html += `
      <div class="stat-card">
        <div class="stat-label">${stat}</div>
        <div class="stat-effective">${effective}</div>
        <div class="stat-base">Base: <input type="number" class="stat-input" data-field="${stat}" value="${c[stat]}" style="width:58px;font-size:0.85rem"></div>
        <div class="stat-mods">${modsHtml}</div>
        <button class="btn btn-ghost btn-xs btn-add-mod" data-add-stat-mod="${stat}">+ Mod</button>
      </div>`;
  }
  html += '</div>';

  body.innerHTML = html;
  if (scrollEl) scrollEl.scrollTop = savedScroll;

  // Event: update current HP directly
  const hpInput = $('#current-hp-input');
  if (hpInput) {
    hpInput.addEventListener('change', async () => {
      const val = parseInt(hpInput.value);
      if (isNaN(val)) return;
      await api.patch(`/api/characters/${c.id}/hp`, { set: val });
      await refreshChar();
      renderStats();
      renderTabs();
    });
  }

  // Event: update stat base / max_hp / armor_class
  body.querySelectorAll('.stat-input').forEach(inp => {
    inp.addEventListener('change', async () => {
      const field = inp.dataset.field;
      const val = parseInt(inp.value) || 0;
      const updated = await api.put(`/api/characters/${c.id}`, { [field]: val });
      Object.assign(c, updated);
      renderStats();
      if (field === 'armor_class') renderDamageIntake();
    });
  });

  // Event: toggle stat modifier
  body.querySelectorAll('[data-mod-type="stat"][type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await api.put(`/api/modifiers/${cb.dataset.modId}?type=stat`, { is_active: cb.checked });
      await refreshChar();
      renderStats();
    });
  });

  // Event: update stat modifier name/value
  body.querySelectorAll('[data-mod-field]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const field = inp.dataset.modField;
      const val = field === 'value' ? parseInt(inp.value) || 0 : inp.value;
      await api.put(`/api/modifiers/${inp.dataset.modId}?type=${inp.dataset.modType}`, { [field]: val });
      await refreshChar();
      renderStats();
    });
  });

  // Event: delete stat modifier
  body.querySelectorAll('[data-del-mod]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.del(`/api/modifiers/${btn.dataset.delMod}?type=${btn.dataset.delType}`);
      await refreshChar();
      renderStats();
    });
  });

  // Event: add stat modifier
  body.querySelectorAll('[data-add-stat-mod]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.post(`/api/characters/${c.id}/modifiers`, { modifier_type: 'stat', stat_name: btn.dataset.addStatMod, name: 'Mod', value: 0 });
      await refreshChar();
      renderStats();
    });
  });
}

async function refreshChar() {
  const c = await api.get(`/api/characters/${activeCharId}`);
  const idx = characters.findIndex(x => x.id === activeCharId);
  if (idx >= 0) characters[idx] = c;
}

// ══════════════════════════════════════════════════════════════
// ATTACK & DAMAGE ROLL PANEL
// ══════════════════════════════════════════════════════════════
let _atkD20Result = 0; // persisted across re-renders within a session

// ── Damage dice groups (per-character, stored in localStorage) ──
function getDiceGroups(charId) {
  const all = JSON.parse(localStorage.getItem('dnd-dice-groups') || '{}');
  return all[charId] || [{ id: 1, count: 1, die: 8, active: true }];
}
function setDiceGroups(charId, groups) {
  const all = JSON.parse(localStorage.getItem('dnd-dice-groups') || '{}');
  all[charId] = groups;
  localStorage.setItem('dnd-dice-groups', JSON.stringify(all));
}
let _diceGroupIdCounter = 100;

function buildDiceGroupsHtml(charId) {
  const groups = getDiceGroups(charId);
  return groups.map(g => `
    <div class="mod-row ${g.active ? '' : 'inactive'}" data-dg-id="${g.id}">
      <label class="toggle-switch"><input type="checkbox" ${g.active ? 'checked' : ''} data-dg-toggle="${g.id}"><span class="slider"></span></label>
      <input type="number" value="${g.count}" min="1" style="width:44px" data-dg-field="count" data-dg-id="${g.id}">
      <span style="color:var(--color-text-muted)">d</span>
      <select data-dg-field="die" data-dg-id="${g.id}" style="width:60px">
        ${[4,6,8,10,12,20,100].map(d => `<option value="${d}" ${g.die === d ? 'selected' : ''}>d${d}</option>`).join('')}
      </select>
      <span class="text-muted" style="font-size:0.72rem;min-width:40px">${g.count}d${g.die}</span>
      <button class="btn-icon danger" data-dg-del="${g.id}" title="Delete">🗑</button>
    </div>
  `).join('');
}

function renderAttackDamage() {
  const c = getChar();
  if (!c) return;
  const body = $('#attack-body');
  const scrollEl = $('.main-area');
  const savedScroll = scrollEl ? scrollEl.scrollTop : 0;

  // Attack modifiers
  let atkModsHtml = '';
  for (const m of (c.attack_modifiers || [])) {
    atkModsHtml += `
      <div class="mod-row ${m.is_active ? '' : 'inactive'}">
        <label class="toggle-switch"><input type="checkbox" ${m.is_active ? 'checked' : ''} data-atkmod-id="${m.id}"><span class="slider"></span></label>
        <input type="text" class="mod-row-name" value="${m.name}" data-atkmod-id="${m.id}" data-atkmod-field="name">
        <input type="number" value="${m.value}" data-atkmod-id="${m.id}" data-atkmod-field="value" style="width:50px">
        <button class="btn-icon danger" data-del-atkmod="${m.id}" title="Delete">🗑</button>
      </div>`;
  }

  // Damage modifiers
  let dmgModsHtml = '';
  for (const m of (c.damage_modifiers || [])) {
    dmgModsHtml += `
      <div class="mod-row ${m.is_active ? '' : 'inactive'}">
        <label class="toggle-switch"><input type="checkbox" ${m.is_active ? 'checked' : ''} data-dmgmod-id="${m.id}"><span class="slider"></span></label>
        <input type="text" class="mod-row-name" value="${m.name}" data-dmgmod-id="${m.id}" data-dmgmod-field="name">
        <input type="number" value="${m.value}" data-dmgmod-id="${m.id}" data-dmgmod-field="value" style="width:50px">
        <button class="btn-icon danger" data-del-dmgmod="${m.id}" title="Delete">🗑</button>
      </div>`;
  }

  body.innerHTML = `
    <h3 style="font-family:var(--font-display);font-size:0.85rem;margin-bottom:8px" data-tooltip="Roll d20 + modifiers, then calculate attack bonus = floor(total/5)*2">⚔️ Hit Roll</h3>
    <div class="field-group">
      <label>D20 Count:</label>
      <input type="number" id="atk-d20-count" min="1" max="10" value="1" style="width:44px" data-tooltip="Number of d20s to roll">
      <select id="atk-d20-mode" class="adv-select" data-tooltip="Advantage = take best, Disadvantage = take worst">
        <option value="normal">Normal</option>
        <option value="advantage">Advantage</option>
        <option value="disadvantage">Disadvantage</option>
      </select>
      <button class="btn btn-accent btn-sm" id="atk-d20-roll" title="Roll d20">🎲 Roll D20</button>
    </div>
    <div class="field-group">
      <label>D20 Result:</label>
      <span id="atk-d20-value" class="value text-accent" style="font-size:1.1rem">${_atkD20Result || '—'}</span>
      <div id="atk-d20-chips" class="d20-rolls-display"></div>
    </div>
    <div class="field-group">
      <label>Base Mod:</label>
      <input type="number" id="atk-base-mod" value="0">
    </div>
    <div class="mod-list" id="atk-mod-list">${atkModsHtml}</div>
    <button class="btn btn-ghost btn-xs btn-add-mod" id="btn-add-atk-mod">+ Attack Modifier</button>
    <div class="result-box" id="atk-result"><span class="text-muted">Roll d20 to calculate</span></div>

    <hr class="section-divider">

    <h3 style="font-family:var(--font-display);font-size:0.85rem;margin-bottom:8px" data-tooltip="Roll damage dice + weapon bonus + attack bonus + damage modifiers">💥 Damage Roll</h3>
    <div id="dmg-dice-groups">${buildDiceGroupsHtml(c.id)}</div>
    <div style="display:flex;gap:6px;margin:6px 0">
      <button class="btn btn-ghost btn-xs" id="btn-add-dice-group">+ Add Dice</button>
      <button class="btn btn-accent btn-sm" id="dmg-roll-btn" title="Roll all active dice">🎲 Roll All</button>
    </div>
    <div class="field-group">
      <label>Weapon Bonus:</label>
      <input type="number" id="dmg-weapon-bonus" value="0">
      <label>Attack Bonus:</label>
      <span id="dmg-atk-bonus" class="value text-accent" data-tooltip="Auto-populated from hit roll above">0</span>
    </div>
    <div class="mod-list" id="dmg-mod-list">${dmgModsHtml}</div>
    <button class="btn btn-ghost btn-xs btn-add-mod" id="btn-add-dmg-mod">+ Damage Modifier</button>
    <div class="result-box" id="dmg-result"><span class="text-muted">Roll damage dice to calculate</span></div>
    <button class="btn btn-ghost btn-xs mt-8" id="btn-copy-dmg" style="display:none">📋 Copy to Clipboard</button>
  `;

  // Restore scroll position after re-render
  if (scrollEl) scrollEl.scrollTop = savedScroll;

  // ── Attack roll logic
  const calcAttack = () => {
    const d20 = _atkD20Result;
    if (!d20) { $('#atk-result').innerHTML = '<span class="text-muted">Roll d20 first</span>'; return; }
    const baseMod = parseInt($('#atk-base-mod').value) || 0;
    const freshC = getChar();
    const mods = (freshC.attack_modifiers || []).filter(m => m.is_active);
    const modVals = mods.map(m => m.value);
    const total = d20 + baseMod + modVals.reduce((a, b) => a + b, 0);
    const attackBonus = Math.floor(total / 5) * 2;

    let breakdown = `D20(${d20}) + Base(${baseMod})`;
    mods.forEach(m => { breakdown += ` + ${m.name}(${m.value > 0 ? '+' : ''}${m.value})`; });

    $('#atk-result').innerHTML = `${breakdown} = <strong>${total}</strong> → <span class="text-accent">Attack Bonus: ${attackBonus}</span>`;
    $('#dmg-atk-bonus').textContent = attackBonus;
    addLog(`[Attack] ${breakdown} = ${total} → Bonus: ${attackBonus}`);
  };

  $('#atk-base-mod').addEventListener('input', calcAttack);

  // D20 Roll with advantage/disadvantage
  $('#atk-d20-roll').addEventListener('click', () => {
    const count = Math.max(1, Math.min(10, parseInt($('#atk-d20-count').value) || 1));
    const mode = $('#atk-d20-mode').value;
    const rolls = [];
    for (let i = 0; i < count; i++) rolls.push(Math.floor(Math.random() * 20) + 1);

    let selected;
    if (mode === 'advantage') selected = Math.max(...rolls);
    else if (mode === 'disadvantage') selected = Math.min(...rolls);
    else selected = rolls[0];

    _atkD20Result = selected;
    $('#atk-d20-value').textContent = selected;

    // Show roll chips (mark only the first matching value as selected)
    const chipsEl = $('#atk-d20-chips');
    if (count > 1) {
      let selectedMarked = false;
      chipsEl.innerHTML = rolls.map(r => {
        let cls = 'discarded';
        if (r === selected && !selectedMarked) { cls = 'selected'; selectedMarked = true; }
        return `<span class="d20-roll-chip ${cls} dice-pop">${r}</span>`;
      }).join('');
    } else {
      chipsEl.innerHTML = `<span class="d20-roll-chip selected dice-pop">${selected}</span>`;
    }

    flash($('#atk-d20-roll'), 'dice-shake');
    playSound('dice');
    addRollHistory('attack', `${count}d20 (${mode}): [${rolls.join(',')}] → ${selected}`, selected);
    calcAttack();
  });

  // If we already have a d20 result, recalculate
  if (_atkD20Result) calcAttack();

  // ── Attack modifier events
  body.querySelectorAll('[data-atkmod-id][type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await api.put(`/api/modifiers/${cb.dataset.atkmodId}?type=attack`, { is_active: cb.checked });
      await refreshChar();
      renderAttackDamage();
    });
  });
  body.querySelectorAll('[data-atkmod-field]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const f = inp.dataset.atkmodField;
      const v = f === 'value' ? parseInt(inp.value) || 0 : inp.value;
      await api.put(`/api/modifiers/${inp.dataset.atkmodId}?type=attack`, { [f]: v });
      await refreshChar();
      calcAttack();
    });
  });
  body.querySelectorAll('[data-del-atkmod]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.del(`/api/modifiers/${btn.dataset.delAtkmod}?type=attack`);
      await refreshChar();
      renderAttackDamage();
    });
  });
  $('#btn-add-atk-mod').addEventListener('click', async () => {
    await api.post(`/api/characters/${c.id}/modifiers`, { modifier_type: 'attack', name: 'Mod', value: 0 });
    await refreshChar();
    renderAttackDamage();
  });

  // ── Dice group events ──
  const bindDiceGroupEvents = () => {
    body.querySelectorAll('[data-dg-toggle]').forEach(cb => {
      cb.addEventListener('change', () => {
        const groups = getDiceGroups(c.id);
        const g = groups.find(x => x.id == cb.dataset.dgToggle);
        if (g) g.active = cb.checked;
        setDiceGroups(c.id, groups);
        renderAttackDamage();
      });
    });
    body.querySelectorAll('[data-dg-field]').forEach(inp => {
      inp.addEventListener('change', () => {
        const groups = getDiceGroups(c.id);
        const g = groups.find(x => x.id == inp.dataset.dgId);
        if (!g) return;
        const f = inp.dataset.dgField;
        g[f] = parseInt(inp.value) || (f === 'count' ? 1 : 8);
        setDiceGroups(c.id, groups);
        renderAttackDamage();
      });
    });
    body.querySelectorAll('[data-dg-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        let groups = getDiceGroups(c.id);
        groups = groups.filter(x => x.id != btn.dataset.dgDel);
        if (groups.length === 0) groups = [{ id: ++_diceGroupIdCounter, count: 1, die: 8, active: true }];
        setDiceGroups(c.id, groups);
        renderAttackDamage();
      });
    });
  };
  bindDiceGroupEvents();

  $('#btn-add-dice-group').addEventListener('click', () => {
    const groups = getDiceGroups(c.id);
    groups.push({ id: ++_diceGroupIdCounter, count: 1, die: 8, active: true });
    setDiceGroups(c.id, groups);
    renderAttackDamage();
  });

  // ── Damage roll logic
  let lastDmgText = '';
  $('#dmg-roll-btn').addEventListener('click', async () => {
    const groups = getDiceGroups(c.id);
    const weaponBonus = parseInt($('#dmg-weapon-bonus').value) || 0;
    const attackBonus = parseInt($('#dmg-atk-bonus').textContent) || 0;
    const freshC = getChar();
    const mods = (freshC.damage_modifiers || []).filter(m => m.is_active);
    const modVals = mods.map(m => m.value);

    const res = await api.post('/api/calc/damage-roll', {
      dice_groups: groups, weapon_bonus: weaponBonus,
      attack_bonus: attackBonus, modifier_values: modVals,
    });

    flash($('#dmg-roll-btn'), 'dice-shake');
    playSound('dice');

    // Build description from group results
    const groupDesc = (res.group_results || []).map(g => `${g.count}d${g.die}[${g.rolls.join(',')}]=${g.subtotal}`).join(' + ');
    addRollHistory('damage', `${groupDesc} = ${res.total}`, res.total);

    let text = '';
    for (const g of (res.group_results || [])) {
      text += `<span class="text-muted">${g.count}d${g.die}:</span> [${g.rolls.join(', ')}] = ${g.subtotal} &nbsp;`;
    }
    if (weaponBonus) text += ` + Weapon(${weaponBonus > 0 ? '+' : ''}${weaponBonus})`;
    if (attackBonus) text += ` + AtkBonus(+${attackBonus})`;
    mods.forEach(m => { text += ` + ${m.name}(${m.value > 0 ? '+' : ''}${m.value})`; });
    text += `<br>= <strong class="damage-num">${res.total} damage</strong>`;
    lastDmgText = `${groupDesc} + W(${weaponBonus}) + A(${attackBonus}) = ${res.total} damage`;

    $('#dmg-result').innerHTML = text;
    $('#btn-copy-dmg').style.display = '';
    addLog(`[Damage] ${groupDesc} + W(${weaponBonus}) + A(${attackBonus}) = ${res.total}`);
  });

  $('#btn-copy-dmg').addEventListener('click', () => {
    navigator.clipboard.writeText(lastDmgText.replace(/<[^>]+>/g, ''));
  });

  // ── Damage modifier events
  body.querySelectorAll('[data-dmgmod-id][type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await api.put(`/api/modifiers/${cb.dataset.dmgmodId}?type=damage`, { is_active: cb.checked });
      await refreshChar();
      renderAttackDamage();
    });
  });
  body.querySelectorAll('[data-dmgmod-field]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const f = inp.dataset.dmgmodField;
      const v = f === 'value' ? parseInt(inp.value) || 0 : inp.value;
      await api.put(`/api/modifiers/${inp.dataset.dmgmodId}?type=damage`, { [f]: v });
      await refreshChar();
    });
  });
  body.querySelectorAll('[data-del-dmgmod]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.del(`/api/modifiers/${btn.dataset.delDmgmod}?type=damage`);
      await refreshChar();
      renderAttackDamage();
    });
  });
  $('#btn-add-dmg-mod').addEventListener('click', async () => {
    await api.post(`/api/characters/${c.id}/modifiers`, { modifier_type: 'damage', name: 'Mod', value: 0 });
    await refreshChar();
    renderAttackDamage();
  });
}

// ══════════════════════════════════════════════════════════════
// INCOMING DAMAGE PANEL
// ══════════════════════════════════════════════════════════════
function renderDamageIntake() {
  const c = getChar();
  if (!c) return;
  const body = $('#damage-intake-body');

  body.innerHTML = `
    <div class="field-group">
      <label data-tooltip="Enemy's d20 attack roll result">Enemy Roll:</label>
      <input type="number" id="di-enemy-roll" value="" placeholder="d20+mod">
    </div>
    <div class="field-group">
      <label>Your KD (AC):</label>
      <span class="value text-accent">${c.armor_class}</span>
    </div>
    <div class="field-group">
      <label data-tooltip="Total damage dice rolled by the enemy">Damage Rolled:</label>
      <input type="number" id="di-damage-rolled" value="" placeholder="Total dmg">
    </div>
    <button class="btn btn-danger btn-sm mt-4" id="btn-apply-damage">⚔️ APPLY DAMAGE</button>
    <div class="result-box" id="di-result"><span class="text-muted">Enter enemy roll & damage</span></div>
  `;

  $('#btn-apply-damage').addEventListener('click', async () => {
    const enemyRoll = parseInt($('#di-enemy-roll').value);
    const damageRolled = parseInt($('#di-damage-rolled').value);
    if (isNaN(enemyRoll) || isNaN(damageRolled)) {
      $('#di-result').innerHTML = '<span class="text-danger">Fill in both fields</span>';
      return;
    }

    const res = await api.post('/api/calc/damage-intake', {
      character_id: c.id, enemy_roll: enemyRoll, damage_rolled: damageRolled,
    });

    if (res.final_damage === 0 && res.hit_diff <= 0) {
      $('#di-result').innerHTML = `<span class="miss-text">MISS!</span> Difference: ${res.hit_diff} (${res.tier_label})`;
      addLog(`[Defense] Enemy(${enemyRoll}) vs KD(${res.armor_class}) = ${res.hit_diff} → MISS`);
    } else {
      // Confirm if large damage
      if (res.final_damage > c.current_hp * 0.5 && res.final_damage > 0) {
        const ok = await confirmAction(`Take ${res.final_damage} damage? (>${Math.round(c.current_hp * 0.5)} — over 50% of current HP)`);
        if (!ok) return;
      }

      // Apply damage — with undo
      const hpBefore = c.current_hp;
      await api.patch(`/api/characters/${c.id}/hp`, { delta: -res.final_damage });
      await refreshChar();
      playSound('hit');
      pushUndo(`${res.final_damage} damage`, async () => {
        await api.patch(`/api/characters/${c.id}/hp`, { set: hpBefore });
      });

      let breakdown = `Diff: ${res.hit_diff} → <span class="tier-text">${res.tier_label}</span><br>`;
      // Show combined reduction (tier + effects summed)
      const tierPct = Math.round((1 - res.multiplier) * 100);
      breakdown += `Tier reduction: ${tierPct}%`;
      if (res.effect_breakdown.length) {
        for (const e of res.effect_breakdown) {
          if (e.type === 'percent_reduction') breakdown += ` + ${e.name}: ${e.value}%`;
          else breakdown += `<br>→ ${e.name}: -${e.value} flat`;
        }
        breakdown += `<br>Total reduction: <span class="text-accent">${res.total_percent_reduction}%</span> → ×${res.combined_multiplier}`;
        breakdown += `<br>${damageRolled} × ${res.combined_multiplier} = ${res.base_damage}`;
        if (res.flat_sum > 0) breakdown += ` - ${res.flat_sum} flat = ${res.after_percent - res.flat_sum}`;
      } else {
        breakdown += `<br>${damageRolled} × ${res.combined_multiplier} = ${res.base_damage}`;
      }
      breakdown += `<br><strong>Final: <span class="damage-num">${res.final_damage} damage</span></strong>`;

      $('#di-result').innerHTML = breakdown;
      flash($('#hp-card'), 'flash-damage');
      addLog(`[Defense] Enemy(${enemyRoll}) vs KD(${res.armor_class}) = ${res.hit_diff} → ${res.tier_label} → ${res.final_damage} dmg`);

      renderStats();
      renderTabs();
    }
  });
}

// ══════════════════════════════════════════════════════════════
// HP RECOVERY PANEL
// ══════════════════════════════════════════════════════════════
function renderHPRecovery() {
  const c = getChar();
  if (!c) return;
  const body = $('#hp-recovery-body');

  body.innerHTML = `
    <h3 style="font-family:var(--font-display);font-size:0.8rem;margin-bottom:6px" data-tooltip="Roll healing dice + modifier, heals up to max HP">🎲 Dice Recovery</h3>
    <div class="field-group">
      <label>Dice Count:</label>
      <input type="number" id="hr-dice-count" value="${c.hp_dice_count}" min="1" style="width:44px">
      <label>d</label>
      <input type="number" id="hr-die-type" value="${c.hp_dice_type}" min="1" style="width:44px">
      <label>Mod:</label>
      <input type="number" id="hr-modifier" value="${c.hp_recovery_modifier}" style="width:50px">
    </div>
    <button class="btn btn-success btn-sm" id="btn-roll-heal">💚 ROLL & HEAL</button>
    <div class="result-box" id="hr-result"><span class="text-muted">Roll to heal</span></div>

    <hr class="section-divider">

    <h3 style="font-family:var(--font-display);font-size:0.8rem;margin-bottom:6px">✏️ Manual Recovery</h3>
    <div class="field-group">
      <input type="number" id="hr-manual" value="" placeholder="HP amount" style="width:70px">
      <button class="btn btn-success btn-sm" id="btn-add-hp">+ ADD HP</button>
      <button class="btn btn-ghost btn-sm" id="btn-set-hp" data-tooltip="Set HP to exact value">SET</button>
    </div>
  `;

  // Save dice config on change
  ['hr-dice-count', 'hr-die-type', 'hr-modifier'].forEach(id => {
    $(`#${id}`).addEventListener('change', async () => {
      await api.put(`/api/characters/${c.id}`, {
        hp_dice_count: parseInt($('#hr-dice-count').value) || 2,
        hp_dice_type: parseInt($('#hr-die-type').value) || 12,
        hp_recovery_modifier: parseInt($('#hr-modifier').value) || 0,
      });
      await refreshChar();
    });
  });

  // Roll & Heal
  $('#btn-roll-heal').addEventListener('click', async () => {
    const res = await api.post('/api/calc/hp-recovery', {
      character_id: c.id,
      dice_count: parseInt($('#hr-dice-count').value) || 2,
      die_type: parseInt($('#hr-die-type').value) || 12,
      modifier: parseInt($('#hr-modifier').value) || 0,
    });
    const hpBefore = c.current_hp;
    await refreshChar();
    playSound('heal');
    addRollHistory('heal', `${res.rolls.length}d${$('#hr-die-type').value}: [${res.rolls.join(',')}] = +${res.total_heal}`, res.total_heal);
    pushUndo(`+${res.total_heal} heal`, async () => {
      await api.patch(`/api/characters/${c.id}/hp`, { set: hpBefore });
    });
    const mod = res.modifier;
    const modStr = mod >= 0 ? `+ mod ${mod}` : `- mod ${Math.abs(mod)}`;
    $('#hr-result').innerHTML = `Rolled: [${res.rolls.join(', ')}] ${modStr} = <span class="heal-num">+${res.total_heal} HP</span> → New HP: <strong>${res.new_hp}</strong>`;
    flash($('#hp-card'), 'flash-heal');
    addLog(`[Heal] ${res.rolls.length}d${$('#hr-die-type').value}[${res.rolls.join(',')}] ${modStr} = +${res.total_heal} → ${res.new_hp}/${res.max_hp}`);
    renderStats();
    renderTabs();
  });

  // Manual Add HP
  $('#btn-add-hp').addEventListener('click', async () => {
    const val = parseInt($('#hr-manual').value) || 0;
    if (!val) return;
    const hpBefore = c.current_hp;
    await api.patch(`/api/characters/${c.id}/hp`, { delta: val });
    await refreshChar();
    playSound(val > 0 ? 'heal' : 'hit');
    pushUndo(`manual ${val > 0 ? '+' : ''}${val} HP`, async () => {
      await api.patch(`/api/characters/${c.id}/hp`, { set: hpBefore });
    });
    flash($('#hp-card'), val > 0 ? 'flash-heal' : 'flash-damage');
    addLog(`[Manual HP] ${val > 0 ? '+' : ''}${val} → ${getChar().current_hp}/${getChar().max_hp}`);
    renderStats();
    renderTabs();
    $('#hr-manual').value = '';
  });

  // Set HP
  $('#btn-set-hp').addEventListener('click', async () => {
    const val = parseInt($('#hr-manual').value);
    if (isNaN(val)) return;
    const hpBefore = c.current_hp;
    await api.patch(`/api/characters/${c.id}/hp`, { set: val });
    await refreshChar();
    pushUndo(`set HP to ${val}`, async () => {
      await api.patch(`/api/characters/${c.id}/hp`, { set: hpBefore });
    });
    renderStats();
    renderTabs();
    addLog(`[Set HP] → ${getChar().current_hp}/${getChar().max_hp}`);
    $('#hr-manual').value = '';
  });
}

// ══════════════════════════════════════════════════════════════
// TURN COUNTER PANEL
// ══════════════════════════════════════════════════════════════
function renderTurnCounter() {
  const c = getChar();
  if (!c) return;
  const body = $('#turns-body');
  const scrollEl = $('.main-area');
  const savedScroll = scrollEl ? scrollEl.scrollTop : 0;

  let timersHtml = '';
  for (const t of (c.turn_timers || [])) {
    const valClass = t.current_value <= 0 ? 'expired' : 'active';
    timersHtml += `
      <div class="timer-row ${t.is_active ? '' : 'inactive'}">
        <label class="toggle-switch"><input type="checkbox" ${t.is_active ? 'checked' : ''} data-timer-toggle="${t.id}"><span class="slider"></span></label>
        <input type="text" class="timer-name" value="${t.name}" data-timer-id="${t.id}" data-timer-field="name" style="width:100px">
        <span class="timer-value ${valClass}">${t.current_value}</span>
        <span class="timer-initial">/ ${t.initial_value}</span>
        <input type="number" value="${t.initial_value}" data-timer-id="${t.id}" data-timer-field="initial_value" style="width:48px" min="1" data-tooltip="Initial duration">
        <button class="btn btn-ghost btn-xs" data-timer-reset="${t.id}" title="Reset to initial value">↩️</button>
        <button class="btn-icon danger" data-timer-del="${t.id}" title="Delete">🗑</button>
      </div>`;
  }

  body.innerHTML = `
    <div class="turn-header">
      <div>
        <div class="turn-label">Turn</div>
        <div class="turn-count-display">${c.turn_count || 0}</div>
      </div>
      <button class="btn btn-accent btn-sm" id="btn-next-turn">⏭ Next Turn</button>
      <button class="btn btn-ghost btn-sm" id="btn-reset-turns">↩️ Reset</button>
    </div>
    <div id="timer-list">${timersHtml}</div>
    <button class="btn btn-ghost btn-xs mt-4" id="btn-add-timer">+ Add Timer</button>
  `;
  if (scrollEl) scrollEl.scrollTop = savedScroll;

  // Next Turn
  $('#btn-next-turn').addEventListener('click', async () => {
    const updated = await api.post(`/api/characters/${c.id}/advance-turn`);
    Object.assign(c, updated);
    const idx = characters.findIndex(x => x.id === c.id);
    if (idx >= 0) characters[idx] = c;
    playSound('turn');
    renderTurnCounter();
    addLog(`[Turn] → Turn ${c.turn_count}`);
  });

  // Reset Turns
  $('#btn-reset-turns').addEventListener('click', async () => {
    const updated = await api.post(`/api/characters/${c.id}/reset-turns`);
    Object.assign(c, updated);
    const idx = characters.findIndex(x => x.id === c.id);
    if (idx >= 0) characters[idx] = c;
    renderTurnCounter();
    addLog(`[Turn] Reset to 0`);
  });

  // Add Timer
  $('#btn-add-timer').addEventListener('click', async () => {
    await api.post(`/api/characters/${c.id}/turn-timers`, { name: 'Timer', initial_value: 3 });
    await refreshChar();
    renderTurnCounter();
  });

  // Toggle timer active
  body.querySelectorAll('[data-timer-toggle]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await api.put(`/api/turn-timers/${cb.dataset.timerToggle}`, { is_active: cb.checked });
      await refreshChar();
      renderTurnCounter();
    });
  });

  // Update timer fields (name, initial_value)
  body.querySelectorAll('[data-timer-field]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const f = inp.dataset.timerField;
      let v = inp.value;
      if (f === 'initial_value') {
        v = Math.max(1, parseInt(v) || 1);
        // Also update current_value to match new initial
        await api.put(`/api/turn-timers/${inp.dataset.timerId}`, { [f]: v, current_value: v });
      } else {
        await api.put(`/api/turn-timers/${inp.dataset.timerId}`, { [f]: v });
      }
      await refreshChar();
      renderTurnCounter();
    });
  });

  // Reset individual timer
  body.querySelectorAll('[data-timer-reset]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.post(`/api/turn-timers/${btn.dataset.timerReset}/reset`);
      await refreshChar();
      renderTurnCounter();
    });
  });

  // Delete timer
  body.querySelectorAll('[data-timer-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.del(`/api/turn-timers/${btn.dataset.timerDel}`);
      await refreshChar();
      renderTurnCounter();
    });
  });
}

// ══════════════════════════════════════════════════════════════
// EFFECTS PANEL
// ══════════════════════════════════════════════════════════════
function renderEffects() {
  const c = getChar();
  if (!c) return;
  const body = $('#effects-body');
  const scrollEl = $('.main-area');
  const savedScroll = scrollEl ? scrollEl.scrollTop : 0;

  let html = '';
  for (const e of (c.effects || [])) {
    html += `
      <div class="effect-row ${e.is_active ? '' : 'inactive'}">
        <label class="toggle-switch"><input type="checkbox" ${e.is_active ? 'checked' : ''} data-eff-id="${e.id}"><span class="slider"></span></label>
        <input type="text" class="effect-name" value="${e.name}" data-eff-id="${e.id}" data-eff-field="name">
        <select data-eff-id="${e.id}" data-eff-field="effect_type">
          <option value="percent_reduction" ${e.effect_type === 'percent_reduction' ? 'selected' : ''}>% Reduction</option>
          <option value="flat_reduction" ${e.effect_type === 'flat_reduction' ? 'selected' : ''}>Flat Reduction</option>
        </select>
        <input type="number" value="${e.value}" data-eff-id="${e.id}" data-eff-field="value" style="width:55px">
        <button class="btn-icon danger" data-del-eff="${e.id}" title="Delete">🗑</button>
      </div>`;
  }
  html += `<button class="btn btn-ghost btn-sm mt-4" id="btn-add-effect">+ Add Effect</button>`;
  body.innerHTML = html;
  if (scrollEl) scrollEl.scrollTop = savedScroll;

  // Toggle
  body.querySelectorAll('[data-eff-id][type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await api.put(`/api/effects/${cb.dataset.effId}`, { is_active: cb.checked });
      await refreshChar();
      renderEffects();
    });
  });

  // Update fields
  body.querySelectorAll('[data-eff-field]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const f = inp.dataset.effField;
      let v = inp.value;
      if (f === 'value') v = parseFloat(v) || 0;
      await api.put(`/api/effects/${inp.dataset.effId}`, { [f]: v });
      await refreshChar();
    });
  });

  // Delete
  body.querySelectorAll('[data-del-eff]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.del(`/api/effects/${btn.dataset.delEff}`);
      await refreshChar();
      renderEffects();
    });
  });

  // Add
  $('#btn-add-effect').addEventListener('click', async () => {
    await api.post(`/api/characters/${c.id}/effects`, { name: 'New Effect', effect_type: 'percent_reduction', value: 0 });
    await refreshChar();
    renderEffects();
  });
}

// ══════════════════════════════════════════════════════════════
// ENEMY DAMAGE CALCULATOR (sidebar — persists across char switches)
// ══════════════════════════════════════════════════════════════
function renderEnemyCalc() {
  const body = $('#enemy-calc-body');

  let defHtml = '';
  for (const d of enemyDefenses) {
    defHtml += `
      <div class="defense-row ${d.active ? '' : 'inactive'}">
        <label class="toggle-switch"><input type="checkbox" ${d.active ? 'checked' : ''} data-edef-id="${d.id}"><span class="slider"></span></label>
        <input type="text" value="${d.name}" data-edef-id="${d.id}" data-edef-field="name">
        <select data-edef-id="${d.id}" data-edef-field="type">
          <option value="percent_reduction" ${d.type === 'percent_reduction' ? 'selected' : ''}>%</option>
          <option value="flat_reduction" ${d.type === 'flat_reduction' ? 'selected' : ''}>Flat</option>
        </select>
        <input type="number" value="${d.value}" data-edef-id="${d.id}" data-edef-field="value">
        <button class="btn-icon danger" data-del-edef="${d.id}">🗑</button>
      </div>`;
  }

  body.innerHTML = `
    <div class="field-group">
      <label data-tooltip="Your total attack roll (d20 + all mods)">My Attack Roll:</label>
      <input type="number" id="ec-my-roll" value="" placeholder="Total">
    </div>
    <div class="field-group">
      <label>Enemy KD (AC):</label>
      <input type="number" id="ec-enemy-kd" value="10">
    </div>
    <div class="field-group">
      <label>Damage Rolled:</label>
      <input type="number" id="ec-damage" value="" placeholder="Dmg total">
    </div>
    <div class="defense-list">
      <label class="text-muted" style="font-size:0.75rem">Defense Bonuses:</label>
      ${defHtml}
      <button class="btn btn-ghost btn-xs mt-4" id="btn-add-edef">+ Defense</button>
    </div>
    <button class="btn btn-accent btn-sm mt-8" id="btn-calc-enemy">🎯 CALCULATE</button>
    <div class="result-box" id="ec-result"><span class="text-muted">Fill in fields and calculate</span></div>
  `;

  // Toggle defense
  body.querySelectorAll('[data-edef-id][type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const d = enemyDefenses.find(x => x.id === parseInt(cb.dataset.edefId));
      if (d) d.active = cb.checked;
      renderEnemyCalc();
    });
  });

  // Update defense fields
  body.querySelectorAll('[data-edef-field]').forEach(inp => {
    inp.addEventListener('change', () => {
      const d = enemyDefenses.find(x => x.id === parseInt(inp.dataset.edefId));
      if (!d) return;
      const f = inp.dataset.edefField;
      d[f] = f === 'value' ? parseFloat(inp.value) || 0 : inp.value;
    });
  });

  // Delete defense
  body.querySelectorAll('[data-del-edef]').forEach(btn => {
    btn.addEventListener('click', () => {
      enemyDefenses = enemyDefenses.filter(x => x.id !== parseInt(btn.dataset.delEdef));
      renderEnemyCalc();
    });
  });

  // Add defense
  $('#btn-add-edef').addEventListener('click', () => {
    enemyDefenses.push({ id: ++enemyDefenseIdCounter, name: 'Defense', type: 'percent_reduction', value: 0, active: true });
    renderEnemyCalc();
  });

  // Calculate
  $('#btn-calc-enemy').addEventListener('click', async () => {
    const myRoll = parseInt($('#ec-my-roll').value);
    const enemyKd = parseInt($('#ec-enemy-kd').value);
    const dmg = parseInt($('#ec-damage').value);
    if (isNaN(myRoll) || isNaN(enemyKd) || isNaN(dmg)) {
      $('#ec-result').innerHTML = '<span class="text-danger">Fill all fields</span>';
      return;
    }

    const activeDefs = enemyDefenses.filter(d => d.active);
    const res = await api.post('/api/calc/enemy-damage', {
      my_roll: myRoll, enemy_kd: enemyKd, damage_rolled: dmg,
      defense_bonuses: activeDefs.map(d => ({ name: d.name, type: d.type, value: d.value })),
    });

    if (res.hit_diff <= 0) {
      $('#ec-result').innerHTML = `<span class="miss-text">MISS!</span> Diff: ${res.hit_diff}`;
    } else {
      let text = `Diff: ${res.hit_diff} → <span class="tier-text">${res.tier_label}</span><br>`;
      text += `Base: ${dmg} × ${res.multiplier} = ${res.base_damage}`;
      if (res.defense_breakdown.length) {
        for (const d of res.defense_breakdown) {
          if (d.type === 'percent_reduction') text += `<br>→ ${d.name}: ×${d.factor.toFixed(2)}`;
          else text += `<br>→ ${d.name}: -${d.value}`;
        }
      }
      text += `<br><strong>Final: <span class="damage-num">${res.final_damage} damage</span></strong>`;
      $('#ec-result').innerHTML = text;
    }
    addLog(`[Enemy] Roll(${myRoll}) vs KD(${enemyKd}) = ${res.hit_diff} → ${res.tier_label} → ${res.final_damage} dmg`);
  });
}

// ══════════════════════════════════════════════════════════════
// CALCULATION LOG
// ══════════════════════════════════════════════════════════════
function renderLog() {
  const el = $('#calc-log');
  if (!el) return;
  el.innerHTML = calcLog.map(l => `<div class="log-entry"><span class="log-time">[${l.time}]</span>${l.text}</div>`).join('');

  // Roll history
  const rh = $('#roll-history-log');
  if (rh) {
    const typeColors = { attack: 'var(--color-accent)', damage: 'var(--color-damage)', heal: 'var(--color-heal)', generic: 'var(--color-text-muted)' };
    rh.innerHTML = rollHistory.map(r =>
      `<div class="log-entry"><span class="log-time">[${r.time}]</span> <span style="color:${typeColors[r.type] || typeColors.generic}">[${r.type}]</span> ${r.charName}: ${r.description}</div>`
    ).join('') || '<div class="text-muted">No rolls yet</div>';
  }

  // Tab switching
  document.querySelectorAll('.log-tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.log-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.logTab;
      if ($('#calc-log')) $('#calc-log').style.display = tab === 'calc' ? '' : 'none';
      if ($('#roll-history-log')) $('#roll-history-log').style.display = tab === 'rolls' ? '' : 'none';
    };
  });
}

// ══════════════════════════════════════════════════════════════
// DICE ROLLER
// ══════════════════════════════════════════════════════════════
function setupDiceRoller() {
  $('#btn-dice-roller-toggle').addEventListener('click', () => {
    $('#dice-roller-popup').classList.toggle('hidden');
  });
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById(btn.dataset.close).classList.add('hidden');
    });
  });

  $('#dr-roll').addEventListener('click', () => {
    const count = parseInt($('#dr-count').value) || 1;
    const die = parseInt($('#dr-die').value) || 20;
    const rolls = [];
    for (let i = 0; i < count; i++) rolls.push(Math.floor(Math.random() * die) + 1);
    const total = rolls.reduce((a, b) => a + b, 0);

    $('#dr-result').innerHTML = rolls.map(r => `<span class="roll-val dice-pop">${r}</span>`).join(' ') +
      ` = <strong>${total}</strong>`;
    flash($('#dr-roll'), 'dice-shake');
    playSound('dice');
    addRollHistory('generic', `${count}d${die}: [${rolls.join(',')}] = ${total}`, total);

    diceHistory.unshift(`${count}d${die}: [${rolls.join(', ')}] = ${total}`);
    if (diceHistory.length > 10) diceHistory.pop();
    $('#dr-history').innerHTML = diceHistory.map(h => `<div>${h}</div>`).join('');
  });
}

// ══════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════
function setupSettings() {
  $('#btn-settings').addEventListener('click', () => {
    $('#settings-modal').classList.toggle('hidden');
  });

  // Load saved settings
  const savedFont = localStorage.getItem('dnd-fontsize') || 'normal';
  const savedTheme = localStorage.getItem('dnd-theme') || 'dark';
  const savedSound = localStorage.getItem('dnd-sound') || 'on';
  $('#setting-fontsize').value = savedFont;
  $('#setting-theme').value = savedTheme;
  $('#setting-sound').value = savedSound;
  applySettings(savedFont, savedTheme);

  $('#setting-fontsize').addEventListener('change', () => {
    const fs = $('#setting-fontsize').value;
    localStorage.setItem('dnd-fontsize', fs);
    applySettings(fs, $('#setting-theme').value);
  });
  $('#setting-theme').addEventListener('change', () => {
    const th = $('#setting-theme').value;
    localStorage.setItem('dnd-theme', th);
    applySettings($('#setting-fontsize').value, th);
  });
  $('#setting-sound').addEventListener('change', () => {
    const snd = $('#setting-sound').value;
    localStorage.setItem('dnd-sound', snd);
    SFX.enabled = snd !== 'off';
  });
}

function applySettings(fontSize, theme) {
  document.body.classList.toggle('font-large', fontSize === 'large');
  document.body.classList.toggle('theme-darker', theme === 'darker');
  document.body.classList.toggle('theme-light', theme === 'light');
}

// ══════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════════════
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const inInput = document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'SELECT';

    // Escape — close modals/popups
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => m.classList.add('hidden'));
      document.querySelectorAll('.popup:not(.hidden)').forEach(p => p.classList.add('hidden'));
      document.querySelectorAll('.ctx-menu').forEach(m => m.remove());
      document.querySelectorAll('#avatar-picker-modal').forEach(m => m.remove());
      return;
    }
    // Ctrl+Z — undo last action
    if (e.ctrlKey && e.key === 'z') {
      e.preventDefault();
      playSound('undo');
      performUndo();
      return;
    }
    // Ctrl+1..9 — switch characters
    if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key) - 1;
      if (idx < characters.length) {
        e.preventDefault();
        switchTo(characters[idx].id);
      }
      return;
    }
    if (inInput) return; // Below shortcuts only when not typing
    // R — roll d20 (attack panel) or dice roller if open
    if (e.key === 'r' || e.key === 'R') {
      if (!$('#dice-roller-popup').classList.contains('hidden')) {
        $('#dr-roll').click();
      } else if ($('#atk-d20-roll')) {
        $('#atk-d20-roll').click();
      }
      return;
    }
    // N — next turn
    if (e.key === 'n' || e.key === 'N') {
      const btn = $('#btn-next-turn');
      if (btn) btn.click();
      return;
    }
    // D — toggle dice roller
    if (e.key === 'd' || e.key === 'D') {
      $('#dice-roller-popup').classList.toggle('hidden');
      return;
    }
  });
}
