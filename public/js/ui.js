/**
 * public/js/ui.js — lobby, create dialog, pre-match page, rules editor, chat.
 * Owner: Sam Okafor (T-12, T-13)
 */
(function () {
  'use strict';
  const MCS = window.MCS;
  const Teams = window.Teams;
  const $ = (id) => document.getElementById(id);

  /** Small pixel-art avatar canvas for lists and slot cards. */
  function avatar(team, pos, name, scale, kit) {
    const c = el('canvas', 'avatar');
    c.width = Sprites.W * scale; c.height = Sprites.H * scale;
    const ctx = c.getContext('2d');
    Sprites.draw(ctx, { team, pos, name, frame: 0, kit }, c.width / 2, c.height - scale, scale, false);
    return c;
  }

  /** Apply a room's national teams to CSS variables and return resolved kits. */
  function applySides(sides) {
    const s = Teams.sanitizeSides(sides);
    const kits = Teams.resolveKits(s.red, s.blue);
    document.documentElement.style.setProperty('--teamRed', window.readableTeamColor(Teams.sideColor(kits.red)));
    document.documentElement.style.setProperty('--teamBlue', window.readableTeamColor(Teams.sideColor(kits.blue)));
    return { sides: s, kits };
  }
  window.spriteAvatar = avatar;

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  /**
   * Render a rules editor into `container`.
   * onChange(partialRules) is called with the changed key when editable.
   */
  function renderRulesEditor(container, rules, editable, onChange, group) {
    container.innerHTML = '';
    for (const [key, s] of Object.entries(MCS.RULE_SCHEMA)) {
      if (group && (s.group || 'match') !== group) continue;
      const row = el('div', 'rule' + (rules[key] !== s.def ? ' changed' : ''));
      row.appendChild(el('span', null, s.label));
      if (s.kind === 'bool') {
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!rules[key]; cb.disabled = !editable;
        cb.onchange = () => onChange({ [key]: cb.checked });
        row.appendChild(cb);
      } else if (s.kind === 'enum') {
        const label = (v) => key === 'arena' && MCS.ARENAS[v] ? `${MCS.ARENAS[v].icon} ${MCS.ARENAS[v].label}` : v;
        if (editable) {
          const sel = el('select');
          for (const v of s.options) { const o = el('option', null, label(v)); o.value = v; o.selected = v === rules[key]; sel.appendChild(o); }
          sel.onchange = () => onChange({ [key]: sel.value });
          row.appendChild(sel);
        } else row.appendChild(el('span', 'val', label(rules[key])));
        if (key === 'arena' && MCS.ARENAS[rules[key]]) row.title = MCS.ARENAS[rules[key]].desc;
      } else if (editable) {
        const inp = el('input'); inp.type = 'number'; inp.min = s.min; inp.max = s.max; inp.step = s.step; inp.value = rules[key];
        inp.onchange = () => onChange({ [key]: Number(inp.value) });
        row.appendChild(inp);
      } else {
        row.appendChild(el('span', 'val', String(rules[key])));
      }
      container.appendChild(row);
    }
  }

  function renderBoostToggles(container, rules, editable, onChange) {
    container.innerHTML = '';
    const enabled = new Set(rules.enabledBoosts || []);
    container.classList.toggle('pool-off', !rules.boostsEnabled);
    for (const [id, b] of Object.entries(MCS.BOOSTS)) {
      const lab = el('label', 'boost' + (enabled.has(id) ? ' on' : ' off'));
      lab.style.setProperty('--boost-color', b.color);
      lab.title = `${b.label}: ${b.desc}` + (editable ? ` (click to turn ${enabled.has(id) ? 'off' : 'on'})` : '');
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = enabled.has(id); cb.disabled = !editable;
      cb.onchange = () => {
        const next = new Set(enabled); if (cb.checked) next.add(id); else next.delete(id);
        onChange({ enabledBoosts: [...next] });
      };
      lab.appendChild(cb);
      lab.appendChild(el('span', 'ic', b.icon));
      const txt = el('span', 'txt'); txt.appendChild(el('b', null, b.label)); txt.appendChild(el('small', null, b.desc));
      lab.appendChild(txt);
      lab.appendChild(el('span', 'state', enabled.has(id) ? 'On' : 'Off'));
      if (!editable) lab.style.cursor = 'default';
      container.appendChild(lab);
    }
  }

  /** "5 of 7 on", or "Off" when pickups are disabled. */
  function boostSummary(rules) {
    if (!rules.boostsEnabled) return 'Pickups off';
    return `${(rules.enabledBoosts || []).length} of ${Object.keys(MCS.BOOSTS).length} on`;
  }

  /**
   * Lobby game card: headline rule chips, the boost pool as icons, and a
   * fold-out with every rule grouped as Rules / Boosts / Advanced. (T-44)
   */
  function renderGameRules(card, rules, openSet, id) {
    if (!rules) return;
    const R = MCS.RULE_SCHEMA;
    const chips = el('div', 'rule-chips');
    const chip = (text, title, cls) => { const c = el('span', 'rchip' + (cls ? ' ' + cls : ''), text); if (title) c.title = title; chips.appendChild(c); };
    const ar = MCS.ARENAS[rules.arena];
    chip(`⏱ ${rules.matchSeconds % 60 ? rules.matchSeconds + 's' : rules.matchSeconds / 60 + ' min'}`, 'Match length');
    if (ar) chip(`${ar.icon} ${ar.label}`, ar.desc);
    if (rules.goalLimit) chip(`First to ${rules.goalLimit}`, 'Goal limit');
    if (rules.suddenDeath) chip('Sudden death', 'Next goal wins if tied at full time');
    if (rules.chaosEvents) chip('🎲 Chaos', `A chaos event every ${rules.chaosEvery}s`);
    if (!rules.specials) chip('No signature moves', null, 'off');
    if (!rules.dashEnabled) chip('No sprint / tackle', null, 'off');
    const adv = Object.keys(R).filter(k => R[k].group === 'advanced' && rules[k] !== R[k].def);
    if (adv.length) chip(`⚙ ${adv.length} custom`, adv.map(k => `${R[k].label}: ${rules[k]}`).join('\n'), 'custom');
    card.appendChild(chips);

    const pool = el('div', 'boost-pool');
    if (!rules.boostsEnabled) pool.appendChild(el('span', 'muted', 'Boost pickups off'));
    else {
      const on = new Set(rules.enabledBoosts || []);
      for (const [id, b] of Object.entries(MCS.BOOSTS)) {
        const i = el('span', 'bp' + (on.has(id) ? '' : ' off'), b.icon);
        i.title = `${b.label}: ${b.desc}${on.has(id) ? '' : ' (off)'}`;
        pool.appendChild(i);
      }
    }
    card.appendChild(pool);

    const det = el('details', 'game-rules');
    det.appendChild(el('summary', null, 'All rules'));
    // The lobby re-renders on every update, so remember which cards are open.
    det.open = openSet.has(id);
    det.ontoggle = () => { if (det.open) openSet.add(id); else openSet.delete(id); };
    for (const [group, title] of [['match', 'Rules'], ['boosts', 'Boosts'], ['advanced', 'Advanced']]) {
      det.appendChild(el('h4', null, title));
      const grid = el('div', 'rules-grid compact'); renderRulesEditor(grid, rules, false, null, group); det.appendChild(grid);
    }
    card.appendChild(det);
  }

  class UI {
    constructor(net) {
      this.net = net;
      this.room = null;
      this.games = [];
      this.pendingJoin = null;
      this.createRules = MCS.defaultRules();
      this.createSides = Teams.randomPair();
      this.openGameRules = new Set();
      this.bind();
    }

    // ---- Shared ------------------------------------------------------------
    showScreen(name) {
      for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === 'screen-' + name);
      document.body.dataset.screen = name;
    }
    error(message) {
      const t = $('errorToast'); t.textContent = message; t.classList.remove('hidden');
      clearTimeout(this._errTimer); this._errTimer = setTimeout(() => t.classList.add('hidden'), 3500);
    }

    bind() {
      // Lobby
      $('btnCreate').onclick = () => this.openCreate();
      $('createCancel').onclick = () => $('createDialog').close();
      $('createForm').onsubmit = (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        this.net.send('createGame', { name: fd.get('name'), password: fd.get('password') || undefined, rules: this.createRules, sides: this.createSides, mode: fd.get('mode') || 'match' });
        $('createDialog').close();
      };
      $('createShuffle').onclick = () => { this.createSides = Teams.randomPair(); this.renderCreateSides(); };
      $('joinCodeForm').onsubmit = (e) => { e.preventDefault(); const code = $('joinCode').value.trim(); if (code) this.net.send('joinGame', { invite: code }); };
      $('passwordCancel').onclick = () => $('passwordDialog').close();
      $('passwordForm').onsubmit = (e) => {
        e.preventDefault();
        const pw = new FormData(e.target).get('password');
        if (this.pendingJoin) this.net.send('joinGame', { roomId: this.pendingJoin, password: pw });
        $('passwordDialog').close();
      };
      // Pre-match
      $('btnLeaveRoom').onclick = () => this.net.send('leaveGame');
      $('btnCopyLink').onclick = () => this.copyInvite();
      $('inviteCode').onclick = () => this.copyInvite();
      $('btnReady').onclick = () => { const me = this.me(); if (me) this.net.send('setReady', { ready: !me.ready }); };
      $('btnStart').onclick = () => this.net.send('startGame');
      $('chatFormPre').onsubmit = (e) => { e.preventDefault(); const t = $('chatInputPre').value.trim(); if (t) this.net.send('chat', { text: t }); $('chatInputPre').value = ''; };
    }

    me() { return this.room && this.room.players.find(p => p.id === this.net.id); }
    isHost() { return this.room && this.room.hostId === this.net.id; }

    // ---- Lobby --------------------------------------------------------------
    openCreate() {
      this.createRules = MCS.defaultRules();
      this.createSides = Teams.randomPair();
      const form = $('createForm'); form.reset();
      form.elements.name.value = `${this.net.name || 'My'}'s game`;
      this.renderCreateSides();
      const update = (patch) => { this.createRules = MCS.sanitizeRules(patch, this.createRules); rerender(); };
      const rerender = () => {
        renderRulesEditor($('createRules'), this.createRules, true, update, 'match');
        renderRulesEditor($('createBoostRules'), this.createRules, true, update, 'boosts');
        renderRulesEditor($('createRulesAdv'), this.createRules, true, update, 'advanced');
        renderBoostToggles($('createBoosts'), this.createRules, true, update);
        $('createBoostCount').textContent = boostSummary(this.createRules);
      };
      for (const d of document.querySelectorAll('#createForm .rule-sections details')) d.open = false;
      rerender();
      $('createDialog').showModal();
    }

    /** Team pickers inside the create dialog: select, kit preview, style blurb. */
    renderCreateSides() {
      const kits = Teams.resolveKits(this.createSides.red, this.createSides.blue);
      for (const team of MCS.TEAMS) {
        const box = $('createSide-' + team); box.innerHTML = '';
        const nation = Teams.get(this.createSides[team]);
        box.style.borderTopColor = window.readableTeamColor(Teams.sideColor(kits[team]));
        const pick = el('div', 'pick');
        const sel = el('select', 'team-select');
        for (const id of Teams.IDS) {
          const o = el('option', null, `${Teams.NATIONS[id].flag} ${Teams.NATIONS[id].name}`); o.value = id; o.selected = id === this.createSides[team];
          sel.appendChild(o);
        }
        sel.onchange = () => {
          const other = MCS.otherTeam(team);
          if (this.createSides[other] === sel.value) this.createSides[other] = this.createSides[team]; // swap, never duplicate
          this.createSides[team] = sel.value;
          this.renderCreateSides();
        };
        pick.appendChild(sel);
        box.appendChild(pick);
        const prev = el('div', 'preview');
        for (const pos of MCS.POSITIONS) prev.appendChild(avatar(team, pos, Teams.botName(this.createSides[team], team, pos), 2, kits[team]));
        box.appendChild(prev);
        const blurb = el('div', 'blurb');
        blurb.appendChild(el('b', null, nation.style));
        blurb.appendChild(document.createTextNode(' · ' + nation.desc));
        const sp = Teams.specialFor(this.createSides[team]);
        blurb.appendChild(el('div', 'team-special', `${sp.icon} ${sp.name}`));
        box.appendChild(blurb);
      }
    }

    renderLobby(games) {
      this.games = games;
      const list = $('gameList'); list.innerHTML = '';
      $('noGames').classList.toggle('hidden', games.length > 0);
      $('gameCount').textContent = games.length ? `${games.length} game${games.length === 1 ? '' : 's'} · ${games.reduce((a, g) => a + g.humans, 0)} player${games.reduce((a, g) => a + g.humans, 0) === 1 ? '' : 's'} in rooms` : '';
      for (const g of games) {
        const card = el('div', 'game-card');
        const title = el('div', 'title');
        const na = Teams.get(g.sides && g.sides.red), nb = Teams.get(g.sides && g.sides.blue);
        title.appendChild(el('span', 'name', (g.locked ? '🔒 ' : '') + g.name));
        const badges = el('span', 'badges');
        if (g.mode === 'tournament') badges.appendChild(el('span', 'badge tour', `🏆 ${g.round || 'Tournament'}`));
        if (g.arena && g.arena !== 'classic' && MCS.ARENAS[g.arena]) badges.appendChild(el('span', 'badge', `${MCS.ARENAS[g.arena].icon} ${MCS.ARENAS[g.arena].label}`));
        const badge = el('span', 'badge ' + (g.status === 'playing' ? 'live' : g.status === 'ended' ? 'ended' : 'open'));
        badge.textContent = g.status === 'playing' ? 'Live' : g.status === 'ended' ? 'Full time' : 'Waiting';
        badges.appendChild(badge);
        title.appendChild(badges);
        card.appendChild(title);
        if (na && nb) card.appendChild(el('div', 'matchup', `${na.flag} ${na.name}  v  ${nb.flag} ${nb.name}`));
        const meta = el('div', 'meta');
        meta.appendChild(el('span', null, `Host ${g.hostName}`));
        meta.appendChild(el('span', null, `${g.humans} human${g.humans === 1 ? '' : 's'} · ${g.slotsTaken}/${g.slotsTotal} slots`));
        meta.appendChild(el('span', null, `${Math.round(g.matchSeconds / 60)} min`));
        if (g.status === 'playing' && g.score) meta.appendChild(el('span', null, `Score ${g.score.red}–${g.score.blue} · ${Math.floor(g.timeLeft / 60)}:${String(g.timeLeft % 60).padStart(2, '0')} left`));
        card.appendChild(meta);
        renderGameRules(card, g.rules, this.openGameRules, g.id);
        const btn = el('button', g.status === 'playing' ? '' : 'primary', g.status === 'playing' ? 'Join live (take a bot slot)' : g.status === 'ended' ? 'Join for the rematch' : 'Join');
        btn.onclick = () => this.join(g);
        card.appendChild(btn);
        list.appendChild(card);
      }
    }

    join(g) {
      if (g.locked) { this.pendingJoin = g.id; $('passwordForm').reset(); $('passwordDialog').showModal(); }
      else this.net.send('joinGame', { roomId: g.id });
    }

    // ---- Pre-match -----------------------------------------------------------
    inviteLink() { return `${location.origin}/?invite=${this.room.inviteCode}`; }
    copyInvite() {
      const link = this.inviteLink();
      const done = () => { $('btnCopyLink').textContent = 'Copied!'; setTimeout(() => { $('btnCopyLink').textContent = 'Copy link'; }, 1500); };
      if (navigator.clipboard) navigator.clipboard.writeText(link).then(done, () => prompt('Invite link', link));
      else prompt('Invite link', link);
    }

    renderRoom(room) {
      this.room = room;
      if (!room) return;
      const me = this.me(), host = this.isHost();
      $('roomTitle').textContent = room.name + (room.locked ? ' 🔒' : '');
      $('roomSub').textContent = `Hosted by ${room.players.find(p => p.id === room.hostId)?.name || '?'} · ${room.status === 'ended' ? 'match finished, waiting for rematch' : 'pick a team and position'}`;
      $('inviteCode').textContent = room.inviteCode;

      const { sides, kits } = applySides(room.sides);
      for (const team of MCS.TEAMS) {
        this.renderTeamHeader(team, sides[team], host && room.status !== 'playing' && !(room.mode === 'tournament' && room.tournament && room.tournament.round < 3));
        const box = $('slots-' + team); box.innerHTML = '';
        for (const pos of MCS.POSITIONS) {
          const sid = MCS.slotId(team, pos);
          const pid = room.slots[sid];
          const p = pid && room.players.find(x => x.id === pid);
          const slot = el('div', 'slot' + (p ? ' taken' : ' bot') + (pid === this.net.id ? ' mine' : ''));
          slot.appendChild(avatar(team, pos, p ? p.name : Teams.botName(sides[team], team, pos), 3, kits[team]));
          slot.appendChild(el('span', 'pos', pos));
          const who = el('span', 'who');
          if (p) { who.appendChild(document.createTextNode(p.name + (p.connected ? '' : ' (reconnecting…)'))); who.appendChild(el('small', null, pid === this.net.id ? 'You · click to leave the slot' : 'Human')); }
          else { who.appendChild(document.createTextNode('🤖 Bot')); who.appendChild(el('small', null, 'Click to play here')); }
          slot.appendChild(who);
          if (p && p.ready) slot.appendChild(el('span', 'ready', '✓ ready'));
          slot.onclick = () => {
            if (pid === this.net.id) this.net.send('leaveSlot');
            else if (!pid) this.net.send('pickSlot', { slot: sid });
          };
          box.appendChild(slot);
        }
      }

      const pl = $('playerList'); pl.innerHTML = '';
      $('playerCount').textContent = `${room.players.length} in room`;
      for (const p of room.players) {
        const li = el('li', p.connected ? '' : 'offline');
        li.appendChild(el('span', null, p.name));
        if (p.id === room.hostId) li.appendChild(el('span', 'badge', 'Host'));
        if (p.id === this.net.id) li.appendChild(el('span', 'badge open', 'You'));
        li.appendChild(el('span', 'tag', p.slot ? (() => { const { team, pos } = MCS.parseSlot(p.slot); return Teams.botName(sides[team], team, pos); })() : 'spectating'));
        if (host && p.id !== this.net.id) { const k = el('button', 'ghost small kick', 'Kick'); k.onclick = () => this.net.send('kickPlayer', { playerId: p.id }); li.appendChild(k); }
        pl.appendChild(li);
      }

      $('btnReady').textContent = me && me.ready ? 'Not ready' : 'Ready';
      $('btnReady').disabled = !me || !me.slot;
      $('btnStart').classList.toggle('hidden', !host);
      const t = room.tournament;
      const tourOver = t && t.round >= t.names.length;
      if (room.mode === 'tournament') {
        $('btnStart').textContent = room.status === 'ended' ? (tourOver ? 'Back to the room' : 'Next round') : !t || tourOver ? 'Start tournament' : `Play the ${t.roundName.toLowerCase()}`;
        $('btnStart').disabled = !!(t && t.simulating);
      } else { $('btnStart').textContent = room.status === 'ended' ? 'Rematch' : 'Start match'; $('btnStart').disabled = false; }
      this.renderBracket(room, host);
      const humansSeated = room.players.filter(p => p.slot).length;
      const notReady = room.players.filter(p => p.slot && !p.ready).length;
      $('startHint').textContent = host
        ? `${humansSeated} human${humansSeated === 1 ? '' : 's'} seated, ${MCS.TEAMS.length * MCS.TEAM_SIZE - humansSeated} bot${MCS.TEAMS.length * MCS.TEAM_SIZE - humansSeated === 1 ? '' : 's'}${notReady ? ` · ${notReady} not ready yet` : ''}. You can start whenever you like.`
        : 'Waiting for the host to start the match.';
      $('btnStart').onclick = () => this.net.send(room.status === 'ended' ? 'rematch' : 'startGame');

      $('rulesHint').textContent = host ? 'You can edit these' : 'Only the host can edit';
      const canEdit = host && room.status !== 'playing', send = (patch) => this.net.send('updateRules', { rules: patch });
      renderRulesEditor($('roomRules'), room.rules, canEdit, send, 'match');
      renderRulesEditor($('roomRulesAdv'), room.rules, canEdit, send, 'advanced');
      renderRulesEditor($('roomBoostRules'), room.rules, canEdit, send, 'boosts');
      renderBoostToggles($('roomBoosts'), room.rules, canEdit, send);
      $('boostHint').textContent = boostSummary(room.rules);
      const advChanged = Object.entries(MCS.RULE_SCHEMA).filter(([k, sc]) => sc.group === 'advanced' && room.rules[k] !== sc.def).length;
      $('roomRulesAdv').closest('details').querySelector('summary .muted').textContent = advChanged ? `${advChanged} changed` : 'physics, timings, mercy rule';
    }

    /** Mode switch and the knockout bracket. */
    renderBracket(room, host) {
      const card = $('bracketCard');
      // Mode switch lives in the card header so the host can flip it before starting.
      let sw = $('modeSwitch');
      if (!sw) {
        sw = el('select'); sw.id = 'modeSwitch';
        for (const [v, l] of [['match', '⚽ Single match'], ['tournament', '🏆 Tournament']]) { const o = el('option', null, l); o.value = v; sw.appendChild(o); }
        sw.onchange = () => this.net.send('setMode', { mode: sw.value });
        $('roomSub').after(sw);
      }
      sw.value = room.mode || 'match';
      sw.disabled = !host || room.status === 'playing';
      sw.className = 'mode-switch';
      card.classList.toggle('hidden', room.mode !== 'tournament');
      if (room.mode !== 'tournament') return;
      const t = room.tournament, box = $('bracket'); box.innerHTML = '';
      const flag = (id) => (Teams.get(id) || {}).flag || '';
      const name = (id) => (Teams.get(id) || {}).name || '?';
      if (!t) {
        $('bracketTitle').textContent = '🏆 Tournament';
        $('bracketHint').textContent = `${name(room.sides.red)} (your nation, red) open against ${name(room.sides.blue)}. Six more nations are drawn when you start.`;
        return;
      }
      const over = t.round >= t.names.length;
      $('bracketTitle').textContent = over ? (t.status === 'champion' ? `🏆 ${name(t.home)} are champions!` : `🏆 ${name(t.champion)} won the tournament`) : `🏆 Tournament · ${t.roundName}`;
      $('bracketHint').textContent = t.simulating ? 'Other fixtures are being played…' : over ? 'Start again for a fresh draw' : t.status === 'out' ? `${name(t.home)} are out` : `Your nation: ${flag(t.home)} ${name(t.home)}`;
      t.names.forEach((rn, r) => {
        const col = el('div', 'round' + (r === t.round ? ' current' : ''));
        col.appendChild(el('h4', null, rn));
        const fixtures = t.rounds[r].length ? t.rounds[r] : Array.from({ length: [4, 2, 1][r] }, () => null);
        for (const f of fixtures) {
          const fx = el('div', 'fixture' + (f && (f.a === t.home || f.b === t.home) ? ' home' : ''));
          if (!f) { fx.appendChild(el('div', 'side tbd', 'TBD')); fx.appendChild(el('div', 'side tbd', 'TBD')); col.appendChild(fx); continue; }
          for (const [i, id] of [[0, f.a], [1, f.b]]) {
            const row = el('div', 'side' + (f.winner === id ? ' won' : f.winner ? ' lost' : ''));
            row.appendChild(el('span', null, `${flag(id)} ${name(id)}`));
            row.appendChild(el('b', null, f.score ? String(f.score[i]) + (f.pens ? ` (${f.pens[i]})` : '') : ''));
            fx.appendChild(row);
          }
          if (!f.winner && (f.a === t.home || f.b === t.home) && t.status === 'running') fx.appendChild(el('div', 'next', 'Up next: you play this one'));
          col.appendChild(fx);
        }
        box.appendChild(col);
      });
      if (over) {
        const champ = el('div', 'round champ');
        champ.appendChild(el('h4', null, 'Champion'));
        champ.appendChild(el('div', 'cup-small', `🏆 ${flag(t.champion)} ${name(t.champion)}`));
        box.appendChild(champ);
      }
    }

    /** Country picker, style blurb and traits for one side of the pre-match board. */
    renderTeamHeader(team, nationId, editable) {
      const head = $('team-head-' + team); head.innerHTML = '';
      const nation = Teams.get(nationId);
      const title = el('div', 'team-title');
      if (editable) {
        const sel = el('select', 'team-select');
        for (const id of Teams.IDS) {
          const o = el('option', null, `${Teams.NATIONS[id].flag} ${Teams.NATIONS[id].name}`); o.value = id; o.selected = id === nationId;
          sel.appendChild(o);
        }
        sel.onchange = () => this.net.send('setTeam', { side: team, nation: sel.value });
        title.appendChild(sel);
      } else {
        title.appendChild(el('span', 'flag', nation.flag));
        title.appendChild(el('h2', null, nation.name));
      }
      head.appendChild(title);
      const style = el('div', 'team-style');
      style.appendChild(el('b', null, nation.style));
      style.appendChild(document.createTextNode(' · ' + nation.desc));
      head.appendChild(style);
      const t = nation.traits;
      const pct = (v, inv) => { const d = Math.round(((inv ? 1 / v : v) - 1) * 100); return (d >= 0 ? '+' : '') + d + '%'; };
      const traits = el('div', 'team-traits');
      traits.appendChild(el('span', t.speed >= 1 ? 'up' : 'down', `Speed ${pct(t.speed)}`));
      traits.appendChild(el('span', t.kick >= 1 ? 'up' : 'down', `Kick ${pct(t.kick)}`));
      traits.appendChild(el('span', t.dash <= 1 ? 'up' : 'down', `Dash recharge ${pct(t.dash, true)}`));
      head.appendChild(traits);
      const sp = Teams.specialFor(nationId);
      const spl = el('div', 'team-special');
      spl.appendChild(el('b', null, `${sp.icon} ${sp.name}`));
      spl.appendChild(document.createTextNode(' · ' + sp.desc));
      head.appendChild(spl);
    }

    addChat(msg) {
      for (const id of ['chatLogPre', 'chatLogGame']) {
        const log = $(id);
        const d = el('div', 'msg ' + (msg.system ? 'system' : (msg.team || '')));
        if (msg.from) d.appendChild(el('b', null, msg.from + ':'));
        d.appendChild(document.createTextNode(msg.text));
        log.appendChild(d);
        while (log.children.length > 40) log.firstChild.remove();
        log.scrollTop = log.scrollHeight;
        if (id === 'chatLogGame') setTimeout(() => d.remove(), 12000);
      }
    }
  }

  window.UI = UI;
  window.renderRulesEditor = renderRulesEditor;
})();
