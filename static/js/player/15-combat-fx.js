// ════════════════════════════════════════════════════════
// Combat FX animations
// Source: player-app.js lines 2727-2788
// ════════════════════════════════════════════════════════

// COMBAT FX — play a map-canvas animation when an attack resolves.
// Driven entirely by WS payloads so every client sees the same
// effect, regardless of who rolled. The helper accepts flexible
// field names because two slightly different payload shapes share
// this event (the two-step hit→damage flow from openAttackConfirm
// and the single-step ability flow), and we want to avoid tying
// the FX trigger to either one.
// ══════════════════════════════════════════════════════════════
function _playCombatFxFromPayload(d) {
  if (!d) return;
  const targetId = d.target_id ?? d.defender_id;
  if (!targetId) return;
  const dmg = d.final_damage ?? d.damage ?? null;
  const hit = d.hit ?? (d.attack_roll && d.attack_roll.hit);
  const crit = d.critical ?? (d.attack_roll && d.attack_roll.critical);
  const fumble = d.fumble ?? (d.attack_roll && d.attack_roll.fumble);
  // Choose effect type + floating text in a single place.
  let type, text;
  if (fumble)       { type = 'fumble'; text = 'FUMBLE'; }
  else if (!hit)    { type = 'miss';   text = 'MISS'; }
  else if (crit)    { type = 'crit';   text = dmg != null ? `-${dmg}` : 'CRIT!'; }
  else              { type = 'hit';    text = dmg != null ? `-${dmg}` : 'HIT'; }
  // Play on EVERY live player-side canvas (Main tab inline grid +
  // modal fullscreen if it happens to be open). `playFxOnCharacter`
  // is a no-op when the token isn't on that canvas, so it's safe to
  // broadcast to both unconditionally.
  _eachMapCanvas(c => c.playFxOnCharacter(targetId, type, {
    text, screenShake: crit,
  }));
}

// Stage 11: Combat action WS events
ws.on('combat.attack_result', d => {
  _playCombatFxFromPayload(d);
  showToast(`⚔️ ${d.attacker_name} → ${d.target_name}: ${d.critical ? 'CRITICAL!' : (d.hit ? 'HIT!' : (d.fumble ? 'FUMBLE' : 'MISS'))}`);
  if (d.target_killed && d.target_name) showToast(`💀 ${d.target_name} has been slain!`);
  loadCombatBanner();
});
// Step-1 broadcast from openAttackConfirm (hit/miss BEFORE damage).
// Only show MISS / FUMBLE here — a HIT will be followed by
// combat.attack_result, and we don't want to double-play a ring.
ws.on('combat.hit_result', d => {
  if (!d || d.hit) return;  // hit is handled by attack_result
  _playCombatFxFromPayload(d);
});
ws.on('combat.defend', d => {
  showToast(`🛡️ ${d.character_name} takes a defensive stance`);
  loadCombatBanner();
});
ws.on('combat.character_killed', d => {
  if (d.character_id == CHAR_ID) {
    showToast('💀 You have been slain!');
  }
});
// Dedicated ability-landing broadcast (fired by the ability-use flow
// below). Same payload shape as combat.attack_result, so we route it
// through the same FX helper.
ws.on('combat.ability_result', d => {
  _playCombatFxFromPayload(d);
});

// ══════════════════════════════════════════════════════════════
