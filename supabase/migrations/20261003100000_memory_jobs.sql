-- Chat module (C7): memory. The write side of layers 2-4.
--
-- The read side (turn_context, memory_search, get_memory, forget_note,
-- clear_memory) and the queue table have existed since C1. This adds the
-- functions the `jobs` worker uses to turn queued ids into a title, a summary,
-- notes and moments, plus the sweep that notices a conversation has gone idle.
--
-- Built for many workers and many users:
--   * jobs are claimed with FOR UPDATE SKIP LOCKED, so workers never collide;
--   * a claim is a lease: a crashed worker's job is picked up again after
--     five minutes, and given up on after memory.job_max_attempts;
--   * every write happens in one transaction that first re-checks the job is
--     still wanted, so "forget" and "clear" always win over a running job;
--   * a lease carries a token, so a worker whose lease ran out cannot touch a
--     job another worker has since picked up;
--   * memory writes, "forget", "clear" and a consent withdrawal for the same
--     user take one per-user lock, so they happen one after another;
--   * notes are built only from messages the job has not seen yet, so the cost
--     of a job does not grow with the relationship (G3.9) and a note the user
--     deleted is not re-learned from old messages.

insert into public.app_config (key, value, description, public) values
  ('memory.idle_minutes',          '30',  'Minutes without a message before a conversation is treated as finished for now', false),
  ('memory.job_max_messages',      '120', 'Most recent messages a summary, notes or moments job reads',                       false),
  ('memory.job_max_attempts',      '5',   'Tries before a memory job is given up on',                                         false),
  ('memory.moments_min_exchanges', '3',   'Shortest conversation that can produce moments',                                   false),
  ('memory.moments_per_conversation', '3', 'Most moments kept per conversation',                                             false)
on conflict (key) do nothing;
insert into public.app_config (key, value, description, public) values
  ('memory.max_workers', '8', 'Most worker runs started in one minute when the queue is long', false)
on conflict (key) do nothing;

-- The token a worker gets with its lease. Only the holder of the current
-- token may read, save or release the job.
alter table ops.jobs_queue add column if not exists lease uuid;

-- Account deletion and housekeeping must not scan the whole queue.
create index if not exists jobs_queue_user_idx on ops.jobs_queue (user_id);
create index if not exists jobs_queue_done_idx on ops.jobs_queue (done_at) where done_at is not null;
create index if not exists memory_embeddings_source_idx on public.memory_embeddings (source_id);

-- How far memory work has got in each conversation.
alter table public.conversations
  add column if not exists memory_swept_at  timestamptz,   -- last_message_at the idle sweep has handled
  add column if not exists notes_through_at timestamptz;   -- newest message the notes job has read

-- Only conversations the sweep still has to look at are in this index.
create index if not exists conversations_idle_idx on public.conversations (last_message_at)
  where cleared_at is null and (memory_swept_at is null or memory_swept_at < last_message_at);

-- When the user last asked for something to be forgotten. Notes are never
-- learned from messages older than this.
create table if not exists public.memory_state (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  forgot_at timestamptz not null default clock_timestamp()
);
alter table public.memory_state enable row level security;
revoke all on public.memory_state from public, anon, authenticated;

-- Internal -----------------------------------------------------------------------

-- One lock per user for everything that writes or removes memory. Held to the
-- end of the transaction. The chat reply path never takes it.
create or replace function private.memory_lock(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('memory:' || p_user::text, 0))
$$;
revoke all on function private.memory_lock(uuid) from public, anon, authenticated;

create or replace function private.finish_job(p_job bigint, p_note text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update ops.jobs_queue set done_at = now(), locked_at = null, lease = null, last_error = p_note where id = p_job
$$;
revoke all on function private.finish_job(bigint, text) from public, anon, authenticated;

-- The conversation's own messages, oldest first, newest N only.
create or replace function private.job_messages(
  p_user uuid, p_dek text, p_conversation uuid, p_after timestamptz default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with m as (
    select m.id, m.role, m.created_at, left(private.decrypt_with(p_dek, m.content_enc), 2000) as text
    from public.messages m
    where m.conversation_id = p_conversation and m.user_id = p_user
      and m.role in ('user', 'assistant') and m.status = 'complete'
      and (p_after is null or m.created_at > p_after)
    order by m.created_at desc
    limit private.config_int('memory.job_max_messages', 120)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'role', role, 'at', created_at, 'text', text)
                            order by created_at), '[]')
  from m
