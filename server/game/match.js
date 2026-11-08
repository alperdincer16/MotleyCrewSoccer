/**
 * server/game/match.js — authoritative match simulation.
 * Owner: Diego Ferreira (T-07 physics, T-08 rules engine, T-09 boosts)
 *
 * A Match owns six players (humans or bots), the ball, pickups, the clock,
 * and the score. It is pure game logic: no sockets, no timers. The Room
 * calls setInput() for humans, asks the AI for bot inputs, then step(dt).
 */
'use strict';

const MCS = require('../../shared/rules');
const { FIELD, PLAYER_RADIUS, BALL_RADIUS, TEAMS, POSITIONS, BOOSTS, FORMATION } = MCS;

const W = FIELD.width;
const H = FIELD.height;

// Tunables that are not player-facing rules (feel constants).
const FEEL = {
  playerAccel: 2600,       // units/s^2
  playerMaxSpeed: 270,     // units/s at playerSpeed 1.0
  playerDamping: 0.88,     // per 1/60 s when no input
  playerMoveDamping: 0.96, // per 1/60 s while pushing a direction
  kickSpeed: 640,          // ball speed from a kick at kickPower 1.0
  kickRange: 8,            // extra reach beyond touching
  kickCooldown: 0.28,
  dashImpulse: 560,
  dashCooldown: 2.2,
  dashDuration: 0.16,
  ballMaxSpeed: 1050,
  ballPlayerBounce: 0.55,
  playerPlayerBounce: 0.35,
  wallPlayerBounce: 0.25,
  postRadius: 9,
  pickupRadius: 17,
  centerCircle: 100,
  countdownSeconds: 3,
  magnetRange: 170,
  magnetForce: 900,
  kickoffTimeout: 6,       // seconds before a stalled kickoff opens play to all
  suddenDeathCap: 90,      // seconds of sudden death before the match is a draw
};

const EFFECT_FLAGS = { speed: 1, rocket: 2, frozen: 4, shrink: 8, magnet: 16, shield: 32 };

