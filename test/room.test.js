// Owner: Rosa Vidal (T-17) — lobby / room flow with fake sockets
const test = require('node:test');
const assert = require('node:assert/strict');
const { Lobby } = require('../server/lobby');

class FakeClient {
  constructor(id, name) { this.id = id; this.name = name; this.room = null; this.inbox = []; }
  send(obj) { this.inbox.push(obj); }
  sendRaw(data) { this.inbox.push(JSON.parse(data)); }
  last(type) { for (let i = this.inbox.length - 1; i >= 0; i--) if (this.inbox[i].type === type) return this.inbox[i]; return null; }
  clear() { this.inbox = []; }
}

function setup() {
  const lobby = new Lobby();
  const host = new FakeClient('h1', 'Host'); const guest = new FakeClient('g1', 'Guest'); const third = new FakeClient('t1', 'Third');
  for (const c of [host, guest, third]) lobby.addClient(c);
  return { lobby, host, guest, third };
}
const tick = () => new Promise(r => setImmediate(r));

test('create → listed in lobby → join with password → invite bypasses password', async () => {
  const { lobby, host, guest, third } = setup();
  const room = lobby.createRoom(host, { name: 'Test', password: 'pw', rules: { matchSeconds: 120 } });
  assert.ok(room); assert.equal(host.room, room);
  await tick();
  const list = guest.last('lobby').games;
  assert.equal(list.length, 1); assert.equal(list[0].locked, true); assert.equal(list[0].matchSeconds, 120);

  lobby.joinRoom(guest, { roomId: room.id, password: 'nope' });
  assert.equal(guest.last('error').code, 'bad_password');
  lobby.joinRoom(guest, { roomId: room.id, password: 'pw' });
  assert.equal(guest.room, room);

  lobby.joinRoom(third, { invite: room.inviteCode.toLowerCase() });
  assert.equal(third.room, room);
  assert.equal(room.players.size, 3);
  room.destroy();
});

test('slot picking, conflicts, ready, host-only actions', () => {
  const { lobby, host, guest } = setup();
  const room = lobby.createRoom(host, { name: 'Slots' });
  lobby.joinRoom(guest, { roomId: room.id });
  room.pickSlot(host, 'red:FWD');
  room.pickSlot(guest, 'red:FWD');
  assert.equal(guest.last('error').code, 'slot_taken');
  room.pickSlot(guest, 'blue:GK');
  assert.equal(room.slots['red:FWD'], host.id); assert.equal(room.slots['blue:GK'], guest.id);
  room.pickSlot(host, 'red:GK');            // switching frees the old slot
  assert.equal(room.slots['red:FWD'], null); assert.equal(room.slots['red:GK'], host.id);
  room.setReady(guest, true);
  assert.equal(room.players.get(guest.id).ready, true);

  room.updateRules(guest, { goalLimit: 5 });
  assert.equal(guest.last('error').code, 'not_host');
  room.updateRules(host, { goalLimit: 5, matchSeconds: 10 });
  assert.equal(room.rules.goalLimit, 5); assert.equal(room.rules.matchSeconds, 60); // clamped
  room.startGame(guest);
  assert.equal(guest.last('error').code, 'not_host');
  assert.equal(room.status, 'prematch');
  room.destroy();
});

test('start builds the match with humans in their slots and bots elsewhere; leaving reverts to bot', () => {
  const { lobby, host, guest } = setup();
  const room = lobby.createRoom(host, { name: 'Go' });
  lobby.joinRoom(guest, { roomId: room.id });
  room.pickSlot(host, 'red:FWD'); room.pickSlot(guest, 'blue:DEF');
  room.startGame(host);
  assert.equal(room.status, 'playing');
  assert.ok(host.last('matchStart'));
  const m = room.match;
  assert.equal(m.player('red:FWD').isBot, false); assert.equal(m.player('red:FWD').name, 'Host');
  assert.equal(m.player('blue:DEF').isBot, false);
  assert.equal(m.players.filter(p => p.isBot).length, 4);

  // Mid-match: guest leaves → bot takes over; spectator joins and claims a slot
  room.disconnectPlayer(guest, true);
  assert.equal(m.player('blue:DEF').isBot, true);
  const late = new FakeClient('l1', 'Late'); lobby.addClient(late);
  lobby.joinRoom(late, { roomId: room.id });
  assert.ok(late.last('matchStart'), 'late joiner gets matchStart');
  room.pickSlot(late, 'blue:GK');
  assert.equal(m.player('blue:GK').isBot, false); assert.equal(m.player('blue:GK').name, 'Late');

  // Input routed to the right player
  room.handleInput(host, { up: true });
  assert.equal(m.player('red:FWD').input.up, true);
  room.handleInput(late, { kick: true });
  assert.equal(m.player('blue:GK').input.kick, true);
  room.destroy();
});

