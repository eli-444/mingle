# Supabase de Mingle TV

Le code est raccordé à cette base : `lib/supabase-api.js` fournit les API serveur, `client/supabase-transport.js` utilise Auth anonyme et Realtime privé. `npm start` utilise ce mode dès que `SUPABASE_URL` est renseignée. Le [guide Vercel](../VERCEL.md) contient les étapes de publication.

Pour une nouvelle base, exécuter dans SQL Editor :

1. [La migration principale](migrations/202609090001_mingle.sql).
2. [Le nettoyage Auth anonyme](cleanup-anonymous.sql).
3. Après activation de pg_cron, [les tâches de purge](enable-cron.sql).

La migration principale est réexécutable sans suppression des données. Le schéma `mingle_private` ne doit pas être exposé à l'API publique. Toutes les RPC métier sont réservées au serveur ; seuls les paramètres publics et l'autorisation des canaux sont accessibles aux visiteurs. Aucune table n'enregistre les messages ou les vidéos.

Les sessions expirent après 90 secondes sans heartbeat ; la purge s'exécute chaque minute. Les duos terminés sont supprimés après un jour. Les signalements et le journal suivent la rétention admin. Les identités Auth anonymes sans nouvelle connexion depuis 30 jours et sans session active sont supprimées par lots de 500, chaque heure. Cette suppression vise un projet dédié à Mingle et préserve les comptes permanents.

Les autorisations Realtime sont vérifiées à l'abonnement. Le navigateur quitte les anciens canaux et ignore leurs événements après skip ; le contrôle d'état serveur ferme la conversation après départ ou bannissement. Cela ne permet pas de contrôler un logiciel modifié par un utilisateur ni de révoquer une connexion WebRTC établie entre deux logiciels modifiés.

`npm run test:supabase` exécute les tests SQL dans PGlite et ceux des API. `npm run test:supabase:live` crée quatre visiteurs sur le projet configuré, teste les vrais canaux et nettoie ses comptes et son signalement. Il modifie les compteurs agrégés et consomme des quotas ; ne pas le lancer sur une base partagée avec des utilisateurs actifs.
