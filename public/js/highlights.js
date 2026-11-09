/**
 * public/js/highlights.js — keeps every goal of the match and turns it into
 * a shareable GIF: a follow-cam replay of the build-up, the goal, and the
 * scorer's player-cam celebration.
 * Owner: Tomasz Nowak (T-33 rendering) & Sam Okafor (T-33 results UI)
 */
(function () {
  'use strict';
  const { FIELD } = window.MCS;
  const OUT_W = 480, OUT_H = 300, FPS = 15;
  const CROP_W = 820, CROP_H = 512;          // world-space window the camera follows

  class Highlights {
    constructor(game) {
      this.game = game;
      this.list = [];
      this.el = document.getElementById('highlightList');
    }
    reset() { this.list = []; this.render(); }

    /** Called on a goal event; grabs the snapshots around it once the ball is in. */
    capture(e, now) {
      const g = this.game;
      setTimeout(() => {
        const snaps = g.snaps.filter(s => s.recv >= now - 2800 && s.recv <= now + 900).map(s => ({ recv: s.recv, data: s.data }));
        if (snaps.length < 6) return;
        this.list.push({
          snaps, goalAt: now, team: e.team, scorer: e.scorer, ownGoal: e.ownGoal,
          scorerName: e.scorer ? g.playerName(e.scorer) : 'Unknown', score: e.score,
          sides: Object.assign({}, g.sides), kits: g.kits, teamColors: Object.assign({}, g.teamColors),
          rules: g.rules, looks: Object.assign({}, g.looks), celebration: g.celebration ? Object.assign({}, g.celebration) : null,
          nation: g.nationName(e.team), clock: e.clock, sd: e.sd,
        });
        if (this.list.length > 12) this.list.shift();
        this.render();
      }, 1000);
    }

    render() {
      if (!this.el) return;
      this.el.innerHTML = '';
      this.el.parentElement.classList.toggle('hidden', this.list.length === 0);
      this.list.forEach((h, i) => {
        const row = document.createElement('div'); row.className = 'hl';
        const label = document.createElement('span');
        const n = Teams.get(h.sides[h.team]);
        label.textContent = `${n ? n.flag : ''} ${h.score.red}–${h.score.blue} · ${h.ownGoal ? 'Own goal, ' : ''}${h.scorerName}`;
        const btn = document.createElement('button'); btn.className = 'small'; btn.type = 'button';
        btn.textContent = '⬇ GIF';
        btn.onclick = async () => {
          btn.disabled = true; btn.textContent = 'Rendering…';
          try { await this.download(h, i); btn.textContent = '✓ Saved'; }
          catch (err) { console.error(err); btn.textContent = 'Failed'; }
          setTimeout(() => { btn.disabled = false; btn.textContent = '⬇ GIF'; }, 2500);
        };
        row.appendChild(label); row.appendChild(btn);
        this.el.appendChild(row);
      });
    }

    async download(h, i) {
      const bytes = await this.makeGif(h);
      const blob = new Blob([bytes], { type: 'image/gif' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `motley-goal-${i + 1}-${(h.nation || 'goal').toLowerCase().replace(/[^a-z]+/g, '')}.gif`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      return bytes;
    }

    /** Render the highlight off-screen and encode it. Yields to the UI between frames. */
    async makeGif(h) {
      const g = this.game;
      const big = document.createElement('canvas');
      const R = new Renderer(big);
      R.setTeams(h.kits, h.teamColors, { red: (Teams.get(h.sides.red) || {}).name.toUpperCase(), blue: (Teams.get(h.sides.blue) || {}).name.toUpperCase() });
      R.setArena(h.rules.arena); R.setWeather(h.rules.weather); R.rules = h.rules; R.looks = h.looks;
      const out = document.createElement('canvas'); out.width = OUT_W; out.height = OUT_H;
      const octx = out.getContext('2d', { willReadFrequently: true });
      const first = h.snaps[0].recv, last = h.snaps[h.snaps.length - 1].recv;
      const frames = [], delays = [];
      let cam = null, confettiDone = false;
      const step = 1000 / FPS;
      const M = FIELD.margin;
      for (let t = first; t <= last; t += step) {
        const view = g.viewAt(h.snaps, t);
        if (!confettiDone && t >= h.goalAt) { R.confetti(view.ball.x, view.ball.y, h.teamColors[h.team]); R.kickShake(10); confettiDone = true; }
        if (view.gw) R.setGoalWidth(view.gw);
        R.draw(view, { dt: step / 1000 });
        // Smoothed follow-cam on the ball, clamped to the canvas.
        const target = { x: view.ball.x + M, y: view.ball.y + M };
        cam = cam ? { x: cam.x + (target.x - cam.x) * 0.25, y: cam.y + (target.y - cam.y) * 0.25 } : target;
        const cx = Math.max(0, Math.min(big.width - CROP_W, cam.x - CROP_W / 2));
        const cy = Math.max(0, Math.min(big.height - CROP_H, cam.y - CROP_H / 2));
        octx.imageSmoothingEnabled = true;
        octx.drawImage(big, cx, cy, CROP_W, CROP_H, 0, 0, OUT_W, OUT_H);
        this.overlay(octx, h, t >= h.goalAt);
        frames.push({ rgba: octx.getImageData(0, 0, OUT_W, OUT_H).data }); delays.push(Math.round(100 / FPS));
        if (frames.length % 6 === 0) await new Promise(r => setTimeout(r, 0));
      }
      // Hold the goal moment, then the player-cam celebration.
      delays[delays.length - 1] = 60;
      if (h.celebration && !h.ownGoal && window.Celebrate) {
        for (let k = 0; k < FPS * 1.6; k++) {
          octx.fillStyle = '#0b0e12'; octx.fillRect(0, 0, OUT_W, OUT_H);
          const c = Object.assign({}, h.celebration, { t: k / FPS });
          Celebrate.drawCard(octx, c, (OUT_W - 240) / 2, 30);
          this.overlay(octx, h, true);
          frames.push({ rgba: octx.getImageData(0, 0, OUT_W, OUT_H).data }); delays.push(Math.round(100 / FPS));
          if (k % 6 === 0) await new Promise(r => setTimeout(r, 0));
        }
      }
      return GifEncoder.encode(frames, OUT_W, OUT_H, delays);
    }

    overlay(ctx, h, scored) {
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, OUT_H - 26, OUT_W, 26);
      ctx.font = 'bold 13px system-ui, sans-serif'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffd166'; ctx.textAlign = 'left';
      ctx.fillText(scored ? `GOAL! ${h.nation.toUpperCase()}` : 'MOTLEY CREW SOCCER', 10, OUT_H - 13);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'right';
      const a = Teams.get(h.sides.red), b = Teams.get(h.sides.blue);
      ctx.fillText(`${a ? a.code : 'RED'} ${h.score.red}–${h.score.blue} ${b ? b.code : 'BLUE'} · ${h.scorerName}`, OUT_W - 10, OUT_H - 13);
    }
  }

  window.Highlights = Highlights;
})();
