// Owner: Rosa Vidal (T-17) — shared physics guarantees
const test = require('node:test');
const assert = require('node:assert/strict');
const MCS = require('../shared/rules');
const Physics = require('../shared/physics');
const Match = require('../server/game/match');

const DT = 1 / 60;
const W = MCS.FIELD.width, H = MCS.FIELD.height;

test('a ball fired at a goalpost at top speed bounces instead of tunnelling', () => {
  for (let trial = 0; trial < 20; trial++) {
    const m = new Match({}, {}); m.state = 'play';
    const gh = m.goalHalfWidth();
    // Aim at the top-left post. Within ~0.6 of the combined radius the ball
    // must come straight back; wider offsets are legitimate glancing deflections.
    const off = (trial / 20 - 0.5) * 2 * (Physics.FEEL.postRadius + MCS.BALL_RADIUS) * 0.6;
    m.ball.x = 300; m.ball.y = H / 2 - gh + off; m.ball.vx = -Physics.FEEL.ballMaxSpeed; m.ball.vy = 0;
    let hitPost = false;
    for (let i = 0; i < 60 && m.state === 'play' && !hitPost; i++) {
      m.step(DT);
      hitPost = m.events.some(e => e.type === 'bounce' && e.post);
    }
    assert.ok(hitPost, `trial ${trial}: never touched the post`);
    assert.ok(m.ball.vx > 0, `trial ${trial}: ball kept going after the post (vx=${m.ball.vx})`);
    assert.equal(m.score.blue, 0, `trial ${trial}: scored through a post`);
  }
});

test('a fast ball cannot pass through a player', () => {
  const m = new Match({}, {}); m.state = 'play';
  const gk = m.player('red:GK');
  gk.x = 100; gk.y = H / 2; gk.vx = 0; gk.vy = 0;
  m.ball.x = 400; m.ball.y = H / 2 + 3; m.ball.vx = -Physics.FEEL.ballMaxSpeed; m.ball.vy = 0;
  for (let i = 0; i < 40; i++) m.step(DT);
  assert.ok(m.ball.x > gk.x, 'ball stayed on the field side of the keeper');
});

test('human kick press just before contact still kicks; bots get no buffer', () => {
  const m = new Match({}, { 'red:FWD': { name: 'H', isBot: false } }); m.state = 'play';
  const h = m.player('red:FWD'), bot = m.player('blue:FWD');
  h.x = 400; h.y = 300; h.vx = 0; h.vy = 0;
  m.ball.x = 400 + h.r + m.ball.r + 25; m.ball.y = 300; m.ball.vx = -200; m.ball.vy = 0; // rolling in, arrives in ~5 ticks
  m.setInput('red:FWD', { kick: true }); m.setInput('red:FWD', { kick: false }); // tap
  for (let i = 0; i < 8; i++) m.step(DT);
  assert.ok(m.ball.vx > 300, `human buffered tap kicked (vx=${m.ball.vx})`);

  bot.x = 800; bot.y = 300; bot.vx = 0; bot.vy = 0;
  m.ball.x = 800 - bot.r - m.ball.r - 25; m.ball.y = 300; m.ball.vx = 200; m.ball.vy = 0;
  m.setInput('blue:FWD', { kick: true }); m.setInput('blue:FWD', { kick: false });
  for (let i = 0; i < 8; i++) m.step(DT);
  assert.ok(m.ball.vx < 300, `bot tap was not buffered (vx=${m.ball.vx})`);
});

test('shared integratePlayer is deterministic and matches the server', () => {
  const rules = MCS.defaultRules();
  const mk = () => ({ x: 300, y: 300, vx: 0, vy: 0, r: MCS.PLAYER_RADIUS, dashCooldown: 0, dashTime: 0 });
  const a = mk(), b = mk();
  const st = { speed: false, shrink: false, frozen: false };
  for (let i = 0; i < 60; i++) {
    Physics.integratePlayer(a, { right: true, up: i > 30, dash: i === 10 }, rules, DT, st, { x: 600, y: 350 });
    Physics.integratePlayer(b, { right: true, up: i > 30, dash: i === 10 }, rules, DT, st, { x: 600, y: 350 });
  }
  assert.deepEqual(a, b);
  // and the server Match uses the same code path for its players
  const m = new Match({}, { 'red:FWD': { name: 'H', isBot: false } }); m.state = 'play';
  const p = m.player('red:FWD'); p.x = 300; p.y = 300;
  const twin = mk();
  for (let i = 0; i < 30; i++) {
    m.setInput('red:FWD', { right: true });
    m.step(DT);
    Physics.integratePlayer(twin, { right: true }, m.rules, DT, st, m.ball, m.traits.red);
    Physics.confinePlayer(twin, 'red', m.state, m.kickoffTeam, m.goalHalfWidth());
  }
  assert.ok(Math.abs(p.x - twin.x) < 1e-6 && Math.abs(p.y - twin.y) < 1e-6, 'client twin tracks the server exactly');
});

test('dashing into the ball adds extra pace', () => {
  const m = new Match({}, {}); m.state = 'play';
  const p = m.player('red:FWD'); p.x = 300; p.y = 300; p.vx = 0; p.vy = 0;
  m.ball.x = 300 + p.r + m.ball.r + 20; m.ball.y = 300; m.ball.vx = 0; m.ball.vy = 0;
  m.setInput('red:FWD', { right: true, dash: true });
  for (let i = 0; i < 6; i++) m.step(DT);
  assert.ok(m.ball.vx > 400, `ball speed after dash contact ${m.ball.vx}`);
});

test('botSkill is a clamped rule', () => {
  assert.equal(MCS.sanitizeRules({ botSkill: 9 }).botSkill, 1.5);
  assert.equal(MCS.sanitizeRules({ botSkill: 0.1 }).botSkill, 0.5);
});
