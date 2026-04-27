// ════════════════════════════════════════════════════════
// NPC Library (folders/templates/events)
// Source: gm-app.js lines 6782–7182
// Globals shared via window.* and module-scope hoisting.
// ════════════════════════════════════════════════════════

// STAGE 7 — NPC LIBRARY
// ══════════════════════════════════════════════════════════════
let npcFolders = [];
let npcTemplates = [];
let npcEvents = [];

async function loadNpcLibrary() {
  if (!SESSION_ID) return;
  try {
    const [f, t, e] = await Promise.all([
      api.get(`/api/npc-library/folders?session_id=${SESSION_ID}`),
      api.get(`/api/npc-library/templates?session_id=${SESSION_ID}`),
      api.get(`/api/npc-library/events?session_id=${SESSION_ID}`),
    ]);
    npcFolders = f;
    npcTemplates = t;
    npcEvents = e;
  } catch { npcFolders = []; npcTemplates = []; npcEvents = []; }
  renderNpcLibrary();
}

function renderFolderTree(folders, depth = 0) {
  return folders.map(f => `
    <div style="margin-left:${depth * 16}px;margin-bottom:4px">
      <div style="display:flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid var(--border);border-radius:var(--r-md);background:var(--bg-surface-2)">
        <span style="color:${f.color};font-size:1rem">📁</span>
        <span style="font-weight:700;font-size:0.82rem;flex:1">${f.name}</span>
        <span style="font-size:0.6rem;color:var(--text-muted)">${f.template_count} NPCs</span>
        <button class="btn btn-ghost btn-xs" data-edit-folder="${f.id}">✏️</button>
        <button class="btn btn-ghost btn-xs" data-del-folder="${f.id}" style="color:var(--accent-red)">🗑</button>
      </div>
      ${f.children && f.children.length ? renderFolderTree(f.children, depth + 1) : ''}
    </div>
  `).join('');
}

