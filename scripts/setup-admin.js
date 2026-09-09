import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, scryptSync } from 'node:crypto';
let current = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
if (!/^SERVER_SECRET=.{32,}$/m.test(current)) {
  current = current.replace(/^SERVER_SECRET=.*\r?\n?/gm, '') + '\nSERVER_SECRET=' + randomBytes(32).toString('hex') + '\n';
  writeFileSync('.env', current, { mode: 0o600 });
}
if (/^ADMIN_PASSWORD_HASH=[a-f0-9]{32}:[a-f0-9]{128}/m.test(current) && !process.argv.includes('--rotate')) {
  if (/^SUPABASE_URL=.+/m.test(current) && existsSync('ADMIN-ACCESS.local.txt')) {
    const note = readFileSync('ADMIN-ACCESS.local.txt', 'utf8').replace(/^Lien local : .*$/m, 'Lien local : http://localhost:3000/admin').replace(/^Après publication : .*$/m, 'Après publication : https://adminsecret.mingletv.app');
    writeFileSync('ADMIN-ACCESS.local.txt', note, { mode: 0o600 });
  }
  console.log('Administration déjà configurée. Voir ADMIN-ACCESS.local.txt.'); process.exit(0);
}
const path = '/gestion-' + randomBytes(18).toString('hex');
const password = randomBytes(24).toString('base64url'), salt = randomBytes(16).toString('hex');
const hash = scryptSync(password, salt, 64).toString('hex');
writeFileSync('.env', current.replace(/^ADMIN_(PATH|PASSWORD_HASH)=.*\r?\n?/gm, '') + `\nADMIN_PATH=${path}\nADMIN_PASSWORD_HASH=${salt}:${hash}\n`, { mode: 0o600 });
const supabase = /^SUPABASE_URL=.+/m.test(current);
writeFileSync('ADMIN-ACCESS.local.txt', `Accès administrateur privé — ne pas publier ce fichier\n\nLien local : http://localhost:3000${supabase ? '/admin' : path}\nAprès publication : ${supabase ? 'https://adminsecret.mingletv.app' : 'remplacer localhost:3000 par votre domaine HTTPS.'}\nMot de passe : ${password}\n\nLe mot de passe est stocké sous forme de hash dans .env. Conserver cette fiche dans un gestionnaire de mots de passe puis la supprimer du serveur public.\n`, { mode: 0o600 });
console.log('Accès créé dans ADMIN-ACCESS.local.txt. Redémarrer le serveur pour l’activer.');
