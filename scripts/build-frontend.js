import { mkdir, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { build } from 'esbuild';

export async function buildFrontend(env = process.env) {
  if (env.VERCEL || env.SUPABASE_URL || env.SUPABASE_ANON_KEY) return buildSupabaseFrontend(env);
  const value = env.MINGLE_BACKEND_ORIGIN;
  if (!value) throw new Error('MINGLE_BACKEND_ORIGIN manque : indiquer l’origine HTTPS du serveur de chat persistant. Voir VERCEL.md.');
  const backend = new URL(value);
  const local = !env.VERCEL && ['localhost', '127.0.0.1', '[::1]'].includes(backend.hostname) && backend.protocol === 'http:';
  if ((!local && backend.protocol !== 'https:') || backend.username || backend.password || backend.search || backend.hash || backend.pathname !== '/') throw new Error('MINGLE_BACKEND_ORIGIN doit être une origine HTTPS sans identifiants, chemin ou paramètres.');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = resolve(root, 'dist');
  // Only clean this repository’s fixed build directory, never a configured path or link.
  if (dirname(output) !== resolve(root) || (await lstat(output).catch(e => { if (e.code !== 'ENOENT') throw e; return null; }))?.isSymbolicLink()) throw new Error('Répertoire de sortie non sûr.');
  await rm(output, { recursive: true, force: true }); await mkdir(output);
  const websocket = backend.origin.replace(/^http/, 'ws');
  const csp = `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ${backend.origin} ${websocket}; media-src 'self' blob:; img-src 'self' data:; base-uri 'none'; form-action 'self'; object-src 'none'`;
  const files = ['index.html', 'terms.html', 'privacy.html', 'rules.html', 'app.js', 'privacy.js', 'legal.js', 'style.css'];
  for (const file of files) {
    let data = await readFile(new URL('../public/' + file, import.meta.url), 'utf8');
    if (file.endsWith('.html')) data = data.replace(/(<meta charset="[^"]+">)/i, `$1<meta http-equiv="Content-Security-Policy" content="${csp}">`);
    await writeFile(resolve(output, file), data);
  }
  await writeFile(resolve(output, 'config.js'), `window.MINGLE_BACKEND_ORIGIN = ${JSON.stringify(backend.origin)};\n`);
  console.log('Interface Mingle TV construite dans dist/. Serveur de chat : ' + backend.origin);
}

export async function buildSupabaseFrontend(env = process.env) {
  const missing = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'].filter(name => !env[name]?.trim());
  if (missing.length) throw new Error('Configuration Supabase manquante : ' + missing.join(', ') + '. Dans Vercel → Settings → Environment Variables, ajouter les valeurs du .env pour cet environnement, puis redéployer. Le .env local n’est pas envoyé par Git.');
  if (env.VERCEL) {
    if (!(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY)?.trim()) throw new Error('Configuration serveur manquante : SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_SECRET_KEY).');
    if (!env.SERVER_SECRET?.trim() || env.SERVER_SECRET.trim().length < 32) throw new Error('Configuration serveur invalide : SERVER_SECRET doit contenir au moins 32 caractères.');
  }
  const url = new URL(env.SUPABASE_URL);
  if (url.protocol !== 'https:' || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('SUPABASE_URL invalide.');
  const key = env.SUPABASE_ANON_KEY || '';
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (!publicKey) { try { publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; } catch {} }
  if (!publicKey) throw new Error('SUPABASE_ANON_KEY doit contenir une clé publique, jamais une clé serveur.');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = resolve(root, 'dist');
  if (dirname(output) !== resolve(root) || (await lstat(output).catch(e => { if (e.code !== 'ENOENT') throw e; return null; }))?.isSymbolicLink()) throw new Error('Répertoire de sortie non sûr.');
  await rm(output, { recursive: true, force: true }); await mkdir(output);
  const csp = `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ${url.origin} ${url.origin.replace('https:', 'wss:')}; media-src 'self' blob:; img-src 'self' data:; base-uri 'none'; form-action 'self'; object-src 'none'`;
  for (const file of ['index.html', 'terms.html', 'privacy.html', 'rules.html', 'app.js', 'privacy.js', 'legal.js', 'style.css']) {
    let content = await readFile(new URL('../public/' + file, import.meta.url), 'utf8');
    if (file.endsWith('.html')) content = content.replace(/(<meta charset="[^"]+">)/i, `$1<meta http-equiv="Content-Security-Policy" content="${csp}">`);
    if (file === 'index.html') content = content.replace('<script src="/app.js"', '<script src="/transport.js" defer></script><script src="/app.js"');
    await writeFile(resolve(output, file), content);
  }
  await writeFile(resolve(output, 'config.js'), 'window.MINGLE_BACKEND_ORIGIN = location.origin;\n');
  await build({ entryPoints: [resolve(root, 'client/supabase-transport.js')], outfile: resolve(output, 'transport.js'), bundle: true, minify: true, platform: 'browser', target: ['es2022'], format: 'iife', legalComments: 'none' });
  console.log('Mingle TV construit pour Vercel + Supabase.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildFrontend();
