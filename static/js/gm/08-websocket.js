// ════════════════════════════════════════════════════════
// WebSocket dispatcher + entity invalidation + pending items
// Source: gm-app.js lines 3479–3800
// Globals shared via window.* and module-scope hoisting.
// ════════════════════════════════════════════════════════

// WEBSOCKET
// ══════════════════════════════════════════════════════════════
const ws = new WsClient(SESSION_CODE, GM_TOKEN);

ws.on('_connected', () => {
  $('#ws-dot').className = 'status-dot connected';
  $('#ws-label').textContent = 'connected';
  addLog('system', 'WebSocket connected');
});
ws.on('_disconnected', () => {
  $('#ws-dot').className = 'status-dot disconnected';
  $('#ws-label').textContent = 'disconnected';
  addLog('system', 'WebSocket disconnected');
});
ws.on('_reconnecting', d => { $('#ws-label').textContent = `reconnecting (${d.attempt})...`; });

// Rework v3 Phase 1: live refresh when somebody uploads/replaces the
// map or when a character is created/deleted (auto-seed in the map
// router gives every new token a default grid position). Safe guard
// around `loadMapState` — it may not be defined yet if this handler
// fires during an early reconnect.
ws.on('map.updated', () => {
  if (typeof loadMapState === 'function') loadMapState();
});
// Phase 5: map objects (walls) changed somewhere — refresh the
// overlays portion. We reuse `loadMapState` for simplicity; the extra
// tokens + fog reload are cheap.
ws.on('map.objects_updated', () => {
  if (typeof loadMapState === 'function') loadMapState();
});
// Rework v3 Phase 2: players now move their own tokens; apply the
// incremental position update instead of a full refetch so GM's view
// stays snappy during heavy combat.
ws.on('map.token_moved', d => {
  if (!d || d.character_id == null || !mapCanvas) return;
  const t = (mapCanvas.tokens || []).find(x => x.character_id === d.character_id);
  if (!t) return;
  if (d.visible != null) t.visible = d.visible;
  // Phase 12 R5: smooth interpolation instead of snap
  if (d.x != null && d.y != null) {
    mapCanvas.animateTokenTo(d.character_id, d.x, d.y);
  }
  mapCanvas.render();
});
ws.on('map.chest_added', () => { if (typeof loadMapState === 'function') loadMapState(); });
ws.on('map.chest_updated', () => { if (typeof loadMapState === 'function') loadMapState(); });
ws.on('map.chest_deleted', () => { if (typeof loadMapState === 'function') loadMapState(); });
ws.on('map.portal_added', () => { if (typeof loadMapState === 'function') loadMapState(); });
ws.on('map.portal_updated', () => { if (typeof loadMapState === 'function') loadMapState(); });
ws.on('map.portal_deleted', () => { if (typeof loadMapState === 'function') loadMapState(); });

// Phase 7 bridge: refresh GM map when a bv2 map / location is activated.
ws.on('bv2.map_activated',      () => { if (typeof loadMapState === 'function') loadMapState(); });
ws.on('bv2.location_activated', () => { if (typeof loadMapState === 'function') loadMapState(); });
// Phase 11 R1: character walked through an edge transition — reload map
// so the token appears in the new location.
ws.on('bv2.character_edge_transitioned', d => {
  if (typeof loadMapState === 'function') loadMapState();
});

ws.on('session.state', data => {
  const s = data.session;
  $('#session-name').textContent = s.name;
  $('#session-status').textContent = s.status;
  $('#session-turn').textContent = s.turn_number;
  $('#connected-count').textContent = data.connected_count;
  addLog('session.state', `Loaded: ${s.name}`);
  refreshChars();
});

