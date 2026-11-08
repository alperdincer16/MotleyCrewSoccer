/**
 * public/js/card.js — your player card: level, XP, career stats and the
 * cosmetics you have unlocked (hair, boots, goal celebration). Also renders
 * the post-match XP panel.
 * Owner: Sam Okafor (T-30 UI)
 */
(function () {
  'use strict';
  const P = window.Progress;
  const $ = (id) => document.getElementById(id);
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  class PlayerCard {
    constructor(net, audio) {
      this.net = net; this.audio = audio;
      this.profile = null;
      this.previewAnim = null;
      $('cardChip').onclick = () => this.open();
      $('cardClose').onclick = () => $('cardDialog').close();
      $('cardDialog').addEventListener('close', () => { cancelAnimationFrame(this.previewAnim); this.previewAnim = null; });
    }

    setProfile(profile) {
      this.profile = profile;
      const L = profile.level;
      const tier = P.tierFor(L.level);
      $('cardChipLevel').textContent = `Lv ${L.level}`;
      $('cardChipLevel').style.background = tier.color;
      $('cardChipFill').style.width = L.max ? '100%' : `${Math.round(L.into / L.need * 100)}%`;
      if ($('cardDialog').open) this.render();
    }

    open() { if (!this.profile) return; this.render(); $('cardDialog').showModal(); this.animatePreview(); }

    render() {
      const p = this.profile, L = p.level, tier = P.tierFor(L.level);
      $('cardName').textContent = p.name;
      const badge = $('cardTier'); badge.textContent = `${tier.label} · Level ${L.level}`; badge.style.background = tier.color;
      $('cardXpText').textContent = L.max ? `${L.xp} XP · max level` : `${L.into} / ${L.need} XP to level ${L.level + 1}`;
      $('cardXpFill').style.width = L.max ? '100%' : `${Math.round(L.into / L.need * 100)}%`;
      const stats = $('cardStats'); stats.innerHTML = '';
      const rows = [['Matches', p.matches], ['Wins', p.wins], ['Goals', p.goals], ['Assists', p.assists], ['Saves', p.saves], ['Man of the match', p.mvps], ['Combo goals', p.comboGoals], ['Trophies', p.trophies || 0]];
      for (const [k, v] of rows) { const d = el('div', 'stat'); d.appendChild(el('b', null, String(v))); d.appendChild(el('span', null, k)); stats.appendChild(d); }

      const look = p.look || {};
      const pick = $('cardPickers'); pick.innerHTML = '';
      const group = (title, key, list, swatch) => {
        pick.appendChild(el('h3', null, title));
        const row = el('div', 'pick-row');
        const auto = el('button', 'pick' + (!look[key] ? ' on' : ''), key === 'celebration' ? 'Random' : 'Auto');
        auto.type = 'button'; auto.title = 'Derived from your name';
        auto.onclick = () => this.choose(key, null);
        row.appendChild(auto);
        for (const o of list) {
          const locked = o.lvl > L.level;
          const b = el('button', 'pick' + (look[key] === o.id ? ' on' : '') + (locked ? ' locked' : ''));
          b.type = 'button';
          if (swatch) { const sw = el('span', 'swatch'); sw.style.background = o.id; b.appendChild(sw); }
          b.appendChild(document.createTextNode(locked ? `🔒 ${o.label} · Lv ${o.lvl}` : o.label));
          b.disabled = locked;
          b.onclick = () => this.choose(key, o.id);
          row.appendChild(b);
        }
        pick.appendChild(row);
      };
      group('Hairstyle', 'hair', P.HAIR_STYLES, false);
      group('Hair colour', 'hairColor', P.HAIR_COLORS, true);
      group('Boots', 'boots', P.BOOTS, true);
      group('Goal celebration', 'celebration', P.CELEBRATIONS, false);
    }

    choose(key, id) {
      const look = Object.assign({}, this.profile.look || {});
      if (id) look[key] = id; else delete look[key];
      this.profile.look = look;     // optimistic; the server echoes the sanitized card
      this.net.send('setLook', { look: Object.assign({ hair: null, hairColor: null, boots: null, celebration: null }, look) });
      this.render();
    }

    /** Animated preview: the player in a neutral kit doing their celebration. */
    animatePreview() {
      const c = $('cardPreview'), ctx = c.getContext('2d');
      const t0 = performance.now();
      const frame = (now) => {
        if (!$('cardDialog').open) return;
        const t = (now - t0) / 1000;
        ctx.clearRect(0, 0, c.width, c.height);
        const p = this.profile;
        const kind = Sprites.celebrationFor(p.name, p.look);
        Celebrate.drawFigure(ctx, { team: 'red', pos: 'FWD', name: p.name, look: p.look, kit: null }, c.width / 2, c.height - 22, 8, kind, t);
        this.previewAnim = requestAnimationFrame(frame);
      };
      cancelAnimationFrame(this.previewAnim);
      this.previewAnim = requestAnimationFrame(frame);
    }

    /** Post-match XP panel inside the results card. */
    showXp(rep) {
      const box = $('xpPanel'); box.innerHTML = ''; box.classList.remove('hidden');
      const head = el('div', 'xp-head');
      head.appendChild(el('b', 'xp-gain', `+${rep.gained} XP`));
      const lv = rep.after.level > rep.before.level ? `Level up! ${rep.before.level} → ${rep.after.level}` : `Level ${rep.after.level}`;
      head.appendChild(el('span', rep.after.level > rep.before.level ? 'xp-up' : 'muted', lv));
      box.appendChild(head);
      const bar = el('div', 'xp-bar'); const fill = el('div', 'xp-fill'); bar.appendChild(fill); box.appendChild(bar);
      const pct = rep.after.max ? 100 : Math.round(rep.after.into / rep.after.need * 100);
      fill.style.width = rep.after.level > rep.before.level ? '0%' : `${rep.before.max ? 100 : Math.round(rep.before.into / rep.before.need * 100)}%`;
      requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = pct + '%'; }));
      const list = el('div', 'xp-items');
      for (const [label, v] of rep.items) { const r = el('div'); r.appendChild(el('span', null, label)); r.appendChild(el('span', null, `+${v}`)); list.appendChild(r); }
      box.appendChild(list);
      if (rep.unlocks && rep.unlocks.length) {
        box.appendChild(el('div', 'xp-unlocks', '🔓 Unlocked: ' + rep.unlocks.map(u => u.label + (u.key === 'celebration' ? ' (celebration)' : u.key === 'boots' ? ' boots' : u.key === 'hairColor' ? ' hair' : '')).join(', ') + '. Open your player card to equip.'));
      }
      if (rep.after.level > rep.before.level && this.audio) this.audio.levelUp();
    }
    hideXp() { $('xpPanel').classList.add('hidden'); }
  }

  window.PlayerCard = PlayerCard;
})();
