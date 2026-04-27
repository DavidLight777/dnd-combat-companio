// ════════════════════════════════════════════════════════
// Character detail panel + professions
// Source: gm-app.js lines 396–2100
// Globals shared via window.* and module-scope hoisting.
// ════════════════════════════════════════════════════════

// CHARACTER DETAIL (main area)
// ══════════════════════════════════════════════════════════════
async function renderCharDetail() {
  const area = $('#char-detail');
  if (!selectedCharId) {
    area.innerHTML = '<p class="text-muted">Select a character from the sidebar.</p>';
    return;
  }

  let c;
  try { c = await api.get(`/api/characters/${selectedCharId}`); }
  catch { area.innerHTML = '<p class="text-muted">Character not found.</p>'; return; }

  const pct = c.max_hp > 0 ? (c.current_hp / c.max_hp * 100) : 0;
  const hpColor = pct > 50 ? 'var(--hp-high)' : pct > 25 ? 'var(--hp-mid)' : 'var(--hp-low)';
  const stats = ['strength','dexterity','constitution','intelligence','wisdom','charisma'];
  const labels = ['STR','DEX','CON','INT','WIS','CHA'];

  const effectsHtml = (c.effects || []).map(e =>
    `<div class="mod-row ${e.is_active?'':'inactive'}">
      <label class="toggle-switch"><input type="checkbox" ${e.is_active?'checked':''} data-eff-toggle="${e.id}"><span class="slider"></span></label>
      <span style="flex:1;font-size:0.8rem">${e.name}</span>
      <span style="font-size:0.8rem;color:var(--text-muted)">${e.effect_type==='percent_reduction'?e.value+'%':'-'+e.value}</span>
    </div>`
  ).join('') || '<span class="text-muted" style="font-size:0.8rem">None</span>';

  // ── Shared HTML fragments ──
  const hpHtml = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
      <span style="font-size:1.5rem;font-weight:700;color:${hpColor};font-variant-numeric:tabular-nums">${c.current_hp} / ${c.max_hp}</span>
      <span style="font-size:0.8rem;color:var(--text-muted)">KD: ${c.armor_class}</span>
      <div class="hp-bar-container" style="flex:1"><div class="hp-bar" style="width:${pct}%;background:${hpColor}"></div></div>
    </div>
    <div class="action-row">
      <button class="btn btn-ghost btn-xs" data-hp-delta="-5">-5</button>
      <button class="btn btn-ghost btn-xs" data-hp-delta="-10">-10</button>
      <button class="btn btn-ghost btn-xs" data-hp-delta="-20">-20</button>
      <button class="btn btn-ghost btn-xs" data-hp-delta="-50">-50</button>
      <span style="width:8px"></span>
      <button class="btn btn-ghost btn-xs" data-hp-delta="5">+5</button>
      <button class="btn btn-ghost btn-xs" data-hp-delta="10">+10</button>
      <button class="btn btn-ghost btn-xs" data-hp-delta="20">+20</button>
      <button class="btn btn-ghost btn-xs" data-hp-delta="999" style="color:var(--accent-green)">Full</button>
    </div>
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:12px">
      <label style="font-size:0.78rem;color:var(--text-muted)">Custom:</label>
      <input type="number" id="gm-hp-custom" value="0" style="width:60px">
      <button class="btn btn-ghost btn-xs" id="gm-hp-add">+ Add</button>
      <button class="btn btn-ghost btn-xs" id="gm-hp-sub">- Sub</button>
      <button class="btn btn-ghost btn-xs" id="gm-hp-set">Set</button>
    </div>`;

  // Spiritual HP
  const spiritPct = c.spiritual_max_hp > 0 ? (c.spiritual_hp / c.spiritual_max_hp * 100) : 0;
  const spiritColor = spiritPct > 50 ? '#a855f7' : spiritPct > 25 ? '#c084fc' : '#e879f9';
  const spiritHtml = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;padding-top:12px;border-top:1px solid var(--border)">
      <span style="font-size:1.2rem;font-weight:700;color:${spiritColor};font-variant-numeric:tabular-nums">👻 ${c.spiritual_hp || 0} / ${c.spiritual_max_hp || 0}</span>
      <span style="font-size:0.75rem;color:var(--text-muted)">Spirit HP</span>
      <div class="hp-bar-container" style="flex:1"><div class="hp-bar" style="width:${spiritPct}%;background:${spiritColor}"></div></div>
    </div>
    <div class="action-row">
      <button class="btn btn-ghost btn-xs" data-spirit-delta="-5">-5</button>
      <button class="btn btn-ghost btn-xs" data-spirit-delta="-10">-10</button>
      <button class="btn btn-ghost btn-xs" data-spirit-delta="-20">-20</button>
      <span style="width:8px"></span>
      <button class="btn btn-ghost btn-xs" data-spirit-delta="5">+5</button>
      <button class="btn btn-ghost btn-xs" data-spirit-delta="10">+10</button>
      <button class="btn btn-ghost btn-xs" data-spirit-delta="20">+20</button>
      <button class="btn btn-ghost btn-xs" data-spirit-delta="999" style="color:#a855f7">Full</button>
    </div>
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
      <label style="font-size:0.78rem;color:var(--text-muted)">Custom:</label>
      <input type="number" id="gm-spirit-custom" value="0" style="width:60px">
      <button class="btn btn-ghost btn-xs" id="gm-spirit-add">+ Add</button>
      <button class="btn btn-ghost btn-xs" id="gm-spirit-sub">- Sub</button>
      <button class="btn btn-ghost btn-xs" id="gm-spirit-set">Set</button>
    </div>`;

  const manaHtml = c.mana_max > 0 ? (() => {
    const manaPct = c.mana_max > 0 ? (c.mana_current / c.mana_max * 100) : 0;
    return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
      <span style="font-size:1.1rem;font-weight:700;color:#60a5fa;font-variant-numeric:tabular-nums">🔮 ${c.mana_current} / ${c.mana_max}</span>
      ${c.mana_regen_per_turn ? `<span style="font-size:0.7rem;color:var(--text-muted)">+${c.mana_regen_per_turn}/turn</span>` : ''}
      <div style="flex:1;height:8px;border-radius:4px;background:var(--bg-surface-2);overflow:hidden"><div style="width:${manaPct}%;height:100%;background:#60a5fa;border-radius:4px;transition:width .3s"></div></div>
    </div>
    <div class="action-row" style="margin-bottom:8px">
      <button class="btn btn-ghost btn-xs" data-mana-delta="5">+5</button>
      <button class="btn btn-ghost btn-xs" data-mana-delta="10">+10</button>
      <button class="btn btn-ghost btn-xs" data-mana-delta="20">+20</button>
      <span style="width:8px"></span>
      <button class="btn btn-ghost btn-xs" data-mana-delta="-5">-5</button>
      <button class="btn btn-ghost btn-xs" data-mana-delta="-10">-10</button>
      <button class="btn btn-ghost btn-xs" data-mana-delta="-20">-20</button>
      <button class="btn btn-ghost btn-xs" data-mana-full="1" style="color:#60a5fa;margin-left:4px" title="Full mana restore">🔮 Full</button>
    </div>`;
  })() : '';

  const permanentBonusesHtml = (() => {
    const raceMods = (c.stat_modifiers || []).filter(m => m.source === 'race');
    const classMods = (c.stat_modifiers || []).filter(m => m.source === 'class');
    if (!raceMods.length && !classMods.length) return '';
    let html = '<div style="margin-bottom:8px">';
    html += '<h3 style="font-size:0.82rem;margin-bottom:6px">🏷️ Permanent Bonuses</h3>';
    if (raceMods.length) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px">';
      html += raceMods.map(m => `<span style="padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:600;background:#fbbf2420;border:1px solid #fbbf24;color:#fbbf24">${m.name || m.stat_name}: ${m.value > 0 ? '+' : ''}${m.value}</span>`).join('');
      html += '</div>';
    }
    if (classMods.length) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:4px">';
      html += classMods.map(m => `<span style="padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:600;background:#60a5fa20;border:1px solid #60a5fa;color:#60a5fa">${m.name || m.stat_name}: ${m.value > 0 ? '+' : ''}${m.value}</span>`).join('');
      html += '</div>';
    }
    html += '</div>';
    return html;
  })();

  const statsHtml = `
    <div class="stats-inline">
      ${stats.map((s,i) => {
        const base = c[s];
        const modSum = (c.stat_modifiers || []).filter(m => m.stat_name === s && m.is_active).reduce((a, m) => a + m.value, 0);
        const eff = base + modSum;
        const modLabel = modSum !== 0 ? ` <span style="font-size:0.55rem;color:${modSum > 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">(${modSum > 0 ? '+' : ''}${modSum})</span>` : '';
        return `<div class="stat-inline"><div class="sl">${labels[i]}</div><div class="sv">${eff}${modLabel}</div></div>`;
      }).join('')}
      <div class="stat-inline"><div class="sl">KD</div><div class="sv" style="color:var(--accent)">${c.armor_class}</div></div>
    </div>`;

  const hasPoints = (c.attribute_points_available || 0) > 0;
  const editStatsHtml = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
      ${stats.map((s,i) => `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;position:relative">
        <span style="font-size:0.6rem;color:var(--text-muted)">${labels[i]}</span>
        <div style="display:flex;align-items:center;gap:2px">
          <input type="number" value="${c[s]}" data-gm-stat="${s}" style="width:48px;font-size:0.78rem;padding:3px">
          ${hasPoints ? `<button class="btn btn-xs btn-primary gm-stat-plus" data-stat="${s}" style="padding:1px 4px;font-size:0.6rem" title="+1 point">+1</button>` : ''}
        </div>
      </div>`).join('')}
      <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
        <span style="font-size:0.6rem;color:var(--text-muted)">KD</span>
        <input type="number" value="${c.armor_class}" data-gm-stat="armor_class" style="width:48px;font-size:0.78rem;padding:3px">
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
        <span style="font-size:0.6rem;color:var(--text-muted)">MaxHP</span>
        <input type="number" value="${c.max_hp}" data-gm-stat="max_hp" style="width:48px;font-size:0.78rem;padding:3px">
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
        <span style="font-size:0.6rem;color:#fbbf24">KillXP</span>
        <input type="number" value="${c.kill_xp_reward || 0}" data-gm-stat="kill_xp_reward" style="width:48px;font-size:0.78rem;padding:3px">
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
        <span style="font-size:0.6rem;color:#60a5fa">MaxMP</span>
        <input type="number" value="${c.mana_max}" data-gm-stat="mana_max" style="width:48px;font-size:0.78rem;padding:3px">
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
        <span style="font-size:0.6rem;color:#60a5fa">MP/T</span>
        <input type="number" value="${c.mana_regen_per_turn}" data-gm-stat="mana_regen_per_turn" style="width:48px;font-size:0.78rem;padding:3px">
      </div>
    </div>`;

  const effectsSection = `
    <h3 style="font-size:0.82rem;margin-bottom:6px">Effects</h3>
    <div id="gm-effects">${effectsHtml}</div>`;

  const statusSection = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <h3 style="font-size:0.82rem;flex:1">⚡ Status Effects</h3>
      <button class="btn btn-primary btn-xs" id="btn-gm-add-status">+ Add Status</button>
      <button class="btn btn-ghost btn-xs" id="btn-gm-status-library">📚 Library</button>
    </div>
    <div id="gm-status-badges" style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px"></div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="font-size:0.72rem;color:var(--text-muted)">Force Adv/Disadv:</span>
      <div class="adv-toggle" id="gm-force-adv-toggle">
        <button data-mode="normal" class="active">Normal</button>
        <button data-mode="advantage">ADV</button>
        <button data-mode="disadvantage">DISADV</button>
      </div>
    </div>`;

  const rollSection = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <h3 style="font-size:0.82rem;margin:0">🎲 Characteristic Roll</h3>
      ${makeAdvToggle('gm_char_roll')}
    </div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
      <select id="gm-roll-stat" style="font-size:0.78rem;width:110px">
        <option value="strength">Strength</option>
        <option value="dexterity">Dexterity</option>
        <option value="constitution">Constitution</option>
        <option value="intelligence">Intelligence</option>
        <option value="wisdom">Wisdom</option>
        <option value="charisma">Charisma</option>
      </select>
      <select id="gm-roll-type" style="font-size:0.78rem;width:120px">
        <option value="ability_check">Ability Check</option>
        <option value="saving_throw">Saving Throw</option>
        <option value="skill_check">Skill Check</option>
      </select>
      <button class="btn btn-secondary btn-xs" id="btn-gm-roll-char">🎲 Roll D20</button>
    </div>
    <div id="gm-roll-result" style="font-size:0.82rem;margin-bottom:8px"></div>`;

  const npcAttackHtml = c.is_npc ? `
    <hr class="section-divider">
    <h3 style="font-size:0.82rem;margin-bottom:6px">⚔️ NPC Attack</h3>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
      <label style="font-size:0.78rem;color:var(--text-muted)">Target:</label>
      <select id="npc-atk-target" style="font-size:0.78rem;min-width:120px"></select>
      <span id="npc-weapon-info" style="font-size:0.72rem;color:var(--text-muted)"></span>
    </div>

    <!-- STEP 1: HIT ROLL -->
    <div id="npc-atk-step1">
      <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:4px;font-weight:600">🎯 Step 1 — Roll to Hit (d20)</div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:0.72rem;color:var(--text-muted)">Mode:</span>
        <div class="adv-toggle" id="npc-hit-adv">
          <button data-mode="disadvantage">Disadv</button>
          <button data-mode="normal" class="active">Normal</button>
          <button data-mode="advantage">Adv</button>
        </div>
        <button class="btn btn-primary btn-sm" id="btn-npc-roll-attack" style="margin-left:auto">🎯 Roll Hit</button>
      </div>
    </div>

    <!-- STEP 2: DAMAGE ROLL (hidden until HIT) -->
    <div id="npc-atk-step2" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
      <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:4px;font-weight:600">💥 Step 2 — Roll Damage</div>
      <div id="npc-atk-widget-host" style="margin-bottom:6px"></div>
      <div style="display:flex;gap:6px;align-items:center">
        <button class="btn btn-ghost btn-sm" id="btn-npc-cancel-dmg">Cancel</button>
        <button class="btn btn-primary btn-sm" id="btn-npc-roll-damage" style="margin-left:auto">💥 Roll Damage</button>
      </div>
    </div>

    <div id="npc-atk-result" style="font-size:0.8rem;margin:8px 0"></div>

    <!-- NPC Actions panel: Abilities / Potions / Items (like player's Action Menu) -->
    <hr class="section-divider">
    <h3 style="font-size:0.82rem;margin-bottom:6px">🎯 NPC Actions</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px">
      <button class="btn btn-ghost btn-sm" id="btn-npc-act-ability" style="display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px">
        <span style="font-size:1.2rem">✨</span>
        <span style="font-size:0.72rem">Ability</span>
      </button>
      <button class="btn btn-ghost btn-sm" id="btn-npc-act-potion" style="display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px">
        <span style="font-size:1.2rem">🧪</span>
        <span style="font-size:0.72rem">Potion</span>
      </button>
      <button class="btn btn-ghost btn-sm" id="btn-npc-act-item" style="display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px">
        <span style="font-size:1.2rem">🎒</span>
        <span style="font-size:0.72rem">Use Item</span>
      </button>
      <button class="btn btn-ghost btn-sm" id="btn-npc-act-heal" style="display:flex;flex-direction:column;align-items:center;gap:2px;padding:10px">
        <span style="font-size:1.2rem">❤️</span>
        <span style="font-size:0.72rem">Heal</span>
      </button>
    </div>
    <div id="npc-action-result" style="font-size:0.8rem;margin-bottom:8px"></div>
  ` : '';

  const dmgCalcHtml = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
      <h3 style="font-size:0.82rem;margin:0">Apply Damage to ${c.name}</h3>
    </div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <label style="font-size:0.78rem;color:var(--text-muted)">Enemy Roll:</label>
      <input type="number" id="gm-di-enemy" style="width:56px">
      <label style="font-size:0.78rem;color:var(--text-muted)">Raw Dmg:</label>
      <input type="number" id="gm-di-dmg" style="width:56px">
      <button class="btn btn-danger btn-sm" id="btn-gm-apply-dmg">⚔️ Apply</button>
    </div>
    <div id="gm-dmg-result" style="margin-top:6px;font-size:0.82rem"></div>`;

  const currencyHtml = `
    <h3 style="font-size:0.82rem;margin-bottom:6px">💰 Currency</h3>
    <div id="gm-currency-display" style="font-size:0.85rem;margin-bottom:6px;font-weight:600;color:var(--accent)"></div>
    <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
      <span style="font-size:0.7rem;color:#e0c97f">P:</span><input type="number" id="gm-give-plat" value="0" style="width:42px;font-size:0.75rem" min="0">
      <span style="font-size:0.7rem;color:#fbbf24">G:</span><input type="number" id="gm-give-gold" value="0" style="width:42px;font-size:0.75rem" min="0">
      <span style="font-size:0.7rem;color:#94a3b8">S:</span><input type="number" id="gm-give-silver" value="0" style="width:42px;font-size:0.75rem" min="0">
      <span style="font-size:0.7rem;color:#b87333">B:</span><input type="number" id="gm-give-bronze" value="0" style="width:42px;font-size:0.75rem" min="0">
      <button class="btn btn-primary btn-xs" id="btn-gm-give-currency">+ Give</button>
      <button class="btn btn-ghost btn-xs" id="btn-gm-take-currency">- Take</button>
    </div>
    <div style="display:flex;gap:4px;align-items:center;margin-bottom:8px">
      <span style="font-size:0.7rem;color:var(--text-muted)">Set total bronze:</span>
      <input type="number" id="gm-wealth-bronze" value="${c.wealth_bronze || c.gold_copper || 0}" style="width:80px;font-size:0.75rem">
      <button class="btn btn-ghost btn-xs" id="btn-gm-set-gold">Set</button>
      <button class="btn btn-ghost btn-xs" id="btn-gm-tx-history" style="margin-left:auto">📜 History</button>
    </div>`;

  const inventoryHtml = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <h3 style="font-size:0.82rem;flex:1">🎒 Inventory</h3>
      <label style="font-size:0.7rem;color:var(--text-muted)">Player can edit:</label>
      <label class="toggle-switch"><input type="checkbox" id="gm-can-edit-items" ${c.can_edit_own_items?'checked':''}><span class="slider"></span></label>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
      <button class="btn btn-primary btn-xs" id="btn-gm-give-item">+ Give Item</button>
    </div>
    <div id="gm-char-inventory" style="font-size:0.8rem"></div>`;

  const abilitiesAssignHtml = `
    <div style="margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:0.82rem;font-weight:700">✨ Abilities</span>
        <button class="btn btn-ghost btn-xs" id="btn-assign-ability">+ Assign</button>
      </div>
      <div id="npc-abilities-list" style="font-size:0.78rem"></div>
    </div>`;

  // ── NPC: 6-tab layout | Player: single scrollable view ──
  if (c.is_npc) {
    area.innerHTML = `
      <div class="detail-panel">
        <!-- NPC Header Bar (always visible) -->
        <div class="detail-header" style="flex-wrap:wrap;gap:6px">
          <h2 style="flex:1">${c.name} <span class="cc-badge badge-npc">NPC</span> ${!c.is_alive?'<span class="cc-badge badge-dead">💀 DEAD</span>':''}</h2>
          <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">
            <label style="font-size:0.7rem;display:flex;align-items:center;gap:3px;cursor:pointer" title="Token color">🎨 <input type="color" id="npc-token-color" value="${c.token_color||'#60a5fa'}" style="width:24px;height:20px;border:none;padding:0;cursor:pointer"></label>
            <label style="font-size:0.72rem;display:flex;align-items:center;gap:3px;cursor:pointer"><input type="checkbox" id="npc-place-table" ${c.place_at_table?'checked':''}> Table</label>
            <label style="font-size:0.72rem;display:flex;align-items:center;gap:3px;cursor:pointer"><input type="checkbox" id="npc-show-hp" ${c.show_hp_to_players?'checked':''}> HP</label>
            <button class="btn btn-danger btn-xs" id="btn-npc-kill" title="Kill/KO">💀</button>
            <button class="btn btn-danger btn-xs" id="btn-delete-char" title="Remove from session">🗑️</button>
          </div>
        </div>

        <!-- NPC Tab Bar -->
        <div class="npc-tab-bar" style="display:flex;gap:0;border-bottom:2px solid var(--border);overflow-x:auto;background:var(--bg-surface)">
          <button class="npc-tab active" data-npc-tab="stats">⚔️ Stats</button>
          <button class="npc-tab" data-npc-tab="inventory">🎒 Inv</button>
          <button class="npc-tab" data-npc-tab="status">⚡ Status</button>
          <button class="npc-tab" data-npc-tab="abilities">✨ Abilities</button>
          <button class="npc-tab" data-npc-tab="notes">📝 Notes</button>
          <button class="npc-tab" data-npc-tab="rolls">🎲 Rolls</button>
        </div>

        <div class="detail-body" style="padding-top:8px">
          <!-- Tab: Stats & Combat -->
          <div class="npc-tab-content active" data-npc-panel="stats">
            ${hpHtml}
            ${spiritHtml}
            ${manaHtml}
            ${permanentBonusesHtml}
            ${statsHtml}
            ${editStatsHtml}
            ${npcAttackHtml}
            <hr class="section-divider">
            ${dmgCalcHtml}
          </div>

          <!-- Tab: Inventory -->
          <div class="npc-tab-content" data-npc-panel="inventory" style="display:none">
            ${inventoryHtml}
            ${currencyHtml}
            <hr class="section-divider">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <h3 style="font-size:0.82rem;flex:1">🏪 Merchant</h3>
              <button class="btn btn-primary btn-xs" id="btn-gm-merchant-settings">⚙️ Shop Settings</button>
              <button class="btn btn-ghost btn-xs" id="btn-gm-initiate-trade">🤝 Initiate Trade</button>
            </div>
            <div id="gm-merchant-preview" style="font-size:0.8rem"></div>
          </div>

          <!-- Tab: Status Effects -->
          <div class="npc-tab-content" data-npc-panel="status" style="display:none">
            ${effectsSection}
            <hr class="section-divider">
            ${statusSection}
          </div>

          <!-- Tab: Abilities -->
          <div class="npc-tab-content" data-npc-panel="abilities" style="display:none">
            ${abilitiesAssignHtml}
          </div>

          <!-- Tab: Turn Counter & Notes -->
          <div class="npc-tab-content" data-npc-panel="notes" style="display:none">
            <div style="margin-bottom:8px">
              <h3 style="font-size:0.82rem;margin-bottom:6px">🔄 Turn Counter</h3>
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                <span style="font-size:1.2rem;font-weight:700;color:var(--accent);font-variant-numeric:tabular-nums" id="npc-turn-count">${c.turn_count||0}</span>
                <button class="btn btn-primary btn-xs" id="btn-npc-turn-inc">+1 Turn</button>
                <button class="btn btn-ghost btn-xs" id="btn-npc-turn-dec">-1</button>
                <button class="btn btn-ghost btn-xs" id="btn-npc-turn-reset" style="color:var(--accent-red)">Reset</button>
              </div>
            </div>
            <hr class="section-divider">
            <div style="margin-bottom:8px">
              <h3 style="font-size:0.82rem;margin-bottom:6px">📝 GM Notes</h3>
              <textarea id="npc-gm-notes" rows="8" style="width:100%;font-size:0.8rem;background:var(--bg-surface-2);border:1px solid var(--border);border-radius:var(--r-md);padding:8px;resize:vertical">${c.gm_notes||''}</textarea>
              <div style="display:flex;gap:6px;margin-top:4px">
                <button class="btn btn-primary btn-xs" id="btn-save-npc-notes">Save Notes</button>
                <button class="btn btn-ghost btn-xs" id="btn-preview-npc-notes">Preview</button>
              </div>
              <div id="npc-notes-preview" style="display:none;margin-top:6px;font-size:0.8rem;padding:8px;background:var(--bg-surface-2);border-radius:var(--r-md)"></div>
            </div>
            <hr class="section-divider">
            <div id="char-notes-section"></div>
          </div>

          <!-- Tab: Characteristic Rolls -->
          <div class="npc-tab-content" data-npc-panel="rolls" style="display:none">
            ${rollSection}
            <hr class="section-divider">
            <label style="display:flex;align-items:center;gap:4px;font-size:0.75rem;cursor:pointer">
              <input type="checkbox" id="npc-broadcast-rolls"> Broadcast rolls to players
            </label>
          </div>
        </div>
      </div>`;
  } else {
    // ── Player: original single-view layout ──
    area.innerHTML = `
      <div class="detail-panel">
<div class="detail-header" style="flex-wrap:wrap;gap:6px">
      <h2 style="flex:1">${c.name} <span class="cc-badge badge-player">Player</span> ${!c.is_alive?'<span class="cc-badge badge-dead">💀 DEAD</span>':''}</h2>
      <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">
        <label style="font-size:0.72rem;display:flex;align-items:center;gap:3px;cursor:pointer"><input type="checkbox" id="player-place-table" ${c.place_at_table?'checked':''}> Table</label>
        <label style="font-size:0.72rem;display:flex;align-items:center;gap:3px;cursor:pointer"><input type="checkbox" id="player-show-hp" ${c.show_hp_to_players?'checked':''}> HP</label>
      </div>
    </div>
        <div class="detail-body">
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap;font-size:0.78rem">
            <span id="gm-char-race" style="padding:2px 8px;border-radius:10px;background:var(--bg-surface-2);border:1px solid var(--border)">Race: <strong>${c.race_id ? '...' : 'None'}</strong></span>
            <span id="gm-char-class" style="padding:2px 8px;border-radius:10px;background:var(--bg-surface-2);border:1px solid var(--border)" title="Assigned in Professions panel">Profession: <strong>${Array.isArray(c.professions)&&c.professions.length ? c.professions.map(p=>p.name+' L'+p.level).join(' / ') : 'None'}</strong></span>
            <!-- Rework Phase 8: Level / Rank / XP progression badge -->
            <span id="gm-char-progression" style="padding:2px 8px;border-radius:10px;background:var(--bg-surface-2);border:1px solid var(--border)">
              <span title="Rank" style="text-transform:capitalize">${(c.rank||'common')}</span>
              · Lvl <strong>${c.level ?? 0}</strong>
              · XP <strong><span id="gm-char-xp">${c.experience || 0}</span></strong>/<span id="gm-char-xp-next">${100 + 100 * (c.level || 0)}</span>
              ${(c.attribute_points_available || 0) > 0 ? `· Points: <strong style="color:#fbbf24">${c.attribute_points_available}</strong>` : ''}
              <button class="btn btn-ghost btn-xs" id="btn-grant-xp" style="padding:0 3px;margin-left:4px;font-size:0.65rem" title="Grant XP">+XP</button>
              <button class="btn btn-ghost btn-xs" id="btn-level-up" style="padding:0 3px;font-size:0.65rem" title="Level up">⬆</button>
              <button class="btn btn-ghost btn-xs" id="btn-rank-up" style="padding:0 3px;font-size:0.65rem" title="Rank up">★</button>
              <button class="btn btn-ghost btn-xs" id="btn-edit-xp" style="padding:0 3px;font-size:0.65rem" title="Set XP">✏️</button>
            </span>
          </div>
          ${hpHtml}
          ${spiritHtml}
          ${manaHtml}
          ${abilitiesAssignHtml}
          <hr class="section-divider">
          ${permanentBonusesHtml}
          ${statsHtml}
          ${editStatsHtml}
          <hr class="section-divider">
          ${effectsSection}
          <hr class="section-divider">
          ${statusSection}
          <hr class="section-divider">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <h3 style="font-size:0.82rem;flex:1">⏱ Timer</h3>
          </div>
          <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px">
            <input type="number" id="gm-detail-timer-min" value="2" min="1" max="60" step="1" style="width:50px;font-size:0.8rem">
            <span style="font-size:0.75rem;color:var(--text-muted)">min</span>
            <button class="btn btn-primary btn-xs" id="btn-gm-detail-timer-start">▶ Start</button>
            <button class="btn btn-ghost btn-xs" id="btn-gm-detail-timer-pause" style="display:none">⏸ Pause</button>
            <button class="btn btn-ghost btn-xs" id="btn-gm-detail-timer-resume" style="display:none">▶ Resume</button>
            <button class="btn btn-danger btn-xs" id="btn-gm-detail-timer-stop" style="display:none">⏹ Stop</button>
          </div>
          <div id="gm-detail-timer-display" style="font-size:1.6rem;font-weight:700;color:var(--accent-orange);margin-bottom:8px;display:none;font-variant-numeric:tabular-nums"></div>
          <hr class="section-divider">
          ${rollSection}
          <hr class="section-divider">
          ${dmgCalcHtml}
          <hr class="section-divider">
          ${currencyHtml}
          <hr class="section-divider">
          ${inventoryHtml}
          <hr class="section-divider">
          <!-- Rework Phase 4: Professions panel -->
          <div class="gm-prof-section">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <h3 style="font-size:0.82rem;flex:1">🛡️ Professions <span class="text-muted" style="font-size:0.7rem">(multi)</span></h3>
              <button class="btn btn-primary btn-xs" id="btn-gm-prof-add">+ Add</button>
            </div>
            <div id="gm-char-professions" style="display:flex;flex-direction:column;gap:6px;min-height:20px"></div>
          </div>
          <hr class="section-divider">
          <div id="char-notes-section"></div>
        </div>
      </div>`;
  }

  // Rework Phase 4: load + wire professions panel for this character
  loadGmCharProfessions(c.id);
  const addProfBtn = area.querySelector('#btn-gm-prof-add');
  if (addProfBtn) addProfBtn.addEventListener('click', () => openGmAddProfessionModal(c.id));

  // ── Wire events ──
  // HP delta buttons
  area.querySelectorAll('[data-hp-delta]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const d = parseInt(btn.dataset.hpDelta);
      if (d === 999) await api.patch(`/api/characters/${c.id}/hp`, { set: c.max_hp });
      else await api.patch(`/api/characters/${c.id}/hp`, { delta: d });
      await refreshChars();
      addLog('gm.hp', `${c.name}: ${d===999?'Full Heal':d>0?'+'+d:d} HP`);
    });
  });
  // Custom HP
  $('#gm-hp-add').addEventListener('click', async () => { const v=parseInt($('#gm-hp-custom').value)||0; await api.patch(`/api/characters/${c.id}/hp`,{delta:v}); await refreshChars(); addLog('gm.hp',`${c.name}: +${v}`); });
  $('#gm-hp-sub').addEventListener('click', async () => { const v=parseInt($('#gm-hp-custom').value)||0; await api.patch(`/api/characters/${c.id}/hp`,{delta:-v}); await refreshChars(); addLog('gm.hp',`${c.name}: -${v}`); });
  $('#gm-hp-set').addEventListener('click', async () => { const v=parseInt($('#gm-hp-custom').value)||0; await api.patch(`/api/characters/${c.id}/hp`,{set:v}); await refreshChars(); addLog('gm.hp',`${c.name}: set ${v}`); });

  // Spiritual HP delta buttons
  area.querySelectorAll('[data-spirit-delta]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const d = parseInt(btn.dataset.spiritDelta);
      const newVal = Math.max(0, Math.min((c.spiritual_max_hp || 0), (c.spiritual_hp || 0) + d));
      await api.patch(`/api/characters/${c.id}`, { spiritual_hp: newVal });
      await refreshChars();
      addLog('gm.spirit_hp', `${c.name}: ${d===999?'Full Spirit Heal':d>0?'+'+d:d} Spirit HP`);
    });
  });
  // Custom Spiritual HP
  $('#gm-spirit-add').addEventListener('click', async () => { const v=parseInt($('#gm-spirit-custom').value)||0; const newVal = Math.min((c.spiritual_max_hp||0), (c.spiritual_hp||0)+v); await api.patch(`/api/characters/${c.id}`, {spiritual_hp: newVal}); await refreshChars(); addLog('gm.spirit_hp',`${c.name}: +${v} Spirit`); });
  $('#gm-spirit-sub').addEventListener('click', async () => { const v=parseInt($('#gm-spirit-custom').value)||0; const newVal = Math.max(0, (c.spiritual_hp||0)-v); await api.patch(`/api/characters/${c.id}`, {spiritual_hp: newVal}); await refreshChars(); addLog('gm.spirit_hp',`${c.name}: -${v} Spirit`); });
  $('#gm-spirit-set').addEventListener('click', async () => { const v=parseInt($('#gm-spirit-custom').value)||0; await api.patch(`/api/characters/${c.id}`, {spiritual_hp: v}); await refreshChars(); addLog('gm.spirit_hp',`${c.name}: set ${v} Spirit`); });

  // Mana delta buttons
  area.querySelectorAll('[data-mana-delta]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const d = parseInt(btn.dataset.manaDelta);
      if (d > 0) await api.post(`/api/characters/${c.id}/restore-mana`, { amount: d });
      else await api.post(`/api/characters/${c.id}/spend-mana`, { cost: -d });
      await refreshChars();
      addLog('gm.mana', `${c.name}: ${d>0?'+'+d:d} Mana`);
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN)
        ws.ws.send(JSON.stringify({ type: 'mana.updated', character_id: c.id, mana_current: null, mana_max: c.mana_max }));
    });
  });
  area.querySelectorAll('[data-mana-full]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.post(`/api/characters/${c.id}/restore-mana`, { full: true });
      await refreshChars();
      addLog('gm.mana', `${c.name}: Full Mana`);
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN)
        ws.ws.send(JSON.stringify({ type: 'mana.updated', character_id: c.id, mana_current: null, mana_max: c.mana_max }));
    });
  });

  // Stat edits
  area.querySelectorAll('[data-gm-stat]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const f = inp.dataset.gmStat;
      const v = parseInt(inp.value) || 0;
      await api.put(`/api/characters/${c.id}`, { [f]: v });
      await refreshChars();
      addLog('gm.stat', `${c.name}: ${f}=${v}`);
    });
  });

  // Attribute point [+1] buttons (Fix 1)
  area.querySelectorAll('.gm-stat-plus').forEach(btn => {
    btn.addEventListener('click', async () => {
      const stat = btn.dataset.stat;
      try {
        const res = await api.post(`/api/characters/${c.id}/spend-attribute-point`, { stat });
        showToast(`${stat.slice(0,3).toUpperCase()} +1! Points left: ${res.attribute_points_available}`, 'accent');
        addLog('gm.stat', `${c.name}: ${stat} +1 (point spent)`);
        await refreshChars();
        renderCharDetail();
      } catch (e) {
        showToast('Failed to spend point', 'error');
      }
    });
  });

  // Effect toggles
  area.querySelectorAll('[data-eff-toggle]').forEach(cb => {
    cb.addEventListener('change', async () => {
      await api.put(`/api/effects/${cb.dataset.effToggle}`, { is_active: cb.checked });
      await refreshChars();
    });
  });

  // Delete NPC
  if (c.is_npc && area.querySelector('#btn-delete-char')) {
    area.querySelector('#btn-delete-char').addEventListener('click', async () => {
      if (!confirm(`Delete NPC "${c.name}"?`)) return;
      await api.del(`/api/characters/${c.id}`);
      selectedCharId = null;
      await refreshChars();
      renderCharDetail();
      addLog('gm.npc', `Deleted NPC: ${c.name}`);
    });
  }

  // Phase 7: NPC Tab switching
  if (c.is_npc) {
    area.querySelectorAll('.npc-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.npcTab;
        area.querySelectorAll('.npc-tab').forEach(t => t.classList.toggle('active', t === tab));
        area.querySelectorAll('.npc-tab-content').forEach(p => {
          p.style.display = p.dataset.npcPanel === target ? '' : 'none';
          p.classList.toggle('active', p.dataset.npcPanel === target);
        });
      });
    });

    // Kill/KO button
    const killBtn = area.querySelector('#btn-npc-kill');
    if (killBtn) {
      killBtn.addEventListener('click', async () => {
        if (!confirm(`Kill/KO ${c.name}?`)) return;
        await api.patch(`/api/characters/${c.id}/hp`, { set: 0 });
        await api.put(`/api/characters/${c.id}`, { is_alive: false });
        try {
          await api.post(`/api/characters/${c.id}/status-effects`, { name: 'Unconscious', icon: '💀', color: '#ef4444', effects: '[]', remaining_turns: -1 });
        } catch {}
        addLog('gm.npc', `${c.name}: KILLED/KO`);
        await refreshChars();
        if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
          ws.ws.send(JSON.stringify({ type: 'combat.character_downed', character_id: c.id, character_name: c.name }));
        }
      });
    }

    // Token color picker
    const colorPicker = area.querySelector('#npc-token-color');
    if (colorPicker) {
      colorPicker.addEventListener('change', async () => {
        await api.put(`/api/characters/${c.id}`, { token_color: colorPicker.value });
        addLog('gm.npc', `${c.name}: token color → ${colorPicker.value}`);
        if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
          ws.ws.send(JSON.stringify({ type: 'npc.token_color_changed', character_id: c.id, color: colorPicker.value }));
        }
      });
    }

    // GM Notes save
    const saveNotesBtn = area.querySelector('#btn-save-npc-notes');
    if (saveNotesBtn) {
      saveNotesBtn.addEventListener('click', async () => {
        const txt = area.querySelector('#npc-gm-notes').value;
        await api.put(`/api/characters/${c.id}`, { gm_notes: txt });
        showToast('Notes saved');
      });
    }
    const previewBtn = area.querySelector('#btn-preview-npc-notes');
    if (previewBtn) {
      previewBtn.addEventListener('click', () => {
        const preview = area.querySelector('#npc-notes-preview');
        const ta = area.querySelector('#npc-gm-notes');
        if (preview.style.display === 'none') {
          preview.style.display = '';
          preview.innerHTML = ta.value.replace(/\n/g, '<br>');
          previewBtn.textContent = 'Edit';
        } else {
          preview.style.display = 'none';
          previewBtn.textContent = 'Preview';
        }
      });
    }

    // NPC Attack section wiring
    const atkTarget = area.querySelector('#npc-atk-target');
    if (atkTarget) {
      // Populate targets (all session characters except this NPC)
      const sessionChars = characters.filter(ch => ch.id !== c.id && ch.is_alive);
      atkTarget.innerHTML = sessionChars.map(ch =>
        `<option value="${ch.id}">${ch.name}${ch.is_npc ? ' (NPC)' : ''} — KD:${ch.armor_class}</option>`
      ).join('');
      if (!sessionChars.length) atkTarget.innerHTML = '<option value="">No targets</option>';

      // Show weapon info; damage dice widget will mount after HIT (step 2)
      let weaponDefaults = { diceCount: c.attack_dice_count || 1, diceType: c.attack_dice_type || 6 };
      let hitAdvMode = 'normal';
      let dmgWidgetState = { diceCount: weaponDefaults.diceCount, diceType: weaponDefaults.diceType, advantageMode: 'normal' };
      let lastHitData = null; // stored after /hit-roll succeeds

      (async () => {
        try {
          const inv = await api.get(`/api/characters/${c.id}/inventory`);
          const mainHand = (inv.items||[]).find(i => i.is_equipped && i.equipped_slot === 'main_hand');
          const wInfo = area.querySelector('#npc-weapon-info');
          if (mainHand && wInfo) {
            wInfo.textContent = `🗡️ ${mainHand.name}`;
            const wst = mainHand.weapon_stats;
            if (wst) {
              weaponDefaults.diceCount = wst.dice_count || weaponDefaults.diceCount;
              weaponDefaults.diceType  = wst.dice_type  || weaponDefaults.diceType;
            }
          } else if (wInfo) {
            wInfo.textContent = `👊 Unarmed (${c.attack_dice_count||1}d${c.attack_dice_type||6})`;
          }
        } catch {}
      })();

      // Hit-mode adv toggle
      area.querySelectorAll('#npc-hit-adv button').forEach(b => {
        b.addEventListener('click', () => {
          area.querySelectorAll('#npc-hit-adv button').forEach(x => x.classList.toggle('active', x === b));
          hitAdvMode = b.dataset.mode;
        });
      });

      // Helper: mount damage dice widget in step 2
      const mountDmgWidget = () => {
        const host = area.querySelector('#npc-atk-widget-host');
        if (!host) return;
        host.innerHTML = '';
        if (typeof createDiceRollWidget === 'function') {
          createDiceRollWidget(host, {
            label: 'Damage Dice',
            defaultDiceCount: dmgWidgetState.diceCount,
            defaultDiceType:  dmgWidgetState.diceType,
            showDiceSelector: true,
            showAdvantage:    true,
            showRollButton:   false,
            onStateChange: (s) => { dmgWidgetState = s; },
          });
        } else {
          host.innerHTML = `
            <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
              <label style="font-size:0.72rem;color:var(--text-muted)">Dice:</label>
              <input type="number" id="npc-dmg-count" value="${dmgWidgetState.diceCount}" min="1" max="20" style="width:48px">
              <span>d</span>
              <select id="npc-dmg-type" style="width:60px">
                <option value="4">4</option><option value="6">6</option>
                <option value="8">8</option><option value="10">10</option>
                <option value="12">12</option><option value="20">20</option>
              </select>
              <div class="adv-toggle" id="npc-dmg-adv" style="margin-left:8px">
                <button data-mode="disadvantage">Disadv</button>
                <button data-mode="normal" class="active">Normal</button>
                <button data-mode="advantage">Adv</button>
              </div>
            </div>`;
          host.querySelector('#npc-dmg-type').value = dmgWidgetState.diceType;
          host.querySelector('#npc-dmg-count').addEventListener('input', e => {
            dmgWidgetState.diceCount = parseInt(e.target.value) || 1;
          });
          host.querySelector('#npc-dmg-type').addEventListener('change', e => {
            dmgWidgetState.diceType = parseInt(e.target.value) || 6;
          });
          host.querySelectorAll('#npc-dmg-adv button').forEach(b => {
            b.addEventListener('click', () => {
              host.querySelectorAll('#npc-dmg-adv button').forEach(x => x.classList.toggle('active', x === b));
              dmgWidgetState.advantageMode = b.dataset.mode;
            });
          });
        }
      };

      const resetAttackSteps = () => {
        area.querySelector('#npc-atk-step1').style.display = '';
        area.querySelector('#npc-atk-step2').style.display = 'none';
        const atkBtnEl = area.querySelector('#btn-npc-roll-attack');
        if (atkBtnEl) { atkBtnEl.disabled = false; atkBtnEl.textContent = '🎯 Roll Hit'; }
        lastHitData = null;
      };

      // STEP 1: Roll Hit button
      const atkBtn = area.querySelector('#btn-npc-roll-attack');
      if (atkBtn) {
        atkBtn.addEventListener('click', async () => {
          const targetId = parseInt(atkTarget.value);
          if (!targetId) { showToast('Select a target'); return; }
          const resultDiv = area.querySelector('#npc-atk-result');
          atkBtn.disabled = true;
          resultDiv.innerHTML = '<span style="color:var(--text-muted)">Rolling d20...</span>';
          try {
            const res = await api.post('/api/combat/hit-roll', {
              attacker_id: c.id, target_id: targetId,
              advantage: hitAdvMode,
            });
            lastHitData = { ...res, target_id: targetId };
            let html = '';
            if (res.hit) {
              html += `<div style="color:var(--accent-green);font-weight:700">${res.critical ? '🎯 CRITICAL HIT!' : '⚔️ HIT!'}</div>`;
            } else {
              html += `<div style="color:var(--text-muted);font-weight:700">${res.fumble ? '💨 FUMBLE!' : '🛡️ MISS'}</div>`;
            }
            html += `<div style="font-size:0.75rem">${res.hit_breakdown}</div>`;
            resultDiv.innerHTML = html;
            addLog('gm.combat', `${c.name} → ${res.target_name}: ${res.hit ? (res.critical ? 'CRIT' : 'HIT') : 'MISS'}`);

            // Broadcast hit result
            if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
              ws.ws.send(JSON.stringify({
                type: 'combat.hit_result',
                attacker_id: c.id, attacker_name: c.name,
                target_id: targetId, target_name: res.target_name,
                hit: res.hit, critical: res.critical, fumble: res.fumble,
                hit_breakdown: res.hit_breakdown,
              }));
            }

            if (res.hit) {
              if (res.pending_defense_id) {
                // Defense reaction: pause flow, show waiting indicator
                resultDiv.innerHTML += '<div style="margin-top:4px;color:var(--accent)">⏳ Waiting for target defense...</div>';
              } else {
                // Show step 2 — use server-suggested dice defaults (reflects equipped weapon)
                dmgWidgetState.diceCount = res.default_dice_count || weaponDefaults.diceCount;
                dmgWidgetState.diceType  = res.default_dice_type  || weaponDefaults.diceType;
                dmgWidgetState.advantageMode = 'normal';
                area.querySelector('#npc-atk-step1').style.display = 'none';
                area.querySelector('#npc-atk-step2').style.display = '';
                mountDmgWidget();
              }
            } else {
              atkBtn.disabled = false;
              atkBtn.textContent = '🎯 Re-roll Hit';
            }
          } catch (e) {
            atkBtn.disabled = false;
            resultDiv.innerHTML = `<span style="color:var(--accent-red)">${e?.body?.detail || 'Hit roll failed'}</span>`;
          }
        });
      }

      // STEP 2: Roll Damage button
      const dmgBtn = area.querySelector('#btn-npc-roll-damage');
      if (dmgBtn) {
        dmgBtn.addEventListener('click', async () => {
          if (!lastHitData || !lastHitData.hit) return;
          const targetId = lastHitData.target_id;
          const resultDiv = area.querySelector('#npc-atk-result');
          dmgBtn.disabled = true;
          try {
            const res = await api.post('/api/combat/damage-roll', {
              attacker_id: c.id, target_id: targetId,
              critical: !!lastHitData.critical,
              dice_count: dmgWidgetState.diceCount,
              dice_type:  dmgWidgetState.diceType,
              advantage:  dmgWidgetState.advantageMode || 'normal',
            });
            let html = '';
            if (lastHitData.critical) {
              html += `<div style="color:var(--accent-green);font-weight:700">🎯 CRITICAL HIT!</div>`;
            } else {
              html += `<div style="color:var(--accent-green);font-weight:700">⚔️ HIT!</div>`;
            }
            html += `<div style="font-size:0.75rem">${lastHitData.hit_breakdown}</div>`;
            html += `<div style="font-size:0.75rem;margin-top:3px">${res.damage_breakdown}</div>`;
            html += `<div style="font-size:0.75rem">${res.intake_breakdown}</div>`;
            html += `<div style="font-weight:600;margin-top:3px">${res.target_name}: <span style="color:var(--accent-red)">${res.final_damage} dmg</span> → ${res.target_hp_after} HP${res.target_downed ? ' 💀 DOWN!' : ''}</div>`;
            resultDiv.innerHTML = html;
            addLog('gm.combat', `${c.name} → ${res.target_name}: ${res.final_damage} dmg${res.target_downed ? ' (DOWN)' : ''}`);

            await refreshChars();
            if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
              ws.ws.send(JSON.stringify({
                type: 'combat.attack_result',
                attacker_id: c.id, attacker_name: c.name,
                target_id: targetId, target_name: res.target_name,
                hit: true, critical: !!lastHitData.critical,
                final_damage: res.final_damage, target_hp_after: res.target_hp_after,
              }));
            }
            // Reset back to step 1 for next attack
            setTimeout(resetAttackSteps, 2000);
          } catch (e) {
            dmgBtn.disabled = false;
            resultDiv.innerHTML += `<div style="color:var(--accent-red)">${e?.body?.detail || 'Damage roll failed'}</div>`;
          }
        });
      }

      // Cancel damage button — go back to step 1
      const cancelDmgBtn = area.querySelector('#btn-npc-cancel-dmg');
      if (cancelDmgBtn) cancelDmgBtn.addEventListener('click', resetAttackSteps);

      // ── NPC Actions wiring ──
      const actResEl = area.querySelector('#npc-action-result');
      const showActRes = (msg, color='var(--text-primary)') => {
        if (actResEl) actResEl.innerHTML = `<span style="color:${color}">${msg}</span>`;
      };

      // Ability
      const abBtn = area.querySelector('#btn-npc-act-ability');
      if (abBtn) abBtn.addEventListener('click', async () => {
        try {
          const abs = await api.get(`/api/characters/${c.id}/abilities`);
          const active = (abs || []).filter(a => a.ability_type !== 'passive');
          if (!active.length) { showActRes('No active abilities assigned.', 'var(--text-muted)'); return; }
          openNpcPickerModal('✨ Use Ability', active.map(a => ({
            id: a.character_ability_id,
            label: `${a.icon||'✨'} ${a.name}`,
            sub: (a.description || '') + (a.cooldown_remaining ? ` · ⏳ CD ${a.cooldown_remaining}` : ''),
            onPick: async () => {
              try {
                const res = await api.post(`/api/character-abilities/${a.character_ability_id}/use`, {});
                const msg = (res.results || []).join(' · ') || 'Ability used';
                showActRes(`✅ ${a.name}: ${msg}`, 'var(--accent-green)');
                addLog('gm.ability', `${c.name} used ${a.name}`);
                refreshChars();
              } catch(e) {
                let m='Ability failed'; try{const er=JSON.parse(e.message);m=er.detail?.message||er.detail||m;}catch{}
                showActRes('❌ ' + m, 'var(--accent-red)');
              }
            }
          })));
        } catch (e) { showActRes('❌ Failed to load abilities', 'var(--accent-red)'); }
      });

      // Potion
      const potBtn = area.querySelector('#btn-npc-act-potion');
      if (potBtn) potBtn.addEventListener('click', async () => {
        try {
          const inv = await api.get(`/api/characters/${c.id}/inventory`);
          const potions = (inv.items||[]).filter(i => i.is_potion);
          if (!potions.length) { showActRes('No potions in inventory.', 'var(--text-muted)'); return; }
          openNpcPickerModal('🧪 Use Potion', potions.map(p => ({
            id: p.inventory_id,
            label: `${p.potion_icon||'🧪'} ${p.name}`,
            sub: `x${p.quantity} · ${p.description||''}`,
            onPick: async () => {
              try {
                const res = await api.post(`/api/inventory/${p.inventory_id}/use`, {});
                const msg = res.breakdown || 'used';
                showActRes(`✅ ${p.name}: ${msg}`, 'var(--accent-green)');
                addLog('gm.potion', `${c.name} used ${p.name}`);
                refreshChars();
              } catch(e) {
                let m='Use failed'; try{const er=JSON.parse(e.message);m=er.detail?.message||er.detail||m;}catch{}
                showActRes('❌ ' + m, 'var(--accent-red)');
              }
            }
          })));
        } catch(e) { showActRes('❌ Failed to load potions', 'var(--accent-red)'); }
      });

      // Use Item (any consumable)
      const itBtn = area.querySelector('#btn-npc-act-item');
      if (itBtn) itBtn.addEventListener('click', async () => {
        try {
          const inv = await api.get(`/api/characters/${c.id}/inventory`);
          const usable = (inv.items||[]).filter(i => i.consumable || i.is_potion);
          if (!usable.length) { showActRes('No usable items in inventory.', 'var(--text-muted)'); return; }
          openNpcPickerModal('🎒 Use Item', usable.map(it => ({
            id: it.inventory_id,
            label: `${it.is_potion ? (it.potion_icon||'🧪') : '📦'} ${it.name}`,
            sub: `x${it.quantity} · ${it.description||''}`,
            onPick: async () => {
              try {
                const res = await api.post(`/api/inventory/${it.inventory_id}/use`, {});
                const msg = res.breakdown || 'used';
                showActRes(`✅ ${it.name}: ${msg}`, 'var(--accent-green)');
                addLog('gm.item', `${c.name} used ${it.name}`);
                refreshChars();
              } catch(e) {
                let m='Use failed'; try{const er=JSON.parse(e.message);m=er.detail?.message||er.detail||m;}catch{}
                showActRes('❌ ' + m, 'var(--accent-red)');
              }
            }
          })));
        } catch(e) { showActRes('❌ Failed to load inventory', 'var(--accent-red)'); }
      });

      // Quick Heal (full)
      const healBtn = area.querySelector('#btn-npc-act-heal');
      if (healBtn) healBtn.addEventListener('click', async () => {
        try {
          await api.put(`/api/characters/${c.id}`, { current_hp: c.max_hp, is_alive: true });
          showActRes(`✅ ${c.name} fully healed (${c.max_hp} HP)`, 'var(--accent-green)');
          addLog('gm.heal', `${c.name} fully healed by GM`);
          // Broadcast HP change so player UIs update
          if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
            ws.ws.send(JSON.stringify({
              type: 'character.hp_changed',
              character_id: c.id,
              current_hp: c.max_hp,
              max_hp: c.max_hp,
            }));
          }
          refreshChars();
        } catch(e) { showActRes('❌ Heal failed', 'var(--accent-red)'); }
      });
    }

    // Turn counter wiring
    const turnCountEl = area.querySelector('#npc-turn-count');
    const turnInc = area.querySelector('#btn-npc-turn-inc');
    const turnDec = area.querySelector('#btn-npc-turn-dec');
    const turnReset = area.querySelector('#btn-npc-turn-reset');
    if (turnInc) {
      const updateTurn = async (val) => {
        await api.put(`/api/characters/${c.id}`, { turn_count: Math.max(0, val) });
        if (turnCountEl) turnCountEl.textContent = Math.max(0, val);
        c.turn_count = Math.max(0, val);
      };
      turnInc.addEventListener('click', () => updateTurn((c.turn_count||0) + 1));
      turnDec.addEventListener('click', () => updateTurn((c.turn_count||0) - 1));
      turnReset.addEventListener('click', () => updateTurn(0));
    }

    // Broadcast rolls toggle wiring
    const broadcastChk = area.querySelector('#npc-broadcast-rolls');
    if (broadcastChk) {
      // Store on element for roll handler to read
      broadcastChk.__npcBroadcast = true;
    }
  }

  // Phase 6 / FIX 1: Place at Table / Show HP toggles — use dedicated endpoint
  // (server broadcasts `table.updated` to all session clients)
  const placeChk = area.querySelector('#npc-place-table');
  if (placeChk) {
    placeChk.addEventListener('change', async () => {
      try {
        await api.patch(`/api/characters/${c.id}/table-visibility`,
                        { is_at_table: placeChk.checked });
        addLog('gm.npc', `${c.name}: Place at Table = ${placeChk.checked}`);
      } catch (e) { showToast('Failed to update table visibility'); }
    });
  }
