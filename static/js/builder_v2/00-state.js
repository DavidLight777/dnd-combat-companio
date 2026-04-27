// ════════════════════════════════════════════════════════════
// Map Builder v2 — module-scope shared state.
// All modules read/write window.bv2.* to avoid the legacy
// builder's global pollution.
// ════════════════════════════════════════════════════════════

(function () {
  if (window.bv2) return; // hot-reload safety
  window.bv2 = {
    // Network state
    maps: [],            // [{id, name, ...}]
    locations: [],       // [{id, name, ...}] for current map
    currentMapId: null,
    currentLocId: null,

    // Editor state
    view: null,          // MapView instance
    brush: 'floor',
    saveTimer: null,
    pendingSet: new Map(),    // "col,row" -> tile_type   (queued upserts)
    pendingErase: new Set(),  // "col,row"                (queued deletes)
    saveIndicator: null, // DOM ref filled at init
    suppressNextWs: false,    // ignore the WS event from our own save
  };
})();
