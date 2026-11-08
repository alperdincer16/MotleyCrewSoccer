/**
 * server/game/match.js — authoritative match simulation.
 * Owner: Diego Ferreira (T-07 physics, T-08 rules engine, T-09 boosts, T-20 shared physics)
 *
 * A Match owns six players (humans or bots), the ball, pickups, the clock,
 * and the score. It is pure game logic: no sockets, no timers. The Room
 * calls setInput() for humans, asks the AI for bot inputs, then step(dt).
 * Player movement and arena collision live in shared/physics.js so the
 * client can predict its own player with identical code.
 */
'use strict';

const MCS = require('../../shared/rules');
const Physics = require('../../shared/physics');
const { FIELD, PLAYER_RADIUS, BALL_RADIUS, TEAMS, POSITIONS, BOOSTS, FORMATION } = MCS;
const { FEEL } = Physics;

const W = FIELD.width;
const H = FIELD.height;

const EFFECT_FLAGS = { speed: 1, rocket: 2, frozen: 4, shrink: 8, magnet: 16, shield: 32 };

function len(x, y) { return Math.hypot(x, y); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function rnd(a, b) { return a + Math.random() * (b - a); }
function blankInput() { return { up: false, down: false, left: false, right: false, kick: false, dash: false, aimX: null, aimY: null }; }

class Match {
  /**
   * @param {object} rules  sanitized rules (see shared/rules.js)
   * @param {object} roster map slotId -> { name, isBot }
   */
  constructor(rules, roster) {
    this.rules = MCS.sanitizeRules(rules);
    this.tick = 0;
    this.time = this.rules.matchSeconds;   // seconds remaining
    this.state = 'countdown';              // countdown | kickoff | play | goal | ended
    this.stateTimer = FEEL.countdownSeconds;
    this.kickoffTimer = 0;                 // seconds spent waiting for the kickoff touch
    this.score = { red: 0, blue: 0 };
    this.suddenDeath = false;
    this.kickoffTeam = Math.random() < 0.5 ? 'red' : 'blue';
    this.winner = null;
    this.events = [];
    this.pickups = [];
    this.nextPickupId = 1;
    this.pickupTimer = this.rules.pickupInterval * 0.6;
    this.lastTouch = null;   // { slot, team, tick }
    this.prevTouch = null;
    this.lastKick = null;

    this.ball = { x: W / 2, y: H / 2, vx: 0, vy: 0, r: BALL_RADIUS, effects: {} };

    this.players = [];
    for (const team of TEAMS) {
      for (const pos of POSITIONS) {
        const id = MCS.slotId(team, pos);
        const info = (roster && roster[id]) || {};
        this.players.push({
          id, team, pos,
          name: info.name || `${team.toUpperCase()} ${pos} bot`,
          isBot: info.isBot !== false,
          x: 0, y: 0, vx: 0, vy: 0, r: PLAYER_RADIUS,
          input: blankInput(),
          kickCooldown: 0, dashCooldown: 0, dashTime: 0, kickFlash: 0,
          kickBuffer: 0,      // seconds left in which a recent kick press still counts
          kickHeld: false,
          effects: {},
          stats: { goals: 0, ownGoals: 0, assists: 0, kicks: 0, touches: 0, pickups: 0, saves: 0 },
        });
      }
    }
    this.resetPositions();
  }

  // ---- Roster management ---------------------------------------------------
  player(slotId) { return this.players.find(p => p.id === slotId); }
  setHuman(slotId, name) { const p = this.player(slotId); if (p) { p.isBot = false; p.name = name; } }
  setBot(slotId) {
    const p = this.player(slotId);
    if (p) { p.isBot = true; p.name = `${p.team.toUpperCase()} ${p.pos} bot`; p.input = blankInput(); }
  }
  setInput(slotId, input) {
    const p = this.player(slotId);
    if (!p || !input) return;
    p.input.up = !!input.up; p.input.down = !!input.down;
    p.input.left = !!input.left; p.input.right = !!input.right;
    p.input.dash = !!input.dash;
    const kick = !!input.kick;
    if (kick && !p.kickHeld && !p.isBot) p.kickBuffer = FEEL.kickBuffer;   // humans: a press just before contact still counts
    p.kickHeld = kick;
    p.input.kick = kick;
    p.input.aimX = Number.isFinite(input.aimX) ? clamp(input.aimX, -FIELD.goalDepth, W + FIELD.goalDepth) : null;
    p.input.aimY = Number.isFinite(input.aimY) ? clamp(input.aimY, 0, H) : null;
  }

  // ---- Geometry helpers ----------------------------------------------------
  goalCenter(team) { return { x: team === 'red' ? 0 : W, y: H / 2 }; }
  attackDir(team) { return team === 'red' ? 1 : -1; }   // red attacks +x
  goalHalfWidth() { return this.rules.goalWidth / 2; }

  resetPositions() {
    for (const p of this.players) {
      const f = FORMATION[p.pos];
      const x = f.fx * W;
      p.x = p.team === 'red' ? x : W - x;
      p.y = p.team === 'red' ? f.fy * H : (1 - f.fy) * H;
      p.vx = 0; p.vy = 0; p.dashTime = 0;
    }
    this.ball.x = W / 2; this.ball.y = H / 2; this.ball.vx = 0; this.ball.vy = 0;
  }

  emit(ev) { this.events.push(ev); }

  effectState(p) { return { speed: !!p.effects.speed, shrink: !!p.effects.shrink, frozen: !!p.effects.frozen }; }

  // ---- Main step -------------------------------------------------------------
  step(dt) {
    if (this.state === 'ended') return;
    this.tick++;

    if (this.state === 'countdown') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) { this.state = 'kickoff'; this.kickoffTimer = 0; this.emit({ type: 'whistle' }); }
      this.decayEffects(dt);
      return; // nobody moves during the countdown
    }
    if (this.state === 'goal') {
      this.stateTimer -= dt;
      this.moveBall(dt); // let the ball roll into the net for show
      if (this.stateTimer <= 0) {
        this.resetPositions();
        this.ball.effects = {};
        this.state = 'kickoff';
        this.kickoffTimer = 0;
        this.emit({ type: 'whistle' });
      }
      return;
    }

    // Clock ----------------------------------------------------------------
    if (!this.suddenDeath) {
      this.time -= dt;
      if (this.time <= 0) {
        this.time = 0;
        if (this.score.red === this.score.blue && this.rules.suddenDeath) {
          this.suddenDeath = true;
          this.emit({ type: 'suddenDeath' });
        } else {
          this.endMatch();
          return;
        }
      }
    } else {
      this.time += dt; // count up in sudden death
      if (this.time >= FEEL.suddenDeathCap) { this.endMatch(); return; }
    }

    if (this.state === 'kickoff') {
      this.kickoffTimer += dt;
      if (this.kickoffTimer >= FEEL.kickoffTimeout) { this.state = 'play'; this.emit({ type: 'kickoffOpen' }); }
    }

    // Players ----------------------------------------------------------------
    for (const p of this.players) this.integratePlayer(p, dt);
    this.collidePlayers();
    for (const p of this.players) Physics.confinePlayer(p, p.team, this.state, this.kickoffTeam, this.goalHalfWidth());

    // Ball: sub-stepped so a fast shot can't pass through a post or a player.
    this.applyMagnets(dt);
    const speed = len(this.ball.vx, this.ball.vy);
    const steps = Math.max(1, Math.min(6, Math.ceil(speed * dt / (this.ball.r * 0.75))));
    for (let i = 0; i < steps; i++) {
      this.moveBall(dt / steps);
      for (const p of this.players) this.collideBallPlayer(p);
    }
    for (const p of this.players) this.tryKick(p, dt);

    if (this.state === 'kickoff' && len(this.ball.vx, this.ball.vy) > 1) this.state = 'play';

    this.updatePickups(dt);
    this.decayEffects(dt);
    this.checkGoal();
  }

  // ---- Players -------------------------------------------------------------
  speedMul(p) { return Physics.speedMul(this.rules, this.effectState(p)); }

  integratePlayer(p, dt) {
    p.kickCooldown = Math.max(0, p.kickCooldown - dt);
    p.kickFlash = Math.max(0, p.kickFlash - dt);
    p.kickBuffer = Math.max(0, p.kickBuffer - dt);
    const dashed = Physics.integratePlayer(p, p.input, this.rules, dt, this.effectState(p), this.ball);
    if (dashed) this.emit({ type: 'dash', slot: p.id, x: p.x, y: p.y });
  }

  collidePlayers() {
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i], b = ps[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = len(dx, dy);
        const minD = a.r + b.r;
        if (d === 0 || d >= minD) continue;
        const nx = dx / d, ny = dy / d;
        const overlap = minD - d;
        // Shield: a shielded player is immovable versus opponents.
        const aFixed = !!a.effects.shield && a.team !== b.team;
        const bFixed = !!b.effects.shield && b.team !== a.team;
        let wa = 0.5, wb = 0.5;
        if (aFixed && !bFixed) { wa = 0; wb = 1; }
        else if (bFixed && !aFixed) { wa = 1; wb = 0; }
        a.x -= nx * overlap * wa; a.y -= ny * overlap * wa;
        b.x += nx * overlap * wb; b.y += ny * overlap * wb;
        const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
        const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          const imp = -(1 + FEEL.playerPlayerBounce) * vn;
          a.vx -= nx * imp * wa; a.vy -= ny * imp * wa;
          b.vx += nx * imp * wb; b.vy += ny * imp * wb;
        }
      }
    }
  }

  // ---- Ball ------------------------------------------------------------------
  ballRadius() { return this.ball.effects.giant ? BALL_RADIUS * 2.2 : BALL_RADIUS; }

  /** Integrate the ball by dt and resolve wall/post contact. */
  moveBall(dt) {
    const b = this.ball;
    b.r = this.ballRadius();
    const drag = Math.pow(b.effects.giant ? Math.min(0.999, this.rules.ballDrag + 0.004) : this.rules.ballDrag, dt * 60);
    b.vx *= drag; b.vy *= drag;
    const sp = len(b.vx, b.vy);
    if (sp > FEEL.ballMaxSpeed) { b.vx = b.vx / sp * FEEL.ballMaxSpeed; b.vy = b.vy / sp * FEEL.ballMaxSpeed; }
    if (sp < 2) { b.vx = 0; b.vy = 0; }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const bounce = b.effects.giant ? Math.max(this.rules.ballBounce, 0.95) : this.rules.ballBounce;
    const hitWall = Physics.confineToArena(b, b.r, bounce, true, this.goalHalfWidth());
    const hitPost = Physics.collidePosts(b, bounce, this.goalHalfWidth());
    if ((hitWall || hitPost) && sp > 120) this.emit({ type: 'bounce', x: b.x, y: b.y, speed: sp, post: hitPost });
  }

  collideBallPlayer(p) {
    const b = this.ball;
    const dx = b.x - p.x, dy = b.y - p.y;
    const d = len(dx, dy);
    const minD = b.r + p.r;
    if (d >= minD || d === 0) return;
    const nx = dx / d, ny = dy / d;
    const overlap = minD - d;
    const ballShare = b.effects.giant ? 0.7 : 1;
    b.x += nx * overlap * ballShare; b.y += ny * overlap * ballShare;
    if (ballShare < 1) { p.x -= nx * overlap * (1 - ballShare); p.y -= ny * overlap * (1 - ballShare); }
    const rvx = b.vx - p.vx, rvy = b.vy - p.vy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      const imp = -(1 + FEEL.ballPlayerBounce) * vn;
      b.vx += nx * imp; b.vy += ny * imp;
    }
    // Dribble push: make sure the ball separates from a moving player.
    const pushN = p.vx * nx + p.vy * ny;
    const bn = b.vx * nx + b.vy * ny;
    if (bn < pushN + 40) { b.vx += nx * (pushN + 40 - bn); b.vy += ny * (pushN + 40 - bn); }
    // A dashing player that runs into the ball gives it a real whack.
    if (p.dashTime > 0 && !p.effects.frozen) {
      const extra = 180;
      b.vx += nx * extra; b.vy += ny * extra;
    }
    this.registerTouch(p, false);
  }

  tryKick(p, dt) {
    const wants = p.input.kick || p.kickBuffer > 0;
    if (!wants || p.kickCooldown > 0 || p.effects.frozen) return;
    const b = this.ball;
    const dx = b.x - p.x, dy = b.y - p.y;
    const d = len(dx, dy);
    if (d > b.r + p.r + FEEL.kickRange) return;
    let nx = dx / (d || 1), ny = dy / (d || 1);
    // Optional aim: the kick direction is blended toward the aim point.
    if (p.input.aimX !== null && p.input.aimY !== null) {
      let ax = p.input.aimX - b.x, ay = p.input.aimY - b.y;
      const al = len(ax, ay);
      if (al > 1) {
        ax /= al; ay /= al;
        const dot = ax * nx + ay * ny;
        if (dot > 0.2) { nx = nx * 0.45 + ax * 0.55; ny = ny * 0.45 + ay * 0.55; const l = len(nx, ny); nx /= l; ny /= l; }
      }
    }
    let power = FEEL.kickSpeed * this.rules.kickPower;
    let rocket = false;
    if (p.effects.rocket) { power *= 2.2; delete p.effects.rocket; rocket = true; }
    if (b.effects.giant) power *= 0.8;
    b.vx = nx * power + p.vx * 0.3;
    b.vy = ny * power + p.vy * 0.3;
    p.kickCooldown = FEEL.kickCooldown;
    p.kickBuffer = 0;
    p.kickFlash = 0.15;
    p.stats.kicks++;
    this.registerTouch(p, true);
    this.emit({ type: 'kick', slot: p.id, x: b.x, y: b.y, power: power / FEEL.kickSpeed, rocket });
  }

  registerTouch(p, isKick) {
    const now = this.tick;
    if (!this.lastTouch || this.lastTouch.slot !== p.id) {
      p.stats.touches++;
      this.prevTouch = this.lastTouch;
      this.lastTouch = { slot: p.id, team: p.team, tick: now, since: now };
    } else {
      this.lastTouch.tick = now;
    }
    if (isKick) {
      this.lastTouch.kick = true;
      this.lastKick = { slot: p.id, team: p.team, tick: now, prev: this.prevTouch };
    }
  }

  applyMagnets(dt) {
    const b = this.ball;
    for (const p of this.players) {
      if (!p.effects.magnet) continue;
      const dx = p.x - b.x, dy = p.y - b.y, d = len(dx, dy);
      if (d > FEEL.magnetRange || d < p.r + b.r + 2) continue;
      const f = FEEL.magnetForce * (1 - d / FEEL.magnetRange) + 200;
      b.vx += dx / d * f * dt; b.vy += dy / d * f * dt;
      b.vx *= 0.97; b.vy *= 0.97;
    }
  }

  // ---- Pickups & effects ---------------------------------------------------
  updatePickups(dt) {
    const r = this.rules;
    if (!r.boostsEnabled || r.enabledBoosts.length === 0) { this.pickups = []; return; }
    this.pickupTimer -= dt;
    if (this.pickupTimer <= 0 && this.pickups.length < r.maxPickups && this.state === 'play') {
      this.pickupTimer = r.pickupInterval;
      const type = r.enabledBoosts[Math.floor(Math.random() * r.enabledBoosts.length)];
      // Spawn away from the ball and from every player so nobody gets a freebie.
      let pk = null;
      for (let attempt = 0; attempt < 12; attempt++) {
        const cand = { x: rnd(W * 0.15, W * 0.85), y: rnd(H * 0.15, H * 0.85) };
        const tooClose = len(cand.x - this.ball.x, cand.y - this.ball.y) < 120 || this.players.some(p => len(p.x - cand.x, p.y - cand.y) < 90);
        if (!tooClose || attempt === 11) { pk = cand; break; }
      }
      pk = { id: this.nextPickupId++, type, x: pk.x, y: pk.y, ttl: 20 };
      this.pickups.push(pk);
      this.emit({ type: 'spawn', boost: type, x: pk.x, y: pk.y });
    }
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.ttl -= dt;
      if (pk.ttl <= 0) { this.pickups.splice(i, 1); continue; }
      for (const p of this.players) {
        if (len(p.x - pk.x, p.y - pk.y) < p.r + FEEL.pickupRadius) {
          this.pickups.splice(i, 1);
          this.applyBoost(p, pk.type);
          break;
        }
      }
    }
  }

  applyBoost(p, type) {
    const dur = BOOSTS[type].duration;
    p.stats.pickups++;
    switch (type) {
      case 'speed': p.effects.speed = dur; break;
      case 'rocket': p.effects.rocket = dur; break;
      case 'giant': this.ball.effects.giant = dur; break;
      case 'magnet': p.effects.magnet = dur; break;
      case 'freeze':
        for (const o of this.players) if (o.team !== p.team) o.effects.frozen = dur;
        break;
      case 'shrink':
        for (const o of this.players) if (o.team !== p.team) o.effects.shrink = dur;
        break;
      case 'shield':
        for (const o of this.players) if (o.team === p.team) o.effects.shield = dur;
        break;
    }
    this.emit({ type: 'pickup', boost: type, slot: p.id, team: p.team, x: p.x, y: p.y });
  }

  decayEffects(dt) {
    const decay = (obj) => {
      for (const k of Object.keys(obj)) {
        obj[k] -= dt;
        if (obj[k] <= 0) delete obj[k];
      }
    };
    for (const p of this.players) decay(p.effects);
    decay(this.ball.effects);
  }

  // ---- Scoring -------------------------------------------------------------
  checkGoal() {
    const b = this.ball;
    const gh = this.goalHalfWidth();
    if (Math.abs(b.y - H / 2) >= gh) return;
    let scoring = null;
    if (b.x < 0) scoring = 'blue';          // crossed red's goal line
    else if (b.x > W) scoring = 'red';
    if (!scoring) return;
    this.score[scoring]++;
    const conceded = MCS.otherTeam(scoring);

    let scorer = null, assist = null, ownGoal = false;
    // Deflections: a defender who only brushed the ball (contact started < 1 s
    // ago) right after an attacker touched it does not score an own goal; the
    // attacker is credited. A deliberate kick by the defender still counts.
    if (this.lastTouch && this.lastTouch.team === conceded && !this.lastTouch.kick
        && this.tick - this.lastTouch.since < MCS.TICK_RATE * 1.0
        && this.prevTouch && this.prevTouch.team === scoring
        && this.tick - this.prevTouch.tick < MCS.TICK_RATE * 2.5) {
      this.lastTouch = { slot: this.prevTouch.slot, team: scoring, tick: this.tick, kick: true };
      this.prevTouch = null;
    } else if (this.lastTouch && this.lastTouch.team === conceded && this.lastKick && this.lastKick.team === scoring
        && this.tick - this.lastKick.tick < MCS.TICK_RATE * 2) {
      this.lastTouch = { slot: this.lastKick.slot, team: scoring, tick: this.tick, kick: true };
      this.prevTouch = this.lastKick.prev || null;
    }
    if (this.lastTouch) {
      const lp = this.player(this.lastTouch.slot);
      if (lp.team === scoring) {
        scorer = lp; lp.stats.goals++;
        if (this.prevTouch && this.prevTouch.team === scoring && this.prevTouch.slot !== lp.id) {
          assist = this.player(this.prevTouch.slot); assist.stats.assists++;
        }
      } else { scorer = lp; lp.stats.ownGoals++; ownGoal = true; }
    }
    const shotSpeed = len(b.vx, b.vy);
    this.emit({
      type: 'goal', team: scoring, scorer: scorer ? scorer.id : null, scorerName: scorer ? scorer.name : null,
      assist: assist ? assist.id : null, ownGoal, score: Object.assign({}, this.score), x: b.x, y: b.y,
      speed: Math.round(shotSpeed), clock: Math.round(this.time), sd: this.suddenDeath,
    });
    this.lastTouch = null; this.prevTouch = null; this.lastKick = null;
    this.kickoffTeam = conceded;

    const r = this.rules;
    const diff = Math.abs(this.score.red - this.score.blue);
    this.state = 'goal';
    this.stateTimer = r.kickoffPause;
    if (this.suddenDeath || (r.goalLimit > 0 && this.score[scoring] >= r.goalLimit) || (r.mercyLead > 0 && diff >= r.mercyLead)) {
      this.endMatch();
    }
  }

  endMatch() {
    this.state = 'ended';
    this.winner = this.score.red > this.score.blue ? 'red' : this.score.blue > this.score.red ? 'blue' : 'draw';
    this.emit({ type: 'end', winner: this.winner, score: Object.assign({}, this.score) });
  }

  // ---- Snapshot ------------------------------------------------------------
  effectFlags(p) {
    let f = 0;
    for (const k of Object.keys(p.effects)) f |= EFFECT_FLAGS[k] || 0;
    return f;
  }

  snapshot() {
    const snap = {
      t: this.tick,
      time: Math.round(this.time * 10) / 10,
      state: this.state,
      sd: this.suddenDeath,
      score: this.score,
      ko: this.kickoffTeam,
      cd: this.state === 'countdown' ? Math.ceil(this.stateTimer) : 0,
      players: this.players.map(p => ({
        id: p.id, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10,
        vx: Math.round(p.vx), vy: Math.round(p.vy), r: p.r,
        fx: this.effectFlags(p),
        dash: p.dashCooldown > 0 ? Math.round(p.dashCooldown / FEEL.dashCooldown * 100) / 100 : 0,
        dc: Math.round(p.dashCooldown * 100) / 100, dtm: Math.round(p.dashTime * 1000) / 1000,
        kf: p.kickFlash > 0 ? 1 : 0, bot: p.isBot ? 1 : 0, name: p.name,
      })),
      ball: { x: Math.round(this.ball.x * 10) / 10, y: Math.round(this.ball.y * 10) / 10, vx: Math.round(this.ball.vx), vy: Math.round(this.ball.vy), r: this.ball.r, giant: this.ball.effects.giant ? 1 : 0 },
      pickups: this.pickups.map(pk => ({ id: pk.id, x: Math.round(pk.x), y: Math.round(pk.y), type: pk.type, ttl: Math.round(pk.ttl) })),
      events: this.events,
    };
    this.events = [];
    return snap;
  }

  stats() {
    return this.players.map(p => ({ id: p.id, name: p.name, team: p.team, pos: p.pos, bot: p.isBot, stats: p.stats }));
  }
}

Match.FEEL = FEEL;
Match.EFFECT_FLAGS = EFFECT_FLAGS;
module.exports = Match;
