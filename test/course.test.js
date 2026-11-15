const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { convert, convertTees } = require('../scripts/import-course');
const { holeWorld, sampleElevation, horizonAngle, teeLine, mapCoords, inRings, holeMap, holeTrees, surfaceAt } = require('../public/course');
const { layerOf, stitch, clipRing, convert: convertMap } = require('../scripts/import-map');
const { otsu, canopyMask, plantTrees } = require('../scripts/import-trees');
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

test('import keeps one scorecard row per tee colour with both ratings', () => {
  const hole = (distance) => ({ par: 4, distance });
  const tees = convertTees([
    { name: 'White', color: 'white', type: 'MEN', par: 72, rating: '69.4', slope: 119, holes: [hole(300), hole(350)] },
    { name: 'Gold', color: 'gold', type: 'MEN', par: 72, rating: '73.3', slope: 132, holes: [hole(349), hole(588)] },
    { name: 'White', color: 'white', type: 'LADY', par: 73, rating: '74.5', slope: 128, holes: [hole(300), hole(350)] },
    { name: 'Old', color: 'red', type: 'MEN', isarchived: true, holes: [hole(200), hole(200)] }
  ]);
  assert.deepEqual(tees.map((tee) => tee.name), ['Gold', 'White']);
  assert.deepEqual(tees[1], { name: 'White', color: 'white', yards: 650, distances: [300, 350], par: 72, rating: 69.4, slope: 119,
    ladies: { par: 73, rating: 74.5, slope: 128 } });
});

test('sample course tees match its mapped back-tee yardages', () => {
  assert.equal(imported.tees[0].name, 'Gold');
  assert.deepEqual(imported.tees[0].distances, imported.holes.map((hole) => hole.distance));
  assert.ok(imported.tees.every((tee) => tee.distances.length === 18 && tee.yards === tee.distances.reduce((a, b) => a + b, 0)));
});

test('forward tee starts down the centerline and shortens the hole by the cut', () => {
  const raw = imported.holes[1];
  const full = holeWorld(raw);
  const length = (hole) => hole.centerline.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - hole.centerline[i].x, p.z - hole.centerline[i].z), 0);
  assert.deepEqual(teeLine(raw.line, 0), raw.line);
  const forward = holeWorld({ ...raw, line: teeLine(raw.line, 100) });
  assert.ok(Math.abs(length(full) - length(forward) - 100) < 0.5);
  // A cut past the dogleg drops that point; one longer than the hole still leaves a playable line.
  assert.equal(teeLine(raw.line, 400).length, 2);
  assert.ok(length(holeWorld({ ...raw, line: teeLine(raw.line, 5000) })) >= 19);
});

test('terrain carries on level past the edge of the height grid', () => {
  const grid = { source: 'test', width: 2, height: 2, west: 0, north: .001, lonStep: .001, latStep: .001, values: [5, 9, 5, 9] };
  const hole = holeWorld({ line: [[0, 0], [.001, 0]], features: [] }, grid);
  assert.ok(Math.abs(hole.heightAt(0, 111) - 4) < .05);
  assert.ok(Math.abs(hole.heightAt(0, 5000) - 4) < 1e-9);
  assert.ok(Math.abs(hole.heightAt(300, -5000)) < 1e-9);
});

test('map import sorts OSM tags into layers, stitches split rings and clips to the course', () => {
  assert.equal(layerOf({ golf: 'lateral_water_hazard' }), 'water');
  assert.equal(layerOf({ natural: 'wood' }), 'wood');
  assert.equal(layerOf({ golf: 'hole' }), null);
  assert.deepEqual(stitch([[[0, 0], [1, 0]], [[1, 1], [1, 0]], [[1, 1], [0, 0]]]).map((ring) => ring.length), [4]);
  assert.deepEqual(stitch([[[0, 0], [1, 0]], [[1, 1], [2, 2]]]), []);
  assert.deepEqual(clipRing([[-1, -1], [3, -1], [3, 3], [-1, 3], [-1, -1]], [0, 0, 2, 2]).length, 4);
  const node = (lon, lat) => ({ lon, lat });
  const square = (x, y, size) => [node(x, y), node(x + size, y), node(x + size, y + size), node(x, y + size), node(x, y)];
  const map = convertMap({ elements: [
    { type: 'way', tags: { golf: 'green' }, geometry: square(.001, .001, .0002) },
    { type: 'way', tags: { golf: 'bunker' }, geometry: square(5, 5, .0002) },
    { type: 'way', tags: { golf: 'cartpath' }, geometry: [node(.001, .001), node(.002, .002), node(9, 9)] },
    { type: 'way', tags: { golf: 'hole' }, geometry: [node(.001, .001), node(.002, .002)] },
    { type: 'relation', tags: { golf: 'fairway', type: 'multipolygon' }, members: [
      { type: 'way', role: 'outer', geometry: square(.001, .001, .002).slice(0, 3) },
      { type: 'way', role: 'outer', geometry: square(.001, .001, .002).slice(2) },
      { type: 'way', role: 'inner', geometry: square(.0015, .0015, .0002) }] }
  ] }, [0, 0, .01, .01]);
  assert.equal(map.source, 'OpenStreetMap contributors');
  assert.deepEqual(map.green, [[[1000, 1000, 1200, 1000, 1200, 1200, 1000, 1200]]]);
  assert.equal(map.bunker.length, 0);
  assert.deepEqual(map.path, [[1000, 1000, 2000, 2000]]);
  assert.deepEqual(map.fairway.map((rings) => rings.map((ring) => ring.length)), [[8, 8]]);
  assert.deepEqual(mapCoords([10, 20], [1000, 2000]), [[10.001, 20.002]]);
});

