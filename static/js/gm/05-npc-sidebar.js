// ════════════════════════════════════════════════════════
// NPC sidebar spawn + AOE damage
// Source: gm-app.js lines 2814–2866
// Globals shared via window.* and module-scope hoisting.
// ════════════════════════════════════════════════════════

// NPC SIDEBAR SPAWN (from NPC Library)
// ══════════════════════════════════════════════════════════════
$('#btn-show-npc-spawn').addEventListener('click', async () => {
  const area = $('#npc-spawn-area');
  if (!area.classList.contains('hidden')) { area.classList.add('hidden'); return; }
  area.classList.remove('hidden');
  // Load templates into dropdown
  const sel = $('#npc-spawn-select');
  if (!npcTemplates.length) {
    try {
      const t = await api.get(`/api/npc-library/templates?session_id=${SESSION_ID}`);
      npcTemplates = t;
    } catch(e) { npcTemplates = []; }
  }
  sel.innerHTML = npcTemplates.length
    ? npcTemplates.map(t => `<option value="${t.id}">${t.name}</option>`).join('')
    : '<option disabled>No templates</option>';
});

$('#btn-npc-spawn').addEventListener('click', async () => {
  const tplId = parseInt($('#npc-spawn-select').value);
  const count = parseInt($('#npc-spawn-count').value) || 1;
  if (!tplId) return;
  try {
    const res = await api.post(`/api/npc-library/templates/${tplId}/spawn`, { session_id: SESSION_ID, count });
    $('#npc-spawn-area').classList.add('hidden');
    showToast(`Spawned ${res.spawned.length} NPC(s)`);
    await refreshChars();
  } catch(e) { showToast('Failed to spawn: ' + e.message, 'error'); }
});

// ══════════════════════════════════════════════════════════════
// AOE DAMAGE
// ══════════════════════════════════════════════════════════════
$('#btn-aoe-damage').addEventListener('click', async () => {
  const er = parseInt($('#aoe-enemy-roll').value) || 0;
  const dmg = parseInt($('#aoe-damage').value) || 0;
  if (!er || !dmg) return;

  const players = characters.filter(c => !c.is_npc && c.is_alive);
  const results = [];
  for (const p of players) {
    const res = await api.post('/api/calc/damage-intake', { character_id: p.id, enemy_roll: er, damage_rolled: dmg });
    if (res.final_damage > 0) await api.patch(`/api/characters/${p.id}/hp`, { delta: -res.final_damage });
    results.push({ name: p.name, damage: res.final_damage, tier: res.tier_label });
  }
  await refreshChars();
  const lines = results.map(r => `${r.name}: ${r.tier} → ${r.damage} dmg`).join('<br>');
  $('#aoe-result').innerHTML = lines || '<span class="text-muted">No living players</span>';
  addLog('gm.aoe', `AoE ${er}/${dmg} → ${results.map(r=>r.name+':'+r.damage).join(', ')}`);
});

// ══════════════════════════════════════════════════════════════
