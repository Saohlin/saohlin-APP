begin;
select plan(99);

-- Two users. e1 writes; e2 is the stranger who must never see any of it.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1', 'e1@test.local',
   '{"profile":{"displayName":"Eva","vocative":"Evo","dateOfBirth":"1992-03-03","gender":"female"},"consent":{"accepted":true}}'),
  ('00000000-0000-0000-0000-0000000000e2', 'e2@test.local',
   '{"profile":{"displayName":"Jana","vocative":"Jano","dateOfBirth":"1985-01-01"},"consent":{"accepted":true}}');

-- Keep the limits out of the way except where they are tested.
update public.app_config set value = '100000' where key in
  ('journal.writes_per_minute', 'journal.searches_per_minute', 'journal.entries_per_day');

create temp table t (k text primary key, v jsonb) on commit drop;
grant all on t to authenticated, service_role;
create function pg_temp.v(p_k text) returns jsonb language sql as $$ select v from t where k = p_k $$;
grant execute on function pg_temp.v(text) to authenticated, service_role;

create function pg_temp.dec(p_user uuid, p_value bytea) returns text language sql security definer as $$
  select private.decrypt(p_user, p_value)
$$;

-- One exchange written straight into the tables (the turn itself is tested in 05).
create function pg_temp.exchange(p_user uuid, p_conv uuid, p_msg uuid, p_reply uuid, p_text text, p_answer text)
returns void language plpgsql security definer as $$
begin
  insert into public.conversations (id, user_id) values (p_conv, p_user) on conflict (id) do nothing;
  insert into public.messages (id, conversation_id, user_id, role, status, content_enc, client_msg_id)
  values (p_msg, p_conv, p_user, 'user', 'complete', private.encrypt(p_user, p_text), gen_random_uuid());
  insert into public.messages (id, conversation_id, user_id, role, status, content_enc, reply_to)
  values (p_reply, p_conv, p_user, 'assistant', 'complete', private.encrypt(p_user, p_answer), p_msg);
end $$;

-- A memory row made from an entry, as the journal job will write it.
create function pg_temp.remember(p_user uuid, p_entry uuid) returns void language sql security definer as $$
  insert into public.memory_embeddings (user_id, source, source_id, content_enc, embedding, occurred_at)
  values (p_user, 'journal_entry', p_entry, private.encrypt(p_user, 'Uvědomila si, že potřebuje klid.'),
          array_fill(0.1::real, array[1024])::extensions.vector(1024), now())
$$;

create function pg_temp.as_user(p_user text) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p_user), true);
$$;
grant execute on function pg_temp.as_user(text) to authenticated;

-- Access ---------------------------------------------------------------------------

select ok(
  not has_table_privilege('anon', 'public.journal_entries', 'select')
  and not has_table_privilege('authenticated', 'public.journal_entries', 'select')
  and not has_table_privilege('service_role', 'public.journal_entries', 'select')
  and not has_table_privilege('authenticated', 'public.journal_entries', 'insert')
  and not has_table_privilege('authenticated', 'public.journal_entries', 'update')
  and not has_table_privilege('authenticated', 'public.journal_entries', 'delete')
  and not has_table_privilege('service_role', 'public.journal_entries', 'update'),
  'no API role, the service role included, can touch journal_entries directly');

select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'journal_entries'),
  0, 'the table has no policy: functions are the only way in');

select is(
  (select count(*)::int from pg_publication_tables where schemaname = 'public' and tablename = 'journal_entries'),
  0, 'journal_entries is in no publication (no Realtime)');

select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname like any (array['journal_%', 'export_journal'])
     and (has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute'))),
  null, 'the journal helpers in private are not executable by anon or authenticated');

set local role anon;
select throws_ok('select public.journal_home()', '42501', null, 'anon cannot open the journal');
select throws_ok($$select public.journal_save(gen_random_uuid(), 'ahoj')$$, '42501', null, 'anon cannot write an entry');
reset role;

-- Create ---------------------------------------------------------------------------

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');

insert into t values ('a', public.journal_save('50000000-0000-0000-0000-000000000001',
  E'  Dnes jsem si uvědomila, že klid je můj nový luxus. 🌙\n\nŽluťoučký kůň úpěl ďábelské ódy.  ', 'Večerní ZNAČKAJEDNA'));
