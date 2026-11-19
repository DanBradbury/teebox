const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public/game-swing');
const P = require('../public/physics');
function shot(depth, error = 0, club = '7i') {
  const s = S.begin(200, 100);
  S.move(s, 200, 100 + depth);
  S.move(s, 200 + error, 100);
  return S.finish(s, club, P.CLUBS);
}
test('clicks and unreversed drags do not hit shots', () => {
  const s = S.begin(0, 0);
  assert.equal(S.finish(s, '7i', P.CLUBS), null);
  S.move(s, 0, 140);
  assert.equal(S.finish(s, '7i', P.CLUBS), null);
  S.move(s, 0, 100);
  assert.equal(S.finish(s, '7i', P.CLUBS), null);
});
test('backswing sets power, caps at full, and changes actual carry', () => {
  assert.equal(shot(140).power, 1);
  assert.equal(shot(280).power, 1);
  assert.equal(shot(70).power, .5);
  assert.ok(P.simulate(shot(140)).carryYd > P.simulate(shot(70)).carryYd * 1.5);
});
test('straight swings are repeatable; misses produce directional flight', () => {
  assert.deepEqual(shot(140), shot(140));
  assert.equal(shot(140).hla, 0);
  assert.ok(P.simulate(shot(140, -35)).totalX < 0);
  assert.ok(P.simulate(shot(140, 35)).totalX > 0);
});
test('all clubs produce finite playable flights with distinct distances', () => {
  for (const club of Object.keys(P.CLUBS)) {
    const res = P.simulate(shot(140, 0, club));
    assert.ok(Number.isFinite(res.carryYd) && res.carryYd > 0, club);
  }
  assert.ok(P.simulate(shot(140, 0, 'DR')).carryYd > P.simulate(shot(140, 0, 'SW')).carryYd);
});
