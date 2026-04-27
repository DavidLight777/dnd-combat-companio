// ════════════════════════════════════════════════════════
// Combat tab, roll log, FX, defense reactions
// Source: gm-app.js lines 4712–5800
// Globals shared via window.* and module-scope hoisting.
// ════════════════════════════════════════════════════════

// STAGE 5 — COMBAT TAB
// ══════════════════════════════════════════════════════════════
let activeCombat = null;
let combatTimerInterval = null;

async function loadCombatPanel() {
  const panel = document.querySelector('#combat-panel');
  if (!panel) return;

  // Check for active combat
  const res = await api.get(`/api/combat/session/${SESSION_CODE}/active`);
  if (res.active && res.combat.status === 'active') {
    activeCombat = res.combat;
    renderActiveCombat(panel);
  } else if (res.active && res.combat.status === 'preparing') {
    activeCombat = res.combat;
    renderPreparingCombat(panel);
  } else {
    activeCombat = null;
    renderCombatSetup(panel);
  }
}

function renderCombatSetup(panel) {
  panel.innerHTML = `
    <div class="detail-panel">
      <div class="detail-header">
        <h2>⚔️ Combat Manager</h2>
      </div>
      <div class="detail-body">
        <div style="display:flex;gap:8px;margin-bottom:12px;align-items:center">
          <input type="text" id="combat-name" placeholder="Combat name (e.g. Ambush at the bridge)" style="flex:1">
          <button class="btn btn-primary btn-sm" id="btn-create-combat">🗡️ New Combat</button>
        </div>
        <p class="text-muted" style="font-size:0.8rem">No active combat. Create one to begin.</p>
      </div>
    </div>
  `;
  panel.querySelector('#btn-create-combat').addEventListener('click', async () => {
    const name = panel.querySelector('#combat-name').value.trim() || 'Combat';
    const sess = await api.get(`/api/sessions/${SESSION_CODE}`);
    const res = await api.post('/api/combat/create', { session_id: sess.id, name });
    activeCombat = res;
    renderPreparingCombat(panel);
    addLog('gm.combat', `Combat "${name}" created`);
    // Broadcast
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({ type: 'combat.created', data: { combat_id: res.id, name } }));
    }
  });
}

function renderPreparingCombat(panel) {
  const c = activeCombat;
  const allChars = characters;
  const partIds = new Set(c.participants.map(p => p.character_id));

  panel.innerHTML = `
    <div class="detail-panel">
      <div class="detail-header">
        <h2>⚔️ ${c.name} <span class="cc-badge" style="background:var(--accent-orange)">Preparing</span> <span id="difficulty-badge" style="font-size:0.65rem"></span></h2>
      </div>
      <div class="detail-body">
        <div style="font-size:0.8rem;font-weight:600;margin-bottom:6px">Add Participants:</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px" id="combat-char-selector">
          ${allChars.map(ch => {
            const inCombat = partIds.has(ch.id);
            const label = ch.is_npc ? 'NPC' : 'Player';
            return `<label style="display:flex;gap:4px;align-items:center;padding:4px 8px;border:1px solid var(--border);border-radius:var(--r-md);font-size:0.78rem;cursor:pointer;${inCombat?'background:var(--accent)20;border-color:var(--accent)':''}">
              <input type="checkbox" value="${ch.id}" ${inCombat?'checked':''} ${!ch.is_alive?'disabled':''}>
              ${ch.name} <span style="font-size:0.65rem;color:var(--text-muted)">(${label})</span>
              ${!ch.is_alive?'💀':''}
            </label>`;
          }).join('')}
        </div>
        <button class="btn btn-ghost btn-xs" id="btn-combat-update-participants" style="margin-bottom:12px">Update Participants</button>

        <hr class="section-divider">
        <div style="font-size:0.8rem;font-weight:600;margin-bottom:6px">Participants & Initiative:</div>
        <div id="combat-participants-list" style="margin-bottom:10px">${renderParticipantRows(c)}</div>

        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
          <button class="btn btn-primary btn-sm" id="btn-combat-roll-npc">🎲 Roll NPC Initiative</button>
          <button class="btn btn-ghost btn-sm" id="btn-combat-request-player-rolls">📣 Request Player Rolls</button>
        </div>

        <hr class="section-divider">
        <button class="btn btn-primary btn-sm" id="btn-combat-start" style="width:100%">▶ Start Combat</button>
      </div>
    </div>
  `;

  // Helper: sync checkboxes → API, refresh state
  async function syncParticipants() {
    const checked = [...panel.querySelectorAll('#combat-char-selector input:checked')].map(i => parseInt(i.value));
    const current = new Set(activeCombat.participants.map(p => p.character_id));
    const toAdd = checked.filter(id => !current.has(id));
    const toRemove = [...current].filter(id => !checked.includes(id));

    for (const id of toRemove) {
      await api.del(`/api/combat/${activeCombat.id}/participants/${id}`);
    }
    if (toAdd.length) {
      await api.post(`/api/combat/${activeCombat.id}/add-participants`, { character_ids: toAdd });
    }
    if (toAdd.length || toRemove.length) {
      const state = await api.get(`/api/combat/${activeCombat.id}/state`);
      activeCombat = state;
    }
  }

  // Auto-sync when checkbox changes
  panel.querySelectorAll('#combat-char-selector input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await syncParticipants();
      panel.querySelector('#combat-participants-list').innerHTML = renderParticipantRows(activeCombat);
      wireInitiativeInputs(panel, activeCombat);
      updateDifficultyBadge();
    });
  });

  // Initial difficulty badge
  updateDifficultyBadge();

  async function updateDifficultyBadge() {
    const badge = panel.querySelector('#difficulty-badge');
    if (!badge || !activeCombat) return;
    const parts = activeCombat.participants || [];
    const players = parts.filter(p => !p.is_npc).map(p => {
      const ch = characters.find(x => x.id === p.character_id);
      return { max_hp: ch?.max_hp ?? 0, armor_class: ch?.armor_class ?? 0, level: ch?.level ?? 0 };
    });
    const npcs = parts.filter(p => p.is_npc).map(p => {
      const ch = characters.find(x => x.id === p.character_id);
      return { max_hp: ch?.max_hp ?? 0, armor_class: ch?.armor_class ?? 0 };
    });
    if (!players.length || !npcs.length) { badge.textContent = ''; return; }
    try {
      const res = await api.post('/api/npc-library/encounter-difficulty', { players, npcs });
      const colors = { Trivial: '#888', Easy: '#4caf50', Medium: '#ff9800', Hard: '#f44336', Deadly: '#b71c1c' };
      const icons = { Trivial: '⚪', Easy: '🟢', Medium: '🟡', Hard: '🟠', Deadly: '🔴' };
      badge.innerHTML = `<span style="padding:2px 8px;border-radius:10px;background:${colors[res.difficulty]}20;color:${colors[res.difficulty]};font-weight:700">${icons[res.difficulty] || ''} ${res.difficulty}</span>`;
    } catch { badge.textContent = ''; }
  }

  // Update Participants button (still available as explicit sync)
  panel.querySelector('#btn-combat-update-participants').addEventListener('click', async () => {
    await syncParticipants();
    renderPreparingCombat(panel);
  });

  panel.querySelector('#btn-combat-roll-npc').addEventListener('click', async () => {
    await syncParticipants();
    if (!activeCombat.participants.some(p => p.is_npc)) {
      showToast('No NPC participants to roll for');
      return;
    }
    const res = await api.post(`/api/combat/${activeCombat.id}/roll-npc-initiative`);
    activeCombat = res.combat;
    panel.querySelector('#combat-participants-list').innerHTML = renderParticipantRows(activeCombat);
    wireInitiativeInputs(panel, activeCombat);
    addLog('gm.combat', `NPC initiative rolled: ${res.rolls.map(r => `${r.name}=${r.final}`).join(', ')}`);
  });

  panel.querySelector('#btn-combat-request-player-rolls').addEventListener('click', async () => {
    try { await syncParticipants(); } catch(e) { console.error('syncParticipants error:', e); }
    const playerParts = activeCombat.participants.filter(p => !p.is_npc);
    if (!playerParts.length) {
      showToast('No player participants');
      return;
    }
    const res = await api.post(`/api/combat/${activeCombat.id}/request-player-initiative`);
    if (res.sent_to && res.sent_to.length) {
      showToast(`Initiative request sent to ${res.sent_to.map(s => s.name).join(', ')}`);
    } else {
      showToast('No connected players to send to');
    }
  });

  panel.querySelector('#btn-combat-start').addEventListener('click', async () => {
    await syncParticipants();
    try {
      const res = await api.post(`/api/combat/${activeCombat.id}/start`);
      activeCombat = res;
      renderActiveCombat(panel);
      addLog('gm.combat', `Combat "${activeCombat.name}" started!`);
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({ type: 'combat.started', data: { combat_id: activeCombat.id } }));
      }
    } catch (e) {
      showToast('Cannot start: ensure all participants have initiative');
    }
  });

  // Manual initiative inputs
  wireInitiativeInputs(panel, activeCombat);
}

