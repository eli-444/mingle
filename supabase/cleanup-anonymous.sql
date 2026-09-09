-- Projet dédié à Mingle. À exécuter après la migration principale.
-- Supabase ne purge pas automatiquement les comptes Auth anonymes.
-- Préserve les comptes permanents et les visiteurs actuellement connectés.
begin;
create or replace function public.mingle_cleanup_anonymous()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  perform pg_advisory_xact_lock(70909001);
  delete from auth.users where id in (
    select u.id from auth.users u
    where u.is_anonymous is true
      and u.created_at < now() - interval '30 days'
      and coalesce(u.last_sign_in_at, u.created_at) < now() - interval '30 days'
      and not exists (select 1 from mingle_private.visitor_sessions s where s.user_id=u.id and s.expires_at>now() and s.state<>'stopped')
    order by u.created_at limit 500
  );
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function public.mingle_cleanup_anonymous() from public, anon, authenticated;
grant execute on function public.mingle_cleanup_anonymous() to service_role;
do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    execute $cron$select cron.schedule('mingle-cleanup-anonymous','15 * * * *','select public.mingle_cleanup_anonymous();')$cron$;
  else
    raise notice 'Activer pg_cron, puis exécuter enable-cron.sql.';
  end if;
end $$;
commit;
