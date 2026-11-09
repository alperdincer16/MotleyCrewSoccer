// Owner: Rosa Vidal (T-34) — signature moves, shots, combos, arenas, chaos,
// progression and tournaments.
const test = require('node:test');
const assert = require('node:assert/strict');
const MCS = require('../shared/rules');
const Physics = require('../shared/physics');
const Teams = require('../shared/teams');
const Progress = require('../shared/progress');
const Match = require('../server/game/match');
const { Tournament } = require('../server/tournament');
const { Profiles } = require('../server/profiles');

const DT = 1 / 60;
const W = MCS.FIELD.width, H = MCS.FIELD.height;
function inPlay(rules = {}, sides) { const m = new Match(Object.assign({ chaosEvents: false, boostsEnabled: false }, rules), {}, sides); m.state = 'play'; return m; }
function stepN(m, n) { for (let i = 0; i < n; i++) m.step(DT); }
function events(m) { return m.snapshot().events; }
/** Put player p right behind the ball facing +x, ready to kick. */
function setUpKick(m, p, extra = {}) {
  m.ball.x = 600; m.ball.y = 350; m.ball.vx = 0; m.ball.vy = 0;
  p.x = 600 - p.r - m.ball.r - 2; p.y = 350; p.vx = 0; p.vy = 0;
  for (const o of m.players) if (o !== p) { o.x = 100 + Math.random() * 50; o.y = 50; }
  m.setInput(p.id, Object.assign({ aimX: 1100, aimY: 350 }, extra));
}

test('every nation has a signature move with a known kind', () => {
  for (const id of Teams.IDS) {
    const sp = Teams.specialFor(id);
    assert.ok(Teams.SPECIALS[sp.kind], id);
    assert.ok(sp.name && sp.icon && sp.desc, id);
  }
});

test('signature meter fills, E arms the move once, thunder fires harder and ploughs through', () => {
  const m = inPlay({}, { red: 'eng', blue: 'bra' });
  const p = m.player('red:FWD');
  m.setInput(p.id, { skill: true }); stepN(m, 1);
  assert.equal(p.armed, null, 'empty meter: nothing happens');
  p.meter = 1;
  m.setInput(p.id, { skill: false }); stepN(m, 1);
  m.setInput(p.id, { skill: true }); stepN(m, 1);
  assert.equal(p.armed, 'thunder'); assert.equal(p.meter, 0);
  assert.ok(events(m).some(e => e.type === 'special' && e.kind === 'thunder'));
  setUpKick(m, p, { kick: true });
  stepN(m, 1);
  const sp = Math.hypot(m.ball.vx, m.ball.vy);
  assert.ok(sp > Physics.FEEL.kickSpeed * 1.5, `thunder speed ${sp}`);
  assert.ok(m.ball.effects.thunder);
  assert.equal(p.armed, null);
  // An outfield opponent in the path is knocked over, not a wall.
  const def = m.player('blue:DEF'); def.x = m.ball.x + 60; def.y = m.ball.y; def.vx = 0; def.vy = 0;
  m.setInput(p.id, {});
  stepN(m, 8);
  assert.ok(def.effects.stun > 0, 'defender stunned');
  assert.ok(m.ball.x > def.x, 'ball went through');
});

test('sliding tackle knocks an opponent over; shockwave pushes opponents away', () => {
  const m = inPlay({}, { red: 'ita', blue: 'tur' });
  const p = m.player('red:DEF'), o = m.player('blue:FWD');
  p.x = 400; p.y = 350; o.x = 470; o.y = 350; m.ball.x = 900; m.ball.y = 600;
  p.meter = 1; m.setInput(p.id, { right: true, skill: true });
  stepN(m, 10);
  assert.ok(o.effects.stun > 0, 'opponent stunned by the slide');
  assert.ok(events(m).some(e => e.type === 'tackle'));

  const t = m.player('blue:DEF');
  t.x = 700; t.y = 300; t.meter = 1;
  const victim = m.player('red:FWD'); victim.x = 760; victim.y = 300; victim.vx = 0; victim.vy = 0;
  m.setInput(t.id, { skill: true }); stepN(m, 1);
  assert.ok(victim.vx > 200, `pushed away: ${victim.vx}`);
});