select is(pg_temp.v('a') ->> 'kind', 'ok', 'a new entry is saved');
select is(pg_temp.v('a') -> 'entry' ->> 'body',
  E'Dnes jsem si uvědomila, že klid je můj nový luxus. 🌙\n\nŽluťoučký kůň úpěl ďábelské ódy.',
  'the body comes back exactly, trimmed, with diacritics, emoji and line breaks');
select is(pg_temp.v('a') -> 'entry' ->> 'excerpt',
  'Dnes jsem si uvědomila, že klid je můj nový luxus. 🌙 Žluťoučký kůň úpěl ďábelské ódy.',
  'the excerpt is the body on one line');
select is(pg_temp.v('a') -> 'entry' ->> 'title', 'Večerní ZNAČKAJEDNA', 'the title is stored');
select ok(
  (pg_temp.v('a') -> 'entry' ->> 'version')::int = 1
  and (pg_temp.v('a') -> 'entry' ->> 'sharedWithAi')::boolean = false
  and pg_temp.v('a') -> 'entry' ->> 'source' = 'manual'
  and (pg_temp.v('a') -> 'entry' ->> 'bodyChars')::int = 86
  and pg_temp.v('a') -> 'entry' ->> 'conversationId' is null,
  'a new entry is version 1, private, manual and counted in characters');
select is((pg_temp.v('a') -> 'entry' ->> 'entryDate')::date, (now() at time zone 'Europe/Prague')::date,
  'without a date the entry belongs to today in Prague');

-- The same client id again: the answer was lost, the app retries.
insert into t values ('a2', public.journal_save('50000000-0000-0000-0000-000000000001', 'úplně jiný text'));
select is(pg_temp.v('a2') -> 'entry' ->> 'id', pg_temp.v('a') -> 'entry' ->> 'id', 'a retried save is the same entry');
select is(pg_temp.v('a2') -> 'entry' ->> 'body', pg_temp.v('a') -> 'entry' ->> 'body', 'and its text is not overwritten');

reset role;
select is((select count(*)::int from public.journal_entries where user_id = '00000000-0000-0000-0000-0000000000e1'),
  1, 'a retry does not create a second row');
select ok(
  (select position('klid' in encode(body_enc, 'escape')) = 0
      and position('klid' in encode(excerpt_enc, 'escape')) = 0
      and position('ZNAČKAJEDNA' in encode(title_enc, 'escape')) = 0
      and position('ZNA' in convert_from(title_enc, 'latin1')) = 0
   from public.journal_entries where client_entry_id = '50000000-0000-0000-0000-000000000001'),
  'no column of the row holds readable text');
select is(
  (select pg_temp.dec(user_id, body_enc) from public.journal_entries
   where client_entry_id = '50000000-0000-0000-0000-000000000001'),
  pg_temp.v('a') -> 'entry' ->> 'body', 'the stored ciphertext decrypts with the user''s key');

-- Validation -------------------------------------------------------------------------

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select throws_ok($$select public.journal_save(gen_random_uuid(), E'  \n\t ')$$, '22023', 'INVALID_INPUT', 'an empty entry is rejected');
select throws_ok(format('select public.journal_save(gen_random_uuid(), %L)', repeat('a', 10001)),
  '22023', 'INVALID_INPUT', 'an entry over 10,000 characters is rejected');
select throws_ok(format('select public.journal_save(gen_random_uuid(), %L, %L)', 'ahoj', repeat('t', 121)),
  '22023', 'INVALID_INPUT', 'a title over 120 characters is rejected');
select throws_ok($$select public.journal_save(gen_random_uuid(), 'ahoj', null, date '2019-12-31')$$,
  '22023', 'INVALID_INPUT', 'a date before 2020 is rejected');
select throws_ok(format('select public.journal_save(gen_random_uuid(), %L, null, %L::date)', 'ahoj',
  (now() at time zone 'Europe/Prague')::date + 2), '22023', 'INVALID_INPUT', 'a date after tomorrow is rejected');
select throws_ok($$select public.journal_save(null, 'ahoj')$$, '22023', 'INVALID_INPUT', 'a new entry needs a client id');
select is(
  (public.journal_save('50000000-0000-0000-0000-000000000002', repeat('ž', 10000)) -> 'entry' ->> 'bodyChars')::int,
  10000, 'exactly 10,000 characters are accepted, counted as characters not bytes');

