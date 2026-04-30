// ════════════════════════════════════════════════════════
// WebSocket + entity invalidation
// Source: player-app.js lines 2189-2380
// ════════════════════════════════════════════════════════

// WEBSOCKET
// ══════════════════════════════════════════════════════════════
const ws = new WsClient(SESSION_CODE, PLAYER_TOKEN);

ws.on('_connected', () => {
  $('#ws-dot').className = 'status-dot connected';
  $('#ws-label').textContent = 'connected';
});
ws.on('_disconnected', () => {
  $('#ws-dot').className = 'status-dot disconnected';
  $('#ws-label').textContent = 'disconnected';
});
ws.on('_reconnecting', d => { $('#ws-label').textContent = `reconnecting (${d.attempt})...`; });

ws.on('character.hp_update', d => {
  if (d.character_id == CHAR_ID) loadChar();
});
ws.on('inventory.item_added', d => {
  if (d.character_id == CHAR_ID) { loadInventory(); renderBonusesPenalties(); }
});
ws.on('inventory.item_equipped', d => {
  if (d.character_id == CHAR_ID) { loadInventory(); renderBonusesPenalties(); }
});
ws.on('inventory.item_removed', d => {
  if (d.character_id == CHAR_ID) { loadInventory(); renderBonusesPenalties(); }
});
ws.on('combat.bonuses_updated', d => {
  if (d.character_id == CHAR_ID) { loadInventory(); loadChar(); renderBonusesPenalties(); }
});
ws.on('status.updated', d => {
  if (d.character_id == CHAR_ID) { renderBonusesPenalties(); }
});
ws.on('session.status_change', d => {
  if (d.status === 'ended') addLog('[Session] Ended by GM');
});
// Rework v3: Player-to-player item transfer.
ws.on('inventory.transferred', d => {
  const me = parseInt(CHAR_ID);
  if (d.from_character_id === me) {
    showToast(`🎁 Sent ${d.item_name} ×${d.quantity} to ${d.to_character_name}`);
    loadInventory();
  } else if (d.to_character_id === me) {
    showToast(`🎁 Received ${d.item_name} ×${d.quantity} from ${d.from_character_name}`);
    addLog(`🎁 Received ${d.item_name} ×${d.quantity} from ${d.from_character_name}`);
    loadInventory();
  }
});
// Rework v3: GM triggered Full Rest — refresh and notify the player.
ws.on('session.full_rest', async () => {
  try {
    char = await api.get(`/api/characters/${CHAR_ID}`);
    renderAll();
  } catch {}
  showToast('🌙 Full Rest — HP, mana, cooldowns and uses restored');
  addLog('[Rest] Full Rest applied by GM');
});
// Stage 3: Economy WS events
ws.on('currency.updated', d => {
  if (d.character_id == CHAR_ID) loadCurrency();
});
// Phase 3: Mana WS events
ws.on('mana.updated', d => {
  if (d.character_id == CHAR_ID) { loadChar(); }
});
ws.on('trade.initiated', d => {
  if (d.player_id == CHAR_ID) {
    openTradeModal(d.trade_id, d.npc_id, d.npc_name);
  }
});
ws.on('trade.closed', d => {
  closeTradeModal();
});
// Stage 4: Status effect events
ws.on('status_effect.applied', d => {
  if (d.character_id == CHAR_ID) loadStatusEffects();
});
ws.on('status_effect.removed', d => {
  if (d.character_id == CHAR_ID) loadStatusEffects();
});
ws.on('status_effect.expired', d => {
  if (d.character_id == CHAR_ID) { loadStatusEffects(); showToast(`${d.effect_name} expired`); }
});
// Phase 9: character walked through an edge transition
ws.on('bv2.character_edge_transitioned', d => {
  if (d.character_id == CHAR_ID) {
    showToast('You move to a new area…');
    loadPlayerMapState();
  }
});

// Live-sync: refresh the player Map view on every builder mutation.
// Builder v2 already broadcasts these; player just needs to listen.
// Coalesced so a tile-paint burst doesn't spam loadPlayerMapState.
let _bv2MapRefreshScheduled = false;
function _scheduleBv2MapRefresh() {
  if (_bv2MapRefreshScheduled) return;
  _bv2MapRefreshScheduled = true;
  setTimeout(() => {
    _bv2MapRefreshScheduled = false;
    if (typeof loadPlayerMapState === 'function') loadPlayerMapState();
  }, 200);
}
[
  'bv2.map_added', 'bv2.map_updated', 'bv2.map_deleted',
  'bv2.map_activated',
  'bv2.location_added', 'bv2.location_updated', 'bv2.location_deleted',
  'bv2.location_activated',
  'bv2.tiles_patched', 'bv2.tiles_replaced',
  'bv2.entity_added', 'bv2.entity_updated', 'bv2.entity_deleted',
  'bv2.light_added', 'bv2.light_updated', 'bv2.light_deleted',
  'bv2.edge_added', 'bv2.edge_updated', 'bv2.edge_deleted',
  'bv2.portal_added', 'bv2.portal_updated', 'bv2.portal_deleted',
  'bv2.interior_zone_added', 'bv2.interior_zone_updated', 'bv2.interior_zone_deleted',
  'bv2.cover_zone_added', 'bv2.cover_zone_updated', 'bv2.cover_zone_deleted',
  'bv2.chest_added', 'bv2.chest_updated', 'bv2.chest_deleted',
  'bv2.trap_added', 'bv2.trap_updated', 'bv2.trap_deleted',
  'bv2.npc_spawn_added', 'bv2.npc_spawn_updated', 'bv2.npc_spawn_deleted',
].forEach(evt => ws.on(evt, _scheduleBv2MapRefresh));

