-- Extensions, internal schema and default privileges.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- unaccent() is not immutable, so it can't be used in indexes or generated
-- columns directly. This wrapper can. Czech users often type without diacritics.
create or replace function public.f_unaccent(text)
returns text
language sql
immutable
parallel safe
strict
set search_path = ''
as $$ select extensions.unaccent('extensions.unaccent'::regdictionary, $1) $$;

-- Internal helpers (encryption, keys). Never exposed through the API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- New functions are executable by PUBLIC by default in Postgres, and Supabase
-- also grants them to anon and authenticated. Every function the app may call
-- is granted explicitly instead.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges in schema private revoke execute on functions from public;

revoke execute on function public.f_unaccent(text) from public, anon, authenticated;
grant execute on function public.f_unaccent(text) to authenticated, service_role;
