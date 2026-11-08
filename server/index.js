/**
 * server/index.js — HTTP static file server + WebSocket game server.
 * Owner: Priya Natarajan (T-03)
 *
 *   npm start            → http://localhost:3000
 *   PORT=8080 npm start  → custom port
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const { Lobby } = require('./lobby');
const { C2S, S2C } = require('./protocol');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'shared');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  let base = PUBLIC_DIR;
  if (urlPath.startsWith('/shared/')) { base = SHARED_DIR; urlPath = urlPath.slice('/shared'.length); }
  const file = path.normalize(path.join(base, urlPath));
  if (!file.startsWith(base)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA fallback: any unknown path serves the app so invite links work.
      if (!path.extname(urlPath)) return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) { res.writeHead(500); return res.end('index missing'); }
        res.writeHead(200, { 'Content-Type': MIME['.html'] }); res.end(html);
      });
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// ---- Client wrapper ---------------------------------------------------------
let nextClientNum = 1;
const tokens = new Map(); // token -> { id, name }

class Client {
  constructor(ws, lobby) {
    this.ws = ws; this.lobby = lobby;
    this.id = null; this.name = null; this.token = null; this.room = null;
    this.alive = true;
    // Token buckets: inputs stream at up to 30/s legitimately; other
    // messages are rare. Over-budget messages are dropped silently.
    this.bucket = { input: 60, other: 20, at: Date.now() };
  }

  /** Returns true if the message is within the client's rate budget. */
  allow(kind) {
    const b = this.bucket, now = Date.now(), dt = (now - b.at) / 1000;
    b.at = now;
    b.input = Math.min(60, b.input + dt * 90);
    b.other = Math.min(20, b.other + dt * 10);
    if (b[kind] < 1) return false;
    b[kind] -= 1;
    return true;
  }
  send(obj) { this.sendRaw(JSON.stringify(obj)); }
  sendRaw(data) { if (this.ws.readyState === 1) this.ws.send(data); }
  error(code, message) { this.send({ type: S2C.ERROR, code, message }); }

  handle(msg) {
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === C2S.HELLO) return this.hello(msg);
    if (!this.id) return this.error('no_hello', 'Say hello first');
    if (!this.allow(msg.type === C2S.INPUT || msg.type === C2S.PING ? 'input' : 'other')) return;
    const room = this.room;
    switch (msg.type) {
      case C2S.PING: return this.send({ type: S2C.PONG, t: msg.t });
      case C2S.SET_NAME: {
        this.name = cleanName(msg.name, this.name);
        tokens.set(this.token, { id: this.id, name: this.name });
        this.send({ type: S2C.WELCOME, id: this.id, name: this.name, token: this.token });
        if (room) room.rename(this, this.name);
        return;
      }
      case C2S.LIST: return this.send({ type: S2C.LOBBY, games: this.lobby.list() });
      case C2S.CREATE: return void this.lobby.createRoom(this, { name: msg.name, password: msg.password, rules: msg.rules });
      case C2S.JOIN: return this.lobby.joinRoom(this, { roomId: msg.roomId, password: msg.password, invite: msg.invite });
      case C2S.LEAVE: if (room) { room.disconnectPlayer(this, true); this.send({ type: S2C.ROOM, room: null }); } return;
      case C2S.PICK_SLOT: return room && room.pickSlot(this, msg.slot);
      case C2S.LEAVE_SLOT: return room && room.leaveSlot(this);
      case C2S.READY: return room && room.setReady(this, msg.ready);
      case C2S.RULES: return room && room.updateRules(this, msg.rules);
      case C2S.KICK: return room && room.kickPlayer(this, msg.playerId);
      case C2S.START: return room && room.startGame(this);
      case C2S.REMATCH: return room && room.rematch(this);
      case C2S.INPUT: return room && room.handleInput(this, msg);
      case C2S.CHAT: return room && typeof msg.text === 'string' && msg.text.trim() && room.chat(this, msg.text.trim());
      default: return this.error('unknown', `Unknown message ${msg.type}`);
    }
  }

  hello(msg) {
    const known = msg.token && tokens.get(String(msg.token));
    if (known) { this.id = known.id; this.token = String(msg.token); }
    else { this.id = 'p' + (nextClientNum++) + crypto.randomBytes(2).toString('hex'); this.token = crypto.randomBytes(12).toString('hex'); }
    this.name = cleanName(msg.name, known ? known.name : null) || `Player ${nextClientNum}`;
    tokens.set(this.token, { id: this.id, name: this.name });
    this.send({ type: S2C.WELCOME, id: this.id, name: this.name, token: this.token });
    this.lobby.addClient(this);
    // Reconnect into a room we were still a member of (grace window).
    for (const room of this.lobby.rooms.values()) {
      if (room.players.has(this.id)) { room.addPlayer(this); break; }
    }
  }
}

function cleanName(name, fallback) {
  if (typeof name !== 'string') return fallback;
  const n = name.replace(/[^\p{L}\p{N} _\-.!?]/gu, '').trim().slice(0, 16);
  return n || fallback;
}

// ---- Boot ---------------------------------------------------------------------
function createServer() {
  const lobby = new Lobby();
  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });

  wss.on('connection', (ws) => {
    const client = new Client(ws, lobby);
    ws.on('pong', () => { client.alive = true; });
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return client.error('bad_json', 'Malformed message'); }
      try { client.handle(msg); } catch (err) { console.error('handler error', err); client.error('server_error', 'Something went wrong'); }
    });
    ws.on('close', () => { lobby.removeClient(client); });
    ws.on('error', () => { /* close follows */ });
  });

  // Heartbeat: drop sockets that stop answering pings.
  const hb = setInterval(() => {
    for (const ws of wss.clients) {
      const c = ws._client;
      if (ws.isAlive === false) { ws.terminate(); continue; }
      ws.isAlive = false; ws.ping();
    }
  }, 15000);
  wss.on('connection', (ws) => { ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; }); });
  wss.on('close', () => clearInterval(hb));

  return { server, wss, lobby };
}

if (require.main === module) {
  const { server } = createServer();
  server.listen(PORT, () => console.log(`Motley Crew Soccer listening on http://localhost:${PORT}`));
}

module.exports = { createServer, cleanName };
