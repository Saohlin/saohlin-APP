-- Account deletion, callable by the signed-in user.

-- Deletes the caller's account. Every user table references auth.users with
-- on delete cascade, so profile, consents, answers, settings and the user's
-- data key go with it. Without the key, any encrypted copy left in backups
-- can no longer be read.
create or replace function public.delete_my_account()
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

  delete from auth.users where id = uid;
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
