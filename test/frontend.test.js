import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { buildFrontend } from '../scripts/build-frontend.js';

async function listFiles(url, prefix = '') {
  const entries = await readdir(url, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(new URL(entry.name + '/', url), relative));
    else files.push(relative);
  }
  return files.sort();
}

const SEO_PUBLIC_FILES = [
  '404.html', 'app.js', 'config.js', 'en/chat-with-strangers.html', 'en/omegle-alternative.html',
  'en/random-video-chat.html', 'en/video-chat-without-registration.html', 'favicon.png', 'favicon.svg',
  'fr/alternative-omegle.html', 'fr/chat-en-ligne.html', 'fr/chat-sans-inscription.html',
  'fr/chat-video-aleatoire.html', 'index.html', 'legal.js', 'og-image.png', 'privacy.html',
  'privacy.js', 'robots.txt', 'rules.html', 'sitemap.xml', 'style.css', 'terms.html'
];

test('Vercel reports missing Supabase variables instead of selecting the legacy backend', async () => {
  await assert.rejects(buildFrontend({ VERCEL: '1' }), /Configuration Supabase manquante : SUPABASE_URL, SUPABASE_ANON_KEY/);
  await assert.rejects(buildFrontend({ VERCEL: '1', MINGLE_BACKEND_ORIGIN: 'https://old.example' }), /Configuration Supabase manquante/);
  await assert.rejects(buildFrontend({ VERCEL: '1', SUPABASE_ANON_KEY: 'sb_publishable_example' }), /manquante : SUPABASE_URL\./);
  await assert.rejects(buildFrontend({ VERCEL: '1', SUPABASE_URL: 'https://example.supabase.co' }), /manquante : SUPABASE_ANON_KEY\./);
  await assert.rejects(buildFrontend({ VERCEL: '1', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_example' }), /SUPABASE_SERVICE_ROLE_KEY/);
  await assert.rejects(buildFrontend({ VERCEL: '1', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_example', SUPABASE_SECRET_KEY: 'sb_secret_example' }), /SERVER_SECRET/);
});

test('Vercel build rejects unsafe backend origins and exports public files only', async () => {
  await assert.rejects(buildFrontend({}), /MINGLE_BACKEND_ORIGIN/);
  for (const origin of ['http://example.com', 'https://user:password@example.com', 'https://api.mingletv.app/path', 'https://api.mingletv.app?secret=value', 'https://api.mingletv.app/#hash']) await assert.rejects(buildFrontend({ MINGLE_BACKEND_ORIGIN: origin }));
  await assert.rejects(buildFrontend({ VERCEL: '1', MINGLE_BACKEND_ORIGIN: 'http://localhost:3100' }));
  await buildFrontend({ MINGLE_BACKEND_ORIGIN: 'https://api.mingletv.app', TURN_SECRET: 'must-not-export', ADMIN_PASSWORD_HASH: 'must-not-export' });
  const files = await listFiles(new URL('../dist/', import.meta.url));
  assert.deepEqual(files, SEO_PUBLIC_FILES);
  for (const file of files) {
    const content = await readFile(new URL('../dist/' + file, import.meta.url));
    const text = content.toString('utf8');
    assert.doesNotMatch(text, /must-not-export|__ADMIN_PATH__/);
    if (file.endsWith('.html')) assert.match(text, /connect-src 'self' https:\/\/api\.mingletv\.app wss:\/\/api\.mingletv\.app/);
  }
});

test('Supabase build bundles private Realtime and excludes all server secrets and admin files', async () => {
  const config = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_example', SUPABASE_SERVICE_ROLE_KEY: 'must-not-export-service', SERVER_SECRET: 'must-not-export-server', ADMIN_PASSWORD_HASH: 'must-not-export-password', TURN_SECRET: 'must-not-export-turn' };
  await assert.rejects(buildFrontend({ ...config, SUPABASE_ANON_KEY: 'sb_secret_invalid' }), /clé publique/);
  await buildFrontend(config);
  const files = await listFiles(new URL('../dist/', import.meta.url));
  assert.ok(files.includes('transport.js'));
  assert.ok(files.every(file => !file.split('/').pop().startsWith('admin') && !file.split('/').pop().startsWith('.')));
  for (const file of files) {
    const content = await readFile(new URL('../dist/' + file, import.meta.url));
    const text = content.toString('utf8');
    assert.doesNotMatch(text, /must-not-export|__ADMIN_PATH__/);
    if (file.endsWith('.html')) assert.match(text, /connect-src 'self' https:\/\/example\.supabase\.co wss:\/\/example\.supabase\.co/);
    if (file === 'index.html') assert.ok(text.indexOf('/transport.js') < text.indexOf('/app.js'));
  }
});
