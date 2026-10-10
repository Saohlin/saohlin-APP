-- Test access: an account that is never asked to subscribe and is not held by
-- the daily pause or moved to the cheaper model after the monthly allowance.
-- For the developer's and the client's own accounts on a test project.
--
-- It is a flag on the user's entitlement row, set by hand in the SQL editor
-- (ops.grant_test_access); nothing in the app or in any function names an
-- email. The per-minute rate limit stays: it protects against a runaway loop,
-- not against use. Every reply is still written to usage_ledger.

alter table public.entitlements add column unlimited boolean not null default false;

create or replace function private.is_unlimited(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select e.unlimited and e.active and (e.period_ends_at is null or e.period_ends_at > now())
    from public.entitlements e where e.user_id = p_user), false)
$$;
revoke all on function private.is_unlimited(uuid) from public, anon, authenticated;

-- begin_turn as before, with the two caps skipped for an unlimited account.
create or replace function public.begin_turn(p_user uuid, p_message_ref uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s        public.usage_state%rowtype;
  trial    int := private.config_int('trial.total_replies', 5);
  daycap   int := private.config_int('limits.daily_soft_cap', 30);
  monthcap int := private.config_int('limits.monthly_allowance', 400);
  permin   int := private.config_int('limits.rate_per_minute', 6);
  today    date := (now() at time zone 'Europe/Prague')::date;
  paid     boolean := private.is_paid(p_user);
  nocap    boolean := private.is_unlimited(p_user);
  degraded boolean := false;
begin
  insert into public.usage_state (user_id) values (p_user) on conflict do nothing;
  select * into s from public.usage_state where user_id = p_user for update;

  if s.day <> today then s.day := today; s.day_count := 0; end if;
  if s.month <> date_trunc('month', today)::date then
    s.month := date_trunc('month', today)::date; s.month_count := 0;
  end if;
  if now() - s.minute_window >= interval '1 minute' then
    s.minute_window := now(); s.minute_count := 0;
  end if;

  if s.minute_count >= permin then
    return jsonb_build_object('decision', 'rate_limited',
      'retryAfterSeconds', greatest(1, ceil(extract(epoch from (s.minute_window + interval '1 minute' - now())))::int));
  end if;

  if not paid then
    if s.trial_used >= trial then
      return jsonb_build_object('decision', 'paywall', 'paid', false, 'trialRemaining', 0);
    end if;
    s.trial_used := s.trial_used + 1;
    insert into public.usage_ledger (user_id, kind, message_id) values (p_user, 'trial_reply', p_message_ref);
  else
    if s.day_count >= daycap and not nocap then
      return jsonb_build_object('decision', 'daily_cap', 'paid', true);
    end if;
    degraded := s.month_count >= monthcap and not nocap;
    insert into public.usage_ledger (user_id, kind, message_id)
    values (p_user, case when degraded then 'reply_degraded' else 'reply' end::public.usage_kind, p_message_ref);
  end if;

  update public.usage_state set
    trial_used = s.trial_used, day = s.day, day_count = s.day_count + 1,
    month = s.month, month_count = s.month_count + 1,
    minute_window = s.minute_window, minute_count = s.minute_count + 1
  where user_id = p_user;

  return jsonb_build_object(
    'decision', case when degraded then 'allow_degraded' else 'allow' end,
    'paid', paid,
    'trialRemaining', case when paid then null else trial - s.trial_used end);
end $$;

-- Gives (or takes back) test access by email. Run from the SQL editor only.
create or replace function ops.grant_test_access(p_email text, p_on boolean default true)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(btrim(p_email));
  if uid is null then
    return 'no account with that email yet: sign up in the app first, then run this again';
  end if;
  if p_on then
    insert into public.entitlements (user_id, active, plan, store, period_ends_at, will_renew, unlimited, updated_at)
    values (uid, true, 'founding', 'promotional', null, false, true, now())
    on conflict (user_id) do update
      set active = true, store = 'promotional', period_ends_at = null, will_renew = false,
          plan = coalesce(public.entitlements.plan, 'founding'), unlimited = true, updated_at = now();
    return 'test access on';
  end if;
  update public.entitlements
  set unlimited = false, active = false, updated_at = now()
  where user_id = uid and store = 'promotional';
  return 'test access off';
end $$;
revoke all on function ops.grant_test_access(text, boolean) from public, anon, authenticated, service_role;

