import { mkdir, readFile, writeFile, rm, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

export async function buildFrontend(env = process.env) {
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

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildFrontend();
