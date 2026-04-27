// ════════════════════════════════════════════════════════
// FIX 4: reactions panel
// Source: player-app.js lines 4604-4717
// ════════════════════════════════════════════════════════

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
