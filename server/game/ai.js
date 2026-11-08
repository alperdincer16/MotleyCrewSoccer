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
const { FIELD, BALL_RADIUS } = MCS;
const W = FIELD.width;
const H = FIELD.height;

function len(x, y) { return Math.hypot(x, y); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

class BotBrain {
  constructor(slotId, difficulty = 1) {
    this.slotId = slotId;
    this.difficulty = difficulty;      // 0.6 easy .. 1.3 hard (affects reaction + aim noise)
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
    const drag = Math.pow(match.rules.ballDrag, 60 * t);
    // integral of v*drag^s ds approximated
    const k = (1 - drag) / Math.max(1e-6, -Math.log(match.rules.ballDrag) * 60);
    return { x: clamp(b.x + b.vx * k, 0, W), y: clamp(b.y + b.vy * k, 0, H) };
  }

  think(match, me) {
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

    this.wantKick = false;
    this.wantDash = false;
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
      return { x: oppGoal.x, y: farPostY + noise(40) };
    };
    const clearTarget = () => ({ x: oppGoal.x, y: b.y < H / 2 ? H * 0.15 : H * 0.85 });

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
      const behind = { x: pred.x - ax * standOff, y: pred.y - ay * standOff };
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
      if (aggressive && myDist > 160 && myDist < 420 && me.dashCooldown === 0) this.wantDash = true;
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
      if (ballInOwnHalf && ballToGoal < 230 && meToGoal < ballToGoal + 10 && (bsp < 180 || (ballComing && ballToGoal < 160))) {
        attackBall(clearTarget(), ballComing);
        this.lastPlan = 'gk-rush';
        return;
      }
      // Hold the line between ball and goal centre.
      let ty = pred.y;
      if (Math.abs(b.vx) > 20) {
        const t = (lineX - b.x) / b.vx;
        if (t > 0 && t < 2) ty = b.y + b.vy * t;
      }
      // Ball hugging our end wall: step onto its path.
      if (Math.abs(b.x - ownGoal.x) < 60 && Math.abs(b.vy) > 100) ty = b.y + Math.sign(b.vy) * 40;
      ty = clamp(ty, H / 2 - gh * 0.9, H / 2 + gh * 0.9);
      this.target = { x: lineX, y: ty + noise(8) };
      this.lastPlan = 'gk-line';
      this.wantKick = myDist < me.r + b.r + 16 && safeToKick();
      this.aim = clearTarget();
      return;
    }

    if (me.pos === 'DEF') {
      const iAmClosest = myDist <= nearestMateDist + 10;
      if ((ballInOwnHalf && iAmClosest) || myDist < 90) {
        attackBall(clearTarget(), ballInOwnHalf);
        this.lastPlan = 'def-challenge';
        return;
      }
      // Hold a covering position between ball and own goal.
      const gx = ownGoal.x + dir * 150;
      const t = 0.45;
      const cx = gx + (b.x - gx) * t;
      const cy = H / 2 + (b.y - H / 2) * 0.6;
      // Never stray past the halfway line by much.
      const limitX = dir > 0 ? Math.min(cx, W * 0.6) : Math.max(cx, W * 0.4);
      this.target = { x: limitX, y: cy + noise(10) };
      this.lastPlan = 'def-cover';
      return;
    }

    // FWD
    const iAmClosest = myDist <= nearestMateDist + 20;
    if (iAmClosest || !ballInOwnHalf || myDist < 140) {
      attackBall(shootTarget(), true);
      this.lastPlan = 'fwd-attack';
      return;
    }
    // Support: get ahead of the ball on the far side for a pass.
    const sx = clamp(b.x + dir * 180, W * 0.12, W * 0.88);
    const sy = b.y < H / 2 ? H * 0.72 : H * 0.28;
    this.target = { x: sx, y: sy + noise(15) };
    this.lastPlan = 'fwd-support';
  }

  /** Returns an input object for this tick. */
  update(match, dt) {
    const me = match.player(this.slotId);
    const input = { up: false, down: false, left: false, right: false, kick: false, dash: false, aimX: null, aimY: null };
    if (!me || match.state === 'countdown' || match.state === 'goal' || match.state === 'ended') return input;

    this.replanIn -= dt;
    if (this.replanIn <= 0) {
      this.replanIn = (0.1 + Math.random() * 0.06) / this.difficulty;
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
    input.kick = this.wantKick;
    input.dash = this.wantDash && match.rules.dashEnabled;
    if (this.aim) { input.aimX = this.aim.x; input.aimY = this.aim.y; }
    return input;
  }
}

module.exports = { BotBrain };
