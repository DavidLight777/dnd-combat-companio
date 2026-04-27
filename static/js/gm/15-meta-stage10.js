// ════════════════════════════════════════════════════════
// Stage 10: announcements, notes, timer, log filters, AI NPC gen
// Source: gm-app.js lines 7183–7558
// Globals shared via window.* and module-scope hoisting.
// ════════════════════════════════════════════════════════

// STAGE 10 — ANNOUNCEMENTS
// ══════════════════════════════════════════════════════════════
async function loadAnnouncements() {
  try {
    const list = await api.get(`/api/announcements/${SESSION_CODE}`);
    const el = $('#announcements-list');
    if (!el) return;
    if (!list.length) { el.innerHTML = '<p class="text-muted" style="font-size:0.8rem">No announcements yet.</p>'; return; }
    el.innerHTML = list.map(a => `
      <div style="padding:8px 10px;margin-bottom:6px;border-radius:var(--r-md);border:1px solid ${a.is_pinned ? 'var(--accent)' : 'var(--border)'};background:${a.is_pinned ? 'rgba(212,175,55,0.06)' : 'var(--bg-surface-2)'}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-weight:600;font-size:0.78rem">${a.is_pinned ? '📌 ' : ''}${a.author_name || 'GM'}</span>
          <span style="font-size:0.68rem;color:var(--text-muted)">${a.posted_at ? new Date(a.posted_at).toLocaleString() : ''}</span>
        </div>
        <div style="font-size:0.82rem;white-space:pre-wrap">${a.content}</div>
        <div style="display:flex;gap:4px;margin-top:6px;justify-content:flex-end">
          <button class="btn btn-ghost btn-xs" data-ann-pin="${a.id}" data-pinned="${a.is_pinned}">${a.is_pinned ? 'Unpin' : 'Pin'}</button>
          <button class="btn btn-ghost btn-xs" data-ann-del="${a.id}" style="color:var(--danger)">Delete</button>
        </div>
      </div>
    `).join('');
    el.querySelectorAll('[data-ann-pin]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.patch(`/api/announcements/${btn.dataset.annPin}/pin`, { is_pinned: btn.dataset.pinned !== 'true' });
        loadAnnouncements();
        if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
          ws.ws.send(JSON.stringify({ type: 'announcement.pinned', announcement_id: parseInt(btn.dataset.annPin) }));
        }
      });
    });
    el.querySelectorAll('[data-ann-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.del(`/api/announcements/${btn.dataset.annDel}`);
        loadAnnouncements();
        if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
          ws.ws.send(JSON.stringify({ type: 'announcement.deleted', announcement_id: parseInt(btn.dataset.annDel) }));
        }
      });
    });
  } catch (e) { console.error('loadAnnouncements', e); }
}

$('#btn-post-announce')?.addEventListener('click', async () => {
  const input = $('#announce-input');
  const content = input.value.trim();
  if (!content) return;
  const is_pinned = $('#announce-pin')?.checked || false;
  const a = await api.post(`/api/announcements/${SESSION_CODE}`, { content, is_pinned });
  input.value = '';
  if ($('#announce-pin')) $('#announce-pin').checked = false;
  loadAnnouncements();
  addLog('gm.announce', `Announcement posted: "${content.substring(0, 60)}..."`);
  if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
    ws.ws.send(JSON.stringify({ type: 'announcement.posted', announcement: a }));
  }
});

