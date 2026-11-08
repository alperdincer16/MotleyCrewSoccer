/**
 * public/js/sprites.js — procedural pixel-art player sprites.
 * Owner: Tomasz Nowak (T-15)
 *
 * Every player is drawn from a 14×20 pixel template in the style of 16-bit
 * football games: a big head, team kit, shorts, socks and boots, with a
 * one-pixel dark outline generated automatically. Looks (skin tone, hair
 * colour and style) are derived from the player's name so a person keeps the
 * same face between matches, and the kit comes from the team and position.
 */
(function () {
  'use strict';

  const W = 14, H = 20;
  const SKIN = ['#f8d3b0', '#efb98a', '#d0945f', '#a7683c', '#7a4a27', '#4e2e17'];
  const HAIR = ['#1b1b1b', '#3a2416', '#7a4a1e', '#c98a3a', '#f2d35b', '#d94a2c'];
  const HAIR_STYLES = ['short', 'long', 'afro', 'spiky', 'bald', 'band', 'curly'];
  const OUTLINE = '#141414';
  const EYE = '#111111';

  // Kits: jersey, jersey accent, shorts, socks, boots, pattern
  const KITS = {
    red:  { j: '#e63946', k: '#ffffff', p: '#ffffff', w: '#e63946', b: '#1a1a1a', pattern: 'stripes' },
    blue: { j: '#2a7de1', k: '#ffffff', p: '#1d4ed8', w: '#ffffff', b: '#1a1a1a', pattern: 'sleeves' },
  };
  // Goalkeepers keep the team colour but wear a dark trim and gloves.
  const GK_OVERRIDE = { k: '#222222', pattern: 'band', gloves: '#f4f4f4' };

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /** Deterministic appearance for a name. */
  function lookFor(name) {
    const h = hash(String(name || 'player'));
    return {
      skin: SKIN[h % SKIN.length],
      hair: HAIR[(h >>> 4) % HAIR.length],
      style: HAIR_STYLES[(h >>> 9) % HAIR_STYLES.length],
    };
  }

  /** Build the character grid. frame: 0 stand, 1 walkA, 2 walkB, 3 kick. */
  function buildGrid(style, pattern, gk, frame) {
    const g = Array.from({ length: H }, () => Array(W).fill('.'));
    const put = (x, y, c) => { if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = c; };
    const rect = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, c); };

    // Head (face) x 3..10, y 1..7
    rect(3, 1, 8, 7, 's');
    // Hair
    switch (style) {
      case 'short': rect(3, 1, 8, 2, 'h'); put(3, 3, 'h'); put(10, 3, 'h'); break;
      case 'long': rect(3, 1, 8, 2, 'h'); rect(3, 3, 1, 4, 'h'); rect(10, 3, 1, 4, 'h'); put(4, 3, 'h'); put(9, 3, 'h'); break;
      case 'afro': rect(2, 0, 10, 3, 'h'); rect(2, 3, 1, 3, 'h'); rect(11, 3, 1, 3, 'h'); put(3, 3, 'h'); put(10, 3, 'h'); break;
      case 'spiky': rect(3, 1, 8, 2, 'h'); for (let x = 3; x <= 10; x += 2) put(x, 0, 'h'); put(3, 3, 'h'); put(10, 3, 'h'); break;
      case 'bald': put(3, 1, 'h'); put(10, 1, 'h'); break;
      case 'band': rect(3, 1, 8, 1, 'h'); rect(3, 2, 8, 1, 'k'); put(3, 3, 'h'); put(10, 3, 'h'); break;
      case 'curly': rect(3, 1, 8, 2, 'h'); for (let x = 3; x <= 10; x += 2) put(x, 0, 'h'); rect(3, 3, 1, 2, 'h'); rect(10, 3, 1, 2, 'h'); break;
    }
    // Eyes
    put(5, 5, 'e'); put(8, 5, 'e');
    // Round off the head corners (the outline fills them in)
    for (const [x, y] of [[3, 1], [10, 1], [3, 7], [10, 7], [2, 0], [11, 0]]) if (g[y][x] !== '.') put(x, y, '.');
    // Neck
    rect(6, 8, 2, 1, 's');
    // Shirt body x 3..10, y 9..12; sleeves at x 2 / 11, y 9..10; arms below
    rect(3, 9, 8, 4, 'j');
    rect(2, 9, 1, 2, 'j'); rect(11, 9, 1, 2, 'j');
    rect(2, 11, 1, 2, 's'); rect(11, 11, 1, 2, 's');
    switch (pattern) {
      case 'stripes': for (const x of [4, 6, 8]) rect(x, 9, 1, 4, 'k'); break;
      case 'sleeves': rect(2, 9, 1, 2, 'k'); rect(11, 9, 1, 2, 'k'); rect(3, 9, 1, 1, 'k'); rect(10, 9, 1, 1, 'k'); break;
      case 'band': rect(3, 10, 8, 1, 'k'); rect(2, 9, 1, 2, 'k'); rect(11, 9, 1, 2, 'k'); break;
      case 'hoops': rect(3, 10, 8, 1, 'k'); rect(3, 12, 8, 1, 'k'); break;
      case 'sash': for (let y = 9; y <= 12; y++) rect(3 + (y - 9) * 2, y, 2, 1, 'k'); break;
      case 'checks': for (let y = 9; y <= 12; y++) for (let x = 3; x <= 10; x++) if ((x + y) % 2 === 0) put(x, y, 'k'); break;
      case 'halves': rect(3, 9, 4, 4, 'k'); rect(2, 9, 1, 2, 'k'); break;
      case 'center': rect(6, 9, 2, 4, 'k'); break;
      case 'vee': put(4, 9, 'k'); put(9, 9, 'k'); put(5, 10, 'k'); put(8, 10, 'k'); rect(6, 11, 2, 1, 'k'); break;
      case 'plain': default: break;
    }
    if (gk) { put(2, 12, 'g'); put(11, 12, 'g'); put(2, 13, 'g'); put(11, 13, 'g'); }
    // Shorts
    rect(4, 13, 6, 2, 'p');
    // Legs: left x 4..5, right x 8..9. Skin 15, socks 16..17, boots 18.
    const leg = (x, lift) => {
      const y0 = 15 - lift;
      if (lift === 0) rect(x, y0, 2, 1, 's'); else rect(x, y0 + 1, 2, 1, 's');
      rect(x, 16 - lift, 2, 2, 'w'); rect(x, 18 - lift, 2, 1, 'b');
    };
    if (frame === 1) { leg(4, 1); leg(8, 0); }
    else if (frame === 2) { leg(4, 0); leg(8, 1); }
    else if (frame === 3) {
      // Kick: right leg swings out to the side, boot pointing right.
      leg(4, 0);
      rect(8, 15, 2, 1, 's'); rect(9, 16, 2, 1, 'w'); rect(10, 16, 2, 1, 'w'); rect(11, 17, 2, 1, 'b');
      // Arm swings up for balance
      put(2, 11, 's'); put(1, 10, 's'); put(2, 12, 'j');
    } else { leg(4, 0); leg(8, 0); }

    // Auto outline: any empty cell touching a filled one.
    const out = g.map(r => r.slice());
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (g[y][x] !== '.') continue;
      const n = (g[y - 1] && g[y - 1][x] !== '.') || (g[y + 1] && g[y + 1][x] !== '.') || (g[y][x - 1] && g[y][x - 1] !== '.') || (g[y][x + 1] && g[y][x + 1] !== '.');
      if (n) out[y][x] = 'o';
    }
    return out;
  }

  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = (sh) => Math.round(((pa >> sh) & 255) * (1 - t) + ((pb >> sh) & 255) * t);
    return '#' + [16, 8, 0].map(sh => ch(sh).toString(16).padStart(2, '0')).join('');
  }

  const cache = new Map();

  /**
   * Returns a cached 14×20 canvas for the given appearance.
   * @param {object} o { team, pos, name, frame, frozen }
   */
  function canvas(o) {
    const look = lookFor(o.name);
    const base = o.kit || KITS[o.team] || KITS.red;
    const kitKey = [base.j, base.k, base.p, base.w, base.pattern, base.gk || ''].join(',');
    const key = [kitKey, o.pos, look.skin, look.hair, look.style, o.frame | 0, o.frozen ? 1 : 0].join('|');
    let c = cache.get(key);
    if (c) return c;
    // Keepers wear the kit's keeper colour with dark trim and gloves.
    const kit = Object.assign({ b: '#1a1a1a' }, base, o.pos === 'GK' ? Object.assign({}, GK_OVERRIDE, base.gk ? { j: base.gk } : {}) : {});
    let pal = { o: OUTLINE, e: EYE, s: look.skin, h: look.hair, j: kit.j, k: kit.k, p: kit.p, w: kit.w, b: kit.b, g: kit.gloves || '#fff' };
    if (o.frozen) for (const k of Object.keys(pal)) pal[k] = mix(pal[k], '#bfe6ff', k === 'o' ? 0.3 : 0.65);
    const grid = buildGrid(look.style, kit.pattern, o.pos === 'GK', o.frame | 0);
    c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const ch = grid[y][x]; if (ch === '.') continue;
      ctx.fillStyle = pal[ch] || '#f0f'; ctx.fillRect(x, y, 1, 1);
    }
    cache.set(key, c);
    return c;
  }

  /**
   * Draw a sprite with its feet at (cx, feetY), `scale` screen px per sprite px.
   * flip mirrors the sprite horizontally.
   */
  function draw(ctx, o, cx, feetY, scale, flip) {
    const img = canvas(o);
    const w = W * scale, h = H * scale;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(cx, feetY);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -w / 2, -h + scale, w, h); // bottom row (boots) sits on feetY
    ctx.restore();
  }

  window.Sprites = { W, H, lookFor, canvas, draw, KITS };
})();