const showHpChk = area.querySelector('#npc-show-hp');
if (showHpChk) {
    showHpChk.addEventListener('change', async () => {
      try {
        await api.patch(`/api/characters/${c.id}/table-visibility`, { show_hp_to_players: showHpChk.checked });
        addLog('gm.npc', `${c.name}: Show HP = ${showHpChk.checked}`);
      } catch (e) { showToast('Failed to update HP visibility'); }
    });
  }

  // Player character: Place at Table / Show HP toggles
  const playerPlaceChk = area.querySelector('#player-place-table');
  if (playerPlaceChk) {
    playerPlaceChk.addEventListener('change', async () => {
      try {
        await api.patch(`/api/characters/${c.id}/table-visibility`, { place_at_table: playerPlaceChk.checked });
        c.place_at_table = playerPlaceChk.checked;
        if (playerPlaceChk.checked) {
          const tokenOnMap = mapCanvas?.tokens?.find(t => t.character_id === c.id);
          const hasCoords = tokenOnMap && tokenOnMap.x != null && tokenOnMap.y != null;
          if (!hasCoords) {
            try {
              await api.patch(`/api/map/token/${c.id}`, { x: 0.5, y: 0.5 });
              if (mapCanvas) mapCanvas.setTokens(mapCanvas.tokens.map(t => t.character_id === c.id ? { ...t, x: 0.5, y: 0.5 } : t));
            } catch (mapErr) { console.warn('Auto-place token failed', mapErr); }
          }
        }
        renderPartyList();
        showToast(`${c.name}: ${playerPlaceChk.checked ? 'placed on map' : 'removed from map'}`);
      } catch (e) { showToast('Failed to update table visibility'); }
    });
  }
  const playerShowHpChk = area.querySelector('#player-show-hp');
  if (playerShowHpChk) {
    playerShowHpChk.addEventListener('change', async () => {
      try {
        await api.patch(`/api/characters/${c.id}/table-visibility`, { show_hp_to_players: playerShowHpChk.checked });
        c.show_hp_to_players = playerShowHpChk.checked;
        renderPartyList();
        showToast(`${c.name}: HP ${playerShowHpChk.checked ? 'visible' : 'hidden'}`);
      } catch (e) { showToast('Failed to update HP visibility'); }
    });
  }

  // Phase 7: Ability assign + enhanced list
  const abList = area.querySelector('#npc-abilities-list');
  if (abList) {
    try {
      const cas = await api.get(`/api/characters/${c.id}/abilities`);
      if (cas.length) {
        abList.innerHTML = cas.map(a => {
          const onCd = a.cooldown_remaining > 0;
          const typeBadge = a.ability_type === 'passive' ? '<span style="font-size:0.6rem;background:#3b82f620;color:#60a5fa;padding:1px 5px;border-radius:8px">passive</span>' :
            a.ability_type === 'reaction' ? '<span style="font-size:0.6rem;background:#f59e0b20;color:#f59e0b;padding:1px 5px;border-radius:8px">reaction</span>' : '';
          const costParts = [];
          if (a.mana_cost) costParts.push(`🔮${a.mana_cost}`);
          if (a.hp_cost) costParts.push(`❤️${a.hp_cost}`);
          const rankBadge = `<span style="font-size:0.6rem;text-transform:capitalize;background:var(--bg-surface-3);padding:1px 4px;border-radius:4px">${a.ability_rank||'common'}</span>`;
          const lvlBadge = `<span style="font-size:0.6rem;background:var(--bg-surface-3);padding:1px 4px;border-radius:4px">Lv.${a.ability_level||0}</span>`;
          return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:5px;padding:4px 8px;border-left:3px solid ${a.color||'#60a5fa'};background:var(--bg-surface-2);border-radius:var(--r-sm);${onCd?'opacity:0.5':''}">
            <span style="font-weight:600;font-size:0.78rem">${a.icon||'⚡'} ${a.name}</span>
            ${typeBadge}
            ${rankBadge}
            ${lvlBadge}
            ${costParts.length ? `<span style="font-size:0.65rem;color:var(--text-muted)">${costParts.join(' ')}</span>` : ''}
            ${onCd ? `<span style="color:var(--accent-orange);font-size:0.65rem">⏳${a.cooldown_remaining}t</span>` : ''}
            ${a.cooldown_turns && !onCd ? `<span style="font-size:0.6rem;color:var(--text-muted)">CD:${a.cooldown_turns}t</span>` : ''}
            <span style="margin-left:auto;display:flex;gap:3px">
              ${a.ability_type !== 'passive' && !onCd ? `<button class="btn btn-primary btn-xs" data-use-ca="${a.character_ability_id}" data-use-name="${a.name}" style="font-size:0.6rem;padding:1px 6px">Use</button>` : ''}
              <button class="btn btn-ghost btn-xs" data-promote-ca="${a.character_ability_id}" title="Promote rank" style="font-size:0.6rem;padding:1px 4px">⭐</button>
              <button class="btn btn-ghost btn-xs" data-rm-ca="${a.character_ability_id}" style="color:var(--accent-red);font-size:0.65rem">✕</button>
            </span>
          </div>`;
        }).join('');
        abList.querySelectorAll('[data-rm-ca]').forEach(btn => {
          btn.addEventListener('click', async () => {
            await api.del(`/api/character-abilities/${btn.dataset.rmCa}`);
            renderCharDetail();
          });
        });
        abList.querySelectorAll('[data-promote-ca]').forEach(btn => {
          btn.addEventListener('click', async () => {
            try {
              const res = await api.post(`/api/characters/${c.id}/abilities/${btn.dataset.promoteCa}/promote-rank`);
              showToast(`${res.ability_name} promoted to ${res.ability_rank}!`);
              renderCharDetail();
            } catch (e) { showToast('Promotion failed'); }
          });
        });
        abList.querySelectorAll('[data-use-ca]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const caId = btn.dataset.useCa;
            const abName = btn.dataset.useName;
            try {
              const res = await api.post(`/api/character-abilities/${caId}/use`, {});
              if (res.results) res.results.forEach(r => addLog('gm.ability', `${c.name} → ${abName}: ${r}`));
              await refreshChars();
              renderCharDetail();
            } catch (e) {
              const d = e?.body?.detail;
              showToast(typeof d === 'object' ? d.message : String(d || 'Failed'), 'error');
            }
          });
        });
      } else {
        abList.innerHTML = '<span class="text-muted">No abilities assigned</span>';
      }
    } catch { abList.innerHTML = '<span class="text-muted">—</span>'; }
  }
  const assignBtn = area.querySelector('#btn-assign-ability');
  if (assignBtn) {
    assignBtn.addEventListener('click', async () => {
      try {
        const all = await api.get(`/api/abilities?session_id=${SESSION_ID}`);
        if (!all.length) { showToast('No abilities created yet. Create one in GM Tools.'); return; }
        const names = all.map((a, i) => `${i+1}. ${a.name} (🔮${a.mana_cost})`).join('\n');
        const pick = prompt(`Assign ability:\n${names}\nEnter number:`);
        if (!pick) return;
        const ab = all[parseInt(pick) - 1];
        if (!ab) return;
        await api.post(`/api/characters/${c.id}/abilities`, { ability_id: ab.id });
        renderCharDetail();
        addLog('gm.ability', `Assigned ${ab.name} to ${c.name}`);
      } catch (e) { showToast(e?.body?.detail || 'Failed'); }
    });
  }

  // Characteristic Roll
  bindAdvToggle(area, 'gm_char_roll');
  $('#btn-gm-roll-char').addEventListener('click', async () => {
    const stat = $('#gm-roll-stat').value;
    const rollType = $('#gm-roll-type').value;
    try {
      const res = await api.post(`/api/characters/${c.id}/roll-characteristic`, {
        stat, roll_type: rollType, advantage_mode: getAdvMode('gm_char_roll'),
      });
      let advTag = '';
      if (res.advantage_mode === 'advantage') advTag = ' <span class="adv-badge advantage">ADV</span>';
      else if (res.advantage_mode === 'disadvantage') advTag = ' <span class="adv-badge disadvantage">DISADV</span>';
      $('#gm-roll-result').innerHTML = `<span style="color:var(--accent)">${res.description}</span>${advTag}`;
      addLog('gm.roll', res.description);
      addRollLogEntry(res);
      lastGmRollTime = Date.now();
      // Broadcast via WS (respect NPC broadcast toggle)
      const shouldBroadcast = c.is_npc ? (area.querySelector('#npc-broadcast-rolls')?.checked || false) : true;
      if (shouldBroadcast && ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({ type: 'roll.characteristic', ...res }));
      }
    } catch (e) {
      $('#gm-roll-result').textContent = 'Roll failed';
    }
  });

  // Apply damage
  $('#btn-gm-apply-dmg').addEventListener('click', async () => {
    const er = parseInt($('#gm-di-enemy').value)||0;
    const dmg = parseInt($('#gm-di-dmg').value)||0;
    if (!er || !dmg) return;
    const res = await api.post('/api/calc/damage-intake', { character_id: c.id, enemy_roll: er, damage_rolled: dmg });
    if (res.final_damage > 0) {
      await api.patch(`/api/characters/${c.id}/hp`, { delta: -res.final_damage });
      await refreshChars();
    }
    const text = res.hit_diff <= 0
      ? `<span style="color:var(--text-muted);font-weight:700">MISS</span> (diff: ${res.hit_diff})`
      : `${res.tier_label} → <strong style="color:var(--accent-red)">${res.final_damage} damage</strong> applied`;
    $('#gm-dmg-result').innerHTML = text + (res.breakdown ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px">${res.breakdown}</div>` : '');
    addLog('gm.damage', `${c.name}: ${res.breakdown || `${er} vs KD${c.armor_class} → ${res.final_damage} dmg`}`);
  });

  // ── Detail Timer wiring (player only) ──
  if (!c.is_npc) {
    const startBtn = area.querySelector('#btn-gm-detail-timer-start');
    const pauseBtn = area.querySelector('#btn-gm-detail-timer-pause');
    const resumeBtn = area.querySelector('#btn-gm-detail-timer-resume');
    const stopBtn = area.querySelector('#btn-gm-detail-timer-stop');
    const timerDisplay = area.querySelector('#gm-detail-timer-display');
    const timerInput = area.querySelector('#gm-detail-timer-min');

    startBtn.addEventListener('click', () => {
      const mins = parseFloat(timerInput.value) || 2;
      const secs = Math.round(mins * 60);
      startDetailTimer(c.id, secs);
      sendPlayerTimer(c.id, secs);
    });
    pauseBtn.addEventListener('click', () => pauseDetailTimer());
    resumeBtn.addEventListener('click', () => resumeDetailTimer());
    stopBtn.addEventListener('click', () => {
      stopDetailTimer();
      sendPlayerTimerStop(c.id);
    });
    restoreDetailTimer();

    // Load race/class names
    if (c.race_id) {
      api.get(`/api/races-classes/races/${c.race_id}`).then(r => {
        const el = area.querySelector('#gm-char-race');
        if (el) el.innerHTML = `Race: <strong>${r.name}</strong>`;
      }).catch(() => {});
    }
    // Rework v2: Character.class_id is gone; professions panel handles this.

    // XP/Level edit
    const xpBtn = area.querySelector('#btn-edit-xp');
    if (xpBtn) {
      xpBtn.addEventListener('click', async () => {
        const newXp = prompt('Set experience:', c.experience || 0);
        if (newXp === null) return;
        const newLvl = prompt('Set level:', c.level ?? 0);
        if (newLvl === null) return;
        await api.patch(`/api/characters/${c.id}`, { experience: parseInt(newXp)||0, level: parseInt(newLvl)||0 });
        await refreshChars();
        renderCharDetail();
      });
    }

    // Rework Phase 8: Grant XP
    const grantBtn = area.querySelector('#btn-grant-xp');
    if (grantBtn) {
      grantBtn.addEventListener('click', async () => {
        const amt = prompt('Grant how much XP?', '50');
        if (amt === null) return;
        try {
          const res = await api.post(`/api/characters/${c.id}/grant-xp`, { amount: parseInt(amt, 10) || 0 });
          addLog('gm.xp', `${c.name}: +${amt} XP → ${res.experience}/${res.xp_to_next}`);
          await refreshChars();
          renderCharDetail();
        } catch (e) { showToast('Failed to grant XP'); }
      });
    }
    // Fix 1: Level up with choice (attributes vs rank)
    const lvlUpBtn = area.querySelector('#btn-level-up');
    if (lvlUpBtn) {
      lvlUpBtn.addEventListener('click', () => openGmLevelUpModal(c));
    }
    // Remove old rank-up button handler (now integrated into level-up modal)
    const rankBtn = area.querySelector('#btn-rank-up');
    if (rankBtn) {
      rankBtn.style.display = 'none';  // Hide old button
    }
  }

  // ── Status Effects wiring ──
  loadStatusBadges(c.id);
  $('#btn-gm-add-status').addEventListener('click', () => openAddStatusModal(c.id, c.name));
  $('#btn-gm-status-library').addEventListener('click', () => openStatusLibraryModal());

  // ── Force Advantage toggle wiring ──
  (async () => {
    // Detect current forced adv/disadv from status penalties
    try {
      const pen = await api.get(`/api/characters/${c.id}/status-penalties`);
      let curMode = 'normal';
      if (pen.forced_advantage) curMode = 'advantage';
      else if (pen.forced_disadvantage) curMode = 'disadvantage';
      const btns = area.querySelectorAll('#gm-force-adv-toggle button');
      btns.forEach(b => b.classList.toggle('active', b.dataset.mode === curMode));
    } catch {}
  })();
  area.querySelectorAll('#gm-force-adv-toggle button').forEach(b => {
    b.addEventListener('click', async () => {
      const mode = b.dataset.mode;
      try {
        await api.post(`/api/characters/${c.id}/set-advantage`, { mode });
        area.querySelectorAll('#gm-force-adv-toggle button').forEach(x => x.classList.toggle('active', x === b));
        loadStatusBadges(c.id);
        addLog('gm.status', `Set ${c.name} → ${mode === 'normal' ? 'Normal' : mode.toUpperCase()}`);
        if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
          ws.ws.send(JSON.stringify({ type: 'status_effect.applied', character_id: c.id, name: `Forced ${mode}` }));
        }
      } catch (e) {
        showToast('Failed: ' + e.message);
      }
    });
  });

  // ── Currency wiring ──
  // Load and display currency
  (async () => {
    try {
      const cur = await api.get(`/api/characters/${c.id}/currency`);
      const d = cur.currency;
      const parts = [];
      if (d.platinum) parts.push(`<span style="color:#e0c97f">${d.platinum}P</span>`);
      if (d.gold) parts.push(`<span style="color:#fbbf24">${d.gold}G</span>`);
      if (d.silver) parts.push(`<span style="color:#94a3b8">${d.silver}S</span>`);
      parts.push(`<span style="color:#b87333">${d.bronze}B</span>`);
      $('#gm-currency-display').innerHTML = parts.join(' ') + ` <span style="font-size:0.7rem;color:var(--text-muted)">(${cur.total_bronze}b)</span>`;
    } catch {}
  })();

  // Give currency
  $('#btn-gm-give-currency').addEventListener('click', async () => {
    const p = parseInt($('#gm-give-plat').value) || 0;
    const g = parseInt($('#gm-give-gold').value) || 0;
    const s = parseInt($('#gm-give-silver').value) || 0;
    const co = parseInt($('#gm-give-bronze').value) || 0;
    if (!p && !g && !s && !co) return;
    await api.post(`/api/characters/${c.id}/give-gold`, { platinum: p, gold: g, silver: s, bronze: co });
    await refreshChars();
    addLog('gm.gold', `Gave ${c.name}: ${p}P ${g}G ${s}S ${co}B`);
  });

  // Take currency (negative give)
  $('#btn-gm-take-currency').addEventListener('click', async () => {
    const p = parseInt($('#gm-give-plat').value) || 0;
    const g = parseInt($('#gm-give-gold').value) || 0;
    const s = parseInt($('#gm-give-silver').value) || 0;
    const co = parseInt($('#gm-give-bronze').value) || 0;
    if (!p && !g && !s && !co) return;
    await api.post(`/api/characters/${c.id}/give-gold`, { platinum: -p, gold: -g, silver: -s, bronze: -co, note: 'GM deduction' });
    await refreshChars();
    addLog('gm.gold', `Took from ${c.name}: ${p}P ${g}G ${s}S ${co}B`);
  });

  // Set total bronze
  $('#btn-gm-set-gold').addEventListener('click', async () => {
    const v = parseInt($('#gm-wealth-bronze').value) || 0;
    await api.put(`/api/characters/${c.id}`, { wealth_bronze: v });
    await refreshChars();
    addLog('gm.gold', `${c.name}: wealth_bronze = ${v}`);
  });

  // Transaction history
  $('#btn-gm-tx-history').addEventListener('click', () => openTxHistoryModal(c.id, c.name));

  // ── Inventory wiring ──
  // Can edit toggle
  $('#gm-can-edit-items').addEventListener('change', async () => {
    await api.put(`/api/characters/${c.id}`, { can_edit_own_items: $('#gm-can-edit-items').checked });
    addLog('gm.perm', `${c.name}: can_edit_own_items = ${$('#gm-can-edit-items').checked}`);
  });

  // Give item
  $('#btn-gm-give-item').addEventListener('click', () => {
    openGmGiveItemModal(c.id);
  });

  // ── Merchant wiring (NPC only) ──
  if (c.is_npc) {
    const merchantBtn = area.querySelector('#btn-gm-merchant-settings');
    const tradeBtn = area.querySelector('#btn-gm-initiate-trade');
    if (merchantBtn) merchantBtn.addEventListener('click', () => openMerchantSettingsModal(c.id, c.name));
    if (tradeBtn) tradeBtn.addEventListener('click', () => openInitiateTradeModal(c.id, c.name));
    loadMerchantPreview(c.id);
  }

  // Load inventory
  loadGmCharInventory(c.id);

  // Load notes (Stage 10)
  loadCharNotes(c.id);
}

