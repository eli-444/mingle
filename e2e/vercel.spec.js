import { test, expect } from '@playwright/test';
import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { scryptSync } from 'node:crypto';
import { createApp } from '../server.js';
import { buildFrontend } from '../scripts/build-frontend.js';

test('built frontend connects across origins and keeps admin on the backend', async ({ browser }) => {
  const adminPath = '/gestion-split-tests-12345678901234567890';
  const salt = '0123456789abcdef0123456789abcdef';
  const env = { DATA_FILE: ':memory:', ADMIN_PATH: adminPath, ADMIN_PASSWORD_HASH: salt + ':' + scryptSync('split-password', salt, 64).toString('hex') };
  const backend = createApp(env);
  await new Promise(resolve => backend.server.listen(0, '127.0.0.1', resolve));
  const backendOrigin = 'http://127.0.0.1:' + backend.server.address().port;
  env.ADMIN_ORIGIN = backendOrigin;
  const frontend = http.createServer(async (req, res) => {
    const path = req.url.split('?')[0];
    const pages = { '/': 'index.html', '/terms': 'terms.html', '/privacy': 'privacy.html', '/rules': 'rules.html' };
    const filename = pages[path] || path.slice(1);
    if (!['index.html', 'terms.html', 'privacy.html', 'rules.html', 'config.js', 'app.js', 'legal.js', 'privacy.js', 'style.css'].includes(filename)) { res.writeHead(404); return res.end(); }
    try { const content = await readFile(new URL('../dist/' + filename, import.meta.url)); res.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8'); res.end(content); }
    catch { res.writeHead(500); res.end(); }
  });
  const contexts = [];
  try {
    await buildFrontend({ MINGLE_BACKEND_ORIGIN: backendOrigin });
    expect(await readdir(new URL('../dist/', import.meta.url))).not.toContain('admin.html');
    await new Promise(resolve => frontend.listen(0, '127.0.0.1', resolve));
    env.PUBLIC_ORIGIN = 'http://127.0.0.1:' + frontend.address().port;
    for (let i = 0; i < 3; i++) contexts.push(await browser.newContext({ permissions: ['camera', 'microphone'] }));
    const [a, b, admin] = await Promise.all(contexts.map(context => context.newPage()));
    const errors = [];
    for (const page of [a, b, admin]) page.on('pageerror', error => errors.push(error.message));
    for (const page of [a, b]) {
      await page.goto(env.PUBLIC_ORIGIN); await page.locator('#adultConfirmed').check(); await page.locator('#start').click();
    }
    await expect(a.locator('#remotePanel')).toHaveAttribute('data-state', 'connected', { timeout: 20000 });
    await a.locator('#privacyOpen').click(); await expect(a.locator('#privacyText')).toContainText('Aurora Web & Security');
    await admin.goto(backendOrigin + adminPath); await admin.locator('#password').fill('split-password'); await admin.locator('#login button').click();
    await expect(admin.locator('#dashboard')).toBeVisible();
    await expect(admin.locator('#live .card').filter({ hasText: 'Connexions en ligne' }).locator('strong')).toHaveText('2');
    await expect(admin.locator('#live .card').filter({ hasText: 'Pages vues aujourd’hui' }).locator('strong')).toHaveText('2');
    await a.goto(env.PUBLIC_ORIGIN + '/privacy'); await expect(a.locator('[data-policy="operator"]')).toHaveText('Aurora Web & Security');
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    await new Promise(resolve => frontend.close(resolve)); await backend.close();
  }
});
