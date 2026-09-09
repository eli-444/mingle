# Administration Mingle TV

## Se connecter

L’accès local et le mot de passe généré sont dans **ADMIN-ACCESS.local.txt**, à la racine du projet. Ouvrir ce lien et saisir le mot de passe. Le lien n’apparaît pas sur le site public. Aucun compte visiteur n’est nécessaire.

Sur une installation neuve :

```sh
npm run setup:admin
npm start
```

Ce script génère un chemin aléatoire et un mot de passe de 32 caractères. `.env` ne contient que le hash scrypt du mot de passe. Le fichier d’accès contient le mot de passe en clair : le conserver dans un gestionnaire de mots de passe puis le retirer du serveur de publication. `.env`, ce fichier et `data/` sont exclus de Git et du contexte Docker.

Le lien seul ne donne pas accès aux données : les API nécessitent une session. Le cookie admin est HttpOnly et SameSite=Strict, avec Secure quand `PUBLIC_ORIGIN` est en HTTPS. La session expire après 8 heures et au redémarrage. Les modifications exigent aussi un jeton anti-CSRF et une origine autorisée. Les tentatives de connexion sont limitées. Il n’y a pas encore de deuxième facteur ni de comptes admin distincts.

Pour renouveler le lien ET le mot de passe :

```sh
npm run setup:admin -- --rotate
```

Redémarrer ensuite le serveur. Cela invalide les anciennes sessions.

## Signalements et IP

Le drapeau sur la vidéo distante ouvre un formulaire. L’envoi n’est possible que pendant une association active et termine la conversation. Le serveur choisit lui-même l’IP du partenaire ; une IP fournie dans le formulaire serait ignorée. Les signalements contiennent motif, commentaire facultatif, heure, IP et pays estimé du signalé, identifiants techniques de session. Aucune capture ni contenu du chat n’est collecté automatiquement. L’IP du déclarant ne figure pas dans le dossier ; un hash temporaire sert à limiter les abus de signalement en mémoire.

Le panel permet de filtrer et paginer, examiner, annoter, classer sans suite, traiter ou supprimer un dossier. Il permet aussi de bloquer l’IP 1, 7 ou 30 jours, de déconnecter ses sessions actives et de lever un blocage. Une IP partagée peut correspondre à plusieurs personnes ; une IP VPN ne révèle pas l’identité ou l’IP habituelle. Ces blocages sont des mesures limitées, pas des interdictions impossibles à contourner.

En local, les IP seront souvent `127.0.0.1`. En production, le proxy doit écraser `X-Real-IP` et être le seul accès réseau au serveur Node. Définir `TRUST_PROXY=true` seulement dans ce cas. Avec plusieurs proxies ou un CDN, leur chaîne de confiance doit être configurée avant de l’activer : sinon l’IP affichée peut être celle du proxy, ou une valeur falsifiable.

## Statistiques

- En direct, actualisé toutes les 5 secondes quand l’onglet admin est visible : connexions ouvertes, visiteurs en attente, duos actifs, pages vues du jour et pic de connexions simultanées du jour. L’actualisation automatique n’écrase pas les notes ni les champs en cours de saisie.
- Par mois et par jour : pages vues, connexions WebSocket, pic de connexions simultanées, duos créés, signalements reçus. Les nouvelles colonnes sont ajoutées automatiquement aux bases existantes ; aucun historique antérieur de pages vues ou de pics n’est inventé.
- Visiteurs distincts mensuels : identifiants de navigateurs ayant accepté les statistiques, transformés par HMAC avec un contexte mensuel.

Une connexion en ligne correspond à un onglet du chat ouvert, même sans caméra. Une reconnexion compte comme une connexion supplémentaire. Une page vue correspond à un chargement de l’accueil ou d’une page légale avec JavaScript, sans cookie ni identifiant pour cette mesure. Le panel n’est pas compté. Un duo créé ne prouve pas que la vidéo a abouti. Les visiteurs consentants ne constituent ni un décompte exhaustif ni une identification des personnes. Robots, bloqueurs et multi-appareils peuvent fausser les statistiques. Les mois sans activité n’ont pas de ligne et aucune fréquentation historique n’est inventée. La bande passante des vidéos doit être suivie chez le prestataire TURN.

Les statistiques ne contiennent aucune IP. Le consentement facultatif est désactivé par défaut ; son retrait demande l’effacement des décomptes distincts liés à l’identifiant local sur les 13 mois conservés. Les compteurs d’activité agrégés restent présents. La suppression d’un signalement retire son dossier personnel, mais pas le compteur historique agrégé.

## Confidentialité

Les visiteurs peuvent masquer leur pays, demander un relais vidéo obligatoire quand TURN est configuré et accepter/refuser la mesure facultative de visiteurs distincts. Le relais voit l’IP de connexion ; il la masque à l’autre participant. Le choix du relais s’applique à la prochaine recherche. Un VPN ou un relais n’empêche pas l’interlocuteur d’enregistrer son écran.

Le panel permet de renseigner l’exploitant, son adresse, le contact, l’hébergeur et les informations sur les transferts. Aurora Web & Security et aurorawebsec@gmail.com sont les valeurs initiales fournies par l’exploitant ; l’adresse et l’hébergement restent à compléter. Le texte public présente données, finalités, destinataires, durées et droits. L’éditeur doit l’adapter et valider les bases légales et la situation réelle avant publication, en particulier pour un hébergement hors UE. Références : [information des personnes, CNIL](https://www.cnil.fr/fr/conformite-rgpd-information-des-personnes-et-transparence), [durées de conservation, CNIL](https://www.cnil.fr/fr/passer-laction/les-durees-de-conservation-des-donnees).

Les signalements et le journal d’actions admin sont conservés 30 jours par défaut (7/30/90 au choix). Les blocages expirent au terme choisi. La purge s’exécute au démarrage, chaque minute et lors de l’actualisation admin. Les statistiques sont conservées sur le mois courant et les 12 précédents. Les dossiers supprimés ne sont plus accessibles par l’application ; l’effacement des sauvegardes et la conservation des journaux de l’hébergeur restent à configurer par l’exploitant.

## Stockage et déploiement

La base est `data/mingle.sqlite` (`DATA_FILE` permet de changer le chemin). Le fichier et ses fichiers SQLite associés ne doivent jamais être placés dans `public/`. La base n’est pas chiffrée au repos par l’application : restreindre l’accès au disque et aux sauvegardes. Le serveur ne propose aucune route pour télécharger cette base.

Docker Compose utilise le volume persistant `mingle-data`. Le conserver lors des mises à jour. Ne pas lancer plusieurs instances partageant cette architecture : associations et sessions admin restent en mémoire. Une sauvegarde cohérente doit être réalisée avec les outils SQLite ou serveur arrêté, sans oublier les contraintes de conservation. Une copie brute de la base en activité peut omettre les écritures du journal WAL.

Pour un hébergeur sans volume persistant, les dossiers seraient perdus au redéploiement : ajouter un disque persistant avant publication. Protéger l’admin avec HTTPS et, si possible, limiter son accès réseau à l’administration. Ne pas acheter de certificat payant uniquement pour ce panel : le certificat HTTPS du domaine suffit.

## Tests

`npm test` vérifie notamment authentification, refus sans CSRF ou avec origine étrangère, limitation des connexions, IP déterminée par le serveur, blocages, retrait du consentement, conservation après redémarrage et purge. `npm run test:e2e` teste aussi le parcours visiteur → signalement → traitement admin, ainsi que les réglages de confidentialité dans un vrai navigateur avec caméras simulées.
