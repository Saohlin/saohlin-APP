-- Journal module (J3): sharing an entry with CLAUDIA AI.
--
-- App (authenticated): journal_share, journal_unshare.
-- Changed: private.turn_context returns the shared entry of a journal_share
-- conversation. start_turn, begin_turn and finish_turn are not touched, and the
-- chat request gets no new field: the server finds the entry through the
-- conversation row, which only journal_share can create.
--
-- Sharing is the user's explicit act. It flips the flag and opens a
-- conversation; the reflection itself is an ordinary chat turn, counted like
-- any other. Nothing here calls a model or touches the job queue: the minute
-- sweep (next migration) notices the entry needs indexing.

-- Returns
--   { kind: 'ok', entry, conversationId }
--   { kind: 'limit', code: AI_PAUSED | PAYWALL | RATE_LIMITED, retryAfterSeconds? }
-- A refused share changes nothing.
create or replace function public.journal_share(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid      uuid := private.require_uid();
  dek      text;
  e        public.journal_entries%rowtype;
  conv_id  uuid;
  wait     int;
  midnight timestamptz := private.prague_today()::timestamp at time zone 'Europe/Prague';
begin
  wait := private.journal_rate(uid, 'write');
  if wait > 0 then
    return private.journal_limit('RATE_LIMITED', wait);
  end if;

  select * into e from public.journal_entries
  where id = p_id and user_id = uid and deleted_at is null for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Consent first, then the right to a reply: sharing is AI use, so it is
  -- not available past the paywall.
  if not private.ai_allowed(uid) then
    return private.journal_limit('AI_PAUSED');
  end if;
  if not private.is_paid(uid) and private.trial_remaining(uid) <= 0 then
    return private.journal_limit('PAYWALL');
  end if;
  dek := private.user_dek(uid);

  -- Already shared and its conversation still carries the entry: go back to it.
  if e.shared_with_ai then
    select c.id into conv_id from public.conversations c
    where c.journal_entry_id = e.id and c.user_id = uid and c.cleared_at is null
      and c.origin = 'journal_share'
      and c.exchange_count < private.config_int('journal.share_inject_exchanges', 10)
    order by c.started_at desc limit 1;
    if conv_id is not null then
      return jsonb_build_object('kind', 'ok', 'entry', private.journal_full(dek, e), 'conversationId', conv_id);
    end if;
  end if;

  if (select count(*) from public.conversations c
      where c.user_id = uid and c.origin = 'journal_share' and c.started_at >= midnight)
     >= private.config_int('journal.shares_per_day', 20) then
    return private.journal_limit('RATE_LIMITED',
      greatest(1, ceil(extract(epoch from (midnight + interval '1 day' - now())))::int));
  end if;

  if not e.shared_with_ai then
    -- clock_timestamp(), like updated_at: the sweep compares it with job times.
    update public.journal_entries set shared_with_ai = true, shared_at = clock_timestamp()
    where id = e.id returning * into e;
  end if;

  insert into public.conversations (user_id, origin, journal_entry_id)
  values (uid, 'journal_share', e.id) returning id into conv_id;
  insert into public.messages (conversation_id, user_id, role, status, event_kind, event_ref)
  values (conv_id, uid, 'event', 'complete', 'journal_shared', e.id);

  return jsonb_build_object('kind', 'ok', 'entry', private.journal_full(dek, e), 'conversationId', conv_id);
end $$;

-- Takes the entry back. Its memory rows go in this transaction (trigger) and
-- it is no longer put into any prompt. What CLAUDIA AI already said about it
-- stays in that conversation until the user deletes the conversation.
create or replace function public.journal_unshare(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid  uuid := private.require_uid();
  e    public.journal_entries%rowtype;
  wait int;
begin
  wait := private.journal_rate(uid, 'write');
  if wait > 0 then
    return private.journal_limit('RATE_LIMITED', wait);
  end if;
  select * into e from public.journal_entries
  where id = p_id and user_id = uid and deleted_at is null for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if e.shared_with_ai then
    update public.journal_entries set shared_with_ai = false, shared_at = null
    where id = e.id returning * into e;
  end if;
  return jsonb_build_object('kind', 'ok', 'entry', private.journal_full(private.user_dek(uid), e));
end $$;

revoke all on function public.journal_share(uuid)   from public, anon;
revoke all on function public.journal_unshare(uuid) from public, anon;
grant execute on function public.journal_share(uuid)   to authenticated;
grant execute on function public.journal_unshare(uuid) to authenticated;

-- "How many shares today" must not read every conversation of a heavy user.
create index conversations_journal_share_idx on public.conversations (user_id, started_at desc)
  where origin = 'journal_share';

-- turn_context, unchanged except for the added journalEntry.
create or replace function private.turn_context(p_user uuid, p_dek text, p_conversation uuid, p_message uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with cur as (
    select m.id, m.created_at, private.decrypt_with(p_dek, m.content_enc) as text, m.input_method
    from public.messages m where m.id = p_message and m.user_id = p_user
  ),
  conv as (
    select c.* from public.conversations c where c.id = p_conversation and c.user_id = p_user
  ),
  hist as (
    select m.role, m.mode, m.created_at, private.decrypt_with(p_dek, m.content_enc) as text
    from public.messages m, cur
    where m.conversation_id = p_conversation and m.user_id = p_user
      and m.role in ('user', 'assistant') and m.created_at < cur.created_at and m.id <> cur.id
      and m.status in ('complete', 'pending', 'failed')
    order by m.created_at desc
    limit private.config_int('memory.raw_window', 8)
  ),
  prev_user as (
    select private.decrypt_with(p_dek, m.content_enc) as text
    from public.messages m, cur
    where m.conversation_id = p_conversation and m.user_id = p_user and m.role = 'user'
      and m.created_at < cur.created_at and m.id <> cur.id
    order by m.created_at desc limit 1
  ),
  notes as (
    select n.category, n.key, private.decrypt_with(p_dek, n.content_enc) as content
    from public.memory_notes n where n.user_id = p_user
    order by n.updated_at desc
    limit private.config_int('memory.notes_max', 40)
  ),
  recent as (
    select c.id, c.last_message_at, private.decrypt_with(p_dek, c.title_enc) as title,
           private.decrypt_with(p_dek, s.summary_enc) as summary
    from public.conversations c
    join public.conversation_summaries s on s.conversation_id = c.id
    where c.user_id = p_user and c.cleared_at is null and c.id <> p_conversation
    order by c.last_message_at desc
    limit private.config_int('memory.recent_conversations', 3)
  )
  select jsonb_build_object(
    'message', (select text from cur),
    'inputMethod', (select input_method from cur),
    'previousUserText', (select text from prev_user),
    'conversation', (select jsonb_build_object(
        'id', conv.id, 'origin', conv.origin, 'exchangeCount', conv.exchange_count,
        'guideDrawId', conv.guide_draw_id, 'journalEntryId', conv.journal_entry_id) from conv),
    'priorModes', coalesce((
        select jsonb_agg(m.mode order by m.created_at)
        from public.messages m, cur
        where m.conversation_id = p_conversation and m.role = 'assistant' and m.created_at < cur.created_at), '[]'),
    'profile', (select jsonb_build_object(
        'displayName', p.display_name, 'vocative', p.vocative, 'gender', p.gender, 'zodiac', p.zodiac)
        from public.profiles p where p.user_id = p_user),
    'context', coalesce((select jsonb_strip_nulls(jsonb_build_object(
        'work',      private.decrypt_with(p_dek, x.work_enc),
        'situation', private.decrypt_with(p_dek, x.situation_enc),
        'blocking',  private.decrypt_with(p_dek, x.blocking_enc),
        'visions',   private.decrypt_with(p_dek, x.visions_enc)))
        from public.user_context x where x.user_id = p_user), '{}'),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('category', category, 'key', key, 'content', content)
                                        order by category, key) from notes), '[]'),
    'summary', (select private.decrypt_with(p_dek, s.summary_enc)
                from public.conversation_summaries s where s.conversation_id = p_conversation and s.user_id = p_user),
    'recentConversations', coalesce((select jsonb_agg(jsonb_build_object(
        'title', title, 'summary', summary, 'lastMessageAt', last_message_at) order by last_message_at desc)
        from recent), '[]'),
    -- Layer 1 goes stale: true when the four answers were last confirmed (or
    -- last asked about) longer ago than memory.profile_stale_days.
    'profileStale', coalesce((
        select private.config_int('memory.profile_stale_days', 90) > 0
           and coalesce(x.work_enc, x.situation_enc, x.blocking_enc, x.visions_enc) is not null
           and greatest(x.last_confirmed_at, x.recheck_asked_at)
               < now() - make_interval(days => private.config_int('memory.profile_stale_days', 90))
        from public.user_context x where x.user_id = p_user), false),
    -- The entry this conversation was opened on, while it is still shared and
    -- the conversation is young. Read here, from the database: the app never
    -- sends entry text to the chat function. Null in every other conversation.
    'journalEntry', (
        select jsonb_build_object(
          'id', j.id,
          'date', j.entry_date,
          'title', private.decrypt_with(p_dek, j.title_enc),
          'text', left(private.decrypt_with(p_dek, j.body_enc), private.config_int('journal.share_max_chars', 4000)),
          'truncated', j.body_chars > private.config_int('journal.share_max_chars', 4000))
        from conv
        join public.journal_entries j on j.id = conv.journal_entry_id
        where conv.origin = 'journal_share'
          and conv.exchange_count < private.config_int('journal.share_inject_exchanges', 10)
          and j.user_id = p_user and j.shared_with_ai and j.deleted_at is null),
    'history', coalesce((select jsonb_agg(jsonb_build_object('role', role, 'mode', mode, 'text', text)
                                          order by created_at) from hist), '[]')
  )
$$;

revoke all on function private.turn_context(uuid, text, uuid, uuid) from public, anon, authenticated;