// Phase 17 Round 3: Map lock toggle
ws.on('map.lock_changed', d => {
  window.__lastMapLockState = !!d.locked;
  const panel = document.getElementById('player-grid-panel');
  if (panel) panel.classList.toggle('map-locked', !!d.locked);
  if (d.locked) showToast('🗺 Map locked by GM');
});

// ══════════════════════════════════════════════════════════════
// GENERIC ENTITY INVALIDATION — live refresh without page reload
// ══════════════════════════════════════════════════════════════
// The server emits `entity.invalidated` after every DB commit via the
// SQLAlchemy after_commit dispatcher (app/realtime.py). Payload:
//   { changes: [{ entity, character_id, action }, ...] }
// We map each entity type to the existing loader and debounce so that
// bursts of writes (e.g. batch HP update + status effect tick) collapse
// into a single refetch.
function _call(fn, ...args) {
  if (typeof fn === 'function') { try { fn(...args); } catch (e) { console.warn('refresh error', e); } }
}
const _invRefreshers = {
  // ── Character-scoped ──────────────────────────────────────
  // Character: the sheet, at-the-table HP bars, map tokens, currency
  // (wealth_bronze lives on Character).
  Character: () => {
    loadChar();
    _call(loadCurrency);
    _call(loadTableView);
    _call(loadPlayerMapState);
    _call(loadCombatBanner);
  },
  InventoryItem: () => {
    loadInventory();
    _call(loadCurrency);
    _call(renderBonusesPenalties);
    loadChar();  // max HP / AC can change with gear
  },
  InventoryItemPoison: () => { loadInventory(); },
  CharacterAbility: () => { _call(loadAbilities); _call(renderBonusesPenalties); },
  StatModifier:    () => { _call(renderBonusesPenalties); loadChar(); },
  AttackModifier:  () => { _call(renderBonusesPenalties); },
  DamageModifier:  () => { _call(renderBonusesPenalties); },
  CharacterEffect: () => { _call(loadStatusEffects); _call(renderBonusesPenalties); },
  CharacterStatusEffect: () => { _call(loadStatusEffects); _call(renderBonusesPenalties); },
  CharacterQuest:  () => { _call(loadPlayerQuests); },
  CharacterProfession: () => { loadChar(); },
  TurnTimer: () => { loadChar(); },
  CharacterNote: () => { _call(loadPlayerNotes); },
  CharacterMemory: () => { _call(loadMemory); },
  CharacterWizardState: () => { /* wizard has its own WS events */ },
  NpcReputation: () => { _call(loadTableView); },
  NpcShopInventory: () => { /* only visible while trade modal open */ },
  // ── Session-scoped ────────────────────────────────────────
  Session: () => {
    _call(loadCombatBanner);
    _call(loadTableView);
  },
  CombatEvent: () => {
    _call(loadCombatBanner);
    _call(loadTableView);
    _call(loadPlayerMapState);
  },
  CombatParticipant: () => {
    _call(loadCombatBanner);
    _call(loadTableView);
  },
  CombatAction: () => {
    _call(loadCombatBanner);
  },
  InitiativeOrder: () => { _call(loadCombatBanner); },
  SessionAnnouncement: () => { _call(loadPlayerAnnouncements); },
  QuestTemplate: () => { _call(loadPlayerQuests); },   // template desc may change
  MapData:    () => { _call(loadPlayerMapState); },
  MapMarker:  () => { _call(loadPlayerMapState); },
  MapDrawing: () => { _call(loadPlayerMapState); },
  MapObject:  () => { _call(loadPlayerMapState); },
  // Global templates — player UI mostly doesn't care, but ability
  // templates change the rendered ability description on the fly.
  Ability:        () => { _call(loadAbilities); },
  Race:           () => { /* selection is at character-creation time */ },
  CharacterClass: () => { loadChar(); },
  StatusEffectTemplate: () => { _call(loadStatusEffects); },
  PoisonTemplate: () => { _call(loadInventory); },
};
const _invPending = new Set();
let _invTimer = null;
function _invFlush() {
  const keys = Array.from(_invPending);
  _invPending.clear();
  _invTimer = null;
  for (const key of keys) {
    const fn = _invRefreshers[key];
    if (fn) try { fn(); } catch (e) { console.warn('inv refresh', key, e); }
  }
}
ws.on('entity.invalidated', d => {
  if (!d || !Array.isArray(d.changes)) return;
  const me = parseInt(CHAR_ID);
  for (const ch of d.changes) {
    if (!ch || !ch.entity) continue;
    if (!_invRefreshers[ch.entity]) continue;
    // Character rows always matter: own = my sheet; others = table-view
    // HP bars and map token HP. Character-scoped rows (those carrying a
    // character_id) only matter if they belong to ME — other players'
    // inventory / abilities / notes etc. don't render in my UI. All
    // remaining (session-scoped) entities are kept unconditionally.
    if (ch.character_id != null && ch.character_id !== me && ch.entity !== 'Character') {
      continue;
    }
    _invPending.add(ch.entity);
  }
  if (_invPending.size === 0) return;
  if (_invTimer) clearTimeout(_invTimer);
  _invTimer = setTimeout(_invFlush, 200);
});

// ══════════════════════════════════════════════════════════════
