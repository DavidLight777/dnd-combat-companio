// ════════════════════════════════════════════════════════
// Fix 1: level-up choice modal
// Source: player-app.js lines 5107-5280
// ════════════════════════════════════════════════════════

// Fix 1 — LEVEL-UP CHOICE MODAL (attributes vs rank)
// ══════════════════════════════════════════════════════════════
const _RANK_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'divine'];

function openLevelUpModal() {
  if (document.getElementById('levelup-modal')) return;
  if (!char) return;

  const level = char.level ?? 0;
  const xp = char.experience || 0;
  const thresh = 100 + 100 * Math.max(0, level);
  if (xp < thresh) {
    showToast(`Need ${thresh - xp} more XP to level up.`, 'warn');
    return;
  }

  const rank = (char.rank || 'common').toLowerCase();
  const rankIdx = _RANK_ORDER.indexOf(rank);
  const isMaxRank = rankIdx >= _RANK_ORDER.length - 1;
  const isRankUp = level >= 10;

  // Race HP die copy (if no race, backend defaults to 1d8)
  const hpCount = char.race?.hp_dice_count || char.hp_dice_count || 1;
  const hpDie   = char.race?.hp_die       || char.hp_die       || 8;
  const hpDieStr = `${hpCount}d${hpDie}`;

  let mode = 'attributes';  // 'attributes' | 'rank'
  let selectedAbilityId = null;

  const overlay = document.createElement('div');
  overlay.id = 'levelup-modal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:520px">
      <h2 style="margin:0 0 4px">⬆ ${isRankUp ? 'Rank Up!' : 'Level Up'}</h2>
      <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:10px">
        ${isRankUp ? `<strong>Level 10 reached!</strong> Rank will advance to next tier.` : `Current: <strong>${rank}</strong> rank · Level ${level} · ${xp} XP`}
      </div>

      <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:12px;padding:8px;background:var(--bg-surface-3);border-radius:var(--r-sm)">
        🎲 HP ${hpDieStr} + spiritual HP + mana — always rolled<br>
        Choose your bonus:
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <div class="lvlup-choice ${mode==='attributes'?'selected':''}" data-mode="attributes">
          <div class="lc-title">📈 +1 Attribute</div>
          <div class="lc-sub">
            Gain 1 attribute point to spend on any stat
          </div>
        </div>
        <div class="lvlup-choice ${mode==='rank'?'selected':''}" data-mode="rank">
          <div class="lc-title">⭐ Promote Ability Rank</div>
          <div class="lc-sub">
            Increase rank of one of your abilities
          </div>
        </div>
      </div>

      <div id="ability-select-area" style="display:none;margin-bottom:12px">
        <label style="font-size:0.78rem">Select ability to promote:</label>
        <select id="lvlup-ability-select" style="width:100%;font-size:0.78rem;margin-top:4px">
          <option value="">— Choose ability —</option>
        </select>
      </div>

      <div id="lvlup-error" class="error-msg" style="color:var(--accent-red);font-size:0.78rem;min-height:14px;margin-bottom:6px"></div>

      <div style="display:flex;gap:6px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" id="lvlup-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="lvlup-confirm">⚔ Confirm</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#lvlup-cancel').addEventListener('click', () => overlay.remove());

  const err = overlay.querySelector('#lvlup-error');
  const confirmBtn = overlay.querySelector('#lvlup-confirm');
  const abilityArea = overlay.querySelector('#ability-select-area');
  const abilitySelect = overlay.querySelector('#lvlup-ability-select');

  // Load abilities into select
  (async () => {
    try {
      const abs = await api.get(`/api/characters/${CHAR_ID}/abilities`);
      const _RANKS = ['common','uncommon','rare','epic','legendary','mythic','divine'];
      abs.forEach(a => {
        const curRank = a.ability_rank || 'common';
        const idx = _RANKS.indexOf(curRank);
        const isMax = idx >= _RANKS.length - 1;
        const nextRank = isMax ? null : _RANKS[idx + 1];
        const opt = document.createElement('option');
        opt.value = a.character_ability_id;
        opt.textContent = `${a.name} (${curRank}${nextRank ? ' → ' + nextRank : ' — max'})`;
        if (isMax) opt.disabled = true;
        abilitySelect.appendChild(opt);
      });
    } catch {}
  })();

  overlay.querySelectorAll('.lvlup-choice').forEach(card => {
    card.addEventListener('click', () => {
      mode = card.dataset.mode;
      overlay.querySelectorAll('.lvlup-choice').forEach(c => c.classList.toggle('selected', c === card));
      abilityArea.style.display = mode === 'rank' ? 'block' : 'none';
    });
  });

  overlay.querySelector('#lvlup-confirm').addEventListener('click', async () => {
    if (mode === 'rank') {
      selectedAbilityId = parseInt(abilitySelect.value);
      if (!selectedAbilityId) {
        err.textContent = 'Please select an ability to promote';
        return;
      }
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Rolling…';
    const payload = { choice: mode };
    if (mode === 'rank') payload.ability_id = selectedAbilityId;

    try {
      const res = await api.post(`/api/characters/${CHAR_ID}/level-up`, payload);

      const rolls = (res.chosen?.hp_rolls || []).join(' + ');
      const total = res.chosen?.hp_gained ?? '?';
      const spiritRolls = (res.chosen?.spirit_hp_rolls || []).join(' + ');
      const spiritTotal = res.chosen?.spirit_gained ?? '?';
      const abilityName = res.chosen?.ability_name || '';
      const prevAbilityRank = res.chosen?.previous_ability_rank || '';
      const newAbilityRank = res.chosen?.ability_rank || '';

      overlay.innerHTML = `
        <div class="modal-content" style="max-width:480px;text-align:center">
          <h2 style="margin-top:0">${res.chosen?.rank_promoted ? '⭐ Rank Up!' : '🎉 Level Up!'}</h2>
          <div style="font-size:2rem;font-weight:800;color:var(--accent-green);margin:8px 0">+${total} HP</div>
          <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:4px">
            ${res.chosen?.hp_dice_count}d${res.chosen?.hp_die}: ${rolls || '?'}
          </div>
          <div style="font-size:1.2rem;font-weight:700;color:#a855f7;margin:4px 0">+${spiritTotal} Spiritual HP</div>
          <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:4px">
            ${res.chosen?.spirit_hp_dice_count}d${res.chosen?.spirit_hp_die}: ${spiritRolls || '?'}
          </div>
          <div style="font-size:1rem;font-weight:600;color:#60a5fa;margin:4px 0">+${res.chosen?.mana_gained ?? 0} Mana</div>
          ${mode === 'attributes'
            ? `<div style="font-size:1rem;font-weight:600;color:#fbbf24;margin:4px 0">+1 Attribute Point</div>`
            : `<div style="font-size:1rem;font-weight:600;color:#fbbf24;margin:4px 0">⭐ ${abilityName}<br>${prevAbilityRank} → ${newAbilityRank}</div>`}
          ${res.chosen?.rank_promoted ? `<div style="font-size:1rem;font-weight:600;color:#f472b6;margin:4px 0">⭐ Promoted to ${res.rank}!</div>` : ''}
          <div style="font-size:0.78rem;color:var(--text-muted);margin-top:8px">
            Level ${res.level} · ${res.rank} · Next: <strong>${res.xp_to_next}</strong> XP
          </div>
          <button class="btn btn-primary btn-sm" id="lvlup-close" style="margin-top:14px">Continue</button>
        </div>`;
      overlay.querySelector('#lvlup-close').addEventListener('click', () => overlay.remove());
      addLog(`⬆ Level ${res.level} · +${total} HP · ${res.rank}`);

      loadChar();
      loadAbilities();
    } catch (e) {
      err.textContent = e.message || 'Level-up failed';
      confirmBtn.disabled = false;
      confirmBtn.textContent = '⚔ Confirm';
    }
  });
}

// Wire the Level-up CTA once at load.
document.addEventListener('click', e => {
  if (e.target && e.target.closest('#btn-level-up')) openLevelUpModal();
});

// ══════════════════════════════════════════════════════════════
