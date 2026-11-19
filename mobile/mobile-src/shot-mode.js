// Two-step shot for the iOS app: tap Shot to lock in club and aim, then swing on a large centred pad.
// The browser game's swing logic is untouched; this only shows, hides and enlarges its existing controls.
(() => {
  const hud = $('#gameHud'), pad = $('#swingPad');
  const btn = hud.appendChild(Object.assign(document.createElement('button'), { id: 'shotBtn', textContent: 'Shot' }));
  const scrim = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'shotScrim' }));
  const banner = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'shotBanner' }));
  banner.innerHTML = '<div><strong id="shotClub"></strong><span id="shotDetail"></span></div><button id="shotCancel">Cancel</button>';
  let on = false;

  function set(next) {
    on = next;
    document.body.classList.toggle('shot-mode', next);
    if (!next) return;
    $('#shotClub').textContent = `${$('#gameClubName').textContent} · ${$('#gameCarry').textContent} yd`;
    $('#shotDetail').textContent = `Aim ${$('#gameAimValue').textContent} · pull back, then push through`;
  }
  btn.onclick = () => {
    if (!game.enabled || $('#gameAim').disabled) return;   // a shot is in flight or a swing is under way
    window.Capacitor?.Plugins?.Haptics?.impact({ style: 'MEDIUM' }).catch(() => {});
    set(true);
  };
  $('#shotCancel').onclick = () => { game.reset(); set(false); };
  addEventListener('keydown', (e) => { if (on && e.key === 'Escape') set(false); });

  // The swing logic reads pull-back distance in pixels (140 px = full power), tuned for the small pad.
  // On the enlarged pad, hand it distances shrunk by the same factor the pad grew, so pulling to the bottom of the pad is full power,
  // then redraw the handle under the finger.
  let track = null, handleFrame = 0;
  const lens = (e, x, y) => { Object.defineProperty(e, 'clientX', { value: x }); Object.defineProperty(e, 'clientY', { value: y }); };
  const handle = $('#swingHandle');
  function placeHandle() {
    handleFrame = 0;
    if (!track) return;
    const r = pad.getBoundingClientRect();
    const dx = Math.max(-(r.width / 2 - 10), Math.min(r.width / 2 - 10, track.x - track.x0));
    const dy = Math.max(-15, Math.min(r.height - 60, track.y - track.y0));
    handle.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  document.addEventListener('pointerdown', (e) => {
    if (e.target !== pad || !on) return;
    const k = Math.max(1, (pad.getBoundingClientRect().height - 70) / 140);
    track = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, k };
  }, true);
  for (const type of ['pointermove', 'pointerup']) document.addEventListener(type, (e) => {
    if (!track || e.pointerId !== track.id) return;
    track.x = e.clientX; track.y = e.clientY;
    lens(e, track.x0 + (e.clientX - track.x0) / track.k, track.y0 + (e.clientY - track.y0) / track.k);
    if (type === 'pointermove' && !handleFrame) handleFrame = requestAnimationFrame(placeHandle);
    if (type === 'pointerup') track = null;
  }, true);
  document.addEventListener('pointercancel', () => { track = null; }, true);

  // Leave shot mode once the ball is away, or if the game or menu takes over.
  (function watch() {
    requestAnimationFrame(watch);
    if (on && (anim || !game.enabled || document.body.classList.contains('menu-open'))) set(false);
  })();
})();
