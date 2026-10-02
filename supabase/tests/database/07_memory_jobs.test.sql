begin;
select plan(49);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d1', 'd1@test.local',
   '{"profile":{"displayName":"Eva","vocative":"Evo","dateOfBirth":"1992-03-03","gender":"female"},"consent":{"accepted":true}}'),
  ('00000000-0000-0000-0000-0000000000d2', 'd2@test.local',
   '{"profile":{"displayName":"Jana","vocative":"Jano","dateOfBirth":"1985-01-01"},"consent":{"accepted":true}}');

create temp table t (k text primary key, v jsonb) on commit drop;
grant all on t to authenticated, service_role;
create function pg_temp.v(p_k text) returns jsonb language sql as $$ select v from t where k = p_k $$;
grant execute on function pg_temp.v(text) to authenticated, service_role;

-- One exchange written straight into the tables (the turn itself is tested in 05).
create function pg_temp.exchange(p_user uuid, p_conv uuid, p_user_text text, p_reply text, p_at timestamptz)
returns void language plpgsql security definer as $$
begin
  insert into public.conversations (id, user_id, last_message_at) values (p_conv, p_user, p_at)
  on conflict (id) do nothing;
  insert into public.messages (conversation_id, user_id, role, status, content_enc, created_at, client_msg_id)
  values (p_conv, p_user, 'user', 'complete', private.encrypt(p_user, p_user_text), p_at, gen_random_uuid()),
         (p_conv, p_user, 'assistant', 'complete', private.encrypt(p_user, p_reply), p_at + interval '1 second', null);
  update public.conversations set exchange_count = exchange_count + 1, last_message_at = p_at + interval '1 second'
  where id = p_conv;
end $$;

grant execute on function pg_temp.exchange(uuid, uuid, text, text, timestamptz) to service_role;

create function pg_temp.dec(p_user uuid, p_value bytea) returns text language sql security definer as $$
  select private.decrypt(p_user, p_value)
$$;
grant execute on function pg_temp.dec(uuid, bytea) to service_role;

-- A 1024-dimension vector as JSON, pointing along one axis.
create function pg_temp.vec(p_axis int) returns jsonb language sql as $$
  select jsonb_agg(case when i = p_axis then 1 else 0 end order by i) from generate_series(1, 1024) i
$$;
grant execute on function pg_temp.vec(int) to service_role;

select pg_temp.exchange('00000000-0000-0000-0000-0000000000d1', '40000000-0000-0000-0000-000000000001',
  'Pracuju jako účetní a už mě to nebaví.', 'Evo, co přesně tě na tom vyčerpává?', now() - interval '3 hours');
select pg_temp.exchange('00000000-0000-0000-0000-0000000000d1', '40000000-0000-0000-0000-000000000001',
  'Hlavně šéf.', 'A co bys chtěla místo toho?', now() - interval '2 hours 50 minutes');
select pg_temp.exchange('00000000-0000-0000-0000-0000000000d1', '40000000-0000-0000-0000-000000000001',
  'Chtěla bych učit jógu.', 'To zní jako jasný směr.', now() - interval '2 hours 40 minutes');
select pg_temp.exchange('00000000-0000-0000-0000-0000000000d2', '40000000-0000-0000-0000-000000000002',
  'Pracuju jako účetní a už mě to nebaví.', 'Jano, co se děje?', now() - interval '2 hours');

-- Test-only (rolled back): assertions read tables directly as the service role.
grant select on all tables in schema public to service_role;
grant select, update on all tables in schema ops to service_role;

-- Access ---------------------------------------------------------------------------
select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('claim_jobs', 'job_context', 'save_job_result', 'fail_job', 'enqueue_idle_memory', 'purge_jobs')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))),
  null, 'worker functions are not executable by anon or authenticated');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('claim_jobs', 'job_context', 'save_job_result', 'fail_job', 'enqueue_idle_memory', 'purge_jobs')
     and has_function_privilege('service_role', p.oid, 'execute')),
  6, 'worker functions are executable by the service role');
select ok(not has_table_privilege('authenticated', 'public.memory_state', 'select')
      and not has_table_privilege('anon', 'public.memory_state', 'select'), 'memory_state is not readable by the app');
