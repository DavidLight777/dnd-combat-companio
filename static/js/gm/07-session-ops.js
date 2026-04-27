// ════════════════════════════════════════════════════════
// Initiative, full rest, end session
// Source: gm-app.js lines 3377–3478
// Globals shared via window.* and module-scope hoisting.
// ════════════════════════════════════════════════════════

// INITIATIVE
// ══════════════════════════════════════════════════════════════
$('#btn-roll-initiative').addEventListener('click', async () => {
  try {
    const res = await api.post(`/api/initiative/${SESSION_CODE}/roll-all`, {});
    renderInitiativeOrder(res.order.map((r, i) => ({
      order: i, character_id: r.character_id, name: r.name,
      roll_result: r.total, is_current_turn: false,
    })));
    addLog('initiative', `Rolled: ${res.order.map(r => `${r.name}(${r.total})`).join(', ')}`);
  } catch (e) { showToast('Error: ' + e.message); }
});

$('#btn-start-combat').addEventListener('click', async () => {
  try {
    const res = await api.post(`/api/initiative/${SESSION_CODE}/start-combat`, {});
    $('#session-status').textContent = res.status;
    $('#session-turn').textContent = res.turn_number;
    addLog('combat', `Combat started! Turn 1`);
    loadInitiativeOrder();
  } catch (e) { showToast('Error: ' + e.message); }
});

$('#btn-next-turn').addEventListener('click', async () => {
  try {
    const res = await api.post(`/api/initiative/${SESSION_CODE}/next-turn`, {});
    $('#session-turn').textContent = res.turn_number;
    addLog('combat', `Turn → ${res.character_name} (round ${res.turn_number})`);
    loadInitiativeOrder();
  } catch (e) { showToast('Error: ' + e.message); }
});

$('#btn-end-combat').addEventListener('click', async () => {
  if (!confirm('End combat?')) return;
  try {
    await api.post(`/api/initiative/${SESSION_CODE}/end-combat`, {});
    $('#session-status').textContent = 'waiting';
    $('#session-turn').textContent = '0';
    $('#initiative-order').innerHTML = '<p class="text-muted">Roll initiative to begin.</p>';
    addLog('combat', 'Combat ended');
  } catch (e) { showToast('Error: ' + e.message); }
});

async function loadInitiativeOrder() {
  try {
    const res = await api.get(`/api/initiative/${SESSION_CODE}/order`);
    renderInitiativeOrder(res.order);
    if (res.turn_number) $('#session-turn').textContent = res.turn_number;
  } catch { /* no initiative yet */ }
}

function renderInitiativeOrder(order) {
  const el = $('#initiative-order');
  if (!order || !order.length) {
    el.innerHTML = '<p class="text-muted">No initiative order.</p>';
    return;
  }
  el.innerHTML = order.map(o => {
    const pct = o.max_hp > 0 ? (o.current_hp / o.max_hp * 100) : 100;
    const hpColor = pct > 50 ? 'var(--hp-high)' : pct > 25 ? 'var(--hp-mid)' : 'var(--hp-low)';
    const active = o.is_current_turn ? 'border-color:var(--accent);box-shadow:0 0 0 1px var(--accent),0 0 8px var(--accent-glow)' : '';
    const dead = o.is_alive === false ? 'opacity:0.4;' : '';
    const badge = o.is_npc ? '<span class="cc-badge badge-npc">NPC</span>' : '';
    return `<div class="char-card" style="${active}${dead}margin-bottom:4px">
      <div class="cc-top">
        <span style="font-weight:700;font-size:1.1rem;color:var(--accent);width:28px">${o.order + 1}</span>
        <span class="cc-name">${o.name}</span>${badge}
        <span style="font-size:0.78rem;color:var(--text-muted)">Roll: ${o.roll_result}</span>
      </div>
      ${o.max_hp ? `<div class="hp-bar-container" style="margin-top:4px"><div class="hp-bar" style="width:${pct}%;background:${hpColor}"></div></div>
      <span style="font-size:0.72rem;color:var(--text-muted)">${o.current_hp}/${o.max_hp}</span>` : ''}
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════
// FULL REST (Rework v3)
// ══════════════════════════════════════════════════════════════
$('#btn-full-rest')?.addEventListener('click', async () => {
  if (!confirm('🌙 Full Rest: restore HP, mana, cooldowns, and uses for every living player. Proceed?')) return;
  try {
    const res = await api.post(`/api/sessions/${SESSION_CODE}/full-rest`, {});
    const n = res?.healed_count ?? 0;
    showToast(`🌙 Full Rest applied — ${n} player${n === 1 ? '' : 's'} restored`);
    addLog('gm.rest', `Full Rest: ${n} players fully restored`);
    await refreshChars();
  } catch (e) {
    showToast(`Full Rest failed: ${e.message || e}`);
  }
});

// ══════════════════════════════════════════════════════════════
// END SESSION
// ══════════════════════════════════════════════════════════════
$('#btn-end-session').addEventListener('click', async () => {
  if (!confirm('End this session? All players will be disconnected.')) return;
  await api.patch(`/api/sessions/${SESSION_CODE}/status`, { gm_token: GM_TOKEN, status: 'ended' });
  ws.disconnect();
  location.href = '/';
});

// ══════════════════════════════════════════════════════════════
