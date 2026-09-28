begin;
select plan(8);

select ok(
  not has_schema_privilege('authenticated', 'kb', 'usage')
  and not has_schema_privilege('anon', 'kb', 'usage'),
  'kb schema is not usable by anon or authenticated'
);

select is(
  (select array_agg(c.relname::text order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'kb' and c.relkind = 'r' and not c.relrowsecurity),
  null,
  'RLS is enabled on every kb table, as a second lock'
);

select ok(
  not has_function_privilege('authenticated', 'public.retrieve_all(uuid, extensions.vector, text, jsonb, text, text[], int)', 'execute')
  and not has_function_privilege('authenticated', 'public.get_kb_static()', 'execute')
  and not has_function_privilege('anon', 'public.retrieve_all(uuid, extensions.vector, text, jsonb, text, text[], int)', 'execute')
  and not has_function_privilege('anon', 'public.get_kb_static()', 'execute'),
  'the app cannot page through her knowledge base'
);

select ok(
  has_function_privilege('service_role', 'public.retrieve_all(uuid, extensions.vector, text, jsonb, text, text[], int)', 'execute')
  and has_function_privilege('service_role', 'public.get_kb_static()', 'execute'),
  'the chat function can retrieve'
);

-- A tiny collection to check the search itself.
insert into kb.documents (id, collection, source_file, title) values
  ('00000000-0000-0000-0000-00000000d001', 'knowledge', 'a.docx', 'A'),
  ('00000000-0000-0000-0000-00000000d002', 'video', 'v.mp4', 'V');
insert into kb.chunks (id, document_id, collection, text, embedding, personal_reading) values
  ('k1', '00000000-0000-0000-0000-00000000d001', 'knowledge', 'Samota a osamělost',
   (select array_agg(case when i = 1 then 1.0 else 0 end)::extensions.vector(1024) from generate_series(1, 1024) i), false),
  ('k2', '00000000-0000-0000-0000-00000000d001', 'knowledge', 'Hojnost a peníze',
   (select array_agg(case when i = 2 then 1.0 else 0 end)::extensions.vector(1024) from generate_series(1, 1024) i), false),
  ('v1', '00000000-0000-0000-0000-00000000d002', 'video', 'Výklad pro jednu klientku',
   (select array_agg(case when i = 1 then 1.0 else 0 end)::extensions.vector(1024) from generate_series(1, 1024) i), true);

select is(
  (select array_agg(id) from kb.search_chunks(
     (select array_agg(case when i = 1 then 0.9 when i = 2 then 0.1 else 0 end)::extensions.vector(1024)
      from generate_series(1, 1024) i), 'samota', 'knowledge', 2)),
  array['k1', 'k2'],
  'nearest passage first'
);

select is(
  (select count(*)::int from kb.search_chunks(
     (select array_agg(case when i = 1 then 1.0 else 0 end)::extensions.vector(1024) from generate_series(1, 1024) i),
     'x', 'video', 5)),
  0,
  'one-to-one readings are left out by default'
);

update public.app_config set value = 'false' where key = 'retrieval.exclude_personal_readings';
select is(
  (select count(*)::int from kb.search_chunks(
     (select array_agg(case when i = 1 then 1.0 else 0 end)::extensions.vector(1024) from generate_series(1, 1024) i),
     'x', 'video', 5)),
  1,
  'and come back only when the config allows it'
);

select is(
  (select array_agg(id) from kb.search_chunks(null, 'osamelost', 'knowledge', 2, 1.0)),
  array['k1'],
  'the lexical arm matches Czech typed without diacritics'
);

select * from finish();
rollback;
