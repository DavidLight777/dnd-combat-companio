// ════════════════════════════════════════════════════════
// FIX 2: action menu (2x2 grid)
// Source: player-app.js lines 3692-4603
// ════════════════════════════════════════════════════════

// FIX 2 — ACTION MENU (2×2 card grid with slide-in confirmation)
// ══════════════════════════════════════════════════════════════

// Confirmation panel — rendered as a fixed overlay above the Actions
// panel. `_closeConfirmPanel` tears down both the panel and its
// backdrop, and restores the inline Actions strip that was hidden
// while the overlay was up.
function _closeConfirmPanel() {
  const backdrop = document.getElementById('action-confirm-backdrop');
  if (backdrop) backdrop.remove();
  const p = document.getElementById('action-confirm-panel');
  if (p) p.remove();
  const body = document.getElementById('action-menu-body');
  if (body) {
    body.style.visibility = '';
    delete body.dataset._hidden;
  }
  renderActionMenu();
}

function _mountConfirmPanel(innerHtml) {
  const body = $('#action-menu-body');
  if (!body) return null;
  // The in-sidebar layout fought us every time — flex-wrap parent,
  // nested panels with `overflow:hidden`, variable sibling heights,
  // viewport-cached HTML — so we bail on the inline approach and
  // render the confirm panel as a FIXED overlay anchored to the
  // viewport. This makes the max-height + scroll deterministic and
  // identical on every browser, regardless of how tall the ability
  // flow grows.
  //
  // UX: the overlay is placed over the right-sidebar column (same
  // visual location as before) with a semi-transparent backdrop so
  // the rest of the screen is clearly secondary while rolling.
  // Clicking the backdrop closes the panel, same as the ✕ button.
  //
  // We still return a DOM node anchored at `#action-confirm-panel`
  // so the existing `_closeConfirmPanel()` / `querySelector` code
  // keeps working unchanged.
  // Clean up any stale overlay first (defensive — a hot-reload or
  // double-click could otherwise leave two stacked backdrops).
  document.querySelectorAll('#action-confirm-backdrop, #action-confirm-panel')
    .forEach(n => n.remove());
  // Hide the inline body so the Actions strip doesn't show behind.
  body.dataset._hidden = '1';
  body.style.visibility = 'hidden';
  const backdrop = document.createElement('div');
  backdrop.id = 'action-confirm-backdrop';
  backdrop.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.55);
    z-index:9000;display:flex;align-items:center;justify-content:center;
    padding:24px;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);
  `;
  const panel = document.createElement('div');
  panel.id = 'action-confirm-panel';
  panel.className = 'action-confirm slide-in';
  panel.style.cssText = `
    width:min(420px, 92vw);max-height:min(85vh, 820px);
    background:var(--bg-surface-2);border:1px solid var(--border-active);
    border-radius:var(--r-md);box-shadow:0 8px 32px rgba(0,0,0,0.55);
    padding:12px 14px 18px 14px;overflow-y:auto;overscroll-behavior:contain;
    -webkit-overflow-scrolling:touch;
  `;
  panel.innerHTML = innerHtml;
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  // Backdrop click-outside closes the panel (but only on the backdrop
  // itself, not when clicks bubble up from inner widgets).
  backdrop.addEventListener('mousedown', e => {
    if (e.target === backdrop) _closeConfirmPanel();
  });
  // Esc to close.
  const escHandler = e => {
    if (e.key === 'Escape') {
      _closeConfirmPanel();
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
  return panel;
}

function _actionCard({id, icon, label, sub, subColor = 'var(--text-muted)'}) {
  return `<div class="action-card list-row" id="${id}" role="button" tabindex="0">
    <div class="lr-ico">${icon}</div>
    <div class="lr-body">
      <div class="lr-name">${label}</div>
      <div class="lr-meta" style="color:${subColor}">${sub}</div>
    </div>
    <div class="lr-cost">Action</div>
  </div>`;
}

function _dockSection(title, rows) {
  return rows.length ? `<div class="dp-section-title">${title}</div>${rows.join('')}` : '';
}

function _dockActionRow({ id = '', icon = '⚡', name, meta = '', cost = '', cls = '', data = '' }) {
  return `<div class="list-row ${cls}" ${id ? `id="${id}"` : ''} ${data} role="button" tabindex="0">
    <div class="lr-ico">${icon}</div>
    <div class="lr-body">
      <div class="lr-name">${name}</div>
      ${meta ? `<div class="lr-meta">${meta}</div>` : ''}
    </div>
    ${cost ? `<div class="lr-cost">${cost}</div>` : ''}
  </div>`;
}

function renderActionMenu() {
  const body = $('#action-menu-body');
  if (!body || !char) return;

  body.style.display = 'block';
  body.style.flexWrap = '';
  body.style.gap = '';

  const items = inventoryData?.items || [];
  const supportEl = document.getElementById('dock-support-actions');

  // Attack: main_hand weapon equipped
  const wpn = items.find(i => i.is_equipped && i.equipped_slot === 'main_hand' && i.weapon_stats);
  // Potion: any consumable flagged is_potion OR in category "potion" (backward compat)
  const potions = items.filter(i => i.consumable && (i.is_potion || (i.category || '').toLowerCase() === 'potion'));
  // Use Item: non-consumable with use_effect defined (not a potion)
  const useables = items.filter(i =>
    !i.consumable && i.use_effect && !i.is_potion && (i.category || '').toLowerCase() !== 'potion'
  );
  // Ability: ≥1 active/reaction ability not all on cooldown
  const activeAbs = (abilitiesData || []).filter(a =>
    a.ability_type !== 'passive' && a.ability_type !== 'reaction' && a.is_unlocked !== false && (a.cooldown_remaining || 0) <= 0
  );

  const basicRows = [];
  if (wpn) {
    const ws = wpn.weapon_stats;
    // Rework v3 Phase 7: show grid-cell range on the Attack card so
    // the player knows how close they must be before clicking. Server
    // still enforces the check; this is just pre-empting the 403.
    const rng = ws.range_cells != null ? ` · 📏${ws.range_cells}` : '';
    basicRows.push(_dockActionRow({
      id: 'action-attack', icon: '⚔️', label: 'Attack',
      name: 'Attack',
      meta: `${wpn.name} · ${ws.dice_count}d${ws.dice_type}${rng}`,
      cost: 'Action',
      cls: 'atk',
    }));
  }

  const offensiveAbs = activeAbs.filter(a => {
    const effects = Array.isArray(a.effect) ? a.effect : (a.effect && Array.isArray(a.effect.effects) ? a.effect.effects : []);
    return a.requires_hit_roll || a.damage_dice_count || effects.some(e => e?.type === 'damage');
  });
  const supportAbs = activeAbs.filter(a => !offensiveAbs.includes(a));
  const abilityRows = offensiveAbs.map(a => _dockActionRow({
    icon: a.icon || '✨',
    name: a.name,
    meta: a.flavor_text || a.description || (a.damage_dice_count ? `${a.damage_dice_count}d${a.damage_dice_type} ${a.damage_type || ''}` : ''),
    cost: [a.mana_cost ? `${a.mana_cost} Mana` : '', a.cooldown_remaining ? `CD ${a.cooldown_remaining}` : a.cooldown_turns ? `CD ${a.cooldown_turns}` : '', a.current_uses != null ? `${a.current_uses}/${a.max_uses || ''} uses` : ''].filter(Boolean).join('<br>'),
    cls: a.damage_dice_count ? 'magic' : 'atk',
    data: `data-action-ability-id="${a.character_ability_id}"`,
  }));
  const itemRows = useables.map(i => _dockActionRow({
    icon: CATEGORY_ICONS[i.category] || '🎒',
    name: i.name,
    meta: i.description || 'Usable item',
    cost: i.quantity > 1 ? `×${i.quantity}` : 'Item',
    cls: 'item',
    data: `data-action-item-id="${i.inventory_id}"`,
  }));

  body.innerHTML = (basicRows.length || abilityRows.length || itemRows.length)
    ? [
        _dockSection('Basic Actions', basicRows),
        _dockSection('Abilities', abilityRows),
        _dockSection('Items', itemRows),
      ].join('')
    : '<span class="text-muted" style="font-size:0.82rem;padding:8px">No actions available — equip a weapon, learn an ability, or get items</span>';

  if (supportEl) {
    const potionRows = potions.map(i => _dockActionRow({
      icon: (i.is_potion && i.potion_icon) ? i.potion_icon : '🧪',
      name: i.name,
      meta: i.description || 'Consumable',
      cost: i.quantity > 1 ? `×${i.quantity}` : 'Use',
      cls: 'heal',
      data: `data-action-potion-id="${i.inventory_id}"`,
    }));
    const supportRows = supportAbs.map(a => _dockActionRow({
      icon: a.icon || '💚',
      name: a.name,
      meta: a.flavor_text || a.description || 'Support ability',
      cost: [a.mana_cost ? `${a.mana_cost} Mana` : '', a.cooldown_remaining ? `CD ${a.cooldown_remaining}` : a.cooldown_turns ? `CD ${a.cooldown_turns}` : '', a.current_uses != null ? `${a.current_uses}/${a.max_uses || ''} uses` : ''].filter(Boolean).join('<br>'),
      cls: 'heal',
      data: `data-action-ability-id="${a.character_ability_id}"`,
    }));
    supportEl.innerHTML = [
      _dockSection('Healing & Support', supportRows),
      _dockSection('Consumables', potionRows),
    ].join('') || '<div class="text-muted" style="font-size:0.78rem;padding:8px">No support actions available.</div>';
  }

  // Hover / click styling
  body.querySelectorAll('.action-card').forEach(el => {
    el.addEventListener('mouseenter', () => { el.style.borderColor = 'var(--accent)'; });
    el.addEventListener('mouseleave', () => { el.style.borderColor = 'var(--border)'; });
  });

  const atkBtn   = body.querySelector('#action-attack');
  if (atkBtn)  atkBtn.addEventListener('click',   () => openAttackConfirm(wpn));
  document.querySelectorAll('[data-action-ability-id]').forEach(el => {
    el.addEventListener('click', () => {
      const caId = parseInt(el.dataset.actionAbilityId);
      const ab = abilitiesData.find(a => a.character_ability_id === caId);
      if (!ab) return;
      const panel = _mountConfirmPanel(`<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px"><span style="font-size:1.2rem">${ab.icon || '✨'}</span><span style="font-weight:700;flex:1">${ab.name}</span><button class="btn btn-ghost btn-xs" id="ap-close">✕</button></div><div id="ap-confirm-area"></div>`);
      if (!panel) return;
      panel.querySelector('#ap-close').addEventListener('click', _closeConfirmPanel);
      _mountAbilityConfirm(panel, ab);
    });
  });
  document.querySelectorAll('[data-action-potion-id]').forEach(el => {
    el.addEventListener('click', () => openItemPicker(potions, 'Potions', '🧪'));
  });
  document.querySelectorAll('[data-action-item-id]').forEach(el => {
    el.addEventListener('click', () => openItemPicker(useables, 'Use Item', '🎒'));
  });
}