// ── GM Character Inventory Loading ──────────────────────────
async function loadGmCharInventory(charId) {
  const container = $('#gm-char-inventory');
  if (!container) return;
  try {
    const data = await api.get(`/api/characters/${charId}/inventory`);
    if (!data.items || !data.items.length) {
      container.innerHTML = '<span class="text-muted">No items in inventory.</span>';
      return;
    }
    // Rework Phase 3: split items into Bag (non-equipped) and Equipped sections.
    const renderRow = (i) => {
      const eq = i.is_equipped ? '✅' : '';
      const slotLbl = i.equipped_slot ? ` [${i.equipped_slot}]` : '';
      const bonusesStr = (i.bonuses||[]).map(b => b.bonus_type === 'stat_bonus' ? `${b.stat_name}+${b.value}` : `${b.bonus_type.replace(/_/g,' ')}+${b.value}`).join(', ');
      const isPotion = i.is_potion;
      const isConsumable = i.consumable;
      const showEquip = i.equippable && !isPotion;
      const showUse = isConsumable || isPotion;
      const icon = isPotion ? (i.potion_icon || '🧪') : '';
      const isWeapon = !!i.weapon_stats;
      return `<div class="mod-row" style="gap:6px">
        <span style="min-width:18px">${eq}${icon}</span>
        <span class="rarity-${i.rarity}" style="flex:1;font-weight:600">${i.name}</span>
        <span style="font-size:0.7rem;color:var(--text-muted)">x${i.quantity}${slotLbl}</span>
        ${bonusesStr ? `<span style="font-size:0.65rem;color:var(--accent-green)">${bonusesStr}</span>` : ''}
        ${showEquip ? `<button class="btn btn-ghost btn-xs" data-gm-equip="${i.inventory_id}" data-gm-equipped="${i.is_equipped}">${i.is_equipped ? 'Unequip' : 'Equip'}</button>` : ''}
        ${showUse ? `<button class="btn btn-primary btn-xs" data-gm-use="${i.inventory_id}" data-gm-use-name="${i.name}" title="Use on this character">${isPotion ? '🧪 Use' : 'Use'}</button>` : ''}
        ${isWeapon ? `<button class="btn btn-ghost btn-xs" data-gm-poison="${i.inventory_id}" title="Apply poison">💧</button>` : ''}
        <button class="btn btn-ghost btn-xs" data-gm-buyback="${i.inventory_id}" data-gm-buyback-price="${i.base_price_bronze||i.base_price_copper||0}" data-gm-buyback-name="${i.name}" title="Buy from player">💰</button>
        <button class="btn-icon danger" data-gm-remove-inv="${i.inventory_id}" title="Remove">🗑</button>
      </div>`;
    };
    const equipped = data.items.filter(i => i.is_equipped);
    const bag = data.items.filter(i => !i.is_equipped);
    const section = (title, count, rows, weight) => `
      <div class="inv-section" style="margin-bottom:8px">
        <div style="font-size:0.75rem;font-weight:600;color:var(--text-muted);margin-bottom:4px;display:flex;gap:8px;align-items:center">
          <span>${title} <span class="chip-muted">${count}</span></span>
          ${weight != null ? `<span style="margin-left:auto;font-weight:400">wt ${weight}</span>` : ''}
        </div>
        ${rows.length ? rows.join('') : '<span class="text-muted" style="font-size:0.75rem">— empty —</span>'}
      </div>`;
    container.innerHTML =
      section('⚔️ Equipped', equipped.length, equipped.map(renderRow), null) +
      section('🎒 Bag',      bag.length,      bag.map(renderRow),      data.total_weight_bag ?? data.total_weight);

    // Equip/unequip
    container.querySelectorAll('[data-gm-equip]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const invId = btn.dataset.gmEquip;
        const isEq = btn.dataset.gmEquipped === 'true';
        if (isEq) {
          await api.patch(`/api/inventory/${invId}/equip`, { equip: false });
        } else {
          await api.patch(`/api/inventory/${invId}/equip`, { equip: true, slot: 'main_hand' });
        }
        loadGmCharInventory(charId);
      });
    });

    // Remove
    container.querySelectorAll('[data-gm-remove-inv]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.del(`/api/inventory/${btn.dataset.gmRemoveInv}`);
        loadGmCharInventory(charId);
      });
    });
    // Use consumable/potion (GM applies effect to the character)
    container.querySelectorAll('[data-gm-use]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const invId = btn.dataset.gmUse;
        const itemName = btn.dataset.gmUseName;
        if (!confirm(`Use "${itemName}" on this character?`)) return;
        try {
          const res = await api.post(`/api/inventory/${invId}/use`, {});
          const breakdown = res.breakdown || res.results?.join('; ') || 'applied';
          addLog('inventory.use', `${itemName} used → ${breakdown}`);
          showToast(`✅ ${itemName} used: ${breakdown}`);
          loadGmCharInventory(charId);
          // Refresh char detail to show new HP/mana
          if (selectedCharId === charId) renderCharDetail();
        } catch (e) {
          let msg = 'Use failed';
          try { const err = JSON.parse(e.message); msg = err.detail?.message || err.detail || msg; } catch {}
          showToast('❌ ' + msg);
        }
      });
    });
    // Buyback
    container.querySelectorAll('[data-gm-buyback]').forEach(btn => {
      btn.addEventListener('click', () => {
        const invId = parseInt(btn.dataset.gmBuyback);
        const basePrice = parseInt(btn.dataset.gmBuybackPrice) || 0;
        const itemName = btn.dataset.gmBuybackName;
        openGmBuybackModal(invId, itemName, basePrice, charId);
      });
    });
    // Rework Phase 5: Apply poison (GM)
    container.querySelectorAll('[data-gm-poison]').forEach(btn => {
      btn.addEventListener('click', () => openGmApplyPoisonModal(btn.dataset.gmPoison, charId));
    });
  } catch(e) { container.innerHTML = '<span class="text-muted">Error loading inventory.</span>'; }
}