function renderParticipantRows(c) {
  if (!c.participants.length) return '<span class="text-muted" style="font-size:0.78rem">No participants yet.</span>';
  return c.participants.map(p => {
    const hpPct = p.max_hp > 0 ? (p.current_hp / p.max_hp * 100) : 0;
    const hpColor = hpPct > 50 ? 'var(--hp-high)' : hpPct > 25 ? 'var(--hp-mid)' : 'var(--hp-low)';
    const badge = p.is_npc ? '<span style="font-size:0.6rem;color:var(--text-muted)">NPC</span>' : '<span style="font-size:0.6rem;color:var(--accent)">Player</span>';
    const isCurrent = c.current_participant_id === p.id;
    return `<div style="display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);${isCurrent?'background:var(--accent)10;border-left:3px solid var(--accent);padding-left:5px':''}">
      <span style="font-size:0.9rem;min-width:28px;text-align:center;font-weight:700;color:${isCurrent?'var(--accent)':'var(--text-muted)'}">${p.final_initiative !== null ? p.final_initiative : '—'}</span>
      <div style="flex:1">
        <div style="font-size:0.8rem;font-weight:600">${p.name} ${badge}</div>
        <div class="hp-bar-container" style="height:4px;margin-top:2px"><div class="hp-bar" style="width:${hpPct}%;background:${hpColor}"></div></div>
      </div>
      <span style="font-size:0.7rem;color:var(--text-muted)">${p.current_hp}/${p.max_hp}</span>
      <input type="number" data-init-pid="${p.id}" value="${p.final_initiative !== null ? p.final_initiative : ''}" placeholder="Init" style="width:48px;font-size:0.75rem;text-align:center" title="Manual initiative">
    </div>`;
  }).join('');
}

function wireInitiativeInputs(panel, c) {
  panel.querySelectorAll('[data-init-pid]').forEach(input => {
    input.addEventListener('change', async () => {
      const pid = parseInt(input.dataset.initPid);
      const val = parseInt(input.value);
      if (isNaN(val)) return;
      await api.post(`/api/combat/${c.id}/set-manual-initiative`, { participant_id: pid, final_initiative: val });
    });
  });
}