-- Edit -----------------------------------------------------------------------------

insert into t values ('b', public.journal_save(null, 'Klid je můj nový luxus. Opraveno.', 'Večerní ZNAČKAJEDNA', null,
  (pg_temp.v('a') -> 'entry' ->> 'id')::uuid, 1));
select ok(pg_temp.v('b') ->> 'kind' = 'ok' and (pg_temp.v('b') -> 'entry' ->> 'version')::int = 2
  and pg_temp.v('b') -> 'entry' ->> 'body' = 'Klid je můj nový luxus. Opraveno.'
  and pg_temp.v('b') -> 'entry' ->> 'excerpt' = 'Klid je můj nový luxus. Opraveno.',
  'an edit with the right version saves and raises the version');

insert into t values ('b2', public.journal_save(null, 'Starý telefon přepisuje.', null, null,
  (pg_temp.v('a') -> 'entry' ->> 'id')::uuid, 1));
select ok(pg_temp.v('b2') ->> 'kind' = 'conflict' and (pg_temp.v('b2') -> 'entry' ->> 'version')::int = 2
  and pg_temp.v('b2') -> 'entry' ->> 'body' = 'Klid je můj nový luxus. Opraveno.',
  'an edit from a stale version is a conflict, carries the server copy and changes nothing');

insert into t values ('b3', public.journal_save(null, '  Klid je můj nový luxus. Opraveno.  ', 'Večerní ZNAČKAJEDNA', null,
  (pg_temp.v('a') -> 'entry' ->> 'id')::uuid, 2));
select is((pg_temp.v('b3') -> 'entry' ->> 'version')::int, 2, 'saving without a change does not make a new version');

select throws_ok(format('select public.journal_save(null, %L, null, null, %L)', 'ahoj', pg_temp.v('a') -> 'entry' ->> 'id'),
  '22023', 'INVALID_INPUT', 'an edit needs the version it was made from');
select throws_ok($$select public.journal_save(null, 'ahoj', null, null, '99999999-9999-9999-9999-999999999999', 1)$$,
  'P0002', 'NOT_FOUND', 'editing an entry that does not exist is not found');

insert into t values ('b4', public.journal_save(null, 'Klid je můj nový luxus. Opraveno.', 'Večerní ZNAČKAJEDNA',
  date '2026-09-01', (pg_temp.v('a') -> 'entry' ->> 'id')::uuid, 2));
select ok((pg_temp.v('b4') -> 'entry' ->> 'entryDate') = '2026-09-01' and (pg_temp.v('b4') -> 'entry' ->> 'version')::int = 3,
  'moving an entry to another day is an edit');

-- A stranger -------------------------------------------------------------------------

select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select throws_ok(format('select public.journal_get(%L)', pg_temp.v('a') -> 'entry' ->> 'id'),
  'P0002', 'NOT_FOUND', 'another user cannot read the entry');
select throws_ok(format('select public.journal_save(null, %L, null, null, %L, 3)', 'cizí text', pg_temp.v('a') -> 'entry' ->> 'id'),
  'P0002', 'NOT_FOUND', 'another user cannot edit the entry');
select throws_ok(format('select public.journal_delete(%L)', pg_temp.v('a') -> 'entry' ->> 'id'),
  'P0002', 'NOT_FOUND', 'another user cannot delete the entry');
select throws_ok(format('select public.journal_restore(%L)', pg_temp.v('a') -> 'entry' ->> 'id'),
  'P0002', 'NOT_FOUND', 'another user cannot restore the entry');
select ok(
  (public.journal_home() ->> 'total')::int = 0
  and jsonb_array_length(public.journal_list() -> 'items') = 0
  and jsonb_array_length(public.journal_search('klid') -> 'items') = 0
  and jsonb_array_length(public.journal_days(date '2026-01-01', date '2026-03-01')) = 0,
  'another user sees an empty journal, list, search and calendar');
-- Their own entry with the same client id is their own, not e1's.
select isnt(public.journal_save('50000000-0000-0000-0000-000000000001', 'Janin zápis.') -> 'entry' ->> 'id',
  pg_temp.v('a') -> 'entry' ->> 'id', 'client ids are per user');

