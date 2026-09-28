begin;
select plan(7);

-- Every table in public has RLS enabled.
select is(
  (select array_agg(c.relname::text order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  null,
  'RLS is enabled on every public table'
);

-- Every user_id column is NOT NULL (or a primary key).
select is(
  (select array_agg(table_name::text order by table_name)
   from information_schema.columns
   where table_schema = 'public' and column_name = 'user_id' and is_nullable = 'YES'),
  null,
  'user_id is NOT NULL everywhere'
);

-- Every user_id references auth.users with ON DELETE CASCADE.
select is(
  (select array_agg(t.relname::text order by t.relname)
   from pg_attribute a
   join pg_class t on t.oid = a.attrelid
   join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public' and t.relkind = 'r' and a.attname = 'user_id'
     and not exists (
       select 1 from pg_constraint k
       where k.conrelid = t.oid and k.contype = 'f'
         and k.confrelid = 'auth.users'::regclass
         and k.confdeltype = 'c'
         and a.attnum = any (k.conkey)
     )),
  null,
  'user_id cascades from auth.users everywhere'
);

-- Nothing in public is executable by anon.
select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('anon', p.oid, 'execute')),
  null,
  'no public function is executable by anon'
);

-- Only the allow-listed functions are executable by signed-in users.
select is(
  (select array_agg(distinct p.proname::text order by p.proname::text)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('authenticated', p.oid, 'execute')),
  array['complete_onboarding', 'delete_my_account', 'f_unaccent', 'get_me', 'grant_consent',
        'save_context', 'update_profile', 'withdraw_consent'],
  'only allow-listed functions are executable by authenticated'
);

-- The private schema is closed to API roles.
select ok(
  not has_schema_privilege('authenticated', 'private', 'usage')
  and not has_schema_privilege('anon', 'private', 'usage'),
  'private schema is not usable by anon or authenticated'
);

-- Sensitive tables have no direct write grants for API roles.
select is(
  (select array_agg(distinct table_name::text order by table_name::text)
   from information_schema.role_table_grants
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
     and table_name in ('profiles', 'consents', 'user_context')),
  null,
  'no direct writes to profiles, consents or user_context'
);

select * from finish();
rollback;
