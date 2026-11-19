// Mouse-only play layered over the existing flight, terrain and round systems.
game = (() => {
  let enabled = false, swing = null, pointer = null, pending = null, strikeAt = 0, finishAt = 0;
  let swingClub = null, swingAim = 0, lastBusy = null, lastLie = null;
  const pad = $('#swingPad'), aim = $('#gameAim'), names = { DR: 'Driver', '3W': '3 Wood', '5W': '5 Wood', PW: 'P Wedge', SW: 'S Wedge' };
  const clubs = Object.keys(P.CLUBS);
  const busy = () => !!anim || !!pending;
  function status(text) { $('#gameStatus').textContent = text; }
  function power(value) {
    $('#gamePower').textContent = `${Math.round(value * 100)}%`;
    $('#gamePowerBar').style.width = `${value * 100}%`;
  }
  function reset() {
    swing = pending = null;
    const oldPointer = pointer; pointer = null;
    if (oldPointer !== null && pad.hasPointerCapture(oldPointer)) pad.releasePointerCapture(oldPointer);
    strikeAt = finishAt = 0;
    $('#swingHandle').style.transform = '';
    power(0);
    status('Hold mouse, pull down, push up, then release.');
  }
  function clubInfo() {
    const club = $('#club').value, c = P.CLUBS[club];
    $('#gameClubName').textContent = names[club] || `${club.slice(0, -1)} Iron`;
    $('#gameClubArt').dataset.kind = ['DR', '3W', '5W'].includes(club) ? 'wood' : ['PW', 'SW'].includes(club) ? 'wedge' : 'iron';
    const res = P.simulate({ speed: c[0], vla: c[1], hla: 0, backspin: c[2], sidespin: 0 }, conditions());
    $('#gameCarry').textContent = String(Math.round(res.carryYd));
  }
  function setAim(value) { aim.value = value; $('#gameAimValue').textContent = `${value > 0 ? '+' : ''}${value}°`; }
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
  for (const [id, direction] of [['#clubPrev', -1], ['#clubNext', 1]]) $(id).onclick = () => {
    if (busy() || swing) return;
    $('#club').value = clubs[(clubs.indexOf($('#club').value) + direction + clubs.length) % clubs.length];
    clubInfo();
  };
  $('#club').addEventListener('change', clubInfo);
  $('#condBox').addEventListener('change', clubInfo);
  aim.oninput = () => setAim(Number(aim.value));
  $('#aimReset').onclick = () => setAim(0);
  pad.onpointerdown = (e) => {
    if (!enabled || busy() || pointer !== null || e.button !== 0) return;
    e.preventDefault();
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
    shot.aim = swingAim;
    pending = shot; strikeAt = performance.now() + 240; finishAt = strikeAt + 900;
    status(`${Math.round(shot.power * 100)}% power · ${Math.abs(shot.error) < .12 ? 'Pure strike' : shot.error < 0 ? 'Pulled left' : 'Pushed right'}`);
  };
  pad.onpointercancel = pad.onlostpointercapture = () => { if (pointer !== null) reset(); };
  addEventListener('blur', () => { if (swing || pending) reset(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && (swing || pending)) reset(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') reset(); });

  function draw(now) {
    if (!enabled) return;
    if (pending && now >= strikeAt) { const shot = pending; pending = null; handleShot(shot); }
    const locked = busy() || !!swing;
    if (locked !== lastBusy) {
      for (const id of ['#clubPrev', '#clubNext', '#gameAim', '#aimReset']) $(id).disabled = locked;
      pad.disabled = busy(); lastBusy = locked;
      if (!locked && now > finishAt) status('Hold mouse, pull down, push up, then release.');
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
    const backswing = swing ? Math.min(1, swing.depth / 140) : 0;
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
