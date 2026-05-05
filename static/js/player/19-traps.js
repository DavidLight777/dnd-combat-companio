// Phase 17 Round 5: Player trap notifications
function openPlayerTrapModal(trap) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:360px">
      <h3>⚠️ ${trap.name || 'Trap'}</h3>
      <p style="color:var(--text-muted);font-size:0.85rem;margin:12px 0">Attempt to disarm this trap?</p>
      <div id="tp-disarm-form"></div>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:8px">
        <button class="btn btn-ghost btn-sm" id="tp-disarm-cancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#tp-disarm-cancel').addEventListener('click', () => overlay.remove());
  if (typeof createD20RollForm !== 'function') {
    showToast('Roll UI failed to load');
    return;
  }
  createD20RollForm(overlay.querySelector('#tp-disarm-form'), {
    idPrefix: 'tp-disarm',
    hideRollType: true,
    defaultAbility: 'dexterity',
    maxDice: 5,
    rollButtonText: 'Disarm',
    onRoll: async ({ ability, diceCount, advantageMode }) => {
      const advantage_mode = advantageMode;
      const d20_count = diceCount;
      const res = await api.post(`/api/builder-v2/traps/${trap.id}/disarm`, { character_id: CHAR_ID, ability, advantage_mode, d20_count });
      if (!res?.rolls) throw new Error(res?.detail || 'Disarm failed');
      const mod = res.modifier >= 0 ? `+${res.modifier}` : `${res.modifier}`;
      showToast(`${res.success ? '🔧 Trap disarmed!' : '🔧 Disarm failed!'} Roll ${res.rolls.join(', ')} → ${res.chosen_roll}${mod} = ${res.total} vs DC ${res.dc}`);
      setTimeout(() => overlay.remove(), 400);
      if (typeof loadPlayerMapState === 'function') loadPlayerMapState();
      return res;
    },
    resultFormatter: res => {
      if (!res?.rolls) return '';
      const mod = res.modifier >= 0 ? `+${res.modifier}` : `${res.modifier}`;
      return `<span style="color:var(--accent)">${res.rolls.join(', ')} → ${res.chosen_roll}${mod} = ${res.total} vs DC ${res.dc}</span>`;
    },
  });
}

ws.on('trap.triggered', d => {
  if (d.character_id !== CHAR_ID) return;
  if (d.missed) {
    showToast(`⚠️ ${d.trap_name} missed you!`);
  } else {
    showToast(`☠️ ${d.trap_name} dealt ${d.damage} ${d.damage_type} damage!`);
    if (d.dot_applied) {
      showToast(`☠️ ${d.dot_name} applied (${d.dot_turns} turns)`);
    }
    // Refresh HP display
    if (typeof loadChar === 'function') loadChar();
  }
});

// Dodge offer modal
ws.on('trap.dodge_offer', d => {
  if (d.character_id !== CHAR_ID) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:320px;text-align:center">
      <h3>⚠️ ${d.trap_name || 'Trap'}</h3>
      <p style="color:var(--text-muted);font-size:0.85rem;margin:12px 0">A trap is about to spring! Attempt to dodge?</p>
      <div style="display:flex;gap:8px;justify-content:center">
        <button class="btn btn-ghost btn-sm" id="tp-dodge-cancel">Accept Hit</button>
        <button class="btn btn-primary btn-sm" id="tp-dodge-roll">🎲 Dodge</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#tp-dodge-cancel').addEventListener('click', async () => {
    try {
      const res = await api.post(`/api/builder-v2/traps/${d.trap_id}/dodge`, { character_id: CHAR_ID, force_hit: true });
      showToast(`💥 Trap hit you for ${res.damage || 0} damage!`);
      if (typeof loadChar === 'function') loadChar();
    } catch (e) {
      showToast('Failed to resolve trap');
      console.error(e);
    }
    overlay.remove();
  });
  overlay.querySelector('#tp-dodge-roll').addEventListener('click', async () => {
    try {
      const res = await api.post(`/api/builder-v2/traps/${d.trap_id}/dodge`, { character_id: CHAR_ID });
      showToast(res.missed ? '🛡️ You dodged the trap!' : '💥 Dodge failed!');
      overlay.remove();
      if (typeof loadChar === 'function') loadChar();
    } catch (e) {
      showToast('Failed to dodge');
      console.error(e);
      overlay.remove();
    }
  });
});

ws.on('trap.dodge_resolved', d => {
  if (d.character_id !== CHAR_ID) return;
  showToast(d.missed ? '🛡️ You dodged the trap!' : `💥 Trap hit you for ${d.damage || 0} damage!`);
  if (typeof loadChar === 'function') loadChar();
});

ws.on('trap.disarm_resolved', d => {
  if (d.character_id !== CHAR_ID) return;
  showToast(d.success ? '🔧 Trap disarmed!' : '🔧 Disarm failed!');
});
