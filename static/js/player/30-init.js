// ════════════════════════════════════════════════════════
// Final init() — MUST be last
// Source: player-app.js lines 5281-5337
// ════════════════════════════════════════════════════════

// INIT
// ══════════════════════════════════════════════════════════════
window.addEventListener('error', e => {
  console.error('Global error:', e.error);
  showToast('JS Error: ' + (e.error?.message || 'unknown'));
});
window.addEventListener('unhandledrejection', e => {
  console.error('Unhandled rejection:', e.reason);
  showToast('Async Error: ' + (e.reason?.message || 'unknown'));
});

(async function init() {
  try {
    await loadChar();
    loadInventory();
    loadCurrency();
    loadStatusEffects();
    // Rework v3 Phase 1: always-on battle grid in the Main tab.
    initPlayerMainGrid();
    loadCombatBanner();
    loadPlayerQuests();
    loadPlayerAnnouncements();
    loadPlayerNotes();
    loadPlayerTimer();
    restoreGmTimer();
    loadTableView();
    renderBonusesPenalties();
    loadAbilities();  // FIX 2: load early so Action Menu (Main tab) knows abilities
    initFreeRollWidget();  // FIX 4
  } catch (e) {
    console.error('Init failed:', e);
    showToast('Page init failed: ' + (e.message || 'unknown'));
  }
})();

// FIX 1: WS listeners for Table View updates
ws.on('table.updated', () => {
  loadTableView();
});

ws.on('character.hp_changed', d => {
  if (!d || !d.character_id) return;
  const cards = document.querySelectorAll(`[data-id="${d.character_id}"]`);
  cards.forEach(card => {
    const hpText = card.querySelector('.mini-hp-text');
    const hpBar = card.querySelector('.mini-hp-bar');
    if (hpText && d.current_hp !== undefined && d.max_hp !== undefined) {
      hpText.textContent = `${d.current_hp}/${d.max_hp}`;
    }
    if (hpBar && d.current_hp !== undefined && d.max_hp !== undefined) {
      const pct = d.max_hp > 0 ? Math.min(100, d.current_hp / d.max_hp * 100) : 0;
      hpBar.style.width = pct + '%';
    }
  });
});

ws.connect();