// ══════════════════════════════════════════════════════════════
// GENERIC ENTITY INVALIDATION — live refresh without page reload
// ══════════════════════════════════════════════════════════════
// Server emits `entity.invalidated` after every DB commit via the
// SQLAlchemy after_commit dispatcher (app/realtime.py). Payload:
//   { changes: [{ entity, character_id, action }, ...] }
// GM cares about almost everything — the party list / combat panel /
// quest panel should track any player's mutations. Each refresher is
// debounced so a flood of writes collapses into a single refetch.
function _gmCall(fn, ...args) {
  if (typeof fn === 'function') { try { fn(...args); } catch (e) { console.warn('gm refresh error', e); } }
}
const _gmInvRefreshers = {
  // ── Character-scoped ──────────────────────────────────────
  Character: () => {
    _gmCall(refreshChars);
    if (typeof activeCombat !== 'undefined' && activeCombat) _gmCall(loadCombatPanel);
    _gmCall(loadMapState);
  },
  // GM-side per-character inventory / notes / memory panels live in
  // modals that re-fetch on open. Refreshing the party list on these
  // mutations still helps because HP / slot counters live there.
  InventoryItem:       () => { _gmCall(refreshChars); },
  InventoryItemPoison: () => {},
  CharacterAbility:    () => { _gmCall(loadGmAbilities); _gmCall(refreshChars); },
  StatModifier:        () => { _gmCall(refreshChars); },
  AttackModifier:      () => { _gmCall(refreshChars); },
  DamageModifier:      () => { _gmCall(refreshChars); },
  CharacterEffect:     () => { _gmCall(refreshChars); },
  CharacterStatusEffect: () => { _gmCall(refreshChars); },
  CharacterQuest:      () => { _gmCall(loadQuests); },
  CharacterProfession: () => { _gmCall(refreshChars); },
  TurnTimer:           () => { _gmCall(refreshChars); },
  CharacterNote:       () => {},   // only visible in notes modal
  CharacterMemory:     () => {},   // only visible in memory modal
  CharacterWizardState:() => { _gmCall(loadWizardPending); },
  NpcReputation:       () => {},
  NpcShopInventory:    () => {},
  // ── Session-scoped ────────────────────────────────────────
  Session: () => { _gmCall(refreshChars); },
  CombatEvent: () => {
    _gmCall(refreshChars);
    _gmCall(loadCombatPanel);
    _gmCall(loadMapState);
  },
  CombatParticipant: () => {
    _gmCall(loadCombatPanel);
    _gmCall(refreshChars);
  },
  CombatAction: () => { _gmCall(loadCombatPanel); },
  InitiativeOrder: () => { _gmCall(loadCombatPanel); },
  SessionAnnouncement: () => { _gmCall(loadAnnouncements); },
  QuestTemplate: () => { _gmCall(loadQuests); },
  MapData:    () => { _gmCall(loadMapState); },
  MapMarker:  () => { _gmCall(loadMapState); },
  MapDrawing: () => { _gmCall(loadMapState); },
  MapObject:  () => { _gmCall(loadMapState); },
  NpcFolder:    () => { _gmCall(loadNpcLibrary); },
  NpcTemplate:  () => { _gmCall(loadNpcLibrary); },
  EventTemplate:() => { _gmCall(loadNpcLibrary); },
  ShopItem:     () => {},   // only visible in shop editor modal
  TradeSession: () => {},   // trade modals manage themselves
  // ── Global templates ──────────────────────────────────────
  Ability:        () => { _gmCall(loadGmAbilities); },
  Race:           () => { _gmCall(loadRacesClasses); },
  CharacterClass: () => { _gmCall(loadRacesClasses); },
  StatusEffectTemplate: () => {},
  PoisonTemplate:       () => {},
  EquipmentTemplate:    () => {},
};
const _gmInvPending = new Set();
let _gmInvTimer = null;
function _gmInvFlush() {
  const keys = Array.from(_gmInvPending);
  _gmInvPending.clear();
  _gmInvTimer = null;
  for (const key of keys) {
    const fn = _gmInvRefreshers[key];
    if (fn) try { fn(); } catch (e) { console.warn('gm inv refresh', key, e); }
  }
}
ws.on('entity.invalidated', d => {
  if (!d || !Array.isArray(d.changes)) return;
  for (const ch of d.changes) {
    if (ch && ch.entity && _gmInvRefreshers[ch.entity]) {
      _gmInvPending.add(ch.entity);
    }
  }
  if (_gmInvPending.size === 0) return;
  if (_gmInvTimer) clearTimeout(_gmInvTimer);
  _gmInvTimer = setTimeout(_gmInvFlush, 200);
});

