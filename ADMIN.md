# Administration Mingle TV

## Accès

- En production : **https://adminsecret.mingletv.app**, après configuration de ce domaine dans Vercel et dans le DNS.
- En local : **http://localhost:3000/admin**, avec `npm start` et les variables Supabase.
- Mot de passe : **ADMIN-ACCESS.local.txt**. Ce fichier et `.env` sont exclus de Git.

`npm run setup:admin` génère les identifiants manquants et `SERVER_SECRET`, sans remplacer un mot de passe déjà configuré. Pour le renouveler : `npm run setup:admin -- --rotate`, puis copier le nouveau `ADMIN_PASSWORD_HASH` dans Vercel et redéployer.

Le panel n'est pas lié depuis le site public. Les API vérifient le sous-domaine, le mot de passe et la session. Le cookie est réservé à l'hôte admin, HttpOnly, SameSite=Strict et Secure en production ; les modifications exigent aussi un jeton CSRF.

Les sessions durent huit heures et sont partagées dans Supabase. La déconnexion révoque la session courante. Un changement de mot de passe seul ne révoque pas les autres sessions. Changer `SERVER_SECRET` les invalide, mais change aussi les empreintes des statistiques : conserver ce secret stable en fonctionnement normal.

## Fonctions

Examiner les signalements, modifier leur statut et les notes internes, bloquer l'IP pendant 1/7/30 jours, débloquer une IP et supprimer un dossier. L'IP provient de la connexion de la personne signalée, pas d'une valeur déclarée par le navigateur. Les réseaux partagés et VPN limitent sa valeur d'identification.

Le panel affiche les pages vues, connexions, duos, pics et signalements par jour et par mois. Les visiteurs distincts ne couvrent que les navigateurs consentants. Les compteurs peuvent inclure les essais techniques et ne mesurent pas la bande passante vidéo.

Les informations d'exploitant, de contact, d'adresse, d'hébergement et de rétention alimentent la confidentialité publique. Réduire la rétention purge les dossiers trop anciens. Aucun historique du chat ni enregistrement vidéo n'est joint aux signalements.

## Publication et entretien

Suivre [VERCEL.md](VERCEL.md) pour les variables, le DNS et les tâches Cron. Vérifier les exécutions des purges dans Supabase et surveiller les quotas.

L'ancienne architecture sans Supabase conserve un chemin local aléatoire `ADMIN_PATH` et SQLite. Elle ne doit pas être confondue avec le panel Vercel décrit ici.
