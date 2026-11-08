/**
 * public/js/audio.js — procedural sound effects (no asset files needed).
 * Owner: Tomasz Nowak (T-16)
 */
(function () {
  'use strict';

  class GameAudio {
    constructor() {
      this.ctx = null; this.master = null; this.enabled = true;
      this.muted = localStorage.getItem('mcs.muted') === '1';
      const unlock = () => { this.ensure(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); };
      ['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, unlock, { passive: true }));
    }
    ensure() {
      if (this.ctx) return true;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { this.enabled = false; return false; }
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      return true;
    }
    toggleMute() {
      this.muted = !this.muted; localStorage.setItem('mcs.muted', this.muted ? '1' : '0');
      if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
      return this.muted;
    }
    now() { return this.ctx.currentTime; }

    tone(freq, dur, { type = 'sine', gain = 0.3, attack = 0.005, decay = dur, slide = null, start = 0 } = {}) {
      if (!this.ensure()) return;
      const t = this.now() + start;
      const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + dur);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
    }
    noise(dur, { gain = 0.3, filter = 1200, q = 0.7, start = 0, type = 'lowpass' } = {}) {
      if (!this.ensure()) return;
      const t = this.now() + start;
      const len = Math.ceil(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = filter; f.Q.value = q;
      const g = this.ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(this.master); src.start(t);
    }

    kick(power = 1, rocket = false) {
      const p = Math.min(2.5, power);
      this.noise(0.08 + 0.04 * p, { gain: 0.35 * p, filter: 900 + 600 * p });
      this.tone(140 * p, 0.12, { type: 'triangle', gain: 0.25, slide: 60 });
      if (rocket) { this.tone(600, 0.3, { type: 'sawtooth', gain: 0.15, slide: 120 }); this.noise(0.35, { gain: 0.3, filter: 2500, type: 'bandpass' }); }
    }
    bounce(speed = 300, post = false) {
      const s = Math.min(1, speed / 900);
      if (post) { this.tone(880, 0.25, { type: 'square', gain: 0.12 * s + 0.05, slide: 700 }); }
      else this.noise(0.05, { gain: 0.15 * s + 0.03, filter: 700 });
    }
    whistle(long = false) {
      const dur = long ? 0.7 : 0.35;
      this.tone(2300, dur, { type: 'square', gain: 0.08, attack: 0.01 });
      this.tone(2380, dur, { type: 'square', gain: 0.06, attack: 0.01 });
      if (long) { this.tone(2300, 0.5, { type: 'square', gain: 0.08, start: 0.8 }); this.tone(2300, 0.9, { type: 'square', gain: 0.08, start: 1.4 }); }
    }
    countdown(n) { this.tone(n === 0 ? 1200 : 700, 0.12, { type: 'square', gain: 0.12 }); }
    goal(ours) {
      const base = ours ? 1 : 0.8;
      [0, 0.1, 0.2].forEach((s, i) => this.tone([392, 494, 587][i] * base, 0.5, { type: 'sawtooth', gain: 0.12, start: s, attack: 0.02 }));
      this.tone(784 * base, 1.1, { type: 'sawtooth', gain: 0.14, start: 0.3, attack: 0.05 });
      this.noise(1.4, { gain: 0.25, filter: 1800, type: 'bandpass', q: 0.4 });
    }
    pickup() { [660, 880, 1320].forEach((f, i) => this.tone(f, 0.15, { type: 'triangle', gain: 0.15, start: i * 0.06 })); }
    dash() { this.noise(0.18, { gain: 0.2, filter: 2000, type: 'highpass' }); this.tone(300, 0.15, { type: 'sine', gain: 0.1, slide: 900 }); }
    freeze() { this.tone(1800, 0.6, { type: 'sine', gain: 0.12, slide: 300 }); this.noise(0.5, { gain: 0.1, filter: 4000, type: 'highpass' }); }
    tick() { this.tone(1000, 0.06, { type: 'square', gain: 0.08 }); }
    end() { this.whistle(true); }
  }

  window.GameAudio = GameAudio;
})();
