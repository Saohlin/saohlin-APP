-- Chat module (C1): functions.
--
-- App (authenticated): list_conversations, get_conversation, rename_conversation,
--   clear_conversation, restore_conversation, get_memory, forget_note, clear_memory.
-- Chat function only (service_role): begin_turn, start_turn, finish_turn,
--   fail_turn, log_ai_calls, memory_search, purge_expired.
-- Every app function acts on auth.uid() only. Every service function takes the
-- user id the chat function read from the verified token, never from a body.

-- Internal helpers ---------------------------------------------------------------

create or replace function private.require_uid()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  return uid;
end $$;

-- True when the user may have their messages processed by the AI.
create or replace function private.ai_allowed(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.user_id = p_user and p.ai_processing_paused_at is null)
     and exists (select 1 from public.consents c where c.user_id = p_user and c.kind = 'ai_processing' and c.withdrawn_at is null)
     and exists (select 1 from public.consents c where c.user_id = p_user and c.kind = 'special_category' and c.withdrawn_at is null)
$$;

create or replace function private.is_paid(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select e.active and (e.period_ends_at is null or e.period_ends_at > now())
    from public.entitlements e where e.user_id = p_user), false)
$$;

create or replace function private.trial_remaining(p_user uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0, private.config_int('trial.total_replies', 5)
                     - coalesce((select trial_used from public.usage_state where user_id = p_user), 0))
$$;

-- The conversation context the chat function needs to build a prompt, in one
-- read: memory layers 1-3, the raw window and the current message.
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
    'history', coalesce((select jsonb_agg(jsonb_build_object('role', role, 'mode', mode, 'text', text)
                                          order by created_at) from hist), '[]')
  )
$$;

revoke all on function private.require_uid() from public, anon, authenticated;
revoke all on function private.ai_allowed(uuid) from public, anon, authenticated;
revoke all on function private.is_paid(uuid) from public, anon, authenticated;
revoke all on function private.trial_remaining(uuid) from public, anon, authenticated;
revoke all on function private.turn_context(uuid, text, uuid, uuid) from public, anon, authenticated;

-- begin_turn: the gate --------------------------------------------------------------
-- Entitlement, trial, caps and rate, decided in one locked transaction BEFORE
-- any AI call. The trial reply is counted here, so cancelling, killing the app
-- or a provider error never gives it back.

