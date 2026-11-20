const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
require('../scripts/sync-web.js');

const www = path.join(__dirname, '..', 'www');

test('index.html gets the iOS overlay', () => {
  const html = fs.readFileSync(path.join(www, 'index.html'), 'utf8');
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /mobile\.css/);
  assert.match(html, /aim-preview\.js/);
  assert.match(html, /shot-mode\.js/);
  assert.match(html, /mobile\.js/);
});

test('desktop-only pages are not bundled', () => {
  assert.ok(!fs.existsSync(path.join(www, 'courses.html')));
  assert.ok(fs.existsSync(path.join(www, 'courses', 'index.json')));
});