select ok((select relrowsecurity from pg_class where oid = 'public.memory_state'::regclass), 'memory_state has RLS on');

set local role service_role;

-- Idle sweep -----------------------------------------------------------------------
select is(public.enqueue_idle_memory(), 2, 'two idle conversations are swept');
select is((select count(*)::int from ops.jobs_queue where done_at is null), 6, 'each gets a summary, a notes and a moments job');
select is(public.enqueue_idle_memory(), 0, 'the sweep handles a conversation once per burst of activity');

-- Claiming ---------------------------------------------------------------------------
insert into t values ('claim', public.claim_jobs(50));
select is(jsonb_array_length(pg_temp.v('claim')), 6, 'all ready jobs are claimed');
select is(jsonb_array_length(public.claim_jobs(50)), 0, 'a claimed job is not handed out twice');

create function pg_temp.job(p_kind text, p_user text) returns bigint language sql as $$
  select id from ops.jobs_queue where kind = p_kind and user_id = p_user::uuid order by id desc limit 1
$$;
create function pg_temp.lease(p_job bigint) returns uuid language sql as $$
  select lease from ops.jobs_queue where id = p_job
$$;
-- The worker's three calls, with the lease the claim handed out.
create function pg_temp.ctx(p_job bigint) returns jsonb language sql as $$
  select public.job_context(p_job, pg_temp.lease(p_job))
$$;
create function pg_temp.save(p_job bigint, p_result jsonb, p_calls jsonb default '[]') returns text language sql as $$
  select public.save_job_result(p_job, pg_temp.lease(p_job), p_result, p_calls)
$$;
create function pg_temp.fail(p_job bigint, p_error text, p_retry boolean, p_count boolean default true) returns void language sql as $$
  select public.fail_job(p_job, pg_temp.lease(p_job), p_error, p_retry, p_count)
$$;

-- Summary ----------------------------------------------------------------------------
insert into t values ('sctx', pg_temp.ctx(pg_temp.job('summary', '00000000-0000-0000-0000-0000000000d1')));
select is(jsonb_array_length(pg_temp.v('sctx') -> 'messages'), 6, 'the summary job reads the raw messages');
select is(pg_temp.v('sctx') -> 'messages' -> 0 ->> 'text', 'Pracuju jako účetní a už mě to nebaví.',
  'messages arrive decrypted and oldest first');
select is(pg_temp.save(pg_temp.job('summary', '00000000-0000-0000-0000-0000000000d1'),
  jsonb_build_object('summary', 'Eva zvažuje odchod z účetnictví; chce učit jógu.',
    'throughMessageId', pg_temp.v('sctx') ->> 'throughMessageId', 'messageCount', 6, 'model', 'gpt-5.6-luna'),
  '[{"purpose":"summary","model":"gpt-5.6-luna","tokensIn":300,"tokensOut":40,"ok":true,"durationMs":800}]'),
  'saved', 'a summary is saved');
select is((select pg_temp.dec(user_id, summary_enc) from public.conversation_summaries
           where conversation_id = '40000000-0000-0000-0000-000000000001'),
  'Eva zvažuje odchod z účetnictví; chce učit jógu.', 'and stored encrypted for its owner');
select is((select count(*)::int from ops.ai_calls where purpose = 'summary'
           and user_id = '00000000-0000-0000-0000-0000000000d1'), 1, 'its cost row is recorded');
select is(pg_temp.save(pg_temp.job('summary', '00000000-0000-0000-0000-0000000000d1'),
  '{"summary":"jiné"}'), 'stale', 'a finished job cannot write twice');

