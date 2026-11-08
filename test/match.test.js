// Owner: Rosa Vidal (T-17, T-18)
const test = require('node:test');
const assert = require('node:assert/strict');
const MCS = require('../shared/rules');
const Match = require('../server/game/match');
const { BotBrain } = require('../server/game/ai');

const DT = 1 / 60;
const W = MCS.FIELD.width, H = MCS.FIELD.height;

/** Skip the countdown so play can start. */
function inPlay(rules = {}) {
  const m = new Match(rules, {});
  m.state = 'play';
  return m;
}
function stepN(m, n, before) { for (let i = 0; i < n; i++) { if (before) before(i); m.step(DT); } }
function drain(m) { return m.snapshot().events; }

test('countdown then kickoff whistle', () => {
  const m = new Match({}, {});
  assert.equal(m.state, 'countdown');
  stepN(m, 60 * 3 + 2);
  assert.equal(m.state, 'kickoff');
  assert.ok(drain(m).some(e => e.type === 'whistle'));
});

test('ball crossing the red goal line scores for blue and triggers kickoff for red', () => {
  const m = inPlay({ kickoffPause: 0.5 });
  m.ball.x = 30; m.ball.y = H / 2; m.ball.vx = -900; m.ball.vy = 0;
  stepN(m, 6);
  assert.equal(m.score.blue, 1);
  assert.equal(m.state, 'goal');
  const ev = drain(m).find(e => e.type === 'goal');
  assert.equal(ev.team, 'blue');
  assert.equal(m.kickoffTeam, 'red');
  stepN(m, 40);
  assert.equal(m.state, 'kickoff');
  assert.equal(m.ball.x, W / 2);
});

test('ball outside the goal mouth bounces off the end wall instead of scoring', () => {
  const m = inPlay();
  m.ball.x = 30; m.ball.y = 60; m.ball.vx = -900;
  stepN(m, 10);
  assert.equal(m.score.blue, 0);
  assert.ok(m.ball.vx > 0, 'ball should have bounced back');
});

test('goal credited to scorer, assist to previous team-mate, own goal flagged', () => {
  const m = inPlay({ kickoffPause: 0.5 });
  const fwd = m.player('red:FWD'), def = m.player('red:DEF');
  m.registerTouch(def, true);
  m.registerTouch(fwd, true);
  m.ball.x = W - 20; m.ball.y = H / 2; m.ball.vx = 900;
  stepN(m, 4);
  assert.equal(fwd.stats.goals, 1);
  assert.equal(def.stats.assists, 1);

  const m2 = inPlay({ kickoffPause: 0.5 });
  const gk = m2.player('red:GK');
  m2.registerTouch(gk, true);
  m2.ball.x = 20; m2.ball.y = H / 2; m2.ball.vx = -900;
  stepN(m2, 4);
  assert.equal(gk.stats.ownGoals, 1);
  assert.equal(drain(m2).find(e => e.type === 'goal').ownGoal, true);
});

test('deflection off a defender within 2 s of a shot credits the shooter', () => {
  const m = inPlay({ kickoffPause: 0.5 });
  const shooter = m.player('blue:FWD'), gk = m.player('red:GK');
  m.registerTouch(shooter, true);
  m.registerTouch(gk, false);
  m.ball.x = 20; m.ball.y = H / 2; m.ball.vx = -900;
  stepN(m, 4);
  assert.equal(shooter.stats.goals, 1);
  assert.equal(gk.stats.ownGoals, 0);
});

test('kick sends the ball away at kickPower-scaled speed', () => {
  const m = inPlay({ kickPower: 1.5 });
  const p = m.player('red:FWD');
  p.x = 400; p.y = 300; p.vx = 0; p.vy = 0;
  m.ball.x = p.x + p.r + m.ball.r + 2; m.ball.y = 300; m.ball.vx = 0; m.ball.vy = 0;
  m.setInput('red:FWD', { kick: true });
  m.step(DT);
  const speed = Math.hypot(m.ball.vx, m.ball.vy);
  assert.ok(speed > Match.FEEL.kickSpeed * 1.4 && speed < Match.FEEL.kickSpeed * 1.6, `speed ${speed}`);
  assert.ok(m.ball.vx > 0);
  assert.equal(p.stats.kicks, 1);
  assert.ok(drain(m).some(e => e.type === 'kick'));
});

