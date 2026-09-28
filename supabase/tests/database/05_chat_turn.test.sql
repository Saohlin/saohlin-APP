begin;
select plan(40);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'c1@test.local',
   '{"profile":{"displayName":"Eva","vocative":"Evo","dateOfBirth":"1992-03-03","gender":"female"},"consent":{"accepted":true}}'),
  ('00000000-0000-0000-0000-0000000000c2', 'c2@test.local',
   '{"profile":{"displayName":"Jana","vocative":"Jano","dateOfBirth":"1985-01-01"},"consent":{"accepted":true}}');

-- Keep the rate limit out of the way except where it is tested.
update public.app_config set value = '100' where key = 'limits.rate_per_minute';

create temp table t (k text primary key, v jsonb) on commit drop;
grant all on t to authenticated, service_role;
create function pg_temp.v(p_k text) returns jsonb language sql as $$ select v from t where k = p_k $$;
grant execute on function pg_temp.v(text) to authenticated, service_role;

set local role service_role;

-- Input validation ------------------------------------------------------------------
select throws_ok($$select public.start_turn('00000000-0000-0000-0000-0000000000c1', gen_random_uuid(), '   ')$$,
  '22023', null, 'an empty message is rejected');
select throws_ok(format('select public.start_turn(%L, gen_random_uuid(), %L)',
  '00000000-0000-0000-0000-0000000000c1', repeat('a', 4001)),
  '22023', null, 'a message over 4,000 characters is rejected');
select throws_ok($$select public.start_turn('00000000-0000-0000-0000-0000000000c1', gen_random_uuid(), 'ahoj',
  '99999999-9999-9999-9999-999999999999')$$,
  'P0002', null, 'a conversation that is not yours is not found');

-- A first turn ------------------------------------------------------------------------
insert into t values ('t1', public.start_turn('00000000-0000-0000-0000-0000000000c1',
  '30000000-0000-0000-0000-000000000001', 'Nevím, co se sebou.'));
select is(pg_temp.v('t1') ->> 'kind', 'turn', 'a new message starts a turn');
select is((pg_temp.v('t1') ->> 'retry')::boolean, false, 'it is not a retry');
select is((pg_temp.v('t1') ->> 'trialRemaining')::int, 4, 'the trial is counted before any AI call');
select is(pg_temp.v('t1') -> 'context' ->> 'message', 'Nevím, co se sebou.', 'the context carries the message');
select is(pg_temp.v('t1') -> 'context' -> 'profile' ->> 'vocative', 'Evo', 'the context carries the stored vocative');
select is(pg_temp.v('t1') -> 'context' -> 'conversation' ->> 'origin', 'chat', 'a new conversation was created');

-- Same client id again before the reply: a retry, not counted.
insert into t values ('t1b', public.start_turn('00000000-0000-0000-0000-0000000000c1',
  '30000000-0000-0000-0000-000000000001', 'Nevím, co se sebou.'));
select is((pg_temp.v('t1b') ->> 'retry')::boolean, true, 'the same client id is a retry');
select is((select trial_used from public.usage_state where user_id = '00000000-0000-0000-0000-0000000000c1'), 1,
  'a retry does not count again');
select is(pg_temp.v('t1b') ->> 'userMessageId', pg_temp.v('t1') ->> 'userMessageId', 'the retry is the same message');

-- Finish, then send the same id again: replay.
insert into t values ('f1', public.finish_turn('00000000-0000-0000-0000-0000000000c1',
  (pg_temp.v('t1') ->> 'userMessageId')::uuid, 'Evo, co se teď děje?', 'PROZKOUMANI',
  '{"model":"gpt-5.6-terra","plannerHow":"deterministic","timings":{"first_delta":900},"hardFailures":["zkus"]}',
  '[{"collection":"knowledge","itemId":"kb_1","score":0.8,"slot":0},{"collection":"video","itemId":"v_7","score":0.7,"slot":0}]'));
