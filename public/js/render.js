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
  const FX = { speed: 1, rocket: 2, frozen: 4, shrink: 8, magnet: 16, shield: 32, slide: 64, sticky: 128, armed: 256, stun: 512 };
  const BF = { giant: 1, thunder: 2, fire: 4, laser: 8 };
  const ARMED_COLORS = { banana: '#ffe066', thunder: '#fff176', laser: '#4cc9f0' };
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
      this.time = 0;
      this.pitchCache = null;
      this.goalWidth = 180;
      this.facing = new Map();   // player id -> facing left?
      this.kits = null;          // { red, blue } resolved national kits
      this.teamColors = { red: COLORS.red, blue: COLORS.blue };
      this.arena = 'classic';
      this.rules = null;
      this.wind = { x: 0, y: 0 };
      this.windLines = [];
      this.callouts = new Map();  // player id -> { text, color, t }
      this.emotes = new Map();    // player id -> { text, color, t }
      this.rings = [];            // expanding rings (shockwaves, bumper hits)
      this.ballTrail = [];
    }

    setArena(a) { if (a !== this.arena) { this.arena = a || 'classic'; this.pitchCache = null; } }
    setWind(x, y) { this.wind.x = x; this.wind.y = y; }
    callout(id, text, color) { this.callouts.set(id, { text, color, t: 1.6 }); }
    emote(id, text, color) { this.emotes.set(id, { text, color, t: 2.2 }); }
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
      for (let i = this.rings.length - 1; i >= 0; i--) { const r = this.rings[i]; r.t -= dt; if (r.t <= 0) this.rings.splice(i, 1); }
      // Wind streaks drift across the pitch.
      const wf = Math.hypot(this.wind.x, this.wind.y);
      if (this.arena === 'wind' && wf > 5) {
        while (this.windLines.length < 26) this.windLines.push({ x: Math.random() * W, y: Math.random() * H, l: 20 + Math.random() * 50, a: Math.random() });
        for (const w of this.windLines) {
          w.x += this.wind.x * dt * 2.2; w.y += this.wind.y * dt * 2.2;
          if (w.x < -60) w.x = W + 40; if (w.x > W + 60) w.x = -40; if (w.y < -60) w.y = H + 40; if (w.y > H + 60) w.y = -40;
        }
      } else this.windLines.length = 0;
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
      // Stands: concrete terraces behind the hoardings, stepped rows.
      ctx.fillStyle = '#1a1f26'; ctx.fillRect(-M, -M, W + 2 * M, H + 2 * M);
      for (let r = 0; r < 3; r++) {
        const inset = 30 + r * 23;
        ctx.fillStyle = r % 2 ? '#20262e' : '#242b34';
        ctx.fillRect(-inset - 23, -inset - 23, W + 2 * (inset + 23), 23);
        ctx.fillRect(-inset - 23, H + inset, W + 2 * (inset + 23), 23);
        ctx.fillRect(-inset - 23, -inset, 23, H + 2 * inset);
        ctx.fillRect(W + inset, -inset, 23, H + 2 * inset);
      }
      // Hoardings: advertising boards between the wall and the front row.
      const boardY = [-28, H + 14];
      ctx.font = 'bold 10px system-ui, sans-serif'; ctx.textBaseline = 'middle';
      for (const by of boardY) {
        ctx.fillStyle = '#0f1318'; ctx.fillRect(-28, by, W + 56, 14);
        const texts = ['MOTLEY CREW SOCCER', this.teamNames.red, 'BOOSTS ON', this.teamNames.blue, '3 v 3', 'GOLDEN GOAL'];
        for (let i = 0; i < 6; i++) {
          const x0 = -28 + i * (W + 56) / 6;
          ctx.fillStyle = i % 2 ? '#1f2a36' : '#2a1f36'; ctx.fillRect(x0 + 2, by + 1, (W + 56) / 6 - 4, 12);
          ctx.fillStyle = i === 1 ? this.teamColors.red : i === 3 ? this.teamColors.blue : '#d7dde6';
          ctx.textAlign = 'center'; ctx.fillText(texts[i], x0 + (W + 56) / 12, by + 7);
        }
      }
      for (const bx of [-28, W + 14]) {
        ctx.fillStyle = '#0f1318'; ctx.fillRect(bx, -14, 14, H + 28);
        ctx.save(); ctx.translate(bx + 7, H / 2); ctx.rotate(bx < 0 ? -Math.PI / 2 : Math.PI / 2);
        ctx.fillStyle = bx < 0 ? this.teamColors.red : this.teamColors.blue; ctx.textAlign = 'center';
        ctx.fillText((bx < 0 ? this.teamNames.red : this.teamNames.blue) + ' END', 0, 0);
        ctx.restore();
      }
      // Arena walls (rounded rect) with goal pockets cut out
      const arena = new Path2D();
      arena.roundRect(-8, -8, W + 16, H + 16, cr + 8);
      ctx.fillStyle = COLORS.wallEdge; ctx.fill(arena);
      const inner = new Path2D(); inner.roundRect(0, 0, W, H, cr);
      // Grass
      ctx.save(); ctx.clip(inner);
      const surf = SURFACES[this.arena] || SURFACES.classic;
      ctx.fillStyle = surf.a; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = surf.b;
      const stripes = 12; for (let i = 0; i < stripes; i += 2) ctx.fillRect(i * W / stripes, 0, W / stripes, H);
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
      for (const p of sorted) this.drawBubbles(p);
      if (opts.replay) this.drawReplayOverlay();
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
      if (p.kf) frame = 3;
      else if (speed > 25) frame = Math.floor(this.time * (6 + speed / 40)) % 2 + 1;

      const scale = (p.r * 2 * 1.35) / Sprites.H;
      const feetY = p.y + p.r * 0.9;
      const sprite = { team, pos, name: p.name, frame, frozen: !!(fx & FX.frozen), kit: this.kits ? this.kits[team] : null, look: p.look || (this.looks && this.looks[p.id]) || null };
      const tilt = fx & FX.stun ? (flip ? -1.45 : 1.45) : fx & FX.slide ? (Math.atan2(p.vy, Math.abs(p.vx)) * 0.2 + (flip ? -1.05 : 1.05)) : (p.celebrate || 0);
      if (tilt) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(tilt);
        Sprites.draw(ctx, sprite, 0, p.r * 0.9, scale, flip);
        ctx.restore();
      } else Sprites.draw(ctx, sprite, p.x, feetY - (p.hop || 0), scale, flip);
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
      ctx.fillText(pos === 'GK' ? 'G' : pos === 'DEF' ? 'D' : 'F', p.x - tw / 2 - 10, top - 12);
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
      b = Object.assign({}, b, { r });
      ctx.save(); ctx.translate(b.x, by);
      ctx.beginPath(); ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.fillStyle = b.giant ? '#aef7df' : '#fff'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#333'; ctx.stroke();
      // pentagon patches
      ctx.rotate(this.ballSpin * Math.sign(b.vx || 1));
      ctx.fillStyle = '#222';
      for (let i = 0; i < 3; i++) {
        const a = i * Math.PI * 2 / 3;
        ctx.beginPath(); ctx.arc(Math.cos(a) * b.r * 0.5, Math.sin(a) * b.r * 0.5, b.r * 0.28, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
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

  Renderer.COLORS = COLORS;
  window.Renderer = Renderer;
})();
