const $ = id => document.getElementById(id);
const base = location.pathname.replace(/\/$/, '') + '/api/';
let csrf = '', page = 0;
let metricsTimer, metricsLoading = false;
const views = {
  overview: ['Overview', 'A live pulse of your community.'],
  analytics: ['Analytics', 'Traffic and activity over time.'],
  'reports-section': ['Reports', 'Review reports and manage moderation.'],
  'mail-section': ['Mail', 'Messages from your community.'],
  'bans-section': ['IP bans', 'Review and manage access restrictions.'],
  'settings-section': ['Settings', 'Manage public information and retention.'],
  'audit-section': ['Audit log', 'Recent administrative actions.']
};
const mobileLayout = matchMedia('(max-width: 900px)');
function closeMenu(restoreFocus = false) {
  document.body.classList.remove('menu-open');
  $('menuToggle').setAttribute('aria-expanded', 'false');
  $('menuBackdrop').hidden = true;
  $('workspace').inert = false;
  $('sidebar').inert = mobileLayout.matches;
  $('sidebar').removeAttribute('role');
  $('sidebar').removeAttribute('aria-modal');
  if (restoreFocus) $('menuToggle').focus();
}
function selectView(focus = false) {
  const requested = location.hash.slice(1);
  const name = Object.hasOwn(views, requested) ? requested : 'overview';
  if (requested !== name) history.replaceState(null, '', '#' + name);
  document.querySelectorAll('[data-view]').forEach(section => { section.hidden = section.id !== name; });
  document.querySelectorAll('.side-link').forEach(link => {
    const current = link.hash === '#' + name;
    link.classList.toggle('active', current);
    if (current) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  $('viewTitle').textContent = views[name][0];
  $('viewDescription').textContent = views[name][1];
  document.title = views[name][0] + ' · Mingle TV Admin';
  closeMenu();
  if (focus && !$('dashboard').hidden) { $('viewTitle').focus({ preventScroll: true }); window.scrollTo(0, 0); }
}
$('menuToggle').onclick = () => {
  document.body.classList.add('menu-open');
  $('menuToggle').setAttribute('aria-expanded', 'true');
  $('menuBackdrop').hidden = false;
  $('workspace').inert = true;
  $('sidebar').inert = false;
  $('sidebar').setAttribute('role', 'dialog');
  $('sidebar').setAttribute('aria-modal', 'true');
  $('menuClose').focus();
};
$('menuClose').onclick = () => closeMenu(true);
$('menuBackdrop').onclick = () => closeMenu(true);
document.addEventListener('keydown', event => {
  if (!document.body.classList.contains('menu-open')) return;
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
  if (event.key === 'Tab') {
    const items = [...$('sidebar').querySelectorAll('a[href], button:not([hidden])')].filter(el => el.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
mobileLayout.addEventListener('change', () => closeMenu());
window.addEventListener('hashchange', () => selectView(true));
document.querySelectorAll('.side-link').forEach(link => link.addEventListener('click', () => {
  if (location.hash === link.hash) { closeMenu(); $('viewTitle').focus(); }
}));
selectView();

const reasonLabels = {"Nudité / contenu sexuel":"Nudity / sexual content","Harcèlement / haine":"Harassment / hate","Mineur présumé":"Suspected minor","Violence / menace":"Violence / threats","Spam / escroquerie":"Spam / scams","Autre":"Other"};
const states = { pending: 'New', reviewing: 'In review', resolved: 'Resolved', dismissed: 'Dismissed' };
const date = value => new Date(value).toLocaleString('en-GB');
function el(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function notice(text) { $('notice').textContent = text; }
function loggedIn(value) {
  $('login').hidden = value; $('dashboard').hidden = $('logout').hidden = !value;
  clearInterval(metricsTimer);
  closeMenu();
  if (value) selectView();
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

function confirmAction(message) {
  return new Promise(resolve => {
    const dialog = $('confirmDialog');
    const previous = document.activeElement;
    $('confirmMessage').textContent = message;
    dialog.returnValue = '';
    dialog.addEventListener('close', () => { previous?.focus(); resolve(dialog.returnValue === 'confirm'); }, { once: true });
    dialog.showModal();
  });
}
const palette = ['#a3e635', '#38bdf8', '#a78bfa', '#2dd4bf', '#fb7185'];
const numberFormat = new Intl.NumberFormat('en-GB');
function plot(id, items, definitions, labelKey) {
  const host = $(id); host.replaceChildren();
  if (!items.length) { host.append(el('p', 'No activity recorded yet.', 'chart-empty')); return; }
  const ns = 'http://www.w3.org/2000/svg';
  const svgNode = (tag, attrs, text) => { const n = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k,v]) => n.setAttribute(k,v)); if(text !== undefined) n.textContent = text; return n; };
  const svg = svgNode('svg', { viewBox:'0 0 640 250', role:'img', 'aria-label': definitions.map(d=>d[1]).join(' and ') + ' over time' });
  const value = (row,key) => Math.max(0, Number(row[key]) || 0);
  const maximum = Math.max(1, ...items.flatMap(row => definitions.map(d=>value(row,d[0]))));
  const x = i => items.length === 1 ? 340 : 52 + i/(items.length-1)*568;
  const y = v => 208-v/maximum*180;
  for(let i=0;i<=4;i++){
    const yy=28+i*45;
    svg.append(svgNode('line',{x1:52,x2:620,y1:yy,y2:yy,stroke:'#292929','stroke-dasharray':'3 6'}));
    svg.append(svgNode('text',{x:42,y:yy+4,'text-anchor':'end',fill:'#888', 'font-size':11},new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(maximum*(4-i)/4)));
  }
  const defs = svgNode('defs',{}); svg.append(defs);
  definitions.forEach(([key,label,color],index)=>{
    const points=items.map((row,i)=>[x(i),y(value(row,key))]);
    const gradient=svgNode('linearGradient',{id:id+'-fill-'+index,x1:0,y1:0,x2:0,y2:1});
    gradient.append(svgNode('stop',{offset:'0%','stop-color':color,'stop-opacity':'.22'}),svgNode('stop',{offset:'100%','stop-color':color,'stop-opacity':'0'})); defs.append(gradient);
    if(points.length>1){
      const line='M'+points.map(p=>p.join(',')).join(' L');
      svg.append(svgNode('path',{d:line+' L620,208 L52,208 Z',fill:'url(#'+id+'-fill-'+index+')'}));
      svg.append(svgNode('path',{d:line,fill:'none',stroke:color,'stroke-width':2.5,'stroke-linejoin':'round','stroke-linecap':'round'}));
    }
    points.forEach(([xx,yy],i)=>{const dot=svgNode('circle',{cx:xx,cy:yy,r:points.length===1?5:3,fill:color}); dot.append(svgNode('title',{},String(items[i][labelKey])+': '+numberFormat.format(value(items[i],key))+' '+label));svg.append(dot);});
  });
  const formatLabel = row => labelKey==='minute' ? new Date(row.minute).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'}) : String(row[labelKey]);
  [...new Set([0,Math.floor((items.length-1)/2),items.length-1])].forEach(i=>svg.append(svgNode('text',{x:x(i),y:239,'text-anchor':i===0?'start':i===items.length-1?'end':'middle',fill:'#999','font-size':11},formatLabel(items[i]))));
  host.append(svg);
  const legend=el('div',undefined,'chart-legend');
  definitions.forEach(([,label,color])=>{const item=el('span',label);item.style.setProperty('--series',color);legend.append(item);});
  host.append(legend);
}

function renderMetrics(data) {
  $('updated').textContent = 'Statistics updated at ' + new Date().toLocaleTimeString('en-GB') + ' · refreshed every 5 s';
  $('live').replaceChildren(...[['Visits / 30 min', data.visits30m, 'Rolling window'], ['Visits today', data.visitsToday, 'Since 00:00 UTC'], ['Visits this month', data.visitsMonth, 'Calendar month'], ['People online', data.online.connected, 'Active chat sessions'], ['Reports', data.reportsTotal, 'All reports']].map(([label, number, caption], i) => {
    const div = el('div', undefined, 'card'); div.style.setProperty('--accent', palette[i]);
    const top = el('div', undefined, 'metric-top'); top.append(el('span', label), el('span', ['↗','◷','▥','◉','⚑'][i], 'metric-icon'));
    div.append(top, el('strong', numberFormat.format(number ?? 0)), el('small', caption)); return div;
  }));
  plot('trafficChart', data.visitSeries || [], [['visits','Visits per minute · UTC',palette[0]]], 'minute');
  plot('dailyChart', [...(data.daily || [])].sort((a,b)=>a.date.localeCompare(b.date)), [['pageviews','Page views',palette[1]],['connections','Connections',palette[2]]], 'date');
  plot('monthlyChart', [...(data.monthly || [])].sort((a,b)=>a.month.localeCompare(b.month)), [['pageviews','Page views',palette[0]],['matches','Matches',palette[3]]], 'month');
  const maxCountry = Math.max(1, ...(data.countries || []).map(item => Number(item.visits)));
  $('countries').replaceChildren(...(data.countries || []).map(item => { const row = el('div', undefined, 'country-row'); const label = el('div'); label.append(el('strong', item.country), el('span', item.visits + ' visits')); const track = el('div', undefined, 'country-track'); const fill = el('i'); fill.style.width = (Number(item.visits) / maxCountry * 100) + '%'; track.append(fill); row.append(label, track); return row; }));
  if (!(data.countries || []).length) $('countries').append(el('p', 'No country data yet.', 'chart-empty'));
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
      action('Ban this IP', async () => { if (!await confirmAction('Ban this IP for ' + days.value + ' day(s)? This may affect a shared network.')) return; await api('report', { id: report.id, action: 'ban', days: Number(days.value) }); await load(); notice('IP banned.'); }, true),
      action('Delete', async () => { if (!await confirmAction('Permanently delete this report and its IP?')) return; await api('report', { id: report.id, action: 'delete' }); await load(); notice('Report deleted.'); }, true));
    card.append(status, notes, buttons); return card;
  }));
  if (!data.reports.length) $('reports').append(el('p', 'No reports.'));
  const contactStates = { new: 'New', in_progress: 'In progress', closed: 'Closed' };
  $('contacts').replaceChildren(...(data.contacts || []).map(contact => {
    const card = el('article', undefined, 'report'); card.dataset.contactId = contact.id;
    card.append(el('h3', contact.firstName + ' ' + contact.lastName + ' · ' + contact.email), el('p', date(contact.created) + ' · ' + contact.id, 'meta'), el('p', contact.message, 'details'));
    const status = el('select'); status.setAttribute('aria-label', 'Mail status'); Object.entries(contactStates).forEach(([value, label]) => { const option = el('option', label); option.value = value; status.append(option); }); status.value = contact.status;
    const notes = el('textarea'); notes.value = contact.notes || ''; notes.maxLength = 2000; notes.placeholder = 'Internal notes';
    const buttons = el('div', undefined, 'report-actions'); buttons.append(action('Save', async () => { await api('contact', { id: contact.id, action: 'update', status: status.value, notes: notes.value }); await load(); notice('Mail updated.'); }), action('Delete', async () => { if (!await confirmAction('Delete this message?')) return; await api('contact', { id: contact.id, action: 'delete' }); await load(); notice('Mail deleted.'); }, true));
    card.append(status, notes, buttons); return card;
  }));
  if (!(data.contacts || []).length) $('contacts').append(el('p', 'No messages.'));
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