create or replace function public.begin_turn(p_user uuid, p_message_ref uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s        public.usage_state%rowtype;
  trial    int := private.config_int('trial.total_replies', 5);
  daycap   int := private.config_int('limits.daily_soft_cap', 30);
  monthcap int := private.config_int('limits.monthly_allowance', 400);
  permin   int := private.config_int('limits.rate_per_minute', 6);
  today    date := (now() at time zone 'Europe/Prague')::date;
  paid     boolean := private.is_paid(p_user);
  degraded boolean := false;
begin
  insert into public.usage_state (user_id) values (p_user) on conflict do nothing;
  select * into s from public.usage_state where user_id = p_user for update;

  if s.day <> today then s.day := today; s.day_count := 0; end if;
  if s.month <> date_trunc('month', today)::date then
    s.month := date_trunc('month', today)::date; s.month_count := 0;
  end if;
  if now() - s.minute_window >= interval '1 minute' then
    s.minute_window := now(); s.minute_count := 0;
  end if;

  if s.minute_count >= permin then
    return jsonb_build_object('decision', 'rate_limited',
      'retryAfterSeconds', greatest(1, ceil(extract(epoch from (s.minute_window + interval '1 minute' - now())))::int));
  end if;

  if not paid then
    if s.trial_used >= trial then
      return jsonb_build_object('decision', 'paywall', 'paid', false, 'trialRemaining', 0);
    end if;
    s.trial_used := s.trial_used + 1;
    insert into public.usage_ledger (user_id, kind, message_id) values (p_user, 'trial_reply', p_message_ref);
  else
    if s.day_count >= daycap then
      return jsonb_build_object('decision', 'daily_cap', 'paid', true);
    end if;
    degraded := s.month_count >= monthcap;
    insert into public.usage_ledger (user_id, kind, message_id)
    values (p_user, case when degraded then 'reply_degraded' else 'reply' end::public.usage_kind, p_message_ref);
  end if;

  update public.usage_state set
    trial_used = s.trial_used, day = s.day, day_count = s.day_count + 1,
    month = s.month, month_count = s.month_count + 1,
    minute_window = s.minute_window, minute_count = s.minute_count + 1
  where user_id = p_user;

  return jsonb_build_object(
    'decision', case when degraded then 'allow_degraded' else 'allow' end,
    'paid', paid,
    'trialRemaining', case when paid then null else trial - s.trial_used end);
end $$;

-- start_turn: everything before the AI, in one round trip -----------------------------
--
-- Returns one of:
--   { kind: 'limit', code: PAYWALL | DAILY_CAP | AI_PAUSED | RATE_LIMITED, ... }
--   { kind: 'replay', ... reply }       the message was already answered: send it again, count nothing
--   { kind: 'turn', retry, ... context } generate a reply (retry = true: our earlier failure, not counted again)
-- Raises INVALID_INPUT (22023) or NOT_FOUND (P0002) for bad requests.

create or replace function public.start_turn(
  p_user              uuid,
  p_client_msg_id     uuid,
  p_text              text,
  p_conversation_id   uuid default null,
  p_input_method      public.input_method default 'text',
  p_resume_message_id uuid default null,
  p_origin            public.conversation_origin default 'chat'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  dek        text;
  msg        public.messages%rowtype;
  reply      public.messages%rowtype;
  conv_id    uuid;
  gate       jsonb;
  decision   text;
  counted    boolean := false;
  max_chars  int := private.config_int('limits.message_max_chars', 4000);
begin
  if p_user is null or p_client_msg_id is null then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  if not private.ai_allowed(p_user) then
    return jsonb_build_object('kind', 'limit', 'code', 'AI_PAUSED');
  end if;

  dek := private.user_dek(p_user);

  -- 1. Find the message this request is about: a held one to resume, one sent
  --    before with the same client id, or a new one.
  if p_resume_message_id is not null then
    select * into msg from public.messages
    where id = p_resume_message_id and user_id = p_user and role = 'user' for update;
    if not found then
      raise exception 'NOT_FOUND' using errcode = 'P0002';
    end if;
  else
    select * into msg from public.messages
    where user_id = p_user and client_msg_id = p_client_msg_id for update;
  end if;

  if msg.id is null then
    if p_text is null or char_length(btrim(p_text)) = 0 or char_length(p_text) > max_chars then
      raise exception 'INVALID_INPUT' using errcode = '22023';
    end if;

    if p_conversation_id is null then
      insert into public.conversations (user_id, origin) values (p_user, p_origin) returning id into conv_id;
    else
      select id into conv_id from public.conversations
      where id = p_conversation_id and user_id = p_user and cleared_at is null for update;
      if conv_id is null then
        raise exception 'NOT_FOUND' using errcode = 'P0002';
      end if;
    end if;

    insert into public.messages (conversation_id, user_id, role, content_enc, status, client_msg_id, input_method)
    values (conv_id, p_user, 'user', private.encrypt_with(dek, p_text), 'pending', p_client_msg_id,
            coalesce(p_input_method, 'text'))
    on conflict (user_id, client_msg_id) do nothing
    returning * into msg;

    if msg.id is null then
      -- A parallel request with the same client id won the insert. Treat this
      -- one as a retry of it.
      select * into msg from public.messages
      where user_id = p_user and client_msg_id = p_client_msg_id for update;
    else
      gate := public.begin_turn(p_user, msg.id);
      decision := gate ->> 'decision';
      counted := true;
    end if;
  end if;

  -- 2. Already answered: replay it.
  select * into reply from public.messages where reply_to = msg.id and role = 'assistant';
  if reply.id is not null then
    return jsonb_build_object(
      'kind', 'replay',
      'conversationId', msg.conversation_id,
      'userMessageId', msg.id,
      'assistantMessageId', reply.id,
      'mode', reply.mode,
      'reply', private.decrypt_with(dek, reply.content_enc),
      'trialRemaining', case when private.is_paid(p_user) then null else private.trial_remaining(p_user) end);
  end if;

  -- 3. A held message (paywall earlier) goes through the gate again.
  if not counted and msg.status = 'awaiting_entitlement' then
    gate := public.begin_turn(p_user, msg.id);
    decision := gate ->> 'decision';
    counted := true;
  end if;

  if counted and decision in ('rate_limited', 'daily_cap') then
    if msg.status = 'pending' then
      -- Not stored: the app keeps the text and can send it again later.
      delete from public.messages where id = msg.id;
      delete from public.conversations c
      where c.id = msg.conversation_id and c.exchange_count = 0
        and not exists (select 1 from public.messages m where m.conversation_id = c.id);
    end if;
    return jsonb_build_object('kind', 'limit',
      'code', case decision when 'rate_limited' then 'RATE_LIMITED' else 'DAILY_CAP' end,
      'retryAfterSeconds', gate -> 'retryAfterSeconds');
  end if;

  if counted and decision = 'paywall' then
    update public.messages set status = 'awaiting_entitlement' where id = msg.id;
    return jsonb_build_object('kind', 'limit', 'code', 'PAYWALL',
      'conversationId', msg.conversation_id, 'userMessageId', msg.id, 'trialRemaining', 0);
  end if;

  -- 4. Generate. A retry of our own failure is not counted again.
  update public.messages set status = 'pending' where id = msg.id and status <> 'pending';
  update public.conversations set last_message_at = now() where id = msg.conversation_id;

  return jsonb_build_object(
    'kind', 'turn',
    'retry', not counted,
    'conversationId', msg.conversation_id,
    'userMessageId', msg.id,
    'degraded', coalesce(decision = 'allow_degraded', false)
                or (not counted and exists (select 1 from public.usage_ledger l
                                            where l.message_id = msg.id and l.kind = 'reply_degraded')),
    'paid', private.is_paid(p_user),
    'trialRemaining', case when private.is_paid(p_user) then null else private.trial_remaining(p_user) end,
    'context', private.turn_context(p_user, dek, msg.conversation_id, msg.id));
end $$;

-- finish_turn: store the reply and its metadata ------------------------------------
--
-- p_meta: { model, plannerHow, understanding{}, tokensIn, tokensCached, tokensOut,
--           costEur, timings{}, hardFailures[], retried, degraded, crisisFlag }
-- p_retrievals: [{ collection, itemId, score, slot }]
-- p_crisis_card: also store a crisis-resources event after the reply.

create or replace function public.finish_turn(
  p_user            uuid,
  p_user_message_id uuid,
  p_reply           text,
  p_mode            public.response_mode,
  p_meta            jsonb default '{}',
  p_retrievals      jsonb default '[]',
  p_crisis_card     boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  dek      text;
  umsg     public.messages%rowtype;
  reply_id uuid;
  exchanges int;
  every    int := private.config_int('memory.summary_every', 10);
begin
  if p_reply is null or char_length(btrim(p_reply)) = 0 or char_length(p_reply) > 8000 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  select * into umsg from public.messages
  where id = p_user_message_id and user_id = p_user and role = 'user' for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  dek := private.user_dek(p_user);

  insert into public.messages (conversation_id, user_id, role, content_enc, status, mode, reply_to)
  values (umsg.conversation_id, p_user, 'assistant', private.encrypt_with(dek, p_reply), 'complete', p_mode, umsg.id)
  on conflict (reply_to) where role = 'assistant' do nothing
  returning id into reply_id;

  if reply_id is null then
    -- Already stored by an earlier attempt.
    select id into reply_id from public.messages where reply_to = umsg.id and role = 'assistant';
    return jsonb_build_object('assistantMessageId', reply_id, 'duplicate', true);
  end if;

  update public.messages set status = 'complete' where id = umsg.id;

  insert into public.message_meta (
    message_id, user_id, model, mode, planner_how, understanding, tokens_in, tokens_cached, tokens_out,
    cost_eur, timings, hard_failures, retried, degraded, crisis_flag)
  values (
    reply_id, p_user, coalesce(p_meta ->> 'model', 'unknown'), p_mode, p_meta ->> 'plannerHow',
    coalesce(p_meta -> 'understanding', '{}'),
    (p_meta ->> 'tokensIn')::int, (p_meta ->> 'tokensCached')::int, (p_meta ->> 'tokensOut')::int,
    (p_meta ->> 'costEur')::numeric, coalesce(p_meta -> 'timings', '{}'),
    coalesce((select array_agg(x) from jsonb_array_elements_text(p_meta -> 'hardFailures') x), '{}'),
    coalesce((p_meta ->> 'retried')::boolean, false),
    coalesce((p_meta ->> 'degraded')::boolean, false),
    coalesce((p_meta ->> 'crisisFlag')::boolean, false));

  insert into public.message_retrievals (message_id, user_id, collection, item_id, score, slot)
  select reply_id, p_user, r ->> 'collection', r ->> 'itemId', (r ->> 'score')::real, (r ->> 'slot')::smallint
  from jsonb_array_elements(coalesce(p_retrievals, '[]')) r
  on conflict do nothing;

  if p_crisis_card then
    insert into public.messages (conversation_id, user_id, role, status, event_kind)
    values (umsg.conversation_id, p_user, 'event', 'complete', 'crisis_resources');
  end if;

  update public.conversations
  set exchange_count = exchange_count + 1, last_message_at = now()
  where id = umsg.conversation_id
  returning exchange_count into exchanges;

  if exchanges = 2 then
    insert into ops.jobs_queue (kind, user_id, payload)
    values ('title', p_user, jsonb_build_object('conversation_id', umsg.conversation_id))
    on conflict do nothing;
  end if;
  if exchanges % every = 0 then
    insert into ops.jobs_queue (kind, user_id, payload)
    values ('summary', p_user, jsonb_build_object('conversation_id', umsg.conversation_id, 'through_message_id', reply_id)),
           ('notes',   p_user, jsonb_build_object('conversation_id', umsg.conversation_id, 'through_message_id', reply_id))
    on conflict do nothing;
  end if;

  return jsonb_build_object('assistantMessageId', reply_id, 'exchangeCount', exchanges);
end $$;

-- fail_turn: our side failed. The message stays, marked failed; retrying with
-- the same client id regenerates it without counting again.
create or replace function public.fail_turn(p_user uuid, p_user_message_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.messages set status = 'failed'
  where id = p_user_message_id and user_id = p_user and role = 'user' and status = 'pending'
$$;

-- Cost rows, content-free. p_calls: [{ purpose, model, tokensIn, tokensCached,
-- tokensOut, costEur, durationMs, ok, errorCode }]
create or replace function public.log_ai_calls(p_user uuid, p_message_id uuid, p_calls jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into ops.ai_calls (user_id, message_id, purpose, model, tokens_in, tokens_cached, tokens_out,
                            cost_eur, duration_ms, ok, error_code)
  select p_user, p_message_id, c ->> 'purpose', c ->> 'model',
         (c ->> 'tokensIn')::int, (c ->> 'tokensCached')::int, (c ->> 'tokensOut')::int,
         coalesce((c ->> 'costEur')::numeric, 0), (c ->> 'durationMs')::int,
         coalesce((c ->> 'ok')::boolean, false), c ->> 'errorCode'
  from jsonb_array_elements(coalesce(p_calls, '[]')) c
$$;

-- Layer 4 search. The user filter runs first, over the user's own rows only,
-- so another user's moments are never candidates.
create or replace function public.memory_search(
  p_user uuid, p_embedding extensions.vector, p_limit int default 3, p_min_similarity real default 0.35)
returns table (id uuid, source public.memory_source, content text, occurred_at timestamptz, similarity real)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as materialized (
    select m.id, m.source, m.content_enc, m.occurred_at,
           (1 - extensions.cosine_distance(m.embedding, p_embedding))::real as similarity
    from public.memory_embeddings m
    where m.user_id = p_user
  ),
  k as (select private.user_dek(p_user) as dek)
  select mine.id, mine.source, private.decrypt_with(k.dek, mine.content_enc), mine.occurred_at, mine.similarity
  from mine, k
  where mine.similarity >= p_min_similarity
  order by mine.similarity desc
  limit least(greatest(p_limit, 0), 10)
$$;

-- Nightly: hard-delete conversations cleared more than 24 h ago (with their
-- summaries and moments), and retrieval logs older than 90 days.
create or replace function public.purge_expired()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_conv int;
  n_ret  int;
begin
  delete from public.memory_embeddings e
  using public.conversations c
  where e.source = 'conversation_insight' and e.source_id = c.id
    and c.cleared_at < now() - interval '24 hours';

  delete from public.conversations where cleared_at < now() - interval '24 hours';
  get diagnostics n_conv = row_count;

  delete from public.message_retrievals where created_at < now() - interval '90 days';
  get diagnostics n_ret = row_count;

  return jsonb_build_object('conversations', n_conv, 'retrievals', n_ret);
end $$;

-- App functions ------------------------------------------------------------------

-- Conversation history, newest first, 30 per page.
create or replace function public.list_conversations(p_page int default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  dek text := private.user_dek(uid);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'title', private.decrypt_with(dek, c.title_enc),
      'origin', c.origin,
      'exchangeCount', c.exchange_count,
      'startedAt', c.started_at,
      'lastMessageAt', c.last_message_at) order by c.last_message_at desc)
    from (
      select * from public.conversations
      where user_id = uid and cleared_at is null
        and exists (select 1 from public.messages m where m.conversation_id = conversations.id)
      order by last_message_at desc
      offset greatest(coalesce(p_page, 0), 0) * 30 limit 30
    ) c), '[]');
end $$;

-- One conversation, a page of messages at a time (newest page first, returned
-- in reading order). p_before: load messages older than this timestamp.
create or replace function public.get_conversation(p_id uuid, p_before timestamptz default null, p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid  uuid := private.require_uid();
  dek  text;
  conv public.conversations%rowtype;
  lim  int := least(greatest(coalesce(p_limit, 50), 1), 100);
  page jsonb;
  more boolean;
begin
  select * into conv from public.conversations where id = p_id and user_id = uid and cleared_at is null;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  dek := private.user_dek(uid);

  with slice as (
    select m.* from public.messages m
    where m.conversation_id = p_id and m.user_id = uid
      and (p_before is null or m.created_at < p_before)
    order by m.created_at desc
    limit lim + 1
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'role', s.role,
      'content', private.decrypt_with(dek, s.content_enc),
      'status', s.status,
      'mode', s.mode,
      'clientMsgId', s.client_msg_id,
      'replyTo', s.reply_to,
      'eventKind', s.event_kind,
      'eventRef', s.event_ref,
      'createdAt', s.created_at) order by s.created_at) filter (where s.rn <= lim), '[]'),
    count(*) > lim
  into page, more
  from (select slice.*, row_number() over (order by slice.created_at desc) as rn from slice) s;

  return jsonb_build_object(
    'conversation', jsonb_build_object(
      'id', conv.id,
      'title', private.decrypt_with(dek, conv.title_enc),
      'origin', conv.origin,
      'exchangeCount', conv.exchange_count,
      'startedAt', conv.started_at,
      'lastMessageAt', conv.last_message_at),
    'messages', page,
    'hasMore', more);
end $$;

create or replace function public.rename_conversation(p_id uuid, p_title text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid   uuid := private.require_uid();
  title text := nullif(btrim(p_title), '');
begin
  if title is null or char_length(title) > 80 then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;
  update public.conversations set title_enc = private.encrypt(uid, title)
  where id = p_id and user_id = uid and cleared_at is null;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
end $$;

-- Hides the conversation at once; it is hard-deleted after 24 h.
create or replace function public.clear_conversation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := private.require_uid();
begin
  update public.conversations set cleared_at = now()
  where id = p_id and user_id = uid and cleared_at is null;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into ops.data_requests (user_id, kind, status, completed_at)
  values (uid, 'clear_conversation', 'done', now());
end $$;

-- Undo within 24 h.
create or replace function public.restore_conversation(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := private.require_uid();
begin
  update public.conversations set cleared_at = null
  where id = p_id and user_id = uid and cleared_at > now() - interval '24 hours';
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
end $$;

-- Screen 34, "What CLAUDIA AI remembers": notes (layer 3) and conversation
-- summaries (layer 2). The profile and four answers come from get_me.
create or replace function public.get_memory()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_uid();
  dek text := private.user_dek(uid);
begin
  return jsonb_build_object(
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', n.id, 'category', n.category, 'key', n.key,
        'content', private.decrypt_with(dek, n.content_enc), 'updatedAt', n.updated_at)
        order by n.category, n.updated_at desc)
      from public.memory_notes n where n.user_id = uid), '[]'),
    'conversations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', private.decrypt_with(dek, c.title_enc),
        'summary', private.decrypt_with(dek, s.summary_enc), 'updatedAt', s.updated_at)
        order by s.updated_at desc)
      from public.conversation_summaries s
      join public.conversations c on c.id = s.conversation_id
      where s.user_id = uid and c.cleared_at is null), '[]'),
    'momentsCount', (select count(*) from public.memory_embeddings where user_id = uid));
