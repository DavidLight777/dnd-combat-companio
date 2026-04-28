// ════════════════════════════════════════════════════════
// Stage 8: player quests
// Source: player-app.js lines 3005-3225
// ════════════════════════════════════════════════════════

// STAGE 8 — PLAYER QUESTS
// ══════════════════════════════════════════════════════════════
let playerQuests = [];

async function loadPlayerQuests() {
  try {
    playerQuests = await api.get(`/api/characters/${CHAR_ID}/quests`);
    renderPlayerQuests();
  } catch (e) { console.error('loadPlayerQuests error', e); }
}

function renderPlayerQuests() {
  const activePanel = $('#player-quests-active');
  const completedPanel = $('#player-quests-completed');
  if (!activePanel) return;

  const active = playerQuests.filter(q => q.status === 'active');
  const done = playerQuests.filter(q => q.status === 'completed' || q.status === 'failed');

  if (!active.length) {
    activePanel.innerHTML = '<div style="color:var(--text-muted);font-size:0.78rem;padding:8px">No active quests.</div>';
  } else {
    activePanel.innerHTML = active.map(q => renderPlayerQuestCard(q)).join('');
  }

  if (!done.length) {
    completedPanel.innerHTML = '<div style="color:var(--text-muted);font-size:0.78rem;padding:8px">No completed quests yet.</div>';
  } else {
    completedPanel.innerHTML = done.map(q => renderPlayerQuestCard(q)).join('');
  }
}

