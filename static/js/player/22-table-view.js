// ════════════════════════════════════════════════════════
// Phase 6: table view
// Source: player-app.js lines 3538-3691
// ════════════════════════════════════════════════════════

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
    const dockTarget = $('#dock-target');
    const dockTargetName = $('#dock-target-name');
    if (dockTarget) dockTarget.style.display = 'flex';
    if (dockTargetName) dockTargetName.textContent = t ? t.name : `#${selectedTargetId}`;
  } else {
    info.style.display = 'none';
    const dockTarget = $('#dock-target');
    if (dockTarget) dockTarget.style.display = 'none';
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
