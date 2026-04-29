(function () {
  MapCanvas.prototype.animateTokenTo = function(charId, x, y) {
    const t = (this.tokens || []).find(tok => tok.character_id === charId);
    if (!t) return;
    this._tokenAnims.set(charId, {
      prevX: t.x ?? x,
      prevY: t.y ?? y,
      targetX: x,
      targetY: y,
      startTime: performance.now(),
    });
  }

  // Convenience: find the token for a character_id and play FX there.

  MapCanvas.prototype.playFxOnCharacter = function(charId, type, opts = {}) {
    if (charId == null) return;
    const t = (this.tokens || []).find(tk => tk.character_id === charId);
    if (!t || t.x == null || t.y == null) return;
    this.playFx(type, t.x, t.y, opts);
  }


  MapCanvas.prototype._triggerScreenShake = function(intensity) {
    // Prefer the closest positioned ancestor of the canvas so the
    // shake doesn't move the whole page (which is jarring when the
    // sidebar/character sheet is also visible). Falls back to <body>.
    const host = this.canvas.closest('.battle-panel')
              || this.canvas.closest('.panel')
              || document.body;
    const cls = intensity === 'hard' ? 'fx-shake-hard' : 'fx-shake-soft';
    host.classList.remove('fx-shake-soft', 'fx-shake-hard');
    // Force reflow so the animation restarts if a previous one is
    // still running (reapplying the same class is a no-op otherwise).
    void host.offsetWidth;
    host.classList.add(cls);
    setTimeout(() => host.classList.remove(cls),
               intensity === 'hard' ? 520 : 320);
  }


})();
