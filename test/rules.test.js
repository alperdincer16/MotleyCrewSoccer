// Owner: Rosa Vidal (T-17)
const test = require('node:test');
const assert = require('node:assert/strict');
const MCS = require('../shared/rules');

test('defaultRules covers every schema key and all boosts', () => {
  const r = MCS.defaultRules();
  for (const k of Object.keys(MCS.RULE_SCHEMA)) assert.ok(k in r, `missing ${k}`);
  assert.deepEqual(r.enabledBoosts, MCS.BOOST_IDS);
});

test('sanitizeRules clamps, snaps to step and ignores junk', () => {
  const r = MCS.sanitizeRules({ matchSeconds: 99999, goalLimit: -4, playerSpeed: '1.25', bogus: 1, suddenDeath: 0 });
  assert.equal(r.matchSeconds, 600);
  assert.equal(r.goalLimit, 0);
  assert.equal(r.playerSpeed, 1.3);          // snapped to 0.1 step
  assert.equal(r.suddenDeath, false);
  assert.ok(!('bogus' in r));
});

test('sanitizeRules merges onto a base and filters unknown boosts', () => {
  const base = MCS.sanitizeRules({ goalWidth: 240 });
  const r = MCS.sanitizeRules({ enabledBoosts: ['speed', 'nope', 'freeze'] }, base);
  assert.equal(r.goalWidth, 240);
  assert.deepEqual(r.enabledBoosts, ['speed', 'freeze']);
});

test('slot helpers', () => {
  assert.equal(MCS.slotId('red', 'GK'), 'red:GK');
  assert.deepEqual(MCS.parseSlot('blue:FWD'), { team: 'blue', pos: 'FWD' });
  assert.equal(MCS.parseSlot('green:GK'), null);
  assert.equal(MCS.otherTeam('red'), 'blue');
});
