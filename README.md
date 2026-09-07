# Mingle

Site de rencontres vidéo aléatoires sans inscription. Interface minimale : deux caméras côte à côte, pays, chat, Rechercher / skip et stop. Un drapeau permet de signaler et une roue dentée ouvre les réglages de confidentialité. La caméra locale est à gauche, celle de l’inconnu à droite.

## Lancer sur ton ordinateur

Installer Node.js 24, puis ouvrir un terminal dans ce dossier :

```sh
npm ci
npm start
```

Ouvrir **http://localhost:3000**. Cliquer sur Rechercher puis autoriser caméra et microphone dans le navigateur. Aucun écran intermédiaire. Pour essayer seul, ouvrir une deuxième fenêtre ou un autre navigateur sur cette même adresse. Certains appareils ne permettent pas à deux navigateurs de partager la même caméra. Avec deux appareils différents, utiliser le site publié en HTTPS.

Ne pas ouvrir directement `public/index.html` : le serveur est indispensable. Ne pas copier `.env.example` pour un simple essai local, car son origine HTTPS d’exemple refuserait la connexion locale.

## Ce qui fonctionne

- Rechercher : activer caméra et micro, puis rejoindre la file aléatoire.
- skip : quitter et rechercher une nouvelle personne. L’ancien partenaire doit cliquer sur skip pour reprendre sa recherche.
- stop : quitter et libérer la caméra et le microphone. Ce bouton est à gauche de skip.
- Caméra locale à gauche, caméra distante à droite, avec audio.
- Pays estimé de chaque connexion, affiché sous forme de drapeau et de nom.
- Indicateur animé pendant la recherche ; messages visibles uniquement en cas d’erreur.
- Fermer ou recharger la page libère la caméra et le microphone.

Le chat compact sous les caméras permet d’envoyer par Entrée ou par le bouton flèche. Il est actif dès la mise en relation et s’efface au changement de partenaire, au départ ou à stop. Ni le chat ni la vidéo ne sont enregistrés. Les signalements, blocages et statistiques sont maintenant conservés dans une base SQLite privée. Voir [ADMIN.md](ADMIN.md) pour l’accès et l’exploitation.

## Affichage du pays

Le serveur utilise une base GeoIP locale pour estimer le pays de l’adresse réseau. Aucune permission GPS ni requête à un service de géolocalisation externe n’est nécessaire. Seul le code pays est transmis au partenaire par la signalisation de l’application. En local, sur une adresse privée ou inconnue, le site affiche `🌐 —`. Un VPN peut faire apparaître le pays de sa sortie réseau.

En accès direct, laisser `TRUST_PROXY=false`. Derrière le proxy Caddy fourni, définir `TRUST_PROXY=true` : Caddy remplace `X-Real-IP` par l’adresse du visiteur. Le port Node doit rester inaccessible directement depuis Internet. Avec un autre hébergeur, configurer ce même en-tête fiable avant d’activer cette option. Ne pas faire confiance à un en-tête fourni directement par le visiteur.