test('charged kicks are harder than taps; curve bends the ball; lobs fly over players', () => {
  const tap = inPlay(); const a = tap.player('red:FWD');
  setUpKick(tap, a, { kick: true }); stepN(tap, 1);
  const tapSpeed = Math.hypot(tap.ball.vx, tap.ball.vy);

  const ch = inPlay(); const b = ch.player('red:FWD');
  b.isBot = false;                        // charging is for humans
  setUpKick(ch, b, {});
  b.x -= 80;
  for (let i = 0; i < 45; i++) { ch.setInput(b.id, { kick: true, aimX: 1100, aimY: 350 }); ch.step(DT); }   // wind up
  for (let i = 0; i < 60 && b.kickCooldown === 0; i++) { ch.setInput(b.id, { kick: true, right: true, aimX: 1100, aimY: 350 }); ch.step(DT); }
  const chSpeed = Math.hypot(ch.ball.vx, ch.ball.vy);
  assert.ok(chSpeed > tapSpeed * 1.2, `charged ${chSpeed} vs tap ${tapSpeed}`);

  const cu = inPlay(); const c = cu.player('red:FWD');
  setUpKick(cu, c, { kick: true, curve: 1 }); stepN(cu, 1);
  const y0 = cu.ball.y; stepN(cu, 30);
  assert.ok(cu.ball.y > y0 + 25, 'positive curve bends the ball clockwise (downward when shooting right)');

  const lo = inPlay(); const d = lo.player('red:FWD');
  setUpKick(lo, d, { lob: true }); stepN(lo, 1);
  assert.ok(lo.ball.vz > 0);
  const blocker = lo.player('blue:DEF'); blocker.x = lo.ball.x + 90; blocker.y = lo.ball.y;
  stepN(lo, 12);
  assert.ok(lo.ball.z > Physics.FEEL.headHeight, 'ball is in the air');
  stepN(lo, 18);
  assert.ok(lo.ball.x > blocker.x + 20, 'and sailed over the defender');
  stepN(lo, 120);
  assert.equal(lo.ball.z, 0, 'it comes back down');
});

test('a ball over the bar does not score', () => {
  const m = inPlay();
  m.ball.x = W - 30; m.ball.y = H / 2; m.ball.vx = 600; m.ball.z = 80; m.ball.vz = 0;
  stepN(m, 6);
  assert.equal(m.score.red, 0);
  assert.ok(m.ball.vx < 0, 'bounced back off the frame');
});

test('three passes in a row power up the next shot; an opponent touch breaks the chain', () => {
  const m = inPlay();
  const [g, d, f] = ['red:GK', 'red:DEF', 'red:FWD'].map(id => m.player(id));
  const pass = (from, to) => { m.registerTouch(from, true); m.tick += 10; m.registerTouch(to, false); m.tick += 10; };
  pass(g, d); pass(d, f);
  assert.equal(m.combo.red.chain, 2);
  m.registerTouch(m.player('blue:FWD'), false);
  assert.equal(m.combo.red.chain, 0, 'broken');
  pass(g, d); pass(d, f); pass(f, d);
  assert.equal(m.combo.red.ready, true);
  setUpKick(m, d, { kick: true }); stepN(m, 1);
  assert.ok(m.ball.effects.fire, 'combo shot');
  assert.equal(m.combo.red.ready, false);
});

test('arenas change the feel: ice slides further, mud is slower; prediction uses the same code', () => {
  const run = (arena) => {
    const rules = MCS.sanitizeRules({ arena });
    const p = { x: 300, y: 300, vx: 0, vy: 0, r: 20, dashCooldown: 0, dashTime: 0 };
    for (let i = 0; i < 40; i++) Physics.integratePlayer(p, { right: true }, rules, DT, {}, null, null);
    const top = p.vx;
    for (let i = 0; i < 30; i++) Physics.integratePlayer(p, {}, rules, DT, {}, null, null);
    return { top, coast: p.vx };
  };
  const classic = run('classic'), ice = run('ice'), mud = run('mud');
  assert.ok(ice.coast > classic.coast * 3, 'ice keeps sliding');
  assert.ok(mud.top < classic.top, 'mud is slower');
  assert.equal(MCS.sanitizeRules({ arena: 'lava' }).arena, 'classic', 'unknown arenas are ignored');
});

test('pinball bumpers move deterministically and fire the ball off', () => {
  const rules = MCS.sanitizeRules({ arena: 'bumpers' });
  assert.deepEqual(Physics.bumpersAt(rules, 120), Physics.bumpersAt(rules, 120));
  assert.notDeepEqual(Physics.bumpersAt(rules, 0), Physics.bumpersAt(rules, 120));
  const m = inPlay({ arena: 'bumpers' });
  const bp = Physics.bumpersAt(m.rules, m.tick + 1)[0];
  m.ball.x = bp.x - 60; m.ball.y = bp.y; m.ball.vx = 300; m.ball.vy = 0;
  for (const p of m.players) { p.x = 50; p.y = 50; }
  stepN(m, 20);
  assert.ok(events(m).some(e => e.type === 'bumper'));
});

test('wind pushes the ball in the windy arena', () => {
  const m = inPlay({ arena: 'wind' });
  for (const p of m.players) { p.x = 50; p.y = 50; }
  m.ball.x = 600; m.ball.y = 350;
  m.wind = { x: 150, y: 0, tx: 150, ty: 0, timer: 99 };
  stepN(m, 60);
  assert.ok(m.ball.x > 640, `drifted to ${m.ball.x}`);
});

