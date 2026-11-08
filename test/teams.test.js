// Owner: Rosa Vidal (T-25) — national teams: kits, traits, play styles
const test = require('node:test');
const assert = require('node:assert/strict');
const Teams = require('../shared/teams');
const Match = require('../server/game/match');
const { BotBrain } = require('../server/game/ai');
const { Lobby } = require('../server/lobby');

const DT = 1 / 60;

test('every nation has a complete kit, alt kit, traits and ai profile within bounds', () => {
  assert.ok(Teams.IDS.length >= 12);
  for (const id of Teams.IDS) {
    const n = Teams.NATIONS[id];
    for (const kit of [n.kit, n.alt]) for (const k of ['j', 'k', 'p', 'w', 'pattern', 'gk']) assert.ok(kit[k], `${id} kit missing ${k}`);
    for (const k of ['speed', 'kick', 'dash']) assert.ok(n.traits[k] >= 0.7 && n.traits[k] <= 1.1, `${id} trait ${k} out of bounds`);
    for (const k of ['press', 'passing', 'defLine', 'gkRush', 'dash']) assert.ok(n.ai[k] >= 0 && n.ai[k] <= 1, `${id} ai ${k}`);
    assert.ok(n.ai.shootRange > 300 && n.ai.shootRange < 800);
  }
});

test('kit clash puts the blue side into its alternate kit', () => {
  const clash = Teams.resolveKits('eng', 'ger');       // both white
  assert.equal(clash.blue.j, Teams.NATIONS.ger.alt.j);
  const fine = Teams.resolveKits('bra', 'arg');
  assert.equal(fine.blue.j, Teams.NATIONS.arg.kit.j);
});

test('sanitizeSides falls back to defaults and randomPair never repeats a nation', () => {
  assert.deepEqual(Teams.sanitizeSides({ red: 'xxx', blue: 'jpn' }), { red: Teams.DEFAULT_SIDES.red, blue: 'jpn' });
  for (let i = 0; i < 50; i++) { const p = Teams.randomPair(); assert.notEqual(p.red, p.blue); }
});

test('traits change on-pitch behaviour: Brazil runs faster, England kicks harder, USA dashes sooner', () => {
  const run = (nation) => {
    const m = new Match({}, {}, { red: nation, blue: 'bel' }); m.state = 'play';
    const p = m.player('red:FWD'); p.x = 200; p.y = 300;
    for (let i = 0; i < 90; i++) { m.setInput('red:FWD', { right: true }); m.step(DT); }
    return Math.hypot(p.vx, p.vy);
  };
  assert.ok(run('bra') > run('ger') * 1.05);

  const kick = (nation) => {
    const m = new Match({}, {}, { red: nation, blue: 'bel' }); m.state = 'play';
    const p = m.player('red:FWD'); p.x = 400; p.y = 300;
    m.ball.x = p.x + p.r + m.ball.r + 2; m.ball.y = 300;
    m.setInput('red:FWD', { kick: true }); m.step(DT);
    return Math.hypot(m.ball.vx, m.ball.vy);
  };
  assert.ok(kick('eng') > kick('bra') * 1.08);

  const m = new Match({}, {}, { red: 'usa', blue: 'bel' }); m.state = 'play';
  const p = m.player('red:FWD'); p.x = 300; p.y = 300;
  m.setInput('red:FWD', { right: true, dash: true }); m.step(DT);
  assert.ok(p.dashCooldown < Match.FEEL.dashCooldown * 0.8, 'USA dash recharges faster');
});

test('play styles steer the bots: Italy defends deep, Netherlands pushes the defender up', () => {
  const defenderX = (nation) => {
    const m = new Match({}, {}, { red: nation, blue: 'bel' }); m.state = 'play';
    // Ball in the opponent half, held by our forward: the defender picks a cover spot.
    m.ball.x = 900; m.ball.y = 350; m.player('red:FWD').x = 880; m.player('red:FWD').y = 350;
    const brain = new BotBrain('red:DEF');
    brain.think(m, m.player('red:DEF'));
    return brain.target.x;
  };
  assert.ok(defenderX('ned') > defenderX('ita') + 100, `ned ${defenderX('ned')} vs ita ${defenderX('ita')}`);
});

test('host picks teams; picking the same nation for both sides swaps them', () => {
  const lobby = new Lobby();
  const mk = (id) => ({ id, name: id, room: null, inbox: [], send(o) { this.inbox.push(o); }, sendRaw(d) { this.inbox.push(JSON.parse(d)); } });
  const host = mk('h'), guest = mk('g');
  lobby.addClient(host); lobby.addClient(guest);
  const room = lobby.createRoom(host, { name: 'T', sides: { red: 'bra', blue: 'ger' } });
  lobby.joinRoom(guest, { roomId: room.id });
  room.setTeam(guest, 'red', 'esp');
  assert.equal(room.sides.red, 'bra');
  room.setTeam(host, 'red', 'ger');
  assert.deepEqual(room.sides, { red: 'ger', blue: 'bra' });
  room.setTeam(host, 'blue', 'tur');
  assert.deepEqual(room.sides, { red: 'ger', blue: 'tur' });
  room.startGame(host);
  assert.deepEqual(room.match.sides, { red: 'ger', blue: 'tur' });
  assert.deepEqual(host.inbox.filter(m => m.type === 'matchStart').pop().sides, { red: 'ger', blue: 'tur' });
  room.destroy();
});