// ── Attack confirmation panel (two-step: Hit → Damage) ───────
function openAttackConfirm(wpn) {
  if (!wpn) return;
  if (!selectedTargetId) {
    // Inline warning instead of modal
    const body = $('#action-menu-body');
    if (!body) return;
    const existing = document.getElementById('action-inline-warn');
    if (existing) existing.remove();
    const warn = document.createElement('div');
    warn.id = 'action-inline-warn';
    warn.style.cssText = 'width:100%;padding:6px 10px;margin-top:4px;background:rgba(184,64,64,0.12);border:1px solid var(--accent-red);border-radius:var(--r-sm);color:#e07878;font-size:0.78rem';
    warn.innerHTML = '⚠️ Select a target first (tap an NPC card at the table above)';
    body.appendChild(warn);
    setTimeout(() => warn.remove(), 4000);
    return;
  }
  const target = tableParticipants.find(c => c.id === selectedTargetId);
  const wpnStats = wpn.weapon_stats || { dice_count: 1, dice_type: 6 };
  const html = `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
      <span style="font-size:1.2rem">⚔️</span>
      <span style="font-weight:700;flex:1">Attack: ${target ? target.name : '?'}</span>
      <button class="btn btn-ghost btn-xs" id="ac-cancel">✕</button>
    </div>
    <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:6px">
      Weapon: <strong style="color:var(--text-primary)">${wpn.name}</strong>
    </div>

    <!-- STEP 1: HIT ROLL -->
    <div id="ac-step1">
      <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:4px;font-weight:600">🎯 Step 1 — Roll to Hit (d20)</div>
      <div id="ac-hit-adv-host" style="margin-bottom:6px"></div>
      <div style="display:flex;gap:6px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" id="ac-cancel-2">Cancel</button>
        <button class="btn btn-primary btn-sm" id="ac-roll-hit">🎯 Roll Hit</button>
      </div>
    </div>

    <!-- STEP 2: DAMAGE ROLL (hidden until hit confirmed) -->
    <div id="ac-step2" style="display:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
      <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:4px;font-weight:600">💥 Step 2 — Roll Damage</div>
      <div id="ac-dmg-widget" style="margin-bottom:6px"></div>
      <div style="display:flex;gap:6px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" id="ac-cancel-3">Cancel</button>
        <button class="btn btn-primary btn-sm" id="ac-roll-dmg">💥 Roll Damage</button>
      </div>
    </div>

    <div id="ac-result" style="margin-top:8px;font-size:0.78rem"></div>
  `;
  const panel = _mountConfirmPanel(html);
  if (!panel) return;

  // ── Hit roll advantage toggle + dice-count stepper (Rework v3) ──
  const hitAdvHost = panel.querySelector('#ac-hit-adv-host');
  let hitState = { advantageMode: 'normal', diceCount: 1 };
  function _renderHitAdv() {
    hitAdvHost.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:0.72rem;color:var(--text-muted)">Mode:</span>
        <div class="adv-toggle" id="ac-hit-adv">
          <button data-mode="disadvantage" class="${hitState.advantageMode==='disadvantage'?'active':''}">Disadv</button>
          <button data-mode="normal" class="${hitState.advantageMode==='normal'?'active':''}">Normal</button>
          <button data-mode="advantage" class="${hitState.advantageMode==='advantage'?'active':''}">Adv</button>
        </div>
        <div style="display:inline-flex;align-items:center;gap:4px">
          <span style="font-size:0.72rem;color:var(--text-muted)">🎲 ×</span>
          <button type="button" class="btn btn-ghost btn-xs" id="ac-hit-dice-minus" style="padding:0 6px">−</button>
          <span id="ac-hit-dice-count" style="font-weight:600;min-width:10px;text-align:center">${hitState.diceCount}</span>
          <button type="button" class="btn btn-ghost btn-xs" id="ac-hit-dice-plus" style="padding:0 6px">+</button>
        </div>
      </div>`;
    hitAdvHost.querySelectorAll('#ac-hit-adv button').forEach(b => {
      b.addEventListener('click', () => {
        hitState.advantageMode = b.dataset.mode;
        if (hitState.advantageMode !== 'normal' && hitState.diceCount < 2) hitState.diceCount = 2;
        _renderHitAdv();
      });
    });
    const step = (d) => {
      const min = hitState.advantageMode === 'normal' ? 1 : 2;
      hitState.diceCount = Math.max(min, Math.min(ADV_DICE_CAP, hitState.diceCount + d));
      _renderHitAdv();
    };
    hitAdvHost.querySelector('#ac-hit-dice-minus').addEventListener('click', () => step(-1));
    hitAdvHost.querySelector('#ac-hit-dice-plus').addEventListener('click', () => step(+1));
  }
  _renderHitAdv();

  // ── Damage dice widget state (mounted after hit roll) ──
  //    Rework v3: dice_count/type are FIXED by weapon; if the weapon defines
  //    preset damage_modes, the player picks one via modeIndex instead.
  let dmgState = {
    diceCount: wpnStats.dice_count,
    diceType: wpnStats.dice_type,
    damageModes: (wpnStats.damage_modes || []),
    modeIndex: (wpnStats.damage_modes && wpnStats.damage_modes.length ? 0 : null),
    advantageMode: 'normal',
  };
  let hitData = null; // stored after Step 1

  const closePanel = () => _closeConfirmPanel();
  panel.querySelector('#ac-cancel').addEventListener('click', closePanel);
  panel.querySelector('#ac-cancel-2').addEventListener('click', closePanel);
  panel.querySelector('#ac-cancel-3').addEventListener('click', closePanel);

  // STEP 1: Roll Hit
  panel.querySelector('#ac-roll-hit').addEventListener('click', async () => {
    const resultEl = panel.querySelector('#ac-result');
    const rollBtn = panel.querySelector('#ac-roll-hit');
    rollBtn.disabled = true;
    resultEl.innerHTML = '<span class="text-muted">Rolling d20...</span>';
    try {
      const res = await api.post('/api/combat/hit-roll', {
        attacker_id: CHAR_ID,
        target_id:   selectedTargetId,
        advantage:   hitState.advantageMode,
        hit_dice_count: hitState.diceCount,
      });
      hitData = res;
      let out = '';
      if (res.hit) {
        out += `<div style="color:var(--accent-green);font-weight:700">${res.critical ? '🎯 CRITICAL HIT!' : '⚔️ HIT!'}</div>`;
      } else {
        out += `<div style="color:var(--accent-red);font-weight:700">${res.fumble ? '💨 FUMBLE' : '🛡️ MISS'}</div>`;
      }
      out += `<div>${res.hit_breakdown}</div>`;
      resultEl.innerHTML = out;
      addLog(`⚔️ ${res.hit_breakdown}`);

      // WS broadcast: hit result (no damage yet)
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({
          type: 'combat.hit_result',
          attacker_id: CHAR_ID, attacker_name: char.name,
          target_id:   selectedTargetId, target_name: res.target_name,
          hit: res.hit, critical: res.critical, fumble: res.fumble,
          hit_breakdown: res.hit_breakdown,
        }));
      }

      if (res.hit) {
        if (res.pending_defense_id) {
          // Defense reaction: pause the flow, store state for resume after resolution
          resultEl.innerHTML += '<div style="margin-top:4px;color:var(--accent)">⏳ Waiting for target defense...</div>';
          _pendingAttackState = { panel, hitData: res, selectedTargetId, dmgState };
        } else {
          // No defense needed (crit or miss already handled) → show step 2 immediately
          panel.querySelector('#ac-step1').style.display = 'none';
          const step2 = panel.querySelector('#ac-step2');
          step2.style.display = '';
          // Defaults from server response (reflects equipped weapon)
          dmgState.diceCount = res.default_dice_count || wpnStats.dice_count;
          dmgState.diceType  = res.default_dice_type  || wpnStats.dice_type;
          // Rework v3: server returns preset damage_modes if the weapon has them.
          if (Array.isArray(res.damage_modes) && res.damage_modes.length) {
            dmgState.damageModes = res.damage_modes;
            if (dmgState.modeIndex == null) dmgState.modeIndex = 0;
          } else {
            dmgState.damageModes = [];
            dmgState.modeIndex = null;
          }
          _mountDmgWidget(panel, dmgState);
        }
      } else {
        // Miss/fumble — close after delay via final button
        rollBtn.disabled = false;
        rollBtn.textContent = '🎯 Re-roll Hit';
      }
    } catch (e) {
      rollBtn.disabled = false;
      const d = e?.body?.detail;
      resultEl.innerHTML = `<span style="color:var(--accent-red)">${typeof d === 'object' ? (d.message || JSON.stringify(d)) : (d || 'Hit roll failed')}</span>`;
    }
  });

  // STEP 2: Roll Damage
  panel.querySelector('#ac-roll-dmg').addEventListener('click', async () => {
    if (!hitData || !hitData.hit) return;
    const resultEl = panel.querySelector('#ac-result');
    const rollBtn = panel.querySelector('#ac-roll-dmg');
    rollBtn.disabled = true;
    resultEl.innerHTML = (resultEl.innerHTML || '') + '<div class="text-muted">Rolling damage...</div>';
    try {
      const res = await api.post('/api/combat/damage-roll', {
        attacker_id: CHAR_ID,
        target_id:   selectedTargetId,
        critical:    !!hitData.critical,
        // Rework v3: damage dice are fixed by the weapon. Only pass mode index.
        damage_mode_index: dmgState.modeIndex,
        advantage:   dmgState.advantageMode || 'normal',
      });
      let out = '';
      if (hitData.critical) {
        out += `<div style="color:var(--accent-green);font-weight:700">🎯 CRITICAL HIT!</div>`;
      } else {
        out += `<div style="color:var(--accent-green);font-weight:700">⚔️ HIT!</div>`;
      }
      out += `<div>${hitData.hit_breakdown}</div>`;
      out += `<div>${res.damage_breakdown}</div>`;
      out += `<div>${res.intake_breakdown}</div>`;
      out += `<div style="font-weight:600;margin-top:3px">${res.target_name}: <span style="color:var(--accent-red)">${res.final_damage} dmg</span> → ${res.target_hp_after} HP${res.target_downed ? ' 💀 DOWN!' : ''}</div>`;
      resultEl.innerHTML = out;
      addLog(`💥 ${res.damage_breakdown}`);
      addLog(`🛡️ ${res.intake_breakdown}`);
      if (res.target_downed) addLog(`💀 ${res.target_name} is DOWN!`);

      // WS broadcast: full attack result
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({
          type: 'combat.attack_result',
          attacker_id: CHAR_ID, attacker_name: char.name,
          target_id:   selectedTargetId, target_name: res.target_name,
          hit: true, critical: !!hitData.critical, fumble: false,
          final_damage: res.final_damage, target_hp_after: res.target_hp_after,
        }));
      }
      await loadChar();
      loadTableView();
    } catch (e) {
      rollBtn.disabled = false;
      const d = e?.body?.detail;
      resultEl.innerHTML += `<div style="color:var(--accent-red)">${typeof d === 'object' ? (d.message || JSON.stringify(d)) : (d || 'Damage roll failed')}</div>`;
    }
  });
}

// Rework v3: damage dice are LOCKED by the weapon.
//   * No damage_modes → render read-only "1d6 physical".
//   * Has damage_modes → render a dropdown of preset modes.
// Player can still pick adv/disadv on the damage roll.
function _mountDmgWidget(panel, dmgState) {
  const host = panel.querySelector('#ac-dmg-widget');
  if (!host) return;
  const modes = Array.isArray(dmgState.damageModes) ? dmgState.damageModes : [];
  dmgState.advantageMode = dmgState.advantageMode || 'normal';

  if (modes.length > 0) {
    if (dmgState.modeIndex == null) dmgState.modeIndex = 0;
    host.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:6px">
        <label style="font-size:0.72rem;color:var(--text-muted)">Damage Mode:</label>
        <select id="ac-dmg-mode" style="font-size:0.85rem">
          ${modes.map((m, i) => `<option value="${i}"${i===dmgState.modeIndex?' selected':''}>${m.name} — ${m.dice_count}d${m.dice_type} ${m.damage_type || ''}</option>`).join('')}
        </select>
        <div style="display:flex;gap:6px;align-items:center">
          <span style="font-size:0.72rem;color:var(--text-muted)">Adv:</span>
          <div class="adv-toggle" id="ac-dmg-adv">
            <button data-mode="disadvantage" class="${dmgState.advantageMode==='disadvantage'?'active':''}">Disadv</button>
            <button data-mode="normal" class="${dmgState.advantageMode==='normal'?'active':''}">Normal</button>
            <button data-mode="advantage" class="${dmgState.advantageMode==='advantage'?'active':''}">Adv</button>
          </div>
        </div>
      </div>`;
    host.querySelector('#ac-dmg-mode').addEventListener('change', e => {
      dmgState.modeIndex = parseInt(e.target.value) || 0;
    });
  } else {
    // Single-mode weapon — read-only display.
    host.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:6px">
        <div style="font-size:0.8rem">Damage: <strong>${dmgState.diceCount}d${dmgState.diceType}</strong> <span style="color:var(--text-muted)">(fixed by weapon)</span></div>
        <div style="display:flex;gap:6px;align-items:center">
          <span style="font-size:0.72rem;color:var(--text-muted)">Adv:</span>
          <div class="adv-toggle" id="ac-dmg-adv">
            <button data-mode="disadvantage" class="${dmgState.advantageMode==='disadvantage'?'active':''}">Disadv</button>
            <button data-mode="normal" class="${dmgState.advantageMode==='normal'?'active':''}">Normal</button>
            <button data-mode="advantage" class="${dmgState.advantageMode==='advantage'?'active':''}">Adv</button>
          </div>
        </div>
      </div>`;
  }
  host.querySelectorAll('#ac-dmg-adv button').forEach(b => {
    b.addEventListener('click', () => {
      host.querySelectorAll('#ac-dmg-adv button').forEach(x => x.classList.toggle('active', x === b));
      dmgState.advantageMode = b.dataset.mode;
    });
  });
}

// ── Ability picker confirmation panel ─────────────────────────
function openAbilityPicker(ablist) {
  if (!ablist || !ablist.length) { showToast('No ready abilities'); return; }
  const cur = char?.mana_current ?? 0;
  const html = `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
      <span style="font-size:1.2rem">✨</span>
      <span style="font-weight:700;flex:1">Choose an Ability</span>
      <button class="btn btn-ghost btn-xs" id="ap-close">✕</button>
    </div>
    <div id="ap-list" style="display:flex;flex-direction:column;gap:4px;max-height:240px;overflow-y:auto">
      ${(abilitiesData || []).filter(a => a.ability_type !== 'passive' && a.is_unlocked !== false).map(a => {
        const onCd = (a.cooldown_remaining || 0) > 0;
        const notEnoughMana = (a.mana_cost || 0) > cur;
        const disabled = onCd || notEnoughMana;
        const color = a.color || 'var(--accent)';
        return `<div class="ap-item ${disabled ? 'disabled' : ''}" data-ca-id="${a.character_ability_id}"
                 style="padding:6px 8px;background:var(--bg-surface);border-left:3px solid ${color};
                        border-radius:var(--r-sm);cursor:${disabled ? 'not-allowed' : 'pointer'};
                        opacity:${disabled ? '0.5' : '1'};transition:background .15s">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:1rem">${a.icon || '⚡'}</span>
            <strong style="flex:1;font-size:0.82rem">${a.name}</strong>
            ${a.ability_type === 'reaction' ? '<span style="font-size:0.6rem;color:#f59e0b">reaction</span>' : ''}
            ${a.mana_cost ? `<span style="font-size:0.7rem;color:${notEnoughMana ? 'var(--accent-red)' : '#60a5fa'}">🔮${a.mana_cost}</span>` : ''}
            ${a.hp_cost ? `<span style="font-size:0.7rem;color:var(--accent-red)">❤️${a.hp_cost}</span>` : ''}
            ${onCd ? `<span style="font-size:0.7rem;color:var(--accent-orange)">⏳${a.cooldown_remaining}t</span>` : ''}
          </div>
          ${a.flavor_text ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px">${a.flavor_text}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
    <div id="ap-confirm-area" style="margin-top:8px"></div>
  `;
  const panel = _mountConfirmPanel(html);
  if (!panel) return;

  panel.querySelector('#ap-close').addEventListener('click', _closeConfirmPanel);

  panel.querySelectorAll('.ap-item:not(.disabled)').forEach(el => {
    el.addEventListener('click', () => {
      const caId = parseInt(el.dataset.caId);
      const ab = abilitiesData.find(a => a.character_ability_id === caId);
      if (!ab) return;
      _mountAbilityConfirm(panel, ab);
    });
  });
}

function _mountAbilityConfirm(panel, ab) {
  const area = panel.querySelector('#ap-confirm-area');
  if (!area) return;
  // Rework v3 — classify the ability by its effects to show the right targets.
  //   * Offensive (requires hit-roll OR has a damage dice/effect) → enemies only (NPCs).
  //   * Supportive (heal / restore mana / buff / cleanse / ...)   → allies + self.
  //   * Mixed or unknown                                          → everyone living.
  const _effList = Array.isArray(ab.effect) ? ab.effect
    : (ab.effect && Array.isArray(ab.effect.effects)) ? ab.effect.effects : [];
  const _hasDamage = _effList.some(e => e && e.type === 'damage')
                  || !!(ab.damage_dice_count && ab.damage_dice_type);
  const _hasSupport = _effList.some(e => e && [
    'heal_hp','restore_mana','restore_hp_by_die',
    'stat_boost','apply_status','remove_status',
  ].includes(e.type));
  const _isOffensive = !!ab.requires_hit_roll || (_hasDamage && !_hasSupport);
  // Rework v3 Phase 7 bug fix — previously `needsTarget` was strictly
  // `target_type === 'single'`, which meant abilities with
  // `target_type='aoe'` (very easy to pick in the creator) skipped the
  // target dropdown and silently fell back to `target_id = null` on
  // the server — where the damage was then applied to the CASTER
  // instead of the intended enemy. Until we grow a proper AoE picker
  // (area-on-map), ALL non-self / non-none abilities prompt for a
  // primary target. Passive abilities still opt out of the picker.
  const needsTarget = !ab.is_passive
                   && ab.target_type !== 'self'
                   && ab.target_type !== 'none';

  let targets;
  if (_isOffensive) {
    targets = (tableParticipants || []).filter(t => t.is_npc && t.is_alive !== false);
  } else if (_hasSupport && !_hasDamage) {
    const allies = (tableParticipants || [])
      .filter(t => !t.is_npc && t.id !== CHAR_ID && t.is_alive !== false);
    targets = [{ id: CHAR_ID, name: (char?.name || 'Self'), _self: true }, ...allies];
  } else {
    const others = (tableParticipants || [])
      .filter(t => t.id !== CHAR_ID && t.is_alive !== false);
    targets = [{ id: CHAR_ID, name: (char?.name || 'Self'), _self: true }, ...others];
  }
  const costLine = [
    ab.mana_cost ? `🔮 ${ab.mana_cost} mana` : null,
    ab.hp_cost   ? `❤️ ${ab.hp_cost} HP` : null,
    ab.cooldown_turns ? `⏳ CD ${ab.cooldown_turns}t` : null,
    // Rework v3 Phase 7: show range so the player knows the reach.
    (ab.range_cells != null && ab.target_type !== 'self') ? `📏 ${ab.range_cells} cells` : null,
  ].filter(Boolean).join(' · ');

  // Rework Phase 6: state across the two-step flow
  const state = {
    hit_roll: null,      // { total, hit, critical, breakdown }
    damage_roll: null,   // { dice_count, dice_type, rolls, total }
  };
  const needsHit = !!ab.requires_hit_roll;
  const hasDamageDice = !!(ab.damage_dice_count && ab.damage_dice_type);
  const hitStatLabel = (ab.hit_stat || '').slice(0, 3).toUpperCase() || 'STAT';
  const dmgStatLabel = (ab.damage_stat || '').slice(0, 3).toUpperCase() || '';

  // Compute character stat value for hit bonus (direct per Rework Phase 2)
  const statVal = (char && ab.hit_stat && typeof char[ab.hit_stat] === 'number') ? char[ab.hit_stat] : 0;
  const dmgStatVal = (char && ab.damage_stat && typeof char[ab.damage_stat] === 'number') ? char[ab.damage_stat] : 0;

  area.innerHTML = `
    <div style="padding:8px;background:var(--bg-surface);border-radius:var(--r-sm);border:1px solid var(--border-active)">
      <div style="font-weight:700;margin-bottom:3px">${ab.icon || '⚡'} ${ab.name}</div>
      ${ab.flavor_text ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:4px">${ab.flavor_text}</div>` : ''}
      ${costLine ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:6px">${costLine}</div>` : ''}
      ${needsTarget ? `<div style="margin-bottom:6px">
        <label style="font-size:0.75rem">Target:
          <select id="ap-target" style="font-size:0.8rem;margin-left:4px;min-width:140px">
            ${(() => {
              if (!targets.length) return '<option value="">(no targets)</option>';
              // Prefer the currently selected table target; else first option in the list.
              const picked = targets.find(t => t.id === selectedTargetId) || targets[0];
              return targets.map(t => {
                const lbl = t._self ? `Self (${t.name})`
                          : (t.is_npc ? `🎭 ${t.name}` : `👤 ${t.name}`);
                return `<option value="${t.id}"${t.id === picked.id ? ' selected' : ''}>${lbl}</option>`;
              }).join('');
            })()}
          </select>
        </label>
      </div>` : ''}
      ${needsHit ? `
        <div style="margin-bottom:8px">
          <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:3px">Step 1 — Hit roll (+${statVal} ${hitStatLabel})</div>
          <div id="ap-hit-widget"></div>
          <div id="ap-hit-result" style="margin-top:4px;font-size:0.78rem"></div>
        </div>` : ''}
      ${hasDamageDice ? `
        <div style="margin-bottom:8px">
          <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:3px">${needsHit ? 'Step 2' : 'Step'} — Effect roll${dmgStatLabel ? ` (+${dmgStatVal} ${dmgStatLabel})` : ''}</div>
          <div id="ap-dmg-widget"></div>
          <div id="ap-dmg-result" style="margin-top:4px;font-size:0.78rem"></div>
        </div>` : ''}
      <div style="display:flex;gap:6px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" id="ap-back">← Back</button>
        <button class="btn btn-primary btn-sm" id="ap-use"${needsHit || hasDamageDice ? ' disabled' : ''}>Use</button>
      </div>
      <div id="ap-result" style="margin-top:6px;font-size:0.78rem"></div>
    </div>`;

  // Wire widgets
  const useBtn = area.querySelector('#ap-use');
  const refreshUseButton = () => {
    const hitReady = !needsHit || !!state.hit_roll;
    const dmgReady = !hasDamageDice || !!state.damage_roll || (state.hit_roll && state.hit_roll.hit === false);
    useBtn.disabled = !(hitReady && dmgReady);
  };

  if (needsHit && typeof createDiceRollWidget === 'function') {
    // Rework v3 — parity with the regular Attack panel:
    // the player may roll N×d20 for the hit check. ADV/DIS interpret
    // "N dice" as a pool — take the highest (ADV) or lowest (DIS) of
    // the whole pool. With Normal mode a pool > 1 is still permitted
    // (e.g. "Superior advantage" house rules) but only the first die
    // is used, so the UX mirrors `makeAdvToggle`'s stepper behaviour.
    // The *dice type* is always d20 and is locked by `fixedDiceType`.
    createDiceRollWidget(area.querySelector('#ap-hit-widget'), {
      label: `Attack d20${statVal ? ` + ${statVal} ${hitStatLabel}` : ''}`,
      defaultDiceCount: 1, defaultDiceType: 20,
      showDiceSelector: true, fixedDiceType: 20, showAdvantage: true,
      onRoll: async ({ diceCount, advantageMode }) => {
        const n = Math.max(1, Math.min(20, diceCount | 0));
        const all = [];
        for (let i = 0; i < n; i++) all.push(1 + Math.floor(Math.random() * 20));
        let chosen;
        if (advantageMode === 'advantage')       chosen = Math.max(...all);
        else if (advantageMode === 'disadvantage') chosen = Math.min(...all);
        else                                      chosen = all[0];
        const total = chosen + statVal;
        const fumble = chosen === 1;
        const crit = chosen === 20;
        // Determine target AC for hit verdict
        const tgtId = needsTarget ? parseInt(area.querySelector('#ap-target')?.value || '') : null;
        const tgt = tgtId ? (tableParticipants||[]).find(t => t.id === tgtId) : null;
        const ac = tgt?.armor_class ?? 10;
        const hit = fumble ? false : (crit || total >= ac);
        const poolTag = n > 1
          ? `${advantageMode === 'advantage' ? 'ADV' : advantageMode === 'disadvantage' ? 'DIS' : 'POOL'}[${all.join(',')}] took ${chosen} · `
          : '';
        const bd = `${poolTag}D20(${chosen}) + ${hitStatLabel}(${statVal >= 0 ? '+' : ''}${statVal}) = ${total} vs AC ${ac} → ${fumble ? 'FUMBLE' : crit ? 'CRIT' : hit ? 'HIT' : 'MISS'}`;
        state.hit_roll = { total, hit, critical: crit, fumble, breakdown: bd };
        const resEl = area.querySelector('#ap-hit-result');
        if (resEl) resEl.innerHTML = `<span style="color:${hit ? 'var(--accent-green)' : 'var(--accent-red)'}">${bd}</span>`;
        refreshUseButton();
        return { total, breakdown: bd };
      },
      resultFormatter: r => r.breakdown || '',
    });
  }

  if (hasDamageDice && typeof createDiceRollWidget === 'function') {
    // Rework v3 — damage dice count & die type are authored by the GM
    // on the Ability template (`ab.damage_dice_count` / `_type`). The
    // player must NOT be able to inflate their own damage by bumping
    // these in the widget, so we lock both: `lockDiceCount` makes the
    // count input readonly, `fixedDiceType` disables the die dropdown.
    createDiceRollWidget(area.querySelector('#ap-dmg-widget'), {
      label: `Effect ${ab.damage_dice_count}d${ab.damage_dice_type}${dmgStatVal ? ` + ${dmgStatVal} ${dmgStatLabel}` : ''}`,
      defaultDiceCount: ab.damage_dice_count || 1,
      defaultDiceType: ab.damage_dice_type || 6,
      showDiceSelector: true, showAdvantage: true,
      lockDiceCount: true, fixedDiceType: ab.damage_dice_type || 6,
      onRoll: async ({ diceCount, diceType, advantageMode }) => {
        const rollOnce = () => {
          const rolls = [];
          let actual = diceCount;
          if (state.hit_roll && state.hit_roll.critical) actual = diceCount * 2;
          for (let i = 0; i < actual; i++) rolls.push(1 + Math.floor(Math.random() * diceType));
          return { rolls, sum: rolls.reduce((a, b) => a + b, 0) };
        };
        const r1 = rollOnce();
        let chosen = r1, all = [r1];
        if (advantageMode === 'advantage' || advantageMode === 'disadvantage') {
          const r2 = rollOnce();
          all = [r1, r2];
          chosen = advantageMode === 'advantage' ? (r1.sum >= r2.sum ? r1 : r2) : (r1.sum <= r2.sum ? r1 : r2);
        }
        const total = chosen.sum + dmgStatVal;
        const advTag = advantageMode !== 'normal' ? `${advantageMode === 'advantage' ? 'ADV' : 'DIS'} took ${chosen.sum} · ` : '';
        const crTag = (state.hit_roll && state.hit_roll.critical) ? 'CRIT×2 ' : '';
        const bd = `${advTag}${crTag}${chosen.rolls.length}d${diceType}[${chosen.rolls.join(',')}]=${chosen.sum}${dmgStatVal ? ` + ${dmgStatVal} ${dmgStatLabel}` : ''} = ${total}`;
        state.damage_roll = { dice_count: diceCount, dice_type: diceType, rolls: chosen.rolls, total };
        const resEl = area.querySelector('#ap-dmg-result');
        if (resEl) resEl.innerHTML = `<span style="color:var(--accent)">${bd}</span>`;
        refreshUseButton();
        return { total, breakdown: bd };
      },
      resultFormatter: r => r.breakdown || '',
    });
  }

  area.querySelector('#ap-back').addEventListener('click', () => openAbilityPicker(abilitiesData));
  useBtn.addEventListener('click', async () => {
    const resultEl = area.querySelector('#ap-result');
    const tgt = needsTarget ? parseInt(area.querySelector('#ap-target')?.value || '') : null;
    if (needsTarget && !tgt) { resultEl.innerHTML = '<span style="color:var(--accent-red)">Pick a target</span>'; return; }
    resultEl.innerHTML = '<span class="text-muted">Using...</span>';
    try {
      const body = {};
      if (tgt) body.target_id = tgt;
      if (state.hit_roll)    body.hit_roll = state.hit_roll;
      if (state.damage_roll) {
        body.override_dice_count = state.damage_roll.dice_count;
        body.override_dice_type  = state.damage_roll.dice_type;
      }
      const res = await api.post(`/api/character-abilities/${ab.character_ability_id}/use`, body);
      let out = '';
      if (res.results && res.results.length) {
        out = res.results.map(r => `<div>• ${r}</div>`).join('');
        res.results.forEach(r => addLog(`✨ ${ab.name}: ${r}`));
      } else {
        out = '<div>✅ Ability used</div>';
      }
      resultEl.innerHTML = out;

      // Defense reaction: if server deferred damage, store state and wait
      if (res.pending_defense_id) {
        _pendingAbilityState = { area, ab, state, tgt };
        resultEl.innerHTML += '<div style="margin-top:4px;color:var(--accent)">⏳ Waiting for target defense...</div>';
        await loadChar();
        await loadAbilities();
        loadTableView();
        return;
      }

      // ── Combat FX + broadcast ─────────────────────────────────
      // Play a local animation and notify the rest of the table so
      // every client sees the same hit/miss/crit ring. We keep the
      // payload schema compatible with `combat.attack_result` so the
      // same renderer (`_playCombatFxFromPayload`) handles both.
      if (tgt) {
        const fxPayload = {
          attacker_id: CHAR_ID,
          attacker_name: char && char.name,
          target_id: tgt,
          target_name: (tableParticipants || []).find(t => t.id === tgt)?.name || null,
          hit:      state.hit_roll ? !!state.hit_roll.hit      : true,
          critical: state.hit_roll ? !!state.hit_roll.critical : false,
          fumble:   state.hit_roll ? !!state.hit_roll.fumble   : false,
          // Server returns the actual applied damage (post-resistances)
          // in `damage_applied` when the ability dealt HP damage.
          final_damage: res.damage_applied ?? res.final_damage ?? null,
        };
        _playCombatFxFromPayload(fxPayload);
        if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
          ws.ws.send(JSON.stringify({
            type: 'combat.ability_result',
            ...fxPayload,
            ability_name: ab.name,
          }));
        }
      }
      await loadChar();
      await loadAbilities();
      loadTableView();
    } catch (e) {
      const d = e?.body?.detail;
      resultEl.innerHTML = `<span style="color:var(--accent-red)">${typeof d === 'object' ? (d.message || JSON.stringify(d)) : (d || 'Failed')}</span>`;
    }
  });
}

// ── Potion / Use-Item picker confirmation panel ─────────────
function openItemPicker(items, title, icon) {
  if (!items || !items.length) return;
  const html = `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
      <span style="font-size:1.2rem">${icon}</span>
      <span style="font-weight:700;flex:1">${title}</span>
      <button class="btn btn-ghost btn-xs" id="ip-close">✕</button>
    </div>
    <div id="ip-list" style="display:flex;flex-direction:column;gap:4px;max-height:240px;overflow-y:auto">
      ${items.map(it => {
        const rarityCls = it.rarity ? ` rarity-${it.rarity}` : '';
        const rarityBorder = it.rarity ? `var(--rarity-${it.rarity}, var(--border))` : 'var(--border)';
        const effDesc = _summarizeUseEffect(it);
        // FIX 6: per-item potion icon
        const itIcon = (it.is_potion && it.potion_icon) ? it.potion_icon : '';
        return `<div class="ip-item" data-inv-id="${it.inventory_id}"
                 style="padding:6px 8px;background:var(--bg-surface);border:1px solid var(--border);
                        border-left:3px solid ${rarityBorder};
                        border-radius:var(--r-sm);cursor:pointer;transition:all .15s">
          <div style="display:flex;align-items:center;gap:6px">
            ${itIcon ? `<span style="font-size:1rem">${itIcon}</span>` : ''}
            <strong class="${rarityCls}" style="flex:1;font-size:0.82rem">${it.name}</strong>
            <span style="font-size:0.7rem;color:var(--text-muted)">×${it.quantity}</span>
            ${it.mana_cost ? `<span style="font-size:0.7rem;color:#60a5fa">🔮${it.mana_cost}</span>` : ''}
          </div>
          ${effDesc ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px">${effDesc}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
    <div id="ip-confirm-area" style="margin-top:8px"></div>
  `;
  const panel = _mountConfirmPanel(html);
  if (!panel) return;
  panel.querySelector('#ip-close').addEventListener('click', _closeConfirmPanel);
  panel.querySelectorAll('.ip-item').forEach(el => {
    el.addEventListener('click', () => {
      const invId = parseInt(el.dataset.invId);
      const it = items.find(x => x.inventory_id === invId);
      if (!it) return;
      _mountItemConfirm(panel, it);
    });
  });
}

function _summarizeUseEffect(it) {
  // Derive a short human description of what the item does
  // Supports both new dice-based effect format (FIX 6) and legacy flat format.
  try {
    const ue = it.use_effect;
    if (!ue) {
      if (it.effect_type && it.effect_value) return `${it.effect_type}: ${it.effect_value}`;
      return it.description || '';
    }
    const effs = Array.isArray(ue) ? ue : (ue.effects || []);
    const parts = effs.map(e => {
      // New dice-based formats
      if (e.type === 'heal_hp') {
        const dc = e.dice_count, dt = e.dice_type, fb = e.flat_bonus || 0;
        if (dc && dt) return `+${dc}d${dt}${fb ? (fb > 0 ? '+' + fb : fb) : ''} HP`;
        return e.value ? `+${e.value} HP` : '+HP';
      }
      if (e.type === 'damage') {
        const dc = e.dice_count, dt = e.dice_type, fb = e.flat_bonus || 0;
        if (dc && dt) return `-${dc}d${dt}${fb ? (fb > 0 ? '+' + fb : fb) : ''} HP`;
        return e.value ? `-${e.value} HP` : '-HP';
      }
      if (e.type === 'restore_mana') return `+${e.amount ?? e.value ?? 0} mana`;
      if (e.type === 'stat_boost')   return `+${e.value} ${e.stat} (${e.duration_turns || '?'}t)`;
      if (e.type === 'apply_status') return `apply status${e.duration_turns ? ` (${e.duration_turns}t)` : ''}`;
      if (e.type === 'remove_status') return `remove ${e.status_name || 'status'}`;
      if (e.type === 'custom')       return e.description || 'custom effect';
      // Legacy names
      if (e.type === 'heal')         return `+${e.value} HP`;
      if (e.type === 'mana_restore') return `+${e.value} mana`;
      return e.description || e.type || '';
    }).filter(Boolean);
    if (parts.length) return parts.join(' · ');
    return it.description || '';
  } catch { return it.description || ''; }
}

function _mountItemConfirm(panel, it) {
  const area = panel.querySelector('#ip-confirm-area');
  if (!area) return;
  const rarityCls = it.rarity ? ` rarity-${it.rarity}` : '';
  // Rework v3 — consumables can target Self or a teammate. Build a Self + living
  // teammates dropdown; default to the currently selected table target (if it is
  // not Self), otherwise Self. Previously this modal shipped no target_id at all,
  // so potions "used on a teammate" were silently applied to the caster instead.
  const _teammates = (tableParticipants || [])
    .filter(t => t && t.id !== CHAR_ID && t.is_alive !== false);
  const _hasTeammates = _teammates.length > 0;
  const _defaultTargetId = (selectedTargetId && selectedTargetId !== CHAR_ID)
    ? selectedTargetId : CHAR_ID;
  const _targetOptions = [
    `<option value="${CHAR_ID}"${_defaultTargetId === CHAR_ID ? ' selected' : ''}>Self (${char?.name || 'me'})</option>`,
    ..._teammates.map(t => `<option value="${t.id}"${t.id === _defaultTargetId ? ' selected' : ''}>${t.is_npc ? '🎭 ' : '👤 '}${t.name}</option>`),
  ].join('');

  area.innerHTML = `
    <div style="padding:8px;background:var(--bg-surface);border-radius:var(--r-sm);border:1px solid var(--border-active)">
      <div style="font-weight:700;margin-bottom:3px"><span class="${rarityCls}">${it.name}</span></div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:4px">${_summarizeUseEffect(it) || it.description || ''}</div>
      ${it.mana_cost ? `<div style="font-size:0.72rem;color:#60a5fa;margin-bottom:6px">🔮 ${it.mana_cost} mana</div>` : ''}
      ${_hasTeammates ? `<div style="margin-bottom:6px">
        <label style="font-size:0.75rem">Target:
          <select id="ip-target" style="font-size:0.8rem;margin-left:4px;min-width:160px">${_targetOptions}</select>
        </label>
      </div>` : ''}
      <div style="display:flex;gap:6px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" id="ip-back">← Back</button>
        <button class="btn btn-primary btn-sm" id="ip-use">Use</button>
      </div>
      <div id="ip-result" style="margin-top:6px;font-size:0.78rem"></div>
    </div>`;
  area.querySelector('#ip-back').addEventListener('click', _closeConfirmPanel);
  area.querySelector('#ip-use').addEventListener('click', async () => {
    const resultEl = area.querySelector('#ip-result');
    resultEl.innerHTML = '<span class="text-muted">Using...</span>';
    const hpBefore = char?.current_hp ?? 0;
    try {
      // Rework v3 — include target_id so the server applies heal / buff / status
      // to the chosen character instead of defaulting to the caster.
      const _sel = area.querySelector('#ip-target');
      const _tid = _sel ? parseInt(_sel.value) : CHAR_ID;
      const _body = (_tid && _tid !== CHAR_ID) ? { target_id: _tid } : {};
      const res = await api.post(`/api/inventory/${it.inventory_id}/use`, _body);
      const results = res.results || [];
      let out = results.length ? results.map(r => `<div>• ${r}</div>`).join('') : '<div>✅ Used</div>';
      await loadChar();
      await loadInventory();
      const hpAfter = char?.current_hp ?? hpBefore;
      if (hpAfter !== hpBefore) {
        out = `<div style="font-weight:700;margin-bottom:3px">HP: ${hpBefore} → ${hpAfter}</div>` + out;
      }
      resultEl.innerHTML = out;
      const logIcon = (it.is_potion && it.potion_icon) ? it.potion_icon
                    : ((it.category||'').toLowerCase() === 'potion' ? '🧪' : '🎒');
      results.forEach(r => addLog(`${logIcon} ${it.name}: ${r}`));
    } catch (e) {
      const d = e?.body?.detail;
      resultEl.innerHTML = `<span style="color:var(--accent-red)">${typeof d === 'object' ? (d.message || JSON.stringify(d)) : (d || 'Failed')}</span>`;
    }
  });
}

// ══════════════════════════════════════════════════════════════
