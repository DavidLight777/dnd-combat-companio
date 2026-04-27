// ════════════════════════════════════════════════════════
// Quest system
// Source: gm-app.js lines 6234–6781
// Globals shared via window.* and module-scope hoisting.
// ════════════════════════════════════════════════════════

// STAGE 8 — QUEST SYSTEM
// ══════════════════════════════════════════════════════════════
let questTemplates = [];
let activeQuests = [];

async function loadQuests() {
  try {
    const sess = await api.get(`/api/sessions/${SESSION_CODE}`);
    const [tpls, quests] = await Promise.all([
      api.get(`/api/quest-templates?session_id=${sess.id}`),
      api.get(`/api/quests/session/${SESSION_CODE}`),
    ]);
    questTemplates = tpls;
    activeQuests = quests;
    renderQuestTemplates();
    renderActiveQuests();
  } catch (e) { console.error('loadQuests error', e); }
}

function renderQuestTemplates() {
  const panel = $('#quest-templates-panel');
  if (!panel) return;
  if (!questTemplates.length) {
    panel.innerHTML = '<p class="text-muted" style="font-size:0.8rem">No quest templates yet. Click "+ Quest Template" to create one.</p>';
    return;
  }
  panel.innerHTML = questTemplates.map(t => {
    const stages = t.stages || [];
    const stageLabel = stages.length ? `${stages.length} stage${stages.length > 1 ? 's' : ''}` : 'No stages';
    return `
      <div style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--r-md);margin-bottom:6px;background:var(--bg-surface)">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <span style="font-weight:700;font-size:0.85rem">📜 ${t.title}</span>
            <span style="font-size:0.65rem;color:var(--text-muted);margin-left:6px">${stageLabel}</span>
            ${t.reward_is_hidden ? '<span style="font-size:0.6rem;color:var(--accent-orange);margin-left:4px">🔒 Hidden Reward</span>' : ''}
          </div>
          <div style="display:flex;gap:4px">
            <button class="btn btn-primary btn-xs" onclick="openQuestAssignModal(${t.id})">📤 Assign</button>
            <button class="btn btn-ghost btn-xs" onclick="openQuestEditorModal(${t.id})">✏️</button>
            <button class="btn btn-danger btn-xs" onclick="deleteQuestTemplate(${t.id})">🗑️</button>
          </div>
        </div>
        ${t.description ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px">${t.description.substring(0, 100)}${t.description.length > 100 ? '...' : ''}</div>` : ''}
        ${t.reward_description ? `<div style="font-size:0.7rem;margin-top:3px;color:var(--accent)">Reward: ${t.reward_is_hidden ? '???' : t.reward_description}</div>` : ''}
      </div>
    `;
  }).join('');
}

function renderActiveQuests() {
  const panel = $('#quest-active-panel');
  if (!panel) return;
  const active = activeQuests.filter(q => q.status === 'active');
  const completed = activeQuests.filter(q => q.status === 'completed');
  const failed = activeQuests.filter(q => q.status === 'failed');

  if (!activeQuests.length) {
    panel.innerHTML = '<p class="text-muted" style="font-size:0.8rem">No quests assigned yet.</p>';
    return;
  }

  let html = '';

  if (active.length) {
    html += '<div style="font-size:0.8rem;font-weight:700;margin-bottom:6px">Active Quests</div>';
    html += active.map(q => renderQuestRow(q)).join('');
  }

  if (completed.length) {
    html += `<details style="margin-top:10px"><summary style="font-size:0.8rem;font-weight:700;cursor:pointer;color:var(--accent)">✅ Completed (${completed.length})</summary>`;
    html += completed.map(q => renderQuestRow(q)).join('');
    html += '</details>';
  }

  if (failed.length) {
    html += `<details style="margin-top:10px"><summary style="font-size:0.8rem;font-weight:700;cursor:pointer;color:#f44336">❌ Failed (${failed.length})</summary>`;
    html += failed.map(q => renderQuestRow(q)).join('');
    html += '</details>';
  }

  panel.innerHTML = html;
}

function renderQuestRow(q) {
  const stagesCompleted = q.stages_completed || [];
  const statusColors = { active: 'var(--accent)', completed: '#4caf50', failed: '#f44336' };
  const statusIcons = { active: '🔵', completed: '✅', failed: '❌' };

  // Build stage chain if quest has stages (look up from template)
  const tpl = questTemplates.find(t => t.id === q.quest_template_id);
  const stages = tpl ? (tpl.stages || []) : [];

  let stageChain = '';
  if (stages.length > 0) {
    stageChain = stages.map((s, i) => {
      const done = stagesCompleted.includes(i);
      const current = i === q.current_stage && q.status === 'active';
      const style = done ? 'background:#4caf5030;color:#4caf50;border:1px solid #4caf50'
                   : current ? 'background:var(--accent)20;color:var(--accent);border:1px solid var(--accent)'
                   : 'background:var(--bg-surface-2);color:var(--text-muted);border:1px solid var(--border)';
      return `<span style="display:inline-block;padding:2px 6px;border-radius:8px;font-size:0.6rem;${style}" title="${s.title || ''}">${done ? '✓' : current ? '●' : '○'} ${i + 1}</span>`;
    }).join(' → ');
  }

  const buttons = q.status === 'active' ? `
    <div style="display:flex;gap:3px;margin-top:4px">
      ${stages.length > 0 ? `<button class="btn btn-ghost btn-xs" onclick="completeQuestStage(${q.id}, ${q.current_stage})">✅ Complete Stage ${q.current_stage + 1}</button>` : ''}
      <button class="btn btn-primary btn-xs" onclick="completeQuest(${q.id})">🏆 Complete Quest</button>
      <button class="btn btn-danger btn-xs" onclick="failQuest(${q.id})">❌ Fail</button>
    </div>
  ` : '';

  return `
    <div style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--r-md);margin-bottom:6px;background:var(--bg-surface);border-left:3px solid ${statusColors[q.status] || 'var(--border)'}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <span style="font-size:0.7rem;font-weight:700;color:var(--text-muted)">${q.character_name || ''}</span>
          <span style="font-weight:700;font-size:0.82rem;margin-left:6px">${statusIcons[q.status] || ''} ${q.title}</span>
        </div>
      </div>
      ${q.source_npc_name ? `<div style="font-size:0.7rem;color:var(--text-muted)">From: ${q.source_npc_name}</div>` : ''}
      ${stageChain ? `<div style="margin-top:4px;display:flex;gap:2px;align-items:center;flex-wrap:wrap">${stageChain}</div>` : ''}
      ${buttons}
    </div>
  `;
}

async function completeQuestStage(questId, stageIndex) {
  try {
    await api.patch(`/api/character-quests/${questId}/complete-stage`, { stage_index: stageIndex });
    addLog('gm.quest', `Completed stage ${stageIndex + 1} of quest #${questId}`);
    // WS broadcast
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({ type: 'quest.stage_completed', quest_id: questId, stage_index: stageIndex }));
    }
    loadQuests();
  } catch (e) { showToast('Failed to complete stage'); }
}