function len(x, y) { return Math.hypot(x, y); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function rnd(a, b) { return a + Math.random() * (b - a); }

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
          input: { up: false, down: false, left: false, right: false, kick: false, dash: false, aimX: null, aimY: null },
          kickCooldown: 0, dashCooldown: 0, dashTime: 0, kickFlash: 0,
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
    if (p) { p.isBot = true; p.name = `${p.team.toUpperCase()} ${p.pos} bot`; p.input = { up: false, down: false, left: false, right: false, kick: false, dash: false, aimX: null, aimY: null }; }
  }
  setInput(slotId, input) {
    const p = this.player(slotId);
    if (!p || !input) return;
    p.input.up = !!input.up; p.input.down = !!input.down;
    p.input.left = !!input.left; p.input.right = !!input.right;
    p.input.kick = !!input.kick; p.input.dash = !!input.dash;
    p.input.aimX = Number.isFinite(input.aimX) ? input.aimX : null;
    p.input.aimY = Number.isFinite(input.aimY) ? input.aimY : null;
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

  // ---- Main step -------------------------------------------------------------
  step(dt) {
    if (this.state === 'ended') return;
    this.tick++;

    // State machine ----------------------------------------------------------
    if (this.state === 'countdown') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) { this.state = 'kickoff'; this.kickoffTimer = 0; this.emit({ type: 'whistle' }); }
      this.decayEffects(dt);
      return; // nobody moves during the countdown
    }
    if (this.state === 'goal') {
      this.stateTimer -= dt;
      this.integrateBall(dt); // let the ball roll into the net for show
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

    // Kickoff: once the taker has had a fair chance, open play to everyone so
    // an idle human can never freeze the match.
    if (this.state === 'kickoff') {
      this.kickoffTimer += dt;
      if (this.kickoffTimer >= FEEL.kickoffTimeout) { this.state = 'play'; this.emit({ type: 'kickoffOpen' }); }
    }

    // Players ----------------------------------------------------------------
    for (const p of this.players) this.integratePlayer(p, dt);
    this.collidePlayers();
    for (const p of this.players) this.confinePlayer(p);

    // Ball -----------------------------------------------------------------
    this.applyMagnets(dt);
    this.integrateBall(dt);
    for (const p of this.players) this.collideBallPlayer(p);
    for (const p of this.players) this.tryKick(p);

    if (this.state === 'kickoff' && len(this.ball.vx, this.ball.vy) > 1) this.state = 'play';

    // Pickups ----------------------------------------------------------------
    this.updatePickups(dt);
    this.decayEffects(dt);

    // Goal detection ---------------------------------------------------------
    this.checkGoal();
  }

  // ---- Players -------------------------------------------------------------
  speedMul(p) {
    let m = this.rules.playerSpeed;
    if (p.effects.speed) m *= 1.6;
    if (p.effects.shrink) m *= 0.7;
    return m;
  }
  radiusOf(p) { return p.effects.shrink ? PLAYER_RADIUS * 0.6 : PLAYER_RADIUS; }

  integratePlayer(p, dt) {
    p.r = this.radiusOf(p);
    p.kickCooldown = Math.max(0, p.kickCooldown - dt);
    p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    p.dashTime = Math.max(0, p.dashTime - dt);
    p.kickFlash = Math.max(0, p.kickFlash - dt);

    const frozen = !!p.effects.frozen;
    let dx = 0, dy = 0;
    if (!frozen) {
      if (p.input.left) dx -= 1;
      if (p.input.right) dx += 1;
      if (p.input.up) dy -= 1;
      if (p.input.down) dy += 1;
    }
    const moving = dx !== 0 || dy !== 0;
    if (moving) {
      const l = len(dx, dy); dx /= l; dy /= l;
      const mul = this.speedMul(p);
      p.vx += dx * FEEL.playerAccel * mul * dt;
      p.vy += dy * FEEL.playerAccel * mul * dt;
    }

    // Dash: a burst of speed in the movement direction (or facing the ball).
    if (!frozen && this.rules.dashEnabled && p.input.dash && p.dashCooldown === 0) {
      let ddx = dx, ddy = dy;
      if (!moving) { ddx = this.ball.x - p.x; ddy = this.ball.y - p.y; const l = len(ddx, ddy) || 1; ddx /= l; ddy /= l; }
      p.vx += ddx * FEEL.dashImpulse;
      p.vy += ddy * FEEL.dashImpulse;
      p.dashCooldown = FEEL.dashCooldown;
      p.dashTime = FEEL.dashDuration;
      this.emit({ type: 'dash', slot: p.id, x: p.x, y: p.y });
    }

    // Damping and speed cap
    const damp = Math.pow(moving ? FEEL.playerMoveDamping : FEEL.playerDamping, dt * 60);
    p.vx *= damp; p.vy *= damp;
    if (frozen) { p.vx *= 0.8; p.vy *= 0.8; }
    const max = FEEL.playerMaxSpeed * this.speedMul(p) * (p.dashTime > 0 ? 3 : 1);
    const sp = len(p.vx, p.vy);
    if (sp > max) { p.vx = p.vx / sp * max; p.vy = p.vy / sp * max; }

    p.x += p.vx * dt;
    p.y += p.vy * dt;
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
        else if (aFixed && bFixed) { wa = 0.5; wb = 0.5; }
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

  confinePlayer(p) {
    const r = p.r;
    // Rounded-corner arena, players never enter the goal pockets.
    this.confineCircleToArena(p, r, FEEL.wallPlayerBounce, false);

    // Kickoff discipline: stay in own half; non-kicking team outside the circle.
    if (this.state === 'kickoff') {
      const dir = this.attackDir(p.team);
      if (dir > 0 && p.x > W / 2 - r) { p.x = W / 2 - r; if (p.vx > 0) p.vx = 0; }
      if (dir < 0 && p.x < W / 2 + r) { p.x = W / 2 + r; if (p.vx < 0) p.vx = 0; }
      if (p.team !== this.kickoffTeam) {
        const dx = p.x - W / 2, dy = p.y - H / 2, d = len(dx, dy);
        const minD = FEEL.centerCircle + r;
        if (d < minD) {
          const nx = d ? dx / d : -dir, ny = d ? dy / d : 0;
          p.x = W / 2 + nx * minD; p.y = H / 2 + ny * minD;
          const vn = p.vx * nx + p.vy * ny;
          if (vn < 0) { p.vx -= nx * vn; p.vy -= ny * vn; }
        }
      }
    }
    // Goalposts
    this.collidePosts(p, 0.3);
  }

  /** Confine a circle body to the arena. allowPockets lets it enter the goals. */
  confineCircleToArena(b, r, bounce, allowPockets) {
    const gh = this.goalHalfWidth();
    const inMouth = Math.abs(b.y - H / 2) < gh - r * 0.2;
    let hit = false;

    if (allowPockets && inMouth) {
      // Inside the goal pocket region: bounce off the back net and pocket sides.
      const back = FIELD.goalDepth;
      if (b.x < -back + r) { b.x = -back + r; if (b.vx < 0) { b.vx = -b.vx * bounce; hit = true; } }
      if (b.x > W + back - r) { b.x = W + back - r; if (b.vx > 0) { b.vx = -b.vx * bounce; hit = true; } }
      if (b.x < r || b.x > W - r) {
        if (b.y < H / 2 - gh + r) { b.y = H / 2 - gh + r; if (b.vy < 0) { b.vy = -b.vy * bounce; hit = true; } }
        if (b.y > H / 2 + gh - r) { b.y = H / 2 + gh - r; if (b.vy > 0) { b.vy = -b.vy * bounce; hit = true; } }
        return hit;
      }
    } else {
      if (b.x < r) { b.x = r; if (b.vx < 0) { b.vx = -b.vx * bounce; hit = true; } }
      if (b.x > W - r) { b.x = W - r; if (b.vx > 0) { b.vx = -b.vx * bounce; hit = true; } }
    }
    if (b.y < r) { b.y = r; if (b.vy < 0) { b.vy = -b.vy * bounce; hit = true; } }
    if (b.y > H - r) { b.y = H - r; if (b.vy > 0) { b.vy = -b.vy * bounce; hit = true; } }

    // Rounded corners
    const cr = FIELD.cornerRadius;
    const corners = [[cr, cr], [W - cr, cr], [cr, H - cr], [W - cr, H - cr]];
    for (const [cx, cy] of corners) {
      const inCornerBox = (cx < W / 2 ? b.x < cx : b.x > cx) && (cy < H / 2 ? b.y < cy : b.y > cy);
      if (!inCornerBox) continue;
      const dx = b.x - cx, dy = b.y - cy, d = len(dx, dy);
      const maxD = cr - r;
      if (d > maxD && d > 0) {
        const nx = dx / d, ny = dy / d;
        b.x = cx + nx * maxD; b.y = cy + ny * maxD;
        const vn = b.vx * nx + b.vy * ny;
        if (vn > 0) { b.vx -= (1 + bounce) * vn * nx; b.vy -= (1 + bounce) * vn * ny; hit = true; }
      }
    }
    return hit;
  }

  collidePosts(b, bounce) {
    const gh = this.goalHalfWidth();
    const posts = [[0, H / 2 - gh], [0, H / 2 + gh], [W, H / 2 - gh], [W, H / 2 + gh]];
    let hit = false;
    for (const [px, py] of posts) {
      const dx = b.x - px, dy = b.y - py, d = len(dx, dy);
      const minD = b.r + FEEL.postRadius;
      if (d < minD && d > 0) {
        const nx = dx / d, ny = dy / d;
        b.x = px + nx * minD; b.y = py + ny * minD;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= (1 + bounce) * vn * nx; b.vy -= (1 + bounce) * vn * ny; hit = true; }
      }
    }
    return hit;
  }

  // ---- Ball ------------------------------------------------------------------
  ballRadius() { return this.ball.effects.giant ? BALL_RADIUS * 2.2 : BALL_RADIUS; }

  integrateBall(dt) {
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
    const hitWall = this.confineCircleToArena(b, b.r, bounce, true);
    const hitPost = this.collidePosts(b, bounce);
    if ((hitWall || hitPost) && sp > 120) this.emit({ type: 'bounce', x: b.x, y: b.y, speed: sp, post: hitPost });
  }

  collideBallPlayer(p) {
    const b = this.ball;
    const dx = b.x - p.x, dy = b.y - p.y;
    const d = len(dx, dy);
    const minD = b.r + p.r;
    if (d >= minD || d === 0) return;
    const nx = dx / d, ny = dy / d;
    // Move the ball out (the player is far heavier); a giant ball nudges the player a bit.
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
    this.registerTouch(p, false);
  }

  tryKick(p) {
    if (!p.input.kick || p.kickCooldown > 0 || p.effects.frozen) return;
    const b = this.ball;
    const dx = b.x - p.x, dy = b.y - p.y;
    const d = len(dx, dy);
    if (d > b.r + p.r + FEEL.kickRange) return;
    let nx = dx / (d || 1), ny = dy / (d || 1);
    // Optional aim: humans can point with the mouse; the kick direction is
    // blended toward the aim point for a little extra control.
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
      this.lastTouch = { slot: p.id, team: p.team, tick: now };
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
      // bleed off sideways velocity so the ball actually arrives
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
      const pk = { id: this.nextPickupId++, type, x: rnd(W * 0.15, W * 0.85), y: rnd(H * 0.15, H * 0.85), ttl: 20 };
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
    // A defender's deflection within 2 s of an attacker's kick credits the attacker.
    if (this.lastTouch && this.lastTouch.team === conceded && this.lastKick && this.lastKick.team === scoring
        && this.tick - this.lastKick.tick < MCS.TICK_RATE * 2) {
      this.prevTouch = this.lastTouch; // keeps assists sane
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
    this.emit({
      type: 'goal', team: scoring, scorer: scorer ? scorer.id : null, scorerName: scorer ? scorer.name : null,
      assist: assist ? assist.id : null, ownGoal, score: Object.assign({}, this.score), x: b.x, y: b.y,
    });
    this.lastTouch = null; this.prevTouch = null; this.lastKick = null;
    this.kickoffTeam = conceded;

    const r = this.rules;
    const diff = Math.abs(this.score.red - this.score.blue);
    if (this.suddenDeath || (r.goalLimit > 0 && this.score[scoring] >= r.goalLimit) || (r.mercyLead > 0 && diff >= r.mercyLead)) {
      this.state = 'goal'; this.stateTimer = r.kickoffPause;
      this.endMatch();
      return;
    }
    this.state = 'goal';
    this.stateTimer = r.kickoffPause;
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
        fx: this.effectFlags(p), dash: p.dashCooldown > 0 ? Math.round(p.dashCooldown / FEEL.dashCooldown * 100) / 100 : 0,
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
