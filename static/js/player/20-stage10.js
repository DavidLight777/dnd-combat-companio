// ════════════════════════════════════════════════════════
// Stage 10: announcements, notes, timer
// Source: player-app.js lines 3343-3504
// ════════════════════════════════════════════════════════

// STAGE 10 — PLAYER ANNOUNCEMENTS
// ══════════════════════════════════════════════════════════════
async function loadPlayerAnnouncements() {
  try {
    const list = await api.get(`/api/announcements/${SESSION_CODE}`);
    const el = $('#player-announcements');
    if (!el) return;
    if (!list.length) { el.innerHTML = '<p class="text-muted" style="font-size:0.8rem">No announcements yet.</p>'; return; }
    el.innerHTML = list.map(a => `
      <div style="padding:8px 10px;margin-bottom:6px;border-radius:8px;border:1px solid ${a.is_pinned ? 'var(--accent)' : 'var(--border)'};background:${a.is_pinned ? 'rgba(212,175,55,0.06)' : 'var(--bg-surface-2)'}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-weight:600;font-size:0.78rem">${a.is_pinned ? '📌 ' : ''}${a.author_name || 'GM'}</span>
          <span style="font-size:0.68rem;color:var(--text-muted)">${a.posted_at ? new Date(a.posted_at).toLocaleString() : ''}</span>
        </div>
        <div style="font-size:0.82rem;white-space:pre-wrap">${a.content}</div>
      </div>
    `).join('');
  } catch (e) { console.error('loadPlayerAnnouncements', e); }
}

// Rework Phase 7: starting-item wizard events (server → player)
ws.on('wizard.completed', d => {
  if (d && d.character_id == CHAR_ID) {
    const overlay = document.getElementById('wiz-starting-item');
    if (overlay) overlay.remove();
    showToast(`🎁 Starting item approved: ${d.rarity || 'unknown'} rarity`);
    loadInventory();
  }
});
ws.on('wizard.update', d => {
  if (d && d.character_id == CHAR_ID && d.rejected) {
    // Refresh the modal to show the rejection note
    maybeShowStartingItemWizard();
  }
});

ws.on('announcement.posted', () => loadPlayerAnnouncements());
ws.on('announcement.pinned', () => loadPlayerAnnouncements());
ws.on('announcement.deleted', () => loadPlayerAnnouncements());

// ══════════════════════════════════════════════════════════════
// STAGE 10 — PLAYER NOTES
// ══════════════════════════════════════════════════════════════
async function loadPlayerNotes() {
  try {
    const notes = await api.get(`/api/notes/character/${CHAR_ID}`);
    const el = $('#player-notes-list');
    if (!el) return;
    if (!notes.length) { el.innerHTML = '<p class="text-muted" style="font-size:0.8rem">No notes yet. Click "+ New Note" to add one.</p>'; return; }
    el.innerHTML = notes.map(n => `
      <div style="padding:8px 10px;margin-bottom:6px;border-radius:8px;border:1px solid var(--border);background:var(--bg-surface-2)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <strong style="font-size:0.82rem">${n.title || 'Untitled'}</strong>
          <div style="display:flex;gap:3px">
            <button class="btn btn-ghost btn-xs" data-edit-pnote="${n.id}">✏️</button>
            <button class="btn btn-ghost btn-xs" data-del-pnote="${n.id}" style="color:var(--danger)">🗑️</button>
          </div>
        </div>
        <div style="font-size:0.8rem;white-space:pre-wrap">${n.content}</div>
        <div style="font-size:0.65rem;color:var(--text-muted);margin-top:4px">${n.updated_at ? new Date(n.updated_at).toLocaleString() : ''}</div>
      </div>
    `).join('');
    el.querySelectorAll('[data-edit-pnote]').forEach(btn => {
      const note = notes.find(no => no.id === parseInt(btn.dataset.editPnote));
      btn.addEventListener('click', () => openPlayerNoteModal(note));
    });
    el.querySelectorAll('[data-del-pnote]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.del(`/api/notes/${btn.dataset.delPnote}`);
        loadPlayerNotes();
      });
    });
  } catch (e) { console.error('loadPlayerNotes', e); }
}

function openPlayerNoteModal(existing) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="width:400px">
      <div class="modal-header"><h3>${existing ? 'Edit' : 'New'} Note</h3></div>
      <div class="modal-body">
        <label style="font-size:0.78rem;font-weight:600">Title</label>
        <input type="text" id="pnote-title" value="${existing?.title || ''}" style="width:100%;margin-bottom:8px">
        <label style="font-size:0.78rem;font-weight:600">Content</label>
        <textarea id="pnote-content" rows="6" style="width:100%;resize:vertical">${existing?.content || ''}</textarea>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost btn-sm" id="pnote-cancel">Cancel</button>
        <button class="btn btn-primary btn-sm" id="pnote-save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#pnote-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#pnote-save').addEventListener('click', async () => {
    const body = { title: overlay.querySelector('#pnote-title').value, content: overlay.querySelector('#pnote-content').value };
    if (existing) await api.put(`/api/notes/${existing.id}`, body);
    else await api.post(`/api/notes/character/${CHAR_ID}`, body);
    overlay.remove();
    loadPlayerNotes();
  });
}

$('#btn-player-add-note')?.addEventListener('click', () => openPlayerNoteModal(null));

// ══════════════════════════════════════════════════════════════
// STAGE 10 — SESSION TIMER (player side)
// ══════════════════════════════════════════════════════════════
let pTimerRunning = false;
let pTimerBase = 0;
let pTimerStartedAt = null;
let pTimerInterval = null;

function pFormatTimer(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function pUpdateTimer() {
  let total = pTimerBase;
  if (pTimerRunning && pTimerStartedAt) total += Math.floor((Date.now() - pTimerStartedAt) / 1000);
  const el = $('#player-timer-display');
  if (el) el.textContent = pFormatTimer(total);
}

async function loadPlayerTimer() {
  try {
    const t = await api.get(`/api/sessions/${SESSION_CODE}/timer`);
    pTimerBase = t.total_seconds || 0;
    pTimerRunning = t.running;
    if (t.running && t.started_at) {
      pTimerStartedAt = new Date(t.started_at).getTime();
      pTimerBase = (t.total_seconds || 0) - Math.floor((Date.now() - pTimerStartedAt) / 1000);
      if (pTimerBase < 0) pTimerBase = 0;
    } else {
      pTimerStartedAt = null;
    }
    if (pTimerInterval) clearInterval(pTimerInterval);
    pTimerInterval = setInterval(pUpdateTimer, 1000);
    pUpdateTimer();
  } catch (e) { console.error('loadPlayerTimer', e); }
}

ws.on('session.timer_started', d => {
  pTimerRunning = true;
  pTimerStartedAt = Date.now();
  pTimerBase = (d.total_seconds || 0) - Math.floor((Date.now() - pTimerStartedAt) / 1000);
  if (pTimerInterval) clearInterval(pTimerInterval);
  pTimerInterval = setInterval(pUpdateTimer, 1000);
  pUpdateTimer();
});
ws.on('session.timer_paused', d => {
  pTimerRunning = false;
  pTimerBase = d.total_seconds || 0;
  pTimerStartedAt = null;
  pUpdateTimer();
});

// ══════════════════════════════════════════════════════════════
