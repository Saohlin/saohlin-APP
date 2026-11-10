-- Admin panel: SAOHLIN cards, managed from the admin web.
--
-- public.cards holds every card the app shows: name, keywords, quote, the
--   three panels (message, step, mantra), the detailed meaning for CLAUDIA AI,
--   the artwork's path in the card-art bucket, its place in the deck and
--   whether it is published. Signed-in app users read published cards only;
--   nobody but the admin functions below writes.
-- card-art: public storage bucket for the artwork. The admin Edge Function
--   uploads with signed upload URLs and removes files no card uses any more.
-- Every change writes one row to ops.admin_log (ids and counts, never text).

-- Table --------------------------------------------------------------------------

create table public.cards (
  id           uuid primary key default gen_random_uuid(),
  position     int not null check (position > 0),
  name         text not null check (char_length(name) between 1 and 60),
  keywords     text[] not null default '{}'
               check (cardinality(keywords) <= 5 and array_position(keywords, null) is null
                      and char_length(array_to_string(keywords, '')) <= 200),
  quote        text check (char_length(quote) <= 300),
  message      text check (char_length(message) <= 2000),
  step         text check (char_length(step) <= 3000),
  mantra       text check (char_length(mantra) <= 500),
  meaning      text check (char_length(meaning) <= 30000),
  art_path     text check (art_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$'),
  status       text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id) on delete set null,
  constraint cards_position_key unique (position) deferrable initially immediate,
  constraint cards_published_have_art check (status = 'draft' or art_path is not null)
);
alter table public.cards enable row level security;
revoke all on public.cards from public, anon, authenticated, service_role;
-- Column grant: the app reads what it shows. `meaning` (for CLAUDIA AI) and the
-- bookkeeping columns stay out; the chat reads meaning through a security
-- definer function on the server.
grant select (id, position, name, keywords, quote, message, step, mantra, art_path, status, updated_at)
  on public.cards to authenticated;

create policy cards_read_published on public.cards
  for select to authenticated
  using (status = 'published');

-- Artwork bucket (public read; 10 MB; PNG, JPEG, WebP) ------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-art', 'card-art', true, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Helpers ------------------------------------------------------------------------

create or replace function private.card_json(c public.cards, p_full boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id',          c.id,
    'position',    c.position,
    'name',        c.name,
    'keywords',    to_jsonb(c.keywords),
    'quote',       c.quote,
    'message',     c.message,
    'step',        c.step,
    'mantra',      c.mantra,
    'meaningLength', coalesce(char_length(c.meaning), 0),
    'artPath',     c.art_path,
    'status',      c.status,
    'publishedAt', c.published_at,
    'createdAt',   c.created_at,
    'updatedAt',   c.updated_at,
    'updatedBy',   (select u.email from auth.users u where u.id = c.updated_by))
  || case when p_full then jsonb_build_object('meaning', c.meaning) else '{}'::jsonb end
$$;

-- Trims a text field; empty becomes null.
create or replace function private.card_text(p jsonb, p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(p ->> p_key), '')
$$;

