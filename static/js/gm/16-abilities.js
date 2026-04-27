// ════════════════════════════════════════════════════════
// Phase 6 GM Ability Manager
// Source: gm-app.js lines 7559–8203
// Globals shared via window.* and module-scope hoisting.
// ════════════════════════════════════════════════════════

// PHASE 6 — GM ABILITY MANAGER
// ══════════════════════════════════════════════════════════════
let gmAbilities = [];
// Rework v2: filter state for the ability list
let _abFilter = { pool: false, rarity: '' };

async function loadGmAbilities() {
  try {
    gmAbilities = await api.get(`/api/abilities?session_id=${SESSION_ID}`);
    renderGmAbilities();
  } catch (e) { console.warn('loadGmAbilities:', e); }
}

// Wire ability filter controls once.
document.addEventListener('DOMContentLoaded', () => {
  const poolEl = document.getElementById('ab-filter-pool');
  const rarEl  = document.getElementById('ab-filter-rarity');
  if (poolEl) poolEl.addEventListener('change', () => { _abFilter.pool = poolEl.checked; renderGmAbilities(); });
  if (rarEl)  rarEl .addEventListener('change', () => { _abFilter.rarity = rarEl.value;   renderGmAbilities(); });
});

const _AB_ICONS = ['⚡','⚔️','🔥','❄️','☠️','✨','🛡️','💨','🌊','🌑','💀','🌿','🪄','💫','🌟','⭐','🔮','❤️','🎯','👁️'];
const _AB_DMGTYPES = ['physical','fire','ice','lightning','poison','holy','dark','arcane','custom'];
const _AB_STATS = ['strength','dexterity','constitution','intelligence','wisdom','charisma'];
// Rework v3: added restore_hp_by_die (rolls the race HP die for healing).
const _AB_EFF_TYPES = ['heal_hp','heal_spirit','restore_hp_by_die','restore_mana','apply_status','stat_boost','remove_status','damage','summon_npc','teleport','custom'];
// Rework v3: passive bonus types available in the ability editor dropdown.
const _AB_PASSIVE_BONUS_TYPES = [
  { value: 'attack_bonus',           label: '⚔️  ATK Bonus'                  },
  { value: 'damage_bonus',           label: '💥  DMG Bonus'                  },
  { value: 'stat_bonus',             label: '📊  Stat Bonus'                 },
  { value: 'damage_reduction_flat',  label: '🛡  Dmg Reduction (flat)'       },
  { value: 'damage_reduction_pct',   label: '🛡  Dmg Reduction (%)'          },
  { value: 'max_hp_bonus',           label: '❤️  Max HP (+N)'                },
  { value: 'max_mana_bonus',         label: '🔮  Max Mana (+N)'              },
  { value: 'mana_regen_bonus',       label: '🔄  Mana Regen / turn (+N)'     },
  { value: 'hp_die_bonus',           label: '🎲  HP Die size (+N)'           },
  { value: 'hp_die_count_bonus',     label: '🎲  HP Dice count (+N)'         },
];

