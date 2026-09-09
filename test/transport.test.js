import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = {};
const { MingleSocket } = await import('../client/supabase-transport.js');

test('stop cancels a queued search before it can join the shared queue', async () => {
  const socket = Object.assign(Object.create(MingleSocket.prototype), { readyState: 1, revision: 0, intent: 0, queue: Promise.resolve() });
  const calls = [];
  socket.api = async action => { calls.push(action); return { state: 'waiting' }; };
  socket.schedulePoll = () => {};
  socket.send(JSON.stringify({ type: 'join', adultConfirmed: true }));
  socket.send(JSON.stringify({ type: 'leave' }));
  await socket.queue;
  assert.deepEqual(calls, ['leave']); assert.equal(socket.searching, false);
});

test('skip ignores a match returned by an earlier in-flight join', async () => {
  const socket = Object.assign(Object.create(MingleSocket.prototype), { readyState: 1, revision: 0, intent: 0, queue: Promise.resolve() });
  let finish, accepted = false;
  socket.api = async action => action === 'join' ? new Promise(resolve => { finish = resolve; }) : null;
  socket.acceptState = async () => { accepted = true; };
  socket.schedulePoll = () => {};
  socket.send(JSON.stringify({ type: 'join', adultConfirmed: true }));
  await Promise.resolve();
  socket.send(JSON.stringify({ type: 'leave' }));
  finish({ state: 'matched', room: 'obsolete' });
  await socket.queue;
  assert.equal(accepted, false); assert.equal(socket.searching, false);
});


test('transport preserves the real failure reason when it closes', () => {
  const socket = Object.assign(Object.create(MingleSocket.prototype), { readyState: 0, revision: 0 });
  socket.dropRoom = () => {};
  let seenError, closed;
  socket.onerror = error => { seenError = error; };
  socket.onclose = event => { closed = event; };
  const error = Object.assign(new Error('Origin rejected'), { status: 403 });
  socket.fail(error);
  assert.equal(seenError.message, 'Origin rejected');
  assert.equal(closed.reason, 'Origin rejected');
  assert.equal(closed.status, 403);
});
