// Touch aiming and landing preview for the iOS app. Reads the game's globals; changes no physics.
//   - Drag across the scene to aim (drives the same #gameAim control the slider did).
//   - A top-down preview shows the aim line, expected carry and where the pin sits.
(() => {
  const cv = $('#view'), aim = $('#gameAim');
  const DEG_PER_PX = .25;

  // ---- drag to aim ----
  let drag = null;
  const aimable = () => game.enabled && !aim.disabled && !document.body.classList.contains('shot-mode');
  cv.addEventListener('pointerdown', (e) => {
    if (!aimable() || drag) return;
    drag = { id: e.pointerId, x: e.clientX, aim: Number(aim.value) };
    cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!aimable()) { drag = null; return; }
    aim.value = Math.round(drag.aim + (e.clientX - drag.x) * DEG_PER_PX);   // right of screen = right of target
    aim.dispatchEvent(new Event('input'));
  });
  const end = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  $('.game-aim').insertAdjacentHTML('beforeend', '<span class="aim-hint">Drag the view to aim</span>');

  // ---- landing preview ----
  // On a mapped hole: the ground around your landing zone from above, aim line pointing up.
  // On the range, or a hole without map data: a radar of distance rings.
  const box = document.body.appendChild(document.createElement('canvas'));
  box.id = 'landingPreview';
  const W = 136, H = 210, dpr = window.devicePixelRatio || 1;
  box.width = W * dpr; box.height = H * dpr;
  const g = box.getContext('2d');
  g.scale(dpr, dpr);
  const SURFACE = { rough: '#2f5d35', wood: '#1f4128', fairway: '#62a052', tee: '#4f8e47', green: '#86c971', bunker: '#e8d9a6', water: '#4d8cc0' };
  let carryKey = '', carry = 0, lastKey = '';

  const BX = W / 2, BY = H - 26;
  const pinWorld = () => (sceneMode === 'course' && hole ? hole.green : { x: 0, z: targetYd * YD });

  // One shot's view: `fr` is the ball's world position, (dx, dz) the world heading drawn straight up, `carryM` sets the zoom.
  function view(fr, dx, dz, carryM) {
    const scale = (BY - 64) / Math.max(carryM, 20);   // px per metre; the landing zone sits near the top
    const at = (x, z) => [BX + ((x - fr.x) * dz - (z - fr.z) * dx) * scale, BY - ((x - fr.x) * dx + (z - fr.z) * dz) * scale];
    return { at, scale, fr };
  }
  function paintGround(v) {
    if (sceneMode === 'course' && hole?.scene) {
      g.fillStyle = SURFACE.rough; g.fillRect(0, 0, W, H);
      const map = hole.scene.map;
      for (const kind of ['wood', 'fairway', 'tee', 'water', 'green', 'bunker']) {
        g.beginPath();
        for (const rings of map[kind] || []) for (const ring of rings) {
          ring.forEach(([x, z], i) => { const [px, py] = v.at(x, z); i ? g.lineTo(px, py) : g.moveTo(px, py); });
          g.closePath();
        }
        g.fillStyle = SURFACE[kind]; g.fill('evenodd');
      }
    } else {   // radar of distance rings
      g.fillStyle = '#101a22'; g.fillRect(0, 0, W, H);
      g.strokeStyle = '#ffffff1f'; g.lineWidth = 1; g.fillStyle = '#9db0a1'; g.font = '8px system-ui';
      const step = BY / v.scale / YD > 240 ? 50 : 25;
      for (let d = step; d * YD * v.scale < BY; d += step) {
        g.beginPath(); g.arc(BX, BY, d * YD * v.scale, -Math.PI * .85, -Math.PI * .15); g.stroke();
        g.fillText(String(d), BX + 3, BY - d * YD * v.scale - 2);
      }
    }
  }
  const oval = (x, y, scale, carryM, dim) => {
    g.fillStyle = dim ? '#f2d78222' : '#f2d78255'; g.strokeStyle = dim ? '#f2d78288' : '#f2d782'; g.lineWidth = 1.5;
    g.beginPath(); g.ellipse(x, y, Math.max(6, carryM * .09 * scale), Math.max(7, carryM * .06 * scale), 0, 0, Math.PI * 2); g.fill(); g.stroke();
  };
  const flagIcon = (x, y, big) => {
    const h = big ? 18 : 10, w = big ? 11 : 7;
    g.fillStyle = '#0006'; g.beginPath(); g.ellipse(x, y, big ? 4 : 2.5, big ? 1.6 : 1, 0, 0, Math.PI * 2); g.fill();   // cup
    g.strokeStyle = '#fff'; g.lineWidth = big ? 1.5 : 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - h); g.stroke();
    g.fillStyle = '#e04a4a'; g.beginPath(); g.moveTo(x, y - h); g.lineTo(x + w, y - h + w * .38); g.lineTo(x, y - h + w * .76); g.closePath(); g.fill();
  };
  // The flag is drawn where the pin really is when that is on the map; otherwise it sits on the border pointing toward it.
  function flag(v, dx, dz) {
    const pin = pinWorld(), px = pin.x - v.fr.x, pz = pin.z - v.fr.z;
    const ax = px * dz - pz * dx, az = px * dx + pz * dz;   // pin in the aim frame, metres
    const sx0 = BX + ax * v.scale, sy0 = BY - az * v.scale;
    if (sx0 > 10 && sx0 < W - 10 && sy0 > 22 && sy0 < H - 34) { flagIcon(sx0, sy0, true); return Math.hypot(px, pz) / YD; }
    const bearing = Math.atan2(ax, az), sx = Math.sin(bearing), sy = -Math.cos(bearing), inset = 14;
    const t = Math.min(sx > 0 ? (W - inset - BX) / sx : sx < 0 ? (inset - BX) / sx : Infinity,
      sy > 0 ? (H - 34 - BY) / sy || Infinity : sy < 0 ? (inset + 8 - BY) / sy : Infinity);
    flagIcon(BX + sx * t, Math.min(H - 34, BY + sy * t), false);
    return Math.hypot(px, pz) / YD;
  }
  const label = (text) => {
    g.fillStyle = '#eef3f5'; g.font = '600 9px system-ui'; g.textAlign = 'center'; g.shadowColor = '#000'; g.shadowBlur = 3;
    g.fillText(text, W / 2, H - 6); g.textAlign = 'left'; g.shadowBlur = 0;
  };

  // Before the swing: planned landing zone for the chosen club and aim.
  function drawAim() {
    const fr = shotFrame(), a = Number(aim.value) * Math.PI / 180;
    const dx = fr.fx * Math.cos(a) + fr.fz * Math.sin(a), dz = fr.fz * Math.cos(a) - fr.fx * Math.sin(a);
    const m = carry * YD, v = view(fr, dx, dz, m), ly = BY - m * v.scale;
    paintGround(v);
    g.setLineDash([3, 3]); g.strokeStyle = '#f2d782'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(BX, BY); g.lineTo(BX, ly); g.stroke(); g.setLineDash([]);
    oval(BX, ly, v.scale, m);
    const pin = flag(v, dx, dz);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(BX, BY, 3, 0, Math.PI * 2); g.fill();
    label(`${Math.round(carry)} carry · ${Math.round(pin)} to pin`);
  }
  // During the shot: the same view, frozen on the aim it was hit with, with the ball's track drawn as it flies.
  function drawFlight() {
    const { res, frame: fr, t } = anim;
    const m = res.carryYd * YD, v = view(fr, fr.fx, fr.fz, m);
    paintGround(v);
    const plan = BY - carry * YD * v.scale;
    oval(BX, plan, v.scale, carry * YD, true);
    flag(v, fr.fx, fr.fz);
    // Ground track so far, then the ball itself; it swells with height so the arc reads from above.
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.lineJoin = g.lineCap = 'round'; g.beginPath();
    g.moveTo(BX, BY);
    for (const [pt, x, , z] of res.path) { if (pt > t) break; const [px, py] = v.at(x, z); g.lineTo(px, py); }
    const [bx, by, bz] = ballAt(res, t), [px, py] = v.at(bx, bz);
    g.lineTo(px, py); g.stroke();
    if (anim.carryShown) {
      const [cx, , cz] = frameWorld(fr, [res.carryX * YD, 0, res.carryZ * YD]), [lx, ly] = v.at(cx, cz);
      g.strokeStyle = '#f2d782'; g.lineWidth = 1.5; g.beginPath(); g.arc(lx, ly, 4, 0, Math.PI * 2); g.stroke();
    }
    g.fillStyle = '#000a'; g.beginPath(); g.arc(px + 1, py + 1, 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(px, py - Math.min(10, by * .12), 3 + Math.min(2, by * .03), 0, Math.PI * 2); g.fill();
    label(anim.endShown ? `${Math.round(res.carryYd)} carry · ${Math.round(res.totalYd)} total` : anim.carryShown ? `${Math.round(res.carryYd)} carry` : '');
  }

  function frame() {
    requestAnimationFrame(frame);
    if (!document.body.classList.contains('game-mode')) return;
    const club = $('#club').value, cond = JSON.stringify(conditions());
    if (carryKey !== club + cond) {     // full-swing carry, same estimate the club panel shows
      const c = P.CLUBS[club];
      carry = P.simulate({ speed: c[0], vla: c[1], hla: 0, backspin: c[2], sidespin: 0 }, conditions()).carryYd;
      carryKey = club + cond;
    }
    const live = !!anim?.res, fr = shotFrame();
    const key = `${carryKey}|${aim.value}|${sceneMode}|${hole?.number}:${fr.x.toFixed(0)},${fr.z.toFixed(0)}|${targetYd}`;
    if (!live && key === lastKey) return;    // still scenes redraw only when something changed; flight redraws every frame
    lastKey = live ? '' : key;
    g.clearRect(0, 0, W, H);
    g.save(); g.beginPath(); g.roundRect(0, 0, W, H, 10); g.clip();
    if (live) drawFlight(); else drawAim();
    g.restore();
    g.strokeStyle = '#ffffff30'; g.lineWidth = 1; g.beginPath(); g.roundRect(.5, .5, W - 1, H - 1, 10); g.stroke();
  }
  requestAnimationFrame(frame);
})();
