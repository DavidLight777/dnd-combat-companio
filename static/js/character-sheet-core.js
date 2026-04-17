/* ══════════════════════════════════════════════════════════════
   Character Sheet Core — shared rendering functions
   Used by both gm-app.js and player-app.js
   ══════════════════════════════════════════════════════════════ */
'use strict';

const STAT_KEYS = ['strength','dexterity','constitution','intelligence','wisdom','charisma'];
const STAT_LABELS = ['STR','DEX','CON','INT','WIS','CHA'];

/**
 * Render the stats display row (effective = base + modifiers).
 * @param {object} character - character data object
 * @param {HTMLElement} container - target container
 * @param {object} options - { canEditStats }
 */
function renderStatsSection(character, container, options = {}) {
  const c = character;
  let html = '<div class="stats-inline">';
  STAT_KEYS.forEach((s, i) => {
    const base = c[s];
    const modSum = (c.stat_modifiers || [])
      .filter(m => m.stat_name === s && m.is_active)
      .reduce((a, m) => a + m.value, 0);
    const eff = base + modSum;
    const modLabel = modSum !== 0
      ? ` <span style="font-size:0.55rem;color:${modSum > 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">(${modSum > 0 ? '+' : ''}${modSum})</span>`
      : '';
    html += `<div class="stat-inline"><div class="sl">${STAT_LABELS[i]}</div><div class="sv">${eff}${modLabel}</div></div>`;
  });
  html += `<div class="stat-inline"><div class="sl">KD</div><div class="sv" style="color:var(--accent)">${c.armor_class}</div></div>`;
  html += '</div>';

  if (options.canEditStats) {
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">';
    STAT_KEYS.forEach((s, i) => {
      html += `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">
        <span style="font-size:0.6rem;color:var(--text-muted)">${STAT_LABELS[i]}</span>
        <input type="number" value="${c[s]}" data-gm-stat="${s}" style="width:48px;font-size:0.78rem;padding:3px">
      </div>`;
    });
    html += `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">
      <span style="font-size:0.6rem;color:var(--text-muted)">KD</span>
      <input type="number" value="${c.armor_class}" data-gm-stat="armor_class" style="width:48px;font-size:0.78rem;padding:3px">
    </div>`;
    html += `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">
      <span style="font-size:0.6rem;color:var(--text-muted)">MaxHP</span>
      <input type="number" value="${c.max_hp}" data-gm-stat="max_hp" style="width:48px;font-size:0.78rem;padding:3px">
    </div>`;
    html += `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">
      <span style="font-size:0.6rem;color:#60a5fa">MaxMP</span>
      <input type="number" value="${c.mana_max}" data-gm-stat="mana_max" style="width:48px;font-size:0.78rem;padding:3px">
    </div>`;
    html += `<div style="display:flex;flex-direction:column;align-items:center;gap:2px">
      <span style="font-size:0.6rem;color:#60a5fa">MP/T</span>
      <input type="number" value="${c.mana_regen_per_turn}" data-gm-stat="mana_regen_per_turn" style="width:48px;font-size:0.78rem;padding:3px">
    </div>`;
    html += '</div>';
  }

  container.innerHTML = html;
}

/**
 * Render HP bar with quick buttons.
 * @param {object} character
 * @param {HTMLElement} container
 * @param {object} options - { canEditHP }
 */
function renderHPSection(character, container, options = {}) {
  const c = character;
  const pct = c.max_hp > 0 ? Math.min(100, c.current_hp / c.max_hp * 100) : 0;
  const hpColor = pct > 50 ? 'var(--accent-green)' : pct > 25 ? 'var(--accent-orange)' : 'var(--accent-red)';
  let html = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
      <span style="font-size:1.5rem;font-weight:700;color:${hpColor};font-variant-numeric:tabular-nums">${c.current_hp} / ${c.max_hp}</span>
      <span style="font-size:0.8rem;color:var(--text-muted)">KD: ${c.armor_class}</span>
      <div class="hp-bar-container" style="flex:1"><div class="hp-bar" style="width:${pct}%;background:${hpColor}"></div></div>
    </div>`;

  if (options.canEditHP) {
    html += `
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
  }

  container.innerHTML = html;
}

/**
 * Render permanent bonuses (race/class modifiers).
 * @param {object} character
 * @returns {string} HTML string
 */
function renderPermanentBonuses(character) {
  const raceMods = (character.stat_modifiers || []).filter(m => m.source === 'race');
  const classMods = (character.stat_modifiers || []).filter(m => m.source === 'class');
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
}

/**
 * Render an ability card for a character ability.
 * @param {object} ability - ability data with character_ability_id
 * @param {object} options - { showUse, showRemove }
 * @returns {string} HTML string
 */
