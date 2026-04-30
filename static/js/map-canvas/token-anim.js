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
    this._startTokenAnimLoop();
  };

  MapCanvas.prototype._startTokenAnimLoop = function() {
    if (this._tokenAnimRafId) return;
    const tick = () => {
      this.render();
      if (this._tokenAnims.size > 0) {
        this._tokenAnimRafId = requestAnimationFrame(tick);
      } else {
        this._tokenAnimRafId = null;
      }
    };
    this._tokenAnimRafId = requestAnimationFrame(tick);
  };

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

  // Phase 17 Round 4: toast when player tries to drag beyond movement budget.
  MapCanvas.prototype._showMovementError = function(msg) {
    const el = document.createElement('div');
    el.className = 'map-movement-error';
    el.textContent = msg;
    Object.assign(el.style, {
      position: 'absolute', bottom: '60px', left: '50%',
      transform: 'translateX(-50%)', background: 'rgba(200,50,50,0.9)',
      color: '#fff', padding: '6px 14px', borderRadius: '6px',
      pointerEvents: 'none', zIndex: '999', fontSize: '0.85rem',
    });
    const parent = this.canvas.parentElement;
    if (parent) {
      parent.style.position = 'relative';
      parent.appendChild(el);
      setTimeout(() => el.remove(), 2000);
    }
  };


})();
