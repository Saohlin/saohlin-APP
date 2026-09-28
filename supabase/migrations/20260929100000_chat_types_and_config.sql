-- Chat module (C1): types, configuration and helpers.

create type public.conversation_origin as enum ('chat', 'welcome', 'guide_draw', 'journal_share');
create type public.message_role        as enum ('user', 'assistant', 'event');
create type public.message_status      as enum ('pending', 'complete', 'failed', 'awaiting_entitlement', 'blocked');
create type public.response_mode       as enum ('PROZKOUMANI', 'VEDENI', 'VYSVETLENI', 'PAUZA', 'HRANICE', 'IDENTITA', 'KARTA');
create type public.input_method        as enum ('text', 'voice');
create type public.memory_category     as enum ('goal', 'pattern', 'recurring_guide', 'family', 'work',
                                                'relationship', 'health_context', 'preference', 'other');
create type public.memory_source       as enum ('conversation_insight', 'journal_entry', 'guide_draw');
create type public.plan_kind           as enum ('founding', 'public');
create type public.store_kind          as enum ('app_store', 'play_store', 'promotional');
create type public.usage_kind          as enum ('trial_reply', 'reply', 'reply_degraded', 'tts', 'stt');
create type public.answer_mark         as enum ('right', 'too_generic', 'should_have_asked', 'wrong_guide');

-- Operations schema: cost rows, job queue, data requests. Service role only.
create schema if not exists ops;
revoke all on schema ops from public, anon, authenticated;
grant usage on schema ops to service_role;
alter default privileges in schema ops revoke execute on functions from public;

-- Configuration. Everything a product decision can change is a row here, not code.
-- Limit messages are drafts in her voice until she approves them (open question Q9).
insert into public.app_config (key, value, description, public) values
  ('limits.daily_soft_cap',     '30',   'Replies per day for members before her warm pause message (midnight Prague reset)', true),
  ('limits.monthly_allowance',  '400',  'Member replies per month on the main model; past it, the cheaper model answers',     false),
  ('limits.rate_per_minute',    '6',    'Messages per minute per user',                                                      false),
  ('limits.message_max_chars',  '4000', 'Longest message a user can send',                                                   true),
  ('memory.raw_window',         '8',    'Raw messages sent to the model; older turns reach it through summaries',            false),
  ('memory.summary_every',      '10',   'Exchanges between summary and notes refreshes',                                     false),
  ('memory.notes_max',          '40',   'Most memory notes kept per user',                                                   false),
  ('memory.recent_conversations','3',   'Summaries of other recent conversations included in each prompt',                   false),
  ('model.reply',               '"gpt-5.6-terra"', 'Reply model. Calibration and production must use the same one',          false),
  ('model.reply_degraded',      '"gpt-5.6-luna"',  'Reply model past the monthly allowance',                                 false),
  ('model.planner',             '"gpt-5.6-luna"',  'Mode planner and crisis classifier',                                     false),
  ('model.jobs',                '"gpt-5.6-luna"',  'Titles, summaries, notes and moments',                                   false),
  ('model.embedding',           '"text-embedding-3-large"', 'Embedding model, locked at 1024 dimensions',                     false),
  ('chat.limit_messages', jsonb_build_object(
      'PAYWALL',   'Tvoje bezplatné odpovědi jsou vyčerpané. Pokud chceš pokračovat, můžeš se stát členkou SAOHLIN.',
      'DAILY_CAP', 'Dnes jsme spolu mluvily opravdu dlouho. Dej si chvíli klidu a nech to v sobě dozrát. Zítra tu budu zase pro tebe.',
      'AI_PAUSED', 'Zpracování tvých zpráv umělou inteligencí je pozastavené, protože jsi odvolala souhlas. Obnovit ho můžeš v Nastavení.'),
   'Limit messages shown in the chat, in her voice. Drafts until Claudia approves (Q9)', true),
  ('crisis.patterns', '[]', 'Czech crisis keyword patterns (regex, matched unaccented, lower case). Filled by the chat function seed', false),
  ('crisis.resources', '[]', 'Czech crisis lines [{name, phone, hours, audience}]. EMPTY until Claudia and the lawyer confirm (Q2); production deploy is blocked while empty', false)
on conflict (key) do nothing;

-- Encryption with a key already unwrapped. private.encrypt/decrypt unwrap the
-- user's data key on every call, which is fine for one field and slow for a
-- page of messages. These take the key once.
create or replace function private.encrypt_with(p_dek text, p_value text)
returns bytea
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null or p_value = '' then null
    else extensions.pgp_sym_encrypt(p_value, p_dek, 'cipher-algo=aes256, s2k-mode=1') end
$$;

create or replace function private.decrypt_with(p_dek text, p_value bytea)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null then null else extensions.pgp_sym_decrypt(p_value, p_dek) end
$$;

revoke all on function private.encrypt_with(text, text) from public, anon, authenticated;
revoke all on function private.decrypt_with(text, bytea) from public, anon, authenticated;

create or replace function private.config_int(p_key text, p_default int)
returns int
language sql
stable
set search_path = ''
as $$ select coalesce((select (value #>> '{}')::int from public.app_config where key = p_key), p_default) $$;

revoke all on function private.config_int(text, int) from public, anon, authenticated;
