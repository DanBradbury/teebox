// iOS shell: a home screen with two paths over the same game engine and physics.
//   game      - a round on a course, hole bar on top, settings tucked into a menu sheet.
//   simulator - the full browser panel (range, launch monitor, conditions); Game mode is still one tap away.
(() => {
  const PATH_KEY = 'teebox.app.path';
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch (_) { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch (_) { /* storage optional */ } },
  };
  const playMode = $('#playMode'), sceneMode = $('#sceneMode'), top = $('#top');
  const setPlayMode = (value) => { playMode.value = value; playMode.onchange(); };
  const setScene = (value) => { sceneMode.value = value; sceneMode.onchange({ target: sceneMode }); };
  let path = null;

  // ---- DOM added by the shell ----
  const el = (tag, attrs = {}, html = '') => Object.assign(document.body.appendChild(document.createElement(tag)), attrs, { innerHTML: html });
  const home = el('main', { id: 'home' }, `
    <h1>Teebox</h1>
    <p class="tag">Golf you can swing at.</p>
    <button class="path-card" data-path="game"><strong>Play</strong><span>Play a round. Pick a club, aim, and swing with your finger.</span><em id="homeLast-game"></em></button>
    <button class="path-card" data-path="sim"><strong>Simulator</strong><span>Driving range, launch monitor shots, conditions and shot data.</span><em id="homeLast-sim"></em></button>`);
  const picker = el('section', { id: 'coursePicker', hidden: true }, `
    <button id="pickerBack" class="back">‹ Back</button>
    <h2>Choose a course</h2>
    <p class="lede">Pick where you want to play.</p>
    <div id="courseList"></div>`);
  const bar = el('header', { id: 'holeBar', hidden: true }, `
    <div class="hole-main"><strong id="holeBarTitle"></strong><span id="holeBarInfo"></span></div>
    <span id="holeBarRound"></span>
    <button id="menuBtn" aria-label="Menu">☰</button>`);
  const menuActions = el('div', { id: 'menuActions', hidden: true }, `
    <button id="menuCourses">Courses</button><button id="menuSim">Simulator</button><button id="menuHome">Home</button><button id="menuClose" class="primary">Resume</button>`);

  // ---- paths ----
  function updateBar() {
    $('#holeBarTitle').textContent = $('#holeSelect').value ? `Hole ${$('#holeSelect').value}` : 'Loading…';
    $('#holeBarInfo').textContent = $('#holeInfo').textContent;
    $('#holeBarRound').textContent = $('#roundInfo').textContent.split(' · ')[0];
  }
  for (const id of ['#holeInfo', '#roundInfo']) new MutationObserver(updateBar).observe($(id), { childList: true, characterData: true, subtree: true });
  $('#holeSelect').addEventListener('change', updateBar);

  function setMenu(open) {
    document.body.classList.toggle('menu-open', open);
    menuActions.hidden = !open;
    if (open) top.classList.remove('compact');
  }
  // ---- course picker (Play path) ----
  let catalog = [];
  fetch('/courses/index.json').then((r) => r.json()).then((all) => { catalog = all; renderCourses(); }).catch(() => {});
  const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CONTOURS = `<svg viewBox="0 0 400 250" aria-hidden="true">${[0, 1, 2, 3, 4, 5].map((i) =>
    `<ellipse cx="${150 + i * 14}" cy="${130 - i * 5}" rx="${190 - i * 30}" ry="${108 - i * 17}" fill="none" stroke="#dfe9d8" stroke-width="1.2" opacity=".3" transform="rotate(-14 200 125)"/>`).join('')}</svg>`;
  // Routing map: every hole's mapped tee -> green line, north up (same drawing as the web course list).
  function routing(course) {
    const lat0 = course.holes[0].line[0][1], squash = Math.cos(lat0 * Math.PI / 180);
    const all = course.holes.flatMap((hole) => hole.line);
    const xs = all.map((p) => p[0] * squash), ys = all.map((p) => p[1]);
    const west = Math.min(...xs), north = Math.max(...ys);
    const scale = Math.min(340 / (Math.max(...xs) - west), 200 / (north - Math.min(...ys)));
    const offX = (400 - (Math.max(...xs) - west) * scale) / 2, offY = (250 - (north - Math.min(...ys)) * scale) / 2;
    const at = ([lon, lat]) => [offX + (lon * squash - west) * scale, offY + (north - lat) * scale];
    const holes = course.holes.map((hole) => {
      const points = hole.line.map(at), tee = points[0], green = points[points.length - 1];
      return `<polyline points="${points.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="#e9f1e2" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>` +
        `<circle cx="${green[0].toFixed(1)}" cy="${green[1].toFixed(1)}" r="3.4" fill="#e9f1e2"/>` +
        `<text x="${tee[0].toFixed(1)}" y="${(tee[1] + 3).toFixed(1)}" font-size="8.5" text-anchor="middle" fill="#fff" stroke="#12301f" stroke-width="2.6" paint-order="stroke" font-family="system-ui,sans-serif" font-weight="600">${hole.number}</text>`;
    }).join('');
    return `<svg viewBox="0 0 400 250" role="img" aria-label="Course routing map">${holes}</svg>`;
  }
  function renderCourses() {
    $('#courseList').innerHTML = catalog.map((c) => `
      <button class="course-card${c.comingSoon ? ' soon' : ''}" data-handle="${esc(c.handle)}"${c.comingSoon ? ' disabled' : ''}>
        <div class="art" data-art="${esc(c.handle)}">${CONTOURS}</div>
        <div class="body">
          <div><h3>${esc(c.name)}</h3><div class="where">${esc([c.location, c.architect].filter(Boolean).join(' · '))}</div></div>
          <dl class="stats"><div><dt>Par</dt><dd>${esc(c.par ?? '–')}</dd></div><div><dt>Yards</dt><dd>${c.yards ? c.yards.toLocaleString('en-US') : '–'}</dd></div>
            <div><dt>Rating</dt><dd>${c.rating ? c.rating.toFixed(1) : '–'}</dd></div><div><dt>Slope</dt><dd>${esc(c.slope ?? '–')}</dd></div></dl>
          <div class="go">${c.comingSoon ? '<span class="tag">Coming soon</span><span></span>' : `<span>${esc(c.holes ?? 18)} holes · terrain mapped</span><span>Tee off →</span>`}</div>
        </div>
      </button>`).join('');
    for (const c of catalog.filter((item) => !item.comingSoon)) {
      fetch(`/courses/${encodeURIComponent(c.handle)}.json`).then((r) => r.json()).then((course) => {
        const art = document.querySelector(`[data-art="${CSS.escape(c.handle)}"]`);
        if (art) art.innerHTML = routing(course);
      }).catch(() => { /* keep the placeholder art */ });
    }
  }
  function showCourses() {
    path = null; setMenu(false); bar.hidden = true; home.hidden = true; picker.hidden = false;
    document.body.classList.remove('path-game', 'path-sim');
  }
  function startCourse(handle) {
    const select = $('#courseSelect');
    if (select.value !== handle) { select.value = handle; select.onchange({ target: select }); }
    enter('game');
  }
  picker.addEventListener('click', (e) => { const card = e.target.closest('.course-card'); if (card && !card.disabled) startCourse(card.dataset.handle); });
  $('#pickerBack').onclick = goHome;

  function enter(next) {
    path = next; store.set(PATH_KEY, next);
    home.hidden = true; picker.hidden = true; setMenu(false);
    document.body.classList.toggle('path-game', next === 'game');
    document.body.classList.toggle('path-sim', next === 'sim');
    bar.hidden = next !== 'game';
    if (next === 'game') { setScene('course'); setPlayMode('game'); updateBar(); }
    else { setScene(store.get('teebox.sim.scene') || 'range'); setPlayMode(store.get('teebox.sim.playMode') || 'simulator'); }
  }
  function goHome() {
    path = null; setMenu(false); bar.hidden = true; picker.hidden = true;
    document.body.classList.remove('path-game', 'path-sim');
    const last = store.get(PATH_KEY);
    for (const id of ['game', 'sim']) $(`#homeLast-${id}`).textContent = last === id ? 'Last played' : '';
    home.hidden = false;
  }
  // Simulator users keep their own mode and scene, independent of what the game path forces.
  playMode.addEventListener('change', () => { if (path === 'sim') store.set('teebox.sim.playMode', playMode.value); });
  sceneMode.addEventListener('change', () => { if (path === 'sim') store.set('teebox.sim.scene', sceneMode.value); });

  home.addEventListener('click', (e) => { const card = e.target.closest('[data-path]'); if (card) card.dataset.path === 'game' ? showCourses() : enter('sim'); });
  $('#menuBtn').onclick = () => setMenu(!document.body.classList.contains('menu-open'));
  $('#menuClose').onclick = () => setMenu(false);
  $('#menuHome').onclick = goHome;
  $('#menuCourses').onclick = showCourses;
  $('#menuSim').onclick = () => enter('sim');
  goHome();

  // ---- haptics ----
  const haptics = window.Capacitor?.Plugins?.Haptics;
  if (!haptics) return;
  const pad = $('#swingPad');
  pad.addEventListener('pointerdown', () => haptics.impact({ style: 'LIGHT' }).catch(() => {}));
  // game.js ticks at each quarter of the backswing and each follow-through dot, and strikes as the finger crosses the hitting zone.
  // The strike is a short heavy-heavy-medium rattle so it reads as contact, not just another tick.
  const tap = (style) => haptics.impact({ style }).catch(() => {});
  pad.addEventListener('swingtick', (e) => {
    if (e.detail !== 'strike') { tap('LIGHT'); return; }
    tap('HEAVY'); setTimeout(() => tap('HEAVY'), 55); setTimeout(() => tap('MEDIUM'), 120);
  });
})();
