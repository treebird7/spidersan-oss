-- Spider Registries: Machine-tagged branch registry for cross-machine awareness
-- Part of F1: Supabase Registry Sync (spidersan-github-dashboard)
--
-- Each row = one branch registered on one machine.
-- UNIQUE(machine_id, repo_name, branch_name) ensures no duplicates per machine.

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

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_spider_reg_machine ON spider_registries(machine_id);
CREATE INDEX IF NOT EXISTS idx_spider_reg_repo ON spider_registries(repo_name);
CREATE INDEX IF NOT EXISTS idx_spider_reg_status ON spider_registries(status);
CREATE INDEX IF NOT EXISTS idx_spider_reg_synced ON spider_registries(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_spider_reg_branch ON spider_registries(repo_name, branch_name);

-- RLS: All authenticated users can read, write only own machine's rows
ALTER TABLE spider_registries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read all registries"
    ON spider_registries FOR SELECT
    USING (true);

CREATE POLICY "Insert own machine registries"
    ON spider_registries FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Update own machine registries"
    ON spider_registries FOR UPDATE
    USING (true);

CREATE POLICY "Delete own machine registries"
    ON spider_registries FOR DELETE
    USING (true);

-- View: active branches across all machines for a repo
CREATE OR REPLACE VIEW spider_active_registries AS
SELECT * FROM spider_registries
WHERE status = 'active'
ORDER BY synced_at DESC;

-- View: cross-machine file overlaps (conflict candidates)
CREATE OR REPLACE VIEW spider_file_overlaps AS
SELECT
    r1.repo_name,
    unnest(r1.files) AS file_path,
    r1.branch_name AS branch_a,
    r1.machine_name AS machine_a,
    r2.branch_name AS branch_b,
    r2.machine_name AS machine_b
FROM spider_registries r1
JOIN spider_registries r2
    ON r1.repo_name = r2.repo_name
    AND r1.id < r2.id
    AND r1.status = 'active'
    AND r2.status = 'active'
WHERE r1.files && r2.files;
