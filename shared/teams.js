/**
 * shared/teams.js — national teams: kits, colours and play styles.
 * Owner: Mei Lin (play styles) & Tomasz Nowak (kits) — T-25
 *
 * A play style has two parts:
 *   traits — small stat modifiers applied to every player on the team,
 *            human or bot (speed, kick power, dash cooldown). They are kept
 *            within ±8% so no nation is strictly better.
 *   ai     — tendencies for the bots: how high they press, how much they
 *            pass, how far out they shoot, how deep the defender sits, how
 *            eager the keeper is to rush, and how often they dash.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Teams = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // kit: j jersey, k accent, p shorts, w socks, pattern; gk jersey colour.
  // alt: alternate kit used when the two sides clash.
  const NATIONS = {
    bra: { name: 'Brazil', code: 'BRA', flag: '🇧🇷', color: '#f9d342',
      kit: { j: '#f9d342', k: '#1f8a3b', p: '#1b4fa0', w: '#ffffff', pattern: 'sleeves', gk: '#5c6b73' },
      alt: { j: '#1b4fa0', k: '#f9d342', p: '#ffffff', w: '#1b4fa0', pattern: 'sleeves', gk: '#2e7d32' },
      style: 'Joga Bonito', desc: 'Quick feet, dribbles at defenders, shoots from close range.',
      traits: { speed: 1.06, kick: 0.96, dash: 1.0 },
      ai: { press: 0.5, passing: 0.35, shootRange: 420, defLine: 0.45, gkRush: 0.6, dash: 0.7, flair: 1.2 } },
    arg: { name: 'Argentina', code: 'ARG', flag: '🇦🇷', color: '#74b9e8',
      kit: { j: '#74b9e8', k: '#ffffff', p: '#141414', w: '#ffffff', pattern: 'stripes', gk: '#3a3a3a' },
      alt: { j: '#2b2f6b', k: '#74b9e8', p: '#2b2f6b', w: '#2b2f6b', pattern: 'band', gk: '#b8860b' },
      style: 'Garra', desc: 'Relentless pressing and hard tackles; wins the ball high up the pitch.',
      traits: { speed: 1.03, kick: 1.0, dash: 0.85 },
      ai: { press: 0.95, passing: 0.5, shootRange: 500, defLine: 0.6, gkRush: 0.7, dash: 1.0, flair: 1.0 } },
    ger: { name: 'Germany', code: 'GER', flag: '🇩🇪', color: '#e6e6e6',
      kit: { j: '#f2f2f2', k: '#141414', p: '#141414', w: '#f2f2f2', pattern: 'band', gk: '#2e8b57' },
      alt: { j: '#1d3c34', k: '#ffffff', p: '#1d3c34', w: '#1d3c34', pattern: 'plain', gk: '#c0c0c0' },
      style: 'Die Maschine', desc: 'Disciplined shape and patient passing; strikes with power when the lane opens.',
      traits: { speed: 0.98, kick: 1.06, dash: 1.0 },
      ai: { press: 0.55, passing: 0.8, shootRange: 560, defLine: 0.5, gkRush: 0.5, dash: 0.5, flair: 0.7 } },
    fra: { name: 'France', code: 'FRA', flag: '🇫🇷', color: '#2d55c9',
      kit: { j: '#2d55c9', k: '#ffffff', p: '#ffffff', w: '#e63946', pattern: 'plain', gk: '#ffd166' },
      alt: { j: '#f4f4f4', k: '#2d55c9', p: '#2d55c9', w: '#e63946', pattern: 'hoops', gk: '#3b3b3b' },
      style: 'Contre-attaque', desc: 'Sits deep, then breaks at speed; forwards love the counter.',
      traits: { speed: 1.04, kick: 1.02, dash: 0.9 },
      ai: { press: 0.35, passing: 0.6, shootRange: 520, defLine: 0.3, gkRush: 0.5, dash: 0.9, flair: 1.0 } },
    ita: { name: 'Italy', code: 'ITA', flag: '🇮🇹', color: '#1e66b5',
      kit: { j: '#1e66b5', k: '#ffffff', p: '#ffffff', w: '#1e66b5', pattern: 'plain', gk: '#8a8a8a' },
      alt: { j: '#f4f4f4', k: '#1e66b5', p: '#1e66b5', w: '#f4f4f4', pattern: 'center', gk: '#e9c46a' },
      style: 'Catenaccio', desc: 'Defends the box as a unit, keeper comes for everything, scores on the break.',
      traits: { speed: 0.97, kick: 1.05, dash: 1.0 },
      ai: { press: 0.3, passing: 0.65, shootRange: 540, defLine: 0.2, gkRush: 0.9, dash: 0.6, flair: 0.8 } },
    esp: { name: 'Spain', code: 'ESP', flag: '🇪🇸', color: '#d7263d',
      kit: { j: '#d7263d', k: '#f9d342', p: '#1b2a6b', w: '#1b2a6b', pattern: 'sleeves', gk: '#4fa3d1' },
      alt: { j: '#f4f4f4', k: '#d7263d', p: '#f4f4f4', w: '#f4f4f4', pattern: 'sash', gk: '#1b2a6b' },
      style: 'Tiki-taka', desc: 'Passes, passes, passes; only shoots when the chance is clear.',
      traits: { speed: 1.0, kick: 0.95, dash: 1.1 },
      ai: { press: 0.7, passing: 1.0, shootRange: 380, defLine: 0.65, gkRush: 0.5, dash: 0.4, flair: 0.9 } },
    eng: { name: 'England', code: 'ENG', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', color: '#f4f4f4',
      kit: { j: '#f4f4f4', k: '#1b2a6b', p: '#1b2a6b', w: '#f4f4f4', pattern: 'plain', gk: '#e9c46a' },
      alt: { j: '#c8102e', k: '#ffffff', p: '#f4f4f4', w: '#c8102e', pattern: 'sleeves', gk: '#2f2f2f' },
      style: 'Route One', desc: 'Long balls forward and thunderous shots from anywhere.',
      traits: { speed: 0.98, kick: 1.08, dash: 1.0 },
      ai: { press: 0.6, passing: 0.3, shootRange: 680, defLine: 0.4, gkRush: 0.6, dash: 0.7, flair: 0.8 } },
    ned: { name: 'Netherlands', code: 'NED', flag: '🇳🇱', color: '#ff7f11',
      kit: { j: '#ff7f11', k: '#ffffff', p: '#ffffff', w: '#ff7f11', pattern: 'plain', gk: '#2d55c9' },
      alt: { j: '#1f2a44', k: '#ff7f11', p: '#1f2a44', w: '#1f2a44', pattern: 'vee', gk: '#f4f4f4' },
      style: 'Total Football', desc: 'Everyone attacks, everyone defends; the defender pushes right up.',
      traits: { speed: 1.02, kick: 1.0, dash: 1.0 },
      ai: { press: 0.75, passing: 0.75, shootRange: 520, defLine: 0.9, gkRush: 0.7, dash: 0.7, flair: 1.0 } },
    por: { name: 'Portugal', code: 'POR', flag: '🇵🇹', color: '#c8102e',
      kit: { j: '#c8102e', k: '#1f8a3b', p: '#1f8a3b', w: '#c8102e', pattern: 'sleeves', gk: '#3b3b3b' },
      alt: { j: '#f4f4f4', k: '#c8102e', p: '#f4f4f4', w: '#1f8a3b', pattern: 'stripes', gk: '#e9c46a' },
      style: 'Flair', desc: 'Shoots from distance, dashes into space, a little greedy.',
      traits: { speed: 1.02, kick: 1.04, dash: 0.9 },
      ai: { press: 0.5, passing: 0.3, shootRange: 640, defLine: 0.5, gkRush: 0.5, dash: 1.0, flair: 1.3 } },
    jpn: { name: 'Japan', code: 'JPN', flag: '🇯🇵', color: '#1c3d8f',
      kit: { j: '#1c3d8f', k: '#e63946', p: '#1c3d8f', w: '#1c3d8f', pattern: 'band', gk: '#8ecae6' },
      alt: { j: '#f4f4f4', k: '#1c3d8f', p: '#f4f4f4', w: '#f4f4f4', pattern: 'hoops', gk: '#e63946' },
      style: 'Hassle', desc: 'Swarms the ball carrier and moves it on quickly.',
      traits: { speed: 1.05, kick: 0.96, dash: 0.95 },
      ai: { press: 1.0, passing: 0.7, shootRange: 460, defLine: 0.6, gkRush: 0.6, dash: 0.8, flair: 0.9 } },
    usa: { name: 'USA', code: 'USA', flag: '🇺🇸', color: '#f4f4f4',
      kit: { j: '#f4f4f4', k: '#b22234', p: '#1f3c88', w: '#f4f4f4', pattern: 'hoops', gk: '#1f3c88' },
      alt: { j: '#1f3c88', k: '#ffffff', p: '#1f3c88', w: '#b22234', pattern: 'sash', gk: '#e9c46a' },
      style: 'Athletic', desc: 'Fit and fearless: dashes recover fastest in the game.',
      traits: { speed: 1.02, kick: 1.0, dash: 0.75 },
      ai: { press: 0.7, passing: 0.5, shootRange: 540, defLine: 0.5, gkRush: 0.6, dash: 1.0, flair: 0.9 } },
    nga: { name: 'Nigeria', code: 'NGA', flag: '🇳🇬', color: '#1f8a3b',
      kit: { j: '#1f8a3b', k: '#ffffff', p: '#ffffff', w: '#1f8a3b', pattern: 'checks', gk: '#3b3b3b' },
      alt: { j: '#f4f4f4', k: '#1f8a3b', p: '#1f8a3b', w: '#f4f4f4', pattern: 'checks', gk: '#e9c46a' },
      style: 'Power', desc: 'Fast and physical; hits the ball harder than anyone when it sits up.',
      traits: { speed: 1.03, kick: 1.06, dash: 1.0 },
      ai: { press: 0.65, passing: 0.35, shootRange: 600, defLine: 0.5, gkRush: 0.6, dash: 0.9, flair: 1.1 } },
    cro: { name: 'Croatia', code: 'CRO', flag: '🇭🇷', color: '#e63946',
      kit: { j: '#f4f4f4', k: '#e63946', p: '#f4f4f4', w: '#1b2a6b', pattern: 'checks', gk: '#2e8b57' },
      alt: { j: '#1b2a6b', k: '#e63946', p: '#1b2a6b', w: '#1b2a6b', pattern: 'checks', gk: '#e9c46a' },
      style: 'Midfield control', desc: 'Keeps the ball moving and pushes the defender up to support.',
      traits: { speed: 1.0, kick: 1.02, dash: 1.0 },
      ai: { press: 0.6, passing: 0.85, shootRange: 520, defLine: 0.75, gkRush: 0.5, dash: 0.5, flair: 0.9 } },
    mex: { name: 'Mexico', code: 'MEX', flag: '🇲🇽', color: '#0b7a3b',
      kit: { j: '#0b7a3b', k: '#ffffff', p: '#ffffff', w: '#d7263d', pattern: 'vee', gk: '#3b3b3b' },
      alt: { j: '#f4f4f4', k: '#0b7a3b', p: '#0b7a3b', w: '#f4f4f4', pattern: 'sleeves', gk: '#1c3d8f' },
      style: 'Quick feet', desc: 'Nimble and busy; wins second balls and plays one-twos.',
      traits: { speed: 1.05, kick: 0.95, dash: 0.95 },
      ai: { press: 0.8, passing: 0.65, shootRange: 440, defLine: 0.55, gkRush: 0.6, dash: 0.8, flair: 1.0 } },
    bel: { name: 'Belgium', code: 'BEL', flag: '🇧🇪', color: '#d7263d',
      kit: { j: '#d7263d', k: '#141414', p: '#141414', w: '#d7263d', pattern: 'sleeves', gk: '#e9c46a' },
      alt: { j: '#f4f4f4', k: '#d7263d', p: '#f4f4f4', w: '#141414', pattern: 'stripes', gk: '#2e8b57' },
      style: 'Balanced', desc: 'No weaknesses, no gimmicks: a textbook side.',
      traits: { speed: 1.0, kick: 1.0, dash: 1.0 },
      ai: { press: 0.6, passing: 0.6, shootRange: 520, defLine: 0.5, gkRush: 0.6, dash: 0.7, flair: 1.0 } },
    tur: { name: 'Türkiye', code: 'TUR', flag: '🇹🇷', color: '#e30a17',
      kit: { j: '#e30a17', k: '#ffffff', p: '#ffffff', w: '#e30a17', pattern: 'sash', gk: '#1c1c1c' },
      alt: { j: '#f4f4f4', k: '#e30a17', p: '#e30a17', w: '#f4f4f4', pattern: 'band', gk: '#e9c46a' },
      style: 'Ateş', desc: 'All heart: presses hard, shoots early, dashes into every duel.',
      traits: { speed: 1.03, kick: 1.03, dash: 0.9 },
      ai: { press: 0.9, passing: 0.4, shootRange: 600, defLine: 0.55, gkRush: 0.7, dash: 1.0, flair: 1.2 } },
  };
  const IDS = Object.keys(NATIONS);
  const DEFAULT_SIDES = { red: 'bra', blue: 'ger' };

  function get(id) { return NATIONS[id] || null; }

  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function colorDist(a, b) { const [r1, g1, b1] = hexToRgb(a), [r2, g2, b2] = hexToRgb(b); return Math.hypot(r1 - r2, g1 - g2, b1 - b2); }

  /**
   * Resolve the kits both sides wear. The blue side switches to its
   * alternate kit when its jersey is too close to the red side's.
   */
  function resolveKits(redId, blueId) {
    const a = get(redId) || NATIONS[DEFAULT_SIDES.red];
    const b = get(blueId) || NATIONS[DEFAULT_SIDES.blue];
    let bk = b.kit;
    if (colorDist(a.kit.j, b.kit.j) < 110) bk = b.alt;
    return { red: a.kit, blue: bk };
  }

  /** Display colour for a side given the resolved kit. Avoid white-on-dark being invisible. */
  function sideColor(kit) { return colorDist(kit.j, '#ffffff') < 60 ? kit.k : kit.j; }

  function randomPair() {
    const a = IDS[Math.floor(Math.random() * IDS.length)];
    let b = a;
    while (b === a) b = IDS[Math.floor(Math.random() * IDS.length)];
    return { red: a, blue: b };
  }

  /** Display name for the bot in a slot, e.g. "NED FWD". Shared so looks match everywhere. */
  function botName(nationId, team, pos) { const n = get(nationId); return `${n ? n.code : team.toUpperCase()} ${pos}`; }

  function traitsFor(id) { const n = get(id); return n ? n.traits : { speed: 1, kick: 1, dash: 1 }; }
  function aiFor(id) { const n = get(id); return n ? n.ai : NATIONS.bel.ai; }

  function sanitizeSides(input) {
    const out = Object.assign({}, DEFAULT_SIDES);
    if (input && typeof input === 'object') {
      if (get(input.red)) out.red = input.red;
      if (get(input.blue)) out.blue = input.blue;
    }
    return out;
  }

  return { NATIONS, IDS, DEFAULT_SIDES, get, resolveKits, sideColor, randomPair, traitsFor, aiFor, sanitizeSides, colorDist, botName };
});
