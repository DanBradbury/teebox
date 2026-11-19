// Deterministic mouse swing model shared by the game UI and tests.
(function (root) {
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  function begin(x, y) { return { x, y, depth: 0, lastY: y, error: 0, returnDistance: 0 }; }
  function move(s, x, y) {
    s.depth = Math.max(s.depth, y - s.y);
    s.lastY = y;
    s.error = x - s.x;
    s.returnDistance = s.depth - (y - s.y);
    return s;
  }
  function finish(s, club, clubs) {
    if (!s || s.depth < 12 || s.returnDistance < s.depth * .7) return null;
    const power = clamp(s.depth / 140, .08, 1);
    const error = clamp(s.error / 70, -1, 1);
    const c = clubs[club];
    if (!c) return null;
    const backspin = c[2] * Math.sqrt(power), sidespin = error * 1800 * power;
    return { speed: c[0] * power * (1 - Math.abs(error) * .12), vla: c[1],
      hla: error * 9, backspin, sidespin, total: Math.hypot(backspin, sidespin),
      axis: Math.atan2(sidespin, backspin) * 180 / Math.PI, club, source: 'game', power, error };
  }
  const api = { begin, move, finish };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GolfSwing = api;
})(typeof window !== 'undefined' ? window : globalThis);
