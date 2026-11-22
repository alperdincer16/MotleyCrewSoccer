// Owner: Rosa Vidal (T-53) — sprint & stamina, tackle split from sprint
const test = require('node:test');
const assert = require('node:assert/strict');
const MCS = require('../shared/rules');
const Physics = require('../shared/physics');
const Match = require('../server/game/match');
const { BotBrain } = require('../server/game/ai');

const DT = 1 / 60;
const { FEEL } = Physics;
const rules = MCS.defaultRules();
const st = { speed: false, shrink: false, frozen: false };
const body = () => ({ x: 300, y: 400, vx: 0, vy: 0, r: MCS.PLAYER_RADIUS, dashCooldown: 0, dashTime: 0 });
const run = (p, input, secs, r = rules) => { for (let i = 0; i < Math.round(secs * 60); i++) { Physics.integratePlayer(p, input, r, DT, st, null, null); p.x = 300; } };

test('sprint and tackle are separate rules, both on by default', () => {
  assert.equal(rules.sprintEnabled, true);
  assert.equal(rules.dashEnabled, true);
  assert.equal(MCS.sanitizeRules({ sprintEnabled: false }).sprintEnabled, false);
});

test('sprinting is faster than running, and drains stamina', () => {
  const walk = body(), dash = body();
  run(walk, { right: true }, 1.5);
  run(dash, { right: true, sprint: true }, 1.5);
  assert.ok(dash.vx > walk.vx * 1.25, `sprint ${dash.vx} vs run ${walk.vx}`);
  assert.equal(walk.stamina, 1);
  assert.ok(dash.stamina < 0.6 && dash.stamina > 0.4, `stamina ${dash.stamina}`);
  assert.equal(dash.sprinting, true);
});

test('holding sprint while standing still does not drain stamina', () => {
  const p = body();
  run(p, { sprint: true }, 2);
  assert.equal(p.stamina, 1);
  assert.equal(p.sprinting, false);
});

test('an empty tank stops the sprint until it refills past the recover mark', () => {
  const p = body();
  run(p, { right: true, sprint: true }, 1 / FEEL.staminaDrain + 0.2);
  assert.ok(p.stamina < 0.05, `stamina ${p.stamina}`);   // emptied, refilling slowly
  assert.equal(p.tired, true);
  assert.equal(p.sprinting, false);
  // Still holding sprint: no boost, slightly slower than a fresh runner, stamina refills.
  const fresh = body(); run(fresh, { right: true }, 1);
  run(p, { right: true, sprint: true }, 1);
  assert.ok(p.vx < fresh.vx, 'tired runner is a touch slower');
  assert.ok(p.stamina > 0 && p.stamina < FEEL.staminaRecover);
  run(p, {}, 2);   // rest
  assert.equal(p.tired, false);
  run(p, { right: true, sprint: true }, 0.1);
  assert.equal(p.sprinting, true);
});

test('stamina refills faster at rest than on the move', () => {
  const a = Object.assign(body(), { stamina: 0.2 }), b = Object.assign(body(), { stamina: 0.2 });
  run(a, {}, 1); run(b, { right: true }, 1);
  assert.ok(a.stamina > b.stamina);
});

test('sprint does nothing when the rule is off', () => {
  const off = Object.assign({}, rules, { sprintEnabled: false });
  const a = body(), b = body();
  run(a, { right: true }, 1, off); run(b, { right: true, sprint: true }, 1, off);
  assert.equal(Math.round(a.vx), Math.round(b.vx));
  assert.equal(b.stamina, 1);
});

test('sprint does not fire a tackle, and tackle (dash) does not need sprint', () => {
  const p = body();
  const fired = Physics.integratePlayer(p, { right: true, sprint: true }, rules, DT, st, null, null);
  assert.equal(fired, false);
  assert.equal(p.dashCooldown, 0);
  assert.equal(Physics.integratePlayer(p, { right: true, dash: true }, rules, DT, st, null, null), true);
});

