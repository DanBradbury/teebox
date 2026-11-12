const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');

const OC = 40000 + Math.floor(Math.random() * 10000), WEB = OC + 1;
let server;

test.before(async () => {
  server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')],
    { env: { ...process.env, OC_PORT: String(OC), WEB_PORT: String(WEB), HOST: '127.0.0.1' }, stdio: 'pipe' });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('server did not start')), 5000);
    server.stdout.on('data', (d) => { if (String(d).includes('Range view')) { clearTimeout(t); res(); } });
  });
});
test.after(() => server.kill());

// collect SSE events from the server
function listen(events) {
  return new Promise((resolve) => {
    const req = http.get({ port: WEB, path: '/events', host: '127.0.0.1' }, (res) => {
      res.on('data', (d) => String(d).split('\n\n').forEach((c) => { if (c.startsWith('data: ')) events.push(JSON.parse(c.slice(6))); }));
      resolve(req);
    });
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (n, extra = {}) => JSON.stringify({ DeviceID: 'Test', ShotNumber: n, APIversion: '1',
  BallData: { Speed: 120, SpinAxis: 5, TotalSpin: 6000, HLA: -1, VLA: 18, ...extra },
  ShotDataOptions: { ContainsBallData: true, ContainsClubData: false, LaunchMonitorIsReady: true, LaunchMonitorBallDetected: true, IsHeartBeat: false } });

test('accepts Open Connect shots over TCP, even split across packets and glued together', async () => {
  const events = [], replies = [];
  const sse = await listen(events);
  const sock = net.connect(OC, '127.0.0.1');
  sock.on('data', (d) => replies.push(String(d)));
  await new Promise((r) => sock.on('connect', r));

  const a = shot(1), b = shot(2, { Speed: 140 });
  sock.write(a);                                     // whole message
  await wait(50);
  sock.write(b.slice(0, 30)); await wait(50);        // split message
  sock.write(b.slice(30) + '{"ShotDataOptions":{"IsHeartBeat":true,"ContainsBallData":false}}'); // + heartbeat
  await wait(300);

  const shots = events.filter((e) => e.type === 'shot').map((e) => e.shot);
  assert.equal(shots.length, 2);
  assert.equal(shots[0].speed, 120); assert.equal(shots[1].speed, 140);
  assert.ok(Math.abs(shots[0].backspin - 6000 * Math.cos(5 * Math.PI / 180)) < 1);   // derived from TotalSpin + SpinAxis
  assert.ok(replies.join('').includes('"Code":200'));
  assert.ok(events.some((e) => e.type === 'status' && e.connected && e.device === 'Test'));
  sock.destroy(); sse.destroy();
});

test('rejects a shot with missing ball data', async () => {
  const replies = [];
  const sock = net.connect(OC, '127.0.0.1'); sock.on('data', (d) => replies.push(String(d)));
  await new Promise((r) => sock.on('connect', r));
  sock.write(JSON.stringify({ BallData: { Speed: 100 }, ShotDataOptions: { ContainsBallData: true } }));
  await wait(200);
  assert.ok(replies.join('').includes('"Code":501'));
  sock.destroy();
});

test('HTTP test endpoint pushes a shot to the browser stream', async () => {
  const events = []; const sse = await listen(events);
  await new Promise((resolve, reject) => {
    const req = http.request({ port: WEB, host: '127.0.0.1', path: '/api/shot', method: 'POST' }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
    req.end(JSON.stringify({ BallData: { Speed: 100, VLA: 20, HLA: 0, BackSpin: 7000, SideSpin: 0 } }));
  });
  await wait(200);
  assert.ok(events.some((e) => e.type === 'shot' && e.shot.speed === 100));
  sse.destroy();
});

test('serves the UI and refuses path traversal', async () => {
  const get = (p) => new Promise((res) => http.get({ port: WEB, host: '127.0.0.1', path: p }, (r) => { r.resume(); res(r.statusCode); }));
  assert.equal(await get('/'), 200);
  assert.equal(await get('/physics.js'), 200);
  assert.equal(await get('/course.js'), 200);
  assert.equal(await get('/courses/index.json'), 200);
  assert.equal(await get('/courses/ancilhoffmangc.json'), 200);
  assert.equal(await get('/../server.js'), 404);
});
