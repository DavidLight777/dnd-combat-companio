// ════════════════════════════════════════════════════════
// Phase 6: bonuses & penalties
// Source: player-app.js lines 4718-4787
// ════════════════════════════════════════════════════════

// PHASE 6 — ACTIVE BONUSES & PENALTIES PANEL
// ══════════════════════════════════════════════════════════════
async function renderBonusesPenalties() {
  const bonusEl = $('#active-bonuses-list');
  const penaltyEl = $('#active-penalties-list');
  if (!bonusEl || !penaltyEl) return;

  // Bonuses from equipped items + passive abilities + active status buffs
  try {
    const data = await api.get(`/api/characters/${CHAR_ID}/equipped-bonuses`);
    // API returns { breakdown: [{source, bonus_type, stat_name, value}], + aggregated keys }
    const bonuses = Array.isArray(data.breakdown) ? data.breakdown.slice() : (data.bonuses || []);
    // Also show passive ability bonuses
    const passiveAbs = (abilitiesData || []).filter(a => a.ability_type === 'passive' && a.is_unlocked !== false);
    for (const pa of passiveAbs) {
      const pe = pa.passive_effect || {};
      const pBonuses = pe.bonuses || [];
      for (const pb of pBonuses) {
        bonuses.push({ value: pb.value, bonus_type: pb.bonus_type, stat_name: pb.stat_name, source: `${pa.icon||'🔵'} ${pa.name} (passive)` });
      }
    }
    // Also show active status effect buffs (positive values)
    try {
      const effects = await api.get(`/api/characters/${CHAR_ID}/status-effects`);
      for (const se of (effects || [])) {
        const effs = typeof se.effects === 'string' ? JSON.parse(se.effects) : (se.effects || []);
        for (const e of effs) {
          const v = Number(e.value || 0);
          if (v > 0 && !String(e.type||'').includes('penalty')) {
            bonuses.push({
              value: v,
              bonus_type: e.type || 'bonus',
              stat_name: e.stat_name || null,
              source: `${se.icon || '✨'} ${se.name}`,
            });
          }
        }
      }
    } catch {}
    if (bonuses.length) {
      bonusEl.innerHTML = bonuses.map(b => {
        const label = b.stat_name
          ? `${b.stat_name.toUpperCase()} ${b.value > 0 ? '+' : ''}${b.value}`
          : `${b.bonus_type.replace(/_/g,' ')} ${b.value > 0 ? '+' : ''}${b.value}`;
        return `<div style="margin-bottom:3px"><span style="color:var(--accent-green)">${label}</span> <span style="color:var(--text-muted)">from ${b.source}</span></div>`;
      }).join('');
    } else {
      bonusEl.innerHTML = '<span class="text-muted">No active bonuses</span>';
    }
  } catch (e) { console.warn('bonuses:', e); bonusEl.innerHTML = '<span class="text-muted">No active bonuses</span>'; }

  // Penalties from status effects
  try {
    const effects = await api.get(`/api/characters/${CHAR_ID}/status-effects`);
    const entries = [];
    for (const se of (effects || [])) {
      const effs = typeof se.effects === 'string' ? JSON.parse(se.effects) : (se.effects || []);
      for (const e of effs) {
        if (e.value && e.value < 0 || e.type?.includes('penalty') || e.type === 'skip_turn') {
          entries.push(`${se.icon || '⚠️'} ${se.name}: ${e.type.replace(/_/g,' ')} ${e.value || ''}`);
        }
      }
    }
    penaltyEl.innerHTML = entries.length ?
      entries.map(e => `<div style="margin-bottom:3px">${e}</div>`).join('') :
      '<span class="text-muted">No active penalties</span>';
  } catch { penaltyEl.innerHTML = '<span class="text-muted">No active penalties</span>'; }
}

// ══════════════════════════════════════════════════════════════