function renderActiveCombat(panel) {
  const c = activeCombat;
  const currentP = c.participants.find(p => p.id === c.current_participant_id);

  panel.innerHTML = `
    <div class="detail-panel">
      <div class="detail-header">
        <h2>⚔️ ${c.name} <span class="cc-badge" style="background:var(--accent-green)">Active</span> <span style="font-size:0.8rem;color:var(--text-muted)">Round ${c.round_number}</span></h2>
        <button class="btn btn-danger btn-sm" id="btn-combat-end">⏹ End Combat</button>
      </div>
      <div class="detail-body">
        <!-- Current Turn Banner -->
        <div style="padding:10px;margin-bottom:12px;border-radius:var(--r-md);background:var(--accent)15;border:2px solid var(--accent);text-align:center">
          <div style="font-size:0.75rem;color:var(--text-muted)">Current Turn</div>
          <div style="font-size:1.2rem;font-weight:700;color:var(--accent)">${currentP ? currentP.name : '—'}</div>
          ${currentP && !currentP.is_npc ? `
            <div style="margin-top:6px;display:flex;gap:6px;justify-content:center;align-items:center" id="combat-timer-controls">
              <label style="font-size:0.7rem;color:var(--text-muted)">Timer (min):</label>
              <input type="number" id="combat-timer-min" value="2" style="width:50px;font-size:0.75rem" min="1" max="30" step="1">
              <button class="btn btn-ghost btn-xs" id="btn-combat-timer-start">⏱ Start</button>
              <button class="btn btn-ghost btn-xs" id="btn-combat-timer-pause" style="display:none">⏸</button>
              <button class="btn btn-ghost btn-xs" id="btn-combat-timer-resume" style="display:none">▶</button>
              <button class="btn btn-danger btn-xs" id="btn-combat-timer-stop" style="display:none">⏹</button>
            </div>
            <div id="combat-timer-display" style="font-size:1.5rem;font-weight:700;color:var(--accent-orange);margin-top:4px;display:none;font-variant-numeric:tabular-nums"></div>
          ` : ''}
        </div>

        <!-- Action Panel (NPC turn = GM controls) -->
        ${currentP && currentP.is_npc ? `
        <div style="padding:10px;margin-bottom:12px;border-radius:var(--r-md);background:var(--bg-dark);border:1px solid var(--border)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <span style="font-size:0.75rem;color:var(--text-muted)">⚔️ Actions for ${currentP.name}</span>
            ${makeAdvToggle('gm_combat')}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-danger btn-sm" id="btn-combat-attack">⚔️ Attack</button>
            <button class="btn btn-accent btn-sm" id="btn-combat-defend">🛡️ Defend</button>
            <button class="btn btn-primary btn-sm" id="btn-combat-next-turn" style="flex:1;min-width:120px;font-size:1rem;padding:10px">⏭ Next Turn</button>
          </div>
          <div id="combat-target-panel" style="display:none;margin-top:10px"></div>
          <div id="combat-action-result" style="margin-top:8px;font-size:0.85rem"></div>
        </div>
        ` : `
        <!-- Player turn: just next turn button -->
        <div style="display:flex;gap:6px;margin-bottom:12px">
          <button class="btn btn-primary" id="btn-combat-next-turn" style="flex:1;font-size:1rem;padding:10px">⏭ Next Turn</button>
        </div>
        `}

        <!-- Turn Order -->
        <div style="font-size:0.8rem;font-weight:600;margin-bottom:6px">Turn Order:</div>
        <div id="combat-turn-order">${renderParticipantRows(c)}</div>

        <!-- Combat Action Log -->
        <div style="margin-top:12px">
          <div style="font-size:0.8rem;font-weight:600;margin-bottom:6px">⚔️ Battle Log</div>
          <div id="combat-action-log" style="max-height:200px;overflow-y:auto;font-size:0.78rem;background:var(--bg-dark);border-radius:var(--r-sm);padding:6px"></div>
        </div>

        <!-- Turn Events -->
        <div id="combat-events" style="margin-top:8px;font-size:0.78rem"></div>
      </div>
    </div>
  `;

  // Wire Next Turn
  panel.querySelector('#btn-combat-next-turn').addEventListener('click', async () => {
    const res = await api.post(`/api/combat/${c.id}/next-turn`);
    activeCombat = res.combat;
    renderActiveCombat(panel);

    // Show events
    const evEl = panel.querySelector('#combat-events');
    if (evEl && res.turn_end_events && res.turn_end_events.length) {
      evEl.innerHTML = res.turn_end_events.map(e => {
        if (e.type === 'hp_change') return `<div style="color:var(--accent-red)">💔 ${e.character_name}: ${e.hp_change} HP (${e.sources.map(s=>s.name).join(', ')})</div>`;
        if (e.type === 'status_effect.expired') return `<div style="color:var(--accent-orange)">✨ ${e.character_name}: ${e.effect_name} expired</div>`;
        return '';
      }).join('');
    }
    if (res.skipped && res.skipped.length) {
      const skText = res.skipped.map(s => `⏭ ${s.name} skipped (${s.reason})`).join('<br>');
      if (evEl) evEl.innerHTML += skText;
    }

    addLog('gm.combat', `Turn: ${res.current_character_name} (Round ${res.combat.round_number})`);
    // Broadcast
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({ type: 'combat.turn_changed', data: {
        combat_id: c.id,
        current_character_id: res.current_character_id,
        current_character_name: res.current_character_name,
        round_number: res.combat.round_number,
      }}));
    }
  });

  // Wire End Combat
  panel.querySelector('#btn-combat-end').addEventListener('click', async () => {
    await api.post(`/api/combat/${c.id}/end`);
    activeCombat = null;
    addLog('gm.combat', `Combat ended`);
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({ type: 'combat.ended', data: { combat_id: c.id } }));
    }
    loadCombatPanel();
  });

  // Wire Combat Timer
  const ctStartBtn = panel.querySelector('#btn-combat-timer-start');
  const ctPauseBtn = panel.querySelector('#btn-combat-timer-pause');
  const ctResumeBtn = panel.querySelector('#btn-combat-timer-resume');
  const ctStopBtn = panel.querySelector('#btn-combat-timer-stop');
  const ctDisplay = panel.querySelector('#combat-timer-display');
  const ctInput = panel.querySelector('#combat-timer-min');

  if (ctStartBtn && currentP) {
    ctStartBtn.addEventListener('click', () => {
      const mins = parseFloat(ctInput.value) || 2;
      const secs = Math.round(mins * 60);
      startGmCombatTimer(secs, currentP.character_id);
    });
    ctPauseBtn.addEventListener('click', () => pauseGmCombatTimer());
    ctResumeBtn.addEventListener('click', () => resumeGmCombatTimer());
    ctStopBtn.addEventListener('click', () => {
      stopGmCombatTimer();
      sendPlayerTimerStop(currentP.character_id);
    });
    // Restore timer if one was running
    restoreGmCombatTimer();
  }

  // Bind combat advantage toggle
  bindAdvToggle(panel, 'gm_combat');

  // Wire Attack Button (NPC turn)
  const atkBtn = panel.querySelector('#btn-combat-attack');
  if (atkBtn && currentP) {
    atkBtn.addEventListener('click', async () => {
      const targetPanel = panel.querySelector('#combat-target-panel');
      if (!targetPanel) return;
      try {
        const targets = await api.get(`/api/combat/${c.id}/targets/${currentP.character_id}`);
        if (!targets.length) { showToast('No valid targets'); return; }
        targetPanel.style.display = 'block';
        targetPanel.innerHTML = `
          <div style="font-size:0.75rem;font-weight:600;margin-bottom:6px">Select Target:</div>
          ${targets.map(t => `
            <div class="combat-target-card" data-id="${t.character_id}" style="cursor:pointer;padding:8px;margin-bottom:4px;border-radius:var(--r-sm);border:1px solid var(--border);display:flex;align-items:center;gap:8px;transition:background 0.2s">
              <div style="width:20px;height:20px;border-radius:50%;background:${t.token_color}"></div>
              <div style="flex:1">
                <div style="font-weight:600;font-size:0.85rem">${t.name}${t.is_npc ? ' <span style="color:var(--text-muted);font-size:0.6rem">NPC</span>' : ''}</div>
                <div style="font-size:0.7rem;color:var(--text-muted)">HP: ${t.current_hp}/${t.max_hp} | AC: ${t.armor_class}</div>
              </div>
              <div style="width:60px;height:6px;background:var(--bg-dark);border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${Math.round(t.current_hp/t.max_hp*100)}%;background:${t.current_hp/t.max_hp > 0.5 ? 'var(--hp-high)' : t.current_hp/t.max_hp > 0.25 ? 'var(--hp-mid)' : 'var(--hp-low)'}"></div>
              </div>
            </div>
          `).join('')}
        `;
        targetPanel.querySelectorAll('.combat-target-card').forEach(card => {
          card.addEventListener('mouseenter', () => card.style.background = 'var(--accent)15');
          card.addEventListener('mouseleave', () => card.style.background = '');
          card.addEventListener('click', async () => {
            const targetId = parseInt(card.dataset.id);
            try {
              const result = await api.post(`/api/combat/${c.id}/attack`, {
                attacker_id: currentP.character_id, target_id: targetId,
                advantage_mode: getAdvMode('gm_combat'),
              });
              targetPanel.style.display = 'none';
              const resEl = panel.querySelector('#combat-action-result');
              if (resEl) {
                const atk = result.attack_roll;
                const dmg = result.damage_roll;
                let html = `<div style="padding:8px;border-radius:var(--r-sm);border:1px solid `;
                if (atk.critical) html += `gold;background:#ffd70020"><b style="color:gold">🎯 CRITICAL!</b>`;
                else if (atk.fumble) html += `var(--accent-red);background:var(--accent-red)10"><b style="color:var(--accent-red)">💨 FUMBLE!</b>`;
                else if (atk.hit) html += `var(--accent-green);background:var(--accent-green)10"><b style="color:var(--accent-green)">⚔️ HIT!</b>`;
                else html += `var(--text-muted);background:var(--bg-dark)"><b style="color:var(--text-muted)">🛡️ MISS</b>`;
                html += `<div style="font-size:0.75rem;margin-top:4px">d20: ${atk.d20} + STR: ${atk.stat_mod} + Wpn: ${atk.weapon_bonus} + Items: ${atk.item_bonuses} = ${atk.total} vs AC ${atk.target_ac}</div>`;
                if (dmg) {
                  html += `<div style="font-size:0.75rem;margin-top:2px">Damage: [${dmg.dice_rolls.join(',')}] + STR: ${dmg.stat_mod} + Wpn: ${dmg.weapon_damage_bonus} = ${dmg.final_damage} damage</div>`;
                  html += `<div style="font-size:0.75rem">${result.target_name}: ${result.target_current_hp}/${result.target_max_hp} HP</div>`;
                  if (result.target_killed) html += `<div style="color:var(--accent-red);font-weight:700;margin-top:4px">💀 ${result.target_name} SLAIN!</div>`;
                }
                html += `</div>`;
                resEl.innerHTML = html;
              }
              // Add to log & broadcast
              addLog('gm.combat', result.description);
              appendCombatLogEntry(result);
              if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
                ws.ws.send(JSON.stringify({ type: 'combat.attack_result', data: result }));
                if (result.target_killed) {
                  ws.ws.send(JSON.stringify({ type: 'combat.character_killed', data: {
                    character_id: targetId, character_name: result.target_name, killed_by: currentP.name
                  }}));
                }
              }
              // Refresh turn order HP bars
              const state = await api.get(`/api/combat/${c.id}/state`);
              activeCombat = state;
              const toEl = panel.querySelector('#combat-turn-order');
              if (toEl) toEl.innerHTML = renderParticipantRows(activeCombat);
            } catch (e) { showToast('Attack error: ' + e.message); }
          });
        });
      } catch (e) { showToast('Error loading targets: ' + e.message); }
    });
  }

  // Wire Defend Button (NPC turn)
  const defBtn = panel.querySelector('#btn-combat-defend');
  if (defBtn && currentP) {
    defBtn.addEventListener('click', async () => {
      try {
        const result = await api.post(`/api/combat/${c.id}/defend`, { character_id: currentP.character_id });
        const resEl = panel.querySelector('#combat-action-result');
        if (resEl) {
          resEl.innerHTML = `<div style="padding:8px;border-radius:var(--r-sm);border:1px solid var(--accent);background:var(--accent)10">
            <b style="color:var(--accent)">🛡️ DEFENDING</b>
            <div style="font-size:0.75rem;margin-top:4px">${result.description}</div>
            <div style="font-size:0.75rem">New AC: ${result.new_ac}</div>
          </div>`;
        }
        addLog('gm.combat', result.description);
        appendCombatLogEntry({ description: result.description, attack_roll: { defend: true } });
        if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
          ws.ws.send(JSON.stringify({ type: 'combat.defend', data: result }));
        }
      } catch (e) { showToast('Defend error: ' + e.message); }
    });
  }

  // Load battle log
  loadCombatActionLog(c.id);
}

