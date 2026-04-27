// ════════════════════════════════════════════════════════
// Turn counter + effects
// Source: player-app.js lines 880-993
// ════════════════════════════════════════════════════════

// TURN COUNTER
// ══════════════════════════════════════════════════════════════
function renderTurns() {
  const c = char; if (!c) return;
  const body = $('#turns-body');
  let timersHtml = (c.turn_timers||[]).map(t => {
    const vc = t.current_value <= 0 ? 'expired' : 'active';
    return `<div class="timer-row ${t.is_active?'':'inactive'}">
      <label class="toggle-switch"><input type="checkbox" ${t.is_active?'checked':''} data-timer-toggle="${t.id}"><span class="slider"></span></label>
      <input type="text" value="${t.name}" data-timer-id="${t.id}" data-timer-field="name" style="width:90px">
      <span class="timer-value ${vc}">${t.current_value}</span><span class="timer-initial">/ ${t.initial_value}</span>
      <input type="number" value="${t.initial_value}" data-timer-id="${t.id}" data-timer-field="initial_value" style="width:48px" min="1">
      <button class="btn btn-ghost btn-xs" data-timer-reset="${t.id}">↩️</button>
      <button class="btn-icon danger" data-timer-del="${t.id}">🗑</button>
    </div>`;
  }).join('');

  body.innerHTML = `
    <div class="turn-header">
      <div><div class="turn-label">Turn</div><div class="turn-count-display">${c.turn_count||0}</div></div>
      <button class="btn btn-accent btn-sm" id="btn-next-turn">⏭ Next</button>
      <button class="btn btn-ghost btn-sm" id="btn-reset-turns">↩️ Reset</button>
    </div>
    <div id="timer-list">${timersHtml}</div>
    <button class="btn btn-ghost btn-xs" id="btn-add-timer" style="margin-top:6px">+ Add Timer</button>
  `;

  $('#btn-next-turn').addEventListener('click', async () => {
    char = await api.post(`/api/characters/${CHAR_ID}/advance-turn`);
    renderTurns(); addLog(`[Turn] Advanced to ${char.turn_count}`);
  });
  $('#btn-reset-turns').addEventListener('click', async () => {
    char = await api.post(`/api/characters/${CHAR_ID}/reset-turns`);
    renderTurns(); addLog(`[Turn] Reset`);
  });
  $('#btn-add-timer').addEventListener('click', async () => {
    await api.post(`/api/characters/${CHAR_ID}/timers`, { name:'Timer', initial_value:3 });
    char = await api.get(`/api/characters/${CHAR_ID}`); renderTurns();
  });
  body.querySelectorAll('[data-timer-toggle]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await api.put(`/api/timers/${cb.dataset.timerToggle}`, { is_active: cb.checked });
      char = await api.get(`/api/characters/${CHAR_ID}`); renderTurns();
    });
  });
  body.querySelectorAll('[data-timer-field]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const f = inp.dataset.timerField;
      const v = f === 'name' ? inp.value : parseInt(inp.value)||1;
      await api.put(`/api/timers/${inp.dataset.timerId}`, { [f]: v });
      char = await api.get(`/api/characters/${CHAR_ID}`); renderTurns();
    });
  });
  body.querySelectorAll('[data-timer-reset]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const t = (char.turn_timers||[]).find(x => x.id == btn.dataset.timerReset);
      if (t) { await api.put(`/api/timers/${t.id}`, { current_value: t.initial_value }); }
      char = await api.get(`/api/characters/${CHAR_ID}`); renderTurns();
    });
  });
  body.querySelectorAll('[data-timer-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.del(`/api/timers/${btn.dataset.timerDel}`);
      char = await api.get(`/api/characters/${CHAR_ID}`); renderTurns();
    });
  });
}

// ══════════════════════════════════════════════════════════════
// EFFECTS
// ══════════════════════════════════════════════════════════════
function renderEffects() {
  const c = char; if (!c) return;
  const body = $('#effects-body');
  body.innerHTML = (c.effects||[]).map(e => `
    <div class="mod-row ${e.is_active?'':'inactive'}">
      <label class="toggle-switch"><input type="checkbox" ${e.is_active?'checked':''} data-eff-toggle="${e.id}"><span class="slider"></span></label>
      <input type="text" value="${e.name}" data-eff-field="name" data-eff-id="${e.id}">
      <select data-eff-field="effect_type" data-eff-id="${e.id}">
        <option value="percent_reduction" ${e.effect_type==='percent_reduction'?'selected':''}>% Reduction</option>
        <option value="flat_reduction" ${e.effect_type==='flat_reduction'?'selected':''}>Flat Reduction</option>
      </select>
      <input type="number" value="${e.value}" data-eff-field="value" data-eff-id="${e.id}" style="width:52px">
      <button class="btn-icon danger" data-del-eff="${e.id}">🗑</button>
    </div>
  `).join('') + `<button class="btn btn-ghost btn-xs" id="btn-add-effect" style="margin-top:6px">+ Add Effect</button>`;

  body.querySelector('#btn-add-effect').addEventListener('click', async () => {
    await api.post(`/api/characters/${CHAR_ID}/effects`, { name:'New Effect', effect_type:'percent_reduction', value:0 });
    char = await api.get(`/api/characters/${CHAR_ID}`); renderEffects();
  });
  body.querySelectorAll('[data-eff-toggle]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await api.put(`/api/effects/${cb.dataset.effToggle}`, { is_active: cb.checked });
      char = await api.get(`/api/characters/${CHAR_ID}`); renderEffects();
    });
  });
  body.querySelectorAll('[data-eff-field]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const f = inp.dataset.effField;
      const v = f === 'value' ? parseFloat(inp.value)||0 : inp.value;
      await api.put(`/api/effects/${inp.dataset.effId}`, { [f]: v });
      char = await api.get(`/api/characters/${CHAR_ID}`);
    });
  });
  body.querySelectorAll('[data-del-eff]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.del(`/api/effects/${btn.dataset.delEff}`);
      char = await api.get(`/api/characters/${CHAR_ID}`); renderEffects();
    });
  });
}

// ══════════════════════════════════════════════════════════════
