// ════════════════════════════════════════════════════════
// Starting Item Wizard (Phase 7 steps 4-5)
// Source: player-app.js lines 176-438
// ════════════════════════════════════════════════════════

// Rework Phase 7 — Starting Item Wizard (step 4-5)
// ══════════════════════════════════════════════════════════════
async function maybeShowStartingItemWizard() {
  if (!CHAR_ID) return;
  try {
    const ws = await api.get(`/api/wizard/${CHAR_ID}`);
    if (ws.is_completed) return;
    if (document.getElementById('wiz-starting-item')) return;  // already shown
    openStartingItemWizard(ws);
  } catch (e) { /* ignore — wizard is optional */ }
}

function openStartingItemWizard(ws) {
  const overlay = document.createElement('div');
  overlay.id = 'wiz-starting-item';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:480px">
      <h2 style="margin-top:0">🎲 Starting Item</h2>
      <p style="font-size:0.85rem;color:var(--text-muted)">
        Every adventurer begins with a single piece of gear. Roll the dice to determine its quality,
        then describe the item. Your GM will approve it before it goes into your bag.
      </p>
      <div id="wiz-body"></div>
    </div>`;
  document.body.appendChild(overlay);
  renderWizardBody(overlay, ws);
}

function renderWizardBody(overlay, ws) {
  const body = overlay.querySelector('#wiz-body');
  const data = ws.data || {};
  // Branch: rolled? approved? rejected?
  if (ws.is_completed) { overlay.remove(); loadInventory(); return; }

  if (!data.starting_roll) {
    body.innerHTML = `
      <div style="text-align:center;padding:18px 0">
        <button class="btn btn-primary btn-lg" id="wiz-roll">🎲 Roll d20</button>
      </div>`;
    body.querySelector('#wiz-roll').addEventListener('click', async () => {
      try {
        const res = await api.post(`/api/wizard/${CHAR_ID}/starting-roll`, {});
        addLog('wizard', `🎲 Rolled ${res.d20} → ${res.rarity.toUpperCase()}`);
        renderWizardBody(overlay, res.state);
      } catch (e) { showToast('Roll failed'); }
    });
    return;
  }

  const r = data.starting_roll;
  const rarity = r.rarity;
  const description = rarityDescription(r.d20);
  if (data.gm_approved) { overlay.remove(); loadInventory(); return; }

  if (data.proposed_item && !data.gm_rejected) {
    // Waiting for GM
    body.innerHTML = `
      <div style="padding:10px;background:var(--bg-surface-2);border-radius:var(--r-md);margin-bottom:10px">
        <div style="font-size:0.8rem;color:var(--text-muted)">Your roll</div>
        <div style="font-size:1.1rem"><strong>d20 = ${r.d20}</strong> · ${description}</div>
      </div>
      <div style="padding:10px;border:1px dashed var(--border);border-radius:var(--r-md);margin-bottom:10px">
        <div style="font-size:0.75rem;color:var(--text-muted)">Proposed item (<strong class="rarity-${rarity}">${rarity}</strong>)</div>
        <div style="font-weight:700;font-size:1rem">${escapeHtml(data.proposed_item.name)}</div>
        <div style="font-size:0.78rem;color:var(--text-muted)">${escapeHtml(data.proposed_item.description || '')}</div>
      </div>
      <div style="text-align:center;font-size:0.85rem;color:var(--accent-green)">⏳ Waiting for GM to approve…</div>`;
    // Poll — simple re-fetch every 3s
    const t = setInterval(async () => {
      try {
        const ws2 = await api.get(`/api/wizard/${CHAR_ID}`);
        if (ws2.is_completed) { clearInterval(t); overlay.remove(); loadInventory(); return; }
        if (ws2.data?.gm_rejected) { clearInterval(t); renderWizardBody(overlay, ws2); return; }
      } catch {}
    }, 3000);
    return;
  }

  // Propose item form (first time or after rejection)
  const rejectedNote = data.gm_rejected ? data.gm_reject_note || 'The GM asked you to propose a different item.' : '';
  body.innerHTML = `
    <div style="padding:10px;background:var(--bg-surface-2);border-radius:var(--r-md);margin-bottom:10px">
      <div style="font-size:0.8rem;color:var(--text-muted)">Your roll</div>
      <div style="font-size:1.1rem"><strong>d20 = ${r.d20}</strong> · ${description}</div>
      <div style="margin-top:4px">Rarity: <strong class="rarity-${rarity}" style="text-transform:capitalize">${rarity}</strong></div>
    </div>
    ${rejectedNote ? `<div style="padding:8px;border:1px solid var(--accent-red);border-radius:var(--r-sm);margin-bottom:10px;font-size:0.82rem;color:var(--accent-red)">GM: ${escapeHtml(rejectedNote)}</div>` : ''}
    <label style="font-size:0.78rem">Item Name</label>
    <input type="text" id="wiz-item-name" placeholder="e.g. Bronze Dagger" style="width:100%;margin-bottom:8px">
    <label style="font-size:0.78rem">Description</label>
    <textarea id="wiz-item-desc" rows="3" placeholder="A short description…" style="width:100%;margin-bottom:8px"></textarea>
    <label style="font-size:0.78rem">Category</label>
    <select id="wiz-item-cat" style="width:100%;margin-bottom:12px">
      <option value="weapon">Weapon</option>
      <option value="armor">Armor</option>
      <option value="potion">Potion</option>
      <option value="misc" selected>Miscellaneous</option>
    </select>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button class="btn btn-primary btn-sm" id="wiz-submit">Send to GM</button>
    </div>`;
  body.querySelector('#wiz-submit').addEventListener('click', async () => {
    const name = body.querySelector('#wiz-item-name').value.trim();
    if (!name) { showToast('Give your item a name'); return; }
    const description = body.querySelector('#wiz-item-desc').value.trim();
    const category = body.querySelector('#wiz-item-cat').value;
    try {
      const res = await api.post(`/api/wizard/${CHAR_ID}/propose-item`, { name, description, category });
      addLog('wizard', `📝 Proposed starting item: ${name}`);
      renderWizardBody(overlay, res);
    } catch (e) { showToast('Failed to send proposal'); }
  });
}

function rarityDescription(d20) {
  if (d20 <= 1)  return 'Cursed start — broken or tainted.';
  if (d20 <= 9)  return 'Common quality.';
  if (d20 <= 14) return 'Uncommon find.';
  if (d20 <= 19) return 'Rare treasure!';
  return '✨ LEGENDARY ROLL — Epic item!';
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Rework Phase 4: render player's professions list.
function renderProfessionsPanel(professions) {
  const panel = document.getElementById('professions-list');
  if (!panel) return;
  if (!professions || !professions.length) {
    panel.innerHTML = '<span class="text-muted" style="font-size:0.82rem">No professions yet — ask your GM to assign one.</span>';
    return;
  }
  panel.innerHTML = professions.map(p => {
    const bonuses = Array.isArray(p.bonuses) ? p.bonuses : [];
    const bonusChips = bonuses.map(b => {
      if (b.type === 'stat_bonus') return `<span class="chip-muted">${(b.stat||'').slice(0,3).toUpperCase()}+${b.value}</span>`;
      return `<span class="chip-muted">${(b.type||'').replace(/_/g,' ')}+${b.value||0}</span>`;
    }).join('');
    const abilities = Array.isArray(p.special_abilities) ? p.special_abilities : [];
    return `<div class="profession-card">
      <div class="prof-head">
        <span class="prof-name">${p.name || 'Profession'}</span>
        <span class="prof-level">L ${p.level}/5</span>
        ${p.is_active ? '' : '<span class="chip-muted">inactive</span>'}
      </div>
      ${p.description ? `<div class="prof-desc">${p.description}</div>` : ''}
      ${bonusChips ? `<div class="prof-bonuses">${bonusChips}</div>` : ''}
      ${abilities.length ? `<ul class="prof-abilities">${abilities.map(a => `<li>${a}</li>`).join('')}</ul>` : ''}
    </div>`;
  }).join('');
}

// FIX 2: Populate left character sidebar from `char` state
function renderCharSidebar() {
  const c = char; if (!c) return;
  const nameEl = $('#cs-name'); if (nameEl) nameEl.textContent = c.name || 'Character';
  const initEl = $('#cs-avatar-initial'); if (initEl) initEl.textContent = (c.name || '?').trim().charAt(0).toUpperCase();
  const avatar = $('#cs-avatar'); if (avatar && c.token_color) avatar.style.background = `linear-gradient(135deg, ${c.token_color} 0%, var(--bg-surface-3) 100%)`;

  // Rework v2: cosmetic age / gender line + declined-stats badge
  const bioEl = $('#cs-bio');
  if (bioEl) {
    const parts = [];
    if (c.age)    parts.push(`Age ${c.age}`);
    if (c.gender) parts.push(c.gender);
    if (c.declined_stats) parts.push('<span style="color:#dc5050;font-weight:600" title="Declined the gift of stats — rolls with advantage on the starting feature">⚔ Walked Alone</span>');
    bioEl.innerHTML = parts.join(' · ');
  }

  // HP
  const hpPct = c.max_hp > 0 ? Math.min(100, Math.max(0, c.current_hp / c.max_hp * 100)) : 0;
  const hpColor = hpPct > 50 ? 'var(--hp-high)' : hpPct > 25 ? 'var(--hp-mid)' : 'var(--hp-low)';
  const hpVal = $('#cs-hp-value'); if (hpVal) hpVal.textContent = `${c.current_hp} / ${c.max_hp}`;
  const hpFill = $('#cs-hp-fill'); if (hpFill) { hpFill.style.width = hpPct + '%'; hpFill.style.background = hpColor; }
  const kdEl = $('#cs-kd'); if (kdEl) kdEl.textContent = c.armor_class;

  // Spiritual HP
  const spiritHpPct = c.spiritual_max_hp > 0 ? Math.min(100, Math.max(0, c.spiritual_hp / c.spiritual_max_hp * 100)) : 0;
  const spiritHpColor = spiritHpPct > 50 ? '#a855f7' : spiritHpPct > 25 ? '#c084fc' : '#e879f9';
  const spiritHpVal = $('#cs-spirit-hp-value'); if (spiritHpVal) spiritHpVal.textContent = `${c.spiritual_hp} / ${c.spiritual_max_hp}`;
  const spiritHpFill = $('#cs-spirit-hp-fill'); if (spiritHpFill) { spiritHpFill.style.width = spiritHpPct + '%'; spiritHpFill.style.background = spiritHpColor; }

  // Mana
  const manaBlk = $('#cs-mana-block');
  if (manaBlk) {
    if (c.mana_max > 0) {
      manaBlk.style.display = '';
      const mp = c.mana_max > 0 ? Math.min(100, c.mana_current / c.mana_max * 100) : 0;
      $('#cs-mana-value').textContent = `${c.mana_current} / ${c.mana_max}`;
      $('#cs-mana-fill').style.width = mp + '%';
    } else {
      manaBlk.style.display = 'none';
    }
  }

  // XP (level + experience).
  const xpBlk = $('#cs-xp-block');
  if (xpBlk) {
    const level = c.level ?? 0;
    const xp = c.experience || 0;
    const xpVal = $('#cs-xp-value');
    const xpFill = $('#cs-xp-fill');
    // Rework v2 curve: threshold = 100 + 100 * level (matches backend xp_to_next)
    const nextThresh = 100 + 100 * Math.max(0, level);
    const pct = Math.min(100, (xp / nextThresh) * 100);
    if (xpVal) xpVal.textContent = `Lvl ${level} · ${xp}/${nextThresh}`;
    if (xpFill) xpFill.style.width = pct + '%';

    // Rework v2: expose the Level-up CTA exactly when ready.
    const lvlBtn = $('#btn-level-up');
    if (lvlBtn) lvlBtn.style.display = xp >= nextThresh ? '' : 'none';
  }
}

// FIX 2: Sidebar characteristic roll (wired once at init)
let _csRollAdv = 'normal';
document.addEventListener('click', (e) => {
  if (e.target && e.target.closest('#cs-roll-adv button')) {
    const btn = e.target.closest('button');
    _csRollAdv = btn.dataset.mode;
    document.querySelectorAll('#cs-roll-adv button').forEach(b => b.classList.toggle('active', b === btn));
  }
});
document.addEventListener('click', async (e) => {
  if (e.target && e.target.id === 'btn-cs-roll') {
    const stat = document.getElementById('cs-roll-stat').value;
    const rollType = document.getElementById('cs-roll-type').value;
    const diceCount = parseInt(document.getElementById('cs-roll-dice-count')?.value) || 1;
    const diceType = parseInt(document.getElementById('cs-roll-dice-type')?.value) || 20;
    const resEl = document.getElementById('cs-roll-result');
    try {
      const res = await api.post(`/api/characters/${CHAR_ID}/roll-characteristic`, {
        stat, roll_type: rollType, advantage_mode: _csRollAdv,
        dice_count: diceCount, dice_type: diceType,
      });
      let advTag = '';
      if (res.advantage_mode === 'advantage') advTag = ' <span class="adv-badge advantage">ADV</span>';
      else if (res.advantage_mode === 'disadvantage') advTag = ' <span class="adv-badge disadvantage">DISADV</span>';
      resEl.innerHTML = `<span style="color:var(--accent)">${res.description}</span>${advTag}`;
      addLog(`🎲 ${res.description}`);
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({ type: 'roll.characteristic', ...res }));
      }
    } catch {
      if (resEl) resEl.textContent = 'Roll failed';
    }
  }
});
function renderAll() {
  renderHP();
  renderStats();
  renderAttack();
  renderDefense();
  renderHeal();
  renderTurns();
  renderEffects();
  renderEnemyCalc();
}

// ══════════════════════════════════════════════════════════════
