-- Profile, consent records, onboarding answers and settings.
-- Every user-scoped table: user_id not null, cascade on account deletion,
-- RLS enabled in the same migration.

create table public.profiles (
  user_id                 uuid primary key references auth.users (id) on delete cascade,
  display_name            text not null check (char_length(display_name) between 1 and 60),
  vocative                text not null check (char_length(vocative) between 1 and 60),
  first_name              text check (char_length(first_name) <= 60),
  last_name               text check (char_length(last_name) <= 60),
  date_of_birth_enc       bytea,
  gender                  public.gender not null default 'unspecified',
  zodiac                  public.zodiac_sign,
  locale                  text not null default 'cs',
  consent_granted_at      timestamptz,
  profile_completed_at    timestamptz,
  deeper_completed_at     timestamptz,
  ai_processing_paused_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Append-only consent evidence. Timestamps come from the server clock.
create table public.consents (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  kind           public.consent_kind not null,
  notice_version text not null,
  source         text not null check (source in ('onboarding', 'settings')),
  app_version    text check (char_length(app_version) <= 20),
  platform       text check (platform in ('ios', 'android', 'web')),
  granted_at     timestamptz not null default now(),
  withdrawn_at   timestamptz
);
alter table public.consents enable row level security;
create index consents_user_active_idx on public.consents (user_id, kind) where withdrawn_at is null;

-- Onboarding part 2. Encrypted per user (see private.encrypt).
create table public.user_context (
  user_id           uuid primary key references auth.users (id) on delete cascade,
  work_enc          bytea,
  situation_enc     bytea,
  blocking_enc      bytea,
  visions_enc       bytea,
  last_confirmed_at timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.user_context enable row level security;

create table public.user_settings (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  notifications  boolean not null default true,
  voice_playback boolean not null default true,
  haptics        boolean not null default true,
  updated_at     timestamptz not null default now()
);
alter table public.user_settings enable row level security;

-- Access. Sensitive tables are written only through the RPCs in the next
-- migration; the client can read its own profile, consents and settings,
-- and change its own settings directly.
revoke all on public.profiles, public.consents, public.user_context, public.user_settings
  from anon, authenticated;

grant select on public.profiles, public.consents, public.user_settings to authenticated;
grant update (notifications, voice_playback, haptics) on public.user_settings to authenticated;

create policy "Users read their own profile"
  on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users read their own consents"
  on public.consents for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users read their own settings"
  on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users update their own settings"
  on public.user_settings for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Helpers ----------------------------------------------------------------

create or replace function private.zodiac_for(p_dob date)
returns public.zodiac_sign
language sql
immutable
set search_path = ''
as $$
  select case
    when p_dob is null then null
    when (m = 3 and d >= 21) or (m = 4 and d <= 19) then 'aries'
    when (m = 4 and d >= 20) or (m = 5 and d <= 20) then 'taurus'
    when (m = 5 and d >= 21) or (m = 6 and d <= 20) then 'gemini'
    when (m = 6 and d >= 21) or (m = 7 and d <= 22) then 'cancer'
    when (m = 7 and d >= 23) or (m = 8 and d <= 22) then 'leo'
    when (m = 8 and d >= 23) or (m = 9 and d <= 22) then 'virgo'
    when (m = 9 and d >= 23) or (m = 10 and d <= 22) then 'libra'
    when (m = 10 and d >= 23) or (m = 11 and d <= 21) then 'scorpio'
    when (m = 11 and d >= 22) or (m = 12 and d <= 21) then 'sagittarius'
    when (m = 12 and d >= 22) or (m = 1 and d <= 19) then 'capricorn'
    when (m = 1 and d >= 20) or (m = 2 and d <= 18) then 'aquarius'
    else 'pisces'
  end::public.zodiac_sign
  from (select extract(month from p_dob)::int as m, extract(day from p_dob)::int as d) parts
$$;

-- Parses an ISO date and checks the minimum age. Raises on invalid input.
create or replace function private.valid_dob(p_value text)
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  dob date;
  min_age int := coalesce((select (value)::int from public.app_config where key = 'onboarding.min_age'), 15);
begin
  if p_value is null or p_value = '' then
    return null;
  end if;
  if p_value !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'INVALID_DATE_OF_BIRTH' using errcode = '22023';
  end if;
  dob := p_value::date;
  if dob < date '1900-01-01' or dob > current_date - make_interval(years => min_age) then
    raise exception 'AGE_BELOW_MINIMUM' using errcode = '22023';
  end if;
  return dob;
end $$;

create or replace function private.valid_gender(p_value text)
returns public.gender
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value in ('female', 'male', 'other', 'unspecified') then p_value::public.gender
    else 'unspecified'::public.gender
  end
$$;

revoke all on function private.zodiac_for(date) from public, anon, authenticated;
revoke all on function private.valid_dob(text) from public, anon, authenticated;
revoke all on function private.valid_gender(text) from public, anon, authenticated;

-- Sign-up -----------------------------------------------------------------
--
-- The app collects the profile and consent before the account exists and
-- sends them as sign-up metadata. This creates the rows with server
-- timestamps, then removes the data from auth metadata so it isn't kept in
-- plain text there.

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta     jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  p        jsonb := coalesce(meta -> 'profile', '{}'::jsonb);
  c        jsonb := coalesce(meta -> 'consent', '{}'::jsonb);
  name     text  := nullif(btrim(coalesce(p ->> 'displayName', p ->> 'firstName', '')), '');
  dob      date  := private.valid_dob(p ->> 'dateOfBirth');
  version  text  := coalesce(nullif(c ->> 'noticeVersion', ''),
                             (select value #>> '{}' from public.app_config where key = 'consent.notice_version'));
  platform text  := case when c ->> 'platform' in ('ios', 'android', 'web') then c ->> 'platform' end;
begin
  insert into public.profiles (
    user_id, display_name, vocative, first_name, last_name,
    date_of_birth_enc, gender, zodiac, profile_completed_at
  ) values (
    new.id,
    left(coalesce(name, 'Ty'), 60),
    left(coalesce(nullif(btrim(p ->> 'vocative'), ''), name, 'Ty'), 60),
    left(nullif(btrim(p ->> 'firstName'), ''), 60),
    left(nullif(btrim(p ->> 'lastName'), ''), 60),
    private.encrypt(new.id, dob::text),
    private.valid_gender(p ->> 'gender'),
    private.zodiac_for(dob),
    case when name is not null then now() end
  );

  if coalesce((c ->> 'accepted')::boolean, false) then
    insert into public.consents (user_id, kind, notice_version, source, app_version, platform)
    select new.id, k, version, 'onboarding', left(c ->> 'appVersion', 20), platform
    from unnest(enum_range(null::public.consent_kind)) as k;

    update public.profiles set consent_granted_at = now() where user_id = new.id;
  end if;

  insert into public.user_settings (user_id) values (new.id);

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'profile' - 'consent'
  where id = new.id;

  return new;
end $$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();
