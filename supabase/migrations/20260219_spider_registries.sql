-- spider_registries — machine-tagged branch registry for cross-machine awareness.
-- Part of F1 (Supabase Registry Sync). Each row = one branch registered on one machine.
-- UNIQUE(machine_id, repo_name, branch_name) ensures no duplicates per machine.
--
-- DEPLOYMENT TARGET: treebird_runtime (ruvwundetxnzesrbkdzr) — the canonical home of the
--   whole spidersan table family (branch_registry, active/stale_branches, spider_activity_log,
--   spider_intents, spidersan_git_events). Config drift earlier created this table on the
--   vault project (dknahxavnrtaqlatflot) instead; it is being consolidated back onto runtime.
--   Vault teardown: 20260623_decommission_vault_spider_registries.sql (after the data move).
--
-- ROLLBACK:
--   DROP VIEW  IF EXISTS public.spider_file_overlaps;
--   DROP VIEW  IF EXISTS public.spider_active_registries;
--   DROP TABLE IF EXISTS public.spider_registries;

CREATE TABLE IF NOT EXISTS spider_registries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id TEXT NOT NULL,
    machine_name TEXT NOT NULL,
    hostname TEXT,
    repo_path TEXT,
    repo_name TEXT NOT NULL,
    branch_name TEXT NOT NULL,
    files TEXT[] DEFAULT '{}',
    agent TEXT,
    description TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned', 'merged')),
    last_commit_sha TEXT,
    last_commit_date TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(machine_id, repo_name, branch_name)
);

CREATE INDEX IF NOT EXISTS idx_spider_reg_machine ON spider_registries(machine_id);
CREATE INDEX IF NOT EXISTS idx_spider_reg_repo    ON spider_registries(repo_name);
CREATE INDEX IF NOT EXISTS idx_spider_reg_status  ON spider_registries(status);
CREATE INDEX IF NOT EXISTS idx_spider_reg_synced  ON spider_registries(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_spider_reg_branch  ON spider_registries(repo_name, branch_name);
-- GIN supports spider_file_overlaps' array-overlap (files && files) self-join.
CREATE INDEX IF NOT EXISTS idx_spider_reg_files   ON spider_registries USING GIN (files);

-- RLS — runtime is the PUBLIC project (the Toak app's anon key is publishable), and on a
-- shared project `authenticated` includes app end-users. So:
--   • service_role            → full access (registry-sync writes with the service key)
--   • authenticated + agent_id → read-only (fleet agents see cross-machine state; plain app
--     users carry no agent_id claim and are denied). Mirrors spider_activity_log/spider_intents.
--   • anon                    → no policy => denied.
ALTER TABLE spider_registries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages registries" ON spider_registries;
CREATE POLICY "Service role manages registries"
    ON spider_registries FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "Agents read registries" ON spider_registries;
CREATE POLICY "Agents read registries"
    ON spider_registries FOR SELECT
    TO authenticated
    USING ((current_setting('request.jwt.claims', true)::jsonb ->> 'agent_id') IS NOT NULL);

-- Views run under the CALLER's RLS (security_invoker) so they don't bypass the table RLS above.
CREATE OR REPLACE VIEW spider_active_registries
WITH (security_invoker = true) AS
SELECT * FROM spider_registries
WHERE status = 'active'
ORDER BY synced_at DESC;

CREATE OR REPLACE VIEW spider_file_overlaps
WITH (security_invoker = true) AS
SELECT
    r1.repo_name,
    unnest(r1.files) AS file_path,
    r1.branch_name  AS branch_a,
    r1.machine_name AS machine_a,
    r2.branch_name  AS branch_b,
    r2.machine_name AS machine_b
FROM spider_registries r1
JOIN spider_registries r2
    ON  r1.repo_name = r2.repo_name
    AND r1.id < r2.id
    AND r1.status = 'active'
    AND r2.status = 'active'
WHERE r1.files && r2.files;