-- Save a chat message ------------------------------------------------------------------

reset role;
select pg_temp.exchange('00000000-0000-0000-0000-0000000000e1', '51000000-0000-0000-0000-000000000001',
  '52000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000002',
  'Nevím, co se sebou.', 'Evo, klid nenajdeš venku. Polož si otázku, co ti ho bere.');
select pg_temp.exchange('00000000-0000-0000-0000-0000000000e1', '51000000-0000-0000-0000-000000000002',
  '52000000-0000-0000-0000-000000000003', '52000000-0000-0000-0000-000000000004',
  'Smazaný rozhovor.', 'Smazaná odpověď.');
update public.conversations set cleared_at = now() where id = '51000000-0000-0000-0000-000000000002';
insert into public.messages (id, conversation_id, user_id, role, status, event_kind)
values ('52000000-0000-0000-0000-000000000005', '51000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000e1', 'event', 'complete', 'paywall');

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
insert into t values ('m', public.journal_save_message('52000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000010'));
select ok(pg_temp.v('m') ->> 'kind' = 'ok'
  and pg_temp.v('m') -> 'entry' ->> 'source' = 'saved_message'
  and pg_temp.v('m') -> 'entry' ->> 'sourceMessageId' = '52000000-0000-0000-0000-000000000002'
  and pg_temp.v('m') -> 'entry' ->> 'body' = 'Evo, klid nenajdeš venku. Polož si otázku, co ti ho bere.',
  'a reply saved to the journal carries the stored text');
select is(public.journal_save_message('52000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000011')
  -> 'entry' ->> 'id', pg_temp.v('m') -> 'entry' ->> 'id', 'saving the same message again returns the first entry');
select is(public.journal_save_message('52000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000012')
  -> 'entry' ->> 'body', 'Nevím, co se sebou.', 'the user''s own message can be saved too');
select throws_ok($$select public.journal_save_message('52000000-0000-0000-0000-000000000005', gen_random_uuid())$$,
  'P0002', 'NOT_FOUND', 'an event is not a message that can be saved');
select throws_ok($$select public.journal_save_message('52000000-0000-0000-0000-000000000004', gen_random_uuid())$$,
  'P0002', 'NOT_FOUND', 'a message of a deleted conversation cannot be saved');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select throws_ok($$select public.journal_save_message('52000000-0000-0000-0000-000000000002', gen_random_uuid())$$,
  'P0002', 'NOT_FOUND', 'another user cannot save the message');

-- Lists ----------------------------------------------------------------------------

-- 90 more entries over 30 days, three a day, so several share a date.
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
do $$
begin
  for i in 1..90 loop
    perform public.journal_save(gen_random_uuid(), 'Zápis číslo ' || i, null,
      (now() at time zone 'Europe/Prague')::date - ((i - 1) / 3));
  end loop;
end $$;

-- e1 now has: a (2026-09-01), the 10,000 character entry, two saved messages, 90 more = 94.
insert into t values ('p1', public.journal_list());
insert into t values ('p2', public.journal_list(pg_temp.v('p1') -> 'nextCursor'));
insert into t values ('p3', public.journal_list(pg_temp.v('p2') -> 'nextCursor'));
insert into t values ('p4', public.journal_list(pg_temp.v('p3') -> 'nextCursor'));
select is(
  array[jsonb_array_length(pg_temp.v('p1') -> 'items'), jsonb_array_length(pg_temp.v('p2') -> 'items'),
        jsonb_array_length(pg_temp.v('p3') -> 'items'), jsonb_array_length(pg_temp.v('p4') -> 'items')],
  array[30, 30, 30, 4], '94 entries come back as pages of 30, 30, 30 and 4');
select is(
  (select count(distinct i ->> 'id')::int
   from t, jsonb_array_elements(t.v -> 'items') i where t.k in ('p1', 'p2', 'p3', 'p4')),
  94, 'no entry is repeated or skipped across pages, even with several on one date');
select ok(pg_temp.v('p4') -> 'nextCursor' is null or jsonb_typeof(pg_temp.v('p4') -> 'nextCursor') = 'null',
  'the last page has no next cursor');
