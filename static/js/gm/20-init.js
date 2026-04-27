// ════════════════════════════════════════════════════════
// Final init() calls
// Source: gm-app.js lines 10255–10273
// Globals shared via window.* and module-scope hoisting.
// ════════════════════════════════════════════════════════

// INIT
// ══════════════════════════════════════════════════════════════
refreshChars();
loadInitiativeOrder();
loadAIHistory();
loadCategories().then(() => loadItems());
loadCombatPanel();
loadRacesClasses();
loadNpcLibrary();
loadQuests();
loadAnnouncements();
loadSessionTimer();
loadGmAbilities();
loadWizardPending();
loadBuilder();
loadMapState();
loadCards();
loadChests();
ws.connect();
