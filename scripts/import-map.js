#!/usr/bin/env node
// Bake the real outlines of an already imported course from OpenStreetMap:
// fairways, greens, bunkers, tees, water and woods as polygons, cart paths as lines.
// Map data © OpenStreetMap contributors, available under the Open Database License.
const fs = require('node:fs');
const path = require('node:path');
const { courseBounds } = require('./import-elevation');

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const OUT_DIR = path.join(__dirname, '..', 'public', 'courses');
const AREAS = ['fairway', 'green', 'bunker', 'tee', 'water', 'wood'];

// Which layer an OSM element belongs to, or null if Teebox does not draw it.
function layerOf(tags = {}) {
  if (['fairway', 'driving_range'].includes(tags.golf)) return 'fairway';
  if (['green', 'bunker', 'tee'].includes(tags.golf)) return tags.golf;
  if (['water_hazard', 'lateral_water_hazard'].includes(tags.golf) || tags.natural === 'water') return 'water';
  if (tags.natural === 'wood' || tags.landuse === 'forest') return 'wood';
  if (['cartpath', 'path'].includes(tags.golf)) return 'path';
  return null;
}

const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const last = (list) => list[list.length - 1];

// Join a multipolygon's member ways end to end into closed rings. Ways that never close are dropped.
function stitch(ways) {
  const rings = [], open = ways.filter((way) => way.length > 1).map((way) => way.slice());
  while (open.length) {
    let ring = open.pop();
    for (let grew = true; grew && !same(ring[0], last(ring));) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const way = open[i];
        if (same(way[0], last(ring))) ring = ring.concat(way.slice(1));
        else if (same(last(way), last(ring))) ring = ring.concat(way.slice(0, -1).reverse());
        else if (same(last(way), ring[0])) ring = way.concat(ring.slice(1));
        else if (same(way[0], ring[0])) ring = way.slice(1).reverse().concat(ring);
        else continue;
        open.splice(i, 1); grew = true; break;
      }
    }
    if (ring.length >= 4 && same(ring[0], last(ring))) rings.push(ring);
  }
  return rings;
}

// Sutherland–Hodgman clip of a closed ring to [west, south, east, north]. Returns an unclosed ring.
function clipRing(ring, [west, south, east, north]) {
  let points = same(ring[0], last(ring)) ? ring.slice(0, -1) : ring.slice();
  const edges = [[0, west, 1], [0, east, -1], [1, south, 1], [1, north, -1]];
  for (const [axis, limit, sign] of edges) {
    const inside = (p) => (p[axis] - limit) * sign >= 0, out = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if (inside(a)) out.push(a);
      if (inside(a) !== inside(b)) {
        const t = (limit - a[axis]) / (b[axis] - a[axis]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    points = out;
  }
  return points;
}

function inRing(ring, [x, y]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// Overpass JSON (`out geom`) to Teebox's map layers, clipped to bbox [west, south, east, north].
// Rings are stored flat, in whole millionths of a degree east and north of the bbox's south-west corner.
function convert(osm, bbox) {
  const origin = [Math.floor(bbox[0] * 1e6) / 1e6, Math.floor(bbox[1] * 1e6) / 1e6];
  const flat = (points) => {
    const out = [];
    for (const [lon, lat] of points) {
      const x = Math.round((lon - origin[0]) * 1e6), y = Math.round((lat - origin[1]) * 1e6);
      if (out.length < 2 || out[out.length - 2] !== x || out[out.length - 1] !== y) out.push(x, y);
    }
    // A ring's rounded end can land back on its start.
    if (out.length > 2 && out[0] === out[out.length - 2] && out[1] === out[out.length - 1]) out.length -= 2;
    return out;
  };
  const coords = (geometry) => (geometry || []).filter(Boolean).map((p) => [p.lon, p.lat]);
  const map = { source: 'OpenStreetMap contributors', origin, path: [] };
  for (const layer of AREAS) map[layer] = [];
  for (const element of osm.elements || []) {
    const layer = layerOf(element.tags);
    if (!layer) continue;
    if (layer === 'path') {
      if (element.type !== 'way') continue;
      // Split the path wherever it leaves the bbox.
      let run = [];
      for (const point of [...coords(element.geometry), null]) {
        if (point && point[0] >= bbox[0] && point[0] <= bbox[2] && point[1] >= bbox[1] && point[1] <= bbox[3]) { run.push(point); continue; }
        if (run.length > 1) map.path.push(flat(run));
        run = [];
      }
      continue;
    }
    let outers = [], inners = [];
    if (element.type === 'way') {
      const ring = coords(element.geometry);
      if (ring.length >= 4 && same(ring[0], last(ring))) outers = [ring];
    } else if (element.type === 'relation') {
      const role = (name) => stitch(element.members.filter((m) => m.type === 'way' && (m.role || 'outer') === name).map((m) => coords(m.geometry)));
      outers = role('outer'); inners = role('inner');
    }
    for (const outer of outers) {
      const rings = [outer, ...inners.filter((inner) => inRing(outer, inner[0]))]
        .map((ring) => flat(clipRing(ring, bbox))).filter((ring) => ring.length >= 6);
      // An outer ring wholly outside the bbox clips away to nothing; its holes go with it.
      if (clipRing(outer, bbox).length >= 3 && rings.length) map[layer].push(rings);
    }
  }
  return map;
}

async function fetchMap(course, fetchFn = fetch) {
  const bbox = courseBounds(course, 250);
  const box = `(${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]})`;
  const query = `[out:json][timeout:60];(way["golf"]${box};relation["golf"]${box};` +
    `way["natural"~"^(water|wood)$"]${box};relation["natural"~"^(water|wood)$"]${box};` +
    `way["landuse"="forest"]${box};relation["landuse"="forest"]${box};);out geom;`;
  const response = await fetchFn(OVERPASS, { method: 'POST', signal: AbortSignal.timeout(90000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'teebox-course-import' },
    body: `data=${encodeURIComponent(query)}` });
  if (!response.ok) throw new Error(`OpenStreetMap request failed: HTTP ${response.status}`);
  const map = convert(await response.json(), bbox);
  if (!map.fairway.length && !map.green.length) throw new Error('OpenStreetMap has no fairways or greens mapped for this course');
  return map;
}

if (require.main === module) {
  const handle = process.argv[2];
  if (!handle || !/^[a-z0-9_-]+$/i.test(handle)) {
    console.error('Usage: node scripts/import-map.js COURSE_HANDLE');
    process.exit(1);
  }
  const file = path.join(OUT_DIR, `${handle}.json`);
  const course = JSON.parse(fs.readFileSync(file, 'utf8'));
  fetchMap(course).then((map) => {
    course.map = map;
    fs.writeFileSync(file, JSON.stringify(course));
    console.log(`Imported OpenStreetMap outlines for ${course.name}: ` +
      [...AREAS, 'path'].map((layer) => `${map[layer].length} ${layer}`).join(', '));
  }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { layerOf, stitch, clipRing, convert, fetchMap };
