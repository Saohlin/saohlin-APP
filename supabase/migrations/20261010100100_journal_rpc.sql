-- Journal module (J2): the private journal. Everything the Deník screens need
-- that does not involve the AI.
--
-- App (authenticated): journal_home, journal_list, journal_days, journal_get,
--   journal_save, journal_save_message, journal_delete, journal_restore,
--   journal_search.
-- Sharing with CLAUDIA AI and the memory job come in the next migrations.
--
-- Rules, the same as the chat functions:
--   * every function acts on auth.uid() only; an id that is not the caller's
--     is NOT_FOUND, the same answer as an id that does not exist;
--   * text is decrypted and encrypted here and nowhere else;
--   * exceptions are for bad requests (NOT_AUTHENTICATED 42501,
--     CONSENT_REQUIRED 42501, INVALID_INPUT 22023, NOT_FOUND P0002). Limits and
--     edit conflicts are returned as data, { "kind": "limit" | "conflict" },
--     the way start_turn returns its limits;
--   * locks are taken in one order: the user's usage row, then the entry row.
--     No function here touches the job queue or the memory lock.
--
-- Call these with POST (supabase.rpc default). With { get: true } the
-- arguments, a search term included, would travel in the URL.

-- Internal helpers ---------------------------------------------------------------

create or replace function private.prague_today()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Europe/Prague')::date $$;
revoke all on function private.prague_today() from public, anon, authenticated;

-- Storing an entry is processing of special category data, so writing needs
-- that consent. Reading, exporting and deleting never do.
create or replace function private.journal_can_write(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.consents c
                 where c.user_id = p_user and c.kind = 'special_category' and c.withdrawn_at is null)
$$;
revoke all on function private.journal_can_write(uuid) from public, anon, authenticated;

-- One row of a list: never the body.
create or replace function private.journal_summary(p_dek text, e public.journal_entries)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', e.id,
    'entryDate', e.entry_date,
    'createdAt', e.created_at,
    'updatedAt', e.updated_at,
    'title', private.decrypt_with(p_dek, e.title_enc),
    'excerpt', private.decrypt_with(p_dek, e.excerpt_enc),
    'bodyChars', e.body_chars,
    'sharedWithAi', e.shared_with_ai,
    'source', e.source)
$$;
revoke all on function private.journal_summary(text, public.journal_entries) from public, anon, authenticated;

-- A whole entry. conversationId: the newest conversation it was shared into.
create or replace function private.journal_full(p_dek text, e public.journal_entries)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select private.journal_summary(p_dek, e) || jsonb_build_object(
    'body', private.decrypt_with(p_dek, e.body_enc),
    'version', e.version,
    'sharedAt', e.shared_at,
    'sourceMessageId', e.source_message_id,
    'guideId', e.guide_id,
    'deletedAt', e.deleted_at,
    'conversationId', (select c.id from public.conversations c
                       where c.journal_entry_id = e.id and c.user_id = e.user_id and c.cleared_at is null
                       order by c.started_at desc limit 1))
$$;
revoke all on function private.journal_full(text, public.journal_entries) from public, anon, authenticated;

