// Phase 17 Round 5: Player trap notifications
ws.on('trap.triggered', d => {
  if (d.character_id !== CHAR_ID) return;
  if (d.missed) {
    showToast(`⚠️ ${d.trap_name} missed you!`);
  } else {
    showToast(`☠️ ${d.trap_name} dealt ${d.damage} ${d.damage_type} damage!`);
    if (d.dot_applied) {
      showToast(`☠️ ${d.dot_name} applied (${d.dot_turns} turns)`);
    }
    // Refresh HP display
    if (typeof loadChar === 'function') loadChar();
  }
});
