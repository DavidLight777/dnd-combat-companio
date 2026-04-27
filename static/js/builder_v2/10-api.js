// ════════════════════════════════════════════════════════════
// Map Builder v2 — thin API wrapper. Reuses the global `api`
// helper from gm/01-core.js for auth headers + JSON parsing.
// ════════════════════════════════════════════════════════════

(function () {
  const BASE = '/api/builder-v2';

  window.bv2.api = {
    // Maps
    listMaps:     ()                  => api.get(`${BASE}/sessions/${SESSION_CODE}/maps`),
    createMap:    (body)              => api.post(`${BASE}/sessions/${SESSION_CODE}/maps`, body),
    updateMap:    (id, body)          => api.patch(`${BASE}/maps/${id}`, body),
    deleteMap:    (id)                => api.del(`${BASE}/maps/${id}`),
    activateMap:  (id)                => api.post(`${BASE}/maps/${id}/activate`, {}),

    // Locations
    listLocs:     (mapId)             => api.get(`${BASE}/maps/${mapId}/locations`),
    createLoc:    (mapId, body)       => api.post(`${BASE}/maps/${mapId}/locations`, body),
    getLoc:       (id)                => api.get(`${BASE}/locations/${id}`),
    updateLoc:    (id, body)          => api.patch(`${BASE}/locations/${id}`, body),
    deleteLoc:    (id)                => api.del(`${BASE}/locations/${id}`),
    activateLoc:  (id)                => api.post(`${BASE}/locations/${id}/activate`, {}),

    // Tiles
    listTiles:    (locId)             => api.get(`${BASE}/locations/${locId}/tiles`),
    replaceTiles: (locId, tilesArr)   => api.put(`${BASE}/locations/${locId}/tiles`, { tiles: tilesArr }),
    patchTiles:   (locId, setArr, eraseArr) =>
      api.patch(`${BASE}/locations/${locId}/tiles`, { set: setArr, erase: eraseArr }),

    // Entities
    listEntities: (locId)             => api.get(`${BASE}/locations/${locId}/entities`),
    createEntity: (locId, body)       => api.post(`${BASE}/locations/${locId}/entities`, body),
    getEntity:    (id)                => api.get(`${BASE}/entities/${id}`),
    updateEntity: (id, body)          => api.patch(`${BASE}/entities/${id}`, body),
    deleteEntity: (id)                => api.del(`${BASE}/entities/${id}`),
    moveEntity:   (id, body)          => api.post(`${BASE}/entities/${id}/move`, body),

    // Lights
    listLights:   (locId)             => api.get(`${BASE}/locations/${locId}/lights`),
    createLight:  (locId, body)       => api.post(`${BASE}/locations/${locId}/lights`, body),
    updateLight:  (id, body)          => api.patch(`${BASE}/lights/${id}`, body),
    deleteLight:  (id)                => api.del(`${BASE}/lights/${id}`),

    // FOV
    visitLocation: (locId, charId, visibleCells) =>
      api.post(`${BASE}/locations/${locId}/visit`, { character_id: charId, visible_cells: visibleCells }),

    // Edges
    listEdges:   (locId)          => api.get(`${BASE}/locations/${locId}/edges`),
    createEdge:  (locId, body)    => api.post(`${BASE}/locations/${locId}/edges`, body),
    updateEdge:  (id, body)       => api.patch(`${BASE}/edges/${id}`, body),
    deleteEdge:  (id)             => api.del(`${BASE}/edges/${id}`),

    // Grid movement
    moveGrid:    (charId, body)   => api.post(`${BASE}/characters/${charId}/move-grid`, body),

    // Library
    listLibrary:   (sessCode)     => api.get(`${BASE}/library?session_code=${sessCode}`),
    saveSnapshot:  (body)         => api.post(`${BASE}/library/save-from-map`, body),
    loadSnapshot:  (id, body)     => api.post(`${BASE}/library/${id}/load-as-map`, body),
    deleteSnapshot:(id)           => api.del(`${BASE}/library/${id}`),
  };
})();