function renderPlayerQuestCard(q) {
  const stagesCompleted = q.stages_completed || [];
  const statusColors = { active: 'var(--accent)', completed: '#4caf50', failed: '#f44336' };
  const statusIcons = { active: '📜', completed: '✅', failed: '❌' };

  // Build stage chain from enriched stages data
  const stages = q.stages || [];
  let stageChain = '';
  if (stages.length > 0) {
    stageChain = stages.map((s, i) => {
      const done = stagesCompleted.includes(i);
      const current = i === q.current_stage && q.status === 'active';
      const style = done ? 'background:#4caf5030;color:#4caf50;border:1px solid #4caf50'
                   : current ? 'background:var(--accent)20;color:var(--accent);border:1px solid var(--accent)'
                   : 'background:var(--bg-surface-2);color:var(--text-muted);border:1px solid var(--border)';
      const label = s.title || `Stage ${i + 1}`;
      return `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:0.65rem;${style}" title="${s.description || ''}">${done ? '✓' : current ? '●' : '○'} ${label}</span>`;
    }).join(' → ');
  }

  // Rewards
  let rewardHtml = '';
  if (q.reward_is_hidden && !q.reward_revealed) {
    rewardHtml = '<div style="font-size:0.72rem;color:var(--accent-orange);margin-top:4px">🔒 Reward: ???</div>';
  } else if (q.reward_description) {
    rewardHtml = `<div style="font-size:0.72rem;color:var(--accent);margin-top:4px">🎁 ${q.reward_description}</div>`;
  }

  return `
    <div style="padding:10px 12px;border:1px solid var(--border);border-radius:var(--r-md);margin-bottom:8px;background:var(--bg-surface);border-left:3px solid ${statusColors[q.status] || 'var(--border)'}">
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:1rem">${statusIcons[q.status] || '📜'}</span>
        <span style="font-weight:700;font-size:0.88rem">${q.title}</span>
      </div>
      ${q.source_npc_name ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px">From: ${q.source_npc_name}</div>` : ''}
      ${q.description ? `<div style="font-size:0.75rem;margin-top:4px">${q.description}</div>` : ''}
      ${stageChain ? `<div style="margin-top:6px;display:flex;gap:3px;align-items:center;flex-wrap:wrap">${stageChain}</div>` : ''}
      ${rewardHtml}
      ${q.status !== 'active' && q.completed_at ? `<div style="font-size:0.6rem;color:var(--text-muted);margin-top:4px">${q.status === 'completed' ? 'Completed' : 'Failed'}: ${new Date(q.completed_at).toLocaleString()}</div>` : ''}
    </div>
  `;
}

// Quest sub-tabs
document.querySelectorAll('.player-quest-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.player-quest-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.pqtab;
    $('#player-quests-active').style.display = tab === 'active' ? 'block' : 'none';
    $('#player-quests-completed').style.display = tab === 'completed' ? 'block' : 'none';
  });
});

// WS listeners for quest events
ws.on('quest.assigned', d => {
  if (d.character_id == CHAR_ID) {
    showToast(`New quest: ${d.quest_title || 'A quest has been assigned!'}`);
    loadPlayerQuests();
  }
});
ws.on('quest.stage_completed', d => {
  showToast('Quest stage completed!');
  loadPlayerQuests();
});
ws.on('quest.completed', d => {
  const rewards = d.rewards_applied || {};
  let msg = 'Quest completed!';
  const parts = [];
  if (rewards.xp) parts.push(`${rewards.xp} XP`);
  if (rewards.currency) parts.push(`${rewards.currency} copper worth`);
  if (rewards.items?.length) parts.push(`${rewards.items.length} item(s)`);
  if (parts.length) msg += ' Rewards: ' + parts.join(', ');
  if (rewards.level_up_available) msg += ' ⬆ Level up available!';
  showToast(msg);
  loadPlayerQuests();
  loadCurrency();
  loadInventory();
  loadChar();
});
ws.on('quest.failed', d => {
  showToast('A quest has been failed...');
  loadPlayerQuests();
});

// ── Map overlay WS events (fan out to every mounted canvas) ────
// Before Rework v3 Phase 1 these only targeted the fullscreen modal
// canvas; now we also keep the always-on Main-tab grid in sync.
ws.on('map.drawing_added', d => {
  if (!d.drawing || !d.drawing.visible_to_players) return;
  _eachMapCanvas(c => { c.drawings.push(d.drawing); c.render(); });
});
ws.on('map.drawing_deleted', d => {
  _eachMapCanvas(c => {
    if (d.all) c.drawings = [];
    else c.drawings = c.drawings.filter(dr => dr.id !== d.drawing_id);
    c.render();
  });
});
ws.on('map.marker_added', d => {
  if (!d.marker || !d.marker.visible_to_players) return;
  _eachMapCanvas(c => { c.markers.push(d.marker); c.render(); });
});
ws.on('map.marker_updated', d => {
  if (!d.marker) return;
  _eachMapCanvas(c => {
    c.markers = c.markers.filter(m => m.id !== d.marker.id);
    if (d.marker.visible_to_players) c.markers.push(d.marker);
    c.render();
  });
});
ws.on('map.marker_deleted', d => {
  _eachMapCanvas(c => {
    c.markers = c.markers.filter(m => m.id !== d.marker_id);
    c.render();
  });
});

// Map uploaded / replaced by the GM. The server broadcasts this after
// `POST /api/map/{code}/upload`; we need a full refresh because the
// image URL, dimensions, grid and token seeds may have all changed.
ws.on('map.updated', () => { loadPlayerMapState(); });

// Live token movement (Rework v3 Phase 1). The server broadcasts this
// after every successful PATCH /api/map/token/{id}, so we can mutate
// the in-memory token lists instead of refetching the whole map state.
ws.on('map.token_moved', d => {
  if (d == null || d.character_id == null) return;
  _eachMapCanvas(c => {
    const t = (c.tokens || []).find(x => x.character_id === d.character_id);
    if (!t) return;  // unknown token; next full refresh will add it
    if (d.visible != null) t.visible = d.visible;
    // Phase 4: carry over the authoritative movement info so the
    // overlay + HUD stay in sync without a refetch.
    if (d.speed_total   != null) t.speed_total   = d.speed_total;
    if (d.movement_used != null) t.movement_used = d.movement_used;
    if (d.movement_left != null) t.movement_left = d.movement_left;
    // Phase 12 R5: smooth interpolation instead of snap
    if (d.x != null && d.y != null) {
      c.animateTokenTo(d.character_id, d.x, d.y);
    }
    c.render();
  });
  // Mirror the same fields into the cached state so HUD helpers that
  // read `_lastMapState` see the latest numbers too.
  if (_lastMapState && d.character_id === CHAR_ID) {
    const cached = (_lastMapState.tokens || []).find(t => t.character_id === d.character_id);
    if (cached) {
      if (d.x != null) cached.x = d.x;
      if (d.y != null) cached.y = d.y;
      if (d.speed_total   != null) cached.speed_total   = d.speed_total;
      if (d.movement_used != null) cached.movement_used = d.movement_used;
      if (d.movement_left != null) cached.movement_left = d.movement_left;
    }
    _refreshMovementBudget();
  }
});

// Phase 4: turn changed → refresh the whole map state so the new
// actor's reset movement budget propagates. Cheap enough (2 GETs) for
// an event that fires once per turn.
ws.on('combat.turn_changed', () => {
  // loadCombatBanner already handles playerCombat + gating; piggy-back
  // here to also refresh the map data (speed_total / movement_left).
  loadPlayerMapState();
});
ws.on('combat.started', () => { loadPlayerMapState(); });
ws.on('combat.ended',   () => { loadPlayerMapState(); });

// Phase 5: a wall / zone was added, edited, or removed.
ws.on('map.objects_updated', () => { loadPlayerMapState(); });

// Map Builder: floor / tiles / trap events
ws.on('map.floor_activated', () => { loadPlayerMapState(); });
ws.on('map.tiles_updated',   () => { loadPlayerMapState(); });
ws.on('map.trap_triggered', d => {
  showToast(`💥 ${d.name || 'Trap'} triggered!`);
  loadPlayerMapState();
});
ws.on('map.trap_discovered', d => {
  showToast(`👁 Trap discovered!`);
  loadPlayerMapState();
});
ws.on('map.chest_added', () => loadPlayerMapState());
ws.on('map.chest_updated', () => loadPlayerMapState());
ws.on('map.chest_deleted', () => loadPlayerMapState());
ws.on('map.portal_added', () => loadPlayerMapState());
ws.on('map.portal_updated', () => loadPlayerMapState());
ws.on('map.portal_deleted', () => loadPlayerMapState());

// ══════════════════════════════════════════════════════════════
