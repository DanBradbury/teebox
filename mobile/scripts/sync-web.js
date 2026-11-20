// Copies the browser game (../public) into www/ and injects the iOS overlay.
// Run via `npm run sync`; www/ is generated, never edit it.
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'public');
const OVERLAY = path.join(__dirname, '..', 'mobile-src');
const OUT = path.join(__dirname, '..', 'www');
const SKIP = new Set(['courses.html']); // course importer page needs the desktop server

function patchIndex(html) {
  const meta = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">';
  if (!/<meta name="viewport"[^>]*>/.test(html)) throw new Error('index.html: viewport meta not found');
  html = html.replace(/<meta name="viewport"[^>]*>/, meta);
  html = html.replace('<link rel="stylesheet" href="game.css">', '<link rel="stylesheet" href="game.css">\n<link rel="stylesheet" href="mobile.css">');
  if (!html.includes('mobile.css')) throw new Error('index.html: game.css link not found');
  html = html.replace('<script src="game.js"></script>', '<script src="game.js"></script>\n<script src="aim-preview.js"></script>\n<script src="shot-mode.js"></script>\n<script src="mobile.js"></script>');
  if (!html.includes('mobile.js')) throw new Error('index.html: game.js script not found');
  return html;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true, filter: (file) => !SKIP.has(path.basename(file)) });
for (const file of fs.readdirSync(OVERLAY)) fs.copyFileSync(path.join(OVERLAY, file), path.join(OUT, file));
const index = path.join(OUT, 'index.html');
fs.writeFileSync(index, patchIndex(fs.readFileSync(index, 'utf8')));
console.log(`Synced ${SRC} -> ${OUT}`);
// Touch wording for strings the browser build words for a mouse.
const WORDING = [['Hold mouse, pull down the dotted path, then swing back up through the ball.', 'Touch the pad, pull down the dotted path, then swing back up through the ball.'], ["'Mouse'", "'Touch'"], ['>Mouse<', '>Touch<']];
for (const name of ['game.js', 'index.html']) {
  const file = path.join(OUT, name);
  let text = fs.readFileSync(file, 'utf8');
  for (const [from, to] of WORDING) text = text.split(from).join(to);
  fs.writeFileSync(file, text);
}
module.exports = { patchIndex };