-- Notes --------------------------------------------------------------------------------
insert into t values ('nctx', pg_temp.ctx(pg_temp.job('notes', '00000000-0000-0000-0000-0000000000d1')));
select is(jsonb_array_length(pg_temp.v('nctx') -> 'notes'), 0, 'there are no notes yet');
select is(pg_temp.save(pg_temp.job('notes', '00000000-0000-0000-0000-0000000000d1'),
  jsonb_build_object('throughAt', pg_temp.v('nctx') ->> 'throughAt', 'upsert', jsonb_build_array(
    jsonb_build_object('category', 'work', 'key', 'job', 'content', 'Pracuje jako účetní.', 'confidence', 0.9),
    jsonb_build_object('category', 'goal', 'key', 'goal.main', 'content', 'Chce učit jógu.'),
    jsonb_build_object('category', 'nonsense', 'key', 'x', 'content', 'špatná kategorie'),
    jsonb_build_object('category', 'other', 'key', 'Bad Key', 'content', 'špatný klíč'),
    jsonb_build_object('category', 'other', 'key', 'long', 'content', repeat('a', 401))))),
  'saved', 'notes are saved');
select is((select count(*)::int from public.memory_notes where user_id = '00000000-0000-0000-0000-0000000000d1'),
  2, 'invalid category, key and over-long content are dropped');

-- A changed fact updates its row (G3.3).
select pg_temp.exchange('00000000-0000-0000-0000-0000000000d1', '40000000-0000-0000-0000-000000000001',
  'Dala jsem výpověď.', 'To je velký krok.', now() - interval '2 hours');
-- Two, not three: her moments job from the first sweep is still open and covers it.
select is(public.enqueue_idle_memory(), 1, 'new activity that has gone idle is swept again');
select is((select count(*)::int from ops.jobs_queue where user_id = '00000000-0000-0000-0000-0000000000d1' and done_at is null), 3,
  'without duplicate jobs');
select public.claim_jobs(50);
insert into t values ('nctx2', pg_temp.ctx(pg_temp.job('notes', '00000000-0000-0000-0000-0000000000d1')));
select is(jsonb_array_length(pg_temp.v('nctx2') -> 'messages'), 2, 'the notes job reads only messages it has not seen');
select is(jsonb_array_length(pg_temp.v('nctx2') -> 'notes'), 2, 'and is given the notes that exist');
select pg_temp.save(pg_temp.job('notes', '00000000-0000-0000-0000-0000000000d1'),
  jsonb_build_object('throughAt', pg_temp.v('nctx2') ->> 'throughAt', 'upsert', jsonb_build_array(
    jsonb_build_object('category', 'work', 'key', 'job', 'content', 'Dala výpověď v účetní firmě.'))));
select is((select array_agg(pg_temp.dec(user_id, content_enc) order by key) from public.memory_notes
           where user_id = '00000000-0000-0000-0000-0000000000d1'),
  array['Chce učit jógu.', 'Dala výpověď v účetní firmě.'], 'a changed fact replaces its row, no contradictory pair');

-- Moments ------------------------------------------------------------------------------
insert into t values ('mctx', pg_temp.ctx(pg_temp.job('moments', '00000000-0000-0000-0000-0000000000d1')));
select ok(pg_temp.v('mctx') ? 'messages', 'a long enough conversation can produce moments');
select is(pg_temp.ctx(pg_temp.job('moments', '00000000-0000-0000-0000-0000000000d2')) ->> 'skip', 'short',
  'a one-exchange conversation does not');
select is(pg_temp.save(pg_temp.job('moments', '00000000-0000-0000-0000-0000000000d1'),
  jsonb_build_object('occurredAt', pg_temp.v('mctx') ->> 'occurredAt', 'moments', jsonb_build_array(
    jsonb_build_object('content', 'Rozhodla se odejít z účetnictví.', 'embedding', pg_temp.vec(1)),
    jsonb_build_object('content', 'Uvědomila si, že chce učit jógu.', 'embedding', pg_temp.vec(2)),
    jsonb_build_object('content', 'třetí', 'embedding', pg_temp.vec(3)),
    jsonb_build_object('content', 'čtvrtý je navíc', 'embedding', pg_temp.vec(4))))),
  'saved', 'moments are saved');
select is((select count(*)::int from public.memory_embeddings where user_id = '00000000-0000-0000-0000-0000000000d1'),
  3, 'at most three per conversation');
select is((select content from public.memory_search('00000000-0000-0000-0000-0000000000d1',
            (pg_temp.vec(2))::text::extensions.vector, 1)),
  'Uvědomila si, že chce učit jógu.', 'the owner finds her moment');
