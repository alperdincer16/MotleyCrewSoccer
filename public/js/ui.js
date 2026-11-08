/**
 * public/js/ui.js — lobby, create dialog, pre-match page, rules editor, chat.
 * Owner: Sam Okafor (T-12, T-13)
 */
(function () {
  'use strict';
  const MCS = window.MCS;
  const $ = (id) => document.getElementById(id);

  /** Small pixel-art avatar canvas for lists and slot cards. */
  function avatar(team, pos, name, scale) {
    const c = el('canvas', 'avatar');
    c.width = Sprites.W * scale; c.height = Sprites.H * scale;
    const ctx = c.getContext('2d');
    Sprites.draw(ctx, { team, pos, name, frame: 0 }, c.width / 2, c.height - scale, scale, false);
    return c;
  }
  window.spriteAvatar = avatar;

  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  /**
   * Render a rules editor into `container`.
   * onChange(partialRules) is called with the changed key when editable.
   */
  function renderRulesEditor(container, rules, editable, onChange) {
    container.innerHTML = '';
    for (const [key, s] of Object.entries(MCS.RULE_SCHEMA)) {
      const row = el('div', 'rule');
      row.appendChild(el('span', null, s.label));
      if (s.kind === 'bool') {
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!rules[key]; cb.disabled = !editable;
        cb.onchange = () => onChange({ [key]: cb.checked });
        row.appendChild(cb);
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
    for (const [id, b] of Object.entries(MCS.BOOSTS)) {
      const lab = el('label', 'boost' + (enabled.has(id) ? '' : ' off'));
      lab.style.borderColor = enabled.has(id) ? b.color : '';
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = enabled.has(id); cb.disabled = !editable;
      cb.onchange = () => {
        const next = new Set(enabled); if (cb.checked) next.add(id); else next.delete(id);
        onChange({ enabledBoosts: [...next] });
      };
      lab.appendChild(cb);
      lab.appendChild(el('span', 'ic', b.icon));
      const txt = el('span'); txt.appendChild(document.createTextNode(b.label)); txt.appendChild(el('small', null, b.desc));
      lab.appendChild(txt);
      if (!editable) lab.style.cursor = 'default';
      container.appendChild(lab);
    }
  }

  class UI {
    constructor(net) {
      this.net = net;
      this.room = null;
      this.games = [];
      this.pendingJoin = null;
      this.createRules = MCS.defaultRules();
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
        this.net.send('createGame', { name: fd.get('name'), password: fd.get('password') || undefined, rules: this.createRules });
        $('createDialog').close();
      };
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
      const form = $('createForm'); form.reset();
      form.elements.name.value = `${this.net.name || 'My'}'s game`;
      const rerender = () => {
        renderRulesEditor($('createRules'), this.createRules, true, (patch) => { this.createRules = MCS.sanitizeRules(patch, this.createRules); });
        const bt = $('createBoosts') || (() => { const d = el('div', 'boost-grid'); d.id = 'createBoosts'; d.style.gridColumn = '1 / -1'; $('createRules').after(d); return d; })();
        renderBoostToggles(bt, this.createRules, true, (patch) => { this.createRules = MCS.sanitizeRules(patch, this.createRules); rerender(); });
      };
      rerender();
      $('createDialog').showModal();
    }

    renderLobby(games) {
      this.games = games;
      const list = $('gameList'); list.innerHTML = '';
      $('noGames').classList.toggle('hidden', games.length > 0);
      $('gameCount').textContent = games.length ? `${games.length} game${games.length === 1 ? '' : 's'} · ${games.reduce((a, g) => a + g.humans, 0)} players online in rooms` : '';
      for (const g of games) {
        const card = el('div', 'game-card');
        const title = el('div', 'title');
        title.appendChild(el('span', null, (g.locked ? '🔒 ' : '') + g.name));
        const badge = el('span', 'badge ' + (g.status === 'playing' ? 'live' : g.status === 'ended' ? 'ended' : 'open'));
        badge.textContent = g.status === 'playing' ? 'Live' : g.status === 'ended' ? 'Full time' : 'Waiting';
        title.appendChild(badge);
        card.appendChild(title);
        const meta = el('div', 'meta');
        meta.appendChild(el('span', null, `Host: ${g.hostName}`));
        meta.appendChild(el('span', null, `${g.humans} human${g.humans === 1 ? '' : 's'} · ${g.slotsTaken}/${g.slotsTotal} slots`));
        meta.appendChild(el('span', null, `${Math.round(g.matchSeconds / 60)} min`));
        if (g.status === 'playing' && g.score) meta.appendChild(el('span', null, `Score ${g.score.red}–${g.score.blue} · ${Math.floor(g.timeLeft / 60)}:${String(g.timeLeft % 60).padStart(2, '0')} left`));
        card.appendChild(meta);
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

      for (const team of MCS.TEAMS) {
        const box = $('slots-' + team); box.innerHTML = '';
        for (const pos of MCS.POSITIONS) {
          const sid = MCS.slotId(team, pos);
          const pid = room.slots[sid];
          const p = pid && room.players.find(x => x.id === pid);
          const slot = el('div', 'slot' + (p ? ' taken' : ' bot') + (pid === this.net.id ? ' mine' : ''));
          slot.appendChild(avatar(team, pos, p ? p.name : `${team.toUpperCase()} ${pos} bot`, 3));
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
        if (p.id === room.hostId) li.appendChild(el('span', 'tag', 'HOST'));
        if (p.id === this.net.id) li.appendChild(el('span', 'tag', 'YOU'));
        li.appendChild(el('span', 'tag', p.slot ? p.slot.replace(':', ' ') : 'spectating'));
        if (host && p.id !== this.net.id) { const k = el('button', 'ghost small kick', 'Kick'); k.onclick = () => this.net.send('kickPlayer', { playerId: p.id }); li.appendChild(k); }
        pl.appendChild(li);
      }

      $('btnReady').textContent = me && me.ready ? 'Not ready' : 'Ready';
      $('btnReady').disabled = !me || !me.slot;
      $('btnStart').classList.toggle('hidden', !host);
      $('btnStart').textContent = room.status === 'ended' ? 'Rematch' : 'Start match';
      const humansSeated = room.players.filter(p => p.slot).length;
      const notReady = room.players.filter(p => p.slot && !p.ready).length;
      $('startHint').textContent = host
        ? `${humansSeated} human${humansSeated === 1 ? '' : 's'} seated, ${6 - humansSeated} bot${6 - humansSeated === 1 ? '' : 's'}${notReady ? ` · ${notReady} not ready yet` : ''}. You can start whenever you like.`
        : 'Waiting for the host to start the match.';
      $('btnStart').onclick = () => this.net.send(room.status === 'ended' ? 'rematch' : 'startGame');

      $('rulesHint').textContent = host ? 'You can edit these' : 'Only the host can edit';
      renderRulesEditor($('roomRules'), room.rules, host && room.status !== 'playing', (patch) => this.net.send('updateRules', { rules: patch }));
      renderBoostToggles($('roomBoosts'), room.rules, host && room.status !== 'playing', (patch) => this.net.send('updateRules', { rules: patch }));
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
