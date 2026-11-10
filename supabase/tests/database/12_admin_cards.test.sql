begin;
select plan(37);

insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-0000-0000-0000000000ad', 'admin@test.local', '{"saohlin_admin": true}'),
  ('00000000-0000-0000-0000-0000000000c2', 'real@test.local', '{}');

create temp table t (k text primary key, v jsonb) on commit drop;
grant all on t to authenticated, service_role;
create function pg_temp.v(p_k text) returns jsonb language sql as $$ select v from t where k = p_k $$;
grant execute on function pg_temp.v(text) to authenticated, service_role;
create function pg_temp.id(p_k text) returns uuid language sql as $$ select (v ->> 'id')::uuid from t where k = p_k $$;
grant execute on function pg_temp.id(text) to authenticated, service_role;
create function pg_temp.deck(p_field text) returns text[] language sql as $$
  select array_agg(e ->> p_field order by (e ->> 'position')::int)
  from jsonb_array_elements(public.admin_cards_list('00000000-0000-0000-0000-0000000000ad') -> 'items') e $$;
grant execute on function pg_temp.deck(text) to service_role;

-- Access --------------------------------------------------------------------------

select ok(
  has_column_privilege('authenticated', 'public.cards', 'name', 'select')
  and has_column_privilege('authenticated', 'public.cards', 'art_path', 'select')
  and not has_table_privilege('authenticated', 'public.cards', 'insert')
  and not has_table_privilege('authenticated', 'public.cards', 'update')
  and not has_table_privilege('authenticated', 'public.cards', 'delete')
  and not has_table_privilege('anon', 'public.cards', 'select')
  and not has_table_privilege('service_role', 'public.cards', 'insert'),
  'signed-in users may only read cards; nobody writes directly');

select ok(
  not has_column_privilege('authenticated', 'public.cards', 'meaning', 'select')
  and not has_column_privilege('authenticated', 'public.cards', 'updated_by', 'select'),
  'signed-in users cannot read the meaning or who edited a card');

