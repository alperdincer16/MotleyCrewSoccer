/**
 * shared/progress.js — player levels, XP awards and cosmetic unlocks.
 * Owner: Alex Mercer (T-30 design) with Sam Okafor (player card UI)
 *
 * Shared by the server (which awards XP and validates looks) and the
 * browser (which renders the player card). Dependency-free.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Progress = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LEVEL_CAP = 30;
  /** XP needed to go from level L to L+1. */
  function stepXp(L) { return 100 + 50 * (L - 1); }
  /** Total XP at which level L starts. */
  function xpAtLevel(L) { let t = 0; for (let i = 1; i < L; i++) t += stepXp(i); return t; }
  function levelInfo(xp) {
    xp = Math.max(0, Math.floor(xp || 0));
    let L = 1;
    while (L < LEVEL_CAP && xp >= xpAtLevel(L + 1)) L++;
    const start = xpAtLevel(L), need = L >= LEVEL_CAP ? 0 : stepXp(L);
    return { level: L, xp, into: xp - start, need, max: L >= LEVEL_CAP };
  }

  const TIERS = [
    { min: 20, id: 'legend', label: 'Legend', color: '#c77dff' },
    { min: 10, id: 'star',   label: 'Star',   color: '#ffd166' },
    { min: 5,  id: 'pro',    label: 'Pro',    color: '#cfd8e3' },
    { min: 1,  id: 'rookie', label: 'Rookie', color: '#d08c5b' },
  ];
  function tierFor(level) { return TIERS.find(t => level >= t.min); }

  // Cosmetics: every option has the level it unlocks at.
  const HAIR_STYLES = [
    { id: 'short', label: 'Short', lvl: 1 }, { id: 'bald', label: 'Shaved', lvl: 1 },
    { id: 'long', label: 'Long', lvl: 2 }, { id: 'spiky', label: 'Spiky', lvl: 3 },
    { id: 'curly', label: 'Curly', lvl: 5 }, { id: 'afro', label: 'Afro', lvl: 7 },
    { id: 'band', label: 'Headband', lvl: 8 },
  ];
  const HAIR_COLORS = [
    { id: '#1b1b1b', label: 'Black', lvl: 1 }, { id: '#3a2416', label: 'Dark brown', lvl: 1 },
    { id: '#7a4a1e', label: 'Brown', lvl: 1 }, { id: '#c98a3a', label: 'Dark blond', lvl: 4 },
    { id: '#f2d35b', label: 'Blond', lvl: 6 }, { id: '#d94a2c', label: 'Ginger', lvl: 9 },
    { id: '#4cc9f0', label: 'Electric blue', lvl: 15 }, { id: '#ff5d8f', label: 'Hot pink', lvl: 20 },
  ];
  const BOOTS = [
    { id: '#1a1a1a', label: 'Classic black', lvl: 1 }, { id: '#f4f4f4', label: 'White', lvl: 2 },
    { id: '#e63946', label: 'Red', lvl: 3 }, { id: '#2a7de1', label: 'Blue', lvl: 4 },
    { id: '#7cff4f', label: 'Neon', lvl: 5 }, { id: '#ff5d8f', label: 'Pink', lvl: 7 },
    { id: '#ffd166', label: 'Gold', lvl: 10 }, { id: '#c77dff', label: 'Legend purple', lvl: 20 },
  ];
  const CELEBRATIONS = [
    { id: 'fistpump', label: 'Fist pump', lvl: 1 },
    { id: 'dance', label: 'Dance', lvl: 2 },
    { id: 'slide', label: 'Knee slide', lvl: 4 },
    { id: 'airplane', label: 'Airplane', lvl: 6 },
    { id: 'robot', label: 'The robot', lvl: 9 },
    { id: 'backflip', label: 'Backflip', lvl: 12 },
  ];
  const COSMETICS = { hair: HAIR_STYLES, hairColor: HAIR_COLORS, boots: BOOTS, celebration: CELEBRATIONS };

  /** Keep only the cosmetic choices this level has unlocked. */
  function sanitizeLook(look, level) {
    const out = {};
    if (!look || typeof look !== 'object') return out;
    for (const [key, list] of Object.entries(COSMETICS)) {
      const opt = list.find(o => o.id === look[key]);
      if (opt && opt.lvl <= level) out[key] = opt.id;
    }
    return out;
  }

  /** Everything that unlocks when going from level a to level b. */
  function unlocksBetween(a, b) {
    const out = [];
    for (const [key, list] of Object.entries(COSMETICS)) for (const o of list) if (o.lvl > a && o.lvl <= b) out.push({ key, id: o.id, label: o.label, lvl: o.lvl });
    return out.sort((x, y) => x.lvl - y.lvl);
  }

  /**
   * XP for one match. `s` is the player's own stats in the match, `result`
   * is 'win' | 'draw' | 'loss', `extra` { mvp, tournament }.
   */
  function xpForMatch(s, result, extra = {}) {
    const items = [['Match played', 40]];
    if (result === 'win') items.push(['Win', 60]); else if (result === 'draw') items.push(['Draw', 25]);
    if (s.goals) items.push([`Goals × ${s.goals}`, 25 * s.goals]);
    if (s.assists) items.push([`Assists × ${s.assists}`, 15 * s.assists]);
    if (s.saves) items.push([`Saves × ${s.saves}`, 10 * s.saves]);
    if (s.comboGoals) items.push([`Combo goals × ${s.comboGoals}`, 10 * s.comboGoals]);
    if (extra.mvp) items.push(['Man of the match', 30]);
    if (extra.tournament) items.push([extra.tournament.label, extra.tournament.xp]);
    return { total: items.reduce((a, [, v]) => a + v, 0), items };
  }

  /** Match rating used to pick the man of the match (same formula everywhere). */
  function matchRating(s) { return s.goals * 3 + s.assists * 2 + (s.saves || 0) * 1.5 + (s.kicks || 0) * 0.1; }

  return { LEVEL_CAP, stepXp, xpAtLevel, levelInfo, TIERS, tierFor, COSMETICS, HAIR_STYLES, HAIR_COLORS, BOOTS, CELEBRATIONS, sanitizeLook, unlocksBetween, xpForMatch, matchRating };
});
