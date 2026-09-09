import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// PostgreSQL réel embarqué. Les schémas Auth/Realtime sont simulés, pas le SQL métier.
const db = new PGlite();
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key, is_anonymous boolean default true, created_at timestamptz default now(), last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to authenticated, service_role;
  create schema realtime;
  create table realtime.messages(id bigint generated always as identity primary key, extension text, topic text);
  alter table realtime.messages enable row level security;
  create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic',true) $$;
  grant usage on schema realtime to authenticated;
  grant select,insert on realtime.messages to authenticated;
  grant usage on sequence realtime.messages_id_seq to authenticated;
`);
const sql = await readFile(new URL('../supabase/migrations/202609090001_mingle.sql', import.meta.url), 'utf8');
await db.exec(sql);
await db.exec(await readFile(new URL('../supabase/cleanup-anonymous.sql', import.meta.url), 'utf8'));
after(() => db.close());
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('anonymous cleanup preserves permanent users and active visitors', async () => {
  for (const n of [90,91,92]) await open(n);
  await db.exec("update auth.users set created_at=now()-interval '31 days' where id in ('00000000-0000-4000-8000-000000000090','00000000-0000-4000-8000-000000000091','00000000-0000-4000-8000-000000000092')");
  await db.query('update auth.users set is_anonymous=false where id=$1', [uid(90)]);
  await db.query('update mingle_private.visitor_sessions set expires_at=now()-interval \'1 second\' where user_id in ($1,$2)', [uid(90),uid(92)]);
  assert.equal(await value('select public.mingle_cleanup_anonymous() as value'), 1);
  assert.equal(await value('select count(*)::int as value from auth.users where id in ($1,$2)', [uid(90),uid(91)]), 2);
  await db.query('delete from auth.users where id in ($1,$2)', [uid(90),uid(91)]);
});

async function value(query, args = []) { return (await db.query(query, args)).rows[0]?.value; }
async function open(n, ip = `192.0.2.${n}`) {
  await db.query('insert into auth.users(id) values($1) on conflict do nothing', [uid(n)]);
  return value("select public.mingle_open_session($1,$2,'FR') as value", [uid(n), ip]);
}
async function join(n, session) { return value('select public.mingle_join($1,$2,true) as value', [uid(n), session]); }
async function leave(n, session) { return db.query('select public.mingle_leave($1,$2,true)', [uid(n),session]); }
async function asUser(n, task) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid(n)]);
  await db.exec('set role authenticated');
  try { return await task(); } finally { await db.exec('reset role'); }
}

test('migration runs twice without losing settings and locks private data', async () => {
  await db.exec("update mingle_private.settings set operator='Preserved'");
  await db.exec(sql);
  assert.equal(await value('select operator as value from mingle_private.settings'), 'Preserved');
  const rows = await db.query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='mingle_private' and c.relkind='r' and not c.relrowsecurity");
  assert.equal(rows.rows.length, 0);
  await asUser(1, async () => {
    await assert.rejects(db.query('select * from mingle_private.reports'), /permission denied/);
    await assert.rejects(db.query('select public.mingle_admin_dashboard()'), /permission denied/);
    await assert.rejects(db.query('select public.mingle_open_session($1,$2)', [uid(1),'192.0.2.1']), /permission denied/);
    assert.equal((await value('select public.mingle_public_settings() as value')).operator, 'Preserved');
  });
});

test('matching creates independent duos and repeat join cannot duplicate a room', async () => {
  const a=await open(1), b=await open(2), c=await open(3), d=await open(4);
  assert.equal((await join(1,a)).state, 'waiting');
  const ab=await join(2,b); assert.equal(ab.state, 'matched');
  assert.equal((await join(1,a)).room, ab.room);
  await join(3,c); const cd=await join(4,d); assert.notEqual(cd.room, ab.room);
  const state=await value('select public.mingle_session_state($1,$2) as value',[uid(1),a]);
  assert.equal(state.room,ab.room); assert.equal(JSON.stringify(state).includes('192.0.2.'),false);
  await asUser(1, async () => {
    assert.equal(await value('select public.mingle_can_access_channel($1) as value',[ab.topic]),true);
    assert.equal(await value('select public.mingle_can_access_channel($1) as value',[cd.topic]),false);
    await db.query("select set_config('realtime.topic',$1,false)",[cd.topic]);
    await assert.rejects(db.query("insert into realtime.messages(extension,topic) values('broadcast',$1)",[cd.topic]),/row-level security/);
    await db.query("select set_config('realtime.topic',$1,false)",[ab.topic]);
    await db.query("insert into realtime.messages(extension,topic) values('broadcast',$1)",[ab.topic]);
  });
  await leave(1,a); assert.equal((await value('select public.mingle_session_state($1,$2) as value',[uid(2),b])).state,'idle');
  await asUser(1,async()=>assert.equal(await value('select public.mingle_can_access_channel($1) as value',[ab.topic]),false));
  await leave(2,b); await leave(3,c); await leave(4,d);
});

test('adult declaration, ownership, country privacy and expiry are enforced', async () => {
  const a=await open(5), b=await open(6);
  await assert.rejects(db.query('select public.mingle_join($1,$2,false)',[uid(5),a]),/Adult/);
  await assert.rejects(db.query('select public.mingle_join($1,$2,true)',[uid(6),a]),/expired/);
  await db.query('select public.mingle_set_privacy($1,$2,true)',[uid(5),a]);
  await join(5,a); assert.equal((await join(6,b)).country,null);
  await db.query("update mingle_private.visitor_sessions set expires_at=now()-interval '1 second' where id=$1",[a]);
  assert.equal(await value('select public.mingle_heartbeat($1,$2) as value',[uid(5),a]),false);
  await db.exec('select public.mingle_cleanup()');
  assert.equal((await value('select public.mingle_session_state($1,$2) as value',[uid(6),b])).state,'idle');
  await leave(6,b);
});

test('report snapshots the actual peer IP, ban ends room and prevents joining', async () => {
  const a=await open(7), b=await open(8); await join(7,a); const room=(await join(8,b)).room;
  await assert.rejects(db.query("select public.mingle_report($1,$2,$3,'Autre','')",[uid(9),a,room]),/Not in/);
  const id=await value("select public.mingle_report($1,$2,$3,'Autre','A examiner') as value",[uid(7),a,room]);
  assert.equal(await value('select host(reported_ip) as value from mingle_private.reports where id=$1',[id]),'192.0.2.8');
  await db.query("select public.mingle_admin_review($1,'reviewing','Notes','admin')",[id]);
  await db.query("select public.mingle_admin_ban($1,7,'admin')",[id]);
  await assert.rejects(open(8),/Access suspended/);
  await db.exec("select public.mingle_admin_unban('192.0.2.8','admin')");
  const again=await open(8); await leave(8,again); await leave(7,a);
  await db.query("select public.mingle_admin_delete_report($1,'admin')",[id]);
  assert.equal(await value('select count(*)::int as value from mingle_private.reports where id=$1',[id]),0);
});

test('statistics deduplicate consented visitors and withdrawal removes them', async () => {
  const month=await value("select date_trunc('month',now() at time zone 'UTC')::date::text as value");
  const hash='a'.repeat(64);
  await db.query('select public.mingle_count_visitor($1,$2)',[month,hash]);
  await db.query('select public.mingle_count_visitor($1,$2)',[month,hash]);
  const metrics=await value('select public.mingle_metrics() as value'); assert.equal(metrics.monthly[0].visitors,1);
  await db.query('select public.mingle_count_visitor($1,$2,true)',[month,hash]);
  assert.equal((await value('select public.mingle_metrics() as value')).monthly[0].visitors,0);
  assert.equal((await value('select public.mingle_admin_dashboard() as value')).policy.operator,'Preserved');
});

test('shared admin sessions, throttling and cleanup work', async () => {
  const token='b'.repeat(64), csrf='c'.repeat(64);
  await db.query('select public.mingle_admin_session_create($1,$2)',[token,csrf]);
  assert.equal((await value('select public.mingle_admin_session_read($1) as value',[token])).csrf_hash,csrf);
  await db.query('select public.mingle_admin_session_delete($1)',[token]);
  assert.equal(await value('select public.mingle_admin_session_read($1) as value',[token]),null);
  assert.equal(await value("select public.mingle_take_rate_limit('test',1,60) as value"),true);
  assert.equal(await value("select public.mingle_take_rate_limit('test',1,60) as value"),false);
  await db.exec("insert into mingle_private.admin_audit(actor,action,created_at) values('test','old',now()-interval '100 days')");
  await db.exec("select public.mingle_admin_settings('Aurora','contact@example.com','','',7,'admin')");
  assert.equal(await value("select count(*)::int as value from mingle_private.admin_audit where action='old'"),0);
});
