begin;
select plan(62);

-- f1 writes and shares; f2 is the stranger. f1 is a member, f2 is on the trial.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 'f1@test.local',
   '{"profile":{"displayName":"Eva","vocative":"Evo","dateOfBirth":"1992-03-03","gender":"female"},"consent":{"accepted":true}}'),
  ('00000000-0000-0000-0000-0000000000f2', 'f2@test.local',
   '{"profile":{"displayName":"Jana","vocative":"Jano","dateOfBirth":"1985-01-01"},"consent":{"accepted":true}}');
insert into public.entitlements (user_id, active, plan) values ('00000000-0000-0000-0000-0000000000f1', true, 'founding');

update public.app_config set value = '100000' where key in
  ('journal.writes_per_minute', 'journal.entries_per_day', 'limits.rate_per_minute');
-- No quiet time after an edit, so the sweep can be tested without waiting.
update public.app_config set value = '0' where key = 'journal.reindex_delay_seconds';

create temp table t (k text primary key, v jsonb) on commit drop;
grant all on t to authenticated, service_role;
create function pg_temp.v(p_k text) returns jsonb language sql as $$ select v from t where k = p_k $$;
grant execute on function pg_temp.v(text) to authenticated, service_role;
create function pg_temp.as_user(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p_user), true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;
create function pg_temp.dec(p_user uuid, p_value bytea) returns text language sql security definer as $$
  select private.decrypt(p_user, p_value)
$$;
grant execute on function pg_temp.dec(uuid, bytea) to service_role;
-- A 1024-dimension vector as JSON, pointing along one axis.
create function pg_temp.vec(p_axis int) returns jsonb language sql as $$
  select jsonb_agg(case when i = p_axis then 1 else 0 end order by i) from generate_series(1, 1024) i
$$;
grant execute on function pg_temp.vec(int) to service_role;
-- Lease one journal job the way claim_jobs does, and remember it.
create function pg_temp.lease(p_k text, p_entry uuid) returns void language plpgsql security definer as $$
declare j ops.jobs_queue%rowtype;
begin
  update ops.jobs_queue set locked_at = now(), lease = gen_random_uuid(), attempts = attempts + 1
  where kind = 'journal' and done_at is null and payload ->> 'entry_id' = p_entry::text
  returning * into j;
  insert into t values (p_k, jsonb_build_object('id', j.id, 'lease', j.lease))
  on conflict (k) do update set v = excluded.v;
end $$;
grant execute on function pg_temp.lease(text, uuid) to service_role;

-- Access ---------------------------------------------------------------------------

select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('journal_job_context', 'journal_job_save', 'enqueue_journal_memory')
     and (has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute'))),
  null, 'the journal job functions are not executable by anon or authenticated');