$$;
revoke all on function private.job_messages(uuid, text, uuid, timestamptz) from public, anon, authenticated;

-- Worker functions (service_role only) ---------------------------------------------

-- Lease up to p_limit ready jobs. Safe to call from any number of workers.
create or replace function public.claim_jobs(p_limit int default 10)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_attempts int := private.config_int('memory.job_max_attempts', 5);
  claimed jsonb;
begin
  -- A job whose worker died on its last attempt.
  update ops.jobs_queue
  set done_at = now(), locked_at = null, lease = null, last_error = 'gave_up'
  where done_at is null and attempts >= max_attempts
    and (locked_at is null or locked_at < now() - interval '5 minutes');

  -- Work nobody could do for three days (a long provider outage) is dropped.
  update ops.jobs_queue
  set done_at = now(), locked_at = null, lease = null, last_error = 'expired'
  where done_at is null and created_at < now() - interval '3 days'
    and (locked_at is null or locked_at < now() - interval '5 minutes');

  with picked as (
    select j.id
    from ops.jobs_queue j
    where j.done_at is null and j.run_after <= now() and j.attempts < max_attempts
      and (j.locked_at is null or j.locked_at < now() - interval '5 minutes')
    order by j.run_after
    for update skip locked
    limit least(greatest(coalesce(p_limit, 10), 1), 50)
  ),
  upd as (
    update ops.jobs_queue j
    set locked_at = now(), lease = gen_random_uuid(), attempts = j.attempts + 1
    from picked where j.id = picked.id
    returning j.id, j.kind, j.run_after, j.lease
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'lease', lease) order by run_after), '[]')
  into claimed from upd;
  return claimed;
end $$;