async function completeQuest(questId) {
  if (!confirm('Complete this quest and grant rewards?')) return;
  try {
    await api.patch(`/api/character-quests/${questId}/complete`, {});
    addLog('gm.quest', `Quest #${questId} completed!`);
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({ type: 'quest.completed', quest_id: questId }));
    }
    loadQuests();
  } catch (e) { showToast('Failed to complete quest'); }
}

async function failQuest(questId) {
  if (!confirm('Mark this quest as failed?')) return;
  try {
    await api.patch(`/api/character-quests/${questId}/fail`, {});
    addLog('gm.quest', `Quest #${questId} failed`);
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({ type: 'quest.failed', quest_id: questId }));
    }
    loadQuests();
  } catch (e) { showToast('Failed to mark quest as failed'); }
}

async function deleteQuestTemplate(tplId) {
  if (!confirm('Delete this quest template?')) return;
  try {
    await api.del(`/api/quest-templates/${tplId}`);
    loadQuests();
  } catch (e) { showToast('Failed to delete template'); }
}

function renderStructuredRewardItems(items) {
  if (!items || !items.length) return '<div style="font-size:0.72rem;color:var(--text-muted)">No items</div>';
  return items.map((it, i) => `
    <div class="qt-sr-item" data-sr-idx="${i}" style="display:flex;gap:4px;align-items:center;margin-bottom:3px">
      <input type="number" class="qt-sr-item-id" value="${it.item_id || ''}" placeholder="Item ID" style="width:60px;font-size:0.72rem">
      <input type="number" class="qt-sr-item-qty" value="${it.quantity || 1}" min="1" style="width:50px;font-size:0.72rem">
      <button class="btn btn-danger btn-xs" onclick="this.closest('div').remove()">×</button>
    </div>
  `).join('');
}

