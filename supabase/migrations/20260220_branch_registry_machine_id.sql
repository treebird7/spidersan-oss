-- Add machine_id columns to branch_registry for cross-machine registry sync (F1)
-- This enables spidersan registry-sync --push/--pull across machines.

ALTER TABLE branch_registry
    ADD COLUMN IF NOT EXISTS machine_id TEXT,
    ADD COLUMN IF NOT EXISTS machine_name TEXT,
    ADD COLUMN IF NOT EXISTS hostname TEXT,
    ADD COLUMN IF NOT EXISTS repo_name TEXT,
    ADD COLUMN IF NOT EXISTS repo_path TEXT;

-- Index for efficient cross-machine queries
CREATE INDEX IF NOT EXISTS idx_branch_registry_machine_id ON branch_registry(machine_id);
CREATE INDEX IF NOT EXISTS idx_branch_registry_repo_name ON branch_registry(repo_name);
