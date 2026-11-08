/**
 * public/js/net.js — WebSocket client with auto-reconnect and identity token.
 * Owner: Priya Natarajan (T-11)
 */
(function () {
  'use strict';

  class Net {
    constructor() {
      this.ws = null;
      this.handlers = {};
      this.connected = false;
      this.backoff = 500;
      this.name = localStorage.getItem('mcs.name') || '';
      this.token = localStorage.getItem('mcs.token') || null;
      this.id = null;
      this.pingMs = 0;
      this._pingTimer = null;
      this._queue = [];
    }

    on(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); return this; }
    emit(type, msg) { for (const fn of this.handlers[type] || []) fn(msg); }

    connect() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      ws.onopen = () => {
        this.connected = true; this.backoff = 500;
        this.sendRaw({ type: 'hello', name: this.name, token: this.token });
        this.emit('_open');
        clearInterval(this._pingTimer);
        this._pingTimer = setInterval(() => this.sendRaw({ type: 'ping', t: performance.now() }), 3000);
      };
      ws.onmessage = (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'welcome') {
          this.id = msg.id; this.name = msg.name; this.token = msg.token;
          localStorage.setItem('mcs.token', msg.token); localStorage.setItem('mcs.name', msg.name);
          while (this._queue.length) this.sendRaw(this._queue.shift());
        }
        if (msg.type === 'pong') { this.pingMs = Math.round(performance.now() - msg.t); return; }
        this.emit(msg.type, msg);
        this.emit('*', msg);
      };
      ws.onclose = () => {
        this.connected = false; this.id = null;
        clearInterval(this._pingTimer);
        this.emit('_close');
        setTimeout(() => this.connect(), this.backoff);
        this.backoff = Math.min(8000, this.backoff * 1.7);
      };
      ws.onerror = () => { /* onclose follows */ };
    }

    sendRaw(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }

    /** Send once we have an identity; queued until then. */
    send(type, payload) {
      const msg = Object.assign({ type }, payload || {});
      if (this.id) this.sendRaw(msg); else this._queue.push(msg);
    }

    setName(name) {
      this.name = name; localStorage.setItem('mcs.name', name);
      this.send('setName', { name });
    }
  }

  window.Net = Net;
})();
