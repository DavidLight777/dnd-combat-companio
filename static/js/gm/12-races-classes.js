// ════════════════════════════════════════════════════════
// Races & classes manager
// Source: gm-app.js lines 5801–6233
// Globals shared via window.* and module-scope hoisting.
// ════════════════════════════════════════════════════════

// STAGE 6 — RACES & CLASSES MANAGER
// ══════════════════════════════════════════════════════════════
let rcRaces = [];
let rcClasses = [];

async function loadRacesClasses() {
  try {
    const [rr, cc] = await Promise.all([
      api.get('/api/races-classes/races'),
      api.get('/api/races-classes/classes'),
    ]);
    rcRaces = rr;
    window._allRaces = rcRaces;
    rcClasses = cc;
  } catch { rcRaces = []; rcClasses = []; }
  renderRCList();
}

function bonusLabel(b) {
  if (b.type === 'stat_bonus') return `+${b.value} ${(b.stat||'').slice(0,3).toUpperCase()}`;
  if (b.type === 'hp_bonus') return `+${b.value} HP`;
  if (b.type === 'initiative_bonus') return `+${b.value} Init`;
  if (b.type === 'damage_bonus') return `+${b.value} Dmg`;
  if (b.type === 'attack_bonus') return `+${b.value} Atk`;
  return `${b.type}: ${b.value}`;
}

function renderRCList() {
  const rList = document.querySelector('#rc-races-list');
  const cList = document.querySelector('#rc-classes-list');
  if (!rList || !cList) return;

  rList.innerHTML = rcRaces.length ? rcRaces.map(r => `
    <div style="padding:8px;border:1px solid var(--border);border-radius:var(--r-md);margin-bottom:6px;background:var(--bg-surface-2)${!r.is_available?';opacity:0.5':''}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700;font-size:0.85rem">${r.name}</span>
        <div style="display:flex;gap:4px;align-items:center">
          <span style="font-size:0.62rem;padding:1px 6px;border-radius:10px;background:rgba(200,60,60,0.22);color:#ff9494;font-weight:700" title="Physical HP die">${r.hp_dice_count || 1}d${r.hp_die || 8}</span>
          <span style="font-size:0.62rem;padding:1px 6px;border-radius:10px;background:rgba(60,100,200,0.22);color:#94b4ff;font-weight:700" title="Spiritual HP die">${r.spiritual_hp_dice_count || 1}d${r.spiritual_hp_die || 4}</span>
          <button class="btn btn-ghost btn-xs" data-edit-race="${r.id}">✏️</button>
          <button class="btn btn-ghost btn-xs" data-del-race="${r.id}" style="color:var(--accent-red)">🗑</button>
        </div>
      </div>
      <div style="font-size:0.7rem;color:var(--text-muted);margin:2px 0">${r.description}</div>
      <div>${(r.bonuses||[]).map(b => `<span style="display:inline-block;font-size:0.6rem;padding:1px 5px;border-radius:8px;background:var(--accent)20;color:var(--accent);margin-right:2px">${bonusLabel(b)}</span>`).join('')}</div>
      ${!r.is_available ? '<div style="font-size:0.6rem;color:var(--accent-red)">Hidden from players</div>' : ''}
    </div>
  `).join('') : '<span class="text-muted" style="font-size:0.8rem">No races. Click "Seed Defaults" or create one.</span>';

  // Rework v2: internal table still "classes" but UI reads "Professions"
  cList.innerHTML = rcClasses.length ? rcClasses.map(c => `
    <div style="padding:8px;border:1px solid var(--border);border-radius:var(--r-md);margin-bottom:6px;background:var(--bg-surface-2)${!c.is_available?';opacity:0.5':''}">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:700;font-size:0.85rem">${c.name}</span>
        <div style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-xs" data-edit-class="${c.id}">✏️</button>
          <button class="btn btn-ghost btn-xs" data-del-class="${c.id}" style="color:var(--accent-red)">🗑</button>
        </div>
      </div>
      <div style="font-size:0.7rem;color:var(--text-muted);margin:2px 0">${c.description}</div>
      <div>${(c.bonuses||[]).map(b => `<span style="display:inline-block;font-size:0.6rem;padding:1px 5px;border-radius:8px;background:var(--accent)20;color:var(--accent);margin-right:2px">${bonusLabel(b)}</span>`).join('')}</div>
      ${!c.is_available ? '<div style="font-size:0.6rem;color:var(--accent-red)">Hidden from players</div>' : ''}
    </div>
  `).join('') : '<span class="text-muted" style="font-size:0.8rem">No professions. Click "Seed Defaults" or create one.</span>';

  // Wire edit/delete
  rList.querySelectorAll('[data-edit-race]').forEach(btn => {
    btn.addEventListener('click', () => {
      const r = rcRaces.find(x => x.id === parseInt(btn.dataset.editRace));
      if (r) openRCEditorModal('race', r);
    });
  });
  rList.querySelectorAll('[data-del-race]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this race?')) return;
      try {
        await api.del(`/api/races-classes/races/${btn.dataset.delRace}`);
        loadRacesClasses();
      } catch (e) { showToast('Failed to delete race: ' + (e.message || e), 'error'); }
    });
  });
  cList.querySelectorAll('[data-edit-class]').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = rcClasses.find(x => x.id === parseInt(btn.dataset.editClass));
      if (c) openRCEditorModal('class', c);
    });
  });
  cList.querySelectorAll('[data-del-class]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this class?')) return;
      await api.del(`/api/races-classes/classes/${btn.dataset.delClass}`);
      loadRacesClasses();
    });
  });
}