test('ticking the room broadcasts snapshots and finishes the match; rematch resets to prematch', () => {
  const { lobby, host } = setup();
  const room = lobby.createRoom(host, { name: 'Tick', rules: { matchSeconds: 60, suddenDeath: false } });
  room.pickSlot(host, 'red:GK');
  room.startGame(host);
  room.stopLoop();                       // drive manually
  host.clear();
  for (let i = 0; i < 10; i++) room.tickOnce();
  assert.ok(host.inbox.filter(m => m.type === 'snapshot').length >= 4);
  room.match.time = 0.01; room.match.state = 'play';
  room.tickOnce();
  assert.equal(room.status, 'ended');
  const end = host.last('matchEnd');
  assert.ok(end); assert.equal(end.stats.length, 6);
  room.rematch(host);
  assert.equal(room.status, 'prematch'); assert.equal(room.match, null);
  assert.equal(room.slots['red:GK'], host.id, 'slots survive a rematch');
  room.destroy();
});

test('host migration and room teardown when empty', async () => {
  const { lobby, host, guest } = setup();
  const room = lobby.createRoom(host, { name: 'Bye' });
  lobby.joinRoom(guest, { roomId: room.id });
  room.disconnectPlayer(host, true);
  assert.equal(room.hostId, guest.id);
  room.disconnectPlayer(guest, true);
  assert.equal(lobby.rooms.size, 0);
  await tick();
  assert.equal(guest.last('lobby').games.length, 0);
});

test('kicked players are removed and told', () => {
  const { lobby, host, guest } = setup();
  const room = lobby.createRoom(host, { name: 'Kick' });
  lobby.joinRoom(guest, { roomId: room.id });
  room.kickPlayer(guest, host.id);
  assert.equal(guest.last('error').code, 'not_host');
  room.kickPlayer(host, guest.id);
  assert.equal(room.players.has(guest.id), false);
  assert.equal(guest.last('error').code, 'kicked');
  assert.equal(guest.last('room').room, null);
  room.destroy();
});

test('XP is awarded to seated humans with a player card; tournament mode plays the bracket', async () => {
  const { lobby, host, guest } = setup();
  host.token = 'tok-host'; lobby.profiles.get('tok-host', 'Host');
  const room = lobby.createRoom(host, { name: 'Cup', mode: 'tournament', sides: { red: 'esp', blue: 'ned' }, rules: { matchSeconds: 60 } });
  room.setMode(guest, 'match');
  assert.equal(room.mode, 'tournament', 'only the host changes the mode');
  room.pickSlot(host, 'red:FWD');
  room.startGame(host); room.stopLoop();
  assert.ok(room.tournament);
  assert.deepEqual(room.match.sides, { red: 'esp', blue: 'ned' });
  assert.equal(room.match.rules.suddenDeath, true, 'knockouts always have sudden death');
  room.setTeam(host, 'blue', 'bra');
  assert.equal(host.last('error').code, 'in_progress');
  room.match.score.red = 2; room.match.time = 0.01; room.match.state = 'play';
  room.tickOnce();
  const end = host.last('matchEnd');
  assert.ok(end.tournament && end.tournament.won);
  const xp = host.last('matchXp');
  assert.ok(xp.items.some(([label]) => label === 'Reached the semi-final'));
  assert.equal(lobby.profiles.get('tok-host').wins, 1);
  await new Promise(r => { const iv = setInterval(() => { if (!room.tournament.simulating) { clearInterval(iv); r(); } }, 20); });
  assert.equal(room.tournament.round, 1);
  assert.equal(room.sides.red, 'esp');
  room.rematch(host);
  room.setTeam(host, 'blue', 'bra');
  assert.equal(host.last('error').code, 'tournament', 'the bracket picks the opponent');
  room.destroy();
});
