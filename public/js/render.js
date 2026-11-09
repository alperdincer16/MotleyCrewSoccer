/**
 * public/js/render.js — Canvas renderer: pitch, players, ball, pickups, FX.
 * Owner: Tomasz Nowak (T-15)
 *
 * World coordinates are 1200×700 (see shared/rules.js). The canvas is
 * 1320×820: a 60-unit border all around so the goal pockets (depth 50)
 * and a little wall thickness fit on screen.
 */
(function () {
  'use strict';
  const { FIELD, BOOSTS, PLAYER_RADIUS } = window.MCS;
  const W = FIELD.width, H = FIELD.height, M = FIELD.margin;

  const COLORS = {
    red: '#ff4d5e', redDark: '#a8222f', blue: '#3aa0ff', blueDark: '#1b5fa8',
    grass1: '#2f8f46', grass2: '#2a8340', line: 'rgba(255,255,255,.85)',
    wall: '#1c2229', wallEdge: '#3a4654', net: 'rgba(255,255,255,.35)',
  };
  const FX = { speed: 1, rocket: 2, frozen: 4, shrink: 8, magnet: 16, shield: 32, slide: 64, sticky: 128, armed: 256, stun: 512, stumble: 1024 };
  const BF = { giant: 1, thunder: 2, fire: 4, laser: 8 };
  const ARMED_COLORS = { banana: '#ffe066', thunder: '#fff176', laser: '#4cc9f0' };
  // Locations (T-46): stands, hoardings, wall and the mowing pattern on grass.
  const VENUE_LOOK = {
    national: { tiers: ['#1a1f26', '#20262e', '#242b34'], board: '#0f1318', boardA: '#1f2a36', boardB: '#2a1f36', ink: '#d7dde6', wall: '#3a4654',
      grass: ['#2f8f46', '#2a8340'], mow: 'stripes', texts: ['MOTLEY CREW SOCCER', 'BOOSTS ON', 'GOLDEN GOAL'] },
    oldtown:  { tiers: ['#3a1d18', '#4a241d', '#552a21'], board: '#2b1712', boardA: '#efe6cf', boardB: '#d9cdb0', ink: '#5a2a1f', wall: '#7a4330',
      grass: ['#2c7a3c', '#27703a'], mow: 'narrow', texts: ['OLD TOWN FC · EST. 1911', 'PIES & BOVRIL', 'MIND THE TERRACE'] },
    seaside:  { tiers: ['#cfe0e4', '#b7d4da', '#9fc6ce'], board: '#0a3d47', boardA: '#11707f', boardB: '#0e5f6c', ink: '#f2fbfc', wall: '#e2cc97',
      grass: ['#3aa357', '#349650'], mow: 'diagonal', texts: ['SEASIDE ARENA', 'SURF & TURF', 'ICE CREAM ON THE PIER'] },
    alpine:   { tiers: ['#4a3220', '#5a3d27', '#6b4a2f'], board: '#18241b', boardA: '#2b3f2f', boardB: '#34503a', ink: '#f1f5ee', wall: '#6d7a6f',
      grass: ['#2f9a4c', '#288843'], mow: 'checker', texts: ['ALPINE PARK', 'HOT CHOCOLATE', 'GONDOLA TO THE GROUND'] },
    rooftop:  { tiers: ['#2a2d33', '#33373e', '#3c4048'], board: '#08080b', boardA: '#2a0d33', boardB: '#0d2a33', ink: '#ff5ad1', ink2: '#4cf0ff', wall: '#8a929c', fence: true,
      grass: ['#2c8a52', '#267d4a'], mow: 'stripes', texts: ['ROOFTOP CAGE', 'NO BALLS OVER THE EDGE', 'LEVEL 42'] },
    desert:   { tiers: ['#a8743f', '#b8834b', '#c69356'], board: '#4a2f16', boardA: '#7a4e24', boardB: '#6a431f', ink: '#ffe9c2', wall: '#c9a46b',
      grass: ['#4a9a3e', '#438c38'], mow: 'rings', texts: ['DESERT BOWL', 'STAY HYDRATED', 'OASIS SPRINGS'] },
  };
  // Pitch palettes per arena: two stripe colours, line colour, vignette strength.
  const SURFACES = {
    classic: { a: '#2f8f46', b: '#2a8340', line: 'rgba(255,255,255,.85)', vig: 0.25 },
    wind:    { a: '#3a9a4e', b: '#338b46', line: 'rgba(255,255,255,.85)', vig: 0.2 },
    bumpers: { a: '#1d2b53', b: '#1a2549', line: 'rgba(123,223,242,.85)', vig: 0.35 },
    ice:     { a: '#cfe8f3', b: '#bddbea', line: 'rgba(214,40,57,.75)', vig: 0.18 },
    mud:     { a: '#6b4a2b', b: '#5e4026', line: 'rgba(255,255,255,.6)', vig: 0.35 },
  };

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      canvas.width = W + 2 * M; canvas.height = H + 2 * M;
      this.ctx = canvas.getContext('2d');
      this.crowd = window.Crowd ? new Crowd() : null;
      this.teamNames = { red: 'RED', blue: 'BLUE' };
      this.particles = [];
      this.shake = 0;
      this.ballSpin = 0;
      this.ballRot = [1, 0, 0, 0, 1, 0, 0, 0, 1];   // ball orientation (row-major 3x3), rolled in drawBall
      this.time = 0;
      this.pitchCache = null;
      this.goalWidth = 180;
      this.facing = new Map();   // player id -> facing left?
      this.kits = null;          // { red, blue } resolved national kits
      this.teamColors = { red: COLORS.red, blue: COLORS.blue };
      this.arena = 'classic';
      this.weather = 'clear';
      this.venue = 'national';
      this.drops = [];           // rain streaks or snowflakes in canvas pixels (T-45)
      this.nightLayer = null;    // cached floodlight overlay
      this.rules = null;
      this.wind = { x: 0, y: 0 };
      this.windLines = [];
      this.callouts = new Map();  // player id -> { text, color, t }
      this.emotes = new Map();    // player id -> { text, color, t }
      this.rings = [];            // expanding rings (shockwaves, bumper hits)
      this.tackleAnims = new Map(); // player id -> { kind: 'lunge'|'stumble', t, dur, dx, dy } (T-43)
      this.ballTrail = [];
    }

    setArena(a) { if (a !== this.arena) { this.arena = a || 'classic'; this.pitchCache = null; } }
    setVenue(v) { v = VENUE_LOOK[v] ? v : 'national'; if (v !== this.venue) { this.venue = v; this.pitchCache = null; } }
    setWeather(w) { w = w || 'clear'; if (w !== this.weather) { this.weather = w; this.pitchCache = null; this.drops = []; this.nightLayer = null; } }
    setWind(x, y) { this.wind.x = x; this.wind.y = y; }
    callout(id, text, color) { this.callouts.set(id, { text, color, t: 1.6 }); }
    emote(id, text, color) { this.emotes.set(id, { text, color, t: 2.2 }); }
    /**
     * Tackle (T-43): the tackler lunges toward the ball with a motion smear,
     * the victim wobbles and hops with stars, dust and an impact ring at the
     * contact point, and a "TACKLE!" callout over the tackler.
     */
    tackleFx(e, color, ground) {
      this.tackleAnims.set(e.slot, { kind: 'lunge', t: 0, dur: 0.38, dx: e.dx || 0, dy: e.dy || 0 });
      if (e.victim) this.tackleAnims.set(e.victim, { kind: 'stumble', t: 0, dur: 0.6, dx: e.dx || 0, dy: e.dy || 0 });
      this.burst(e.x, e.y, { n: 16, color: ground, speed: 170, life: 0.55, size: 3 });
      this.burst(e.x, e.y, { n: 6, color: '#ffffff', speed: 240, life: 0.25, size: 2 });
      this.rings.push({ x: e.x, y: e.y, r: 8, max: 46, t: 0.25, life: 0.25, color: '#ffffff', w: 3 });
      this.callout(e.slot, 'TACKLE!', color);
    }
    /** Current tackle pose for a player: lean, offset, hop, smear strength. */
    tacklePose(id) {
      const a = this.tackleAnims.get(id);
      if (!a) return null;
      const u = Math.min(1, a.t / a.dur);
      if (a.kind === 'lunge') {
        const k = Math.sin(Math.PI * Math.min(1, u * 1.4));          // fast out, slower recovery
        return { kind: 'lunge', k, ox: a.dx * 12 * k, oy: a.dy * 12 * k, lean: 0.62 * k, hop: 0 };
      }
      const fade = 1 - u;
      return { kind: 'stumble', k: fade, ox: -a.dx * 6 * fade, oy: -a.dy * 6 * fade, lean: Math.sin(a.t * 28) * 0.38 * fade, hop: Math.abs(Math.sin(a.t * 14)) * 7 * fade };
    }
    bumperHit(x, y) { this.rings.push({ x, y, r: 26, max: 60, t: 0.3, life: 0.3, color: '#7bdff2', w: 4 }); }
    specialFx(x, y, kind, color) {
      if (kind === 'shockwave') {
        this.rings.push({ x, y, r: 20, max: 230, t: 0.45, life: 0.45, color: '#fff', w: 6 });
        this.rings.push({ x, y, r: 10, max: 180, t: 0.55, life: 0.55, color, w: 4 });
        this.burst(x, y, { n: 40, color, speed: 380, life: 0.6 });
      } else {
        this.rings.push({ x, y, r: 18, max: 70, t: 0.4, life: 0.4, color: ARMED_COLORS[kind] || color, w: 3 });
        this.burst(x, y, { n: 18, color: ARMED_COLORS[kind] || color, speed: 200, life: 0.5 });
      }
    }

    setGoalWidth(gw) { if (gw !== this.goalWidth) { this.goalWidth = gw; this.pitchCache = null; } }
    setTeams(kits, colors, names) {
      this.kits = kits; this.teamColors = colors; this.pitchCache = null;
      if (names) this.teamNames = names;
      if (this.crowd) this.crowd.setColors(colors);
    }

    // ---- Particles ---------------------------------------------------------
    burst(x, y, { n = 10, color = '#fff', speed = 180, life = 0.5, size = 3, gravity = 0 } = {}) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.8);
        this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, maxLife: life, color, size: size * (0.6 + Math.random() * 0.8), gravity });
      }
    }
    confetti(x, y, color) {
      for (let i = 0; i < 90; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, s = 300 + Math.random() * 500;
        this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1.6, maxLife: 1.6, color: Math.random() < 0.5 ? color : ['#ffd166', '#fff', '#06d6a0'][i % 3], size: 3 + Math.random() * 4, gravity: 900, rect: true });
      }
    }
    kickShake(amount) { this.shake = Math.max(this.shake, amount); }

    updateParticles(dt) {
      this.time += dt;
      this.shake *= Math.pow(0.02, dt);
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= dt;
        if (p.life <= 0) { this.particles.splice(i, 1); continue; }
        p.vy += (p.gravity || 0) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= Math.pow(0.3, dt); if (!p.gravity) p.vy *= Math.pow(0.3, dt);
      }
      for (const m of [this.callouts, this.emotes]) for (const [k, v] of m) { v.t -= dt; if (v.t <= 0) m.delete(k); }
      for (const [k, a] of this.tackleAnims) { a.t += dt; if (a.t >= a.dur) this.tackleAnims.delete(k); }
      for (let i = this.rings.length - 1; i >= 0; i--) { const r = this.rings[i]; r.t -= dt; if (r.t <= 0) this.rings.splice(i, 1); }
      // Wind streaks drift across the pitch.
      const wf = Math.hypot(this.wind.x, this.wind.y);
      if (this.weather === 'wind' && wf > 5) {
        while (this.windLines.length < 26) this.windLines.push({ x: Math.random() * W, y: Math.random() * H, l: 20 + Math.random() * 50, a: Math.random() });
        for (const w of this.windLines) {
          w.x += this.wind.x * dt * 2.2; w.y += this.wind.y * dt * 2.2;
          if (w.x < -60) w.x = W + 40; if (w.x > W + 60) w.x = -40; if (w.y < -60) w.y = H + 40; if (w.y > H + 60) w.y = -40;
        }
      } else this.windLines.length = 0;
      this.updateWeather(dt);
    }

    /** Mowing pattern in the second grass colour (fillStyle already set). */
    mowPattern(ctx, mow, base) {
      if (mow === 'narrow') { const n = 24; for (let i = 0; i < n; i += 2) ctx.fillRect(i * W / n, 0, W / n, H); }
      else if (mow === 'checker') { const nx = 12, ny = 8; for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if ((i + j) % 2) ctx.fillRect(i * W / nx, j * H / ny, W / nx, H / ny); }
      else if (mow === 'diagonal') {
        ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-Math.PI / 4);
        const d = Math.hypot(W, H), w = 70; for (let x = -d / 2; x < d / 2; x += w * 2) ctx.fillRect(x, -d / 2, w, d);
        ctx.restore();
      } else if (mow === 'rings') {
        const max = Math.hypot(W, H) / 2, w = 55, b = ctx.fillStyle;
        for (let k = Math.ceil(max / w); k > 0; k--) {
          ctx.beginPath(); ctx.arc(W / 2, H / 2, k * w, 0, Math.PI * 2);
          ctx.fillStyle = k % 2 ? b : base; ctx.fill();
        }
      } else { const n = 12; for (let i = 0; i < n; i += 2) ctx.fillRect(i * W / n, 0, W / n, H); }
    }

    // ---- Weather (T-45) -----------------------------------------------------
    updateWeather(dt) {
      const cw = this.canvas.width, ch = this.canvas.height, d = this.drops;
      if (this.weather === 'rain') {
        while (d.length < 260) d.push({ x: Math.random() * cw, y: Math.random() * ch, v: 900 + Math.random() * 500, l: 14 + Math.random() * 18, a: 0.3 + Math.random() * 0.35 });
        for (const r of d) {
          r.y += r.v * dt; r.x -= r.v * 0.18 * dt;
          if (r.y > ch) {
            if (Math.random() < 0.3 && this.rings.length < 40) this.rings.push({ x: Math.random() * W, y: Math.random() * H, r: 1, max: 7, t: 0.35, life: 0.35, color: 'rgba(200,225,255,.55)', w: 1 });
            r.y = -r.l; r.x = Math.random() * (cw + 200);
          }
        }
      } else if (this.weather === 'snow') {
        while (d.length < 140) d.push({ x: Math.random() * cw, y: Math.random() * ch, v: 40 + Math.random() * 60, s: 1.5 + Math.random() * 2.5, ph: Math.random() * 6.28, a: 0.5 + Math.random() * 0.45 });
        for (const f of d) {
          f.y += f.v * dt; f.ph += dt * 1.5; f.x += Math.sin(f.ph) * 18 * dt + this.wind.x * 0.1 * dt;
          if (f.y > ch + 4) { f.y = -4; f.x = Math.random() * cw; }
        }
      }
    }

    drawWeather() {
      const ctx = this.ctx, cw = this.canvas.width, ch = this.canvas.height;
      if (this.weather === 'night') {
        if (!this.nightLayer) this.nightLayer = this.buildNightLayer();
        ctx.drawImage(this.nightLayer, 0, 0);
        return;
      }
      if (this.weather === 'rain') {
        ctx.fillStyle = 'rgba(20,30,50,.16)'; ctx.fillRect(0, 0, cw, ch);
        ctx.lineWidth = 1.6; ctx.lineCap = 'round';
        for (const r of this.drops) {
          ctx.strokeStyle = `rgba(200,220,255,${r.a})`;
          ctx.beginPath(); ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + r.l * 0.18, r.y - r.l); ctx.stroke();
        }
      } else if (this.weather === 'snow') {
        ctx.fillStyle = 'rgba(220,235,255,.06)'; ctx.fillRect(0, 0, cw, ch);
        for (const f of this.drops) {
          ctx.fillStyle = `rgba(255,255,255,${f.a})`;
          ctx.beginPath(); ctx.arc(f.x, f.y, f.s, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    /** Dark sky with four corner floodlights and a lit pitch, cut out of a navy layer once. */
    buildNightLayer() {
      const c = document.createElement('canvas'); c.width = this.canvas.width; c.height = this.canvas.height;
      const g = c.getContext('2d');
      g.fillStyle = 'rgba(4,8,24,.78)'; g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = 'destination-out';
      const pools = [[M + W * 0.5, M + H * 0.5, W * 0.6, 0.5]];
      for (const [x, y] of [[M, M], [M + W, M], [M, M + H], [M + W, M + H]]) pools.push([x, y, W * 0.4, 0.35]);
      for (const [x, y, r, a] of pools) {
        const rg = g.createRadialGradient(x, y, 0, x, y, r);
        rg.addColorStop(0, `rgba(0,0,0,${a})`); rg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = rg; g.fillRect(0, 0, c.width, c.height);
      }
      g.globalCompositeOperation = 'source-over';
      // Floodlight pylons glowing in the corners of the stands.
      for (const [x, y] of [[M - 40, M - 40], [M + W + 40, M - 40], [M - 40, M + H + 40], [M + W + 40, M + H + 40]]) {
        const rg = g.createRadialGradient(x, y, 0, x, y, 70);
        rg.addColorStop(0, 'rgba(255,250,220,.9)'); rg.addColorStop(0.15, 'rgba(255,245,200,.45)'); rg.addColorStop(1, 'rgba(255,245,200,0)');
        g.fillStyle = rg; g.beginPath(); g.arc(x, y, 70, 0, Math.PI * 2); g.fill();
      }
      return c;
    }

    // ---- Static pitch (cached) ----------------------------------------------
    drawPitchToCache() {
      const c = document.createElement('canvas');
      c.width = this.canvas.width; c.height = this.canvas.height;
      const ctx = c.getContext('2d');
      const gh = this.goalWidth / 2, cr = FIELD.cornerRadius, gd = FIELD.goalDepth;

      // Floor around the arena
      ctx.fillStyle = '#0b0e12'; ctx.fillRect(0, 0, c.width, c.height);

      ctx.save(); ctx.translate(M, M);
      // Stands: terraces behind the hoardings, stepped rows, coloured by location.
      const look = VENUE_LOOK[this.venue] || VENUE_LOOK.national;
      ctx.fillStyle = look.tiers[0]; ctx.fillRect(-M, -M, W + 2 * M, H + 2 * M);
      for (let r = 0; r < 3; r++) {
        const inset = 30 + r * 23;
        ctx.fillStyle = r % 2 ? look.tiers[1] : look.tiers[2];
        ctx.fillRect(-inset - 23, -inset - 23, W + 2 * (inset + 23), 23);
        ctx.fillRect(-inset - 23, H + inset, W + 2 * (inset + 23), 23);
        ctx.fillRect(-inset - 23, -inset, 23, H + 2 * inset);
        ctx.fillRect(W + inset, -inset, 23, H + 2 * inset);
      }
      // Hoardings: advertising boards between the wall and the front row.
      const boardY = [-28, H + 14];
      ctx.font = 'bold 10px system-ui, sans-serif'; ctx.textBaseline = 'middle';
      for (const by of boardY) {
        ctx.fillStyle = look.board; ctx.fillRect(-28, by, W + 56, 14);
        const texts = [look.texts[0], this.teamNames.red, look.texts[1], this.teamNames.blue, '4 v 4', look.texts[2]];
        for (let i = 0; i < 6; i++) {
          const x0 = -28 + i * (W + 56) / 6;
          ctx.fillStyle = i % 2 ? look.boardA : look.boardB; ctx.fillRect(x0 + 2, by + 1, (W + 56) / 6 - 4, 12);
          if (look.fence) { ctx.shadowColor = i % 2 ? look.ink2 : look.ink; ctx.shadowBlur = 8; }
          ctx.fillStyle = i === 1 ? this.teamColors.red : i === 3 ? this.teamColors.blue : (look.ink2 && i % 2 ? look.ink2 : look.ink);
          ctx.textAlign = 'center'; ctx.fillText(texts[i], x0 + (W + 56) / 12, by + 7);
          ctx.shadowBlur = 0;
        }
      }
      for (const bx of [-28, W + 14]) {
        ctx.fillStyle = look.board; ctx.fillRect(bx, -14, 14, H + 28);
        ctx.save(); ctx.translate(bx + 7, H / 2); ctx.rotate(bx < 0 ? -Math.PI / 2 : Math.PI / 2);
        ctx.fillStyle = bx < 0 ? this.teamColors.red : this.teamColors.blue; ctx.textAlign = 'center';
        ctx.fillText((bx < 0 ? this.teamNames.red : this.teamNames.blue) + ' END', 0, 0);
        ctx.restore();
      }
      // Arena walls (rounded rect) with goal pockets cut out
      const arena = new Path2D();
      arena.roundRect(-8, -8, W + 16, H + 16, cr + 8);
      ctx.fillStyle = look.wall; ctx.fill(arena);
      if (look.fence) {
        // Rooftop: a chain-link fence just outside the wall.
        ctx.save(); ctx.strokeStyle = 'rgba(200,210,220,.35)'; ctx.lineWidth = 1;
        const fence = new Path2D(); fence.roundRect(-20, -20, W + 40, H + 40, cr + 20);
        ctx.setLineDash([3, 4]); ctx.lineWidth = 6; ctx.stroke(fence); ctx.setLineDash([]); ctx.restore();
      }
      const inner = new Path2D(); inner.roundRect(0, 0, W, H, cr);
      // Grass
      ctx.save(); ctx.clip(inner);
      const grassy = this.arena === 'classic' || !SURFACES[this.arena];
      const surf = grassy ? Object.assign({}, SURFACES.classic, { a: look.grass[0], b: look.grass[1] }) : SURFACES[this.arena];
      ctx.fillStyle = surf.a; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = surf.b;
      this.mowPattern(ctx, grassy ? look.mow : 'stripes', surf.a);
      if (this.arena === 'ice') {
        // skate scratches
        ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1;
        let seed = 7; const rr = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < 90; i++) { const x = rr() * W, y = rr() * H, l = 20 + rr() * 60, a = rr() * Math.PI; ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 8, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke(); }
      } else if (this.arena === 'mud') {
        let seed = 11; const rr = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < 26; i++) { ctx.fillStyle = i % 2 ? 'rgba(40,25,12,.45)' : 'rgba(120,90,60,.35)'; ctx.beginPath(); ctx.ellipse(rr() * W, rr() * H, 20 + rr() * 50, 10 + rr() * 22, rr() * 3, 0, Math.PI * 2); ctx.fill(); }
        for (let i = 0; i < 40; i++) { ctx.fillStyle = 'rgba(60,110,40,.5)'; ctx.fillRect(rr() * W, rr() * H, 3, 6); }
      } else if (this.arena === 'bumpers') {
        ctx.strokeStyle = 'rgba(123,223,242,.08)'; ctx.lineWidth = 1;
        for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
        for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
        // orbit guides
        ctx.strokeStyle = 'rgba(123,223,242,.18)'; ctx.setLineDash([6, 8]);
        for (const cx of [W * 0.3, W * 0.7]) { ctx.beginPath(); ctx.ellipse(cx, H / 2, Physics.FEEL.bumperOrbit, Physics.FEEL.bumperOrbit * 1.4, 0, 0, Math.PI * 2); ctx.stroke(); }
        ctx.setLineDash([]);
      }
      // Weather on the turf: a wet sheen in rain, a dusting of snow.
      if (this.weather === 'rain') {
        ctx.fillStyle = 'rgba(30,60,90,.18)'; ctx.fillRect(0, 0, W, H);
        let seed = 5; const rr = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < 22; i++) { ctx.fillStyle = 'rgba(160,200,230,.12)'; ctx.beginPath(); ctx.ellipse(rr() * W, rr() * H, 25 + rr() * 60, 8 + rr() * 18, 0, 0, Math.PI * 2); ctx.fill(); }
      } else if (this.weather === 'snow') {
        ctx.fillStyle = 'rgba(240,248,255,.28)'; ctx.fillRect(0, 0, W, H);
        let seed = 9; const rr = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        for (let i = 0; i < 500; i++) { ctx.fillStyle = `rgba(255,255,255,${0.3 + rr() * 0.5})`; ctx.fillRect(rr() * W, rr() * H, 2, 2); }
      }
      // subtle vignette
      const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, `rgba(0,0,0,${surf.vig})`);
      ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
      ctx.restore();

      // Lines
      ctx.strokeStyle = surf.line; ctx.lineWidth = 3; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 100, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 5, 0, Math.PI * 2); ctx.fillStyle = surf.line; ctx.fill();
      // Boxes
      const boxW = 170, boxH = gh * 2 + 160;
      ctx.strokeRect(0, H / 2 - boxH / 2, boxW, boxH); ctx.strokeRect(W - boxW, H / 2 - boxH / 2, boxW, boxH);
      ctx.beginPath(); ctx.arc(boxW, H / 2, 70, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(W - boxW, H / 2, 70, Math.PI / 2, Math.PI * 1.5); ctx.stroke();
      // Goal lines (the wall is open here)
      ctx.lineWidth = 3;

      // Goal pockets: cut the wall away and draw a net
      for (const side of [-1, 1]) {
        const x0 = side < 0 ? -gd : W, x1 = side < 0 ? 0 : W + gd;
        ctx.fillStyle = '#10151b'; ctx.fillRect(Math.min(x0, x1) - 8 * (side < 0 ? 1 : -1) * 0, H / 2 - gh, gd, gh * 2);
        ctx.fillStyle = '#0d1116';
        ctx.fillRect(side < 0 ? -gd - 8 : W, H / 2 - gh - 8, gd + 8, gh * 2 + 16);
        ctx.fillStyle = '#141a21'; ctx.fillRect(side < 0 ? -gd : W, H / 2 - gh, gd, gh * 2);
        // net mesh
        ctx.strokeStyle = COLORS.net; ctx.lineWidth = 1;
        for (let x = 0; x <= gd; x += 10) { ctx.beginPath(); ctx.moveTo((side < 0 ? -x : W + x), H / 2 - gh); ctx.lineTo((side < 0 ? -x : W + x), H / 2 + gh); ctx.stroke(); }
        for (let y = -gh; y <= gh; y += 10) { ctx.beginPath(); ctx.moveTo(side < 0 ? -gd : W, H / 2 + y); ctx.lineTo(side < 0 ? 0 : W + gd, H / 2 + y); ctx.stroke(); }
        // team colour strip on the back of the net
        ctx.fillStyle = side < 0 ? this.teamColors.red : this.teamColors.blue;
        ctx.fillRect(side < 0 ? -gd - 6 : W + gd, H / 2 - gh, 6, gh * 2);
        // posts
        for (const py of [H / 2 - gh, H / 2 + gh]) {
          ctx.beginPath(); ctx.arc(side < 0 ? 0 : W, py, 9, 0, Math.PI * 2);
          ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#999'; ctx.lineWidth = 2; ctx.stroke();
        }
      }
      ctx.restore();
      this.pitchCache = c;
    }

    // ---- Frame -------------------------------------------------------------
    /**
     * @param view  interpolated match view { players, ball, pickups, state, ... }
     * @param opts  { mySlot, dt }
     */
    draw(view, opts) {
      const ctx = this.ctx, dt = opts.dt || 0.016;
      this.updateParticles(dt);
      if (!this.pitchCache) this.drawPitchToCache();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
      ctx.drawImage(this.pitchCache, sx, sy);
      ctx.translate(M + sx, M + sy);
      if (this.crowd) { this.crowd.update(dt, view); this.crowd.draw(ctx); }
      if (!view) return;

      // Kickoff: dim the half the non-kicking team may not enter.
      if (view.state === 'kickoff' && view.ko) {
        ctx.fillStyle = 'rgba(255,255,255,.06)';
        ctx.fillRect(view.ko === 'red' ? 0 : W / 2, 0, W / 2, H);
      }

      this.drawWind();
      this.drawBumpers(view);
      for (const pk of view.pickups) this.drawPickup(pk);
      // Shadows (the ball's shadow stays on the ground and shrinks as it rises)
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      for (const p of view.players) { ctx.beginPath(); ctx.ellipse(p.x, p.y + p.r * 0.9, p.r * 0.95, p.r * 0.35, 0, 0, Math.PI * 2); ctx.fill(); }
      const bz = view.ball.z || 0, sh = Math.max(0.45, 1 - bz / 140);
      ctx.fillStyle = `rgba(0,0,0,${0.25 * sh})`;
      ctx.beginPath(); ctx.ellipse(view.ball.x + 3 + bz * 0.15, view.ball.y + 5, view.ball.r * sh, view.ball.r * 0.8 * sh, 0, 0, Math.PI * 2); ctx.fill();

      const sorted = view.players.slice().sort((a, b) => a.y - b.y);
      // A low ball is drawn among the players by depth; a high ball above them all.
      let ballDrawn = false;
      for (const p of sorted) {
        if (!ballDrawn && bz < 18 && view.ball.y < p.y) { this.drawBall(view.ball, dt); ballDrawn = true; }
        this.drawPlayer(p, p.id === opts.mySlot);
      }
      if (!ballDrawn) this.drawBall(view.ball, dt);
      this.drawRings();
      this.drawParticles();
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); this.drawWeather(); ctx.restore();
      for (const p of sorted) this.drawBubbles(p);
      if (opts.replay) this.drawReplayOverlay();
      if (opts.celebration && window.Celebrate) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        Celebrate.drawCard(ctx, opts.celebration, 24, this.canvas.height - 36 - 220);
      }
    }

    drawWind() {
      if (!this.windLines.length) return;
      const ctx = this.ctx, wf = Math.hypot(this.wind.x, this.wind.y) || 1;
      const ux = this.wind.x / wf, uy = this.wind.y / wf;
      ctx.lineWidth = 2; ctx.lineCap = 'round';
      for (const w of this.windLines) {
        ctx.strokeStyle = `rgba(255,255,255,${0.08 + w.a * 0.12})`;
        ctx.beginPath(); ctx.moveTo(w.x, w.y); ctx.lineTo(w.x - ux * w.l, w.y - uy * w.l); ctx.stroke();
      }
    }

    drawBumpers(view) {
      if (this.arena !== 'bumpers' || !this.rules) return;
      const ctx = this.ctx;
      for (const b of Physics.bumpersAt(this.rules, view.t || 0)) {
        const g = ctx.createRadialGradient(b.x, b.y, 4, b.x, b.y, b.r * 1.8);
        g.addColorStop(0, 'rgba(123,223,242,.5)'); g.addColorStop(1, 'rgba(123,223,242,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 1.8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#0d1b2a'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#7bdff2'; ctx.lineWidth = 4; ctx.stroke();
        ctx.fillStyle = '#ff5d8f'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.45, 0, Math.PI * 2); ctx.fill();
      }
    }

    drawRings() {
      const ctx = this.ctx;
      for (const r of this.rings) {
        const k = 1 - r.t / r.life;
        ctx.globalAlpha = Math.max(0, 1 - k);
        ctx.strokeStyle = r.color; ctx.lineWidth = r.w;
        ctx.beginPath(); ctx.arc(r.x, r.y, r.r + (r.max - r.r) * k, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    /** Signature-move callouts and quick-emote speech bubbles above players. */
    drawBubbles(p) {
      const ctx = this.ctx;
      const top = p.y - p.r * 2.1 - 30;
      const co = this.callouts.get(p.id);
      if (co) {
        const k = Math.min(1, (1.6 - co.t) * 6), rise = (1.6 - co.t) * 14;
        ctx.save(); ctx.globalAlpha = Math.min(1, co.t * 2);
        ctx.font = `900 ${Math.round(15 + 5 * k)}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.strokeText(co.text, p.x, top - 14 - rise);
        ctx.fillStyle = co.color; ctx.fillText(co.text, p.x, top - 14 - rise);
        ctx.restore();
      }
      const em = this.emotes.get(p.id);
      if (em) {
        ctx.save(); ctx.globalAlpha = Math.min(1, em.t * 3);
        ctx.font = 'bold 14px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const tw = ctx.measureText(em.text).width + 16, bx = p.x + 18, by = top - (co ? 34 : 6);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = em.color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect(bx - tw / 2, by - 13, tw, 26, 9); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bx - tw / 2 + 8, by + 12); ctx.lineTo(bx - tw / 2 + 2, by + 22); ctx.lineTo(bx - tw / 2 + 16, by + 12); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#111'; ctx.fillText(em.text, bx, by + 1);
        ctx.restore();
      }
    }

    drawReplayOverlay() {
      const ctx = this.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const cw = this.canvas.width, ch = this.canvas.height;
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(0, 0, cw, 36); ctx.fillRect(0, ch - 36, cw, 36);
      ctx.fillStyle = '#ffd166'; ctx.font = 'bold 18px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText('REPLAY', cw - 24, ch - 18);
      ctx.fillStyle = Math.sin(this.time * 6) > 0 ? '#ff4d5e' : 'rgba(255,77,94,.35)';
      ctx.beginPath(); ctx.arc(cw - 112, ch - 18, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      for (let y = 36; y < ch - 36; y += 6) ctx.fillRect(0, y, cw, 1);
    }

    drawPickup(pk) {
      const ctx = this.ctx, b = BOOSTS[pk.type]; if (!b) return;
      const pulse = 1 + Math.sin(this.time * 5 + pk.id) * 0.08;
      const r = 17 * pulse;
      const fade = pk.ttl < 4 ? (Math.sin(this.time * 12) > 0 ? 0.5 : 1) : 1;
      ctx.save(); ctx.globalAlpha = fade;
      const g = ctx.createRadialGradient(pk.x, pk.y, 2, pk.x, pk.y, r * 2.2);
      g.addColorStop(0, b.color + 'aa'); g.addColorStop(1, b.color + '00');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(pk.x, pk.y, r * 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#10151b'; ctx.beginPath(); ctx.arc(pk.x, pk.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = b.color; ctx.lineWidth = 3; ctx.stroke();
      ctx.font = `${Math.round(r * 1.1)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
      ctx.fillText(b.icon, pk.x, pk.y + 1);
      ctx.restore();
    }

    drawPlayer(p, isMe) {
      const ctx = this.ctx, team = p.id.split(':')[0], pos = p.id.split(':')[1];
      const fx = p.fx || 0;
      const speed = Math.hypot(p.vx, p.vy);

      // Effect auras under the body
      if (fx & FX.shield) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 7, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(72,202,228,.9)'; ctx.lineWidth = 3; ctx.setLineDash([6, 4]); ctx.lineDashOffset = -this.time * 40; ctx.stroke(); ctx.setLineDash([]); }
      if (fx & FX.magnet) { ctx.beginPath(); ctx.arc(p.x, p.y, 170, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,159,28,.25)'; ctx.lineWidth = 2; ctx.setLineDash([10, 10]); ctx.lineDashOffset = this.time * 60; ctx.stroke(); ctx.setLineDash([]); }
      if (fx & FX.speed) { for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.arc(p.x - p.vx * 0.012 * i, p.y - p.vy * 0.012 * i, p.r * (1 - i * 0.15), 0, Math.PI * 2); ctx.fillStyle = `rgba(255,209,102,${0.35 - i * 0.1})`; ctx.fill(); } }
      if (fx & FX.rocket) { const g = ctx.createRadialGradient(p.x, p.y, p.r, p.x, p.y, p.r * 2); g.addColorStop(0, 'rgba(239,71,111,.6)'); g.addColorStop(1, 'rgba(239,71,111,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 2, 0, Math.PI * 2); ctx.fill(); }
      if (fx & FX.armed && p.sp) {
        const c = ARMED_COLORS[p.sp] || '#fff', pulse = 1 + Math.sin(this.time * 10) * 0.12;
        const g = ctx.createRadialGradient(p.x, p.y, p.r * 0.6, p.x, p.y, p.r * 2.3 * pulse);
        g.addColorStop(0, c + 'aa'); g.addColorStop(1, c + '00');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 2.3 * pulse, 0, Math.PI * 2); ctx.fill();
      }
      if (fx & FX.sticky) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 10, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 2; ctx.setLineDash([3, 5]); ctx.lineDashOffset = -this.time * 80; ctx.stroke(); ctx.setLineDash([]); }
      if (fx & FX.slide && Math.random() < 0.7) this.particles.push({ x: p.x + (Math.random() - 0.5) * 10, y: p.y + p.r * 0.8, vx: -p.vx * 0.1, vy: -20 - Math.random() * 30, life: 0.4, maxLife: 0.4, color: this.arena === 'ice' ? '#ffffff' : this.arena === 'mud' ? '#4a3220' : '#7fbf6a', size: 3 });
      if (isMe) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 2, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,209,102,.45)'; ctx.lineWidth = 2; ctx.stroke(); }

      // Facing: remember the last horizontal direction so idle players don't flip.
      if (p.vx < -25) this.facing.set(p.id, true); else if (p.vx > 25) this.facing.set(p.id, false);
      const flip = !!this.facing.get(p.id);
      // Animation frame: kick pose while the kick flash is on, else walk cycle.
      let frame = 0;
      const tp = this.tacklePose(p.id);
      if (p.kf || (tp && tp.kind === 'lunge')) frame = 3;
      else if (speed > 25) frame = Math.floor(this.time * (6 + speed / 40)) % 2 + 1;

      const scale = (p.r * 2 * 1.35) / Sprites.H;
      const feetY = p.y + p.r * 0.9;
      const sprite = { team, pos, name: p.name, frame, frozen: !!(fx & FX.frozen), kit: this.kits ? this.kits[team] : null, look: p.look || (this.looks && this.looks[p.id]) || null };
      let tilt = fx & FX.stun ? (flip ? -1.45 : 1.45) : fx & FX.slide ? (Math.atan2(p.vy, Math.abs(p.vx)) * 0.2 + (flip ? -1.05 : 1.05)) : (p.celebrate || 0);
      // Tackle poses (T-43): lunge leans into the ball, stumble wobbles.
      let ox = 0, oy = 0, hop = p.hop || 0;
      if (tp && !(fx & (FX.stun | FX.slide))) {
        ox = tp.ox; oy = tp.oy; hop += tp.hop;
        if (tp.kind === 'lunge') {
          const fwd = tp.ox !== 0 ? Math.sign(tp.ox) : (flip ? -1 : 1);
          tilt += fwd * tp.lean;
          // Motion smear: two fading copies trailing the lunge.
          if (tp.k > 0.25) {
            for (let i = 2; i >= 1; i--) {
              ctx.save(); ctx.globalAlpha = 0.22 * tp.k / i;
              ctx.translate(p.x + ox - tp.ox * 0.55 * i, p.y + oy - tp.oy * 0.55 * i); ctx.rotate(tilt * 0.6);
              Sprites.draw(ctx, sprite, 0, p.r * 0.9, scale, fwd < 0);
              ctx.restore();
            }
          }
        } else tilt += tp.lean;
      }
      if (tilt) {
        ctx.save(); ctx.translate(p.x + ox, p.y + oy - hop); ctx.rotate(tilt);
        Sprites.draw(ctx, sprite, 0, p.r * 0.9, scale, tp && tp.kind === 'lunge' && tp.ox !== 0 ? tp.ox < 0 : flip);
        ctx.restore();
      } else Sprites.draw(ctx, sprite, p.x + ox, feetY + oy - hop, scale, flip);
      if (tp && tp.kind === 'stumble' && tp.k > 0.05) {
        for (let i = 0; i < 3; i++) {
          const a = this.time * 9 + i * 2.1;
          ctx.save(); ctx.globalAlpha = Math.min(1, tp.k * 1.5);
          ctx.fillStyle = '#ffd166'; ctx.font = '11px system-ui'; ctx.textAlign = 'center';
          ctx.fillText('★', p.x + ox + Math.cos(a) * 14, p.y + oy - p.r * 1.7 - hop + Math.sin(a) * 4);
          ctx.restore();
        }
      }
      if (fx & FX.stun) {
        for (let i = 0; i < 3; i++) {
          const a = this.time * 5 + i * 2.1;
          ctx.fillStyle = '#ffd166'; ctx.font = '12px system-ui'; ctx.textAlign = 'center';
          ctx.fillText('★', p.x + Math.cos(a) * 16, p.y - p.r * 0.6 + Math.sin(a) * 5);
        }
      }
      const top = feetY - Sprites.H * scale;

      // Name tag
      ctx.font = `${isMe ? 'bold ' : ''}12px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      const label = (p.bot ? '🤖 ' : '') + p.name;
      const tw = ctx.measureText(label).width + 10;
      ctx.beginPath(); ctx.roundRect(p.x - tw / 2, top - 20, tw, 16, 6); ctx.fill();
      ctx.fillStyle = isMe ? '#ffd166' : '#fff'; ctx.fillText(label, p.x, top - 8);
      // Position badge
      ctx.fillStyle = this.teamColors[team];
      ctx.beginPath(); ctx.roundRect(p.x - tw / 2 - 18, top - 20, 16, 16, 4); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 10px system-ui, sans-serif'; ctx.textBaseline = 'middle';
      ctx.fillText(pos[0], p.x - tw / 2 - 10, top - 12);
      ctx.textBaseline = 'alphabetic';

      // Local-player marker + dash cooldown arc
      if (isMe) {
        ctx.beginPath(); ctx.moveTo(p.x, top - 26); ctx.lineTo(p.x - 6, top - 34); ctx.lineTo(p.x + 6, top - 34); ctx.closePath();
        ctx.fillStyle = '#ffd166'; ctx.fill();
        if (p.dash > 0) {
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - p.dash));
          ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2; ctx.stroke();
        }
        // Charge bar under the feet while holding kick or lob.
        if (p.ch > 0) {
          const w = 44, x0 = p.x - w / 2, y0 = feetY + 8;
          ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x0 - 1, y0 - 1, w + 2, 7);
          ctx.fillStyle = p.ch >= 1 ? '#ff5d5d' : '#ffd166'; ctx.fillRect(x0, y0, w * p.ch, 5);
        }
        // Signature meter ready: pulsing gold ring.
        if (p.m >= 1 && !p.sp) {
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 9 + Math.sin(this.time * 8) * 2, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,209,102,.9)'; ctx.lineWidth = 3; ctx.stroke();
        }
      }
    }

    drawBall(b, dt) {
      const ctx = this.ctx;
      const speed = Math.hypot(b.vx, b.vy);
      this.ballSpin += speed * dt / Math.max(6, b.r);
      const z = b.z || 0, by = b.y - z, r = b.r * (1 + z / 160);
      const bf = b.bf || 0;
      // Trail: remember recent screen positions for curved / special shots.
      const tr = this.ballTrail;
      tr.push({ x: b.x, y: by });
      if (tr.length > 14) tr.shift();
      const trailColor = bf & BF.fire ? '255,140,40' : bf & BF.thunder ? '255,241,118' : bf & BF.laser ? '76,201,240' : Math.abs(b.spin || 0) > 0.5 ? '255,255,255' : null;
      if (trailColor && tr.length > 2) {
        ctx.lineCap = 'round';
        for (let i = 1; i < tr.length; i++) {
          ctx.strokeStyle = `rgba(${trailColor},${(i / tr.length) * 0.55})`; ctx.lineWidth = r * 1.4 * (i / tr.length);
          ctx.beginPath(); ctx.moveTo(tr[i - 1].x, tr[i - 1].y); ctx.lineTo(tr[i].x, tr[i].y); ctx.stroke();
        }
        if (bf & (BF.fire | BF.thunder) && Math.random() < 0.8) this.particles.push({ x: b.x, y: by, vx: (Math.random() - 0.5) * 80, vy: (Math.random() - 0.5) * 80, life: 0.35, maxLife: 0.35, color: bf & BF.fire ? '#ff9f1c' : '#fff176', size: 4 });
      } else if (speed > 350) {
        // motion blur streak
        ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = r * 1.2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(b.x, by); ctx.lineTo(b.x - b.vx * 0.03, by - b.vy * 0.03); ctx.stroke();
      }
      // Roll the 3D orientation: moving along v spins the ball about (-vy, vx, 0).
      if (speed > 1 && dt > 0) rotateBall(this.ballRot, -b.vy / speed, b.vx / speed, 0, speed * dt / Math.max(6, b.r));
      if (b.spin && dt > 0) rotateBall(this.ballRot, 0, 0, 1, b.spin * dt * 2); // sidespin on curved shots
      drawSoccerBall(ctx, b.x, by, r, this.ballRot, b.giant);
    }

    drawParticles() {
      const ctx = this.ctx;
      for (const p of this.particles) {
        ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
        ctx.fillStyle = p.color;
        if (p.rect) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.life * 6); ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore(); }
        else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.life / p.maxLife), 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
    }
  }

  // ---- Soccer ball (T-36) -------------------------------------------------
  // A truncated icosahedron: 12 black pentagons sit on the icosahedron's
  // vertices, and each pentagon corner lies a third of the way along an edge.
  const BALL = (() => {
    const t = (1 + Math.sqrt(5)) / 2, raw = [];
    for (const a of [-1, 1]) for (const b of [-t, t]) raw.push([0, a, b], [a, b, 0], [b, 0, a]);
    const n = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
    const V = raw.map(n);
    const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
    const edge = Math.min(...V.slice(1).map(v => d2(V[0], v)));
    const lerp = (p, q, f) => n([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f]);
    const pentagons = [], seams = [];
    V.forEach((c, i) => {
      const nb = V.map((v, j) => j).filter(j => j !== i && Math.abs(d2(c, V[j]) - edge) < 1e-6);
      // Order the five neighbours around the centre so the corners form a polygon.
      const u = n(V[nb[0]].map((x, k) => x - c[k] * (c[0] * V[nb[0]][0] + c[1] * V[nb[0]][1] + c[2] * V[nb[0]][2])));
      const w = [c[1] * u[2] - c[2] * u[1], c[2] * u[0] - c[0] * u[2], c[0] * u[1] - c[1] * u[0]];
      nb.sort((p, q) => Math.atan2(dot(V[p], w), dot(V[p], u)) - Math.atan2(dot(V[q], w), dot(V[q], u)));
      pentagons.push({ c, pts: nb.map(j => lerp(c, V[j], 1 / 3)) });
      for (const j of nb) if (j > i) seams.push([lerp(c, V[j], 1 / 3), lerp(c, V[j], 2 / 3)]);
    });
    function dot(p, q) { return p[0] * q[0] + p[1] * q[1] + p[2] * q[2]; }
    return { pentagons, seams };
  })();

  /** Pre-multiply the orientation matrix M by a rotation of `ang` about axis (x, y, z). */
  function rotateBall(M, x, y, z, ang) {
    const c = Math.cos(ang), s = Math.sin(ang), k = 1 - c;
    const R = [c + x * x * k, x * y * k - z * s, x * z * k + y * s,
               y * x * k + z * s, c + y * y * k, y * z * k - x * s,
               z * x * k - y * s, z * y * k + x * s, c + z * z * k];
    const out = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[i * 3 + j] = R[i * 3] * M[j] + R[i * 3 + 1] * M[3 + j] + R[i * 3 + 2] * M[6 + j];
    // Re-orthonormalise the rows so rounding never skews the ball.
    const r0 = out.slice(0, 3), r1 = out.slice(3, 6);
    const l0 = Math.hypot(...r0); for (let i = 0; i < 3; i++) r0[i] /= l0;
    const d = r0[0] * r1[0] + r0[1] * r1[1] + r0[2] * r1[2]; for (let i = 0; i < 3; i++) r1[i] -= d * r0[i];
    const l1 = Math.hypot(...r1); for (let i = 0; i < 3; i++) r1[i] /= l1;
    const r2 = [r0[1] * r1[2] - r0[2] * r1[1], r0[2] * r1[0] - r0[0] * r1[2], r0[0] * r1[1] - r0[1] * r1[0]];
    M.splice(0, 9, ...r0, ...r1, ...r2);
  }

  /** Draw a shaded black-and-white ball of radius r at (x, y), oriented by M; z points at the viewer. */
  function drawSoccerBall(ctx, x, y, r, M, giant) {
    const P = (v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
    // Points just behind the rim are pulled onto it so edge patches wrap round.
    const S = (q) => { if (q[2] >= 0) return [q[0] * r, q[1] * r]; const l = Math.hypot(q[0], q[1]) || 1; return [q[0] / l * r, q[1] / l * r]; };
    ctx.save(); ctx.translate(x, y);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = giant ? '#c8fbea' : '#fbfbfb'; ctx.fill();
    ctx.save(); ctx.clip();
    // Hexagon seams
    ctx.strokeStyle = 'rgba(40,40,48,.45)'; ctx.lineWidth = Math.max(0.6, r * 0.06);
    ctx.beginPath();
    for (const [a, b] of BALL.seams) {
      const pa = P(a), pb = P(b);
      if (pa[2] < -0.05 && pb[2] < -0.05) continue;
      const sa = S(pa), sb = S(pb); ctx.moveTo(sa[0], sa[1]); ctx.lineTo(sb[0], sb[1]);
    }
    ctx.stroke();
    // Black pentagons
    ctx.fillStyle = giant ? '#1f6f5a' : '#16161c';
    for (const pg of BALL.pentagons) {
      if (P(pg.c)[2] < -0.2) continue;
      ctx.beginPath();
      pg.pts.forEach((v, i) => { const sp = S(P(v)); if (i) ctx.lineTo(sp[0], sp[1]); else ctx.moveTo(sp[0], sp[1]); });
      ctx.closePath(); ctx.fill();
    }
    // Light from the top left: soft shading plus a highlight.
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    g.addColorStop(0, 'rgba(255,255,255,.35)'); g.addColorStop(0.55, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,.38)');
    ctx.fillStyle = g; ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, Math.min(2, r * 0.1)); ctx.strokeStyle = 'rgba(20,20,26,.8)'; ctx.stroke();
    ctx.restore();
  }
  Renderer.drawSoccerBall = drawSoccerBall;

  Renderer.COLORS = COLORS;
  window.Renderer = Renderer;
})();