// ══════════════════════════════════════════════════════════════
// STAGE 10 — CHARACTER NOTES (GM side)
// ══════════════════════════════════════════════════════════════
async function loadCharNotes(charId) {
  const container = document.querySelector('#char-notes-section');
  if (!container) return;
  try {
    const notes = await api.get(`/api/notes/character/${charId}/all`);
    const playerNotes = notes.filter(n => !n.is_gm_note);
    const gmNotes = notes.filter(n => n.is_gm_note);
    container.innerHTML = `
      <div style="margin-bottom:8px;display:flex;align-items:center;gap:8px">
        <h4 style="font-size:0.82rem;flex:1">📝 Notes</h4>
        <button class="btn btn-primary btn-xs" id="btn-add-gm-note">+ GM Note</button>
      </div>
      ${gmNotes.length ? `<div style="margin-bottom:8px"><span style="font-size:0.72rem;color:var(--text-muted)">GM Notes (hidden from player):</span>
        ${gmNotes.map(n => `
          <div style="padding:6px 8px;margin:4px 0;background:rgba(212,175,55,0.08);border:1px solid var(--accent);border-radius:var(--r-sm)">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <strong style="font-size:0.78rem">${n.title || 'Untitled'}</strong>
              <div style="display:flex;gap:3px">
                <button class="btn btn-ghost btn-xs" data-edit-note="${n.id}">✏️</button>
                <button class="btn btn-ghost btn-xs" data-del-note="${n.id}" style="color:var(--danger)">🗑️</button>
              </div>
            </div>
            <div style="font-size:0.78rem;white-space:pre-wrap;margin-top:3px">${n.content}</div>
          </div>
        `).join('')}
      </div>` : ''}
      ${playerNotes.length ? `<div><span style="font-size:0.72rem;color:var(--text-muted)">Player Notes (read-only):</span>
        ${playerNotes.map(n => `
          <div style="padding:6px 8px;margin:4px 0;background:var(--bg-surface-2);border:1px solid var(--border);border-radius:var(--r-sm)">
            <strong style="font-size:0.78rem">${n.title || 'Untitled'}</strong>
            <div style="font-size:0.78rem;white-space:pre-wrap;margin-top:3px">${n.content}</div>
          </div>
        `).join('')}
      </div>` : '<p class="text-muted" style="font-size:0.75rem">No player notes.</p>'}
    `;
    container.querySelector('#btn-add-gm-note')?.addEventListener('click', () => openNoteModal(charId, null, true));
    container.querySelectorAll('[data-edit-note]').forEach(btn => {
      const note = notes.find(n => n.id === parseInt(btn.dataset.editNote));
      btn.addEventListener('click', () => openNoteModal(charId, note, true));
    });
    container.querySelectorAll('[data-del-note]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.del(`/api/notes/${btn.dataset.delNote}`);
        loadCharNotes(charId);
      });
    });
  } catch (e) { console.error('loadCharNotes', e); }
}

function openNoteModal(charId, existing, isGm) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="width:440px">
      <div class="modal-header"><h3>${existing ? 'Edit' : 'New'} ${isGm ? 'GM' : ''} Note</h3></div>
      <div class="modal-body">
        <label class="form-label">Title</label>
        <input type="text" id="note-title" value="${existing?.title || ''}" style="width:100%;margin-bottom:8px">
        <label class="form-label">Content</label>
        <textarea id="note-content" rows="6" style="width:100%;resize:vertical">${existing?.content || ''}</textarea>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost btn-sm" id="btn-note-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="btn-note-save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#btn-note-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#btn-note-save').addEventListener('click', async () => {
    const body = { title: overlay.querySelector('#note-title').value, content: overlay.querySelector('#note-content').value, is_gm_note: isGm };
    if (existing) await api.put(`/api/notes/${existing.id}`, body);
    else await api.post(`/api/notes/character/${charId}`, body);
    overlay.remove();
    loadCharNotes(charId);
  });
}

// ══════════════════════════════════════════════════════════════
// STAGE 10 — SESSION TIMER
// ══════════════════════════════════════════════════════════════
let sessionTimerRunning = false;
let sessionTimerBase = 0;
let sessionTimerStartedAt = null;
let sessionTimerInterval = null;

function formatTimer(totalSec) {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function updateTimerDisplay() {
  let total = sessionTimerBase;
  if (sessionTimerRunning && sessionTimerStartedAt) {
    total += Math.floor((Date.now() - sessionTimerStartedAt) / 1000);
  }
  const el = $('#session-timer-display');
  if (el) el.textContent = formatTimer(total);
}

function startTimerTick() {
  if (sessionTimerInterval) clearInterval(sessionTimerInterval);
  sessionTimerInterval = setInterval(updateTimerDisplay, 1000);
  updateTimerDisplay();
}

async function loadSessionTimer() {
  try {
    const t = await api.get(`/api/sessions/${SESSION_CODE}/timer`);
    sessionTimerBase = t.total_seconds || 0;
    sessionTimerRunning = t.running;
    if (t.running && t.started_at) {
      sessionTimerStartedAt = new Date(t.started_at).getTime();
      sessionTimerBase = (t.total_seconds || 0) - Math.floor((Date.now() - sessionTimerStartedAt) / 1000);
      if (sessionTimerBase < 0) sessionTimerBase = 0;
    } else {
      sessionTimerStartedAt = null;
    }
    const btn = $('#btn-timer-toggle');
    if (btn) btn.textContent = sessionTimerRunning ? '⏸' : '▶';
    startTimerTick();
  } catch (e) { console.error('loadSessionTimer', e); }
}

$('#btn-timer-toggle')?.addEventListener('click', async () => {
  if (sessionTimerRunning) {
    const t = await api.post(`/api/sessions/${SESSION_CODE}/timer/pause`);
    sessionTimerRunning = false;
    sessionTimerBase = t.total_seconds;
    sessionTimerStartedAt = null;
    $('#btn-timer-toggle').textContent = '▶';
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({ type: 'session.timer_paused', total_seconds: t.total_seconds }));
    }
  } else {
    const t = await api.post(`/api/sessions/${SESSION_CODE}/timer/start`);
    sessionTimerRunning = true;
    sessionTimerBase = 0;
    sessionTimerStartedAt = Date.now();
    sessionTimerBase = t.total_seconds - Math.floor((Date.now() - sessionTimerStartedAt) / 1000);
    $('#btn-timer-toggle').textContent = '⏸';
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({ type: 'session.timer_started', total_seconds: t.total_seconds }));
    }
  }
  updateTimerDisplay();
});

