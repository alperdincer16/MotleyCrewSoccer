/**
 * server/room.js — one game room: pre-match → playing → ended → (rematch).
 * Owner: Priya Natarajan (T-05, T-06 server side)
 *
 * Human players own slots; every slot without a human is a bot driven by
 * ai.js. Humans may claim a bot slot at any time, including mid-match.
 */
'use strict';

const MCS = require('../shared/rules');
const Teams = require('../shared/teams');
const Match = require('./game/match');
const { BotBrain } = require('./game/ai');
const { S2C } = require('./protocol');
const Progress = require('../shared/progress');
const { Tournament } = require('./tournament');

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
  constructor(lobby, host, { name, password, rules, sides, mode }) {
    this.lobby = lobby;
    this.id = 'r' + (nextRoomId++);
    this.name = String(name || `${host.name}'s game`).slice(0, 32);
    this.password = password ? String(password).slice(0, 64) : null;
    this.inviteCode = randomCode();
    this.rules = MCS.sanitizeRules(rules);
    this.sides = sides ? Teams.sanitizeSides(sides) : Teams.randomPair();
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
    this.mode = mode === 'tournament' ? 'tournament' : 'match';
    this.tournament = null;
  }

  // ---- Tournament ----------------------------------------------------------
  setMode(client, mode) {
    if (!this.isHost(client)) return this.error(client, 'not_host', 'Only the host can change the mode');
    if (this.status === 'playing') return this.error(client, 'in_progress', 'Wait for the match to finish');
    if (mode !== 'match' && mode !== 'tournament') return;
    if (this.tournament && !this.tournament.finished() && mode === 'match') this.systemChat('Tournament abandoned');
    this.mode = mode;
    this.tournament = null;
    this.broadcastRoom();
    this.lobby.broadcastLobby();
  }
  tournamentLocked() { return this.mode === 'tournament' && this.tournament && !this.tournament.finished(); }

  /** After the live fixture: record it, give bonus XP, simulate the rest of the round. */
  finishTournamentMatch() {
    const t = this.tournament, m = this.match;
    const roundName = t.roundName();
    const res = t.recordLive(m.score, m.winner);
    if (!res) return null;
    const home = Teams.get(t.home).name;
    const pens = res.pens ? ` (${res.pens[0]}–${res.pens[1]} on penalties)` : '';
    const bonus = { 'Quarter-final': ['Reached the semi-final', 40], 'Semi-final': ['Reached the final', 70], 'Final': ['Tournament champion', 150] }[roundName];
    this.xpExtra = (team) => (team === 'red' && res.won ? { tournament: { label: bonus[0], xp: bonus[1] }, trophy: roundName === 'Final' } : {});
    this.systemChat(res.won ? `${home} win the ${roundName.toLowerCase()}${pens}!` : `${home} are knocked out in the ${roundName.toLowerCase()}${pens}`);
    t.simulateRest(() => {
      if (t.finished()) this.systemChat(t.status === 'champion' ? `🏆 ${home} are champions!` : `🏆 ${Teams.get(t.champion).name} win the tournament`);
      else this.systemChat(`Next: ${home} vs ${Teams.get(t.nextSides().blue).name} in the ${t.roundName().toLowerCase()}`);
      if (t.nextSides()) this.sides = t.nextSides();
      this.broadcastRoom();
      this.lobby.broadcastLobby();
    });
    return { won: res.won, pens: res.pens, roundName };
  }

  // ---- Membership --------------------------------------------------------
  get humanCount() { return [...this.players.values()].filter(p => p.connected).length; }
  get hostName() { const h = this.players.get(this.hostId); return h ? h.name : '?'; }

  addPlayer(client) {
    const existing = this.players.get(client.id);
    if (existing) {
      // Reconnect inside the grace window: restore the slot.
      existing.connected = true; existing.client = client; existing.name = client.name; existing.look = client.look || null;
      clearTimeout(existing.graceTimer);
      if (existing.slot && this.match) this.match.setHuman(existing.slot, client.name, existing.look);
    } else {
      this.players.set(client.id, { id: client.id, name: client.name, slot: null, ready: false, connected: true, client, joinedAt: Date.now(), look: client.look || null, statBase: null });
    }
    client.room = this;
    this.broadcastRoom();
    if (this.status === 'playing' && this.match) {
      client.send({ type: S2C.MATCH_START, rules: this.match.rules, sides: this.sides, roomId: this.id });
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
    if (this.match) {
      this.match.setHuman(slotId, p.name, p.look);
      // Taking over mid-match: only what you do from now on counts for your XP.
      p.statBase = Object.assign({}, this.match.player(slotId).stats);
    }
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
    this.lobby.broadcastLobby();   // lobby cards show the rules (T-44)
  }

  setTeam(client, side, nation) {
    if (!this.isHost(client)) return this.error(client, 'not_host', 'Only the host can pick teams');
    if (this.status === 'playing') return this.error(client, 'in_progress', 'Teams lock while a match is running');
    if (!MCS.TEAMS.includes(side) || !Teams.get(nation)) return this.error(client, 'bad_team', 'Unknown team');
    if (this.tournamentLocked()) return this.error(client, 'tournament', 'The bracket decides the teams until the tournament ends');
    const other = MCS.otherTeam(side);
    if (this.sides[other] === nation) this.sides[other] = this.sides[side]; // swap instead of duplicating
    this.sides[side] = nation;
    this.broadcastRoom();
    this.lobby.broadcastLobby();
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
    if (p.slot && this.match) this.match.setHuman(p.slot, name, p.look);
    this.broadcastRoom();
  }

  /** The player changed cosmetics on their player card. */
  refreshLook(client) {
    const p = this.players.get(client.id);
    if (!p) return;
    p.look = client.look || null;
    if (p.slot && this.match) this.match.setHuman(p.slot, p.name, p.look);
    this.broadcastRoom();
  }

  // ---- Match lifecycle --------------------------------------------------
  startGame(client) {
    if (!this.isHost(client)) return this.error(client, 'not_host', 'Only the host can start');
    if (this.status === 'playing') return;
    if (this.tournament && this.tournament.simulating) return this.error(client, 'busy', 'The other fixtures are still being played');
    let rules = this.rules;
    if (this.mode === 'tournament') {
      if (!this.tournament || this.tournament.finished()) {
        this.tournament = new Tournament(this.sides, this.rules);
        this.systemChat(`🏆 Tournament started: ${this.tournament.nations.map(id => Teams.get(id).flag).join(' ')}`);
      }
      this.sides = this.tournament.nextSides();
      rules = Object.assign({}, this.rules, { suddenDeath: true });   // knockout: someone has to win
    }
    const roster = {};
    for (const [slot, pid] of Object.entries(this.slots)) {
      const p = pid ? this.players.get(pid) : null;
      roster[slot] = p ? { name: p.name, isBot: false, look: p.look } : { isBot: true };
    }
    this.match = new Match(rules, roster, this.sides);
    this.brains = this.match.players.map(p => new BotBrain(p.id, p.pos === 'GK' ? 0.85 : 1)); // botSkill rule scales these at runtime
    this.status = 'playing';
    this.lastResult = null;
    for (const p of this.players.values()) { p.ready = false; p.statBase = null; }
    this.broadcast({ type: S2C.MATCH_START, rules: this.match.rules, sides: this.sides, roomId: this.id });
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
    this.xpExtra = null;
    const tour = this.mode === 'tournament' && this.tournament ? this.finishTournamentMatch() : null;
    this.lastResult = { winner: this.match.winner, score: Object.assign({}, this.match.score), stats: this.match.stats(), suddenDeath: this.match.suddenDeath, sides: this.sides, tournament: tour };
    this.broadcast(Object.assign({ type: S2C.MATCH_END }, this.lastResult));
    this.awardXp(this.xpExtra);
    this.broadcastRoom();
    this.lobby.broadcastLobby();
  }

  /** XP and career stats for every human who finished the match in a slot. */
  awardXp(extraFor) {
    const m = this.match, stats = m.stats();
    const best = stats.reduce((a, s) => (!a || Progress.matchRating(s.stats) > Progress.matchRating(a.stats) ? s : a), null);
    for (const p of this.players.values()) {
      if (!p.slot || !p.client || !p.client.token || !this.lobby.profiles.has(p.client.token)) continue;
      const mine = stats.find(s => s.id === p.slot);
      if (!mine) continue;
      const delta = {};
      for (const [k, v] of Object.entries(mine.stats)) delta[k] = Math.max(0, v - ((p.statBase && p.statBase[k]) || 0));
      const team = MCS.parseSlot(p.slot).team;
      const result = m.winner === 'draw' ? 'draw' : m.winner === team ? 'win' : 'loss';
      const extra = Object.assign({ mvp: best && best.id === p.slot && Progress.matchRating(best.stats) > 0 }, extraFor ? extraFor(team) : {});
      const report = this.lobby.profiles.award(p.client.token, delta, result, extra);
      if (report) { p.client.send(Object.assign({ type: S2C.XP }, report)); if (p.client.sendProfile) p.client.sendProfile(); }
    }
  }

  // ---- Chat ------------------------------------------------------------
  chat(client, text) {
    const p = this.players.get(client.id);
    if (!p) return;
    const msg = { type: S2C.CHAT, from: p.name, playerId: p.id, text: String(text).slice(0, 200), team: p.slot ? MCS.parseSlot(p.slot).team : null, t: Date.now() };
    this.chatLog.push(msg); if (this.chatLog.length > 50) this.chatLog.shift();
    this.broadcast(msg);
  }
  /** Quick shout from a seated player, shown as a bubble over their head. */
  emote(client, id) {
    const p = this.players.get(client.id);
    if (!p || !p.slot || this.status !== 'playing' || !MCS.EMOTES.some(e => e.id === id)) return;
    const now = Date.now();
    if (now - (p.lastEmote || 0) < 600) return;
    p.lastEmote = now;
    this.broadcast({ type: S2C.EMOTE, slot: p.slot, id });
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
      matchSeconds: this.rules.matchSeconds, createdAt: this.createdAt, sides: this.sides,
      mode: this.mode, round: this.tournament ? this.tournament.roundName() : null, arena: this.rules.arena,
      rules: Object.assign({}, this.rules),
      score: this.match ? this.match.score : null,
      timeLeft: this.match ? Math.round(this.match.time) : null,
    };
  }

  /** Full state sent to members. */
  state() {
    return {
      id: this.id, name: this.name, inviteCode: this.inviteCode, locked: !!this.password,
      hostId: this.hostId, status: this.status, rules: this.rules, slots: this.slots, sides: this.sides,
      mode: this.mode, tournament: this.tournament ? this.tournament.view() : null,
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, slot: p.slot, ready: p.ready, connected: p.connected, look: p.look || null })),
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
