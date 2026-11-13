#!/usr/bin/env node
// Bake the real skyline around an already imported course from USGS 3DEP.
// Stores, per compass azimuth, the highest elevation angle seen in each distance band,
// so the renderer can draw the actual ridges behind every hole without runtime requests.
const fs = require('node:fs');
const path = require('node:path');
const { sampleElevation } = require('../public/course');
const { courseBounds, fetchTiff } = require('./import-elevation');

const OUT_DIR = path.join(__dirname, '..', 'public', 'courses');
const BANDS = [[1000, 8000], [8000, 40000], [40000, 150000]]; // metres from course centre
const EARTH_RADIUS = 6371000, REFRACTION = .13, EYE_HEIGHT = 1.7;

// sample(lon, lat) returns metres above sea level, or null outside coverage.
function horizonProfile(sample, [lon0, lat0], { step = .5, rays = 4, bands = BANDS } = {}) {
  const ground = sample(lon0, lat0);
  if (!Number.isFinite(ground)) throw new Error('No elevation at course centre');
  const eye = ground + EYE_HEIGHT;
  const metresEast = 111320 * Math.cos(lat0 * Math.PI / 180);
  const count = Math.round(360 / step);
  const angles = bands.map(() => new Array(count).fill(0));
  const start = bands[0][0], end = bands[bands.length - 1][1];
  for (let i = 0; i < count; i++) {
    // Several rays per bin so narrow peaks between azimuth samples are not missed.
    for (let ray = 0; ray < rays; ray++) {
      const azimuth = (i + (ray + .5) / rays - .5) * step * Math.PI / 180;
      const east = Math.sin(azimuth), north = Math.cos(azimuth);
      for (let d = start; d <= end; d += Math.max(30, d * .004)) {
        const height = sample(lon0 + d * east / metresEast, lat0 + d * north / 111320);
        if (!Number.isFinite(height)) continue;
        const drop = d * d * (1 - REFRACTION) / (2 * EARTH_RADIUS);
        const angle = Math.atan2(height - eye - drop, d) * 180 / Math.PI;
        const band = bands.findIndex(([from, to]) => d >= from && d <= to);
        if (angle > angles[band][i]) angles[band][i] = angle;
      }
    }
  }
  return { step, bands: bands.map(([from, to], b) => ({
    from, to, angles: angles[b].map((angle) => Math.round(angle * 100) / 100)
  })) };
}

function areaBounds([lon, lat], radius) {
  const lonPad = radius / (111320 * Math.cos(lat * Math.PI / 180)), latPad = radius / 111320;
  return [lon - lonPad, lat - latPad, lon + lonPad, lat + latPad];
}

async function fetchHorizon(course, fetchFn = fetch) {
  const [west, south, east, north] = courseBounds(course, 0);
  const centre = [(west + east) / 2, (south + north) / 2];
  // Fine grid for nearby hills, coarse grid for distant ranges.
  const grids = [];
  for (const radius of [BANDS[0][1] * 1.5, BANDS[BANDS.length - 1][1]]) {
    const bbox = areaBounds(centre, radius);
    const height = Math.round(1000 * (bbox[3] - bbox[1]) / (bbox[2] - bbox[0]));
    grids.push(await fetchTiff(bbox, 1000, height, fetchFn));
  }
  const sample = (lon, lat) => sampleElevation(grids[0], lon, lat) ?? sampleElevation(grids[1], lon, lat);
  return { source: 'USGS 3DEP', ...horizonProfile(sample, centre) };
}

if (require.main === module) {
  const handle = process.argv[2];
  if (!handle || !/^[a-z0-9_-]+$/i.test(handle)) {
    console.error('Usage: node scripts/import-horizon.js COURSE_HANDLE');
    process.exit(1);
  }
  const file = path.join(OUT_DIR, `${handle}.json`);
  const course = JSON.parse(fs.readFileSync(file, 'utf8'));
  fetchHorizon(course).then((horizon) => {
    course.horizon = horizon;
    fs.writeFileSync(file, JSON.stringify(course));
    const peak = Math.max(...horizon.bands.flatMap((band) => band.angles));
    console.log(`Imported USGS horizon for ${course.name}: highest skyline ${peak.toFixed(2)}°`);
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { horizonProfile, fetchHorizon };
