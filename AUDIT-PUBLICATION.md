# Audit de publication — Mingle TV

État du projet examiné le 9 septembre 2026. Exploitant indiqué : Aurora Web & Security. Contact : aurorawebsec@gmail.com. Domaine prévu : mingletv.app.

**Conclusion : base fonctionnelle pour un pilote, mais pas encore prête pour une ouverture publique sans configuration supplémentaire.** Le frontend est préparé pour Vercel ; le serveur de chat nécessite un hébergement persistant séparé dans cette architecture. Aucun déploiement public, DNS ni relais réel n’a été réalisé pendant cet audit.

## Résultats et corrections

| Élément | État vérifié |
| --- | --- |
| Rencontres vidéo | Association, signalisation WebRTC, audio/vidéo simulés, skip, stop et refus caméra testés localement |
| Chat textuel | Isolation entre conversations, rejet des anciennes conversations, rendu des messages en texte |
| Admin | Panel existant vérifié et accès local généré ; mot de passe scrypt, session HttpOnly/SameSite, Secure en HTTPS, expiration, contrôle d’origine, CSRF et limitation des tentatives |
| Fréquentation | Pages vues, connexions ouvertes, attente, duos, pics simultanés, historique journalier/mensuel ; actualisation des métriques toutes les 5 secondes sans écraser les saisies admin |
| Données | SQLite persistante, migration des nouveaux compteurs, maintien des données au redémarrage et purge testés |
| Signalements | Motif, détails et IP déterminée par le serveur ; examen, annotation, suppression, blocage 1/7/30 jours et déblocage testés |
| Textes | Conditions, confidentialité et règles adaptées en français ; copies anglaises renommées conservées hors des fichiers publiés |
| Accès adulte | Confirmation non cochée par défaut, exigée avant la caméra et par le protocole d’entrée en file ; ce n’est pas une vérification d’âge |
| Vercel | Build statique avec une liste fermée de fichiers publics ; origine backend configurable ; données publiques accessibles à l’origine autorisée ; admin conservée sur le backend |
| Secrets | `.env`, fiche admin et base exclus de Git ; aucune inclusion dans le build statique ; fichiers admin servis sans mise en cache |

Les tests ne constituent pas un audit d’intrusion exhaustif ni une validation juridique.

## Points à régler avant l’ouverture

1. **Hébergement du backend.** Choisir et configurer une instance Node 24+, HTTPS/WebSockets, sans mise en veille et avec disque persistant. Garder une seule instance ; la file et les sessions admin restent en mémoire. Définir les origines exactes pour le site et le panel. Le port Node ne doit pas être accessible directement si `TRUST_PROXY=true`.
2. **Relais TURN.** Installer/configurer un relais et ses quotas, puis tester `RELAY_ONLY=true` entre Wi-Fi et réseau mobile. Sans TURN, certaines rencontres échoueront ; avec une connexion directe, l’interlocuteur peut découvrir l’IP réseau. Les identifiants temporaires TURN sont actuellement renouvelés en reconnectant/rechargeant la page après leur durée de validité de 24 heures.
3. **Mentions et traitements réels.** Compléter l’adresse et les informations d’identification requises selon le statut de l’exploitant ; renseigner les prestataires, pays, transferts, durées de logs, emails et sauvegardes. L’identité et le contact fournis sont intégrés ; les informations manquantes sont signalées explicitement. Faire valider les textes selon l’activité et les pays ciblés.
4. **Modération et accès des mineurs.** Définir qui traite les signalements, selon quels délais, comment gérer les contenus illégaux et les recours, et quelles mesures de protection des mineurs appliquer. Le système actuel ne possède ni vérification fiable d’âge, ni détection de nudité, ni surveillance vidéo, ni modération 24 h/24. Les blocages IP peuvent être contournés ou affecter un réseau partagé.
5. **Exploitation.** Configurer les sauvegardes SQLite cohérentes et leur effacement, le suivi de disponibilité et les alertes de consommation TURN. Effectuer un test de charge avant une ouverture large. Le plafond de 2 000 connexions est une limite logicielle, pas une capacité démontrée. Les protections actuelles ne remplacent pas une défense contre des attaques distribuées ; les identifiants TURN sont remis aux connexions autorisées par origine sans authentification visiteur, et nécessitent des quotas côté relais.

## Vercel : ce qui est livré

Le [guide VERCEL.md](VERCEL.md) décrit le frontend sur `mingletv.app` et un backend persistant, par exemple `api.mingletv.app` à créer. Vercel supporte désormais les WebSockets ; la difficulté de ce dépôt est surtout l’état en mémoire et SQLite locale. Une migration entièrement dans des Functions demanderait stockage et coordination externes, et gestion de leurs interruptions. Le build fourni ne prétend pas réaliser cette migration.

Le tableau admin compte les onglets de chat connectés, pas les personnes physiques. Les visiteurs distincts ne couvrent que les navigateurs ayant consenti. Les pages vues dépendent de JavaScript et du serveur disponible ; elles peuvent être faussées par des robots ou bloqueurs. Les statistiques n’indiquent pas les octets de vidéo consommés : ce suivi appartient au relais.

## Validation locale

- **22 tests serveur/admin/build réussis sous Node 24.**
- **9 parcours navigateur validés sous Edge**, avec caméra et microphone simulés : rencontre, chat, skip/stop, signalement et traitement admin, préférences, déclaration adulte, affichage mobile/ordinateur et mise à jour automatique.
- Frontend construit puis servi sur une origine différente du backend : vidéo, informations publiques et statistiques admin vérifiées.
- Dépendances installées par `npm ci` ; aucun avis de vulnérabilité remonté par l’audit npm lors de cette vérification.
- Un premier démarrage d’Edge s’est fermé avant un test ; le parcours concerné a ensuite été relancé avec succès.

Node par défaut dans le terminal de cet ordinateur était **20.11.1**, insuffisant pour le projet. Les validations ont utilisé Node 24 via un exécutable npm dédié, sans modifier l’installation globale. Sélectionner Node 24+ avant `npm start` ou `npm test`.

Les résultats locaux ne valident pas les caméras physiques, les navigateurs Safari/Firefox, les réseaux mobiles, le domaine public, TLS, le serveur TURN ni la résistance à une charge réelle.

## Références consultées

- [Vercel : WebSockets, durée et stockage de l’état](https://vercel.com/docs/functions/websockets).
- [Vercel : limites du stockage SQLite local](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel).
- [Vercel : configuration du build](https://vercel.com/docs/builds/configure-a-build).
- [CNIL : information des personnes](https://www.cnil.fr/fr/conformite-rgpd-information-des-personnes-et-transparence).
- [CNIL : durées de conservation](https://www.cnil.fr/fr/passer-laction/les-durees-de-conservation-des-donnees).

Accès local : voir `ADMIN-ACCESS.local.txt`, qui contient le lien et le mot de passe et ne doit pas être publié. Les informations d’exploitation se complètent dans le panel.
