const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../public/physics.js');

const fly = (speed, vla, back, hla = 0, side = 0) => P.simulate({ speed, vla, hla, backspin: back, sidespin: side });

// Radar-measured tour averages published by TrackMan: [club, ball mph, launch deg, spin rpm, carry yd, apex yd, landing deg].
// The model is not tuned club by club; one drag/lift law has to reproduce the whole bag for both tours.
const PGA = [['DR', 167, 10.9, 2686, 275, 32, 38], ['3W', 158, 9.2, 3655, 243, 30, 43], ['5W', 152, 9.4, 4350, 230, 31, 47],
  ['Hy', 146, 10.2, 4437, 225, 29, 47], ['3i', 142, 10.4, 4630, 212, 27, 46], ['4i', 137, 11.0, 4836, 203, 28, 48],
  ['5i', 132, 12.1, 5361, 194, 31, 49], ['6i', 127, 14.1, 6231, 183, 30, 50], ['7i', 120, 16.3, 7097, 172, 32, 50],
  ['8i', 115, 18.1, 7998, 160, 31, 50], ['9i', 109, 20.4, 8647, 148, 30, 51], ['PW', 102, 24.2, 9304, 136, 29, 52]];
const LPGA = [['DR', 140, 13.2, 2611, 218, 25, 37], ['3W', 132, 11.2, 2704, 195, 23, 39], ['5W', 128, 12.1, 4501, 185, 26, 43],
  ['7W', 123, 12.7, 4693, 174, 25, 46], ['4i', 116, 14.3, 4801, 169, 24, 43], ['5i', 112, 14.8, 5081, 161, 23, 45],
  ['6i', 109, 17.1, 5943, 152, 25, 46], ['7i', 104, 19.0, 6699, 141, 26, 47], ['8i', 100, 20.8, 7494, 130, 25, 47],
  ['9i', 93, 23.9, 7589, 119, 26, 47], ['PW', 86, 25.6, 8403, 107, 23, 48]];

for (const [tour, table] of [['PGA', PGA], ['LPGA', LPGA]]) {
  test(`${tour} Tour averages: carry, apex and landing angle across the bag`, () => {
    let carryErr = 0;
    for (const [club, speed, vla, spin, carry, apexYd, land] of table) {
      const r = P.simulate({ speed, vla, hla: 0, backspin: spin, sidespin: 0 }, { tempC: 25 });
      const id = `${tour} ${club}`;
      assert.ok(Math.abs(r.carryYd / carry - 1) < 0.04, `${id} carry ${r.carryYd.toFixed(1)} vs ${carry}`);
      assert.ok(Math.abs(r.apexFt / 3 / apexYd - 1) < 0.20, `${id} apex ${(r.apexFt / 3).toFixed(1)} vs ${apexYd}`);
      assert.ok(Math.abs(r.landAngle - land) < 8, `${id} landing angle ${r.landAngle.toFixed(1)} vs ${land}`);
      carryErr += Math.abs(r.carryYd - carry);
    }
    assert.ok(carryErr / table.length < 4, `mean carry error ${(carryErr / table.length).toFixed(1)} yd`);
  });
}

test('7 iron carries less than driver and lands steeper', () => {
  const d = fly(171, 10.4, 2545), i7 = fly(120, 16.3, 7097);
  assert.ok(i7.carryYd < d.carryYd);
  assert.ok(i7.landAngle > d.landAngle);
});

test('air density follows temperature, altitude and humidity', () => {
  const isa = P.atmosphere({ tempC: 15, humidity: 0 });
  assert.ok(Math.abs(isa.rho - 1.225) < 0.002, `ISA sea level ${isa.rho}`);
  assert.ok(Math.abs(isa.mu - 1.79e-5) < 0.03e-5, `viscosity ${isa.mu}`);
  const denver = P.atmosphere({ tempC: 15, humidity: 0, altitudeFt: 5280 });
  assert.ok(denver.rho / isa.rho > 0.80 && denver.rho / isa.rho < 0.85, `Denver ratio ${denver.rho / isa.rho}`);
  assert.ok(P.atmosphere({ tempF: 100 }).rho < P.atmosphere({ tempF: 40 }).rho);
  assert.ok(P.atmosphere({ tempC: 30, humidity: 100 }).rho < P.atmosphere({ tempC: 30, humidity: 0 }).rho);
});

test('thin air and warm air carry further', () => {
  const s = { speed: 167, vla: 10.9, hla: 0, backspin: 2686, sidespin: 0 };
  const sea = P.simulate(s, { tempF: 70 }).carryYd;
  const gain = P.simulate(s, { tempF: 70, altitudeFt: 5280 }).carryYd / sea - 1;
  assert.ok(gain > 0.03 && gain < 0.09, `mile-high gain ${(gain * 100).toFixed(1)}%`);
  assert.ok(P.simulate(s, { tempF: 95 }).carryYd > sea);
  assert.ok(P.simulate(s, { tempF: 45 }).carryYd < sea);
});

