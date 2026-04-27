// ════════════════════════════════════════════════════════
// NPC picker modal + floating control panels
// Source: gm-app.js lines 8204–8821
// Globals shared via window.* and module-scope hoisting.
// ════════════════════════════════════════════════════════

// NPC Picker Modal (used by NPC Actions panel)
// ══════════════════════════════════════════════════════════════
function openNpcPickerModal(title, items) {
  if (!items || !items.length) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:9999';
  overlay.innerHTML = `
    <div class="modal-content" style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg);padding:16px;max-width:400px;width:90%;max-height:70vh;overflow-y:auto">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <h3 style="flex:1;margin:0;font-size:1rem">${title}</h3>
        <button class="btn-icon" id="npc-picker-close">✕</button>
      </div>
      <div id="npc-picker-items" style="display:flex;flex-direction:column;gap:6px">
        ${items.map((it, i) => `
          <button class="btn btn-ghost" data-pick="${i}" style="text-align:left;padding:8px 10px;display:flex;flex-direction:column;align-items:flex-start;gap:2px">
            <span style="font-weight:600">${it.label}</span>
            ${it.sub ? `<span style="font-size:0.72rem;color:var(--text-muted)">${it.sub}</span>` : ''}
          </button>
        `).join('')}
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#npc-picker-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelectorAll('[data-pick]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.pick);
      close();
      if (items[idx] && items[idx].onPick) await items[idx].onPick();
    });
  });
}

// Wire table.updated WS event — refresh NPC list so map/hp toggles stay in sync
ws.on('table.updated', () => {
  renderNPCList();
});

// ══════════════════════════════════════════════════════════════
// NPC FLOATING CONTROL PANELS
// ══════════════════════════════════════════════════════════════
const npcPanels = {};

function getNpcPanelCount() { return Object.keys(npcPanels).length; }

function _makeNpcPanelHtml(npc) {
  const pct = npc.max_hp > 0 ? Math.round((npc.current_hp / npc.max_hp) * 100) : 0;
  const hpColor = pct > 50 ? 'var(--hp-high)' : pct > 25 ? 'var(--hp-mid)' : 'var(--hp-low)';
  return `
    <div class="npc-control-panel" data-npc-panel="${npc.id}" style="top:${60 + getNpcPanelCount()*12}px;left:${14 + getNpcPanelCount()*14}px">
      <div class="npc-panel-header">
        <span style="font-size:0.85rem">${npc.token_color ? '●' : '○'}</span>
        <span class="npc-panel-name">${npc.name}</span>
        <button class="npc-panel-close" title="Close">×</button>
      </div>
      <div class="npc-panel-body">
        <div class="npc-panel-hpbar"><div style="width:${pct}%;background:${hpColor}"></div></div>
        <div class="npc-panel-stats">
          <span>AC ${npc.armor_class}</span>
          <span>HP ${npc.current_hp}/${npc.max_hp}</span>
          <span style="flex:1;text-align:right">${!npc.is_alive ? '💀' : ''}</span>
        </div>
        <div class="npc-panel-statuses" data-npc-panel-statuses="${npc.id}" style="display:flex;flex-wrap:wrap;gap:2px;font-size:0.6rem"></div>

        <div style="border-top:1px solid var(--border);margin:2px 0"></div>

        <!-- WEAPON INFO -->
        <div class="npc-panel-weapon-info" data-npc-panel-weapon="${npc.id}" style="font-size:0.62rem;color:var(--text-muted)">
          <span>Loading weapon…</span>
        </div>

        <div style="font-size:0.62rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;font-weight:600">Target</div>
        <select class="npc-panel-target" data-npc-panel-target="${npc.id}" style="width:100%;font-size:0.7rem">
          <option value="">— select —</option>
        </select>

        <!-- ADVANTAGE TOGGLE (shared for hit & damage) -->
        <div style="display:flex;gap:0;border-radius:var(--r-sm);overflow:hidden;border:1px solid var(--border);height:22px" data-npc-panel-adv="${npc.id}">
          <button class="adv-btn" data-mode="normal" style="border:none;background:var(--bg-surface-3);color:var(--text-primary);padding:0 8px;cursor:pointer;font-size:0.6rem;font-weight:700">Normal</button>
          <button class="adv-btn" data-mode="advantage" style="border:none;background:var(--bg-surface-2);color:var(--text-muted);padding:0 8px;cursor:pointer;font-size:0.6rem">Adv</button>
          <button class="adv-btn" data-mode="disadvantage" style="border:none;background:var(--bg-surface-2);color:var(--text-muted);padding:0 8px;cursor:pointer;font-size:0.6rem">Dis</button>
        </div>

        <!-- STEP 1: HIT ROLL (with d20 dice count, e.g. multi-attack) -->
        <div data-npc-panel-hit="${npc.id}" style="display:flex;gap:4px;align-items:center">
          <label style="font-size:0.62rem;color:var(--text-muted)" title="Number of d20 to roll (best counts)">×</label>
          <input type="number" data-npc-panel-hit-count="${npc.id}" value="1" min="1" max="10" style="width:42px;font-size:0.72rem;text-align:center" title="d20 dice count">
          <button class="btn btn-primary btn-xs" data-npc-panel-roll-hit="${npc.id}" style="flex:1">⚔ Roll Hit</button>
        </div>

        <!-- STEP 2: DAMAGE (hidden until hit). Dice shown only for unarmed; mode selector for multi-mode weapons. -->
        <div data-npc-panel-damage="${npc.id}" style="display:none;flex-direction:column;gap:4px">
          <div data-npc-panel-dmg-modewrap="${npc.id}" style="display:none">
            <select data-npc-panel-dmg-mode="${npc.id}" style="width:100%;font-size:0.65rem"></select>
          </div>
          <div data-npc-panel-dmg-dicewrap="${npc.id}" style="display:none;align-items:center;gap:4px">
            <input type="number" data-npc-panel-dmg-count="${npc.id}" value="1" min="1" style="width:36px;font-size:0.65rem;text-align:center" title="Dice count">
            <select data-npc-panel-dmg-die="${npc.id}" style="font-size:0.65rem;flex:1">
              <option value="4">d4</option>
              <option value="6">d6</option>
              <option value="8" selected>d8</option>
              <option value="10">d10</option>
              <option value="12">d12</option>
              <option value="20">d20</option>
            </select>
          </div>
          <div data-npc-panel-dmg-readonly="${npc.id}" style="display:none;font-size:0.65rem;color:var(--text-muted);padding:2px 4px;background:var(--bg-surface-2);border-radius:3px"></div>
          <div style="display:flex;gap:4px">
            <button class="btn btn-primary btn-xs" data-npc-panel-roll-dmg="${npc.id}" style="flex:1">💥 Roll Damage</button>
            <button class="btn btn-ghost btn-xs" data-npc-panel-cancel-dmg="${npc.id}" style="padding:2px 6px">✕</button>
          </div>
        </div>

        <div class="npc-panel-result hidden" data-npc-panel-result="${npc.id}"></div>

        <!-- DEFEND -->
        <div style="border-top:1px solid var(--border);margin:2px 0"></div>
        <div class="npc-panel-actions">
          <button class="btn btn-ghost btn-xs npc-panel-def" data-npc="${npc.id}">🛡 Defend</button>
          <button class="btn btn-ghost btn-xs npc-panel-heal-btn" data-npc="${npc.id}">❤ Quick Heal</button>
        </div>
        <div data-npc-panel-heal-box="${npc.id}" style="display:none;flex-direction:column;gap:4px">
          <div style="display:flex;gap:4px;align-items:center">
            <input type="number" data-npc-panel-heal-input="${npc.id}" placeholder="HP" style="width:60px;font-size:0.7rem" min="0">
            <button class="btn btn-primary btn-xs" data-npc-panel-heal-ok="${npc.id}">Heal</button>
            <button class="btn btn-ghost btn-xs" data-npc-panel-heal-cancel="${npc.id}">✕</button>
          </div>
        </div>

        <!-- ABILITIES (inline list) -->
        <div style="border-top:1px solid var(--border);margin:2px 0"></div>
        <div style="font-size:0.62rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;font-weight:600">Abilities</div>
        <div data-npc-panel-abilities="${npc.id}" style="max-height:90px;overflow-y:auto;font-size:0.65rem;display:flex;flex-direction:column;gap:3px">
          <span style="color:var(--text-muted)">Loading…</span>
        </div>

        <!-- ITEMS (inline list) -->
        <div style="border-top:1px solid var(--border);margin:2px 0"></div>
        <div style="font-size:0.62rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;font-weight:600">Items</div>
        <div data-npc-panel-items="${npc.id}" style="max-height:70px;overflow-y:auto;font-size:0.65rem;display:flex;flex-direction:column;gap:3px">
          <span style="color:var(--text-muted)">Loading…</span>
        </div>
      </div>
    </div>`;
}

async function openNpcControlPanel(npcId) {
  if (npcPanels[npcId]) {
    // Already open — bring to front and refresh
    updateNpcControlPanel(npcId);
    const el = document.querySelector(`[data-npc-panel="${npcId}"]`);
    if (el) {
      el.style.zIndex = 300;
      Object.values(npcPanels).forEach(p => {
        if (p.id !== npcId) p.el.style.zIndex = 200;
      });
    }
    return;
  }
  const npc = characters.find(c => c.id === npcId);
  if (!npc || !npc.is_npc) return;

  const html = _makeNpcPanelHtml(npc);
  document.body.insertAdjacentHTML('beforeend', html);
  const el = document.querySelector(`[data-npc-panel="${npcId}"]`);
  npcPanels[npcId] = { id: npcId, el };

  // Draggable header
  const header = el.querySelector('.npc-panel-header');
  let dragOffX = 0, dragOffY = 0, dragging = false;
  header.addEventListener('mousedown', e => {
    dragging = true;
    const rect = el.getBoundingClientRect();
    dragOffX = e.clientX - rect.left;
    dragOffY = e.clientY - rect.top;
    el.style.zIndex = 300;
    Object.values(npcPanels).forEach(p => { if (p.id !== npcId) p.el.style.zIndex = 200; });
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    el.style.left = (e.clientX - dragOffX) + 'px';
    el.style.top = (e.clientY - dragOffY) + 'px';
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  // Close
  el.querySelector('.npc-panel-close').addEventListener('click', () => {
    el.remove();
    delete npcPanels[npcId];
  });

  // Populate target dropdown
  const targetSel = el.querySelector(`[data-npc-panel-target="${npcId}"]`);
  const aliveChars = characters.filter(c => c.is_alive && c.id !== npcId);
  targetSel.innerHTML = '<option value="">— select —</option>' +
    aliveChars.map(c => `<option value="${c.id}">${c.name} ${c.is_npc?'[NPC]':''}</option>`).join('');

  // Load weapon info, abilities, items, status effects
  _loadNpcPanelWeapon(npcId);
  _loadNpcPanelStatuses(npcId);
  _loadNpcPanelAbilities(npcId);
  _loadNpcPanelItems(npcId);

  // Wire actions
  _wireNpcPanelActions(el, npcId);
}

async function _loadNpcPanelStatuses(npcId) {
  const el = document.querySelector(`[data-npc-panel-statuses="${npcId}"]`);
  if (!el) return;
  try {
    const effects = await api.get(`/api/characters/${npcId}/status-effects`);
    if (!effects.length) { el.innerHTML = ''; return; }
    el.innerHTML = effects.map(e => {
      const turns = e.remaining_turns !== null ? e.remaining_turns+'t' : '';
      return `<span style="background:${e.color}20;border:1px solid ${e.color};border-radius:3px;padding:0 3px" title="${e.name}">${e.icon}${turns}</span>`;
    }).join('');
  } catch { el.innerHTML = ''; }
}

async function _loadNpcPanelWeapon(npcId) {
   const el = document.querySelector(`[data-npc-panel-weapon="${npcId}"]`);
   if (!el) return;
   try {
     const inv = await api.get(`/api/characters/${npcId}/inventory`);
     // Find equipped weapon (not just any equipped item)
     const weapon = (inv.items || []).find(i => i.is_equipped && i.category === 'weapon');
     if (weapon) {
       const ws = weapon.weapon_stats || {};
       const dmg = ws.dice_count && ws.dice_type ? `${ws.dice_count}d${ws.dice_type}` : '—';
       // Calculate damage bonus from item bonuses
       const dmgBonus = (weapon.bonuses || []).reduce((sum, b) => {
         return sum + (b.bonus_type === 'damage_bonus' ? b.value : 0);
       }, 0);
       const bonus = dmgBonus ? `+${dmgBonus}` : '';
       el.innerHTML = `<span style="color:var(--accent)">⚔ ${weapon.name}</span> · ${dmg}${bonus} · ${ws.weapon_range || ''}`;
     } else {
       el.innerHTML = `<span style="color:var(--text-muted)">No weapon equipped</span>`;
     }
 } catch (e) { el.innerHTML = ''; }
 }

async function _loadNpcPanelAbilities(npcId) {
    const el = document.querySelector(`[data-npc-panel-abilities="${npcId}"]`);
    if (!el) return;
    try {
      const abs = await api.get(`/api/characters/${npcId}/abilities`);
      // Validate we got an array
      if (!Array.isArray(abs)) {
        console.warn('Expected array for abilities, got:', abs);
        el.innerHTML = '<span style="color:var(--text-muted)">Invalid data</span>';
        return;
      }
     const active = abs.filter(a => !a.is_passive);
     if (!active.length) { 
       if (abs.length === 0) {
         el.innerHTML = '<span style="color:var(--text-muted)">No abilities assigned</span>';
       } else {
         const passiveCount = abs.filter(a => a.is_passive).length;
         el.innerHTML = `<span style="color:var(--text-muted)">${abs.length} abilities (${passiveCount} passive)</span>`;
       }
       return; 
     }
     el.innerHTML = active.map(a => {
       const onCd = (a.cooldown_remaining||0) > 0;
       const cdInfo = a.cooldown_turns ? `CD ${a.cooldown_turns}` : '';
       return `<div style="display:flex;align-items:center;gap:4px;padding:2px 4px;border-radius:4px;${onCd?'opacity:0.45':''}">
         <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${'✨'} ${a.name}</span>
         <span style="color:var(--text-muted);font-size:0.55rem">${cdInfo}</span>
         ${onCd ? `<span style="color:var(--text-muted);font-size:0.55rem">${a.cooldown_remaining}t</span>` : `<button class="btn btn-primary btn-xs" data-npc-panel-use-ability="${npcId}" data-ability="${a.character_ability_id}" style="font-size:0.55rem;padding:1px 5px">Use</button>`}
       </div>`;
     }).join('');
     // Wire inline ability buttons
     el.querySelectorAll('[data-npc-panel-use-ability]').forEach(btn => {
       btn.addEventListener('click', async () => {
         const aid = parseInt(btn.dataset.ability);
         btn.disabled = true;
         try {
           const res = await api.post(`/api/character-abilities/${aid}/use`, {});
           const msg = (res.results || []).join(' · ') || 'Ability used';
           _showNpcPanelResult(npcId, `<b>✅</b> ${msg}`);
           _loadNpcPanelAbilities(npcId);
           refreshChars();
         } catch(e) {
           let m='Ability failed'; try{const er=JSON.parse(e.message);m=er.detail?.message||er.detail||m;}catch{}
           _showNpcPanelResult(npcId, `<b>❌</b> ${m}`, true);
         } finally { btn.disabled = false; }
       });
     });
   } catch (e) {
     console.error('Error loading NPC abilities:', e);
     el.innerHTML = '<span style="color:var(--text-muted)">Error loading</span>';
   }
 }

async function _loadNpcPanelItems(npcId) {
   const el = document.querySelector(`[data-npc-panel-items="${npcId}"]`);
   if (!el) return;
   try {
     const inv = await api.get(`/api/characters/${npcId}/inventory`);
     // Validate inventory response structure
     if (!inv || !Array.isArray(inv.items)) {
       console.warn('Invalid inventory response:', inv);
       el.innerHTML = '<span style="color:var(--text-muted)">Invalid inventory data</span>';
       return;
     }
     const items = inv.items.filter(i => i.consumable || i.is_potion);
     if (!items.length) { 
       const totalItems = inv.items.length;
       el.innerHTML = totalItems === 0 
         ? '<span style="color:var(--text-muted)">No items in inventory</span>' 
         : `<span style="color:var(--text-muted)">${totalItems} items (none usable)</span>`;
       return; 
     }
     el.innerHTML = items.map(it => `<div style="display:flex;align-items:center;gap:4px;padding:2px 4px;border-radius:4px">
       <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${it.description||''}">${it.potion_icon||'🧪'} ${it.name}</span>
       <span style="color:var(--text-muted);font-size:0.55rem">x${it.quantity}</span>
       <button class="btn btn-primary btn-xs" data-npc-panel-use-item="${npcId}" data-inventory-id="${it.inventory_id}" style="font-size:0.55rem;padding:1px 5px">Use</button>
     </div>`).join('');
     // Wire inline item buttons
     el.querySelectorAll('[data-npc-panel-use-item]').forEach(btn => {
       btn.addEventListener('click', async () => {
         const iid = parseInt(btn.dataset.inventoryId);
         btn.disabled = true;
         try {
           const res = await api.post(`/api/inventory/${iid}/use`, {});
           _showNpcPanelResult(npcId, `<b>✅</b> ${res.breakdown||'used'}`);
           _loadNpcPanelItems(npcId);
           refreshChars();
         } catch(e) { 
           let errorMsg = 'Use failed';
           try {
             if (e.body && e.body.detail) errorMsg = e.body.detail;
             else if (typeof e === 'string') errorMsg = e;
           } finally {
             _showNpcPanelResult(npcId, `<b>❌</b> ${errorMsg}`, true);
           }
         } finally { 
           btn.disabled = false; 
         }
       });
     });
   } catch (e) {
     console.error('Error loading NPC items:', e);
     el.innerHTML = '<span style="color:var(--text-muted)">Error loading items</span>';
   }
 }

function updateNpcControlPanel(npcId) {
  const p = npcPanels[npcId];
  if (!p) return;
  const npc = characters.find(c => c.id === npcId);
  if (!npc) { p.el.remove(); delete npcPanels[npcId]; return; }
  const pct = npc.max_hp > 0 ? Math.round((npc.current_hp / npc.max_hp) * 100) : 0;
  const hpColor = pct > 50 ? 'var(--hp-high)' : pct > 25 ? 'var(--hp-mid)' : 'var(--hp-low)';
  const bar = p.el.querySelector('.npc-panel-hpbar > div');
  if (bar) { bar.style.width = pct + '%'; bar.style.background = hpColor; }
  const stats = p.el.querySelector('.npc-panel-stats');
  if (stats) stats.innerHTML = `<span>AC ${npc.armor_class}</span><span>HP ${npc.current_hp}/${npc.max_hp}</span><span style="flex:1;text-align:right">${!npc.is_alive ? '💀' : ''}</span>`;
  _loadNpcPanelStatuses(npcId);
  // Refresh target list
  const targetSel = p.el.querySelector(`[data-npc-panel-target="${npcId}"]`);
  if (targetSel) {
    const prev = targetSel.value;
    const aliveChars = characters.filter(c => c.is_alive && c.id !== npcId);
    targetSel.innerHTML = '<option value="">— select —</option>' +
      aliveChars.map(c => `<option value="${c.id}">${c.name} ${c.is_npc?'[NPC]':''}</option>`).join('');
    if ([...targetSel.options].some(o => o.value === prev)) targetSel.value = prev;
  }
  // Refresh abilities/items lists (cooldowns, quantities)
  _loadNpcPanelAbilities(npcId);
  _loadNpcPanelItems(npcId);
}

function _showNpcPanelResult(npcId, html, isError=false) {
  const resEl = document.querySelector(`[data-npc-panel-result="${npcId}"]`);
  if (!resEl) return;
  resEl.classList.remove('hidden');
  resEl.style.borderLeftColor = isError ? 'var(--accent-red)' : 'var(--accent)';
  resEl.innerHTML = html;
  setTimeout(() => { if (resEl) resEl.classList.add('hidden'); }, 5000);
}

function _getNpcPanelAdvMode(npcId) {
  const wrap = document.querySelector(`[data-npc-panel-adv="${npcId}"]`);
  if (!wrap) return 'normal';
  const active = wrap.querySelector('.adv-btn.active');
  return active ? active.dataset.mode : 'normal';
}
function _setNpcPanelAdvMode(npcId, mode) {
  const wrap = document.querySelector(`[data-npc-panel-adv="${npcId}"]`);
  if (!wrap) return;
  wrap.querySelectorAll('.adv-btn').forEach(b => {
    const isActive = b.dataset.mode === mode;
    b.classList.toggle('active', isActive);
    b.style.background = isActive ? 'var(--bg-surface-3)' : 'var(--bg-surface-2)';
    b.style.color = isActive ? (mode==='advantage'?'var(--accent-green)':mode==='disadvantage'?'var(--accent-red)':'var(--text-primary)') : 'var(--text-muted)';
    b.style.fontWeight = isActive ? '700' : '400';
  });
}
// Reveal the damage step, populating either the damage_modes selector,
// the read-only weapon-locked dice display, or the editable dice (unarmed).
function _revealDmgStep(el, npcId, hitData) {
  const hitWrap = el.querySelector(`[data-npc-panel-hit="${npcId}"]`);
  const dmgWrap = el.querySelector(`[data-npc-panel-damage="${npcId}"]`);
  if (hitWrap) hitWrap.style.display = 'none';
  if (dmgWrap) dmgWrap.style.display = 'flex';

  const modeWrap = el.querySelector(`[data-npc-panel-dmg-modewrap="${npcId}"]`);
  const modeSel  = el.querySelector(`[data-npc-panel-dmg-mode="${npcId}"]`);
  const diceWrap = el.querySelector(`[data-npc-panel-dmg-dicewrap="${npcId}"]`);
  const roWrap   = el.querySelector(`[data-npc-panel-dmg-readonly="${npcId}"]`);
  if (modeWrap) modeWrap.style.display = 'none';
  if (diceWrap) diceWrap.style.display = 'none';
  if (roWrap)   roWrap.style.display = 'none';

  const modes = Array.isArray(hitData.damage_modes) ? hitData.damage_modes : [];
  const isUnarmed = !hitData.weapon_name || hitData.weapon_name === 'Unarmed';
  const critMul = hitData.critical ? 2 : 1;

  if (modes.length) {
    if (modeSel) {
      modeSel.innerHTML = modes.map((m, i) =>
        `<option value="${i}">${m.label || `Mode ${i+1}`} · ${(m.dice_count||1)*critMul}d${m.dice_type||6}${m.damage_stat?` (${m.damage_stat.slice(0,3).toUpperCase()})`:''}</option>`
      ).join('');
    }
    if (modeWrap) modeWrap.style.display = '';
  } else if (isUnarmed) {
    if (diceWrap) diceWrap.style.display = 'flex';
    const dcEl = el.querySelector(`[data-npc-panel-dmg-count="${npcId}"]`);
    const dtEl = el.querySelector(`[data-npc-panel-dmg-die="${npcId}"]`);
    if (dcEl && hitData.default_dice_count) dcEl.value = hitData.default_dice_count;
    if (dtEl && hitData.default_dice_type) dtEl.value = hitData.default_dice_type;
  } else {
    // Locked weapon — surface editable count/die so GM can override (server now honors).
    if (diceWrap) diceWrap.style.display = 'flex';
    const dcEl = el.querySelector(`[data-npc-panel-dmg-count="${npcId}"]`);
    const dtEl = el.querySelector(`[data-npc-panel-dmg-die="${npcId}"]`);
    if (dcEl && hitData.default_dice_count) dcEl.value = hitData.default_dice_count;
    if (dtEl && hitData.default_dice_type) dtEl.value = hitData.default_dice_type;
    if (roWrap) {
      const dc = (hitData.default_dice_count || 1) * critMul;
      const dt = hitData.default_dice_type || 6;
      roWrap.style.display = '';
      roWrap.textContent = `${hitData.weapon_name} default: ${dc}d${dt}${hitData.critical?' (CRIT ×2)':''} — change to override`;
    }
  }
}

function _wireNpcPanelActions(el, npcId) {
  const advWrap = el.querySelector(`[data-npc-panel-adv="${npcId}"]`);
  if (advWrap) { _setNpcPanelAdvMode(npcId, 'normal'); advWrap.querySelectorAll('.adv-btn').forEach(b => b.addEventListener('click', () => _setNpcPanelAdvMode(npcId, b.dataset.mode))); }
  const hitWrap = el.querySelector(`[data-npc-panel-hit="${npcId}"]`);
  const dmgWrap = el.querySelector(`[data-npc-panel-damage="${npcId}"]`);
  const hitBtn = el.querySelector(`[data-npc-panel-roll-hit="${npcId}"]`);
  if (hitBtn) {
    hitBtn.addEventListener('click', async () => {
      const targetSel = el.querySelector(`[data-npc-panel-target="${npcId}"]`);
      const targetId = parseInt(targetSel?.value);
      if (!targetId) { _showNpcPanelResult(npcId, '<b>❌ Select a target first</b>', true); return; }
      const npc = characters.find(c => c.id === npcId);
      const target = characters.find(c => c.id === targetId);
      if (!npc || !target) return;
      hitBtn.disabled = true;
      try {
        const adv = _getNpcPanelAdvMode(npcId);
        const hitCountEl = el.querySelector(`[data-npc-panel-hit-count="${npcId}"]`);
        const hitDiceCount = Math.max(1, parseInt(hitCountEl?.value) || 1);
        const res = await api.post('/api/combat/hit-roll', { attacker_id: npcId, target_id: targetId, advantage: adv, hit_dice_count: hitDiceCount });
        // Cache hit context for the damage step (and for defense-resolve resume)
        if (npcPanels[npcId]) {
          npcPanels[npcId].hitData = res;
          npcPanels[npcId].targetId = targetId;
        }
        const color = res.hit ? (res.critical ? 'var(--accent-yellow)' : 'var(--accent-green)') : 'var(--accent-red)';
        const label = res.fumble ? '💨 FUMBLE' : res.critical ? '💥 CRITICAL' : res.hit ? '✅ HIT' : '❌ MISS';
        _showNpcPanelResult(npcId, `<div style="color:${color};font-weight:700">${label}</div><div style="font-size:0.62rem;color:var(--text-muted)">${res.hit_breakdown || ''}</div>`);
        if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
          ws.ws.send(JSON.stringify({ type: 'combat.hit_result', attacker_id: npcId, attacker_name: npc.name, target_id: targetId, target_name: target.name, hit: res.hit, critical: !!res.critical, fumble: !!res.fumble, hit_breakdown: res.hit_breakdown, total: res.total }));
        }
        if (res.hit) {
          if (res.pending_defense_id) {
            // Defense reaction is pending — wait for resolution.
            // combat.defense_resolved listener will reveal damage step (or close it on success).
            _showNpcPanelResult(npcId, `<div style="color:${color};font-weight:700">${label}</div><div style="font-size:0.62rem;color:var(--accent)">⏳ Waiting for ${target.name} to defend...</div>`);
          } else {
            // CRIT / fumble / no-defense path → reveal damage step
            _revealDmgStep(el, npcId, res);
          }
        }
      } catch (e) {
        let msg = e?.body?.detail?.message || e?.body?.detail || 'Attack failed';
        _showNpcPanelResult(npcId, `<b>❌</b> ${msg}`, true);
      } finally { hitBtn.disabled = false; }
    });
  }

  // ── STEP 2: Damage Roll ──
  const dmgBtn = el.querySelector(`[data-npc-panel-roll-dmg="${npcId}"]`);
  const cancelDmgBtn = el.querySelector(`[data-npc-panel-cancel-dmg="${npcId}"]`);
  if (cancelDmgBtn) {
    cancelDmgBtn.addEventListener('click', () => {
      hitWrap.style.display = 'flex';
      dmgWrap.style.display = 'none';
      if (npcPanels[npcId]) { npcPanels[npcId].hitData = null; }
    });
  }
  if (dmgBtn) {
    dmgBtn.addEventListener('click', async () => {
      const ctx = npcPanels[npcId] || {};
      const hitData = ctx.hitData;
      const targetId = ctx.targetId || parseInt(el.querySelector(`[data-npc-panel-target="${npcId}"]`)?.value);
      if (!targetId || !hitData) { _showNpcPanelResult(npcId, '<b>❌ Roll Hit first</b>', true); return; }
      const npc = characters.find(c => c.id === npcId);
      const target = characters.find(c => c.id === targetId);
      if (!npc || !target) return;
      const adv = _getNpcPanelAdvMode(npcId);
      // Body: critical from hitData; if NPC has weapon, server ignores dice_*; if unarmed-fallback, send overrides
      const body = {
        attacker_id: npcId, target_id: targetId,
        critical: !!hitData.critical, advantage: adv,
      };
      const modeSel = el.querySelector(`[data-npc-panel-dmg-mode="${npcId}"]`);
      if (modeSel && modeSel.value !== '') body.damage_mode_index = parseInt(modeSel.value);
      const dcEl = el.querySelector(`[data-npc-panel-dmg-count="${npcId}"]`);
      const dtEl = el.querySelector(`[data-npc-panel-dmg-die="${npcId}"]`);
      // Forward dice override; server honors when set (works for unarmed AND armed power-attacks)
      if (dcEl && dcEl.offsetParent !== null) body.dice_count = parseInt(dcEl.value) || 1;
      if (dtEl && dtEl.offsetParent !== null) body.dice_type = parseInt(dtEl.value) || 8;
      dmgBtn.disabled = true;
      try {
        const res = await api.post('/api/combat/damage-roll', body);
        const color = hitData.critical ? 'var(--accent-yellow)' : 'var(--accent-green)';
        _showNpcPanelResult(npcId, `
          <div style="color:${color};font-weight:700">💥 ${res.final_damage} DAMAGE${res.target_downed ? ' · 💀 DOWN' : ''}</div>
          <div style="font-size:0.62rem;color:var(--text-muted)">${res.damage_breakdown || ''}</div>
          <div style="font-size:0.62rem;color:var(--text-muted)">${res.intake_breakdown || ''}</div>
          <div style="font-size:0.62rem">${target.name}: HP ${res.target_hp_before}→<b>${res.target_hp_after}</b></div>
        `);
        if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
          ws.ws.send(JSON.stringify({
            type: 'combat.attack_result',
            attacker_id: npcId, attacker_name: npc.name,
            target_id: targetId, target_name: target.name,
            hit: true, critical: !!hitData.critical, fumble: false,
            final_damage: res.final_damage, target_hp_after: res.target_hp_after,
          }));
        }
        refreshChars();
        hitWrap.style.display = 'flex';
        dmgWrap.style.display = 'none';
        if (npcPanels[npcId]) { npcPanels[npcId].hitData = null; }
      } catch (e) {
        let msg = e?.body?.detail?.message || e?.body?.detail || 'Damage roll failed';
        _showNpcPanelResult(npcId, `<b>❌</b> ${msg}`, true);
      } finally { dmgBtn.disabled = false; }
    });
  }

  // Defend
  const defBtn = el.querySelector(`.npc-panel-def[data-npc="${npcId}"]`);
  if (defBtn) {
    defBtn.addEventListener('click', async () => {
      if (!activeCombat || activeCombat.status !== 'active') {
        _showNpcPanelResult(npcId, '<b>❌ No active combat</b>', true); return;
      }
      defBtn.disabled = true;
      try {
        const res = await api.post(`/api/combat/${activeCombat.id}/defend`, { character_id: npcId });
        _showNpcPanelResult(npcId, `<b>🛡 DEFENDING</b><div style="font-size:0.62rem;color:var(--text-muted)">New AC: ${res.new_ac}</div>`);
        if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
          ws.ws.send(JSON.stringify({ type: 'combat.defend', data: res }));
        }
      } catch (e) { _showNpcPanelResult(npcId, `<b>❌</b> ${e?.body?.detail || 'Defend failed'}`, true); }
      finally { defBtn.disabled = false; }
    });
  }

  // Heal expand / collapse
  const healToggle = el.querySelector(`.npc-panel-heal-btn[data-npc="${npcId}"]`);
  const healBox = el.querySelector(`[data-npc-panel-heal-box="${npcId}"]`);
  if (healToggle && healBox) {
    healToggle.addEventListener('click', () => {
      healBox.style.display = healBox.style.display === 'flex' ? 'none' : 'flex';
    });
    const healOk = el.querySelector(`[data-npc-panel-heal-ok="${npcId}"]`);
    const healCancel = el.querySelector(`[data-npc-panel-heal-cancel="${npcId}"]`);
    if (healCancel) healCancel.addEventListener('click', () => { healBox.style.display = 'none'; });
    if (healOk) {
      healOk.addEventListener('click', async () => {
        const input = el.querySelector(`[data-npc-panel-heal-input="${npcId}"]`);
        const amt = parseInt(input?.value) || 0;
        if (amt <= 0) return;
        const npc = characters.find(c => c.id === npcId);
        if (!npc) return;
        const newHp = Math.min(npc.max_hp, npc.current_hp + amt);
        try {
          await api.patch(`/api/characters/${npcId}`, { current_hp: newHp });
          _showNpcPanelResult(npcId, `<b>❤ Healed +${amt}</b> → HP ${newHp}/${npc.max_hp}`);
          healBox.style.display = 'none';
          refreshChars();
        } catch (e) { _showNpcPanelResult(npcId, `<b>❌</b> ${e?.body?.detail||'Heal failed'}`, true); }
      });
    }
  }
}

// Auto-update open panels when character data changes
function _updateAllNpcPanels() {
  Object.keys(npcPanels).forEach(id => updateNpcControlPanel(parseInt(id)));
}

// Wire open-panel from token shift+click and context menu
// NOTE: actual wiring is done inside map canvas init (onTokenClick / onTokenRightClick)

// ══════════════════════════════════════════════════════════════
