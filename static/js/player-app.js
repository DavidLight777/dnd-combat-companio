/* ══════════════════════════════════════════════════════════════
   PLAYER APP — Full Character Sheet
   ══════════════════════════════════════════════════════════════ */
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// ── Auth ─────────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const SESSION_CODE = params.get('code') || sessionStorage.getItem('session_code');
const PLAYER_TOKEN = sessionStorage.getItem('player_token');
const CHAR_ID = parseInt(sessionStorage.getItem('character_id'));
if (!SESSION_CODE || !PLAYER_TOKEN || !CHAR_ID) location.href = '/';
$('#session-code').textContent = SESSION_CODE;

// ── State ────────────────────────────────────────────────────
let char = null;          // Current character data
let calcLog = [];         // Calc log entries
let rollHistory = [];     // Roll history entries
let _atkD20Result = null; // Last d20 roll

// ── API helper ───────────────────────────────────────────────
const api = {
  async get(url) { const r = await fetch(url); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async post(url, body) { const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async put(url, body) { const r = await fetch(url, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async patch(url, body) { const r = await fetch(url, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
  async del(url) { const r = await fetch(url, { method:'DELETE' }); if (!r.ok) throw new Error(await r.text()); return r.json(); },
};

// ── Debounced save ───────────────────────────────────────────
let _saveTimer = null;
function debouncedSave(fields) {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    try { await api.put(`/api/characters/${CHAR_ID}`, fields); } catch(e) { console.warn('Save failed:', e); }
  }, 300);
}

// ── Utility ──────────────────────────────────────────────────
function addLog(text) {
  calcLog.unshift({ time: new Date().toLocaleTimeString(), text });
  if (calcLog.length > 20) calcLog.length = 20;
  renderLog();
}
function addRollHistory(type, desc, result) {
  rollHistory.unshift({ time: new Date().toLocaleTimeString(), type, desc, result });
  if (rollHistory.length > 50) rollHistory.length = 50;
  renderLog();
}
function flash(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 300);
}
function confirmAction(msg) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'confirm-overlay';
    ov.innerHTML = `<div class="confirm-box"><p>${msg}</p><div class="btns"><button class="btn btn-primary btn-sm" id="cf-yes">Confirm</button><button class="btn btn-ghost btn-sm" id="cf-no">Cancel</button></div></div>`;
    document.body.appendChild(ov);
    ov.querySelector('#cf-yes').onclick = () => { ov.remove(); resolve(true); };
    ov.querySelector('#cf-no').onclick = () => { ov.remove(); resolve(false); };
  });
}

// ══════════════════════════════════════════════════════════════
// LOAD CHARACTER
// ══════════════════════════════════════════════════════════════
async function loadChar() {
  char = await api.get(`/api/characters/${CHAR_ID}`);
  $('#char-name').textContent = char.name;
  document.title = `${char.name} — Combat Companion`;
  renderAll();
}
function renderAll() {
  renderHP();
  renderStats();
  renderAttack();
  renderDefense();
  renderHeal();
  renderTurns();
  renderEffects();
  renderEnemyCalc();
}

// ══════════════════════════════════════════════════════════════
// HP DISPLAY
// ══════════════════════════════════════════════════════════════
function renderHP() {
  const c = char; if (!c) return;
  const pct = c.max_hp > 0 ? (c.current_hp / c.max_hp * 100) : 0;
  const color = pct > 50 ? 'var(--hp-high)' : pct > 25 ? 'var(--hp-mid)' : 'var(--hp-low)';
  $('#hp-display').textContent = `${c.current_hp} / ${c.max_hp}`;
  $('#hp-display').style.color = color;
  $('#hp-bar').style.width = `${pct}%`;
  $('#hp-bar').style.background = color;
  $('#kd-display').textContent = c.armor_class;
}