async function loadCombatActionLog(combatId) {
  const logEl = document.querySelector('#combat-action-log');
  if (!logEl) return;
  try {
    const actions = await api.get(`/api/combat/${combatId}/actions`);
    logEl.innerHTML = actions.length ? actions.map(a => {
      let color = 'var(--text-muted)';
      if (a.attack_roll?.critical) color = 'gold';
      else if (a.attack_roll?.hit) color = 'var(--accent-green)';
      else if (a.attack_roll?.fumble) color = 'var(--accent-red)';
      else if (a.action_type === 'defend') color = 'var(--accent)';
      return `<div style="padding:3px 0;border-bottom:1px solid var(--border);color:${color}">
        <span style="color:var(--text-muted);font-size:0.65rem">R${a.round_number}</span> ${a.description}
      </div>`;
    }).join('') : '<div style="color:var(--text-muted)">No actions yet</div>';
  } catch(e) { logEl.innerHTML = ''; }
}

function appendCombatLogEntry(result) {
  const logEl = document.querySelector('#combat-action-log');
  if (!logEl) return;
  let color = 'var(--text-muted)';
  const atk = result.attack_roll;
  if (atk?.critical) color = 'gold';
  else if (atk?.hit) color = 'var(--accent-green)';
  else if (atk?.fumble) color = 'var(--accent-red)';
  else if (atk?.defend) color = 'var(--accent)';
  const entry = document.createElement('div');
  entry.style.cssText = `padding:3px 0;border-bottom:1px solid var(--border);color:${color}`;
  entry.innerHTML = `<span style="color:var(--text-muted);font-size:0.65rem">R${activeCombat?.round_number || '?'}</span> ${result.description}`;
  logEl.prepend(entry);
}