function openRCEditorModal(kind, existing) {
  const isEdit = !!existing;
  const kindLabel = kind === 'race' ? 'Race' : 'Profession';   // Rework v2 UI rename
  const title = isEdit ? `Edit ${kindLabel}` : `Create ${kindLabel}`;
  const data = existing || { name: '', description: '', bonuses: [], special_abilities: [], is_available: true,
                             hp_die: 8, hp_dice_count: 1, spiritual_hp_die: 4, spiritual_hp_dice_count: 1 };

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:480px">
      <div class="modal-header"><h3>${title}</h3><button class="modal-close">&times;</button></div>
      <div class="modal-body">
        <div class="form-group"><label>Name</label><input type="text" id="rc-ed-name" value="${data.name}"></div>
        <div class="form-group"><label>Description</label><textarea id="rc-ed-desc" rows="2" style="width:100%;resize:vertical">${data.description}</textarea></div>
        ${kind === 'race' ? `
          <div class="form-group" style="display:flex;gap:10px;align-items:flex-end">
            <div style="flex:1">
              <label title="Rolled at creation and on every level-up">Physical HP Die</label>
              <select id="rc-ed-hpdie">
                ${[4,6,8,10,12].map(d => `<option value="${d}"${(data.hp_die||8)===d?' selected':''}>d${d}</option>`).join('')}
              </select>
            </div>
            <div style="flex:1">
              <label>Physical HP Dice Count</label>
              <input type="number" id="rc-ed-hpcount" min="1" max="20" value="${data.hp_dice_count || 1}">
            </div>
          </div>
          <div class="form-group" style="display:flex;gap:10px;align-items:flex-end">
            <div style="flex:1">
              <label title="Spiritual HP die (separate pool for spirit-based damage)">Spiritual HP Die</label>
              <select id="rc-ed-spirithpdie">
                ${[4,6,8,10,12].map(d => `<option value="${d}"${(data.spiritual_hp_die||4)===d?' selected':''}>d${d}</option>`).join('')}
              </select>
            </div>
            <div style="flex:1">
              <label>Spiritual HP Dice Count</label>
              <input type="number" id="rc-ed-spirithpcount" min="1" max="20" value="${data.spiritual_hp_dice_count || 1}">
            </div>
          </div>` : ''}
        <div class="form-group">
          <label>Bonuses</label>
          <div id="rc-ed-bonuses"></div>
          <button class="btn btn-ghost btn-xs" id="rc-ed-add-bonus" style="margin-top:4px">+ Add Bonus</button>
        </div>
        <div class="form-group">
          <label>Special Abilities (text)</label>
          <div id="rc-ed-abilities"></div>
          <button class="btn btn-ghost btn-xs" id="rc-ed-add-ability" style="margin-top:4px">+ Add Ability</button>
        </div>
        <div class="form-group" style="display:flex;align-items:center;gap:8px">
          <label class="toggle-switch"><input type="checkbox" id="rc-ed-available" ${data.is_available?'checked':''}><span class="slider"></span></label>
          <span style="font-size:0.8rem">Available to players</span>
        </div>
        ${kind === 'race' && isEdit ? `
        <div class="form-group" style="border-top:1px solid var(--border);padding-top:12px;margin-top:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <label style="margin:0">🏆 Rank Configurations</label>
            <button class="btn btn-ghost btn-xs" id="rc-ed-add-rank">+ Add Rank</button>
          </div>
          <div id="rc-ed-rank-configs" style="max-height:200px;overflow:auto">
            <p class="text-muted" style="font-size:0.75rem">Loading...</p>
          </div>
        </div>` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="rc-ed-cancel">Cancel</button>
        <button class="btn btn-primary" id="rc-ed-save">${isEdit ? 'Save' : 'Create'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const bonusCont = overlay.querySelector('#rc-ed-bonuses');
  const abilityCont = overlay.querySelector('#rc-ed-abilities');
  let bonuses = [...(data.bonuses || [])];
  let abilities = [...(data.special_abilities || [])];

  function renderBonuses() {
    bonusCont.innerHTML = bonuses.map((b, i) => `
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:3px">
        <select data-bi="${i}" data-field="type" style="font-size:0.75rem;width:120px">
          <option value="stat_bonus"${b.type==='stat_bonus'?' selected':''}>Stat Bonus</option>
          <option value="hp_bonus"${b.type==='hp_bonus'?' selected':''}>HP Bonus</option>
          <option value="initiative_bonus"${b.type==='initiative_bonus'?' selected':''}>Initiative</option>
          <option value="attack_bonus"${b.type==='attack_bonus'?' selected':''}>Attack</option>
          <option value="damage_bonus"${b.type==='damage_bonus'?' selected':''}>Damage</option>
        </select>
        ${b.type === 'stat_bonus' ? `<select data-bi="${i}" data-field="stat" style="font-size:0.75rem;width:90px">
          ${['strength','dexterity','constitution','intelligence','wisdom','charisma'].map(s => `<option value="${s}"${b.stat===s?' selected':''}>${s.slice(0,3).toUpperCase()}</option>`).join('')}
        </select>` : ''}
        <input type="number" data-bi="${i}" data-field="value" value="${b.value||0}" style="width:50px;font-size:0.75rem">
        <button class="btn btn-ghost btn-xs" data-remove-bonus="${i}" style="color:var(--accent-red)">✕</button>
      </div>
    `).join('');
    bonusCont.querySelectorAll('[data-bi]').forEach(el => {
      el.addEventListener('change', () => {
        const i = parseInt(el.dataset.bi);
        const f = el.dataset.field;
        bonuses[i][f] = f === 'value' ? parseInt(el.value) || 0 : el.value;
        if (f === 'type') renderBonuses();
      });
    });
    bonusCont.querySelectorAll('[data-remove-bonus]').forEach(btn => {
      btn.addEventListener('click', () => { bonuses.splice(parseInt(btn.dataset.removeBonus), 1); renderBonuses(); });
    });
  }

  function renderAbilities() {
    abilityCont.innerHTML = abilities.map((a, i) => `
      <div style="display:flex;gap:4px;align-items:center;margin-bottom:3px">
        <input type="text" data-ai="${i}" value="${a}" style="flex:1;font-size:0.75rem">
        <button class="btn btn-ghost btn-xs" data-remove-ability="${i}" style="color:var(--accent-red)">✕</button>
      </div>
    `).join('');
    abilityCont.querySelectorAll('[data-ai]').forEach(el => {
      el.addEventListener('change', () => { abilities[parseInt(el.dataset.ai)] = el.value; });
    });
    abilityCont.querySelectorAll('[data-remove-ability]').forEach(btn => {
      btn.addEventListener('click', () => { abilities.splice(parseInt(btn.dataset.removeAbility), 1); renderAbilities(); });
    });
  }

  renderBonuses();
  renderAbilities();

  overlay.querySelector('#rc-ed-add-bonus').addEventListener('click', () => {
    bonuses.push({ type: 'stat_bonus', stat: 'strength', value: 1 });
    renderBonuses();
  });
  overlay.querySelector('#rc-ed-add-ability').addEventListener('click', () => {
    abilities.push('New ability');
    renderAbilities();
  });

  // Rank Config management for races
  if (kind === 'race' && isEdit) {
    const rankConfigsContainer = overlay.querySelector('#rc-ed-rank-configs');
    let rankConfigs = [];

    async function loadRankConfigs() {
      try {
        rankConfigs = await api.get(`/api/races-classes/races/${existing.id}/rank-configs`);
        renderRankConfigs();
      } catch (e) {
        rankConfigsContainer.innerHTML = '<p class="text-muted" style="font-size:0.75rem;color:var(--accent-red)">Failed to load</p>';
      }
    }

    function renderRankConfigs() {
      if (!rankConfigs.length) {
        rankConfigsContainer.innerHTML = '<p class="text-muted" style="font-size:0.75rem">No rank configs yet. Click "+ Add Rank" to create one.</p>';
        return;
      }
      const rankOrder = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'divine'];
      const sorted = [...rankConfigs].sort((a, b) => {
        const rankDiff = rankOrder.indexOf(a.rank) - rankOrder.indexOf(b.rank);
        if (rankDiff !== 0) return rankDiff;
        return a.rank_plus - b.rank_plus;
      });

      rankConfigsContainer.innerHTML = `
        <table style="width:100%;font-size:0.7rem;border-collapse:collapse">
          <thead>
            <tr style="border-bottom:1px solid var(--border);text-align:left">
              <th style="padding:3px 4px">Rank</th>
              <th style="padding:3px 4px">Phys HP</th>
              <th style="padding:3px 4px">Spirit HP</th>
              <th style="padding:3px 4px">Mana</th>
              <th style="padding:3px 4px;width:50px"></th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map(rc => `
              <tr style="border-bottom:1px solid var(--border-dim)" data-rank-id="${rc.id}">
                <td style="padding:4px"><b>${rc.rank}${rc.rank_plus > 0 ? '+' + rc.rank_plus : ''}</b></td>
                <td style="padding:4px">${rc.physical_hp_dice_count}d${rc.physical_hp_die}</td>
                <td style="padding:4px">${rc.spiritual_hp_dice_count}d${rc.spiritual_hp_die}</td>
                <td style="padding:4px">+${rc.mana_per_level}/lvl</td>
                <td style="padding:4px">
                  <button class="btn btn-ghost btn-xs" data-edit-rank="${rc.id}" style="padding:2px 4px">✏️</button>
                  <button class="btn btn-ghost btn-xs" data-del-rank="${rc.id}" style="padding:2px 4px;color:var(--accent-red)">🗑️</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

      rankConfigsContainer.querySelectorAll('[data-edit-rank]').forEach(btn => {
        btn.addEventListener('click', () => openRankConfigEditor(parseInt(btn.dataset.editRank)));
      });
      rankConfigsContainer.querySelectorAll('[data-del-rank]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this rank config?')) return;
          const id = parseInt(btn.dataset.delRank);
          try {
            await api.delete(`/api/races-classes/races/${existing.id}/rank-configs/${id}`);
            rankConfigs = rankConfigs.filter(rc => rc.id !== id);
            renderRankConfigs();
          } catch (e) { showToast('Failed to delete'); }
        });
      });
    }

    function openRankConfigEditor(rcId = null) {
      const existingRc = rcId ? rankConfigs.find(r => r.id === rcId) : null;
      const rcData = existingRc || { rank: 'common', rank_plus: 0, physical_hp_die: 4, physical_hp_dice_count: 1, spiritual_hp_die: 4, spiritual_hp_dice_count: 1, mana_per_level: 2, notes: '' };
      const isEditing = !!existingRc;

      // Save original modal content
      const originalContent = overlay.querySelector('.modal-body').innerHTML;
      const originalHeader = overlay.querySelector('.modal-header h3').textContent;
      const originalFooter = overlay.querySelector('.modal-footer').innerHTML;

      // Replace modal content with rank config editor
      overlay.querySelector('.modal-header h3').textContent = `${isEditing ? 'Edit' : 'Add'} Rank Config`;
      overlay.querySelector('.modal-body').innerHTML = `
            <div class="form-group" style="display:flex;gap:10px">
              <div style="flex:1">
                <label>Rank</label>
                <select id="rc-rank" style="width:100%">
                  ${['common','uncommon','rare','epic','legendary','mythic','divine'].map(r => `<option value="${r}"${rcData.rank===r?' selected':''}>${r.charAt(0).toUpperCase()+r.slice(1)}</option>`).join('')}
                </select>
              </div>
              <div style="width:80px">
                <label>Plus</label>
                <select id="rc-rank-plus" style="width:100%">
                  ${[0].map(p => `<option value="${p}"${rcData.rank_plus===p?' selected':''}>${'Base'}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="form-group" style="display:flex;gap:10px">
              <div style="flex:1">
                <label>Physical HP</label>
                <div style="display:flex;gap:4px">
                  <input type="number" id="rc-phys-count" min="1" max="5" value="${rcData.physical_hp_dice_count}" style="width:50px">
                  <select id="rc-phys-die" style="flex:1">
                    ${[4,6,8,10,12].map(d => `<option value="${d}"${rcData.physical_hp_die===d?' selected':''}>d${d}</option>`).join('')}
                  </select>
                </div>
              </div>
              <div style="flex:1">
                <label>Spiritual HP</label>
                <div style="display:flex;gap:4px">
                  <input type="number" id="rc-spirit-count" min="1" max="5" value="${rcData.spiritual_hp_dice_count}" style="width:50px">
                  <select id="rc-spirit-die" style="flex:1">
                    ${[4,6,8,10,12].map(d => `<option value="${d}"${rcData.spiritual_hp_die===d?' selected':''}>d${d}</option>`).join('')}
                  </select>
                </div>
              </div>
            </div>
            <div class="form-group">
              <label>Mana per Level</label>
              <input type="number" id="rc-mana" min="0" value="${rcData.mana_per_level}" style="width:100px">
            </div>
            <div class="form-group">
              <label>Notes</label>
              <input type="text" id="rc-notes" value="${rcData.notes}" placeholder="Special properties, e.g., +1d6 regen at B+" style="width:100%">
            </div>
          </div>`;

      overlay.querySelector('.modal-footer').innerHTML = `
        <button class="btn btn-ghost" id="rc-rank-cancel">Cancel</button>
        <button class="btn btn-primary" id="rc-rank-save">${isEditing ? 'Save' : 'Create'}</button>
      `;

      function restoreOriginal() {
        overlay.querySelector('.modal-header h3').textContent = originalHeader;
        overlay.querySelector('.modal-body').innerHTML = originalContent;
        overlay.querySelector('.modal-footer').innerHTML = originalFooter;
        // Re-attach event listeners for the original modal
        loadRankConfigs();
      }

      overlay.querySelector('.modal-close').addEventListener('click', restoreOriginal);
      overlay.querySelector('#rc-rank-cancel').addEventListener('click', restoreOriginal);
      overlay.querySelector('#rc-rank-save').addEventListener('click', async () => {
        const body = {
          rank: overlay.querySelector('#rc-rank').value,
          rank_plus: parseInt(overlay.querySelector('#rc-rank-plus').value),
          physical_hp_dice_count: parseInt(overlay.querySelector('#rc-phys-count').value) || 1,
          physical_hp_die: parseInt(overlay.querySelector('#rc-phys-die').value) || 4,
          spiritual_hp_dice_count: parseInt(overlay.querySelector('#rc-spirit-count').value) || 1,
          spiritual_hp_die: parseInt(overlay.querySelector('#rc-spirit-die').value) || 4,
          mana_per_level: parseInt(overlay.querySelector('#rc-mana').value) || 0,
          notes: overlay.querySelector('#rc-notes').value.trim(),
        };
        try {
          if (isEditing) {
            await api.put(`/api/races-classes/races/${existing.id}/rank-configs/${rcId}`, body);
          } else {
            await api.post(`/api/races-classes/races/${existing.id}/rank-configs`, body);
          }
          restoreOriginal();
          await loadRankConfigs();
        } catch (e) {
          showToast(e?.body?.detail || 'Failed to save rank config');
        }
      });
    }

    overlay.querySelector('#rc-ed-add-rank')?.addEventListener('click', () => openRankConfigEditor());
    loadRankConfigs();
  }

  overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#rc-ed-cancel').addEventListener('click', () => overlay.remove());

  overlay.querySelector('#rc-ed-save').addEventListener('click', async () => {
    const body = {
      name: overlay.querySelector('#rc-ed-name').value.trim(),
      description: overlay.querySelector('#rc-ed-desc').value.trim(),
      bonuses,
      special_abilities: abilities.filter(a => a.trim()),
      is_available: overlay.querySelector('#rc-ed-available').checked,
    };
    if (!body.name) return;

    if (kind === 'race') {
      body.hp_die = parseInt(overlay.querySelector('#rc-ed-hpdie')?.value) || 8;
      body.hp_dice_count = Math.max(1, Math.min(5, parseInt(overlay.querySelector('#rc-ed-hpcount')?.value) || 1));
      body.spiritual_hp_die = parseInt(overlay.querySelector('#rc-ed-spirithpdie')?.value) || 4;
      body.spiritual_hp_dice_count = Math.max(1, Math.min(5, parseInt(overlay.querySelector('#rc-ed-spirithpcount')?.value) || 1));
    }

    if (isEdit) {
      await api.put(`/api/races-classes/${kind === 'race' ? 'races' : 'classes'}/${existing.id}`, body);
    } else {
      await api.post(`/api/races-classes/${kind === 'race' ? 'races' : 'classes'}`, body);
    }
    overlay.remove();
    loadRacesClasses();
  });
}

// ══════════════════════════════════════════════════════════════
