-- Activer d'abord pg_cron / Cron dans le dashboard Supabase.
-- Le nom fixe remplace le planning existant au lieu de créer des doublons.
select cron.schedule('mingle-cleanup', '* * * * *', 'select public.mingle_cleanup();');
-- Installer aussi cleanup-anonymous.sql avant cette seconde planification.
select cron.schedule('mingle-cleanup-anonymous', '15 * * * *', 'select public.mingle_cleanup_anonymous();');
-- Vérification : select jobname, schedule, active from cron.job where jobname='mingle-cleanup';
