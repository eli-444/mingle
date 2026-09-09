const $ = id => document.getElementById(id);
let socket, stream, peer, room, config, active = false, busy = false;
let epoch = 0, pendingCandidates = [], connectionTimer, reconnectTimer, signalQueue = Promise.resolve();
let reportedRoom = null, banned = false, pendingAnalyticsRemoval = null;
const regions = new Intl.DisplayNames(['fr'], { type: 'region' });
const send = data => { if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(data)); return true; } return false; };
function country(id, code) {
  const valid = typeof code === 'string' && /^[A-Z]{2}$/.test(code);
  $(id).textContent = valid ? String.fromCodePoint(...[...code].map(c => c.charCodeAt(0) + 127397)) + ' ' + regions.of(code) : '🌐 —';
  $(id).title = valid ? 'Pays estimé à partir de la connexion' : 'Pays indisponible';
}
function controls() {
  $('start').disabled = busy || !config || socket?.readyState !== WebSocket.OPEN;
  $('buttonLabel').textContent = active ? 'skip' : 'Rechercher';
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
  $('remoteVideo').srcObject = null; $('playRemote').hidden = true; $('remoteCountry').hidden = true;
  $('messages').replaceChildren(); $('message').value = ''; controls();
  if ($('reportDialog').open && reportedRoom) { $('reportSend').disabled = true; $('reportNotice').textContent = 'La conversation est terminée.'; }
}
function stop() {
  epoch++; active = busy = false; send({ type: 'leave' }); closePeer();
  stream?.getTracks().forEach(t => t.stop()); stream = null; $('localVideo').srcObject = null;
  $('localPlaceholder').hidden = false; state('idle', 'Caméra arrêtée'); controls();
}
async function begin() {
  if (busy || !config) return;
  if (!$('adultConfirmed').checked) { error('Confirme que tu as au moins 18 ans et que tu acceptes les conditions et les règles.'); $('adultConfirmed').focus(); return; }
  busy = true; const token = ++epoch; error(); controls();
  try {
    if (!stream) {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('La caméra nécessite une connexion HTTPS.');
      const acquired = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: { echoCancellation: true, noiseSuppression: true } });
      if (token !== epoch) { acquired.getTracks().forEach(t => t.stop()); return; }
      stream = acquired; $('localVideo').srcObject = stream; $('localPlaceholder').hidden = true;
      for (const track of stream.getTracks()) track.onended = () => { stop(); error('Caméra ou microphone déconnecté.'); };
    }
    if (token !== epoch) return;
    send({ type: 'leave' }); closePeer(); active = true;
    if (!send({ type: 'join', adultConfirmed: true })) throw new Error('Serveur déconnecté. Réessaie dans un instant.');
    state('searching', 'Recherche en cours');
  } catch (e) {
    if (token !== epoch) return;
    stop();
    error(({ NotAllowedError: 'Autorise la caméra et le microphone pour rechercher.', NotFoundError: 'Aucune caméra ou aucun microphone détecté.', NotReadableError: 'Caméra ou microphone indisponible.' })[e.name] || e.message);
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
    $('remoteVideo').play().catch(() => { if (peer === pc) $('playRemote').hidden = false; });
  };
  pc.onconnectionstatechange = () => {
    if (peer !== pc) return;
    if (pc.connectionState === 'connected') { clearTimeout(connectionTimer); state('connected', 'Vous êtes connectés'); error(); }
    else if (pc.connectionState === 'failed') { clearTimeout(connectionTimer); state('idle', 'Connexion vidéo impossible'); error('Vidéo indisponible. Passe au suivant.'); }
    else if (pc.connectionState === 'disconnected') state('connecting', 'Reconnexion vidéo');
  };
  state('connecting', 'Connexion vidéo'); controls();
  connectionTimer = setTimeout(() => { if (peer === pc && pc.connectionState !== 'connected') { state('idle', 'Connexion vidéo impossible'); error('Vidéo indisponible. Passe au suivant.'); } }, 20000);
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
  const endpoint = new URL('/ws', window.MINGLE_BACKEND_ORIGIN); endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(endpoint);
  socket.onmessage = event => {
    const m = JSON.parse(event.data);
    if (m.type === 'age-required') { stop(); error('Confirme ton âge et accepte les conditions avant de rechercher.'); }
    if (m.type === 'chat' && room && m.room === room && typeof m.text === 'string') {
      const bubble = document.createElement('div');
      bubble.className = m.own ? 'bubble own' : 'bubble';
      bubble.textContent = m.text;
      bubble.setAttribute('aria-label', (m.own ? 'Toi : ' : 'Inconnu : ') + m.text);
      $('messages').append(bubble);
      if ($('messages').children.length > 250) $('messages').firstElementChild.remove();
      $('messages').scrollTop = $('messages').scrollHeight;
    }
    if (m.type === 'hello') { config = { iceServers: m.iceServers, iceTransportPolicy: m.iceTransportPolicy }; country('localCountry', m.country); applyPrivacy(); error(); controls(); }
    if (m.type === 'country' && room === m.room) country('remoteCountry', m.country);
    if (m.type === 'banned') { banned = true; stop(); config = null; controls(); error('Accès temporairement suspendu. Consulte le contact dans Confidentialité pour contester.'); }
    if (m.type === 'report-result') {
      $('reportSend').disabled = false;
      if (m.ok) { reportedRoom = null; $('reportDialog').close(); stop(); error('Signalement transmis à l’administration. Référence : ' + m.id); }
      else $('reportNotice').textContent = m.message;
    }
    if (m.type === 'matched' || m.type === 'signal') {
      const token = epoch;
      signalQueue = signalQueue.then(() => { if (token !== epoch) return; return m.type === 'matched' ? matched(m) : signal(m); }).catch(() => { if (token === epoch && active) error('Vidéo indisponible. Passe au suivant.'); });
    }
    if (m.type === 'left') { epoch++; closePeer(); state('idle', 'Cette personne est partie. Passe au suivant.'); error(); controls(); }
  };
  socket.onclose = () => { config = null; stop(); if (banned) return; error('Reconnexion au serveur…'); clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 2500); };
  socket.onerror = () => error('Serveur indisponible.');
}
$('start').onclick = begin;
$('adultConfirmed').onchange = () => { if (!$('adultConfirmed').checked) stop(); };
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
  if (!room || room !== reportedRoom) { $('reportNotice').textContent = 'La conversation est terminée.'; return; }
  if (send({ type: 'report', room: reportedRoom, reason: $('reportReason').value, details: $('reportDetails').value.trim() })) $('reportSend').disabled = true;
};
$('stop').onclick = () => { stop(); error(); };
$('message').oninput = controls;
$('chatForm').onsubmit = event => {
  event.preventDefault();
  const text = $('message').value.trim();
  if (room && text && send({ type: 'chat', room, text })) { $('message').value = ''; controls(); }
};
$('playRemote').onclick = async () => { try { await $('remoteVideo').play(); $('playRemote').hidden = true; } catch { error('Lecture indisponible. Passe au suivant.'); } };
window.addEventListener('pagehide', () => { stop(); socket?.close(); });
connect();
