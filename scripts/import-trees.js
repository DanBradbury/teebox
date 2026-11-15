#!/usr/bin/env node
// Find the real trees on an already imported course in USGS NAIP aerial imagery.
// Tree canopy is leafy (bright in near-infrared, dark in red) but darker than turf; each patch of it
// is packed with round crowns, so the renderer can stand a tree wherever one actually grows.
const fs = require('node:fs');
const path = require('node:path');
const { mapCoords, inRings } = require('../public/course');
const { courseBounds, fetchTiff } = require('./import-elevation');

const NAIP = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage';
const OUT_DIR = path.join(__dirname, '..', 'public', 'courses');
const REACH = 150;                    // metres past the holes to look for trees
const MIN_CROWN = 2.5, MAX_CROWN = 8; // crown radius, metres
const OPEN = ['fairway', 'green', 'bunker', 'tee', 'water'];   // mapped surfaces no trunk stands on

// Otsu's threshold: the cut that best separates a two-peaked histogram of whole numbers 0–255.
function otsu(values) {
  const hist = new Array(256).fill(0);
  for (const value of values) hist[Math.max(0, Math.min(255, Math.round(value)))]++;
  const total = values.length, sum = hist.reduce((acc, n, i) => acc + n * i, 0);
  let below = 0, sumBelow = 0, best = 0, cut = 0;
  for (let i = 0; i < 256; i++) {
    below += hist[i]; sumBelow += hist[i] * i;
    if (!below || below === total) continue;
    const gap = sumBelow / below - (sum - sumBelow) / (total - below);
    const spread = below * (total - below) * gap * gap;
    if (spread > best) { best = spread; cut = i; }
  }
  return cut;
}

// 1 where a pixel is tree canopy. Bands are flat arrays of 0–255 reflectance.
function canopyMask(red, green, blue, nir) {
  const count = red.length, leafy = [], bright = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    bright[i] = (red[i] + green[i] + blue[i]) / 3;
    if ((nir[i] - red[i]) / (nir[i] + red[i] + 1e-6) > .25) leafy.push(i);
  }
  // Among living vegetation, crowns shade themselves and read darker than grass.
  const cut = otsu(leafy.map((i) => bright[i]));
  const mask = new Uint8Array(count);
  for (const i of leafy) if (bright[i] <= cut) mask[i] = 1;
  return mask;
}

// Pack a canopy mask with round crowns, largest first. Returns [{ x, y, r }] in pixels.
// `minR` drops specks; crowns wider than `maxR` are split into several trees.
function plantTrees(mask, width, height, minR, maxR) {
  // Chamfer distance from each canopy pixel to the nearest open ground.
  const depth = new Float32Array(width * height), FAR = 1e9, DIAG = Math.SQRT2;
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : depth[y * width + x]);
  for (let i = 0; i < depth.length; i++) depth[i] = mask[i] ? FAR : 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (depth[i]) depth[i] = Math.min(depth[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + DIAG, at(x + 1, y - 1) + DIAG);
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x;
    if (depth[i]) depth[i] = Math.min(depth[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + DIAG, at(x - 1, y + 1) + DIAG);
  }
  const order = [];
  for (let i = 0; i < depth.length; i++) if (depth[i] >= minR) order.push(i);
  order.sort((a, b) => depth[b] - depth[a] || a - b);
  const taken = new Uint8Array(width * height), trees = [];
  for (const i of order) {
    if (taken[i]) continue;
    const x = i % width, y = Math.floor(i / width), r = Math.min(depth[i], maxR);
    trees.push({ x, y, r });
    // Neighbouring crowns overlap a little, as they do in a real stand.
    const claim = Math.ceil(r * 1.5);
    for (let dy = -claim; dy <= claim; dy++) for (let dx = -claim; dx <= claim; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && dx * dx + dy * dy <= r * r * 2.25) taken[ny * width + nx] = 1;
    }
  }
  return trees;
}

// Shortest distance in metres from a point to any hole's mapped line.
function metresToHoles(course, [lon, lat]) {
  const metresEast = 111320 * Math.cos(lat * Math.PI / 180);
  let best = Infinity;
  for (const hole of course.holes) {
    for (let i = 1; i < hole.line.length; i++) {
      const ax = (hole.line[i - 1][0] - lon) * metresEast, ay = (hole.line[i - 1][1] - lat) * 111320;
      const bx = (hole.line[i][0] - lon) * metresEast, by = (hole.line[i][1] - lat) * 111320;
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(ax + dx * t, ay + dy * t));
    }
  }
  return best;
}

async function fetchTrees(course, fetchFn = fetch) {
  const bbox = courseBounds(course, REACH);
  const metresEast = 111320 * Math.cos((bbox[1] + bbox[3]) / 2 * Math.PI / 180);
  const spanEast = (bbox[2] - bbox[0]) * metresEast, spanNorth = (bbox[3] - bbox[1]) * 111320;
  const pixel = Math.max(2, Math.max(spanEast, spanNorth) / 1000);   // metres
  const width = Math.ceil(spanEast / pixel), height = Math.ceil(spanNorth / pixel);
  const bands = [];
  for (const band of [0, 1, 2, 3]) bands.push(await fetchTiff(bbox, width, height, fetchFn, NAIP, { bandIds: band }));
  const grid = bands[0];
  if (bands.some((band) => band.values.length !== grid.values.length)) throw new Error('NAIP bands differ in size');
  if (grid.values.filter((value) => value > 0).length < grid.values.length * .9) {
    throw new Error('NAIP imagery coverage incomplete for this course');
  }
  const mask = canopyMask(...bands.map((band) => band.values.map((value) => value ?? 0)));
  const open = OPEN.flatMap((layer) => course.map?.[layer] || []).map((rings) => rings.map((ring) => mapCoords(course.map.origin, ring)));
  const origin = [Math.floor(bbox[0] * 1e6) / 1e6, Math.floor(bbox[1] * 1e6) / 1e6], points = [];
  for (const tree of plantTrees(mask, grid.width, grid.height, MIN_CROWN / pixel, MAX_CROWN / pixel)) {
    const lon = grid.west + tree.x * grid.lonStep, lat = grid.north - tree.y * grid.latStep;
    if (metresToHoles(course, [lon, lat]) > REACH || open.some((rings) => inRings(rings, lon, lat))) continue;
    points.push(Math.round((lon - origin[0]) * 1e6), Math.round((lat - origin[1]) * 1e6), Math.round(tree.r * pixel * 10));
  }
  return { source: 'USGS NAIP', origin, points };
}

if (require.main === module) {
  const handle = process.argv[2];
  if (!handle || !/^[a-z0-9_-]+$/i.test(handle)) {
    console.error('Usage: node scripts/import-trees.js COURSE_HANDLE');
    process.exit(1);
  }
  const file = path.join(OUT_DIR, `${handle}.json`);
  const course = JSON.parse(fs.readFileSync(file, 'utf8'));
  fetchTrees(course).then((trees) => {
    course.trees = trees;
    fs.writeFileSync(file, JSON.stringify(course));
    console.log(`Imported ${trees.points.length / 3} trees from USGS NAIP imagery for ${course.name}` +
      (course.map ? '' : ' (run import-map.js first to keep them off fairways and greens)'));
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { otsu, canopyMask, plantTrees, metresToHoles, fetchTrees };
