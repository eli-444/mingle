import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, scryptSync } from 'node:crypto';
const current = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
if (/^ADMIN_PASSWORD_HASH=[a-f0-9]{32}:[a-f0-9]{128}/m.test(current) && !process.argv.includes('--rotate')) { console.log('Administration déjà configurée. Voir ADMIN-ACCESS.local.txt.'); process.exit(0); }
const path = '/gestion-' + randomBytes(18).toString('hex');
const password = randomBytes(24).toString('base64url'), salt = randomBytes(16).toString('hex');
const hash = scryptSync(password, salt, 64).toString('hex');
writeFileSync('.env', current.replace(/^ADMIN_(PATH|PASSWORD_HASH)=.*\r?\n?/gm, '') + `\nADMIN_PATH=${path}\nADMIN_PASSWORD_HASH=${salt}:${hash}\n`, { mode: 0o600 });
writeFileSync('ADMIN-ACCESS.local.txt', `Accès administrateur privé — ne pas publier ce fichier\n\nLien local : http://localhost:3000${path}\nAprès publication : remplacer localhost:3000 par votre domaine HTTPS.\nMot de passe : ${password}\n\nLe mot de passe est stocké sous forme de hash dans .env. Conserver cette fiche dans un gestionnaire de mots de passe puis la supprimer du serveur public.\n`, { mode: 0o600 });
console.log('Accès créé dans ADMIN-ACCESS.local.txt. Redémarrer le serveur pour l’activer.');
