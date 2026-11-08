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
      // Browsers only allow audio after a user gesture; nothing is created before one.
      this.unlocked = false;
      const unlock = () => { this.unlocked = true; this.ensure(); if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); };
      ['pointerdown', 'keydown', 'touchstart'].forEach(ev => window.addEventListener(ev, unlock, { passive: true }));
    }
    ensure() {
      if (this.ctx) return true;
      if (!this.unlocked) return false;
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

    // ---- Crowd layer ------------------------------------------------------
    /** Start the looping murmur (noise through a low-pass) if not running. */
    ensureCrowd() {
      if (this.crowdGain || !this.ensure()) return;
      const len = this.ctx.sampleRate * 3;
      const buf = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch); let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < len; i++) {           // pinkish noise
          const w = Math.random() * 2 - 1;
          b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
          d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
        }
      }
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 0.5;
      const g = this.ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master); src.start();
      this.crowdGain = g; this.crowdFilter = f;
    }
    /** Smoothly set the murmur level (0..1). Called every frame. */
    setCrowd(level) {
      if (level > 0.01) this.ensureCrowd();
      if (!this.crowdGain) return;
      const t = this.now();
      this.crowdGain.gain.setTargetAtTime(0.03 + level * 0.22, t, 0.25);
      this.crowdFilter.frequency.setTargetAtTime(450 + level * 1400, t, 0.3);
    }
    /** A roar: a swell of band-passed noise plus a chorus of detuned voices. */
    cheer(intensity = 1) {
      if (!this.ensure()) return;
      const t = this.now();
      const dur = 2.2 + intensity;
      this.noise(dur, { gain: 0.35 * intensity, filter: 900, q: 0.6, type: 'bandpass' });
      this.noise(dur * 0.8, { gain: 0.25 * intensity, filter: 1800, q: 0.8, type: 'bandpass', start: 0.15 });
      for (let i = 0; i < 6; i++) {
        const f0 = 180 + i * 37 + Math.random() * 20;
        const o = this.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, t);
        o.frequency.linearRampToValueAtTime(f0 * 1.25, t + 0.5); o.frequency.linearRampToValueAtTime(f0 * 1.1, t + dur);
        const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900 + i * 120; lp.Q.value = 2;
        const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.045 * intensity, t + 0.35 + i * 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(lp).connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.1);
      }
    }
    /** A collective "ooh": a short swell that drops away. */
    gasp() {
      if (!this.ensure()) return;
      const t = this.now();
      this.noise(0.7, { gain: 0.25, filter: 650, q: 1.2, type: 'bandpass' });
      for (const [f, g] of [[330, 0.05], [660, 0.03], [990, 0.015]]) {
        const o = this.ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 0.82, t + 0.6);
        const gn = this.ctx.createGain(); gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(g, t + 0.18); gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
        o.connect(gn).connect(this.master); o.start(t); o.stop(t + 0.8);
      }
    }
    /** Two claps in the stands (called once per second in the final ten). */
    clap() {
      this.noise(0.05, { gain: 0.22, filter: 2600, q: 1.5, type: 'bandpass' });
      this.noise(0.05, { gain: 0.18, filter: 2300, q: 1.5, type: 'bandpass', start: 0.5 });
    }
    end() { this.whistle(true); }
  }

  window.GameAudio = GameAudio;
})();
