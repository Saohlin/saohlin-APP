-- Memory jobs on a schedule (SUPABASE_IMPLEMENTATION 21.2: "every minute:
-- process ops.jobs_queue").
--
-- Every minute the database (1) queues work for conversations that have gone
-- idle and (2) if anything is ready, wakes the `jobs` Edge Function. The
-- function is called with a shared secret, both kept in Vault:
--
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/jobs', 'jobs_function_url');
--   select vault.create_secret('<the same value as the JOBS_SECRET function secret>', 'jobs_secret');
--
-- Until both exist, or where pg_net / pg_cron are not installed (a plain local
-- Postgres), nothing is called and jobs simply wait in the queue.

-- Starts enough worker runs for the queue: one per 20 ready jobs, at most
-- memory.max_workers. Workers lease jobs, so extra runs are harmless.
create or replace function ops.kick_jobs()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  url     text;
  secret  text;
  ready   int;
  workers int;
begin
  if to_regnamespace('net') is null then return 0; end if;
  select count(*) into ready from (
    select 1 from ops.jobs_queue
    where done_at is null and run_after <= now()
      and (locked_at is null or locked_at < now() - interval '5 minutes')
    limit 400) q;
  if ready = 0 then return 0; end if;
  select decrypted_secret into url    from vault.decrypted_secrets where name = 'jobs_function_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'jobs_secret';
  if url is null or secret is null then return 0; end if;
  workers := least(ceil(ready / 20.0)::int, greatest(private.config_int('memory.max_workers', 8), 1));
  for i in 1..workers loop
    execute 'select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 5000)'
      using url, jsonb_build_object('Content-Type', 'application/json', 'x-jobs-secret', secret), '{}'::jsonb;
  end loop;
  return workers;
end $$;
revoke all on function ops.kick_jobs() from public, anon, authenticated;

create or replace function ops.memory_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Up to 500 idle conversations a minute, in batches of 100.
  for i in 1..5 loop
    exit when public.enqueue_idle_memory(100) < 100;
  end loop;
  -- A problem waking the worker must not undo the sweep above.
  begin
    perform ops.kick_jobs();
  exception when others then
    raise warning 'memory_tick: kick failed (%)', sqlstate;
  end;
end $$;
revoke all on function ops.memory_tick() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname in ('saohlin-memory-tick', 'saohlin-purge-jobs');
    perform cron.schedule('saohlin-memory-tick', '* * * * *', 'select ops.memory_tick()');
    perform cron.schedule('saohlin-purge-jobs', '40 3 * * *', 'select public.purge_jobs()');
    -- pg_cron's own run log grows by 1,440 rows a day from the tick.
    perform cron.unschedule(jobid) from cron.job where jobname = 'saohlin-purge-cron-log';
    perform cron.schedule('saohlin-purge-cron-log', '50 3 * * *',
      $q$delete from cron.job_run_details where end_time < now() - interval '3 days'$q$);
  else
    raise notice 'pg_cron not available: memory jobs are not scheduled here';
  end if;
end $$;
