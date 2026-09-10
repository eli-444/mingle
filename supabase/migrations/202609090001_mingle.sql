-- Mingle TV — exécuter dans le SQL Editor d'un projet Supabase dédié.
-- Schéma utilisé par les API Vercel + Supabase du projet.
-- Aucune table de messages, de vidéo ou d'audio.
-- Toutes les RPC métier sont réservées à service_role (serveur uniquement).
-- Une session Supabase Auth, éventuellement anonyme, identifie chaque visiteur.
-- Le backend vérifie ce JWT et l'IP réelle avant d'appeler ces fonctions.

begin;

create schema if not exists mingle_private;
revoke all on schema mingle_private from public, anon, authenticated;
grant usage on schema mingle_private to service_role;

create table if not exists mingle_private.settings (
  id boolean primary key default true check (id),
  operator text not null default 'Aurora Web & Security' check (length(operator) <= 500),
  contact text not null default 'aurorawebsec@gmail.com' check (length(contact) <= 500),
  address text not null default '' check (length(address) <= 500),
  hosting text not null default '' check (length(hosting) <= 500),
  retention_days integer not null default 30 check (retention_days in (7,30,90)),
  updated_at timestamptz not null default now()
);
insert into mingle_private.settings(id) values (true) on conflict do nothing;

create table if not exists mingle_private.daily_stats (
  day date primary key,
  pageviews bigint not null default 0 check (pageviews >= 0),
  connections bigint not null default 0 check (connections >= 0),
  peak bigint not null default 0 check (peak >= 0),
  matches bigint not null default 0 check (matches >= 0),
  reports bigint not null default 0 check (reports >= 0)
);
create table if not exists mingle_private.minute_stats (
  minute timestamptz primary key,
  visits bigint not null default 0 check (visits >= 0),
  countries jsonb not null default '{}'::jsonb
);
create index if not exists mingle_minute_stats_minute on mingle_private.minute_stats(minute);
create table if not exists mingle_private.monthly_visitors (
  month date not null check (extract(day from month) = 1),
  visitor_hash text not null check (visitor_hash ~ '^[a-f0-9]{64}$'),
  primary key (month, visitor_hash)
);
-- visitor_hash = HMAC(secret serveur, mois + identifiant navigateur consentant).
-- Aucune IP, aucun identifiant navigateur brut dans les statistiques.

create table if not exists mingle_private.visitor_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ip inet not null check (masklen(ip) = case family(ip) when 4 then 32 else 128 end),
  country text check (country ~ '^[A-Z]{2}$'),
  hide_country boolean not null default false,
  adult_confirmed_at timestamptz,
  state text not null default 'idle' check (state in ('idle','waiting','matched','stopped')),
  current_room uuid,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  queued_at timestamptz,
  expires_at timestamptz not null default (now() + interval '90 seconds'),
  check ((state = 'matched') = (current_room is not null))
);
create index if not exists mingle_sessions_waiting on mingle_private.visitor_sessions(queued_at) where state = 'waiting';
create index if not exists mingle_sessions_expiry on mingle_private.visitor_sessions(expires_at);
create index if not exists mingle_sessions_user on mingle_private.visitor_sessions(user_id);
create index if not exists mingle_sessions_ip on mingle_private.visitor_sessions(ip);

create table if not exists mingle_private.rooms (
  id uuid primary key default gen_random_uuid(),
  first_session uuid not null,
  second_session uuid not null,
  state text not null default 'active' check (state in ('active','ended')),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  check (first_session <> second_session),
  check ((state = 'ended') = (ended_at is not null))
);
-- Les identifiants de sessions dans rooms ne sont pas des FK : purge indépendante.
create index if not exists mingle_rooms_active on mingle_private.rooms(created_at) where state = 'active';
create table if not exists mingle_private.session_blocks (
  session_id uuid not null references mingle_private.visitor_sessions(id) on delete cascade,
  peer_user_id uuid not null,
  primary key(session_id, peer_user_id)
);

