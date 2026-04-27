// ════════════════════════════════════════════════════════
// Modal dismiss helper + trade modal
// Source: player-app.js lines 2044-2188
// ════════════════════════════════════════════════════════

// FIX 7 — UNIVERSAL MODAL DISMISS HELPER
// ══════════════════════════════════════════════════════════════
/**
 * Make any modal overlay dismissible via ✕ button, outside click, or Escape.
 * @param {HTMLElement} modalEl - The overlay root element
 * @param {function} onDismiss - Callback (reason: 'btn'|'outside'|'escape')
 */
function makeModalDismissible(modalEl, onDismiss = null) {
  if (!modalEl) return;
  function close(reason) {
    if (modalEl.parentNode) modalEl.parentNode.removeChild(modalEl);
    document.removeEventListener('keydown', escHandler);
    if (typeof onDismiss === 'function') {
      try { onDismiss(reason); } catch (e) { console.warn('modal onDismiss:', e); }
    }
  }
  // ✕ close button
  const closeBtn = modalEl.querySelector('.modal-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', () => close('btn'));
  // Outside click (only if target is the overlay itself)
  modalEl.addEventListener('click', e => {
    if (e.target === modalEl) close('outside');
  });
  // Escape key
  function escHandler(e) {
    if (e.key === 'Escape') close('escape');
  }
  document.addEventListener('keydown', escHandler);
  // Expose close function so external code can dismiss cleanly
  modalEl._dismiss = close;
  return close;
}
window.makeModalDismissible = makeModalDismissible;

// ══════════════════════════════════════════════════════════════
// TRADE MODAL (opened via WS event from GM)
// ══════════════════════════════════════════════════════════════
let activeTradeOverlay = null;

function openTradeModal(tradeId, npcId, npcName) {
  if (activeTradeOverlay) activeTradeOverlay.remove();

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay trade-modal';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div class="modal-content" style="background:var(--bg-surface);border:1px solid var(--border);border-radius:var(--r-lg);width:90%;max-width:550px;max-height:85vh;display:flex;flex-direction:column;overflow:hidden">
      <div class="modal-header" style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border);background:var(--bg-surface-2);gap:12px">
        <h3 class="modal-title" style="flex:1;font-size:0.95rem;margin:0">🤝 Trading with ${npcName}</h3>
        <span id="trade-balance" style="font-size:0.8rem;color:var(--accent)"></span>
        <button class="modal-close-btn btn btn-ghost btn-xs" title="Close (Esc) — trade ends">✕</button>
      </div>
      <div id="trade-shop-list" style="padding:12px;overflow-y:auto;flex:1;font-size:0.82rem"></div>
      <div id="trade-result" style="padding:8px 16px;font-size:0.8rem"></div>
      <div style="padding:6px 16px;font-size:0.68rem;color:var(--text-muted);text-align:center;border-top:1px solid var(--border)">
        You can ask the GM to reopen this trade
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  activeTradeOverlay = overlay;

  // FIX 7: Dismissible — on dismiss, close trade + broadcast to GM
  makeModalDismissible(overlay, async (reason) => {
    activeTradeOverlay = null;
    // Tell server to close the trade session
    try {
      await api.post(`/api/trade/${tradeId}/close`, {});
    } catch {}
    // Notify GM via WS so they see dismissal in log
    if (ws && ws.ws && ws.ws.readyState === WebSocket.OPEN) {
      ws.ws.send(JSON.stringify({
        type: 'trade.dismissed',
        trade_id: tradeId,
        player_id: CHAR_ID,
        player_name: char?.name || 'Player',
        npc_id: npcId,
        npc_name: npcName,
        reason,
      }));
    }
    showToast('Trade ended');
  });

  async function loadTradeShop() {
    try {
      const cur = await api.get(`/api/characters/${CHAR_ID}/currency`);
      const d = cur.currency;
      const bal = [d.platinum && d.platinum+'P', d.gold && d.gold+'G', d.silver && d.silver+'S', (d.bronze||d.copper)+'B'].filter(Boolean).join(' ');
      overlay.querySelector('#trade-balance').textContent = `💰 ${bal}`;

      const shop = await api.get(`/api/npc/${npcId}/shop?player_id=${CHAR_ID}`);
      const el = overlay.querySelector('#trade-shop-list');
      if (!shop.items.length) { el.innerHTML = '<span class="text-muted">This merchant has nothing for sale.</span>'; return; }

      el.innerHTML = shop.items.map(si => {
        const fp = si.final_price;
        const priceStr = [fp.platinum && fp.platinum+'P', fp.gold && fp.gold+'G', fp.silver && fp.silver+'S', (fp.bronze||fp.copper) && (fp.bronze||fp.copper)+'B'].filter(Boolean).join(' ') || (si.final_price_bronze||si.final_price_copper)+'b';
        const stockStr = si.stock === null ? '' : `(${si.stock} left)`;
        const canBuy = si.stock === null || si.stock > 0;
        return `<div style="display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1">
            <div class="rarity-${si.rarity}" style="font-weight:600">${si.name}</div>
            <div style="font-size:0.7rem;color:var(--text-muted)">${si.description || ''}</div>
          </div>
          <span style="font-size:0.75rem;font-weight:600">${priceStr}</span>
          <span style="font-size:0.65rem;color:var(--text-muted)">${stockStr}</span>
          ${canBuy ? `<button class="btn btn-primary btn-xs" data-trade-buy="${si.shop_item_id}">Buy</button>` : '<span style="color:var(--accent-red);font-size:0.7rem">SOLD</span>'}
        </div>`;
      }).join('');

      el.querySelectorAll('[data-trade-buy]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const sid = parseInt(btn.dataset.tradeBuy);
          try {
            const res = await api.post(`/api/trade/${tradeId}/buy`, { shop_item_id: sid, quantity: 1 });
            overlay.querySelector('#trade-result').innerHTML = `<span style="color:var(--accent-green)">Bought ${res.item_name} for ${res.total_cost_bronze||res.total_cost_copper}b!</span>`;
            loadCurrency();
            loadInventory();
            loadTradeShop();
            addLog(`[Trade] Bought ${res.item_name}`);
          } catch (e) {
            let msg = 'Purchase failed';
            try { const err = JSON.parse(e.message); msg = err.detail?.message || err.detail || msg; } catch {}
            overlay.querySelector('#trade-result').innerHTML = `<span style="color:var(--accent-red)">${msg}</span>`;
          }
        });
      });
    } catch (e) {
      overlay.querySelector('#trade-shop-list').innerHTML = '<span class="text-muted">Error loading shop.</span>';
    }
  }

  loadTradeShop();
}

function closeTradeModal() {
  if (activeTradeOverlay) {
    activeTradeOverlay.remove();
    activeTradeOverlay = null;
    showToast('Trade ended');
  }
}

// ══════════════════════════════════════════════════════════════
