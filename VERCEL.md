# Publier Mingle TV avec Vercel

Le dépôt prépare désormais **le frontend sur Vercel**, relié directement à **un serveur Node persistant** pour le chat, les statistiques et l’administration. Un push seul ne configure ni ce serveur, ni sa base, ni le relais vidéo.

Vercel accepte maintenant les WebSockets, mais ses connexions peuvent changer d’instance et s’arrêtent à la durée maximale d’une Function. Les files, la présence et les sessions de cette application sont en mémoire ; sa base SQLite est un fichier local. L’exécution de ce serveur dans une Function perdrait ou séparerait ces données. Voir [WebSockets et état persistant](https://vercel.com/docs/functions/websockets) et [SQLite sur Vercel](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel), vérifiés le 9 septembre 2026.

## 1. Serveur de chat et administration

Utiliser le Dockerfile sur une seule instance sans mise en veille, avec HTTPS, WebSockets et un disque persistant monté sur `/app/data`. Le guide VPS, Caddy et coturn du README reste applicable. `api.mingletv.app` est une proposition de sous-domaine à créer, pas un service déjà déployé.

Variables du serveur :

```dotenv
PUBLIC_ORIGIN=https://mingletv.app
ADMIN_ORIGIN=https://api.mingletv.app
DATA_FILE=/app/data/mingle.sqlite
ADMIN_PATH=<chemin généré localement>
ADMIN_PASSWORD_HASH=<hash généré localement>
TURN_URLS=<URLs du relais réellement installé>
TURN_SECRET=<secret du relais>
RELAY_ONLY=true
```

`ADMIN_ORIGIN` est l’origine où tu ouvres le panel. Si toute l’application est hébergée sur un seul domaine, elle doit être égale à `PUBLIC_ORIGIN` ou rester vide. Ne pas recopier la valeur d’exemple `api.mingletv.app` sur un déploiement à domaine unique.

`TRUST_PROXY=true` uniquement derrière un proxy de confiance qui **remplace** `X-Real-IP`, avec le port Node inaccessible directement depuis Internet. Le navigateur Vercel contacte le serveur de chat directement : ne pas ajouter de réécriture Vercel pour `/ws` ou l’administration.

Le compteur en ligne agrège les onglets de chat reliés à cette instance, même avant l’activation de la caméra. Les pages vues incluent l’accueil et les trois pages légales avec JavaScript. Les stats sont visibles dans le panel du backend, pas dans un tableau Vercel.

## 2. Interface sur Vercel

Importer le dépôt, garder `vercel.json`, sélectionner Node.js 24.x, puis définir dans les variables de **build** :

```dotenv
MINGLE_BACKEND_ORIGIN=https://api.mingletv.app
```

Remplacer cette valeur par l’origine HTTPS effective du serveur. Cette variable est publique et ne doit contenir aucun secret. Ne mettre ni `ADMIN_PASSWORD_HASH`, ni `TURN_SECRET`, ni le fichier d’accès admin dans le projet frontend Vercel.

La commande `npm run build` produit `dist/` à partir d’une liste fermée de fichiers publics, sans les fichiers admin, la base ni les brouillons juridiques. Elle intègre l’origine du backend dans `config.js` et dans la politique de sécurité des pages. Sans origine valide, le build échoue explicitement. `cleanUrls` permet `/terms`, `/privacy` et `/rules`.

Ajouter `mingletv.app` au projet Vercel et configurer ses DNS. Choisir ce domaine comme URL canonique ; rediriger `www` si nécessaire. Une prévisualisation `*.vercel.app` ne peut pas utiliser le chat de production : l’origine autorisée doit correspondre exactement à `PUBLIC_ORIGIN`. Pour tester une preview, utiliser un backend de staging séparé et son origine autorisée, sans ouvrir de joker.

Les réglages de build Vercel sont documentés dans [la configuration des builds](https://vercel.com/docs/builds/configure-a-build).

## 3. Accès admin et ouverture publique

Exécuter `npm run setup:admin` avec Node 24+, puis conserver `ADMIN-ACCESS.local.txt` dans un gestionnaire de mots de passe. Reporter le chemin et le hash dans les variables du backend, puis redémarrer celui-ci. Ouvrir `https://api.mingletv.app/<chemin généré>` et saisir le mot de passe. Les identifiants locaux ne sont pas déployés automatiquement.

Compléter l’adresse et l’hébergement dans le panel. Organiser le traitement des signalements et des demandes de droits. La majorité est déclarative ; aucune vérification d’âge fiable n’est implémentée. Évaluer les mesures de protection des mineurs adaptées au lancement et aux pays visés.

Avant l’ouverture : tester vidéo/audio entre un appareil Wi-Fi et un appareil 4G/5G avec `RELAY_ONLY=true`, puis stop, skip, signalement et blocage. Redémarrer le serveur et vérifier la conservation des statistiques et dossiers. Vérifier les IP observées derrière le proxy, les sauvegardes, les limites de débit et les coûts TURN. Les tests locaux ne valident ni le DNS, ni TLS, ni la bande passante de production.

Une migration **entièrement sur Vercel Functions** demanderait une autre architecture : base distante, file et présence partagées, coordination des messages entre instances, sessions admin partagées et reconnexion avec restauration d’état. Cette migration n’est pas incluse dans le frontend préparé ici.
