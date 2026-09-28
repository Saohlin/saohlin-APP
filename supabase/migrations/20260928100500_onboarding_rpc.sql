-- Functions the app calls for session state and onboarding.
-- Each one acts only on the calling user (auth.uid()).

-- Everything the app needs to route and render, in one round trip.
create or replace function public.get_me()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'userId',        u.id,
    'email',         u.email,
    'emailVerified', u.email_confirmed_at is not null,
    'profile', jsonb_build_object(
      'displayName', p.display_name,
      'vocative',    p.vocative,
      'firstName',   p.first_name,
      'lastName',    p.last_name,
      'dateOfBirth', private.decrypt(u.id, p.date_of_birth_enc),
      'gender',      p.gender,
      'zodiac',      p.zodiac
    ),
    'context', jsonb_strip_nulls(jsonb_build_object(
      'work',      private.decrypt(u.id, c.work_enc),
      'situation', private.decrypt(u.id, c.situation_enc),
      'blocking',  private.decrypt(u.id, c.blocking_enc),
      'visions',   private.decrypt(u.id, c.visions_enc)
    )),
    'onboarding', jsonb_strip_nulls(jsonb_build_object(
      'consentGrantedAt',   p.consent_granted_at,
      'profileCompletedAt', p.profile_completed_at,
      'deeperCompletedAt',  p.deeper_completed_at,
      'aiPausedAt',         p.ai_processing_paused_at
    )),
    'entitlement', jsonb_build_object(
      'active', false,
      'plan', null,
      'trialTotal', trial.total,
      'trialRemaining', trial.total
    ),
    'settings', jsonb_build_object(
      'notifications', s.notifications,
      'voicePlayback', s.voice_playback,
      'haptics',       s.haptics
    )
  )
  from auth.users u
  join public.profiles p on p.user_id = u.id
  left join public.user_context c on c.user_id = u.id
  left join public.user_settings s on s.user_id = u.id
  cross join lateral (
    select coalesce((select (value)::int from public.app_config where key = 'trial.total_replies'), 5) as total
  ) trial
  where u.id = auth.uid()
$$;