// ══════════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════════
function renderStats() {
  const c = char; if (!c) return;
  const stats = ['strength','dexterity','constitution','intelligence','wisdom','charisma'];
  const labels = ['STR','DEX','CON','INT','WIS','CHA'];
  const grid = $('#stats-grid');

  grid.innerHTML = stats.map((s, i) => {
    const base = c[s];
    const mods = (c.stat_modifiers || []).filter(m => m.stat_name === s && m.is_active);
    const total = base + mods.reduce((a, m) => a + m.value, 0);
    return `<div class="stat-cell">
      <div class="stat-name">${labels[i]}</div>
      <div class="stat-val">${total}</div>
      <input type="number" value="${base}" data-stat="${s}" style="margin-top:4px">
    </div>`;
  }).join('') + `
    <div class="stat-cell">
      <div class="stat-name">KD</div>
      <div class="stat-val" style="color:var(--accent)">${c.armor_class}</div>
      <input type="number" value="${c.armor_class}" data-stat="armor_class" style="margin-top:4px">
    </div>
    <div class="stat-cell">
      <div class="stat-name">Max HP</div>
      <div class="stat-val">${c.max_hp}</div>
      <input type="number" value="${c.max_hp}" data-stat="max_hp" style="margin-top:4px">
    </div>`;

  grid.querySelectorAll('input[data-stat]').forEach(inp => {
    inp.addEventListener('change', () => {
      const field = inp.dataset.stat;
      const val = parseInt(inp.value) || 0;
      debouncedSave({ [field]: val });
      char[field] = val;
      renderHP();
    });
  });
}

// ══════════════════════════════════════════════════════════════
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
    <h3 style="font-size:0.82rem;margin-bottom:6px">🎲 Attack Roll</h3>
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

    <h3 style="font-size:0.82rem;margin-bottom:6px">💥 Damage Roll</h3>
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
    });
    flash($('#dmg-roll-btn'), 'dice-shake');

    const gd = (res.group_results||[]).map(g => `${g.count}d${g.die}[${g.rolls.join(',')}]=${g.subtotal}`).join(' + ');
    addRollHistory('damage', `${gd} = ${res.total}`, res.total);

    let text = '';
    for (const g of (res.group_results||[])) text += `<span class="text-muted">${g.count}d${g.die}:</span> [${g.rolls.join(', ')}]=${g.subtotal} `;
    if (weaponBonus) text += ` + W(${weaponBonus})`;
    if (atkBonus) text += ` + A(${atkBonus})`;
    mods.forEach(m => { text += ` + ${m.name}(${m.value>0?'+':''}${m.value})`; });
    text += `<br>= <strong class="damage-num">${res.total} damage</strong>`;
    $('#dmg-result').innerHTML = text;
    addLog(`[Damage] ${gd} + W(${weaponBonus}) + A(${atkBonus}) = ${res.total}`);
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
  });
  let t = `D20(${res.d20}) + Base(${res.base_mod})`;
  mods.forEach(m => { t += ` + ${m.name}(${m.value>0?'+':''}${m.value})`; });
  t += ` = <strong>${res.total}</strong> → Attack Bonus: <span class="value">${res.attack_bonus}</span>`;
  $('#atk-result').innerHTML = t;
  $('#dmg-atk-bonus').textContent = res.attack_bonus;
  addLog(`[Attack] d20(${res.d20})+base(${res.base_mod})=${res.total} → AtkBonus ${res.attack_bonus}`);
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
// INCOMING DAMAGE
// ══════════════════════════════════════════════════════════════
function renderDefense() {
  const c = char; if (!c) return;
  const body = $('#defense-body');
  body.innerHTML = `
    <div class="field-group"><label>Enemy Roll:</label><input type="number" id="di-enemy-roll" style="width:60px"></div>
    <div class="field-group"><label>Your KD (AC):</label><span class="value">${c.armor_class}</span></div>
    <div class="field-group"><label>Damage Rolled:</label><input type="number" id="di-damage" style="width:60px"></div>
    <button class="btn btn-danger btn-sm" id="di-apply" style="margin-top:8px">⚔️ Apply Damage</button>
    <div class="result-box" id="di-result" style="margin-top:8px"><span class="text-muted">Enter values and apply</span></div>
  `;
  $('#di-apply').addEventListener('click', async () => {
    const enemyRoll = parseInt($('#di-enemy-roll').value)||0;
    const dmg = parseInt($('#di-damage').value)||0;
    if (!enemyRoll || !dmg) return;
    const res = await api.post('/api/calc/damage-intake', {
      character_id: CHAR_ID, enemy_roll: enemyRoll, damage_rolled: dmg,
    });
    if (res.final_damage === 0 && res.hit_diff <= 0) {
      $('#di-result').innerHTML = `<span class="miss-text">MISS!</span> Diff: ${res.hit_diff}`;
      addLog(`[Defense] Enemy(${enemyRoll}) vs KD(${res.armor_class}) = MISS`);
    } else {
      if (res.final_damage > c.current_hp * 0.5 && res.final_damage > 0) {
        const ok = await confirmAction(`Take ${res.final_damage} damage? (>50% of current HP)`);
        if (!ok) return;
      }
      await api.patch(`/api/characters/${CHAR_ID}/hp`, { delta: -res.final_damage });
      char = await api.get(`/api/characters/${CHAR_ID}`);
      flash($('#hp-card'), 'flash-damage');
      renderHP();

      const tierPct = Math.round((1 - res.multiplier) * 100);
      let bd = `Diff: ${res.hit_diff} → <span class="tier-text">${res.tier_label}</span><br>Tier reduction: ${tierPct}%`;
      if (res.effect_breakdown.length) {
        res.effect_breakdown.forEach(e => {
          if (e.type==='percent_reduction') bd += ` + ${e.name}: ${e.value}%`;
          else bd += `<br>→ ${e.name}: -${e.value} flat`;
        });
        bd += `<br>Total: <span class="text-accent">${res.total_percent_reduction}%</span> → ×${res.combined_multiplier}`;
        bd += `<br>${dmg} × ${res.combined_multiplier} = ${res.base_damage}`;
        if (res.flat_sum > 0) bd += ` - ${res.flat_sum} flat`;
      } else {
        bd += `<br>${dmg} × ${res.combined_multiplier} = ${res.base_damage}`;
      }
      bd += `<br><strong>Final: <span class="damage-num">${res.final_damage} damage</span></strong>`;
      $('#di-result').innerHTML = bd;
      addLog(`[Defense] Enemy(${enemyRoll}) vs KD(${res.armor_class}) → ${res.tier_label} → ${res.final_damage} dmg`);
    }
  });
}

