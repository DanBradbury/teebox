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
    : 'Hold mouse, pull down, push up, then release.';
  function status(text) { $('#gameStatus').textContent = text; }
  function power(value) {
    $('#gamePower').textContent = `${Math.round(value * 100)}%`;
    $('#gamePowerBar').style.width = `${value * 100}%`;
  }
  function reset() {
    swing = pending = stick = null;
    const oldPointer = pointer; pointer = null;
    if (oldPointer !== null && pad.hasPointerCapture(oldPointer)) pad.releasePointerCapture(oldPointer);
    strikeAt = finishAt = 0;
    $('#swingHandle').style.transform = '';
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
    pad.setPointerCapture(pointer); power(0);
    status('Pull down for power. Return straight up to strike.');
  };
  function move(e) {
    GolfSwing.move(swing, e.clientX, e.clientY);
    power(Math.min(1, swing.depth / 140));
    $('#swingHandle').style.transform = `translate(${Math.max(-80, Math.min(80, swing.error))}px, ${Math.max(-15, Math.min(155, e.clientY - swing.y))}px)`;
  }
  pad.onpointermove = (e) => { if (swing && e.pointerId === pointer) move(e); };
  pad.onpointerup = (e) => {
    if (!swing || e.pointerId !== pointer) return;
    move(e);
    const shot = GolfSwing.finish(swing, swingClub, P.CLUBS);
    const oldPointer = pointer; pointer = null; swing = null;
    pad.releasePointerCapture(oldPointer);
    $('#swingHandle').style.transform = '';
    if (!shot) { power(0); status('Swing cancelled. Pull down, then return upward before releasing.'); return; }
    launch(shot);
  };
  function launch(shot) {
    shot.aim = swingAim;
    pending = shot; strikeAt = performance.now() + 240; finishAt = strikeAt + 900;
    const tempo = shot.tempo !== undefined && shot.tempo < .95 ? ' · Slow tempo' : '';
    status(`${Math.round(shot.power * 100)}% power · ${Math.abs(shot.error) < .12 ? 'Pure strike' : shot.error < 0 ? 'Pulled left' : 'Pushed right'}${tempo}`);
  }
  pad.onpointercancel = pad.onlostpointercapture = () => { if (pointer !== null) reset(); };
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
      swingClub = $('#club').value; swingAim = Number(aim.value);
      status('Push the stick straight forward through the ball.');
    }
    if (stickSwinging()) {
      power(Math.min(1, stick.depth / GolfSwing.STICK.full));
      $('#swingHandle').style.transform = `translate(${rx * 80}px, ${Math.max(-15, Math.min(155, ry * 140))}px)`;
    } else if (was !== 'ready' || stick.phase !== 'ready') {
      $('#swingHandle').style.transform = '';
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
      pad.disabled = busy(); lastBusy = locked;
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
    if (pending) rotation = -2.5 * Math.max(0, (strikeAt - now) / 240);
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
