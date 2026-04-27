// ════════════════════════════════════════════════════════
// Attack & damage roll
// Source: player-app.js lines 566-784
// ════════════════════════════════════════════════════════

// ATTACK & DAMAGE ROLL
// ══════════════════════════════════════════════════════════════
function renderAttack() {
  const c = char; if (!c) return;
  const body = $('#attack-body');

  // Attack mods HTML
  const atkMods = (c.attack_modifiers || []).map(m => `
    <div class="mod-row ${m.is_active ? '' : 'inactive'}">
      <label class="toggle-switch"><input type="checkbox" ${m.is_active ? 'checked' : ''} data-atkmod="${m.id}"><span class="slider"></span></label>
      <input type="text" value="${m.name}" data-atkmod-field="name" data-atkmod-id="${m.id}">
      <input type="number" value="${m.value}" data-atkmod-field="value" data-atkmod-id="${m.id}">
      <button class="btn-icon danger" data-del-atkmod="${m.id}">🗑</button>
    </div>`).join('');

  // Damage mods HTML
  const dmgMods = (c.damage_modifiers || []).map(m => `
    <div class="mod-row ${m.is_active ? '' : 'inactive'}">
      <label class="toggle-switch"><input type="checkbox" ${m.is_active ? 'checked' : ''} data-dmgmod="${m.id}"><span class="slider"></span></label>
      <input type="text" value="${m.name}" data-dmgmod-field="name" data-dmgmod-id="${m.id}">
      <input type="number" value="${m.value}" data-dmgmod-field="value" data-dmgmod-id="${m.id}">
      <button class="btn-icon danger" data-del-dmgmod="${m.id}">🗑</button>
    </div>`).join('');

  // Dice groups
  const groups = getDiceGroups();
  const diceHtml = groups.map(g => `
    <div class="mod-row ${g.active ? '' : 'inactive'}" data-dg-id="${g.id}">
      <label class="toggle-switch"><input type="checkbox" ${g.active ? 'checked' : ''} data-dg-toggle="${g.id}"><span class="slider"></span></label>
      <input type="number" value="${g.count}" min="1" style="width:44px" data-dg-field="count" data-dg-id="${g.id}">
      <span class="text-muted">d</span>
      <select data-dg-field="die" data-dg-id="${g.id}" style="width:58px">
        ${[4,6,8,10,12,20,100].map(d => `<option value="${d}" ${g.die===d?'selected':''}>${d}</option>`).join('')}
      </select>
      <span class="text-muted" style="font-size:0.7rem">${g.count}d${g.die}</span>
      <button class="btn-icon danger" data-dg-del="${g.id}">🗑</button>
    </div>`).join('');

  body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <h3 style="font-size:0.82rem;margin:0">🎲 Attack Roll</h3>
      ${makeAdvToggle('attack')}
    </div>
    <div class="field-group">
      <label>D20:</label>
      <input type="number" id="atk-d20" value="${_atkD20Result||''}" min="1" max="20" style="width:52px">
      <button class="btn btn-ghost btn-xs" id="atk-d20-roll">Roll</button>
      <label>Base Mod:</label>
      <input type="number" id="atk-base-mod" value="0">
    </div>
    <div id="atk-mod-list">${atkMods}</div>
    <button class="btn btn-ghost btn-xs" id="btn-add-atk-mod" style="margin:4px 0">+ Attack Modifier</button>
    <div class="result-box" id="atk-result"><span class="text-muted">Roll d20 to calculate</span></div>

    <hr class="section-divider">

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <h3 style="font-size:0.82rem;margin:0">💥 Damage Roll</h3>
      ${makeAdvToggle('damage')}
    </div>
    <div id="dmg-dice-groups">${diceHtml}</div>
    <div style="display:flex;gap:6px;margin:6px 0">
      <button class="btn btn-ghost btn-xs" id="btn-add-dice-group">+ Add Dice</button>
      <button class="btn btn-accent btn-sm" id="dmg-roll-btn">🎲 Roll All</button>
    </div>
    <div class="field-group">
      <label>Weapon Bonus:</label>
      <input type="number" id="dmg-weapon-bonus" value="0">
      <label>Atk Bonus:</label>
      <span class="value" id="dmg-atk-bonus">0</span>
    </div>
    <div id="dmg-mod-list">${dmgMods}</div>
    <button class="btn btn-ghost btn-xs" id="btn-add-dmg-mod" style="margin:4px 0">+ Damage Modifier</button>
    <div class="result-box" id="dmg-result"><span class="text-muted">Roll damage to calculate</span></div>
  `;

  // ── Bind advantage toggles ──
  bindAdvToggle(body, 'attack');
  bindAdvToggle(body, 'damage');

  // ── Wire attack events ──
  $('#atk-d20-roll').addEventListener('click', async () => {
    const d20 = Math.floor(Math.random() * 20) + 1;
    $('#atk-d20').value = d20;
    _atkD20Result = d20;
    flash($('#atk-d20-roll'), 'dice-shake');
    calcAttack();
    addRollHistory('attack', `d20 = ${d20}`, d20);
  });
  $('#atk-d20').addEventListener('change', () => { _atkD20Result = parseInt($('#atk-d20').value)||0; calcAttack(); });
  $('#atk-base-mod').addEventListener('change', calcAttack);

  // Attack modifier events
  body.querySelectorAll('[data-atkmod]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await api.put(`/api/modifiers/${cb.dataset.atkmod}?type=attack`, { is_active: cb.checked });
      char = await api.get(`/api/characters/${CHAR_ID}`); renderAttack();
    });
  });
  body.querySelectorAll('[data-atkmod-field]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const f = inp.dataset.atkmodField;
      const v = f === 'value' ? parseInt(inp.value)||0 : inp.value;
      await api.put(`/api/modifiers/${inp.dataset.atkmodId}?type=attack`, { [f]: v });
      char = await api.get(`/api/characters/${CHAR_ID}`);
    });
  });
  body.querySelectorAll('[data-del-atkmod]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.del(`/api/modifiers/${btn.dataset.delAtkmod}?type=attack`);
      char = await api.get(`/api/characters/${CHAR_ID}`); renderAttack();
    });
  });
  $('#btn-add-atk-mod').addEventListener('click', async () => {
    await api.post(`/api/characters/${CHAR_ID}/modifiers`, { modifier_type:'attack', name:'Mod', value:0 });
    char = await api.get(`/api/characters/${CHAR_ID}`); renderAttack();
  });

  // ── Wire dice group events ──
  bindDiceGroupEvents(body);
  $('#btn-add-dice-group').addEventListener('click', () => {
    const g = getDiceGroups();
    g.push({ id: Date.now(), count:1, die:8, active:true });
    setDiceGroups(g); renderAttack();
  });

  // ── Wire damage roll ──
  $('#dmg-roll-btn').addEventListener('click', async () => {
    const groups = getDiceGroups();
    const weaponBonus = parseInt($('#dmg-weapon-bonus').value)||0;
    const atkBonus = parseInt($('#dmg-atk-bonus').textContent)||0;
    const mods = (char.damage_modifiers||[]).filter(m => m.is_active);

    const res = await api.post('/api/calc/damage-roll', {
      dice_groups: groups, weapon_bonus: weaponBonus,
      attack_bonus: atkBonus, modifier_values: mods.map(m => m.value),
      character_id: CHAR_ID, advantage_mode: getAdvMode('damage'),
    });
    flash($('#dmg-roll-btn'), 'dice-shake');

    const gd = (res.group_results||[]).map(g => `${g.count}d${g.die}[${g.rolls.join(',')}]=${g.subtotal}`).join(' + ');
    addRollHistory('damage', `${gd} = ${res.total}`, res.total);

    let text = res.breakdown || '';
    if (!text) {
      for (const g of (res.group_results||[])) text += `<span class="text-muted">${g.count}d${g.die}:</span> [${g.rolls.join(', ')}]=${g.subtotal} `;
      if (weaponBonus) text += ` + W(${weaponBonus})`;
      if (atkBonus) text += ` + A(${atkBonus})`;
      mods.forEach(m => { text += ` + ${m.name}(${m.value>0?'+':''}${m.value})`; });
    }
    text += `<br>= <strong class="damage-num">${res.total} damage</strong>`;
    $('#dmg-result').innerHTML = text;
    addLog(`[Damage] ${res.breakdown || `${gd} = ${res.total}`}`);
  });

  // Damage modifier events
  body.querySelectorAll('[data-dmgmod]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await api.put(`/api/modifiers/${cb.dataset.dmgmod}?type=damage`, { is_active: cb.checked });
      char = await api.get(`/api/characters/${CHAR_ID}`); renderAttack();
    });
  });
  body.querySelectorAll('[data-dmgmod-field]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const f = inp.dataset.dmgmodField;
      const v = f === 'value' ? parseInt(inp.value)||0 : inp.value;
      await api.put(`/api/modifiers/${inp.dataset.dmgmodId}?type=damage`, { [f]: v });
      char = await api.get(`/api/characters/${CHAR_ID}`);
    });
  });
  body.querySelectorAll('[data-del-dmgmod]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.del(`/api/modifiers/${btn.dataset.delDmgmod}?type=damage`);
      char = await api.get(`/api/characters/${CHAR_ID}`); renderAttack();
    });
  });
  $('#btn-add-dmg-mod').addEventListener('click', async () => {
    await api.post(`/api/characters/${CHAR_ID}/modifiers`, { modifier_type:'damage', name:'Mod', value:0 });
    char = await api.get(`/api/characters/${CHAR_ID}`); renderAttack();
  });
}

async function calcAttack() {
  const d20 = parseInt($('#atk-d20').value)||0;
  if (!d20) return;
  const baseMod = parseInt($('#atk-base-mod').value)||0;
  const mods = (char.attack_modifiers||[]).filter(m => m.is_active);
  const res = await api.post('/api/calc/attack-roll', {
    d20, base_mod: baseMod, modifier_values: mods.map(m => m.value),
    character_id: CHAR_ID, advantage_mode: getAdvMode('attack'),
    hit_dice_count: getAdvDiceCount('attack'),
  });
  let t = res.breakdown || `D20(${res.d20}) + Base(${res.base_mod}) = ${res.total}`;
  t += ` → Attack Bonus: <span class="value">${res.attack_bonus}</span>`;
  $('#atk-result').innerHTML = `<strong>${t}</strong>`;
  $('#dmg-atk-bonus').textContent = res.attack_bonus;
  addLog(`[Attack] ${res.breakdown || `d20(${res.d20})+base(${res.base_mod})=${res.total}`} → AtkBonus ${res.attack_bonus}`);
}

// ── Dice Groups (localStorage) ──────────────────────────────
function getDiceGroups() {
  try { const a = JSON.parse(localStorage.getItem('dnd-dice-groups')||'{}'); return a[CHAR_ID]||[{id:1,count:1,die:8,active:true}]; } catch { return [{id:1,count:1,die:8,active:true}]; }
}
function setDiceGroups(g) {
  const a = JSON.parse(localStorage.getItem('dnd-dice-groups')||'{}'); a[CHAR_ID]=g; localStorage.setItem('dnd-dice-groups',JSON.stringify(a));
}
function bindDiceGroupEvents(body) {
  body.querySelectorAll('[data-dg-toggle]').forEach(cb => {
    cb.addEventListener('change', () => { const g=getDiceGroups(); const x=g.find(x=>x.id==cb.dataset.dgToggle); if(x)x.active=cb.checked; setDiceGroups(g); renderAttack(); });
  });
  body.querySelectorAll('[data-dg-field]').forEach(inp => {
    inp.addEventListener('change', () => { const g=getDiceGroups(); const x=g.find(x=>x.id==inp.dataset.dgId); if(!x)return; x[inp.dataset.dgField]=parseInt(inp.value)||(inp.dataset.dgField==='count'?1:8); setDiceGroups(g); renderAttack(); });
  });
  body.querySelectorAll('[data-dg-del]').forEach(btn => {
    btn.addEventListener('click', () => { let g=getDiceGroups().filter(x=>x.id!=btn.dataset.dgDel); if(!g.length)g=[{id:Date.now(),count:1,die:8,active:true}]; setDiceGroups(g); renderAttack(); });
  });
}

// ══════════════════════════════════════════════════════════════