// ══════════════════════════════════════════════════════════════
// HP RECOVERY
// ══════════════════════════════════════════════════════════════
function renderHeal() {
  const c = char; if (!c) return;
  const body = $('#heal-body');
  body.innerHTML = `
    <div class="field-group">
      <label>Dice:</label><input type="number" id="heal-count" value="${c.hp_dice_count}" min="1" style="width:44px">
      <label>d</label><input type="number" id="heal-die" value="${c.hp_dice_type}" min="1" style="width:44px">
      <label>+</label><input type="number" id="heal-mod" value="${c.hp_recovery_modifier}" style="width:44px">
    </div>
    <button class="btn btn-primary btn-sm" id="btn-roll-heal" style="margin:6px 0">💚 Roll & Heal</button>
    <div class="result-box" id="heal-result"><span class="text-muted">Roll to heal</span></div>
    <hr class="section-divider">
    <div class="field-group">
      <label>Manual HP:</label>
      <input type="number" id="manual-hp" value="0" style="width:60px">
      <button class="btn btn-ghost btn-xs" id="btn-add-hp">+ Add</button>
      <button class="btn btn-ghost btn-xs" id="btn-set-hp">Set</button>
    </div>
  `;
  $('#btn-roll-heal').addEventListener('click', async () => {
    const cnt = parseInt($('#heal-count').value)||2;
    const die = parseInt($('#heal-die').value)||12;
    const mod = parseInt($('#heal-mod').value)||0;
    const res = await api.post('/api/calc/hp-recovery', {
      character_id: CHAR_ID, dice_count: cnt, die_type: die, modifier: mod,
    });
    char = await api.get(`/api/characters/${CHAR_ID}`);
    flash($('#hp-card'), 'flash-heal');
    renderHP();
    const text = `Rolled: [${res.rolls.join(', ')}] + ${mod} = <strong class="heal-num">+${res.total_heal} HP</strong> → ${res.new_hp}/${res.max_hp}`;
    $('#heal-result').innerHTML = text;
    addRollHistory('heal', `${cnt}d${die}+${mod} = +${res.total_heal}`, res.total_heal);
    addLog(`[Heal] ${cnt}d${die}+${mod}=[${res.rolls.join(',')}] → +${res.total_heal} HP`);
  });
  $('#btn-add-hp').addEventListener('click', async () => {
    const v = parseInt($('#manual-hp').value)||0;
    if (!v) return;
    await api.patch(`/api/characters/${CHAR_ID}/hp`, { delta: v });
    char = await api.get(`/api/characters/${CHAR_ID}`);
    if (v > 0) flash($('#hp-card'), 'flash-heal');
    else flash($('#hp-card'), 'flash-damage');
    renderHP();
    addLog(`[HP] Manually ${v>0?'+':''}${v} HP`);
  });
  $('#btn-set-hp').addEventListener('click', async () => {
    const v = parseInt($('#manual-hp').value)||0;
    await api.patch(`/api/characters/${CHAR_ID}/hp`, { set: v });
    char = await api.get(`/api/characters/${CHAR_ID}`);
    renderHP();
    addLog(`[HP] Set to ${v}`);
  });
}

