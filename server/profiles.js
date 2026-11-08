/**
 * server/profiles.js — persistent player cards: XP, career stats, cosmetics.
 * Owner: Priya Natarajan (T-30 storage)
 *
 * Profiles are keyed by the identity token the browser keeps in
 * localStorage. They live in memory and, when a file is given, are written
 * to a small JSON file (debounced) so they survive a server restart.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Progress = require('../shared/progress');

const MAX_PROFILES = 50000;

class Profiles {
  constructor(file) {
    this.file = file || null;
    this.map = new Map();
    this.saveTimer = null;
    if (this.file) {
      try {
        const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        for (const [k, v] of Object.entries(data)) this.map.set(k, v);
      } catch { /* first run */ }
    }
  }

  has(token) { return !!token && this.map.has(token); }

  get(token, name) {
    let p = this.map.get(token);
    if (!p) {
      if (this.map.size >= MAX_PROFILES) this.map.delete(this.map.keys().next().value);
      p = { name: name || 'Player', xp: 0, matches: 0, wins: 0, draws: 0, losses: 0, goals: 0, assists: 0, saves: 0, mvps: 0, comboGoals: 0, trophies: 0, look: {}, createdAt: Date.now() };
      this.map.set(token, p);
      this.save();
    }
    if (name && p.name !== name) { p.name = name; this.save(); }
    return p;
  }

  /** Public view sent to the owner. */
  view(p) { return Object.assign({}, p, { level: Progress.levelInfo(p.xp) }); }

  setLook(token, look) {
    const p = this.map.get(token);
    if (!p) return null;
    p.look = Progress.sanitizeLook(Object.assign({}, p.look, look), Progress.levelInfo(p.xp).level);
    this.save();
    return p;
  }

  /**
   * Record one match for a player. Returns the XP report sent to the client.
   * stats: the player's own match stats; result: win | draw | loss.
   */
  award(token, stats, result, extra) {
    const p = this.map.get(token);
    if (!p) return null;
    const before = Progress.levelInfo(p.xp);
    const { total, items } = Progress.xpForMatch(stats, result, extra);
    p.xp += total;
    p.matches++;
    if (result === 'win') p.wins++; else if (result === 'draw') p.draws++; else p.losses++;
    p.goals += stats.goals || 0; p.assists += stats.assists || 0; p.saves += stats.saves || 0;
    p.comboGoals += stats.comboGoals || 0;
    if (extra && extra.mvp) p.mvps++;
    if (extra && extra.trophy) p.trophies++;
    const after = Progress.levelInfo(p.xp);
    this.save();
    return { gained: total, items, before, after, unlocks: Progress.unlocksBetween(before.level, after.level) };
  }

  save() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const data = JSON.stringify(Object.fromEntries(this.map));
      fs.mkdir(path.dirname(this.file), { recursive: true }, () => {
        const tmp = this.file + '.tmp';
        fs.writeFile(tmp, data, (err) => { if (!err) fs.rename(tmp, this.file, () => {}); });
      });
    }, 2000);
    if (this.saveTimer.unref) this.saveTimer.unref();
  }
}

module.exports = { Profiles };
