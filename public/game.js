// Mouse or controller play layered over the existing flight, terrain and round systems.
game = (() => {
  let enabled = false, swing = null, pointer = null, pending = null, strikeAt = 0, finishAt = 0;
  let swingClub = null, swingAim = 0, lastBusy = null, flew = false, lastLie = null;
  // Controller state: the active stick swing, last frame's buttons, and fractional aim from the left stick.
  let input = 'mouse', stick = null, held = [], lastPoll = 0, aimDrift = 0, rearm = false;
  const pad = $('#swingPad'), aim = $('#gameAim'), names = { DR: 'Driver', '3W': '3 Wood', '5W': '5 Wood', PW: 'P Wedge', SW: 'S Wedge' };
  const clubs = Object.keys(P.CLUBS);
  const busy = () => !!anim || !!pending;
  const stickSwinging = () => !!stick && (stick.phase === 'back' || stick.phase === 'down');
  const swinging = () => !!swing || stickSwinging();
  const idleText = () => input === 'controller'
    ? 'Pull right stick back, then push it forward. LB/RB club · left stick aim · B cancel.'
    : 'Hold mouse, pull down the dotted path, then swing back up through the ball.';
  function status(text) { $('#gameStatus').textContent = text; }
  function power(value) {
    $('#gamePower').textContent = `${Math.round(value * 100)}%`;
    $('#gamePowerBar').style.width = `${value * 100}%`;
  }
  // Swing pad art: a dotted guide from the hitting zone down to a full backswing (lit as the finger pulls back),
  // follow-through dots above the zone, and a trail of the finger's real path so drift off the guide shows.
  // Sizes track the pad, which grows in the iOS shot mode; swing distances arrive in swing pixels (140 = full),
  // so k maps them onto the drawn guide. pad.dataset.scale publishes k for the iOS touch lens.
  const guide = $('#swingGuide'), STRIKE_MS = 120;
  let geom = null, dots = [], thruDots = [], trail = [], notch = 0, struckTimer = 0;
  // After the strike the finger keeps going: thru holds the swing's origin until the finger lifts, and thruNotch the dots passed.
  let thru = null, thruNotch = 0;
  function buildGuide() {
    const w = pad.clientWidth, h = pad.clientHeight, cx = w / 2, top = Math.max(32, Math.round(h * .3));
    const len = Math.max(60, h - top - 30), n = Math.round(len / 14), gap = len / n;
    geom = { cx, top, len, gap, k: len / 140 };
    pad.dataset.scale = String(geom.k);
    $('#swingHandle').style.top = `${top - 13}px`;
    guide.setAttribute('viewBox', `0 0 ${w} ${h}`);
    let html = `<rect class="streak" x="0" y="${top - 1.5}" width="${w}" height="3"/><rect class="zone" x="${cx - 34}" y="${top - 10}" width="68" height="20" rx="10"/><polyline class="trail"/>`;
    for (let i = 1; i <= n; i++) html += `<circle class="guide-dot${i === n ? ' end' : ''}" cx="${cx}" cy="${(top + gap * i).toFixed(1)}" r="${i === n ? 4.5 : 2.5}"/>`;
    for (let y = top - gap; y > 14; y -= gap) html += `<circle class="thru-dot" cx="${cx}" cy="${y.toFixed(1)}" r="2.5"/>`;
    guide.innerHTML = html + `<circle class="ring" cx="${cx}" cy="${top}" r="9"/><circle class="ball" cx="${cx}" cy="${top}" r="5"/>`;
    dots = [...guide.querySelectorAll('.guide-dot')];
    thruDots = [...guide.querySelectorAll('.thru-dot')];
  }
  new ResizeObserver(buildGuide).observe(pad);
  function tick(kind) {
    pad.dispatchEvent(new CustomEvent('swingtick', { detail: kind }));
    try { navigator.vibrate?.(kind === 'strike' ? [35, 25, 25] : 6); } catch (_) { /* vibration is optional */ }
  }
  function drawSwing(dx, dy, depth) {
    if (!geom) buildGuide();
    const { cx, top, len, k } = geom, x = Math.max(10 - cx, Math.min(cx - 10, dx * k)), y = Math.max(14 - top, Math.min(len + 15, dy * k));
    $('#swingHandle').style.transform = `translate(${x}px, ${y}px)`;
    const reach = Math.min(1, depth / 140);
    dots.forEach((dot, i) => dot.classList.toggle('lit', (i + 1) / dots.length <= reach + .001));
    trail.push(`${(cx + x).toFixed(1)},${(top + y).toFixed(1)}`);
    guide.querySelector('.trail').setAttribute('points', trail.join(' '));
    // A tick at each quarter of the backswing, so power can be felt as well as seen.
    const q = Math.floor(reach * 4);
    if (q > notch) { notch = q; tick('notch'); }
    return y;
  }
  // Follow-through: the handle and trail keep tracking above the zone, lighting a dot and ticking for each one passed.
  function follow(e) {
    const y = drawSwing(e.clientX - thru.x, e.clientY - thru.y, 0), passed = Math.min(thruDots.length, Math.floor(-y / geom.gap));
    if (passed <= thruNotch) return;
    for (let i = thruNotch; i < passed; i++) thruDots[i].classList.add('lit');
    thruNotch = passed; tick('through');
  }
  function endFollow() {
    thru = null; pad.classList.remove('following');
    endPointer();
    $('#swingHandle').style.transform = '';
  }
  function clearSwing(keepTrail) {
    $('#swingHandle').style.transform = '';
    for (const dot of [...dots, ...thruDots]) dot.classList.remove('lit');
    notch = thruNotch = 0; pad.classList.remove('swinging');
    if (!keepTrail) { trail = []; guide.querySelector('.trail')?.setAttribute('points', ''); }
  }
  function startSwing() {
    clearTimeout(struckTimer); pad.classList.remove('struck');
    clearSwing(); pad.classList.add('swinging');
  }
  function showGrade(shot) {
    const g = GolfSwing.grade(shot), el = $('#shotGrade');
    el.textContent = g.label; el.dataset.tier = pad.dataset.tier = g.tier;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }
  function reset() {
    swing = pending = stick = thru = null; pad.classList.remove('following');
    const oldPointer = pointer; pointer = null;
    if (oldPointer !== null && pad.hasPointerCapture(oldPointer)) pad.releasePointerCapture(oldPointer);
    strikeAt = finishAt = 0;
    clearTimeout(struckTimer); pad.classList.remove('struck');
    clearSwing();
    power(0);
    status(idleText());
  }
  function setInput(next) {
    if (next === input) return;
    input = next; stick = null;
    $('#gameInput').textContent = next === 'controller' ? 'Right stick' : 'Mouse';
    if (!swinging() && !busy()) status(idleText());
  }
  function clubInfo() {
    const club = $('#club').value, c = P.CLUBS[club];
    $('#gameClubName').textContent = names[club] || `${club.slice(0, -1)} Iron`;
    $('#gameClubArt').dataset.kind = ['DR', '3W', '5W'].includes(club) ? 'wood' : ['PW', 'SW'].includes(club) ? 'wedge' : 'iron';
    const res = P.simulate({ speed: c[0], vla: c[1], hla: 0, backspin: c[2], sidespin: 0 }, conditions());
    $('#gameCarry').textContent = String(Math.round(res.carryYd));
  }
  function setAim(value) { value = Math.max(-45, Math.min(45, value)); aim.value = value; $('#gameAimValue').textContent = `${value > 0 ? '+' : ''}${value}°`; }
  function setCompact(compact) {
    $('#top').classList.toggle('compact', compact);
    $('#gameSettingsToggle').textContent = compact ? 'Show settings' : 'Hide settings';
    $('#gameSettingsToggle').setAttribute('aria-expanded', String(!compact));
  }
  $('#gameSettingsToggle').onclick = () => setCompact(!$('#top').classList.contains('compact'));
  $('#playMode').onchange = () => {
    reset(); enabled = $('#playMode').value === 'game';
    document.body.classList.toggle('game-mode', enabled);
    $('#gameHud').hidden = !enabled;
    if (enabled) { clubInfo(); setAim(0); setCompact(innerWidth < 700); }
    try { localStorage.setItem('teebox.playMode', enabled ? 'game' : 'simulator'); } catch (_) { /* optional storage */ }
  };
  function changeClub(direction) {
    if (busy() || swinging()) return;
    $('#club').value = clubs[(clubs.indexOf($('#club').value) + direction + clubs.length) % clubs.length];
    clubInfo();
  }
  for (const [id, direction] of [['#clubPrev', -1], ['#clubNext', 1]]) $(id).onclick = () => changeClub(direction);
  $('#club').addEventListener('change', clubInfo);
  $('#condBox').addEventListener('change', clubInfo);
  aim.oninput = () => setAim(Number(aim.value));
  $('#aimReset').onclick = () => setAim(0);
  pad.onpointerdown = (e) => {
    if (!enabled || busy() || pointer !== null || stickSwinging() || e.button !== 0) return;
    e.preventDefault(); setInput('mouse');
    swing = GolfSwing.begin(e.clientX, e.clientY); pointer = e.pointerId;
    swingClub = $('#club').value; swingAim = Number(aim.value);
    pad.setPointerCapture(pointer); power(0); startSwing();
    status('Pull down the dotted path for power. Swing back up through the ball.');
  };
  function endPointer() {
    const oldPointer = pointer; pointer = null; swing = null;
    if (pad.hasPointerCapture(oldPointer)) pad.releasePointerCapture(oldPointer);
  }
  // The ball goes the moment the finger comes back up into the hitting zone; there is no need to let go,
  // and the finger can carry on into the follow-through.
  function move(e) {
    if (thru) { follow(e); return; }
    GolfSwing.move(swing, e.clientX, e.clientY);
    power(Math.min(1, swing.depth / 140));
    drawSwing(swing.error, e.clientY - swing.y, swing.depth);
    if (!GolfSwing.struck(swing)) return;
    const shot = GolfSwing.finish(swing, swingClub, P.CLUBS);
    thru = swing; swing = null; pad.classList.add('following');
    launch(shot);
  }
  pad.onpointermove = (e) => { if ((swing || thru) && e.pointerId === pointer) move(e); };
  pad.onpointerup = (e) => {
    if (thru && e.pointerId === pointer) { follow(e); endFollow(); return; }
    if (!swing || e.pointerId !== pointer) return;
    move(e);
    if (!swing) return;
    endPointer(); clearSwing(); power(0);
    status('Swing cancelled. Pull down, then swing back up through the ball before letting go.');
  };
  function launch(shot) {
    shot.aim = swingAim;
    pending = shot; strikeAt = performance.now() + STRIKE_MS; finishAt = strikeAt + 900;
    showGrade(shot); clearSwing(true); tick('strike');
    clearTimeout(struckTimer); pad.classList.remove('struck'); void pad.offsetWidth; pad.classList.add('struck');
    struckTimer = setTimeout(() => pad.classList.remove('struck'), 900);
    const tempo = shot.tempo !== undefined && shot.tempo < .95 ? ' · Slow tempo' : '';
    status(`${Math.round(shot.power * 100)}% power · ${Math.abs(shot.error) < .12 ? 'Pure strike' : shot.error < 0 ? 'Pulled left' : 'Pushed right'}${tempo}`);
  }
  // Losing the finger mid-follow-through only ends the follow-through; the ball is already away.
  pad.onpointercancel = pad.onlostpointercapture = () => { if (thru) endFollow(); else if (pointer !== null) reset(); };
  addEventListener('blur', () => { if (swing || pending) reset(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && (swing || pending)) reset(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') reset(); });

  // Controller: polled once per frame. Standard mapping: right stick swings, left stick or d-pad aims,
  // LB/RB change club, Y aims back at the pin, B cancels. Any controller input switches to controller swings;
  // pressing on the swing pad switches back to the mouse.
  const BTN = { B: 1, Y: 3, LB: 4, RB: 5, LEFT: 14, RIGHT: 15 }, DEAD = .25;
  function gamepad() {
    for (const g of navigator.getGamepads ? navigator.getGamepads() : []) if (g && g.connected) return g;
    return null;
  }
  function rumble() {
    try { gamepad()?.vibrationActuator?.playEffect('dual-rumble', { duration: 110, strongMagnitude: .7, weakMagnitude: .4 }).catch(() => {}); } catch (_) { /* rumble is optional */ }
  }
  function poll(now) {
    const dt = Math.min(.1, (now - lastPoll) / 1000); lastPoll = now;
    const g = gamepad();
    if (!g) { if (input === 'controller') setInput('mouse'); held = []; return; }
    const pressed = g.buttons.map(b => b.pressed), last = held, tap = (i) => pressed[i] && !last[i];
    const [lx = 0, ly = 0, rx = 0, ry = 0] = g.axes;
    held = pressed;
    if (pressed.some((_, i) => tap(i)) || Math.hypot(lx, ly) > DEAD || Math.hypot(rx, ry) > DEAD) setInput('controller');
    if (input !== 'controller' || swing) return;
    if (tap(BTN.B)) { reset(); rearm = true; return; }
    if (busy()) { stick = null; return; }
    if (!stickSwinging()) {
      if (tap(BTN.LB)) changeClub(-1);
      if (tap(BTN.RB)) changeClub(1);
      if (tap(BTN.Y)) setAim(0);
      if (tap(BTN.LEFT)) setAim(Number(aim.value) - 1);
      if (tap(BTN.RIGHT)) setAim(Number(aim.value) + 1);
      aimDrift = Math.abs(lx) > DEAD ? aimDrift + lx * 30 * dt : 0;
      if (Math.abs(aimDrift) >= 1) { const step = Math.trunc(aimDrift); aimDrift -= step; setAim(Number(aim.value) + step); }
    }
    // After B, the stick has to come back to center before it can start another swing.
    if (rearm) { if (Math.hypot(rx, ry) >= GolfSwing.STICK.dead) return; rearm = false; }
    stick = stick || GolfSwing.stickBegin();
    const was = stick.phase;
    GolfSwing.stickMove(stick, rx, ry, now);
    if (was === 'ready' && stickSwinging()) {
      swingClub = $('#club').value; swingAim = Number(aim.value); startSwing();
      status('Push the stick straight forward through the ball.');
    }
    if (stickSwinging()) {
      power(Math.min(1, stick.depth / GolfSwing.STICK.full));
      drawSwing(rx * 80, ry * 140, stick.depth / GolfSwing.STICK.full * 140);
    } else if (was !== 'ready' || stick.phase !== 'ready') {
      if (stick.phase !== 'struck') clearSwing();
      if (stick.phase === 'struck') { const shot = GolfSwing.stickFinish(stick, swingClub, P.CLUBS); stick = null; if (shot) { rumble(); launch(shot); } }
      else if (stick.phase === 'cancelled') { stick = null; power(0); status('Swing cancelled. Pull the stick back, then push it forward through the ball.'); }
      else power(0);
    }
  }
  addEventListener('gamepadconnected', () => { if (enabled) setInput('controller'); });
  addEventListener('gamepaddisconnected', () => { if (gamepad()) return; if (stickSwinging()) reset(); setInput('mouse'); });

  function draw(now) {
    if (!enabled) return;
    poll(now);
    if (pending && now >= strikeAt) { const shot = pending; pending = null; handleShot(shot); }
    const locked = busy() || swinging();
    if (busy()) flew = true;
    if (locked !== lastBusy) {
      for (const id of ['#clubPrev', '#clubNext', '#gameAim', '#aimReset']) $(id).disabled = locked;
      // A class rather than disabled: a disabled button stops getting the follow-through's pointer events.
      pad.classList.toggle('busy', busy()); lastBusy = locked;
      // Back to the prompt after a shot, but leave a cancelled swing's message showing.
      if (!locked) { if (flew && now > finishAt) status(idleText()); flew = false; }
    }
    if (lie !== lastLie && !anim) { setAim(0); lastLie = lie; }
    if (anim && now > finishAt) return;
    const fr = anim ? anim.frame : shotFrame();
    const angle = anim ? 0 : Number(aim.value) * Math.PI / 180;
    const golferFrame = { ...fr, fx: fr.fx * Math.cos(angle) + fr.fz * Math.sin(angle), fz: fr.fz * Math.cos(angle) - fr.fx * Math.sin(angle) };
    const ground = terrainHeight(), base = ground ? ground(fr.x, fr.z) : 0;
    const pt = (x, y, z) => project(frameWorld(golferFrame, [x, base + y, z]));
    const line = (points, color, width) => {
      const ps = points.map(p => pt(...p)); if (ps.some(p => !p)) return;
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, focal * width / ps[0].z); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ps.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke();
    };
    // Aim stripe follows the chosen heading across the terrain.
    if (!anim) {
      ctx.save(); ctx.setLineDash([6, 7]);
      const points = [1, 3, 6, 12, 24, 45].map(z => {
        const w = frameWorld(golferFrame, [0, 0, z]);
        return [0, (ground ? ground(w[0], w[2]) : 0) - base + .05, z];
      });
      line(points, '#f2d782bb', .025); ctx.restore();
      drawBall(pt(0, .04, 0));
    }
    // Articulated golfer, drawn in world space at the current ball position.
    const backswing = swing ? Math.min(1, swing.depth / 140) : stickSwinging() ? Math.min(1, stick.depth / GolfSwing.STICK.full) : 0;
    let rotation = -backswing * 2.5;
    if (pending) rotation = -2.5 * Math.max(0, (strikeAt - now) / STRIKE_MS);
    else if (now < finishAt) rotation = Math.min(2.7, (now - strikeAt) / 180);
    line([[-.95,.08,-.35],[-1.02,.55,-.25],[-.95,.96,0]], '#d9d1b9', .17);
    line([[-.95,.96,0],[-.85,.52,.28],[-.85,.08,.4]], '#c4bda7', .18);
    line([[-1.08,.07,-.37],[-.85,.07,-.37]], '#f6f6ee', .13);
    line([[-1,.07,.42],[-.7,.07,.42]], '#f6f6ee', .13);
    line([[-.95,.92,0],[-.85,1.38,0]], '#346e9d', .38);
    const head = pt(-.76,1.64,0);
    if (head) {
      ctx.fillStyle = '#d3a47e'; ctx.beginPath(); ctx.arc(head.x,head.y,focal*.13/head.z,0,Math.PI*2); ctx.fill();
      line([[-.9,1.76,0],[-.56,1.76,0]], '#f0f2e9', .09);
    }
    const hand = [-.49 + Math.sin(rotation)*.35, 1.05 + (1-Math.cos(rotation))*.32, 0];
    line([[-.85,1.42,-.13],[-.65,1.17,-.14],hand], '#d3a47e', .09);
    line([[-.85,1.42,.13],[-.62,1.16,.13],hand], '#e4b992', .09);
    const clubEnd = [hand[0] + Math.sin(.47 + rotation)*1.1, hand[1] - Math.cos(.47 + rotation)*1.1, 0];
    line([hand,clubEnd], '#d9e1e4', .025);
    line([clubEnd,[clubEnd[0]+.12,clubEnd[1]+.02,.03]], '#bac5ce', .085);
  }
  try { if (localStorage.getItem('teebox.playMode') === 'game') { $('#playMode').value = 'game'; $('#playMode').onchange(); } } catch (_) { /* optional storage */ }
  return { get enabled() { return enabled; }, reset, draw };
})();
