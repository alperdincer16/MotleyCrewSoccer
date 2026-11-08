/**
 * public/js/crowd.js — animated pixel crowd in the stands.
 * Owner: Tomasz Nowak (T-26)
 *
 * Four stands surround the arena. Fans behind each goal support that side;
 * the long stands are split, home end left, away end right, with a few
 * neutrals mixed in. Every fan has a seat, a shirt colour and a phase. The
 * crowd reacts to the match:
 *   - tension: the closer and faster the ball travels toward a goal, the
 *     more both sets of fans bounce (anticipation / anxiety)
 *   - goal: the scorers' fans leap with arms up and wave flags, the
 *     conceding end goes quiet and still
 *   - post / near miss: a collective flinch (gasp)
 *   - pickup / rocket kick: a ripple of excitement
 *   - last ten seconds: rhythmic unison clapping
 *   - a Mexican wave travels around the ground when play is dull
 *   - full time: the winners' fans celebrate, the losers sit
 */
(function () {
  'use strict';
  const { FIELD } = window.MCS;
  const W = FIELD.width, H = FIELD.height, M = FIELD.margin;

  const NEUTRALS = ['#e9e4d6', '#c9c1b1', '#8d99ae', '#6c757d', '#f4a261', '#b5838d', '#2a9d8f', '#e9c46a', '#5a5a5a', '#3d405b'];
  const SKIN = ['#f8d3b0', '#efb98a', '#d0945f', '#a7683c', '#7a4a27', '#4e2e17'];

  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function shade(hex, f) { const [r, g, b] = hexToRgb(hex); const c = (v) => Math.max(0, Math.min(255, Math.round(v * f))); return `rgb(${c(r)},${c(g)},${c(b)})`; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  class Crowd {
    constructor() {
      this.fans = [];
      this.flags = [];
      this.time = 0;
      this.colors = { red: '#ff4d5e', blue: '#3aa0ff' };
      // Excitement per side (0..1) and modes
      this.excite = { red: 0.15, blue: 0.15 };
      this.target = { red: 0.15, blue: 0.15 };
      this.celebrate = { red: 0, blue: 0 };   // seconds left of goal celebration
      this.silence = { red: 0, blue: 0 };     // seconds left of stunned silence
      this.gaspT = 0;                          // seconds left of a flinch
      this.clap = false;                       // rhythmic clapping (last 10 s)
      this.finale = null;                      // 'red' | 'blue' | 'draw' after full time
      this.wave = null;                        // { t } Mexican wave progress 0..1
      this.dullFor = 0;
      this.build();
    }

    setColors(colors) {
      this.colors = colors;
      for (const f of this.fans) if (f.team) f.color = this.pickShirt(f.team, f.seed);
      for (const fl of this.flags) fl.color = this.colors[fl.team];
    }

    pickShirt(team, seed) {
      const base = this.colors[team];
      const v = seed < 0.35 ? 0.75 : seed < 0.7 ? 1.0 : 1.2;
      return shade(base, v);
    }

    /** Lay out seats. Rows are drawn back to front so nearer fans overlap. */
    build() {
      const fans = [];
      const addFan = (x, y, team, stand, perim) => {
        const seed = Math.random();
        const neutral = Math.random() < 0.22;
        fans.push({
          x: Math.round(x), y: Math.round(y), team: neutral ? null : team, seed, stand, perim,
          color: neutral ? NEUTRALS[Math.floor(Math.random() * NEUTRALS.length)] : this.pickShirt(team, seed),
          skin: SKIN[Math.floor(Math.random() * SKIN.length)],
          phase: Math.random() * Math.PI * 2, rate: rnd(0.8, 1.25), hat: Math.random() < 0.12,
        });
      };
      const depth0 = 44;      // distance from the arena edge to the front row's feet
      const rowGap = 23;      // rows are deep enough for the taller fans
      const rows = 3;
      const seat = 13;
      const pocketPad = 10;
      // North and south stands run the full width including the corners.
      // Home end is the left half, away end the right, with neutrals mixed in.
      const x0 = -M + 12, x1 = W + M - 12;
      for (let r = rows - 1; r >= 0; r--) {
        for (let x = x0; x <= x1; x += seat) {
          const jitter = rnd(-2, 2);
          const team = x < W / 2 ? (Math.random() < 0.85 ? 'red' : 'blue') : (Math.random() < 0.85 ? 'blue' : 'red');
          addFan(x + jitter, -depth0 - r * rowGap, team, 'north', ((x - x0) / (x1 - x0)) * 0.35);
        }
      }
      for (let r = rows - 1; r >= 0; r--) {
        for (let x = x1; x >= x0; x -= seat) {
          const jitter = rnd(-2, 2);
          const team = x < W / 2 ? (Math.random() < 0.85 ? 'red' : 'blue') : (Math.random() < 0.85 ? 'blue' : 'red');
          addFan(x + jitter, H + depth0 + r * rowGap + 16, team, 'south', 0.5 + ((x1 - x) / (x1 - x0)) * 0.35);
        }
      }
      // West (red end) and east (blue end) stands: columns behind the goals.
      const gh = 160 + pocketPad; // generous: skip seats that would sit in the goal pocket
      for (let r = rows - 1; r >= 0; r--) {
        for (let y = 14; y <= H - 14; y += seat) {
          const jitter = rnd(-2, 2);
          const inPocket = Math.abs(y - H / 2) < gh && r === 0;
          if (!inPocket) addFan(-depth0 - r * rowGap + 10, y + jitter + 12, 'red', 'west', 0.85 + ((H - y) / H) * 0.15);
          if (!inPocket) addFan(W + depth0 + r * rowGap - 10, y + jitter + 12, 'blue', 'east', 0.35 + (y / H) * 0.15);
        }
      }
      this.fans = fans;
      // Flags: a few per end, waved harder when excited.
      this.flags = [];
      for (let i = 0; i < 7; i++) {
        this.flags.push({ x: -depth0 - 24 - (i % 3) * 20, y: 40 + i * 90, team: 'red', color: this.colors.red, phase: Math.random() * 6 });
        this.flags.push({ x: W + depth0 + 24 + (i % 3) * 20, y: 40 + i * 90, team: 'blue', color: this.colors.blue, phase: Math.random() * 6 });
      }
      for (let i = 0; i < 6; i++) {
        this.flags.push({ x: 60 + i * 100, y: -depth0 - 48, team: 'red', color: this.colors.red, phase: Math.random() * 6 });
        this.flags.push({ x: W - 60 - i * 100, y: -depth0 - 48, team: 'blue', color: this.colors.blue, phase: Math.random() * 6 });
      }
    }

    // ---- Reactions -----------------------------------------------------------
    goal(team, ownGoal) {
      const other = team === 'red' ? 'blue' : 'red';
      this.celebrate[team] = ownGoal ? 2.5 : 3.8;
      this.silence[other] = 3.0;
      this.excite[team] = 1; this.excite[other] = 0;
      this.wave = null;
    }
    gasp() { this.gaspT = 0.7; this.excite.red = Math.min(1, this.excite.red + 0.35); this.excite.blue = Math.min(1, this.excite.blue + 0.35); }
    pulse(team, amount) { if (team) this.excite[team] = Math.min(1, this.excite[team] + amount); else { this.excite.red = Math.min(1, this.excite.red + amount); this.excite.blue = Math.min(1, this.excite.blue + amount); } }
    setClapping(on) { this.clap = on; }
    end(winner) { this.finale = winner; this.celebrate.red = 0; this.celebrate.blue = 0; this.silence.red = 0; this.silence.blue = 0; this.clap = false; }
    reset() { this.finale = null; this.celebrate = { red: 0, blue: 0 }; this.silence = { red: 0, blue: 0 }; this.excite = { red: 0.15, blue: 0.15 }; this.clap = false; this.wave = null; }

    /** Overall noise level 0..1 for the audio layer. */
    level() {
      const c = Math.max(this.celebrate.red, this.celebrate.blue) > 0 ? 1 : 0;
      return clamp(Math.max(this.excite.red, this.excite.blue) * 0.8 + c * 0.2 + (this.clap ? 0.2 : 0), 0, 1);
    }

    /**
     * Per-frame update. `view` is the interpolated match view (may be null).
     * Tension comes from where the ball is and where it is heading.
     */
    update(dt, view) {
      this.time += dt;
      let tension = { red: 0.15, blue: 0.15 };
      if (view && view.ball && (view.state === 'play' || view.state === 'kickoff')) {
        const b = view.ball;
        const sp = Math.hypot(b.vx, b.vy);
        for (const [team, gx] of [['red', 0], ['blue', W]]) {
          const dx = gx - b.x, dy = H / 2 - b.y, d = Math.hypot(dx, dy) || 1;
          const toward = sp > 1 ? Math.max(0, (dx * b.vx + dy * b.vy) / (d * sp)) : 0;
          const near = clamp(1 - d / 420, 0, 1);
          const danger = near * (0.45 + 0.55 * toward * clamp(sp / 500, 0, 1));
          // Ball near red's goal: blue fans anticipate (more), red fans fret (less).
          const other = team === 'red' ? 'blue' : 'red';
          tension[other] = Math.max(tension[other], 0.15 + danger * 0.85);
          tension[team] = Math.max(tension[team], 0.15 + danger * 0.55);
        }
        if (view.sd) { tension.red = Math.max(tension.red, 0.5); tension.blue = Math.max(tension.blue, 0.5); }
      }
      for (const t of ['red', 'blue']) {
        this.celebrate[t] = Math.max(0, this.celebrate[t] - dt);
        this.silence[t] = Math.max(0, this.silence[t] - dt);
        let target = tension[t];
        if (this.finale) target = this.finale === t ? 1 : this.finale === 'draw' ? 0.4 : 0.05;
        if (this.celebrate[t] > 0) target = 1;
        if (this.silence[t] > 0) target = 0;
        const rate = target > this.excite[t] ? 3.5 : 1.2;   // excitement spikes fast, fades slowly
        this.excite[t] += (target - this.excite[t]) * Math.min(1, dt * rate);
      }
      this.gaspT = Math.max(0, this.gaspT - dt);

      // Mexican wave when nothing much is happening.
      const dull = this.excite.red < 0.3 && this.excite.blue < 0.3 && !this.finale && !this.clap;
      this.dullFor = dull ? this.dullFor + dt : 0;
      if (this.wave) { this.wave.t += dt / 5.5; if (this.wave.t > 1.15) this.wave = null; }
      else if (this.dullFor > 9) { this.wave = { t: -0.05 }; this.dullFor = 0; }
    }

    /** Vertical offset (px, positive = up) and pose for one fan this frame. */
    pose(f) {
      const t = this.time;
      const team = f.team;
      const e = team ? this.excite[team] : (this.excite.red + this.excite.blue) / 2;
      let up = 0, arms = false;
      if (team && this.silence[team] > 0) return { up: 0, arms: false, slump: true };
      if (this.finale && team && this.finale !== team && this.finale !== 'draw') return { up: 0, arms: false, slump: true };
      if (this.clap) {
        // unison clap at 2 Hz: a quick hop on the beat
        const beat = (t * 2) % 1;
        up = beat < 0.25 ? Math.sin(beat / 0.25 * Math.PI) * 5 : 0;
        arms = beat < 0.3;
      } else if (team && (this.celebrate[team] > 0 || (this.finale === team))) {
        const jump = Math.sin(t * (5 + f.rate) + f.phase);
        up = Math.max(0, jump) * 11;
        arms = true;
      } else {
        const amp = 1 + e * 7, freq = 1.2 + e * 4;
        up = Math.max(0, Math.sin(t * freq * f.rate + f.phase)) * amp;
        arms = e > 0.75 && Math.sin(t * 3 + f.phase) > 0.2;
      }
      if (this.gaspT > 0) up -= 3 * Math.sin((0.7 - this.gaspT) / 0.7 * Math.PI); // flinch: duck then recover
      if (this.wave) {
        const d = f.perim - this.wave.t;
        if (d > -0.06 && d < 0.02) { const k = (0.02 - d) / 0.08; up += Math.sin(k * Math.PI) * 14; arms = k > 0.3 && k < 0.8; }
      }
      return { up, arms, slump: false };
    }

    draw(ctx) {
      const fans = this.fans;
      for (let i = 0; i < fans.length; i++) {
        const f = fans[i];
        const { up, arms, slump } = this.pose(f);
        const y = f.y - up;
        // body 10x8, head 6x6; slumped fans sit lower with a darker shirt
        const sl = slump ? 3 : 0;
        ctx.fillStyle = slump ? shade(f.color.startsWith('#') ? f.color : '#777777', 0.7) : f.color;
        ctx.fillRect(f.x - 5, y - 8 + sl, 10, 8);
        ctx.fillStyle = f.skin;
        ctx.fillRect(f.x - 3, y - 14 + sl, 6, 6);
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(f.x - 2, y - 11 + sl, 1, 1); ctx.fillRect(f.x + 1, y - 11 + sl, 1, 1);   // eyes
        if (f.hat) { ctx.fillStyle = f.team ? this.colors[f.team] : '#222'; ctx.fillRect(f.x - 3, y - 16 + sl, 6, 2); }
        if (arms) { ctx.fillStyle = f.skin; ctx.fillRect(f.x - 7, y - 18, 2, 7); ctx.fillRect(f.x + 5, y - 18, 2, 7); }
      }
      // Flags wave with excitement
      for (const fl of this.flags) {
        const e = this.excite[fl.team];
        const wobble = Math.sin(this.time * (2 + e * 6) + fl.phase) * (2 + e * 5);
        ctx.fillStyle = '#d9d9d9'; ctx.fillRect(fl.x, fl.y - 30, 2, 30);
        ctx.fillStyle = fl.color;
        ctx.beginPath(); ctx.moveTo(fl.x + 2, fl.y - 30); ctx.lineTo(fl.x + 18 + wobble, fl.y - 24 + wobble * 0.3); ctx.lineTo(fl.x + 2, fl.y - 17); ctx.closePath(); ctx.fill();
      }
    }
  }

  window.Crowd = Crowd;
})();