test('players move with input and are confined to the arena', () => {
  const m = inPlay();
  const p = m.player('red:FWD');
  p.x = 100; p.y = 100;
  m.setInput('red:FWD', { left: true, up: true });
  stepN(m, 120);
  assert.ok(p.x >= p.r - 0.01 && p.y >= p.r - 0.01, 'inside arena');
  assert.ok(p.x < 100 && p.y < 100, 'moved toward the corner');
  for (const q of m.players) assert.ok(Number.isFinite(q.x) && Number.isFinite(q.y));
});

test('kickoff keeps teams in their half and defenders out of the circle', () => {
  const m = new Match({}, {});
  m.state = 'kickoff'; m.kickoffTeam = 'red';
  const blueFwd = m.player('blue:FWD');
  blueFwd.x = W / 2 + 150; blueFwd.y = H / 2;
  m.setInput('blue:FWD', { left: true });
  stepN(m, 90);
  const d = Math.hypot(blueFwd.x - W / 2, blueFwd.y - H / 2);
  assert.ok(d >= Match.FEEL.centerCircle + blueFwd.r - 0.5, `blue kept out of circle (${d})`);
  assert.ok(blueFwd.x >= W / 2, 'blue stays in own half');
  assert.equal(m.state, 'kickoff');
});

test('a stalled kickoff opens play after the timeout', () => {
  const m = new Match({}, {});
  m.state = 'kickoff';
  stepN(m, Math.ceil(Match.FEEL.kickoffTimeout * 60) + 2);
  assert.equal(m.state, 'play');
});

test('clock expiry ends the match unless tied with sudden death', () => {
  const m = inPlay({ matchSeconds: 60, suddenDeath: false });
  m.time = 0.05; stepN(m, 5);
  assert.equal(m.state, 'ended'); assert.equal(m.winner, 'draw');

  const m2 = inPlay({ matchSeconds: 60, suddenDeath: true });
  m2.time = 0.05; stepN(m2, 5);
  assert.equal(m2.state, 'play'); assert.equal(m2.suddenDeath, true);
  // next goal wins
  m2.ball.x = W - 20; m2.ball.y = H / 2; m2.ball.vx = 900;
  stepN(m2, 4);
  assert.equal(m2.state, 'ended'); assert.equal(m2.winner, 'red');
});

test('sudden death cannot last forever', () => {
  const m = inPlay({ matchSeconds: 60, suddenDeath: true });
  m.time = 0.01; m.step(DT);
  assert.equal(m.suddenDeath, true);
  m.time = Match.FEEL.suddenDeathCap - 0.01; m.step(DT);
  assert.equal(m.state, 'ended'); assert.equal(m.winner, 'draw');
});

test('goal limit and mercy rule end the match', () => {
  const m = inPlay({ goalLimit: 1, kickoffPause: 0.5 });
  m.ball.x = W - 20; m.ball.y = H / 2; m.ball.vx = 900; stepN(m, 4);
  assert.equal(m.state, 'ended'); assert.equal(m.winner, 'red');

  const m2 = inPlay({ mercyLead: 2, kickoffPause: 0.5 });
  m2.score.blue = 1;
  m2.ball.x = 20; m2.ball.y = H / 2; m2.ball.vx = -900; stepN(m2, 4);
  assert.equal(m2.state, 'ended'); assert.equal(m2.winner, 'blue');
});

