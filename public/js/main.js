/**
 * public/js/main.js — wires network events to screens.
 * Owner: Alex Mercer (T-01 integration) with Sam Okafor
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  const net = new Net();
  const audio = new GameAudio();
  const ui = new UI(net);
  const game = new Game({ canvas: $('pitch'), net, audio, ui });
  window.app = { net, ui, game, audio };

  // Name field
  const nameInput = $('nameInput');
  nameInput.value = net.name || '';
  nameInput.addEventListener('change', () => { const n = nameInput.value.trim(); if (n) net.setName(n); });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); });
  if (!net.name) {
    const adjectives = ['Swift', 'Brave', 'Wild', 'Lucky', 'Fancy', 'Quick', 'Jolly', 'Mighty'];
    const nouns = ['Fox', 'Otter', 'Hawk', 'Wolf', 'Bear', 'Lynx', 'Crow', 'Moose'];
    net.name = adjectives[Math.floor(Math.random() * adjectives.length)] + nouns[Math.floor(Math.random() * nouns.length)] + Math.floor(Math.random() * 90 + 10);
    nameInput.value = net.name;
  }

  // Invite / join links
  const params = new URLSearchParams(location.search);
  const inviteParam = params.get('invite');
  const joinParam = params.get('join');
  let autoJoinDone = false;

  net.on('_open', () => { $('connDot').className = 'dot on'; });
  net.on('_close', () => { $('connDot').className = 'dot off'; });

  net.on('welcome', (msg) => {
    nameInput.value = msg.name;
    if (!autoJoinDone) {
      autoJoinDone = true;
      if (inviteParam) net.send('joinGame', { invite: inviteParam });
      else if (joinParam) net.send('joinGame', { roomId: joinParam });
      if (inviteParam || joinParam) history.replaceState(null, '', location.pathname);
    }
  });

  net.on('lobby', (msg) => ui.renderLobby(msg.games));

  let currentRoomId = null;
  net.on('room', (msg) => {
    const room = msg.room;
    if (!room) {
      currentRoomId = null; ui.room = null;
      game.stop(); game.setRoom(null);
      ui.showScreen('lobby');
      return;
    }
    const isNew = room.id !== currentRoomId;
    currentRoomId = room.id;
    ui.renderRoom(room);
    game.setRoom(room);
    if (room.status === 'playing') {
      ui.showScreen('game');
    } else if (room.status === 'ended') {
      ui.showScreen('game');   // results overlay stays on the pitch
    } else {
      game.stop();
      ui.showScreen('prematch');
      if (isNew) { $('chatLogPre').innerHTML = ''; $('chatLogGame').innerHTML = ''; }
    }
  });

  net.on('matchStart', (msg) => {
    ui.showScreen('game');
    game.start(msg.rules);
    if (ui.room) game.setRoom(ui.room);
  });

  net.on('snapshot', (snap) => { if (game.active) game.onSnapshot(snap); });

  net.on('matchEnd', (res) => {
    ui.showScreen('game');
    if (!game.active) { game.start(ui.room ? ui.room.rules : undefined); }
    game.showResults(res);
    if (ui.room) game.setRoom(Object.assign({}, ui.room, { status: 'ended' }));
  });

  net.on('chat', (msg) => ui.addChat(msg));
  net.on('error', (msg) => ui.error(msg.message || msg.code));

  $('btnRematch').onclick = () => net.send('rematch');
  $('btnResultsLeave').onclick = () => net.send('leaveGame');

  net.connect();
})();