select is(
  (select array_agg(i ->> 'id' order by o) from jsonb_array_elements(pg_temp.v('p1') -> 'items') with ordinality x(i, o)),
  (select array_agg(i ->> 'id' order by (i ->> 'entryDate')::date desc, (i ->> 'createdAt')::timestamptz desc, i ->> 'id' desc)
   from jsonb_array_elements(pg_temp.v('p1') -> 'items') i),
  'a page is ordered newest first');
select ok(not (pg_temp.v('p1') -> 'items' -> 0) ? 'body', 'a list row never carries the body');
select is(jsonb_array_length(public.journal_list(null, 500) -> 'items'), 50, 'a page is at most 50 entries');
select throws_ok($$select public.journal_list('{"date":"not a date","createdAt":"x","id":"y"}')$$,
  '22023', 'INVALID_INPUT', 'a malformed cursor is rejected');
select throws_ok($$select public.journal_list('{"date":"2026-10-01"}')$$,
  '22023', 'INVALID_INPUT', 'an incomplete cursor is rejected');
select is(jsonb_array_length(public.journal_list(null, 30, true) -> 'items'), 0, 'the shared-only list is empty: nothing is shared');

-- The Deník screen -----------------------------------------------------------------------

insert into t values ('h', public.journal_home());
select ok(jsonb_array_length(pg_temp.v('h') -> 'week') = 7
  and extract(isodow from (pg_temp.v('h') -> 'week' -> 0 ->> 'date')::date) = 1
  and (pg_temp.v('h') ->> 'weekStart') = (pg_temp.v('h') -> 'week' -> 0 ->> 'date'),
  'the week is seven days starting on Monday');
select is((pg_temp.v('h') ->> 'todayCount')::int, 6, 'today holds its three entries, two saved messages and the long one');
select is(
  (select sum((d ->> 'count')::int)::int from jsonb_array_elements(pg_temp.v('h') -> 'week') d
   where (d ->> 'date')::date = (pg_temp.v('h') ->> 'today')::date),
  6, 'and the week strip agrees with it');
select ok(jsonb_array_length(pg_temp.v('h') -> 'recent') = 4 and (pg_temp.v('h') ->> 'total')::int = 94,
  'home carries the four newest entries and the total');
select is(pg_temp.v('h') -> 'recent' -> 0 ->> 'id', pg_temp.v('p1') -> 'items' -> 0 ->> 'id',
  'the newest entry on home is the newest in the list');

select is(public.journal_days(date '2026-09-01', date '2026-09-01'), '[{"date": "2026-09-01", "count": 1}]'::jsonb,
  'a day range lists the days that have entries');
select throws_ok($$select public.journal_days(date '2026-01-01', date '2026-06-01')$$,
  '22023', 'INVALID_INPUT', 'a range over 62 days is rejected');

-- Search -------------------------------------------------------------------------------

insert into t values ('s', public.journal_search('LUXUS. Oprav'));
select ok(pg_temp.v('s') ->> 'kind' = 'ok' and jsonb_array_length(pg_temp.v('s') -> 'items') = 1
  and pg_temp.v('s') -> 'items' -> 0 ->> 'id' = pg_temp.v('a') -> 'entry' ->> 'id',
  'search ignores case');
select is(jsonb_array_length(public.journal_search('novy luxus') -> 'items'), 1, 'search ignores diacritics');
select is(public.journal_search('značkajedna') -> 'items' -> 0 ->> 'id', pg_temp.v('a') -> 'entry' ->> 'id',
  'search reads titles');
select ok(position('luxus' in pg_temp.v('s') -> 'items' -> 0 ->> 'snippet') > 0 and not (pg_temp.v('s') -> 'items' -> 0) ? 'body',
  'a hit carries the words around the match, not the body');
select ok((pg_temp.v('s') ->> 'scanned')::int = 94 and (pg_temp.v('s') ->> 'total')::int = 94, 'search says how much it read');
select is(jsonb_array_length(public.journal_search('%_%') -> 'items'), 0, 'LIKE wildcards are plain characters');
select throws_ok($$select public.journal_search('a')$$, '22023', 'INVALID_INPUT', 'a one-letter search is rejected');

reset role;
update public.app_config set value = '10' where key = 'journal.search_scan_max';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select ok((public.journal_search('zápis číslo') ->> 'scanned')::int = 10
  and jsonb_array_length(public.journal_search('novy luxus') -> 'items') = 0,
  'search reads only the newest journal.search_scan_max entries');
