const $ = id => document.getElementById(id);
const base = location.pathname.replace(/\/$/, '') + '/api/';
let csrf = '', page = 0;
let metricsTimer, metricsLoading = false;
const reasonLabels = {"Nudité / contenu sexuel":"Nudity / sexual content","Harcèlement / haine":"Harassment / hate","Mineur présumé":"Suspected minor","Violence / menace":"Violence / threats","Spam / escroquerie":"Spam / scams","Autre":"Other"};
const states = { pending: 'New', reviewing: 'In review', resolved: 'Resolved', dismissed: 'Dismissed' };
const date = value => new Date(value).toLocaleString('en-GB');
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
  if (!response.ok) { if (response.status === 401) loggedIn(false); throw new Error(result.error || 'Operation failed'); }
  return result;
}
function action(label, task, dangerous = false) {
  const b = el('button', label, dangerous ? 'danger' : ''); b.type = 'button';
  b.onclick = async () => { b.disabled = true; try { await task(); } catch (e) { notice(e.message); } finally { b.disabled = false; } }; return b;
}
function rows(id, items, keys) { $(id).replaceChildren(...items.map(item => { const tr = el('tr'); keys.forEach(key => tr.append(el('td', item[key]))); return tr; })); }
function renderMetrics(data) {
  $('updated').textContent = 'Statistics updated at ' + new Date().toLocaleTimeString('en-GB') + ' · refreshed every 5 s';
  $('live').replaceChildren(...[['Visits / 30 min', data.visits30m], ['Visits today', data.visitsToday], ['Visits this month', data.visitsMonth], ['People online', data.online.connected], ['Reports', data.reportsTotal]].map(([label, number]) => { const div = el('div', undefined, 'card'); div.append(el('strong', number ?? 0), el('span', label)); return div; }));
  const series = data.visitSeries || [];
  const maxVisit = Math.max(1, ...series.map(row => Number(row.visits || 0)));
  $('trafficChart').replaceChildren(...series.map(row => { const bar = el('span', undefined, 'traffic-bar'); bar.style.height = Math.max(4, Number(row.visits || 0) / maxVisit * 100) + '%'; bar.title = new Date(row.minute).toLocaleTimeString('en-GB') + ': ' + row.visits + ' visits'; return bar; }));
  const maxCountry = Math.max(1, ...(data.countries || []).map(item => Number(item.visits)));
  $('countries').replaceChildren(...(data.countries || []).map(item => { const row = el('div', undefined, 'country-row'); const label = el('div'); label.append(el('strong', item.country), el('span', item.visits + ' visits')); const track = el('div', undefined, 'country-track'); const fill = el('i'); fill.style.width = (Number(item.visits) / maxCountry * 100) + '%'; track.append(fill); row.append(label, track); return row; }));
  rows('monthly', data.monthly, ['month', 'pageviews', 'connections', 'visitors', 'peak', 'matches', 'reports']); rows('daily', data.daily, ['date', 'pageviews', 'connections', 'peak', 'matches', 'reports']);
}
async function refreshMetrics() {
  if (document.hidden || $('dashboard').hidden || metricsLoading) return;
  metricsLoading = true;
  try { const data = await api('metrics'); if (!$('dashboard').hidden) renderMetrics(data); }
  catch (e) { $('updated').textContent = 'Statistics could not be refreshed: ' + e.message; }
  finally { metricsLoading = false; }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshMetrics(); });
async function load() {
  const data = await api('dashboard?status=' + $('filter').value + '&page=' + page); loggedIn(true);
  renderMetrics(data);
  $('reports').replaceChildren(...data.reports.map(report => {
    const card = el('article', undefined, 'report'); card.dataset.reportId = report.id;
    card.append(el('h3', (reasonLabels[report.reason] || report.reason) + ' · ' + states[report.status]), el('p', date(report.created) + ' · ' + report.id, 'meta'), el('p', 'Reported IP: ' + report.ip + ' · Country: ' + (report.country || '—'), 'meta'), el('p', report.details || 'No details provided.', 'details'));
    const status = el('select'); status.setAttribute('aria-label', 'Report status');
    Object.entries(states).forEach(([value, label]) => { const option = el('option', label); option.value = value; status.append(option); }); status.value = report.status;
    const notes = el('textarea'); notes.value = report.notes; notes.maxLength = 2000; notes.placeholder = 'Internal notes'; notes.setAttribute('aria-label', 'Internal notes');
    const days = el('select'); days.setAttribute('aria-label', 'Ban duration'); [1, 7, 30].forEach(n => { const option = el('option', n + ' day(s)'); option.value = n; days.append(option); }); days.value = '7';
    const buttons = el('div', undefined, 'report-actions');
    buttons.append(action('Save', async () => { await api('report', { id: report.id, action: 'update', status: status.value, notes: notes.value }); await load(); notice('Report updated.'); }), days,
      action('Ban this IP', async () => { if (!confirm('Ban this IP for ' + days.value + ' day(s)? This may affect a shared network.')) return; await api('report', { id: report.id, action: 'ban', days: Number(days.value) }); await load(); notice('IP banned.'); }, true),
      action('Delete', async () => { if (!confirm('Permanently delete this report and its IP?')) return; await api('report', { id: report.id, action: 'delete' }); await load(); notice('Report deleted.'); }, true));
    card.append(status, notes, buttons); return card;
  }));
  if (!data.reports.length) $('reports').append(el('p', 'No reports.'));
  $('pagination').textContent = 'Page ' + (page + 1) + ' · ' + data.totalReports + ' report(s)'; $('previous').disabled = page === 0; $('next').disabled = (page + 1) * 50 >= data.totalReports;
  $('bans').replaceChildren(...data.bans.map(ban => { const row = el('div', undefined, 'ban'); row.append(el('span', ban.ip + ' · until ' + date(ban.expires)), action('Unban', async () => { await api('unban', { ip: ban.ip }); await load(); notice('IP unbanned.'); })); return row; }));
  for (const key of ['operator', 'contact', 'address', 'hosting']) $(key).value = data.policy[key]; $('retention').value = data.policy.retentionDays;
  $('audit').replaceChildren(...data.audit.map(a => el('li', date(a.created) + ' · ' + a.action)));
}
$('login').onsubmit = async e => { e.preventDefault(); const button = $('login').querySelector('button'); button.disabled = true; try { const result = await api('login', { password: $('password').value }); csrf = result.csrf; $('password').value = ''; await load(); notice(''); } catch (e) { notice(e.message); } finally { button.disabled = false; } };
$('logout').onclick = async () => { try { await api('logout', {}); csrf = ''; loggedIn(false); $('reports').replaceChildren(); $('bans').replaceChildren(); notice('Signed out.'); } catch (e) { notice(e.message); } };
$('refresh').onclick = () => load().catch(e => notice(e.message));
$('filter').onchange = () => { page = 0; load().catch(e => notice(e.message)); };
$('previous').onclick = () => { page--; load().catch(e => notice(e.message)); };
$('next').onclick = () => { page++; load().catch(e => notice(e.message)); };
$('settings').onsubmit = async e => { e.preventDefault(); try { await api('settings', { operator: $('operator').value.trim(), contact: $('contact').value.trim(), address: $('address').value.trim(), hosting: $('hosting').value.trim(), retentionDays: Number($('retention').value) }); await load(); notice('Privacy information saved.'); } catch (e) { notice(e.message); } };
api('session').then(result => { csrf = result.csrf; return load(); }).catch(e => { loggedIn(false); if (e.message !== 'Sign-in required') notice(e.message); });