La base livrée avec geoip-lite peut vieillir. Prévoir son actualisation pour une exploitation publique, selon les [instructions de geoip-lite](https://github.com/geoip-lite/node-geoip#built-in-updater). Ce produit inclut des données GeoLite créées par [MaxMind](https://www.maxmind.com/).

## Publier

Il reste à fournir ton domaine, ton hébergement et les paramètres du relais vidéo. Aucun compte n’est demandé aux visiteurs. Un compte chez un hébergeur peut être nécessaire pour toi, selon l’hébergement choisi.

Un hébergement de fichiers statiques seul ne suffit pas. Le serveur Node.js doit rester actif et accepter les WebSockets. Déployer **une seule instance** : la file d’attente est en mémoire. Plusieurs instances sépareraient les visiteurs en files indépendantes.

### 1. Configuration

Pour une installation neuve, copier `.env.example` en `.env` et renseigner les variables ci-dessous. Si `npm run setup:admin` a déjà créé `.env`, modifier ce fichier sans l’écraser afin de conserver les identifiants admin.

```dotenv
PORT=3000
PUBLIC_ORIGIN=https://chat.ton-domaine.fr
TURN_URLS=turn:turn.ton-domaine.fr:3478?transport=udp,turn:turn.ton-domaine.fr:3478?transport=tcp
TURN_SECRET=ton-secret-aleatoire
RELAY_ONLY=true
```

`PUBLIC_ORIGIN` doit correspondre exactement à l’adresse visitée, sans slash final. Utiliser un seul domaine canonique et rediriger les autres vers lui. Le secret reste côté serveur ; le navigateur reçoit des identifiants TURN temporaires valables 24 heures. Après 24 heures d’ouverture, recharger la page avant une nouvelle rencontre pour renouveler ces identifiants. Ne jamais publier `.env` dans un dépôt.

`RELAY_ONLY=true` impose le relais pour ne pas exposer l’adresse IP directe à l’interlocuteur. Le relais doit être opérationnel. `false` autorise les connexions directes et réduit la bande passante du relais, mais l’autre participant peut alors découvrir l’IP réseau. Sans paramètres TURN, le site essaie seulement STUN et la vidéo peut échouer entre certains réseaux. Le besoin de TURN est expliqué dans la [documentation WebRTC](https://webrtc.org/getting-started/turn-server).

### 2. Héberger l’application

Sur un serveur Linux avec Docker Compose installé, transférer ce projet et le fichier `.env`, puis exécuter :

```sh
docker compose up -d --build
docker compose logs --tail=50 app
```

Le serveur écoute sur `127.0.0.1:3000`, pour être exposé par un proxy HTTPS. Docker redémarre l’application automatiquement. Le conteneur exécute Node avec un utilisateur non administrateur.

Si ton hébergeur fournit déjà HTTPS et WebSockets : utiliser le Dockerfile, ou configurer `npm ci --omit=dev` comme commande de construction et `npm start` comme commande de lancement. Renseigner les variables dans son interface, déclarer le port 3000 ou son `PORT` fourni, et utiliser `/health` pour le contrôle de disponibilité. Garder une seule instance active, sans mise en veille automatique si tu souhaites des connexions continues.

### 3. Activer HTTPS sur un VPS

Faire pointer l’enregistrement DNS du domaine vers le serveur. Installer Caddy sur l’hôte, adapter `Caddyfile.example` et placer son contenu dans la configuration Caddy de ce serveur. Autoriser les ports TCP 80 et 443. Le proxy dirige le trafic vers `127.0.0.1:3000` et accepte aussi les WebSockets.

Avec un domaine valide et les ports accessibles, Caddy obtient et renouvelle les certificats : [guide officiel Caddy](https://caddyserver.com/docs/quick-starts/reverse-proxy). L’accès à la caméra exige HTTPS, sauf sur localhost : [documentation getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).

### 4. Configurer le relais vidéo

Le fichier `coturn.conf.example` fournit une configuration de départ pour un serveur coturn avec une IP publique. Sur un serveur Debian/Ubuntu avec coturn disponible :

```sh
sudo apt-get update
sudo apt-get install coturn
```

Générer un secret aléatoire, par exemple avec `openssl rand -hex 32`. Copier ce même secret dans `TURN_SECRET` et `static-auth-secret` de coturn. Adapter `realm` et `server-name` au domaine TURN. Installer la configuration adaptée dans `/etc/turnserver.conf`, puis lancer :

```sh
sudo systemctl enable --now coturn
sudo systemctl restart coturn
```

Faire pointer le domaine TURN directement vers le serveur, sans proxy HTTP intermédiaire. Ouvrir **3478 UDP et TCP**, ainsi que **49160–49260 UDP** dans le pare-feu système et chez l’hébergeur. En cas de NAT, renseigner `external-ip` comme expliqué dans le fichier. Pour les réseaux n’autorisant que TLS, ajouter un point d’accès TURN TLS et son certificat selon la [configuration officielle coturn](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf), puis ajouter son URL `turns:` à `TURN_URLS`.

La plage de ports, les quotas et la bande passante sont à dimensionner selon la fréquentation. Le fichier fourni ne garantit pas une capacité particulière. Le serveur TURN est un service distinct du conteneur de l’application.

### 5. Vérifier le site publié

Ouvrir le site sur deux appareils, l’un en Wi-Fi et l’autre en réseau mobile. Tester vidéo dans les deux sens, audio, pays et Suivant. Faire ce test avec `RELAY_ONLY=true` pour confirmer le fonctionnement du relais. Vérifier que la fermeture de la page libère la caméra.

Les tests locaux ont été exécutés avec des caméras simulées sous Edge. Ils ne remplacent pas ce test de réseau : aucun hébergement public ni relais réel n’a été configuré ou validé dans ce projet.

Les règles et informations de confidentialité sont accessibles par la roue dentée. L’administration permet désormais la modération a posteriori des signalements et les blocages IP temporaires. Elle ne surveille pas les vidéos et ne vérifie pas l’âge. Compléter dans le panel le nom de l’exploitant, le contact et l’hébergement, puis valider les bases légales et l’encadrement des transferts avant l’ouverture publique. Les textes fournis ne constituent pas une certification de conformité.

## Tester et modifier

```sh
npm test
npx playwright install chromium
npm run test:e2e
```

Sur Windows avec Edge déjà installé :

```powershell
$env:PLAYWRIGHT_CHANNEL='msedge'
npm run test:e2e
```

Les tests couvrent les associations, le protocole serveur, les départs, le contrôle d’origine, la détection des pays, les identifiants TURN et le parcours vidéo en un clic avec changement de partenaire. Ils vérifient aussi le refus de caméra et la disposition côte à côte sur mobile et ordinateur. Les captures sont produites dans `test-results/`.

| Fichier | Rôle |
| --- | --- |
| `public/index.html` | Structure et textes de l’interface |
| `public/style.css` | Couleurs, mise en page, adaptations mobiles |
| `public/app.js` | Caméra, WebRTC, pays et recherche |
| `server.js` | Serveur HTTP, associations, messages et signalisation |
| `.env.example` | Paramètres de publication |
| `Dockerfile`, `compose.yaml` | Déploiement de l’application |
| `Caddyfile.example` | Proxy HTTPS |
| `coturn.conf.example` | Relais audio/vidéo |

Pour modifier le nom, chercher `Mingle` et `mingle` dans les fichiers de l’interface. Pour changer les couleurs, modifier les variables au début de `public/style.css`. `npm run dev` relance le serveur lors des modifications ; recharger le navigateur pour les changements visuels.

Le serveur limite les paquets WebSocket à 32 Ko, le trafic d’une connexion à 150 événements sur 10 secondes et les connexions simultanées à 2 000. Cette dernière valeur est un plafond de protection, pas une capacité mesurée. Les associations et états expirent au redémarrage du serveur.
