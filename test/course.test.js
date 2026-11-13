const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { convert } = require('../scripts/import-course');
const { holeWorld, sampleElevation, horizonAngle } = require('../public/course');
const { horizonProfile } = require('../scripts/import-horizon');
const { courseBounds } = require('../scripts/import-elevation');

const imported = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'courses', 'ancilhoffmangc.json')));

test('sample course contains 18 ordered playable holes and no remote map URLs', () => {
  assert.equal(imported.holes.length, 18);
  assert.deepEqual(imported.holes.map((hole) => hole.number), Array.from({ length: 18 }, (_, i) => i + 1));
  assert.ok(imported.holes.every((hole) => hole.line.length >= 2 && hole.features.some((feature) => feature.type === 'green')));
  assert.ok(!JSON.stringify(imported).includes('http'));
});

test('geo projection places tee at origin and green downrange', () => {
  for (const raw of imported.holes) {
    const hole = holeWorld(raw);
    assert.ok(Math.abs(hole.centerline[0].x) < 1e-8);
    assert.ok(Math.abs(hole.centerline[0].z) < 1e-8);
    assert.ok(hole.green.z > 50, `hole ${hole.number}`);
    assert.ok(Math.abs(hole.green.x) < 30, `hole ${hole.number}`);
  }
});

test('sample terrain covers all Ancil Hoffman holes and anchors each tee to zero', () => {
  const grid = imported.elevation;
  assert.equal(grid.source, 'USGS 3DEP');
  assert.equal(grid.values.length, grid.width * grid.height);
  for (const raw of imported.holes) {
    const hole = holeWorld(raw, grid);
    assert.ok(Number.isFinite(hole.teeElevation), `hole ${raw.number} tee`);
    assert.ok(Number.isFinite(hole.greenRise), `hole ${raw.number} green`);
    assert.ok(Math.abs(hole.heightAt(0, 0)) < 1e-8);
  }
  const first = holeWorld(imported.holes[0], grid);
  assert.ok(first.greenRise > 1 && first.greenRise < 4);
  const last = holeWorld(imported.holes[17], grid);
  assert.ok(last.greenRise > 2 && last.greenRise < 5);
});

test('height grid bilinear interpolation and bounds behave predictably', () => {
  const grid = { width: 2, height: 2, west: 10, north: 20, lonStep: 1, latStep: 1,
    values: [0, 10, 20, 30] };
  assert.equal(sampleElevation(grid, 10.5, 19.5), 15);
  assert.equal(sampleElevation(grid, 9, 19), null);
  assert.equal(sampleElevation({ ...grid, values: [0, null, 20, 30] }, 10.5, 19.5), null);
  const bounds = courseBounds(imported);
  assert.ok(bounds[0] < imported.holes[0].line[0][0]);
  assert.ok(bounds[3] > imported.holes[0].line[0][1]);
});

test('import validates line geometry and keeps only mapped feature coordinates', () => {
  const full = { handle: 'example', name: 'Example', holes: [{ par: 3, distance: 150,
    features: [{ type: 'green', centerlon: 1, centerlat: 2 }, { type: 'tree' }] }] };
  const geo = { type: 'FeatureCollection', features: [{ properties: { hole_number: 1 },
    geometry: { type: 'LineString', coordinates: [[1, 1], [1, 2]] } }] };
  const course = convert(full, geo);
  assert.equal(course.holes[0].features.length, 1);
  assert.deepEqual(course.holes[0].line, [[1, 1], [1, 2]]);
  geo.features[0].geometry.coordinates = [[1, 1]];
  assert.throws(() => convert(full, geo), /Invalid geometry/);
});

test('horizon profile finds a ridge at its azimuth and distance band', () => {
  // 500 m ridge 20 km due east of a sea-level observer at the equator.
  const ridgeLon = 20000 / 111320;
  const sample = (lon, lat) => (Math.abs(lon - ridgeLon) < .01 && Math.abs(lat) < .02 ? 500 : 0);
  const horizon = horizonProfile(sample, [0, 0], { step: 1 });
  assert.equal(horizon.bands.length, 3);
  assert.ok(horizon.bands.every((band) => band.angles.length === 360));
  const mid = horizon.bands[1].angles;
  // atan(500 / 20 km) is 1.43°; Earth curvature hides about 0.08° of it.
  assert.ok(mid[90] > 1.2 && mid[90] < 1.5, `east ${mid[90]}`);
  assert.equal(mid[270], 0);
  assert.equal(Math.max(...horizon.bands[0].angles, ...horizon.bands[2].angles), 0);
  assert.ok(Math.abs(horizonAngle(horizon, horizon.bands[1], 450) - mid[90]) < 1e-9);
  assert.ok(Math.abs(horizonAngle(horizon, horizon.bands[1], -90.5) - (mid[269] + mid[270]) / 2) < 1e-9);
});

test('sample course skyline covers every azimuth and holes report compass bearings', () => {
  const horizon = imported.horizon;
  assert.equal(horizon.source, 'USGS 3DEP');
  for (const band of horizon.bands) {
    assert.equal(band.angles.length, 360 / horizon.step);
    assert.ok(band.angles.every((angle) => angle >= 0 && angle < 45));
  }
  // Sierra Nevada rises east of Sacramento; the valley floor lies west.
  const far = horizon.bands[2];
  assert.ok(horizonAngle(horizon, far, 75) > horizonAngle(horizon, far, 255) + .5);
  // Hole 1 plays north-west from its tee.
  const bearing = holeWorld(imported.holes[0]).bearing;
  assert.ok(bearing < -40 && bearing > -80, `bearing ${bearing}`);
});