ws.on('session.player_joined', data => {
  $('#connected-count').textContent = data.connected_count;
  addLog('session.player_joined', `${data.role} joined (${data.connected_count} online)`);
  refreshChars();
});

ws.on('session.player_disconnected', data => {
  $('#connected-count').textContent = data.connected_count;
  addLog('session.player_disconnected', `${data.role} left (${data.connected_count} online)`);
});

ws.on('*', (event, data) => {
  if (event.startsWith('_') || event === 'session.state') return;
  if (event !== 'session.player_joined' && event !== 'session.player_disconnected') {
    addLog(event, JSON.stringify(data).substring(0, 120));
  }
});

// Rework Phase 7: GM-side starting-item approval
ws.on('wizard.update', data => {
  if (data && data.needs_gm_approve && data.character_id) {
    openGmWizardApprovalModal(data.character_id);
  }
});
ws.on('wizard.completed', data => {
  if (data && data.character_id) {
    addLog('wizard', `✅ Starting item approved for character #${data.character_id} (${data.rarity})`);
  }
});

async function openGmWizardApprovalModal(charId) {
  // Avoid duplicates
  if (document.getElementById(`gm-wiz-approve-${charId}`)) return;
  let ws_state;
  try { ws_state = await api.get(`/api/wizard/${charId}`); } catch { return; }
  const data = ws_state.data || {};
  if (!data.proposed_item || ws_state.is_completed) return;

  const char = characters.find(c => c.id === charId) || { name: `#${charId}` };
  const rarity = data.starting_roll?.rarity || 'common';
  const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

  const overlay = document.createElement('div');
  overlay.id = `gm-wiz-approve-${charId}`;
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:480px">
      <h2 style="margin-top:0">🎁 Starting-Item Approval</h2>
      <div style="font-size:0.88rem;margin-bottom:8px"><strong>${char.name}</strong> rolled
        <strong>d20 = ${data.starting_roll?.d20 ?? '?'}</strong> → proposed:</div>
      <div style="padding:10px;background:var(--bg-surface-2);border-radius:var(--r-md);margin-bottom:10px">
        <div style="font-weight:700;font-size:1rem">${data.proposed_item.name}</div>
        <div style="font-size:0.78rem;color:var(--text-muted);margin-top:4px">${data.proposed_item.description || '(no description)'}</div>
        <div style="font-size:0.72rem;margin-top:4px">Category: <strong>${data.proposed_item.category || 'misc'}</strong></div>
      </div>
      <label style="font-size:0.78rem">Rarity (override if needed)</label>
      <select id="gmw-rarity" style="width:100%;margin-bottom:8px">
        ${rarities.map(r => `<option value="${r}" ${r===rarity?'selected':''}>${r}</option>`).join('')}
      </select>
      <label style="font-size:0.78rem">GM note (optional)</label>
      <input type="text" id="gmw-note" placeholder="e.g. Nice concept" style="width:100%;margin-bottom:12px">
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" id="gmw-cancel">Close</button>
        <button class="btn btn-danger btn-sm" id="gmw-reject">Reject</button>
        <button class="btn btn-primary btn-sm" id="gmw-approve">Approve</button>
      </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#gmw-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#gmw-reject').addEventListener('click', async () => {
    const note = overlay.querySelector('#gmw-note').value.trim();
    try {
      await api.post(`/api/wizard/${charId}/reject-item`, { note });
      addLog('gm.wizard', `Rejected starting-item for ${char.name}`);
      overlay.remove();
      loadWizardPending();
    } catch { showToast('Failed to reject'); }
  });
  overlay.querySelector('#gmw-approve').addEventListener('click', async () => {
    const rarity_override = overlay.querySelector('#gmw-rarity').value;
    const note = overlay.querySelector('#gmw-note').value.trim();
    try {
      const res = await api.post(`/api/wizard/${charId}/approve-item`, { rarity_override, note });
      addLog('gm.wizard', `Approved starting-item for ${char.name} (${res.rarity})`);
      overlay.remove();
      loadWizardPending();
    } catch { showToast('Failed to approve'); }
  });
}