test('wind: a headwind hurts more than a tailwind helps, a crosswind moves the ball downwind', () => {
  const s = { speed: 120, vla: 16.3, hla: 0, backspin: 7097, sidespin: 0 };
  const calm = P.simulate(s).carryYd;
  const head = P.simulate(s, { windMph: 10, windFrom: 0 }).carryYd, tail = P.simulate(s, { windMph: 10, windFrom: 180 }).carryYd;
  assert.ok(head < calm && tail > calm);
  assert.ok(calm - head > tail - calm, `head ${head} calm ${calm} tail ${tail}`);
  assert.ok(P.simulate(s, { windMph: 10, windFrom: 90 }).carryX < -3);    // from the right, ball goes left
  assert.ok(P.simulate(s, { windMph: 10, windFrom: 270 }).carryX > 3);
});

test('lift and drag coefficients sit in the wind-tunnel range', () => {
  for (const [S, Re] of [[0.05, 2e5], [0.1, 1.5e5], [0.2, 1e5], [0.3, 1e5], [0.5, 8e4]]) {
    const { cd, cl } = P.coefficients(S, Re);
    assert.ok(cd > 0.19 && cd < 0.45, `Cd ${cd} at S=${S}`);
    assert.ok(cl > 0.08 && cl < 0.42, `Cl ${cl} at S=${S}`);
  }
  assert.equal(P.coefficients(0, 1e5).cl, 0);
  assert.ok(P.coefficients(0.1, 1e5).cl < P.coefficients(0.3, 1e5).cl);          // more spin, more lift
  assert.ok(P.coefficients(0.1, 1e5).cd < P.coefficients(0.3, 1e5).cd);          // and more drag
  assert.ok(P.coefficients(0.1, 4e4).cd > P.coefficients(0.1, 1.5e5).cd);        // drag crisis at low Re
});

test('spin decays in flight', () => {
  const r = fly(167, 10.9, 2686);
  assert.ok(r.landSpin < 2686 * 0.9 && r.landSpin > 2686 * 0.6, `landing spin ${r.landSpin}`);
});

test('bounce: backspin checks the ball, a steep spinning wedge can stop or back up', () => {
  const turf = P.SURFACES.green, RPM = Math.PI / 30;
  const dead = P.bounce([0, -15, 15], [0, 0, 0], turf), spun = P.bounce([0, -15, 15], [-9000 * RPM, 0, 0], turf);
  assert.ok(dead.v[1] > 0 && spun.v[1] > 0);                 // both rebound
  assert.ok(dead.v[2] > 0 && dead.v[2] < 15);                // forward, but slower
  assert.ok(spun.v[2] < dead.v[2]);
  assert.ok(dead.w[0] > 0);                                  // friction turns a dead ball into topspin
  const wedge = P.simulate({ speed: 102, vla: 24.2, hla: 0, backspin: 9304, sidespin: 0 }, { surface: 'green' });
  assert.ok(wedge.totalYd - wedge.carryYd < 3, `wedge released ${wedge.totalYd - wedge.carryYd} yd`);
});

test('restitution falls with impact speed', () => {
  assert.ok(P.restitution(2) > P.restitution(10) && P.restitution(10) > P.restitution(19));
  assert.ok(Math.abs(P.restitution(25) - 0.12) < 1e-9);
});

test('roll-out depends on the turf and on how the ball lands', () => {
  const drive = { speed: 150, vla: 12, hla: 0, backspin: 2600, sidespin: 0 };
  const roll = (surface, s = drive) => { const r = P.simulate(s, { surface }); return r.totalYd - r.carryYd; };
  assert.ok(roll('firm') > roll('fairway') && roll('fairway') > roll('soft') && roll('soft') >= roll('rough'));
  assert.ok(roll('fairway') > 5 && roll('fairway') < 60, `drive rolled ${roll('fairway')}`);
  const wedge = { speed: 96, vla: 25, hla: 0, backspin: 9200, sidespin: 0 };
  assert.ok(roll('fairway', wedge) < roll('fairway', drive));
  assert.ok(P.simulate(drive, { surface: 'soft' }).carryYd === P.simulate(drive, { surface: 'firm' }).carryYd);
});

test('odd inputs stay finite', () => {
  for (const s of [[0, 0, 0], [5, 0, 0], [60, -3, 2000], [190, 45, 12000], [100, 15, 0], [100, 15, -500], [80, 60, 11000]]) {
    const r = P.simulate({ speed: s[0], vla: s[1], hla: 0, backspin: s[2], sidespin: 300 }, { windMph: 20, windFrom: 45 });
    assert.ok(r.path.every((q) => q.every(Number.isFinite)), `path for ${s}`);
    assert.ok(Number.isFinite(r.carryYd) && Number.isFinite(r.totalYd) && r.duration < 90, `result for ${s}`);
  }
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