// Rework Phase 5: GM-side poison application (mirrors player flow).
async function openGmApplyPoisonModal(inventoryId, charId) {
  let poisons = [];
  try { poisons = await api.get('/api/poison-templates'); } catch {}
  if (!poisons.length) {
    if (!confirm('No poisons yet. Create a sample poison now?')) return;
    try {
      await api.post('/api/poison-templates', {
        name: 'Basic Poison', damage_dice_count: 1, damage_dice_type: 4,
        damage_type: 'poison', default_charges: 3, default_turns_per_hit: 3,
      });
      poisons = await api.get('/api/poison-templates');
    } catch { showToast('Failed to create default poison'); return; }
  }
  let current = null;
  try { current = await api.get(`/api/inventory/${inventoryId}/applied-poison`); } catch {}

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:420px">
      <h3 style="margin-top:0">💧 Apply Poison</h3>
      ${current ? `<div style="margin-bottom:10px;font-size:0.8rem;color:var(--accent-green)">
        Current: ${current.template?.icon||''} ${current.template?.name||''} —
        ${current.charges_remaining} charges · ${current.turns_per_hit} turn(s)/hit
        <button class="btn btn-ghost btn-xs" id="gm-poison-remove" style="margin-left:6px">Remove</button>
      </div>` : ''}
      <label style="font-size:0.78rem">Poison</label>
      <select id="gm-poison-tpl" style="width:100%;margin-bottom:8px">
        ${poisons.map(p => `<option value="${p.id}">${p.icon} ${p.name} — ${p.damage_dice_count}d${p.damage_dice_type} ${p.damage_type}</option>`).join('')}
      </select>
      <div style="display:flex;gap:8px">
        <div style="flex:1">
          <label style="font-size:0.75rem">Charges</label>
          <input type="number" id="gm-poison-charges" min="1" max="50" value="${poisons[0].default_charges}" style="width:100%">
        </div>
        <div style="flex:1">
          <label style="font-size:0.75rem">Turns/hit</label>
          <input type="number" id="gm-poison-turns" min="1" max="20" value="${poisons[0].default_turns_per_hit}" style="width:100%">
        </div>
      </div>
      <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" id="gm-poison-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="gm-poison-apply">Apply</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const sel = overlay.querySelector('#gm-poison-tpl');
  sel.addEventListener('change', () => {
    const p = poisons.find(x => x.id === parseInt(sel.value, 10));
    if (p) {
      overlay.querySelector('#gm-poison-charges').value = p.default_charges;
      overlay.querySelector('#gm-poison-turns').value = p.default_turns_per_hit;
    }
  });
  overlay.querySelector('#gm-poison-cancel').addEventListener('click', () => overlay.remove());
  const rm = overlay.querySelector('#gm-poison-remove');
  if (rm) rm.addEventListener('click', async () => {
    try { await api.del(`/api/inventory/${inventoryId}/apply-poison`); overlay.remove(); loadGmCharInventory(charId); addLog('gm.poison','Poison removed'); }
    catch { showToast('Failed to remove poison'); }
  });
  overlay.querySelector('#gm-poison-apply').addEventListener('click', async () => {
    const poison_template_id = parseInt(sel.value, 10);
    const charges = parseInt(overlay.querySelector('#gm-poison-charges').value, 10);
    const turns_per_hit = parseInt(overlay.querySelector('#gm-poison-turns').value, 10);
    try {
      await api.post(`/api/inventory/${inventoryId}/apply-poison`, { poison_template_id, charges, turns_per_hit });
      addLog('gm.poison', `Coated weapon with poison (${charges}x charges, ${turns_per_hit} turns/hit)`);
      overlay.remove();
      loadGmCharInventory(charId);
    } catch (e) { showToast(e?.message || 'Failed to apply poison'); }
  });
}