-- Per-minute counter. Returns 0 and counts the call, or the seconds to wait.
-- p_bucket: 'write' or 'search'. Locks the user's usage row, like begin_turn.
create or replace function private.journal_rate(p_user uuid, p_bucket text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  s   public.usage_state%rowtype;
  lim int;
  win timestamptz;
  cnt int;
begin
  insert into public.usage_state (user_id) values (p_user) on conflict do nothing;
  select * into s from public.usage_state where user_id = p_user for update;

  if p_bucket = 'search' then
    lim := private.config_int('journal.searches_per_minute', 30);
    win := s.journal_search_window; cnt := s.journal_search_count;
  else
    lim := private.config_int('journal.writes_per_minute', 20);
    win := s.journal_minute_window; cnt := s.journal_minute_count;
  end if;

  if now() - win >= interval '1 minute' then
    win := now(); cnt := 0;
  end if;
  if cnt >= lim then
    return greatest(1, ceil(extract(epoch from (win + interval '1 minute' - now())))::int);
  end if;

  if p_bucket = 'search' then
    update public.usage_state set journal_search_window = win, journal_search_count = cnt + 1 where user_id = p_user;
  else
    update public.usage_state set journal_minute_window = win, journal_minute_count = cnt + 1 where user_id = p_user;
  end if;
  return 0;
end $$;
revoke all on function private.journal_rate(uuid, text) from public, anon, authenticated;

create or replace function private.journal_limit(p_code text, p_retry int default null)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object('kind', 'limit', 'code', p_code, 'retryAfterSeconds', p_retry))
$$;
revoke all on function private.journal_limit(text, int) from public, anon, authenticated;

-- The gate in front of every new entry: rate, entries today, entries in all.
-- Returns null when the entry may be created.
create or replace function private.journal_create_gate(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  wait     int;
  today    date := private.prague_today();
  midnight timestamptz := today::timestamp at time zone 'Europe/Prague';
begin
  wait := private.journal_rate(p_user, 'write');
  if wait > 0 then
    return private.journal_limit('RATE_LIMITED', wait);
  end if;

  if (select count(*) from public.journal_entries e where e.user_id = p_user and e.created_at >= midnight)
     >= private.config_int('journal.entries_per_day', 100) then
    return private.journal_limit('RATE_LIMITED',
      greatest(1, ceil(extract(epoch from (midnight + interval '1 day' - now())))::int));
  end if;

  if (select count(*) from public.journal_entries e where e.user_id = p_user and e.deleted_at is null)
     >= private.config_int('journal.entries_max', 5000) then
    return private.journal_limit('LIMIT_REACHED');
  end if;
  return null;
end $$;
revoke all on function private.journal_create_gate(uuid) from public, anon, authenticated;

-- First 160 characters on one line, for lists.
create or replace function private.journal_excerpt(p_body text)
returns text
language sql
immutable
set search_path = ''
as $$ select left(btrim(regexp_replace(p_body, '\s+', ' ', 'g')), 160) $$;
revoke all on function private.journal_excerpt(text) from public, anon, authenticated;

-- Reads --------------------------------------------------------------------------

-- The Deník screen in one call: this week's days, today, the newest four
-- entries and the total.
create or replace function public.journal_home()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid    uuid := private.require_uid();
  dek    text := private.user_dek(uid);
  today  date := private.prague_today();
  monday date := date_trunc('week', private.prague_today())::date;
begin
  return jsonb_build_object(
    'today', today,
    'weekStart', monday,
    'week', (
      select jsonb_agg(jsonb_build_object('date', d.day, 'count', coalesce(c.n, 0)) order by d.day)
      from (select (monday + i) as day from generate_series(0, 6) i) d
      left join (
        select e.entry_date, count(*)::int as n
        from public.journal_entries e
        where e.user_id = uid and e.deleted_at is null and e.entry_date between monday and monday + 6
        group by e.entry_date) c on c.entry_date = d.day),
    'todayCount', (select count(*)::int from public.journal_entries e
                   where e.user_id = uid and e.deleted_at is null and e.entry_date = today),
    'recent', coalesce((
      select jsonb_agg(private.journal_summary(dek, e) order by e.entry_date desc, e.created_at desc, e.id desc)
      from (select * from public.journal_entries
            where user_id = uid and deleted_at is null
            order by entry_date desc, created_at desc, id desc limit 4) e), '[]'),
    'total', (select count(*)::int from public.journal_entries e where e.user_id = uid and e.deleted_at is null));
end $$;

-- The archive, newest first. p_before is the nextCursor of the previous page
-- ({ date, createdAt, id }); page 50 costs the same as page 1.
create or replace function public.journal_list(p_before jsonb default null, p_limit int default 30,
                                               p_shared_only boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid    uuid := private.require_uid();
  dek    text;
  lim    int := least(greatest(coalesce(p_limit, 30), 1), 50);
  c_date date := 'infinity';
  c_at   timestamptz := 'infinity';
  c_id   uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  items  jsonb;
  next_cur jsonb;
begin
  if p_before is not null and jsonb_typeof(p_before) <> 'null' then
    begin
      c_date := (p_before ->> 'date')::date;
      c_at   := (p_before ->> 'createdAt')::timestamptz;
      c_id   := (p_before ->> 'id')::uuid;
    exception when others then
      raise exception 'INVALID_INPUT' using errcode = '22023';
    end;
    if jsonb_typeof(p_before) <> 'object' or c_date is null or c_at is null or c_id is null then
      raise exception 'INVALID_INPUT' using errcode = '22023';
    end if;
  end if;
  dek := private.user_dek(uid);

  with page as (
    select e.id, row_number() over (order by e.entry_date desc, e.created_at desc, e.id desc) as rn
    from public.journal_entries e
    where e.user_id = uid and e.deleted_at is null
      and (not coalesce(p_shared_only, false) or e.shared_with_ai)
      and (e.entry_date, e.created_at, e.id) < (c_date, c_at, c_id)
    order by e.entry_date desc, e.created_at desc, e.id desc
    limit lim + 1
  )
  select
    coalesce(jsonb_agg(private.journal_summary(dek, e) order by p.rn) filter (where p.rn <= lim), '[]'),
    (select jsonb_build_object('date', x.entry_date, 'createdAt', x.created_at, 'id', x.id)
     from page q join public.journal_entries x on x.id = q.id
     where q.rn = lim and exists (select 1 from page m where m.rn > lim))
  into items, next_cur
  from page p join public.journal_entries e on e.id = p.id;

  return jsonb_build_object('items', items, 'nextCursor', next_cur);
end $$;

-- Which days in a range have entries (the week strip on other weeks, a month view).
create or replace function public.journal_days(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := private.require_uid();
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('date', d.entry_date, 'count', d.n) order by d.entry_date)
    from (select e.entry_date, count(*)::int as n
          from public.journal_entries e
          where e.user_id = uid and e.deleted_at is null and e.entry_date between p_from and p_to
          group by e.entry_date) d), '[]');
