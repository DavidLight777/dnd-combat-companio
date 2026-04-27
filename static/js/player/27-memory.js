// ════════════════════════════════════════════════════════
// Phase 6: memory tab
// Source: player-app.js lines 4891-5035
// ════════════════════════════════════════════════════════

// PHASE 6 — MEMORY TAB
// ══════════════════════════════════════════════════════════════
let memoryData = [];

async function loadMemory() {
  try {
    memoryData = await api.get(`/api/characters/${CHAR_ID}/memory`);
    renderMemory();
  } catch (e) { console.warn('loadMemory:', e); }
}

function renderMemory() {
  const list = $('#memory-list');
  if (!list) return;
  const search = ($('#memory-search')?.value || '').toLowerCase();
  let filtered = memoryData;
  if (search) {
    filtered = memoryData.filter(m =>
      m.title.toLowerCase().includes(search) || m.content.toLowerCase().includes(search)
    );
  }
  if (!filtered.length) {
    list.innerHTML = '<span class="text-muted" style="font-size:0.8rem">No journal entries</span>';
    return;
  }

  // Group by type
  const groups = { npc_encounter: [], event: [], note: [] };
  filtered.forEach(m => {
    const g = groups[m.entry_type] || groups.note;
    g.push(m);
  });

  let html = '';
  const labels = { npc_encounter: '👤 NPC Encounters', event: '📍 Events', note: '📝 My Notes' };
  for (const [type, entries] of Object.entries(groups)) {
    if (!entries.length) continue;
    html += `<div style="font-weight:700;font-size:0.82rem;margin:8px 0 4px">${labels[type]}</div>`;
    html += entries.map(m => `<div class="memory-entry" data-mem-id="${m.id}">
      <div style="display:flex;align-items:center;gap:8px">
        <span class="me-title">${m.title}</span>
        <span class="me-type">${m.entry_type}</span>
        ${m.entry_type === 'note' ? `<button class="btn btn-ghost btn-xs" data-del-mem="${m.id}" style="margin-left:auto;color:var(--accent-red)">✕</button>` : ''}
      </div>
      <div class="me-content">${m.content || ''}</div>
    </div>`).join('');
  }
  list.innerHTML = html;

  // Click to expand
  list.querySelectorAll('.memory-entry').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('[data-del-mem]')) return;
      el.classList.toggle('expanded');
    });
  });

  // Delete
  list.querySelectorAll('[data-del-mem]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this note?')) return;
      await api.del(`/api/memory/${btn.dataset.delMem}`);
      loadMemory();
    });
  });
}

// Add note button
if ($('#btn-add-memory')) {
  $('#btn-add-memory').addEventListener('click', async () => {
    const title = prompt('Note title:');
    if (!title) return;
    const content = prompt('Note content:');
    await api.post(`/api/characters/${CHAR_ID}/memory`, {
      entry_type: 'note', title, content: content || '',
    });
    loadMemory();
  });
}

// Search filter
if ($('#memory-search')) {
  $('#memory-search').addEventListener('input', () => renderMemory());
}

// WS listeners for Phase 6
ws.on('ability.cooldown_ready', d => {
  if (d.character_id == CHAR_ID) {
    showToast(`✨ ${d.ability_name} is ready!`);
    loadAbilities();
  }
});
ws.on('ability.rank_promoted', d => {
  if (d.character_id == CHAR_ID) {
    showToast(`⭐ ${d.ability_name} promoted to ${d.new_rank}!`);
    loadAbilities();
    loadChar();
  }
});
ws.on('combat.attack_result', d => {
  if (d.target_id == CHAR_ID || d.attacker_id == CHAR_ID) {
    loadChar();
    loadTableView();
  }
  // HP of attacker/target may have changed — grid bars need to catch up,
  // regardless of whether CHAR_ID was involved.
  loadPlayerMapState();
});
ws.on('combat.character_downed', d => {
  loadTableView();
  loadPlayerMapState();
});
ws.on('table.updated', () => {
  loadTableView();
  loadPlayerMapState();
});
// FIX 1: Re-render table on HP, status, or turn change.
// Rework v3 Phase 1: the embedded battle grid renders token HP bars from
// the same data, so we refresh the map state in lock-step. `loadPlayerMapState`
// is cheap (two GETs) and coalescing would be premature given real-world
// tick rates.
const _refreshBoth = () => { loadTableView(); loadPlayerMapState(); };
ws.on('character.hp_changed', _refreshBoth);
ws.on('character.hp_update',  _refreshBoth);
ws.on('character.status_changed', _refreshBoth);
ws.on('status_effect.applied',  _refreshBoth);
ws.on('status_effect.removed',  _refreshBoth);
ws.on('status_effect.expired',  _refreshBoth);
// FIX 5: Auto-populate Memory tab — refresh + toast on new entry
ws.on('memory.entry_added', d => {
  if (d.character_id != CHAR_ID) return;
  const typeIcon = d.entry_type === 'npc_encounter' ? '👥'
                 : d.entry_type === 'event' ? '📜'
                 : '📝';
  showToast(`${typeIcon} ${d.title}`);
  loadMemory();
});

// FIX 4: Log OTHER players' free-rolls (own roll is logged locally by the widget to avoid duplication)
ws.on('roll.free_roll', d => {
  if (d.character_id == CHAR_ID) return;
  addLog(`🎲 ${d.character_name || 'Someone'}: ${d.breakdown}`);
});

// ══════════════════════════════════════════════════════════════