select is((select count(*)::int from public.message_retrievals
           where message_id = (pg_temp.v('f1') ->> 'assistantMessageId')::uuid), 2, 'retrievals are stored');
select is((select hard_failures from public.message_meta
           where message_id = (pg_temp.v('f1') ->> 'assistantMessageId')::uuid), array['zkus'], 'meta keeps rule ids');
select is((public.finish_turn('00000000-0000-0000-0000-0000000000c1',
  (pg_temp.v('t1') ->> 'userMessageId')::uuid, 'Jiná odpověď', 'VEDENI') ->> 'duplicate')::boolean, true,
  'a second finish does not store a second reply');

insert into t values ('t1c', public.start_turn('00000000-0000-0000-0000-0000000000c1',
  '30000000-0000-0000-0000-000000000001', 'Nevím, co se sebou.'));
select is(pg_temp.v('t1c') ->> 'kind', 'replay', 'an answered message is replayed');
select is(pg_temp.v('t1c') ->> 'reply', 'Evo, co se teď děje?', 'the replay carries the stored reply');
select is((select trial_used from public.usage_state where user_id = '00000000-0000-0000-0000-0000000000c1'), 1,
  'a replay does not count');

-- Second turn in the same conversation: history and previous user turn.
insert into t values ('t2', public.start_turn('00000000-0000-0000-0000-0000000000c1',
  '30000000-0000-0000-0000-000000000002', 'A proč?', (pg_temp.v('t1') ->> 'conversationId')::uuid));
select is(pg_temp.v('t2') -> 'context' ->> 'previousUserText', 'Nevím, co se sebou.',
  'the previous user turn is available for the retrieval query');
select is(jsonb_array_length(pg_temp.v('t2') -> 'context' -> 'history'), 2, 'history holds the earlier exchange');
select is(pg_temp.v('t2') -> 'context' -> 'priorModes', '["PROZKOUMANI"]'::jsonb, 'prior modes feed the understanding gate');

-- Our failure, then a retry: regenerated, not counted.
select public.fail_turn('00000000-0000-0000-0000-0000000000c1', (pg_temp.v('t2') ->> 'userMessageId')::uuid);
select is((public.start_turn('00000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-000000000002', 'A proč?')
           ->> 'retry')::boolean, true, 'a failed message is retried');
select is((select trial_used from public.usage_state where user_id = '00000000-0000-0000-0000-0000000000c1'), 2,
  'retrying our own failure is free');
select public.finish_turn('00000000-0000-0000-0000-0000000000c1', (pg_temp.v('t2') ->> 'userMessageId')::uuid,
  'Protože to v tobě něco otevírá.', 'VEDENI');
select is((select count(*)::int from ops.jobs_queue where user_id = '00000000-0000-0000-0000-0000000000c1' and kind = 'title'),
  1, 'a title job is queued after the second exchange');

-- Trial runs out: the message is held behind the paywall ------------------------------
select public.start_turn('00000000-0000-0000-0000-0000000000c1', gen_random_uuid(), 'zpráva ' || i)
from generate_series(3, 5) i;
insert into t values ('p', public.start_turn('00000000-0000-0000-0000-0000000000c1',
  '30000000-0000-0000-0000-000000000006', 'Šestá zpráva'));
select is(pg_temp.v('p') ->> 'code', 'PAYWALL', 'the sixth message hits the paywall');
select is((select status::text from public.messages where id = (pg_temp.v('p') ->> 'userMessageId')::uuid),
  'awaiting_entitlement', 'the message is held');
select is((public.start_turn('00000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-000000000006',
  'Šestá zpráva') ->> 'code'), 'PAYWALL', 'resending without paying stays behind the paywall');

