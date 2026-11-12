#!/usr/bin/env node
// Download a small USGS 3DEP height grid for an already imported course.
// No runtime dependency: USGS exportImage returns an uncompressed float GeoTIFF.
const fs = require('node:fs');
const path = require('node:path');

const SERVICE = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';
const OUT_DIR = path.join(__dirname, '..', 'public', 'courses');

function tiffGrid(buffer) {
  if (buffer.toString('ascii', 0, 2) !== 'II' || buffer.readUInt16LE(2) !== 42) {
    throw new Error('USGS did not return a little-endian TIFF');
  }
  const ifd = buffer.readUInt32LE(4), count = buffer.readUInt16LE(ifd);
  const tags = new Map();
  const bytes = { 2: 1, 3: 2, 4: 4, 11: 4, 12: 8 };
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    const tag = buffer.readUInt16LE(entry), type = buffer.readUInt16LE(entry + 2);
    const n = buffer.readUInt32LE(entry + 4), size = bytes[type];
    if (!size) continue;
    const at = n * size <= 4 ? entry + 8 : buffer.readUInt32LE(entry + 8);
    const values = [];
    for (let j = 0; j < n; j++) {
      const offset = at + j * size;
      values.push(type === 3 ? buffer.readUInt16LE(offset) : type === 4 ? buffer.readUInt32LE(offset) :
        type === 11 ? buffer.readFloatLE(offset) : type === 12 ? buffer.readDoubleLE(offset) : buffer.readUInt8(offset));
    }
    tags.set(tag, values);
  }
  const one = (tag) => tags.get(tag)?.[0];
  const width = one(256), height = one(257), tileW = one(322), tileH = one(323);
  const offsets = tags.get(324), lengths = tags.get(325);
  const scale = tags.get(33550), tie = tags.get(33922);
  const noData = tags.has(42113) ? Number(String.fromCharCode(...tags.get(42113)).replace(/\0/g, '')) : null;
  if (one(258) !== 32 || one(259) !== 1 || one(277) !== 1 || one(339) !== 3 ||
      !tileW || !tileH || !offsets || !lengths || !scale || !tie) {
    throw new Error('Expected uncompressed, tiled, single-band float32 GeoTIFF');
  }
  const values = [];
  const across = Math.ceil(width / tileW);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = Math.floor(y / tileH) * across + Math.floor(x / tileW);
      const byte = offsets[tile] + ((y % tileH) * tileW + x % tileW) * 4;
      if (byte + 4 > offsets[tile] + lengths[tile]) throw new Error('Truncated TIFF tile');
      const elevation = buffer.readFloatLE(byte);
      values.push(Number.isFinite(elevation) && Math.abs(elevation) < 10000 && elevation !== noData
        ? Math.round(elevation * 100) / 100 : null);
    }
  }
  // GeoTIFF tie point identifies upper-left pixel corner; grid stores pixel centres.
  return {
    width, height, west: tie[3] + scale[0] / 2, north: tie[4] - scale[1] / 2,
    lonStep: scale[0], latStep: scale[1], values
  };
}

function courseBounds(course, paddingMetres = 90) {
  const coords = course.holes.flatMap((hole) => [...hole.line, ...hole.features.map((f) => f.coord)]);
  if (!coords.length) throw new Error('Course has no coordinates');
  const west = Math.min(...coords.map((p) => p[0])), east = Math.max(...coords.map((p) => p[0]));
  const south = Math.min(...coords.map((p) => p[1])), north = Math.max(...coords.map((p) => p[1]));
  const latMid = (south + north) / 2;
  const lonPad = paddingMetres / (111320 * Math.cos(latMid * Math.PI / 180));
  const latPad = paddingMetres / 111320;
  return [west - lonPad, south - latPad, east + lonPad, north + latPad];
}

async function fetchGrid(course, fetchFn = fetch) {
  const bbox = courseBounds(course);
  const metresEast = 111320 * Math.cos((bbox[1] + bbox[3]) / 2 * Math.PI / 180);
  const width = Math.ceil((bbox[2] - bbox[0]) * metresEast / 4);
  const height = Math.ceil((bbox[3] - bbox[1]) * 111320 / 4);
  if (width > 1000 || height > 1000) throw new Error('Course bounds too large for one grid');
  const url = new URL(SERVICE);
  url.search = new URLSearchParams({ bbox: bbox.join(','), bboxSR: '4326', imageSR: '4326',
    size: `${width},${height}`, format: 'tiff', pixelType: 'F32', f: 'image' }).toString();
  const response = await fetchFn(url, { signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`USGS elevation request failed: HTTP ${response.status}`);
  const grid = tiffGrid(Buffer.from(await response.arrayBuffer()));
  if (grid.values.filter(Number.isFinite).length < grid.values.length * .9) {
    throw new Error('Elevation coverage incomplete for this course');
  }
  return { source: 'USGS 3DEP', ...grid };
}

if (require.main === module) {
  const handle = process.argv[2];
  if (!handle || !/^[a-z0-9_-]+$/i.test(handle)) {
    console.error('Usage: node scripts/import-elevation.js COURSE_HANDLE');
    process.exit(1);
  }
  const file = path.join(OUT_DIR, `${handle}.json`);
  const course = JSON.parse(fs.readFileSync(file, 'utf8'));
  fetchGrid(course).then((elevation) => {
    course.elevation = elevation;
    fs.writeFileSync(file, JSON.stringify(course));
    console.log(`Imported ${elevation.width} × ${elevation.height} USGS elevation grid for ${course.name}`);
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { tiffGrid, courseBounds, fetchGrid };
