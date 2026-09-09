import { createClient } from '@supabase/supabase-js';

// Socket-shaped adapter: Realtime carries only the current duo's ephemeral data.
export class MingleSocket {
  constructor() {
    this.readyState = 0; this.queue = Promise.resolve(); this.revision = 0; this.intent = 0; this.lastHeartbeat = 0;
    this.start().catch(error => this.fail(error));
  }
  emit(message) { if (this.readyState !== 3) this.onmessage?.({ data: JSON.stringify(message) }); }
  enqueue(task) {
    this.queue = this.queue.then(() => this.readyState !== 3 && task()).catch(error => this.fail(error));
    return this.queue;
  }
  async api(action, values = {}, keepalive = false) {
    if (!this.accessToken) throw new Error('Visitor session unavailable.');
    const response = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.accessToken },
      body: JSON.stringify({ ...values, session: this.session, action }), keepalive,
      signal: keepalive ? undefined : AbortSignal.timeout(15000)
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
    if (!response.ok) throw Object.assign(new Error(data.error || `Service unavailable (${response.status}).`), { status: response.status });
    return data;
  }
  async start() {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) throw new Error('Configuration unavailable.');
    const config = await response.json();
    if (this.readyState === 3) return;
    this.client = createClient(config.url, config.key, { auth: { storage: sessionStorage, storageKey: 'mingle.auth', detectSessionInUrl: false } });
    let { data: { session } } = await this.client.auth.getSession();
    if (!session) {
      const result = await this.client.auth.signInAnonymously();
      if (result.error) throw new Error('Anonymous sign-in unavailable. Check the Supabase Auth settings.');
      session = result.data.session;
    }
    if (this.readyState === 3) return;
    this.accessToken = session.access_token;
    await this.client.realtime.setAuth(this.accessToken);
    this.authSubscription = this.client.auth.onAuthStateChange((_event, value) => {
      if (value) { this.accessToken = value.access_token; queueMicrotask(() => this.client.realtime.setAuth(value.access_token).catch(error => this.fail(error))); }
    }).data.subscription;
    const hello = await this.api('open', { hideCountry: window.minglePrivacy?.get().hideCountry === true });
    this.session = hello.id;
    if (this.readyState === 3) { await this.api('leave', { stop: true }, true).catch(() => {}); return; }
    this.readyState = 1;
    this.emit({ ...hello, type: 'hello' });
    this.schedulePoll();
  }
  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (this.readyState !== 1) return;
    this.pollTimer = setTimeout(() => {
      this.enqueue(async () => {
        const revision = this.revision;
        const heartbeat = Date.now() - this.lastHeartbeat > 25000;
        const state = await this.api('state', { heartbeat });
        if (heartbeat) this.lastHeartbeat = Date.now();
        if (revision === this.revision) await this.acceptState(state);
      }).finally(() => this.schedulePoll());
    }, this.searching || this.room ? 2000 : 25000);
  }
  async acceptState(state) {
    if (state.state === 'banned') { this.emit({ type: 'banned' }); this.close(); return; }
    if (state.state === 'expired' || state.state === 'stopped') throw new Error('Session expired.');
    if (state.state === 'matched') {
      if (this.room === state.room) { this.match.country = state.country; this.emit({ type: 'country', room: state.room, country: state.country }); }
      else await this.subscribeRoom(state);
    } else {
      if (this.room || (this.searching && state.state !== 'waiting')) { this.dropRoom(); this.emit({ type: 'left' }); }
      this.searching = state.state === 'waiting';
      if (this.searching) this.emit({ type: 'waiting' });
    }
  }
  dropRoom() {
    this.revision++; clearInterval(this.readyTimer); clearTimeout(this.roomTimer);
    const old = this.channel;
    this.channel = null; this.room = null; this.match = null; this.delivered = false;
    if (old) this.client.removeChannel(old).catch(() => {});
  }
  deliverMatch() {
    if (this.delivered || !this.match) return;
    this.delivered = true; clearTimeout(this.roomTimer);
    this.emit({ ...this.match, type: 'matched' });
  }
  async subscribeRoom(state) {
    this.dropRoom(); this.room = state.room; this.match = state; this.searching = false;
    const revision = this.revision;
    const channel = this.client.channel(state.topic, { config: { private: true, broadcast: { self: false, ack: true } } });
    this.channel = channel;
    let windowStart = Date.now(), count = 0;
    channel.on('broadcast', { event: 'duo' }, ({ payload }) => {
      if (revision !== this.revision || !payload || payload.room !== this.room) return;
      if (Date.now() - windowStart > 10000) { count = 0; windowStart = Date.now(); }
      if (++count > 150 || JSON.stringify(payload).length > 32768) return;
      if (payload.type === 'ready') { this.deliverMatch(); return; }
      if (payload.type === 'signal' && payload.data && typeof payload.data === 'object') {
        const { description, candidate } = payload.data; let data;
        if (description && ['offer', 'answer'].includes(description.type) && typeof description.sdp === 'string' && description.sdp.length <= 30000) data = { description: { type: description.type, sdp: description.sdp } };
        else if (candidate && typeof candidate.candidate === 'string' && candidate.candidate.length <= 4096 && (candidate.sdpMid == null || typeof candidate.sdpMid === 'string') && (candidate.sdpMLineIndex == null || Number.isInteger(candidate.sdpMLineIndex))) data = { candidate: { candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex } };
        if (data) { this.deliverMatch(); this.emit({ type: 'signal', room: this.room, data }); }
      }
      if (payload.type === 'chat' && typeof payload.text === 'string' && payload.text.trim() && payload.text.length <= 2000) {
        this.deliverMatch(); this.emit({ type: 'chat', room: this.room, text: payload.text.trim(), own: false });
      }
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Private connection unavailable.')), 12000);
      channel.subscribe(status => {
        if (revision !== this.revision) { clearTimeout(timeout); resolve(); return; }
        if (status === 'SUBSCRIBED') { clearTimeout(timeout); resolve(); }
        else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
          clearTimeout(timeout); const error = new Error('Private conversation disconnected.'); reject(error);
          if (this.delivered) this.fail(error);
        }
      });
    });
    if (revision !== this.revision) return;
    // Repeated readiness avoids sending an offer before the peer subscribes.
    const ready = () => { if (revision === this.revision) channel.send({ type: 'broadcast', event: 'duo', payload: { type: 'ready', room: state.room } }).catch(() => {}); };
    ready(); this.readyTimer = setInterval(ready, 1000);
    this.roomTimer = setTimeout(() => { if (!this.delivered && revision === this.revision) this.fail(new Error('Your partner is not responding.')); }, 20000);
  }
  send(raw) {
    if (this.readyState !== 1) return;
    const message = JSON.parse(raw);
    if (message.type === 'chat' || message.type === 'signal') {
      const channel = this.channel, revision = this.revision;
      if (!channel || message.room !== this.room) return;
      channel.send({ type: 'broadcast', event: 'duo', payload: message }).then(status => {
        if (revision !== this.revision) return;
        if (status !== 'ok') { this.fail(new Error('Sending failed.')); return; }
        if (message.type === 'chat') this.emit({ type: 'chat', room: message.room, text: message.text, own: true });
      }).catch(error => this.fail(error));
      return;
    }
    if (message.type === 'leave') { this.intent++; this.dropRoom(); this.searching = false; }
    const intent = this.intent;
    this.enqueue(async () => {
      if (message.type === 'join') {
        if (intent !== this.intent) return;
        const revision = this.revision;
        this.searching = true;
        const state = await this.api('join', message);
        if (revision === this.revision && intent === this.intent) await this.acceptState(state);
        this.schedulePoll();
      } else if (message.type === 'leave') { this.dropRoom(); this.searching = false; await this.api('leave'); }
      else if (message.type === 'privacy' || message.type === 'analytics') await this.api(message.type, message);
      else if (message.type === 'report') {
        try { const result = await this.api('report', message); this.dropRoom(); this.searching = false; this.emit({ type: 'report-result', ...result }); }
        catch (error) { this.emit({ type: 'report-result', ok: false, message: error.message }); }
      }
    });
  }
  fail(error) {
    if (this.readyState === 3) return;
    const normalized = error instanceof Error ? error : new Error('Connection unavailable.');
    this.lastError = normalized;
    if (normalized.status === 401) { try { sessionStorage.removeItem('mingle.auth'); } catch {} }
    if (normalized.status === 403 && /suspended/.test(normalized.message)) this.emit({ type: 'banned' });
    else this.onerror?.(normalized);
    this.close(normalized);
  }
  close(reason) {
    if (this.readyState === 3) return;
    this.readyState = 3; clearTimeout(this.pollTimer); this.dropRoom();
    if (this.session && this.accessToken) this.api('leave', { stop: true }, true).catch(() => {});
    this.authSubscription?.unsubscribe(); this.client?.auth.stopAutoRefresh(); this.client?.realtime.disconnect();
    this.onclose?.({ reason: reason?.message || this.lastError?.message || '', status: reason?.status || this.lastError?.status });
  }
}
window.MingleSocket = MingleSocket;