-- Purchase lands (the webhook's job), then resume answers the held message.
reset role;
insert into public.entitlements (user_id, active, plan, period_ends_at)
values ('00000000-0000-0000-0000-0000000000c1', true, 'founding', now() + interval '30 days');
set local role service_role;
insert into t values ('r', public.start_turn('00000000-0000-0000-0000-0000000000c1', gen_random_uuid(), null,
  null, 'text', (pg_temp.v('p') ->> 'userMessageId')::uuid));
select is(pg_temp.v('r') ->> 'kind', 'turn', 'after purchase the held message is answered');
select is(pg_temp.v('r') ->> 'userMessageId', pg_temp.v('p') ->> 'userMessageId', 'in place');
select is((select kind::text from public.usage_ledger where message_id = (pg_temp.v('p') ->> 'userMessageId')::uuid),
  'reply', 'it is counted as a member reply');

-- Daily cap for members: not stored, her message ---------------------------------------
reset role;
update public.app_config set value = '1' where key = 'limits.daily_soft_cap';
set local role service_role;
insert into t values ('d', public.start_turn('00000000-0000-0000-0000-0000000000c1',
  '30000000-0000-0000-0000-000000000007', 'Ještě jedna'));
select is(pg_temp.v('d') ->> 'code', 'DAILY_CAP', 'members meet the daily cap');
select is((select count(*)::int from public.messages where client_msg_id = '30000000-0000-0000-0000-000000000007'), 0,
  'a capped message is not stored');

-- Rate limit ---------------------------------------------------------------------------
reset role;
update public.app_config set value = '1' where key = 'limits.rate_per_minute';
set local role service_role;
select public.start_turn('00000000-0000-0000-0000-0000000000c2', gen_random_uuid(), 'první');
select is((public.start_turn('00000000-0000-0000-0000-0000000000c2', gen_random_uuid(), 'druhá') ->> 'code'),
  'RATE_LIMITED', 'too many messages a minute are rate limited');

-- Consent withdrawn: AI paused, nothing stored -----------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
select public.withdraw_consent(array['ai_processing']::public.consent_kind[]);
reset role;
set local role service_role;
select is((public.start_turn('00000000-0000-0000-0000-0000000000c2', '40000000-0000-0000-0000-000000000001', 'ahoj')
           ->> 'code'), 'AI_PAUSED', 'withdrawn consent pauses the AI');
select is((select count(*)::int from public.messages where client_msg_id = '40000000-0000-0000-0000-000000000001'), 0,
  'nothing is stored while paused');
reset role;

-- The app side: history, clear, restore, forget ----------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
insert into t values ('n_before', to_jsonb(jsonb_array_length(public.list_conversations())));
select public.clear_conversation((pg_temp.v('t1') ->> 'conversationId')::uuid);
select is(jsonb_array_length(public.list_conversations()), (pg_temp.v('n_before'))::int - 1,
  'a cleared conversation leaves the history at once');
select public.restore_conversation((pg_temp.v('t1') ->> 'conversationId')::uuid);
select is(jsonb_array_length(public.list_conversations()), (pg_temp.v('n_before'))::int,
  'it can be restored within 24 hours');
select is((public.get_conversation((pg_temp.v('t1') ->> 'conversationId')::uuid) -> 'messages' -> 1 ->> 'content'),
  'Evo, co se teď děje?', 'messages come back decrypted and in order');
select public.clear_memory();
select is(jsonb_array_length(public.list_conversations()), 0, 'forgetting everything hides past conversations');
select public.delete_my_account();
reset role;
select is(
  (select count(*)::int from public.conversations where user_id = '00000000-0000-0000-0000-0000000000c1')
  + (select count(*)::int from public.messages where user_id = '00000000-0000-0000-0000-0000000000c1')
  + (select count(*)::int from public.message_meta where user_id = '00000000-0000-0000-0000-0000000000c1')
  + (select count(*)::int from public.usage_state where user_id = '00000000-0000-0000-0000-0000000000c1')
  + (select count(*)::int from public.entitlements where user_id = '00000000-0000-0000-0000-0000000000c1')
  + (select count(*)::int from ops.jobs_queue where user_id = '00000000-0000-0000-0000-0000000000c1'),
  0, 'deleting the account removes every chat row');

select * from finish();
rollback;
