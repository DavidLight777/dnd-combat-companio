// ════════════════════════════════════════════════════════
// Status badges + currency display/transfer
// Source: player-app.js lines 1927-2043
// ════════════════════════════════════════════════════════

// STATUS EFFECT BADGES (Stage 4)
// ══════════════════════════════════════════════════════════════
async function loadStatusEffects() {
  const el = $('#player-status-badges');
  if (!el) return;
  try {
    const effects = await api.get(`/api/characters/${CHAR_ID}/status-effects`);
    if (!effects.length) { el.innerHTML = ''; return; }
    el.innerHTML = effects.map(e => {
      const turns = e.remaining_turns !== null ? ` ${e.remaining_turns}t` : '';
      const efDesc = (e.effects||[]).map(ef => {
        if (ef.type === 'attack_penalty') return `ATK ${ef.value}`;
        if (ef.type === 'damage_penalty') return `DMG ${ef.value}`;
        if (ef.type === 'hp_change_per_turn') return `HP/turn ${ef.value}`;
        if (ef.type === 'skip_turn') return 'Skip turn';
        if (ef.type === 'stat_penalty') return `${ef.stat} ${ef.value}`;
        if (ef.type === 'custom_note') return ef.text;
        return ef.type;
      }).join(', ');
      return `<span style="background:${e.color}20;border:1px solid ${e.color};border-radius:6px;padding:3px 8px;font-size:0.78rem;display:inline-flex;align-items:center;gap:3px;cursor:help" title="${e.name}: ${efDesc}">${e.icon} ${e.name}${turns ? `<span style='font-size:0.65rem;opacity:0.7'>${turns}</span>` : ''}</span>`;
    }).join('');
  } catch {}
}

// ══════════════════════════════════════════════════════════════
// CURRENCY DISPLAY & TRANSFER
// ══════════════════════════════════════════════════════════════
async function loadCurrency() {
  try {
    const data = await api.get(`/api/characters/${CHAR_ID}/currency`);
    const d = data.currency;
    const parts = [];
    if (d.platinum) parts.push(`${d.platinum}P`);
    if (d.gold) parts.push(`${d.gold}G`);
    if (d.silver) parts.push(`${d.silver}S`);
    parts.push(`${d.bronze || d.copper}B`);
    $('#player-currency').innerHTML = `💰 ${parts.join(' ')}`;
    $('#player-currency').dataset.totalBronze = data.total_bronze || data.total_copper;
    // FIX 2: mirror to left sidebar — always show all 4 denominations
    const plat = $('#cs-curr-plat');
    const platVal = $('#cs-curr-plat-val');
    if (plat) { plat.style.display = ''; }
    if (platVal) platVal.textContent = d.platinum || 0;
    const csGold   = $('#cs-curr-gold');   if (csGold)   csGold.textContent   = d.gold || 0;
    const csSilver = $('#cs-curr-silver'); if (csSilver) csSilver.textContent = d.silver || 0;
    const csBronze = $('#cs-curr-bronze'); if (csBronze) csBronze.textContent = d.bronze || d.copper || 0;
  } catch {}
}

$('#player-currency').addEventListener('click', () => openTransferModal());

function openTransferModal() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg);width:85%;max-width:380px;padding:20px">
      <h3 style="font-size:0.9rem;margin-bottom:12px">💰 Transfer Currency</h3>
      <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:8px">Balance: <strong style="color:var(--accent)">${$('#player-currency').textContent}</strong></p>
      <div id="transfer-targets" style="margin-bottom:10px"></div>
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:8px">
        <span style="font-size:0.7rem;color:#e0c97f">P:</span><input type="number" id="tx-plat" value="0" style="width:42px;font-size:0.75rem" min="0">
        <span style="font-size:0.7rem;color:#fbbf24">G:</span><input type="number" id="tx-gold" value="0" style="width:42px;font-size:0.75rem" min="0">
        <span style="font-size:0.7rem;color:#94a3b8">S:</span><input type="number" id="tx-silver" value="0" style="width:42px;font-size:0.75rem" min="0">
        <span style="font-size:0.7rem;color:#b87333">B:</span><input type="number" id="tx-bronze" value="0" style="width:42px;font-size:0.75rem" min="0">
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-primary btn-sm" id="tx-send">Send</button>
        <button class="btn btn-ghost btn-sm" id="tx-cancel">Cancel</button>
      </div>
      <div id="tx-result" style="margin-top:8px;font-size:0.8rem"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#tx-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Load other characters in session
  let selectedTarget = null;
  (async () => {
    try {
      const chars = await api.get(`/api/sessions/${SESSION_CODE}/characters`);
      const others = chars.filter(c => c.id !== CHAR_ID && !c.is_npc);
      const el = overlay.querySelector('#transfer-targets');
      if (!others.length) { el.innerHTML = '<span class="text-muted" style="font-size:0.8rem">No other players.</span>'; return; }
      el.innerHTML = `<label style="font-size:0.78rem;color:var(--text-muted)">To:</label>
        <select id="tx-target" style="font-size:0.8rem;padding:4px;margin-left:4px">
          ${others.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
        </select>`;
    } catch {}
  })();

  overlay.querySelector('#tx-send').addEventListener('click', async () => {
    const target = overlay.querySelector('#tx-target');
    if (!target) return;
    const toId = parseInt(target.value);
    const p = parseInt(overlay.querySelector('#tx-plat').value) || 0;
    const g = parseInt(overlay.querySelector('#tx-gold').value) || 0;
    const s = parseInt(overlay.querySelector('#tx-silver').value) || 0;
    const co = parseInt(overlay.querySelector('#tx-bronze').value) || 0;
    const totalBronze = p * 1000 + g * 100 + s * 10 + co;
    if (totalBronze <= 0) return;

    try {
      const res = await api.post('/api/currency/transfer', { from_id: CHAR_ID, to_id: toId, bronze_amount: totalBronze });
      overlay.querySelector('#tx-result').innerHTML = `<span style="color:var(--accent-green)">Sent ${p}P ${g}G ${s}S ${co}B to ${res.to.name}!</span>`;
      loadCurrency();
      addLog(`[Transfer] Sent ${totalBronze}b to ${res.to.name}`);
      setTimeout(() => overlay.remove(), 1500);
    } catch (e) {
      let msg = 'Transfer failed';
      try { const err = JSON.parse(e.message); msg = err.detail?.message || err.detail || msg; } catch {}
      overlay.querySelector('#tx-result').innerHTML = `<span style="color:var(--accent-red)">${msg}</span>`;
    }
  });
}

// ══════════════════════════════════════════════════════════════
