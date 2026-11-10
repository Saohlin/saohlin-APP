-- Retention, on a schedule (Chat Module Spec, User rights and Retention):
-- a deleted conversation is hard-deleted after 24 hours, and retrieval logs
-- after 90 days. purge_expired() has existed since the chat schema; this runs
-- it every night at 03:10 UTC. pg_cron is available on Supabase; where it is
-- not installed (a plain local Postgres) the schedule is skipped.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'saohlin-purge-expired';
    perform cron.schedule('saohlin-purge-expired', '10 3 * * *', 'select public.purge_expired()');
  else
    raise notice 'pg_cron not available: purge_expired() is not scheduled here';
  end if;
end $$;