// ══════════════════════════════════════════════════════════════
// STAGE 10 — ENHANCED EVENT LOG (filter, search, export)
// ══════════════════════════════════════════════════════════════
let logFilter = 'all';
let logSearchTerm = '';

document.querySelectorAll('.log-filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.log-filter-btn').forEach(b => { b.classList.remove('active'); b.classList.add('btn-ghost'); });
    btn.classList.add('active');
    btn.classList.remove('btn-ghost');
    logFilter = btn.dataset.logFilter;
    applyLogFilters();
  });
});

$('#log-search')?.addEventListener('input', e => {
  logSearchTerm = e.target.value.toLowerCase();
  applyLogFilters();
});

function applyLogFilters() {
  const log = $('#event-log');
  if (!log) return;
  const entries = log.querySelectorAll('.log-entry');
  entries.forEach(entry => {
    const cat = entry.dataset.logCat || '';
    const text = entry.textContent.toLowerCase();
    const matchFilter = logFilter === 'all' || cat.includes(logFilter);
    const matchSearch = !logSearchTerm || text.includes(logSearchTerm);
    entry.style.display = (matchFilter && matchSearch) ? '' : 'none';
  });
}

$('#btn-export-log')?.addEventListener('click', () => {
  const log = $('#event-log');
  if (!log) return;
  const entries = log.querySelectorAll('.log-entry');
  let text = `Event Log — Session ${SESSION_CODE}\nExported: ${new Date().toLocaleString()}\n${'='.repeat(50)}\n\n`;
  entries.forEach(entry => {
    if (entry.style.display !== 'none') {
      text += entry.textContent.trim() + '\n';
    }
  });
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `event-log-${SESSION_CODE}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

// ══════════════════════════════════════════════════════════════
// STAGE 10 — AI NPC GENERATION
// ══════════════════════════════════════════════════════════════
function openAINpcModal(templateModal) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.zIndex = '1100';
  overlay.innerHTML = `
    <div class="modal" style="width:500px">
      <div class="modal-header"><h3>🤖 Generate NPC with AI</h3></div>
      <div class="modal-body">
        <label class="form-label">Describe this NPC:</label>
        <textarea id="ai-npc-desc" rows="3" placeholder="An old bitter blacksmith who was once an adventurer, now retired..." style="width:100%;resize:vertical"></textarea>
        <div id="ai-npc-preview" style="margin-top:12px;display:none"></div>
        <div id="ai-npc-loading" style="display:none;text-align:center;padding:12px;color:var(--text-muted)">⏳ Generating...</div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost btn-sm" id="btn-ai-npc-close">Cancel</button>
        <button class="btn btn-secondary btn-sm" id="btn-ai-npc-retry" style="display:none">🔄 Retry</button>
        <button class="btn btn-primary btn-sm" id="btn-ai-npc-generate">✨ Generate</button>
        <button class="btn btn-primary btn-sm" id="btn-ai-npc-use" style="display:none">✅ Use This</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  let generatedNpc = null;

  overlay.querySelector('#btn-ai-npc-close').addEventListener('click', () => overlay.remove());

  async function doGenerate() {
    const desc = overlay.querySelector('#ai-npc-desc').value.trim();
    if (!desc) return;
    overlay.querySelector('#ai-npc-loading').style.display = 'block';
    overlay.querySelector('#ai-npc-preview').style.display = 'none';
    overlay.querySelector('#btn-ai-npc-generate').style.display = 'none';
    overlay.querySelector('#btn-ai-npc-retry').style.display = 'none';
    overlay.querySelector('#btn-ai-npc-use').style.display = 'none';

    try {
      const res = await api.post('/api/ai/generate-npc', { description: desc, session_code: SESSION_CODE });
      generatedNpc = res;
      const preview = overlay.querySelector('#ai-npc-preview');
      preview.style.display = 'block';
      preview.innerHTML = `
        <div style="padding:10px;background:var(--bg-surface-2);border-radius:var(--r-md);border:1px solid var(--border)">
          <h4 style="margin-bottom:6px">${res.name || 'NPC'}</h4>
          <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:6px">${res.description || ''}</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:0.75rem">
            <span>❤️ HP: ${res.max_hp ?? 0}</span><span>🛡️ AC: ${res.armor_class ?? 0}</span>
            <span>STR: ${res.strength ?? 0}</span><span>DEX: ${res.dexterity ?? 0}</span>
            <span>CON: ${res.constitution ?? 0}</span><span>INT: ${res.intelligence ?? 0}</span>
            <span>WIS: ${res.wisdom ?? 0}</span><span>CHA: ${res.charisma ?? 0}</span>
          </div>
          ${res.notes ? `<p style="font-size:0.75rem;margin-top:6px;color:var(--text-muted)">Notes: ${res.notes}</p>` : ''}
        </div>
      `;
      overlay.querySelector('#btn-ai-npc-retry').style.display = '';
      overlay.querySelector('#btn-ai-npc-use').style.display = '';
    } catch (e) {
      overlay.querySelector('#ai-npc-preview').style.display = 'block';
      overlay.querySelector('#ai-npc-preview').innerHTML = `<p style="color:var(--danger)">Failed: ${e.message}</p>`;
      overlay.querySelector('#btn-ai-npc-generate').style.display = '';
    }
    overlay.querySelector('#ai-npc-loading').style.display = 'none';
  }

  overlay.querySelector('#btn-ai-npc-generate').addEventListener('click', doGenerate);
  overlay.querySelector('#btn-ai-npc-retry').addEventListener('click', doGenerate);
  overlay.querySelector('#btn-ai-npc-use').addEventListener('click', () => {
    if (!generatedNpc || !templateModal) { overlay.remove(); return; }
    // Fill template modal fields
    const tm = templateModal;
    const setVal = (sel, val) => { const el = tm.querySelector(sel); if (el && val != null) el.value = val; };
    setVal('#nt-name', generatedNpc.name);
    setVal('#nt-desc', generatedNpc.description);
    setVal('#nt-hp', generatedNpc.max_hp);
    setVal('#nt-ac', generatedNpc.armor_class);
    setVal('#nt-str', generatedNpc.strength);
    setVal('#nt-dex', generatedNpc.dexterity);
    setVal('#nt-con', generatedNpc.constitution);
    setVal('#nt-int', generatedNpc.intelligence);
    setVal('#nt-wis', generatedNpc.wisdom);
    setVal('#nt-cha', generatedNpc.charisma);
    setVal('#nt-init', generatedNpc.initiative_bonus);
    setVal('#nt-notes', generatedNpc.notes);
    if (generatedNpc.is_merchant && tm.querySelector('#nt-merchant')) tm.querySelector('#nt-merchant').checked = true;
    overlay.remove();
  });
}

// ══════════════════════════════════════════════════════════════
// STAGE 10 — WS listeners for announcements & timer
// ══════════════════════════════════════════════════════════════
ws.on('announcement.posted', () => loadAnnouncements());
ws.on('announcement.pinned', () => loadAnnouncements());
ws.on('announcement.deleted', () => loadAnnouncements());
ws.on('session.timer_started', d => {
  sessionTimerRunning = true;
  sessionTimerStartedAt = Date.now();
  sessionTimerBase = (d.total_seconds || 0) - Math.floor((Date.now() - sessionTimerStartedAt) / 1000);
  $('#btn-timer-toggle').textContent = '⏸';
  startTimerTick();
});
ws.on('session.timer_paused', d => {
  sessionTimerRunning = false;
  sessionTimerBase = d.total_seconds || 0;
  sessionTimerStartedAt = null;
  $('#btn-timer-toggle').textContent = '▶';
  updateTimerDisplay();
});

// ══════════════════════════════════════════════════════════════