// T-45 (Rosa Vidal): weather is chosen separately from the location.
test('weather: wind is weather now, old "wind" arenas map to it, snow slows players, rain skids the ball', () => {
  const legacy = MCS.sanitizeRules({ arena: 'wind' });
  assert.equal(legacy.arena, 'classic'); assert.equal(legacy.weather, 'wind');
  assert.equal(MCS.sanitizeRules({ weather: 'hail' }).weather, 'clear', 'unknown weather is ignored');
  assert.equal(MCS.sanitizeRules({ venue: 'seaside' }).venue, 'seaside');
  assert.equal(MCS.sanitizeRules({ venue: 'moon' }).venue, 'national', 'unknown locations are ignored');
  const m = inPlay({ arena: 'mud', weather: 'wind' });
  for (const p of m.players) { p.x = 50; p.y = 50; }
  m.ball.x = 600; m.ball.y = 350;
  m.wind = { x: 150, y: 0, tx: 150, ty: 0, timer: 99 };
  stepN(m, 60);
  assert.ok(m.ball.x > 620, `wind works on any location, drifted to ${m.ball.x}`);
  const top = (weather) => {
    const rules = MCS.sanitizeRules({ weather });
    const p = { x: 300, y: 300, vx: 0, vy: 0, r: 20, dashCooldown: 0, dashTime: 0 };
    for (let i = 0; i < 60; i++) Physics.integratePlayer(p, { right: true }, rules, DT, {}, null, null);
    return p.vx;
  };
  assert.ok(top('snow') < top('clear'), 'snow is slower');
  assert.equal(top('night'), top('clear'), 'night only changes the look');
  const clear = MCS.sanitizeRules({}), rain = MCS.sanitizeRules({ weather: 'rain' });
  assert.ok(Physics.ballDragFor(rain) > Physics.ballDragFor(clear), 'the ball skids on in the rain');
});

test('chaos events: tiny goals shrink the mouth, golden window doubles goals, they expire', () => {
  const m = inPlay({ chaosEvents: true, chaosEvery: 15 });
  m.startChaos('tinyGoals');
  assert.ok(m.goalHalfWidth() < m.rules.goalWidth / 2);
  assert.equal(m.snapshot().gw, Math.round(m.goalHalfWidth() * 2));
  m.chaos.t = 0.01; stepN(m, 2);
  assert.equal(m.chaos, null);
  m.startChaos('doublePoints');
  m.ball.x = W - 15; m.ball.y = H / 2; m.ball.vx = 800;
  stepN(m, 4);
  assert.equal(m.score.red, 2);
  const m2 = inPlay({ chaosEvents: true, chaosEvery: 15 });
  stepN(m2, 60 * 16);
  assert.ok(m2.chaos || m2.lastChaos, 'a chaos event started on its own');
});

test('keeper stopping a shot that was going in counts as a save', () => {
  const m = inPlay();
  const gk = m.player('blue:GK');
  for (const p of m.players) if (p !== gk) { p.x = 100; p.y = 60; }
  gk.x = W - 40; gk.y = H / 2; gk.vx = 0; gk.vy = 0;
  m.ball.x = W - 200; m.ball.y = H / 2; m.ball.vx = 700; m.ball.vy = 0;
  stepN(m, 20);
  assert.equal(gk.stats.saves, 1);
  assert.equal(m.score.red, 0);
});

test('progress: levels, unlock validation, XP awards', () => {
  assert.equal(Progress.levelInfo(0).level, 1);
  assert.equal(Progress.levelInfo(Progress.xpAtLevel(5)).level, 5);
  assert.equal(Progress.levelInfo(1e9).level, Progress.LEVEL_CAP);
  assert.deepEqual(Progress.sanitizeLook({ hair: 'afro', boots: '#1a1a1a', celebration: 'backflip' }, 3), { boots: '#1a1a1a' });
  assert.deepEqual(Progress.sanitizeLook({ hair: 'afro', celebration: 'backflip' }, 12), { hair: 'afro', celebration: 'backflip' });
  const profiles = new Profiles(null);
  profiles.get('tok', 'Ana');
  const rep = profiles.award('tok', { goals: 2, assists: 1, saves: 0 }, 'win', { mvp: true });
  assert.equal(rep.gained, 40 + 60 + 50 + 15 + 30);
  assert.equal(rep.after.level, 2);
  assert.ok(rep.unlocks.some(u => u.id === 'dance'));
  assert.equal(profiles.get('tok').wins, 1);
  profiles.setLook('tok', { celebration: 'backflip', hair: 'long' });
  assert.deepEqual(profiles.get('tok').look, { hair: 'long' });
});

test('tournament: 8 nations, live result recorded, the rest simulated, draws go to penalties', async () => {
  const t = new Tournament({ red: 'bra', blue: 'ger' }, { matchSeconds: 60 });
  assert.equal(new Set(t.nations).size, 8);
  assert.deepEqual(t.nextSides(), { red: 'bra', blue: 'ger' });
  const res = t.recordLive({ red: 1, blue: 1 }, 'draw');
  assert.ok(res.pens && res.pens[0] !== res.pens[1]);
  await new Promise(r => t.simulateRest(r));
  if (res.won) {
    assert.equal(t.round, 1);
    assert.equal(t.rounds[1].length, 2);
    assert.ok(t.nextSides().red === 'bra');
  } else {
    assert.equal(t.status, 'out');
    assert.ok(t.finished() && t.champion);
  }
  for (const f of t.rounds[0]) assert.ok(f.winner === f.a || f.winner === f.b);
});
