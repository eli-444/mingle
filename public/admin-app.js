const $ = id => document.getElementById(id);
const base = location.pathname.replace(/\/$/, '') + '/api/';
let csrf = '', page = 0;
let metricsTimer, metricsLoading = false;
const states = { pending: 'Nouveau', reviewing: 'En cours', resolved: 'Traité', dismissed: 'Classé sans suite' };
const date = value => new Date(value).toLocaleString('fr-FR');
function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function notice(text) { $('notice').textContent = text; }
function loggedIn(value) {
  $('login').hidden = value; $('dashboard').hidden = $('logout').hidden = !value;
  clearInterval(metricsTimer);
  if (value) metricsTimer = setInterval(refreshMetrics, 5000);
}
async function api(endpoint, data) {
  const response = await fetch(base + endpoint, { method: data ? 'POST' : 'GET', headers: data ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}, body: data ? JSON.stringify(data) : undefined, cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) { if (response.status === 401) loggedIn(false); throw new Error(result.error || 'Opération impossible'); }
  return result;
}
function action(label, task, dangerous = false) {
  const b = el('button', label, dangerous ? 'danger' : ''); b.type = 'button';
  b.onclick = async () => { b.disabled = true; try { await task(); } catch (e) { notice(e.message); } finally { b.disabled = false; } }; return b;
}
function rows(id, items, keys) { $(id).replaceChildren(...items.map(item => { const tr = el('tr'); keys.forEach(key => tr.append(el('td', item[key]))); return tr; })); }
function renderMetrics(data) {
  $('updated').textContent = 'Statistiques à jour à ' + new Date().toLocaleTimeString('fr-FR') + ' · actualisation toutes les 5 s';
  $('live').replaceChildren(...[['Connexions en ligne', data.online.connected], ['En attente', data.online.waiting], ['Duos actifs', data.online.conversations], ['Pages vues aujourd’hui', data.today.pageviews], ['Pic en ligne aujourd’hui', data.today.peak]].map(([label, number]) => { const div = el('div', undefined, 'card'); div.append(el('strong', number), el('span', label)); return div; }));
  rows('monthly', data.monthly, ['month', 'pageviews', 'connections', 'visitors', 'peak', 'matches', 'reports']); rows('daily', data.daily, ['date', 'pageviews', 'connections', 'peak', 'matches', 'reports']);
}
async function refreshMetrics() {
  if (document.hidden || $('dashboard').hidden || metricsLoading) return;
  metricsLoading = true;
  try { const data = await api('metrics'); if (!$('dashboard').hidden) renderMetrics(data); }
  catch (e) { $('updated').textContent = 'Statistiques non actualisées : ' + e.message; }
  finally { metricsLoading = false; }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshMetrics(); });
async function load() {
  const data = await api('dashboard?status=' + $('filter').value + '&page=' + page); loggedIn(true);
  renderMetrics(data);
  $('reports').replaceChildren(...data.reports.map(report => {
    const card = el('article', undefined, 'report'); card.dataset.reportId = report.id;
    card.append(el('h3', report.reason + ' · ' + states[report.status]), el('p', date(report.created) + ' · ' + report.id, 'meta'), el('p', 'IP signalée : ' + report.ip + ' · Pays : ' + (report.country || '—'), 'meta'), el('p', report.details || 'Aucun détail ajouté.', 'details'));
    const status = el('select'); status.setAttribute('aria-label', 'Statut du signalement');
    Object.entries(states).forEach(([value, label]) => { const option = el('option', label); option.value = value; status.append(option); }); status.value = report.status;
    const notes = el('textarea'); notes.value = report.notes; notes.maxLength = 2000; notes.placeholder = 'Notes internes'; notes.setAttribute('aria-label', 'Notes internes');
    const days = el('select'); days.setAttribute('aria-label', 'Durée du blocage'); [1, 7, 30].forEach(n => { const option = el('option', n + ' jour(s)'); option.value = n; days.append(option); }); days.value = '7';
    const buttons = el('div', undefined, 'report-actions');
    buttons.append(action('Enregistrer', async () => { await api('report', { id: report.id, action: 'update', status: status.value, notes: notes.value }); await load(); notice('Signalement mis à jour.'); }), days,
      action('Bloquer cette IP', async () => { if (!confirm('Bloquer cette IP pendant ' + days.value + ' jour(s) ? Cela peut affecter un réseau partagé.')) return; await api('report', { id: report.id, action: 'ban', days: Number(days.value) }); await load(); notice('IP bloquée.'); }, true),
      action('Supprimer', async () => { if (!confirm('Supprimer définitivement ce signalement et son IP ?')) return; await api('report', { id: report.id, action: 'delete' }); await load(); notice('Signalement supprimé.'); }, true));
    card.append(status, notes, buttons); return card;
  }));
  if (!data.reports.length) $('reports').append(el('p', 'Aucun signalement.'));
  $('pagination').textContent = 'Page ' + (page + 1) + ' · ' + data.totalReports + ' signalement(s)'; $('previous').disabled = page === 0; $('next').disabled = (page + 1) * 50 >= data.totalReports;
  $('bans').replaceChildren(...data.bans.map(ban => { const row = el('div', undefined, 'ban'); row.append(el('span', ban.ip + ' · jusqu’au ' + date(ban.expires)), action('Débloquer', async () => { await api('unban', { ip: ban.ip }); await load(); notice('IP débloquée.'); })); return row; }));
  for (const key of ['operator', 'contact', 'address', 'hosting']) $(key).value = data.policy[key]; $('retention').value = data.policy.retentionDays;
  $('audit').replaceChildren(...data.audit.map(a => el('li', date(a.created) + ' · ' + a.action)));
}
$('login').onsubmit = async e => { e.preventDefault(); const button = $('login').querySelector('button'); button.disabled = true; try { const result = await api('login', { password: $('password').value }); csrf = result.csrf; $('password').value = ''; await load(); notice(''); } catch (e) { notice(e.message); } finally { button.disabled = false; } };
$('logout').onclick = async () => { try { await api('logout', {}); csrf = ''; loggedIn(false); $('reports').replaceChildren(); $('bans').replaceChildren(); notice('Déconnecté.'); } catch (e) { notice(e.message); } };
$('refresh').onclick = () => load().catch(e => notice(e.message));
$('filter').onchange = () => { page = 0; load().catch(e => notice(e.message)); };
$('previous').onclick = () => { page--; load().catch(e => notice(e.message)); };
$('next').onclick = () => { page++; load().catch(e => notice(e.message)); };
$('settings').onsubmit = async e => { e.preventDefault(); try { await api('settings', { operator: $('operator').value.trim(), contact: $('contact').value.trim(), address: $('address').value.trim(), hosting: $('hosting').value.trim(), retentionDays: Number($('retention').value) }); await load(); notice('Informations de confidentialité enregistrées.'); } catch (e) { notice(e.message); } };
api('session').then(result => { csrf = result.csrf; return load(); }).catch(e => { loggedIn(false); if (e.message !== 'Connexion nécessaire') notice(e.message); });