reset role;
update public.app_config set value = '1000' where key = 'journal.search_scan_max';

-- Delete and restore -------------------------------------------------------------------

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
insert into t values ('d', public.journal_delete((pg_temp.v('a') -> 'entry' ->> 'id')::uuid));
select is(pg_temp.v('d') ->> 'kind', 'ok', 'an entry can be deleted');
select throws_ok(format('select public.journal_get(%L)', pg_temp.v('a') -> 'entry' ->> 'id'),
  'P0002', 'NOT_FOUND', 'a deleted entry cannot be read');
select ok((public.journal_home() ->> 'total')::int = 93
  and jsonb_array_length(public.journal_search('novy luxus') -> 'items') = 0
  and jsonb_array_length(public.journal_days(date '2026-09-01', date '2026-09-01')) = 0,
  'a deleted entry leaves home, search and the calendar at once');
select throws_ok(format('select public.journal_delete(%L)', pg_temp.v('a') -> 'entry' ->> 'id'),
  'P0002', 'NOT_FOUND', 'deleting twice is not found');
insert into t values ('r', public.journal_restore((pg_temp.v('a') -> 'entry' ->> 'id')::uuid));
select ok(pg_temp.v('r') ->> 'kind' = 'ok' and pg_temp.v('r') -> 'entry' ->> 'body' = 'Klid je můj nový luxus. Opraveno.'
  and (public.journal_home() ->> 'total')::int = 94, 'a deleted entry can be restored within 24 hours');

select public.journal_delete((pg_temp.v('a') -> 'entry' ->> 'id')::uuid);
reset role;
update public.journal_entries set deleted_at = now() - interval '25 hours'
where id = (pg_temp.v('a') -> 'entry' ->> 'id')::uuid;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select throws_ok(format('select public.journal_restore(%L)', pg_temp.v('a') -> 'entry' ->> 'id'),
  'P0002', 'NOT_FOUND', 'after 24 hours it cannot be restored');
select throws_ok($$select public.journal_save('50000000-0000-0000-0000-000000000001', 'znovu')$$,
  'P0002', 'NOT_FOUND', 'a deleted entry''s client id does not quietly make a new entry');

-- The same message saved again while its first entry was deleted.
select public.journal_delete((pg_temp.v('m') -> 'entry' ->> 'id')::uuid);
insert into t values ('m2', public.journal_save_message('52000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000013'));
select isnt(pg_temp.v('m2') -> 'entry' ->> 'id', pg_temp.v('m') -> 'entry' ->> 'id', 'a deleted saved message can be saved again');
select is(public.journal_restore((pg_temp.v('m') -> 'entry' ->> 'id')::uuid) -> 'entry' ->> 'id',
  pg_temp.v('m2') -> 'entry' ->> 'id', 'restoring the first one returns the live entry instead of failing');

-- Memory cleanup (the triggers) ---------------------------------------------------------

-- Sharing arrives with the next migration; here the flag is set by hand.
reset role;
insert into t values ('x', (select jsonb_build_object('priv', (pg_temp.v('p1') -> 'items' -> 5 ->> 'id'),
                                                       'sh1', (pg_temp.v('p1') -> 'items' -> 6 ->> 'id'),
                                                       'sh2', (pg_temp.v('p1') -> 'items' -> 7 ->> 'id'),
                                                       'sh3', (pg_temp.v('p1') -> 'items' -> 8 ->> 'id'))));