-- Updates any subset of the profile fields. Returns the refreshed state.
create or replace function public.update_profile(p_profile jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := auth.uid();
  name text := nullif(btrim(p_profile ->> 'displayName'), '');
  dob  date;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if p_profile ? 'displayName' and name is null then
    raise exception 'DISPLAY_NAME_REQUIRED' using errcode = '22023';
  end if;
  if p_profile ? 'dateOfBirth' then
    dob := private.valid_dob(p_profile ->> 'dateOfBirth');
  end if;

  update public.profiles set
    display_name      = case when p_profile ? 'displayName' then left(name, 60) else display_name end,
    vocative          = case when p_profile ? 'vocative'
                              then left(coalesce(nullif(btrim(p_profile ->> 'vocative'), ''), name, display_name), 60)
                             else vocative end,
    first_name        = case when p_profile ? 'firstName' then left(nullif(btrim(p_profile ->> 'firstName'), ''), 60) else first_name end,
    last_name         = case when p_profile ? 'lastName' then left(nullif(btrim(p_profile ->> 'lastName'), ''), 60) else last_name end,
    date_of_birth_enc = case when p_profile ? 'dateOfBirth' then private.encrypt(uid, dob::text) else date_of_birth_enc end,
    zodiac            = case when p_profile ? 'dateOfBirth' then private.zodiac_for(dob) else zodiac end,
    gender            = case when p_profile ? 'gender' then private.valid_gender(p_profile ->> 'gender') else gender end,
    profile_completed_at = coalesce(profile_completed_at, now()),
    updated_at        = now()
  where user_id = uid;

  return public.get_me();
end $$;

-- Saves the four onboarding answers. Requires active special-category consent.
create or replace function public.save_context(
  p_work text default null,
  p_situation text default null,
  p_blocking text default null,
  p_visions text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.consents
    where user_id = uid and kind = 'special_category' and withdrawn_at is null
  ) then
    raise exception 'CONSENT_REQUIRED' using errcode = '42501';
  end if;
  if greatest(char_length(p_work), char_length(p_situation),
              char_length(p_blocking), char_length(p_visions)) > 2000 then
    raise exception 'ANSWER_TOO_LONG' using errcode = '22001';
  end if;

  insert into public.user_context as uc (user_id, work_enc, situation_enc, blocking_enc, visions_enc)
  values (
    uid,
    private.encrypt(uid, btrim(p_work)),
    private.encrypt(uid, btrim(p_situation)),
    private.encrypt(uid, btrim(p_blocking)),
    private.encrypt(uid, btrim(p_visions))
  )
  on conflict (user_id) do update set
    work_enc          = excluded.work_enc,
    situation_enc     = excluded.situation_enc,
    blocking_enc      = excluded.blocking_enc,
    visions_enc       = excluded.visions_enc,
    last_confirmed_at = now(),
    updated_at        = now();
end $$;

-- Marks an onboarding step complete. 'deeper' requires consent on record.
create or replace function public.complete_onboarding(p_step text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  if p_step = 'profile' then
    update public.profiles
    set profile_completed_at = coalesce(profile_completed_at, now()), updated_at = now()
    where user_id = uid;
  elsif p_step = 'deeper' then
    if not exists (
      select 1 from public.consents
      where user_id = uid and kind = 'special_category' and withdrawn_at is null
    ) then
      raise exception 'CONSENT_REQUIRED' using errcode = '42501';
    end if;
    update public.profiles
    set deeper_completed_at = coalesce(deeper_completed_at, now()), updated_at = now()
    where user_id = uid;
  else
    raise exception 'UNKNOWN_STEP' using errcode = '22023';
  end if;

  return public.get_me();
end $$;

-- Records consent after sign-up (e.g. re-consent from settings).
create or replace function public.grant_consent(
  p_kinds public.consent_kind[],
  p_notice_version text,
  p_platform text default null,
  p_app_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_kinds), 0) = 0 or coalesce(btrim(p_notice_version), '') = '' then
    raise exception 'INVALID_CONSENT' using errcode = '22023';
  end if;

  insert into public.consents (user_id, kind, notice_version, source, app_version, platform)
  select uid, k, left(p_notice_version, 40), 'settings', left(p_app_version, 20),
         case when p_platform in ('ios', 'android', 'web') then p_platform end
  from unnest(p_kinds) as k
  where not exists (
    select 1 from public.consents c
    where c.user_id = uid and c.kind = k and c.withdrawn_at is null
  );

  update public.profiles set
    consent_granted_at = coalesce(consent_granted_at, now()),
    ai_processing_paused_at = case
      when exists (select 1 from public.consents where user_id = uid and kind = 'ai_processing' and withdrawn_at is null)
       and exists (select 1 from public.consents where user_id = uid and kind = 'special_category' and withdrawn_at is null)
      then null else ai_processing_paused_at end,
    updated_at = now()
  where user_id = uid;

  return public.get_me();
end $$;

-- Withdraws consent. Withdrawing AI or special-category consent pauses all AI processing.
create or replace function public.withdraw_consent(p_kinds public.consent_kind[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;

  update public.consents set withdrawn_at = now()
  where user_id = uid and kind = any (p_kinds) and withdrawn_at is null;

  if p_kinds && array['ai_processing', 'special_category']::public.consent_kind[] then
    update public.profiles set ai_processing_paused_at = now(), updated_at = now()
    where user_id = uid;
  end if;

  return public.get_me();
end $$;

-- Only these are callable from the app.
revoke all on function public.get_me() from public, anon;
revoke all on function public.update_profile(jsonb) from public, anon;
revoke all on function public.save_context(text, text, text, text) from public, anon;
revoke all on function public.complete_onboarding(text) from public, anon;
revoke all on function public.grant_consent(public.consent_kind[], text, text, text) from public, anon;
revoke all on function public.withdraw_consent(public.consent_kind[]) from public, anon;

grant execute on function public.get_me() to authenticated;
grant execute on function public.update_profile(jsonb) to authenticated;
grant execute on function public.save_context(text, text, text, text) to authenticated;
grant execute on function public.complete_onboarding(text) to authenticated;
grant execute on function public.grant_consent(public.consent_kind[], text, text, text) to authenticated;
grant execute on function public.withdraw_consent(public.consent_kind[]) to authenticated;
