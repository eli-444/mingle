# Mingle TV

Rencontres vidéo entre deux inconnus, sans inscription visible : deux caméras, pays estimé, chat éphémère, Rechercher / skip / stop, signalement et confidentialité.

**Architecture de publication : Vercel + Supabase.** Le site et les API tournent sur Vercel ; Supabase gère les identités techniques anonymes, les duos, les signalements, les blocages et les statistiques. Les messages et la signalisation utilisent des canaux Realtime privés. La vidéo WebRTC passe directement entre participants ou par un relais TURN.

## Lancer en local

Node.js 24 est nécessaire.

```sh
npm ci
```

Sur une nouvelle installation, copier `.env.example` vers `.env`, puis renseigner les trois valeurs Supabase. Ne pas écraser un `.env` déjà rempli.

```sh
npm run setup:admin
npm start
```

Ouvrir **http://localhost:3000** et, pour le panel, **http://localhost:3000/admin**. Le mot de passe est dans **ADMIN-ACCESS.local.txt**. Le serveur local utilise les origines localhost même si `.env` contient les domaines de production.

## Publier

Suivre **[VERCEL.md](VERCEL.md)** : variables, purges Supabase, domaine `mingletv.app` et panel `adminsecret.mingletv.app`. Un push seul ne configure ni les variables secrètes, ni le DNS.

Le code a été testé avec le vrai projet Supabase et quatre navigateurs : deux duos isolés, chat aller-retour, vidéo avec caméras simulées, skip, stop, signalement et panel. Aucun déploiement Vercel/DNS ni relais TURN réel n'a été réalisé pendant le raccordement.

## Données et administration

Aucune table ne conserve le chat ou les vidéos. Les sessions de conversation expirent après 90 secondes sans présence, puis sont purgées. Les signalements, bannissements et statistiques restent selon les durées configurées ; voir [la base Supabase](supabase/README.md) et [l'administration](ADMIN.md).

Le pays est estimé par Vercel à partir de la connexion ; il est indisponible en local et peut correspondre à la sortie d'un VPN. La mise en relation ne garantit pas que la vidéo aboutira sur tous les réseaux. TURN doit être configuré pour relayer les connexions qui en ont besoin et pour proposer le masquage de l'IP au partenaire.

Le domaine et le sous-domaine ne garantissent pas l'anonymat de l'exploitant. Compléter les informations publiques de confidentialité dans le panel avec les prestataires réellement utilisés.

## Tests

```sh
npm test
npm run test:supabase
```

Le test réel est volontaire et utilise le projet configuré :

```sh
npm run test:supabase:live
```

Il crée quatre comptes de test, puis les supprime ainsi que son signalement. Les compteurs agrégés peuvent inclure ces essais. Ne pas le lancer sur un projet avec des visiteurs actifs. Edge est utilisé par défaut ; `PLAYWRIGHT_CHANNEL` permet de choisir un autre navigateur installé.

## Ancienne architecture

Sans `SUPABASE_URL`, le démarrage conserve le serveur Node/WebSocket et SQLite historique. `server.js`, `admin.js`, le Dockerfile et les fichiers Caddy/coturn associés restent disponibles pour ce mode. Cette architecture nécessite un serveur permanent et n'est pas celle à publier sur Vercel. Les anciennes données SQLite ne sont pas automatiquement importées dans Supabase.
