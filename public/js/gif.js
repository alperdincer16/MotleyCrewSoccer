/**
 * public/js/gif.js — tiny animated GIF (GIF89a) encoder, no dependencies.
 * Owner: Tomasz Nowak (T-33)
 *
 * Uses a fixed 6×7×6 colour cube (252 colours) with a light ordered dither,
 * which suits the game's flat pixel-art palette, and standard variable-width
 * LZW compression.
 */
(function () {
  'use strict';

  const PALETTE = (() => {
    const p = new Uint8Array(256 * 3);
    let i = 0;
    for (let r = 0; r < 6; r++) for (let g = 0; g < 7; g++) for (let b = 0; b < 6; b++) {
      p[i++] = Math.round(r * 255 / 5); p[i++] = Math.round(g * 255 / 6); p[i++] = Math.round(b * 255 / 5);
    }
    return p;   // remaining entries stay black
  })();
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v / 16 - 0.5));

  /** RGBA pixels → palette indices. */
  function quantize(rgba, w, h) {
    const out = new Uint8Array(w * h);
    for (let y = 0, k = 0; y < h; y++) {
      for (let x = 0; x < w; x++, k++) {
        const d = BAYER[(y & 3) * 4 + (x & 3)];
        const o = k * 4;
        const r = Math.min(5, Math.max(0, Math.round(rgba[o] * 5 / 255 + d * 0.9)));
        const g = Math.min(6, Math.max(0, Math.round(rgba[o + 1] * 6 / 255 + d * 0.9)));
        const b = Math.min(5, Math.max(0, Math.round(rgba[o + 2] * 5 / 255 + d * 0.9)));
        out[k] = r * 42 + g * 6 + b;
      }
    }
    return out;
  }

  class ByteOut {
    constructor() { this.buf = new Uint8Array(1 << 20); this.n = 0; }
    grow(k) { if (this.n + k > this.buf.length) { const nb = new Uint8Array(Math.max(this.buf.length * 2, this.n + k)); nb.set(this.buf); this.buf = nb; } }
    byte(b) { this.grow(1); this.buf[this.n++] = b; }
    bytes(a) { this.grow(a.length); this.buf.set(a, this.n); this.n += a.length; }
    u16(v) { this.byte(v & 255); this.byte((v >> 8) & 255); }
    str(s) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
    result() { return this.buf.slice(0, this.n); }
  }

  /** LZW-compress palette indices into GIF sub-blocks. */
  function lzw(out, indices, minCode) {
    out.byte(minCode);
    const clear = 1 << minCode, eoi = clear + 1;
    let codeSize = minCode + 1, next = eoi + 1;
    let dict = new Map();
    let cur = 0, bits = 0;
    const block = new Uint8Array(255); let bl = 0;
    const flushByte = (b) => { block[bl++] = b; if (bl === 255) { out.byte(255); out.bytes(block); bl = 0; } };
    const emit = (code) => {
      cur |= code << bits; bits += codeSize;
      while (bits >= 8) { flushByte(cur & 255); cur >>>= 8; bits -= 8; }
    };
    emit(clear);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const c = indices[i];
      const key = prefix * 4096 + c;
      const hit = dict.get(key);
      if (hit !== undefined) { prefix = hit; continue; }
      emit(prefix);
      if (next < 4096) {
        dict.set(key, next++);
        if (next > (1 << codeSize) && codeSize < 12) codeSize++;
      } else {
        emit(clear); dict = new Map(); codeSize = minCode + 1; next = eoi + 1;
      }
      prefix = c;
    }
    emit(prefix); emit(eoi);
    if (bits > 0) flushByte(cur & 255);
    if (bl) { out.byte(bl); out.bytes(block.subarray(0, bl)); }
    out.byte(0);
  }

  /**
   * Encode frames into a looping GIF.
   * frames: [{ rgba: Uint8ClampedArray }], w, h, delayCs: per-frame delay in 1/100 s.
   */
  function encode(frames, w, h, delayCs) {
    const out = new ByteOut();
    out.str('GIF89a'); out.u16(w); out.u16(h);
    out.byte(0xf7); out.byte(0); out.byte(0);          // global colour table, 256 entries
    out.bytes(PALETTE);
    out.str('!\xff\x0bNETSCAPE2.0'); out.byte(3); out.byte(1); out.u16(0); out.byte(0);   // loop forever
    frames.forEach((f, i) => {
      const d = Array.isArray(delayCs) ? delayCs[i] : delayCs;
      out.byte(0x21); out.byte(0xf9); out.byte(4); out.byte(0); out.u16(d); out.byte(0); out.byte(0);
      out.byte(0x2c); out.u16(0); out.u16(0); out.u16(w); out.u16(h); out.byte(0);
      lzw(out, quantize(f.rgba, w, h), 8);
    });
    out.byte(0x3b);
    return out.result();
  }

  window.GifEncoder = { encode, quantize };
})();
