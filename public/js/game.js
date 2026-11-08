/**
 * public/js/game.js — in-match client: input, snapshot interpolation with
 * adaptive delay, local-player prediction, instant replay, HUD, events →
 * sound/FX, results, mid-match slot takeover.
 * Owner: Priya Natarajan (T-11, T-21 prediction) & Sam Okafor (T-14 HUD/results)
 */
(function () {
  'use strict';
  const MCS = window.MCS;
  const Physics = window.Physics;
  const Teams = window.Teams;
  const { FIELD } = MCS;
  const INPUT_RATE = 30;
  const FX = { speed: 1, rocket: 2, frozen: 4, shrink: 8, magnet: 16, shield: 32 };
  const SIM_DT = 1 / MCS.TICK_RATE;

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
      // Interpolation delay adapts to measured snapshot jitter.
      this.interp = { delay: 100, meanGap: 33, jitter: 0, lastRecv: 0 };
      // Server clock mapping: min-filtered (recv - tickTime) ≈ one-way latency + fixed delays.
      this.clock = { offset: null };
      // Prediction state
      this.inputHistory = [];       // [{ t, input }] local timestamps
      this.predErr = { x: 0, y: 0 };
      this.lastPred = null;
      this.predictionEnabled = localStorage.getItem('mcs.predict') !== '0';
      // Replay state
      this.replay = null;           // { snaps, start, duration, span }
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
        mobile: document.getElementById('mobileControls'), netInfo: document.getElementById('netInfo'),
        hud: document.getElementById('hud'),
      };
      this.bannerTimer = null;
      this._lastClockSecond = -1;
      this.bindInput();
    }

    // ---- Lifecycle ----------------------------------------------------------
    start(rules, sides) {
      this.rules = MCS.sanitizeRules(rules);
      this.setSides(sides || (this.room && this.room.sides));
      this.renderer.setGoalWidth(this.rules.goalWidth);
      this.renderer.particles = [];
      this.snaps = []; this.inputHistory = []; this.replay = null; this.lastPred = null; this.clock.offset = null;
      this.predErr = { x: 0, y: 0 };
      this.active = true;
      this.el.results.classList.add('hidden');
      this.hideBanner();
      this.setScore(0, 0); this.setClock(this.rules.matchSeconds, '');
      if (!this.raf) this.loop(performance.now());
      if (this.isTouch()) this.el.mobile.classList.remove('hidden');
    }
    setSides(sides) {
      this.sides = Teams.sanitizeSides(sides);
      this.kits = Teams.resolveKits(this.sides.red, this.sides.blue);
      this.teamColors = { red: Teams.sideColor(this.kits.red), blue: Teams.sideColor(this.kits.blue) };
      this.traits = { red: Teams.traitsFor(this.sides.red), blue: Teams.traitsFor(this.sides.blue) };
      this.renderer.setTeams(this.kits, this.teamColors);
      document.documentElement.style.setProperty('--teamRed', this.teamColors.red);
      document.documentElement.style.setProperty('--teamBlue', this.teamColors.blue);
    }
    nationName(team) { const n = Teams.get(this.sides ? this.sides[team] : null); return n ? n.name : team; }

    stop() {
      this.active = false;
      if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; }
      this.el.mobile.classList.add('hidden');
    }
    isTouch() { return matchMedia('(pointer: coarse)').matches; }

    setRoom(room) {
      this.room = room;
      const me = room && room.players.find(p => p.id === this.net.id);
      const newSlot = me ? me.slot : null;
      if (newSlot !== this.mySlot) { this.lastPred = null; this.predErr = { x: 0, y: 0 }; this.inputHistory = []; }
      this.mySlot = newSlot;
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
        const nation = Teams.get(this.room.sides && this.room.sides[team]);
        if (window.spriteAvatar) b.appendChild(window.spriteAvatar(team, pos, Teams.botName(this.room.sides && this.room.sides[team], team, pos), 2, this.kits ? this.kits[team] : null));
        b.appendChild(document.createTextNode(`${nation ? nation.code : team.toUpperCase()} ${pos}`));
        b.style.borderColor = team === 'red' ? 'var(--teamRed)' : 'var(--teamBlue)';
        b.onclick = () => this.net.send('pickSlot', { slot });
        this.el.spectatorSlots.appendChild(b);
      }
    }

    // ---- Snapshots ---------------------------------------------------------
    onSnapshot(snap) {
      const now = performance.now();
      // Jitter estimate → interpolation delay
      const ip = this.interp;
      if (ip.lastRecv) {
        const gap = now - ip.lastRecv;
        ip.meanGap += (gap - ip.meanGap) * 0.1;
        ip.jitter += (Math.abs(gap - ip.meanGap) - ip.jitter) * 0.1;
        const target = Math.min(160, Math.max(60, ip.meanGap * 1.5 + ip.jitter * 2.5));
        ip.delay += (target - ip.delay) * 0.05;
      }
      ip.lastRecv = now;
      const tickMs = 1000 / MCS.TICK_RATE;
      const sample = now - snap.t * tickMs;
      if (this.clock.offset === null || sample < this.clock.offset) this.clock.offset = sample;
      else this.clock.offset += 0.25;   // creep upward so a worsening link is re-learned

      this.snaps.push({ recv: now, data: snap });
      if (this.snaps.length > 90) this.snaps.shift();
      this.handleEvents(snap, now);
      this.setScore(snap.score.red, snap.score.blue);
      let tag = '';
      if (snap.sd) tag = 'SUDDEN DEATH';
      else if (snap.state === 'kickoff') tag = 'KICK OFF';
      this.setClock(snap.time, tag, snap);
      if (snap.state === 'countdown' && snap.cd > 0) {
        if (this._lastCd !== snap.cd) { this._lastCd = snap.cd; this.showBanner(String(snap.cd), '', 'gold', 900); this.audio.countdown(snap.cd); }
      } else this._lastCd = 0;
      // Re-base the prediction smoothly against the new authoritative state.
      this.rebasePrediction(now);
    }

    /** Build an interpolated view `delay` ms behind the latest snapshot. */
    view(now) {
      if (this.replay) return this.replayView(now);
      const s = this.snaps;
      if (s.length === 0) return null;
      if (s.length === 1) return s[0].data;
      const target = now - this.interp.delay;
      return this.viewAt(s, target);
    }
    viewAt(s, target) {
      let a = s[0], b = s[1];
      for (let i = s.length - 1; i >= 1; i--) { if (s[i - 1].recv <= target) { a = s[i - 1]; b = s[i]; break; } }
      if (target >= s[s.length - 1].recv) {
        const latest = s[s.length - 1];
        const dt = Math.min(0.08, (target - latest.recv) / 1000);
        return this.extrapolate(latest.data, dt);
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

    // ---- Local-player prediction --------------------------------------------
    /**
     * The server state we were sent reflects inputs we issued ~RTT ago, and we
     * display it another `delay` ms later. To hide that latency for the player
     * you control, re-simulate your own body from the newest snapshot forward
     * to the moment your current input will reach the server, replaying the
     * inputs you actually pressed in that window with the shared physics code.
     */
    predictLocal(now, fromEntry) {
      const latest = fromEntry || this.snaps[this.snaps.length - 1];
      if (!latest || !this.mySlot || !this.predictionEnabled || this.clock.offset === null) return null;
      const snap = latest.data;
      if (snap.state === 'countdown' || snap.state === 'goal' || snap.state === 'ended') return null;
      const sp = snap.players.find(p => p.id === this.mySlot);
      if (!sp) return null;
      const tickMs = 1000 / MCS.TICK_RATE;
      const owl = Math.min(250, Math.max(0, this.net.pingMs / 2));     // one-way latency
      // Local-clock time at which the server finished this snapshot's tick.
      const tickLocal = snap.t * tickMs + this.clock.offset - owl;
      const horizon = now + owl;                                         // when our current input lands
      const body = { x: sp.x, y: sp.y, vx: sp.vx, vy: sp.vy, r: sp.r, dashCooldown: sp.dc || 0, dashTime: sp.dtm || 0 };
      const st = { speed: !!(sp.fx & FX.speed), shrink: !!(sp.fx & FX.shrink), frozen: !!(sp.fx & FX.frozen) };
      const team = this.mySlot.split(':')[0];
      const gh = this.rules.goalWidth / 2;
      // Replay whole server ticks on the server's own grid: tick k starts at
      // tickLocal + (k-1)*tickMs and uses the input that had reached the server by then.
      for (let k = 1; k <= 40; k++) {
        const start = tickLocal + (k - 1) * tickMs;
        if (start + tickMs > horizon) break;
        const input = this.inputAt(start - owl);
        Physics.integratePlayer(body, input, this.rules, SIM_DT, st, snap.ball, this.traits ? this.traits[team] : null);
        Physics.confinePlayer(body, team, snap.state, snap.ko, gh);
      }
      return body;
    }
    inputAt(localTime) {
      const h = this.inputHistory;
      for (let i = h.length - 1; i >= 0; i--) if (h[i].t <= localTime) return h[i].input;
      return h.length ? h[0].input : { up: false, down: false, left: false, right: false, dash: false };
    }
    recordInput(now, input) {
      const h = this.inputHistory;
      const last = h[h.length - 1];
      if (!last || last.input.up !== input.up || last.input.down !== input.down || last.input.left !== input.left || last.input.right !== input.right || last.input.dash !== input.dash) {
        h.push({ t: now, input: { up: input.up, down: input.down, left: input.left, right: input.right, dash: input.dash } });
      }
      while (h.length > 2 && h[1].t < now - 2000) h.shift();
    }
    rebasePrediction(now) {
      // Predict the same instant (`now`) from the previous snapshot and from
      // the one that just arrived. With a perfect model both agree; any
      // difference is a genuine server correction, which we fold into an
      // offset that decays over the next frames instead of snapping.
      if (!this.lastPred || this.snaps.length < 2) return;
      const prevEntry = this.snaps[this.snaps.length - 2];
      const fromPrev = this.predictLocal(now, prevEntry);
      const fromNew = this.predictLocal(now);
      if (!fromPrev || !fromNew) { this.lastPred = null; return; }
      this.predErr.x += fromPrev.x - fromNew.x;
      this.predErr.y += fromPrev.y - fromNew.y;
      const e = Math.hypot(this.predErr.x, this.predErr.y);
      if (e > 120) { this.predErr.x = 0; this.predErr.y = 0; } // teleport on big desync
    }

    // ---- Instant replay -----------------------------------------------------
    startReplay(now) {
      const span = 1400;
      const snaps = this.snaps.filter(s => s.recv >= now - span);
      if (snaps.length < 4) return;
      const duration = Math.max(1200, Math.min(3000, this.rules.kickoffPause * 1000 * 0.85));
      this.replay = { snaps, start: now + 350, duration, span: snaps[snaps.length - 1].recv - snaps[0].recv, first: snaps[0].recv };
    }
    replayView(now) {
      const r = this.replay;
      if (now < r.start) return this.viewAt(this.snaps, r.first + r.span); // hold the goal frame briefly
      const t = (now - r.start) / r.duration;
      if (t >= 1) { this.replay = null; return this.view(now); }
      const v = this.viewAt(r.snaps, r.first + r.span * t);
      v._replay = true;
      return v;
    }

    // ---- Events → FX/audio ------------------------------------------------
    handleEvents(snap, now) {
      const R = this.renderer;
      const myTeam = this.mySlot ? MCS.parseSlot(this.mySlot).team : null;
      for (const e of snap.events || []) {
        switch (e.type) {
          case 'kick':
            R.burst(e.x, e.y, { n: 6 + Math.round(e.power * 4), color: e.rocket ? '#ef476f' : '#fff', speed: 120 * e.power });
            this.audio.kick(e.power, e.rocket);
            if (e.rocket) R.kickShake(8); else if (e.slot === this.mySlot) R.kickShake(2.5);
            break;
          case 'bounce': R.burst(e.x, e.y, { n: 4, color: 'rgba(255,255,255,.6)', speed: 60 }); this.audio.bounce(e.speed, e.post); if (e.post) R.kickShake(3); break;
          case 'dash': R.burst(e.x, e.y, { n: 8, color: 'rgba(255,255,255,.5)', speed: 90 }); this.audio.dash(); break;
          case 'whistle': this.audio.whistle(false); if (!snap.sd) this.hideBanner(); this.replay = null; break;
          case 'kickoffOpen': this.toast('Kick-off opened: anyone can play the ball'); break;
          case 'suddenDeath': this.showBanner('SUDDEN DEATH', 'Next goal wins', 'gold', 2500); this.audio.whistle(false); break;
          case 'spawn': R.burst(e.x, e.y, { n: 12, color: MCS.BOOSTS[e.boost].color, speed: 100 }); break;
          case 'pickup': {
            const b = MCS.BOOSTS[e.boost];
            R.burst(e.x, e.y, { n: 24, color: b.color, speed: 220, life: 0.7 });
            this.audio.pickup(); if (e.boost === 'freeze') this.audio.freeze();
            this.toast(`${b.icon} ${this.playerName(e.slot)} got ${b.label}`, e.team);
            break;
          }
          case 'goal': {
            const color = this.teamColors ? this.teamColors[e.team] : (e.team === 'red' ? Renderer.COLORS.red : Renderer.COLORS.blue);
            R.confetti(e.x, e.y, color); R.kickShake(18);
            this.audio.goal(myTeam ? e.team === myTeam : true);
            const who = e.scorer ? this.playerName(e.scorer) : 'Nobody';
            let sub = e.ownGoal ? `Own goal by ${who}` : `${who}${e.assist ? ' · assist ' + this.playerName(e.assist) : ''}`;
            if (e.speed > 850) sub += ' · ROCKET!';
            this.showBanner(e.sd ? 'GOLDEN GOAL!' : `GOAL! ${this.nationName(e.team).toUpperCase()}`, sub, e.team, 2600);
            this.startReplay(now);
            break;
          }
          case 'end': this.audio.end(); this.replay = null; break;
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
    setClock(seconds, tag, snap) {
      const s = Math.max(0, Math.ceil(seconds));
      this.el.clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      this.el.clockTag.textContent = tag;
      const urgent = snap && !snap.sd && seconds <= 10 && seconds > 0 && snap.state !== 'countdown';
      this.el.clock.classList.toggle('urgent', !!urgent);
      if (urgent && s !== this._lastClockSecond && s <= 5) this.audio.tick();
      this._lastClockSecond = s;
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
      if (team) t.style.borderColor = team === 'red' ? 'var(--teamRed)' : 'var(--teamBlue)';
      this.el.toasts.appendChild(t);
      setTimeout(() => t.remove(), 3500);
    }

    showResults(res) {
      const myTeam = this.mySlot ? MCS.parseSlot(this.mySlot).team : null;
      if (res.sides) this.setSides(res.sides);
      let title = res.winner === 'draw' ? 'Draw' : `${this.nationName(res.winner)} wins`;
      if (myTeam) title = res.winner === 'draw' ? 'Draw' : res.winner === myTeam ? 'Victory!' : 'Defeat';
      this.el.resultsTitle.textContent = title + (res.suddenDeath ? ' (sudden death)' : '');
      this.el.resRed.textContent = res.score.red; this.el.resBlue.textContent = res.score.blue;
      const tb = this.el.statsBody; tb.innerHTML = '';
      const best = res.stats.reduce((a, s) => (s.stats.goals * 3 + s.stats.assists * 2 + s.stats.kicks * 0.1 > (a ? a.stats.goals * 3 + a.stats.assists * 2 + a.stats.kicks * 0.1 : -1) ? s : a), null);
      for (const s of res.stats) {
        const tr = document.createElement('tr');
        const name = document.createElement('td'); name.className = s.team;
        name.textContent = `${s.pos} ${s.bot ? '🤖 ' : ''}${s.name}${s === best ? ' ⭐' : ''}`;
        tr.appendChild(name);
        for (const v of [s.stats.goals + (s.stats.ownGoals ? ` (${s.stats.ownGoals} OG)` : ''), s.stats.assists, s.stats.kicks, s.stats.pickups]) {
          const td = document.createElement('td'); td.textContent = v; tr.appendChild(td);
        }
        tb.appendChild(tr);
      }
      this.el.results.classList.remove('hidden');
      this.el.spectatorBar.classList.add('hidden');
      this.replay = null;
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
        if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
        if (e.key === 'Enter') { e.preventDefault(); this.el.chatForm.classList.remove('hidden'); this.el.chatInput.focus(); return; }
        if (e.key === 'm' || e.key === 'M') { const m = this.audio.toggleMute(); this.toast(m ? 'Sound off' : 'Sound on'); }
        if (e.key === 'p' || e.key === 'P') { this.predictionEnabled = !this.predictionEnabled; localStorage.setItem('mcs.predict', this.predictionEnabled ? '1' : '0'); this.toast(`Prediction ${this.predictionEnabled ? 'on' : 'off'}`); }
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
      return {
        up: !!(k.KeyW || k.ArrowUp) || this.touch.dy < -0.3,
        down: !!(k.KeyS || k.ArrowDown) || this.touch.dy > 0.3,
        left: !!(k.KeyA || k.ArrowLeft) || this.touch.dx < -0.3,
        right: !!(k.KeyD || k.ArrowRight) || this.touch.dx > 0.3,
        kick: !!(k.Space || k.KeyX) || this.mouse.down || this.touch.kick,
        dash: !!(k.ShiftLeft || k.ShiftRight || k.KeyC) || this.touch.dash,
        aimX: this.mouse.x, aimY: this.mouse.y,
      };
    }
    sendInput(now) {
      if (!this.mySlot || !this.net.id) return;
      const input = this.currentInput();
      this.recordInput(now, input);
      const json = JSON.stringify([input.up, input.down, input.left, input.right, input.kick, input.dash]);
      const changed = json !== this.lastInputJson;
      const anyHeld = json.includes('true');
      // Changes go out immediately; while something is held we stream at
      // INPUT_RATE (the aim point moves); idle clients only send a keepalive.
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
      let view = this.view(now);
      if (view && !view._replay) {
        const pred = this.predictLocal(now);
        if (pred) {
          // Decay the correction offset and overlay the predicted local player.
          const k = Math.exp(-dt * 10);
          this.predErr.x *= k; this.predErr.y *= k;
          const players = view.players.map(p => p.id === this.mySlot
            ? Object.assign({}, p, { x: pred.x + this.predErr.x, y: pred.y + this.predErr.y, vx: pred.vx, vy: pred.vy, r: pred.r, dash: pred.dashCooldown > 0 ? pred.dashCooldown / Physics.FEEL.dashCooldown : 0 })
            : p);
          view = Object.assign({}, view, { players });
          this.lastPred = pred; this.lastPredAt = now;
        } else this.lastPred = null;
      }
      this.renderer.draw(view, { mySlot: this.mySlot, dt, replay: !!(view && view._replay) });
      if (this.el.netInfo && (now - (this._netInfoAt || 0)) > 500) {
        this._netInfoAt = now;
        this.el.netInfo.textContent = `${this.net.pingMs} ms · ${Math.round(this.interp.delay)} ms buffer`;
      }
    }
  }

  window.Game = Game;
})();
