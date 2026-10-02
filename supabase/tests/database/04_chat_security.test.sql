begin;
select plan(25);

-- Two users on near-identical topics (G3.7).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'a1@test.local',
   '{"profile":{"displayName":"Anna","vocative":"Anno","dateOfBirth":"1990-05-05"},"consent":{"accepted":true}}'),
  ('00000000-0000-0000-0000-0000000000b1', 'b1@test.local',
   '{"profile":{"displayName":"Bára","vocative":"Báro","dateOfBirth":"1991-06-06"},"consent":{"accepted":true}}');

-- Service functions are not callable by the app ------------------------------------

select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('begin_turn', 'start_turn', 'finish_turn', 'fail_turn', 'log_ai_calls',
                       'memory_search', 'purge_expired')
     and (has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute'))),
  null,
  'service-only chat functions are not executable by anon or authenticated'
);

select ok(
  (select bool_and(has_function_privilege('service_role', p.oid, 'execute'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('begin_turn', 'start_turn', 'finish_turn', 'fail_turn', 'log_ai_calls',
                       'memory_search', 'purge_expired')),
  'service-only chat functions are executable by service_role'
);

-- What the chat function needs, and nothing more, for the service role.
select ok(
  has_table_privilege('service_role', 'public.app_config', 'select')
  and not has_table_privilege('service_role', 'public.messages', 'select'),
  'the service role reads config directly and everything else through functions'
);

select ok(
  not has_schema_privilege('authenticated', 'ops', 'usage')
  and not has_schema_privilege('anon', 'ops', 'usage'),
  'ops schema is not usable by anon or authenticated'
);

select is(
  (select array_agg(distinct table_name::text order by table_name::text)
   from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
     and table_name in ('conversations', 'messages', 'message_meta', 'message_retrievals',
                        'conversation_summaries', 'memory_notes', 'memory_embeddings',
                        'entitlements', 'usage_state', 'usage_ledger')),
  null,
  'no direct writes to server-owned chat tables'
);

-- Column test: nothing encrypted or server-only is selectable directly.
select ok(
  not has_column_privilege('authenticated', 'public.messages', 'content_enc', 'select')
  and not has_table_privilege('authenticated', 'public.message_meta', 'select')
  and not has_table_privilege('authenticated', 'public.message_retrievals', 'select')
  and not has_table_privilege('authenticated', 'public.memory_embeddings', 'select')
  and not has_table_privilege('authenticated', 'public.usage_ledger', 'select')
  and not has_column_privilege('authenticated', 'public.conversations', 'title_enc', 'select')
  and not has_column_privilege('authenticated', 'public.conversations', 'cleared_at', 'select'),
  'message text, meta, retrievals, moments, ledger and titles are not directly selectable'
);

select ok(
  not has_column_privilege('authenticated', 'public.usage_state', 'trial_used', 'update')
  and not has_column_privilege('authenticated', 'public.entitlements', 'active', 'update'),
  'the client cannot change its trial count or membership'
);

-- User A has a conversation, a reply, a note, a summary and a memory moment ---------

create temp table t (k text primary key, v jsonb) on commit drop;
grant all on t to authenticated, service_role;

set local role service_role;
insert into t values ('a_turn', public.start_turn('00000000-0000-0000-0000-0000000000a1',
  '10000000-0000-0000-0000-000000000001', 'Pořád se vracím k bývalému partnerovi.'));
insert into t values ('a_fin', public.finish_turn('00000000-0000-0000-0000-0000000000a1',
  ((select v from t where k = 'a_turn') ->> 'userMessageId')::uuid,
  'Anno, co tě k němu táhne zpátky?', 'PROZKOUMANI', '{"model":"test"}'));
reset role;

insert into public.memory_notes (user_id, category, key, content_enc)
values ('00000000-0000-0000-0000-0000000000a1', 'relationship', 'partner',
        private.encrypt('00000000-0000-0000-0000-0000000000a1', 'Rozešla se s partnerem Tomášem.'));
insert into t select 'a_note', jsonb_build_object('id', id) from public.memory_notes
  where user_id = '00000000-0000-0000-0000-0000000000a1';
insert into public.conversation_summaries (conversation_id, user_id, summary_enc, through_message_id, source_message_count, model)
values (((select v from t where k = 'a_turn') ->> 'conversationId')::uuid, '00000000-0000-0000-0000-0000000000a1',
        private.encrypt('00000000-0000-0000-0000-0000000000a1', 'Anna řeší návrat k bývalému partnerovi.'),
        ((select v from t where k = 'a_fin') ->> 'assistantMessageId')::uuid, 2, 'test');

-- Near-identical moments for both users; vectors differ only slightly.
insert into public.memory_embeddings (user_id, source, source_id, content_enc, embedding, occurred_at)
select u, 'conversation_insight', gen_random_uuid(), private.encrypt(u, txt),
       (select array_agg(case when i = 1 then 1.0 when i = 2 then d else 0 end)::extensions.vector(1024)
        from generate_series(1, 1024) i),
       now() - interval '8 weeks'
from (values ('00000000-0000-0000-0000-0000000000a1'::uuid, 'A: uvědomila si, že se bojí samoty.', 0.01),
             ('00000000-0000-0000-0000-0000000000b1'::uuid, 'B: uvědomila si, že se bojí samoty.', 0.02)) x(u, txt, d);

-- Stored text is ciphertext.
select ok(
  (select bool_and(position('bývalému' in encode(content_enc, 'escape')) = 0)
   from public.messages where user_id = '00000000-0000-0000-0000-0000000000a1' and content_enc is not null),
  'message text is stored encrypted'
);

-- User B sees none of it --------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);

select is((select count(*)::int from public.conversations), 0, 'B cannot see A''s conversations');
select is(public.list_conversations(), '[]'::jsonb, 'B''s history is empty');
select throws_ok(
  format('select public.get_conversation(%L)', (select v from t where k = 'a_turn') ->> 'conversationId'),
  'P0002', null, 'B cannot open A''s conversation');
select throws_ok(
  format('select public.rename_conversation(%L, %L)', (select v from t where k = 'a_turn') ->> 'conversationId', 'x'),
  'P0002', null, 'B cannot rename A''s conversation');
select throws_ok(
  format('select public.clear_conversation(%L)', (select v from t where k = 'a_turn') ->> 'conversationId'),
  'P0002', null, 'B cannot clear A''s conversation');
select throws_ok(
  format($$insert into public.answer_marks (message_id, user_id, mark) values (%L, %L, 'right')$$,
         (select v from t where k = 'a_fin') ->> 'assistantMessageId', '00000000-0000-0000-0000-0000000000b1'),
  '42501', null, 'B cannot mark A''s answer');
select throws_ok(
  format($$insert into public.answer_marks (message_id, user_id, mark) values (%L, %L, 'right')$$,
         (select v from t where k = 'a_fin') ->> 'assistantMessageId', '00000000-0000-0000-0000-0000000000a1'),
  '42501', null, 'B cannot write a mark in A''s name');
select is(
  public.get_memory(),
  '{"notes": [], "conversations": [], "momentsCount": 1}'::jsonb,
  'B''s memory screen shows none of A''s notes or summaries, and only B''s own moment');
select throws_ok(
  format('select public.forget_note(%L)', (select v ->> 'id' from t where k = 'a_note')),
  'P0002', null, 'B cannot delete A''s note');
select is((select count(*)::int from public.usage_state), 1, 'B reads only its own usage row');
select throws_ok(
  $$select public.start_turn('00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), 'ahoj')$$,
  '42501', null, 'the app cannot call start_turn');

-- User A sees their own ----------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is(
  (public.get_conversation(((select v from t where k = 'a_turn') ->> 'conversationId')::uuid)
     -> 'messages' -> 1 ->> 'content'),
  'Anno, co tě k němu táhne zpátky?',
  'A reads their own reply, decrypted');
select lives_ok(
  format($$insert into public.answer_marks (message_id, user_id, mark, note) values (%L, %L, 'should_have_asked', 'Zeptat se víc')$$,
         (select v from t where k = 'a_fin') ->> 'assistantMessageId', '00000000-0000-0000-0000-0000000000a1'),
  'A can mark their own answer');
select is(jsonb_array_length(public.get_memory() -> 'notes'), 1, 'A sees their own note');
reset role;

-- Contamination: memory search never crosses users -------------------------------

set local role service_role;
select is(
  (select array_agg(content) from public.memory_search('00000000-0000-0000-0000-0000000000b1',
     (select array_agg(case when i = 1 then 1.0 when i = 2 then 0.01 else 0 end)::extensions.vector(1024)
      from generate_series(1, 1024) i), 10, 0)),
  array['B: uvědomila si, že se bojí samoty.'],
  'B''s memory search returns only B''s moment, even with A''s exact vector');
select is(
  (select count(*)::int from jsonb_array_elements(
     (public.start_turn('00000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000001',
        'Pořád se vracím k bývalému partnerovi.') -> 'context' -> 'notes'))),
  0,
  'B''s turn context carries none of A''s notes');
select ok(
  (public.start_turn('00000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000002',
     'A co dál?') -> 'context' ->> 'summary') is null
  and (public.start_turn('00000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-000000000003',
     'A co dál?') -> 'context' -> 'recentConversations') = '[]'::jsonb,
  'B''s turn context carries none of A''s summaries');
reset role;

select * from finish();
rollback;
