-- Field-level encryption for the most sensitive user data.
--
-- Each user gets a random data key, stored encrypted ("wrapped") with a master
-- key held in Supabase Vault. Deleting the user deletes their key, which leaves
-- any remaining ciphertext (for example in backups) unreadable.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'field_encryption_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'field_encryption_key',
      'Master key that wraps per-user data keys'
    );
  end if;
end $$;

create table private.user_keys (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  dek_wrapped bytea not null,
  created_at  timestamptz not null default now()
);
alter table private.user_keys enable row level security;
revoke all on private.user_keys from public, anon, authenticated;

create or replace function private.master_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'field_encryption_key'
$$;

-- Returns the user's data key, creating it on first use.
create or replace function private.user_dek(p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  wrapped bytea;
  dek text;
begin
  select dek_wrapped into wrapped from private.user_keys where user_id = p_user;
  if wrapped is null then
    dek := encode(extensions.gen_random_bytes(32), 'hex');
    insert into private.user_keys (user_id, dek_wrapped)
    values (p_user, extensions.pgp_sym_encrypt(dek, private.master_key(), 'cipher-algo=aes256'))
    on conflict (user_id) do nothing;
    select dek_wrapped into wrapped from private.user_keys where user_id = p_user;
  end if;
  return extensions.pgp_sym_decrypt(wrapped, private.master_key());
end $$;

create or replace function private.encrypt(p_user uuid, p_value text)
returns bytea
language sql
security definer
set search_path = ''
as $$
  select case
    when p_value is null or p_value = '' then null
    else extensions.pgp_sym_encrypt(p_value, private.user_dek(p_user), 'cipher-algo=aes256, s2k-mode=1')
  end
$$;

create or replace function private.decrypt(p_user uuid, p_value bytea)
returns text
language sql
security definer
set search_path = ''
as $$
  select case
    when p_value is null then null
    else extensions.pgp_sym_decrypt(p_value, private.user_dek(p_user))
  end
$$;

revoke all on function private.master_key() from public, anon, authenticated;
revoke all on function private.user_dek(uuid) from public, anon, authenticated;
revoke all on function private.encrypt(uuid, text) from public, anon, authenticated;
revoke all on function private.decrypt(uuid, bytea) from public, anon, authenticated;
