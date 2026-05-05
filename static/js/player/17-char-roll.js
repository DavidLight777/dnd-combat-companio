// ════════════════════════════════════════════════════════
// Characteristic roll (Stage 7)
// Source: player-app.js lines 2974-3004
// ════════════════════════════════════════════════════════

function initAdvancedCharacteristicRollWidget() {
  const host = document.getElementById('player-roll-widget-host');
  if (!host || typeof createD20RollForm !== 'function') return;
  createD20RollForm(host, {
    idPrefix: 'player-roll',
    title: 'Characteristic Roll',
    diceTypes: [4, 6, 8, 10, 12, 20, 100],
    defaultDiceType: 20,
    maxDice: 20,
    rollButtonText: 'Roll',
    onRoll: async ({ ability, rollType, diceCount, diceType, advantageMode }) => {
      const res = await api.post(`/api/characters/${CHAR_ID}/roll-characteristic`, {
        stat: ability,
        roll_type: rollType,
        advantage_mode: advantageMode,
        dice_count: diceCount,
        dice_type: diceType,
      });
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({ type: 'roll.characteristic', ...res }));
      }
      return res;
    },
    resultFormatter: res => `<span style="color:var(--accent)">${res.description}</span>`,
  });
}
document.addEventListener('DOMContentLoaded', initAdvancedCharacteristicRollWidget);

// ══════════════════════════════════════════════════════════════
