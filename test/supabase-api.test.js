import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { scryptSync } from 'node:crypto';
import { createApi, requestIP } from '../lib/supabase-api.js';

const user = '00000000-0000-4000-8000-000000000001', session = '00000000-0000-4000-8000-000000000002';
const salt = '0123456789abcdef0123456789abcdef';
async function fixture(t, overrides = {}) {
  const calls = [], sessions = new Map(); let limited = false;
  const backend = {
    async user(token) { if (token !== 'valid-token') throw Object.assign(new Error('Session invalide'), { status: 401 }); return user; },
    async rpc(name, args = {}) {
      calls.push({ name, args });
      if (name === 'mingle_take_rate_limit') return !limited;
      if (name === 'mingle_open_session') return session;
      if (name === 'mingle_join') return { state: 'waiting' };
      if (name === 'mingle_public_settings') return { operator: 'Mingle', retentionDays: 30 };
      if (name === 'mingle_admin_session_create') sessions.set(args.p_token_hash, { csrf_hash: args.p_csrf_hash });
      if (name === 'mingle_admin_session_read') return sessions.get(args.p_token_hash) || null;
      if (name === 'mingle_admin_session_delete') sessions.delete(args.p_token_hash);
      if (name === 'mingle_metrics') return { online: { connected: 2, waiting: 0, conversations: 1 }, daily: [{ day: new Date().toISOString().slice(0, 10), pageviews: 4, peak: 2 }], monthly: [{ month: '2026-09-01', visitors: 2 }] };
      return null;
    }
  };
  let handler;
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const env = { PUBLIC_ORIGIN: origin, ADMIN_ORIGIN: origin, SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_example', SUPABASE_SERVICE_ROLE_KEY: 'never-export-me', SERVER_SECRET: 'a'.repeat(64), ADMIN_PASSWORD_HASH: salt + ':' + scryptSync('password-test', salt, 64).toString('hex'), ...overrides };
  const restart = () => { handler = createApi(env, backend); }; restart();
  const request = async (path, data, headers = {}) => {
    const response = await fetch(origin + '/api/' + path, { method: data === undefined ? 'GET' : 'POST', headers: { ...(data === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }), ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
    const text = await response.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status, headers: response.headers, body };
  };
  return { env, request, calls, restart, limit: () => { limited = true; } };
}

test('public config never exports a server key, including a mistaken public variable', async t => {
  const f = await fixture(t);
  const config = await f.request('config'); assert.equal(config.status, 200); assert.equal(config.body.key, f.env.SUPABASE_ANON_KEY);
  assert.doesNotMatch(JSON.stringify(config.body), /never-export-me/);
  f.env.SUPABASE_ANON_KEY = 'sb_secret_wrong';
  const invalid = await f.request('config'); assert.equal(invalid.status, 503); assert.doesNotMatch(JSON.stringify(invalid.body), /sb_secret_wrong/);
});

test('chat verifies JWT and origin, derives user and IP on server, and enforces adult declaration', async t => {
  const f = await fixture(t), auth = { Authorization: 'Bearer valid-token' };
  assert.equal((await f.request('chat', { action: 'open' })).status, 401);
  assert.equal((await f.request('chat', { action: 'open' }, { ...auth, Origin: 'https://evil.example' })).status, 403);
  const opened = await f.request('chat', { action: 'open', user: 'forged', ip: '203.0.113.99' }, { ...auth, 'X-Real-IP': '203.0.113.99', 'X-Forwarded-For': '203.0.113.99' });
  assert.equal(opened.status, 200);
  const call = f.calls.find(c => c.name === 'mingle_open_session'); assert.equal(call.args.p_user, user); assert.equal(call.args.p_ip, '127.0.0.1');
  assert.equal((await f.request('chat', { action: 'join', session }, auth)).status, 403);
  assert.equal((await f.request('chat', { action: 'join', session, adultConfirmed: true }, auth)).body.state, 'waiting');
  assert.equal((await f.request('chat', { action: 'report', session, room: session, reason: 'forged', details: '' }, auth)).status, 400);
  f.limit(); assert.equal((await f.request('chat', { action: 'open' }, auth)).status, 429);
});

test('contact form validates fields and calls the private storage RPC', async t => {
  const f = await fixture(t);
  const response = await f.request('contact', { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', message: 'Advertising inquiry' });
  assert.equal(response.status, 200);
  const call = f.calls.find(item => item.name === 'mingle_contact_create');
  assert.equal(call.args.p_first_name, 'Ada'); assert.equal(call.args.p_last_name, 'Lovelace'); assert.equal(call.args.p_email, 'ada@example.com');
  assert.equal((await f.request('contact', { firstName: '', lastName: 'Lovelace', email: 'bad', message: '' })).status, 400);
});

test('Vercel IP extraction prefers the platform-specific header and safely falls back to sanitized forwarding headers', () => {
  assert.equal(requestIP({ headers: { 'x-vercel-forwarded-for': '203.0.113.8', 'x-forwarded-for': '192.0.2.1' } }, { VERCEL: '1' }), '203.0.113.8');
  assert.equal(requestIP({ headers: { 'x-forwarded-for': '192.0.2.1' } }, { VERCEL: '1' }), '192.0.2.1');
  assert.throws(() => requestIP({ headers: {} }, { VERCEL: '1' }));
});


test('Vercel accepts the exact routed public origin without requiring a hard-coded PUBLIC_ORIGIN', async t => {
  const f = await fixture(t, { VERCEL: '1', PUBLIC_ORIGIN: undefined });
  const preview = 'preview-abc.vercel.app';
  const headers = {
    Authorization: 'Bearer valid-token',
    Origin: 'https://' + preview,
    'X-Vercel-Forwarded-For': '203.0.113.8',
    'X-Forwarded-Host': preview,
    'X-Forwarded-Proto': 'https'
  };
  const opened = await f.request('chat', { action: 'open' }, headers);
  assert.equal(opened.status, 200);
  const call = f.calls.find(c => c.name === 'mingle_open_session');
  assert.equal(call.args.p_ip, '203.0.113.8');

  const rejected = await f.request('chat', { action: 'open' }, { ...headers, Origin: 'https://evil.example' });
  assert.equal(rejected.status, 403);
});

test('admin host isolation, password, shared sessions, CSRF, metrics and logout', async t => {
  const f = await fixture(t);
  const origin = f.env.ADMIN_ORIGIN; f.env.ADMIN_ORIGIN = 'https://adminsecret.mingletv.app'; f.restart();
  assert.equal((await f.request('admin/session')).status, 404);
  f.env.ADMIN_ORIGIN = origin; f.restart();
  assert.equal((await f.request('admin/dashboard')).status, 401);
  assert.equal((await f.request('admin/login', { password: 'incorrect' })).status, 401);
  const login = await f.request('admin/login', { password: 'password-test' }); assert.equal(login.status, 200);
  const Cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  f.restart();
  const restored = await f.request('admin/session', undefined, { Cookie }); assert.equal(restored.body.csrf, login.body.csrf);
  assert.equal((await f.request('admin/logout', {}, { Cookie })).status, 403);
  const metrics = await f.request('admin/metrics', undefined, { Cookie }); assert.equal(metrics.body.today.pageviews, 4); assert.equal(metrics.body.monthly[0].month, '2026-09');
  const asset = await f.request('admin-assets/app.js'); assert.match(asset.body, /const base = '\/api\/admin\/'/);
  assert.equal((await f.request('admin/logout', {}, { Cookie, 'X-CSRF-Token': login.body.csrf })).status, 200);
  assert.equal((await f.request('admin/session', undefined, { Cookie })).status, 401);
});

test('analytics withdrawal deletes only monthly HMACs and never stores the browser ID', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('chat', { action: 'analytics', session, id: user, remove: true }, { Authorization: 'Bearer valid-token' })).status, 200);
  const calls = f.calls.filter(c => c.name === 'mingle_count_visitor'); assert.equal(calls.length, 13);
  assert.equal(new Set(calls.map(c => c.args.p_hash)).size, 13);
  for (const call of calls) { assert.match(call.args.p_hash, /^[a-f0-9]{64}$/); assert.equal(call.args.p_remove, true); assert.doesNotMatch(JSON.stringify(call.args), new RegExp(user)); }
});
