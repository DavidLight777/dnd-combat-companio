// ════════════════════════════════════════════════════════
// Phase 6: tab switching
// Source: player-app.js lines 3505-3537
// ════════════════════════════════════════════════════════

// PHASE 6 — TAB SWITCHING
// ══════════════════════════════════════════════════════════════
$$('.player-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.player-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // Hide every tab (force inline display:none to defeat any prior inline override)
    $$('.player-tab').forEach(t => {
      t.classList.remove('active');
      t.style.display = 'none';
    });
    const tab = document.getElementById(btn.dataset.tab);
    if (tab) {
      tab.classList.add('active');
      tab.style.display = 'block';
    }
    // Lazy-load tabs
    if (btn.dataset.tab === 'tab-abilities') loadAbilities();
    if (btn.dataset.tab === 'tab-memory') loadMemory();
    // Rework v3 Phase 1: the Main-tab canvas measured 0×0 while hidden,
    // so re-fit it whenever the player returns to Main. Cheap no-op
    // elsewhere.
    if (btn.dataset.tab === 'tab-main' && typeof playerMainGrid !== 'undefined' && playerMainGrid) {
      // `_resize` already calls render().
      requestAnimationFrame(() => {
        playerMainGrid._resize();
        playerMainGrid.centerView();
      });
    }
  });
});

// ══════════════════════════════════════════════════════════════
