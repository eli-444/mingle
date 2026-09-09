const $ = id => document.getElementById(id);
let socket, stream, peer, room, config, active = false, busy = false;
let epoch = 0, pendingCandidates = [], connectionTimer, reconnectTimer, signalQueue = Promise.resolve();
let reportedRoom = null, banned = false, pendingAnalyticsRemoval = null;
let ageAccepted = false;
const regions = new Intl.DisplayNames(['en'], { type: 'region' });
const send = data => { if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(data)); return true; } return false; };
function country(id, code) {
  const valid = typeof code === 'string' && /^[A-Z]{2}$/.test(code);
  $(id).textContent = valid ? String.fromCodePoint(...[...code].map(c => c.charCodeAt(0) + 127397)) + ' ' + regions.of(code) : '🌐 —';
  $(id).title = valid ? 'Country estimated from the connection' : 'Country unavailable';
}
function controls() {
  $('start').disabled = busy || !config || socket?.readyState !== WebSocket.OPEN;
  $('buttonLabel').textContent = active ? 'skip' : 'Search';
  $('stop').disabled = !active && !busy && !stream;
  $('message').disabled = !room;
  $('send').disabled = !room || !$('message').value.trim();
  $('reportOpen').disabled = !room;
}
function state(value, text) {
  $('remotePanel').dataset.state = value;
  $('remotePlaceholder').hidden = value === 'connected';
  $('status').textContent = text;
}
function error(text = '') { $('error').textContent = text; $('error').hidden = !text; }
function closePeer() {
  clearTimeout(connectionTimer); room = null; pendingCandidates = [];
  if (peer) { peer.ontrack = peer.onicecandidate = peer.onconnectionstatechange = null; peer.close(); peer = null; }
  $('remoteVideo').srcObject = null; $('remoteCountry').hidden = true;
  $('messages').replaceChildren(); $('message').value = ''; controls();
  if ($('reportDialog').open && reportedRoom) { $('reportSend').disabled = true; $('reportNotice').textContent = 'The conversation has ended.'; }
}
function stop() {
  epoch++; active = busy = false; send({ type: 'leave' }); closePeer();
  stream?.getTracks().forEach(t => t.stop()); stream = null; $('localVideo').srcObject = null;
  $('localPlaceholder').hidden = false; state('idle', 'Camera stopped'); controls();
}
async function begin() {
  if (busy || !config) return;
  if (!$('adultConfirmed').checked) { error('Confirm that you are at least 18 and accept the terms and rules.'); $('adultConfirmed').focus(); return; }
  busy = true; const token = ++epoch; error(); controls();
  try {
    if (!stream) {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('The camera requires an HTTPS connection.');
      const acquired = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: { echoCancellation: true, noiseSuppression: true } });
      if (token !== epoch) { acquired.getTracks().forEach(t => t.stop()); return; }
      stream = acquired; $('localVideo').srcObject = stream; $('localPlaceholder').hidden = true;
      for (const track of stream.getTracks()) track.onended = () => { stop(); error('Camera or microphone disconnected.'); };
    }
    if (token !== epoch) return;
    send({ type: 'leave' }); closePeer(); active = true;
    if (!send({ type: 'join', adultConfirmed: true })) throw new Error('Server disconnected. Try again shortly.');
    state('searching', 'Searching');
  } catch (e) {
    if (token !== epoch) return;
    stop();
    error(({ NotAllowedError: 'Allow camera and microphone access to search.', NotFoundError: 'No camera or microphone detected.', NotReadableError: 'Camera or microphone unavailable.' })[e.name] || e.message);
  } finally { if (token === epoch) { busy = false; controls(); } }
}
async function matched(m) {
  if (!active || !stream) { send({ type: 'leave' }); return; }
  closePeer(); room = m.room; country('remoteCountry', m.country); $('remoteCountry').hidden = false;
  const preferRelay = window.minglePrivacy.get().relayOnly;
  const pc = new RTCPeerConnection({ ...config, iceTransportPolicy: config.iceTransportPolicy === 'relay' || preferRelay ? 'relay' : 'all' }); peer = pc;
  stream.getTracks().forEach(track => pc.addTrack(track, stream));
  pc.onicecandidate = event => { if (event.candidate && peer === pc) send({ type: 'signal', room: m.room, data: { candidate: event.candidate.toJSON() } }); };
  pc.ontrack = event => {
    if (peer !== pc) return;
    $('remoteVideo').srcObject = event.streams[0] || new MediaStream([event.track]);
    $('remoteVideo').play().catch(() => {});
  };
  pc.onconnectionstatechange = () => {
    if (peer !== pc) return;
    if (pc.connectionState === 'connected') { clearTimeout(connectionTimer); state('connected', 'You are connected'); error(); }
    else if (pc.connectionState === 'failed') { clearTimeout(connectionTimer); state('idle', 'Video connection failed'); error('Video unavailable. Try the next person.'); }
    else if (pc.connectionState === 'disconnected') state('connecting', 'Reconnecting video');
  };
  state('connecting', 'Connecting video'); controls();
  connectionTimer = setTimeout(() => { if (peer === pc && pc.connectionState !== 'connected') { state('idle', 'Video connection failed'); error('Video unavailable. Try the next person.'); } }, 20000);
  if (m.initiator) { await pc.setLocalDescription(await pc.createOffer()); if (peer === pc) send({ type: 'signal', room: m.room, data: { description: pc.localDescription } }); }
}
async function signal(m) {
  const pc = peer;
  if (!pc || room !== m.room) return;
  if (m.data.description) {
    await pc.setRemoteDescription(m.data.description);
    if (peer !== pc) return;
    for (const candidate of pendingCandidates.splice(0)) { await pc.addIceCandidate(candidate); if (peer !== pc) return; }
    if (m.data.description.type === 'offer') { await pc.setLocalDescription(await pc.createAnswer()); if (peer === pc) send({ type: 'signal', room: m.room, data: { description: pc.localDescription } }); }
  } else if (m.data.candidate) { if (pc.remoteDescription) await pc.addIceCandidate(m.data.candidate); else pendingCandidates.push(m.data.candidate); }
}
function connect() {
  if (!ageAccepted) return;
  const endpoint = new URL('/ws', window.MINGLE_BACKEND_ORIGIN); endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = window.MingleSocket ? new window.MingleSocket() : new WebSocket(endpoint);
  socket.onmessage = event => {
    const m = JSON.parse(event.data);
    if (m.type === 'age-required') { stop(); error('Confirm your age and accept the terms before searching.'); }
    if (m.type === 'chat' && room && m.room === room && typeof m.text === 'string') {
      const bubble = document.createElement('div');
      bubble.className = m.own ? 'bubble own' : 'bubble';
      bubble.textContent = m.text;
      bubble.setAttribute('aria-label', (m.own ? 'You: ' : 'Stranger: ') + m.text);
      $('messages').append(bubble);
      if ($('messages').children.length > 250) $('messages').firstElementChild.remove();
      $('messages').scrollTop = $('messages').scrollHeight;
    }
    if (m.type === 'hello') { config = { iceServers: m.iceServers, iceTransportPolicy: m.iceTransportPolicy }; country('localCountry', m.country); applyPrivacy(); error(); controls(); }
    if (m.type === 'country' && room === m.room) country('remoteCountry', m.country);
    if (m.type === 'banned') { banned = true; stop(); config = null; controls(); error('Access temporarily suspended. See the contact in Privacy to appeal.'); }
    if (m.type === 'report-result') {
      $('reportSend').disabled = false;
      if (m.ok) { reportedRoom = null; $('reportDialog').close(); stop(); error('Report sent to the administrators. Reference: ' + m.id); }
      else $('reportNotice').textContent = m.message;
    }
    if (m.type === 'matched' || m.type === 'signal') {
      const token = epoch;
      signalQueue = signalQueue.then(() => { if (token !== epoch) return; return m.type === 'matched' ? matched(m) : signal(m); }).catch(() => { if (token === epoch && active) error('Video unavailable. Try the next person.'); });
    }
    if (m.type === 'left') {
      epoch++; closePeer(); error();
      if (active && stream) begin();
      else { state('idle', 'This person has left. Try the next person.'); controls(); }
    }
  };
  socket.onclose = event => {
    config = null; stop(); if (banned) return;
    const reason = event?.reason?.trim();
    error(reason ? `${reason} Retrying…` : 'Reconnecting to the server…');
    clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 2500);
  };
  socket.onerror = event => error(event?.message || 'Server unavailable.');
}
$('start').onclick = begin;
$('adultConfirmed').onchange = () => { $('ageContinue').disabled = !$('adultConfirmed').checked; };
$('ageDialog').addEventListener('cancel', event => event.preventDefault());
$('ageForm').onsubmit = event => {
  event.preventDefault();
  if (!$('adultConfirmed').checked || ageAccepted) return;
  ageAccepted = true;
  $('ageDialog').close();
  connect();
};
$('ageUnder18').onclick = () => { location.replace('https://google.com/'); };
function applyPrivacy(removeId) {
  const prefs = window.minglePrivacy.get();
  send({ type: 'privacy', hideCountry: prefs.hideCountry });
  if (removeId) pendingAnalyticsRemoval = removeId;
  if (pendingAnalyticsRemoval && send({ type: 'analytics', id: pendingAnalyticsRemoval, remove: true })) pendingAnalyticsRemoval = null;
  if (prefs.analytics && prefs.visitorId) send({ type: 'analytics', id: prefs.visitorId });
}
window.addEventListener('privacychange', event => applyPrivacy(event.detail.removeId));
$('reportOpen').onclick = () => { if (!room) return; reportedRoom = room; $('reportDetails').value = ''; $('reportNotice').textContent = ''; $('reportSend').disabled = false; $('reportDialog').showModal(); };
$('reportForm').onsubmit = event => {
  event.preventDefault();
  if (!room || room !== reportedRoom) { $('reportNotice').textContent = 'The conversation has ended.'; return; }
  if (send({ type: 'report', room: reportedRoom, reason: $('reportReason').value, details: $('reportDetails').value.trim() })) $('reportSend').disabled = true;
};
$('stop').onclick = () => { stop(); error(); };
$('message').oninput = controls;
$('chatForm').onsubmit = event => {
  event.preventDefault();
  const text = $('message').value.trim();
  if (room && text && send({ type: 'chat', room, text })) { $('message').value = ''; controls(); }
};
window.addEventListener('pagehide', () => { stop(); socket?.close(); });
$('ageDialog').showModal();
