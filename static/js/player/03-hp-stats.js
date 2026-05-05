// ════════════════════════════════════════════════════════
// HP display + Stats panel
// Source: player-app.js lines 439-565
// ════════════════════════════════════════════════════════

// HP DISPLAY
// ══════════════════════════════════════════════════════════════
function renderHP() {
  const c = char; if (!c) return;
  const pct = c.max_hp > 0 ? (c.current_hp / c.max_hp * 100) : 0;
  const color = pct > 50 ? 'var(--hp-high)' : pct > 25 ? 'var(--hp-mid)' : 'var(--hp-low)';
  $('#hp-display').textContent = `${c.current_hp} / ${c.max_hp}`;
  $('#hp-display').style.color = color;
  $('#hp-bar').style.width = `${pct}%`;
  $('#hp-bar').style.background = color;
  $('#kd-display').textContent = c.armor_class;
  // Mana
  renderMana();
  // FIX 2: keep left sidebar in sync
  renderCharSidebar();
  renderCharStatsSidebar();  // Step 2: visible characteristics
}

function renderCharStatsSidebar() {
  const c = char; if (!c) return;
  const grid = document.getElementById('cs-stats-grid');
  if (!grid) return;
  const stats = [
    { key: 'strength', label: 'STR' },
    { key: 'dexterity', label: 'DEX' },
    { key: 'constitution', label: 'CON' },
    { key: 'intelligence', label: 'INT' },
    { key: 'wisdom', label: 'WIS' },
    { key: 'charisma', label: 'CHA' },
  ];
  const hasPoints = (c.attribute_points_available || 0) > 0;
  grid.innerHTML = stats.map(s => {
    // Rework v2: stat value IS the bonus (0..N). 0 is a legitimate value —
    // declined characters have every stat at 0. Never fall back to 10.
    const base = (typeof c[s.key] === 'number') ? c[s.key] : 0;
    const mods = (c.stat_modifiers || []).filter(m => m.stat_name === s.key && m.is_active);
    const modSum = mods.reduce((a, m) => a + m.value, 0);
    const total = base + modSum;
    const modText = modSum !== 0 ? `<span style="font-size:0.6rem;color:${modSum > 0 ? 'var(--accent-green)' : 'var(--accent-red)'}"​>${modSum > 0 ? '+' : ''}${modSum}</span>` : '';
    const plusBtn = hasPoints ? `<button class="btn btn-xs btn-primary stat-plus-btn" data-stat="${s.key}" style="padding:1px 6px;font-size:0.65rem;margin-left:4px" title="+1 ${s.label}"​>+1</button>` : '';
    return `
      <div class="sm-cell" style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <span class="sm-key">${s.label}</span>
          <span class="sm-val">${total} ${modText}</span>
        </div>
        ${plusBtn}
      </div>`;
  }).join('');

  // Wire [+1] buttons
  if (hasPoints) {
    grid.querySelectorAll('.stat-plus-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const stat = btn.dataset.stat;
        try {
          const res = await api.post(`/api/characters/${CHAR_ID}/spend-attribute-point`, { stat });
          showToast(`${stat.slice(0,3).toUpperCase()} +1! Points left: ${res.attribute_points_available}`, 'accent');
          await loadChar();
        } catch (e) {
          showToast('Failed to spend point', 'error');
        }
      });
    });
  }
}

function renderMana() {
  const c = char; if (!c) return;
  const card = $('#mana-card');
  if (!card) return;
  if (!c.mana_max || c.mana_max <= 0) { card.style.display = 'none'; return; }
  card.style.display = '';
  const pct = c.mana_max > 0 ? (c.mana_current / c.mana_max * 100) : 0;
  $('#mana-display').textContent = `${c.mana_current} / ${c.mana_max}`;
  $('#mana-bar').style.width = `${pct}%`;
  const rb = $('#mana-regen-badge');
  if (c.mana_regen_per_turn > 0) { rb.style.display = ''; rb.textContent = `+${c.mana_regen_per_turn}/turn`; }
  else rb.style.display = 'none';
}

// ══════════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════════
function renderStats() {
  const c = char; if (!c) return;
  const stats = ['strength','dexterity','constitution','intelligence','wisdom','charisma'];
  const labels = ['STR','DEX','CON','INT','WIS','CHA'];
  const grid = $('#stats-grid');

  grid.innerHTML = stats.map((s, i) => {
    const base = c[s];
    const mods = (c.stat_modifiers || []).filter(m => m.stat_name === s && m.is_active);
    const modSum = mods.reduce((a, m) => a + m.value, 0);
    const total = base + modSum;
    const modLabel = modSum !== 0 ? `<span style="font-size:0.55rem;color:${modSum > 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">(${modSum > 0 ? '+' : ''}${modSum})</span>` : '';
    const tooltipParts = mods.map(m => `${m.name || m.source || '?'}: ${m.value > 0 ? '+' : ''}${m.value}`);
    const tooltip = tooltipParts.length ? ` title="${tooltipParts.join(', ')}"` : '';
    return `<div class="stat-cell"${tooltip}>
      <div class="stat-name">${labels[i]}</div>
      <div class="stat-val">${total} ${modLabel}</div>
      <input type="number" value="${base}" data-stat="${s}" style="margin-top:4px">
    </div>`;
  }).join('') + `
    <div class="stat-cell">
      <div class="stat-name">KD</div>
      <div class="stat-val" style="color:var(--accent)">${c.armor_class}</div>
      <input type="number" value="${c.armor_class}" data-stat="armor_class" style="margin-top:4px">
    </div>
    <div class="stat-cell">
      <div class="stat-name">Max HP</div>
      <div class="stat-val">${c.max_hp}</div>
      <input type="number" value="${c.max_hp}" data-stat="max_hp" style="margin-top:4px">
    </div>`;

  grid.querySelectorAll('input[data-stat]').forEach(inp => {
    inp.addEventListener('change', () => {
      const field = inp.dataset.stat;
      const val = parseInt(inp.value) || 0;
      debouncedSave({ [field]: val });
      char[field] = val;
      renderHP();
    });
  });
}

// ══════════════════════════════════════════════════════════════