function formatGmTimer(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Combat Timer (localStorage-backed) ──
function _saveCombatTimer(state) {
  if (state) localStorage.setItem('gm-combat-timer', JSON.stringify(state));
  else localStorage.removeItem('gm-combat-timer');
}
function _getCombatTimer() {
  try { return JSON.parse(localStorage.getItem('gm-combat-timer')); } catch { return null; }
}

function _setCombatTimerUI(running, paused) {
  const startBtn = document.querySelector('#btn-combat-timer-start');
  const pauseBtn = document.querySelector('#btn-combat-timer-pause');
  const resumeBtn = document.querySelector('#btn-combat-timer-resume');
  const stopBtn = document.querySelector('#btn-combat-timer-stop');
  const input = document.querySelector('#combat-timer-min');
  const display = document.querySelector('#combat-timer-display');
  if (!startBtn) return;
  if (running) {
    startBtn.style.display = 'none';
    input.style.display = 'none';
    stopBtn.style.display = '';
    display.style.display = '';
    pauseBtn.style.display = paused ? 'none' : '';
    resumeBtn.style.display = paused ? '' : 'none';
  } else {
    startBtn.style.display = '';
    input.style.display = '';
    pauseBtn.style.display = 'none';
    resumeBtn.style.display = 'none';
    stopBtn.style.display = 'none';
    display.style.display = 'none';
    display.style.animation = '';
  }
}

function _tickCombatTimer() {
  const st = _getCombatTimer();
  if (!st || st.paused) return;
  const elapsed = Math.floor((Date.now() - st.startedAt) / 1000);
  const remaining = Math.max(0, st.totalSeconds - elapsed);
  const display = document.querySelector('#combat-timer-display');
  if (!display) return;
  display.textContent = formatGmTimer(remaining);
  display.style.color = remaining <= 10 ? 'var(--accent-red)' : 'var(--accent-orange)';
  if (remaining <= 0) {
    clearInterval(combatTimerInterval);
    combatTimerInterval = null;
    display.textContent = '⏰ TIME UP!';
    display.style.animation = 'pulse 0.5s ease-in-out 3';
    _saveCombatTimer(null);
    setTimeout(() => _setCombatTimerUI(false, false), 4000);
  }
}

function startGmCombatTimer(seconds, charId) {
  if (combatTimerInterval) clearInterval(combatTimerInterval);
  _saveCombatTimer({ totalSeconds: seconds, startedAt: Date.now(), paused: false, charId });
  _setCombatTimerUI(true, false);
  _tickCombatTimer();
  combatTimerInterval = setInterval(_tickCombatTimer, 1000);

  // Send timer to player
  if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
    ws.ws.send(JSON.stringify({
      type: 'combat.timer_started',
      player_id: charId,
      duration_seconds: seconds,
      combat_id: activeCombat ? activeCombat.id : null,
    }));
  }
}

function pauseGmCombatTimer() {
  const st = _getCombatTimer();
  if (!st) return;
  if (combatTimerInterval) { clearInterval(combatTimerInterval); combatTimerInterval = null; }
  const elapsed = Math.floor((Date.now() - st.startedAt) / 1000);
  const remaining = Math.max(0, st.totalSeconds - elapsed);
  _saveCombatTimer({ ...st, totalSeconds: remaining, startedAt: Date.now(), paused: true });
  _setCombatTimerUI(true, true);
}

function resumeGmCombatTimer() {
  const st = _getCombatTimer();
  if (!st) return;
  _saveCombatTimer({ ...st, startedAt: Date.now(), paused: false });
  _setCombatTimerUI(true, false);
  _tickCombatTimer();
  combatTimerInterval = setInterval(_tickCombatTimer, 1000);
}

function stopGmCombatTimer() {
  if (combatTimerInterval) { clearInterval(combatTimerInterval); combatTimerInterval = null; }
  _saveCombatTimer(null);
  _setCombatTimerUI(false, false);
}

function restoreGmCombatTimer() {
  const st = _getCombatTimer();
  if (!st) return;
  if (st.paused) {
    const display = document.querySelector('#combat-timer-display');
    if (display) {
      display.textContent = formatGmTimer(st.totalSeconds);
      display.style.color = st.totalSeconds <= 10 ? 'var(--accent-red)' : 'var(--accent-orange)';
    }
    _setCombatTimerUI(true, true);
  } else {
    const elapsed = Math.floor((Date.now() - st.startedAt) / 1000);
    const remaining = st.totalSeconds - elapsed;
    if (remaining <= 0) {
      _saveCombatTimer(null);
      return;
    }
    _setCombatTimerUI(true, false);
    _tickCombatTimer();
    combatTimerInterval = setInterval(_tickCombatTimer, 1000);
  }
}

function sendPlayerTimer(charId, seconds) {
  if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
    ws.ws.send(JSON.stringify({
      type: 'gm.timer',
      character_id: charId,
      duration_seconds: seconds,
    }));
  }
  showToast(`Timer ${formatGmTimer(seconds)} sent to player`);
}

function sendPlayerTimerStop(charId) {
  if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
    ws.ws.send(JSON.stringify({
      type: 'gm.timer_stop',
      character_id: charId,
    }));
  }
}

// ── Detail panel timer (localStorage-backed) ──
let detailTimerInterval = null;

function _saveDetailTimer(state) {
  if (state) localStorage.setItem('gm-detail-timer', JSON.stringify(state));
  else localStorage.removeItem('gm-detail-timer');
}
function _getDetailTimer() {
  try { return JSON.parse(localStorage.getItem('gm-detail-timer')); } catch { return null; }
}

