// Owner: Rosa Vidal (T-39) — 4v4 roster and close ball control
const test = require('node:test');
const assert = require('node:assert/strict');
const MCS = require('../shared/rules');
const Physics = require('../shared/physics');
const Match = require('../server/game/match');
const { BotBrain } = require('../server/game/ai');

const DT = 1 / 60;
const W = MCS.FIELD.width, H = MCS.FIELD.height;
const play = (roster) => { const m = new Match({}, roster || { 'red:MID': { name: 'H', isBot: false } }); m.state = 'play'; return m; };

test('teams are four a side with a midfielder, and every slot has a formation spot', () => {
  assert.deepEqual(MCS.POSITIONS, ['GK', 'DEF', 'MID', 'FWD']);
  assert.equal(MCS.TEAM_SIZE, 4);
  const m = new Match({}, {});
  assert.equal(m.players.length, 8);
  for (const p of m.players) {
    assert.ok(MCS.FORMATION[p.pos], `formation for ${p.pos}`);
    // kickoff spots are in the own half and not on top of each other
    assert.ok(p.team === 'red' ? p.x < W / 2 : p.x > W / 2, `${p.id} in own half`);
    for (const o of m.players) if (o !== p) assert.ok(Math.hypot(o.x - p.x, o.y - p.y) > 2 * MCS.PLAYER_RADIUS, `${p.id} overlaps ${o.id}`);
  }
  assert.deepEqual(MCS.parseSlot('red:MID'), { team: 'red', pos: 'MID' });
});

test('a bot midfielder holds the middle and steps in when the ball comes close', () => {
  const m = play({});
  const mid = m.player('red:MID'), brain = new BotBrain('red:MID');
  m.ball.x = W * 0.8; m.ball.y = H * 0.2; m.ball.vx = 0; m.ball.vy = 0;
  mid.x = W * 0.4; mid.y = H / 2;
  for (const p of m.players) if (p !== mid && p.team === 'red') { p.x = m.ball.x - 30; p.y = m.ball.y + 30; }
  brain.think(m, mid);
  assert.ok(['shape', 'support'].includes(brain.lastPlan), `holds shape (${brain.lastPlan})`);
  assert.ok(brain.target.x > W * 0.18 && brain.target.x < W * 0.82);
  mid.x = m.ball.x - 60; mid.y = m.ball.y;
  for (const p of m.players) if (p !== mid && p.team === 'red') { p.x = 100; p.y = 100; }
  m.tick++;   // new tick: the team plan is recomputed
  brain.think(m, mid);
  assert.ok(!['shape', 'support', 'cover'].includes(brain.lastPlan), `presses (${brain.lastPlan})`);
});

test('first touch: a firm pass into a standing player is cushioned, a hard shot still bounces', () => {
  const m = play(); const p = m.player('red:MID');
  for (const o of m.players) if (o !== p) { o.x = 60; o.y = 60 + m.players.indexOf(o) * 45; }
  p.x = 500; p.y = 300; p.vx = 0; p.vy = 0;
  m.ball.x = 600; m.ball.y = 300; m.ball.vx = -420; m.ball.vy = 0;
  for (let i = 0; i < 30; i++) m.step(DT);
  const rest = Math.hypot(m.ball.x - p.x, m.ball.y - p.y) - p.r - m.ball.r;
  assert.ok(rest < 20, `ball settled at the feet (gap ${rest.toFixed(1)})`);
  assert.ok(Math.hypot(m.ball.vx - p.vx, m.ball.vy - p.vy) < 60, 'ball is not running away');

  const m2 = play(); const k = m2.player('red:MID');
  k.x = 500; k.y = 300; k.vx = 0; k.vy = 0;
  m2.ball.x = 620; m2.ball.y = 300; m2.ball.vx = -Physics.FEEL.ballMaxSpeed; m2.ball.vy = 0;
  for (let i = 0; i < 12; i++) m2.step(DT);
  assert.ok(m2.ball.vx > 250, `hard shot rebounds (vx=${m2.ball.vx.toFixed(0)})`);
});

test('dribbling keeps the ball close and lets you turn with it', () => {
  const m = play(); const p = m.player('red:MID');
  for (const o of m.players) if (o !== p) { o.x = 60; o.y = 60 + m.players.indexOf(o) * 45; }
  p.x = 300; p.y = 350; p.vx = 0; p.vy = 0;
  m.ball.x = p.x + p.r + m.ball.r + 1; m.ball.y = 350; m.ball.vx = 0; m.ball.vy = 0;
  let maxGap = 0;
  for (let i = 0; i < 90; i++) {
    m.setInput('red:MID', i < 45 ? { right: true } : { down: true });
    m.step(DT);
    if (i > 10) maxGap = Math.max(maxGap, Math.hypot(m.ball.x - p.x, m.ball.y - p.y) - p.r - m.ball.r);
  }
  assert.ok(maxGap < 26, `ball stayed close while dribbling (max gap ${maxGap.toFixed(1)})`);
  assert.ok(m.ball.y > p.y + 5, 'ball followed the turn downward');
  assert.ok(m.ball.x > 400, 'ball travelled with the player');
});

test('a carried ball is kicked toward the aim point', () => {
  const m = play(); const p = m.player('red:MID');
  for (const o of m.players) if (o !== p) { o.x = 60; o.y = 60 + m.players.indexOf(o) * 45; }
  p.x = 400; p.y = 350; p.vx = 0; p.vy = 0;
  m.ball.x = p.x + p.r + m.ball.r + 1; m.ball.y = 350;
  for (let i = 0; i < 20; i++) { m.setInput('red:MID', { right: true }); m.step(DT); }
  assert.ok(p.carrying, 'player has the ball under control');
  m.setInput('red:MID', { right: true, kick: true, aimX: m.ball.x + 200, aimY: m.ball.y - 200 });
  m.step(DT);
  const ang = Math.atan2(-m.ball.vy, m.ball.vx) * 180 / Math.PI;
  assert.ok(ang > 25, `kick went up toward the aim (angle ${ang.toFixed(0)}°)`);
});

test('the carry grip does not fight a fresh kick or a dash', () => {
  const m = play(); const p = m.player('red:MID');
  p.x = 400; p.y = 350; p.vx = 0; p.vy = 0;
  m.ball.x = p.x + p.r + m.ball.r + 1; m.ball.y = 350;
  m.setInput('red:MID', { kick: true }); m.step(DT);
  const v0 = m.ball.vx;
  for (let i = 0; i < 6; i++) { m.setInput('red:MID', {}); m.step(DT); }
  assert.ok(v0 > 400 && m.ball.vx > v0 * 0.85, `kick kept its pace (${v0.toFixed(0)} -> ${m.ball.vx.toFixed(0)})`);
});

test('reversing direction is quicker than before (turn assist)', () => {
  const rules = MCS.defaultRules();
  const st = { speed: false, shrink: false, frozen: false };
  const p = { x: 600, y: 350, vx: Physics.FEEL.playerMaxSpeed, vy: 0, r: MCS.PLAYER_RADIUS, dashCooldown: 0, dashTime: 0 };
  let t = 0;
  while (p.vx > 0 && t < 60) { Physics.integratePlayer(p, { left: true }, rules, DT, st, null); t++; }
  assert.ok(t <= 8, `stopped and turned in ${t} ticks`);
});