function renderGmAbilities() {
  const el = $('#gm-abilities-list');
  if (!el) return;

  // Rework v2: apply filters + starting-pool summary
  const filtered = gmAbilities.filter(a => {
    if (_abFilter.pool && !a.is_in_starting_pool) return false;
    if (_abFilter.rarity && (a.rarity || 'common') !== _abFilter.rarity) return false;
    return true;
  });
  const sumEl = document.getElementById('ab-pool-summary');
  if (sumEl) {
    const buckets = { common: 0, uncommon: 0, rare: 0, epic: 0, legendary: 0 };
    gmAbilities.forEach(a => { if (a.is_in_starting_pool) buckets[a.rarity || 'common'] = (buckets[a.rarity || 'common'] || 0) + 1; });
    sumEl.innerHTML = 'Starting pool: ' +
      Object.entries(buckets).map(([r, n]) => `<span class="rarity-chip rarity-${r}" style="margin-left:4px">${r}: ${n}</span>`).join('');
  }

  if (!filtered.length) {
    el.innerHTML = !gmAbilities.length
      ? '<p class="text-muted">No abilities created yet. Click "+ New Ability" to add one.</p>'
      : '<p class="text-muted" style="font-size:0.8rem">No abilities match the current filter.</p>';
    return;
  }
  el.innerHTML = filtered.map(a => {
    const tags = (Array.isArray(a.tags) ? a.tags : []).map(t => `<span style="font-size:0.62rem;padding:1px 5px;border-radius:8px;background:var(--bg-surface-2);border:1px solid var(--border)">${t}</span>`).join('');
    const typeBadge = a.ability_type === 'passive' ? '🔵 Passive' : a.ability_type === 'reaction' ? '⚡ Reaction' : '🟢 Active';
    const targetIcon = { self:'🙂', single:'🎯', aoe:'💥', none:'—' }[a.target_type] || '';
    const effCount = (a.effect?.effects || []).length;
    const rarity = a.rarity || 'common';
    const rarityChip = `<span class="rarity-chip rarity-${rarity}">${rarity}</span>`;
    const poolChip   = a.is_in_starting_pool
      ? `<span title="In starting pool — can be granted by wizard Step 5" style="font-size:0.62rem;padding:1px 6px;border-radius:8px;background:rgba(192,138,42,0.2);color:var(--accent);font-weight:700">🎁 Pool</span>`
      : '';
    const usesChip   = a.max_uses
      ? `<span title="Max uses per grant" style="font-size:0.62rem;color:var(--accent-green);font-weight:600">⚡ ${a.max_uses}</span>`
      : '';
    const condChip   = a.is_conditional
      ? `<span title="${(a.conditional_text || 'GM discretion').replace(/"/g,'&quot;')}" style="font-size:0.62rem;color:var(--accent);font-style:italic;cursor:help">※ Cond</span>`
      : '';
    return `<div style="display:flex;align-items:stretch;gap:0;margin-bottom:6px;border-radius:var(--r-md);overflow:hidden;border:1px solid var(--border);background:var(--bg-surface)">
      <div style="width:4px;background:${a.color||'#60a5fa'}"></div>
      <div style="flex:1;padding:8px 10px">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:1.1rem">${a.icon||'⚡'}</span>
          <span style="font-weight:700;font-size:0.85rem">${a.name}</span>
          ${rarityChip}
          ${poolChip}
          ${usesChip}
          ${condChip}
          <span style="font-size:0.65rem;padding:1px 6px;border-radius:8px;background:var(--bg-surface-2);border:1px solid var(--border)">${typeBadge}</span>
          ${a.mana_cost ? `<span style="font-size:0.65rem;color:#60a5fa;font-weight:600">🔮 ${a.mana_cost}</span>` : ''}
          ${a.hp_cost ? `<span style="font-size:0.65rem;color:var(--accent-red);font-weight:600">❤️ ${a.hp_cost}</span>` : ''}
          ${a.cooldown_turns ? `<span style="font-size:0.65rem;color:var(--accent-orange)">⏳ ${a.cooldown_turns}t</span>` : ''}
          ${a.damage_dice_count ? `<span style="font-size:0.65rem">${a.damage_dice_count}d${a.damage_dice_type} ${a.damage_type}</span>` : ''}
          <span style="font-size:0.65rem">${targetIcon}</span>
          ${effCount ? `<span style="font-size:0.62rem;color:var(--text-muted)">${effCount} effects</span>` : ''}
        </div>
        ${tags ? `<div style="display:flex;gap:3px;margin-top:3px;flex-wrap:wrap">${tags}</div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:2px;padding:4px;justify-content:center">
        <button class="btn btn-ghost btn-xs" data-edit-ability="${a.id}" title="Edit">✏️</button>
        <button class="btn btn-ghost btn-xs" data-dup-ability="${a.id}" title="Duplicate">📋</button>
        <button class="btn btn-ghost btn-xs" data-assign-ability="${a.id}" title="Assign">👤</button>
        <button class="btn btn-ghost btn-xs" data-del-ability="${a.id}" style="color:var(--accent-red)" title="Delete">🗑️</button>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('[data-edit-ability]').forEach(btn => {
    btn.addEventListener('click', () => {
      const ab = gmAbilities.find(a => a.id == btn.dataset.editAbility);
      if (ab) showAbilityEditor(ab);
    });
  });
  el.querySelectorAll('[data-dup-ability]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await api.post(`/api/abilities/${btn.dataset.dupAbility}/duplicate`);
      loadGmAbilities();
    });
  });
  el.querySelectorAll('[data-assign-ability]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ab = gmAbilities.find(a => a.id == btn.dataset.assignAbility);
      if (!ab) return;
      const charNames = characters.map((c, i) => `${i+1}. ${c.name} ${c.is_npc?'(NPC)':'(Player)'}`).join('\n');
      const pick = prompt(`Assign "${ab.name}" to:\n${charNames}\nEnter numbers (comma-separated):`);
      if (!pick) return;
      const idxs = pick.split(',').map(s => parseInt(s.trim()) - 1).filter(i => i >= 0 && i < characters.length);
      for (const idx of idxs) {
        try {
          await api.post(`/api/characters/${characters[idx].id}/abilities`, { ability_id: ab.id });
        } catch {}
      }
      showToast(`Assigned ${ab.name} to ${idxs.length} character(s)`);
    });
  });
  el.querySelectorAll('[data-del-ability]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this ability?')) return;
      await api.del(`/api/abilities/${btn.dataset.delAbility}`);
      loadGmAbilities();
    });
  });
}

