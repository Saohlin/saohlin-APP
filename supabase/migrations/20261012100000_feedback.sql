-- Feedback (screen 48, "Napiš mi"): a message from the user to Claudia.
-- SUPABASE_IMPLEMENTATION 5.8 and 15.4, acceptance G4.8 (it reaches her inbox
-- within five minutes).
--
-- App (authenticated): send_feedback.
-- The `notify` Edge Function (service role): claim_feedback, feedback_notified.
--
-- Same rules as the journal:
--   * the text is stored only as ciphertext under the user's data key, and no
--     API role can touch the table, the service role included;
--   * exceptions are for bad requests (NOT_AUTHENTICATED 42501, INVALID_INPUT
--     22023); the daily limit is returned as data, { "kind": "limit" };
--   * a send is made once: p_client_id is created on the phone and reused on a
--     retry, so a send whose answer was lost never becomes two messages.
--
-- Unlike the journal, sending does not need the consent for sensitive data:
-- someone who withdrew it must still be able to write to her.
--
-- The email is sent after the fact. send_feedback wakes the `notify` function
-- at once and a minute tick wakes it again while anything is unsent, so a
-- failed delivery is retried (1, 4, 9 ... minutes apart) and the message is
-- never lost: it is in the table whether or not the email went out.
--
-- `notify` is called the way `jobs` is, with the same shared secret. Its
-- address is taken from the Vault secret `jobs_function_url` (…/jobs becomes
-- …/notify), so no new Vault secret is needed.

create table public.feedback (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  client_id        uuid not null,       -- made on the phone; a retried send reuses it
  category         text not null default 'general'
                   check (category in ('general', 'idea', 'bug', 'ai_answer', 'billing')),
  body_enc         bytea not null,
  -- The ceiling. feedback.max_chars can lower the limit, never raise it.
  body_chars       int not null check (body_chars between 1 and 5000),
  app_version      text,
  platform         text check (platform in ('ios', 'android', 'web')),
  os_version       text,
  locale           text,
  status           text not null default 'new' check (status in ('new', 'read', 'done')),
  created_at       timestamptz not null default clock_timestamp(),
  -- Delivery to her inbox.
  notified_at      timestamptz,
  notify_attempts  int not null default 0,
  notify_after     timestamptz not null default now(),
  notify_locked_at timestamptz,
  notify_lease     uuid,
  notify_error     text,
  unique (user_id, client_id)
);
alter table public.feedback enable row level security;
-- No policy and no grant, the service role included: functions only.
revoke all on public.feedback from public, anon, authenticated, service_role;

-- The daily limit counts one user's newest messages.
create index feedback_user_idx on public.feedback (user_id, created_at desc);
-- Only messages still waiting for their email are in this index.
create index feedback_unsent_idx on public.feedback (notify_after) where notified_at is null;

insert into public.app_config (key, value, description, public) values
  ('feedback.max_chars',           '5000', 'Longest feedback message, in characters (the table ceiling is 5,000)', true),
  ('feedback.per_day',             '10',   'Feedback messages one user can send in 24 hours',                      false),
  ('feedback.notify_max_attempts', '8',    'Tries to email one feedback message before giving up',                 false),
  -- OFF for now (decided 11 Oct 2026): messages are stored, none is emailed.
  -- Turning it on (set the value to 1) sends every message still waiting, oldest first.
  ('feedback.notify_enabled',      '0',    'Email feedback to Claudia: 1 on, 0 off (messages are stored either way)', false);

-- Waking the notify function ---------------------------------------------------------

-- Calls `notify` if a message is waiting for its email. Returns 1 when called.
create or replace function ops.kick_notify()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  url    text;
  secret text;
begin
  if private.config_int('feedback.notify_enabled', 0) <> 1 then return 0; end if;
  if to_regnamespace('net') is null then return 0; end if;
  if not exists (
    select 1 from public.feedback
    where notified_at is null and notify_after <= now()
      and notify_attempts < private.config_int('feedback.notify_max_attempts', 8)
      and (notify_locked_at is null or notify_locked_at < now() - interval '5 minutes')) then
    return 0;
  end if;
  select decrypted_secret into url    from vault.decrypted_secrets where name = 'jobs_function_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'jobs_secret';
  if url is null or secret is null then return 0; end if;
  url := regexp_replace(url, '/jobs/?$', '/notify');
  execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 5000)'
    using url, jsonb_build_object('Content-Type', 'application/json', 'x-jobs-secret', secret), '{}'::jsonb;
  return 1;
end $$;
revoke all on function ops.kick_notify() from public, anon, authenticated;

-- App ----------------------------------------------------------------------------------

