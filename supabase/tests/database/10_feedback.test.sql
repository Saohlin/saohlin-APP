begin;
select plan(36);

-- Two users. f1 writes; f2 is the stranger.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 'f1@test.local',
   '{"profile":{"displayName":"Eva","vocative":"Evo","dateOfBirth":"1992-03-03","gender":"female"},"consent":{"accepted":true}}'),
  ('00000000-0000-0000-0000-0000000000f2', 'f2@test.local',
   '{"profile":{"displayName":"Jana","vocative":"Jano","dateOfBirth":"1985-01-01"},"consent":{"accepted":true}}');

create temp table t (k text primary key, v jsonb) on commit drop;
grant all on t to authenticated, service_role;
create function pg_temp.v(p_k text) returns jsonb language sql as $$ select v from t where k = p_k $$;
grant execute on function pg_temp.v(text) to authenticated, service_role;

create function pg_temp.dec(p_user uuid, p_value bytea) returns text language sql security definer as $$
  select private.decrypt(p_user, p_value)
$$;
create function pg_temp.as_user(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p_user), true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;

-- Access ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('anon', 'public.feedback', 'select')
  and not has_table_privilege('authenticated', 'public.feedback', 'select')
  and not has_table_privilege('authenticated', 'public.feedback', 'insert')
  and not has_table_privilege('authenticated', 'public.feedback', 'update')
  and not has_table_privilege('authenticated', 'public.feedback', 'delete')
  and not has_table_privilege('service_role', 'public.feedback', 'select')
  and not has_table_privilege('service_role', 'public.feedback', 'update'),
  'no API role, the service role included, can touch feedback directly');

select ok(
  not has_function_privilege('anon', 'public.send_feedback(uuid, text, text, text, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.send_feedback(uuid, text, text, text, text, text)', 'execute'),
  'only a signed-in user can send');

select ok(
  not has_function_privilege('authenticated', 'public.claim_feedback(int)', 'execute')
  and not has_function_privilege('authenticated', 'public.feedback_notified(uuid, uuid, boolean, text)', 'execute')
  and has_function_privilege('service_role', 'public.claim_feedback(int)', 'execute')
  and has_function_privilege('service_role', 'public.feedback_notified(uuid, uuid, boolean, text)', 'execute'),
  'only the service role can read messages for delivery');

set local role authenticated;
select throws_ok(
  $$select public.send_feedback('10000000-0000-0000-0000-000000000001', 'Ahoj')$$,
  '42501', 'NOT_AUTHENTICATED', 'a request without a user is refused');

-- Sending --------------------------------------------------------------------------

select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
insert into t values ('first', public.send_feedback(
  '10000000-0000-0000-0000-000000000001', E'  \n Moc se mi líbí výklady karet.\n\n ',
  '1.0.0', 'ios', '26.1', 'cs-CZ'));
select is(pg_temp.v('first') ->> 'kind', 'ok', 'a message is accepted');
select ok((pg_temp.v('first') ->> 'id') is not null, 'the answer carries the id');

insert into t values ('again', public.send_feedback(
  '10000000-0000-0000-0000-000000000001', 'Moc se mi líbí výklady karet.'));
select is(pg_temp.v('again') ->> 'id', pg_temp.v('first') ->> 'id', 'a retried send is the same message');

select throws_ok($$select public.send_feedback('10000000-0000-0000-0000-000000000002', E' \n\t ')$$,
  '22023', 'INVALID_INPUT', 'an empty message is refused');
select throws_ok($$select public.send_feedback(null, 'Ahoj')$$,
  '22023', 'INVALID_INPUT', 'a send without its id is refused');
select throws_ok($$select public.send_feedback('10000000-0000-0000-0000-000000000002', repeat('a', 5001))$$,
  '22023', 'INVALID_INPUT', 'a message over 5,000 characters is refused');
select lives_ok($$select public.send_feedback('10000000-0000-0000-0000-000000000003', repeat('ž', 5000), '1.0.0', 'windows')$$,
  'exactly 5,000 characters is accepted');
reset role;

select is((select count(*)::int from public.feedback where user_id = '00000000-0000-0000-0000-0000000000f1'), 2,
  'two messages are stored, the retry stored nothing');
select is(
  (select pg_temp.dec(user_id, body_enc) from public.feedback where id = (pg_temp.v('first') ->> 'id')::uuid),
  'Moc se mi líbí výklady karet.', 'the text is stored trimmed, under the user''s key');
select ok(
  (select position(convert_to('karet', 'utf8') in body_enc) = 0 from public.feedback
   where id = (pg_temp.v('first') ->> 'id')::uuid),
  'the stored bytes are not the plain text');
select is(
  (select row(body_chars, app_version, platform, os_version, locale, category, status)::text
   from public.feedback where id = (pg_temp.v('first') ->> 'id')::uuid),
  '(29,1.0.0,ios,26.1,cs-CZ,general,new)', 'length and device details are kept');