test('server takes the sprint input, snapshots stamina, and refills it after a goal', () => {
  const m = new Match({}, { 'red:MID': { name: 'H', isBot: false } });
  m.state = 'play';
  const me = m.player('red:MID');
  m.setInput('red:MID', { right: true, sprint: true });
  assert.equal(me.input.sprint, true);
  for (let i = 0; i < 60; i++) m.step(DT);
  assert.ok(me.stamina < 0.8, `stamina ${me.stamina}`);
  const snap = m.snapshot().players.find(p => p.id === 'red:MID');
  assert.equal(snap.stm, Math.round(me.stamina * 100) / 100);
  assert.equal(snap.spr, 1);
  m.resetPositions();
  assert.equal(me.stamina, 1);
});

test('bots sprint on long runs only and keep some stamina in reserve', () => {
  const m = new Match({}, {});
  m.state = 'play';
  const brain = new BotBrain('red:DEF');
  const me = m.player('red:DEF');
  brain.target = { x: me.x + 600, y: me.y };
  brain.replanIn = 99;
  assert.equal(brain.update(m, DT).sprint, true);
  me.stamina = 0.2;
  assert.equal(brain.update(m, DT).sprint, false);
  me.stamina = 1; brain.sprinting = false;
  brain.target = { x: me.x + 100, y: me.y };
  assert.equal(brain.update(m, DT).sprint, false);
});

test('humans shoot on release, not press, with the power they held, toward the pointer (T-54)', () => {
  const m = new Match({}, { 'red:MID': { name: 'H', isBot: false } });
  m.state = 'play';
  const p = m.player('red:MID');
  for (const o of m.players) if (o !== p) { o.x = 60; o.y = 60 + m.players.indexOf(o) * 45; }
  p.x = 400; p.y = 350; p.vx = 0; p.vy = 0;
  m.ball.x = p.x + p.r + m.ball.r + 1; m.ball.y = 350; m.ball.vx = 0; m.ball.vy = 0;
  const aim = { aimX: 400, aimY: 100 };   // straight up, 90° off the run of the ball
  for (let i = 0; i < 50; i++) { m.setInput(p.id, Object.assign({ kick: true }, aim)); m.step(DT); }
  assert.equal(p.kickCooldown, 0, 'holding the button does not kick');
  assert.ok(m.snapshot().players.find(s => s.id === p.id).ch >= 1, 'power meter is full');
  m.setInput(p.id, Object.assign({ kick: false }, aim)); m.step(DT);
  assert.ok(p.kickCooldown > 0, 'release kicked');
  const ang = Math.atan2(-m.ball.vy, m.ball.vx) * 180 / Math.PI;
  assert.ok(ang > 70 && ang < 110, `ball goes toward the pointer (${ang.toFixed(0)}°)`);
  assert.ok(Math.hypot(m.ball.vx, m.ball.vy) > FEEL.kickSpeed * 1.3, 'with full power');
});

test('a release just before reaching the ball still kicks; a stale one does not', () => {
  const m = new Match({}, { 'red:MID': { name: 'H', isBot: false } });
  m.state = 'play';
  const p = m.player('red:MID');
  p.x = 400; p.y = 350; m.ball.x = 440; m.ball.y = 350;
  m.setInput(p.id, { kick: true }); m.setInput(p.id, { kick: false });
  m.ball.x = p.x + p.r + m.ball.r + 1; m.step(DT);
  assert.ok(p.kickCooldown > 0);
  p.kickCooldown = 0; m.ball.x = 600; m.ball.vx = 0; m.ball.vy = 0;
  m.setInput(p.id, { kick: true }); m.setInput(p.id, { kick: false });
  for (let i = 0; i < 20; i++) m.step(DT);
  m.ball.x = p.x + p.r + m.ball.r + 1; m.ball.y = p.y; m.step(DT);
  assert.equal(p.kickCooldown, 0, 'a release 0.3 s ago is forgotten');
});