-- The art file is removable when no card points at it any more.
create or replace function private.card_art_unused(p_path text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_path is not null
               and not exists (select 1 from public.cards c where c.art_path = p_path)
              then p_path end
$$;

revoke all on function private.card_json(public.cards, boolean) from public, anon, authenticated;
revoke all on function private.card_text(jsonb, text) from public, anon, authenticated;
revoke all on function private.card_art_unused(text) from public, anon, authenticated;

-- Admin functions (service role only) ---------------------------------------------

-- All cards in deck order, without the long meaning text.
create or replace function public.admin_cards_list(p_admin uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin(p_admin);
  return jsonb_build_object(
    'items', coalesce((select jsonb_agg(private.card_json(c, false) order by c.position)
                       from public.cards c), '[]'::jsonb));
end $$;

-- One card in full, with its neighbours in the deck.
create or replace function public.admin_cards_get(p_admin uuid, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.cards;
begin
  perform private.require_admin(p_admin);
  select * into c from public.cards where id = p_id;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return private.card_json(c, true) || jsonb_build_object(
    'total',  (select count(*) from public.cards),
    'prevId', (select x.id from public.cards x where x.position < c.position order by x.position desc limit 1),
    'nextId', (select x.id from public.cards x where x.position > c.position order by x.position limit 1));
end $$;

-- Creates (p_id null) or updates a card. Fields missing from p_card are cleared,
-- except status, which stays as it is unless given.
create or replace function public.admin_cards_save(p_admin uuid, p_id uuid, p_card jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name     text := private.card_text(p_card, 'name');
  v_keywords text[];
  v_status   text := coalesce(p_card ->> 'status', null);
  c          public.cards;
begin
  perform private.require_admin(p_admin);

  if p_card is null or jsonb_typeof(p_card) <> 'object' or v_name is null then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  if p_card ? 'keywords' and jsonb_typeof(p_card -> 'keywords') <> 'array' then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  select coalesce(array_agg(btrim(k) order by o), '{}') into v_keywords
  from jsonb_array_elements_text(coalesce(p_card -> 'keywords', '[]')) with ordinality as e(k, o)
  where btrim(k) <> '';
  if cardinality(v_keywords) > 5 or exists (select 1 from unnest(v_keywords) k where char_length(k) > 40) then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  if v_status is not null and v_status not in ('draft', 'published') then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  if p_id is null then
    if v_status = 'published' then
      raise exception 'NO_ART' using errcode = 'P0001';
    end if;
    insert into public.cards (position, name, keywords, quote, message, step, mantra, meaning, updated_by)
    values ((select coalesce(max(position), 0) + 1 from public.cards),
            v_name, v_keywords,
            private.card_text(p_card, 'quote'), private.card_text(p_card, 'message'),
            private.card_text(p_card, 'step'), private.card_text(p_card, 'mantra'),
            private.card_text(p_card, 'meaning'), p_admin)
    returning * into c;
    perform private.admin_log(p_admin, 'cards.create', c.id::text, '{}'::jsonb);
  else
    select * into c from public.cards where id = p_id for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
    if coalesce(v_status, c.status) = 'published' and c.art_path is null then
      raise exception 'NO_ART' using errcode = 'P0001';
    end if;
    update public.cards set
      name = v_name, keywords = v_keywords,
      quote = private.card_text(p_card, 'quote'), message = private.card_text(p_card, 'message'),
      step = private.card_text(p_card, 'step'), mantra = private.card_text(p_card, 'mantra'),
      meaning = private.card_text(p_card, 'meaning'),
      status = coalesce(v_status, status),
      published_at = case when coalesce(v_status, status) = 'published'
                          then coalesce(published_at, now()) else null end,
      updated_at = now(), updated_by = p_admin
    where id = p_id
    returning * into c;
    perform private.admin_log(p_admin, 'cards.update', c.id::text,
      jsonb_build_object('status', c.status));
  end if;

  return private.card_json(c, true);
end $$;

-- Publishes or unpublishes several cards. Cards without artwork stay drafts.
create or replace function public.admin_cards_set_status(p_admin uuid, p_ids uuid[], p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_done int;
  skipped jsonb;
begin
  perform private.require_admin(p_admin);
  if p_status not in ('draft', 'published') or p_ids is null or cardinality(p_ids) = 0
     or cardinality(p_ids) > 500 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(c.id), '[]') into skipped
  from public.cards c
  where c.id = any (p_ids) and p_status = 'published' and c.art_path is null;

  update public.cards c set
    status = p_status,
    published_at = case when p_status = 'published' then coalesce(c.published_at, now()) else null end,
    updated_at = now(), updated_by = p_admin
  where c.id = any (p_ids) and c.status <> p_status
    and (p_status = 'draft' or c.art_path is not null);
  get diagnostics n_done = row_count;

  perform private.admin_log(p_admin, 'cards.status', null,
    jsonb_build_object('status', p_status, 'changed', n_done, 'skipped', jsonb_array_length(skipped)));
  return jsonb_build_object('changed', n_done, 'skippedNoArt', skipped);
end $$;

-- Sets the deck order. p_ids must list every card exactly once.
create or replace function public.admin_cards_reorder(p_admin uuid, p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin(p_admin);
  if p_ids is null
     or cardinality(p_ids) <> (select count(*) from public.cards)
     or cardinality(p_ids) <> (select count(distinct x) from unnest(p_ids) x)
     or exists (select 1 from unnest(p_ids) x where not exists (select 1 from public.cards c where c.id = x)) then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  set constraints public.cards_position_key deferred;
  update public.cards c set position = o.n, updated_at = now(), updated_by = p_admin
  from unnest(p_ids) with ordinality as o(id, n)
  where c.id = o.id and c.position <> o.n;
  set constraints public.cards_position_key immediate;

  perform private.admin_log(p_admin, 'cards.reorder', null,
    jsonb_build_object('count', cardinality(p_ids)));
  return public.admin_cards_list(p_admin);
end $$;

-- Copies a card as a draft at the end of the deck. The copy shares the artwork.
create or replace function public.admin_cards_duplicate(p_admin uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.cards;
begin
  perform private.require_admin(p_admin);
  insert into public.cards (position, name, keywords, quote, message, step, mantra, meaning, art_path, updated_by)
  select (select coalesce(max(position), 0) + 1 from public.cards),
         left(s.name, 51) || ' (kopie)', s.keywords, s.quote, s.message, s.step, s.mantra, s.meaning,
         s.art_path, p_admin
  from public.cards s where s.id = p_id
  returning * into c;
  if c.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  perform private.admin_log(p_admin, 'cards.duplicate', c.id::text,
    jsonb_build_object('from', p_id));
  return private.card_json(c, true);
end $$;

-- Deletes a card and closes the gap in the deck. Returns the artwork path to
-- remove from storage when no other card uses it.
create or replace function public.admin_cards_delete(p_admin uuid, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.cards;
begin
  perform private.require_admin(p_admin);
  delete from public.cards where id = p_id returning * into c;
  if c.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  set constraints public.cards_position_key deferred;
  update public.cards set position = position - 1 where position > c.position;
  set constraints public.cards_position_key immediate;

  perform private.admin_log(p_admin, 'cards.delete', c.id::text,
    jsonb_build_object('position', c.position));
  return jsonb_build_object('removeArt', private.card_art_unused(c.art_path));
end $$;

-- Points a card at newly uploaded artwork, or removes it (p_path null; drafts only).
-- The path must sit in the card's own folder. Returns the old file to remove.
create or replace function public.admin_cards_set_art(p_admin uuid, p_id uuid, p_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c   public.cards;
  old text;
begin
  perform private.require_admin(p_admin);
  if p_path is not null and (p_path not like p_id::text || '/%'
                             or p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg|webp)$') then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  select * into c from public.cards where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_path is null and c.status = 'published' then
    raise exception 'NO_ART' using errcode = 'P0001';
  end if;
  old := c.art_path;

  update public.cards set art_path = p_path, updated_at = now(), updated_by = p_admin
  where id = p_id returning * into c;

  perform private.admin_log(p_admin, 'cards.art', c.id::text,
    jsonb_build_object('removed', p_path is null));
  return jsonb_build_object('card', private.card_json(c, true),
                            'removeArt', case when old is distinct from p_path
                                              then private.card_art_unused(old) end);
end $$;

revoke all on function public.admin_cards_list(uuid) from public, anon, authenticated;
revoke all on function public.admin_cards_get(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_cards_save(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.admin_cards_set_status(uuid, uuid[], text) from public, anon, authenticated;
revoke all on function public.admin_cards_reorder(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.admin_cards_duplicate(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_cards_delete(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_cards_set_art(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_cards_list(uuid) to service_role;
grant execute on function public.admin_cards_get(uuid, uuid) to service_role;
grant execute on function public.admin_cards_save(uuid, uuid, jsonb) to service_role;
grant execute on function public.admin_cards_set_status(uuid, uuid[], text) to service_role;
grant execute on function public.admin_cards_reorder(uuid, uuid[]) to service_role;
grant execute on function public.admin_cards_duplicate(uuid, uuid) to service_role;
grant execute on function public.admin_cards_delete(uuid, uuid) to service_role;
grant execute on function public.admin_cards_set_art(uuid, uuid, text) to service_role;
