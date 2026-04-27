// ════════════════════════════════════════════════════════
// Status effects badges + modal
// Source: gm-app.js lines 2560–2813
// Globals shared via window.* and module-scope hoisting.
// ════════════════════════════════════════════════════════

// STAGE 4 — STATUS EFFECTS UI
// ══════════════════════════════════════════════════════════════

// ── Load Status Badges ───────────────────────────────────────
async function loadStatusBadges(charId) {
  const el = document.querySelector('#gm-status-badges');
  if (!el) return;
  try {
    const effects = await api.get(`/api/characters/${charId}/status-effects`);
    if (!effects.length) { el.innerHTML = '<span class="text-muted" style="font-size:0.75rem">None</span>'; return; }
    el.innerHTML = effects.map(e => {
      const turns = e.remaining_turns !== null ? `<span style="font-size:0.6rem;margin-left:2px">${e.remaining_turns}t</span>` : '';
      return `<span class="status-badge" style="background:${e.color}20;border:1px solid ${e.color};border-radius:var(--r-md);padding:2px 6px;font-size:0.75rem;display:inline-flex;align-items:center;gap:2px;cursor:pointer" data-status-id="${e.id}" title="${e.name}: ${(e.effects||[]).map(ef=>ef.type+'='+JSON.stringify(ef.value)).join(', ')}">${e.icon} ${e.name}${turns}<button class="btn-icon" style="font-size:0.6rem;margin-left:3px" data-remove-status="${e.id}">✕</button></span>`;
    }).join('');

    el.querySelectorAll('[data-remove-status]').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        await api.del(`/api/status-effects/${btn.dataset.removeStatus}`);
        loadStatusBadges(charId);
        addLog('gm.status', `Removed status effect #${btn.dataset.removeStatus}`);
      });
    });
  } catch { el.innerHTML = ''; }
}

// ── Add Status Modal ─────────────────────────────────────────
async function openAddStatusModal(charId, charName) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg);width:85%;max-width:420px;max-height:75vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border)">
        <h3 style="flex:1;font-size:0.88rem">⚡ Add Status to ${charName}</h3>
        <button class="btn-icon" id="as-close">✕</button>
      </div>
      <div style="padding:10px">
        <div style="font-size:0.78rem;font-weight:600;margin-bottom:6px">From Templates:</div>
        <div id="as-template-list" style="max-height:200px;overflow-y:auto;margin-bottom:10px;font-size:0.8rem"></div>
        <hr class="section-divider">
        <div style="font-size:0.78rem;font-weight:600;margin-bottom:6px">Custom Effect:</div>
        <div style="display:flex;gap:4px;margin-bottom:4px;align-items:center">
          <input type="text" id="as-custom-name" placeholder="Name" style="flex:1;font-size:0.78rem">
          <input type="text" id="as-custom-icon" value="⚡" style="width:32px;font-size:0.78rem;text-align:center">
          <input type="color" id="as-custom-color" value="#ff6b6b" style="width:28px;height:28px;padding:1px">
        </div>
        <div style="display:flex;gap:4px;margin-bottom:4px;align-items:center">
          <label style="font-size:0.7rem;color:var(--text-muted)">Duration (turns):</label>
          <input type="number" id="as-custom-turns" placeholder="∞" style="width:50px;font-size:0.78rem">
        </div>
        <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:4px">Effects (JSON): [{type, value}]</div>
        <textarea id="as-custom-effects" rows="2" style="width:100%;font-size:0.72rem;font-family:monospace" placeholder='[{"type":"attack_penalty","value":-2}]'></textarea>
        <button class="btn btn-primary btn-xs" id="as-custom-apply" style="margin-top:6px">Apply Custom</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#as-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Load templates
  const templates = await api.get('/api/status-templates');
  const el = overlay.querySelector('#as-template-list');
  if (!templates.length) { el.innerHTML = '<span class="text-muted">No templates. Create one in Library.</span>'; }
  else {
    el.innerHTML = templates.map(t => {
      const effs = (t.effects||[]).map(e => `${e.type}=${JSON.stringify(e.value)}`).join(', ');
      return `<div style="display:flex;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:1rem">${t.icon}</span>
        <span style="flex:1;font-weight:600;color:${t.color}">${t.name}</span>
        <span style="font-size:0.65rem;color:var(--text-muted)">${effs}</span>
        <input type="number" data-tmpl-turns="${t.id}" value="${t.default_duration||''}" placeholder="∞" style="width:40px;font-size:0.7rem" title="Duration">
        <button class="btn btn-primary btn-xs" data-apply-tmpl="${t.id}">Apply</button>
      </div>`;
    }).join('');

    el.querySelectorAll('[data-apply-tmpl]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tid = parseInt(btn.dataset.applyTmpl);
        const turnsInput = el.querySelector(`[data-tmpl-turns="${tid}"]`);
        const turns = turnsInput.value === '' ? null : parseInt(turnsInput.value);
        await api.post(`/api/characters/${charId}/status-effects`, { template_id: tid, remaining_turns: turns });
        overlay.remove();
        loadStatusBadges(charId);
        const tmpl = templates.find(t => t.id === tid);
        addLog('gm.status', `Applied ${tmpl ? tmpl.name : 'status'} to ${charName}`);
      });
    });
  }

  // Custom apply
  overlay.querySelector('#as-custom-apply').addEventListener('click', async () => {
    const name = overlay.querySelector('#as-custom-name').value.trim();
    if (!name) return;
    let effects = [];
    try { effects = JSON.parse(overlay.querySelector('#as-custom-effects').value || '[]'); } catch {}
    const turns = overlay.querySelector('#as-custom-turns').value;
    await api.post(`/api/characters/${charId}/status-effects`, {
      custom_name: name,
      custom_icon: overlay.querySelector('#as-custom-icon').value,
      custom_color: overlay.querySelector('#as-custom-color').value,
      custom_effects: effects,
      remaining_turns: turns === '' ? null : parseInt(turns),
    });
    overlay.remove();
    loadStatusBadges(charId);
    addLog('gm.status', `Applied custom "${name}" to ${charName}`);
  });
}