// ══════════════════════════════════════════════════════════════
// Rework Phase 4: GM Professions management
// ══════════════════════════════════════════════════════════════
async function loadGmCharProfessions(charId) {
  const container = document.querySelector('#gm-char-professions');
  if (!container) return;
  try {
    const list = await api.get(`/api/characters/${charId}/professions`);
    if (!list || !list.length) {
      container.innerHTML = '<span class="text-muted" style="font-size:0.78rem">No professions assigned.</span>';
      return;
    }
    container.innerHTML = list.map(p => {
      const bonuses = (p.bonuses||[]).map(b => {
        if (b.type === 'stat_bonus') return `${(b.stat||'').slice(0,3).toUpperCase()}+${b.value}`;
        return `${(b.type||'').replace(/_/g,' ')}+${b.value||0}`;
      }).join(' · ');
      return `<div class="mod-row" style="gap:6px;align-items:center">
        <span style="flex:1;font-weight:600">${p.name || 'Profession'}</span>
        <span style="font-size:0.7rem;color:var(--text-muted)">L ${p.level}/5</span>
        ${bonuses ? `<span style="font-size:0.65rem;color:var(--accent-green)">${bonuses}</span>` : ''}
        <input type="number" min="1" max="5" value="${p.level}" data-prof-level="${p.id}" style="width:48px;font-size:0.75rem">
        <button class="btn btn-ghost btn-xs" data-prof-save="${p.id}">Save</button>
        <button class="btn-icon danger" data-prof-delete="${p.id}" title="Remove">🗑</button>
      </div>`;
    }).join('');

    container.querySelectorAll('[data-prof-save]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cpId = btn.dataset.profSave;
        const lvlInput = container.querySelector(`[data-prof-level="${cpId}"]`);
        const level = Math.max(1, Math.min(5, parseInt(lvlInput?.value || '1', 10) || 1));
        try {
          await api.patch(`/api/characters/${charId}/professions/${cpId}`, { level });
          addLog('gm.prof', `Set profession level → ${level}`);
          loadGmCharProfessions(charId);
        } catch (e) { showToast('Failed to update profession'); }
      });
    });
    container.querySelectorAll('[data-prof-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cpId = btn.dataset.profDelete;
        if (!confirm('Remove this profession?')) return;
        try {
          await api.del(`/api/characters/${charId}/professions/${cpId}`);
          addLog('gm.prof', `Removed profession`);
          loadGmCharProfessions(charId);
        } catch (e) { showToast('Failed to remove profession'); }
      });
    });
  } catch (e) {
    container.innerHTML = '<span class="text-muted" style="font-size:0.78rem">Error loading professions.</span>';
  }
}

