begin;
select plan(43);

-- Three accounts: a tester (t1), a real user who is never a tester (r1), an admin.
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'tester@test.local',
   '{"profile":{"displayName":"Klára","vocative":"Kláro","dateOfBirth":"1988-04-04"},"consent":{"accepted":true}}', '{}'),
  ('00000000-0000-0000-0000-0000000000c2', 'real@test.local',
   '{"profile":{"displayName":"Petra","vocative":"Petro","dateOfBirth":"1990-02-02"},"consent":{"accepted":true}}', '{}'),
  ('00000000-0000-0000-0000-0000000000ad', 'admin@test.local',
   '{"profile":{"displayName":"Asma","vocative":"Asmo","dateOfBirth":"1995-01-01"},"consent":{"accepted":true}}',
   '{"saohlin_admin": true}');

select ops.set_tester('TESTER@test.local', true);

create temp table t (k text primary key, v jsonb) on commit drop;
grant all on t to authenticated, service_role;
create function pg_temp.v(p_k text) returns jsonb language sql as $$ select v from t where k = p_k $$;
grant execute on function pg_temp.v(text) to authenticated, service_role;
create function pg_temp.as_user(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p_user), true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;

-- Knowledge the answers retrieved.
insert into kb.documents (id, collection, source_file, title) values
  ('00000000-0000-0000-0000-00000000d101', 'knowledge', 'samota.docx', 'Samota');
insert into kb.chunks (id, document_id, collection, topic, text) values
  ('k-samota', '00000000-0000-0000-0000-00000000d101', 'knowledge', 'Samota', 'Samota není prázdnota.');
insert into kb.exemplars (id, bank, situation, claudia_response, word_count) values
  ('ex-1', 'phase01', 'Cítím se sama.', 'Co pro tebe samota znamená?', 5);
insert into public.memory_embeddings (id, user_id, source, source_id, content_enc, embedding, occurred_at)
values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1',
        'conversation_insight', gen_random_uuid(),
        private.encrypt('00000000-0000-0000-0000-0000000000c1', 'Bojí se samoty o víkendech.'),
        (select array_agg(case when i = 1 then 1.0 else 0 end)::extensions.vector(1024) from generate_series(1, 1024) i),
        now() - interval '2 weeks');

-- The tester's conversation: two exchanges. The real user's: one.
set local role service_role;
insert into t values ('q1', public.start_turn('00000000-0000-0000-0000-0000000000c1',
  '30000000-0000-0000-0000-000000000001', 'Ahoj, jak začít?'));
insert into t values ('a1', public.finish_turn('00000000-0000-0000-0000-0000000000c1',
  (pg_temp.v('q1') ->> 'userMessageId')::uuid, 'Kláro, co tě sem dnes přivedlo?', 'PROZKOUMANI', '{"model":"test"}'));
insert into t values ('q2', public.start_turn('00000000-0000-0000-0000-0000000000c1',
  '30000000-0000-0000-0000-000000000002',
  repeat('Cítím se o víkendech hrozně sama a nevím, co s tím. ', 5),
  (pg_temp.v('q1') ->> 'conversationId')::uuid));
