// ════════════════════════════════════════════════════════
// Characteristic roll (Stage 7)
// Source: player-app.js lines 2974-3004
// ════════════════════════════════════════════════════════

// CHARACTERISTIC ROLL (Stage 7)
// ══════════════════════════════════════════════════════════════
// Wire char-roll advantage toggle
let _charRollAdvMode = 'normal';
document.querySelectorAll('#char-roll-adv-toggle button').forEach(b => {
  b.addEventListener('click', () => {
    _charRollAdvMode = b.dataset.mode;
    document.querySelectorAll('#char-roll-adv-toggle button').forEach(x => x.classList.toggle('active', x === b));
  });
});
$('#btn-player-roll')?.addEventListener('click', async () => {
  const stat = $('#player-roll-stat').value;
  const rollType = $('#player-roll-type').value;
  try {
    const res = await api.post(`/api/characters/${CHAR_ID}/roll-characteristic`, {
      stat, roll_type: rollType, advantage_mode: _charRollAdvMode,
    });
    let advTag = '';
    if (res.advantage_mode === 'advantage') advTag = ' <span class="adv-badge advantage">ADV</span>';
    else if (res.advantage_mode === 'disadvantage') advTag = ' <span class="adv-badge disadvantage">DISADV</span>';
    $('#player-roll-result').innerHTML = `<span style="color:var(--accent)">${res.description}</span>${advTag}`;
    // Broadcast to GM
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({ type: 'roll.characteristic', ...res }));
    }
  } catch {
    $('#player-roll-result').textContent = 'Roll failed';
  }
});

// ══════════════════════════════════════════════════════════════