// ── Status Library Modal ─────────────────────────────────────
async function openStatusLibraryModal() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg);width:90%;max-width:560px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--bg-surface-2)">
        <h3 style="flex:1;font-size:0.9rem">📚 Status Effect Library</h3>
        <button class="btn btn-primary btn-xs" id="sl-create" style="margin-right:8px">+ Create New</button>
        <button class="btn-icon" id="sl-close">✕</button>
      </div>
      <div id="sl-list" style="padding:12px;overflow-y:auto;flex:1;font-size:0.8rem"></div>
      <div id="sl-editor" style="display:none;padding:12px;border-top:1px solid var(--border)"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#sl-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  async function loadList() {
    const templates = await api.get('/api/status-templates');
    const el = overlay.querySelector('#sl-list');
    if (!templates.length) { el.innerHTML = '<span class="text-muted">No templates yet.</span>'; return; }
    el.innerHTML = templates.map(t => {
      const effs = (t.effects||[]).map(e => `<code style="font-size:0.65rem">${e.type}=${JSON.stringify(e.value)}</code>`).join(' ');
      return `<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:1.1rem">${t.icon}</span>
        <div style="flex:1">
          <div style="font-weight:600;color:${t.color}">${t.name}</div>
          <div style="font-size:0.7rem;color:var(--text-muted)">${t.description || ''}</div>
          <div>${effs}</div>
        </div>
        <span style="font-size:0.7rem;color:var(--text-muted)">${t.default_duration ? t.default_duration+'t' : '∞'}</span>
        <button class="btn btn-ghost btn-xs" data-sl-edit="${t.id}">✏️</button>
        <button class="btn-icon danger" data-sl-del="${t.id}">🗑</button>
      </div>`;
    }).join('');

    el.querySelectorAll('[data-sl-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.del(`/api/status-templates/${btn.dataset.slDel}`);
        loadList();
      });
    });

    el.querySelectorAll('[data-sl-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = templates.find(x => x.id === parseInt(btn.dataset.slEdit));
        if (t) showEditor(t);
      });
    });
  }

  function showEditor(t = null) {
    const ed = overlay.querySelector('#sl-editor');
    ed.style.display = '';
    ed.innerHTML = `
      <div style="font-size:0.8rem;font-weight:600;margin-bottom:6px">${t ? 'Edit' : 'New'} Template</div>
      <div style="display:flex;gap:4px;margin-bottom:4px">
        <input type="text" id="sl-name" value="${t ? t.name : ''}" placeholder="Name" style="flex:1;font-size:0.78rem">
        <input type="text" id="sl-icon" value="${t ? t.icon : '⚡'}" style="width:32px;font-size:0.78rem;text-align:center">
        <input type="color" id="sl-color" value="${t ? t.color : '#ff6b6b'}" style="width:28px;height:28px">
      </div>
      <input type="text" id="sl-desc" value="${t ? t.description : ''}" placeholder="Description" style="width:100%;font-size:0.78rem;margin-bottom:4px">
      <div style="display:flex;gap:4px;margin-bottom:4px;align-items:center">
        <label style="font-size:0.7rem">Default duration:</label>
        <input type="number" id="sl-duration" value="${t && t.default_duration ? t.default_duration : ''}" placeholder="∞" style="width:50px;font-size:0.78rem">
      </div>
      <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:2px">Effects JSON:</div>
      <textarea id="sl-effects" rows="3" style="width:100%;font-size:0.72rem;font-family:monospace">${t ? JSON.stringify(t.effects, null, 1) : '[]'}</textarea>
      <div style="display:flex;gap:6px;margin-top:6px">
        <button class="btn btn-primary btn-xs" id="sl-save">${t ? 'Update' : 'Create'}</button>
        <button class="btn btn-ghost btn-xs" id="sl-cancel">Cancel</button>
      </div>
    `;

    ed.querySelector('#sl-cancel').addEventListener('click', () => { ed.style.display = 'none'; });
    ed.querySelector('#sl-save').addEventListener('click', async () => {
      const data = {
        name: ed.querySelector('#sl-name').value.trim(),
        description: ed.querySelector('#sl-desc').value,
        icon: ed.querySelector('#sl-icon').value,
        color: ed.querySelector('#sl-color').value,
        default_duration: ed.querySelector('#sl-duration').value === '' ? null : parseInt(ed.querySelector('#sl-duration').value),
      };
      try { data.effects = JSON.parse(ed.querySelector('#sl-effects').value || '[]'); } catch { data.effects = []; }

      if (t) {
        await api.put(`/api/status-templates/${t.id}`, data);
      } else {
        await api.post('/api/status-templates', data);
      }
      ed.style.display = 'none';
      loadList();
    });
  }

  overlay.querySelector('#sl-create').addEventListener('click', () => showEditor(null));
  loadList();
}

