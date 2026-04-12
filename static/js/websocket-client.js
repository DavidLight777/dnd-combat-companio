/**
 * WebSocket Client — shared across lobby, GM, and player pages.
 * Auto-reconnects with exponential backoff.
 */
class WsClient {
  constructor(sessionCode, token) {
    this.sessionCode = sessionCode;
    this.token = token;
    this.ws = null;
    this.listeners = {};
    this.reconnectAttempts = 0;
    this.maxReconnect = 10;
    this.connected = false;
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws/${this.sessionCode}?token=${this.token}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this._emit('_connected', {});
    };

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        this._emit(msg.event, msg.data, msg.timestamp);
      } catch (e) {
        console.warn('WS message parse error:', e);
      }
    };

    this.ws.onclose = (evt) => {
      this.connected = false;
      this._emit('_disconnected', { code: evt.code, reason: evt.reason });
      if (evt.code !== 4001 && evt.code !== 4003 && evt.code !== 4004) {
        this._reconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };
  }

  _reconnect() {
    if (this.reconnectAttempts >= this.maxReconnect) {
      this._emit('_reconnect_failed', {});
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    this._emit('_reconnecting', { attempt: this.reconnectAttempts, delay });
    setTimeout(() => this.connect(), delay);
  }

  send(event, data = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        event,
        data,
        sender_token: this.token,
        timestamp: new Date().toISOString(),
      }));
    }
  }

  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  off(event, callback) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  _emit(event, data, timestamp) {
    (this.listeners[event] || []).forEach(cb => cb(data, timestamp));
    (this.listeners['*'] || []).forEach(cb => cb(event, data, timestamp));
  }

  disconnect() {
    this.maxReconnect = 0; // prevent reconnect
    if (this.ws) this.ws.close();
  }
}