select is((select count(*)::int from public.memory_search('00000000-0000-0000-0000-0000000000d2',
            (pg_temp.vec(2))::text::extensions.vector, 3, 0)),
  0, 'another user on the same topic never sees it (G3.7)');

-- Retry and give up --------------------------------------------------------------------
select pg_temp.fail(pg_temp.job('summary', '00000000-0000-0000-0000-0000000000d2'), 'rate limited!', true);
select ok((select done_at is null and locked_at is null and run_after > now() and last_error = 'ratelimited'
           from ops.jobs_queue where id = pg_temp.job('summary', '00000000-0000-0000-0000-0000000000d2')),
  'a failed job is released and scheduled later, with a code only');
select pg_temp.fail(pg_temp.job('summary', '00000000-0000-0000-0000-0000000000d2'), 'bad_request', false);
select ok((select done_at is not null from ops.jobs_queue
           where id = pg_temp.job('summary', '00000000-0000-0000-0000-0000000000d2')),
  'a job that cannot succeed is closed');

-- A worker that died: the lease expires and the job is claimable again.
update ops.jobs_queue set locked_at = now() - interval '6 minutes'
where id = pg_temp.job('notes', '00000000-0000-0000-0000-0000000000d2');
select is(jsonb_array_length(public.claim_jobs(50)), 1, 'an expired lease is claimed again');
update ops.jobs_queue set locked_at = now() - interval '6 minutes', attempts = 5
where id = pg_temp.job('notes', '00000000-0000-0000-0000-0000000000d2');
select is(jsonb_array_length(public.claim_jobs(50)), 0, 'but not past the attempt limit');
select is((select last_error from ops.jobs_queue where id = pg_temp.job('notes', '00000000-0000-0000-0000-0000000000d2')),
  'gave_up', 'it is closed as given up');

-- Forget one note: old messages must not teach it again ----------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select is(jsonb_array_length(public.get_memory() -> 'notes'), 2, 'screen 34 lists her notes');
select is(jsonb_array_length(public.get_memory() -> 'conversations'), 1, 'and her conversation summary');
select public.forget_note((select (n ->> 'id')::uuid from jsonb_array_elements(public.get_memory() -> 'notes') n
                           where n ->> 'key' = 'goal.main'));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select is(jsonb_array_length(public.get_memory() -> 'notes'), 0, 'another user sees none of it');
reset role;

update public.conversations set notes_through_at = null where id = '40000000-0000-0000-0000-000000000001';
insert into ops.jobs_queue (kind, user_id, payload)
values ('notes', '00000000-0000-0000-0000-0000000000d1', '{"conversation_id":"40000000-0000-0000-0000-000000000001"}');
set local role service_role;
select public.claim_jobs(50);
select is(pg_temp.ctx(pg_temp.job('notes', '00000000-0000-0000-0000-0000000000d1')) ->> 'skip', 'current',
  'after a forget, the notes job is not given messages from before it');

-- Clear everything while a job is running: the job must not write ------------------------
reset role;
select pg_temp.exchange('00000000-0000-0000-0000-0000000000d1', '40000000-0000-0000-0000-000000000001',
  'Ještě jedna věc.', 'Poslouchám.', now() - interval '1 hour');
set local role service_role;
select public.enqueue_idle_memory();
select public.claim_jobs(50);
insert into t values ('race', to_jsonb(pg_temp.job('summary', '00000000-0000-0000-0000-0000000000d1')));
insert into t values ('rctx', pg_temp.ctx((pg_temp.v('race'))::text::bigint));
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select public.clear_memory();
reset role;
set local role service_role;
select is(pg_temp.save((pg_temp.v('race'))::text::bigint,
  jsonb_build_object('summary', 'pozdě', 'throughMessageId', pg_temp.v('rctx') ->> 'throughMessageId')),
  'stale', 'a job that finishes after "forget everything" is refused');
select is((select count(*)::int from public.conversation_summaries where user_id = '00000000-0000-0000-0000-0000000000d1')
        + (select count(*)::int from public.memory_notes where user_id = '00000000-0000-0000-0000-0000000000d1')
        + (select count(*)::int from public.memory_embeddings where user_id = '00000000-0000-0000-0000-0000000000d1'),
  0, 'notes, summaries and moments are all gone (G3.8)');