function openQuestEditorModal(tplId = null) {
  const existing = tplId ? questTemplates.find(t => t.id === tplId) : null;
  const npcs = characters.filter(c => c.is_npc);

  let stages = existing ? (existing.stages || []) : [];

  function renderStageRows() {
    return stages.map((s, i) => `
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:4px">
        <span style="font-size:0.7rem;font-weight:700;width:20px">${i + 1}.</span>
        <input type="text" class="quest-stage-title" data-idx="${i}" value="${s.title || ''}" placeholder="Stage title" style="flex:1;font-size:0.78rem">
        <input type="text" class="quest-stage-desc" data-idx="${i}" value="${s.description || ''}" placeholder="Description" style="flex:2;font-size:0.78rem">
        <button class="btn btn-danger btn-xs" onclick="this.closest('div').remove(); document.querySelector('#quest-stage-list').querySelectorAll('.quest-stage-title').forEach((el,j) => el.closest('div').querySelector('span').textContent = (j+1)+'.')">×</button>
      </div>
    `).join('');
  }

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="width:520px;max-height:90vh;overflow-y:auto">
      <h2 style="margin-bottom:12px">${existing ? 'Edit' : 'Create'} Quest Template</h2>
      <div style="display:flex;flex-direction:column;gap:8px">
        <input type="text" id="qt-title" value="${existing ? existing.title : ''}" placeholder="Quest title" style="font-size:0.85rem;font-weight:700">
        <textarea id="qt-desc" placeholder="Description" rows="3" style="font-size:0.78rem">${existing ? existing.description : ''}</textarea>

        <label style="font-size:0.75rem;font-weight:600">Source NPC</label>
        <select id="qt-npc" style="font-size:0.78rem">
          <option value="">— None —</option>
          ${npcs.map(n => `<option value="${n.id}" ${existing && existing.source_npc_id === n.id ? 'selected' : ''}>${n.name}</option>`).join('')}
        </select>

        <label style="font-size:0.75rem;font-weight:600">Stages</label>
        <div id="quest-stage-list">${renderStageRows()}</div>
        <button class="btn btn-ghost btn-xs" id="btn-qt-add-stage" style="align-self:flex-start">+ Add Stage</button>

        <hr style="border-color:var(--border)">
        <label style="font-size:0.75rem;font-weight:600">Rewards</label>
        <div style="display:flex;gap:6px;align-items:center">
          <label style="font-size:0.72rem">Gold (copper):</label>
          <input type="number" id="qt-gold" value="${existing ? (existing.reward_gold_bronze ?? existing.reward_gold_copper ?? 0) : 0}" style="width:80px;font-size:0.78rem">
        </div>
        <input type="text" id="qt-reward-desc" value="${existing ? existing.reward_description : ''}" placeholder="Reward description (shown to player)" style="font-size:0.78rem">
        <label style="font-size:0.72rem;display:flex;align-items:center;gap:4px">
          <input type="checkbox" id="qt-hidden" ${existing && existing.reward_is_hidden ? 'checked' : ''}>
          Hidden reward (player sees "???")
        </label>

        <hr style="border-color:var(--border);margin-top:10px">
        <label style="font-size:0.75rem;font-weight:600">Structured Rewards</label>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <label style="font-size:0.72rem">XP:</label>
          <input type="number" id="qt-sr-xp" value="${existing?.structured_rewards?.xp ?? 0}" style="width:60px;font-size:0.78rem">
          <label style="font-size:0.72rem">P:</label>
          <input type="number" id="qt-sr-p" value="${existing?.structured_rewards?.currency?.platinum ?? 0}" style="width:50px;font-size:0.78rem">
          <label style="font-size:0.72rem">G:</label>
          <input type="number" id="qt-sr-g" value="${existing?.structured_rewards?.currency?.gold ?? 0}" style="width:50px;font-size:0.78rem">
          <label style="font-size:0.72rem">S:</label>
          <input type="number" id="qt-sr-s" value="${existing?.structured_rewards?.currency?.silver ?? 0}" style="width:50px;font-size:0.78rem">
          <label style="font-size:0.72rem">B:</label>
          <input type="number" id="qt-sr-b" value="${existing?.structured_rewards?.currency?.bronze ?? 0}" style="width:50px;font-size:0.78rem">
        </div>
        <div style="margin-top:8px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span style="font-size:0.72rem;font-weight:600">Items</span>
            <button class="btn btn-ghost btn-xs" id="btn-qt-sr-add-item">+ Add Item</button>
          </div>
          <div id="qt-sr-items">${renderStructuredRewardItems(existing?.structured_rewards?.items || [])}</div>
        </div>

        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-primary btn-sm" id="btn-qt-save" style="flex:1">${existing ? 'Save' : 'Create'}</button>
          <button class="btn btn-ghost btn-sm" id="btn-qt-cancel" style="flex:1">Cancel</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#btn-qt-add-stage').addEventListener('click', () => {
    const list = modal.querySelector('#quest-stage-list');
    const idx = list.querySelectorAll('.quest-stage-title').length;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:4px;align-items:center;margin-bottom:4px';
    row.innerHTML = `
      <span style="font-size:0.7rem;font-weight:700;width:20px">${idx + 1}.</span>
      <input type="text" class="quest-stage-title" data-idx="${idx}" placeholder="Stage title" style="flex:1;font-size:0.78rem">
      <input type="text" class="quest-stage-desc" data-idx="${idx}" placeholder="Description" style="flex:2;font-size:0.78rem">
      <button class="btn btn-danger btn-xs" onclick="this.closest('div').remove()">×</button>
    `;
    list.appendChild(row);
  });

  modal.querySelector('#btn-qt-sr-add-item')?.addEventListener('click', () => {
    const list = modal.querySelector('#qt-sr-items');
    const row = document.createElement('div');
    row.className = 'qt-sr-item';
    row.style.cssText = 'display:flex;gap:4px;align-items:center;margin-bottom:3px';
    row.innerHTML = `
      <input type="number" class="qt-sr-item-id" placeholder="Item ID" style="width:60px;font-size:0.72rem">
      <input type="number" class="qt-sr-item-qty" value="1" min="1" style="width:50px;font-size:0.72rem">
      <button class="btn btn-danger btn-xs" onclick="this.closest('div').remove()">×</button>
    `;
    list.appendChild(row);
  });

  modal.querySelector('#btn-qt-cancel').addEventListener('click', () => modal.remove());
  modal.querySelector('#btn-qt-save').addEventListener('click', async () => {
    const title = modal.querySelector('#qt-title').value.trim();
    if (!title) { showToast('Title required'); return; }
    const stageEls = modal.querySelectorAll('.quest-stage-title');
    const descEls = modal.querySelectorAll('.quest-stage-desc');
    const stagesData = [];
    stageEls.forEach((el, i) => {
      stagesData.push({ order: i + 1, title: el.value.trim(), description: descEls[i]?.value.trim() || '' });
    });

    const sess = await api.get(`/api/sessions/${SESSION_CODE}`);

    // Structured rewards
    const srItems = [];
    modal.querySelectorAll('.qt-sr-item').forEach(row => {
      const itemId = parseInt(row.querySelector('.qt-sr-item-id').value);
      const qty = parseInt(row.querySelector('.qt-sr-item-qty').value) || 1;
      if (itemId) srItems.push({ item_id: itemId, quantity: qty });
    });
    const structuredRewards = {
      xp: parseInt(modal.querySelector('#qt-sr-xp').value) || 0,
      currency: {
        platinum: parseInt(modal.querySelector('#qt-sr-p').value) || 0,
        gold: parseInt(modal.querySelector('#qt-sr-g').value) || 0,
        silver: parseInt(modal.querySelector('#qt-sr-s').value) || 0,
        bronze: parseInt(modal.querySelector('#qt-sr-b').value) || 0,
      },
      items: srItems,
    };

    const payload = {
      session_id: sess.id,
      title,
      description: modal.querySelector('#qt-desc').value.trim(),
      source_npc_id: parseInt(modal.querySelector('#qt-npc').value) || null,
      reward_gold_bronze: parseInt(modal.querySelector('#qt-gold').value) || 0,
      reward_item_ids: [],
      reward_description: modal.querySelector('#qt-reward-desc').value.trim(),
      reward_is_hidden: modal.querySelector('#qt-hidden').checked,
      stages: stagesData,
      is_multi_stage: stagesData.length > 0,
      structured_rewards: structuredRewards,
    };

    try {
      if (existing) {
        await api.put(`/api/quest-templates/${existing.id}`, payload);
      } else {
        await api.post('/api/quest-templates', payload);
      }
      modal.remove();
      loadQuests();
    } catch (e) { showToast('Failed to save quest template'); }
  });
}

