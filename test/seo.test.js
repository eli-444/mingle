import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../public/', import.meta.url);
const pages = [
  ['index.html', 'https://www.mingletv.app/'],
  ['en/random-video-chat.html', 'https://www.mingletv.app/en/random-video-chat'],
  ['en/omegle-alternative.html', 'https://www.mingletv.app/en/omegle-alternative'],
  ['en/chat-with-strangers.html', 'https://www.mingletv.app/en/chat-with-strangers'],
  ['en/video-chat-without-registration.html', 'https://www.mingletv.app/en/video-chat-without-registration'],
  ['fr/chat-video-aleatoire.html', 'https://www.mingletv.app/fr/chat-video-aleatoire'],
  ['fr/alternative-omegle.html', 'https://www.mingletv.app/fr/alternative-omegle'],
  ['fr/chat-en-ligne.html', 'https://www.mingletv.app/fr/chat-en-ligne'],
  ['fr/chat-sans-inscription.html', 'https://www.mingletv.app/fr/chat-sans-inscription']
];

test('SEO landing pages have unique titles, descriptions and self canonicals', async () => {
  const titles = new Set();
  const descriptions = new Set();
  for (const [file, canonical] of pages) {
    const html = await readFile(new URL(file, root), 'utf8');
    const title = html.match(/<title>([^<]+)<\/title>/i)?.[1];
    const description = html.match(/<meta name="description" content="([^"]+)"/i)?.[1];
    assert.ok(title, `${file}: title missing`);
    assert.ok(description, `${file}: description missing`);
    assert.match(html, new RegExp(`<link rel="canonical" href="${canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    assert.doesNotMatch(html, /meta name="keywords"/i);
    assert.ok(!titles.has(title), `${file}: duplicate title`);
    assert.ok(!descriptions.has(description), `${file}: duplicate description`);
    titles.add(title); descriptions.add(description);
  }
});

test('robots and sitemap expose crawlable content without API endpoints', async () => {
  const robots = await readFile(new URL('robots.txt', root), 'utf8');
  const sitemap = await readFile(new URL('sitemap.xml', root), 'utf8');
  assert.match(robots, /User-agent: \*/);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Sitemap: https:\/\/www\.mingletv\.app\/sitemap\.xml/);
  for (const [, canonical] of pages) assert.match(sitemap, new RegExp(canonical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(sitemap, /\/api\//);
});

test('landing page content does not hide text for search engines', async () => {
  const en = await readFile(new URL('en/omegle-alternative.html', root), 'utf8');
  const fr = await readFile(new URL('fr/chat-en-ligne.html', root), 'utf8');
  assert.match(fr, /chat en lgne/);
  assert.match(fr, /cht online/);
  for (const html of [en, fr]) {
    assert.doesNotMatch(html, /display\s*:\s*none/i);
    assert.doesNotMatch(html, /opacity\s*:\s*0/i);
    assert.doesNotMatch(html, /font-size\s*:\s*0/i);
  }
});
