// ════════════════════════════════════════════════════════
// Phase 6: abilities tab
// Source: player-app.js lines 4788-4890
// ════════════════════════════════════════════════════════

// PHASE 6 — ABILITIES TAB
// ══════════════════════════════════════════════════════════════
let abilitiesData = [];

async function loadAbilities() {
  try {
    abilitiesData = await api.get(`/api/characters/${CHAR_ID}/abilities`);
    renderAbilities();
    renderActionMenu();     // FIX 2: refresh action cards (Ability card visibility)
    if (typeof renderReactionsPanel === 'function') renderReactionsPanel();  // FIX 4
  } catch (e) { console.warn('loadAbilities:', e); }
}

function renderAbilities() {
  const grid = $('#abilities-grid');
  if (!grid) return;

  // Separate by type
  const active = abilitiesData.filter(a => a.ability_type !== 'passive' && a.ability_type !== 'reaction');
  const passive = abilitiesData.filter(a => a.ability_type === 'passive');
  const reactions = abilitiesData.filter(a => a.ability_type === 'reaction');

  if (!abilitiesData.length) {
    grid.innerHTML = '<span class="text-muted" style="font-size:0.8rem">No abilities learned yet</span>';
    return;
  }

  function renderCard(a) {
    const onCd = a.cooldown_remaining > 0;
    const typeBadge = a.ability_type === 'passive' ? '🔵' : a.ability_type === 'reaction' ? '⚡' : '';
    const costParts = [];
    if (a.mana_cost) costParts.push(`🔮 ${a.mana_cost}`);
    if (a.hp_cost) costParts.push(`❤️ ${a.hp_cost}`);
    // Rework v2: uses counter + conditional flavor + rarity chip
    const hasUses = a.current_uses !== null && a.current_uses !== undefined;
    const maxUses = a.max_uses;
    const depleted = hasUses && a.current_uses <= 0;
    const usesTag = hasUses
      ? `<span class="ab-uses ${depleted ? 'depleted' : ''}" title="Uses remaining">⚡ ${a.current_uses}${maxUses ? ` / ${maxUses}` : ''}</span>`
      : '';
    const condTag = a.is_conditional
      ? `<span class="ab-cond" title="${(a.conditional_text || 'GM discretion').replace(/"/g,'&quot;')}">※ Conditional</span>`
      : '';
    const rarity = a.ability_rank || a.rarity || 'common';
    const rarityChip = `<span class="rarity-chip rarity-${rarity}">${rarity}</span>`;
    const clickable = !onCd && a.ability_type !== 'passive' && !depleted;
    return `<div class="ability-card ${onCd ? 'on-cooldown' : ''} ${depleted ? 'depleted' : ''} ${a.ability_type === 'passive' ? 'passive' : ''}" data-ca-id="${a.character_ability_id}" style="border-left:3px solid ${a.color||'#60a5fa'}">
      <div class="ab-name">${a.icon||'⚡'} ${a.name} ${typeBadge} ${rarityChip}</div>
      <div class="ab-meta" style="display:flex;flex-wrap:wrap;gap:4px;margin-top:2px">
        ${costParts.length ? `<span class="ab-cost">${costParts.join(' · ')}</span>` : ''}
        ${usesTag}
        ${condTag}
        ${onCd ? `<span class="ab-cd">⏳ ${a.cooldown_remaining} turns</span>` : ''}
        ${a.cooldown_turns && !onCd ? `<span class="ab-cd" style="opacity:0.5">CD: ${a.cooldown_turns}t</span>` : ''}
      </div>
      ${a.damage_dice_count ? `<div style="font-size:0.68rem;color:var(--text-muted);margin-top:2px">${a.damage_dice_count}d${a.damage_dice_type} ${a.damage_type||''}</div>` : ''}
      <div class="ab-desc">${a.flavor_text || a.description || ''}</div>
      ${!clickable && a.ability_type !== 'passive' ? '<div class="ab-locked-note">Not usable</div>' : ''}
    </div>`;
  }

  let html = '';
  if (active.length) {
    html += '<div style="font-weight:700;font-size:0.82rem;margin-bottom:4px">🟢 Active</div>';
    html += active.map(renderCard).join('');
  }
  if (reactions.length) {
    html += '<div style="font-weight:700;font-size:0.82rem;margin:8px 0 4px">⚡ Reactions</div>';
    html += reactions.map(renderCard).join('');
  }
  if (passive.length) {
    html += '<div style="font-weight:700;font-size:0.82rem;margin:8px 0 4px">🔵 Passive</div>';
    html += passive.map(renderCard).join('');
  }
  grid.innerHTML = html;

  // Wire active + reaction click-to-use (not passive, not depleted, not on CD)
  grid.querySelectorAll('.ability-card:not(.on-cooldown):not(.passive):not(.depleted)').forEach(card => {
    card.addEventListener('click', async () => {
      const caId = card.dataset.caId;
      const ab = abilitiesData.find(a => a.character_ability_id == caId);
      if (!ab) return;
      const costs = [];
      if (ab.mana_cost) costs.push(`${ab.mana_cost} mana`);
      if (ab.hp_cost) costs.push(`${ab.hp_cost} HP`);
      const costStr = costs.length ? ` (costs ${costs.join(' + ')})` : '';
      if (!confirm(`Use ${ab.name}?${costStr}`)) return;
      try {
        const body = {};
        if (selectedTargetId) body.target_id = selectedTargetId;
        const res = await api.post(`/api/character-abilities/${caId}/use`, body);
        if (res.results) res.results.forEach(r => addLog(`✨ ${ab.name}: ${r}`));
        await loadChar();
        loadAbilities();
      } catch (e) {
        const d = e?.body?.detail;
        showToast(typeof d === 'object' ? d.message : String(d || 'Failed'), 'error');
      }
    });
  });
}

// ══════════════════════════════════════════════════════════════
