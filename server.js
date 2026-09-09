import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import geoip from 'geoip-lite';
import { isIP } from 'node:net';
import { createManagement } from './admin.js';

export function ipForRequest(req, env = process.env) {
  const value = env.TRUST_PROXY === 'true' ? req.headers['x-real-ip'] : req.socket.remoteAddress;
  const ip = typeof value === 'string' ? value.replace(/^::ffff:/, '') : '';
  return isIP(ip) ? ip : 'unknown';
}

export function countryForRequest(req, env = process.env) {
  // Enable only behind a proxy overwriting X-Real-IP, with direct access blocked.
  return geoip.lookup(ipForRequest(req, env))?.country || null;
}

export function createApp(env = process.env) {
  if (env.VERCEL) throw new Error('Le serveur de chat nécessite une instance persistante avec disque. Sur Vercel, utiliser npm run build pour publier uniquement l’interface. Voir VERCEL.md.');
  const clients = new Set();
  const waiting = new Set();
  const management = createManagement(env, banIP => {
    if (banIP) for (const c of clients) if (c.ip === banIP) { c.send(JSON.stringify({ type: 'banned' })); c.close(1008, 'Access suspended'); }
    return { connected: clients.size, waiting: waiting.size, conversations: [...clients].filter(c => c.peer).length / 2 };
  });
  const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/privacy.js': ['privacy.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
  for (const name of ['config', 'legal']) files[`/${name}.js`] = [`${name}.js`, 'text/javascript'];
  for (const name of ['terms', 'privacy', 'rules']) { files[`/${name}`] = [`${name}.html`, 'text/html']; files[`/${name}.html`] = files[`/${name}`]; }
  if (management.enabled) {
    files[management.adminPath] = ['admin.html', 'text/html'];
    files[management.adminPath + '/app.js'] = ['admin-app.js', 'text/javascript'];
    files[management.adminPath + '/style.css'] = ['admin.css', 'text/css'];
  }
  const send = (c, data) => { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(data)); };
  const stats = () => { for (const c of clients) send(c, { type: 'stats', online: clients.size }); };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self)');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const path = req.url?.split('?')[0];
    res.setHeader('Cache-Control', 'no-store');
    // Only the public policy and aggregate page counter are accessible cross-origin.
    if (['/api/privacy', '/api/visit'].includes(path)) {
      const expectedOrigin = env.PUBLIC_ORIGIN || `http://${req.headers.host}`;
      res.setHeader('Vary', 'Origin');
      if (req.headers.origin === expectedOrigin) res.setHeader('Access-Control-Allow-Origin', expectedOrigin);
      if (path === '/api/visit' && req.method === 'POST') {
        if (req.headers.origin !== expectedOrigin) { res.writeHead(403); return res.end(); }
        management.count('pageviews'); res.writeHead(204); return res.end();
      }
    }
    if (path?.startsWith(management.adminPath || '/__disabled')) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (await management.route(req, res, path, ipForRequest(req, env))) return;
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    if (path === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
    const file = files[path];
    if (!file) { res.writeHead(404); return res.end('Not found'); }
    try {
      let data = await readFile(new URL(`./public/${file[0]}`, import.meta.url));
      if (file[0] === 'admin.html') data = Buffer.from(data.toString().replaceAll('__ADMIN_PATH__', management.adminPath));
      res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': file[0].startsWith('admin') ? 'no-store' : 'no-cache' }); res.end(data);
    } catch { res.writeHead(500); res.end('Server error'); }
  });
  server.requestTimeout = 15000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32768 });
  server.on('upgrade', (req, socket, head) => {
    const expected = env.PUBLIC_ORIGIN || `http://${req.headers.host}`;
    if (req.url !== '/ws' || req.headers.origin !== expected || clients.size >= 2000) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  function leave(c) {
    waiting.delete(c);
    const peer = c.peer;
    c.peer = null; c.room = null;
    if (peer) { peer.peer = null; peer.room = null; send(peer, { type: 'left' }); }
  }
  function join(c, message) {
    if (message.adultConfirmed !== true) { send(c, { type: 'age-required' }); return; }
    if (management.banned(c.ip)) { send(c, { type: 'banned' }); return; }
    if (c.peer || waiting.has(c)) return;
    const candidates = [...waiting].filter(p => p !== c && p.readyState === WebSocket.OPEN && !c.blocked.has(p.id) && !p.blocked.has(c.id));
    const peer = candidates[Math.floor(Math.random() * candidates.length)];
    if (!peer) { waiting.add(c); send(c, { type: 'waiting' }); return; }
    waiting.delete(peer);
    const room = randomUUID(); c.peer = peer; peer.peer = c; c.room = peer.room = room;
    management.count('matches');
    send(c, { type: 'matched', room, initiator: true, country: peer.hideCountry ? null : peer.country }); send(peer, { type: 'matched', room, initiator: false, country: c.hideCountry ? null : c.country });
  }
  wss.on('connection', (c, req) => {
    c.country = countryForRequest(req, env);
    c.ip = ipForRequest(req, env);
    c.id = randomUUID(); c.blocked = new Set(); c.alive = true; c.window = Date.now(); c.count = 0;
    clients.add(c);
    management.count('connections');
    management.recordPeak(clients.size);
    const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    if (env.TURN_SECRET && env.TURN_URLS) {
      const username = `${Math.floor(Date.now() / 1000) + 86400}:${c.id}`;
      iceServers.push({ urls: env.TURN_URLS.split(','), username, credential: createHmac('sha1', env.TURN_SECRET).update(username).digest('base64') });
    }
    send(c, { type: 'hello', country: c.country, iceServers, iceTransportPolicy: env.RELAY_ONLY === 'true' ? 'relay' : 'all' }); stats();
    c.on('pong', () => { c.alive = true; });
    c.on('message', raw => {
      if (Date.now() - c.window > 10000) { c.window = Date.now(); c.count = 0; }
      if (++c.count > 150) return c.close(1008, 'Too many requests');
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.type === 'privacy') {
        c.hideCountry = m.hideCountry === true;
        if (c.peer) send(c.peer, { type: 'country', room: c.room, country: c.hideCountry ? null : c.country });
      }
      if (m.type === 'analytics') {
        if (m.remove === true) { management.visitor(m.id, true); if (c.analyticsId === m.id) c.analyticsId = null; }
        else if (!c.analyticsId || c.analyticsId === m.id) { management.visitor(m.id); c.analyticsId = m.id; }
      }
      if (m.type === 'report') {
        const result = management.report(c, m); send(c, { type: 'report-result', ...result });
        if (result.ok) { c.blocked.add(c.peer.id); leave(c); }
      }
      if (m.type === 'join') join(c, m);
      if (m.type === 'leave') leave(c);
      if (m.type === 'block' && c.peer && m.room === c.room) { c.blocked.add(c.peer.id); leave(c); send(c, { type: 'blocked' }); }
      if (!c.peer || m.room !== c.room) return;
      if (m.type === 'chat' && typeof m.text === 'string' && m.text.trim() && m.text.length <= 2000) {
        const message = { type: 'chat', room: c.room, text: m.text.trim(), time: Date.now() };
        send(c.peer, { ...message, own: false }); send(c, { ...message, own: true });
      }
      if (m.type === 'signal' && m.data && typeof m.data === 'object') {
        const { description, candidate } = m.data;
        if (description && ['offer', 'answer'].includes(description.type) && typeof description.sdp === 'string') send(c.peer, { type: 'signal', room: c.room, data: { description: { type: description.type, sdp: description.sdp } } });
        else if (candidate && typeof candidate.candidate === 'string') send(c.peer, { type: 'signal', room: c.room, data: { candidate } });
      }
    });
    c.on('error', () => {});
    c.on('close', () => { leave(c); clients.delete(c); stats(); });
  });
  const heartbeat = setInterval(() => { if (clients.size) management.recordPeak(clients.size); for (const c of clients) { if (!c.alive) c.terminate(); else { c.alive = false; c.ping(); } } }, 30000);
  heartbeat.unref();
  return { server, close: () => { clearInterval(heartbeat); for (const c of clients) c.terminate(); wss.close(); return new Promise(resolve => server.close(() => { management.close(); resolve(); })); } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.RELAY_ONLY === 'true' && (!process.env.TURN_SECRET || !process.env.TURN_URLS)) throw new Error('RELAY_ONLY nécessite TURN_SECRET et TURN_URLS.');
  const app = createApp();
  app.server.listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => console.log(`Mingle : http://localhost:${process.env.PORT || 3000}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { await app.close(); process.exit(0); });
}
