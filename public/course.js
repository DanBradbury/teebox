// GeoJSON longitude/latitude to Teebox world coordinates: metres right/downrange from tee.
const CourseGeometry = (() => {
  function sampleElevation(grid, lon, lat) {
    if (!grid) return 0;
    const gx = (lon - grid.west) / grid.lonStep;
    const gy = (grid.north - lat) / grid.latStep;
    if (gx < 0 || gy < 0 || gx > grid.width - 1 || gy > grid.height - 1) return null;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const x1 = Math.min(x0 + 1, grid.width - 1), y1 = Math.min(y0 + 1, grid.height - 1);
    const a = gx - x0, b = gy - y0;
    const at = (x, y) => grid.values[y * grid.width + x];
    const corners = [at(x0, y0), at(x1, y0), at(x0, y1), at(x1, y1)];
    if (!corners.every(Number.isFinite)) return null;
    return (corners[0] * (1 - a) + corners[1] * a) * (1 - b) +
      (corners[2] * (1 - a) + corners[3] * a) * b;
  }
  function holeWorld(hole, elevation = null) {
    const line = hole.line;
    const [lon0, lat0] = line[0];
    const metresEast = 111320 * Math.cos(lat0 * Math.PI / 180);
    const local = ([lon, lat]) => [(lon - lon0) * metresEast, (lat - lat0) * 111320];
    const end = local(line[line.length - 1]);
    const length = Math.hypot(...end);
    if (length < 10) throw new Error('Hole tee and green must differ');
    const forward = [end[0] / length, end[1] / length];
    const point = (coord) => {
      const [east, north] = local(coord);
      return { x: east * forward[1] - north * forward[0], z: east * forward[0] + north * forward[1] };
    };
    const centerline = line.map(point);
    const features = hole.features.map((feature) => ({ ...feature, ...point(feature.coord) }));
    const green = features.find((feature) => feature.type === 'green') || centerline[centerline.length - 1];
    const teeHeight = sampleElevation(elevation, lon0, lat0);
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    const heightAt = (x, z) => {
      if (!elevation || teeHeight === null) return 0;
      const east = x * forward[1] + z * forward[0];
      const north = -x * forward[0] + z * forward[1];
      // Past the grid's edge the ground carries on level from the nearest sample.
      const lon = clamp(lon0 + east / metresEast, elevation.west, elevation.west + (elevation.width - 1) * elevation.lonStep);
      const lat = clamp(lat0 + north / 111320, elevation.north - (elevation.height - 1) * elevation.latStep, elevation.north);
      const elevationHere = sampleElevation(elevation, lon, lat);
      return elevationHere === null ? 0 : elevationHere - teeHeight;
    };
    // Compass bearing of tee → green, degrees clockwise from north.
    const bearing = Math.atan2(forward[0], forward[1]) * 180 / Math.PI;
    return { ...hole, centerline, features, green, heightAt, bearing, toWorld: point,
      elevationSource: elevation?.source || null, teeElevation: teeHeight,
      greenRise: heightAt(green.x, green.z) };
  }
  // Forward tees are not mapped, so stand in for one by starting `cut` metres down the mapped centerline.
  function teeLine(line, cut) {
    const metresEast = 111320 * Math.cos(line[0][1] * Math.PI / 180);
    const span = (a, b) => Math.hypot((b[0] - a[0]) * metresEast, (b[1] - a[1]) * 111320);
    const total = line.slice(1).reduce((sum, p, i) => sum + span(line[i], p), 0);
    let left = Math.max(0, Math.min(cut, total - 20));
    for (let i = 1; i < line.length; i++) {
      const length = span(line[i - 1], line[i]);
      if (left < length || i === line.length - 1) {
        const t = left / length;
        const start = [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t];
        return [start, ...line.slice(i)];
      }
      left -= length;
    }
    return line;
  }
  // Baked skyline: elevation angle (degrees) of one distance band at a compass azimuth.
  function horizonAngle(horizon, band, azimuth) {
    const n = band.angles.length;
    const at = (((azimuth % 360) + 360) % 360) / horizon.step;
    const i = Math.floor(at) % n, t = at - Math.floor(at);
    return band.angles[i] * (1 - t) + band.angles[(i + 1) % n] * t;
  }
  // Baked map shapes store each ring as a flat list of whole millionths of a degree east and north of `origin`.
  function mapCoords(origin, flat) {
    const coords = [];
    for (let i = 0; i < flat.length; i += 2) coords.push([origin[0] + flat[i] / 1e6, origin[1] + flat[i + 1] / 1e6]);
    return coords;
  }
  // Even-odd test of a point against polygon rings of [x, y] pairs.
  function inRings(rings, x, y) {
    let inside = false;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j];
        if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
      }
    }
    return inside;
  }
  const MAP_AREAS = ['fairway', 'green', 'bunker', 'tee', 'water', 'wood'];
  // Hole-frame box [left, right, near, far] that takes in the centerline plus `reach` metres all round.
  function holeBox(hole, reach) {
    const xs = hole.centerline.map((p) => p.x), zs = hole.centerline.map((p) => p.z);
    return [Math.min(...xs) - reach, Math.max(...xs) + reach, Math.min(...zs) - reach, Math.max(...zs) + reach];
  }
  // Mapped surfaces (scripts/import-map.js) around a hole, in its frame: polygons as rings of [x, z], cart paths as lines.
  // Neighbouring holes inside the box come along, as they are in view from this one.
  function holeMap(hole, map, reach = 140) {
    const [left, right, near, far] = holeBox(hole, reach);
    const local = (flat) => mapCoords(map.origin, flat).map((coord) => { const p = hole.toWorld(coord); return [p.x, p.z]; });
    const inBox = ([x, z]) => x >= left && x <= right && z >= near && z <= far;
    const overlaps = (ring) => {
      const xs = ring.map((p) => p[0]), zs = ring.map((p) => p[1]);
      return Math.max(...xs) >= left && Math.min(...xs) <= right && Math.max(...zs) >= near && Math.min(...zs) <= far;
    };
    const out = {};
    for (const kind of MAP_AREAS) out[kind] = (map[kind] || []).map((rings) => rings.map(local)).filter((rings) => overlaps(rings[0]));
    out.path = [];
    for (const line of (map.path || []).map(local)) {
      // Keep only the stretches of each path that pass through the box.
      let run = [];
      for (let i = 0; i < line.length; i++) {
        if (inBox(line[i]) || (i && inBox(line[i - 1])) || (i < line.length - 1 && inBox(line[i + 1]))) run.push(line[i]);
        else { if (run.length > 1) out.path.push(run); run = []; }
      }
      if (run.length > 1) out.path.push(run);
    }
    return out;
  }
  // Trees found in aerial imagery (scripts/import-trees.js) around a hole: position and crown radius, metres.
  // `trees.points` is a flat list of [east, north, radius] in millionths of a degree from `origin` and decimetres.
  function holeTrees(hole, trees, reach = 140) {
    const [left, right, near, far] = holeBox(hole, reach), out = [];
    for (let i = 0; i < trees.points.length; i += 3) {
      const { x, z } = hole.toWorld([trees.origin[0] + trees.points[i] / 1e6, trees.origin[1] + trees.points[i + 1] / 1e6]);
      if (x >= left && x <= right && z >= near && z <= far) out.push({ x, z, r: trees.points[i + 2] / 10 });
    }
    return out;
  }
  // Which mapped surface a point of a hole map lies on. Hazards win over the turf around them; unmapped ground is rough.
  function surfaceAt(local, x, z) {
    for (const kind of ['water', 'bunker', 'green', 'tee', 'fairway']) {
      if (local[kind].some((rings) => inRings(rings, x, z))) return kind;
    }
    return 'rough';
  }
  return { holeWorld, sampleElevation, horizonAngle, teeLine, mapCoords, inRings, holeMap, holeTrees, surfaceAt, MAP_AREAS };
})();
if (typeof module !== 'undefined') module.exports = CourseGeometry;
