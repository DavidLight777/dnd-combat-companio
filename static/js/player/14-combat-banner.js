// ════════════════════════════════════════════════════════
// Stage 5: combat banner + initiative
// Source: player-app.js lines 2381-2726
// ════════════════════════════════════════════════════════

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
