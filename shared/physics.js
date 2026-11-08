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
  const W = FIELD.width, H = FIELD.height;

  // Feel constants (not player-facing rules).
  const FEEL = {
    playerAccel: 2600,       // units/s^2
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
  };

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
    const mul = speedMul(rules, st, traits);
    if (moving) {
      const l = len(dx, dy); dx /= l; dy /= l;
      p.vx += dx * FEEL.playerAccel * mul * dt;
      p.vy += dy * FEEL.playerAccel * mul * dt;
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

    const damp = Math.pow(moving ? FEEL.playerMoveDamping : FEEL.playerDamping, dt * 60);
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

  /** Full per-tick confinement for a player (arena, kickoff rules, posts). */
  function confinePlayer(p, team, state, kickoffTeam, goalHalfWidth) {
    confineToArena(p, p.r, FEEL.wallPlayerBounce, false, goalHalfWidth);
    if (state === 'kickoff') kickoffConfine(p, team, kickoffTeam);
    collidePosts(p, 0.3, goalHalfWidth);
  }

  return { FEEL, speedMul, radiusFor, integratePlayer, confineToArena, collidePosts, kickoffConfine, confinePlayer };
});
