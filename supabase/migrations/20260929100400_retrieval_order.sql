-- Pipeline port (C3): retrieve_all returns passages and exemplars in the
-- order the Python pipeline reads them (corpus file order), so ties and the
-- pinned PAUZA protocol come out identically. The largest guide budget of
-- any mode is 3 (KARTA), not 2.

create or replace function public.retrieve_all(
  p_user        uuid,
  q_embedding   extensions.vector,
  q_text        text,
  p_limits      jsonb default '{"knowledge": 6, "video": 2, "guide": 3, "realclient": 1}',
  p_guide       text default null,
  p_pinned      text[] default '{}',
  p_memory      int default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lexw real := coalesce((select (value #>> '{}')::real from public.app_config where key = 'retrieval.lexical_weight'), 0);
  unapproved boolean := coalesce((select (value #>> '{}')::boolean from public.app_config
                                  where key = 'retrieval.include_unapproved_exemplars'), false);
  result jsonb := '{}';
  coll text;
begin
  foreach coll in array array['knowledge', 'video', 'guide', 'realclient'] loop
    result := result || jsonb_build_object(coll, coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'score', s.score, 'topic', c.topic, 'guideName', c.guide_name,
        'text', c.text, 'wordCount', c.word_count, 'meta', c.meta) order by s.score desc, c.id)
      from kb.search_chunks(q_embedding, q_text, coll, coalesce((p_limits ->> coll)::int, 0),
                            case when coll = 'knowledge' then lexw else 0 end,
                            case when coll = 'guide' then p_guide end) s
      join kb.chunks c on c.id = s.id), '[]'));
  end loop;

  result := result || jsonb_build_object('pinned', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'topic', c.topic, 'text', c.text, 'wordCount', c.word_count, 'meta', c.meta)
      order by c.meta ->> 'order')
    from kb.chunks c
    where c.collection = 'knowledge' and not c.excluded
      and exists (select 1 from unnest(p_pinned) p where strpos(c.meta ->> 'source_file', p) > 0)), '[]'));

  result := result || jsonb_build_object('exemplars', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'bank', e.bank, 'situation', e.situation, 'claudiaResponse', e.claudia_response,
      'mode', e.mode, 'subtype', e.subtype, 'wordCount', e.word_count,
      'opensWithGreeting', e.opens_with_greeting,
      'score', case when q_embedding is null or e.embedding is null then null
                    else (1 - (e.embedding operator(extensions.<=>) q_embedding))::real end)
      order by case e.bank when 'phase01' then 0 when 'feedback_r1' then 1 else 2 end, e.meta ->> 'order', e.id)
    from kb.exemplars e
    where e.pair_type = 'turn_pair' and e.excluded_reason is null
      and (e.approved_by_claudia or unapproved)), '[]'));

  if p_memory > 0 and q_embedding is not null then
    result := result || jsonb_build_object('memory', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'source', m.source, 'content', m.content,
                                          'occurredAt', m.occurred_at, 'score', m.similarity)
                       order by m.similarity desc)
      from public.memory_search(p_user, q_embedding, p_memory) m), '[]'));
  else
    result := result || '{"memory": []}'::jsonb;
  end if;

  return result;
end $$;
