/**
 * server/game/ai.js — bot controller.
 * Owner: Mei Lin (T-10)
 *
 * Produces an input object for one bot every tick. Bots re-evaluate their
 * goal every ~120 ms (with a little jitter) and steer toward it, which
 * gives them a natural reaction delay and keeps them from vibrating.
 */
'use strict';

const MCS = require('../../shared/rules');
const Teams = require('../../shared/teams');
const Physics = require('../../shared/physics');
const { FIELD, BALL_RADIUS } = MCS;
const W = FIELD.width;
const H = FIELD.height;

function len(x, y) { return Math.hypot(x, y); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

class BotBrain {
  constructor(slotId, difficulty = 1) {
    this.slotId = slotId;
    this.baseDifficulty = difficulty;  // position modifier (keepers are a touch slower)
    this.difficulty = difficulty;      // scaled by the botSkill rule every update
    this.target = { x: W / 2, y: H / 2 };
    this.wantKick = false;
    this.wantDash = false;
    this.aim = null;
    this.replanIn = 0;
    this.noiseSeed = Math.random() * 1000;
    this.lastPlan = '';
  }

  /** Predict where the ball will be after t seconds (ignores walls). */
  predictBall(match, t) {
    const b = match.ball;
    const d0 = Physics.ballDragFor(match.rules);
    const drag = Math.pow(d0, 60 * t);
    // integral of v*drag^s ds approximated
    const k = (1 - drag) / Math.max(1e-6, -Math.log(d0) * 60);
    return { x: clamp(b.x + b.vx * k, 0, W), y: clamp(b.y + b.vy * k, 0, H) };
  }

  think(match, me) {
    this.plan(match, me);
    this.wantSkill = this.decideSkill(match, me);
  }

  /**
   * Use the nation's signature move when the meter is full and the moment
   * suits it. Bots hesitate a little (skill-scaled) so they don't fire it the
   * instant it charges.
   */
  decideSkill(match, me) {
    if (!match.rules.specials || me.meter < 1 || me.armed) return false;
    if (Math.random() > 0.35 * this.difficulty) return false;
    const b = match.ball;
    const kind = Teams.specialFor(match.sides[me.team]).kind;
    const myDist = len(b.x - me.x, b.y - me.y);
    const oppGoal = match.goalCenter(MCS.otherTeam(me.team));
    const goalDist = len(oppGoal.x - b.x, oppGoal.y - b.y);
    const opps = match.players.filter(p => p.team !== me.team);
    const oppNearBall = opps.some(o => len(o.x - b.x, o.y - b.y) < 70);
    const oppCloser = opps.some(o => len(o.x - b.x, o.y - b.y) < myDist);
    switch (kind) {
      case 'banana': case 'thunder':
        return this.lastPlan === 'fwd-attack' && myDist < 140 && goalDist < 620;
      case 'laser':
        return (this.lastPlan === 'fwd-pass' || this.lastPlan === 'def-pass') && myDist < 110;
      case 'tackle':
        return me.pos !== 'GK' && oppNearBall && oppCloser && myDist < 170 && myDist > 40;
      case 'sprint':
        return myDist < 45 && !oppCloser && goalDist > 280 && me.pos !== 'GK';
      case 'shockwave': {
        const near = opps.filter(o => len(o.x - me.x, o.y - me.y) < 170).length;
        return near >= 2 || (me.pos === 'GK' && oppNearBall && myDist < 140);
      }
    }
    return false;
  }

  plan(match, me) {
    const b = match.ball;
    const dir = match.attackDir(me.team);
    const ownGoal = match.goalCenter(me.team);
    const oppGoal = match.goalCenter(MCS.otherTeam(me.team));
    const gh = match.goalHalfWidth();
    const mates = match.players.filter(p => p.team === me.team && p !== me);
    const distTo = (o) => len(o.x - me.x, o.y - me.y);
    const myDist = distTo(b);
    const mateDists = mates.map(p => len(p.x - b.x, p.y - b.y));
    const nearestMateDist = Math.min(...mateDists);
    const ballInOwnHalf = dir > 0 ? b.x < W / 2 : b.x > W / 2;
    const pred = this.predictBall(match, 0.35);
    const noise = (amp) => (Math.sin(this.noiseSeed + match.tick * 0.013) * amp) / this.difficulty;
    const style = Teams.aiFor(match.sides ? match.sides[me.team] : null);
    this.dashRoll = Math.random();

    this.wantKick = false;
    this.wantDash = false;
    this.wantSkill = false;
    this.aim = null;

    // Pickups: grab one if it is close and the ball is not urgent.
    if (match.pickups.length && myDist > 220) {
      let best = null, bestD = 200;
      for (const pk of match.pickups) {
        const d = len(pk.x - me.x, pk.y - me.y);
        if (d < bestD) { bestD = d; best = pk; }
      }
      if (best && (me.pos !== 'GK' || len(best.x - ownGoal.x, best.y - ownGoal.y) < 260)) {
        this.target = { x: best.x, y: best.y };
        this.lastPlan = 'pickup';
        return;
      }
    }

    // Shooting / clearing target: aim for the far post, or clear upfield.
    const shootTarget = () => {
      const farPostY = me.y < H / 2 ? H / 2 + gh * 0.6 : H / 2 - gh * 0.6;
      return { x: oppGoal.x, y: farPostY + noise(40 * style.flair) };
    };
    const clearTarget = () => ({ x: oppGoal.x, y: b.y < H / 2 ? H * 0.15 : H * 0.85 });
    const opps = match.players.filter(p => p.team !== me.team);

    /** Is the straight line from the ball to `target` blocked by an opponent? */
    const laneBlocked = (target, width) => {
      const tx = target.x - b.x, ty = target.y - b.y, tl = len(tx, ty) || 1;
      for (const o of opps) {
        const ox = o.x - b.x, oy = o.y - b.y;
        const along = (ox * tx + oy * ty) / tl;
        if (along < 0 || along > tl) continue;
        const across = Math.abs(ox * ty - oy * tx) / tl;
        if (across < width + o.r) return true;
      }
      return false;
    };

    /**
     * Pick a pass target: a team-mate (never the keeper) who is in a free lane
     * and not worse placed than the ball. Returns null if shooting is better.
     */
    const passTarget = () => {
      let best = null, bestScore = -Infinity;
      for (const m of mates) {
        if (m.pos === 'GK') continue;
        const d = len(m.x - b.x, m.y - b.y);
        if (d < 120 || d > 520) continue;
        const lead = { x: m.x + m.vx * 0.25, y: m.y + m.vy * 0.25 };
        if (laneBlocked(lead, 14)) continue;
        const progress = (lead.x - b.x) * dir;                 // upfield gain
        const marked = opps.some(o => len(o.x - m.x, o.y - m.y) < 90) ? -120 : 0;
        const score = progress + marked - d * 0.2;
        if (score > bestScore) { bestScore = score; best = lead; }
      }
      return bestScore > -60 - style.passing * 90 ? best : null;
    };

    /** Keep a little distance from team-mates heading to the same spot. */
    const spaced = (t) => {
      for (const m of mates) {
        if (len(m.x - t.x, m.y - t.y) < 70 && len(m.x - b.x, m.y - b.y) < len(me.x - b.x, me.y - b.y)) {
          const side = me.y < m.y ? -1 : 1;
          return { x: t.x - dir * 40, y: t.y + side * 90 };
        }
      }
      return t;
    };

    /**
     * A kick travels roughly from me through the ball. Refuse to kick when
     * that line points at our own goal while we are in our own half.
     */
    const safeToKick = () => {
      if (!ballInOwnHalf) return true;
      const kx = b.x - me.x, ky = b.y - me.y, kl = len(kx, ky) || 1;
      const gx = ownGoal.x - b.x, gy = ownGoal.y - b.y, gl = len(gx, gy) || 1;
      const toward = (kx / kl) * (gx / gl) + (ky / kl) * (gy / gl);
      const nearGoal = gl < 320;
      return toward < (nearGoal ? -0.1 : 0.45);
    };

    /** Approach the ball from the side opposite to `aimAt`, then kick. */
    const attackBall = (aimAt, aggressive) => {
      let ax = aimAt.x - b.x, ay = aimAt.y - b.y;
      const al = len(ax, ay) || 1; ax /= al; ay /= al;
      const standOff = me.r + b.r + 6;
      let behind = { x: pred.x - ax * standOff, y: pred.y - ay * standOff };
      // Ball pinned on a wall: the spot "behind" it may be outside the arena.
      // Then stand between the ball and our goal instead and poke it along the wall.
      if (behind.x < me.r || behind.x > W - me.r || behind.y < me.r || behind.y > H - me.r) {
        let gx = b.x - ownGoal.x, gy = b.y - ownGoal.y; const gl = len(gx, gy) || 1; gx /= gl; gy /= gl;
        behind = { x: clamp(b.x - gx * standOff, me.r + 1, W - me.r - 1), y: clamp(b.y - gy * standOff, me.r + 1, H - me.r - 1) };
      }
      // Am I roughly behind the ball relative to the target?
      const mx = b.x - me.x, my = b.y - me.y, ml = len(mx, my) || 1;
      const alignment = (mx / ml) * ax + (my / ml) * ay;
      if (alignment > 0.55) {
        this.target = { x: pred.x, y: pred.y };
      } else {
        // Go around the ball rather than through it: if the straight path to
        // the "behind" spot passes close to the ball, sidestep perpendicular.
        const bx = behind.x - me.x, by = behind.y - me.y, bl = len(bx, by) || 1;
        const tproj = clamp((mx * bx + my * by) / (bl * bl), 0, 1);
        const cx = me.x + bx * tproj, cy = me.y + by * tproj;
        const clearance = len(b.x - cx, b.y - cy);
        if (clearance < standOff + 14 && myDist < standOff * 3) {
          const side = (mx * by - my * bx) > 0 ? -1 : 1; // which side of the path the ball is on
          this.target = { x: me.x + bx * 0.5 + (-by / bl) * side * 70, y: me.y + by * 0.5 + (bx / bl) * side * 70 };
        } else {
          this.target = behind;
        }
      }
      this.aim = aimAt;
      this.wantKick = myDist < me.r + b.r + 18 && alignment > 0.15 && safeToKick();
      if (aggressive && myDist > 160 && myDist < 420 && me.dashCooldown === 0 && this.dashRoll < style.dash) this.wantDash = true;
    };

    if (me.pos === 'GK') {
      const lineX = ownGoal.x + dir * (me.r + 4);
      const ballToGoal = len(b.x - ownGoal.x, b.y - ownGoal.y);
      const bsp = len(b.vx, b.vy);
      // "Coming" = moving toward our goal centre at a meaningful speed.
      const ballComing = bsp > 40 && ((ownGoal.x - b.x) * b.vx + (ownGoal.y - b.y) * b.vy) / (bsp * (ballToGoal || 1)) > 0.3;
      // Rush when the ball is in the box and slow, or rolling toward goal nearby.
      const meToGoal = len(me.x - ownGoal.x, me.y - ownGoal.y);
      // Rush only from the goal side of the ball, otherwise we'd shove it in.
      // Rush a slow ball in the box (never a fast one: hold the line instead).
      const rushRange = 150 + style.gkRush * 120, rushSpeed = 110 + style.gkRush * 90;
      // Loose ball on our goal line, behind the keeper (T-37): any touch from
      // in front would bundle it in, so come round to the centre side and
      // sweep it sideways out past the post instead.
      const minD = me.r + b.r;
      if ((b.x - me.x) * dir < 6 && Math.abs(b.x - ownGoal.x) < minD + 20 && Math.abs(b.y - H / 2) < gh + 12 && bsp < 260) {
        const side = b.y < H / 2 ? 1 : -1;            // stand on the centre side of the ball
        const lineIn = clamp(ownGoal.x + dir * (me.r + 1), me.r + 1, W - me.r - 1);
        const d = len(me.x - b.x, me.y - b.y);
        if ((me.y - b.y) * side > minD * 0.6) this.target = { x: lineIn, y: b.y };          // push it toward the post
        else if (d < minD + 10) this.target = { x: b.x + dir * (minD + 30), y: me.y };      // step off it first
        else this.target = { x: lineIn, y: b.y + side * (minD + 4) };                        // go round
        this.wantKick = false; this.aim = null;
        this.lastPlan = 'gk-sweep';
        return;
      }
      if (ballInOwnHalf && ballToGoal < rushRange && meToGoal < ballToGoal + 10 && (bsp < rushSpeed || ballToGoal < 70)) {
        attackBall(clearTarget(), ballComing);
        this.lastPlan = 'gk-rush';
        return;
      }
      // Hold the line between ball and goal centre.
      // Where will the ball cross our line? A keeper reads slow shots well but
      // is late on fast ones: blend between "follow the ball" and the true
      // intercept point depending on shot speed and skill.
      let intercept = pred.y;
      if (Math.abs(b.vx) > 20) {
        const t = (lineX - b.x) / b.vx;
        if (t > 0 && t < 2) intercept = b.y + b.vy * t;
      }
      const read = clamp(1.15 - bsp / (650 * this.difficulty), 0.15, 1);
      let ty = b.y + (intercept - b.y) * read;
      // Ball hugging our end wall: step onto its path.
      if (Math.abs(b.x - ownGoal.x) < 60 && Math.abs(b.vy) > 100) ty = b.y + Math.sign(b.vy) * 40;
      ty = clamp(ty, H / 2 - gh * 0.9, H / 2 + gh * 0.9);
      this.target = { x: lineX, y: ty + noise(22) };
      this.lastPlan = 'gk-line';
      this.wantKick = myDist < me.r + b.r + 16 && safeToKick();
      this.aim = clearTarget();
      return;
    }

    // MID: box-to-box link player (T-37). Wins the ball in the middle third,
    // moves it on to the forward, and shoots only from a clear look.
    if (me.pos === 'MID') {
      const iAmClosest = myDist <= nearestMateDist + 15;
      if (iAmClosest || myDist < 110 + style.press * 90) {
        const goalDist = len(oppGoal.x - b.x, oppGoal.y - b.y);
        const shot = shootTarget();
        let aimAt = null;
        if (goalDist < style.shootRange * 0.9 && !laneBlocked(shot, 30)) aimAt = shot;
        if (!aimAt) aimAt = passTarget();
        if (!aimAt) aimAt = ballInOwnHalf ? clearTarget() : { x: clamp(b.x + dir * 240, 0, W), y: H / 2 + (b.y - H / 2) * 0.5 };
        attackBall(aimAt, !ballInOwnHalf);
        this.lastPlan = aimAt === shot ? 'fwd-attack' : 'def-pass';
        return;
      }
      // Hold the middle: trail the ball upfield, shade toward its side,
      // and stay on the opposite flank to the forward's support run.
      const hx = clamp(b.x - dir * (90 - style.press * 40), W * 0.18, W * 0.82);
      const hy = H / 2 + (b.y - H / 2) * 0.45;
      this.target = spaced({ x: hx, y: hy + noise(14) });
      this.lastPlan = 'mid-hold';
      return;
    }

    if (me.pos === 'DEF') {
      const iAmClosest = myDist <= nearestMateDist + 10;
      const highPress = !ballInOwnHalf && style.press > 0.7 && iAmClosest && myDist < 260;
      if ((ballInOwnHalf && iAmClosest) || myDist < 90 + style.press * 110 || highPress) {
        const pass = passTarget();
        attackBall(pass || clearTarget(), ballInOwnHalf);
        this.lastPlan = pass ? 'def-pass' : 'def-challenge';
        return;
      }
      // Hold a covering position between ball and own goal.
      // How high the defender holds depends on the nation's defensive line.
      const gx = ownGoal.x + dir * (100 + style.defLine * 220);
      const t = 0.35 + style.defLine * 0.3;
      const cx = gx + (b.x - gx) * t;
      const cy = H / 2 + (b.y - H / 2) * 0.6;
      const maxAdvance = 0.5 + style.defLine * 0.3;   // fraction of the pitch the defender may reach
      const limitX = dir > 0 ? Math.min(cx, W * maxAdvance) : Math.max(cx, W * (1 - maxAdvance));
      this.target = spaced({ x: limitX, y: cy + noise(10) });
      this.lastPlan = 'def-cover';
      return;
    }

    // FWD
    const iAmClosest = myDist <= nearestMateDist + 20;
    if (iAmClosest || !ballInOwnHalf || myDist < 140 + style.press * 100) {
      const goalDist = len(oppGoal.x - b.x, oppGoal.y - b.y);
      const shot = shootTarget();
      let aimAt = shot;
      // Out of this nation's shooting range, blocked, or simply a passing side:
      // look for a pass unless we are holding a rocket kick.
      const passingMood = style.passing > 0.7 && goalDist > 260 && this.dashRoll < style.passing - 0.4;
      if (!me.effects.rocket && (goalDist > style.shootRange || laneBlocked(shot, 30) || passingMood)) {
        const pass = passTarget();
        if (pass) aimAt = pass;
      }
      attackBall(aimAt, true);
      this.lastPlan = aimAt === shot ? 'fwd-attack' : 'fwd-pass';
      return;
    }
    // Support: get ahead of the ball on the far side for a pass.
    const sx = clamp(b.x + dir * (140 + style.passing * 90), W * 0.12, W * 0.88);
    const sy = b.y < H / 2 ? H * 0.72 : H * 0.28;
    this.target = spaced({ x: sx, y: sy + noise(15) });
    this.lastPlan = 'fwd-support';
  }

  /**
   * Evaluated every tick (not just at re-plan time): would kicking the ball
   * right now send it toward our own goal? Uses the actual kick geometry,
   * i.e. the line from me through the ball, extended to our goal line.
   */
  kickSafeNow(match, me) {
    const b = match.ball;
    const dir = match.attackDir(me.team);
    const ownGoal = match.goalCenter(me.team);
    const gh = match.goalHalfWidth();
    const ballInOwnHalf = dir > 0 ? b.x < W / 2 : b.x > W / 2;
    if (!ballInOwnHalf) return true;
    let kx = b.x - me.x, ky = b.y - me.y; const kl = len(kx, ky) || 1; kx /= kl; ky /= kl;
    const backward = -kx * dir;                 // > 0 means toward our own end line
    if (backward <= 0.05) return true;
    const t = (ownGoal.x - b.x) / kx;           // distance along the ray to our end line
    const yAt = b.y + ky * t;
    if (Math.abs(yAt - H / 2) < gh + 45) return false;          // would cross into (or skim) the goal
    const toGoal = len(b.x - ownGoal.x, b.y - ownGoal.y);
    if (backward > 0.6 && toGoal < 300) return false;           // hammering it into our own end wall near the goal
    return true;
  }

  /** Returns an input object for this tick. */
  update(match, dt) {
    const me = match.player(this.slotId);
    const input = { up: false, down: false, left: false, right: false, kick: false, dash: false, aimX: null, aimY: null };
    if (!me || match.state === 'countdown' || match.state === 'goal' || match.state === 'ended') return input;

    this.difficulty = this.baseDifficulty * (match.rules.botSkill || 1);
    this.replanIn -= dt;
    if (this.replanIn <= 0) {
      this.replanIn = ((me.pos === 'GK' ? 0.14 : 0.1) + Math.random() * 0.06) / this.difficulty;
      this.think(match, me);
    }

    // Kickoff: only the kicking team's forward goes for the ball.
    if (match.state === 'kickoff') {
      // The forward takes the kickoff. If the forward is a human who dawdles,
      // the nearest bot team-mate steps up after a couple of seconds.
      const fwd = match.players.find(p => p.team === match.kickoffTeam && p.pos === 'FWD');
      let isKicker = me.team === match.kickoffTeam && me.pos === 'FWD';
      if (!isKicker && me.team === match.kickoffTeam && fwd && !fwd.isBot && match.kickoffTimer > 2) {
        const bots = match.players.filter(p => p.team === me.team && p.isBot);
        const nearest = bots.sort((a, b) => len(a.x - match.ball.x, a.y - match.ball.y) - len(b.x - match.ball.x, b.y - match.ball.y))[0];
        isKicker = nearest === me;
      }
      if (!isKicker) {
        // ease toward formation spot, don't crowd the circle
        const f = MCS.FORMATION[me.pos];
        const fx = me.team === 'red' ? f.fx * W : W - f.fx * W;
        const fy = me.team === 'red' ? f.fy * H : (1 - f.fy) * H;
        this.target = { x: fx, y: fy };
        this.wantKick = false; this.wantDash = false;
      } else {
        this.target = { x: match.ball.x, y: match.ball.y };
        this.wantKick = true;
        this.aim = { x: me.team === 'red' ? W * 0.75 : W * 0.25, y: me.y < H / 2 ? H * 0.7 : H * 0.3 };
      }
    }

    // Steer: convert target into digital directions with a dead zone that
    // shrinks as the bot slows down to avoid jitter.
    const dx = this.target.x - me.x, dy = this.target.y - me.y;
    const d = len(dx, dy);
    const dead = 6;
    if (d > dead) {
      // Lead the target by cancelling current velocity a bit (arrive smoothly).
      const brake = Math.min(1, d / 120);
      const sx = dx - me.vx * 0.12 * (1 - brake);
      const sy = dy - me.vy * 0.12 * (1 - brake);
      const thr = Math.max(4, d * 0.3);
      if (sx > thr) input.right = true; else if (sx < -thr) input.left = true;
      if (sy > thr) input.down = true; else if (sy < -thr) input.up = true;
    }
    input.kick = this.wantKick && this.kickSafeNow(match, me);
    input.dash = this.wantDash && match.rules.dashEnabled;
    input.skill = !!this.wantSkill && match.tick % 2 === 0;   // a fresh press every other tick
    if (this.aim) { input.aimX = this.aim.x; input.aimY = this.aim.y; }
    return input;
  }
}

module.exports = { BotBrain };