async function openGmAddProfessionModal(charId) {
  let classes = [];
  try { classes = await api.get('/api/races-classes/classes'); } catch { classes = []; }
  if (!classes.length) { showToast('No classes defined. Seed them first.'); return; }

  // Filter out classes the char already has
  let assigned = [];
  try { assigned = await api.get(`/api/characters/${charId}/professions`); } catch {}
  const taken = new Set((assigned||[]).map(p => p.class_id));
  const available = classes.filter(c => !taken.has(c.id));
  if (!available.length) { showToast('All available professions already assigned.'); return; }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:360px">
      <h3 style="margin-top:0">🛡️ Add Profession</h3>
      <label style="font-size:0.78rem">Class</label>
      <select id="gm-prof-new-class" style="width:100%;margin-bottom:8px">
        ${available.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
      </select>
      <label style="font-size:0.78rem">Starting Level</label>
      <input type="number" id="gm-prof-new-level" value="1" min="1" max="5" style="width:100%;margin-bottom:12px">
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" id="gm-prof-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="gm-prof-confirm">Add</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#gm-prof-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#gm-prof-confirm').addEventListener('click', async () => {
    const class_id = parseInt(overlay.querySelector('#gm-prof-new-class').value, 10);
    const level = Math.max(1, Math.min(5, parseInt(overlay.querySelector('#gm-prof-new-level').value, 10) || 1));
    try {
      await api.post(`/api/characters/${charId}/professions`, { class_id, level });
      addLog('gm.prof', `Added profession (class #${class_id}) L${level}`);
      overlay.remove();
      loadGmCharProfessions(charId);
    } catch (e) {
      showToast(e?.message || 'Failed to add profession');
    }
  });
}

