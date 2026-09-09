import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, createHash, createHmac, timingSafeEqual, scrypt } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const day = 86400000;
export const reasons = ['Nudité / contenu sexuel', 'Harcèlement / haine', 'Mineur présumé', 'Violence / menace', 'Spam / escroquerie', 'Autre'];
export function createManagement(env, online) {
  const filename = env.DATA_FILE || './data/mingle.sqlite';
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, room TEXT NOT NULL, reporter TEXT NOT NULL, ip TEXT NOT NULL, country TEXT, reason TEXT NOT NULL, details TEXT NOT NULL, created INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', notes TEXT NOT NULL DEFAULT '', UNIQUE(room,reporter));
    CREATE TABLE IF NOT EXISTS bans (ip TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS daily (date TEXT PRIMARY KEY, connections INTEGER NOT NULL DEFAULT 0, matches INTEGER NOT NULL DEFAULT 0, reports INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS visitors (month TEXT NOT NULL, token TEXT NOT NULL, PRIMARY KEY(month,token));
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, action TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS reports_created ON reports(created);
  `);
  const columns = db.prepare('PRAGMA table_info(daily)').all().map(column => column.name);
  for (const column of ['pageviews', 'peak']) if (!columns.includes(column)) db.exec(`ALTER TABLE daily ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
  const get = (key, fallback) => { const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? JSON.parse(row.value) : fallback; };
  const put = (key, value) => db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(key, JSON.stringify(value));
  const secret = get('secret', null) || randomBytes(32).toString('hex'); put('secret', secret);
  const adminPath = /^\/[a-zA-Z0-9_-]{20,100}$/.test(env.ADMIN_PATH || '') ? env.ADMIN_PATH : null;
  const passwordParts = (env.ADMIN_PASSWORD_HASH || '').split(':');
  const enabled = !!adminPath && passwordParts.length === 2 && /^[a-f0-9]{32}$/.test(passwordParts[0]) && /^[a-f0-9]{128}$/.test(passwordParts[1]);
  const sessions = new Map(), attempts = new Map(), reportRates = new Map();
  let globalLogin = { count: 0, until: 0 };
  const hash = value => createHash('sha256').update(value).digest('hex');
  const identity = (id, month) => createHmac('sha256', secret).update(month + ':' + id).digest('hex');
  function policy() { return { operator: get('operator', 'Aurora Web & Security'), contact: get('contact', 'aurorawebsec@gmail.com'), address: get('address', ''), hosting: get('hosting', ''), retentionDays: get('retentionDays', 30), analyticsMonths: 13, relayAvailable: !!(env.TURN_URLS && env.TURN_SECRET), relayRequired: env.RELAY_ONLY === 'true' }; }
  function purge() {
    const now = Date.now(), cutoff = now - policy().retentionDays * day;
    db.prepare('DELETE FROM reports WHERE created < ?').run(cutoff);
    db.prepare('DELETE FROM audit WHERE created < ?').run(cutoff);
    db.prepare('DELETE FROM bans WHERE expires <= ?').run(now);
    const oldest = new Date(); oldest.setUTCDate(1); oldest.setUTCMonth(oldest.getUTCMonth() - 12);
    db.prepare('DELETE FROM visitors WHERE month < ?').run(oldest.toISOString().slice(0, 7));
    db.prepare('DELETE FROM daily WHERE date < ?').run(oldest.toISOString().slice(0, 10));
    for (const [key, value] of sessions) if (value.expires < now) sessions.delete(key);
    for (const map of [attempts, reportRates]) for (const [key, value] of map) if (value.until < now) map.delete(key);
  }
  purge(); const timer = setInterval(purge, 60000); timer.unref();
  function count(field) {
    if (!['connections', 'matches', 'reports', 'pageviews'].includes(field)) return;
    db.prepare(`INSERT INTO daily(date,${field}) VALUES (?,1) ON CONFLICT(date) DO UPDATE SET ${field}=${field}+1`).run(new Date().toISOString().slice(0, 10));
  }
  function metrics() {
    const current = online(), today = new Date().toISOString().slice(0, 10);
    if (current.connected) recordPeak(current.connected);
    return { online: current, today: db.prepare('SELECT * FROM daily WHERE date=?').get(today) || { date: today, pageviews: 0, connections: 0, peak: 0, matches: 0, reports: 0 },
      monthly: db.prepare(`SELECT substr(date,1,7) AS month, SUM(pageviews) AS pageviews, SUM(connections) AS connections, MAX(peak) AS peak, SUM(matches) AS matches, SUM(reports) AS reports, (SELECT COUNT(*) FROM visitors v WHERE v.month=substr(d.date,1,7)) AS visitors FROM daily d GROUP BY month ORDER BY month DESC LIMIT 13`).all(),
      daily: db.prepare('SELECT * FROM daily ORDER BY date DESC LIMIT 31').all() };
  }
  function recordPeak(connected) {
    db.prepare('INSERT INTO daily(date,peak) VALUES (?,?) ON CONFLICT(date) DO UPDATE SET peak=MAX(peak,excluded.peak)').run(new Date().toISOString().slice(0, 10), connected);
  }
  const banned = ip => !!db.prepare('SELECT ip FROM bans WHERE ip=? AND expires>?').get(ip, Date.now());
  function visitor(id, remove = false) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) return;
    const date = new Date(); date.setUTCDate(1);
    if (!remove) { const month = date.toISOString().slice(0, 7); db.prepare('INSERT OR IGNORE INTO visitors VALUES (?,?)').run(month, identity(id, month)); return; }
    for (let i = 0; i < 13; i++) { const month = date.toISOString().slice(0, 7); db.prepare('DELETE FROM visitors WHERE month=? AND token=?').run(month, identity(id, month)); date.setUTCMonth(date.getUTCMonth() - 1); }
  }
  function report(c, m) {
    if (!c.peer || c.room !== m.room || !reasons.includes(m.reason) || typeof m.details !== 'string' || m.details.length > 1000) return { ok: false, message: 'Invalid report or conversation ended.' };
    const key = hash(c.ip), now = Date.now(); let rate = reportRates.get(key);
    if (!rate || rate.until < now) { rate = { count: 0, until: now + 3600000 }; reportRates.set(key, rate); }
    if (rate.count >= 5) return { ok: false, message: 'Report limit reached. Try again later.' };
    if (db.prepare('SELECT id FROM reports WHERE room=? AND reporter=?').get(c.room, c.id)) return { ok: false, message: 'This conversation has already been reported.' };
    const id = randomBytes(12).toString('hex');
    db.prepare('INSERT INTO reports(id,room,reporter,ip,country,reason,details,created) VALUES (?,?,?,?,?,?,?,?)').run(id, c.room, c.id, c.peer.ip, c.peer.country, m.reason, m.details.trim(), now);
    rate.count++; count('reports'); return { ok: true, id };
  }
  const json = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  async function body(req) {
    let chunks = [], size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 8192) throw new Error('Request too large'); chunks.push(chunk); }
    const value = JSON.parse(Buffer.concat(chunks).toString());
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request');
    return value;
  }
  async function route(req, res, path, ip) {
    if (path === '/api/privacy' && req.method === 'GET') { json(res, 200, policy()); return true; }
    if (!enabled || !path.startsWith(adminPath + '/api/')) return false;
    const endpoint = path.slice(adminPath.length + 5);
    const adminOrigin = env.ADMIN_ORIGIN || env.PUBLIC_ORIGIN;
    const expectedOrigin = adminOrigin || `http://${req.headers.host}`;
    if (req.method !== 'GET' && req.headers.origin !== expectedOrigin) { json(res, 403, { error: 'Origin rejected' }); return true; }
    const cookieName = adminOrigin?.startsWith('https:') ? '__Host-mingle_admin' : 'mingle_admin';
    const cookie = (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    const sessionKey = cookie ? hash(cookie) : '';
    const session = sessions.get(sessionKey);
    const secure = adminOrigin?.startsWith('https:') ? '; Secure' : '';
    try {
      if (endpoint === 'login' && req.method === 'POST') {
        const now = Date.now(), key = hash(ip);
        if (globalLogin.until < now) globalLogin = { count: 0, until: now + 600000 };
        let attempt = attempts.get(key);
        if (!attempt || attempt.until < now) { attempt = { count: 0, until: now + 600000 }; attempts.set(key, attempt); }
        if (attempt.count >= 5 || globalLogin.count >= 40) { json(res, 429, { error: 'Too many attempts. Try again in 10 minutes.' }); return true; }
        attempt.count++; globalLogin.count++;
        const input = await body(req);
        if (typeof input.password !== 'string' || input.password.length > 256) throw new Error('Invalid password');
        const computed = await derive(input.password, passwordParts[0], 64);
        if (!timingSafeEqual(computed, Buffer.from(passwordParts[1], 'hex'))) { json(res, 401, { error: 'Incorrect password' }); return true; }
        const token = randomBytes(32).toString('hex'), csrf = randomBytes(24).toString('hex');
        if (sessions.size >= 20) sessions.delete(sessions.keys().next().value);
        sessions.set(hash(token), { csrf, expires: now + 8 * 3600000 }); attempts.delete(key);
        res.setHeader('Set-Cookie', `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`);
        json(res, 200, { csrf }); return true;
      }
      if (!session || session.expires <= Date.now()) { sessions.delete(sessionKey); json(res, 401, { error: 'Sign-in required' }); return true; }
      if (req.method !== 'GET' && req.headers['x-csrf-token'] !== session.csrf) { json(res, 403, { error: 'Invalid session. Sign in again.' }); return true; }
      if (endpoint === 'session' && req.method === 'GET') json(res, 200, { csrf: session.csrf });
      else if (endpoint === 'metrics' && req.method === 'GET') { purge(); json(res, 200, metrics()); }
      else if (endpoint === 'logout' && req.method === 'POST') { sessions.delete(sessionKey); res.setHeader('Set-Cookie', `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`); json(res, 200, { ok: true }); }
      else if (endpoint === 'dashboard' && req.method === 'GET') {
        purge(); const url = new URL(req.url, 'http://localhost');
        const status = url.searchParams.get('status') || 'all';
        if (!['all', 'pending', 'reviewing', 'resolved', 'dismissed'].includes(status)) throw new Error('Filtre invalide');
        const page = Math.max(0, Math.min(100000, Number.parseInt(url.searchParams.get('page') || '0', 10) || 0));
        const where = status === 'all' ? '' : 'WHERE status=?', params = status === 'all' ? [] : [status];
        json(res, 200, { ...metrics(), policy: policy(), reports: db.prepare(`SELECT * FROM reports ${where} ORDER BY created DESC LIMIT 50 OFFSET ?`).all(...params, page * 50), totalReports: db.prepare(`SELECT COUNT(*) AS n FROM reports ${where}`).get(...params).n,
          bans: db.prepare('SELECT * FROM bans WHERE expires>? ORDER BY expires DESC LIMIT 200').all(Date.now()), audit: db.prepare('SELECT action,created FROM audit ORDER BY created DESC LIMIT 50').all() });
      } else if (endpoint === 'settings' && req.method === 'POST') {
        const input = await body(req);
        input.address ??= get('address', '');
        for (const key of ['operator', 'contact', 'address', 'hosting']) if (typeof input[key] !== 'string' || input[key].length > 500) throw new Error('Invalid information');
        if (input.contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contact)) throw new Error('Invalid email address');
        if (![7, 30, 90].includes(input.retentionDays)) throw new Error('Invalid duration');
        for (const key of ['operator', 'contact', 'address', 'hosting', 'retentionDays']) put(key, input[key]);
        db.prepare('INSERT INTO audit(action,created) VALUES (?,?)').run('Update privacy settings', Date.now()); purge(); json(res, 200, { ok: true });
      } else if (endpoint === 'report' && req.method === 'POST') {
        const input = await body(req); const row = db.prepare('SELECT * FROM reports WHERE id=?').get(String(input.id));
        if (!row) { json(res, 404, { error: 'Report not found' }); return true; }
        if (input.action === 'delete') db.prepare('DELETE FROM reports WHERE id=?').run(row.id);
        else if (input.action === 'ban') {
          if (![1, 7, 30].includes(input.days)) throw new Error('Invalid ban duration');
          db.prepare('INSERT OR REPLACE INTO bans VALUES (?,?)').run(row.ip, Date.now() + input.days * day);
          db.prepare("UPDATE reports SET status='resolved' WHERE id=?").run(row.id);
          online(row.ip);
        } else if (input.action === 'update') {
          if (!['pending', 'reviewing', 'resolved', 'dismissed'].includes(input.status) || typeof input.notes !== 'string' || input.notes.length > 2000) throw new Error('Invalid update');
          db.prepare('UPDATE reports SET status=?,notes=? WHERE id=?').run(input.status, input.notes, row.id);
        } else throw new Error('Invalid action');
        db.prepare('INSERT INTO audit(action,created) VALUES (?,?)').run(`${input.action} : report ${row.id}`, Date.now()); json(res, 200, { ok: true });
      } else if (endpoint === 'unban' && req.method === 'POST') {
        const input = await body(req); db.prepare('DELETE FROM bans WHERE ip=?').run(String(input.ip));
        db.prepare('INSERT INTO audit(action,created) VALUES (?,?)').run('Unban IP', Date.now()); json(res, 200, { ok: true });
      } else json(res, 404, { error: 'Not found' });
    } catch { json(res, 400, { error: 'Invalid request or operation failed.' }); }
    return true;
  }
  return { route, policy, count, recordPeak, report, visitor, banned, enabled, adminPath, close() { clearInterval(timer); db.close(); } };
}