function openQuestAssignModal(tplId) {
  const tpl = questTemplates.find(t => t.id === tplId);
  if (!tpl) return;
  const players = characters.filter(c => !c.is_npc);

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="width:380px">
      <h2 style="margin-bottom:10px">Assign: ${tpl.title}</h2>
      <div style="font-size:0.78rem;margin-bottom:10px">Select players to receive this quest:</div>
      <div id="qa-players" style="display:flex;flex-direction:column;gap:4px;margin-bottom:12px">
        ${players.map(p => `
          <label style="display:flex;gap:6px;align-items:center;font-size:0.8rem;cursor:pointer">
            <input type="checkbox" value="${p.id}" checked> ${p.name}
          </label>
        `).join('')}
        ${!players.length ? '<span style="font-size:0.75rem;color:var(--text-muted)">No players in session</span>' : ''}
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" id="btn-qa-assign" style="flex:1">📤 Assign</button>
        <button class="btn btn-ghost btn-sm" id="btn-qa-cancel" style="flex:1">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#btn-qa-cancel').addEventListener('click', () => modal.remove());
  modal.querySelector('#btn-qa-assign').addEventListener('click', async () => {
    const checked = [...modal.querySelectorAll('#qa-players input:checked')].map(i => parseInt(i.value));
    if (!checked.length) { showToast('Select at least one player'); return; }
    try {
      const res = await api.post('/api/quests/assign', { template_id: tplId, character_ids: checked });
      addLog('gm.quest', `Assigned "${tpl.title}" to ${res.assigned.length} player(s)`);
      // WS notify each player
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        for (const a of res.assigned) {
          ws.ws.send(JSON.stringify({ type: 'quest.assigned', character_id: a.character_id, quest_title: tpl.title }));
        }
      }
      modal.remove();
      loadQuests();
    } catch (e) { showToast('Failed to assign quest'); }
  });
}