// ══════════════════════════════════════════════════════════════
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
// ENEMY DAMAGE CALC (sidebar)
// ══════════════════════════════════════════════════════════════
let enemyDefenses = [];
let edIdCounter = 0;
function renderEnemyCalc() {
  const body = $('#enemy-calc-body');
  const defHtml = enemyDefenses.map(d => `
    <div class="mod-row">
      <select data-edef-type="${d.id}" style="width:60px">
        <option value="percent" ${d.type==='percent'?'selected':''}>%</option>
        <option value="flat" ${d.type==='flat'?'selected':''}>Flat</option>
      </select>
      <input type="number" value="${d.value}" data-edef-val="${d.id}" style="width:52px">
      <button class="btn-icon danger" data-del-edef="${d.id}">🗑</button>
    </div>`).join('');

  body.innerHTML = `
    <div class="field-group"><label>My Roll:</label><input type="number" id="ec-my-roll" style="width:60px"></div>
    <div class="field-group"><label>Enemy KD:</label><input type="number" id="ec-kd" value="10" style="width:60px"></div>
    <div class="field-group"><label>Damage:</label><input type="number" id="ec-dmg" style="width:60px"></div>
    <div style="margin:6px 0"><strong style="font-size:0.75rem">Defense Bonuses:</strong></div>
    <div id="ec-defs">${defHtml}</div>
    <button class="btn btn-ghost btn-xs" id="ec-add-def" style="margin:4px 0">+ Defense</button>
    <button class="btn btn-primary btn-sm" id="ec-calc" style="margin-top:8px;width:100%">Calculate</button>
    <div class="result-box" id="ec-result" style="margin-top:8px"><span class="text-muted">—</span></div>
  `;

  body.querySelectorAll('[data-edef-type]').forEach(s => { s.addEventListener('change', () => { const d=enemyDefenses.find(x=>x.id==s.dataset.edefType); if(d)d.type=s.value; }); });
  body.querySelectorAll('[data-edef-val]').forEach(inp => { inp.addEventListener('change', () => { const d=enemyDefenses.find(x=>x.id==inp.dataset.edefVal); if(d)d.value=parseInt(inp.value)||0; }); });
  body.querySelectorAll('[data-del-edef]').forEach(btn => { btn.addEventListener('click', () => { enemyDefenses=enemyDefenses.filter(x=>x.id!=btn.dataset.delEdef); renderEnemyCalc(); }); });
  $('#ec-add-def').addEventListener('click', () => { enemyDefenses.push({id:++edIdCounter,type:'percent',value:0}); renderEnemyCalc(); });
  $('#ec-calc').addEventListener('click', async () => {
    const res = await api.post('/api/calc/enemy-damage', {
      my_roll: parseInt($('#ec-my-roll').value)||0,
      enemy_kd: parseInt($('#ec-kd').value)||10,
      damage_rolled: parseInt($('#ec-dmg').value)||0,
      defense_bonuses: enemyDefenses,
    });
    let t = `Diff: ${res.hit_diff} → ${res.tier_label}<br>Base: ${res.base_damage}`;
    t += `<br><strong>Final: <span class="damage-num">${res.final_damage} damage</span></strong>`;
    $('#ec-result').innerHTML = t;
    addLog(`[Enemy] → ${res.tier_label} → ${res.final_damage} dmg`);
  });
}

