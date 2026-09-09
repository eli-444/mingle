# Publier Mingle TV sur Vercel + Supabase

Le frontend et les API sont hébergés dans **un seul projet Vercel**. Supabase gère les sessions, les duos, les signalements, les statistiques et les canaux privés. Aucun serveur Node permanent ni fichier SQLite n'est nécessaire dans ce mode. Les messages et la signalisation passent par Realtime ; la vidéo passe par WebRTC, directement ou via TURN.

## 1. Supabase

La migration principale `supabase/migrations/202609090001_mingle.sql` a été importée dans ton projet et sa connexion a été vérifiée.

- Garder **Authentication → Sign In / Providers → Anonymous Sign-Ins** activé : aucune inscription visible.
- Dans **Realtime**, n'autoriser que les canaux privés. Sur un projet partagé, vérifier les autres politiques de `realtime.messages` : elles ne doivent pas accorder un accès plus large.
- Activer **pg_cron / Cron**.
- Dans SQL Editor, exécuter **`supabase/cleanup-anonymous.sql`**, puis **`supabase/enable-cron.sql`**. Ces réglages du dashboard n'ont pas été appliqués automatiquement par le raccordement du code.
- Vérifier les deux tâches et leurs dernières exécutions dans Cron : `mingle-cleanup` chaque minute et `mingle-cleanup-anonymous` chaque heure.

Les identités anonymes sont nécessaires aux autorisations privées. Voir [Auth anonyme](https://supabase.com/docs/guides/auth/auth-anonymous) et [autorisation Realtime](https://supabase.com/docs/guides/realtime/authorization).

## 2. Projet Vercel et variables

Importer le dépôt GitHub qui contient **ce** `package.json`, `api/handler.js` et `vercel.json`. Si le dépôt contient lui-même un sous-dossier `mingle`, choisir ce sous-dossier comme **Root Directory** ; sinon, laisser la racine.

- Framework : **Other** ; Node.js : **24.x**.
- Build : **`npm run build`** ; sortie : **`dist`**.
- Les fonctions `api/` sont déployées avec le site, sans serveur à démarrer.

Dans **Settings → Environment Variables**, renseigner pour **Production** :

| Variable | Valeur |
| --- | --- |
| `SUPABASE_URL` | Valeur de ton `.env` |
| `SUPABASE_ANON_KEY` | Clé publique de ton `.env` |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé serveur de ton `.env` — secrète. Avec les nouvelles clés Supabase, `SUPABASE_SECRET_KEY` est aussi accepté. |
| `SERVER_SECRET` | Valeur générée dans ton `.env` — secrète et stable |
| `ADMIN_PASSWORD_HASH` | Valeur complète de ton `.env`, avec le `:` |
| `PUBLIC_ORIGIN` | `https://mingletv.app` (recommandé en production ; les Preview Vercel sont aussi reconnues automatiquement par leur propre origine) |
| `ADMIN_ORIGIN` | `https://adminsecret.mingletv.app` |
| `RELAY_ONLY` | `false`, ou `true` après configuration TURN |
| `TURN_URLS`, `TURN_SECRET` | À ajouter si un relais coturn est configuré |

Ne pas copier `PORT`, `DATA_FILE`, `ADMIN_PATH`, `TRUST_PROXY` ou `MINGLE_BACKEND_ORIGIN` pour cette architecture. Ne pas ajouter de préfixe public aux secrets. **Un push ne transfère pas les variables à Vercel** : `.env` et `ADMIN-ACCESS.local.txt` sont ignorés par Git.

Pour une Preview, définir `PUBLIC_ORIGIN` sur son origine HTTPS exacte dans cet environnement. Ne pas partager la base et les secrets de production avec des previews de code non fiable. Redéployer après toute modification des variables.

## 3. Domaine et panel

Ajouter ces deux domaines au **même projet Vercel**, dans **Settings → Domains** :

1. `mingletv.app`
2. `adminsecret.mingletv.app`

Chez le fournisseur du domaine, recopier **les enregistrements DNS indiqués par Vercel** pour chacun. Attendre la validation DNS et le certificat HTTPS. [Guide des domaines Vercel](https://vercel.com/docs/domains/working-with-domains/add-a-domain).

`vercel.json` dirige la racine du sous-domaine admin vers le panel. Les API admin vérifient ce nom d'hôte et exigent le mot de passe, une session et un jeton CSRF. Le sous-domaine n'est pas une garantie de secret.

**Mot de passe : `ADMIN-ACCESS.local.txt`, dans le dossier du projet.** En local : `npm start`, puis `http://localhost:3000/admin`. Ne jamais publier cette fiche.

`npm run setup:admin -- --rotate` génère un nouveau mot de passe ; copier ensuite le nouveau hash dans Vercel. Pour révoquer aussi les sessions existantes, changer `SERVER_SECRET` : cela change également les empreintes statistiques.

## 4. Après déploiement

Tester deux navigateurs ou appareils : caméra/micro, recherche, chat dans les deux sens, skip et stop. Vérifier puis supprimer un signalement de test dans le panel. Essayer aussi sur un réseau mobile distinct : le test local ne remplace pas la validation TURN.

Compléter dans le panel l'adresse de l'exploitant, les lieux d'hébergement, les transferts et la politique des journaux/sauvegardes. **Supabase ne fournit pas un relais TURN**. Sans TURN, certains réseaux ne pourront pas établir la vidéo ; masquer l'IP au partenaire exige le mode relais.

## Validation effectuée

Les tests locaux couvrent SQL PostgreSQL, permissions, JWT/origines, sessions admin partagées, CSRF, limites de requêtes, isolation des duos et annulation des recherches. Le parcours réel sur Supabase a vérifié quatre visiteurs, deux duos, messages aller-retour isolés, vidéo avec caméras simulées, skip, signalement, statistiques, reconnexion admin et stop. Les comptes et le signalement de test ont été supprimés ; les compteurs agrégés peuvent inclure ces essais.

Le DNS, le certificat du domaine, le déploiement Vercel et TURN n'ont pas été configurés ni validés en production. L'état est consulté toutes les deux secondes pendant une recherche/conversation, toutes les 25 secondes au repos ; le heartbeat se renouvelle environ toutes les 25 secondes. Un bannissement s'affiche donc au prochain contrôle, hors latence réseau. Surveiller les quotas Realtime, Auth et Functions et tester la charge avant une forte fréquentation.