// Wire quest sub-tabs and buttons
document.querySelectorAll('.quest-sub').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.quest-sub').forEach(b => { b.classList.remove('active'); b.classList.add('btn-ghost'); });
    btn.classList.add('active');
    btn.classList.remove('btn-ghost');
    const sub = btn.dataset.qsub;
    $('#quest-active-panel').style.display = sub === 'active' ? 'block' : 'none';
    $('#quest-templates-panel').style.display = sub === 'templates' ? 'block' : 'none';
  });
});

$('#btn-quest-create')?.addEventListener('click', () => openQuestEditorModal());

// Quick Assign — choose template or create custom, then pick players
$('#btn-quest-assign-quick')?.addEventListener('click', () => openQuickAssignModal());

function openQuickAssignModal() {
  const players = characters.filter(c => !c.is_npc);
  if (!players.length) { showToast('No players in session'); return; }

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="width:480px;max-height:90vh;overflow-y:auto">
      <h2 style="margin-bottom:12px">📤 Assign Quest</h2>

      <!-- Source: template or custom -->
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <button class="btn btn-sm qa-src active" data-src="template" style="font-size:0.78rem">From Template</button>
        <button class="btn btn-sm btn-ghost qa-src" data-src="custom" style="font-size:0.78rem">Custom Quest</button>
      </div>

      <!-- Template picker -->
      <div id="qa-template-section">
        ${questTemplates.length ? `
          <select id="qa-tpl-select" style="width:100%;font-size:0.8rem;margin-bottom:8px">
            ${questTemplates.map(t => `<option value="${t.id}">${t.title} (${t.stages.length} stages)</option>`).join('')}
          </select>
          <div id="qa-tpl-preview" style="font-size:0.72rem;color:var(--text-muted);margin-bottom:10px"></div>
        ` : '<div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:10px">No templates. Create one first or use "Custom Quest".</div>'}
      </div>

      <!-- Custom quest fields -->
      <div id="qa-custom-section" style="display:none">
        <input type="text" id="qa-custom-title" placeholder="Quest title" style="width:100%;font-size:0.82rem;font-weight:700;margin-bottom:6px">
        <textarea id="qa-custom-desc" placeholder="Description" rows="2" style="width:100%;font-size:0.78rem;margin-bottom:6px"></textarea>
        <input type="text" id="qa-custom-npc" placeholder="Source NPC name (optional)" style="width:100%;font-size:0.78rem;margin-bottom:6px">
        <div style="display:flex;gap:6px;margin-bottom:6px">
          <input type="number" id="qa-custom-gold" value="0" placeholder="Gold reward (copper)" style="width:100px;font-size:0.78rem">
          <input type="text" id="qa-custom-reward" placeholder="Reward description" style="flex:1;font-size:0.78rem">
        </div>
        <label style="font-size:0.72rem;display:flex;align-items:center;gap:4px;margin-bottom:8px">
          <input type="checkbox" id="qa-custom-hidden"> Hidden reward
        </label>
      </div>

      <!-- Player selection -->
      <div style="font-size:0.78rem;font-weight:700;margin-bottom:6px">Assign to:</div>
      <div id="qa-player-list" style="display:flex;flex-direction:column;gap:4px;margin-bottom:12px">
        <label style="font-size:0.75rem;cursor:pointer;display:flex;align-items:center;gap:4px;margin-bottom:4px">
          <input type="checkbox" id="qa-select-all" checked> <strong>Select All</strong>
        </label>
        ${players.map(p => `
          <label style="display:flex;gap:6px;align-items:center;font-size:0.8rem;cursor:pointer;padding-left:16px">
            <input type="checkbox" class="qa-player-cb" value="${p.id}" checked> ${p.name}
          </label>
        `).join('')}
      </div>

      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" id="btn-qa-go" style="flex:1">📤 Assign</button>
        <button class="btn btn-ghost btn-sm" id="btn-qa-close" style="flex:1">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Source tabs
  modal.querySelectorAll('.qa-src').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.querySelectorAll('.qa-src').forEach(b => { b.classList.remove('active'); b.classList.add('btn-ghost'); });
      btn.classList.add('active'); btn.classList.remove('btn-ghost');
      const src = btn.dataset.src;
      modal.querySelector('#qa-template-section').style.display = src === 'template' ? 'block' : 'none';
      modal.querySelector('#qa-custom-section').style.display = src === 'custom' ? 'block' : 'none';
    });
  });

  // Template preview
  const tplSelect = modal.querySelector('#qa-tpl-select');
  const preview = modal.querySelector('#qa-tpl-preview');
  function updatePreview() {
    if (!tplSelect || !preview) return;
    const t = questTemplates.find(x => x.id === parseInt(tplSelect.value));
    if (!t) { preview.textContent = ''; return; }
    preview.innerHTML = `${t.description ? t.description.substring(0, 120) : ''}<br>Reward: ${t.reward_is_hidden ? '🔒 Hidden' : (t.reward_description || 'None')}`;
  }
  tplSelect?.addEventListener('change', updatePreview);
  updatePreview();

  // Select all
  modal.querySelector('#qa-select-all')?.addEventListener('change', e => {
    modal.querySelectorAll('.qa-player-cb').forEach(cb => cb.checked = e.target.checked);
  });

  modal.querySelector('#btn-qa-close').addEventListener('click', () => modal.remove());

  modal.querySelector('#btn-qa-go').addEventListener('click', async () => {
    const checked = [...modal.querySelectorAll('.qa-player-cb:checked')].map(i => parseInt(i.value));
    if (!checked.length) { showToast('Select at least one player'); return; }

    const isCustom = modal.querySelector('.qa-src.active')?.dataset.src === 'custom';

    try {
      let payload;
      if (isCustom) {
        const title = modal.querySelector('#qa-custom-title').value.trim();
        if (!title) { showToast('Title required'); return; }
        payload = {
          character_ids: checked,
          title,
          description: modal.querySelector('#qa-custom-desc').value.trim(),
          source_npc_name: modal.querySelector('#qa-custom-npc').value.trim() || null,
          reward_gold_bronze: parseInt(modal.querySelector('#qa-custom-gold').value) || 0,
          reward_description: modal.querySelector('#qa-custom-reward').value.trim(),
          reward_is_hidden: modal.querySelector('#qa-custom-hidden').checked,
          stages: [],
          is_multi_stage: false,
        };
      } else {
        const tplId = parseInt(tplSelect?.value);
        if (!tplId) { showToast('Select a template'); return; }
        payload = { template_id: tplId, character_ids: checked };
      }

      const res = await api.post('/api/quests/assign', payload);
      const questTitle = isCustom ? payload.title : (questTemplates.find(t => t.id === payload.template_id)?.title || 'Quest');
      addLog('gm.quest', `Assigned "${questTitle}" to ${res.assigned.length} player(s)`);

      // WS notify
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        for (const a of res.assigned) {
          ws.ws.send(JSON.stringify({ type: 'quest.assigned', character_id: a.character_id, quest_title: questTitle }));
        }
      }

      modal.remove();
      showToast(`Quest assigned to ${res.assigned.length} player(s)!`);
      loadQuests();
    } catch (e) { showToast('Failed to assign quest'); }
  });
}


// ══════════════════════════════════════════════════════════════
