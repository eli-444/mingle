import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { buildFrontend } from '../scripts/build-frontend.js';

test('Vercel build rejects unsafe backend origins and exports public files only', async () => {
  await assert.rejects(buildFrontend({}), /MINGLE_BACKEND_ORIGIN/);
  for (const origin of ['http://example.com', 'https://user:password@example.com', 'https://api.mingletv.app/path', 'https://api.mingletv.app?secret=value', 'https://api.mingletv.app/#hash']) await assert.rejects(buildFrontend({ MINGLE_BACKEND_ORIGIN: origin }));
  await assert.rejects(buildFrontend({ VERCEL: '1', MINGLE_BACKEND_ORIGIN: 'http://localhost:3100' }));
  await buildFrontend({ MINGLE_BACKEND_ORIGIN: 'https://api.mingletv.app', TURN_SECRET: 'must-not-export', ADMIN_PASSWORD_HASH: 'must-not-export' });
  const files = await readdir(new URL('../dist/', import.meta.url));
  assert.deepEqual(files.sort(), ['app.js', 'config.js', 'index.html', 'legal.js', 'privacy.html', 'privacy.js', 'rules.html', 'style.css', 'terms.html']);
  for (const file of files) {
    const content = await readFile(new URL('../dist/' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(content, /must-not-export|__ADMIN_PATH__/);
    if (file.endsWith('.html')) assert.match(content, /connect-src 'self' https:\/\/api\.mingletv\.app wss:\/\/api\.mingletv\.app/);
  }
});