function renderNpcLibrary() {
  const tree = document.querySelector('#npc-folder-tree');
  const tList = document.querySelector('#npc-template-list');
  const eList = document.querySelector('#npc-event-list');
  if (!tree || !tList || !eList) return;

  // Folder tree
  tree.innerHTML = npcFolders.length ? renderFolderTree(npcFolders) : '<span class="text-muted" style="font-size:0.8rem">No folders.</span>';

  // Templates
  tList.innerHTML = npcTemplates.length ? npcTemplates.map(t => `
    <div style="padding:8px;border:1px solid var(--border);border-radius:var(--r-md);margin-bottom:6px;background:var(--bg-surface-2)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="width:12px;height:12px;border-radius:50%;background:${t.token_color};display:inline-block"></span>
          <span style="font-weight:700;font-size:0.85rem">${t.name}</span>
          ${t.is_merchant ? '<span style="font-size:0.6rem;padding:1px 5px;border-radius:8px;background:var(--accent)20;color:var(--accent)">Merchant</span>' : ''}
        </div>
        <div style="display:flex;gap:3px">
          <button class="btn btn-ghost btn-xs" data-spawn-tpl="${t.id}" title="Spawn">⚡</button>
          <button class="btn btn-ghost btn-xs" data-edit-tpl="${t.id}">✏️</button>
          <button class="btn btn-ghost btn-xs" data-del-tpl="${t.id}" style="color:var(--accent-red)">🗑</button>
        </div>
      </div>
      <div style="font-size:0.7rem;color:var(--text-muted)">${t.description || ''}</div>
      <div style="font-size:0.7rem;margin-top:2px">HP: ${t.max_hp} | KD: ${t.armor_class} | STR:${t.strength} DEX:${t.dexterity} CON:${t.constitution}</div>
    </div>
  `).join('') : '<span class="text-muted" style="font-size:0.8rem">No NPC templates.</span>';

  // Events
  eList.innerHTML = npcEvents.length ? npcEvents.map(e => {
    const entries = e.npc_template_ids || [];
    const summary = entries.map(en => {
      const tpl = npcTemplates.find(t => t.id === en.template_id);
      return `${tpl ? tpl.name : '?'} x${en.count}`;
    }).join(', ');
    return `
    <div style="padding:8px;border:1px solid var(--border);border-radius:var(--r-md);margin-bottom:6px;background:var(--bg-surface-2)">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700;font-size:0.85rem">${e.name}</span>
        <div style="display:flex;gap:3px">
          <button class="btn btn-primary btn-xs" data-trigger-event="${e.id}" title="Trigger">⚡ Trigger</button>
          <button class="btn btn-ghost btn-xs" data-edit-event="${e.id}">✏️</button>
          <button class="btn btn-ghost btn-xs" data-del-event="${e.id}" style="color:var(--accent-red)">🗑</button>
        </div>
      </div>
      <div style="font-size:0.7rem;color:var(--text-muted)">${e.description || ''}</div>
      <div style="font-size:0.65rem;margin-top:2px">${summary || 'No NPCs configured'}</div>
    </div>`;
  }).join('') : '<span class="text-muted" style="font-size:0.8rem">No event templates.</span>';

  // Wire folder actions
  tree.querySelectorAll('[data-edit-folder]').forEach(btn => {
    btn.addEventListener('click', () => {
      const fId = parseInt(btn.dataset.editFolder);
      const flatFolders = flattenFolders(npcFolders);
      const fo = flatFolders.find(x => x.id === fId);
      if (fo) openFolderModal(fo);
    });
  });
  tree.querySelectorAll('[data-del-folder]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this folder?')) return;
      await api.del(`/api/npc-library/folders/${btn.dataset.delFolder}`);
      loadNpcLibrary();
    });
  });

  // Wire template actions
  tList.querySelectorAll('[data-spawn-tpl]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const count = parseInt(prompt('How many to spawn?', '1')) || 1;
      const res = await api.post(`/api/npc-library/templates/${btn.dataset.spawnTpl}/spawn`, { session_id: SESSION_ID, count });
      showToast(`Spawned ${res.spawned.length} NPC(s)`);
      refreshChars();
    });
  });
  tList.querySelectorAll('[data-edit-tpl]').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = npcTemplates.find(x => x.id === parseInt(btn.dataset.editTpl));
      if (t) openNpcTemplateModal(t);
    });
  });
  tList.querySelectorAll('[data-del-tpl]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this template?')) return;
      await api.del(`/api/npc-library/templates/${btn.dataset.delTpl}`);
      loadNpcLibrary();
    });
  });

  // Wire event actions
  eList.querySelectorAll('[data-trigger-event]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Trigger this event? NPCs will be spawned.')) return;
      const res = await api.post(`/api/npc-library/events/${btn.dataset.triggerEvent}/trigger`);
      showToast(`Event "${res.event_name}" triggered — ${res.spawned.length} NPC(s) spawned`);
      refreshChars();
    });
  });
  eList.querySelectorAll('[data-edit-event]').forEach(btn => {
    btn.addEventListener('click', () => {
      const e = npcEvents.find(x => x.id === parseInt(btn.dataset.editEvent));
      if (e) openEventModal(e);
    });
  });
  eList.querySelectorAll('[data-del-event]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this event?')) return;
      await api.del(`/api/npc-library/events/${btn.dataset.delEvent}`);
      loadNpcLibrary();
    });
  });
}

function flattenFolders(folders) {
  let result = [];
  for (const f of folders) {
    result.push(f);
    if (f.children) result = result.concat(flattenFolders(f.children));
  }
  return result;
}

// ── Folder Modal ──
function openFolderModal(existing) {
  const isEdit = !!existing;
  const data = existing || { name: '', color: '#888888', parent_folder_id: null };
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:380px">
      <div class="modal-header"><h3>${isEdit ? 'Edit' : 'Create'} Folder</h3><button class="modal-close">&times;</button></div>
      <div class="modal-body">
        <div class="form-group"><label>Name</label><input type="text" id="nf-name" value="${data.name}"></div>
        <div class="form-group"><label>Color</label><input type="color" id="nf-color" value="${data.color}"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="nf-cancel">Cancel</button>
        <button class="btn btn-primary" id="nf-save">${isEdit ? 'Save' : 'Create'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#nf-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#nf-save').addEventListener('click', async () => {
    const body = {
      session_id: SESSION_ID,
      name: overlay.querySelector('#nf-name').value.trim(),
      color: overlay.querySelector('#nf-color').value,
      parent_folder_id: data.parent_folder_id,
    };
    if (!body.name) return;
    if (isEdit) await api.put(`/api/npc-library/folders/${existing.id}`, body);
    else await api.post('/api/npc-library/folders', body);
    overlay.remove();
    loadNpcLibrary();
  });
}

