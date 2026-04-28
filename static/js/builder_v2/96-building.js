// ════════════════════════════════════════════════════════════
// Map Builder v2 — Building tool (Phase 10 Round 1).
// Drag a rectangle to atomically create walls + floor + door + zone.
// ════════════════════════════════════════════════════════════

(function () {
  const S = window.bv2;

  async function commitBuilding({ cMin, rMin, cMax, rMax, doorSide }) {
    if (!S.currentLocId) return;
    const setArr = [];
    // Perimeter walls
    for (let c = cMin; c <= cMax; c++) {
      setArr.push({ col: c, row: rMin, tile_type: 'wall' });
      setArr.push({ col: c, row: rMax, tile_type: 'wall' });
    }
    for (let r = rMin + 1; r < rMax; r++) {
      setArr.push({ col: cMin, row: r, tile_type: 'wall' });
      setArr.push({ col: cMax, row: r, tile_type: 'wall' });
    }
    // Interior floor
    const interiorCells = [];
    for (let c = cMin + 1; c < cMax; c++) {
      for (let r = rMin + 1; r < rMax; r++) {
        setArr.push({ col: c, row: r, tile_type: 'floor' });
        interiorCells.push({ col: c, row: r });
      }
    }
    // Door (default south edge centre)
    let doorCol, doorRow;
    if (doorSide === 'n') { doorCol = Math.floor((cMin + cMax) / 2); doorRow = rMin; }
    else if (doorSide === 'e') { doorCol = cMax; doorRow = Math.floor((rMin + rMax) / 2); }
    else if (doorSide === 'w') { doorCol = cMin; doorRow = Math.floor((rMin + rMax) / 2); }
    else { doorCol = Math.floor((cMin + cMax) / 2); doorRow = rMax; }
    const idx = setArr.findIndex(t => t.col === doorCol && t.row === doorRow);
    if (idx >= 0) setArr[idx] = { col: doorCol, row: doorRow, tile_type: 'door' };

    await S.api.patchTiles(S.currentLocId, setArr, []);
    const name = (prompt('Building name:', 'Building') || 'Building').trim();
    await S.api.createInterior(S.currentLocId, {
      name,
      kind: 'building',
      reveal_mode: 'on_enter',
      cells: interiorCells,
    });
    await S.loadLocation(S.currentLocId);
    if (typeof S.refreshInteriorList === 'function') S.refreshInteriorList();
  }

  S.commitBuilding = commitBuilding;
})();
