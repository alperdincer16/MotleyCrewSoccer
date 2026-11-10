/**
 * shared/physics.js — movement and arena collision code shared by the
 * server simulation and the client's local-player prediction.
 * Owner: Diego Ferreira (T-20)
 *
 * Everything here is deterministic given the same inputs and dt, so the
 * client can replay its own inputs on top of the last authoritative
 * snapshot and land on the same answer the server will.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules'));
  else root.Physics = factory(root.MCS);
})(typeof self !== 'undefined' ? self : this, function (MCS) {
  'use strict';
  const { FIELD, PLAYER_RADIUS } = MCS;
  // (ARENAS lives in rules.js so the rules editor can list them.)
  const W = FIELD.width, H = FIELD.height;

  // Feel constants (not player-facing rules).
  const FEEL = {
    playerAccel: 3000,       // units/s^2 (was 2600; snappier starts, T-38)
    turnAssist: 1.5,         // extra accel when pushing against your own momentum
    playerMaxSpeed: 270,     // units/s at playerSpeed 1.0
    playerDamping: 0.88,     // per 1/60 s when no input
    playerMoveDamping: 0.96, // per 1/60 s while pushing a direction
    kickSpeed: 640,          // ball speed from a kick at kickPower 1.0
    kickRange: 8,            // extra reach beyond touching
    kickCooldown: 0.28,
    kickBuffer: 0.15,        // a kick press this long before contact still fires
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
    // Charged kicks, curve and lobs (T-27)
    chargeStart: 0.12,       // holding kick longer than this starts charging
    chargeFull: 0.75,        // seconds of holding for a full charge
    chargeBonus: 0.42,       // a full charge adds this much power
    curveMax: 2.4,           // rad/s the ball's heading turns at full spin
    spinDecay: 0.975,        // per 1/60 s
    lobPower: 0.62,          // horizontal power of a lob relative to a kick
    lobLift: 340,            // upward speed of a lob (units/s), more with charge
    gravity: 900,
    crossbar: 42,            // a ball higher than this goes over the goal
    headHeight: 18,          // outfield players can't touch a ball above this
    keeperReach: 36,         // keepers can claw a ball down below this
    // Bumpers arena
    bumperRadius: 26,
    bumperOrbit: 120,
    bumperPeriod: 12,        // seconds per orbit
    bumperKick: 1.25,        // ball leaves a bumper faster than it arrived
    // Ball control (T-38)
    trapSoft: 260,           // incoming balls slower than this are fully cushioned
    trapHard: 700,           // ...and faster than this bounce off like before
    dribbleBounce: 0.08,     // restitution of a cushioned touch
    dribblePush: 12,         // how much faster than you a cushioned touch rolls (was a flat 40)
    trapGrip: 0.55,          // share of sideways spin a cushioned touch kills
    carryReach: 12,          // ball within this of your feet is "on your foot"
    carryMaxRel: 300,        // ...if it moves slower than this relative to you
    carryGrip: 0.34,         // per 1/60 s pull of the ball toward the carry point (T-41: was 0.22)
    carryContested: 0.75,    // grip kept with an opponent alongside (was 0.5)
    protectTime: 0.5,        // seconds a fresh ball-winner can't be robbed (T-41; 0.7 felt too safe)
    regainTime: 0.6,         // a player who just lost the ball can't win it straight back
    carryAim: 0.75,          // kick-direction weight given to your aim while carrying (0.55 otherwise)
  };

  /** Arena feel multipliers for the current rules. */
  /**
   * The pitch feel for a location plus its weather (T-45). Cached per pair so
   * the per-tick player code allocates nothing.
   */
  const feelCache = new Map();
  function arenaOf(rules) {
    const a = (MCS.ARENAS && MCS.ARENAS[rules && rules.arena]) || MCS.ARENAS.classic;
    const w = (MCS.WEATHER && MCS.WEATHER[rules && rules.weather]) || null;
    if (!w) return a;
    const key = (rules.arena || 'classic') + '|' + rules.weather;
    let f = feelCache.get(key);
    if (!f) {
      f = Object.assign({}, a, { accel: a.accel * w.accel, speed: a.speed * w.speed, ballDrag: a.ballDrag + w.ballDrag, ballBounce: a.ballBounce * w.ballBounce });
      feelCache.set(key, f);
    }
    return f;
  }
  /** Effective per-1/60 s ball drag on the ground for these rules. */
  function ballDragFor(rules) { return Math.min(0.9995, Math.max(0.9, rules.ballDrag + arenaOf(rules).ballDrag)); }

  /**
   * Bumper positions at a given server tick (Pinball arena only). Two orbit
   * a point in each half, in opposite phase, so they never block kickoff.
   */
  function bumpersAt(rules, tick) {
    if (!rules || rules.arena !== 'bumpers') return [];
    const t = (tick || 0) / MCS.TICK_RATE;
    const a = (t / FEEL.bumperPeriod) * Math.PI * 2;
    const R = FEEL.bumperOrbit;
    const out = [];
    for (const [cx, sgn] of [[W * 0.3, 1], [W * 0.7, -1]]) {
      for (const off of [0, Math.PI]) {
        out.push({ x: cx + Math.cos(a * sgn + off) * R, y: H / 2 + Math.sin(a * sgn + off) * R * 1.4, r: FEEL.bumperRadius });
      }
    }
    return out;
  }

  /** Circle body vs bumpers; returns the bumper hit (or null). */
  function collideBumpers(b, rules, tick, bounce) {
    const list = bumpersAt(rules, tick);
    let hit = null;
    for (const bp of list) {
      const dx = b.x - bp.x, dy = b.y - bp.y, d = Math.hypot(dx, dy);
      const minD = (b.r || PLAYER_RADIUS) + bp.r;
      if (d < minD && d > 0) {
        const nx = dx / d, ny = dy / d;
        b.x = bp.x + nx * minD; b.y = bp.y + ny * minD;
        const vn = b.vx * nx + b.vy * ny;
        if (vn < 0) { b.vx -= (1 + bounce) * vn * nx; b.vy -= (1 + bounce) * vn * ny; hit = bp; }
      }
    }
    return hit;
  }

  function len(x, y) { return Math.hypot(x, y); }

  /** Speed multiplier from rules + active effects {speed, shrink}. */
  function speedMul(rules, st, traits) {
    let m = rules.playerSpeed * (traits && traits.speed ? traits.speed : 1);
    if (st.speed) m *= 1.6;
    if (st.shrink) m *= 0.7;
    return m;
  }
  function radiusFor(st) { return st.shrink ? PLAYER_RADIUS * 0.6 : PLAYER_RADIUS; }

  /**
   * Advance one player body by dt.
   * p: { x, y, vx, vy, r, dashCooldown, dashTime }
   * input: { up, down, left, right, dash }
   * st: { speed, shrink, frozen }  (effect state)
   * aim: { x, y } fallback dash direction when standing still (the ball)
   * traits: { speed, kick, dash } national team modifiers (optional)
   * Returns true if a dash fired this step.
   */
  function integratePlayer(p, input, rules, dt, st, aim, traits) {
    p.r = radiusFor(st);
    p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    p.dashTime = Math.max(0, p.dashTime - dt);

    let dx = 0, dy = 0;
    if (!st.frozen) {
      if (input.left) dx -= 1;
      if (input.right) dx += 1;
      if (input.up) dy -= 1;
      if (input.down) dy += 1;
    }
    const moving = dx !== 0 || dy !== 0;
    const arena = arenaOf(rules);
    const mul = speedMul(rules, st, traits) * arena.speed;
    if (moving) {
      const l = len(dx, dy); dx /= l; dy /= l;
      // Turning against your own momentum bites harder, so cuts and stops are sharp.
      const sp0 = len(p.vx, p.vy);
      const against = sp0 > 1 ? -(p.vx * dx + p.vy * dy) / sp0 : 0;   // 1 = straight back
      const turn = against > 0 ? 1 + (FEEL.turnAssist - 1) * against : 1;
      p.vx += dx * FEEL.playerAccel * arena.accel * mul * turn * dt;
      p.vy += dy * FEEL.playerAccel * arena.accel * mul * turn * dt;
    }

    let dashed = false;
    if (!st.frozen && rules.dashEnabled && input.dash && p.dashCooldown === 0) {
      let ddx = dx, ddy = dy;
      if (!moving && aim) { ddx = aim.x - p.x; ddy = aim.y - p.y; const l = len(ddx, ddy) || 1; ddx /= l; ddy /= l; }
      if (ddx !== 0 || ddy !== 0) {
        p.vx += ddx * FEEL.dashImpulse;
        p.vy += ddy * FEEL.dashImpulse;
        p.dashCooldown = FEEL.dashCooldown * (traits && traits.dash ? traits.dash : 1);
        p.dashTime = FEEL.dashDuration;
        dashed = true;
      }
    }

    const damp = Math.pow(moving ? (arena.moveDamp || FEEL.playerMoveDamping) : (arena.idleDamp || FEEL.playerDamping), dt * 60);
    p.vx *= damp; p.vy *= damp;
    if (st.frozen) { p.vx *= 0.8; p.vy *= 0.8; }
    const max = FEEL.playerMaxSpeed * mul * (p.dashTime > 0 ? 3 : 1);
    const sp = len(p.vx, p.vy);
    if (sp > max) { p.vx = p.vx / sp * max; p.vy = p.vy / sp * max; }

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    return dashed;
  }

  /**
   * Confine a circle body to the rounded arena. allowPockets lets it enter
   * the goal mouths (the ball). Returns true if it hit something.
   */
  function confineToArena(b, r, bounce, allowPockets, goalHalfWidth) {
    const gh = goalHalfWidth;
    const inMouth = Math.abs(b.y - H / 2) < gh - r * 0.2;
    let hit = false;

    if (allowPockets && inMouth) {
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

    const cr = FIELD.cornerRadius;
    const corners = [[cr, cr], [W - cr, cr], [cr, H - cr], [W - cr, H - cr]];
    for (const [cx, cy] of corners) {
      const inBox = (cx < W / 2 ? b.x < cx : b.x > cx) && (cy < H / 2 ? b.y < cy : b.y > cy);
      if (!inBox) continue;
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

  /** Circle vs the four goalposts. */
  function collidePosts(b, bounce, goalHalfWidth) {
    const gh = goalHalfWidth;
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

  /** Kickoff discipline: own half only; non-kicking team outside the circle. */
  function kickoffConfine(p, team, kickoffTeam) {
    const r = p.r;
    const dir = team === 'red' ? 1 : -1;
    if (dir > 0 && p.x > W / 2 - r) { p.x = W / 2 - r; if (p.vx > 0) p.vx = 0; }
    if (dir < 0 && p.x < W / 2 + r) { p.x = W / 2 + r; if (p.vx < 0) p.vx = 0; }
    if (team !== kickoffTeam) {
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

  /**
   * Full per-tick confinement for a player (arena, kickoff rules, posts,
   * bumpers). `rules` and `tick` are only needed for the Pinball arena.
   */
  function confinePlayer(p, team, state, kickoffTeam, goalHalfWidth, rules, tick) {
    confineToArena(p, p.r, FEEL.wallPlayerBounce, false, goalHalfWidth);
    if (state === 'kickoff') kickoffConfine(p, team, kickoffTeam);
    collidePosts(p, 0.3, goalHalfWidth);
    if (rules && rules.arena === 'bumpers') collideBumpers(p, rules, tick, 0.5);
  }

  return { FEEL, arenaOf, ballDragFor, bumpersAt, collideBumpers, speedMul, radiusFor, integratePlayer, confineToArena, collidePosts, kickoffConfine, confinePlayer };
});