test('point-in-polygon honours holes', () => {
  const rings = [[[0, 0], [10, 0], [10, 10], [0, 10]], [[4, 4], [6, 4], [6, 6], [4, 6]]];
  assert.ok(inRings(rings, 2, 2));
  assert.ok(!inRings(rings, 5, 5));
  assert.ok(!inRings(rings, 11, 5));
});

test('sample course map puts every green point on a mapped green and trees off the playing surfaces', () => {
  const { map, trees } = imported;
  assert.equal(map.source, 'OpenStreetMap contributors');
  assert.equal(trees.source, 'USGS NAIP');
  assert.ok(map.fairway.length >= 18 && map.green.length >= 18 && map.bunker.length > 20 && map.tee.length >= 18);
  const lonLat = (layer) => map[layer].map((rings) => rings.map((ring) => mapCoords(map.origin, ring)));
  const greens = lonLat('green'), open = ['fairway', 'green', 'bunker', 'tee', 'water'].flatMap(lonLat);
  for (const hole of imported.holes) {
    const green = hole.features.find((feature) => feature.type === 'green').coord;
    assert.ok(greens.some((rings) => inRings(rings, ...green)), `hole ${hole.number}`);
  }
  assert.ok(trees.points.length % 3 === 0 && trees.points.length / 3 > 500);
  for (let i = 0; i < trees.points.length; i += 3) {
    const lon = trees.origin[0] + trees.points[i] / 1e6, lat = trees.origin[1] + trees.points[i + 1] / 1e6;
    assert.ok(!open.some((rings) => inRings(rings, lon, lat)));
    assert.ok(trees.points[i + 2] >= 25 && trees.points[i + 2] <= 80);
  }
});

test('hole map keeps the hole\'s own green around the flag and nearby trees, in hole coordinates', () => {
  for (const raw of imported.holes) {
    const hole = holeWorld(raw, imported.elevation), local = holeMap(hole, imported.map);
    assert.ok(local.green.some((rings) => inRings(rings, hole.green.x, hole.green.z)), `hole ${raw.number}`);
    assert.ok(local.fairway.length >= 1 && local.fairway.length < imported.map.fairway.length);
    const trees = holeTrees(hole, imported.trees);
    assert.ok(trees.length > 20 && trees.length < imported.trees.points.length / 3, `hole ${raw.number} trees`);
    assert.ok(trees.every((tree) => tree.z >= -140 && tree.r >= 2.5));
  }
});

test('canopy is the dark part of living vegetation and is packed with crowns', () => {
  assert.ok(otsu([...Array(50).fill(40), ...Array(50).fill(120)]) >= 40 && otsu([...Array(50).fill(40), ...Array(50).fill(120)]) < 120);
  // Pixels: tree, turf, tree, bare soil.
  assert.deepEqual([...canopyMask([40, 90, 45, 150], [60, 140, 62, 130], [35, 70, 40, 100], [150, 200, 160, 160])], [1, 0, 1, 0]);
  const width = 40, height = 30, mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (Math.hypot(x - 10, y - 15) <= 6 || (x === 30 && y === 5)) mask[y * width + x] = 1;
  }
  const trees = plantTrees(mask, width, height, 1.5, 4);
  assert.ok(trees.length >= 1 && trees.length <= 5);
  assert.deepEqual([trees[0].x, trees[0].y, trees[0].r], [10, 15, 4]);
  assert.ok(trees.every((tree) => Math.hypot(tree.x - 10, tree.y - 15) <= 6));
});

test('surface lookup names what lies under the ball, hazards first', () => {
  const box = (x0, z0, x1, z1) => [[[x0, z0], [x1, z0], [x1, z1], [x0, z1]]];
  const local = { water: [box(0, 0, 4, 4)], bunker: [box(10, 0, 14, 4)], green: [box(8, -2, 20, 6)], tee: [], fairway: [box(-5, -5, 30, 10)] };
  assert.equal(surfaceAt(local, 2, 2), 'water');
  assert.equal(surfaceAt(local, 12, 2), 'bunker');
  assert.equal(surfaceAt(local, 18, 2), 'green');
  assert.equal(surfaceAt(local, 25, 2), 'fairway');
  assert.equal(surfaceAt(local, 50, 50), 'rough');
  for (const raw of imported.holes) {
    const hole = holeWorld(raw, imported.elevation), map = holeMap(hole, imported.map);
    assert.equal(surfaceAt(map, hole.green.x, hole.green.z), 'green', `hole ${raw.number}`);
  }
});
