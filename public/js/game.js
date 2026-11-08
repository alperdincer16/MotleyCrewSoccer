/**
 * public/js/game.js — in-match client: input, snapshot interpolation, HUD,
 * events → sound/FX, results, mid-match slot takeover.
 * Owner: Priya Natarajan (T-11 interpolation/input stream) & Sam Okafor (T-14 HUD/results)
 */
(function () {
  'use strict';
  const MCS = window.MCS;
  const { FIELD } = MCS;
  const INTERP_DELAY = 100; // ms behind the newest snapshot
  const INPUT_RATE = 30;

  class Game {
    constructor({ canvas, net, audio, ui }) {
      this.canvas = canvas; this.net = net; this.audio = audio; this.ui = ui;
      this.renderer = new Renderer(canvas);
      this.snaps = [];              // [{ recv, data }]
      this.rules = MCS.defaultRules();
      this.mySlot = null;
      this.room = null;
      this.active = false;
      this.keys = {};
      this.mouse = { x: null, y: null, down: false };
      this.touch = { dx: 0, dy: 0, kick: false, dash: false };
      this.lastInputSent = 0;
      this.lastInputJson = '';
      this.raf = null;
      this.lastFrame = 0;
      this.offsetMs = 0;            // smoothed server-time offset estimate
      this.el = {
        scoreRed: document.getElementById('scoreRed'), scoreBlue: document.getElementById('scoreBlue'),
        clock: document.getElementById('clock'), clockTag: document.getElementById('clockTag'),
        banner: document.getElementById('banner'), toasts: document.getElementById('toasts'),
        results: document.getElementById('results'), resultsTitle: document.getElementById('resultsTitle'),
        resRed: document.getElementById('resRed'), resBlue: document.getElementById('resBlue'),
        statsBody: document.querySelector('#statsTable tbody'),
        spectatorBar: document.getElementById('spectatorBar'), spectatorSlots: document.getElementById('spectatorSlots'),
        rematchHint: document.getElementById('rematchHint'), btnRematch: document.getElementById('btnRematch'),
        chatForm: document.getElementById('chatFormGame'), chatInput: document.getElementById('chatInputGame'),
        mobile: document.getElementById('mobileControls'),
      };
      this.bannerTimer = null;
      this.bindInput();
    }

    // ---- Lifecycle ----------------------------------------------------------
    start(rules) {
      this.rules = MCS.sanitizeRules(rules);
      this.renderer.setGoalWidth(this.rules.goalWidth);
      this.renderer.particles = [];
      this.snaps = [];
      this.active = true;
      this.el.results.classList.add('hidden');
      this.hideBanner();
      this.setScore(0, 0); this.setClock(this.rules.matchSeconds, '');
      this.canvas.focus && this.canvas.focus();
      if (!this.raf) this.loop(performance.now());
      if (this.isTouch()) this.el.mobile.classList.remove('hidden');
    }
    stop() {
      this.active = false;
      if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
      this.el.mobile.classList.add('hidden');
    }
    isTouch() { return matchMedia('(pointer: coarse)').matches; }

    setRoom(room) {
      this.room = room;
      const me = room && room.players.find(p => p.id === this.net.id);
      this.mySlot = me ? me.slot : null;
      this.updateSpectatorBar();
      if (room && room.status === 'ended') {
        this.el.btnRematch.disabled = room.hostId !== this.net.id;
        this.el.rematchHint.textContent = room.hostId === this.net.id ? '' : 'Waiting for the host to start a rematch…';
      }
    }

    updateSpectatorBar() {
      const bar = this.el.spectatorBar;
      if (!this.room || this.room.status !== 'playing' || this.mySlot) { bar.classList.add('hidden'); return; }
      bar.classList.remove('hidden');
      this.el.spectatorSlots.innerHTML = '';
      for (const [slot, pid] of Object.entries(this.room.slots)) {
        if (pid) continue;
        const b = document.createElement('button');
        const { team, pos } = MCS.parseSlot(slot);
        if (window.spriteAvatar) b.appendChild(window.spriteAvatar(team, pos, `${team.toUpperCase()} ${pos} bot`, 2));
        b.appendChild(document.createTextNode(`${team.toUpperCase()} ${pos}`));
        b.style.borderColor = team === 'red' ? 'var(--red)' : 'var(--blue)';
        b.onclick = () => this.net.send('pickSlot', { slot });
        this.el.spectatorSlots.appendChild(b);
      }
    }

    // ---- Snapshots ---------------------------------------------------------
    onSnapshot(snap) {
      const now = performance.now();
      this.snaps.push({ recv: now, data: snap });
      if (this.snaps.length > 60) this.snaps.shift();
      this.handleEvents(snap);
      this.setScore(snap.score.red, snap.score.blue);
      let tag = '';
      if (snap.sd) tag = 'SUDDEN DEATH';
      else if (snap.state === 'kickoff') tag = 'KICK OFF';
      this.setClock(snap.time, tag);
      if (snap.state === 'countdown' && snap.cd > 0) {
        if (this._lastCd !== snap.cd) { this._lastCd = snap.cd; this.showBanner(String(snap.cd), '', 'gold', 900); this.audio.countdown(snap.cd); }
      } else this._lastCd = 0;
    }

    /** Build an interpolated view INTERP_DELAY ms behind the latest snapshot. */
    view(now) {
      const s = this.snaps;
      if (s.length === 0) return null;
      if (s.length === 1) return s[0].data;
      const target = now - INTERP_DELAY;
      let a = s[0], b = s[1];
      for (let i = s.length - 1; i >= 1; i--) { if (s[i - 1].recv <= target) { a = s[i - 1]; b = s[i]; break; } }
      if (target >= s[s.length - 1].recv) {
        // Extrapolate a little from the newest snapshot (max 80 ms)
        const latest = s[s.length - 1].data;
        const dt = Math.min(0.08, (target - s[s.length - 1].recv) / 1000);
        return this.extrapolate(latest, dt);
      }
      const span = b.recv - a.recv || 1;
      const t = Math.min(1, Math.max(0, (target - a.recv) / span));
      return this.lerpSnap(a.data, b.data, t);
    }
    lerp(x, y, t) { return x + (y - x) * t; }
    lerpSnap(A, B, t) {
      const players = B.players.map((pb, i) => {
        const pa = A.players[i] && A.players[i].id === pb.id ? A.players[i] : pb;
        return Object.assign({}, pb, { x: this.lerp(pa.x, pb.x, t), y: this.lerp(pa.y, pb.y, t), r: this.lerp(pa.r, pb.r, t) });
      });
      const ball = Object.assign({}, B.ball, { x: this.lerp(A.ball.x, B.ball.x, t), y: this.lerp(A.ball.y, B.ball.y, t), r: this.lerp(A.ball.r, B.ball.r, t) });
      return Object.assign({}, B, { players, ball });
    }
    extrapolate(S, dt) {
      return Object.assign({}, S, {
        players: S.players.map(p => Object.assign({}, p, { x: p.x + p.vx * dt, y: p.y + p.vy * dt })),
        ball: Object.assign({}, S.ball, { x: S.ball.x + S.ball.vx * dt, y: S.ball.y + S.ball.vy * dt }),
      });
    }

    // ---- Events → FX/audio ------------------------------------------------
    handleEvents(snap) {
      const R = this.renderer;
      const myTeam = this.mySlot ? MCS.parseSlot(this.mySlot).team : null;
      for (const e of snap.events || []) {
        switch (e.type) {
          case 'kick': R.burst(e.x, e.y, { n: 6 + Math.round(e.power * 4), color: e.rocket ? '#ef476f' : '#fff', speed: 120 * e.power }); this.audio.kick(e.power, e.rocket); if (e.rocket) R.kickShake(8); break;
          case 'bounce': R.burst(e.x, e.y, { n: 4, color: 'rgba(255,255,255,.6)', speed: 60 }); this.audio.bounce(e.speed, e.post); break;
          case 'dash': R.burst(e.x, e.y, { n: 8, color: 'rgba(255,255,255,.5)', speed: 90 }); this.audio.dash(); break;
          case 'whistle': this.audio.whistle(false); if (!snap.sd) this.hideBanner(); break;
          case 'suddenDeath': this.showBanner('SUDDEN DEATH', 'Next goal wins', 'gold', 2500); this.audio.whistle(false); break;
          case 'spawn': R.burst(e.x, e.y, { n: 12, color: MCS.BOOSTS[e.boost].color, speed: 100 }); break;
          case 'pickup': {
            const b = MCS.BOOSTS[e.boost];
            R.burst(e.x, e.y, { n: 24, color: b.color, speed: 220, life: 0.7 });
            this.audio.pickup(); if (e.boost === 'freeze') this.audio.freeze();
            const who = this.playerName(e.slot);
            this.toast(`${b.icon} ${who} got ${b.label}`, e.team);
            break;
          }
          case 'goal': {
            const color = e.team === 'red' ? Renderer.COLORS.red : Renderer.COLORS.blue;
            R.confetti(e.x, e.y, color); R.kickShake(18);
            this.audio.goal(myTeam ? e.team === myTeam : true);
            const who = e.scorer ? this.playerName(e.scorer) : 'Nobody';
            const sub = e.ownGoal ? `Own goal by ${who}` : `${who}${e.assist ? ' · assist ' + this.playerName(e.assist) : ''}`;
            this.showBanner('GOAL!', sub, e.team, 2200);
            break;
          }
          case 'end': {
            this.audio.end();
            break;
          }
        }
      }
    }
    playerName(slot) {
      const s = this.snaps[this.snaps.length - 1];
      const p = s && s.data.players.find(p => p.id === slot);
      return p ? p.name : slot;
    }

    // ---- HUD ---------------------------------------------------------------
    setScore(r, b) { this.el.scoreRed.textContent = r; this.el.scoreBlue.textContent = b; }
    setClock(seconds, tag) {
      const s = Math.max(0, Math.ceil(seconds));
      this.el.clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      this.el.clockTag.textContent = tag;
    }
    showBanner(text, sub, cls, ms) {
      const b = this.el.banner;
      b.className = 'banner ' + (cls || '');
      b.innerHTML = ''; b.appendChild(document.createTextNode(text));
      if (sub) { const s = document.createElement('small'); s.textContent = sub; b.appendChild(s); }
      clearTimeout(this.bannerTimer);
      if (ms) this.bannerTimer = setTimeout(() => this.hideBanner(), ms);
    }
    hideBanner() { this.el.banner.classList.add('hidden'); }
    toast(text, team) {
      const t = document.createElement('div'); t.className = 'toast'; t.textContent = text;
      if (team) t.style.borderColor = team === 'red' ? 'var(--red)' : 'var(--blue)';
      this.el.toasts.appendChild(t);
      setTimeout(() => t.remove(), 3500);
    }

    showResults(res) {
      const myTeam = this.mySlot ? MCS.parseSlot(this.mySlot).team : null;
      let title = res.winner === 'draw' ? 'Draw' : `${res.winner === 'red' ? 'Red' : 'Blue'} wins`;
      if (myTeam) title = res.winner === 'draw' ? 'Draw' : res.winner === myTeam ? 'Victory!' : 'Defeat';
      this.el.resultsTitle.textContent = title + (res.suddenDeath ? ' (sudden death)' : '');
      this.el.resRed.textContent = res.score.red; this.el.resBlue.textContent = res.score.blue;
      const tb = this.el.statsBody; tb.innerHTML = '';
      for (const s of res.stats) {
        const tr = document.createElement('tr');
        const name = document.createElement('td'); name.className = s.team; name.textContent = `${s.pos} ${s.bot ? '🤖 ' : ''}${s.name}`;
        tr.appendChild(name);
        for (const v of [s.stats.goals + (s.stats.ownGoals ? ` (${s.stats.ownGoals} OG)` : ''), s.stats.assists, s.stats.kicks, s.stats.pickups]) {
          const td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
        }
        tb.appendChild(tr);
      }
      this.el.results.classList.remove('hidden');
      this.el.spectatorBar.classList.add('hidden');
    }

    // ---- Input -------------------------------------------------------------
    bindInput() {
      const c = this.canvas;
      window.addEventListener('keydown', (e) => {
        if (!this.active) return;
        if (document.activeElement === this.el.chatInput) {
          if (e.key === 'Escape') { this.el.chatForm.classList.add('hidden'); this.el.chatInput.blur(); }
          return;
        }
        if (e.key === 'Enter') { e.preventDefault(); this.el.chatForm.classList.remove('hidden'); this.el.chatInput.focus(); return; }
        if (e.key === 'm' || e.key === 'M') { const m = this.audio.toggleMute(); this.toast(m ? 'Sound off' : 'Sound on'); }
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Shift'].includes(e.key)) e.preventDefault();
        this.keys[e.code] = true;
      });
      window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
      window.addEventListener('blur', () => { this.keys = {}; this.mouse.down = false; });
      c.addEventListener('mousemove', (e) => { const p = this.toWorld(e); this.mouse.x = p.x; this.mouse.y = p.y; });
      c.addEventListener('mousedown', (e) => { if (e.button === 0) this.mouse.down = true; });
      window.addEventListener('mouseup', () => { this.mouse.down = false; });
      c.addEventListener('contextmenu', (e) => e.preventDefault());
      this.el.chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = this.el.chatInput.value.trim();
        if (text) this.net.send('chat', { text });
        this.el.chatInput.value = ''; this.el.chatForm.classList.add('hidden'); this.el.chatInput.blur();
      });
      this.bindTouch();
    }
    toWorld(e) {
      const r = this.canvas.getBoundingClientRect();
      const sx = this.canvas.width / r.width, sy = this.canvas.height / r.height;
      return { x: (e.clientX - r.left) * sx - FIELD.margin, y: (e.clientY - r.top) * sy - FIELD.margin };
    }
    bindTouch() {
      const joy = document.getElementById('joystick'), stick = document.getElementById('stick');
      let active = null;
      const center = () => { const r = joy.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, rad: r.width / 2 }; };
      joy.addEventListener('pointerdown', (e) => { active = e.pointerId; joy.setPointerCapture(e.pointerId); });
      joy.addEventListener('pointermove', (e) => {
        if (e.pointerId !== active) return;
        const c = center(); let dx = e.clientX - c.x, dy = e.clientY - c.y; const d = Math.hypot(dx, dy);
        if (d > c.rad) { dx = dx / d * c.rad; dy = dy / d * c.rad; }
        stick.style.transform = `translate(${dx}px, ${dy}px)`;
        this.touch.dx = dx / c.rad; this.touch.dy = dy / c.rad;
      });
      const end = (e) => { if (e.pointerId !== active) return; active = null; stick.style.transform = ''; this.touch.dx = 0; this.touch.dy = 0; };
      joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end);
      const hold = (id, key) => {
        const b = document.getElementById(id);
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.touch[key] = true; });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => b.addEventListener(ev, () => { this.touch[key] = false; }));
      };
      hold('mKick', 'kick'); hold('mDash', 'dash');
    }

    currentInput() {
      const k = this.keys;
      const input = {
        up: !!(k.KeyW || k.ArrowUp) || this.touch.dy < -0.3,
        down: !!(k.KeyS || k.ArrowDown) || this.touch.dy > 0.3,
        left: !!(k.KeyA || k.ArrowLeft) || this.touch.dx < -0.3,
        right: !!(k.KeyD || k.ArrowRight) || this.touch.dx > 0.3,
        kick: !!(k.Space || k.KeyX) || this.mouse.down || this.touch.kick,
        dash: !!(k.ShiftLeft || k.ShiftRight || k.KeyC) || this.touch.dash,
        aimX: this.mouse.x, aimY: this.mouse.y,
      };
      return input;
    }
    sendInput(now) {
      if (!this.mySlot || !this.net.id) return;
      const input = this.currentInput();
      const json = JSON.stringify([input.up, input.down, input.left, input.right, input.kick, input.dash]);
      const changed = json !== this.lastInputJson;
      const anyHeld = json.includes('true');
      // Changes go out immediately; while something is held (or the mouse aim
      // matters) we stream at INPUT_RATE; idle clients only send a keepalive.
      const interval = anyHeld ? 1000 / INPUT_RATE : 250;
      if (changed || now - this.lastInputSent >= interval) {
        this.net.send('input', input);
        this.lastInputSent = now; this.lastInputJson = json;
      }
    }

    // ---- Loop ---------------------------------------------------------------
    loop(now) {
      this.raf = requestAnimationFrame((t) => this.loop(t));
      const dt = Math.min(0.05, (now - (this.lastFrame || now)) / 1000);
      this.lastFrame = now;
      if (!this.active) return;
      this.sendInput(now);
      const view = this.view(now);
      this.renderer.draw(view, { mySlot: this.mySlot, dt });
    }
  }

  window.Game = Game;
})();