function _setDetailTimerUI(running, paused) {
  const startBtn = document.querySelector('#btn-gm-detail-timer-start');
  const pauseBtn = document.querySelector('#btn-gm-detail-timer-pause');
  const resumeBtn = document.querySelector('#btn-gm-detail-timer-resume');
  const stopBtn = document.querySelector('#btn-gm-detail-timer-stop');
  const input = document.querySelector('#gm-detail-timer-min');
  const display = document.querySelector('#gm-detail-timer-display');
  if (!startBtn) return;
  if (running) {
    startBtn.style.display = 'none';
    input.style.display = 'none';
    stopBtn.style.display = '';
    display.style.display = '';
    pauseBtn.style.display = paused ? 'none' : '';
    resumeBtn.style.display = paused ? '' : 'none';
  } else {
    startBtn.style.display = '';
    input.style.display = '';
    pauseBtn.style.display = 'none';
    resumeBtn.style.display = 'none';
    stopBtn.style.display = 'none';
    display.style.display = 'none';
    display.style.animation = '';
  }
}

function _tickDetailTimer() {
  const st = _getDetailTimer();
  if (!st || st.paused) return;
  const elapsed = Math.floor((Date.now() - st.startedAt) / 1000);
  const remaining = Math.max(0, st.totalSeconds - elapsed);
  const display = document.querySelector('#gm-detail-timer-display');
  if (!display) return;
  display.textContent = formatGmTimer(remaining);
  display.style.color = remaining <= 10 ? 'var(--accent-red)' : 'var(--accent-orange)';
  if (remaining <= 0) {
    clearInterval(detailTimerInterval);
    detailTimerInterval = null;
    display.textContent = '⏰ TIME UP!';
    display.style.animation = 'pulse 0.5s ease-in-out 3';
    _saveDetailTimer(null);
    setTimeout(() => _setDetailTimerUI(false, false), 4000);
  }
}

function startDetailTimer(charId, seconds) {
  if (detailTimerInterval) clearInterval(detailTimerInterval);
  _saveDetailTimer({ totalSeconds: seconds, startedAt: Date.now(), paused: false, charId });
  _setDetailTimerUI(true, false);
  _tickDetailTimer();
  detailTimerInterval = setInterval(_tickDetailTimer, 1000);
}

function pauseDetailTimer() {
  const st = _getDetailTimer();
  if (!st) return;
  if (detailTimerInterval) { clearInterval(detailTimerInterval); detailTimerInterval = null; }
  const elapsed = Math.floor((Date.now() - st.startedAt) / 1000);
  const remaining = Math.max(0, st.totalSeconds - elapsed);
  _saveDetailTimer({ ...st, totalSeconds: remaining, startedAt: Date.now(), paused: true });
  _setDetailTimerUI(true, true);
}

function resumeDetailTimer() {
  const st = _getDetailTimer();
  if (!st) return;
  _saveDetailTimer({ ...st, startedAt: Date.now(), paused: false });
  _setDetailTimerUI(true, false);
  _tickDetailTimer();
  detailTimerInterval = setInterval(_tickDetailTimer, 1000);
}

function stopDetailTimer() {
  if (detailTimerInterval) { clearInterval(detailTimerInterval); detailTimerInterval = null; }
  _saveDetailTimer(null);
  _setDetailTimerUI(false, false);
}

function restoreDetailTimer() {
  const st = _getDetailTimer();
  if (!st) return;
  if (st.paused) {
    const display = document.querySelector('#gm-detail-timer-display');
    if (display) {
      display.textContent = formatGmTimer(st.totalSeconds);
      display.style.color = st.totalSeconds <= 10 ? 'var(--accent-red)' : 'var(--accent-orange)';
    }
    _setDetailTimerUI(true, true);
  } else {
    const elapsed = Math.floor((Date.now() - st.startedAt) / 1000);
    const remaining = st.totalSeconds - elapsed;
    if (remaining <= 0) { _saveDetailTimer(null); return; }
    _setDetailTimerUI(true, false);
    _tickDetailTimer();
    detailTimerInterval = setInterval(_tickDetailTimer, 1000);
  }
}

// ══════════════════════════════════════════════════════════════
// FLOATING DICE ROLL LOG
// ══════════════════════════════════════════════════════════════
let rollLogEntries = [];
let rollLogCollapsed = false;
let rollLogUnread = 0;

function addRollLogEntry(data) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  rollLogEntries.unshift({ ...data, time });
  if (rollLogEntries.length > 50) rollLogEntries.pop();
  if (rollLogCollapsed) {
    rollLogUnread++;
    const badge = document.querySelector('#roll-log-count');
    if (badge) { badge.textContent = rollLogUnread; badge.style.display = 'inline'; }
  }
  renderRollLog();
}

function renderRollLog() {
  const body = document.querySelector('#roll-log-body');
  if (!body) return;
  if (!rollLogEntries.length) {
    body.innerHTML = '<div style="color:var(--text-muted);font-size:0.75rem;text-align:center;padding:12px 0">Rolls from players will appear here...</div>';
    return;
  }
  body.innerHTML = rollLogEntries.map(e => {
    const statColors = {
      strength: '#e53935', dexterity: '#43a047', constitution: '#fb8c00',
      intelligence: '#1e88e5', wisdom: '#8e24aa', charisma: '#e91e63',
    };
    const color = statColors[e.stat] || 'var(--accent)';
    const rollTypeLabel = (e.roll_type || '').replace(/_/g, ' ');
    const isNat20 = e.d20 === 20;
    const isNat1 = e.d20 === 1;
    const highlight = isNat20 ? 'background:#4caf5030;border-left:3px solid #4caf50' :
                      isNat1 ? 'background:#f4433630;border-left:3px solid #f44336' :
                      'border-left:3px solid var(--border)';
    return `
      <div style="padding:6px 8px;margin-bottom:4px;border-radius:var(--r-md);${highlight}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:700;font-size:0.82rem">${e.character_name || '?'}</span>
          <span style="font-size:0.6rem;color:var(--text-muted)">${e.time}</span>
        </div>
        <div style="font-size:0.75rem;margin-top:2px">
          <span style="color:${color};font-weight:600">${(e.stat || '').charAt(0).toUpperCase() + (e.stat || '').slice(1)}</span>
          <span style="color:var(--text-muted)"> ${rollTypeLabel}</span>
        </div>
        <div style="font-size:0.9rem;font-weight:700;margin-top:2px">
          D20(<span style="color:${isNat20 ? '#4caf50' : isNat1 ? '#f44336' : 'var(--text-primary)'}">${e.d20}</span>)
          ${e.modifier >= 0 ? '+' : ''}${e.modifier}
          = <span style="font-size:1rem;color:${color}">${e.total}</span>
          ${isNat20 ? ' <span style="color:#4caf50;font-size:0.7rem">NAT 20!</span>' : ''}
          ${isNat1 ? ' <span style="color:#f44336;font-size:0.7rem">NAT 1!</span>' : ''}
        </div>
      </div>
    `;
  }).join('');
}

