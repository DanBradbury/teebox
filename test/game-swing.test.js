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
// Controller swing: a sequence of [x, y, ms] stick samples (Gamepad axes, down is +y).
function stickShot(samples, club = '7i') {
  const s = S.stickBegin();
  for (const [x, y, t] of samples) S.stickMove(s, x, y, t);
  return { state: s, shot: S.stickFinish(s, club, P.CLUBS) };
}
const flick = (depth, x = 0, gap = 120) => [[0, 0, 0], [0, depth / 2, 50], [0, depth, 100], [x, 0, 100 + gap / 2], [x, -1, 100 + gap]];
test('stick nudges, unfinished backswings and returns to rest do not hit shots', () => {
  assert.equal(stickShot([[0, .25, 0], [0, 0, 20]]).state.phase, 'ready');
  assert.equal(stickShot([[0, 1, 0]]).shot, null);
  const dropped = stickShot([[0, 1, 0], [0, 0, 20], [0, 0, 200], [0, 0, 300]]);
  assert.equal(dropped.state.phase, 'cancelled');
  assert.equal(dropped.shot, null);
});
test('stick strikes on the forward push with power from backswing depth', () => {
  const full = stickShot(flick(1)).shot, half = stickShot(flick(.475)).shot;
  assert.equal(full.power, 1);
  assert.equal(half.power, .5);
  assert.equal(full.hla, 0);
  assert.deepEqual(full, stickShot(flick(1)).shot);
  assert.ok(P.simulate(full).carryYd > P.simulate(half).carryYd * 1.5);
});
test('stick drift through the ball curves the shot; small drift stays pure', () => {
  assert.equal(stickShot(flick(1, .05)).shot.error, 0);
  assert.ok(P.simulate(stickShot(flick(1, -.3)).shot).totalX < 0);
  assert.ok(P.simulate(stickShot(flick(1, .3)).shot).totalX > 0);
});
test('a slow downswing loses power', () => {
  const quick = stickShot(flick(1, 0, 120)).shot, slow = stickShot(flick(1, 0, 600)).shot;
  assert.equal(quick.tempo, 1);
  assert.ok(slow.tempo < 1 && slow.power < quick.power);
});