create table if not exists mingle_private.reports (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,
  reporter_session uuid not null,
  reported_session uuid not null,
  reported_ip inet not null,
  reported_country text,
  reason text not null check (reason in ('Nudité / contenu sexuel','Harcèlement / haine','Mineur présumé','Violence / menace','Spam / escroquerie','Autre')),
  details text not null default '' check (length(details) <= 1000),
  status text not null default 'pending' check (status in ('pending','reviewing','resolved','dismissed')),
  notes text not null default '' check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(room_id, reporter_session)
);
create index if not exists mingle_reports_status on mingle_private.reports(status, created_at desc);
create index if not exists mingle_reports_created on mingle_private.reports(created_at);
create table if not exists mingle_private.ip_bans (
  ip inet primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at)
);
create table if not exists mingle_private.admin_audit (
  id bigint generated always as identity primary key,
  actor text not null check (length(actor) between 1 and 120),
  action text not null check (length(action) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists mingle_audit_created on mingle_private.admin_audit(created_at desc);
create table if not exists mingle_private.admin_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  csrf_hash text not null check (csrf_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '8 hours')
);
-- Les mots de passe/hash scrypt et secrets TURN restent dans les variables serveur.
create table if not exists mingle_private.rate_limits (
  bucket text primary key check (length(bucket) between 1 and 200),
  hits integer not null default 1 check (hits > 0),
  expires_at timestamptz not null
);
create table if not exists mingle_private.contact_requests (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (length(first_name) between 1 and 100),
  last_name text not null check (length(last_name) between 1 and 100),
  email text not null check (length(email) between 3 and 320),
  message text not null check (length(message) between 1 and 5000),
  status text not null default 'new' check (status in ('new','in_progress','closed')),
  notes text not null default '' check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mingle_contact_requests_status on mingle_private.contact_requests(status, created_at desc);

-- Défense en profondeur : RLS sans policy navigateur sur toutes les tables privées.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname = 'mingle_private' loop
    execute format('alter table mingle_private.%I enable row level security', t.tablename);
    execute format('revoke all on mingle_private.%I from public, anon, authenticated', t.tablename);
    execute format('grant all on mingle_private.%I to service_role', t.tablename);
  end loop;
end $$;
revoke all on all sequences in schema mingle_private from public, anon, authenticated;
grant usage, select on all sequences in schema mingle_private to service_role;

-- Helpers privés ; verrou commun pour sérialiser les changements d'association.
create or replace function mingle_private.close_room(p_room uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update mingle_private.rooms set state='ended', ended_at=now() where id=p_room and state='active';
  update mingle_private.visitor_sessions set state='idle', current_room=null, queued_at=null where current_room=p_room;
end $$;

create or replace function mingle_private.increment(p_counter text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_counter not in ('pageviews','connections','matches','reports') then raise exception 'Invalid counter'; end if;
  execute format('insert into mingle_private.daily_stats(day,%I) values ($1,1) on conflict(day) do update set %I=mingle_private.daily_stats.%I+1', p_counter,p_counter,p_counter)
    using (now() at time zone 'UTC')::date;
end $$;

create or replace function mingle_private.is_banned(p_ip inet)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from mingle_private.ip_bans where ip=p_ip and expires_at>now());
$$;

create or replace function public.mingle_open_session(p_user uuid, p_ip inet, p_country text default null, p_hide_country boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_connected bigint;
begin
  perform pg_advisory_xact_lock(70909001);
  if mingle_private.is_banned(p_ip) then raise exception 'Access suspended' using errcode='42501'; end if;
  if (select count(*) from mingle_private.visitor_sessions where expires_at>now() and state<>'stopped') >= 2000 then raise exception 'Capacity reached'; end if;
  insert into mingle_private.visitor_sessions(user_id,ip,country,hide_country) values(p_user,p_ip,p_country,p_hide_country) returning id into v_id;
  perform mingle_private.increment('connections');
  select count(*) into v_connected from mingle_private.visitor_sessions where expires_at>now() and state<>'stopped';
  insert into mingle_private.daily_stats(day,peak) values((now() at time zone 'UTC')::date,v_connected)
    on conflict(day) do update set peak=greatest(mingle_private.daily_stats.peak,excluded.peak);
  return v_id;
end $$;

create or replace function public.mingle_heartbeat(p_user uuid, p_session uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update mingle_private.visitor_sessions set last_seen_at=now(), expires_at=now()+interval '90 seconds'
    where id=p_session and user_id=p_user and expires_at>now() and state<>'stopped' and not mingle_private.is_banned(ip);
  return found;
end $$;

-- Retour filtré : jamais d'IP, notes admin ou identifiants de l'autre utilisateur.
create or replace function public.mingle_session_state(p_user uuid, p_session uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s mingle_private.visitor_sessions; r mingle_private.rooms; peer mingle_private.visitor_sessions;
begin
  select * into s from mingle_private.visitor_sessions where id=p_session and user_id=p_user and expires_at>now();
  if not found then return jsonb_build_object('state','expired'); end if;
  if mingle_private.is_banned(s.ip) then return jsonb_build_object('state','banned'); end if;
  if s.current_room is not null then
    select * into r from mingle_private.rooms where id=s.current_room and state='active';
    select * into peer from mingle_private.visitor_sessions where id=case when r.first_session=s.id then r.second_session else r.first_session end and expires_at>now();
    if r.id is null or peer.id is null then return jsonb_build_object('state','left'); end if;
    return jsonb_build_object('state','matched','room',r.id,'topic','mingle:room:'||r.id::text,'initiator',r.first_session=s.id,'country',case when peer.hide_country then null else peer.country end);
  end if;
  return jsonb_build_object('state',s.state);
end $$;

create or replace function public.mingle_join(p_user uuid, p_session uuid, p_adult boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s mingle_private.visitor_sessions; peer mingle_private.visitor_sessions; v_room uuid;
begin
  perform pg_advisory_xact_lock(70909001);
  select * into s from mingle_private.visitor_sessions where id=p_session and user_id=p_user and expires_at>now() for update;
  if not found or s.state='stopped' then raise exception 'Session expired'; end if;
  if p_adult is distinct from true then raise exception 'Adult declaration required' using errcode='42501'; end if;
  if mingle_private.is_banned(s.ip) then raise exception 'Access suspended' using errcode='42501'; end if;
  if s.current_room is not null then return public.mingle_session_state(p_user,p_session); end if;
  update mingle_private.visitor_sessions set adult_confirmed_at=coalesce(adult_confirmed_at,now()), last_seen_at=now(), expires_at=now()+interval '90 seconds' where id=s.id;
  select * into peer from mingle_private.visitor_sessions c
    where c.state='waiting' and c.expires_at>now() and c.id<>s.id and c.user_id<>s.user_id and not mingle_private.is_banned(c.ip)
    and not exists(select 1 from mingle_private.session_blocks b where (b.session_id=s.id and b.peer_user_id=c.user_id) or (b.session_id=c.id and b.peer_user_id=s.user_id))
    order by c.queued_at, c.id limit 1 for update;
  if peer.id is null then
    update mingle_private.visitor_sessions set state='waiting',queued_at=coalesce(queued_at,now()) where id=s.id;
    return jsonb_build_object('state','waiting');
  end if;
  insert into mingle_private.rooms(first_session,second_session) values(s.id,peer.id) returning id into v_room;
  update mingle_private.visitor_sessions set state='matched',current_room=v_room,queued_at=null where id in (s.id,peer.id);
  perform mingle_private.increment('matches');
  return public.mingle_session_state(p_user,p_session);
end $$;

create or replace function public.mingle_leave(p_user uuid, p_session uuid, p_stop boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare s mingle_private.visitor_sessions;
begin
  perform pg_advisory_xact_lock(70909001);
  select * into s from mingle_private.visitor_sessions where id=p_session and user_id=p_user for update;
  if not found then return; end if;
  if s.current_room is not null then perform mingle_private.close_room(s.current_room); end if;
  update mingle_private.visitor_sessions set state=case when p_stop then 'stopped' else 'idle' end, current_room=null,queued_at=null where id=s.id;
end $$;

create or replace function public.mingle_set_privacy(p_user uuid, p_session uuid, p_hide_country boolean)
returns void language sql security definer set search_path = '' as $$
  update mingle_private.visitor_sessions set hide_country=p_hide_country where id=p_session and user_id=p_user and expires_at>now();
$$;

create or replace function public.mingle_report(p_user uuid, p_session uuid, p_room uuid, p_reason text, p_details text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare s mingle_private.visitor_sessions; peer mingle_private.visitor_sessions; v_id uuid; v_hits integer;
begin
  perform pg_advisory_xact_lock(70909001);
  select * into s from mingle_private.visitor_sessions where id=p_session and user_id=p_user and expires_at>now() and state='matched' and current_room=p_room for update;
  if not found then raise exception 'Not in this conversation' using errcode='42501'; end if;
  if mingle_private.is_banned(s.ip) then raise exception 'Access suspended' using errcode='42501'; end if;
  select * into peer from mingle_private.visitor_sessions where current_room=p_room and id<>s.id and state='matched' and expires_at>now();
  if not found then raise exception 'Peer has left'; end if;
  -- Ce compteur IP privé expire après une heure ; il n'est pas une statistique.
  insert into mingle_private.rate_limits(bucket,hits,expires_at) values('report:'||host(s.ip),1,now()+interval '1 hour')
  on conflict(bucket) do update set hits=case when mingle_private.rate_limits.expires_at<=now() then 1 else mingle_private.rate_limits.hits+1 end,
    expires_at=case when mingle_private.rate_limits.expires_at<=now() then now()+interval '1 hour' else mingle_private.rate_limits.expires_at end
  returning hits into v_hits;
  if v_hits>5 then raise exception 'Report rate limit exceeded'; end if;
  insert into mingle_private.reports(room_id,reporter_session,reported_session,reported_ip,reported_country,reason,details)
    values(p_room,s.id,peer.id,peer.ip,peer.country,p_reason,btrim(p_details)) returning id into v_id;
  insert into mingle_private.session_blocks values(s.id,peer.user_id) on conflict do nothing;
  perform mingle_private.increment('reports');
  perform mingle_private.close_room(p_room);
  return v_id;
end $$;

create or replace function public.mingle_admin_review(p_report uuid, p_status text, p_notes text, p_actor text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update mingle_private.reports set status=p_status,notes=p_notes,updated_at=now() where id=p_report;
  if not found then raise exception 'Report not found'; end if;
  insert into mingle_private.admin_audit(actor,action) values(p_actor,'Review report '||p_report::text);
end $$;

create or replace function public.mingle_admin_ban(p_report uuid, p_days integer, p_actor text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_ip inet; r record;
begin
  if p_days is null or p_days not in (1,7,30) then raise exception 'Invalid duration'; end if;
  perform pg_advisory_xact_lock(70909001);
  select reported_ip into v_ip from mingle_private.reports where id=p_report;
  if not found then raise exception 'Report not found'; end if;
  insert into mingle_private.ip_bans(ip,expires_at) values(v_ip,now()+make_interval(days=>p_days))
    on conflict(ip) do update set created_at=now(),expires_at=excluded.expires_at;
  for r in select distinct current_room from mingle_private.visitor_sessions where ip=v_ip and current_room is not null loop
    perform mingle_private.close_room(r.current_room);
  end loop;
  update mingle_private.visitor_sessions set state='stopped',current_room=null,queued_at=null where ip=v_ip;
  update mingle_private.reports set status='resolved',updated_at=now() where id=p_report;
  insert into mingle_private.admin_audit(actor,action) values(p_actor,'Ban from report '||p_report::text||' for '||p_days||' days');
end $$;

create or replace function public.mingle_admin_unban(p_ip inet, p_actor text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from mingle_private.ip_bans where ip=p_ip;
  insert into mingle_private.admin_audit(actor,action) values(p_actor,'Unban IP');
end $$;

create or replace function public.mingle_admin_delete_report(p_report uuid, p_actor text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from mingle_private.reports where id=p_report;
  insert into mingle_private.admin_audit(actor,action) values(p_actor,'Delete report '||p_report::text);
end $$;

create or replace function public.mingle_count_pageview(p_country text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_minute timestamptz := date_trunc('minute', now());
begin
  perform mingle_private.increment('pageviews');
  insert into mingle_private.minute_stats(minute,visits,countries)
    values(v_minute,1,case when p_country ~ '^[A-Z]{2}$' then jsonb_build_object(p_country,1) else '{}'::jsonb end)
  on conflict(minute) do update set visits=mingle_private.minute_stats.visits+1,
    countries=case when p_country ~ '^[A-Z]{2}$' then jsonb_set(mingle_private.minute_stats.countries,array[p_country],to_jsonb(coalesce((mingle_private.minute_stats.countries->>p_country)::bigint,0)+1),true) else mingle_private.minute_stats.countries end;
end $$;

create or replace function public.mingle_count_visitor(p_month date, p_hash text, p_remove boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_remove then delete from mingle_private.monthly_visitors where month=p_month and visitor_hash=p_hash;
  else
    if p_month is distinct from date_trunc('month',now() at time zone 'UTC')::date then raise exception 'Current month required'; end if;
    insert into mingle_private.monthly_visitors(month,visitor_hash) values(p_month,p_hash) on conflict do nothing;
  end if;
end $$;

create or replace function public.mingle_metrics()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'visits30m',(select coalesce(sum(visits),0) from mingle_private.minute_stats where minute>=date_trunc('minute',now())-interval '29 minutes'),
    'visitsToday',(select coalesce(sum(visits),0) from mingle_private.minute_stats where minute>=date_trunc('day',now())),
    'visitsMonth',(select coalesce(sum(pageviews),0) from mingle_private.daily_stats where day>=date_trunc('month',now() at time zone 'UTC')::date),
    'reportsTotal',(select count(*) from mingle_private.reports),
    'visitSeries',coalesce((select jsonb_agg(jsonb_build_object('minute',minute,'visits',visits) order by minute) from mingle_private.minute_stats where minute>=date_trunc('minute',now())-interval '29 minutes'),'[]'::jsonb),
    'countries',coalesce((select jsonb_agg(jsonb_build_object('country',country,'visits',visits) order by visits desc) from (select key country,sum(value::bigint) visits from mingle_private.minute_stats, jsonb_each_text(countries) where minute>=now()-interval '30 days' group by key order by visits desc limit 10) ranked),'[]'::jsonb),
    'online',jsonb_build_object(
      'connected',(select count(*) from mingle_private.visitor_sessions where expires_at>now() and state<>'stopped' and not mingle_private.is_banned(ip)),
      'waiting',(select count(*) from mingle_private.visitor_sessions where expires_at>now() and state='waiting' and not mingle_private.is_banned(ip)),
      'conversations',(select count(*) from mingle_private.rooms r join mingle_private.visitor_sessions a on a.id=r.first_session join mingle_private.visitor_sessions b on b.id=r.second_session where r.state='active' and a.expires_at>now() and b.expires_at>now() and not mingle_private.is_banned(a.ip) and not mingle_private.is_banned(b.ip))),
    'daily',coalesce((select jsonb_agg(to_jsonb(d) order by d.day desc) from (select * from mingle_private.daily_stats order by day desc limit 31) d),'[]'::jsonb),
    'monthly',coalesce((select jsonb_agg(to_jsonb(m) order by m.month desc) from (
      select agg.*, (select count(*) from mingle_private.monthly_visitors v where v.month=agg.month) as visitors
      from (select date_trunc('month',s.day)::date as month,sum(s.pageviews) as pageviews,sum(s.connections) as connections,max(s.peak) as peak,sum(s.matches) as matches,sum(s.reports) as reports
        from mingle_private.daily_stats s group by date_trunc('month',s.day)::date) agg order by month desc limit 13
    ) m),'[]'::jsonb));
$$;

create or replace function public.mingle_public_settings()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('operator',operator,'contact',contact,'address',address,'hosting',hosting,'retentionDays',retention_days,'analyticsMonths',13) from mingle_private.settings where id;
$$;

create or replace function public.mingle_cleanup()
returns void language plpgsql security definer set search_path = '' as $$
declare r record; v_days integer; v_oldest date;
begin
  perform pg_advisory_xact_lock(70909001);
  select retention_days into v_days from mingle_private.settings where id;
  for r in select distinct current_room from mingle_private.visitor_sessions where (expires_at<=now() or mingle_private.is_banned(ip)) and current_room is not null loop
    perform mingle_private.close_room(r.current_room);
  end loop;
  delete from mingle_private.visitor_sessions where expires_at<=now();
  delete from mingle_private.rooms where state='ended' and ended_at<now()-interval '1 day';
  delete from mingle_private.rooms room_row where not exists(select 1 from mingle_private.visitor_sessions s where s.current_room=room_row.id) and room_row.created_at<now()-interval '1 day';
  delete from mingle_private.reports where created_at<now()-make_interval(days=>v_days);
  delete from mingle_private.admin_audit where created_at<now()-make_interval(days=>v_days);
  delete from mingle_private.ip_bans where expires_at<=now();
  delete from mingle_private.admin_sessions where expires_at<=now();
  delete from mingle_private.rate_limits where expires_at<=now();
  delete from mingle_private.minute_stats where minute<now()-interval '31 days';
  v_oldest := (date_trunc('month',now() at time zone 'UTC')-interval '12 months')::date;
  delete from mingle_private.daily_stats where day<v_oldest;
  delete from mingle_private.monthly_visitors where month<v_oldest;
end $$;

create or replace function public.mingle_admin_settings(p_operator text,p_contact text,p_address text,p_hosting text,p_retention_days integer,p_actor text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Prendre le verrou avant l'écriture pour conserver l'ordre avec cleanup/report.
  perform pg_advisory_xact_lock(70909001);
  update mingle_private.settings set operator=p_operator,contact=p_contact,address=p_address,hosting=p_hosting,retention_days=p_retention_days,updated_at=now() where id;
  insert into mingle_private.admin_audit(actor,action) values(p_actor,'Update privacy settings');
  perform public.mingle_cleanup();
end $$;

-- Service_role utilise cette RPC au lieu d'exposer le schéma privé à PostgREST.
create or replace function public.mingle_admin_dashboard(p_status text default 'all',p_page integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_status is null or p_status not in ('all','pending','reviewing','resolved','dismissed') or p_page is null or p_page<0 or p_page>100000 then raise exception 'Invalid filter'; end if;
  return public.mingle_metrics() || jsonb_build_object(
    'policy',public.mingle_public_settings(),
    'totalReports',(select count(*) from mingle_private.reports where p_status='all' or status=p_status),
    'reports',coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc) from (select * from mingle_private.reports where p_status='all' or status=p_status order by created_at desc,id limit 50 offset p_page*50) r),'[]'::jsonb),
    'contacts',public.mingle_contact_requests(),
    'bans',coalesce((select jsonb_agg(to_jsonb(b)) from (select * from mingle_private.ip_bans where expires_at>now() order by expires_at desc limit 200) b),'[]'::jsonb),
    'audit',coalesce((select jsonb_agg(to_jsonb(a)) from (select * from mingle_private.admin_audit order by created_at desc,id desc limit 50) a),'[]'::jsonb));
end $$;

-- Sessions admin partagées entre les Functions Vercel. Le backend authentifie le
-- mot de passe et ne stocke que SHA-256(cookie) et SHA-256(jeton CSRF).
create or replace function public.mingle_admin_session_create(p_token_hash text,p_csrf_hash text)
returns void language sql security definer set search_path = '' as $$
  insert into mingle_private.admin_sessions(token_hash,csrf_hash,expires_at) values(p_token_hash,p_csrf_hash,now()+interval '8 hours');
$$;
create or replace function public.mingle_admin_session_read(p_token_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('csrf_hash',csrf_hash,'expires_at',expires_at) from mingle_private.admin_sessions where token_hash=p_token_hash and expires_at>now();
$$;
create or replace function public.mingle_admin_session_delete(p_token_hash text)
returns void language sql security definer set search_path = '' as $$
  delete from mingle_private.admin_sessions where token_hash=p_token_hash;
$$;
create or replace function public.mingle_take_rate_limit(p_bucket text,p_limit integer,p_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_hits integer;
begin
  if p_limit is null or p_limit<1 or p_limit>10000 or p_seconds is null or p_seconds<1 or p_seconds>86400 then raise exception 'Invalid rate limit'; end if;
  insert into mingle_private.rate_limits(bucket,hits,expires_at) values(p_bucket,1,now()+make_interval(secs=>p_seconds))
    on conflict(bucket) do update set hits=case when mingle_private.rate_limits.expires_at<=now() then 1 else mingle_private.rate_limits.hits+1 end,
      expires_at=case when mingle_private.rate_limits.expires_at<=now() then now()+make_interval(secs=>p_seconds) else mingle_private.rate_limits.expires_at end
    returning hits into v_hits;
  return v_hits<=p_limit;
end $$;

create or replace function public.mingle_contact_create(p_first_name text,p_last_name text,p_email text,p_message text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into mingle_private.contact_requests(first_name,last_name,email,message)
    values (btrim(p_first_name),btrim(p_last_name),lower(btrim(p_email)),btrim(p_message)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.mingle_contact_requests()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]'::jsonb)
  from (select id,first_name,last_name,email,message,status,notes,created_at,updated_at
        from mingle_private.contact_requests order by created_at desc limit 200) r;
$$;

create or replace function public.mingle_contact_update(p_request uuid,p_status text,p_notes text,p_actor text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('new','in_progress','closed') or length(p_notes)>2000 then raise exception 'Invalid contact request'; end if;
  update mingle_private.contact_requests set status=p_status,notes=p_notes,updated_at=now() where id=p_request;
  if not found then raise exception 'Contact request not found'; end if;
  insert into mingle_private.admin_audit(actor,action) values(p_actor,'Update contact request '||p_request::text);
end $$;

create or replace function public.mingle_contact_delete(p_request uuid,p_actor text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from mingle_private.contact_requests where id=p_request;
  if not found then raise exception 'Contact request not found'; end if;
  insert into mingle_private.admin_audit(actor,action) values(p_actor,'Delete contact request '||p_request::text);
end $$;

-- Autorisation Realtime : uniquement son canal personnel et son duo encore actif.
-- Ne renvoie qu'un booléen. Les IP et tables privées restent inaccessibles.
create or replace function public.mingle_can_access_channel(p_topic text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from mingle_private.visitor_sessions s
    where s.user_id=(select auth.uid()) and s.expires_at>now() and s.state<>'stopped' and not mingle_private.is_banned(s.ip)
    and (p_topic='mingle:user:'||s.id::text or exists(
      select 1 from mingle_private.rooms r join mingle_private.visitor_sessions other on other.id=case when r.first_session=s.id then r.second_session else r.first_session end
      where r.id=s.current_room and r.state='active' and other.expires_at>now() and not mingle_private.is_banned(other.ip) and p_topic='mingle:room:'||r.id::text
    ))
  );
$$;

-- Réexécutable : ne supprime aucune policy d'une autre application.
drop policy if exists mingle_receive on realtime.messages;
create policy mingle_receive on realtime.messages for select to authenticated
  using (extension in ('broadcast','presence') and public.mingle_can_access_channel((select realtime.topic())));
drop policy if exists mingle_send on realtime.messages;
create policy mingle_send on realtime.messages for insert to authenticated
  with check (extension in ('broadcast','presence') and public.mingle_can_access_channel((select realtime.topic())));

-- Les fonctions PostgreSQL sont exécutables par PUBLIC par défaut : fermer toutes
-- les fonctions de CETTE migration, sans modifier les autres fonctions du projet.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='mingle_private' or (n.nspname='public' and left(p.proname,7)='mingle_') loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
grant execute on function public.mingle_can_access_channel(text) to authenticated;
grant execute on function public.mingle_public_settings() to anon, authenticated;

-- Si pg_cron est déjà activé, installer la purge sans intervention supplémentaire.
do $$ begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    execute $cron$select cron.schedule('mingle-cleanup','* * * * *','select public.mingle_cleanup();')$cron$;
  else
    raise notice 'Activer Supabase Cron puis exécuter supabase/enable-cron.sql pour la purge automatique.';
  end if;
end $$;
commit;