// Toggle collapse
document.querySelector('#roll-log-header')?.addEventListener('click', () => {
  rollLogCollapsed = !rollLogCollapsed;
  const body = document.querySelector('#roll-log-body');
  const btn = document.querySelector('#roll-log-toggle');
  if (body) body.style.display = rollLogCollapsed ? 'none' : 'block';
  if (btn) btn.textContent = rollLogCollapsed ? '▲' : '▼';
  if (!rollLogCollapsed) {
    rollLogUnread = 0;
    const badge = document.querySelector('#roll-log-count');
    if (badge) badge.style.display = 'none';
  }
});

// WS listener for characteristic rolls (only from players, not GM's own)
let lastGmRollTime = 0;
ws.on('roll.characteristic', d => {
  if (d.description) {
    // Avoid duplicating GM's own rolls already added locally
    const isDuplicate = rollLogEntries.length > 0
      && rollLogEntries[0].character_id === d.character_id
      && rollLogEntries[0].d20 === d.d20
      && rollLogEntries[0].total === d.total
      && (Date.now() - lastGmRollTime) < 2000;
    if (!isDuplicate) {
      addLog('roll', d.description);
      addRollLogEntry(d);
    }
  }
});

// FIX 4: Free rolls from players appear in the GM's Roll Log
// (server only forwards here when private=false)
ws.on('roll.free_roll', d => {
  const who = d.character_name || `Character #${d.character_id}`;
  addLog('roll', `🎲 ${who}: ${d.breakdown}`);
});

// WS listeners for combat
ws.on('combat.initiative_submitted', d => {
  if (activeCombat) {
    showToast(`${d.character_id} submitted initiative: ${d.roll} (total: ${d.final})`);
    loadCombatPanel();
  }
});

// ══════════════════════════════════════════════════════════════
// Combat FX — mirror of the player-side helper. Plays hit / miss /
// crit / fumble / heal animations on the GM's map canvas whenever
// any combat resolution is broadcast. Two event shapes feed through:
// the legacy `combat.attack_result` where data might be either at
// top-level OR nested under `d.data` (see gm-app.js line 4438), and
// the newer flat shape used by the ability flow.
// ══════════════════════════════════════════════════════════════
function _playCombatFxFromPayloadGM(raw) {
  if (!raw) return;
  const d = raw.data && typeof raw.data === 'object' ? raw.data : raw;
  const targetId = d.target_id ?? d.defender_id;
  if (targetId == null || !mapCanvas) return;
  const dmg = d.final_damage ?? d.damage ?? null;
  const ar  = d.attack_roll || {};
  const hit = d.hit ?? ar.hit;
  const crit = d.critical ?? ar.critical;
  const fumble = d.fumble ?? ar.fumble;
  let type, text;
  if (fumble)       { type = 'fumble'; text = 'FUMBLE'; }
  else if (!hit)    { type = 'miss';   text = 'MISS'; }
  else if (crit)    { type = 'crit';   text = dmg != null ? `-${dmg}` : 'CRIT!'; }
  else              { type = 'hit';    text = dmg != null ? `-${dmg}` : 'HIT'; }
  mapCanvas.playFxOnCharacter(targetId, type, { text, screenShake: crit });
}

// Stage 11: Combat action WS events for GM
ws.on('combat.attack_result', d => {
  _playCombatFxFromPayloadGM(d);
  if (activeCombat) {
    showToast(`⚔️ ${d.attacker_name} → ${d.target_name}: ${d.attack_roll?.hit ? 'HIT' : 'MISS'}`);
    appendCombatLogEntry(d);
    loadCombatPanel();
  }
});
ws.on('combat.hit_result', d => {
  // Only fire FX for miss/fumble — a hit will also trigger an
  // attack_result with the damage, and we don't want to double-ring.
  if (d && !d.hit) _playCombatFxFromPayloadGM(d);
});
ws.on('combat.ability_result', d => {
  _playCombatFxFromPayloadGM(d);
  if (d && d.attacker_name && d.target_name) {
    showToast(`✨ ${d.attacker_name} → ${d.target_name}: ${d.critical ? 'CRIT!' : (d.hit ? 'HIT' : (d.fumble ? 'FUMBLE' : 'MISS'))}`);
  }
});
ws.on('combat.defend', d => {
  if (activeCombat) {
    showToast(`🛡️ ${d.character_name} defends`);
    appendCombatLogEntry({ description: d.description, attack_roll: { defend: true } });
    loadCombatPanel();
  }
});
ws.on('combat.character_killed', d => {
  if (activeCombat) {
    showToast(`💀 ${d.character_name} has been slain!`);
  }
});

// Auto-update open NPC floating panels on relevant WS events
ws.on('combat.attack_result', () => _updateAllNpcPanels());
ws.on('combat.hit_result', () => _updateAllNpcPanels());
ws.on('combat.ability_result', () => _updateAllNpcPanels());
ws.on('combat.defend', () => _updateAllNpcPanels());
ws.on('combat.defense_resolved', () => _updateAllNpcPanels());
ws.on('character.updated', () => _updateAllNpcPanels());
ws.on('map.updated', () => _updateAllNpcPanels());
ws.on('status.update', d => {
  if (d && d.character_id && npcPanels[d.character_id]) _loadNpcPanelStatuses(d.character_id);
});
ws.on('inventory.update', d => {
  if (d && d.character_id && npcPanels[d.character_id]) {
    _loadNpcPanelWeapon(d.character_id);
    _loadNpcPanelItems(d.character_id);
  }
});

