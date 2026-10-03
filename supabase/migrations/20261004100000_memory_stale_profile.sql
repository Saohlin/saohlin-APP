-- Chat module (C7), second part: the stale-profile check and an index.
--
-- Spec, memory layer 1: "stale facts: after 90 days it gently re-checks once".
-- The four onboarding answers carry last_confirmed_at (set whenever the user
-- saves them). When they are older than memory.profile_stale_days the turn
-- context says so, the prompt lets CLAUDIA AI ask once whether they still
-- hold, and the moment it has been given that chance is recorded here so it
-- is not offered again for another period. Set the config to 0 to turn it off.

insert into public.app_config (key, value, description, public) values
  ('memory.profile_stale_days', '90', 'Days after which the onboarding answers are gently re-checked once (0 = never)', false)
on conflict (key) do nothing;

alter table public.user_context add column if not exists recheck_asked_at timestamptz;

-- The nightly purge looks for cleared conversations; only those are indexed.
create index if not exists conversations_cleared_idx on public.conversations (cleared_at) where cleared_at is not null;

-- turn_context, unchanged except for the added profileStale flag.
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
    'history', coalesce((select jsonb_agg(jsonb_build_object('role', role, 'mode', mode, 'text', text)
                                          order by created_at) from hist), '[]')
  )
$$;

revoke all on function private.turn_context(uuid, text, uuid, uuid) from public, anon, authenticated;

-- Called by the chat function after a reply whose prompt carried the re-check.
create or replace function public.mark_profile_recheck(p_user uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.user_context set recheck_asked_at = now() where user_id = p_user
$$;
revoke all on function public.mark_profile_recheck(uuid) from public, anon, authenticated;
grant execute on function public.mark_profile_recheck(uuid) to service_role;
