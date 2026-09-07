import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync, randomUUID } from 'node:crypto';
import { mkdirSync, unlinkSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';
const path = '/gestion-tests-12345678901234567890';
const salt = '0123456789abcdef0123456789abcdef';
const defaults = { DATA_FILE: ':memory:', ADMIN_PATH: path, ADMIN_PASSWORD_HASH: salt + ':' + scryptSync('correct-password', salt, 64).toString('hex'), TRUST_PROXY: 'true' };
async function setup(t, overrides = {}) {
  const app = createApp({ ...defaults, ...overrides }); await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.server.address().port; let closed = false;
  const close = async () => { if (!closed) { closed = true; await app.close(); } }; t.after(close);
  let cookie = '', csrf = '';
  async function api(endpoint, data, headers = {}) {
    return fetch(base + path + '/api/' + endpoint, { method: data ? 'POST' : 'GET', headers: { cookie, Origin: base, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...headers }, body: data ? JSON.stringify(data) : undefined });
  }
  async function login() { const res = await api('login', { password: 'correct-password' }); assert.equal(res.status, 200); assert.match(res.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/); cookie = res.headers.get('set-cookie').split(';')[0]; csrf = (await res.json()).csrf; }
  async function client(ip) {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws', { origin: base, headers: { 'x-real-ip': ip } });
    const messages = []; ws.on('message', raw => messages.push(JSON.parse(raw)));
    async function next(type) { const limit = Date.now() + 3000; while (Date.now() < limit) { const i = messages.findIndex(m => m.type === type); if (i >= 0) return messages.splice(i, 1)[0]; await new Promise(r => setTimeout(r, 5)); } throw new Error('Absent: ' + type); }
    await next('hello'); return { ws, next, send: m => ws.send(JSON.stringify(m)) };
  }
  return { app, close, base, api, login, client };
}
async function makeReport(ctx) {
  const a = await ctx.client('8.8.8.8'), b = await ctx.client('1.1.1.1'); a.send({ type: 'join' }); b.send({ type: 'join' });
  const match = await a.next('matched'); await b.next('matched');
  a.send({ type: 'report', room: match.room, reason: 'Autre', details: '<script>not executable</script>', ip: '9.9.9.9' });
  const result = await a.next('report-result'); assert.equal(result.ok, true); await b.next('left'); return { a, b, id: result.id };
}
test('admin requires auth, CSRF, same origin, and logout invalidates session', async t => {
  const ctx = await setup(t);
  assert.equal((await ctx.api('dashboard')).status, 401);
  assert.equal((await fetch(ctx.base + '/admin')).status, 404);
  assert.equal((await fetch(ctx.base + '/data/mingle.sqlite')).status, 404);
  assert.equal((await ctx.api('login', { password: 'bad' })).status, 401);
  await ctx.login();
  assert.equal((await ctx.api('dashboard')).status, 200);
  const settings = { operator: 'Test', contact: 'a@example.com', hosting: 'Test local', retentionDays: 7 };
  assert.equal((await ctx.api('settings', settings, { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await ctx.api('settings', settings, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await ctx.api('settings', settings)).status, 200);
  assert.equal((await (await fetch(ctx.base + '/api/privacy')).json()).operator, 'Test');
  await ctx.api('logout', {}); assert.equal((await ctx.api('dashboard')).status, 401);
});
test('reports use server IP, support review, ban, unban and deletion', async t => {
  const ctx = await setup(t); await ctx.login(); const { b, id } = await makeReport(ctx);
  const data = await (await ctx.api('dashboard')).json(); assert.equal(data.reports.length, 1); assert.equal(data.reports[0].ip, '1.1.1.1');
  assert.equal((await ctx.api('report', { id, action: 'update', status: 'reviewing', notes: 'À examiner' })).status, 200);
  assert.equal((await ctx.api('report', { id, action: 'ban', days: 1 })).status, 200); await b.next('banned');
  const c = await ctx.client('1.1.1.1'); c.send({ type: 'join' }); await c.next('banned');
  await ctx.api('unban', { ip: '1.1.1.1' }); c.send({ type: 'join' }); await c.next('waiting');
  await ctx.api('report', { id, action: 'delete' }); assert.equal((await (await ctx.api('dashboard')).json()).reports.length, 0);
});
test('fake room report is rejected and hidden country is not sent to peer', async t => {
  const ctx = await setup(t); const a = await ctx.client('8.8.8.8'), b = await ctx.client('1.1.1.1');
  a.send({ type: 'report', room: 'forged', reason: 'Autre', details: '' }); assert.equal((await a.next('report-result')).ok, false);
  a.send({ type: 'privacy', hideCountry: true }); a.send({ type: 'join' }); b.send({ type: 'join' }); await a.next('matched'); assert.equal((await b.next('matched')).country, null);
});
test('distinct visitors are opt-in, deduplicated and removed on withdrawal', async t => {
  const ctx = await setup(t); await ctx.login(); const a = await ctx.client('8.8.8.8');
  assert.equal((await (await ctx.api('dashboard')).json()).monthly[0].visitors, 0);
  const id = randomUUID(); a.send({ type: 'analytics', id }); a.send({ type: 'analytics', id });
  a.send({ type: 'join' }); await a.next('waiting');
  assert.equal((await (await ctx.api('dashboard')).json()).monthly[0].visitors, 1);
  a.send({ type: 'analytics', id, remove: true }); a.send({ type: 'leave' }); a.send({ type: 'join' }); await a.next('waiting');
  assert.equal((await (await ctx.api('dashboard')).json()).monthly[0].visitors, 0);
});
test('login throttles repeated failures', async t => {
  const ctx = await setup(t);
  for (let i = 0; i < 5; i++) assert.equal((await ctx.api('login', { password: 'wrong' })).status, 401);
  assert.equal((await ctx.api('login', { password: 'correct-password' })).status, 429);
});
test('reports survive restart and expire according to retention', async t => {
  mkdirSync('test-results', { recursive: true }); const file = './test-results/persistence-' + randomUUID() + '.sqlite';
  const first = await setup(t, { DATA_FILE: file }); const { id } = await makeReport(first); await first.close();
  const second = await setup(t, { DATA_FILE: file }); await second.login(); assert.equal((await (await second.api('dashboard')).json()).reports[0].id, id); await second.close();
  const db = new DatabaseSync(file); db.prepare('UPDATE reports SET created=?').run(Date.now() - 31 * 86400000); db.close();
  const third = await setup(t, { DATA_FILE: file }); await third.login(); assert.equal((await (await third.api('dashboard')).json()).reports.length, 0); await third.close();
  for (const suffix of ['', '-wal', '-shm']) { try { unlinkSync(file + suffix); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
});
