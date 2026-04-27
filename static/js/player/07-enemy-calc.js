// ════════════════════════════════════════════════════════
// Enemy damage calc sidebar
// Source: player-app.js lines 994-1039
// ════════════════════════════════════════════════════════

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