create or replace function public.send_feedback(
  p_client_id   uuid,
  p_body        text,
  p_app_version text default null,
  p_platform    text default null,
  p_os_version  text default null,
  p_locale      text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid    uuid := auth.uid();
  -- Spaces and line breaks around the message are not part of it.
  body   text := regexp_replace(coalesce(p_body, ''), '^\s+|\s+$', '', 'g');
  maxc   int  := least(greatest(private.config_int('feedback.max_chars', 5000), 1), 5000);
  perday int  := private.config_int('feedback.per_day', 10);
  f      public.feedback%rowtype;
  n      int;
  oldest timestamptz;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if p_client_id is null or char_length(body) = 0 or char_length(body) > maxc then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  -- One send at a time per user, so two taps cannot both pass the daily limit.
  insert into public.usage_state (user_id) values (uid) on conflict do nothing;
  perform 1 from public.usage_state where user_id = uid for update;

  -- A retry of a send that already arrived: the same answer, nothing new stored.
  select * into f from public.feedback where user_id = uid and client_id = p_client_id;
  if found then
    return jsonb_build_object('kind', 'ok', 'id', f.id, 'createdAt', f.created_at);
  end if;

  select count(*), min(created_at) into n, oldest
  from public.feedback
  where user_id = uid and created_at > now() - interval '24 hours';
  if n >= perday then
    return private.journal_limit('RATE_LIMITED',
      least(86400, greatest(1, ceil(extract(epoch from (oldest + interval '24 hours' - now())))::int)));
  end if;

  insert into public.feedback (user_id, client_id, body_enc, body_chars, app_version, platform, os_version, locale)
  values (uid, p_client_id, private.encrypt(uid, body), char_length(body),
          left(nullif(btrim(p_app_version), ''), 40),
          case when p_platform in ('ios', 'android', 'web') then p_platform end,
          left(nullif(btrim(p_os_version), ''), 40),
          left(nullif(btrim(p_locale), ''), 20))
  returning * into f;

  -- The request leaves when this transaction commits. A problem waking the
  -- function must not undo the send: the minute tick will wake it instead.
  begin
    perform ops.kick_notify();
  exception when others then
    raise warning 'send_feedback: kick failed (%)', sqlstate;
  end;

  return jsonb_build_object('kind', 'ok', 'id', f.id, 'createdAt', f.created_at);
end $$;

-- The notify function ------------------------------------------------------------------

-- Leases up to p_limit messages that still need their email and returns them
-- with the text. A lease not answered within five minutes can be taken again.
create or replace function public.claim_feedback(p_limit int default 10)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with picked as (
    select f.id
    from public.feedback f
    where private.config_int('feedback.notify_enabled', 0) = 1
      and f.notified_at is null and f.notify_after <= now()
      and f.notify_attempts < private.config_int('feedback.notify_max_attempts', 8)
      and (f.notify_locked_at is null or f.notify_locked_at < now() - interval '5 minutes')
    order by f.notify_after, f.created_at
    limit least(greatest(p_limit, 1), 50)
    for update skip locked
  ),
  leased as (
    update public.feedback f
    set notify_locked_at = now(), notify_lease = gen_random_uuid(), notify_attempts = f.notify_attempts + 1
    from picked
    where f.id = picked.id
    returning f.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id,
      'lease', l.notify_lease,
      'body', private.decrypt(l.user_id, l.body_enc),
      'category', l.category,
      'appVersion', l.app_version,
      'platform', l.platform,
      'osVersion', l.os_version,
      'locale', l.locale,
      'createdAt', l.created_at,
      'email', (select u.email from auth.users u where u.id = l.user_id),
      'name', (select p.display_name from public.profiles p where p.user_id = l.user_id))
    order by l.created_at), '[]'::jsonb)
  from leased l
$$;

-- The answer to a lease: sent, or not (try again later: 1, 4, 9 ... minutes).
-- A stale lease changes nothing.
create or replace function public.feedback_notified(p_id uuid, p_lease uuid, p_ok boolean, p_error text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.feedback
  set notified_at      = case when p_ok then now() end,
      notify_error     = case when p_ok then null else left(coalesce(nullif(btrim(p_error), ''), 'unknown'), 200) end,
      notify_after     = case when p_ok then notify_after
                              else now() + make_interval(mins => notify_attempts * notify_attempts) end,
      notify_locked_at = null,
      notify_lease     = null
  where id = p_id and notify_lease = p_lease and notified_at is null;
  return found;
end $$;

-- Access ---------------------------------------------------------------------------------

revoke all on function public.send_feedback(uuid, text, text, text, text, text) from public, anon;
revoke all on function public.claim_feedback(int)                               from public, anon, authenticated;
revoke all on function public.feedback_notified(uuid, uuid, boolean, text)      from public, anon, authenticated;
grant execute on function public.send_feedback(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.claim_feedback(int)                               to service_role;
grant execute on function public.feedback_notified(uuid, uuid, boolean, text)      to service_role;

-- Every minute, while anything is unsent ------------------------------------------------

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'saohlin-feedback-tick';
    perform cron.schedule('saohlin-feedback-tick', '* * * * *', 'select ops.kick_notify()');
  else
    raise notice 'pg_cron not available: feedback emails are sent only when a message arrives';
  end if;
end $$;