test('boost effects: speed, freeze, shrink, giant ball, shield, rocket', () => {
  const m = inPlay();
  const red = m.player('red:FWD'), blue = m.player('blue:FWD');
  m.applyBoost(red, 'speed');
  assert.ok(m.speedMul(red) > 1.5);
  m.applyBoost(red, 'freeze');
  assert.ok(blue.effects.frozen > 0);
  blue.x = 600; blue.y = 200; m.setInput('blue:FWD', { right: true });
  stepN(m, 30);
  assert.ok(Math.abs(blue.x - 600) < 1, 'frozen player did not move');
  m.applyBoost(red, 'shrink');
  m.step(DT);
  assert.ok(blue.r < MCS.PLAYER_RADIUS, 'opponent shrunk');
  m.applyBoost(red, 'giant');
  m.step(DT);
  assert.ok(m.ball.r > MCS.BALL_RADIUS * 2);
  m.applyBoost(red, 'shield');
  assert.ok(m.player('red:GK').effects.shield > 0, 'whole team shielded');
  m.applyBoost(red, 'rocket');
  red.x = 400; red.y = 300; red.vx = 0; red.vy = 0; red.effects.frozen = 0; delete red.effects.frozen;
  m.ball.effects = {}; m.ball.r = MCS.BALL_RADIUS;
  m.ball.x = red.x + red.r + m.ball.r + 2; m.ball.y = 300; m.ball.vx = 0; m.ball.vy = 0;
  m.setInput('red:FWD', { kick: true }); m.step(DT);
  assert.ok(Math.hypot(m.ball.vx, m.ball.vy) > Match.FEEL.kickSpeed * 2, 'rocket kick');
  assert.ok(!red.effects.rocket, 'rocket consumed');
  assert.ok(drain(m).filter(e => e.type === 'pickup').length === 6);
});

test('effects expire', () => {
  const m = inPlay();
  const red = m.player('red:FWD');
  m.applyBoost(red, 'speed');
  stepN(m, 60 * (MCS.BOOSTS.speed.duration + 0.5));
  assert.ok(!red.effects.speed);
});

test('pickups spawn only when enabled, respect maxPickups and the enabled set', () => {
  const m = inPlay({ pickupInterval: 3, maxPickups: 1, enabledBoosts: ['magnet'] });
  stepN(m, 60 * 10);
  assert.equal(m.pickups.length, 1);
  assert.equal(m.pickups[0].type, 'magnet');

  const off = inPlay({ boostsEnabled: false });
  stepN(off, 60 * 10);
  assert.equal(off.pickups.length, 0);
});

test('player collects a pickup by touching it', () => {
  const m = inPlay();
  const p = m.player('red:FWD'); p.x = 300; p.y = 300;
  m.pickups.push({ id: 1, type: 'speed', x: 300, y: 300, ttl: 10 });
  m.step(DT);
  assert.equal(m.pickups.length, 0);
  assert.ok(p.effects.speed > 0);
  assert.equal(p.stats.pickups, 1);
});

test('snapshot is compact JSON with the expected shape', () => {
  const m = new Match({}, { 'red:GK': { name: 'Zed', isBot: false } });
  const s = m.snapshot();
  assert.equal(s.players.length, MCS.TEAM_SIZE * 2);
  assert.equal(s.players[0].name, 'Zed');
  assert.equal(s.players[0].bot, 0);
  assert.equal(s.players[1].bot, 1);
  assert.ok(JSON.stringify(s).length < 3000);
});

test('T-18 soak: a full bot-vs-bot match completes with finite state and some goals', () => {
  let goals = 0;
  for (let run = 0; run < 2; run++) {
    const m = new Match({ matchSeconds: 180, suddenDeath: false }, {});
    const brains = m.players.map(p => new BotBrain(p.id, p.pos === 'GK' ? 0.85 : 1));
    let ticks = 0;
    while (m.state !== 'ended' && ticks < 60 * 400) {
      for (const b of brains) m.setInput(b.slotId, b.update(m, DT));
      m.step(DT);
      for (const e of m.snapshot().events) if (e.type === 'goal') goals++;
      for (const p of m.players) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.vx), 'player finite');
      assert.ok(Number.isFinite(m.ball.x) && Number.isFinite(m.ball.vx), 'ball finite');
      ticks++;
    }
    assert.equal(m.state, 'ended');
    assert.ok(ticks >= 180 * 60 - 1);
  }
  assert.ok(goals >= 1, 'bots should score at least once in two matches');
});
