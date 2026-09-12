// Explicit opt-in smoke test against the configured project. Creates four
// anonymous test visitors, then removes only their Auth accounts and test report.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { randomBytes, scryptSync } from 'node:crypto';
import { startSupabaseServer } from '../lib/supabase-server.js';

const password = randomBytes(24).toString('hex'), salt = randomBytes(16).toString('hex');
const env = { ...process.env, PORT: '3200', ADMIN_PASSWORD_HASH: salt + ':' + scryptSync(password, salt, 64).toString('hex') };
const service = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const server = await startSupabaseServer(env);
const origin = 'http://localhost:3200';
let browser, reportId, testBan = false, stage = 'initialisation';
const users = new Set(), contexts = [];
try {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const pages = [];
  for (let i = 0; i < 4; i++) {
    stage = 'ouverture visiteur ' + (i + 1);
    const context = await browser.newContext({ permissions: ['camera', 'microphone'] }); contexts.push(context);
    const page = await context.newPage(); pages.push(page);
    page.on('pageerror', error => console.error('Erreur navigateur : ' + error.message.split('\n')[0]));
    page.on('response', async response => { if (response.url().startsWith(origin + '/api/') && response.status() >= 400) console.error('API ' + new URL(response.url()).pathname + ' : HTTP ' + response.status()); });
    await page.goto(origin);
    await page.locator('#adultConfirmed').check(); await page.locator('#ageContinue').click();
    await page.waitForFunction(() => !document.getElementById('start').disabled, { timeout: 25000 });
    const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('mingle.auth')).user.id); users.add(id);
    console.log('Visiteur ' + (i + 1) + ' connecté.');
  }
  const [a, b, c, d] = pages;
  stage = 'mise en relation';
  for (const page of [a, b]) await page.locator('#start').click();
  for (const page of [a, b]) await page.waitForFunction(() => !document.getElementById('message').disabled, { timeout: 30000 });
  for (const page of [c, d]) await page.locator('#start').click();
  for (const page of [c, d]) await page.waitForFunction(() => !document.getElementById('message').disabled, { timeout: 30000 });
  console.log('Deux duos privés établis.');
  const otherTopic = await c.evaluate(() => socket.match.topic);
  const denied = await a.evaluate(async topic => {
    const channel = socket.client.channel(topic, { config: { private: true } });
    const result = await new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), 10000);
      channel.subscribe(status => { if (status === 'CHANNEL_ERROR' || status === 'SUBSCRIBED') { clearTimeout(timer); resolve(status === 'CHANNEL_ERROR'); } });
    });
    await socket.client.removeChannel(channel); return result;
  }, otherTopic);
  assert.equal(denied, true, 'Un visiteur extérieur ne doit pas pouvoir rejoindre le second duo.');
  await a.locator('#message').fill('Test Supabase privé'); await a.locator('#message').press('Enter');
  await b.getByText('Test Supabase privé', { exact: true }).waitFor();
  assert.equal(await c.locator('#messages').innerText(), '');
  assert.equal(await d.locator('#messages').innerText(), '');
  await b.locator('#message').fill('Réponse éphémère'); await b.locator('#message').press('Enter');
  await a.getByText('Réponse éphémère', { exact: true }).waitFor();
  await a.waitForFunction(() => document.getElementById('remoteVideo').videoWidth > 0, { timeout: 30000 });
  console.log('Chat aller-retour isolé et flux vidéo reçu.');
  await a.locator('#start').click();
  await b.waitForFunction(() => document.getElementById('message').disabled, { timeout: 10000 });
  await b.locator('#start').click();
  for (const page of [a, b]) await page.waitForFunction(() => !document.getElementById('message').disabled, { timeout: 30000 });
  assert.equal(await a.locator('#messages').innerText(), '');
  await a.locator('#reportOpen').click(); await a.locator('#reportReason').selectOption({ label: 'Other' });
  await a.locator('#reportDetails').fill('Test technique automatique à supprimer'); await a.locator('#reportSend').click();
  await a.waitForFunction(() => document.getElementById('error').textContent.includes('Reference:'), { timeout: 15000 });
  reportId = (await a.locator('#error').innerText()).match(/[a-f0-9-]{36}/)?.[0]; assert.ok(reportId);
  const admin = await (await browser.newContext()).newPage();
  await admin.goto(origin + '/admin'); await admin.locator('#password').fill(password);
  await admin.locator('#login button').click(); await admin.locator('#dashboard').waitFor();
  await admin.getByRole('link', { name: 'Reports', exact: true }).click();
  await admin.locator(`[data-report-id="${reportId}"]`).waitFor();
  assert.ok(await admin.locator('#monthly tr').count());
  await admin.reload(); await admin.locator('#dashboard').waitFor();
  stage = 'bannissement et déblocage';
  testBan = true;
  await admin.locator(`[data-report-id="${reportId}"]`).getByRole('button', { name: 'Ban this IP' }).click();
  await admin.locator('#confirmDialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  for (const page of [c, d]) await page.waitForFunction(() => document.getElementById('error').textContent.includes('suspended'), null, { timeout: 15000 });
  // The former partner is now idle: its next heartbeat is at most 25s away.
  await b.waitForFunction(() => document.getElementById('error').textContent.includes('suspended'), null, { timeout: 35000 });
  await admin.getByRole('link', { name: 'IP bans', exact: true }).click();
  const ban = admin.locator('#bans .ban').filter({ hasText: '127.0.0.1' });
  await ban.getByRole('button', { name: 'Unban' }).click();
  await ban.waitFor({ state: 'detached' }); testBan = false;
  await admin.locator('#logout').click(); await admin.locator('#login').waitFor();
  console.log('Skip, signalement, blocage/déblocage, statistiques et session admin vérifiés.');
  for (const page of pages) { await page.locator('#stop').click({ force: true }); }
  for (const page of pages) assert.equal(await page.evaluate(() => document.getElementById('localVideo').srcObject), null);
  console.log('Stop libère les caméras.');
} catch (error) {
  // Do not dump Playwright request headers, Auth payloads, or environment values.
  console.error('Échec du parcours Supabase (' + stage + ') : ' + error.name + ' — ' + error.message.split('\n')[0]);
  for (const context of contexts) for (const page of context.pages()) { try { console.error('État interface : ' + await page.locator('#error').innerText()); } catch {} }
  process.exitCode = 1;
} finally {
  for (const context of contexts) {
    for (const page of context.pages()) { try { const id = await page.evaluate(() => JSON.parse(sessionStorage.getItem('mingle.auth') || 'null')?.user?.id); if (id) users.add(id); } catch {} }
  }
  await browser?.close();
  if (testBan) await service.rpc('mingle_admin_unban', { p_ip: '127.0.0.1', p_actor: 'smoke-test-cleanup' });
  if (reportId) await service.rpc('mingle_admin_delete_report', { p_report: reportId, p_actor: 'smoke-test-cleanup' });
  for (const id of users) { const { error } = await service.auth.admin.deleteUser(id); if (error) { console.error('Nettoyage compte test incomplet.'); process.exitCode = 1; } }
  await new Promise(resolve => server.close(resolve));
  console.log('Nettoyage des visiteurs de test terminé.');
}