// ── Initiate Trade Modal ─────────────────────────────────────
function openInitiateTradeModal(npcId, npcName) {
  const players = characters.filter(ch => !ch.is_npc);
  if (!players.length) { showToast('No players in session'); return; }

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg);width:80%;max-width:360px;padding:20px">
      <h3 style="font-size:0.9rem;margin-bottom:12px">🤝 Initiate Trade with ${npcName}</h3>
      <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:8px">Select a player:</p>
      <div id="trade-player-list" style="display:flex;flex-direction:column;gap:6px">
        ${players.map(p => `<button class="btn btn-ghost btn-sm" data-trade-player="${p.id}" style="text-align:left">${p.name}</button>`).join('')}
      </div>
      <button class="btn btn-ghost btn-xs" id="trade-cancel" style="margin-top:12px">Cancel</button>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#trade-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelectorAll('[data-trade-player]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const playerId = parseInt(btn.dataset.tradePlayer);
      const res = await api.post('/api/trade/initiate', { npc_id: npcId, player_id: playerId });
      overlay.remove();
      addLog('gm.trade', `Trade initiated: ${npcName} ↔ player #${playerId} (trade #${res.trade_id})`);
      // Broadcast WS event
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({
          type: 'trade.initiated',
          trade_id: res.trade_id,
          npc_id: npcId,
          npc_name: npcName,
          player_id: playerId,
        }));
      }
      showToast(`Trade #${res.trade_id} started`);
    });
  });
}

// ══════════════════════════════════════════════════════════════
