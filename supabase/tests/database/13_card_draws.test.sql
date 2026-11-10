begin;
select plan(20);

-- Two users. u1 draws; u2 is the stranger. An admin publishes two cards.
insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000000ad', 'admin@test.local', '{"saohlin_admin": true}'),
  ('00000000-0000-0000-0000-0000000000d1', 'd1@test.local', '{}'),
  ('00000000-0000-0000-0000-0000000000d2', 'd2@test.local', '{}');

create temp table t (k text primary key, v jsonb) on commit drop;
grant all on t to authenticated, service_role;
create function pg_temp.v(p_k text) returns jsonb language sql as $$ select v from t where k = p_k $$;
grant execute on function pg_temp.v(text) to authenticated, service_role;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select (v ->> 'id')::uuid from t where k = p_k $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;
create function pg_temp.as_user(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p_user), true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;

-- Cards: two published (with artwork), one draft.
set local role service_role;
insert into t values ('c1', public.admin_cards_save('00000000-0000-0000-0000-0000000000ad', null, '{"name":"Důvěra"}'));
insert into t values ('c2', public.admin_cards_save('00000000-0000-0000-0000-0000000000ad', null, '{"name":"Orel"}'));
insert into t values ('c3', public.admin_cards_save('00000000-0000-0000-0000-0000000000ad', null, '{"name":"Koncept"}'));
select public.admin_cards_set_art('00000000-0000-0000-0000-0000000000ad', pg_temp.id('c1'),
  pg_temp.id('c1')::text || '/11111111-1111-1111-1111-111111111111.webp');
select public.admin_cards_set_art('00000000-0000-0000-0000-0000000000ad', pg_temp.id('c2'),
  pg_temp.id('c2')::text || '/22222222-2222-2222-2222-222222222222.webp');
select public.admin_cards_save('00000000-0000-0000-0000-0000000000ad', pg_temp.id('c1'), '{"name":"Důvěra","status":"published"}');
select public.admin_cards_save('00000000-0000-0000-0000-0000000000ad', pg_temp.id('c2'), '{"name":"Orel","status":"published"}');
reset role;

-- Access ---------------------------------------------------------------------------

select ok(
  has_column_privilege('authenticated', 'public.card_draws', 'card_name', 'select')
  and not has_column_privilege('authenticated', 'public.card_draws', 'user_id', 'select')
  and not has_table_privilege('authenticated', 'public.card_draws', 'insert')
  and not has_table_privilege('authenticated', 'public.card_draws', 'update')
  and not has_table_privilege('authenticated', 'public.card_draws', 'delete')
  and not has_table_privilege('anon', 'public.card_draws', 'select'),
  'signed-in users may only read draws; nobody writes directly');

select ok(
  has_function_privilege('authenticated', 'public.draw_card(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.card_today()', 'execute')
  and not has_function_privilege('anon', 'public.draw_card(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.card_today()', 'execute'),
  'only a signed-in user can draw');

set local role authenticated;

select throws_ok($$ select public.draw_card(gen_random_uuid()) $$, '42501', 'NOT_AUTHENTICATED',
  'drawing needs a signed-in user');
select throws_ok($$ select public.card_today() $$, '42501', 'NOT_AUTHENTICATED',
  'reading today''s card needs a signed-in user');

-- The first draw of the day ----------------------------------------------------------

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');

select is(public.card_today(), null, 'nothing drawn yet today');
select throws_ok($$ select public.draw_card(null) $$, '22023', 'INVALID_INPUT', 'a card is required');
select throws_ok(format($$ select public.draw_card(%L) $$, pg_temp.id('c3')), 'P0002', 'CARD_NOT_FOUND',
  'a draft card cannot be drawn');
select throws_ok($$ select public.draw_card(gen_random_uuid()) $$, 'P0002', 'CARD_NOT_FOUND',
  'an unknown card cannot be drawn');

insert into t values ('d1', public.draw_card(pg_temp.id('c1')));
select ok((pg_temp.v('d1') ->> 'isNew')::boolean, 'the first draw is new');
select is(pg_temp.v('d1') ->> 'cardName', 'Důvěra', 'the draw carries the card name');
select is((pg_temp.v('d1') ->> 'drawDay')::date, (now() at time zone 'Europe/Prague')::date,
  'the draw counts for today in Prague');

-- One card per day ---------------------------------------------------------------------

insert into t values ('d1b', public.draw_card(pg_temp.id('c2')));
select is(pg_temp.v('d1b') ->> 'id', pg_temp.v('d1') ->> 'id', 'a second draw the same day returns the first one');
select ok(not (pg_temp.v('d1b') ->> 'isNew')::boolean, 'and says it is not new');
select is(public.card_today() ->> 'cardName', 'Důvěra', 'today''s card is the first one drawn');
select is((select count(*)::int from public.card_draws), 1, 'the user sees one draw');

-- The stranger -----------------------------------------------------------------------------

select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select is(public.card_today(), null, 'another user has no draw today');
select is((select count(*)::int from public.card_draws), 0, 'another user cannot see someone else''s draws');

reset role;

-- Yesterday's draw does not block today ----------------------------------------------------

update public.card_draws set draw_day = draw_day - 1 where user_id = '00000000-0000-0000-0000-0000000000d1';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
insert into t values ('d2', public.draw_card(pg_temp.id('c2')));
select ok((pg_temp.v('d2') ->> 'isNew')::boolean and pg_temp.v('d2') ->> 'cardName' = 'Orel',
  'a new day brings a new draw');
reset role;

-- A deleted card keeps its name in the history; the account takes the history with it ------

set local role service_role;
select public.admin_cards_delete('00000000-0000-0000-0000-0000000000ad', pg_temp.id('c2'));
reset role;
select ok((select card_id is null and card_name = 'Orel' from public.card_draws where id = pg_temp.id('d2')),
  'a deleted card leaves its name in the history');

delete from auth.users where id = '00000000-0000-0000-0000-0000000000d1';
select is((select count(*)::int from public.card_draws), 0, 'deleting the account deletes its draws');

select * from finish();
rollback;
