// ════════════════════════════════════════════════════════
// AI chat panel
// Source: gm-app.js lines 4578–4711
// Globals shared via window.* and module-scope hoisting.
// ════════════════════════════════════════════════════════

// AI CHAT
// ══════════════════════════════════════════════════════════════
let aiSending = false;

$('#ai-sidebar-toggle').addEventListener('click', () => {
  $('#ai-sidebar').classList.toggle('collapsed');
});

async function loadAIHistory() {
  try {
    const data = await api.get(`/api/ai/history/${SESSION_CODE}`);
    const container = $('#ai-messages');
    container.innerHTML = '';
    for (const msg of data.messages) {
      appendAIMessage(msg.role, msg.content);
    }
    container.scrollTop = container.scrollHeight;
  } catch { /* silent */ }
}

// Rework v3: the server now returns a parsed envelope
// ({reply, say, actions:[{kind, ok, id, name, error}], parse_error}).
// We render `say` in the bubble and render each action as its own card so
// the GM can see exactly what was created (or why it failed).
function _renderAIMessageText(div, content) {
  const safe = String(content || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  div.innerHTML = safe
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

function _renderAIActionCard(action) {
  const card = document.createElement('div');
  card.className = 'ai-item-preview';
  const KIND_LABEL = {
    create_item: '📦 Item',
    create_npc: '🎭 NPC',
    create_ability: '✨ Ability',
  };
  const label = KIND_LABEL[action.kind] || action.kind;
  if (action.ok === false || action.error) {
    card.style.borderLeft = '3px solid var(--accent-red)';
    card.innerHTML = `<strong>${label}</strong> <span style="color:var(--accent-red)">failed</span><br>
      <span style="font-size:0.75rem;color:var(--text-muted)">${action.error || 'unknown error'}</span>`;
    return card;
  }
  const extras = [];
  if (action.rarity) extras.push(action.rarity);
  if (action.category) extras.push(action.category);
  if (action.max_hp) extras.push(`HP ${action.max_hp}`);
  if (action.armor_class) extras.push(`AC ${action.armor_class}`);
  if (action.ability_type) extras.push(action.ability_type);
  if (action.target_type) extras.push(action.target_type);
  card.innerHTML = `
    <div>✓ <strong>${label}</strong> created — <strong>${action.name || ''}</strong>
      ${extras.length ? `<span style="font-size:0.72rem;color:var(--text-muted)">(${extras.join(' · ')})</span>` : ''}
    </div>
    <div style="font-size:0.72rem;color:var(--text-muted)">id #${action.id}</div>`;
  return card;
}

function appendAIMessage(role, content, actions) {
  const container = $('#ai-messages');
  const div = document.createElement('div');
  div.className = `ai-msg ${role}`;

  if (role === 'assistant') {
    _renderAIMessageText(div, content || '');
    for (const a of (actions || [])) div.appendChild(_renderAIActionCard(a));
  } else {
    div.textContent = content;
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function sendAIMessage(msg) {
  if (aiSending || !msg.trim()) return;
  aiSending = true;
  appendAIMessage('user', msg);
  $('#ai-input').value = '';
  $('#btn-ai-send').textContent = '...';
  $('#btn-ai-send').disabled = true;

  try {
    const res = await api.post('/api/ai/chat', { session_code: SESSION_CODE, message: msg });
    if (res.error) {
      appendAIMessage('assistant', `⚠️ ${res.error}`);
    } else {
      // Prefer the parsed `say` for display. Fall back to raw reply if the
      // model failed to emit a valid envelope (parse_error != null).
      const text = res.say || res.reply || '';
      appendAIMessage('assistant', text, res.actions || []);
      // Toast any new items/NPCs so other GM panels refresh immediately.
      for (const a of (res.actions || [])) {
        if (a.ok === false || a.error) continue;
        if (a.kind === 'create_item')    { showToast(`📦 ${a.name} added`);   if (typeof loadItems     === 'function') loadItems();     }
        if (a.kind === 'create_npc')     { showToast(`🎭 ${a.name} spawned`); if (typeof loadCharacters === 'function') loadCharacters(); }
        if (a.kind === 'create_ability') { showToast(`✨ ${a.name} forged`);  if (typeof loadAbilities  === 'function') loadAbilities();  }
      }
    }
  } catch (e) {
    appendAIMessage('assistant', `⚠️ Error: ${e.message}`);
  }
  aiSending = false;
  $('#btn-ai-send').textContent = 'Send';
  $('#btn-ai-send').disabled = false;
}

$('#btn-ai-send').addEventListener('click', () => sendAIMessage($('#ai-input').value));
$('#ai-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAIMessage($('#ai-input').value); }
});

// Quick action buttons
$$('[data-ai-quick]').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.aiQuick;
    // Rework v3 prompts — the model is envelope-schema aware, so tell it
    // which kind of action we want (or none) instead of asking for free JSON.
    const prompts = {
      narrate: 'Narrate the current combat situation dramatically in <=300 chars. Emit no actions.',
      npc:     'Analyze the battlefield and suggest what each NPC should do this turn. Short bullets. Emit no actions.',
      item:    'Invent ONE creative fantasy item themed to this session and emit it via a single create_item action. Keep "say" under 200 chars.',
      summary: 'Summarize this session so far in <=400 chars (key events, damage, items, moments). Emit no actions.',
    };
    if (prompts[action]) sendAIMessage(prompts[action]);
  });
});

// ══════════════════════════════════════════════════════════════