select ok(
  (select bool_and(has_function_privilege('service_role', p.oid, 'execute'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('journal_job_context', 'journal_job_save', 'enqueue_journal_memory', 'memory_search', 'purge_expired')),
  'they, and the replaced memory_search and purge_expired, are executable by service_role');
select ok(
  not has_function_privilege('service_role', 'public.journal_share(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.journal_share(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.journal_unshare(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.clear_memory()', 'execute')
  and has_function_privilege('authenticated', 'public.get_memory()', 'execute'),
  'sharing is the user''s act: only a signed-in user can call it');

-- Entries ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
insert into t values ('e1', public.journal_save('60000000-0000-0000-0000-000000000001',
  'SDILENYJEDNA Dnes jsem si uvědomila, že mámě už nemusím nic dokazovat.', 'Máma'));
insert into t values ('e2', public.journal_save('60000000-0000-0000-0000-000000000002',
  'SOUKROMYDVA Tohle nikdy nikomu neřeknu. Bojím se, že mě Tomáš opustí.'));
insert into t values ('e3', public.journal_save('60000000-0000-0000-0000-000000000003',
  'SDILENYTRI ' || repeat('Dlouhý zápis o práci. ', 300)));
insert into t values ('e4', public.journal_save('60000000-0000-0000-0000-000000000004',
  'SDILENYCTYRI Rozhodla jsem se říct šéfovi, že odcházím.'));

-- Share ------------------------------------------------------------------------------

insert into t values ('s1', public.journal_share((pg_temp.v('e1') -> 'entry' ->> 'id')::uuid));
select ok(pg_temp.v('s1') ->> 'kind' = 'ok'
  and (pg_temp.v('s1') -> 'entry' ->> 'sharedWithAi')::boolean
  and pg_temp.v('s1') -> 'entry' ->> 'sharedAt' is not null
  and pg_temp.v('s1') ->> 'conversationId' is not null
  and pg_temp.v('s1') -> 'entry' ->> 'conversationId' = pg_temp.v('s1') ->> 'conversationId',
  'sharing marks the entry and opens a conversation');
select is(public.journal_share((pg_temp.v('e1') -> 'entry' ->> 'id')::uuid) ->> 'conversationId',
  pg_temp.v('s1') ->> 'conversationId', 'sharing again returns to the same conversation');
select is((public.get_memory() ->> 'sharedEntriesCount')::int, 1, 'the memory screen counts shared entries');
select ok(
  public.get_conversation((pg_temp.v('s1') ->> 'conversationId')::uuid) -> 'conversation' ->> 'origin' = 'journal_share'
  and public.get_conversation((pg_temp.v('s1') ->> 'conversationId')::uuid) -> 'messages' -> 0 ->> 'eventKind' = 'journal_shared'
  and public.get_conversation((pg_temp.v('s1') ->> 'conversationId')::uuid) -> 'messages' -> 0 ->> 'eventRef'
      = pg_temp.v('e1') -> 'entry' ->> 'id',
  'the conversation starts with an event that points at the entry');
select throws_ok($$select public.journal_share('99999999-9999-9999-9999-999999999999')$$,
  'P0002', 'NOT_FOUND', 'sharing an entry that does not exist is not found');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select throws_ok(format('select public.journal_share(%L)', pg_temp.v('e2') -> 'entry' ->> 'id'),
  'P0002', 'NOT_FOUND', 'another user cannot share the entry');
select throws_ok(format('select public.journal_unshare(%L)', pg_temp.v('e1') -> 'entry' ->> 'id'),
  'P0002', 'NOT_FOUND', 'another user cannot un-share the entry');
select throws_ok(format('select public.get_conversation(%L)', pg_temp.v('s1') ->> 'conversationId'),
  'P0002', 'NOT_FOUND', 'another user cannot open the conversation it was shared into');
reset role;
select is((select count(*)::int from public.conversations where user_id = '00000000-0000-0000-0000-0000000000f1'),
  1, 'a refused or repeated share opens no second conversation');

-- The chat turn ------------------------------------------------------------------------

set local role service_role;
insert into t values ('t1', public.start_turn('00000000-0000-0000-0000-0000000000f1',
  '61000000-0000-0000-0000-000000000001', 'Chci s tebou sdílet svůj zápis z deníku.',
  (pg_temp.v('s1') ->> 'conversationId')::uuid));
select ok(pg_temp.v('t1') ->> 'kind' = 'turn'
  and pg_temp.v('t1') -> 'context' -> 'journalEntry' ->> 'text'
      = 'SDILENYJEDNA Dnes jsem si uvědomila, že mámě už nemusím nic dokazovat.'
  and pg_temp.v('t1') -> 'context' -> 'journalEntry' ->> 'title' = 'Máma'
  and pg_temp.v('t1') -> 'context' -> 'journalEntry' ->> 'id' = pg_temp.v('e1') -> 'entry' ->> 'id'
  and (pg_temp.v('t1') -> 'context' -> 'journalEntry' ->> 'truncated')::boolean = false
  and pg_temp.v('t1') -> 'context' ->> 'message' = 'Chci s tebou sdílet svůj zápis z deníku.',
  'the first turn in that conversation carries the entry, read by the server');
select is((pg_temp.v('t1') -> 'context' -> 'conversation' ->> 'exchangeCount')::int, 0, 'it is the opening exchange');

insert into t values ('t2', public.start_turn('00000000-0000-0000-0000-0000000000f1',
  '61000000-0000-0000-0000-000000000002', 'Ahoj, jak se máš?'));
select ok(pg_temp.v('t2') -> 'context' -> 'journalEntry' is null
          or jsonb_typeof(pg_temp.v('t2') -> 'context' -> 'journalEntry') = 'null',
  'an ordinary conversation never carries an entry');
select ok(position('SOUKROMYDVA' in pg_temp.v('t1')::text) = 0 and position('SOUKROMYDVA' in pg_temp.v('t2')::text) = 0,
  'no private entry is anywhere in a turn context');
reset role;

-- A long entry is cut for the AI.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
insert into t values ('s3', public.journal_share((pg_temp.v('e3') -> 'entry' ->> 'id')::uuid));
reset role;
set local role service_role;
insert into t values ('t3', public.start_turn('00000000-0000-0000-0000-0000000000f1',
  '61000000-0000-0000-0000-000000000003', 'Tady je.', (pg_temp.v('s3') ->> 'conversationId')::uuid));
select ok(char_length(pg_temp.v('t3') -> 'context' -> 'journalEntry' ->> 'text') = 4000
  and (pg_temp.v('t3') -> 'context' -> 'journalEntry' ->> 'truncated')::boolean,
  'an entry over journal.share_max_chars is cut and marked');
reset role;

-- After the injection window the entry leaves the prompt.
update public.conversations set exchange_count = 10 where id = (pg_temp.v('s1') ->> 'conversationId')::uuid;
set local role service_role;
select ok(jsonb_typeof(public.start_turn('00000000-0000-0000-0000-0000000000f1',
  '61000000-0000-0000-0000-000000000004', 'A co dál?', (pg_temp.v('s1') ->> 'conversationId')::uuid)
  -> 'context' -> 'journalEntry') is not distinct from 'null',
  'after journal.share_inject_exchanges exchanges the entry is no longer injected');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select isnt(public.journal_share((pg_temp.v('e1') -> 'entry' ->> 'id')::uuid) ->> 'conversationId',
  pg_temp.v('s1') ->> 'conversationId', 'sharing again after the window opens a fresh conversation');
reset role;
update public.conversations set exchange_count = 0 where id = (pg_temp.v('s1') ->> 'conversationId')::uuid;

-- The gates ----------------------------------------------------------------------------

-- f2: on the trial with replies left, then none.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
insert into t values ('g1', public.journal_save('60000000-0000-0000-0000-000000000011', 'JANINZAPIS Dnes bylo hezky.'));
insert into t values ('g1s', public.journal_share((pg_temp.v('g1') -> 'entry' ->> 'id')::uuid));
select is(pg_temp.v('g1s') ->> 'kind', 'ok', 'a trial user with free replies left can share');
select public.journal_unshare((pg_temp.v('g1') -> 'entry' ->> 'id')::uuid);
reset role;
update public.usage_state set trial_used = 5 where user_id = '00000000-0000-0000-0000-0000000000f2';
update public.conversations set cleared_at = now() where user_id = '00000000-0000-0000-0000-0000000000f2';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
insert into t values ('g2', public.journal_share((pg_temp.v('g1') -> 'entry' ->> 'id')::uuid));
select ok(pg_temp.v('g2') ->> 'kind' = 'limit' and pg_temp.v('g2') ->> 'code' = 'PAYWALL',
  'past the free replies and without a membership, sharing is behind the paywall');
select is((public.journal_get((pg_temp.v('g1') -> 'entry' ->> 'id')::uuid) ->> 'sharedWithAi')::boolean, false,
  'and the refused share changed nothing');
select is(public.journal_save(gen_random_uuid(), 'Psát můžu dál.') ->> 'kind', 'ok', 'the paywall does not stop writing');

select public.withdraw_consent(array['ai_processing']::public.consent_kind[]);
insert into t values ('g3', public.journal_share((pg_temp.v('g1') -> 'entry' ->> 'id')::uuid));
select is(pg_temp.v('g3') ->> 'code', 'AI_PAUSED', 'without AI consent sharing is paused (checked before the paywall)');
select is(public.journal_save(gen_random_uuid(), 'Bez AI souhlasu se píše dál.') ->> 'kind', 'ok',
  'withdrawing AI consent does not stop writing');
reset role;

update public.app_config set value = '3' where key = 'journal.shares_per_day';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
insert into t values ('g4', public.journal_share((pg_temp.v('e4') -> 'entry' ->> 'id')::uuid));
select ok(pg_temp.v('g4') ->> 'code' = 'RATE_LIMITED' and (pg_temp.v('g4') ->> 'retryAfterSeconds')::int between 1 and 86400,
  'the daily share limit refuses with the time to Prague midnight');
select is(public.journal_share((pg_temp.v('e3') -> 'entry' ->> 'id')::uuid) ->> 'conversationId',
  pg_temp.v('s3') ->> 'conversationId', 'going back to an entry already shared is not a new share');
reset role;
update public.app_config set value = '100' where key = 'journal.shares_per_day';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
insert into t values ('s4', public.journal_share((pg_temp.v('e4') -> 'entry' ->> 'id')::uuid));
reset role;

-- The sweep and the job ------------------------------------------------------------------

-- Test-only (rolled back): assertions read tables directly as the service role.
grant select on all tables in schema public to service_role;
grant select, update on all tables in schema ops to service_role;

select is((select count(*)::int from ops.jobs_queue where kind = 'journal'), 0, 'sharing itself queues nothing');
set local role service_role;
select is(public.enqueue_journal_memory(), 3, 'the sweep queues the three shared entries');
select is(public.enqueue_journal_memory(), 0, 'and does not queue them twice');
select is(
  (select array_agg(distinct jsonb_object_keys order by jsonb_object_keys)
   from ops.jobs_queue q, jsonb_object_keys(q.payload) where q.kind = 'journal'),
  array['entry_id'], 'a journal job carries the entry id and nothing else');

-- job_context is the wrong door: it would close the job. The worker must not use it.
select pg_temp.lease('j1', (pg_temp.v('e1') -> 'entry' ->> 'id')::uuid);
insert into t values ('c1', public.journal_job_context((pg_temp.v('j1') ->> 'id')::bigint, (pg_temp.v('j1') ->> 'lease')::uuid));
select ok(pg_temp.v('c1') ->> 'kind' = 'journal'
  and pg_temp.v('c1') ->> 'text' = 'SDILENYJEDNA Dnes jsem si uvědomila, že mámě už nemusím nic dokazovat.'
  and pg_temp.v('c1') ->> 'title' = 'Máma' and (pg_temp.v('c1') ->> 'version')::int = 1
  and pg_temp.v('c1') ->> 'gender' = 'female',
  'the job reads the shared entry');
select is(public.journal_job_context((pg_temp.v('j1') ->> 'id')::bigint, gen_random_uuid()) ->> 'skip', 'stale',
  'a wrong lease reads nothing');

select is(public.journal_job_save((pg_temp.v('j1') ->> 'id')::bigint, (pg_temp.v('j1') ->> 'lease')::uuid,
  jsonb_build_object('version', 1, 'moments', jsonb_build_array(
    jsonb_build_object('content', 'Uvědomila si, že mámě už nemusí nic dokazovat.', 'embedding', pg_temp.vec(5)),
    jsonb_build_object('content', 'Druhý moment.', 'embedding', pg_temp.vec(6)),
    jsonb_build_object('content', 'Třetí moment navíc.', 'embedding', pg_temp.vec(7)))),
  '[{"purpose":"memory","model":"gpt-5.6-luna","tokensIn":500,"tokensOut":40,"costEur":0.0001,"durationMs":300,"ok":true}]'),
  'saved', 'the job stores its reflections');
select is(
  (select array_agg(pg_temp.dec(user_id, content_enc) order by pg_temp.dec(user_id, content_enc) desc)
   from public.memory_embeddings where source = 'journal_entry' and source_id = (pg_temp.v('e1') -> 'entry' ->> 'id')::uuid),
  array['Uvědomila si, že mámě už nemusí nic dokazovat.', 'Druhý moment.'],
  'at most journal.moments_per_entry reflections are kept, encrypted');
select ok(
  (select indexed_version = version and shared_with_ai from public.journal_entries
   where id = (pg_temp.v('e1') -> 'entry' ->> 'id')::uuid)
  and (select done_at is not null and last_error is null from ops.jobs_queue where id = (pg_temp.v('j1') ->> 'id')::bigint)
  and exists (select 1 from ops.ai_calls where user_id = '00000000-0000-0000-0000-0000000000f1' and purpose = 'memory'),
  'the entry is marked indexed, the job is done and its model call is logged');
select is(
  (select (occurred_at at time zone 'Europe/Prague')::date from public.memory_embeddings
   where source_id = (pg_temp.v('e1') -> 'entry' ->> 'id')::uuid limit 1),
  (pg_temp.v('e1') -> 'entry' ->> 'entryDate')::date, 'a reflection is dated by the entry''s day');
select is(public.journal_job_save((pg_temp.v('j1') ->> 'id')::bigint, (pg_temp.v('j1') ->> 'lease')::uuid,
  '{"version":1,"moments":[]}'), 'stale', 'a finished job cannot be saved again');
select is(public.enqueue_journal_memory(), 0, 'an indexed entry is not queued again');

-- Layer 4 finds it.
select is((select count(*)::int from public.memory_search('00000000-0000-0000-0000-0000000000f1',
  (pg_temp.vec(5))::text::extensions.vector)), 1, 'memory_search returns the reflection of a shared entry');
select is((select count(*)::int from public.memory_search('00000000-0000-0000-0000-0000000000f2',
  (pg_temp.vec(5))::text::extensions.vector)), 0, 'and never to another user');
reset role;

-- A vector that should not exist: planted for the private entry.
insert into public.memory_embeddings (user_id, source, source_id, content_enc, embedding, occurred_at)
select '00000000-0000-0000-0000-0000000000f1', 'journal_entry', (pg_temp.v('e2') -> 'entry' ->> 'id')::uuid,
       private.encrypt('00000000-0000-0000-0000-0000000000f1', 'SOUKROMYDVA nesmí ven.'),
       (pg_temp.vec(9))::text::extensions.vector, now();
set local role service_role;
select is((select count(*)::int from public.memory_search('00000000-0000-0000-0000-0000000000f1',
  (pg_temp.vec(9))::text::extensions.vector)), 0,
  'memory_search ignores a journal row whose entry is not shared, even if the row exists');
reset role;
delete from public.memory_embeddings where source_id = (pg_temp.v('e2') -> 'entry' ->> 'id')::uuid;

-- An edit while the job is running.
set local role service_role;
select pg_temp.lease('j4', (pg_temp.v('e4') -> 'entry' ->> 'id')::uuid);
insert into t values ('c4', public.journal_job_context((pg_temp.v('j4') ->> 'id')::bigint, (pg_temp.v('j4') ->> 'lease')::uuid));
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select public.journal_save(null, 'SDILENYCTYRI Rozhodla jsem se zůstat ještě rok.', null, null,
  (pg_temp.v('e4') -> 'entry' ->> 'id')::uuid, 1);
reset role;
set local role service_role;
select is(public.journal_job_save((pg_temp.v('j4') ->> 'id')::bigint, (pg_temp.v('j4') ->> 'lease')::uuid,
  jsonb_build_object('version', (pg_temp.v('c4') ->> 'version')::int, 'moments', jsonb_build_array(
    jsonb_build_object('content', 'Rozhodla se odejít z práce.', 'embedding', pg_temp.vec(11))))),
  'stale', 'a job that read the old text writes nothing after an edit');
select ok(
  not exists (select 1 from public.memory_embeddings where source_id = (pg_temp.v('e4') -> 'entry' ->> 'id')::uuid)
  and (select last_error = 'changed' and done_at is not null from ops.jobs_queue where id = (pg_temp.v('j4') ->> 'id')::bigint),
  'nothing about the old text is stored, and the job is closed as changed');
select is(public.enqueue_journal_memory(), 1, 'the sweep queues the edited entry again at once');
select pg_temp.lease('j4', (pg_temp.v('e4') -> 'entry' ->> 'id')::uuid);
select is(public.journal_job_context((pg_temp.v('j4') ->> 'id')::bigint, (pg_temp.v('j4') ->> 'lease')::uuid) ->> 'text',
  'SDILENYCTYRI Rozhodla jsem se zůstat ještě rok.', 'and the new job reads the new text');
select is(public.journal_job_save((pg_temp.v('j4') ->> 'id')::bigint, (pg_temp.v('j4') ->> 'lease')::uuid,
  '{"version":2,"moments":[]}'), 'saved', 'an entry with no insight is a finished job with no memory row');
select ok(
  not exists (select 1 from public.memory_embeddings where source_id = (pg_temp.v('e4') -> 'entry' ->> 'id')::uuid)
  and (select indexed_version = 2 from public.journal_entries where id = (pg_temp.v('e4') -> 'entry' ->> 'id')::uuid)
  and public.enqueue_journal_memory() = 0,
  'it counts as indexed and is not queued again');

-- A failed job is not retried every minute.
select pg_temp.lease('j3', (pg_temp.v('e3') -> 'entry' ->> 'id')::uuid);
select public.fail_job((pg_temp.v('j3') ->> 'id')::bigint, (pg_temp.v('j3') ->> 'lease')::uuid, 'bad_output', false);
select is(public.enqueue_journal_memory(), 0, 'an entry whose job just failed for good waits before the next try');
reset role;
update ops.jobs_queue set created_at = now() - interval '7 hours' where id = (pg_temp.v('j3') ->> 'id')::bigint;
set local role service_role;
select is(public.enqueue_journal_memory(), 1, 'and is tried again after six hours');
reset role;

-- Un-share while a job is running.
set local role service_role;
select pg_temp.lease('j3', (pg_temp.v('e3') -> 'entry' ->> 'id')::uuid);
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
insert into t values ('u3', public.journal_unshare((pg_temp.v('e3') -> 'entry' ->> 'id')::uuid));
select ok(pg_temp.v('u3') ->> 'kind' = 'ok' and not (pg_temp.v('u3') -> 'entry' ->> 'sharedWithAi')::boolean
  and pg_temp.v('u3') -> 'entry' ->> 'sharedAt' is null, 'an entry can be taken back');
select is(public.journal_unshare((pg_temp.v('e3') -> 'entry' ->> 'id')::uuid) ->> 'kind', 'ok', 'taking it back twice is fine');
reset role;
set local role service_role;
select is(public.journal_job_save((pg_temp.v('j3') ->> 'id')::bigint, (pg_temp.v('j3') ->> 'lease')::uuid,
  jsonb_build_object('version', 1, 'moments', jsonb_build_array(
    jsonb_build_object('content', 'Z práce je unavená.', 'embedding', pg_temp.vec(12))))),
  'stale', 'a job that finishes after the un-share writes nothing');
select ok(
  not exists (select 1 from public.memory_embeddings where source_id = (pg_temp.v('e3') -> 'entry' ->> 'id')::uuid)
  and jsonb_typeof(public.start_turn('00000000-0000-0000-0000-0000000000f1', '61000000-0000-0000-0000-000000000005',
        'Ještě k tomu.', (pg_temp.v('s3') ->> 'conversationId')::uuid) -> 'context' -> 'journalEntry') is not distinct from 'null',
  'an un-shared entry has no memory row and is no longer put into its conversation''s prompt');
reset role;

-- Un-share and delete remove memory in the same transaction.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select public.journal_unshare((pg_temp.v('e1') -> 'entry' ->> 'id')::uuid);
reset role;
select ok(
  not exists (select 1 from public.memory_embeddings where source = 'journal_entry'
              and user_id = '00000000-0000-0000-0000-0000000000f1')
  and (select indexed_version is null from public.journal_entries where id = (pg_temp.v('e1') -> 'entry' ->> 'id')::uuid),
  'un-sharing removes the entry''s reflections at once');

-- Consent withdrawn mid-flight, then given again.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select public.journal_share((pg_temp.v('e1') -> 'entry' ->> 'id')::uuid);
reset role;
set local role service_role;
select public.enqueue_journal_memory();
select pg_temp.lease('j1', (pg_temp.v('e1') -> 'entry' ->> 'id')::uuid);
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select public.withdraw_consent(array['ai_processing']::public.consent_kind[]);
reset role;
set local role service_role;
select ok(
  public.journal_job_context((pg_temp.v('j1') ->> 'id')::bigint, (pg_temp.v('j1') ->> 'lease')::uuid) ->> 'skip' = 'stale'
  and public.journal_job_save((pg_temp.v('j1') ->> 'id')::bigint, (pg_temp.v('j1') ->> 'lease')::uuid,
        '{"version":1,"moments":[]}') = 'stale'
  and public.enqueue_journal_memory() = 0
  and (select last_error = 'consent' from ops.jobs_queue where id = (pg_temp.v('j1') ->> 'id')::bigint),
  'withdrawing AI consent closes the journal job, and nothing is queued while paused');
reset role;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select public.grant_consent(array['ai_processing']::public.consent_kind[], '2026-10', 'settings', '1.0');
reset role;
set local role service_role;
select is(public.enqueue_journal_memory(), 1, 'giving consent again queues the shared entry that is not indexed');
reset role;

-- Forget everything ------------------------------------------------------------------------

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select public.clear_memory();
select ok((public.get_memory() ->> 'sharedEntriesCount')::int = 0
  and jsonb_array_length(public.journal_list(null, 30, true) -> 'items') = 0
  and (public.journal_home() ->> 'total')::int = 4,
  '"forget everything" takes every entry back from the AI and deletes none of them');
reset role;
select ok(
  not exists (select 1 from public.memory_embeddings where user_id = '00000000-0000-0000-0000-0000000000f1')
  and not exists (select 1 from ops.jobs_queue where user_id = '00000000-0000-0000-0000-0000000000f1'
                  and kind = 'journal' and done_at is null),
  'and leaves no memory row and no waiting journal job');

-- The nightly purge --------------------------------------------------------------------------

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select public.journal_delete((pg_temp.v('e2') -> 'entry' ->> 'id')::uuid);
select public.journal_delete((pg_temp.v('e4') -> 'entry' ->> 'id')::uuid);
reset role;
update public.journal_entries set deleted_at = now() - interval '25 hours' where id = (pg_temp.v('e2') -> 'entry' ->> 'id')::uuid;
set local role service_role;
select is((public.purge_expired() ->> 'journalEntries')::int, 1, 'the purge hard-deletes entries deleted more than 24 hours ago');
reset role;
select ok(
  not exists (select 1 from public.journal_entries where id = (pg_temp.v('e2') -> 'entry' ->> 'id')::uuid)
  and exists (select 1 from public.journal_entries where id = (pg_temp.v('e4') -> 'entry' ->> 'id')::uuid and deleted_at is not null),
  'and leaves the ones still inside the undo window');

select ok(
  (select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private', 'ops') and p.prosrc like '%body_enc%'
     and p.proname not in ('journal_full', 'journal_save', 'journal_save_message', 'journal_search',
                           'turn_context', 'journal_job_context',
                           -- feedback.body_enc, a different table's column of the same name
                           'send_feedback', 'claim_feedback')),
  'only the listed functions ever read or write an entry''s body');

select * from finish();
rollback;
