-- L1 Activity Log for spidersan branch operations
-- Primary storage: Supabase (treebird-internal project)
-- Local fallback queue: ~/.spidersan/activity.jsonl (flushed by CLI)

CREATE TABLE IF NOT EXISTS public.spider_activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repo TEXT NOT NULL,
    branch TEXT,
    agent TEXT,
    machine TEXT,
    event TEXT NOT NULL CHECK (
        event IN (
            'register',
            'merge',
            'abandon',
            'conflict_detected',
            'sync',
            'cleanup',
            'ready_check_pass',
            'ready_check_fail',
            'session_start',
            'session_end'
        )
    ),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spider_activity_log_repo_branch
    ON public.spider_activity_log (repo, branch);

CREATE INDEX IF NOT EXISTS idx_spider_activity_log_agent
    ON public.spider_activity_log (agent);

CREATE INDEX IF NOT EXISTS idx_spider_activity_log_created_at
    ON public.spider_activity_log (created_at DESC);

ALTER TABLE public.spider_activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agents_read_all_activity" ON public.spider_activity_log;
CREATE POLICY "agents_read_all_activity"
    ON public.spider_activity_log
    FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "agents_write_own_activity" ON public.spider_activity_log;
CREATE POLICY "agents_write_own_activity"
    ON public.spider_activity_log
    FOR INSERT
    TO authenticated
    WITH CHECK (
        agent = (current_setting('request.jwt.claims', true)::jsonb ->> 'agent_id')
    );

GRANT SELECT, INSERT ON public.spider_activity_log TO authenticated;

-- One-year default retention helper. Schedule with pg_cron if desired.
CREATE OR REPLACE FUNCTION public.prune_spider_activity_log(retention INTERVAL DEFAULT INTERVAL '1 year')
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    removed_count INTEGER;
BEGIN
    DELETE FROM public.spider_activity_log
    WHERE created_at < NOW() - retention;

    GET DIAGNOSTICS removed_count = ROW_COUNT;
    RETURN removed_count;
END;
$$;