update public.journal_entries set shared_with_ai = true, shared_at = now(), indexed_version = version
where id in ((pg_temp.v('x') ->> 'sh1')::uuid, (pg_temp.v('x') ->> 'sh2')::uuid, (pg_temp.v('x') ->> 'sh3')::uuid);
select pg_temp.remember('00000000-0000-0000-0000-0000000000e1', (pg_temp.v('x') ->> 'sh1')::uuid);
select pg_temp.remember('00000000-0000-0000-0000-0000000000e1', (pg_temp.v('x') ->> 'sh2')::uuid);
select pg_temp.remember('00000000-0000-0000-0000-0000000000e1', (pg_temp.v('x') ->> 'sh3')::uuid);

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select is(jsonb_array_length(public.journal_list(null, 30, true) -> 'items'), 3, 'the shared-only list holds the shared entries');
select public.journal_save(null, 'Soukromý zápis, upravený.', null, null, (pg_temp.v('x') ->> 'priv')::uuid, 1);
reset role;
select is((select count(*)::int from public.memory_embeddings where source = 'journal_entry'), 3,
  'editing a private entry touches no memory row');

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select public.journal_save(null, 'Sdílený zápis, upravený.', null, null, (pg_temp.v('x') ->> 'sh1')::uuid, 1);
reset role;
select ok(
  not exists (select 1 from public.memory_embeddings where source_id = (pg_temp.v('x') ->> 'sh1')::uuid)
  and (select shared_with_ai and indexed_version is null and version = 2
       from public.journal_entries where id = (pg_temp.v('x') ->> 'sh1')::uuid),
  'editing a shared entry removes its memory rows at once, keeps it shared and marks it for indexing');

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select public.journal_delete((pg_temp.v('x') ->> 'sh2')::uuid);
reset role;
select ok(
  not exists (select 1 from public.memory_embeddings where source_id = (pg_temp.v('x') ->> 'sh2')::uuid)
  and (select not shared_with_ai and shared_at is null and deleted_at is not null
       from public.journal_entries where id = (pg_temp.v('x') ->> 'sh2')::uuid),
  'deleting a shared entry un-shares it and removes its memory rows in the same transaction');

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select is((public.journal_restore((pg_temp.v('x') ->> 'sh2')::uuid) -> 'entry' ->> 'sharedWithAi')::boolean, false,
  'a restored entry comes back private');
reset role;

delete from public.journal_entries where id = (pg_temp.v('x') ->> 'sh3')::uuid;
select is((select count(*)::int from public.memory_embeddings where source = 'journal_entry'), 0,
  'a hard delete removes the entry''s memory rows too');

select throws_ok(
  format('update public.journal_entries set deleted_at = now() where id = %L', pg_temp.v('x') ->> 'sh1'),
  '23514', null, 'the table refuses an entry that is deleted and still shared');

-- A purged conversation takes its messages; the saved entry stays.
delete from public.conversations where id = '51000000-0000-0000-0000-000000000001';
select ok(
  (select source_message_id is null and deleted_at is null and source = 'saved_message'
   from public.journal_entries where id = (pg_temp.v('m2') -> 'entry' ->> 'id')::uuid),
  'when the conversation is purged the saved entry stays, without its link');

-- Limits ---------------------------------------------------------------------------------

update public.app_config set value = '3' where key = 'journal.writes_per_minute';
update public.usage_state set journal_minute_count = 0, journal_minute_window = now()
where user_id = '00000000-0000-0000-0000-0000000000e2';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select public.journal_save(gen_random_uuid(), 'jedna');
select public.journal_save(gen_random_uuid(), 'dvě');
select public.journal_save(gen_random_uuid(), 'tři');
insert into t values ('l1', public.journal_save(gen_random_uuid(), 'čtyři'));
select ok(pg_temp.v('l1') ->> 'kind' = 'limit' and pg_temp.v('l1') ->> 'code' = 'RATE_LIMITED'
  and (pg_temp.v('l1') ->> 'retryAfterSeconds')::int between 1 and 60,
  'the write after the per-minute limit is refused with a wait time');
select is(public.journal_delete(gen_random_uuid()) ->> 'code', 'RATE_LIMITED', 'deletes share the same limit');
select is((public.journal_home() ->> 'total')::int, 4, 'a refused write stores nothing, and reads are not limited');
reset role;

update public.app_config set value = '100000' where key = 'journal.writes_per_minute';
update public.app_config set value = '4' where key = 'journal.entries_per_day';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
insert into t values ('l2', public.journal_save(gen_random_uuid(), 'pátý dnes'));
select ok(pg_temp.v('l2') ->> 'code' = 'RATE_LIMITED' and (pg_temp.v('l2') ->> 'retryAfterSeconds')::int between 1 and 86400,
  'the daily limit refuses with the time to Prague midnight');
select is(public.journal_delete((public.journal_list() -> 'items' -> 0 ->> 'id')::uuid) ->> 'kind', 'ok',
  'the daily limit does not stop a delete');