// ── NPC Template Modal ──
function openNpcTemplateModal(existing) {
  const isEdit = !!existing;
  const d = existing || {
    // Rework v2: baseline 0 across the board — GM tunes per NPC.
    name: '', description: '', is_merchant: false, max_hp: 0, armor_class: 0,
    strength: 0, dexterity: 0, constitution: 0, intelligence: 0, wisdom: 0, charisma: 0,
    initiative_bonus: 0, token_color: '#e05252', default_equipment: [], shop_items: [], notes: '',
    folder_id: null,
  };
  const flatFolders = flattenFolders(npcFolders);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:520px;max-height:85vh;overflow-y:auto">
      <div class="modal-header"><h3>${isEdit ? 'Edit' : 'Create'} NPC Template</h3><button class="modal-close">&times;</button></div>
      <div class="modal-body">
        <div style="display:flex;gap:8px">
          <div class="form-group" style="flex:1"><label>Name</label><input type="text" id="nt-name" value="${d.name}"></div>
          <div class="form-group" style="width:60px"><label>Color</label><input type="color" id="nt-color" value="${d.token_color}" style="width:100%"></div>
        </div>
        <div class="form-group"><label>Description</label><textarea id="nt-desc" rows="2" style="width:100%">${d.description}</textarea></div>
        <div class="form-group">
          <label>Folder</label>
          <select id="nt-folder">
            <option value="">None</option>
            ${flatFolders.map(f => `<option value="${f.id}"${d.folder_id === f.id ? ' selected' : ''}>${f.name}</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
          <div class="form-group" style="flex:1"><label>Race</label><select id="nt-race"><option value="">—</option>${(window._allRaces||[]).map(r=>`<option value="${r.id}">${r.name}</option>`).join('')}</select></div>
          <div class="form-group" style="flex:1"><label>Rank</label><select id="nt-rank">${['common','uncommon','rare','epic','legendary','mythic','divine'].map(r=>`<option value="${r}">${r.charAt(0).toUpperCase()+r.slice(1)}</option>`).join('')}</select></div>
          <div class="form-group" style="width:70px"><label>Level</label><input type="number" id="nt-level" value="1" min="0" max="20"></div>
          <button class="btn btn-ghost btn-xs" id="nt-calc" type="button" style="margin-top:18px">🎲 Calc</button>
        </div>
        <div id="nt-calc-result" style="font-size:0.72rem;color:var(--text-muted);margin-bottom:6px;min-height:18px"></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <div class="form-group" style="width:70px"><label>HP</label><input type="number" id="nt-hp" value="${d.max_hp}"></div>
          <div class="form-group" style="width:70px"><label>Spr.HP</label><input type="number" id="nt-sprhp" value="${d.spiritual_max_hp||0}"></div>
          <div class="form-group" style="width:70px"><label>Mana</label><input type="number" id="nt-mana" value="${d.mana_max||0}"></div>
          <div class="form-group" style="width:70px"><label>KD</label><input type="number" id="nt-ac" value="${d.armor_class}"></div>
          <div class="form-group" style="width:70px"><label>Init</label><input type="number" id="nt-init" value="${d.initiative_bonus}"></div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <div class="form-group" style="width:55px"><label>STR</label><input type="number" id="nt-str" value="${d.strength}"></div>
          <div class="form-group" style="width:55px"><label>DEX</label><input type="number" id="nt-dex" value="${d.dexterity}"></div>
          <div class="form-group" style="width:55px"><label>CON</label><input type="number" id="nt-con" value="${d.constitution}"></div>
          <div class="form-group" style="width:55px"><label>INT</label><input type="number" id="nt-int" value="${d.intelligence}"></div>
          <div class="form-group" style="width:55px"><label>WIS</label><input type="number" id="nt-wis" value="${d.wisdom}"></div>
          <div class="form-group" style="width:55px"><label>CHA</label><input type="number" id="nt-cha" value="${d.charisma}"></div>
        </div>
        <div class="form-group" style="display:flex;align-items:center;gap:8px">
          <label class="toggle-switch"><input type="checkbox" id="nt-merchant" ${d.is_merchant ? 'checked' : ''}><span class="slider"></span></label>
          <span style="font-size:0.8rem">Merchant NPC</span>
        </div>
        <div class="form-group"><label>Notes</label><textarea id="nt-notes" rows="2" style="width:100%">${d.notes}</textarea></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="nt-cancel">Cancel</button>
        <button class="btn btn-secondary" id="nt-ai-gen">🤖 Generate with AI</button>
        <button class="btn btn-primary" id="nt-save">${isEdit ? 'Save' : 'Create'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#nt-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#nt-ai-gen').addEventListener('click', () => openAINpcModal(overlay));
  overlay.querySelector('#nt-calc').addEventListener('click', async () => {
    const raceId = parseInt(overlay.querySelector('#nt-race').value) || null;
    const rank = overlay.querySelector('#nt-rank').value;
    const level = parseInt(overlay.querySelector('#nt-level').value) || 0;
    const resEl = overlay.querySelector('#nt-calc-result');
    if (!raceId) { resEl.textContent = 'Select a Race first'; return; }
    try {
      const res = await api.post('/api/races-classes/calculate-hp', { race_id: raceId, rank, rank_plus: 0, level });
      overlay.querySelector('#nt-hp').value = res.physical_hp;
      overlay.querySelector('#nt-sprhp').value = res.spiritual_hp;
      overlay.querySelector('#nt-mana').value = res.mana;
      const warn = res.used_fallback ? ' (fallback)' : '';
      resEl.innerHTML = `<span style="color:var(--accent-green)">Phys HP ${res.physical_hp}</span> · <span style="color:#a855f7">Spr.HP ${res.spiritual_hp}</span> · <span style="color:#60a5fa">Mana ${res.mana}</span>${warn}`;
    } catch(e) { resEl.textContent = 'Error: ' + e.message; }
  });
  overlay.querySelector('#nt-save').addEventListener('click', async () => {
    const body = {
      session_id: SESSION_ID,
      name: overlay.querySelector('#nt-name').value.trim(),
      description: overlay.querySelector('#nt-desc').value.trim(),
      folder_id: overlay.querySelector('#nt-folder').value ? parseInt(overlay.querySelector('#nt-folder').value) : null,
      max_hp: parseInt(overlay.querySelector('#nt-hp').value) || 0,
      spiritual_max_hp: parseInt(overlay.querySelector('#nt-sprhp').value) || 0,
      mana_max: parseInt(overlay.querySelector('#nt-mana').value) || 0,
      armor_class: parseInt(overlay.querySelector('#nt-ac').value) || 0,
      initiative_bonus: parseInt(overlay.querySelector('#nt-init').value) || 0,
      strength: parseInt(overlay.querySelector('#nt-str').value) || 0,
      dexterity: parseInt(overlay.querySelector('#nt-dex').value) || 0,
      constitution: parseInt(overlay.querySelector('#nt-con').value) || 0,
      intelligence: parseInt(overlay.querySelector('#nt-int').value) || 0,
      wisdom: parseInt(overlay.querySelector('#nt-wis').value) || 0,
      charisma: parseInt(overlay.querySelector('#nt-cha').value) || 0,
      token_color: overlay.querySelector('#nt-color').value,
      is_merchant: overlay.querySelector('#nt-merchant').checked,
      notes: overlay.querySelector('#nt-notes').value.trim(),
      default_equipment: d.default_equipment || [],
      shop_items: d.shop_items || [],
    };
    if (!body.name) return;
    if (isEdit) await api.put(`/api/npc-library/templates/${existing.id}`, body);
    else await api.post('/api/npc-library/templates', body);
    overlay.remove();
    loadNpcLibrary();
  });
}

// ── Event Modal ──
function openEventModal(existing) {
  const isEdit = !!existing;
  const d = existing || { name: '', description: '', npc_template_ids: [], folder_id: null };
  let entries = [...(d.npc_template_ids || [])];

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:480px">
      <div class="modal-header"><h3>${isEdit ? 'Edit' : 'Create'} Event</h3><button class="modal-close">&times;</button></div>
      <div class="modal-body">
        <div class="form-group"><label>Name</label><input type="text" id="ev-name" value="${d.name}"></div>
        <div class="form-group"><label>Description</label><textarea id="ev-desc" rows="2" style="width:100%">${d.description}</textarea></div>
        <div class="form-group">
          <label>NPCs to spawn</label>
          <div id="ev-npc-list"></div>
          <button class="btn btn-ghost btn-xs" id="ev-add-npc" style="margin-top:4px">+ Add NPC</button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="ev-cancel">Cancel</button>
        <button class="btn btn-primary" id="ev-save">${isEdit ? 'Save' : 'Create'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  function renderEntries() {
    const cont = overlay.querySelector('#ev-npc-list');
    cont.innerHTML = entries.map((en, i) => `
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:3px">
        <select data-eni="${i}" data-field="template_id" style="flex:1;font-size:0.75rem">
          ${npcTemplates.map(t => `<option value="${t.id}"${en.template_id === t.id ? ' selected' : ''}>${t.name}</option>`).join('')}
        </select>
        <span style="font-size:0.75rem">x</span>
        <input type="number" data-eni="${i}" data-field="count" value="${en.count || 1}" style="width:50px;font-size:0.75rem" min="1">
        <button class="btn btn-ghost btn-xs" data-remove-entry="${i}" style="color:var(--accent-red)">✕</button>
      </div>
    `).join('');
    cont.querySelectorAll('[data-eni]').forEach(el => {
      el.addEventListener('change', () => {
        const i = parseInt(el.dataset.eni);
        const f = el.dataset.field;
        entries[i][f] = f === 'count' ? parseInt(el.value) || 1 : parseInt(el.value);
      });
    });
    cont.querySelectorAll('[data-remove-entry]').forEach(btn => {
      btn.addEventListener('click', () => { entries.splice(parseInt(btn.dataset.removeEntry), 1); renderEntries(); });
    });
  }
  renderEntries();

  overlay.querySelector('#ev-add-npc').addEventListener('click', () => {
    entries.push({ template_id: npcTemplates[0]?.id || 0, count: 1 });
    renderEntries();
  });
  overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#ev-cancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#ev-save').addEventListener('click', async () => {
    const body = {
      session_id: SESSION_ID,
      name: overlay.querySelector('#ev-name').value.trim(),
      description: overlay.querySelector('#ev-desc').value.trim(),
      npc_template_ids: entries,
      folder_id: d.folder_id,
    };
    if (!body.name) return;
    if (isEdit) await api.put(`/api/npc-library/events/${existing.id}`, body);
    else await api.post('/api/npc-library/events', body);
    overlay.remove();
    loadNpcLibrary();
  });
}

// Wire create buttons
document.querySelector('#btn-npc-create-folder')?.addEventListener('click', () => openFolderModal(null));
document.querySelector('#btn-npc-create-template')?.addEventListener('click', () => openNpcTemplateModal(null));
document.querySelector('#btn-npc-create-event')?.addEventListener('click', () => openEventModal(null));

// Wire seed, create buttons
document.querySelector('#btn-seed-rc')?.addEventListener('click', async () => {
  await api.post('/api/races-classes/seed');
  loadRacesClasses();
  showToast('Default races & classes seeded');
});
document.querySelector('#btn-create-race')?.addEventListener('click', () => openRCEditorModal('race', null));
document.querySelector('#btn-create-class')?.addEventListener('click', () => openRCEditorModal('class', null));

// ══════════════════════════════════════════════════════════════
