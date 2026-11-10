-- Card of the day: each user draws one card per day.
--
-- public.card_draws keeps one row per user per day. The day turns at midnight
--   Prague time, decided here and not by the phone's clock, so a second tap, a
--   second phone or a reinstall gets the same card back. The rows are also the
--   user's draw history and, later, the link from a drawn card to its chat.
-- card_today() returns today's draw (or null); draw_card() makes it. Both are
--   the only way in: signed-in users read their own rows and write none.
-- card_name is a copy, so the history keeps the name if a card is deleted.
-- The rows go with the account (on delete cascade from auth.users).

-- Table --------------------------------------------------------------------------

create table public.card_draws (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  card_id         uuid references public.cards (id) on delete set null,
  card_name       text not null check (char_length(card_name) between 1 and 60),
  draw_day        date not null,
  drawn_at        timestamptz not null default now(),
  -- Filled when the user asks CLAUDIA AI for a reading of this card.
  conversation_id uuid references public.conversations (id) on delete set null,
  constraint card_draws_one_per_day unique (user_id, draw_day)
);
create index card_draws_user_recent_idx on public.card_draws (user_id, drawn_at desc);

alter table public.card_draws enable row level security;
revoke all on public.card_draws from public, anon, authenticated, service_role;
grant select (id, card_id, card_name, draw_day, drawn_at, conversation_id) on public.card_draws to authenticated;

create policy card_draws_read_own on public.card_draws
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Helpers ------------------------------------------------------------------------

-- Today's date in Prague, where the day for drawing a card turns.
create or replace function private.card_day()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/Prague')::date
$$;

create or replace function private.card_draw_json(d public.card_draws, p_new boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id',        d.id,
    'cardId',    d.card_id,
    'cardName',  d.card_name,
    'drawDay',   d.draw_day,
    'drawnAt',   d.drawn_at,
    'isNew',     p_new)
$$;

revoke all on function private.card_day() from public, anon, authenticated;
revoke all on function private.card_draw_json(public.card_draws, boolean) from public, anon, authenticated;

-- App functions --------------------------------------------------------------------

-- Today's draw, or null when the user has not drawn yet today.
create or replace function public.card_today()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  d   public.card_draws;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  select * into d from public.card_draws where user_id = uid and draw_day = private.card_day();
  if not found then
    return null;
  end if;
  return private.card_draw_json(d, false);
end $$;

-- Draws a card for today. If the user already drew today, that draw comes back
-- unchanged (isNew false), whichever card was asked for. CARD_NOT_FOUND when
-- the card is not published.
create or replace function public.draw_card(p_card_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := auth.uid();
  day  date := private.card_day();
  d    public.card_draws;
  name text;
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  if p_card_id is null then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  select * into d from public.card_draws where user_id = uid and draw_day = day;
  if found then
    return private.card_draw_json(d, false);
  end if;

  select c.name into name from public.cards c where c.id = p_card_id and c.status = 'published';
  if not found then
    raise exception 'CARD_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.card_draws (user_id, card_id, card_name, draw_day)
  values (uid, p_card_id, name, day)
  on conflict on constraint card_draws_one_per_day do nothing
  returning * into d;

  -- Two taps at the same moment: the other one won, and its draw is today's.
  if d.id is null then
    select * into d from public.card_draws where user_id = uid and draw_day = day;
    return private.card_draw_json(d, false);
  end if;
  return private.card_draw_json(d, true);
end $$;

revoke all on function public.card_today() from public, anon;
revoke all on function public.draw_card(uuid) from public, anon;
grant execute on function public.card_today() to authenticated;
grant execute on function public.draw_card(uuid) to authenticated;