// ── GM Buyback Modal ─────────────────────────────────────────
function openGmBuybackModal(invId, itemName, basePrice, charId) {
  let rem = basePrice;
  const sp = Math.floor(rem / 1000); rem %= 1000;
  const sg = Math.floor(rem / 100); rem %= 100;
  const ss = Math.floor(rem / 10); rem %= 10;
  const sb = rem;

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg);width:85%;max-width:360px;padding:20px">
      <h3 style="margin-bottom:10px">💰 Buy from Player: ${itemName}</h3>
      <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:8px">Base price: ${bronzeToDisplay(basePrice)}</p>
      <p style="font-size:0.75rem;margin-bottom:6px">Set buyback price:</p>
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:12px">
        <span style="font-size:0.7rem;color:#e0c97f">P</span><input type="number" id="bb-p" value="${sp}" min="0" style="width:48px;font-size:0.75rem">
        <span style="font-size:0.7rem;color:#fbbf24">G</span><input type="number" id="bb-g" value="${sg}" min="0" style="width:48px;font-size:0.75rem">
        <span style="font-size:0.7rem;color:#94a3b8">S</span><input type="number" id="bb-s" value="${ss}" min="0" style="width:48px;font-size:0.75rem">
        <span style="font-size:0.7rem;color:#b87333">B</span><input type="number" id="bb-b" value="${sb}" min="0" style="width:48px;font-size:0.75rem">
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-primary btn-sm" id="bb-confirm">Confirm Buyback</button>
        <button class="btn btn-ghost btn-sm" id="bb-cancel">Cancel</button>
      </div>
      <div id="bb-result" style="margin-top:8px;font-size:0.8rem"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#bb-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#bb-confirm').addEventListener('click', async () => {
    const p = parseInt(overlay.querySelector('#bb-p').value) || 0;
    const g = parseInt(overlay.querySelector('#bb-g').value) || 0;
    const s = parseInt(overlay.querySelector('#bb-s').value) || 0;
    const b = parseInt(overlay.querySelector('#bb-b').value) || 0;
    try {
      const res = await api.post('/api/inventory/gm-buyback', {
        inventory_item_id: invId, platinum: p, gold: g, silver: s, bronze: b
      });
      overlay.querySelector('#bb-result').innerHTML = `<span style="color:var(--accent-green)">Bought ${res.item_name} for ${res.price_display}!</span>`;
      addLog('gm.economy', `GM bought ${res.item_name} from ${res.character_name} for ${res.price_display}`);
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({ type: 'inventory.gm_buyback', character_id: charId, item_name: res.item_name, price_display: res.price_display }));
      }
      setTimeout(() => { overlay.remove(); loadGmCharInventory(charId); }, 800);
    } catch (e) {
      let msg = 'Buyback failed';
      try { const err = JSON.parse(e.message); msg = err.detail?.message || err.detail || msg; } catch {}
      overlay.querySelector('#bb-result').innerHTML = `<span style="color:var(--accent-red)">${msg}</span>`;
    }
  });
}

// ══════════════════════════════════════════════════════════════
