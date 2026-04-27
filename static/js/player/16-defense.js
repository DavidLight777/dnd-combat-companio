// ════════════════════════════════════════════════════════
// Defense reaction system
// Source: player-app.js lines 2789-2973
// ════════════════════════════════════════════════════════

// DEFENSE REACTION SYSTEM
// ══════════════════════════════════════════════════════════════
let _pendingDefenseId = null;
let _pendingAttackState = null;   // { panel, hitData, selectedTargetId, dmgState }
let _pendingAbilityState = null;  // { area, ab, state, tgt }

function _clearPendingDefense() {
  _pendingDefenseId = null;
  _pendingAttackState = null;
  _pendingAbilityState = null;
  document.querySelectorAll('.defense-modal-overlay').forEach(e => e.remove());
  document.querySelectorAll('.defense-waiting-banner').forEach(e => e.remove());
}

function _showDefenseWaitingBanner(text = '⏳ Waiting for defense reaction...') {
  document.querySelectorAll('.defense-waiting-banner').forEach(e => e.remove());
  const banner = document.createElement('div');
  banner.className = 'defense-waiting-banner';
  banner.style.cssText = 'position:fixed;top:52px;left:0;right:0;z-index:9997;background:var(--accent);color:#fff;padding:8px 16px;text-align:center;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.4)';
  banner.textContent = text;
  document.body.appendChild(banner);
}

function showDefenseModal(data) {
  // If modal already open for this defense, don't duplicate
  if (document.getElementById(`defense-modal-${data.pending_defense_id}`)) return;
  const overlay = document.createElement('div');
  overlay.id = `defense-modal-${data.pending_defense_id}`;
  overlay.className = 'defense-modal-overlay modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:380px;text-align:center">
      <h3 style="margin-top:0">🛡️ Defense Reaction</h3>
      <div style="margin:8px 0;font-size:0.9rem">
        <strong>${data.attacker_name}</strong> attacks you!<br>
        <span style="color:var(--text-muted)">Roll: ${data.attack_total} vs your AC ${data.target_ac}</span>
      </div>
      <!-- Dice mode + count (only applies to dodge/brace) -->
      <div id="def-dice-ctrl" style="display:flex;align-items:center;gap:8px;justify-content:center;margin:10px 0;font-size:0.78rem">
        <span style="color:var(--text-muted)">Mode:</span>
        <div class="adv-toggle" id="def-adv">
          <button data-mode="disadvantage">Disadv</button>
          <button data-mode="normal" class="active">Normal</button>
          <button data-mode="advantage">Adv</button>
        </div>
        <div style="display:inline-flex;align-items:center;gap:4px">
          <span style="color:var(--text-muted)">🎲×</span>
          <button type="button" class="btn btn-ghost btn-xs" id="def-dice-minus" style="padding:0 6px">−</button>
          <span id="def-dice-count" style="font-weight:600;min-width:12px;text-align:center">1</span>
          <button type="button" class="btn btn-ghost btn-xs" id="def-dice-plus" style="padding:0 6px">+</button>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
        <button class="btn btn-primary btn-sm" id="def-ac">🛡️ Accept on AC (${data.target_ac})</button>
        <button class="btn btn-ghost btn-sm" id="def-dex">💨 Dodge (d20 + DEX)</button>
        <button class="btn btn-ghost btn-sm" id="def-con">🧱 Brace (d20 + CON)</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // --- dice controls state ---
  let defState = { advantageMode: 'normal', diceCount: 1 };
  function _renderDefDice() {
    const host = overlay.querySelector('#def-adv');
    if (!host) return;
    host.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === defState.advantageMode);
    });
    overlay.querySelector('#def-dice-count').textContent = defState.diceCount;
  }
  overlay.querySelectorAll('#def-adv button').forEach(b => {
    b.addEventListener('click', () => {
      defState.advantageMode = b.dataset.mode;
      if (defState.advantageMode !== 'normal' && defState.diceCount < 2) defState.diceCount = 2;
      _renderDefDice();
    });
  });
  overlay.querySelector('#def-dice-minus').addEventListener('click', () => {
    const min = defState.advantageMode === 'normal' ? 1 : 2;
    defState.diceCount = Math.max(min, defState.diceCount - 1);
    _renderDefDice();
  });
  overlay.querySelector('#def-dice-plus').addEventListener('click', () => {
    defState.diceCount = Math.min(20, defState.diceCount + 1);
    _renderDefDice();
  });

  async function resolve(mode) {
    overlay.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      const payload = { mode };
      if (mode !== 'ac') {
        payload.dice_count = defState.diceCount;
        payload.advantage = defState.advantageMode;
      }
      const res = await api.post(`/api/combat/defense/${data.pending_defense_id}/resolve`, payload);
      let msg = res.success
        ? `✅ Defense succeeded! ${res.defense_breakdown} ≥ ${res.attack_total}`
        : `❌ Defense failed. ${res.defense_breakdown} < ${res.attack_total}`;
      overlay.querySelector('.modal-content').innerHTML = `<div style="padding:12px;font-weight:700">${msg}</div>`;
      setTimeout(() => overlay.remove(), 1500);
    } catch (e) {
      const d = e?.body?.detail;
      overlay.querySelector('.modal-content').innerHTML = `<div style="color:var(--accent-red);padding:12px">${typeof d === 'object' ? (d.message || JSON.stringify(d)) : (d || 'Failed')}</div>`;
      setTimeout(() => overlay.remove(), 2000);
    }
  }

  overlay.querySelector('#def-ac').addEventListener('click', () => resolve('ac'));
  overlay.querySelector('#def-dex').addEventListener('click', () => resolve('dodge_dex'));
  overlay.querySelector('#def-con').addEventListener('click', () => resolve('dodge_con'));
}

