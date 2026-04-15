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
