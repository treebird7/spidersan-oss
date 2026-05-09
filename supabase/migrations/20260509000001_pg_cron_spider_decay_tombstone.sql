-- 20260509000001_pg_cron_spider_decay_tombstone.sql
-- Schedules pg_cron jobs for the realtime apprenticeship weight registry:
--   • spider-decay-daily      — apply daily decay to non-confirmed patterns
--   • spider-tombstone-weekly — tombstone patterns inactive >30 days
--
-- Operationalises the manual block at the bottom of
--   20260504000000_realtime_apprenticeship.sql (lines 437–441)
-- which left these "uncomment if pg_cron enabled". Watsan owns the
-- weight manager (per migration §3 comments) — this is its launchd.
--
-- Spec:    walt-san/realism/PLAN_spidersan_realtime_apprenticeship.md
-- Author:  watsan-m5  (2026-05-09)
-- Depends: 20260504000000_realtime_apprenticeship.sql (function defs)
-- Targets: treebird-runtime (ruvwundetxnzesrbkdzr) — staging first
--          treebird-prod    (iopbbsjdphgctfbqljcf) — apply separately
--
-- ROLLBACK:
--   select cron.unschedule('spider-decay-daily');
--   select cron.unschedule('spider-tombstone-weekly');
--   -- (function comments revert with: comment on function ... is null)

-- ─── 0. Preconditions ────────────────────────────────────────────────────────
-- pg_cron must be enabled at the project level (Supabase dashboard →
-- Database → Extensions). This migration will not enable it for you,
-- because CREATE EXTENSION pg_cron requires superuser on Supabase and
-- typical migration roles can't grant it. Fail loudly if missing so the
-- operator knows to flip the dashboard switch before retrying.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception
      'pg_cron extension is not enabled on this database. '
      'Enable it via Supabase dashboard → Database → Extensions, then re-run this migration.';
  end if;
end;
$$;

-- ─── 1. Daily decay sweep ────────────────────────────────────────────────────
-- Runs at 03:00 UTC every day. Decays base_weight on patterns that have
-- not been confirmed in the last 1 day (function default).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'spider-decay-daily') then
    perform cron.unschedule('spider-decay-daily');
  end if;
end;
$$;

select cron.schedule(
  'spider-decay-daily',
  '0 3 * * *',
  $$select public.spider_apply_decay(1)$$
);

-- ─── 2. Weekly tombstone sweep ───────────────────────────────────────────────
-- Runs at 04:00 UTC every Sunday. Tombstones patterns whose
-- last_invoked_at is older than 30 days (function default).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'spider-tombstone-weekly') then
    perform cron.unschedule('spider-tombstone-weekly');
  end if;
end;
$$;

select cron.schedule(
  'spider-tombstone-weekly',
  '0 4 * * 0',
  $$select public.spider_tombstone_stale_patterns(30)$$
);

-- ─── 3. Verification (read-only, surfaces the schedule on apply) ─────────────
-- Apply-time SELECTs land in supabase migration logs; useful trail for
-- "yes the jobs registered" without a follow-up query.
do $$
declare
  decay_id     bigint;
  tombstone_id bigint;
begin
  select jobid into decay_id     from cron.job where jobname = 'spider-decay-daily';
  select jobid into tombstone_id from cron.job where jobname = 'spider-tombstone-weekly';
  if decay_id is null or tombstone_id is null then
    raise exception 'cron.schedule() returned, but jobs are missing from cron.job. Investigate.';
  end if;
  raise notice 'spider-decay-daily      jobid=% schedule="0 3 * * *"',     decay_id;
  raise notice 'spider-tombstone-weekly jobid=% schedule="0 4 * * 0"',     tombstone_id;
end;
$$;

-- ─── 4. Comments ─────────────────────────────────────────────────────────────
comment on function public.spider_apply_decay(int) is
  'Daily decay sweep over spider_pattern_weights. Scheduled by pg_cron job '
  '"spider-decay-daily" at 03:00 UTC (see 20260509000001_pg_cron_spider_decay_tombstone.sql).';

comment on function public.spider_tombstone_stale_patterns(int) is
  'Weekly tombstone sweep for inactive patterns. Scheduled by pg_cron job '
  '"spider-tombstone-weekly" at 04:00 UTC Sundays (see 20260509000001_pg_cron_spider_decay_tombstone.sql).';
