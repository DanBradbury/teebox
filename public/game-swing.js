// Deterministic mouse and controller swing models shared by the game UI and tests.
(function (root) {
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  function strike(power, error, club, clubs) {
    const c = clubs[club];
    if (!c) return null;
    const backspin = c[2] * Math.sqrt(power), sidespin = error * 1800 * power;
    return { speed: c[0] * power * (1 - Math.abs(error) * .12), vla: c[1],
      hla: error * 9, backspin, sidespin, total: Math.hypot(backspin, sidespin),
      axis: Math.atan2(sidespin, backspin) * 180 / Math.PI, club, source: 'game', power, error };
  }
  function begin(x, y) { return { x, y, depth: 0, lastY: y, error: 0, returnDistance: 0 }; }
  function move(s, x, y) {
    s.depth = Math.max(s.depth, y - s.y);
    s.lastY = y;
    s.error = x - s.x;
    s.returnDistance = s.depth - (y - s.y);
    return s;
  }
  // The hitting zone is a band on the address line. After a real backswing, coming back up into it strikes the ball,
  // so the shot fires as the finger crosses rather than on release. Sideways drift at that moment sets the miss.
  const ZONE = 12, MIN_BACK = 24;
  const struck = (s) => !!s && s.depth >= MIN_BACK && s.lastY - s.y <= ZONE;
  function finish(s, club, clubs) {
    if (!struck(s)) return null;
    return strike(clamp(s.depth / 140, .08, 1), clamp(s.error / 70, -1, 1), club, clubs);
  }
  // Placeholder shot feedback from strike quality; tiers will grow as the swing model does.
  function grade(shot) {
    const miss = Math.abs(shot.error) + (shot.tempo !== undefined ? 1 - shot.tempo : 0);
    if (miss < .05) return { tier: 'perfect', label: 'Perfect!' };
    if (miss < .15) return { tier: 'great', label: 'Great shot!' };
    if (miss < .35) return { tier: 'good', label: 'Nice' };
    return { tier: 'miss', label: shot.error < 0 ? 'Pulled' : 'Pushed' };
  }

  // Analog stick swing: pull the stick back (down), then push it forward (up) through the ball.
  // The strike fires as soon as the stick passes the forward line, so there is no button to release.
  // Backswing depth sets power, sideways drift on the way through sets the miss, and a slow
  // downswing (or one that pauses at the top) loses clubhead speed. Axes follow the Gamepad API: down is +y.
  const STICK = { dead: .2, top: .3, turn: .25, strike: .6, full: .95, idle: 250, tempo: 250, line: .06, miss: .3 };
  function stickBegin() { return { phase: 'ready', x: 0, y: 0, depth: 0, sumX: 0, n: 0, downAt: 0, restAt: null, struckAt: 0 }; }
  function stickMove(s, x, y, t) {
    s.x = x; s.y = y;
    const rest = Math.hypot(x, y) < STICK.dead;
    if (s.phase === 'ready') {
      if (y <= STICK.dead) return s;
      s.phase = 'back';
    }
    if (s.phase === 'back') {
      s.depth = Math.max(s.depth, y);
      if (s.depth >= STICK.top && y < s.depth - STICK.turn) { s.phase = 'down'; s.downAt = t; }
      else { if (rest) Object.assign(s, stickBegin(), { x, y }); return s; }
    }
    if (s.phase === 'down') {
      if (!rest) { s.sumX += x; s.n++; }
      if (y <= -STICK.strike) { s.phase = 'struck'; s.struckAt = t; }
      else if (!rest) s.restAt = null;
      else if (s.restAt === null) s.restAt = t;
      else if (t - s.restAt >= STICK.idle) s.phase = 'cancelled';
    }
    return s;
  }
  function stickFinish(s, club, clubs) {
    if (!s || s.phase !== 'struck') return null;
    const tempo = clamp(1 - (s.struckAt - s.downAt - STICK.tempo) / 1600, .75, 1);
    const drift = s.n ? s.sumX / s.n : 0;
    const error = clamp(Math.sign(drift) * Math.max(0, Math.abs(drift) - STICK.line) / STICK.miss, -1, 1);
    const shot = strike(clamp(s.depth / STICK.full, .08, 1) * tempo, error, club, clubs);
    if (shot) shot.tempo = tempo;
    return shot;
  }
  const api = { begin, move, finish, struck, grade, ZONE, stickBegin, stickMove, stickFinish, STICK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GolfSwing = api;
})(typeof window !== 'undefined' ? window : globalThis);
