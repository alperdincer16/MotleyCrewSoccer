// Owner: Rosa Vidal (T-42) — team shape, jockeying and possession protection
const test = require('node:test');
const assert = require('node:assert/strict');
const MCS = require('../shared/rules');
const Match = require('../server/game/match');
const { BotBrain } = require('../server/game/ai');

const DT = 1 / 60;
const W = MCS.FIELD.width, H = MCS.FIELD.height;
const runBots = (m, brains) => m.players.forEach((p, i) => { if (brains[i]) m.setInput(p.id, brains[i].update(m, DT)); });

test('only one outfield bot per team goes to the ball; the rest keep their distance', () => {
  const m = new Match({}, {}); m.state = 'play';
  const brains = m.players.map(p => new BotBrain(p.id, p.pos === 'GK' ? 0.85 : 1));
  m.ball.x = W / 2; m.ball.y = H / 2; m.ball.vx = 0; m.ball.vy = 0;
  let crowd = 0, n = 0;
  for (let i = 0; i < 60 * 20; i++) {
    runBots(m, brains); m.step(DT); m.events.length = 0;
    if (m.state !== 'play') continue;
    for (const t of MCS.TEAMS) { crowd += m.players.filter(p => p.team === t && p.pos !== 'GK' && Math.hypot(p.x - m.ball.x, p.y - m.ball.y) < 110).length; n++; }
  }
  assert.ok(crowd / n < 1.1, `average bots per team near the ball: ${(crowd / n).toFixed(2)}`);
});

test('bot team-mates never take the ball off a human who is dribbling', () => {
  const m = new Match({}, { 'red:MID': { name: 'H', isBot: false } }); m.state = 'play';
  const brains = m.players.map(p => p.isBot && p.team === 'red' ? new BotBrain(p.id, 1) : null);
  const me = m.player('red:MID'); me.x = 400; me.y = 350;
  m.ball.x = me.x + 33; m.ball.y = 350;
  for (const p of m.players) if (p.team === 'blue') { p.x = W - 30; p.y = 60 + m.players.indexOf(p) * 20; }
  for (let i = 0; i < 90; i++) { runBots(m, brains); m.setInput('red:MID', { right: true }); m.step(DT); m.events.length = 0; }
  assert.equal(m.possession && m.possession.slot, 'red:MID', 'still my ball');
});

test('a dribbler cannot be robbed by a body bump, only by a tackle after the protection window', () => {
  const m = new Match({}, { 'red:MID': { name: 'H', isBot: false }, 'blue:DEF': { name: 'O', isBot: false } }); m.state = 'play';
  const me = m.player('red:MID'), opp = m.player('blue:DEF');
  for (const p of m.players) if (p !== me && p !== opp) { p.x = 40; p.y = 40 + m.players.indexOf(p) * 60; }
  me.x = 400; me.y = 350; m.ball.x = me.x + 32; m.ball.y = 350;
  opp.x = 520; opp.y = 350;
  for (let i = 0; i < 20; i++) { m.setInput('red:MID', { right: true }); m.setInput('blue:DEF', { left: true, kick: i > 10 }); m.step(DT); }
  assert.equal(m.possession.slot, 'red:MID', 'bump and early kick do not win it');
  // After the window a real tackle (kick) does.
  m.possession.protectUntil = m.tick;
  opp.x = m.ball.x + opp.r + m.ball.r + 2; opp.y = m.ball.y; opp.kickCooldown = 0;
  m.setInput('blue:DEF', { kick: false }); m.setInput('blue:DEF', { kick: true });
  m.setInput('red:MID', {}); m.step(DT);
  assert.ok(m.ball.vx < 0, `tackle knocked it away (vx=${m.ball.vx.toFixed(0)})`);
});

test('a keeper blocking a ball that rolls along the goal line does not knock it in', () => {
  for (const vy of [-180, 180]) {
    const m = new Match({}, {}); m.state = 'play';
    const gk = m.player('red:GK');
    for (const p of m.players) if (p !== gk) { p.x = W - 40; p.y = 40 + m.players.indexOf(p) * 60; }
    const gh = m.goalHalfWidth();
    gk.x = gk.r + 2; gk.y = H / 2 - Math.sign(vy) * (gh - 20); gk.vx = 0; gk.vy = 0;
    m.ball.x = 14; m.ball.y = H / 2 - Math.sign(vy) * (gh + 60); m.ball.vx = 0; m.ball.vy = vy;
    for (let i = 0; i < 90; i++) { m.step(DT); m.events.length = 0; }
    assert.equal(m.score.blue, 0, `no own goal (vy=${vy})`);
  }
});

test('a tackle on a dribbler emits a steal event and the victim stumbles', () => {
  const m = new Match({}, { 'red:MID': { name: 'H', isBot: false }, 'blue:DEF': { name: 'O', isBot: false } }); m.state = 'play';
  const me = m.player('red:MID'), opp = m.player('blue:DEF');
  for (const p of m.players) if (p !== me && p !== opp) { p.x = 40; p.y = 40 + m.players.indexOf(p) * 60; }
  me.x = 400; me.y = 350; m.ball.x = me.x + 32; m.ball.y = 350; opp.x = 700; opp.y = 100;
  for (let i = 0; i < 5; i++) { m.setInput('red:MID', { right: true }); m.step(DT); }
  m.possession.protectUntil = m.tick;
  opp.x = m.ball.x + opp.r + m.ball.r + 2; opp.y = m.ball.y; opp.kickCooldown = 0;
  m.events.length = 0;
  m.setInput('blue:DEF', { kick: true }); m.step(DT);
  const steal = m.events.find(e => e.type === 'steal');
  assert.ok(steal, 'steal event');
  assert.equal(steal.slot, 'blue:DEF'); assert.equal(steal.victim, 'red:MID');
  assert.ok(me.effects.stumble > 0, 'victim stumbles');
  m.events.length = 0;
  m.setInput('red:MID', { kick: true }); m.step(DT);
  assert.ok(!m.events.some(e => e.type === 'kick' && e.slot === 'red:MID'), 'a stumbling player cannot kick straight back');
});
