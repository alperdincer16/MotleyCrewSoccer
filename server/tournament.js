/**
 * server/tournament.js — 8-nation knockout for a room.
 * Owner: Priya Natarajan (T-32 server) with Mei Lin (simulated fixtures)
 *
 * The room's home nation (red side) is "your" team. Each round its fixture
 * is played live by the room (humans in their slots, bots elsewhere); the
 * other fixtures of the round are simulated bot-vs-bot with the real match
 * engine, a little at a time so the server's event loop stays responsive.
 * Draws after sudden death are settled by a penalty shoot-out.
 */
'use strict';

const MCS = require('../shared/rules');
const Teams = require('../shared/teams');
const Match = require('./game/match');
const { BotBrain } = require('./game/ai');

const ROUND_NAMES = ['Quarter-final', 'Semi-final', 'Final'];
const SIM_DT = 1 / 60;

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/** A penalty shoot-out: best of five, then sudden death. Returns [a, b]. */
function shootout() {
  let a = 0, b = 0;
  for (let i = 0; i < 5; i++) { if (Math.random() < 0.75) a++; if (Math.random() < 0.75) b++; }
  while (a === b) { const x = Math.random() < 0.75, y = Math.random() < 0.75; a += x; b += y; }
  return [a, b];
}

class Tournament {
  /** sides: the room's current { red, blue }: red is your nation, blue your first opponent. */
  constructor(sides, rules) {
    const home = sides.red, first = sides.blue;
    const others = shuffle(Teams.IDS.filter(id => id !== home && id !== first)).slice(0, 6);
    this.home = home;
    this.nations = [home, first, ...others];
    this.rules = MCS.sanitizeRules(Object.assign({}, rules, { suddenDeath: true }));
    this.rounds = [[], [], []];
    for (let i = 0; i < 8; i += 2) this.rounds[0].push(this.fixture(this.nations[i], this.nations[i + 1]));
    this.round = 0;
    this.status = 'running';     // running | simulating | out | champion | done
    this.champion = null;
    this.simulating = false;
  }

  fixture(a, b) { return { a, b, score: null, winner: null, pens: null }; }
  roundName(r = this.round) { return ROUND_NAMES[r] || 'Done'; }
  homeAlive() { return this.status === 'running' || this.status === 'simulating'; }

  /** The fixture the room plays live this round, or null. */
  liveFixture() {
    if (!this.homeAlive()) return null;
    return this.rounds[this.round].find(f => !f.winner && (f.a === this.home || f.b === this.home)) || null;
  }
  /** Sides for the next live match: your nation in red. */
  nextSides() {
    const f = this.liveFixture();
    return f ? { red: this.home, blue: f.a === this.home ? f.b : f.a } : null;
  }

  /** Record the live result; returns { won, pens }. */
  recordLive(score, winner) {
    const f = this.liveFixture();
    if (!f) return null;
    const homeIsA = f.a === this.home;
    const goalsHome = score.red, goalsAway = score.blue;
    f.score = homeIsA ? [goalsHome, goalsAway] : [goalsAway, goalsHome];
    if (winner === 'draw') {
      f.pens = shootout();
      f.winner = f.pens[0] > f.pens[1] ? f.a : f.b;
    } else {
      const winNation = winner === 'red' ? this.home : (homeIsA ? f.b : f.a);
      f.winner = winNation;
    }
    return { won: f.winner === this.home, pens: f.pens };
  }

  /** Simulate a single fixture with the real engine (bots only). */
  static *simulate(a, b, rules) {
    const m = new Match(Object.assign({}, rules, { suddenDeath: true }), {}, { red: a, blue: b });
    m.state = 'kickoff';
    const brains = m.players.map(p => new BotBrain(p.id, p.pos === 'GK' ? 0.85 : 1));
    let steps = 0;
    while (m.state !== 'ended' && steps < 60 * 60 * 15) {
      for (const br of brains) m.setInput(br.slotId, br.update(m, SIM_DT));
      m.step(SIM_DT);
      m.events.length = 0;
      if (++steps % 400 === 0) yield;
    }
    return { score: [m.score.red, m.score.blue], winner: m.winner };
  }

  /**
   * Simulate every unfinished fixture of the current round (and, if your
   * nation is out, every remaining round), cooperatively. Calls done() at the end.
   */
  simulateRest(done) {
    if (this.simulating) return;
    this.simulating = true;
    const self = this;
    const job = (function* () {
      for (;;) {
        for (const f of self.rounds[self.round]) {
          if (f.winner) continue;
          const r = yield* Tournament.simulate(f.a, f.b, self.rules);
          f.score = r.score;
          if (r.winner === 'draw') { f.pens = shootout(); f.winner = f.pens[0] > f.pens[1] ? f.a : f.b; }
          else f.winner = r.winner === 'red' ? f.a : f.b;
        }
        self.advance();
        if (self.round >= ROUND_NAMES.length || self.homeAlive()) return;
      }
    })();
    const pump = () => {
      const t0 = Date.now();
      let r;
      do { r = job.next(); } while (!r.done && Date.now() - t0 < 12);
      if (r.done) { this.simulating = false; done(); } else setImmediate(pump);
    };
    setImmediate(pump);
  }

  /** Close the round: pair up winners, or crown the champion. */
  advance() {
    const winners = this.rounds[this.round].map(f => f.winner);
    if (this.status === 'running' && !winners.includes(this.home)) this.status = 'out';
    if (this.round === ROUND_NAMES.length - 1) {
      this.champion = winners[0];
      this.round++;
      this.status = this.champion === this.home ? 'champion' : this.status === 'out' ? 'out' : 'done';
      return;
    }
    this.round++;
    for (let i = 0; i < winners.length; i += 2) this.rounds[this.round].push(this.fixture(winners[i], winners[i + 1]));
  }

  finished() { return this.round >= ROUND_NAMES.length; }

  view() {
    return {
      home: this.home, round: this.round, roundName: this.roundName(), status: this.status, champion: this.champion,
      simulating: this.simulating, rounds: this.rounds, names: ROUND_NAMES,
    };
  }
}

Tournament.ROUND_NAMES = ROUND_NAMES;
Tournament.shootout = shootout;
module.exports = { Tournament };
