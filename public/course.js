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
    const heightAt = (x, z) => {
      if (!elevation || teeHeight === null) return 0;
      const east = x * forward[1] + z * forward[0];
      const north = -x * forward[0] + z * forward[1];
      const elevationHere = sampleElevation(elevation, lon0 + east / metresEast, lat0 + north / 111320);
      return elevationHere === null ? 0 : elevationHere - teeHeight;
    };
    // Compass bearing of tee → green, degrees clockwise from north.
    const bearing = Math.atan2(forward[0], forward[1]) * 180 / Math.PI;
    return { ...hole, centerline, features, green, heightAt, bearing,
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
  return { holeWorld, sampleElevation, horizonAngle, teeLine };
})();
if (typeof module !== 'undefined') module.exports = CourseGeometry;