async function showAbilityEditor(existing = null) {
  const d = existing || {};
  let levelConfigs = [];
  let rankConfigs = [];
  const deletedLevelIds = [];
  const deletedRankIds = [];

  if (existing && existing.id) {
    try { levelConfigs = await api.get(`/api/abilities/${existing.id}/level-configs`); } catch {}
    try { rankConfigs = await api.get(`/api/abilities/${existing.id}/rank-configs`); } catch {}
  }

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;justify-content:center;align-items:flex-start;padding:30px;overflow-y:auto';

  const tags = Array.isArray(d.tags) ? d.tags.join(', ') : '';
  const effects = d.effect?.effects || [];
  const passiveEff = d.passive_effect || {};

  overlay.innerHTML = `<div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg);width:600px;max-width:95vw;padding:20px;max-height:90vh;overflow-y:auto">
    <h2 style="margin:0 0 12px;font-size:1rem">${existing ? 'Edit' : 'Create'} Ability</h2>

    <!-- Section 1: Identity -->
    <fieldset style="border:1px solid var(--border);border-radius:var(--r-md);padding:10px;margin-bottom:10px">
      <legend style="font-size:0.78rem;font-weight:700;padding:0 6px">🏷️ Identity</legend>
      <div style="display:flex;gap:8px;margin-bottom:6px">
        <div style="flex:1"><label style="font-size:0.72rem">Name</label><input id="ab-name" value="${d.name||''}" style="width:100%"></div>
        <div style="width:80px"><label style="font-size:0.72rem">Color</label><input id="ab-color" type="color" value="${d.color||'#60a5fa'}" style="width:100%;height:30px"></div>
      </div>
      <div style="margin-bottom:6px">
        <label style="font-size:0.72rem">Icon</label>
        <div id="ab-icon-grid" style="display:flex;flex-wrap:wrap;gap:4px">${_AB_ICONS.map(ic => `<button class="btn btn-ghost btn-xs ab-icon-pick ${ic===(d.icon||'⚡')?'active':''}" data-icon="${ic}" style="font-size:1.1rem;padding:2px 4px">${ic}</button>`).join('')}</div>
      </div>
      <div style="margin-bottom:6px"><label style="font-size:0.72rem">Flavor Text (shown to players)</label><textarea id="ab-flavor" rows="2" style="width:100%;font-size:0.78rem">${d.flavor_text||''}</textarea></div>
      <div style="margin-bottom:6px"><label style="font-size:0.72rem">GM Notes (hidden from players)</label><textarea id="ab-notes" rows="2" style="width:100%;font-size:0.78rem">${d.notes||''}</textarea></div>
      <div><label style="font-size:0.72rem">Tags (comma-separated)</label><input id="ab-tags" value="${tags}" style="width:100%"></div>
    </fieldset>

    <!-- Section 2: Type & Targeting -->
    <fieldset style="border:1px solid var(--border);border-radius:var(--r-md);padding:10px;margin-bottom:10px">
      <legend style="font-size:0.78rem;font-weight:700;padding:0 6px">⚙️ Type & Targeting</legend>
      <div style="display:flex;gap:12px;margin-bottom:6px">
        <label style="font-size:0.78rem"><input type="radio" name="ab-type" value="active" ${(d.ability_type||'active')==='active'?'checked':''}> Active</label>
        <label style="font-size:0.78rem"><input type="radio" name="ab-type" value="passive" ${d.ability_type==='passive'?'checked':''}> Passive</label>
        <label style="font-size:0.78rem"><input type="radio" name="ab-type" value="reaction" ${d.ability_type==='reaction'?'checked':''}> Reaction</label>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:6px">
        <label style="font-size:0.78rem"><input type="radio" name="ab-target" value="self" ${d.target_type==='self'?'checked':''}> Self</label>
        <label style="font-size:0.78rem"><input type="radio" name="ab-target" value="single" ${(d.target_type||'single')==='single'?'checked':''}> Single</label>
        <label style="font-size:0.78rem"><input type="radio" name="ab-target" value="aoe" ${d.target_type==='aoe'?'checked':''}> AoE</label>
        <label style="font-size:0.78rem"><input type="radio" name="ab-target" value="none" ${d.target_type==='none'?'checked':''}> None</label>
      </div>
      <div id="ab-aoe-row" style="display:${d.target_type==='aoe'?'flex':'none'};gap:6px;align-items:center;margin-bottom:6px">
        <label style="font-size:0.72rem">AoE Radius (cells):</label><input id="ab-aoe" type="number" value="${d.aoe_radius||3}" min="1" style="width:60px">
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <label style="font-size:0.72rem">Damage Type:</label>
        <select id="ab-dmgtype" style="font-size:0.78rem">${_AB_DMGTYPES.map(t => `<option value="${t}" ${t===(d.damage_type||'physical')?'selected':''}>${t}</option>`).join('')}</select>
        <input id="ab-custom-dmg" placeholder="Custom type name" value="${d.custom_damage_type||''}" style="width:120px;display:${d.damage_type==='custom'?'':'none'}">
      </div>
    </fieldset>

    <!-- Section 3: Costs & Cooldown -->
    <fieldset style="border:1px solid var(--border);border-radius:var(--r-md);padding:10px;margin-bottom:10px">
      <legend style="font-size:0.78rem;font-weight:700;padding:0 6px">💰 Costs & Cooldown</legend>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <div><label style="font-size:0.72rem">🔮 Mana Cost</label><input id="ab-mana" type="number" value="${d.mana_cost||0}" min="0" style="width:60px"></div>
        <div><label style="font-size:0.72rem">❤️ HP Cost</label><input id="ab-hpcost" type="number" value="${d.hp_cost||0}" min="0" style="width:60px"></div>
        <div><label style="font-size:0.72rem">⏳ Cooldown (turns)</label><input id="ab-cd" type="number" value="${d.cooldown_turns||0}" min="0" style="width:60px"></div>
      </div>
      <div style="margin-top:6px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <label style="font-size:0.78rem"><input type="checkbox" id="ab-hitroll" ${d.requires_hit_roll?'checked':''}> Requires Hit Roll</label>
        <div id="ab-hitstat-row" style="display:${d.requires_hit_roll?'flex':'none'};gap:6px;align-items:center">
          <label style="font-size:0.72rem">Hit stat:</label>
          <select id="ab-hitstat" style="font-size:0.78rem">${_AB_STATS.map(s => `<option value="${s}" ${s===(d.hit_stat||'strength')?'selected':''}>${s.substring(0,3).toUpperCase()}</option>`).join('')}</select>
        </div>
        <div style="display:flex;gap:6px;align-items:center" title="Max distance in battle-grid cells (1 = touch)">
          <label style="font-size:0.72rem">📏 Range (cells)</label>
          <input id="ab-range-cells" type="number" value="${d.range_cells ?? 1}" min="1" max="40" style="width:56px">
        </div>
      </div>
    </fieldset>

    <!-- Section 4: Damage -->
    <fieldset style="border:1px solid var(--border);border-radius:var(--r-md);padding:10px;margin-bottom:10px">
      <legend style="font-size:0.78rem;font-weight:700;padding:0 6px">🗡️ Damage</legend>
      <label style="font-size:0.78rem"><input type="checkbox" id="ab-has-dmg" ${d.damage_dice_count?'checked':''}> This ability deals damage</label>
      <div id="ab-dmg-fields" style="display:${d.damage_dice_count?'flex':'none'};gap:8px;margin-top:6px;flex-wrap:wrap;align-items:center">
        <input id="ab-ddc" type="number" value="${d.damage_dice_count||1}" min="1" style="width:50px">
        <span>d</span>
        <select id="ab-ddt" style="font-size:0.78rem">${[4,6,8,10,12,20].map(v => `<option value="${v}" ${v===(d.damage_dice_type||6)?'selected':''}>${v}</option>`).join('')}</select>
        <label style="font-size:0.72rem">Dmg stat:</label>
        <select id="ab-dmgstat" style="font-size:0.78rem"><option value="">None</option>${_AB_STATS.map(s => `<option value="${s}" ${s===(d.damage_stat||'strength')?'selected':''}>${s.substring(0,3).toUpperCase()}</option>`).join('')}</select>
      </div>
    </fieldset>

    <!-- Section 5: Effects Chain -->
    <fieldset style="border:1px solid var(--border);border-radius:var(--r-md);padding:10px;margin-bottom:10px">
      <legend style="font-size:0.78rem;font-weight:700;padding:0 6px">✨ Effects Chain</legend>
      <div id="ab-effects-list"></div>
      <button class="btn btn-ghost btn-xs" id="ab-add-effect" style="margin-top:4px">+ Add Effect</button>
    </fieldset>

    <!-- Rework v2 Section: Pool, Rarity, Uses, Conditional -->
    <fieldset style="border:1px solid var(--border);border-radius:var(--r-md);padding:10px;margin-bottom:10px">
      <legend style="font-size:0.78rem;font-weight:700;padding:0 6px">🎁 Starting Pool & Uses</legend>
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
        <label style="font-size:0.72rem;display:flex;flex-direction:column;gap:2px">Rarity
          <select id="ab-rarity" style="font-size:0.78rem">
            ${['common','uncommon','rare','epic','legendary'].map(r => `<option value="${r}" ${r===(d.rarity||'common')?'selected':''}>${r}</option>`).join('')}
          </select>
        </label>
        <label style="font-size:0.78rem;display:flex;align-items:center;gap:4px">
          <input type="checkbox" id="ab-starting-pool" ${d.is_in_starting_pool?'checked':''}>
          🎁 In starting pool (d4-pickable by wizard)
        </label>
        <label style="font-size:0.72rem;display:flex;flex-direction:column;gap:2px" title="Leave blank or 0 for infinite uses.">Max Uses
          <input type="number" id="ab-max-uses" min="0" value="${d.max_uses ?? ''}" placeholder="∞" style="width:60px;font-size:0.78rem">
        </label>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <label style="font-size:0.78rem;display:flex;align-items:center;gap:4px">
          <input type="checkbox" id="ab-conditional" ${d.is_conditional?'checked':''}>
          ※ Conditional (flavor-only, no mechanics)
        </label>
        <input id="ab-conditional-text" type="text" placeholder="When condition X is met…" value="${(d.conditional_text||'').replace(/"/g,'&quot;')}"
               style="flex:1;font-size:0.78rem;display:${d.is_conditional?'':'none'}">
      </div>
    </fieldset>

    <!-- Section 6: Passive Effect (if passive type) -->
    <fieldset id="ab-passive-section" style="border:1px solid var(--border);border-radius:var(--r-md);padding:10px;margin-bottom:10px;display:${d.ability_type==='passive'?'block':'none'}">
      <legend style="font-size:0.78rem;font-weight:700;padding:0 6px">🔵 Passive Effect</legend>
      <div id="ab-passive-list"></div>
      <button class="btn btn-ghost btn-xs" id="ab-add-passive" style="margin-top:4px">+ Add Bonus</button>
    </fieldset>

    <!-- Section 7: Presets -->
    <fieldset style="border:1px solid var(--border);border-radius:var(--r-md);padding:10px;margin-bottom:10px">
      <legend style="font-size:0.78rem;font-weight:700;padding:0 6px">📈 Presets (Level / Rank)</legend>
      <div id="ab-presets-list" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;font-size:0.72rem;min-height:20px"></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <label style="font-size:0.78rem">Save current config as preset:</label>
        <select id="ab-preset-type" style="font-size:0.78rem">
          <option value="">— None —</option>
          <option value="level">Level</option>
          <option value="rank">Rank</option>
        </select>
        <select id="ab-preset-value" style="font-size:0.78rem;display:none">
          <option value="">— Choose —</option>
        </select>
        <span style="font-size:0.7rem;color:var(--text-muted)">Select a preset target, then Save</span>
      </div>
    </fieldset>

    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button class="btn btn-ghost btn-sm" id="ab-cancel">Cancel</button>
      <button class="btn btn-primary btn-sm" id="ab-save">${existing ? 'Save Changes' : 'Create Ability'}</button>
    </div>
  </div>`;

  document.body.appendChild(overlay);

  // ── Wire icon picker ──
  let selectedIcon = d.icon || '⚡';
  overlay.querySelectorAll('.ab-icon-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      overlay.querySelectorAll('.ab-icon-pick').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedIcon = btn.dataset.icon;
    });
  });

  // ── Toggle visibility based on radio/checkbox ──
  overlay.querySelectorAll('[name="ab-target"]').forEach(r => r.addEventListener('change', () => {
    overlay.querySelector('#ab-aoe-row').style.display = overlay.querySelector('[name="ab-target"]:checked').value === 'aoe' ? 'flex' : 'none';
  }));
  overlay.querySelectorAll('[name="ab-type"]').forEach(r => r.addEventListener('change', () => {
    overlay.querySelector('#ab-passive-section').style.display = overlay.querySelector('[name="ab-type"]:checked').value === 'passive' ? 'block' : 'none';
  }));
  overlay.querySelector('#ab-dmgtype').addEventListener('change', () => {
    overlay.querySelector('#ab-custom-dmg').style.display = overlay.querySelector('#ab-dmgtype').value === 'custom' ? '' : 'none';
  });
  overlay.querySelector('#ab-hitroll').addEventListener('change', () => {
    overlay.querySelector('#ab-hitstat-row').style.display = overlay.querySelector('#ab-hitroll').checked ? 'flex' : 'none';
  });
  overlay.querySelector('#ab-has-dmg').addEventListener('change', () => {
    overlay.querySelector('#ab-dmg-fields').style.display = overlay.querySelector('#ab-has-dmg').checked ? 'flex' : 'none';
  });
  overlay.querySelector('#ab-conditional').addEventListener('change', () => {
    overlay.querySelector('#ab-conditional-text').style.display = overlay.querySelector('#ab-conditional').checked ? '' : 'none';
  });

  // ── Effects chain ──
  let editorEffects = [...effects];
  function renderEffectsEditor() {
    const el = overlay.querySelector('#ab-effects-list');
    if (!editorEffects.length) { el.innerHTML = '<span class="text-muted" style="font-size:0.72rem">No effects</span>'; return; }
    el.innerHTML = editorEffects.map((e, i) => {
      let fields = '';
      if (e.type === 'heal_hp' || e.type === 'heal_spirit' || e.type === 'damage') {
        fields = `<input type="number" data-ef="dice_count" value="${e.dice_count||1}" min="1" style="width:40px" placeholder="dc"> d <input type="number" data-ef="dice_type" value="${e.dice_type||6}" style="width:40px" placeholder="dt"> + <input type="number" data-ef="flat_bonus" value="${e.flat_bonus||0}" style="width:40px" placeholder="bonus">`;
      } else if (e.type === 'restore_mana') {
        fields = `Amount: <input type="number" data-ef="amount" value="${e.amount||0}" style="width:50px">`;
      } else if (e.type === 'restore_hp_by_die') {
        fields = `<span style="color:var(--text-muted)" title="Rolls the caster's race HP die">🎲 race die</span> + <input type="number" data-ef="flat_bonus" value="${e.flat_bonus||0}" style="width:40px" placeholder="bonus">`;
      } else if (e.type === 'apply_status') {
        fields = `Template ID: <input type="number" data-ef="template_id" value="${e.template_id||''}" style="width:50px"> Duration: <input type="number" data-ef="duration_turns" value="${e.duration_turns||3}" style="width:40px">t`;
      } else if (e.type === 'stat_boost') {
        fields = `Stat: <select data-ef="stat">${_AB_STATS.map(s => `<option value="${s}" ${s===e.stat?'selected':''}>${s.substring(0,3)}</option>`).join('')}</select> Value: <input type="number" data-ef="value" value="${e.value||0}" style="width:40px"> Duration: <input type="number" data-ef="duration_turns" value="${e.duration_turns||3}" style="width:40px">t`;
      } else if (e.type === 'remove_status') {
        fields = `Status name: <input data-ef="status_name" value="${e.status_name||''}" style="width:100px">`;
      } else if (e.type === 'custom' || e.type === 'teleport') {
        fields = `Desc: <input data-ef="description" value="${e.description||''}" style="width:180px">`;
      } else if (e.type === 'summon_npc') {
        fields = `Template ID: <input type="number" data-ef="template_id" value="${e.template_id||''}" style="width:50px"> Count: <input type="number" data-ef="count" value="${e.count||1}" style="width:40px">`;
      }
      return `<div style="display:flex;gap:4px;align-items:center;margin-bottom:4px;font-size:0.72rem" data-eff-idx="${i}">
        <select data-ef-type style="font-size:0.72rem">${_AB_EFF_TYPES.map(t => `<option value="${t}" ${t===e.type?'selected':''}>${t}</option>`).join('')}</select>
        ${fields}
        <button class="btn btn-ghost btn-xs" data-rm-eff="${i}" style="color:var(--accent-red)">✕</button>
      </div>`;
    }).join('');
    el.querySelectorAll('[data-ef-type]').forEach(sel => {
      sel.addEventListener('change', () => {
        const idx = parseInt(sel.closest('[data-eff-idx]').dataset.effIdx);
        editorEffects[idx] = { type: sel.value };
        renderEffectsEditor();
      });
    });
    el.querySelectorAll('[data-ef]').forEach(inp => {
      inp.addEventListener('change', () => {
        const idx = parseInt(inp.closest('[data-eff-idx]').dataset.effIdx);
        const key = inp.dataset.ef;
        const v = inp.type === 'number' ? (parseInt(inp.value)||0) : inp.value;
        editorEffects[idx][key] = v;
      });
    });
    el.querySelectorAll('[data-rm-eff]').forEach(btn => {
      btn.addEventListener('click', () => {
        editorEffects.splice(parseInt(btn.dataset.rmEff), 1);
        renderEffectsEditor();
      });
    });
  }
  renderEffectsEditor();
  overlay.querySelector('#ab-add-effect').addEventListener('click', () => {
    editorEffects.push({ type: 'damage', dice_count: 1, dice_type: 6, flat_bonus: 0 });
    renderEffectsEditor();
  });

  // ── Passive bonuses ──
  let passiveBonuses = passiveEff.bonuses || [];
  function renderPassiveEditor() {
    const el = overlay.querySelector('#ab-passive-list');
    if (!passiveBonuses.length) { el.innerHTML = '<span class="text-muted" style="font-size:0.72rem">No passive bonuses</span>'; return; }
    el.innerHTML = passiveBonuses.map((b, i) => {
      const opts = _AB_PASSIVE_BONUS_TYPES.map(t =>
        `<option value="${t.value}" ${b.bonus_type===t.value?'selected':''}>${t.label}</option>`
      ).join('');
      const needsStat = b.bonus_type === 'stat_bonus';
      const statOpts = _AB_STATS.map(s =>
        `<option value="${s}" ${s===(b.stat||'strength')?'selected':''}>${s.charAt(0).toUpperCase()+s.slice(1)}</option>`
      ).join('');
      return `<div style="display:flex;gap:4px;align-items:center;margin-bottom:3px;font-size:0.72rem;flex-wrap:wrap" data-pb-idx="${i}">
        <select data-pb="bonus_type" style="font-size:0.72rem">${opts}</select>
        <select data-pb="stat" style="font-size:0.72rem;display:${needsStat?'':'none'}">${statOpts}</select>
        Value: <input type="number" data-pb="value" value="${b.value||0}" style="width:60px">
        <button class="btn btn-ghost btn-xs" data-rm-pb="${i}" style="color:var(--accent-red)">✕</button>
    </div>`;
    }).join('');
    el.querySelectorAll('[data-pb]').forEach(inp => {
      inp.addEventListener('change', () => {
        const idx = parseInt(inp.closest('[data-pb-idx]').dataset.pbIdx);
        passiveBonuses[idx][inp.dataset.pb] = inp.type === 'number' ? (parseInt(inp.value)||0) : inp.value;
      });
    });
    el.querySelectorAll('[data-rm-pb]').forEach(btn => {
      btn.addEventListener('click', () => { passiveBonuses.splice(parseInt(btn.dataset.rmPb), 1); renderPassiveEditor(); });
    });
  }
  renderPassiveEditor();
  overlay.querySelector('#ab-add-passive').addEventListener('click', () => {
    passiveBonuses.push({ bonus_type: 'attack_bonus', value: 1 });
    renderPassiveEditor();
  });

  // ── Presets helpers ──
  function _collectFormBody() {
    const hasDmg = overlay.querySelector('#ab-has-dmg').checked;
    return {
      ability_type: overlay.querySelector('[name="ab-type"]:checked')?.value || 'active',
      target_type: overlay.querySelector('[name="ab-target"]:checked')?.value || 'single',
      aoe_radius: overlay.querySelector('[name="ab-target"]:checked')?.value === 'aoe' ? (parseInt(overlay.querySelector('#ab-aoe').value)||3) : null,
      damage_type: overlay.querySelector('#ab-dmgtype').value,
      custom_damage_type: overlay.querySelector('#ab-dmgtype').value === 'custom' ? overlay.querySelector('#ab-custom-dmg').value : null,
      mana_cost: parseInt(overlay.querySelector('#ab-mana').value) || 0,
      hp_cost: parseInt(overlay.querySelector('#ab-hpcost').value) || 0,
      cooldown_turns: parseInt(overlay.querySelector('#ab-cd').value) || 0,
      requires_hit_roll: overlay.querySelector('#ab-hitroll').checked,
      hit_stat: overlay.querySelector('#ab-hitstat').value,
      range_cells: Math.max(1, parseInt(overlay.querySelector('#ab-range-cells').value) || 1),
      damage_stat: hasDmg ? overlay.querySelector('#ab-dmgstat').value : 'strength',
      damage_dice_count: hasDmg ? (parseInt(overlay.querySelector('#ab-ddc').value)||1) : null,
      damage_dice_type: hasDmg ? (parseInt(overlay.querySelector('#ab-ddt').value)||6) : null,
      is_passive: (overlay.querySelector('[name="ab-type"]:checked')?.value || 'active') === 'passive',
      max_uses: (() => {
        const v = overlay.querySelector('#ab-max-uses').value;
        if (v === '' || v === null) return null;
        const n = parseInt(v);
        return (isNaN(n) || n <= 0) ? null : n;
      })(),
      is_conditional: overlay.querySelector('#ab-conditional').checked,
      conditional_text: overlay.querySelector('#ab-conditional-text').value.trim() || null,
      notes: overlay.querySelector('#ab-notes').value.trim() || null,
    };
  }

  function _applyPresetToForm(cfg) {
    if (cfg.ability_type) {
      const r = overlay.querySelector(`[name="ab-type"][value="${cfg.ability_type}"]`);
      if (r) { r.checked = true; overlay.querySelector('#ab-passive-section').style.display = cfg.ability_type === 'passive' ? 'block' : 'none'; }
    }
    if (cfg.target_type) {
      const r = overlay.querySelector(`[name="ab-target"][value="${cfg.target_type}"]`);
      if (r) { r.checked = true; overlay.querySelector('#ab-aoe-row').style.display = cfg.target_type === 'aoe' ? 'flex' : 'none'; }
    }
    if (cfg.aoe_radius != null) overlay.querySelector('#ab-aoe').value = cfg.aoe_radius;
    if (cfg.damage_type) {
      overlay.querySelector('#ab-dmgtype').value = cfg.damage_type;
      overlay.querySelector('#ab-custom-dmg').style.display = cfg.damage_type === 'custom' ? '' : 'none';
    }
    if (cfg.custom_damage_type != null) overlay.querySelector('#ab-custom-dmg').value = cfg.custom_damage_type;
    if (cfg.mana_cost != null) overlay.querySelector('#ab-mana').value = cfg.mana_cost;
    if (cfg.hp_cost != null) overlay.querySelector('#ab-hpcost').value = cfg.hp_cost;
    if (cfg.cooldown_turns != null) overlay.querySelector('#ab-cd').value = cfg.cooldown_turns;
    if (cfg.requires_hit_roll != null) {
      overlay.querySelector('#ab-hitroll').checked = cfg.requires_hit_roll;
      overlay.querySelector('#ab-hitstat-row').style.display = cfg.requires_hit_roll ? 'flex' : 'none';
    }
    if (cfg.hit_stat) overlay.querySelector('#ab-hitstat').value = cfg.hit_stat;
    if (cfg.range_cells != null) overlay.querySelector('#ab-range-cells').value = cfg.range_cells;
    if (cfg.damage_dice_count != null) {
      overlay.querySelector('#ab-has-dmg').checked = true;
      overlay.querySelector('#ab-dmg-fields').style.display = 'flex';
      overlay.querySelector('#ab-ddc').value = cfg.damage_dice_count;
    }
    if (cfg.damage_dice_type != null) overlay.querySelector('#ab-ddt').value = cfg.damage_dice_type;
    if (cfg.damage_stat) overlay.querySelector('#ab-dmgstat').value = cfg.damage_stat;
    if (cfg.max_uses != null) overlay.querySelector('#ab-max-uses').value = cfg.max_uses;
    if (cfg.is_conditional != null) {
      overlay.querySelector('#ab-conditional').checked = cfg.is_conditional;
      overlay.querySelector('#ab-conditional-text').style.display = cfg.is_conditional ? '' : 'none';
    }
    if (cfg.conditional_text != null) overlay.querySelector('#ab-conditional-text').value = cfg.conditional_text;
    if (cfg.notes != null) overlay.querySelector('#ab-notes').value = cfg.notes;
  }

  function renderPresets() {
    const el = overlay.querySelector('#ab-presets-list');
    const all = [
      ...levelConfigs.map(c => ({ ...c, kind: 'level', label: `Lv.${c.level}` })),
      ...rankConfigs.map(c => ({ ...c, kind: 'rank', label: c.rank })),
    ];
    if (!all.length) { el.innerHTML = '<span class="text-muted" style="font-size:0.72rem">No presets yet</span>'; return; }
    el.innerHTML = all.map((c, i) => `
      <button class="btn btn-ghost btn-xs" data-load-preset="${i}" style="text-transform:capitalize;font-size:0.72rem;padding:2px 8px">${c.label}</button>
      <button class="btn btn-ghost btn-xs" data-del-preset="${i}" style="color:var(--accent-red);font-size:0.65rem;padding:2px 4px">✕</button>
    `).join('');
    el.querySelectorAll('[data-load-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.loadPreset);
        _applyPresetToForm(all[idx]);
        showToast(`Loaded ${all[idx].label}`);
      });
    });
    el.querySelectorAll('[data-del-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.delPreset);
        const item = all[idx];
        if (item.kind === 'level') {
          const arrIdx = levelConfigs.findIndex(x => x.level === item.level);
          if (arrIdx > -1) { if (levelConfigs[arrIdx].id) deletedLevelIds.push(levelConfigs[arrIdx].id); levelConfigs.splice(arrIdx, 1); }
        } else {
          const arrIdx = rankConfigs.findIndex(x => x.rank === item.rank);
          if (arrIdx > -1) { if (rankConfigs[arrIdx].id) deletedRankIds.push(rankConfigs[arrIdx].id); rankConfigs.splice(arrIdx, 1); }
        }
        renderPresets();
      });
    });
  }

  renderPresets();

  const presetTypeSel = overlay.querySelector('#ab-preset-type');
  const presetValueSel = overlay.querySelector('#ab-preset-value');
  presetTypeSel.addEventListener('change', () => {
    const t = presetTypeSel.value;
    if (!t) { presetValueSel.style.display = 'none'; return; }
    presetValueSel.style.display = '';
    presetValueSel.innerHTML = '<option value="">— Choose —</option>' +
      (t === 'level'
        ? [1,2,3,4,5,6,7,8,9,10].map(n => {
            const exists = levelConfigs.some(c => c.level === n);
            return `<option value="${n}" ${exists ? 'style="color:var(--accent-green)"' : ''}>Level ${n}${exists ? ' (update)' : ''}</option>`;
          }).join('')
        : ['common','uncommon','rare','epic','legendary','mythic','divine'].map(r => {
            const exists = rankConfigs.some(c => c.rank === r);
            return `<option value="${r}" ${exists ? 'style="color:var(--accent-green)"' : ''}>${r}${exists ? ' (update)' : ''}</option>`;
          }).join('')
      );
  });

  // ── Cancel / Save ──
  overlay.querySelector('#ab-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#ab-save').addEventListener('click', async () => {
    const hasDmg = overlay.querySelector('#ab-has-dmg').checked;
    const body = {
      name: overlay.querySelector('#ab-name').value.trim() || 'Ability',
      description: overlay.querySelector('#ab-flavor').value.trim(),
      session_id: SESSION_ID,
      icon: selectedIcon,
      color: overlay.querySelector('#ab-color').value,
      flavor_text: overlay.querySelector('#ab-flavor').value.trim() || null,
      notes: overlay.querySelector('#ab-notes').value.trim() || null,
      tags: overlay.querySelector('#ab-tags').value.split(',').map(s => s.trim()).filter(Boolean),
      ability_type: overlay.querySelector('[name="ab-type"]:checked')?.value || 'active',
      target_type: overlay.querySelector('[name="ab-target"]:checked')?.value || 'single',
      aoe_radius: overlay.querySelector('[name="ab-target"]:checked')?.value === 'aoe' ? (parseInt(overlay.querySelector('#ab-aoe').value)||3) : null,
      damage_type: overlay.querySelector('#ab-dmgtype').value,
      custom_damage_type: overlay.querySelector('#ab-dmgtype').value === 'custom' ? overlay.querySelector('#ab-custom-dmg').value : null,
      mana_cost: parseInt(overlay.querySelector('#ab-mana').value) || 0,
      hp_cost: parseInt(overlay.querySelector('#ab-hpcost').value) || 0,
      cooldown_turns: parseInt(overlay.querySelector('#ab-cd').value) || 0,
      requires_hit_roll: overlay.querySelector('#ab-hitroll').checked,
      hit_stat: overlay.querySelector('#ab-hitstat').value,
      range_cells: Math.max(1, parseInt(overlay.querySelector('#ab-range-cells').value) || 1),
      damage_stat: hasDmg ? overlay.querySelector('#ab-dmgstat').value : 'strength',
      damage_dice_count: hasDmg ? (parseInt(overlay.querySelector('#ab-ddc').value)||1) : null,
      damage_dice_type: hasDmg ? (parseInt(overlay.querySelector('#ab-ddt').value)||6) : null,
      is_passive: (overlay.querySelector('[name="ab-type"]:checked')?.value || 'active') === 'passive',
      passive_effect: passiveBonuses.length ? { bonuses: passiveBonuses } : null,
      effect: { effects: editorEffects },
      rarity: overlay.querySelector('#ab-rarity').value || 'common',
      is_in_starting_pool: overlay.querySelector('#ab-starting-pool').checked,
      max_uses: (() => {
        const v = overlay.querySelector('#ab-max-uses').value;
        if (v === '' || v === null) return null;
        const n = parseInt(v);
        return (isNaN(n) || n <= 0) ? null : n;
      })(),
      is_conditional: overlay.querySelector('#ab-conditional').checked,
      conditional_text: overlay.querySelector('#ab-conditional-text').value.trim() || null,
    };

    let abilityId = existing ? existing.id : null;
    try {
      if (existing) {
        await api.put(`/api/abilities/${existing.id}`, body);
      } else {
        const res = await api.post('/api/abilities', body);
        abilityId = res.id;
      }
    } catch (e) { showToast('Save failed: ' + (e.message || '')); return; }

    // Save preset if selected
    const pType = presetTypeSel.value;
    const pVal = presetValueSel.value;
    if (pType && pVal && abilityId) {
      const cbody = _collectFormBody();
      if (pType === 'level') {
        cbody.level = parseInt(pVal);
        api.post(`/api/abilities/${abilityId}/level-configs`, cbody).catch(() => {});
      } else {
        cbody.rank = pVal;
        api.post(`/api/abilities/${abilityId}/rank-configs`, cbody).catch(() => {});
      }
    }
    // Delete removed presets
    for (const id of deletedLevelIds) {
      api.del(`/api/abilities/${abilityId}/level-configs/${id}`).catch(() => {});
    }
    for (const id of deletedRankIds) {
      api.del(`/api/abilities/${abilityId}/rank-configs/${id}`).catch(() => {});
    }

    overlay.remove();
    loadGmAbilities();
  });
}

if ($('#btn-new-ability')) {
  $('#btn-new-ability').addEventListener('click', () => showAbilityEditor());
}

// ══════════════════════════════════════════════════════════════