select is(public.journal_save(gen_random_uuid(), 'po smazání') ->> 'code', 'RATE_LIMITED',
  'deleting an entry does not buy another one today');
reset role;

update public.app_config set value = '100000' where key = 'journal.entries_per_day';
update public.app_config set value = '3' where key = 'journal.entries_max';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select is(public.journal_save(gen_random_uuid(), 'čtvrtý celkem') ->> 'code', 'LIMIT_REACHED',
  'the entry ceiling refuses a new entry');
select public.journal_delete((public.journal_list() -> 'items' -> 0 ->> 'id')::uuid);
select is(public.journal_save(gen_random_uuid(), 'místo se uvolnilo') ->> 'kind', 'ok', 'and deleting one makes room');
reset role;

update public.app_config set value = '2' where key = 'journal.searches_per_minute';
update public.usage_state set journal_search_count = 0, journal_search_window = now()
where user_id = '00000000-0000-0000-0000-0000000000e2';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select public.journal_search('jedna');
select public.journal_search('jedna');
select is(public.journal_search('jedna') ->> 'code', 'RATE_LIMITED', 'search has its own per-minute limit');
reset role;
update public.app_config set value = '100000' where key in ('journal.entries_max', 'journal.searches_per_minute');

-- Consent --------------------------------------------------------------------------------

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
select public.withdraw_consent(array['special_category']::public.consent_kind[]);
select throws_ok($$select public.journal_save(gen_random_uuid(), 'bez souhlasu')$$,
  '42501', 'CONSENT_REQUIRED', 'without the special category consent nothing new is written');
select throws_ok(format('select public.journal_save(null, %L, null, null, %L, 1)', 'úprava bez souhlasu',
  public.journal_list() -> 'items' -> 0 ->> 'id'), '42501', 'CONSENT_REQUIRED', 'and nothing is edited');
select ok(jsonb_array_length(public.journal_list() -> 'items') = 3
  and public.journal_get((public.journal_list() -> 'items' -> 0 ->> 'id')::uuid) ->> 'body' is not null
  and public.journal_delete((public.journal_list() -> 'items' -> 0 ->> 'id')::uuid) ->> 'kind' = 'ok',
  'reading and deleting stay available without it');
reset role;

-- Export, the queue, account deletion ----------------------------------------------------

select ok(
  jsonb_array_length(private.export_journal('00000000-0000-0000-0000-0000000000e1'))
    = (select count(*)::int from public.journal_entries where user_id = '00000000-0000-0000-0000-0000000000e1')
  and exists (select 1 from jsonb_array_elements(private.export_journal('00000000-0000-0000-0000-0000000000e1')) x
              where x ->> 'deletedAt' is not null and x ->> 'body' = 'Klid je můj nový luxus. Opraveno.'),
  'the export holds every entry in full, the ones waiting for the purge included and marked');

insert into ops.jobs_queue (kind, user_id, payload)
values ('journal', '00000000-0000-0000-0000-0000000000e1', jsonb_build_object('entry_id', pg_temp.v('x') ->> 'sh1'));
select throws_ok(
  format($$insert into ops.jobs_queue (kind, user_id, payload) values ('journal', %L, %L)$$,
         '00000000-0000-0000-0000-0000000000e1', jsonb_build_object('entry_id', pg_temp.v('x') ->> 'sh1')),
  '23505', null, 'one entry has at most one open job');
select throws_ok(
  format($$insert into ops.jobs_queue (kind, user_id, payload) values ('journal', %L, %L)$$,
         '00000000-0000-0000-0000-0000000000e1', '{"entry_id":"x","text":"Dnes jsem..."}'),
  '23514', null, 'a job payload cannot carry text');

delete from auth.users where id = '00000000-0000-0000-0000-0000000000e1';
select ok(
  not exists (select 1 from public.journal_entries where user_id = '00000000-0000-0000-0000-0000000000e1')
  and not exists (select 1 from public.memory_embeddings where user_id = '00000000-0000-0000-0000-0000000000e1')
  and not exists (select 1 from ops.jobs_queue where user_id = '00000000-0000-0000-0000-0000000000e1')
  and not exists (select 1 from private.user_keys where user_id = '00000000-0000-0000-0000-0000000000e1'),
  'deleting the account removes the entries, their memory rows, their jobs and the key');

select * from finish();
rollback;
