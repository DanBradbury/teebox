// Driving Range proof of concept
//  - Listens on TCP 921 for GSPro "Open Connect" shot JSON (what SkyTrak connector software sends)
//  - Serves the range UI on http://localhost:3000 and pushes shots to it via Server-Sent Events
//  - No npm dependencies. Needs Node.js 18+.
const net = require('net');
const http = require('http');
const fs = require('fs');
const path = require('path');

const OC_PORT = parseInt(process.env.OC_PORT || process.argv[2] || '921', 10);
const WEB_PORT = parseInt(process.env.WEB_PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';   // set HOST=127.0.0.1 to keep everything local
const PUBLIC = path.join(__dirname, 'public');

const clients = new Set();           // SSE browser connections
let lmStatus = { connected: false, ready: false, ballDetected: false, device: '' };
let shotCount = 0;

function broadcast(obj) {
  const msg = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of clients) res.write(msg);
}

const num = (x) => (x === undefined || x === null || x === '' ? undefined : Number(x));

// GSPro Open Connect JSON -> our shot format (mph, degrees, rpm)
function normalize(msg) {
  const b = msg.BallData || {};
  const speed = num(b.Speed), vla = num(b.VLA), hla = num(b.HLA);
  if (![speed, vla, hla].every(Number.isFinite)) return null;
  let back = num(b.BackSpin), side = num(b.SideSpin);
  const total = num(b.TotalSpin), axis = num(b.SpinAxis);
  if (!Number.isFinite(back) || !Number.isFinite(side)) {
    if (Number.isFinite(total) && Number.isFinite(axis)) {
      back = total * Math.cos(axis * Math.PI / 180);
      side = total * Math.sin(axis * Math.PI / 180);
    } else { back = Number.isFinite(back) ? back : 0; side = Number.isFinite(side) ? side : 0; }
  }
  return {
    speed, vla, hla, backspin: back, sidespin: side,
    total: Number.isFinite(total) ? total : Math.hypot(back, side),
    axis: Number.isFinite(axis) ? axis : Math.atan2(side, back) * 180 / Math.PI,
    club: msg.Club || undefined,
    device: msg.DeviceID || 'launch monitor',
    source: 'launch-monitor',
  };
}

function handleMessage(msg, socket) {
  const o = msg.ShotDataOptions || {};
  lmStatus = { connected: true, device: msg.DeviceID || lmStatus.device,
    ready: o.LaunchMonitorIsReady !== false, ballDetected: !!o.LaunchMonitorBallDetected };
  broadcast({ type: 'status', ...lmStatus });
  if (o.IsHeartBeat || o.ContainsBallData === false) {
    socket.write(JSON.stringify({ Code: 200, Message: 'OK' }));
    return;
  }
  const shot = normalize(msg);
  if (!shot) { socket.write(JSON.stringify({ Code: 501, Message: 'Missing ball data' })); return; }
  shotCount++;
  console.log(`[shot ${shotCount}] ${shot.speed} mph  VLA ${shot.vla}  HLA ${shot.hla}  back ${Math.round(shot.backspin)}  side ${Math.round(shot.sidespin)}`);
  broadcast({ type: 'shot', shot });
  socket.write(JSON.stringify({ Code: 200, Message: 'Shot received', Player: { Handed: 'RH', Club: 'DR', DistanceToTarget: 0 } }));
}

// ---- TCP listener (acts like GSPro Connect) ----
const tcp = net.createServer((socket) => {
  console.log('Launch monitor client connected from', socket.remoteAddress);
  lmStatus.connected = true; broadcast({ type: 'status', ...lmStatus });
  let buf = '';
  socket.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    // messages are bare JSON objects, possibly several per packet: split by brace depth
    let depth = 0, start = -1, inStr = false, esc = false, i = 0;
    for (; i < buf.length; i++) {
      const c = buf[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') { if (depth === 0) start = i; depth++; }
      else if (c === '}') {
        depth--;
        if (depth === 0 && start >= 0) {
          try { handleMessage(JSON.parse(buf.slice(start, i + 1)), socket); } catch (e) { console.error('Bad JSON:', e.message); }
          start = -1;
        }
      }
    }
    buf = depth > 0 && start >= 0 ? buf.slice(start) : '';
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    console.log('Launch monitor client disconnected');
    lmStatus = { connected: false, ready: false, ballDetected: false, device: '' };
    broadcast({ type: 'status', ...lmStatus });
  });
});
tcp.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n!! Port ${OC_PORT} is already in use (is GSPro Connect running?). Close it, or start with a different port: node server.js 2483\n`);
  else console.error('TCP error:', e.message);
});
tcp.listen(OC_PORT, HOST, () => console.log(`Listening for launch monitor (GSPro Open Connect) on TCP ${OC_PORT}`));

// ---- HTTP: static files + SSE + test endpoint ----
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const web = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'status', ...lmStatus, port: OC_PORT })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url === '/api/shot' && req.method === 'POST') {   // handy for testing: POST a GSPro-format shot
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      try {
        const shot = normalize(JSON.parse(body));
        if (!shot) throw new Error('missing ball data');
        broadcast({ type: 'shot', shot }); res.writeHead(200); res.end('ok');
      } catch (e) { res.writeHead(400); res.end(String(e.message)); }
    });
    return;
  }
  const file = path.join(PUBLIC, url === '/' ? 'index.html' : url);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
web.listen(WEB_PORT, HOST, () => console.log(`Range view:  http://localhost:${WEB_PORT}`));
