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
const Teams = require('../../shared/teams');
const { FIELD, PLAYER_RADIUS, BALL_RADIUS, TEAMS, POSITIONS, BOOSTS, FORMATION, CHAOS, CHAOS_IDS } = MCS;
const { FEEL } = Physics;

const W = FIELD.width;
const H = FIELD.height;

const EFFECT_FLAGS = { speed: 1, rocket: 2, frozen: 4, shrink: 8, magnet: 16, shield: 32, slide: 64, sticky: 128, armed: 256, stun: 512 };
const BALL_FLAGS = { giant: 1, thunder: 2, fire: 4, laser: 8 };
const ARMED_SECONDS = 5;        // a kick-type signature move stays armed this long
const COMBO_PASSES = 3;         // completed passes in a row that power up the next shot
const PASS_WINDOW = 3;          // seconds between a kick and the team-mate's touch

function len(x, y) { return Math.hypot(x, y); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function rnd(a, b) { return a + Math.random() * (b - a); }
function blankInput() { return { up: false, down: false, left: false, right: false, kick: false, dash: false, lob: false, skill: false, curve: 0, aimX: null, aimY: null }; }

class Match {
  /**
   * @param {object} rules  sanitized rules (see shared/rules.js)
   * @param {object} roster map slotId -> { name, isBot }
   * @param {object} sides  { red: nationId, blue: nationId }
   */
  constructor(rules, roster, sides) {
    this.rules = MCS.sanitizeRules(rules);
    this.sides = Teams.sanitizeSides(sides);
    this.traits = { red: Teams.traitsFor(this.sides.red), blue: Teams.traitsFor(this.sides.blue) };
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
    this.possession = null;  // { slot, team, since, lastTick, protectUntil } while someone has the ball on their foot (T-41)
    this.prevTouch = null;
    this.lastKick = null;
    this.combo = { red: { chain: 0, ready: false }, blue: { chain: 0, ready: false } };
    this.chaos = null;                     // { kind, t } while a chaos event runs
    this.lastChaos = null;
    this.chaosTimer = this.rules.chaosEvery;
    this.wind = { x: 0, y: 0, tx: 0, ty: 0, timer: 0 };

    this.ball = { x: W / 2, y: H / 2, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, r: BALL_RADIUS, effects: {}, owner: null };

    this.players = [];
    for (const team of TEAMS) {
      for (const pos of POSITIONS) {
        const id = MCS.slotId(team, pos);
        const info = (roster && roster[id]) || {};
        this.players.push({
          id, team, pos,
          name: info.name || Teams.botName(this.sides[team], team, pos),
          isBot: info.isBot !== false,
          x: 0, y: 0, vx: 0, vy: 0, r: PLAYER_RADIUS,
          input: blankInput(),
          kickCooldown: 0, dashCooldown: 0, dashTime: 0, kickFlash: 0,
          kickBuffer: 0,      // seconds left in which a recent kick press still counts
          kickHeld: false,
          chargeT: 0,         // seconds the kick (or lob) button has been held
          skillHeld: false, skillPress: false,
          meter: 0,           // signature-move meter 0..1
          armed: null,        // kick-type signature move waiting for the next kick
          look: info.look || null,
          effects: {},
          stats: { goals: 0, ownGoals: 0, assists: 0, kicks: 0, touches: 0, pickups: 0, saves: 0 },
        });
      }
    }
    this.resetPositions();
  }

  // ---- Roster management ---------------------------------------------------
  player(slotId) { return this.players.find(p => p.id === slotId); }
  setHuman(slotId, name, look) { const p = this.player(slotId); if (p) { p.isBot = false; p.name = name; p.look = look || null; } }
  setBot(slotId) {
    const p = this.player(slotId);
    if (p) { p.isBot = true; p.name = Teams.botName(this.sides[p.team], p.team, p.pos); p.input = blankInput(); p.look = null; }
  }
  setInput(slotId, input) {
    const p = this.player(slotId);
    if (!p || !input) return;
    p.input.up = !!input.up; p.input.down = !!input.down;
    p.input.left = !!input.left; p.input.right = !!input.right;
    p.input.dash = !!input.dash;
    p.input.lob = !!input.lob;
    p.input.curve = Number.isFinite(input.curve) ? clamp(input.curve, -1, 1) : 0;
    const skill = !!input.skill;
    if (skill && !p.skillHeld) p.skillPress = true;
    p.skillHeld = skill;
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
  goalHalfWidth() { return this.rules.goalWidth / 2 * (this.chaos && this.chaos.kind === 'tinyGoals' ? 0.55 : 1); }

  resetPositions() {
    for (const p of this.players) {
      const f = FORMATION[p.pos];
      const x = f.fx * W;
      p.x = p.team === 'red' ? x : W - x;
      p.y = p.team === 'red' ? f.fy * H : (1 - f.fy) * H;
      p.vx = 0; p.vy = 0; p.dashTime = 0;
    }
    this.possession = null;
    const b = this.ball;
    b.x = W / 2; b.y = H / 2; b.vx = 0; b.vy = 0; b.z = 0; b.vz = 0; b.spin = 0; b.owner = null;
    this.combo.red.chain = 0; this.combo.blue.chain = 0; this.combo.red.ready = false; this.combo.blue.ready = false;
  }

  emit(ev) { this.events.push(ev); }

  effectState(p) { return { speed: !!p.effects.speed, shrink: !!p.effects.shrink, frozen: !!(p.effects.frozen || p.effects.stun) }; }

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

    this.updateChaos(dt);
    this.updateWind(dt);

    // Players ----------------------------------------------------------------
    for (const p of this.players) {
      if (p.skillPress) { p.skillPress = false; this.activateSpecial(p); }
      if (this.state === 'play' && this.rules.specials) this.addMeter(p, 0.025 * dt);
      this.integratePlayer(p, dt);
    }
    this.collidePlayers();
    for (const p of this.players) Physics.confinePlayer(p, p.team, this.state, this.kickoffTeam, this.goalHalfWidth(), this.rules, this.tick);

    // Ball: sub-stepped so a fast shot can't pass through a post or a player.
    this.applyMagnets(dt);
    const speed = len(this.ball.vx, this.ball.vy);
    const steps = Math.max(1, Math.min(6, Math.ceil(speed * dt / (this.ball.r * 0.75))));
    for (let i = 0; i < steps; i++) {
      this.moveBall(dt / steps);
      const b = this.ball;
      this._heading = { x: b.x, y: b.y, vx: b.vx, vy: b.vy };
      for (const p of this.players) this.collideBallPlayer(p);
    }
    this.applyCarry(dt);
    for (const p of this.players) this.tryKick(p, dt);

    if (this.state === 'kickoff' && len(this.ball.vx, this.ball.vy) > 1) this.state = 'play';

    this.updatePickups(dt);
    this.decayEffects(dt);
    this.checkGoal();
  }

  // ---- Players -------------------------------------------------------------
  speedMul(p) { return Physics.speedMul(this.rules, this.effectState(p), this.traits[p.team]); }

  integratePlayer(p, dt) {
    p.kickCooldown = Math.max(0, p.kickCooldown - dt);
    p.kickFlash = Math.max(0, p.kickFlash - dt);
    p.kickBuffer = Math.max(0, p.kickBuffer - dt);
    // Charge: holding kick (or lob) without kicking builds power. Humans only.
    if ((p.input.kick || p.input.lob) && !p.isBot) p.chargeT += dt; else p.chargeT = 0;
    const dashed = Physics.integratePlayer(p, p.input, this.rules, dt, this.effectState(p), this.ball, this.traits[p.team]);
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
        // Sliding tackle: the slider knocks an unshielded opponent over.
        if (a.team !== b.team) {
          for (const [s, o] of [[a, b], [b, a]]) {
            if (s.effects.slide && !o.effects.shield && !o.effects.stun) {
              o.effects.stun = 0.8;
              this.emit({ type: 'tackle', slot: s.id, victim: o.id, team: s.team, x: o.x, y: o.y });
            }
          }
        }
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

  /** Integrate the ball by dt: height, spin, wind, walls, posts, crossbar, bumpers. */
  moveBall(dt) {
    const b = this.ball;
    b.r = this.ballRadius();
    const arena = Physics.arenaOf(this.rules);
    const bouncy = this.chaos && this.chaos.kind === 'bouncyBall';
    let dragBase = Physics.ballDragFor(this.rules);
    if (b.effects.giant) dragBase = Math.min(0.999, dragBase + 0.004);
    if (bouncy) dragBase = Math.max(dragBase, 0.996);
    if (b.z > 0) dragBase = Math.min(0.9995, dragBase + 0.004);   // less friction in the air
    const drag = Math.pow(dragBase, dt * 60);
    b.vx *= drag; b.vy *= drag;

    // Wind pushes the ball, airborne balls twice as much.
    if (this.wind.x || this.wind.y) {
      const k = b.z > 0 ? 2 : 1;
      b.vx += this.wind.x * k * dt; b.vy += this.wind.y * k * dt;
    }
    // Spin bends the ball's path without changing its speed.
    if (b.spin) {
      const a = b.spin * dt, c = Math.cos(a), sn = Math.sin(a);
      const vx = b.vx * c - b.vy * sn, vy = b.vx * sn + b.vy * c;
      b.vx = vx; b.vy = vy;
      b.spin *= Math.pow(FEEL.spinDecay, dt * 60);
      if (Math.abs(b.spin) < 0.03) b.spin = 0;
    }
    // Height
    if (b.z > 0 || b.vz > 0) {
      b.vz -= FEEL.gravity * dt;
      b.z += b.vz * dt;
      if (b.z <= 0) {
        b.z = 0;
        if (b.vz < -160) { b.vz = -b.vz * 0.42; this.emit({ type: 'land', x: b.x, y: b.y }); } else b.vz = 0;
      }
    }

    const max = b.effects.thunder ? FEEL.ballMaxSpeed * 1.35 : FEEL.ballMaxSpeed;
    const sp = len(b.vx, b.vy);
    if (sp > max) { b.vx = b.vx / sp * max; b.vy = b.vy / sp * max; }
    if (sp < 2 && b.z === 0) { b.vx = 0; b.vy = 0; }
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    let bounce = b.effects.giant ? Math.max(this.rules.ballBounce, 0.95) : this.rules.ballBounce;
    bounce *= arena.ballBounce;
    if (bouncy) bounce = Math.max(bounce, 1.02);
    const gh = this.goalHalfWidth();
    // Over the bar: a high ball hits the goal frame instead of entering it.
    let hitBar = false;
    if (b.z > FEEL.crossbar && Math.abs(b.y - H / 2) < gh) {
      if (b.x < 0) { b.x = 0; if (b.vx < 0) b.vx = -b.vx * 0.45; hitBar = true; }
      else if (b.x > W) { b.x = W; if (b.vx > 0) b.vx = -b.vx * 0.45; hitBar = true; }
    }
    const hitWall = Physics.confineToArena(b, b.r, bounce, true, gh);
    const hitPost = Physics.collidePosts(b, bounce, gh);
    if (hitWall || hitPost || hitBar) b.spin *= 0.4;
    if ((hitWall || hitPost || hitBar) && sp > 120) this.emit({ type: 'bounce', x: b.x, y: b.y, speed: sp, post: hitPost || hitBar, bar: hitBar });
    if (this.rules.arena === 'bumpers' && b.z < 30) {
      const bp = Physics.collideBumpers(b, this.rules, this.tick, FEEL.bumperKick);
      if (bp) {
        b.spin = 0;
        const s2 = len(b.vx, b.vy);
        if (s2 < 420) { b.vx *= 420 / (s2 || 1); b.vy *= 420 / (s2 || 1); }
        this.emit({ type: 'bumper', x: bp.x, y: bp.y });
      }
    }
  }

  collideBallPlayer(p) {
    const b = this.ball;
    // A ball in the air sails over outfield players; keepers reach a little higher.
    if (b.z > (p.pos === 'GK' ? FEEL.keeperReach : FEEL.headHeight)) return;
    if (p.effects.stun) return;   // knocked-over players can't play the ball
    const dx = b.x - p.x, dy = b.y - p.y;
    const d = len(dx, dy);
    const minD = b.r + p.r;
    if (d >= minD || d === 0) return;
    let nx = dx / d, ny = dy / d;
    // Protected ball: the opponent bounces off it instead of knocking it away.
    if (this.ballProtectedFrom(p, 'body')) {
      p.x -= nx * (minD - d); p.y -= ny * (minD - d);
      const vn0 = p.vx * nx + p.vy * ny;
      if (vn0 > 0) { p.vx -= nx * vn0 * 1.2; p.vy -= ny * vn0 * 1.2; }
      return;
    }
    // Thunderbolt: ploughs through outfield players, shoving them aside.
    if (b.effects.thunder && p.pos !== 'GK' && p.team !== b.owner) {
      p.vx += b.vx * 0.35; p.vy += b.vy * 0.35;
      if (!p.effects.shield) p.effects.stun = 0.5;
      return;
    }
    if (b.effects.thunder && p.pos === 'GK') { p.vx += b.vx * 0.25; p.vy += b.vy * 0.25; delete b.effects.thunder; }
    // Hands on the line (T-41): right by your own goal, a body touch can't
    // send the ball backwards. Players are always on the pitch side of a ball
    // rolling along the end wall, so without this every block is an own goal.
    {
      const dirA = this.attackDir(p.team), ownX = this.goalCenter(p.team).x;
      const zone = p.pos === 'GK' ? 70 : 30;
      if (Math.abs(b.x - ownX) < zone && Math.abs(b.y - H / 2) < this.goalHalfWidth() + 40 && nx * dirA < 0.15) {
        const fx = 0.15 * dirA, fy = ny === 0 ? 1 : Math.sign(ny);
        const l = len(fx, fy * Math.max(0.3, Math.abs(ny)));
        nx = fx / l; ny = fy * Math.max(0.3, Math.abs(ny)) / l;
      }
    }
    const speedBefore = len(b.vx, b.vy);
    const overlap = minD - d;
    const ballShare = b.effects.giant ? 0.7 : 1;
    b.x += nx * overlap * ballShare; b.y += ny * overlap * ballShare;
    if (ballShare < 1) { p.x -= nx * overlap * (1 - ballShare); p.y -= ny * overlap * (1 - ballShare); }
    const rvx = b.vx - p.vx, rvy = b.vy - p.vy;
    const vn = rvx * nx + rvy * ny;
    // First touch (T-38): a ball arriving at a sensible pace is cushioned
    // instead of pinging off the body; a real shot still deflects.
    const control = this.touchControl(p, len(rvx, rvy));
    if (vn < 0) {
      const bounce = FEEL.ballPlayerBounce + (FEEL.dribbleBounce - FEEL.ballPlayerBounce) * control;
      const imp = -(1 + bounce) * vn;
      b.vx += nx * imp; b.vy += ny * imp;
    }
    if (control > 0) {
      // Kill some of the sideways slip too, so the ball settles at the feet.
      const vt = (b.vx - p.vx) * -ny + (b.vy - p.vy) * nx;
      const k = FEEL.trapGrip * control;
      b.vx -= -ny * vt * k; b.vy -= nx * vt * k;
    }
    // Dribble push: make sure the ball separates from a moving player.
    const push = 40 + (FEEL.dribblePush - 40) * control;
    const pushN = p.vx * nx + p.vy * ny;
    const bn = b.vx * nx + b.vy * ny;
    if (bn < pushN + push) { b.vx += nx * (pushN + push - bn); b.vy += ny * (pushN + push - bn); }
    // A dashing player that runs into the ball gives it a real whack.
    if (p.dashTime > 0 && !p.effects.frozen && !p.effects.slide) {
      const extra = 180;
      b.vx += nx * extra; b.vy += ny * extra;
    }
    // Sliding tackle: the slider takes the ball with them.
    if (p.effects.slide) { b.vx = p.vx * 1.05 + nx * 60; b.vy = p.vy * 1.05 + ny * 60; }
    // Sprint dribble: the ball is glued to the feet.
    if (p.effects.sticky) {
      const ps = len(p.vx, p.vy);
      const fx = ps > 30 ? p.vx / ps : nx, fy = ps > 30 ? p.vy / ps : ny;
      b.x = p.x + fx * (minD + 1); b.y = p.y + fy * (minD + 1);
      b.vx = p.vx; b.vy = p.vy;
    }
    // Any opponent touch knocks a glued ball loose.
    for (const o of this.players) if (o.team !== p.team && o.effects.sticky) delete o.effects.sticky;
    b.spin = 0; b.z = Math.min(b.z, 0); b.vz = 0;
    if (b.effects.fire && b.owner !== p.team) delete b.effects.fire;
    if (b.effects.laser && b.owner !== p.team) delete b.effects.laser;
    // Keeper save: a fast ball that was going in.
    if (p.pos === 'GK' && speedBefore > 280 && (!this.lastTouch || this.lastTouch.slot !== p.id)) {
      if (this._preTouchHeadingIn(p, this.goalCenter(p.team).x)) {
        p.stats.saves++;
        this.emit({ type: 'save', slot: p.id, team: p.team, x: b.x, y: b.y });
      }
    }
    this.registerTouch(p, false);
  }

  /**
   * How much of a body touch is a controlled one (0..1), given the ball's
   * speed relative to the player. Dashing, stunned or frozen players and
   * special-move balls get no control.
   */
  touchControl(p, relSpeed) {
    const b = this.ball;
    if (p.dashTime > 0 || p.effects.stun || p.effects.frozen || p.effects.slide) return 0;
    if (b.effects.thunder || b.effects.laser || b.effects.giant) return 0;
    return clamp((FEEL.trapHard - relSpeed) / (FEEL.trapHard - FEEL.trapSoft), 0, 1);
  }

  /**
   * Close control (T-38): the player nearest a loose, slow ball at their feet
   * keeps it there. Holding a direction steers it in front of you, so you can
   * turn with the ball; standing still traps it. An opponent alongside halves
   * the grip, and a fresh kick is never pulled back.
   */
  applyCarry(dt) {
    const b = this.ball;
    for (const p of this.players) p.carrying = false;
    if (b.z > FEEL.headHeight || b.effects.thunder || b.effects.laser) return;
    let best = null, bestD = Infinity;
    for (const p of this.players) {
      if (this.ballProtectedFrom(p, 'body')) continue;
      const d = len(b.x - p.x, b.y - p.y) - p.r - b.r;
      if (d < bestD) { bestD = d; best = p; }
    }
    // The current carrier keeps the ball while it is still at their feet, even
    // if a team-mate brushes past closer to it (T-41).
    const pos = this.possession, cur = pos && this.tick - pos.lastTick <= 2 ? this.player(pos.slot) : null;
    if (cur && cur !== best && len(b.x - cur.x, b.y - cur.y) - cur.r - b.r < FEEL.carryReach && (!best || best.team === cur.team)) { best = cur; bestD = 0; }
    const p = best;
    if (!p || bestD > FEEL.carryReach) return;
    if (p.dashTime > 0 || p.effects.stun || p.effects.frozen || p.effects.slide || p.effects.sticky) return;
    if (p.kickCooldown > FEEL.kickCooldown - 0.15) return;
    if (len(b.vx - p.vx, b.vy - p.vy) > FEEL.carryMaxRel) return;
    let mx = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
    let my = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
    const ml = len(mx, my);
    const dx = b.x - p.x, dy = b.y - p.y, d = len(dx, dy) || 1;
    if (ml) { mx /= ml; my /= ml; }
    // No input, or running away from a ball behind you: just trap it where it is.
    if (!ml || (mx * dx + my * dy) / d < -0.3) { mx = dx / d; my = dy / d; }
    // Never hold or steer the ball toward your own goal mouth near goal (T-41):
    // a ball sitting goal-side of you there is one bump from an own goal.
    const ownX = this.goalCenter(p.team).x, dirA = this.attackDir(p.team);
    if (Math.abs(b.x - ownX) < 160 && Math.abs(b.y - H / 2) < this.goalHalfWidth() + 60 && (mx * dirA < 0.2)) return;
    const reach = p.r + b.r + 2;
    const tx = p.x + mx * reach, ty = p.y + my * reach;
    let cx = (tx - b.x) * 9, cy = (ty - b.y) * 9;
    const cl = len(cx, cy);
    if (cl > 300) { cx *= 300 / cl; cy *= 300 / cl; }
    const wantVx = p.vx + cx, wantVy = p.vy + cy;
    let grip = FEEL.carryGrip;
    for (const o of this.players) {
      if (o.team !== p.team && len(o.x - b.x, o.y - b.y) < o.r + b.r + FEEL.carryReach + 6) { grip *= FEEL.carryContested; break; }
    }
    const k = 1 - Math.pow(1 - grip, dt * 60);
    b.vx += (wantVx - b.vx) * k; b.vy += (wantVy - b.vy) * k;
    p.carrying = true;
    this.trackPossession(p);
  }

  /**
   * Possession (T-41): who has the ball on their foot. Winning it gives a
   * short protection window in which opponents can't kick it or knock it
   * off you, and the player who lost it can't snatch it straight back.
   */
  trackPossession(p) {
    const now = this.tick, pos = this.possession;
    if (pos && pos.slot === p.id) { pos.lastTick = now; return; }
    const loser = pos && now - pos.lastTick < 30 && pos.team !== p.team ? pos.slot : null;
    this.possession = {
      slot: p.id, team: p.team, since: now, lastTick: now,
      protectUntil: now + Math.round(FEEL.protectTime * MCS.TICK_RATE),
      loser, loserUntil: loser ? now + Math.round(FEEL.regainTime * MCS.TICK_RATE) : 0,
    };
  }

  /**
   * Is the ball shielded from player p right now? A ball under close control
   * can't be knocked off the carrier by bumping into it (kind 'body'); it
   * takes a real tackle, i.e. a kick, and even that has to wait out the
   * protection window after the ball was won (kind 'kick'). Slides ignore it.
   */
  ballProtectedFrom(p, kind) {
    const pos = this.possession;
    if (!pos || pos.team === p.team || p.effects.slide) return false;
    if (this.tick - pos.lastTick > 2) return false;          // carrier has lost close control
    if (kind === 'body') return true;
    return this.tick < pos.protectUntil || (p.id === pos.loser && this.tick < pos.loserUntil);
  }

  /** Was the ball heading into p's goal before this touch? (uses the last recorded heading) */
  _preTouchHeadingIn(p, goalX) {
    const h = this._heading;
    if (!h) return false;
    if ((goalX - h.x) * h.vx <= 0) return false;
    const t = (goalX - h.x) / h.vx;
    if (t <= 0 || t > 0.9) return false;
    const yAt = h.y + h.vy * t;
    return Math.abs(yAt - H / 2) < this.goalHalfWidth() + 25;
  }

  tryKick(p, dt) {
    const wantsLob = p.input.lob;
    const wants = p.input.kick || wantsLob || p.kickBuffer > 0;
    if (!wants || p.kickCooldown > 0 || p.effects.frozen || p.effects.stun) return;
    const b = this.ball;
    if (b.z > (p.pos === 'GK' ? FEEL.keeperReach : FEEL.headHeight)) return;
    if (this.ballProtectedFrom(p, 'kick')) return;
    const dx = b.x - p.x, dy = b.y - p.y;
    const d = len(dx, dy);
    if (d > b.r + p.r + FEEL.kickRange) return;
    let nx = dx / (d || 1), ny = dy / (d || 1);
    // Optional aim: the kick direction is blended toward the aim point.
    const hasAim = p.input.aimX !== null && p.input.aimY !== null;
    if (hasAim) {
      let ax = p.input.aimX - b.x, ay = p.input.aimY - b.y;
      const al = len(ax, ay);
      if (al > 1) {
        ax /= al; ay /= al;
        const dot = ax * nx + ay * ny;
        // A ball under control goes where you aim; a scrambled one less so.
        const wa = p.carrying ? FEEL.carryAim : 0.55;
        if (dot > (p.carrying ? 0 : 0.2)) { nx = nx * (1 - wa) + ax * wa; ny = ny * (1 - wa) + ay * wa; const l = len(nx, ny) || 1; nx /= l; ny /= l; }
      }
    }
    // Charge: 0 for a tap, 1 for a full hold.
    const charge = clamp((p.chargeT - FEEL.chargeStart) / (FEEL.chargeFull - FEEL.chargeStart), 0, 1);
    let power = FEEL.kickSpeed * this.rules.kickPower * this.traits[p.team].kick * (1 + FEEL.chargeBonus * charge);
    let rocket = false, special = null, comboShot = false;
    let spin = p.input.curve * FEEL.curveMax;
    if (p.effects.rocket) { power *= 2.2; delete p.effects.rocket; rocket = true; }
    if (b.effects.giant) power *= 0.8;
    delete b.effects.thunder; delete b.effects.fire; delete b.effects.laser;

    // Armed signature move fires with this kick.
    if (p.armed && p.effects.armed) {
      special = p.armed;
      const oppGoal = this.goalCenter(MCS.otherTeam(p.team));
      if (special === 'thunder') { power *= 1.85; b.effects.thunder = 1.2; }
      else if (special === 'banana') {
        power *= 1.2;
        // Bend toward goal: start aimed outside the target, let the spin bring it in.
        let gx = oppGoal.x - b.x, gy = oppGoal.y - b.y; const gl = len(gx, gy) || 1; gx /= gl; gy /= gl;
        let sign = Math.sign(p.input.curve) || Math.sign(nx * gy - ny * gx) || (b.y < H / 2 ? 1 : -1) * this.attackDir(p.team);
        const off = -sign * 0.38, c = Math.cos(off), sn = Math.sin(off);
        const rx = nx * c - ny * sn, ry = nx * sn + ny * c; nx = rx; ny = ry;
        spin = sign * FEEL.curveMax * 0.75;
      } else if (special === 'laser') {
        const tgt = this.laserTarget(p);
        let tx = tgt.x - b.x, ty = tgt.y - b.y; const tl = len(tx, ty) || 1;
        nx = tx / tl; ny = ty / tl; spin = 0;
        power = Math.max(power, FEEL.kickSpeed * 1.2);
        b.effects.laser = 0.9;
      }
      p.armed = null; delete p.effects.armed;
    }
    // Combo shot: the team strung passes together.
    const combo = this.combo[p.team];
    if (combo.ready) { power *= 1.3; combo.ready = false; combo.chain = 0; comboShot = true; b.effects.fire = 1.6; }

    if (wantsLob && !p.input.kick) {
      b.vx = nx * power * FEEL.lobPower + p.vx * 0.3;
      b.vy = ny * power * FEEL.lobPower + p.vy * 0.3;
      b.vz = FEEL.lobLift * (1 + 0.35 * charge);
      b.z = Math.max(b.z, 1);
    } else {
      b.vx = nx * power + p.vx * 0.3;
      b.vy = ny * power + p.vy * 0.3;
    }
    b.spin = clamp(spin, -FEEL.curveMax, FEEL.curveMax);
    b.owner = p.team;
    p.kickCooldown = FEEL.kickCooldown;
    p.kickBuffer = 0;
    p.kickFlash = 0.15;
    p.chargeT = 0;
    p.stats.kicks++;
    if (p.effects.sticky) delete p.effects.sticky;
    this.addMeter(p, 0.06);
    this.registerTouch(p, true);
    this.emit({ type: 'kick', slot: p.id, team: p.team, x: b.x, y: b.y, power: power / FEEL.kickSpeed, rocket, lob: b.vz > 0, curve: Math.round(b.spin * 100) / 100, charge: Math.round(charge * 100) / 100, special, combo: comboShot });
  }

  /** Where a laser pass goes: the best-placed team-mate's run, else the far corner. */
  laserTarget(p) {
    const b = this.ball, dir = this.attackDir(p.team);
    let best = null, bestScore = -Infinity;
    for (const m of this.players) {
      if (m.team !== p.team || m === p || m.pos === 'GK') continue;
      const lead = { x: m.x + m.vx * 0.3, y: m.y + m.vy * 0.3 };
      const dd = len(lead.x - b.x, lead.y - b.y);
      if (dd < 80) continue;
      const score = (lead.x - b.x) * dir - dd * 0.15;
      if (score > bestScore) { bestScore = score; best = lead; }
    }
    if (best && bestScore > -150) return best;
    const g = this.goalCenter(MCS.otherTeam(p.team));
    return { x: g.x, y: H / 2 + (b.y < H / 2 ? 1 : -1) * this.goalHalfWidth() * 0.7 };
  }

  registerTouch(p, isKick) {
    const now = this.tick;
    if (!this.lastTouch || this.lastTouch.slot !== p.id) {
      p.stats.touches++;
      this.addMeter(p, 0.04);
      this.trackPass(p);
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

  /** Completed passes build a combo; any opponent touch breaks it. */
  trackPass(p) {
    const other = this.combo[MCS.otherTeam(p.team)];
    if (other.chain > 0 || other.ready) {
      if (other.ready || other.chain >= 2) this.emit({ type: 'comboBroken', team: MCS.otherTeam(p.team) });
      other.chain = 0; other.ready = false;
    }
    const k = this.lastKick;
    if (!k || k.passCounted || k.team !== p.team || k.slot === p.id || this.tick - k.tick > PASS_WINDOW * MCS.TICK_RATE) return;
    k.passCounted = true;
    const c = this.combo[p.team];
    if (c.ready) return;          // already powered up; shoot!
    c.chain++;
    this.addMeter(p, 0.1);
    const passer = this.player(k.slot); if (passer) this.addMeter(passer, 0.08);
    if (c.chain >= COMBO_PASSES) c.ready = true;
    this.emit({ type: 'pass', team: p.team, slot: p.id, from: k.slot, chain: c.chain, ready: c.ready });
  }

  // ---- Signature moves ---------------------------------------------------------
  addMeter(p, amount) { if (this.rules.specials && !p.armed) p.meter = Math.min(1, p.meter + amount); }

  activateSpecial(p) {
    if (!this.rules.specials || p.meter < 1 || p.armed || p.effects.stun || p.effects.frozen) return false;
    if (this.state !== 'play' && this.state !== 'kickoff') return false;
    const sp = Teams.specialFor(this.sides[p.team]);
    p.meter = 0;
    const b = this.ball;
    switch (sp.kind) {
      case 'banana': case 'thunder': case 'laser':
        p.armed = sp.kind; p.effects.armed = ARMED_SECONDS; break;
      case 'tackle': {
        let dx = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0), dy = (p.input.down ? 1 : 0) - (p.input.up ? 1 : 0);
        if (!dx && !dy) { dx = b.x - p.x; dy = b.y - p.y; }
        const l = len(dx, dy) || 1;
        p.vx = dx / l * 820; p.vy = dy / l * 820;
        p.dashTime = 0.42; p.effects.slide = 0.42;
        break;
      }
      case 'sprint':
        p.effects.speed = 3; p.effects.sticky = 3; break;
      case 'shockwave': {
        const R = 230;
        for (const o of this.players) {
          if (o.team === p.team) continue;
          const dx = o.x - p.x, dy = o.y - p.y, d = len(dx, dy) || 1;
          if (d > R) continue;
          const f = 720 * (1 - d / R) + 160;
          o.vx += dx / d * f; o.vy += dy / d * f;
          if (!o.effects.shield) o.effects.stun = 0.45;
        }
        const bx = b.x - p.x, by = b.y - p.y, bd = len(bx, by) || 1;
        if (bd < R) { const f = 650 * (1 - bd / R) + 220; b.vx += bx / bd * f; b.vy += by / bd * f; b.owner = p.team; }
        break;
      }
    }
    this.emit({ type: 'special', slot: p.id, team: p.team, kind: sp.kind, name: sp.name, x: p.x, y: p.y });
    return true;
  }

  // ---- Chaos events & wind -------------------------------------------------------
  updateChaos(dt) {
    const r = this.rules;
    if (!r.chaosEvents) { this.chaos = null; return; }
    if (this.chaos) {
      this.chaos.t -= dt;
      if (this.chaos.t <= 0) { this.emit({ type: 'chaosEnd', kind: this.chaos.kind }); this.chaos = null; this.chaosTimer = r.chaosEvery; }
      return;
    }
    if (this.state !== 'play') return;
    this.chaosTimer -= dt;
    if (this.chaosTimer <= 0) this.startChaos();
  }

  startChaos(kind) {
    const r = this.rules;
    let pool = CHAOS_IDS.filter(k => k !== this.lastChaos);
    if (!r.boostsEnabled || !r.enabledBoosts.length) pool = pool.filter(k => k !== 'pickupRain');
    kind = kind || pool[Math.floor(Math.random() * pool.length)];
    const def = CHAOS[kind];
    this.chaos = { kind, t: def.duration };
    this.lastChaos = kind;
    if (kind === 'frenzy') for (const p of this.players) p.effects.speed = def.duration;
    if (kind === 'pickupRain' && r.enabledBoosts.length) {
      for (let i = 0; i < 4; i++) {
        const type = r.enabledBoosts[Math.floor(Math.random() * r.enabledBoosts.length)];
        const pk = { id: this.nextPickupId++, type, x: rnd(W * 0.12, W * 0.88), y: rnd(H * 0.12, H * 0.88), ttl: 12 };
        this.pickups.push(pk);
        this.emit({ type: 'spawn', boost: type, x: pk.x, y: pk.y });
      }
    }
    this.emit({ type: 'chaos', kind, duration: def.duration });
  }

  updateWind(dt) {
    const w = this.wind;
    if (this.rules.arena !== 'wind') { w.x = 0; w.y = 0; return; }
    w.timer -= dt;
    if (w.timer <= 0) {
      const a = Math.random() * Math.PI * 2, f = rnd(70, 190);
      w.tx = Math.cos(a) * f; w.ty = Math.sin(a) * f * 0.7;
      w.timer = rnd(6, 10);
      this.emit({ type: 'wind', x: Math.round(w.tx), y: Math.round(w.ty) });
    }
    const k = Math.min(1, dt * 0.8);
    w.x += (w.tx - w.x) * k; w.y += (w.ty - w.y) * k;
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
    for (const p of this.players) { decay(p.effects); if (p.armed && !p.effects.armed) p.armed = null; }
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
    const points = this.chaos && this.chaos.kind === 'doublePoints' ? 2 : 1;
    this.score[scoring] += points;
    const comboGoal = !!b.effects.fire, specialGoal = b.effects.thunder ? 'thunder' : b.effects.laser ? 'laser' : null;
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
      points, combo: comboGoal, special: specialGoal,
    });
    this.lastTouch = null; this.prevTouch = null; this.lastKick = null;
    this.kickoffTeam = conceded;
    if (comboGoal && scorer && !ownGoal) scorer.stats.comboGoals = (scorer.stats.comboGoals || 0) + 1;
    // Bots react: a team-mate cheers, a culprit apologises.
    const mates = this.players.filter(p => p.isBot && p.team === scoring && p !== scorer);
    if (mates.length && Math.random() < 0.7) this.emit({ type: 'emote', slot: mates[Math.floor(Math.random() * mates.length)].id, id: Math.random() < 0.5 ? 'nice' : 'wow' });
    if (ownGoal && scorer && scorer.isBot) this.emit({ type: 'emote', slot: scorer.id, id: 'sorry' });

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

  ballFlags() {
    let f = 0;
    for (const k of Object.keys(this.ball.effects)) f |= BALL_FLAGS[k] || 0;
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
        m: Math.round(p.meter * 100) / 100, sp: p.armed || 0,
        ch: p.chargeT > FEEL.chargeStart ? Math.round(Math.min(1, (p.chargeT - FEEL.chargeStart) / (FEEL.chargeFull - FEEL.chargeStart)) * 100) / 100 : 0,
      })),
      ball: {
        x: Math.round(this.ball.x * 10) / 10, y: Math.round(this.ball.y * 10) / 10, vx: Math.round(this.ball.vx), vy: Math.round(this.ball.vy), r: this.ball.r,
        z: Math.round(this.ball.z * 10) / 10, vz: Math.round(this.ball.vz), spin: Math.round(this.ball.spin * 100) / 100,
        giant: this.ball.effects.giant ? 1 : 0, bf: this.ballFlags(),
      },
      gw: Math.round(this.goalHalfWidth() * 2),
      chaos: this.chaos ? { k: this.chaos.kind, t: Math.round(this.chaos.t * 10) / 10 } : null,
      wind: this.wind.x || this.wind.y ? [Math.round(this.wind.x), Math.round(this.wind.y)] : null,
      cb: [this.combo.red.chain, this.combo.blue.chain, this.combo.red.ready ? 1 : 0, this.combo.blue.ready ? 1 : 0],
      pickups: this.pickups.map(pk => ({ id: pk.id, x: Math.round(pk.x), y: Math.round(pk.y), type: pk.type, ttl: Math.round(pk.ttl) })),
      events: this.events,
    };
    this.events = [];
    return snap;
  }

  stats() {
    return this.players.map(p => ({ id: p.id, name: p.name, team: p.team, pos: p.pos, bot: p.isBot, stats: p.stats, look: p.look || null }));
  }
}

Match.FEEL = FEEL;
Match.EFFECT_FLAGS = EFFECT_FLAGS;
Match.BALL_FLAGS = BALL_FLAGS;
module.exports = Match;
