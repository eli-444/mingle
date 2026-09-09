import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { buildSupabaseFrontend } from '../scripts/build-frontend.js';
import { createApi } from './supabase-api.js';

export async function startSupabaseServer(env = process.env) {
  // npm start is local development; production origins stay in Vercel variables.
  env = { ...env, PUBLIC_ORIGIN: `http://localhost:${env.PORT || 3000}`, ADMIN_ORIGIN: `http://localhost:${env.PORT || 3000}` };
  await buildSupabaseFrontend(env);
  const api = createApi(env);
  const files = { '/': ['index.html', 'text/html'], '/terms': ['terms.html', 'text/html'], '/privacy': ['privacy.html', 'text/html'], '/rules': ['rules.html', 'text/html'] };
   const files = { ...files, '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
  for (const name of ['app', 'privacy', 'legal', 'config', 'transport']) files['/' + name + '.js'] = [name + '.js', 'text/javascript'];
  files['/style.css'] = ['style.css', 'text/css'];
  const server = http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path.startsWith('/api/')) return api(req, res);
    if (path === '/admin') { req.url = '/api/handler?route=admin-page'; return api(req, res); }
    if (path === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
    if (req.method !== 'GET' || !files[path]) { res.writeHead(404); return res.end('Introuvable'); }
    try {
      const content = await readFile(new URL('../dist/' + files[path][0], import.meta.url));
      res.writeHead(200, { 'Content-Type': files[path][1] + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' }); res.end(content);
    } catch { res.writeHead(500); res.end('Fichier indisponible.'); }
  });
  server.requestTimeout = 15000;
  await new Promise(resolve => server.listen(Number(env.PORT) || 3000, '127.0.0.1', resolve));
  console.log(`Mingle TV + Supabase : http://localhost:${env.PORT || 3000} ; panel local : /admin`);
  return server;
}