select is((select count(*)::int from ops.jobs_queue where user_id = '00000000-0000-0000-0000-0000000000d1' and done_at is null),
  0, 'and nothing is left queued for her');
select is(public.enqueue_idle_memory(), 0, 'cleared conversations are never swept');

-- Consent withdrawn: jobs stop --------------------------------------------------------------
reset role;
insert into ops.jobs_queue (kind, user_id, payload)
values ('summary', '00000000-0000-0000-0000-0000000000d2', '{"conversation_id":"40000000-0000-0000-0000-000000000002"}');
update public.consents set withdrawn_at = now()
where user_id = '00000000-0000-0000-0000-0000000000d2' and kind = 'ai_processing';
set local role service_role;
select is((select last_error from ops.jobs_queue where id = pg_temp.job('summary', '00000000-0000-0000-0000-0000000000d2')),
  'consent', 'withdrawing AI consent closes that user''s memory jobs at once');
select is(jsonb_array_length(public.claim_jobs(50)), 0, 'and none is handed to a worker');

-- A lease that has been taken over: the old worker can neither save nor fail the job --------
reset role;
update public.consents set withdrawn_at = null
where user_id = '00000000-0000-0000-0000-0000000000d2' and kind = 'ai_processing';
insert into ops.jobs_queue (kind, user_id, payload)
values ('summary', '00000000-0000-0000-0000-0000000000d2', '{"conversation_id":"40000000-0000-0000-0000-000000000002"}');
set local role service_role;
select public.claim_jobs(50);
insert into t values ('old', to_jsonb(pg_temp.lease(pg_temp.job('summary', '00000000-0000-0000-0000-0000000000d2'))));
update ops.jobs_queue set lease = gen_random_uuid()
where id = pg_temp.job('summary', '00000000-0000-0000-0000-0000000000d2');
select is(public.save_job_result(pg_temp.job('summary', '00000000-0000-0000-0000-0000000000d2'),
  (pg_temp.v('old') #>> '{}')::uuid, '{"summary":"od starého workera, který už job nedrží"}'),
  'stale', 'a worker whose lease was taken over cannot save');
select public.fail_job(pg_temp.job('summary', '00000000-0000-0000-0000-0000000000d2'),
  (pg_temp.v('old') #>> '{}')::uuid, 'late', true);
select ok((select locked_at is not null and last_error is null from ops.jobs_queue
           where id = pg_temp.job('summary', '00000000-0000-0000-0000-0000000000d2')),
  'nor release it under the worker that holds it now');

-- The provider is down: the try is handed back, the job waits ---------------------------------
select pg_temp.fail(pg_temp.job('summary', '00000000-0000-0000-0000-0000000000d2'), 'credit_exhausted:insufficient_quota', true, false);
select ok((select attempts = 0 and done_at is null and run_after > now()
           from ops.jobs_queue where id = pg_temp.job('summary', '00000000-0000-0000-0000-0000000000d2')),
  'an outage does not use up a try');

-- A deleted conversation's moments stop being found at once ------------------------------------
reset role;
insert into public.memory_embeddings (user_id, source, source_id, content_enc, embedding, occurred_at)
values ('00000000-0000-0000-0000-0000000000d2', 'conversation_insight', '40000000-0000-0000-0000-000000000002',
        private.encrypt('00000000-0000-0000-0000-0000000000d2', 'moment'), (pg_temp.vec(5))::text::extensions.vector, now());
set local role service_role;
select is((select count(*)::int from public.memory_search('00000000-0000-0000-0000-0000000000d2',
            (pg_temp.vec(5))::text::extensions.vector, 3)), 1, 'a moment is found');
reset role;
update public.conversations set cleared_at = now() where id = '40000000-0000-0000-0000-000000000002';
set local role service_role;
select is((select count(*)::int from public.memory_search('00000000-0000-0000-0000-0000000000d2',
            (pg_temp.vec(5))::text::extensions.vector, 3)), 0, 'and not after its conversation is deleted');

select * from finish();
rollback;
