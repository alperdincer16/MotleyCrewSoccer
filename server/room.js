/**
 * server/room.js — one game room: pre-match → playing → ended → (rematch).
 * Owner: Priya Natarajan (T-05, T-06 server side)
 *
 * Human players own slots; every slot without a human is a bot driven by
 * ai.js. Humans may claim a bot slot at any time, including mid-match.
 */
'use strict';

const MCS = require('../shared/rules');
const Match = require('./game/match');
const { BotBrain } = require('./game/ai');
const { S2C } = require('./protocol');

const TICK_DT = 1 / MCS.TICK_RATE;
const SNAP_EVERY = Math.round(MCS.TICK_RATE / MCS.SNAPSHOT_RATE);
const DISCONNECT_GRACE_MS = 15000;

let nextRoomId = 1;

function randomCode(n = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

class Room {
  constructor(lobby, host, { name, password, rules }) {
    this.lobby = lobby;
    this.id = 'r' + (nextRoomId++);
    this.name = String(name || `${host.name}'s game`).slice(0, 32);
    this.password = password ? String(password).slice(0, 64) : null;
    this.inviteCode = randomCode();
    this.rules = MCS.sanitizeRules(rules);
    this.hostId = host.id;
    this.status = 'prematch';           // prematch | playing | ended
    this.players = new Map();           // playerId -> { id, name, slot, ready, connected, client }
    this.slots = {};                    // slotId -> playerId | null
    for (const t of MCS.TEAMS) for (const p of MCS.POSITIONS) this.slots[MCS.slotId(t, p)] = null;
    this.match = null;
    this.brains = [];
    this.timer = null;
    this.tickCount = 0;
    this.lastResult = null;
    this.chatLog = [];
    this.createdAt = Date.now();
  }

  // ---- Membership --------------------------------------------------------
  get humanCount() { return [...this.players.values()].filter(p => p.connected).length; }
  get hostName() { const h = this.players.get(this.hostId); return h ? h.name : '?'; }

  addPlayer(client) {
    const existing = this.players.get(client.id);
    if (existing) {
      // Reconnect inside the grace window: restore the slot.
      existing.connected = true; existing.client = client; existing.name = client.name;
      clearTimeout(existing.graceTimer);
      if (existing.slot && this.match) this.match.setHuman(existing.slot, client.name);
    } else {
      this.players.set(client.id, { id: client.id, name: client.name, slot: null, ready: false, connected: true, client, joinedAt: Date.now() });
    }
    client.room = this;
    this.broadcastRoom();
    if (this.status === 'playing' && this.match) {
      client.send({ type: S2C.MATCH_START, rules: this.match.rules, roomId: this.id });
    } else if (this.status === 'ended' && this.lastResult) {
      client.send(Object.assign({ type: S2C.MATCH_END }, this.lastResult));
    }
    this.lobby.broadcastLobby();
  }

  /** Called on socket close. Keeps the seat for a short grace period while playing. */
  disconnectPlayer(client, immediate) {
    const p = this.players.get(client.id);
    if (!p) return;
    if (immediate || this.status !== 'playing') { this.removePlayer(client.id); return; }
    p.connected = false; p.client = null;
    if (p.slot && this.match) this.match.setBot(p.slot); // bot covers while they are away
    p.graceTimer = setTimeout(() => this.removePlayer(client.id), DISCONNECT_GRACE_MS);
    this.broadcastRoom();
  }

  removePlayer(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    clearTimeout(p.graceTimer);
    if (p.slot) { this.slots[p.slot] = null; if (this.match) this.match.setBot(p.slot); }
    this.players.delete(playerId);
    if (p.client) p.client.room = null;
    if (this.players.size === 0) { this.destroy(); return; }
    if (this.hostId === playerId) {
      // Host migrates to the longest-connected remaining human.
      const next = [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      this.hostId = next.id;
      this.systemChat(`${next.name} is now the host`);
    }
    this.broadcastRoom();
    this.lobby.broadcastLobby();
  }

  destroy() {
    this.stopLoop();
    for (const p of this.players.values()) clearTimeout(p.graceTimer);
    this.lobby.removeRoom(this);
  }

  isHost(client) { return client.id === this.hostId; }

  // ---- Pre-match actions -------------------------------------------------
  pickSlot(client, slotId) {
    const p = this.players.get(client.id);
    if (!p || !MCS.parseSlot(slotId)) return this.error(client, 'bad_slot', 'Unknown slot');
    if (this.slots[slotId] && this.slots[slotId] !== client.id) return this.error(client, 'slot_taken', 'That slot is taken');
    if (this.status === 'ended') return this.error(client, 'match_over', 'Wait for the rematch');
    if (p.slot) { this.slots[p.slot] = null; if (this.match) this.match.setBot(p.slot); }
    p.slot = slotId; this.slots[slotId] = client.id; p.ready = false;
    if (this.match) this.match.setHuman(slotId, p.name);
    this.broadcastRoom();
    this.lobby.broadcastLobby();
  }

  leaveSlot(client) {
    const p = this.players.get(client.id);
    if (!p || !p.slot) return;
    this.slots[p.slot] = null;
    if (this.match) this.match.setBot(p.slot);
    p.slot = null; p.ready = false;
    this.broadcastRoom();
    this.lobby.broadcastLobby();
  }

  setReady(client, ready) {
    const p = this.players.get(client.id);
    if (!p) return;
    p.ready = !!ready && !!p.slot;
    this.broadcastRoom();
  }

  updateRules(client, rules) {
    if (!this.isHost(client)) return this.error(client, 'not_host', 'Only the host can change rules');
    if (this.status === 'playing') return this.error(client, 'in_progress', 'Rules lock while a match is running');
    this.rules = MCS.sanitizeRules(rules, this.rules);
    this.broadcastRoom();
  }

  kickPlayer(client, playerId) {
    if (!this.isHost(client)) return this.error(client, 'not_host', 'Only the host can kick');
    if (playerId === client.id) return;
    const p = this.players.get(playerId);
    if (!p) return;
    if (p.client) { p.client.send({ type: S2C.ERROR, code: 'kicked', message: 'You were removed from the game by the host' }); }
    const c = p.client;
    this.removePlayer(playerId);
    if (c) c.send({ type: S2C.ROOM, room: null });
  }

  rename(client, name) {
    const p = this.players.get(client.id);
    if (!p) return;
    p.name = name;
    if (p.slot && this.match) this.match.setHuman(p.slot, name);
    this.broadcastRoom();
  }

  // ---- Match lifecycle --------------------------------------------------
  startGame(client) {
    if (!this.isHost(client)) return this.error(client, 'not_host', 'Only the host can start');
    if (this.status === 'playing') return;
    const roster = {};
    for (const [slot, pid] of Object.entries(this.slots)) {
      const p = pid ? this.players.get(pid) : null;
      roster[slot] = p ? { name: p.name, isBot: false } : { isBot: true };
    }
    this.match = new Match(this.rules, roster);
    this.brains = this.match.players.map(p => new BotBrain(p.id, p.pos === 'GK' ? 0.85 : 1)); // botSkill rule scales these at runtime
    this.status = 'playing';
    this.lastResult = null;
    for (const p of this.players.values()) p.ready = false;
    this.broadcast({ type: S2C.MATCH_START, rules: this.match.rules, roomId: this.id });
    this.broadcastRoom();
    this.lobby.broadcastLobby();
    this.startLoop();
  }

  rematch(client) {
    if (!this.isHost(client)) return this.error(client, 'not_host', 'Only the host can start a rematch');
    if (this.status !== 'ended') return;
    this.stopLoop();
    this.match = null;
    this.status = 'prematch';
    this.broadcastRoom();
    this.lobby.broadcastLobby();
  }

  handleInput(client, input) {
    const p = this.players.get(client.id);
    if (!p || !p.slot || !this.match) return;
    this.match.setInput(p.slot, input);
  }

  startLoop() {
    this.stopLoop();
    let last = process.hrtime.bigint();
    let acc = 0;
    this.timer = setInterval(() => {
      const now = process.hrtime.bigint();
      acc += Number(now - last) / 1e9;
      last = now;
      // Catch up at most 4 ticks per interval so a stalled event loop
      // doesn't produce a giant physics step.
      let steps = 0;
      while (acc >= TICK_DT && steps < 4) { this.tickOnce(); acc -= TICK_DT; steps++; }
      if (steps === 4) acc = 0;
    }, 1000 / MCS.TICK_RATE);
  }

  stopLoop() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  tickOnce() {
    const m = this.match;
    if (!m) return;
    for (const brain of this.brains) {
      const p = m.player(brain.slotId);
      if (p && p.isBot) m.setInput(p.id, brain.update(m, TICK_DT));
    }
    m.step(TICK_DT);
    this.tickCount++;
    if (this.tickCount % SNAP_EVERY === 0 || m.state === 'ended') {
      const snap = m.snapshot();
      snap.type = S2C.SNAPSHOT;
      this.broadcast(snap);
    }
    if (m.state === 'ended') this.finishMatch();
  }

  finishMatch() {
    this.stopLoop();
    this.status = 'ended';
    this.lastResult = { winner: this.match.winner, score: Object.assign({}, this.match.score), stats: this.match.stats(), suddenDeath: this.match.suddenDeath };
    this.broadcast(Object.assign({ type: S2C.MATCH_END }, this.lastResult));
    this.broadcastRoom();
    this.lobby.broadcastLobby();
  }

  // ---- Chat ------------------------------------------------------------
  chat(client, text) {
    const p = this.players.get(client.id);
    if (!p) return;
    const msg = { type: S2C.CHAT, from: p.name, playerId: p.id, text: String(text).slice(0, 200), team: p.slot ? MCS.parseSlot(p.slot).team : null, t: Date.now() };
    this.chatLog.push(msg); if (this.chatLog.length > 50) this.chatLog.shift();
    this.broadcast(msg);
  }
  systemChat(text) { this.broadcast({ type: S2C.CHAT, from: null, text, system: true, t: Date.now() }); }

  // ---- Serialisation -----------------------------------------------------
  /** Summary shown in the lobby list. */
  summary() {
    return {
      id: this.id, name: this.name, hostName: this.hostName, status: this.status,
      locked: !!this.password, humans: this.humanCount,
      slotsTaken: Object.values(this.slots).filter(Boolean).length,
      slotsTotal: MCS.TEAMS.length * MCS.TEAM_SIZE,
      matchSeconds: this.rules.matchSeconds, createdAt: this.createdAt,
      score: this.match ? this.match.score : null,
      timeLeft: this.match ? Math.round(this.match.time) : null,
    };
  }

  /** Full state sent to members. */
  state() {
    return {
      id: this.id, name: this.name, inviteCode: this.inviteCode, locked: !!this.password,
      hostId: this.hostId, status: this.status, rules: this.rules, slots: this.slots,
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, slot: p.slot, ready: p.ready, connected: p.connected })),
    };
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) if (p.client) p.client.sendRaw(data);
  }
  broadcastRoom() { this.broadcast({ type: S2C.ROOM, room: this.state() }); }
  error(client, code, message) { client.send({ type: S2C.ERROR, code, message }); }
}

module.exports = { Room, randomCode };
