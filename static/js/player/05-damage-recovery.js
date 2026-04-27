// ════════════════════════════════════════════════════════
// Incoming damage + HP recovery
// Source: player-app.js lines 785-879
// ════════════════════════════════════════════════════════

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
  // Rework v3: the player-side "Roll & Heal" dice widget is retired. Healing
  // now comes from potions, abilities, and the GM's Full Rest button. We
  // keep a small manual-HP panel so the player can still toggle HP while
  // roleplaying (e.g. "I drink a potion").
  const c = char; if (!c) return;
  const body = $('#heal-body');
  if (!body) return;
  body.innerHTML = `
    <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:6px">
      💡 Healing comes from <strong>potions</strong>, <strong>abilities</strong>,
      or a GM <strong>Full Rest</strong>.
    </div>
    <div class="field-group">
      <label>Manual HP:</label>
      <input type="number" id="manual-hp" value="0" style="width:60px">
      <button class="btn btn-ghost btn-xs" id="btn-add-hp">+ Add</button>
      <button class="btn btn-ghost btn-xs" id="btn-set-hp">Set</button>
    </div>
  `;
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
