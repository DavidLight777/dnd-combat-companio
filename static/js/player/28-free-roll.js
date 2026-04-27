// ════════════════════════════════════════════════════════
// FIX 4: free dice roll widget
// Source: player-app.js lines 5036-5106
// ════════════════════════════════════════════════════════

// FIX 4 — FREE DICE ROLL (any dice/count/adv, optional private)
// ══════════════════════════════════════════════════════════════
function _rollOne(die) { return Math.floor(Math.random() * die) + 1; }

function initFreeRollWidget() {
  const host = document.getElementById('free-roll-widget-host');
  if (!host || typeof createDiceRollWidget !== 'function') return;

  createDiceRollWidget(host, {
    label: '',
    defaultDiceCount: 1,
    defaultDiceType:  20,
    showDiceSelector: true,
    showAdvantage:    true,
    showRollButton:   true,
    rollButtonText:   'Roll',
    onRoll: async ({ diceCount, diceType, advantageMode }) => {
      // Roll locally (free roll doesn't need a backend endpoint)
      const rollSet = () => Array.from({ length: diceCount }, () => _rollOne(diceType));
      let rolls = rollSet();
      let chosen = rolls;
      let allRolls = rolls.slice();

      if (advantageMode !== 'normal') {
        const second = rollSet();
        allRolls = rolls.slice();
        // Compare sums; pick winning set
        const sumA = rolls.reduce((a, b) => a + b, 0);
        const sumB = second.reduce((a, b) => a + b, 0);
        if (advantageMode === 'advantage') chosen = sumA >= sumB ? rolls : second;
        else                                chosen = sumA <= sumB ? rolls : second;
        allRolls = allRolls.concat(second);
      }

      const total = chosen.reduce((a, b) => a + b, 0);
      const diceLabel = `${diceCount}d${diceType}`;
      let breakdown;
      if (advantageMode === 'advantage') {
        breakdown = `ADV: ${diceLabel}[${rolls.join(',')}] vs [${allRolls.slice(diceCount).join(',')}] → took [${chosen.join(',')}] = ${total}`;
      } else if (advantageMode === 'disadvantage') {
        breakdown = `DISADV: ${diceLabel}[${rolls.join(',')}] vs [${allRolls.slice(diceCount).join(',')}] → took [${chosen.join(',')}] = ${total}`;
      } else {
        breakdown = `${diceLabel}[${chosen.join(',')}] = ${total}`;
      }

      // WS broadcast — private toggle controls GM visibility
      const isPrivate = !!document.getElementById('free-roll-private')?.checked;
      if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
        ws.ws.send(JSON.stringify({
          type: 'roll.free_roll',
          character_id: CHAR_ID,
          character_name: char?.name,
          dice_count: diceCount,
          dice_type:  diceType,
          advantage_mode: advantageMode,
          rolls: chosen,
          total, breakdown,
          private: isPrivate,
        }));
      }

      // Log locally always
      addLog(`🎲 ${breakdown}${isPrivate ? ' (private)' : ''}`);
      addRollHistory('free', breakdown, total);

      return { total, breakdown };
    },
  });
}

// ══════════════════════════════════════════════════════════════