select is(
  (select platform from public.feedback where client_id = '10000000-0000-0000-0000-000000000003'),
  null, 'an unknown platform is dropped, not stored');

-- The same client id from another user is another message.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
insert into t values ('other', public.send_feedback('10000000-0000-0000-0000-000000000001', 'Zpráva od Jany.'));
select isnt(pg_temp.v('other') ->> 'id', pg_temp.v('first') ->> 'id', 'ids made on two phones do not collide');
reset role;

-- The daily limit --------------------------------------------------------------------

update public.app_config set value = '3' where key = 'feedback.per_day';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
insert into t values ('third', public.send_feedback('10000000-0000-0000-0000-000000000004', 'Třetí.'));
insert into t values ('fourth', public.send_feedback('10000000-0000-0000-0000-000000000005', 'Čtvrtá.'));
select is(pg_temp.v('third') ->> 'kind', 'ok', 'the third message of the day is accepted');
select is(pg_temp.v('fourth') ->> 'kind' || ' ' || (pg_temp.v('fourth') ->> 'code'), 'limit RATE_LIMITED',
  'the fourth is a limit, returned as data');
select ok((pg_temp.v('fourth') ->> 'retryAfterSeconds')::int between 1 and 86400, 'with the time to wait');
select is(
  public.send_feedback('10000000-0000-0000-0000-000000000004', 'Třetí.') ->> 'kind', 'ok',
  'a retry of a message that arrived still answers ok at the limit');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select is(public.send_feedback('10000000-0000-0000-0000-000000000006', 'Druhá od Jany.') ->> 'kind', 'ok',
  'one user''s limit does not hold another');
reset role;
update public.feedback set created_at = now() - interval '25 hours'
where client_id = '10000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-0000000000f1';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select is(public.send_feedback('10000000-0000-0000-0000-000000000005', 'Čtvrtá.') ->> 'kind', 'ok',
  'a day later there is room again');
reset role;

-- Delivery ---------------------------------------------------------------------------

-- Emailing is off by default: nothing is handed out and no try is used up.
set local role service_role;
select is(jsonb_array_length(public.claim_feedback(50)), 0, 'with emailing off, no message is handed out');
reset role;
select is((select coalesce(max(notify_attempts), 0) from public.feedback), 0, 'and no message used up a try');
update public.app_config set value = '1' where key = 'feedback.notify_enabled';

select is(ops.kick_notify(), 0, 'without pg_net nothing is called and nothing fails');

set local role service_role;
insert into t values ('claim', public.claim_feedback(2));
select is(jsonb_array_length(pg_temp.v('claim')), 2, 'a claim takes at most what it asked for');
select is(
  (pg_temp.v('claim') -> 0 ->> 'body') || '|' || (pg_temp.v('claim') -> 0 ->> 'email') || '|' || (pg_temp.v('claim') -> 0 ->> 'name'),
  'Moc se mi líbí výklady karet.|f1@test.local|Eva', 'oldest first, with the text, the sender''s email and name');
insert into t values ('rest', public.claim_feedback(50));
select is(jsonb_array_length(pg_temp.v('rest')), 4, 'leased messages are not handed out twice');

select ok(public.feedback_notified(
  (pg_temp.v('claim') -> 0 ->> 'id')::uuid, (pg_temp.v('claim') -> 0 ->> 'lease')::uuid, true),
  'a delivered message is marked');
select ok(not public.feedback_notified(
  (pg_temp.v('claim') -> 0 ->> 'id')::uuid, (pg_temp.v('claim') -> 0 ->> 'lease')::uuid, false, 'late'),
  'a second answer to the same lease changes nothing');
select ok(public.feedback_notified(
  (pg_temp.v('claim') -> 1 ->> 'id')::uuid, (pg_temp.v('claim') -> 1 ->> 'lease')::uuid, false, 'resend_503'),
  'a failed delivery is recorded');
select ok(not public.feedback_notified(
  (pg_temp.v('rest') -> 0 ->> 'id')::uuid, gen_random_uuid(), true),
  'a wrong lease marks nothing');
reset role;

select ok(
  (select notified_at is not null and notify_lease is null and notify_error is null
   from public.feedback where id = (pg_temp.v('claim') -> 0 ->> 'id')::uuid),
  'delivered: time set, lease cleared');
select ok(
  (select notified_at is null and notify_error = 'resend_503' and notify_attempts = 1
          and notify_after > now() + interval '50 seconds' and notify_locked_at is null
   from public.feedback where id = (pg_temp.v('claim') -> 1 ->> 'id')::uuid),
  'failed: kept, with the reason, to be tried again in a minute');

-- Deleting the account removes the messages.
delete from auth.users where id = '00000000-0000-0000-0000-0000000000f1';
select is((select count(*)::int from public.feedback where user_id = '00000000-0000-0000-0000-0000000000f1'), 0,
  'deleting the account deletes its feedback');

select * from finish();
rollback;
