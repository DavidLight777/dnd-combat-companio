// ════════════════════════════════════════════════════════════
// Map Builder v2 — WebSocket handlers.
// Other GMs in the same session see live updates as one GM paints.
// The painting GM ignores their own echo via S.suppressNextWs.
// ════════════════════════════════════════════════════════════

(function () {
  const S = window.bv2;
  if (!window.ws) return;          // ws may not be ready at script-load time

  function reloadIfMatches(locId) {
    if (S.suppressNextWs) return;
    if (S.currentLocId !== locId) return;
    // Cheapest correct refresh: re-fetch the whole location.
    S.loadLocation(locId);
  }

  ws.on('bv2.tiles_patched', d => reloadIfMatches(d.location_id));
  ws.on('bv2.tiles_replaced', d => reloadIfMatches(d.location_id));

  ws.on('bv2.entity_added', d => reloadIfMatches(d.location_id));
  ws.on('bv2.entity_updated', d => reloadIfMatches(d.location_id));
  ws.on('bv2.entity_deleted', d => reloadIfMatches(d.location_id));

  ws.on('bv2.visit_updated', d => {
    // Another character updated their FOV — player/minimap can refresh if needed.
    // For now we do nothing; the client recomputes FOV locally on movement.
  });

  ws.on('bv2.light_added', d => reloadIfMatches(d.location_id));
  ws.on('bv2.light_updated', d => reloadIfMatches(d.location_id));
  ws.on('bv2.light_deleted', d => reloadIfMatches(d.location_id));

  ws.on('bv2.map_added', m => {
    if (!S.maps.find(x => x.id === m.id)) S.maps.push(m);
    if (typeof S.loadMaps === 'function' && document.getElementById('bv2-map-select')) {
      // Cheap re-render
      const sel = document.getElementById('bv2-map-select');
      sel.innerHTML = S.maps.map(x =>
        `<option value="${x.id}" ${x.id === S.currentMapId ? 'selected' : ''}>${x.name}${x.is_active ? ' ★' : ''}</option>`
      ).join('');
    }
  });

  ws.on('bv2.map_deleted', d => {
    S.maps = S.maps.filter(x => x.id !== d.map_id);
    if (S.currentMapId === d.map_id) {
      S.currentMapId = S.maps[0]?.id || null;
      S.currentLocId = null;
      if (S.currentMapId && typeof S.loadLocations === 'function') S.loadLocations();
    }
  });

  ws.on('bv2.location_added', loc => {
    if (loc.map_id !== S.currentMapId) return;
    if (!S.locations.find(x => x.id === loc.id)) {
      S.locations.push(loc);
      const sel = document.getElementById('bv2-loc-select');
      if (sel) sel.innerHTML = S.locations.map(x =>
        `<option value="${x.id}" ${x.id === S.currentLocId ? 'selected' : ''}>${x.name}${x.is_active ? ' ▶' : ''}</option>`
      ).join('');
    }
  });

  ws.on('bv2.location_deleted', d => {
    S.locations = S.locations.filter(x => x.id !== d.location_id);
    if (S.currentLocId === d.location_id) {
      S.currentLocId = S.locations[0]?.id || null;
      if (S.currentLocId && typeof S.loadLocation === 'function') S.loadLocation(S.currentLocId);
    }
  });

  ws.on('bv2.location_activated', d => {
    S.locations.forEach(l => { l.is_active = (l.id === d.location_id); });
    S.maps.forEach(m => { m.is_active = (m.id === d.map_id); });
    const sel = document.getElementById('bv2-loc-select');
    if (sel) sel.innerHTML = S.locations.map(x =>
      `<option value="${x.id}" ${x.id === S.currentLocId ? 'selected' : ''}>${x.name}${x.is_active ? ' ▶' : ''}</option>`
    ).join('');
  });
})();