function renderAbilityCard(ability, options = {}) {
  const a = ability;
  const onCd = a.cooldown_remaining > 0;
  const typeBadge = a.ability_type === 'passive'
    ? '<span style="font-size:0.6rem;background:#3b82f620;color:#60a5fa;padding:1px 5px;border-radius:8px">passive</span>'
    : a.ability_type === 'reaction'
    ? '<span style="font-size:0.6rem;background:#f59e0b20;color:#f59e0b;padding:1px 5px;border-radius:8px">reaction</span>'
    : '';
  const costParts = [];
  if (a.mana_cost) costParts.push(`🔮${a.mana_cost}`);
  if (a.hp_cost) costParts.push(`❤️${a.hp_cost}`);

  let actions = '';
  if (options.showUse && a.ability_type !== 'passive' && !onCd) {
    actions += `<button class="btn btn-primary btn-xs" data-use-ca="${a.character_ability_id}" data-use-name="${a.name}" style="font-size:0.6rem;padding:1px 6px">Use</button>`;
  }
  if (options.showRemove) {
    actions += `<button class="btn btn-ghost btn-xs" data-rm-ca="${a.character_ability_id}" style="color:var(--accent-red);font-size:0.65rem">✕</button>`;
  }

  return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;padding:4px 8px;border-left:3px solid ${a.color||'#60a5fa'};background:var(--bg-surface-2);border-radius:var(--r-sm);${onCd?'opacity:0.5':''}">
    <span style="font-weight:600;font-size:0.78rem">${a.icon||'⚡'} ${a.name}</span>
    ${typeBadge}
    ${costParts.length ? `<span style="font-size:0.65rem;color:var(--text-muted)">${costParts.join(' ')}</span>` : ''}
    ${onCd ? `<span style="color:var(--accent-orange);font-size:0.65rem">⏳${a.cooldown_remaining}t</span>` : ''}
    ${a.cooldown_turns && !onCd ? `<span style="font-size:0.6rem;color:var(--text-muted)">CD:${a.cooldown_turns}t</span>` : ''}
    <span style="margin-left:auto;display:flex;gap:3px">${actions}</span>
  </div>`;
}


/* ══════════════════════════════════════════════════════════════
   FIX 3: Universal Dice Roll Widget
   One reusable component for ALL rolls across GM & Player panels.

   Usage:
     createDiceRollWidget(container, {
       label: 'Attack Roll',
       defaultDiceCount: 1,
       defaultDiceType: 20,
       showDiceSelector: true,        // show [count] d [type] picker
       showAdvantage: true,           // show adv toggle
       showRollButton: true,          // show built-in Roll button (set false to use external confirm)
       fixedDiceType: null,           // e.g. 20 to force D20 with no selector
       lockDiceCount: false,          // make count read-only
       onRoll: async ({diceCount, diceType, advantageMode}) => apiResponse,
       onStateChange: ({diceCount, diceType, advantageMode}) => {},
       resultFormatter: (apiResponse, state) => 'string or HTML',
     });

   Returns an object with helpers:
     { getState, setState, showResult, setLoading, reset, destroy }
   ══════════════════════════════════════════════════════════════ */
function createDiceRollWidget(container, opts = {}) {
  if (!container) return null;
  const {
    label = '',
    defaultDiceCount = 1,
    defaultDiceType = 20,
    showDiceSelector = true,
    showAdvantage = true,
    showRollButton = true,
    fixedDiceType = null,
    lockDiceCount = false,
    onRoll = null,
    onStateChange = null,
    resultFormatter = null,
    rollButtonText = 'Roll',
  } = opts;

  const state = {
    diceCount: Math.max(1, Math.min(20, parseInt(defaultDiceCount) || 1)),
    diceType:  fixedDiceType ? parseInt(fixedDiceType) : (parseInt(defaultDiceType) || 20),
    advantageMode: 'normal',
  };

  const diceOptions = [4, 6, 8, 10, 12, 20, 100];

  const html = `
    <div class="dice-roll-widget">
      ${label ? `<div class="widget-label">${label}</div>` : ''}
      ${showDiceSelector ? `
        <div class="dice-selector">
          <input type="number" class="dice-count" min="1" max="20"
                 value="${state.diceCount}" ${lockDiceCount ? 'readonly' : ''}>
          <span style="color:var(--text-muted)">d</span>
          <select class="dice-type" ${fixedDiceType ? 'disabled' : ''}>
            ${diceOptions.map(d => `<option value="${d}"${d === state.diceType ? ' selected' : ''}>${d}</option>`).join('')}
          </select>
        </div>
      ` : ''}
      ${showAdvantage ? `
        <div class="adv-toggle">
          <button class="adv-btn" data-mode="disadvantage" title="Disadvantage — roll twice, take lower">Disadv</button>
          <button class="adv-btn active" data-mode="normal" title="Normal">Normal</button>
          <button class="adv-btn" data-mode="advantage" title="Advantage — roll twice, take higher">Adv</button>
        </div>
      ` : ''}
      ${showRollButton ? `
        <button class="btn btn-primary btn-sm roll-btn" type="button">🎲 ${rollButtonText}</button>
      ` : ''}
      <div class="roll-result hidden">
        <span class="result-total"></span>
        <div class="result-breakdown"></div>
      </div>
    </div>
  `;
  container.innerHTML = html;

  const root = container.querySelector('.dice-roll-widget');
  const countEl = root.querySelector('.dice-count');
  const typeEl  = root.querySelector('.dice-type');
  const advBtns = root.querySelectorAll('.adv-btn');
  const rollBtn = root.querySelector('.roll-btn');
  const resultEl = root.querySelector('.roll-result');
  const totalEl  = root.querySelector('.result-total');
  const breakEl  = root.querySelector('.result-breakdown');

  function _notify() {
    if (typeof onStateChange === 'function') {
      try { onStateChange({ ...state }); } catch {}
    }
  }

  if (countEl) {
    countEl.addEventListener('input', () => {
      const v = Math.max(1, Math.min(20, parseInt(countEl.value) || 1));
      state.diceCount = v;
      _notify();
    });
  }
  if (typeEl) {
    typeEl.addEventListener('change', () => {
      state.diceType = parseInt(typeEl.value) || 20;
      _notify();
    });
  }
  advBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      advBtns.forEach(b => b.classList.toggle('active', b === btn));
      state.advantageMode = btn.dataset.mode;
      _notify();
    });
  });

  function setLoading(isLoading) {
    if (rollBtn) rollBtn.disabled = !!isLoading;
    if (isLoading) {
      resultEl.classList.remove('hidden');
      totalEl.textContent = '';
      breakEl.innerHTML = '<span style="color:var(--text-muted)">Rolling...</span>';
    }
  }

  function showResult(totalOrText, breakdown) {
    resultEl.classList.remove('hidden');
    if (typeof totalOrText === 'number') {
      totalEl.textContent = totalOrText;
      breakEl.innerHTML = breakdown || '';
    } else {
      // Treat as full HTML/string replacement
      totalEl.textContent = '';
      breakEl.innerHTML = totalOrText || '';
    }
  }

  function reset() {
    resultEl.classList.add('hidden');
    totalEl.textContent = '';
    breakEl.innerHTML = '';
  }

  function getState() { return { ...state }; }
  function setState(patch) {
    Object.assign(state, patch || {});
    if (countEl && patch && 'diceCount' in patch) countEl.value = state.diceCount;
    if (typeEl  && patch && 'diceType'  in patch) typeEl.value  = state.diceType;
    if (patch && 'advantageMode' in patch) {
      advBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === state.advantageMode));
    }
  }

  function destroy() { container.innerHTML = ''; }

  if (rollBtn && typeof onRoll === 'function') {
    rollBtn.addEventListener('click', async () => {
      setLoading(true);
      try {
        const res = await onRoll({ ...state });
        if (typeof resultFormatter === 'function') {
          const formatted = resultFormatter(res, { ...state });
          showResult(formatted);
        } else if (res && typeof res === 'object' && 'total' in res) {
          showResult(res.total, res.breakdown || '');
        } else {
          showResult(String(res ?? ''));
        }
      } catch (e) {
        const msg = e?.body?.detail || e?.message || 'Roll failed';
        showResult(`<span style="color:var(--accent-red)">${typeof msg === 'object' ? JSON.stringify(msg) : msg}</span>`);
      } finally {
        setLoading(false);
      }
    });
  }

  return { getState, setState, showResult, setLoading, reset, destroy, root };
}

/* ══════════════════════════════════════════════════════════════
   FIX 3: Breakdown string formatter (standard format)
   - Normal:       "D20(14) + STR(+3) = 17"
   - Advantage:    "ADV: D20[14, 9] → took 14 + STR(+3) = 17"
   - Disadvantage: "DISADV: D20[14, 9] → took 9 + STR(+3) = 12"
   ══════════════════════════════════════════════════════════════ */
function formatRollBreakdown({ diceLabel = 'D20', allRolls = [], chosenIndex = 0, mode = 'normal', modifiers = [], total = null }) {
  const chosen = allRolls[chosenIndex] ?? allRolls[0];
  let lead;
  if (mode === 'advantage' && allRolls.length > 1) {
    lead = `ADV: ${diceLabel}[${allRolls.join(', ')}] → took ${chosen}`;
  } else if (mode === 'disadvantage' && allRolls.length > 1) {
    lead = `DISADV: ${diceLabel}[${allRolls.join(', ')}] → took ${chosen}`;
  } else {
    lead = `${diceLabel}(${chosen})`;
  }
  const modsStr = modifiers
    .filter(m => m && m.value !== 0)
    .map(m => ` + ${m.label}(${m.value > 0 ? '+' : ''}${m.value})`)
    .join('');
  const totalStr = total !== null ? ` = ${total}` : '';
  return lead + modsStr + totalStr;
}

// Expose globally (no modules in this codebase)
if (typeof window !== 'undefined') {
  window.createDiceRollWidget = createDiceRollWidget;
  window.formatRollBreakdown  = formatRollBreakdown;
}
