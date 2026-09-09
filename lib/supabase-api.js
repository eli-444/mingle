import { createClient } from '@supabase/supabase-js';
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { isIP } from 'node:net';
import { readFile } from 'node:fs/promises';

const derive = promisify(scrypt);
const hash = value => createHash('sha256').update(value).digest('hex');
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const fail = (status, message) => Object.assign(new Error(message), { status });
const reasons = ['Nudité / contenu sexuel', 'Harcèlement / haine', 'Mineur présumé', 'Violence / menace', 'Spam / escroquerie', 'Autre'];

export function requestIP(req, env) {
  // Vercel sanitizes these headers. Never trust forwarded headers on local Node.
  const raw = env.VERCEL
    ? (req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.headers['x-real-ip'])
    : req.socket?.remoteAddress;
  const value = typeof raw === 'string' ? raw.split(',')[0].trim().replace(/^::ffff:/, '') : '';
  if (!isIP(value)) throw fail(400, 'Connection address unavailable.');
  return value;
}

function requestOrigin(req, env) {
  if (!env.VERCEL) return null;
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  if (!/^[A-Za-z0-9.-]+(?::\d+)?$/.test(host) || !['http', 'https'].includes(proto)) return null;
  return `${proto}://${host}`;
}

export function createBackend(env) {
  const serverKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
  if (!env.SUPABASE_URL || !serverKey || !env.SUPABASE_ANON_KEY || !env.SERVER_SECRET || env.SERVER_SECRET.length < 32) throw fail(503, 'Server configuration incomplete.');
  const client = createClient(env.SUPABASE_URL, serverKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(12000) }) }
  });
  return {
    async rpc(name, args = {}) {
      const { data, error } = await client.rpc(name, args);
      if (error) {
        if (error.message === 'Access suspended') throw fail(403, 'Access temporarily suspended.');
        if (/Session expired/.test(error.message)) throw fail(409, 'Session expired.');
        if (/rate limit/i.test(error.message)) throw fail(429, 'Too many requests. Try again later.');
        if (error.code === '42501') throw fail(403, 'Operation not permitted.');
        if (['23514', '22P02', 'P0001'].includes(error.code)) throw fail(400, 'Invalid request or conversation ended.');
        throw fail(503, 'Database temporarily unavailable.');
      }
      return data;
    },
    async user(token) {
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user) throw fail(401, 'Invalid visitor session.');
      return data.user.id;
    }
  };
}

async function readBody(req) {
  let value = req.body;
  if (value === undefined) {
    const parts = []; let size = 0;
    for await (const part of req) { size += part.length; if (size > 8192) throw fail(413, 'Request too large.'); parts.push(Buffer.from(part)); }
    value = Buffer.concat(parts).toString('utf8');
  }
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'string') { if (Buffer.byteLength(value) > 8192) throw fail(413, 'Request too large.'); try { value = JSON.parse(value); } catch { throw fail(400, 'Invalid JSON.'); } }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > 8192) throw fail(400, 'Invalid request.');
  return value;
}

function metrics(data) {
  const daily = data.daily.map(row => ({ ...row, date: row.day }));
  return { ...data, daily, monthly: data.monthly.map(row => ({ ...row, month: row.month.slice(0, 7) })), today: daily.find(row => row.date === new Date().toISOString().slice(0, 10)) || { pageviews: 0, peak: 0 } };
}