end $$;

create or replace function public.forget_note(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := private.require_uid();
begin
  delete from public.memory_notes where id = p_id and user_id = uid;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
end $$;

-- "Zapomenout všechno": notes, moments and summaries are deleted, past
-- conversations are hidden (and purged after 24 h). Profile and answers stay.
create or replace function public.clear_memory()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := private.require_uid();
begin
  delete from public.memory_notes           where user_id = uid;
  delete from public.memory_embeddings      where user_id = uid;
  delete from public.conversation_summaries where user_id = uid;
  update public.conversations set cleared_at = now() where user_id = uid and cleared_at is null;
  update ops.jobs_queue set done_at = now(), last_error = 'cleared'
  where user_id = uid and done_at is null and kind in ('summary', 'notes', 'moments', 'title');
  insert into ops.data_requests (user_id, kind, status, completed_at)
  values (uid, 'clear_memory', 'done', now());
end $$;

-- get_me: real membership and trial count ------------------------------------------

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
      'active',         private.is_paid(u.id),
      'plan',           e.plan,
      'periodEndsAt',   e.period_ends_at,
      'trialTotal',     private.config_int('trial.total_replies', 5),
      'trialRemaining', private.trial_remaining(u.id)
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
  left join public.entitlements e on e.user_id = u.id
  where u.id = auth.uid()
$$;

-- Grants ---------------------------------------------------------------------------

revoke all on function public.begin_turn(uuid, uuid) from public, anon, authenticated;
revoke all on function public.start_turn(uuid, uuid, text, uuid, public.input_method, uuid, public.conversation_origin) from public, anon, authenticated;
revoke all on function public.finish_turn(uuid, uuid, text, public.response_mode, jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public.fail_turn(uuid, uuid) from public, anon, authenticated;
revoke all on function public.log_ai_calls(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.memory_search(uuid, extensions.vector, int, real) from public, anon, authenticated;
revoke all on function public.purge_expired() from public, anon, authenticated;

grant execute on function public.begin_turn(uuid, uuid) to service_role;
grant execute on function public.start_turn(uuid, uuid, text, uuid, public.input_method, uuid, public.conversation_origin) to service_role;
grant execute on function public.finish_turn(uuid, uuid, text, public.response_mode, jsonb, jsonb, boolean) to service_role;
grant execute on function public.fail_turn(uuid, uuid) to service_role;
grant execute on function public.log_ai_calls(uuid, uuid, jsonb) to service_role;
grant execute on function public.memory_search(uuid, extensions.vector, int, real) to service_role;
grant execute on function public.purge_expired() to service_role;

revoke all on function public.list_conversations(int) from public, anon;
revoke all on function public.get_conversation(uuid, timestamptz, int) from public, anon;
revoke all on function public.rename_conversation(uuid, text) from public, anon;
revoke all on function public.clear_conversation(uuid) from public, anon;
revoke all on function public.restore_conversation(uuid) from public, anon;
revoke all on function public.get_memory() from public, anon;
revoke all on function public.forget_note(uuid) from public, anon;
revoke all on function public.clear_memory() from public, anon;

grant execute on function public.list_conversations(int) to authenticated;
grant execute on function public.get_conversation(uuid, timestamptz, int) to authenticated;
grant execute on function public.rename_conversation(uuid, text) to authenticated;
grant execute on function public.clear_conversation(uuid) to authenticated;
grant execute on function public.restore_conversation(uuid) to authenticated;
grant execute on function public.get_memory() to authenticated;
grant execute on function public.forget_note(uuid) to authenticated;
grant execute on function public.clear_memory() to authenticated;
