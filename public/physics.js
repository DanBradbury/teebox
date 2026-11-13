// Golf ball flight, bounce and roll from first principles.
// Units in: mph, degrees, rpm. Internal: SI (m, s, rad). See docs/PHYSICS.md for the model and its sources.
// Coordinates: x = right of target line, y = up, z = downrange. The ground is y = 0 unless a height map is given.
(function (root) {
  const MPH = 0.44704, RPM = Math.PI / 30, YD = 0.9144, FT = 0.3048, DEG = Math.PI / 180;
  const G = 9.80665;
  const MASS = 0.04593, R = 0.021335;          // R&A / USGA ball: 45.93 g, 42.67 mm
  const AREA = Math.PI * R * R;
  const INERTIA = 0.4 * MASS * R * R;          // uniform solid sphere

  // ---------- atmosphere ----------
  // Density of moist air from temperature, altitude (or a measured station pressure) and humidity.
  function atmosphere(c) {
    c = c || {};
    const tC = c.tempC != null ? c.tempC : c.tempF != null ? (c.tempF - 32) / 1.8 : 21.1;
    const alt = c.altitudeM != null ? c.altitudeM : c.altitudeFt != null ? c.altitudeFt * FT : 0;
    const rh = Math.min(1, Math.max(0, (c.humidity != null ? c.humidity : 50) / 100));
    const T = tC + 273.15;
    // barometric formula (isothermal layer at the local temperature)
    const p = c.pressurePa != null ? c.pressurePa : 101325 * Math.exp(-G * 0.0289644 * alt / (8.314462618 * T));
    const pv = rh * 610.94 * Math.exp(17.625 * tC / (tC + 243.04));     // Magnus saturation vapour pressure
    const rho = (p - pv) / (287.058 * T) + pv / (461.495 * T);          // dry air + water vapour
    const mu = 1.716e-5 * Math.pow(T / 273.15, 1.5) * (273.15 + 110.4) / (T + 110.4);   // Sutherland
    return { tempC: tC, altitudeM: alt, pressurePa: p, rho, mu };
  }

  // ---------- aerodynamics ----------
  // Lift and drag coefficients as functions of spin ratio S = R*w/v and Reynolds number Re = rho*v*2R/mu.
  //   Cl = clMax * S / (clHalf + S)                 lift grows with spin ratio, then saturates
  //   Cd = cd0 + cdInduced * Cl^2 + cdRe * (1e5/Re - 1)
  //                                                 profile drag + lift-induced drag + drag-crisis rise at low Re
  // The shapes are the ones seen in wind tunnels (Bearman & Harvey 1976, Smits & Smith 1994). cdRe is set
  // from the wind-tunnel Reynolds slope; the other four constants are fitted to radar-measured carry, apex
  // and landing angle of modern balls (docs/PHYSICS.md).
  const AERO = {
    clMax: 0.508, clHalf: 0.182,
    cd0: 0.234, cdInduced: 1.04, cdRe: 0.08,
    cdMax: 0.50,                         // sub-critical sphere
    spinDecay: 2e-5,                     // dw/dt = -spinDecay * w * v / R  (Smits & Smith)
  };
  function coefficients(S, Re) {
    const cl = S > 0 ? AERO.clMax * S / (AERO.clHalf + S) : 0;
    const re = Math.min(Math.max(Re, 2e4), 2.5e5);
    const cd = Math.min(AERO.cdMax, AERO.cd0 + AERO.cdInduced * cl * cl + AERO.cdRe * (1e5 / re - 1));
    return { cd, cl };
  }

  // ---------- turf ----------
  // mu: sliding friction ball-on-turf. cor: scales Penner's restitution curve. dig: scales how far the turf
  // gives under the ball (Penner's effective slope). stimpFt: roll-out speed, as a Stimpmeter reading.
  const SURFACES = {
    firm:    { label: 'Firm fairway', mu: 0.40, cor: 1.10, dig: 0.65, stimpFt: 5.5 },
    fairway: { label: 'Fairway',      mu: 0.40, cor: 1.00, dig: 0.85, stimpFt: 4.0 },
    soft:    { label: 'Soft fairway', mu: 0.45, cor: 0.85, dig: 1.10, stimpFt: 3.0 },
    rough:   { label: 'Rough',        mu: 0.50, cor: 0.70, dig: 1.30, stimpFt: 1.8 },
    green:   { label: 'Green',        mu: 0.40, cor: 1.00, dig: 1.00, stimpFt: 10.0 },
  };
  const STIMP_V = 1.83;                        // release speed of a Stimpmeter, m/s
  // Rolling deceleration (m/s^2) of a surface, from the distance a Stimpmeter roll covers: a = v^2 / 2d.
  const rollDecel = (turf) => STIMP_V * STIMP_V / (2 * turf.stimpFt * FT);
  const Z0 = 0.03, WIND_REF = 10;              // roughness length of mown grass, wind reference height (m)

  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const FLAT = [0, 1, 0];
  const SLOPE_SPAN = 2, SLOPE_MAX = 1;         // slope is read over +/- 2 m and capped at 45 degrees

  // Penner's normal coefficient of restitution for a ball landing on turf (vn in m/s).
  const restitution = (vn) => (vn < 20 ? 0.510 - 0.0375 * vn + 0.000903 * vn * vn : 0.120);

  // Rigid-sphere bounce with Coulomb friction off turf that gives under the ball (after Penner 2002).
  // Returns new velocity and spin. v, w are 3-vectors; up is the unit normal of the ground (default: level).
  function bounce(v, w, turf, up) {
    const N = up || FLAT;
    const vd = -dot(v, N), speed = len(v);                             // speed into the ground
    const vs = [v[0] + vd * N[0], v[1] + vd * N[1], v[2] + vd * N[2]], vh = len(vs);   // speed along it
    let hd = [vs[0] / vh, vs[1] / vh, vs[2] / vh];
    if (!(vh > 1e-6)) {                                                // straight down: downrange along the ground
      const m = Math.hypot(N[2] * N[0], N[2] * N[1], 1 - N[2] * N[2]) || 1;
      hd = [-N[2] * N[0] / m, -N[2] * N[1] / m, (1 - N[2] * N[2]) / m];
    }
    // The ball digs a pitch mark; the net reaction acts as if the surface were tilted toward the ball.
    const impactDeg = Math.atan2(vd, vh) / DEG;
    const tilt = Math.min(30, 15.4 * (speed / 18.6) * (impactDeg / 44.4) * turf.dig) * DEG;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const n = [ct * N[0] - st * hd[0], ct * N[1] - st * hd[1], ct * N[2] - st * hd[2]];
    const vn = -(v[0] * n[0] + v[1] * n[1] + v[2] * n[2]);
    if (vn <= 0) return { v: v.slice(), w: w.slice() };
    const vt = [v[0] + vn * n[0], v[1] + vn * n[1], v[2] + vn * n[2]];
    const e = Math.min(0.9, restitution(vn) * turf.cor);
    // slip velocity of the contact point: vt + w x (-R n)
    const sp = cross(w, [-R * n[0], -R * n[1], -R * n[2]]);
    const u = [vt[0] + sp[0], vt[1] + sp[1], vt[2] + sp[2]], um = len(u);
    // Friction impulse opposes slip. If it is big enough to stop the slip, the ball leaves rolling (2/7 rule).
    const slide = turf.mu * (1 + e) * vn;
    const k = um < 1e-9 ? 0 : (slide * 3.5 >= um ? 2 / 7 : slide / um);
    const dv = [-k * u[0], -k * u[1], -k * u[2]];
    const dw = cross([-R * n[0], -R * n[1], -R * n[2]], dv).map((x) => x * MASS / INERTIA);
    const out = [vt[0] + dv[0], vt[1] + dv[1], vt[2] + dv[2]], om = len(out);
    // Rolling resistance also acts while the ball is pressed into the turf: c_rr times the normal impulse.
    const keep = om > 1e-9 ? Math.max(0, 1 - (rollDecel(turf) / G) * (1 + e) * vn / om) : 0;
    return {
      v: [out[0] * keep + e * vn * n[0], out[1] * keep + e * vn * n[1], out[2] * keep + e * vn * n[2]],
      w: [w[0] + dw[0], w[1] + dw[1], w[2] + dw[2]],
    };
  }

  // shot: { speed mph, vla deg, hla deg, backspin rpm, sidespin rpm }
  // opts: { tempF|tempC, altitudeFt|altitudeM, humidity %, pressurePa, windMph, windFrom deg, surface, heightAt }
  //   windFrom is where the wind comes from relative to the target line: 0 = headwind, 90 = from the right,
  //   180 = tailwind, 270 = from the left. windMph is measured at 10 m, as weather stations report it.
  //   heightAt(x, z) is the ground height in metres at a point in metres; without it the ground is level.
  function simulate(shot, opts) {
    opts = opts || {};
    const air = atmosphere(opts);
    const turf = typeof opts.surface === 'object' && opts.surface ? opts.surface : SURFACES[opts.surface] || SURFACES.fairway;
    const windRef = (opts.windMph || 0) * MPH, wf = (opts.windFrom || 0) * DEG;
    const windDir = [-Math.sin(wf), 0, -Math.cos(wf)];                 // direction the air moves
    const windAt = (h) => (windRef > 0 && h > Z0 ? windRef * Math.log(h / Z0) / Math.log(WIND_REF / Z0) : 0);

    const heightAt = typeof opts.heightAt === 'function' ? opts.heightAt : null;
    const ground = (x, z) => { const h = heightAt ? heightAt(x, z) : 0; return Number.isFinite(h) ? h : 0; };
    // Unit normal of the ground, from the height difference across a short span.
    const normalAt = (x, z) => {
      if (!heightAt) return FLAT;
      let sx = (ground(x + SLOPE_SPAN, z) - ground(x - SLOPE_SPAN, z)) / (2 * SLOPE_SPAN);
      let sz = (ground(x, z + SLOPE_SPAN) - ground(x, z - SLOPE_SPAN)) / (2 * SLOPE_SPAN);
      const s = Math.hypot(sx, sz);
      if (s > SLOPE_MAX) { sx *= SLOPE_MAX / s; sz *= SLOPE_MAX / s; }
      const m = Math.hypot(sx, 1, sz);
      return [-sx / m, 1 / m, -sz / m];
    };

    const dt = 0.004, sampleEvery = 5;          // RK4 at 250 Hz, path sampled every 20 ms
    const v0 = shot.speed * MPH, vla = shot.vla * DEG, hla = shot.hla * DEG;
    const back = shot.backspin * RPM, side = shot.sidespin * RPM;

    // launch frame
    const d = [Math.sin(hla) * Math.cos(vla), Math.sin(vla), Math.cos(hla) * Math.cos(vla)];
    const r = [Math.cos(hla), 0, -Math.sin(hla)];
    const up = cross(d, r);
    // spin vector (rad/s): backspin about -right, sidespin about up (+ = curves right)
    let w = [-back * r[0] + side * up[0], -back * r[1] + side * up[1], -back * r[2] + side * up[2]];
    const startY = ground(0, 0);
    let p = [0, startY, 0], v = [v0 * d[0], v0 * d[1], v0 * d[2]], t = 0;

    // d/dt of [velocity, spin] in the air. Forces act on the velocity relative to the moving air.
    const deriv = (y, vel, ws, wdir) => {
      const wind = windAt(y);
      const rel = [vel[0] - wind * windDir[0], vel[1], vel[2] - wind * windDir[2]];
      const sp = len(rel), wm = ws;
      if (sp < 0.05) return { a: [0, -G, 0], dw: 0 };
      const { cd, cl } = coefficients(R * wm / sp, air.rho * sp * 2 * R / air.mu);
      const q = 0.5 * air.rho * AREA * sp / MASS;
      const m = cross(wdir, rel), mn = len(m);                           // Magnus direction
      const L = mn > 1e-9 ? cl * q * sp / mn : 0;
      return {
        a: [-cd * q * rel[0] + L * m[0], -cd * q * rel[1] + L * m[1] - G, -cd * q * rel[2] + L * m[2]],
        dw: -AERO.spinDecay * wm * sp / R,
      };
    };

    const pts = [[0, 0, startY, 0]];            // [t, x, y, z]
    const bounces = [];
    let carry = null, apex = 0, landAngle = 0, landSpeed = 0, landSpin = 0, step = 0;
    let mode = dot(v, normalAt(0, 0)) > 0 ? 'air' : 'ground';
    const decel = rollDecel(turf);

    while (t < 90 && step < 30000) {
      step++;
      if (mode === 'air') {
        // RK4 on position, velocity and spin rate; the spin axis stays fixed in flight (gyroscopic)
        const wm = len(w), wdir = wm > 1e-9 ? [w[0] / wm, w[1] / wm, w[2] / wm] : [0, 0, 0];
        const add = (a, b, h) => [a[0] + b[0] * h, a[1] + b[1] * h, a[2] + b[2] * h];
        const clear = p[1] - ground(p[0], p[2]);                         // height above the ground, for the wind
        const k1 = deriv(clear, v, wm, wdir);
        const v2 = add(v, k1.a, dt / 2), k2 = deriv(clear + v[1] * dt / 2, v2, wm + k1.dw * dt / 2, wdir);
        const v3 = add(v, k2.a, dt / 2), k3 = deriv(clear + v2[1] * dt / 2, v3, wm + k2.dw * dt / 2, wdir);
        const v4 = add(v, k3.a, dt), k4 = deriv(clear + v3[1] * dt, v4, wm + k3.dw * dt, wdir);
        let np = [0, 0, 0], nv = [0, 0, 0];
        for (let i = 0; i < 3; i++) {
          np[i] = p[i] + dt / 6 * (v[i] + 2 * v2[i] + 2 * v3[i] + v4[i]);
          nv[i] = v[i] + dt / 6 * (k1.a[i] + 2 * k2.a[i] + 2 * k3.a[i] + k4.a[i]);
        }
        let nwm = Math.max(0, wm + dt / 6 * (k1.dw + 2 * k2.dw + 2 * k3.dw + k4.dw)), h = dt, hit = false;
        const under = ground(np[0], np[2]) - np[1];
        if (under >= 0 && dot(nv, normalAt(np[0], np[2])) < 0) {   // crossed the ground: back up to the moment of contact
          const f = clear > 0 ? clear / (clear + under) : 0;
          for (let i = 0; i < 3; i++) { np[i] = p[i] + (np[i] - p[i]) * f; nv[i] = v[i] + (nv[i] - v[i]) * f; }
          nwm = wm + (nwm - wm) * f; h = dt * f; np[1] = ground(np[0], np[2]); hit = true;
        }
        p = np; v = nv; t += h; w = [wdir[0] * nwm, wdir[1] * nwm, wdir[2] * nwm];
        if (p[1] - startY > apex) apex = p[1] - startY;

        if (hit) {                              // ground contact
          const vh = Math.hypot(v[0], v[2]), N = normalAt(p[0], p[2]);
          if (carry === null) {
            carry = { x: p[0], y: p[1], z: p[2], t };
            landAngle = Math.atan2(-v[1], vh) / DEG;
            landSpeed = len(v) / MPH; landSpin = len(w) / RPM;
          }
          const out = bounce(v, w, turf, N);
          v = out.v; w = out.w;
          bounces.push({ x: p[0], z: p[2], t });
          // a hop lower than the grass (about 2 cm) is a roll
          const vo = dot(v, N);
          if (vo < 0.6 || bounces.length > 40) { mode = 'ground'; for (let i = 0; i < 3; i++) v[i] -= vo * N[i]; }
        }
      } else {
        // On the ground: slide under kinetic friction until the contact point stops slipping, then roll.
        // Gravity pulls the ball down the slope, and the turf only carries the part of its weight normal to it.
        const N = normalAt(p[0], p[2]), press = G * N[1];
        const gt = [press * N[0], press * N[1] - G, press * N[2]];       // gravity along the slope
        const vn = dot(v, N), wn = dot(w, N);
        for (let i = 0; i < 3; i++) v[i] -= vn * N[i];                   // the ball follows the ground
        const rc = [-R * N[0], -R * N[1], -R * N[2]], s = cross(w, rc);
        const u = [v[0] + s[0], v[1] + s[1], v[2] + s[2]], um = len(u);  // contact slip
        if (um > 0.02) {
          const a = turf.mu * press, k = Math.min(1, um / (3.5 * a * dt));   // do not overshoot zero slip
          const af = [-a * k * u[0] / um, -a * k * u[1] / um, -a * k * u[2] / um];
          const tq = cross(rc, af);
          for (let i = 0; i < 3; i++) { v[i] += (af[i] + gt[i]) * dt; w[i] += 2.5 * tq[i] / (R * R) * dt; }
        } else {
          // A rolling solid sphere keeps 5/7 of the pull of gravity; rolling resistance holds it on gentle slopes.
          const pull = [gt[0] * 5 / 7, gt[1] * 5 / 7, gt[2] * 5 / 7], pm = len(pull), res = decel * N[1];
          for (let i = 0; i < 3; i++) v[i] += pull[i] * dt;
          const sp = len(v);
          if (sp <= res * dt) {
            if (pm <= res) break;                                        // at rest
            for (let i = 0; i < 3; i++) v[i] = pull[i] * (1 - res / pm) * dt;   // turns round and runs back down
          } else {
            for (let i = 0; i < 3; i++) v[i] -= v[i] / sp * res * dt;
          }
          const roll = cross(N, v);                                      // rolling without slipping
          for (let i = 0; i < 3; i++) w[i] = roll[i] / R + wn * N[i];
        }
        const scrub = wn * (1 - Math.exp(-2 * dt));                      // turf scrubs off spin about the normal
        for (let i = 0; i < 3; i++) w[i] -= scrub * N[i];
        p[0] += v[0] * dt; p[2] += v[2] * dt; p[1] = ground(p[0], p[2]); t += dt;
      }
      if (step % sampleEvery === 0) pts.push([t, p[0], p[1], p[2]]);
    }
    p[1] = ground(p[0], p[2]);
    pts.push([t, p[0], p[1], p[2]]);
    if (carry === null) carry = { x: p[0], y: p[1], z: p[2], t };
    const toYd = (m) => m / YD;
    return {
      path: pts, bounces,
      carryYd: toYd(Math.hypot(carry.x, carry.z)),
      carryX: toYd(carry.x), carryZ: toYd(carry.z),
      totalYd: toYd(Math.hypot(p[0], p[2])),
      totalX: toYd(p[0]), totalZ: toYd(p[2]),
      apexFt: apex / FT,
      carryRiseFt: (carry.y - startY) / FT, totalRiseFt: (p[1] - startY) / FT,   // ground height vs the tee
      hangTime: carry.t,
      landAngle, landSpeed, landSpin,
      duration: t,
      air,
    };
  }

  // Plausible random shots for sim mode: [ballMph, vla, backspin rpm]
  const CLUBS = {
    DR: [160, 11.5, 2600], '3W': [150, 11, 3400], '5W': [142, 12, 4200], '4i': [130, 13, 4600],
    '5i': [124, 14.5, 5300], '6i': [119, 16, 6000], '7i': [114, 17.5, 6700], '8i': [108, 19.5, 7500],
    '9i': [102, 22, 8400], PW: [96, 25, 9200], SW: [80, 30, 9800],
  };
  function randomShot(club) {
    const c = CLUBS[club] || CLUBS['7i'];
    const g = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;   // ~ bell curve in [-1,1]
    const speed = c[0] * (1 + 0.04 * g()), vla = c[1] + 2 * g();
    const back = c[2] * (1 + 0.12 * g());
    const hla = 2.0 * g(), side = 450 * g() + (hla * 60);
    return { speed, vla, hla, backspin: back, sidespin: side, total: Math.hypot(back, side),
      axis: Math.atan2(side, back) * 180 / Math.PI, club };
  }

  const api = { AERO, SURFACES, atmosphere, coefficients, restitution, bounce, simulate, randomShot, CLUBS, YD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GolfPhysics = api;
})(typeof window !== 'undefined' ? window : globalThis);