export function createApi(env = process.env, injected) {
  let backend = injected;
  const db = () => backend ||= createBackend(env);
  const rpc = (name, args) => db().rpc('mingle_' + name, args);
  const secretHash = value => createHmac('sha256', env.SERVER_SECRET || '').update(value).digest('hex');
  const rate = async (bucket, limit, seconds) => { if (!await rpc('take_rate_limit', { p_bucket: secretHash(bucket), p_limit: limit, p_seconds: seconds })) throw fail(429, 'Too many requests. Try again later.'); };
  const relay = () => ({ relayAvailable: !!(env.TURN_URLS && env.TURN_SECRET), relayRequired: env.RELAY_ONLY === 'true' });
  const adminOrigin = env.ADMIN_ORIGIN || 'https://adminsecret.mingletv.app';
  const publicOrigin = env.PUBLIC_ORIGIN || 'http://localhost:3000';
  const adminHost = new URL(adminOrigin).host;
  const adminEnabled = /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(env.ADMIN_PASSWORD_HASH || '');
  const secure = adminOrigin.startsWith('https:');
  const cookieName = secure ? '__Host-mingle_admin' : 'mingle_admin';
  const cookie = (token, age) => `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${secure ? '; Secure' : ''}`;

  return async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.searchParams.get('route') || url.pathname.replace(/^\/api\//, '');
      const isAdmin = path === 'admin-page' || path.startsWith('admin/') || path.startsWith('admin-assets/');
      if (isAdmin) {
        res.setHeader('X-Robots-Tag', 'noindex, nofollow');
        if (req.headers.host !== adminHost || !adminEnabled) throw fail(404, 'Not found');
      }
      if (req.method === 'POST') {
        const origin = req.headers.origin || '';
        const expected = isAdmin ? adminOrigin : publicOrigin;
        // Public Vercel calls are accepted only when the browser Origin matches the
        // exact host/protocol Vercel routed this request through. This keeps the CSRF
        // protection while allowing custom domains and Preview deployments without
        // having to hard-code PUBLIC_ORIGIN for every deployment URL.
        const sameVercelOrigin = !isAdmin && env.VERCEL && origin === requestOrigin(req, env);
        if (origin !== expected && !sameVercelOrigin) throw fail(403, 'Origin rejected');
        if (path !== 'visit' && !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail(415, 'JSON required.');
      }
      if (isAdmin && req.method === 'GET' && (path === 'admin-page' || path.startsWith('admin-assets/'))) {
        const files = { 'admin-page': ['admin.html', 'text/html'], 'admin-assets/app.js': ['admin-app.js', 'text/javascript'], 'admin-assets/style.css': ['admin.css', 'text/css'] };
        if (!files[path]) throw fail(404, 'Not found');
        let content = await readFile(new URL('../public/' + files[path][0], import.meta.url), 'utf8');
        if (path === 'admin-page') content = content.replaceAll('__ADMIN_PATH__', '/api/admin-assets');
        if (path === 'admin-assets/app.js') content = content.replace("location.pathname.replace(/\\/$/, '') + '/api/'", "'/api/admin/'");
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
        res.writeHead(200, { 'Content-Type': files[path][1] + '; charset=utf-8' }); return res.end(content);
      }
      if (path === 'config' && req.method === 'GET') {
        if (!env.SUPABASE_URL) throw fail(503, 'Supabase URL not configured.');
        let valid = /^sb_publishable_[A-Za-z0-9_-]+$/.test(env.SUPABASE_ANON_KEY || '');
        if (!valid) { try { valid = JSON.parse(Buffer.from(env.SUPABASE_ANON_KEY.split('.')[1], 'base64url').toString()).role === 'anon'; } catch {} }
        if (!valid) throw fail(503, 'Public key not configured.');
        return json(200, { url: env.SUPABASE_URL, key: env.SUPABASE_ANON_KEY });
      }
      if (path === 'privacy' && req.method === 'GET') return json(200, { ...await rpc('public_settings'), ...relay() });
      const ip = requestIP(req, env);
      if (path === 'visit' && req.method === 'POST') { await rate('visit:' + ip, 60, 60); await rpc('count_pageview'); return json(200, { ok: true }); }

      if (isAdmin) {
        const endpoint = path.slice('admin/'.length);
        const rawCookie = (req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1) || '';
        const token = /^[a-f0-9]{64}$/.test(rawCookie) ? rawCookie : '';
        if (endpoint === 'login' && req.method === 'POST') {
          await rate('admin-login:' + ip, 5, 600); await rate('admin-login-global', 40, 600);
          const input = await readBody(req);
          if (typeof input.password !== 'string' || input.password.length > 256) throw fail(400, 'Invalid password.');
          const [salt, stored] = env.ADMIN_PASSWORD_HASH.split(':');
          const computed = await derive(input.password, salt, 64);
          if (!timingSafeEqual(computed, Buffer.from(stored, 'hex'))) throw fail(401, 'Incorrect password');
          const fresh = randomBytes(32).toString('hex'), csrf = secretHash('csrf:' + fresh);
          await rpc('admin_session_create', { p_token_hash: hash(fresh), p_csrf_hash: hash(csrf) });
          res.setHeader('Set-Cookie', cookie(fresh, 28800)); return json(200, { csrf });
        }
        const session = token ? await rpc('admin_session_read', { p_token_hash: hash(token) }) : null;
        if (!session) throw fail(401, 'Sign-in required');
        const csrf = secretHash('csrf:' + token);
        if (session.csrf_hash !== hash(csrf)) throw fail(401, 'Sign-in required');
        if (req.method !== 'GET' && req.headers['x-csrf-token'] !== csrf) throw fail(403, 'Invalid session. Sign in again.');
        if (endpoint === 'session' && req.method === 'GET') return json(200, { csrf });
        if (endpoint === 'metrics' && req.method === 'GET') return json(200, metrics(await rpc('metrics')));
        if (endpoint === 'dashboard' && req.method === 'GET') {
          const data = metrics(await rpc('admin_dashboard', { p_status: url.searchParams.get('status') || 'all', p_page: Number(url.searchParams.get('page') || 0) }));
          data.policy = { ...data.policy, ...relay() };
          data.reports = data.reports.map(r => ({ id: r.id, reason: r.reason, details: r.details, status: r.status, notes: r.notes, ip: r.reported_ip, country: r.reported_country, created: r.created_at }));
          data.bans = data.bans.map(b => ({ ip: b.ip, expires: b.expires_at }));
          data.audit = data.audit.map(a => ({ action: a.action, created: a.created_at }));
          return json(200, data);
        }
        if (req.method !== 'POST') throw fail(404, 'Not found');
        const input = await readBody(req), p_actor = 'admin';
        if (endpoint === 'logout') {
          await rpc('admin_session_delete', { p_token_hash: hash(token) }); res.setHeader('Set-Cookie', cookie('', 0));
        } else if (endpoint === 'settings') {
          for (const k of ['operator', 'contact', 'address', 'hosting']) if (typeof input[k] !== 'string' || input[k].length > 500) throw fail(400, 'Invalid information.');
          if (input.contact && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contact)) throw fail(400, 'Invalid email address.');
          if (![7, 30, 90].includes(input.retentionDays)) throw fail(400, 'Invalid duration.');
          await rpc('admin_settings', { p_operator: input.operator, p_contact: input.contact, p_address: input.address, p_hosting: input.hosting, p_retention_days: input.retentionDays, p_actor });
        } else if (endpoint === 'unban') {
          if (!isIP(input.ip || '')) throw fail(400, 'Invalid IP.');
          await rpc('admin_unban', { p_ip: input.ip, p_actor });
        } else if (endpoint === 'report') {
          if (!uuid(input.id)) throw fail(400, 'Invalid report.');
          if (input.action === 'delete') await rpc('admin_delete_report', { p_report: input.id, p_actor });
          else if (input.action === 'ban' && [1, 7, 30].includes(input.days)) await rpc('admin_ban', { p_report: input.id, p_days: input.days, p_actor });
          else if (input.action === 'update' && ['pending', 'reviewing', 'resolved', 'dismissed'].includes(input.status) && typeof input.notes === 'string' && input.notes.length <= 2000) await rpc('admin_review', { p_report: input.id, p_status: input.status, p_notes: input.notes, p_actor });
          else throw fail(400, 'Invalid action.');
        } else throw fail(404, 'Not found');
        return json(200, { ok: true });
      }

      if (path !== 'chat' || req.method !== 'POST') throw fail(404, 'Not found');
      await rate('api:' + ip, 300, 60);
      const token = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(req.headers.authorization || '')?.[1];
      if (!token || token.length > 8192) throw fail(401, 'Sign-in required');
      const p_user = await db().user(token), input = await readBody(req);
      if (input.action === 'open') {
        await rate('open:' + ip, 30, 600);
        const country = env.VERCEL && /^[A-Z]{2}$/.test(req.headers['x-vercel-ip-country'] || '') ? req.headers['x-vercel-ip-country'] : null;
        if (env.RELAY_ONLY === 'true' && !relay().relayAvailable) throw fail(503, 'Video relay not configured.');
        const id = await rpc('open_session', { p_user, p_ip: ip, p_country: country, p_hide_country: input.hideCountry === true });
        const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
        if (relay().relayAvailable) {
          const username = `${Math.floor(Date.now() / 1000) + 86400}:${id}`;
          iceServers.push({ urls: env.TURN_URLS.split(',').map(s => s.trim()), username, credential: createHmac('sha1', env.TURN_SECRET).update(username).digest('base64') });
        }
        return json(200, { id, country, iceServers, iceTransportPolicy: env.RELAY_ONLY === 'true' ? 'relay' : 'all' });
      }
      if (!uuid(input.session)) throw fail(400, 'Invalid session.');
      const params = { p_user, p_session: input.session };
      if (input.action === 'state') {
        if (input.heartbeat === true) await rpc('heartbeat', params);
        return json(200, await rpc('session_state', params));
      }
      if (input.action === 'join') {
        await rate('join:' + p_user, 30, 60);
        if (input.adultConfirmed !== true) throw fail(403, 'Confirm your age before searching.');
        return json(200, await rpc('join', { ...params, p_adult: true }));
      }
      if (input.action === 'leave') await rpc('leave', { ...params, p_stop: input.stop === true });
      else if (input.action === 'privacy') await rpc('set_privacy', { ...params, p_hide_country: input.hideCountry === true });
      else if (input.action === 'report') {
        if (!uuid(input.room) || !reasons.includes(input.reason) || typeof input.details !== 'string' || input.details.length > 1000) throw fail(400, 'Invalid report.');
        const id = await rpc('report', { ...params, p_room: input.room, p_reason: input.reason, p_details: input.details.trim() });
        return json(200, { ok: true, id });
      } else if (input.action === 'analytics') {
        if (!uuid(input.id)) throw fail(400, 'Invalid identifier.');
        await rate('analytics:' + p_user, 20, 60);
        const date = new Date(); date.setUTCDate(1);
        for (let i = 0; i < (input.remove === true ? 13 : 1); i++) {
          const month = date.toISOString().slice(0, 10);
          await rpc('count_visitor', { p_month: month, p_hash: secretHash('visitor:' + month + ':' + input.id), p_remove: input.remove === true });
          date.setUTCMonth(date.getUTCMonth() - 1);
        }
      } else throw fail(400, 'Invalid action.');
      return json(200, { ok: true });
    } catch (error) {
      return json(error.status || 503, { error: error.status ? error.message : 'Service temporarily unavailable.' });
    }
  };
}
