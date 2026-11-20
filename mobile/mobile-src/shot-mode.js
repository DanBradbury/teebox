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
    $('#shotDetail').textContent = `Aim ${$('#gameAimValue').textContent} · pull down the dots, swing up through the ball`;
  }
  btn.onclick = () => {
    if (!game.enabled || $('#gameAim').disabled) return;   // a shot is in flight or a swing is under way
    window.Capacitor?.Plugins?.Haptics?.impact({ style: 'MEDIUM' }).catch(() => {});
    set(true);
  };
  $('#shotCancel').onclick = () => { game.reset(); set(false); };
  addEventListener('keydown', (e) => { if (on && e.key === 'Escape') set(false); });

  // The swing logic reads pull-back distance in pixels (140 px = full power), tuned for the small pad.
  // On the enlarged pad, hand it distances shrunk by the factor game.js stretches its dotted guide by (pad.dataset.scale),
  // so the guide's last dot is full power and the handle stays under the finger.
  let track = null;
  const lens = (e, x, y) => { Object.defineProperty(e, 'clientX', { value: x }); Object.defineProperty(e, 'clientY', { value: y }); };
  document.addEventListener('pointerdown', (e) => {
    if (e.target !== pad || !on) return;
    const k = Number(pad.dataset.scale) || 1;
    track = { id: e.pointerId, x0: e.clientX, y0: e.clientY, k };
  }, true);
  for (const type of ['pointermove', 'pointerup']) document.addEventListener(type, (e) => {
    if (!track || e.pointerId !== track.id) return;
    lens(e, track.x0 + (e.clientX - track.x0) / track.k, track.y0 + (e.clientY - track.y0) / track.k);
    if (type === 'pointerup') track = null;
  }, true);
  document.addEventListener('pointercancel', () => { track = null; }, true);

  // Swing messages (cancelled, and so on) show in the bottom banner, since the HUD's status line is hidden in shot mode.
  new MutationObserver(() => { if (on) $('#shotDetail').textContent = $('#gameStatus').textContent; })
    .observe($('#gameStatus'), { childList: true, characterData: true, subtree: true });

  // Leave shot mode once the ball is away and the finger has lifted from the follow-through (after a beat,
  // so the strike shows on the pad), or if the game or menu takes over.
  let struckAt = 0;
  pad.addEventListener('swingtick', (e) => { if (e.detail === 'strike') struckAt = performance.now(); });
  (function watch() {
    requestAnimationFrame(watch);
    const away = anim && !pad.classList.contains('following') && performance.now() - struckAt > 450;
    if (on && (away || !game.enabled || document.body.classList.contains('menu-open'))) set(false);
  })();
})();
