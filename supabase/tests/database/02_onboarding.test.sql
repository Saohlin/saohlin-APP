begin;
select plan(24);

-- Setup: three users. A and B consented at onboarding, C did not.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local',
   '{"profile":{"displayName":"Tereza","vocative":"Terezo","firstName":"Tereza","lastName":"Nová",
     "dateOfBirth":"1990-05-12","gender":"female"},
     "consent":{"accepted":true,"noticeVersion":"2026-10","platform":"ios","appVersion":"1.0"}}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.local',
   '{"profile":{"displayName":"Marek","vocative":"Marku","dateOfBirth":"1985-12-30","gender":"male"},
     "consent":{"accepted":true,"noticeVersion":"2026-10"}}'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.local',
   '{"profile":{"displayName":"Jana"}}');

-- Sign-up trigger
select is((select count(*)::int from public.profiles), 3, 'sign-up creates a profile per user');
select is((select count(*)::int from public.consents where user_id = '00000000-0000-0000-0000-00000000000a'), 4,
  'consent at onboarding records all four kinds');
select is((select count(*)::int from public.consents where user_id = '00000000-0000-0000-0000-00000000000c'), 0,
  'no consent recorded when not accepted');
select is((select raw_user_meta_data from auth.users where id = '00000000-0000-0000-0000-00000000000a'), '{}'::jsonb,
  'profile and consent are removed from auth metadata');
select is((select zodiac::text from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a'), 'taurus',
  'zodiac is derived from date of birth');
select ok((select position('1990' in encode(date_of_birth_enc, 'escape')) = 0
           from public.profiles where user_id = '00000000-0000-0000-0000-00000000000a'),
  'date of birth is stored encrypted');
select throws_ok(
  $$insert into auth.users (email, raw_user_meta_data)
    values ('kid@test.local', jsonb_build_object('profile', jsonb_build_object(
      'displayName', 'Kid', 'dateOfBirth', to_char(current_date - interval '10 years', 'YYYY-MM-DD'))))$$,
  '22023', 'AGE_BELOW_MINIMUM', 'sign-up under the minimum age is rejected');

-- Anonymous callers
set local role anon;
select throws_ok('select public.get_me()', '42501', null, 'anon cannot call get_me');
reset role;

-- As user A
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

select is(public.get_me() #>> '{profile,displayName}', 'Tereza', 'get_me returns own profile');
select is(public.get_me() #>> '{profile,dateOfBirth}', '1990-05-12', 'get_me decrypts date of birth');
select is((select count(*)::int from public.profiles), 1, 'A sees only her own profile row');
select is((select count(*)::int from public.consents where user_id <> auth.uid()), 0, 'A sees no other consents');
select throws_ok($$update public.profiles set display_name = 'X'$$, '42501', null,
  'direct profile updates are not allowed');
select throws_ok('select * from public.user_context', '42501', null, 'user_context is not directly readable');
select throws_ok('select * from private.user_keys', '42501', null, 'private keys are not readable');

select lives_ok($$select public.save_context('Učitelka', 'Rozvod', 'Strach', 'Klid a radost')$$,
  'A can save onboarding answers');
select is(public.get_me() #>> '{context,situation}', 'Rozvod', 'answers round-trip through get_me');
select is(public.update_profile('{"displayName":"Terka","vocative":"Terko"}') #>> '{profile,vocative}', 'Terko',
  'update_profile changes the vocative');
select throws_ok($$select public.update_profile('{"dateOfBirth":"2020-01-01"}')$$, '22023', 'AGE_BELOW_MINIMUM',
  'update_profile rejects an underage date');
select is(public.complete_onboarding('deeper') #>> '{onboarding}' is not null, true, 'A can complete onboarding');

update public.user_settings set haptics = false where user_id = '00000000-0000-0000-0000-00000000000b';
reset role;
select is((select haptics from public.user_settings where user_id = '00000000-0000-0000-0000-00000000000b'), true,
  'A cannot change B''s settings');

-- As user C (no consent)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}';
select throws_ok($$select public.save_context('x')$$, '42501', 'CONSENT_REQUIRED',
  'answers cannot be saved without consent');
select throws_ok($$select public.complete_onboarding('deeper')$$, '42501', 'CONSENT_REQUIRED',
  'onboarding cannot complete without consent');
reset role;

-- Deletion removes everything, including the user's encryption key.
delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';
select is(
  (select count(*)::int from (
     select user_id from public.profiles union all
     select user_id from public.consents union all
     select user_id from public.user_context union all
     select user_id from public.user_settings union all
     select user_id from private.user_keys) t
   where user_id = '00000000-0000-0000-0000-00000000000a'),
  0, 'deleting the account removes all rows and the key');

select * from finish();
rollback;