// ══════════════════════════════════════════════════════════════
// DEFENSE REACTION SYSTEM (GM side)
// ══════════════════════════════════════════════════════════════
function showGmDefenseModal(data) {
  if (document.getElementById(`gm-defense-modal-${data.pending_defense_id}`)) return;
  const overlay = document.createElement('div');
  overlay.id = `gm-defense-modal-${data.pending_defense_id}`;
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:380px;text-align:center">
      <h3 style="margin-top:0">🛡️ Defense Reaction</h3>
      <div style="margin:8px 0;font-size:0.9rem">
        <strong>${data.attacker_name}</strong> attacks <strong>${data.target_name}</strong>!<br>
        <span style="color:var(--text-muted)">Roll: ${data.attack_total} vs AC ${data.target_ac}</span>
      </div>
      <!-- Dice mode + count (only applies to dodge/brace) -->
      <div id="gm-def-dice-ctrl" style="display:flex;align-items:center;gap:8px;justify-content:center;margin:10px 0;font-size:0.78rem">
        <span style="color:var(--text-muted)">Mode:</span>
        <div class="adv-toggle" id="gm-def-adv">
          <button data-mode="disadvantage">Disadv</button>
          <button data-mode="normal" class="active">Normal</button>
          <button data-mode="advantage">Adv</button>
        </div>
        <div style="display:inline-flex;align-items:center;gap:4px">
          <span style="color:var(--text-muted)">🎲×</span>
          <button type="button" class="btn btn-ghost btn-xs" id="gm-def-dice-minus" style="padding:0 6px">−</button>
          <span id="gm-def-dice-count" style="font-weight:600;min-width:12px;text-align:center">1</span>
          <button type="button" class="btn btn-ghost btn-xs" id="gm-def-dice-plus" style="padding:0 6px">+</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
        <button class="btn btn-primary btn-sm" id="gm-def-ac">🛡️ Accept on AC (${data.target_ac})</button>
        <button class="btn btn-ghost btn-sm" id="gm-def-dex">💨 Dodge (d20 + DEX)</button>
        <button class="btn btn-ghost btn-sm" id="gm-def-con">🧱 Brace (d20 + CON)</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // --- dice controls state ---
  let defState = { advantageMode: 'normal', diceCount: 1 };
  function _renderDefDice() {
    const host = overlay.querySelector('#gm-def-adv');
    if (!host) return;
    host.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === defState.advantageMode);
    });
    overlay.querySelector('#gm-def-dice-count').textContent = defState.diceCount;
  }
  overlay.querySelectorAll('#gm-def-adv button').forEach(b => {
    b.addEventListener('click', () => {
      defState.advantageMode = b.dataset.mode;
      if (defState.advantageMode !== 'normal' && defState.diceCount < 2) defState.diceCount = 2;
      _renderDefDice();
    });
  });
  overlay.querySelector('#gm-def-dice-minus').addEventListener('click', () => {
    const min = defState.advantageMode === 'normal' ? 1 : 2;
    defState.diceCount = Math.max(min, defState.diceCount - 1);
    _renderDefDice();
  });
  overlay.querySelector('#gm-def-dice-plus').addEventListener('click', () => {
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

  overlay.querySelector('#gm-def-ac').addEventListener('click', () => resolve('ac'));
  overlay.querySelector('#gm-def-dex').addEventListener('click', () => resolve('dodge_dex'));
  overlay.querySelector('#gm-def-con').addEventListener('click', () => resolve('dodge_con'));
}

ws.on('combat.defense_request', d => {
  const target = characters.find(c => c.id === d.target_id);
  // If target is an NPC, GM must choose defense manually
  if (target && target.is_npc) {
    showGmDefenseModal(d);
  } else {
    // Player target — show a lightweight waiting toast
    showToast(`⏳ ${d.target_name} is choosing defense vs ${d.attacker_name}...`);
  }
});

ws.on('combat.defense_resolved', d => {
  document.querySelectorAll('.gm-defense-waiting-banner').forEach(e => e.remove());
  document.querySelectorAll(`.modal-overlay`).forEach(e => {
    if (e.id === `gm-defense-modal-${d.id}`) e.remove();
  });
  // Map FX
  if (typeof mapCanvas !== 'undefined' && mapCanvas) {
    mapCanvas.playFxOnCharacter(d.target_id, 'defended', {
      text: d.success ? 'DEFENDED!' : 'HIT',
      color: d.success ? '#48aaff' : '#ff4848',
    });
  }
  if (d.success) {
    showToast(`🛡️ ${d.target_name} defended against ${d.attacker_name}! ${d.defense_breakdown}`);
    addLog('gm.combat', `🛡️ Defense success: ${d.target_name} — ${d.defense_breakdown} vs ${d.attack_total}`);
  } else {
    showToast(`💥 ${d.target_name} failed defense vs ${d.attacker_name}. ${d.defense_breakdown}`);
    addLog('gm.combat', `💥 Defense failed: ${d.target_name} — ${d.defense_breakdown} vs ${d.attack_total}`);
  }

  // Resume NPC floating-panel attack flow (this NPC was the attacker)
  const ctx = npcPanels[d.attacker_id];
  if (ctx && ctx.hitData && ctx.hitData.pending_defense_id === d.id) {
    if (d.success) {
      // Defense succeeded → no damage step; reset panel UI
      const panelEl = ctx.el;
      const hitWrap = panelEl.querySelector(`[data-npc-panel-hit="${d.attacker_id}"]`);
      const dmgWrap = panelEl.querySelector(`[data-npc-panel-damage="${d.attacker_id}"]`);
      if (hitWrap) hitWrap.style.display = 'flex';
      if (dmgWrap) dmgWrap.style.display = 'none';
      _showNpcPanelResult(d.attacker_id, `<div style="color:var(--accent)">🛡️ ${d.target_name} defended (${d.defense_breakdown||''})</div>`);
      ctx.hitData = null;
    } else {
      // Defense failed → reveal damage step
      _revealDmgStep(ctx.el, d.attacker_id, ctx.hitData);
    }
  }
});

// FIX 7: Player dismissed a trade modal → log to GM's roll log
ws.on('trade.dismissed', d => {
  const name = d.player_name || `Player #${d.player_id}`;
  const npc  = d.npc_name || 'merchant';
  addLog('gm.trade', `🤝 ${name} dismissed the trade with ${npc}`);
  showToast(`${name} dismissed the trade`);
});

// ══════════════════════════════════════════════════════════════