-- Everything one job needs to read, decrypted, in one call. Returns
-- {"skip": reason} and closes the job when there is nothing to do.
create or replace function public.job_context(p_job bigint, p_lease uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job    ops.jobs_queue%rowtype;
  conv   public.conversations%rowtype;
  dek    text;
  msgs   jsonb;
  after  timestamptz;
  last_id uuid;
  base   jsonb;
begin
  select * into job from ops.jobs_queue where id = p_job and done_at is null and lease = p_lease;
  if not found then
    return jsonb_build_object('skip', 'stale');
  end if;

  if not private.ai_allowed(job.user_id) then
    perform private.finish_job(p_job, 'consent');
    return jsonb_build_object('skip', 'consent');
  end if;

  select * into conv from public.conversations
  where id = (job.payload ->> 'conversation_id')::uuid and user_id = job.user_id and cleared_at is null;
  if not found then
    perform private.finish_job(p_job, 'gone');
    return jsonb_build_object('skip', 'gone');
  end if;

  dek := private.user_dek(job.user_id);
  base := jsonb_build_object('kind', job.kind, 'userId', job.user_id, 'conversationId', conv.id,
    'gender', (select p.gender from public.profiles p where p.user_id = job.user_id));

  if job.kind = 'title' then
    if conv.title_enc is not null then
      perform private.finish_job(p_job, 'has_title');
      return jsonb_build_object('skip', 'has_title');
    end if;
    msgs := private.job_messages(job.user_id, dek, conv.id);
    -- A title needs only the opening of the conversation.
    select coalesce(jsonb_agg(e order by o), '[]') into msgs
    from (select e, o from jsonb_array_elements(msgs) with ordinality as x(e, o) order by o limit 4) s;
    if jsonb_array_length(msgs) = 0 then
      perform private.finish_job(p_job, 'empty');
      return jsonb_build_object('skip', 'empty');
    end if;
    return base || jsonb_build_object('messages', msgs);
  end if;

  if job.kind = 'notes' then
    after := greatest(conv.notes_through_at,
                      (select s.forgot_at from public.memory_state s where s.user_id = job.user_id));
    msgs := private.job_messages(job.user_id, dek, conv.id, after);
    if not exists (select 1 from jsonb_array_elements(msgs) e where e ->> 'role' = 'user') then
      perform private.finish_job(p_job, 'current');
      return jsonb_build_object('skip', 'current');
    end if;
    return base || jsonb_build_object(
      'messages', msgs,
      'throughAt', (select max((e ->> 'at')::timestamptz) from jsonb_array_elements(msgs) e),
      'notes', coalesce((
        select jsonb_agg(jsonb_build_object('category', n.category, 'key', n.key,
                                            'content', private.decrypt_with(dek, n.content_enc))
                         order by n.category, n.key)
        from public.memory_notes n where n.user_id = job.user_id), '[]'));
  end if;

  -- summary and moments read the conversation itself (never an older summary).
  msgs := private.job_messages(job.user_id, dek, conv.id);
  if jsonb_array_length(msgs) = 0 then
    perform private.finish_job(p_job, 'empty');
    return jsonb_build_object('skip', 'empty');
  end if;
  last_id := (msgs -> -1 ->> 'id')::uuid;

  if job.kind = 'summary' then
    if exists (select 1 from public.conversation_summaries s
               where s.conversation_id = conv.id and s.through_message_id = last_id) then
      perform private.finish_job(p_job, 'current');
      return jsonb_build_object('skip', 'current');
    end if;
    return base || jsonb_build_object('messages', msgs, 'throughMessageId', last_id,
                                      'messageCount', jsonb_array_length(msgs));
  end if;

  if job.kind = 'moments' then
    if conv.exchange_count < private.config_int('memory.moments_min_exchanges', 3) then
      perform private.finish_job(p_job, 'short');
      return jsonb_build_object('skip', 'short');
    end if;
    return base || jsonb_build_object('messages', msgs, 'occurredAt', conv.last_message_at);
  end if;

  perform private.finish_job(p_job, 'unknown_kind');
  return jsonb_build_object('skip', 'unknown_kind');
end $$;

-- Store a job's result. One transaction: the job row is locked first, and
-- nothing is written if the user cleared memory, deleted the conversation or
-- withdrew consent while the job was running.
create or replace function public.save_job_result(p_job bigint, p_lease uuid, p_result jsonb,
                                                  p_calls jsonb default '[]')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  job   ops.jobs_queue%rowtype;
  conv  public.conversations%rowtype;
  dek   text;
  txt   text;
  n     jsonb;
  kept  int := 0;
  notes_max int := private.config_int('memory.notes_max', 40);
  owner uuid;
begin
  select user_id into owner from ops.jobs_queue where id = p_job;
  if not found then
    return 'stale';
  end if;
  -- Lock order everywhere: the user's memory lock, the job row, the conversation.
  perform private.memory_lock(owner);
  select * into job from ops.jobs_queue where id = p_job for update;
  -- The model calls were made and paid for whatever happens next.
  perform public.log_ai_calls(job.user_id, null, p_calls);
  if job.done_at is not null or job.lease is distinct from p_lease then
    return 'stale';
  end if;

  if not private.ai_allowed(job.user_id) then
    perform private.finish_job(p_job, 'consent');
    return 'stale';
  end if;

  select * into conv from public.conversations
  where id = (job.payload ->> 'conversation_id')::uuid and user_id = job.user_id and cleared_at is null
  for update;
  if not found then
    perform private.finish_job(p_job, 'gone');
    return 'stale';
  end if;

  dek := private.user_dek(job.user_id);

  if job.kind = 'title' then
    txt := left(nullif(btrim(p_result ->> 'title'), ''), 80);
    if txt is not null then
      -- Never over a title the user chose in the meantime.
      update public.conversations set title_enc = private.encrypt_with(dek, txt)
      where id = conv.id and title_enc is null;
    end if;

  elsif job.kind = 'summary' then
    txt := left(nullif(btrim(p_result ->> 'summary'), ''), 2500);
    if txt is not null
       and exists (select 1 from public.messages m
                   where m.id = (p_result ->> 'throughMessageId')::uuid and m.conversation_id = conv.id) then
      insert into public.conversation_summaries
        (conversation_id, user_id, summary_enc, through_message_id, source_message_count, model, updated_at)
      values (conv.id, job.user_id, private.encrypt_with(dek, txt), (p_result ->> 'throughMessageId')::uuid,
              coalesce((p_result ->> 'messageCount')::int, 0), coalesce(p_result ->> 'model', 'unknown'), now())
      on conflict (conversation_id) do update
        set summary_enc = excluded.summary_enc, through_message_id = excluded.through_message_id,
            source_message_count = excluded.source_message_count, model = excluded.model, updated_at = now();
    end if;

  elsif job.kind = 'notes' then
    -- The user forgot something while this job was reading: its input is no
    -- longer allowed, so nothing from it is kept.
    if exists (select 1 from public.memory_state s where s.user_id = job.user_id and s.forgot_at > job.locked_at) then
      perform private.finish_job(p_job, 'forgot');
      return 'stale';
    end if;

    delete from public.memory_notes d
    where d.user_id = job.user_id
      and d.key in (select jsonb_array_elements_text(coalesce(p_result -> 'remove', '[]')));

    for n in select * from jsonb_array_elements(coalesce(p_result -> 'upsert', '[]')) loop
      exit when kept >= notes_max;
      txt := nullif(btrim(n ->> 'content'), '');
      continue when txt is null or char_length(txt) > 400;
      continue when (n ->> 'key') is null or (n ->> 'key') !~ '^[a-z][a-z0-9_.]{0,39}$';
      continue when (n ->> 'category') is null
                 or (n ->> 'category') not in (select unnest(enum_range(null::public.memory_category))::text);
      insert into public.memory_notes (user_id, category, key, content_enc, confidence, source_message_id)
      values (job.user_id, (n ->> 'category')::public.memory_category, n ->> 'key',
              private.encrypt_with(dek, txt),
              least(greatest(coalesce((n ->> 'confidence')::real, 0.7), 0), 1), null)
      on conflict (user_id, key) do update
        set category = excluded.category, content_enc = excluded.content_enc,
            confidence = excluded.confidence, updated_at = now();
      kept := kept + 1;
    end loop;

    -- Hard cap per user: the least recently confirmed notes go first.
    delete from public.memory_notes d
    where d.user_id = job.user_id
      and d.id in (select x.id from public.memory_notes x where x.user_id = job.user_id
                   order by x.updated_at desc, x.id offset notes_max);

    update public.conversations
    set notes_through_at = greatest(notes_through_at, (p_result ->> 'throughAt')::timestamptz)
    where id = conv.id;

  elsif job.kind = 'moments' then
    -- A conversation's moments are replaced as a set, never appended to.
    delete from public.memory_embeddings e
    where e.user_id = job.user_id and e.source = 'conversation_insight' and e.source_id = conv.id;

    insert into public.memory_embeddings (user_id, source, source_id, content_enc, embedding, occurred_at)
    select job.user_id, 'conversation_insight', conv.id,
           private.encrypt_with(dek, left(btrim(m ->> 'content'), 1200)),
           (m ->> 'embedding')::extensions.vector(1024),
           coalesce((p_result ->> 'occurredAt')::timestamptz, conv.last_message_at)
    from jsonb_array_elements(coalesce(p_result -> 'moments', '[]')) with ordinality as x(m, o)
    where nullif(btrim(m ->> 'content'), '') is not null and (m -> 'embedding') is not null
      and o <= private.config_int('memory.moments_per_conversation', 3);
  end if;

  perform private.finish_job(p_job, null);
  return 'saved';
end $$;

-- A job that could not be done now. p_error is a code, never content.
--   p_count = true  (bad model output, database error): the try is used up;
--                   retried after 2, 4, 8, 16 minutes, then given up on.
--   p_count = false (the provider is down, rate limited or out of credit):
--                   not the job's fault, so the try is handed back and the job
--                   waits; it is dropped only if still undone after 3 days.
create or replace function public.fail_job(p_job bigint, p_lease uuid, p_error text,
                                           p_retry boolean default true, p_count boolean default true,
                                           p_calls jsonb default '[]')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  job ops.jobs_queue%rowtype;
  code text := left(regexp_replace(coalesce(p_error, 'unknown'), '[^A-Za-z0-9_.:-]', '', 'g'), 64);
begin
  select * into job from ops.jobs_queue where id = p_job for update;
  if not found then return; end if;
  perform public.log_ai_calls(job.user_id, null, p_calls);
  -- Someone else holds the job now, or it is finished: not ours to change.
  if job.done_at is not null or job.lease is distinct from p_lease then return; end if;
  if code = '' then code := 'unknown'; end if;

  if not p_retry then
    perform private.finish_job(p_job, code);
  elsif not p_count then
    update ops.jobs_queue
    set locked_at = null, lease = null, last_error = code, attempts = greatest(job.attempts - 1, 0),
        run_after = now() + interval '5 minutes'
    where id = p_job;
  elsif job.attempts < private.config_int('memory.job_max_attempts', 5) then
    update ops.jobs_queue
    set locked_at = null, lease = null, last_error = code,
        run_after = now() + make_interval(mins => (power(2, job.attempts))::int)
    where id = p_job;
  else
    perform private.finish_job(p_job, code);
  end if;
end $$;

-- Conversations with no message for memory.idle_minutes get a final summary,
-- a notes pass and their moments. Each conversation is handled once per burst
-- of activity. Small batches: the rows are locked only briefly, so a user who
-- comes back to one of these conversations is not kept waiting. Returns the
-- number of conversations handled; call again while it equals p_limit.
create or replace function public.enqueue_idle_memory(p_limit int default 100)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
  queued_n int;
begin
  with idle as (
    select c.id, c.user_id
    from public.conversations c
    where c.cleared_at is null
      and (c.memory_swept_at is null or c.memory_swept_at < c.last_message_at)
      and c.last_message_at < now() - make_interval(mins => private.config_int('memory.idle_minutes', 30))
    order by c.last_message_at
    for update skip locked
    limit least(greatest(coalesce(p_limit, 100), 1), 1000)
  ),
  swept as (
    update public.conversations c set memory_swept_at = c.last_message_at
    from idle where c.id = idle.id
    returning c.id, c.user_id, c.exchange_count
  ),
  queued as (
    insert into ops.jobs_queue (kind, user_id, payload)
    select k.kind, s.user_id, jsonb_build_object('conversation_id', s.id)
    from swept s cross join (values ('summary'), ('notes'), ('moments')) as k(kind)
    where s.exchange_count >= 1 and private.ai_allowed(s.user_id)
    on conflict do nothing
    returning 1
  )
  select (select count(*) from swept), (select count(*) from queued) into n, queued_n;
  return n;
end $$;

-- Housekeeping: finished jobs are kept a week for diagnosis, then removed.
create or replace function public.purge_jobs()
returns int
language sql
security definer
set search_path = ''
as $$
  with d as (delete from ops.jobs_queue where done_at < now() - interval '7 days' returning 1)
  select count(*)::int from d
$$;

-- Forget and clear: also remember WHEN, so old messages cannot teach it again ----

create or replace function public.forget_note(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := private.require_uid();
begin
  perform private.memory_lock(uid);
  delete from public.memory_notes where id = p_id and user_id = uid;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into public.memory_state (user_id, forgot_at) values (uid, clock_timestamp())
  on conflict (user_id) do update set forgot_at = clock_timestamp();
end $$;

create or replace function public.clear_memory()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := private.require_uid();
begin
  perform private.memory_lock(uid);
  insert into public.memory_state (user_id, forgot_at) values (uid, clock_timestamp())
  on conflict (user_id) do update set forgot_at = clock_timestamp();
  -- Conversations before the queue, the same order the reply path uses.
  update public.conversations set cleared_at = now() where user_id = uid and cleared_at is null;
  update ops.jobs_queue set done_at = now(), locked_at = null, lease = null, last_error = 'cleared'
  where user_id = uid and done_at is null and kind in ('summary', 'notes', 'moments', 'title');
  delete from public.memory_notes           where user_id = uid;
  delete from public.memory_embeddings      where user_id = uid;
  delete from public.conversation_summaries where user_id = uid;
  insert into ops.data_requests (user_id, kind, status, completed_at)
  values (uid, 'clear_memory', 'done', now());
end $$;

-- Withdrawing AI consent (or pausing AI processing) stops memory work at once:
-- open jobs are closed, and the per-user lock makes a job that is saving right
-- now finish first, so nothing is written after the withdrawal commits.
create or replace function private.stop_memory_jobs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.memory_lock(new.user_id);
  update ops.jobs_queue set done_at = now(), locked_at = null, lease = null, last_error = 'consent'
  where user_id = new.user_id and done_at is null;
  return new;
end $$;
revoke all on function private.stop_memory_jobs() from public, anon, authenticated;

drop trigger if exists consents_stop_memory_jobs on public.consents;
create trigger consents_stop_memory_jobs
  before update of withdrawn_at on public.consents
  for each row when (new.withdrawn_at is not null and old.withdrawn_at is null
                     and new.kind in ('ai_processing', 'special_category'))
  execute function private.stop_memory_jobs();

drop trigger if exists profiles_stop_memory_jobs on public.profiles;
create trigger profiles_stop_memory_jobs
  before update of ai_processing_paused_at on public.profiles
  for each row when (new.ai_processing_paused_at is not null and old.ai_processing_paused_at is null)
  execute function private.stop_memory_jobs();

-- Moments of a deleted conversation stop being found at once, not at the
-- nightly purge (and come back if the deletion is undone within 24 h).
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
      and not (m.source = 'conversation_insight' and exists (
        select 1 from public.conversations c where c.id = m.source_id and c.cleared_at is not null))
  ),
  k as (select private.user_dek(p_user) as dek)
  select mine.id, mine.source, private.decrypt_with(k.dek, mine.content_enc), mine.occurred_at, mine.similarity
  from mine, k
  where mine.similarity >= p_min_similarity
  order by mine.similarity desc
  limit least(greatest(p_limit, 0), 10)
$$;

-- Access ---------------------------------------------------------------------------

revoke all on function public.claim_jobs(int)                         from public, anon, authenticated;
revoke all on function public.job_context(bigint, uuid)                     from public, anon, authenticated;
revoke all on function public.save_job_result(bigint, uuid, jsonb, jsonb)   from public, anon, authenticated;
revoke all on function public.fail_job(bigint, uuid, text, boolean, boolean, jsonb)  from public, anon, authenticated;
revoke all on function public.enqueue_idle_memory(int)                from public, anon, authenticated;
revoke all on function public.purge_jobs()                            from public, anon, authenticated;
grant execute on function public.claim_jobs(int)                        to service_role;
grant execute on function public.job_context(bigint, uuid)                    to service_role;
grant execute on function public.save_job_result(bigint, uuid, jsonb, jsonb)  to service_role;
grant execute on function public.fail_job(bigint, uuid, text, boolean, boolean, jsonb) to service_role;
grant execute on function public.enqueue_idle_memory(int)               to service_role;
grant execute on function public.purge_jobs()                           to service_role;

revoke all on function public.forget_note(uuid) from public, anon;
revoke all on function public.clear_memory()    from public, anon;
grant execute on function public.forget_note(uuid) to authenticated;
grant execute on function public.clear_memory()    to authenticated;
revoke all on function public.memory_search(uuid, extensions.vector, int, real) from public, anon, authenticated;
grant execute on function public.memory_search(uuid, extensions.vector, int, real) to service_role;
