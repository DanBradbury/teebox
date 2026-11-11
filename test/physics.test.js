const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../public/physics.js');

const fly = (speed, vla, back, hla = 0, side = 0) => P.simulate({ speed, vla, hla, backspin: back, sidespin: side });

test('driver carry is in a realistic range', () => {
  const r = fly(171, 10.4, 2545);        // roughly PGA Tour average
  assert.ok(r.carryYd > 265 && r.carryYd < 300, `carry ${r.carryYd}`);
  assert.ok(r.apexFt > 80 && r.apexFt < 130, `apex ${r.apexFt}`);
});

test('7 iron carries less than driver and lands steeper', () => {
  const d = fly(171, 10.4, 2545), i7 = fly(120, 16.3, 7097);
  assert.ok(i7.carryYd > 150 && i7.carryYd < 190, `carry ${i7.carryYd}`);
  assert.ok(i7.carryYd < d.carryYd);
  assert.ok(i7.landAngle > d.landAngle - 5);
});

test('positive sidespin curves right, negative curves left', () => {
  assert.ok(fly(150, 12, 3000, 0, 600).carryX > 3);
  assert.ok(fly(150, 12, 3000, 0, -600).carryX < -3);
});

test('positive HLA starts right, straight shot stays on line', () => {
  assert.ok(fly(150, 12, 3000, 3).carryX > 3);
  assert.ok(Math.abs(fly(150, 12, 3000).carryX) < 0.5);
});

test('total distance is at least carry for a normal shot, and the path ends on the ground', () => {
  const r = fly(150, 12, 3000);
  assert.ok(r.totalYd >= r.carryYd);
  const last = r.path[r.path.length - 1];
  assert.equal(last[2], 0);
});

test('more backspin means a higher ball', () => {
  assert.ok(fly(130, 14, 7000).apexFt > fly(130, 14, 3000).apexFt);
});

test('randomShot produces plausible values for every club', () => {
  for (const club of Object.keys(P.CLUBS)) {
    const s = P.randomShot(club);
    assert.ok(s.speed > 50 && s.speed < 200 && s.vla > 3 && s.vla < 45 && s.backspin > 1000, club);
    assert.ok(Number.isFinite(P.simulate(s).carryYd));
  }
});