end $$;

create or replace function public.journal_get(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  e   public.journal_entries%rowtype;
begin
  select * into e from public.journal_entries where id = p_id and user_id = uid and deleted_at is null;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return private.journal_full(private.user_dek(uid), e);
end $$;

-- Writes -------------------------------------------------------------------------

-- Create (p_id null) or edit an entry. Returns
--   { kind: 'ok', entry }        saved, or already saved with this client id
--   { kind: 'conflict', entry }  edited elsewhere since p_expected_version; nothing changed
--   { kind: 'limit', code, retryAfterSeconds? }
create or replace function public.journal_save(
  p_client_entry_id  uuid,
  p_body             text,
  p_title            text default null,
  p_entry_date       date default null,
  p_id               uuid default null,
  p_expected_version int default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid       uuid := private.require_uid();
  dek       text;
  e         public.journal_entries%rowtype;
  body      text := btrim(coalesce(p_body, ''), E' \t\n\r');
  title     text := nullif(btrim(coalesce(p_title, ''), E' \t\n\r'), '');
  today     date := private.prague_today();
  day       date := coalesce(p_entry_date, private.prague_today());
  max_body  int := least(private.config_int('journal.body_max_chars', 10000), 10000);
  max_title int := private.config_int('journal.title_max_chars', 120);
  gate      jsonb;
  wait      int;
begin
  if not private.journal_can_write(uid) then
    raise exception 'CONSENT_REQUIRED' using errcode = '42501';
  end if;
  if char_length(body) = 0 or char_length(body) > max_body
     or char_length(title) > max_title
     or title ~ '[\n\r]'
     or day < date '2020-01-01' or day > today + 1 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  dek := private.user_dek(uid);

  -- Create -------------------------------------------------------------------
  if p_id is null then
    if p_client_entry_id is null then
      raise exception 'INVALID_INPUT' using errcode = '22023';
    end if;
    -- A retry of a save whose answer was lost: the same entry, not counted again.
    select * into e from public.journal_entries where user_id = uid and client_entry_id = p_client_entry_id;
    if found then
      if e.deleted_at is not null then
        raise exception 'NOT_FOUND' using errcode = 'P0002';
      end if;
      return jsonb_build_object('kind', 'ok', 'entry', private.journal_full(dek, e));
    end if;

    gate := private.journal_create_gate(uid);
    if gate is not null then
      return gate;
    end if;

    insert into public.journal_entries
      (user_id, client_entry_id, entry_date, title_enc, excerpt_enc, body_enc, body_chars, source)
    values
      (uid, p_client_entry_id, day, private.encrypt_with(dek, title),
       private.encrypt_with(dek, private.journal_excerpt(body)), private.encrypt_with(dek, body),
       char_length(body), 'manual')
    on conflict (user_id, client_entry_id) do nothing
    returning * into e;
    if e.id is null then
      -- A parallel request with the same client id won the insert.
      select * into e from public.journal_entries where user_id = uid and client_entry_id = p_client_entry_id;
    end if;
    return jsonb_build_object('kind', 'ok', 'entry', private.journal_full(dek, e));
  end if;

  -- Edit ---------------------------------------------------------------------
  if p_expected_version is null then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  wait := private.journal_rate(uid, 'write');
  if wait > 0 then
    return private.journal_limit('RATE_LIMITED', wait);
  end if;

  select * into e from public.journal_entries
  where id = p_id and user_id = uid and deleted_at is null for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if e.version <> p_expected_version then
    return jsonb_build_object('kind', 'conflict', 'entry', private.journal_full(dek, e));
  end if;

  -- Saving without a change is not an edit: no new version, nothing re-indexed.
  if private.decrypt_with(dek, e.body_enc) = body
     and private.decrypt_with(dek, e.title_enc) is not distinct from title
     and e.entry_date = coalesce(p_entry_date, e.entry_date) then
    return jsonb_build_object('kind', 'ok', 'entry', private.journal_full(dek, e));
  end if;

  update public.journal_entries
  set title_enc   = private.encrypt_with(dek, title),
      excerpt_enc = private.encrypt_with(dek, private.journal_excerpt(body)),
      body_enc    = private.encrypt_with(dek, body),
      body_chars  = char_length(body),
      entry_date  = coalesce(p_entry_date, entry_date),
      version     = version + 1,
      updated_at  = clock_timestamp()
  where id = e.id
  returning * into e;
  return jsonb_build_object('kind', 'ok', 'entry', private.journal_full(dek, e));
end $$;

-- "Uložit do deníku": a message from the chat becomes an entry. The text is
-- read from the stored message, never sent by the app. Saving the same
-- message again returns the first entry.
create or replace function public.journal_save_message(p_message_id uuid, p_client_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := private.require_uid();
  dek  text;
  m    public.messages%rowtype;
  e    public.journal_entries%rowtype;
  body text;
  gate jsonb;
begin
  if not private.journal_can_write(uid) then
    raise exception 'CONSENT_REQUIRED' using errcode = '42501';
  end if;
  if p_message_id is null or p_client_entry_id is null then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  select msg.* into m
  from public.messages msg
  join public.conversations c on c.id = msg.conversation_id
  where msg.id = p_message_id and msg.user_id = uid and c.user_id = uid and c.cleared_at is null
    and msg.role in ('user', 'assistant') and msg.status = 'complete' and msg.content_enc is not null;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  dek := private.user_dek(uid);

  select * into e from public.journal_entries
  where user_id = uid and deleted_at is null
    and (source_message_id = m.id or client_entry_id = p_client_entry_id)
  order by (source_message_id = m.id) desc nulls last
  limit 1;
  if found then
    return jsonb_build_object('kind', 'ok', 'entry', private.journal_full(dek, e));
  end if;

  gate := private.journal_create_gate(uid);
  if gate is not null then
    return gate;
  end if;

  -- Replies are at most 8,000 characters and messages 4,000, so this fits.
  body := left(btrim(private.decrypt_with(dek, m.content_enc), E' \t\n\r'), 10000);
  if body is null or char_length(body) = 0 then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.journal_entries
    (user_id, client_entry_id, entry_date, excerpt_enc, body_enc, body_chars, source, source_message_id)
  values
    (uid, p_client_entry_id, private.prague_today(),
     private.encrypt_with(dek, private.journal_excerpt(body)), private.encrypt_with(dek, body),
     char_length(body), 'saved_message', m.id)
  on conflict do nothing
  returning * into e;
  if e.id is null then
    select * into e from public.journal_entries
    where user_id = uid and deleted_at is null
      and (source_message_id = m.id or client_entry_id = p_client_entry_id)
    order by (source_message_id = m.id) desc nulls last
    limit 1;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;
  return jsonb_build_object('kind', 'ok', 'entry', private.journal_full(dek, e));
end $$;

-- Hides the entry at once; it is hard-deleted after 24 h. A deleted entry is
-- never shared, so its memory rows go in this transaction (trigger).
create or replace function public.journal_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := private.require_uid();
  wait int;
  del_at timestamptz;
begin
  wait := private.journal_rate(uid, 'write');
  if wait > 0 then
    return private.journal_limit('RATE_LIMITED', wait);
  end if;
  update public.journal_entries
  set deleted_at = now(), shared_with_ai = false, shared_at = null
  where id = p_id and user_id = uid and deleted_at is null
  returning deleted_at into del_at;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  return jsonb_build_object('kind', 'ok', 'id', p_id, 'deletedAt', del_at);
end $$;

-- Undo within 24 h. The entry comes back private.
create or replace function public.journal_restore(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid   uuid := private.require_uid();
  dek   text;
  e     public.journal_entries%rowtype;
  twin  public.journal_entries%rowtype;
  wait  int;
begin
  wait := private.journal_rate(uid, 'write');
  if wait > 0 then
    return private.journal_limit('RATE_LIMITED', wait);
  end if;

  select * into e from public.journal_entries
  where id = p_id and user_id = uid and deleted_at > now() - interval '24 hours' for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  dek := private.user_dek(uid);

  -- The same message was saved again while this entry was deleted: that entry
  -- is the live one.
  if e.source_message_id is not null then
    select * into twin from public.journal_entries
    where user_id = uid and source_message_id = e.source_message_id and deleted_at is null;
    if found then
      return jsonb_build_object('kind', 'ok', 'entry', private.journal_full(dek, twin));
    end if;
  end if;

  update public.journal_entries set deleted_at = null where id = e.id returning * into e;
  return jsonb_build_object('kind', 'ok', 'entry', private.journal_full(dek, e));
end $$;

-- Search ------------------------------------------------------------------------

-- Text is encrypted, so nothing can be indexed: the newest
-- journal.search_scan_max entries of this user are decrypted here and matched
-- without diacritics ("denik" finds "deník"). Bounded per user; never crosses
-- users. Returns { kind: 'ok', items, scanned, total }; each item is a list
-- row plus `snippet`, the text around the first match.
create or replace function public.journal_search(p_query text, p_limit int default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid   uuid := private.require_uid();
  dek   text;
  raw   text := btrim(coalesce(p_query, ''));
  q     text;
  lim   int := least(greatest(coalesce(p_limit, 20), 1), 30);
  scan  int := least(greatest(private.config_int('journal.search_scan_max', 1000), 1), 5000);
  wait  int;
  items jsonb;
  seen  int;
begin
  if char_length(raw) < 2 or char_length(raw) > 80 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  q := public.f_unaccent(lower(raw));

  wait := private.journal_rate(uid, 'search');
  if wait > 0 then
    return private.journal_limit('RATE_LIMITED', wait);
  end if;
  dek := private.user_dek(uid);

  -- Each body is decrypted and normalised once. Line breaks become spaces with
  -- translate(), which keeps positions, so the snippet can be cut at the match.
  with newest as materialized (
    select n.id, n.entry_date, n.created_at, n.flat,
           strpos(public.f_unaccent(lower(n.flat)), q) as pos,
           strpos(public.f_unaccent(lower(n.title)), q) as title_pos
    from (
      select e.id, e.entry_date, e.created_at,
             translate(private.decrypt_with(dek, e.body_enc), E'\n\r\t', '   ') as flat,
             coalesce(private.decrypt_with(dek, e.title_enc), '') as title
      from public.journal_entries e
      where e.user_id = uid and e.deleted_at is null
      order by e.entry_date desc, e.created_at desc, e.id desc
      limit scan
    ) n
  ),
  hits as (
    select n.id, n.entry_date, n.created_at, n.flat, n.pos
    from newest n
    where n.pos > 0 or n.title_pos > 0
    order by n.entry_date desc, n.created_at desc, n.id desc
    limit lim
  )
  select
    coalesce((
      select jsonb_agg(
        private.journal_summary(dek, e) || jsonb_build_object('snippet',
          case when f.pos > 0
               then btrim(regexp_replace(substr(f.flat, greatest(f.pos - 40, 1), 160), '\s+', ' ', 'g')) end)
        order by f.entry_date desc, f.created_at desc, f.id desc)
      from hits f join public.journal_entries e on e.id = f.id), '[]'),
    (select count(*)::int from newest)
  into items, seen;

  return jsonb_build_object(
    'kind', 'ok', 'items', items, 'scanned', seen,
    'total', (select count(*)::int from public.journal_entries e where e.user_id = uid and e.deleted_at is null));
end $$;

-- Export (for the export-data function, service side) ------------------------------

-- Every entry of one user in full, the ones inside the 24 h delete window
-- included and marked.
create or replace function private.export_journal(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with k as (select private.user_dek(p_user) as dek)
  select coalesce(jsonb_agg(private.journal_full(k.dek, e) order by e.entry_date, e.created_at, e.id), '[]')
  from public.journal_entries e, k
  where e.user_id = p_user
$$;
revoke all on function private.export_journal(uuid) from public, anon, authenticated;

-- Grants ---------------------------------------------------------------------------

revoke all on function public.journal_home()                                       from public, anon;
revoke all on function public.journal_list(jsonb, int, boolean)                    from public, anon;
revoke all on function public.journal_days(date, date)                             from public, anon;
revoke all on function public.journal_get(uuid)                                    from public, anon;
revoke all on function public.journal_save(uuid, text, text, date, uuid, int)      from public, anon;
revoke all on function public.journal_save_message(uuid, uuid)                     from public, anon;
revoke all on function public.journal_delete(uuid)                                 from public, anon;
revoke all on function public.journal_restore(uuid)                                from public, anon;
revoke all on function public.journal_search(text, int)                            from public, anon;

grant execute on function public.journal_home()                                    to authenticated;
grant execute on function public.journal_list(jsonb, int, boolean)                 to authenticated;
grant execute on function public.journal_days(date, date)                          to authenticated;
grant execute on function public.journal_get(uuid)                                 to authenticated;
grant execute on function public.journal_save(uuid, text, text, date, uuid, int)   to authenticated;
grant execute on function public.journal_save_message(uuid, uuid)                  to authenticated;
grant execute on function public.journal_delete(uuid)                              to authenticated;
grant execute on function public.journal_restore(uuid)                             to authenticated;
grant execute on function public.journal_search(text, int)                         to authenticated;