// ══════════════════════════════════════════════════════════════
// Rework v2 — Pending starting-item approvals (GM topbar badge)
// ══════════════════════════════════════════════════════════════
let _wizardPending = [];
async function loadWizardPending() {
  const btn   = document.getElementById('btn-wizard-pending');
  const badge = document.getElementById('wizard-pending-count');
  if (!btn || !badge) return;
  if (!SESSION_ID) { btn.style.display = 'none'; return; }
  try {
    _wizardPending = await api.get(`/api/wizard/session/${SESSION_ID}/pending`);
  } catch { _wizardPending = []; }
  if (!_wizardPending.length) {
    btn.style.display = 'none';
    return;
  }
  btn.style.display = 'inline-flex';
  badge.textContent = _wizardPending.length;
}

function openWizardPendingList() {
  if (!_wizardPending.length) return;
  // One pending → open the approval modal directly.
  if (_wizardPending.length === 1) {
    openGmWizardApprovalModal(_wizardPending[0].character_id);
    return;
  }
  // Multiple → picker list.
  if (document.getElementById('gm-wiz-pending-list')) return;
  const overlay = document.createElement('div');
  overlay.id = 'gm-wiz-pending-list';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:440px">
      <h2 style="margin-top:0">🎁 Pending Starting-Item Approvals</h2>
      <div style="display:flex;flex-direction:column;gap:6px;max-height:60vh;overflow-y:auto">
        ${_wizardPending.map(p => `
          <button class="btn btn-ghost btn-sm" data-wiz-pick="${p.character_id}"
                  style="justify-content:flex-start;text-align:left;padding:8px 10px">
            <div style="display:flex;flex-direction:column;gap:2px;width:100%">
              <div style="display:flex;align-items:center;gap:6px">
                <strong>${p.character_name}</strong>
                ${p.starting_roll ? `<span class="rarity-chip rarity-${p.starting_roll.rarity}">${p.starting_roll.rarity}</span>` : ''}
                ${p.wizard_completed ? '<span style="font-size:0.62rem;color:var(--accent-orange);margin-left:auto">in-game</span>' : ''}
              </div>
              <div style="font-size:0.72rem;color:var(--text-muted)">
                ${(p.proposed_item && p.proposed_item.name) || '(unnamed)'} —
                ${(p.proposed_item && p.proposed_item.category) || 'misc'}
              </div>
            </div>
          </button>
        `).join('')}
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:10px">
        <button class="btn btn-ghost btn-sm" id="gm-wiz-pending-close">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#gm-wiz-pending-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelectorAll('[data-wiz-pick]').forEach(b => {
    b.addEventListener('click', () => {
      const cid = parseInt(b.dataset.wizPick);
      overlay.remove();
      openGmWizardApprovalModal(cid);
    });
  });
}

// Wire topbar pending button
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-wizard-pending');
  if (btn) btn.addEventListener('click', openWizardPendingList);
});
// Refresh when any wizard event fires
ws.on('wizard.update',         () => loadWizardPending());
ws.on('wizard.item_approved',  () => loadWizardPending());
ws.on('wizard.item_rejected',  () => loadWizardPending());
ws.on('wizard.completed',      () => loadWizardPending());

// ══════════════════════════════════════════════════════════════
