// Golf ball flight + bounce + roll. Units in: mph, degrees, rpm. Internal: SI (m, s).
// Coordinates: x = right of target line, y = up, z = downrange.
(function (root) {
  const MPH = 0.44704, RPM = Math.PI / 30, YD = 0.9144;
  const G = 9.81, RHO = 1.19, MASS = 0.04593, R = 0.02135, AREA = Math.PI * R * R;

  const K = { cd: 0.20, a: 5, b: 18, cap: 0.30, cdSpin: 0.3 };   // aero params (tuned)
  const cl = (S) => Math.min(K.cap, K.a * S / (1 + K.b * S)); // lift vs spin ratio S = R*w/v
  const SPIN_DECAY = 0.028;               // fraction of spin lost per second

  function simulate(shot, opts) {
    opts = opts || {};
    const dt = 0.004, sampleEvery = 5;    // sample every 20 ms
    const v0 = shot.speed * MPH, vla = shot.vla * Math.PI / 180, hla = shot.hla * Math.PI / 180;
    const back = shot.backspin * RPM, side = shot.sidespin * RPM;

    // launch frame
    const d = [Math.sin(hla) * Math.cos(vla), Math.sin(vla), Math.cos(hla) * Math.cos(vla)];
    let r = [d[2], 0, -d[0]]; const rn = Math.hypot(r[0], r[2]) || 1; r = [r[0] / rn, 0, r[2] / rn];
    const u = cross(d, r);
    // spin vector (rad/s): backspin about -right, sidespin about up (+ = curves right)
    let w = [-back * r[0] + side * u[0], -back * r[1] + side * u[1], -back * r[2] + side * u[2]];

    let p = [0, 0.03, 0], v = [v0 * d[0], v0 * d[1], v0 * d[2]], t = 0;
    const pts = [[0, 0, 0, 0]];            // [t, x, y, z]
    const bounces = [];
    let carry = null, apex = 0, apexT = 0, landAngle = 0, landSpeed = 0, rolling = false, step = 0;

    while (t < 60 && step < 15000) {
      step++;
      if (!rolling) {
        const sp = Math.hypot(v[0], v[1], v[2]);
        const wm = Math.hypot(w[0], w[1], w[2]);
        const S = sp > 0.1 ? R * wm / sp : 0;
        const q = 0.5 * RHO * AREA * sp;            // force = q * (coef * vector)
        const wc = cross(w, v);                      // magnus direction * |w||v|sin
        const wcn = Math.hypot(wc[0], wc[1], wc[2]) || 1;
        const lift = cl(S) * q * sp / wcn;           // scale unit direction by Cl*q*sp
        const a = [
          (-(K.cd + K.cdSpin * S) * q * v[0] + lift * wc[0]) / MASS,
          (-(K.cd + K.cdSpin * S) * q * v[1] + lift * wc[1]) / MASS - G,
          (-(K.cd + K.cdSpin * S) * q * v[2] + lift * wc[2]) / MASS,
        ];
        for (let i = 0; i < 3; i++) { v[i] += a[i] * dt; p[i] += v[i] * dt; }
        const k = Math.exp(-SPIN_DECAY * dt); w = [w[0] * k, w[1] * k, w[2] * k];
        t += dt;
        if (p[1] > apex) { apex = p[1]; apexT = t; }

        if (p[1] <= 0 && v[1] < 0) {                 // ground contact
          p[1] = 0;
          const vh = Math.hypot(v[0], v[2]) || 1e-6;
          const hd = [v[0] / vh, v[2] / vh];
          const rightH = [hd[1], -hd[0]];
          const wBack = -(w[0] * rightH[0] + w[2] * rightH[1]);   // backspin about the travel direction
          if (carry === null) {
            carry = { x: p[0], z: p[2], t };
            landAngle = Math.atan2(-v[1], vh) * 180 / Math.PI;
            landSpeed = Math.hypot(v[0], v[1], v[2]) / MPH;
          }
          const impactV = -v[1];
          const e = impactV > 8 ? 0.30 : 0.42;
          const f = 0.62;
          const vhNew = vh * f - 0.30 * wBack * R * Math.min(1, 12 / Math.max(vh, 1)) * 1.0;
          const vyNew = impactV * e;
          v = [hd[0] * vhNew, vyNew, hd[1] * vhNew];
          // sideways skid also bleeds off
          w = [w[0] * 0.5, w[1] * 0.5, w[2] * 0.5];
          bounces.push({ x: p[0], z: p[2], t });
          if (vyNew < 1.2) { rolling = true; v[1] = 0; }
        }
      } else {
        const vh = Math.hypot(v[0], v[2]);
        const dec = 1.8 * dt;
        if (vh <= dec) { p[1] = 0; break; }
        v[0] -= v[0] / vh * dec; v[2] -= v[2] / vh * dec;
        p[0] += v[0] * dt; p[2] += v[2] * dt; t += dt;
      }
      if (step % sampleEvery === 0) pts.push([t, p[0], p[1], p[2]]);
    }
    pts.push([t, p[0], 0, p[2]]);
    if (carry === null) carry = { x: p[0], z: p[2], t };
    const toYd = (m) => m / YD;
    return {
      path: pts, bounces,
      carryYd: toYd(Math.hypot(carry.x, carry.z)),
      carryX: toYd(carry.x), carryZ: toYd(carry.z),
      totalYd: toYd(Math.hypot(p[0], p[2])),
      totalX: toYd(p[0]), totalZ: toYd(p[2]),
      apexFt: apex / 0.3048,
      hangTime: carry.t,
      landAngle, landSpeed,
      duration: t,
    };
  }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

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

  const api = { K, simulate, randomShot, CLUBS, YD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GolfPhysics = api;
})(typeof window !== 'undefined' ? window : globalThis);
