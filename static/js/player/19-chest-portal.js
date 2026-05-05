// ════════════════════════════════════════════════════════
// Chest & portal interaction
// Source: player-app.js lines 3226-3342
// ════════════════════════════════════════════════════════

// PLAYER CHEST & PORTAL INTERACTION
// ══════════════════════════════════════════════════════════════
async function openPlayerChestModal(chest) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:380px">
      <h3>📦 ${chest.name || 'Chest'}</h3>
      <div id="pc-chest-content" style="margin-top:8px">
        <div style="text-align:center;padding:12px;color:var(--text-muted)">Loading...</div>
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-ghost btn-sm" id="pc-close">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#pc-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  try {
    const data = await api.get(`/api/builder-v2/chests/${chest.id}`);
    const content = overlay.querySelector('#pc-chest-content');
    const items = data.items || [];
    
    if (data.is_locked) {
      content.innerHTML = `
        <div style="text-align:center;padding:12px">
          <div style="font-size:1.5rem;margin-bottom:8px">🔒</div>
          <div>This chest is locked</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px">Lock DC: ${data.lock_dc}</div>
          <div id="pc-lock-form" style="margin-top:12px"></div>
        </div>`;
      if (typeof createD20RollForm !== 'function') {
        showToast('Roll UI failed to load');
        return;
      }
      createD20RollForm(content.querySelector('#pc-lock-form'), {
        idPrefix: 'pc-lock',
        hideRollType: true,
        defaultAbility: 'dexterity',
        maxDice: 5,
        rollButtonText: 'Pick Lock',
        onRoll: async ({ ability, diceCount, advantageMode }) => {
          const advantage_mode = advantageMode;
          const d20_count = diceCount;
          const res = await api.post(`/api/builder-v2/chests/${chest.id}/pick-lock`, { character_id: CHAR_ID, ability, advantage_mode, d20_count });
          if (!res?.rolls) throw new Error(res?.detail || 'Lockpick failed');
          const mod = res.modifier >= 0 ? `+${res.modifier}` : `${res.modifier}`;
          showToast(`${res.success ? '🔓 Lock picked!' : '🔒 Lockpick failed!'} Roll ${res.rolls.join(', ')} → ${res.chosen_roll}${mod} = ${res.total} vs DC ${res.dc}`);
          if (res.success) {
            setTimeout(() => {
              overlay.remove();
              openPlayerChestModal(chest); // Re-open to show contents
            }, 400);
          }
          return res;
        },
        resultFormatter: res => {
          if (!res?.rolls) return '';
          const mod = res.modifier >= 0 ? `+${res.modifier}` : `${res.modifier}`;
          return `<span style="color:var(--accent)">${res.rolls.join(', ')} → ${res.chosen_roll}${mod} = ${res.total} vs DC ${res.dc}</span>`;
        },
      });
      return;
    }

    if (!items.length) {
      content.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-muted)">Chest is empty</div>';
      return;
    }

    content.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:6px">
        ${items.map((it, i) => `
          <label style="display:flex;align-items:center;gap:8px;background:var(--bg-surface-2);padding:8px;border-radius:var(--r-sm);cursor:pointer">
            <input type="checkbox" class="pc-item-check" value="${i}" checked>
            <span style="flex:1;font-size:0.8rem">${it.name || it.item_name || 'Unknown'} x${it.quantity || 1}</span>
          </label>
        `).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-primary btn-sm" id="pc-take-selected">Take Selected</button>
        <button class="btn btn-ghost btn-sm" id="pc-take-all">Take All</button>
      </div>`;

    overlay.querySelector('#pc-take-selected').addEventListener('click', async () => {
      const checked = Array.from(overlay.querySelectorAll('.pc-item-check:checked')).map(cb => parseInt(cb.value));
      if (!checked.length) { showToast('Select items to take'); return; }
      await takeChestItems(chest.id, checked, overlay);
    });

    overlay.querySelector('#pc-take-all').addEventListener('click', async () => {
      await takeChestItems(chest.id, null, overlay);
    });

  } catch (e) {
    console.error('Failed to load chest items', e);
    overlay.querySelector('#pc-chest-content').innerHTML = '<div style="text-align:center;padding:12px;color:var(--accent-red)">Failed to load chest</div>';
  }
}

async function takeChestItems(chestId, itemIndices, overlay) {
  try {
    const res = await api.post(`/api/builder-v2/chests/${chestId}/take`, {
      character_id: CHAR_ID,
      item_indices: itemIndices,
    });
    showToast(`Taken ${res.taken?.length || 0} item(s)`);
    overlay.remove();
    loadPlayerMapState();
    loadChar(); // refresh character data (inventory, currency)
  } catch (e) {
    showToast('Failed to take items');
    console.error(e);
  }
}

function openPlayerPortalModal(portal) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:320px;text-align:center">
      <h3>🌀 ${portal.name || 'Portal'}</h3>
      <p style="color:var(--text-muted);font-size:0.85rem;margin:12px 0">Enter the portal?</p>
      <div style="display:flex;gap:8px;justify-content:center">
        <button class="btn btn-ghost btn-sm" id="pp-cancel">Stay</button>
        <button class="btn btn-primary btn-sm" id="pp-enter">Enter</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#pp-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#pp-enter').addEventListener('click', async () => {
    try {
      const res = await api.post(`/api/builder-v2/portals/${portal.id}/use`, { character_id: CHAR_ID });
      showToast('Teleported!');
      overlay.remove();
      loadPlayerMapState();
    } catch (e) {
      showToast('Failed to use portal');
      console.error(e);
    }
  });
}

// ══════════════════════════════════════════════════════════════
