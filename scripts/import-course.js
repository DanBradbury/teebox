#!/usr/bin/env node
// Import a Golfeo BlueGolf export into Teebox's small, offline course catalog.
const fs = require('node:fs');
const path = require('node:path');

function convert(full, geo) {
  if (!Array.isArray(full.holes) || geo.type !== 'FeatureCollection' || !Array.isArray(geo.features)) {
    throw new Error('Expected BlueGolf full JSON and holes GeoJSON');
  }
  const holes = geo.features.map((feature) => {
    const number = Number(feature.properties?.hole_number);
    const source = full.holes[number - 1];
    const line = feature.geometry?.coordinates;
    if (!Number.isInteger(number) || number < 1 || !source || feature.geometry?.type !== 'LineString' ||
        !Array.isArray(line) || line.length < 2 || !line.every((p) => p.length >= 2 && p.slice(0, 2).every(Number.isFinite))) {
      throw new Error(`Invalid geometry for hole ${number}`);
    }
    return {
      number, par: source.par, handicap: source.handicap, distance: source.distance,
      line: line.map(([lon, lat]) => [lon, lat]),
      features: (source.features || []).filter((f) => Number.isFinite(f.centerlat ?? f.frontlat) &&
        Number.isFinite(f.centerlon ?? f.frontlon)).map((f) => ({
        type: f.type, coord: [f.centerlon ?? f.frontlon, f.centerlat ?? f.frontlat]
      }))
    };
  });
  holes.sort((a, b) => a.number - b.number);
  return { handle: full.handle, name: full.name, holes, tees: convertTees(full.tees) };
}

// One scorecard row per tee colour, longest first. BlueGolf lists men's and ladies' ratings as separate tees.
function convertTees(source = []) {
  const tees = [];
  for (const tee of source) {
    if (tee.isarchived || !Array.isArray(tee.holes) || !tee.holes.every((hole) => Number.isFinite(hole.distance))) continue;
    const rated = { par: tee.par, rating: Number(tee.rating), slope: tee.slope };
    let row = tees.find((item) => item.name === tee.name);
    if (!row) {
      const distances = tee.holes.map((hole) => hole.distance);
      row = { name: tee.name, color: tee.color, yards: distances.reduce((sum, d) => sum + d, 0), distances };
      tees.push(row);
    }
    if (tee.type === 'LADY') row.ladies = rated; else Object.assign(row, rated);
  }
  return tees.sort((a, b) => b.yards - a.yards);
}

if (require.main === module) {
  const [fullPath, geoPath] = process.argv.slice(2);
  if (!fullPath || !geoPath) {
    console.error('Usage: node scripts/import-course.js COURSE_full.json COURSE_holes.geojson');
    process.exit(1);
  }
  const course = convert(JSON.parse(fs.readFileSync(fullPath)), JSON.parse(fs.readFileSync(geoPath)));
  if (!/^[a-z0-9_-]+$/i.test(course.handle)) throw new Error('Invalid course handle');
  const dir = path.join(__dirname, '..', 'public', 'courses');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${course.handle}.json`), JSON.stringify(course));
  const catalogPath = path.join(dir, 'index.json');
  const catalog = fs.existsSync(catalogPath) ? JSON.parse(fs.readFileSync(catalogPath)) : [];
  const next = catalog.filter((entry) => entry.handle !== course.handle);
  // Keep hand-written catalog details (location, architect); refresh the headline numbers from the longest tee.
  const back = course.tees[0];
  next.push({ ...catalog.find((entry) => entry.handle === course.handle), handle: course.handle, name: course.name,
    holes: course.holes.length,
    ...(back && { par: back.par, yards: back.yards, rating: back.rating, slope: back.slope }) });
  next.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(catalogPath, JSON.stringify(next));
  console.log(`Imported ${course.name}: ${course.holes.length} holes`);
}

module.exports = { convert, convertTees };