// ══════════════════════════════════════════════════════════════
// LOG
// ══════════════════════════════════════════════════════════════
function renderLog() {
  const cl = $('#calc-log');
  cl.innerHTML = calcLog.map(e => `<div class="log-entry"><span class="log-time">${e.time}</span> ${e.text}</div>`).join('');
  const rl = $('#roll-history-log');
  rl.innerHTML = rollHistory.map(e => `<div class="log-entry"><span class="log-time">${e.time}</span> [${e.type}] ${e.desc} → <strong>${e.result}</strong></div>`).join('');
}

// Log tab switching
document.addEventListener('click', e => {
  if (!e.target.classList.contains('log-tab-btn')) return;
  $$('.log-tab-btn').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  const tab = e.target.dataset.logTab;
  $('#calc-log').style.display = tab === 'calc' ? '' : 'none';
  $('#roll-history-log').style.display = tab === 'rolls' ? '' : 'none';
});

// ══════════════════════════════════════════════════════════════
// MAP MODAL
// ══════════════════════════════════════════════════════════════
let playerMapCanvas = null;

$('#btn-open-map').addEventListener('click', async () => {
  const modal = $('#map-modal');
  modal.style.display = 'flex';
  if (!playerMapCanvas) {
    playerMapCanvas = new MapCanvas($('#player-map-canvas'), {
      role: 'player',
      sessionCode: SESSION_CODE,
    });
  }
  playerMapCanvas._resize();
  // Load map state
  try {
    const state = await api.get(`/api/map/${SESSION_CODE}`);
    if (state.has_map) {
      await playerMapCanvas.loadImage(state.image_url);
      playerMapCanvas.setGrid(state.grid_size, state.grid_enabled);
      playerMapCanvas.setFog(state.fog_enabled, state.revealed_cells);
      playerMapCanvas.setTokens(state.tokens);
    }
  } catch { /* no map */ }
});

$('#btn-close-map').addEventListener('click', () => {
  $('#map-modal').style.display = 'none';
});

// ══════════════════════════════════════════════════════════════
// WEBSOCKET
// ══════════════════════════════════════════════════════════════
const ws = new WsClient(SESSION_CODE, PLAYER_TOKEN);

ws.on('_connected', () => {
  $('#ws-dot').className = 'status-dot connected';
  $('#ws-label').textContent = 'connected';
});
ws.on('_disconnected', () => {
  $('#ws-dot').className = 'status-dot disconnected';
  $('#ws-label').textContent = 'disconnected';
});
ws.on('_reconnecting', d => { $('#ws-label').textContent = `reconnecting (${d.attempt})...`; });

ws.on('character.hp_update', d => {
  if (d.character_id == CHAR_ID) loadChar();
});
ws.on('session.status_change', d => {
  if (d.status === 'ended') addLog('[Session] Ended by GM');
});

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════
loadChar();
ws.connect();