insert into t values ('a2', public.finish_turn('00000000-0000-0000-0000-0000000000c1',
  (pg_temp.v('q2') ->> 'userMessageId')::uuid, 'Kláro, samota není prázdnota.', 'VEDENI',
  '{"model":"gpt-test","plannerHow":"planner","timings":{"first":900},"hardFailures":["zkus"],"retried":true}',
  '[{"collection":"knowledge","itemId":"k-samota","score":0.81,"slot":0},
    {"collection":"exemplar","itemId":"ex-1","score":0.77,"slot":0},
    {"collection":"memory","itemId":"00000000-0000-0000-0000-0000000000e1","score":0.6,"slot":0}]'));
insert into t values ('qr', public.start_turn('00000000-0000-0000-0000-0000000000c2',
  '30000000-0000-0000-0000-000000000003', 'Soukromá věc skutečné uživatelky.'));
insert into t values ('ar', public.finish_turn('00000000-0000-0000-0000-0000000000c2',
  (pg_temp.v('qr') ->> 'userMessageId')::uuid, 'Petro, děkuji, že to sdílíš.', 'PROZKOUMANI', '{"model":"test"}'));
reset role;

-- Access --------------------------------------------------------------------------

select ok(
  not has_table_privilege('authenticated', 'private.testers', 'select')
  and not has_table_privilege('service_role', 'private.testers', 'select')
  and not has_table_privilege('authenticated', 'ops.mark_reviews', 'select')
  and not has_table_privilege('service_role', 'ops.mark_reviews', 'select')
  and not has_table_privilege('service_role', 'ops.mark_reviews', 'insert')
  and not has_table_privilege('authenticated', 'ops.admin_log', 'select')
  and not has_table_privilege('service_role', 'ops.admin_log', 'select')
  and not has_table_privilege('service_role', 'ops.admin_log', 'delete'),
  'no API role, the service role included, touches testers, reviews or the admin log directly');

select ok(
  (select bool_and(not has_function_privilege('authenticated', p.oid, 'execute')
                   and not has_function_privilege('anon', p.oid, 'execute')
                   and has_function_privilege('service_role', p.oid, 'execute'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'admin\_%'),
  'admin functions are executable by the service role only');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'admin\_%' and p.proname not like 'admin\_cards\_%'),
  4, 'four admin testing functions exist (the card functions are counted in 12_admin_cards)');

select ok(
  not has_function_privilege('service_role', 'ops.set_tester(text, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'ops.set_tester(text, boolean)', 'execute'),
  'testers are set from the SQL editor only');

-- Marks: testers only, own answers only -----------------------------------------------

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select lives_ok(
  format($$insert into public.answer_marks (message_id, user_id, mark) values (%L, %L, 'right')$$,
         pg_temp.v('a1') ->> 'assistantMessageId', '00000000-0000-0000-0000-0000000000c1'),
  'a tester can mark their own answer');
select lives_ok(
  format($$insert into public.answer_marks (message_id, user_id, mark, note) values (%L, %L, 'too_generic', 'Moc obecné')$$,
         pg_temp.v('a2') ->> 'assistantMessageId', '00000000-0000-0000-0000-0000000000c1'),
  'and give several marks');
select lives_ok(
  format($$insert into public.answer_marks (message_id, user_id, mark) values (%L, %L, 'should_have_asked')$$,
         pg_temp.v('a2') ->> 'assistantMessageId', '00000000-0000-0000-0000-0000000000c1'),
  'to the same answer');
select throws_ok(
  format($$insert into public.answer_marks (message_id, user_id, mark) values (%L, %L, 'right')$$,
         pg_temp.v('ar') ->> 'assistantMessageId', '00000000-0000-0000-0000-0000000000c1'),
  '42501', null, 'a tester cannot mark someone else''s answer');
select is((public.get_me() ->> 'tester')::boolean, true, 'get_me says tester for a tester');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
select throws_ok(
  format($$insert into public.answer_marks (message_id, user_id, mark) values (%L, %L, 'right')$$,
         pg_temp.v('ar') ->> 'assistantMessageId', '00000000-0000-0000-0000-0000000000c2'),
  '42501', 'NOT_TESTER', 'a user who is not a tester cannot mark even their own answer');
select is((public.get_me() ->> 'tester')::boolean, false, 'get_me says not a tester otherwise');
reset role;

-- A mark made while the real user was briefly a tester, then the flag removed.
select ops.set_tester('real@test.local', true);
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c2');
insert into public.answer_marks (message_id, user_id, mark)
values ((pg_temp.v('ar') ->> 'assistantMessageId')::uuid, '00000000-0000-0000-0000-0000000000c2', 'wrong_guide');
reset role;
select is(ops.set_tester('real@test.local', false), 'tester off', 'a tester flag can be removed');
-- Marks made in one transaction share a timestamp; space them out so "newest first" is testable.
update public.answer_marks set created_at = now() - interval '3 minutes' where mark = 'right';
update public.answer_marks set created_at = now() - interval '2 minutes' where mark = 'should_have_asked';
update public.answer_marks set created_at = now() - interval '1 minute' where mark = 'too_generic';
insert into t select 'm_real', jsonb_build_object('id', id) from public.answer_marks
  where user_id = '00000000-0000-0000-0000-0000000000c2';
insert into t select 'm_generic', jsonb_build_object('id', id) from public.answer_marks
  where mark = 'too_generic';
insert into t select 'm_right', jsonb_build_object('id', id) from public.answer_marks
  where mark = 'right' and user_id = '00000000-0000-0000-0000-0000000000c1';

-- Only admins -----------------------------------------------------------------------

set local role service_role;
select throws_ok($$select public.admin_overview('00000000-0000-0000-0000-0000000000c1')$$,
  '42501', 'FORBIDDEN', 'a non-admin cannot read the overview');
select throws_ok($$select public.admin_testing_list('00000000-0000-0000-0000-0000000000c1')$$,
  '42501', 'FORBIDDEN', 'or the list');
select throws_ok(format('select public.admin_testing_get(%L, %L)',
  '00000000-0000-0000-0000-0000000000c1', pg_temp.v('m_generic') ->> 'id'),
  '42501', 'FORBIDDEN', 'or one mark');
select throws_ok(format('select public.admin_testing_review(%L, %L, %L)',
  '00000000-0000-0000-0000-0000000000c1', pg_temp.v('m_generic') ->> 'id', 'fixed'),
  '42501', 'FORBIDDEN', 'or set a review');
select throws_ok($$select public.admin_overview(null)$$, '42501', 'FORBIDDEN', 'a missing admin id is refused');

-- The list ---------------------------------------------------------------------------

insert into t values ('list', public.admin_testing_list('00000000-0000-0000-0000-0000000000ad'));
select is((pg_temp.v('list') ->> 'total')::int, 3, 'the list counts only current testers'' marks');
select ok(
  not exists (select 1 from jsonb_array_elements(pg_temp.v('list') -> 'items') i
              where i ->> 'tester' = 'real@test.local'),
  'a real user''s mark never appears, even one made while they were a tester');
select is(
  pg_temp.v('list') -> 'items' -> 0 ->> 'question',
  left(repeat('Cítím se o víkendech hrozně sama a nevím, co s tím. ', 5), 160),
  'newest first, the question decrypted and cut to 160 characters');
select is(pg_temp.v('list') -> 'items' -> 0 ->> 'answer', 'Kláro, samota není prázdnota.', 'with the answer');
select is(
  (public.admin_testing_list('00000000-0000-0000-0000-0000000000ad', 'too_generic') ->> 'total')::int, 1,
  'filters by mark');
select is(
  jsonb_array_length(public.admin_testing_list('00000000-0000-0000-0000-0000000000ad', null, null, 2, 0) -> 'items'), 2,
  'a page holds exactly the limit, no extra row');
select is(
  jsonb_array_length(public.admin_testing_list('00000000-0000-0000-0000-0000000000ad', null, null, 2, 2) -> 'items'), 1,
  'and the next page holds the rest');
select throws_ok($$select public.admin_testing_list('00000000-0000-0000-0000-0000000000ad', null, 'done')$$,
  '22023', 'INVALID_INPUT', 'an unknown status filter is refused');

-- One mark in full ---------------------------------------------------------------------

insert into t values ('one', public.admin_testing_get('00000000-0000-0000-0000-0000000000ad',
  (pg_temp.v('m_generic') ->> 'id')::uuid));
select is(pg_temp.v('one') -> 'answer' ->> 'text', 'Kláro, samota není prázdnota.', 'the answer, decrypted');
select is(
  (select array_agg(e ->> 'text' order by e ->> 'createdAt') from jsonb_array_elements(pg_temp.v('one') -> 'earlier') e),
  array['Ahoj, jak začít?', 'Kláro, co tě sem dnes přivedlo?'],
  'the earlier messages of the conversation, in order');
select is(
  (select array_agg(r ->> 'collection' || ':' || coalesce(r ->> 'text', '') order by r ->> 'collection')
   from jsonb_array_elements(pg_temp.v('one') -> 'retrieved') r),
  array['exemplar:Situace: Cítím se sama.' || E'\n\n' || 'Odpověď: Co pro tebe samota znamená?',
        'knowledge:Samota není prázdnota.',
        'memory:Bojí se samoty o víkendech.'],
  'what was retrieved, with the passage, the example and the tester''s own memory decrypted');
select is(jsonb_array_length(pg_temp.v('one') -> 'marks'), 2, 'every mark on that answer');
select is(pg_temp.v('one') -> 'review' ->> 'status', 'new', 'and the review, new by default');
select ok(
  pg_temp.v('one') -> 'meta' ->> 'model' = 'gpt-test'
  and (pg_temp.v('one') -> 'meta' ->> 'retried')::boolean
  and pg_temp.v('one') -> 'meta' -> 'hardFailures' = '["zkus"]'::jsonb,
  'and why it said that: model, retry, failed checks');
select throws_ok(format('select public.admin_testing_get(%L, %L)',
  '00000000-0000-0000-0000-0000000000ad', pg_temp.v('m_real') ->> 'id'),
  'P0002', 'NOT_FOUND', 'a real user''s mark cannot be opened, even by an admin calling the function directly');

-- Reviews ----------------------------------------------------------------------------

select is(
  public.admin_testing_review('00000000-0000-0000-0000-0000000000ad', (pg_temp.v('m_generic') ->> 'id')::uuid,
    'in_progress', '  Přidat doptávání  ') ->> 'comment',
  'Přidat doptávání', 'a review saves, trimmed');
select is(
  public.admin_testing_review('00000000-0000-0000-0000-0000000000ad', (pg_temp.v('m_generic') ->> 'id')::uuid,
    'fixed') ->> 'status',
  'fixed', 'and its status changes');
select throws_ok(format('select public.admin_testing_review(%L, %L, %L)',
  '00000000-0000-0000-0000-0000000000ad', pg_temp.v('m_generic') ->> 'id', 'done'),
  '22023', 'INVALID_INPUT', 'an unknown status is refused');
select throws_ok(format('select public.admin_testing_review(%L, %L, %L, %L)',
  '00000000-0000-0000-0000-0000000000ad', pg_temp.v('m_generic') ->> 'id', 'fixed', repeat('x', 2001)),
  '22023', 'INVALID_INPUT', 'a comment over 2,000 characters is refused');
select throws_ok(format('select public.admin_testing_review(%L, %L, %L)',
  '00000000-0000-0000-0000-0000000000ad', pg_temp.v('m_real') ->> 'id', 'fixed'),
  'P0002', 'NOT_FOUND', 'a real user''s mark cannot be reviewed');
select is(
  (public.admin_testing_list('00000000-0000-0000-0000-0000000000ad', null, 'new') ->> 'total')::int, 2,
  'the status filter follows reviews');

select is(
  public.admin_overview('00000000-0000-0000-0000-0000000000ad'),
  '{"testers": 1, "marks": {"right": 1, "too_generic": 1, "should_have_asked": 1},
    "statuses": {"new": 2, "fixed": 1}}'::jsonb,
  'the overview counts testers, marks by type and by status');
reset role;

-- The audit log ---------------------------------------------------------------------------

select is(
  (select array_agg(action || coalesce(':' || (detail ->> 'to'), '') order by id) from ops.admin_log),
  array['testing.list', 'testing.list', 'testing.list', 'testing.list',
        'testing.get', 'testing.review:in_progress', 'testing.review:fixed', 'testing.list'],
  'every successful read and change is logged once, refused calls are not');
select ok(
  (select bool_and(admin_id = '00000000-0000-0000-0000-0000000000ad'
                   and detail::text not like '%Kláro%' and detail::text not like '%sama%'
                   and detail::text not like '%doptávání%')
   from ops.admin_log),
  'log rows name the admin and hold no message or comment text');

-- Removing a tester, deleting a conversation -------------------------------------------------

select ops.set_tester('tester@test.local', false);
set local role service_role;
select is((public.admin_testing_list('00000000-0000-0000-0000-0000000000ad') ->> 'total')::int, 0,
  'removing a tester hides their marks at once');
reset role;
select ops.set_tester('tester@test.local', true);

delete from public.conversations where id = (pg_temp.v('q1') ->> 'conversationId')::uuid;
select ok(
  not exists (select 1 from public.answer_marks where user_id = '00000000-0000-0000-0000-0000000000c1')
  and not exists (select 1 from ops.mark_reviews),
  'deleting the conversation removes its marks and reviews');

select * from finish();
rollback;
