/**
 * public/js/crowd.js — animated pixel crowd in the stands.
 * Owner: Tomasz Nowak (T-26, T-47 look and variety)
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

  // Casual clothes for neutrals and fans not in a shirt (T-47): jackets,
  // hoodies, denim, bright tees and a few loud ones.
  const NEUTRALS = ['#e9e4d6', '#c9c1b1', '#8d99ae', '#6c757d', '#f4a261', '#b5838d', '#2a9d8f', '#e9c46a', '#5a5a5a', '#3d405b',
    '#264653', '#e76f51', '#9b2226', '#005f73', '#ee9b00', '#bb3e03', '#3a5a40', '#588157', '#7b2cbf', '#ff70a6', '#70d6ff', '#ffd670',
    '#2b2d42', '#edf2f4', '#8a5a44', '#4361ee', '#f72585', '#1b263b', '#a3b18a', '#d4a373'];
  const SKIN = ['#f8d3b0', '#efb98a', '#d0945f', '#a7683c', '#7a4a27', '#4e2e17', '#f1c27d', '#e0ac69', '#c68642', '#8d5524'];
  const HAIR = ['#1c1c1c', '#2b1d14', '#3b2417', '#5a3825', '#7b4a2a', '#b07a3c', '#d9b25f', '#e8d6a0', '#a33b1f', '#c25a2b', '#8a8a8a', '#d9d9d9', '#1c1c1c', '#2b1d14'];
  const DYED = ['#ff4fa3', '#45b7ff', '#7cff6b', '#b46bff'];
  // Seat colours per location (see render.js VENUE_LOOK).
  const SEATS = {
    national: ['#3b4452', '#323a46'], oldtown: ['#7a2a1f', '#66231a'], seaside: ['#1594a8', '#e8f1f2'],
    alpine: ['#7a5232', '#694528'], rooftop: ['#30343b', '#3b3f47'], desert: ['#d89a55', '#c4883f'],
  };
  const SPRITE_W = 22, SPRITE_H = 30, FOOT = 26;   // fan sprite canvas; feet at (11, 26)

  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function shade(hex, f) { const [r, g, b] = hexToRgb(hex); const c = (v) => Math.max(0, Math.min(255, Math.round(v * f))); return `rgb(${c(r)},${c(g)},${c(b)})`; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lum(hex) { if (!hex || hex[0] !== '#') return 0.5; const [r, g, b] = hexToRgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
  /** Text colour for a banner: the second team colour if it contrasts, else black or white. */
  function readable(bg, alt) { const d = Math.abs(lum(bg) - lum(alt)); return d > 0.35 ? alt : lum(bg) > 0.55 ? '#111' : '#fff'; }

  class Crowd {
    constructor() {
      this.fans = [];
      this.flags = [];
      this.time = 0;
      this.colors = { red: '#ff4d5e', blue: '#3aa0ff' };
      this.venue = 'national'; this.kits = null; this.names = null;
      this.seatLayer = null; this.bannerLayer = null;
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

    /** Team colours (and full kits when known) for shirts, scarves, flags and banners. */
    setColors(colors, kits, names) {
      this.colors = colors;
      if (kits) this.kits = kits;
      if (names) this.names = names;
      for (const f of this.fans) f.sprites = null;     // redraw lazily in the new colours
      for (const fl of this.flags) fl.color = this.colors[fl.team];
      this.bannerLayer = null;
    }
    setVenue(v) { if (v !== this.venue) { this.venue = v; this.seatLayer = null; } }

    /** Main and second colour for a side, from the kit when we have it. */
    teamPair(team) {
      const k = this.kits && this.kits[team];
      if (k) return [k.j, k.k || '#ffffff', k.pattern];
      return [this.colors[team], '#ffffff', null];
    }

    /** A random look for one fan: build, clothes, hair, headwear, extras. */
    makeLook(team) {
      const r = Math.random;
      const kid = r() < 0.08;
      const look = {
        kid,
        bw: kid ? 7 : [8, 9, 10, 10, 11, 12][Math.floor(r() * 6)],
        th: kid ? 6 : 7 + Math.floor(r() * 3),
        skin: SKIN[Math.floor(r() * SKIN.length)],
        hair: r() < 0.04 ? DYED[Math.floor(r() * DYED.length)] : HAIR[Math.floor(r() * HAIR.length)],
        hairStyle: ['short', 'short', 'long', 'curly', 'bald', 'bun', 'mohawk'][Math.floor(r() * (kid ? 4 : 7))],
        head: null, extra: null, top: 'casual', casual: NEUTRALS[Math.floor(r() * NEUTRALS.length)],
        team,
      };
      if (team) {
        const x = r();
        look.top = x < 0.5 ? 'jersey' : x < 0.75 ? 'scarf' : 'casual';
        look.head = r() < 0.18 ? 'beanie' : r() < 0.12 ? 'cap' : null;
        if (r() < 0.1) look.extra = 'paint';
        if (r() < 0.05 && !kid) look.extra = 'wig';
      } else {
        look.head = r() < 0.12 ? 'cap' : r() < 0.06 ? 'sunhat' : null;
      }
      if (r() < 0.07 && !look.extra) look.extra = 'shades';
      return look;
    }

    /**
     * Draw one fan into a small sprite canvas. pose: 'sit' | 'up' (arms up,
     * scarf held overhead) | 'slump' (head down, colours dimmed).
     */
    renderFan(look, pose) {
      const c = document.createElement('canvas'); c.width = SPRITE_W; c.height = SPRITE_H;
      const g = c.getContext('2d');
      const cx = 11, foot = FOOT, bw = look.bw, th = look.th, hw = look.kid ? 5 : 6;
      const sl = pose === 'slump' ? 2 : 0;
      const [tc1, tc2, pattern] = look.team ? this.teamPair(look.team) : ['#888', '#fff', null];
      const top = look.top === 'jersey' ? tc1 : look.casual;
      const px = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
      const bx = cx - Math.floor(bw / 2), by = foot - th + sl;
      // Torso with a shaded lower edge and a lit shoulder line.
      px(bx, by, bw, th, top);
      px(bx, by + th - 2, bw, 2, shade(top.startsWith('#') ? top : '#888888', 0.72));
      px(bx + 1, by, bw - 2, 1, shade(top.startsWith('#') ? top : '#888888', 1.18));
      if (look.top === 'jersey') {
        if (pattern === 'stripes') for (let x = bx + 1; x < bx + bw; x += 3) px(x, by + 1, 1, th - 2, tc2);
        else if (pattern === 'band') px(bx, by + 2, bw, 2, tc2);
        else if (pattern === 'hoops') { px(bx, by + 1, bw, 1, tc2); px(bx, by + 4, bw, 1, tc2); }
        else px(bx, by, 2, 3, tc2), px(bx + bw - 2, by, 2, 3, tc2);   // sleeves / plain: contrast sleeves
      }
      // Head
      const hx = cx - Math.floor(hw / 2), hy = by - hw + 1 + (pose === 'slump' ? 1 : 0);
      px(hx, hy, hw, hw, look.skin);
      px(hx, hy + hw - 1, hw, 1, shade(look.skin, 0.85));
      // Hair
      const hc = look.hair;
      switch (look.hairStyle) {
        case 'short': px(hx, hy - 1, hw, 2, hc); break;
        case 'long': px(hx - 1, hy - 1, hw + 2, 2, hc); px(hx - 1, hy, 1, hw + 1, hc); px(hx + hw, hy, 1, hw + 1, hc); break;
        case 'curly': px(hx - 1, hy - 2, hw + 2, 3, hc); px(hx - 1, hy + 1, 1, 2, hc); px(hx + hw, hy + 1, 1, 2, hc); break;
        case 'bun': px(hx, hy - 1, hw, 2, hc); px(cx - 1, hy - 3, 3, 2, hc); break;
        case 'mohawk': px(cx - 1, hy - 3, 2, 4, hc); break;
        default: break; // bald
      }
      // Face
      if (pose !== 'slump') {
        if (look.extra === 'shades') px(hx, hy + 2, hw, 1, '#111');
        else { px(hx + 1, hy + 2, 1, 1, '#1a1a1a'); px(hx + hw - 2, hy + 2, 1, 1, '#1a1a1a'); }
        if (pose === 'up') px(cx - 1, hy + 4, 2, 1, '#5a1f1f');       // open mouth, cheering
        if (look.extra === 'paint') { px(hx, hy + 3, 1, 2, tc1); px(hx + hw - 1, hy + 3, 1, 2, tc2); }
      }
      // Headwear
      if (look.extra === 'wig') { px(hx - 2, hy - 3, hw + 4, 4, tc1); px(hx - 1, hy - 4, hw + 2, 1, tc2); }
      else if (look.head === 'beanie') { const bc = look.team ? tc1 : look.casual; px(hx, hy - 2, hw, 3, bc); px(hx, hy, hw, 1, look.team ? tc2 : '#fff'); px(cx - 1, hy - 4, 2, 2, look.team ? tc2 : '#fff'); }
      else if (look.head === 'cap') { const cc = look.team ? tc1 : NEUTRALS[(look.bw * 7) % NEUTRALS.length]; px(hx, hy - 2, hw, 3, cc); px(hx + hw - 1, hy, 3, 1, shade(cc.startsWith('#') ? cc : '#888888', 0.8)); }
      else if (look.head === 'sunhat') { px(hx - 2, hy - 1, hw + 4, 1, '#e8d6a0'); px(hx, hy - 3, hw, 2, '#e8d6a0'); }
      // Scarf round the neck, or held up over the head
      if (look.top === 'scarf' && pose !== 'up') { px(bx, by, bw, 2, tc1); for (let x = bx + 1; x < bx + bw; x += 3) px(x, by, 1, 2, tc2); px(bx + 1, by + 2, 2, 4, tc1); px(bx + 1, by + 5, 2, 1, tc2); }
      if (pose === 'up') {
        const sleeve = look.top === 'jersey' ? tc1 : look.casual;
        px(bx - 2, by - 8, 2, 8, sleeve); px(bx + bw, by - 8, 2, 8, sleeve);
        px(bx - 2, by - 10, 2, 2, look.skin); px(bx + bw, by - 10, 2, 2, look.skin);
        if (look.top === 'scarf') {
          const sy = by - 12, sw = bw + 4;
          px(bx - 2, sy, sw, 3, tc1); for (let x = bx - 1; x < bx - 2 + sw; x += 3) px(x, sy, 1, 3, tc2);
        }
      }
      if (pose === 'slump') { g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, 0, SPRITE_W, SPRITE_H); }
      return c;
    }

    spriteFor(f, pose) {
      if (!f.sprites) f.sprites = {};
      return f.sprites[pose] || (f.sprites[pose] = this.renderFan(f.look, pose));
    }

    /** Lay out seats. Rows are drawn back to front so nearer fans overlap. */
    build() {
      const fans = [];
      this.seats = [];
      const addFan = (x, y, team, stand, perim) => {
        this.seats.push({ x: Math.round(x), y: Math.round(y), stand });
        if (Math.random() < 0.06) return;   // the odd empty seat
        const neutral = Math.random() < 0.3;
        const t = neutral ? null : team;
        fans.push({
          x: Math.round(x), y: Math.round(y), team: t, seed: Math.random(), stand, perim,
          look: this.makeLook(t), sprites: null,
          phase: Math.random() * Math.PI * 2, rate: rnd(0.8, 1.25),
        });
      };
      const depth0 = 40;      // distance from the arena edge to the front row's feet
      const rowGap = 17;      // rows overlap: you see heads and shoulders behind
      const rows = 5;
      const seat = 12;
      const pocketPad = 10;
      // North and south stands run the full width including the corners.
      // Home end is the left half, away end the right, with neutrals mixed in.
      const x0 = -M + 10, x1 = W + M - 10;
      for (let r = rows - 1; r >= 0; r--) {
        for (let x = x0 + (r % 2) * 6; x <= x1; x += seat) {
          const team = x < W / 2 ? (Math.random() < 0.85 ? 'red' : 'blue') : (Math.random() < 0.85 ? 'blue' : 'red');
          addFan(x + rnd(-1, 1), -depth0 - r * rowGap, team, 'north', ((x - x0) / (x1 - x0)) * 0.35);
        }
      }
      for (let r = rows - 1; r >= 0; r--) {
        for (let x = x1 - (r % 2) * 6; x >= x0; x -= seat) {
          const team = x < W / 2 ? (Math.random() < 0.85 ? 'red' : 'blue') : (Math.random() < 0.85 ? 'blue' : 'red');
          addFan(x + rnd(-1, 1), H + depth0 + r * rowGap + 16, team, 'south', 0.5 + ((x1 - x) / (x1 - x0)) * 0.35);
        }
      }
      // West (red end) and east (blue end) stands: columns behind the goals.
      const gh = 160 + pocketPad; // generous: skip seats that would sit in the goal pocket
      for (let r = rows - 1; r >= 0; r--) {
        for (let y = 14 + (r % 2) * 6; y <= H - 14; y += seat) {
          const inPocket = Math.abs(y - H / 2) < gh && r === 0;
          if (!inPocket) addFan(-depth0 - r * rowGap + 8, y + 12, 'red', 'west', 0.85 + ((H - y) / H) * 0.15);
          if (!inPocket) addFan(W + depth0 + r * rowGap - 8, y + 12, 'blue', 'east', 0.35 + (y / H) * 0.15);
        }
      }
      // Fans further back are drawn first so the front rows overlap them.
      fans.sort((a, b) => a.y - b.y);
      this.fans = fans;
      // Flags: a few per end, waved harder when excited.
      this.flags = [];
      for (let i = 0; i < 7; i++) {
        this.flags.push({ x: -depth0 - 30 - (i % 3) * 22, y: 40 + i * 90, team: 'red', color: this.colors.red, phase: Math.random() * 6 });
        this.flags.push({ x: W + depth0 + 30 + (i % 3) * 22, y: 40 + i * 90, team: 'blue', color: this.colors.blue, phase: Math.random() * 6 });
      }
      for (let i = 0; i < 6; i++) {
        this.flags.push({ x: 60 + i * 100, y: -depth0 - 62, team: 'red', color: this.colors.red, phase: Math.random() * 6 });
        this.flags.push({ x: W - 60 - i * 100, y: -depth0 - 62, team: 'blue', color: this.colors.blue, phase: Math.random() * 6 });
      }
      // Banners hung over the front of the long stands.
      this.banners = [];
      for (const [x, team, txt] of [[W * 0.12, 'red', 0], [W * 0.33, 'red', 1], [W * 0.67, 'blue', 1], [W * 0.88, 'blue', 0]]) {
        this.banners.push({ x, y: -depth0 + 4, team, txt, stand: 'north' });
        this.banners.push({ x: W - x, y: H + depth0 + 20, team: team === 'red' ? 'blue' : 'red', txt: 1 - txt, stand: 'south' });
      }
      this.seatLayer = null; this.bannerLayer = null;
    }

    /** Static layer: rows of coloured seats (shows through gaps and empty seats). */
    buildSeatLayer() {
      const c = document.createElement('canvas'); c.width = W + 2 * M; c.height = H + 2 * M;
      const g = c.getContext('2d'); g.translate(M, M);
      const [s1, s2] = SEATS[this.venue] || SEATS.national;
      for (const st of this.seats) {
        const col = ((st.x + st.y) / 12 | 0) % 7 === 0 ? s2 : s1;
        g.fillStyle = shade(col, 0.8); g.fillRect(st.x - 5, st.y - 9, 10, 3);     // seat back
        g.fillStyle = col; g.fillRect(st.x - 5, st.y - 6, 10, 6);
        g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(st.x - 5, st.y - 1, 10, 1);
      }
      return c;
    }

    /** Static layer: team banners with nation names. */
    buildBannerLayer() {
      const c = document.createElement('canvas'); c.width = W + 2 * M; c.height = H + 2 * M;
      const g = c.getContext('2d'); g.translate(M, M);
      g.font = 'bold 9px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const b of this.banners) {
        const [c1, c2] = this.teamPair(b.team);
        const name = (this.names && this.names[b.team]) || (b.team === 'red' ? 'HOME' : 'AWAY');
        const text = b.txt ? `★ ${name} ★` : `GO ${name}!`;
        const w = Math.max(70, g.measureText(text).width + 18), h = 13;
        g.fillStyle = c1; g.fillRect(b.x - w / 2, b.y - h / 2, w, h);
        g.fillStyle = c2; g.fillRect(b.x - w / 2, b.y - h / 2, w, 2); g.fillRect(b.x - w / 2, b.y + h / 2 - 2, w, 2);
        g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(b.x - w / 2, b.y + h / 2, w, 2);
        g.fillStyle = readable(c1, c2); g.fillText(text, b.x, b.y + 0.5);
      }
      return c;
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
      if (!this.seatLayer) this.seatLayer = this.buildSeatLayer();
      ctx.drawImage(this.seatLayer, -M, -M);
      const fans = this.fans;
      for (let i = 0; i < fans.length; i++) {
        const f = fans[i];
        const { up, arms, slump } = this.pose(f);
        const img = this.spriteFor(f, slump ? 'slump' : arms ? 'up' : 'sit');
        ctx.drawImage(img, f.x - 11, Math.round(f.y - up) - FOOT);
      }
      if (!this.bannerLayer) this.bannerLayer = this.buildBannerLayer();
      ctx.drawImage(this.bannerLayer, -M, -M);
      // Flags wave with excitement
      for (const fl of this.flags) {
        const e = this.excite[fl.team];
        const wobble = Math.sin(this.time * (2 + e * 6) + fl.phase) * (2 + e * 5);
        const [c1, c2] = this.teamPair(fl.team);
        ctx.fillStyle = '#d9d9d9'; ctx.fillRect(fl.x, fl.y - 30, 2, 30);
        ctx.fillStyle = c1;
        ctx.beginPath(); ctx.moveTo(fl.x + 2, fl.y - 30); ctx.lineTo(fl.x + 20 + wobble, fl.y - 30 + wobble * 0.3); ctx.lineTo(fl.x + 20 + wobble, fl.y - 18 + wobble * 0.3); ctx.lineTo(fl.x + 2, fl.y - 18); ctx.closePath(); ctx.fill();
        ctx.fillStyle = c2;
        ctx.beginPath(); ctx.moveTo(fl.x + 2, fl.y - 26); ctx.lineTo(fl.x + 20 + wobble, fl.y - 26 + wobble * 0.3); ctx.lineTo(fl.x + 20 + wobble, fl.y - 22 + wobble * 0.3); ctx.lineTo(fl.x + 2, fl.y - 22); ctx.closePath(); ctx.fill();
      }
    }
  }

  window.Crowd = Crowd;
})();