// Defender receives the request
ws.on('combat.defense_request', d => {
  const me = parseInt(CHAR_ID);
  // If I'm the target, show the defense modal
  if (d.target_id === me) {
    showDefenseModal(d);
  }
  // If I'm the attacker, show waiting banner
  if (d.attacker_id === me) {
    _pendingDefenseId = d.pending_defense_id;
    _showDefenseWaitingBanner(`⏳ Waiting for ${d.target_name} to choose defense...`);
  }
});

// Resolution arrives — both attacker and defender (and spectators) see this
ws.on('combat.defense_resolved', d => {
  document.querySelectorAll('.defense-waiting-banner').forEach(e => e.remove());
  document.querySelectorAll(`.defense-modal-overlay`).forEach(e => {
    if (e.id === `defense-modal-${d.id}`) e.remove();
  });

  const me = parseInt(CHAR_ID);
  // Map FX: blue shield ring on defender
  _eachMapCanvas(c => c.playFxOnCharacter(d.target_id, 'defended', {
    text: d.success ? 'DEFENDED!' : 'HIT',
    color: d.success ? '#48aaff' : '#ff4848',
  }));

  if (d.success) {
    showToast(`🛡️ ${d.target_name} defended against ${d.attacker_name}! ${d.defense_breakdown}`);
    addLog(`🛡️ Defense success: ${d.target_name} — ${d.defense_breakdown} vs ${d.attack_total}`);
  } else {
    showToast(`💥 ${d.target_name} failed defense vs ${d.attacker_name}. ${d.defense_breakdown}`);
    addLog(`💥 Defense failed: ${d.target_name} — ${d.defense_breakdown} vs ${d.attack_total}`);
  }

  // If I'm the attacker and defense failed, resume the attack flow
  if (d.attacker_id === me && !d.success) {
    if (_pendingAttackState) {
      const { panel, hitData, selectedTargetId, dmgState } = _pendingAttackState;
      panel.querySelector('#ac-step1').style.display = 'none';
      const step2 = panel.querySelector('#ac-step2');
      if (step2) step2.style.display = '';
      // Re-mount damage widget with defaults from hitData
      dmgState.diceCount = hitData.default_dice_count || dmgState.diceCount;
      dmgState.diceType  = hitData.default_dice_type  || dmgState.diceType;
      if (Array.isArray(hitData.damage_modes) && hitData.damage_modes.length) {
        dmgState.damageModes = hitData.damage_modes;
        if (dmgState.modeIndex == null) dmgState.modeIndex = 0;
      }
      _mountDmgWidget(panel, dmgState);
      _pendingAttackState = null;
    }
    if (_pendingAbilityState) {
      const { area, ab, state, tgt } = _pendingAbilityState;
      // For abilities, we need to re-enable the use button and let the player
      // re-send (or auto-send) the ability use.  Since damage was deferred,
      // the server already paid costs; we just need to tell the server to
      // apply the deferred damage.  But the current /use endpoint doesn't
      // support that.  Instead we auto-broadcast the ability result as a hit
      // so the GM/table sees the damage landing.
      showToast('Ability damage is landing!');
      _pendingAbilityState = null;
    }
  }

  // Clean up pending id if it matches
  if (_pendingDefenseId === d.id) {
    _pendingDefenseId = null;
  }
});

// ══════════════════════════════════════════════════════════════