select ok(
  (select bool_and(not has_function_privilege('authenticated', p.oid, 'execute')
                   and not has_function_privilege('anon', p.oid, 'execute')
                   and has_function_privilege('service_role', p.oid, 'execute'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'admin\_cards\_%'),
  'card admin functions are executable by the service role only');

select ok((select public from storage.buckets where id = 'card-art'), 'the card-art bucket exists and is public');

set local role service_role;

select throws_ok($$ select public.admin_cards_list('00000000-0000-0000-0000-0000000000c2') $$,
  '42501', 'FORBIDDEN', 'a non-admin is refused');

-- Create ----------------------------------------------------------------------------

insert into t values ('a', public.admin_cards_save('00000000-0000-0000-0000-0000000000ad', null,
  '{"name":"  Důvěra ","keywords":[" Odevzdání","","Jistota"],"quote":"Mám jistotu.","message":"Vzkaz",
    "step":"Krok","mantra":"Řádek 1\nŘádek 2","meaning":"Dlouhý význam"}'));
insert into t values ('b', public.admin_cards_save('00000000-0000-0000-0000-0000000000ad', null, '{"name":"Orel"}'));
insert into t values ('c', public.admin_cards_save('00000000-0000-0000-0000-0000000000ad', null, '{"name":"Lev"}'));

select is(pg_temp.v('a') ->> 'name', 'Důvěra', 'the name is trimmed');
select is(pg_temp.v('a') -> 'keywords', '["Odevzdání", "Jistota"]'::jsonb, 'keywords are trimmed and empty ones dropped');
select is(pg_temp.v('a') ->> 'mantra', E'Řádek 1\nŘádek 2', 'line breaks in the mantra are kept');
select is(pg_temp.v('a') ->> 'status', 'draft', 'a new card is a draft');
select is(pg_temp.deck('position'), array['1', '2', '3'], 'new cards go to the end of the deck');

select throws_ok($$ select public.admin_cards_save('00000000-0000-0000-0000-0000000000ad', null, '{"name":"X","status":"published"}') $$,
  'P0001', 'NO_ART', 'a new card cannot be published without artwork');
select throws_ok($$ select public.admin_cards_save('00000000-0000-0000-0000-0000000000ad', null, '{"name":"  "}') $$,
  '22023', 'INVALID_INPUT', 'a name is required');
select throws_ok($$ select public.admin_cards_save('00000000-0000-0000-0000-0000000000ad', null, '{"name":"X","keywords":["1","2","3","4","5","6"]}') $$,
  '22023', 'INVALID_INPUT', 'at most five keywords');
select throws_ok(format($$ select public.admin_cards_save('00000000-0000-0000-0000-0000000000ad', %L, '{"name":"Důvěra","status":"published"}') $$, pg_temp.id('a')),
  'P0001', 'NO_ART', 'a card without artwork cannot be published');

-- Artwork -----------------------------------------------------------------------------

select throws_ok(format($$ select public.admin_cards_set_art('00000000-0000-0000-0000-0000000000ad', %L, %L) $$,
    pg_temp.id('a'), pg_temp.id('b')::text || '/11111111-1111-1111-1111-111111111111.png'),
  '22023', 'INVALID_INPUT', 'artwork must sit in the card''s own folder');

insert into t values ('art1', public.admin_cards_set_art('00000000-0000-0000-0000-0000000000ad', pg_temp.id('a'),
  pg_temp.id('a')::text || '/11111111-1111-1111-1111-111111111111.png'));
select ok(pg_temp.v('art1') -> 'removeArt' = 'null'::jsonb, 'first artwork: nothing to remove');

insert into t values ('pub', public.admin_cards_save('00000000-0000-0000-0000-0000000000ad', pg_temp.id('a'),
  '{"name":"Důvěra","keywords":["Odevzdání","Jistota"],"message":"Vzkaz","status":"published"}'));
select is(pg_temp.v('pub') ->> 'status', 'published', 'a card with artwork can be published');
select ok(pg_temp.v('pub') ->> 'publishedAt' is not null, 'publishing stamps the time');
select ok(pg_temp.v('pub') ->> 'quote' is null and pg_temp.v('pub') ->> 'meaning' is null,
  'saving clears the fields that were left out');

select throws_ok(format($$ select public.admin_cards_set_art('00000000-0000-0000-0000-0000000000ad', %L, null) $$, pg_temp.id('a')),
  'P0001', 'NO_ART', 'a published card cannot lose its artwork');

insert into t values ('art2', public.admin_cards_set_art('00000000-0000-0000-0000-0000000000ad', pg_temp.id('a'),
  pg_temp.id('a')::text || '/22222222-2222-2222-2222-222222222222.webp'));
select is(pg_temp.v('art2') ->> 'removeArt', pg_temp.id('a')::text || '/11111111-1111-1111-1111-111111111111.png',
  'replacing artwork hands back the old file to remove');

-- App users see published cards only ------------------------------------------------------

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
select is((select array_agg(name) from public.cards), array['Důvěra'], 'app users see published cards only');
reset role;
set local role service_role;

-- Duplicate ---------------------------------------------------------------------------------

insert into t values ('d', public.admin_cards_duplicate('00000000-0000-0000-0000-0000000000ad', pg_temp.id('a')));
select is(pg_temp.v('d') ->> 'name', 'Důvěra (kopie)', 'a copy is named as a copy');
select ok(pg_temp.v('d') ->> 'status' = 'draft' and (pg_temp.v('d') ->> 'position')::int = 4,
  'a copy is a draft at the end of the deck');
select is(pg_temp.v('d') ->> 'artPath', pg_temp.v('art2') -> 'card' ->> 'artPath', 'a copy shares the artwork');

insert into t values ('art3', public.admin_cards_set_art('00000000-0000-0000-0000-0000000000ad', pg_temp.id('d'),
  pg_temp.id('d')::text || '/33333333-3333-3333-3333-333333333333.jpg'));
select ok(pg_temp.v('art3') -> 'removeArt' = 'null'::jsonb, 'artwork another card still uses is not removed');

-- Bulk status -----------------------------------------------------------------------------------

insert into t values ('st', public.admin_cards_set_status('00000000-0000-0000-0000-0000000000ad',
  array[pg_temp.id('b'), pg_temp.id('d')], 'published'));
select is((pg_temp.v('st') ->> 'changed')::int, 1, 'bulk publish changes the cards that have artwork');
select is(pg_temp.v('st') -> 'skippedNoArt', jsonb_build_array(pg_temp.id('b')), 'and lists the ones without');

-- Reorder ----------------------------------------------------------------------------------------

select throws_ok(format($$ select public.admin_cards_reorder('00000000-0000-0000-0000-0000000000ad', array[%L, %L]::uuid[]) $$,
    pg_temp.id('a'), pg_temp.id('b')),
  '22023', 'INVALID_INPUT', 'a reorder must list every card');
select lives_ok(format($$ select public.admin_cards_reorder('00000000-0000-0000-0000-0000000000ad', array[%L, %L, %L, %L]::uuid[]) $$,
    pg_temp.id('d'), pg_temp.id('c'), pg_temp.id('b'), pg_temp.id('a')),
  'the deck can be reordered');
select is(pg_temp.deck('name'), array['Důvěra (kopie)', 'Lev', 'Orel', 'Důvěra'],
  'the new order is saved');

-- Get --------------------------------------------------------------------------------------------

insert into t values ('g', public.admin_cards_get('00000000-0000-0000-0000-0000000000ad', pg_temp.id('c')));
select ok((pg_temp.v('g') ->> 'prevId')::uuid = pg_temp.id('d') and (pg_temp.v('g') ->> 'nextId')::uuid = pg_temp.id('b')
          and (pg_temp.v('g') ->> 'total')::int = 4,
  'a card comes with its neighbours and the deck size');
select throws_ok($$ select public.admin_cards_get('00000000-0000-0000-0000-0000000000ad', gen_random_uuid()) $$,
  'P0002', 'NOT_FOUND', 'a missing card is NOT_FOUND');

-- Delete -----------------------------------------------------------------------------------------

insert into t values ('del', public.admin_cards_delete('00000000-0000-0000-0000-0000000000ad', pg_temp.id('a')));
select is(pg_temp.v('del') ->> 'removeArt', pg_temp.id('a')::text || '/22222222-2222-2222-2222-222222222222.webp',
  'deleting a card hands back its artwork when nothing else uses it');
select is(pg_temp.deck('position'), array['1', '2', '3'], 'the deck closes the gap');

reset role;
select is((select array_agg(distinct action order by action) from ops.admin_log where action like 'cards.%'),
  array['cards.art', 'cards.create', 'cards.delete', 'cards.duplicate', 'cards.reorder', 'cards.status', 'cards.update'],
  'every change is in the admin log');
select ok(not exists (select 1 from ops.admin_log where detail::text like '%Důvěra%' or detail::text like '%Vzkaz%'),
  'the admin log holds no card text');

select * from finish();
rollback;
