import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createApp, countryForRequest } from '../server.js';

async function setup(t, env = {}) {
  const app = createApp({ DATA_FILE: ':memory:', ...env }); await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(() => app.close());
  async function client(headers = {}) {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws', { origin: base, headers });
    const inbox = []; ws.on('message', raw => inbox.push(JSON.parse(raw)));
    const next = async type => {
      const deadline = Date.now() + 2500;
      while (Date.now() < deadline) { const i = inbox.findIndex(m => m.type === type); if (i !== -1) return inbox.splice(i, 1)[0]; await new Promise(r => setTimeout(r, 5)); }
      throw new Error(`Message absent : ${type}`);
    };
    const hello = await next('hello');
    return { ws, inbox, next, hello, send: m => ws.send(JSON.stringify(m)), join: () => ws.send(JSON.stringify({ type: 'join' })) };
  }
  return { base, client };
}
test('serves the application, health and security headers', async t => {
  const { base } = await setup(t);
  const page = await fetch(base); assert.equal(page.status, 200); assert.match(await page.text(), /Mingle/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(base + '/.env')).status, 404);
  assert.deepEqual(await (await fetch(base + '/health')).json(), { ok: true });
});
test('pairs two strangers, isolates messages, relays signaling and handles next', async t => {
  const { client } = await setup(t); const a = await client(); const b = await client(); const c = await client();
  a.join(); await a.next('waiting'); b.join();
  const ma = await a.next('matched'); const mb = await b.next('matched');
  assert.equal(ma.room, mb.room); assert.notEqual(ma.initiator, mb.initiator);
  a.send({ type: 'chat', room: ma.room, text: '<img src=x onerror=alert(1)>' });
  assert.equal((await b.next('chat')).text, '<img src=x onerror=alert(1)>'); assert.equal((await a.next('chat')).own, true);
  assert.equal(c.inbox.some(m => m.type === 'chat'), false);
  a.send({ type: 'signal', room: ma.room, data: { description: { type: 'offer', sdp: 'test-sdp' } } });
  assert.equal((await b.next('signal')).data.description.sdp, 'test-sdp');
  a.send({ type: 'leave' }); await b.next('left'); c.join(); await c.next('waiting'); a.join();
  const mc = await c.next('matched'); await a.next('matched'); assert.notEqual(mc.room, ma.room);
  a.send({ type: 'chat', room: ma.room, text: 'stale' }); a.send({ type: 'chat', room: mc.room, text: 'current' });
  assert.equal((await c.next('chat')).text, 'current');
});
test('disconnect removes queued users and notifies partners', async t => {
  const { client } = await setup(t); const a = await client(); const b = await client();
  a.join(); await a.next('waiting'); b.join(); await a.next('matched'); await b.next('matched');
  a.ws.close(); await b.next('left'); b.join(); await b.next('waiting');
});
test('block prevents matching the same connection again', async t => {
  const { client } = await setup(t); const a = await client(); const b = await client();
  a.join(); b.join(); const { room } = await a.next('matched'); await b.next('matched');
  a.send({ type: 'block', room }); await a.next('blocked'); await b.next('left');
  a.join(); b.join(); await a.next('waiting'); await b.next('waiting');
  const c = await client(); c.join(); await c.next('matched');
});
test('rejects cross-origin connections', async t => {
  const { base } = await setup(t);
  await new Promise((resolve, reject) => { const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws', { origin: 'https://evil.example' }); ws.on('open', () => { ws.close(); reject(new Error('Accepted bad origin')); }); ws.on('error', e => { assert.match(e.message, /403/); resolve(); }); });
});
test('malformed input is ignored and joining needs only one request', async t => {
  const { client } = await setup(t); const a = await client(); const b = await client();
  a.ws.send('not json'); a.ws.send('null'); b.join(); await b.next('waiting');
  a.send({ type: 'join' }); await a.next('matched'); await b.next('matched');
});
test('country lookup ignores spoofed headers unless proxy trust is enabled', () => {
  const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-real-ip': '8.8.8.8' } };
  assert.equal(countryForRequest(req, {}), null);
  assert.equal(countryForRequest(req, { TRUST_PROXY: 'true' }), 'US');
  assert.equal(countryForRequest({ socket: { remoteAddress: '::ffff:8.8.8.8' }, headers: {} }, {}), 'US');
});
test('each partner receives the other country without their IP address', async t => {
  const { client } = await setup(t, { TRUST_PROXY: 'true' });
  const a = await client({ 'x-real-ip': '8.8.8.8' }); const b = await client();
  assert.equal(a.hello.country, 'US'); assert.equal(b.hello.country, null);
  a.join(); b.join(); const ma = await a.next('matched'); const mb = await b.next('matched');
  assert.equal(ma.country, null); assert.equal(mb.country, 'US');
  assert.equal(JSON.stringify(mb).includes('8.8.8.8'), false);
});
test('TURN credentials are temporary, with secret never sent to browser', async t => {
  const { client } = await setup(t, { TURN_SECRET: 'test-secret', TURN_URLS: 'turn:example.com:3478', RELAY_ONLY: 'true' });
  const { hello } = await client(); assert.equal(hello.iceTransportPolicy, 'relay'); assert.equal(hello.iceServers.length, 2);
  assert.ok(Number(hello.iceServers[1].username.split(':')[0]) > Date.now() / 1000);
  assert.equal(JSON.stringify(hello).includes('test-secret'), false);
});
