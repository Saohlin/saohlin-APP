begin;
select plan(5);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d1', 'd1@test.local',
   '{"profile":{"displayName":"Eva","dateOfBirth":"1992-03-03"},"consent":{"accepted":true}}'),
  ('00000000-0000-0000-0000-0000000000d2', 'd2@test.local',
   '{"profile":{"displayName":"Petr","dateOfBirth":"1980-07-07"},"consent":{"accepted":true}}');

set local role anon;
select throws_ok('select public.delete_my_account()', '42501', null, 'anon cannot delete an account');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select public.save_context('Učitelka', null, null, null);
select lives_ok('select public.delete_my_account()', 'a user can delete their own account');
reset role;

select is((select count(*)::int from auth.users where id = '00000000-0000-0000-0000-0000000000d1'), 0,
  'the auth user is gone');
select is(
  (select count(*)::int from public.profiles where user_id = '00000000-0000-0000-0000-0000000000d1')
  + (select count(*)::int from public.consents where user_id = '00000000-0000-0000-0000-0000000000d1')
  + (select count(*)::int from public.user_context where user_id = '00000000-0000-0000-0000-0000000000d1')
  + (select count(*)::int from public.user_settings where user_id = '00000000-0000-0000-0000-0000000000d1')
  + (select count(*)::int from private.user_keys where user_id = '00000000-0000-0000-0000-0000000000d1'),
  0, 'profile, consents, answers, settings and key are gone');
select is((select count(*)::int from public.profiles where user_id = '00000000-0000-0000-0000-0000000000d2'), 1,
  'other accounts are untouched');

select * from finish();
rollback;
