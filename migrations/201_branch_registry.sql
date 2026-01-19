-- Branch Registry for Spidersan
-- Migration: 001_branch_registry.sql

CREATE TABLE IF NOT EXISTS branch_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_name TEXT NOT NULL UNIQUE,
  created_by_session TEXT NOT NULL,
  created_by_agent TEXT NOT NULL,
  parent_branch TEXT DEFAULT 'main',
  
  -- Lifecycle
  state TEXT NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'pushed', 'pr_draft', 'pr_ready',
                     'approved', 'merged', 'abandoned', 'conflict')),
  
  -- Dependencies
  depends_on TEXT[],
  
  -- Conflict detection
  conflict_with TEXT[],
  last_conflict_check TIMESTAMPTZ,
  
  -- PR info
  pr_number INTEGER,
  pr_url TEXT,
  
  -- Metadata
  description TEXT,
  files_changed TEXT[],
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_branch_registry_name ON branch_registry(branch_name);
CREATE INDEX IF NOT EXISTS idx_branch_registry_state ON branch_registry(state);
CREATE INDEX IF NOT EXISTS idx_branch_registry_updated ON branch_registry(updated_at DESC);

-- Auto-update timestamp
CREATE OR REPLACE FUNCTION update_branch_registry_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

DROP TRIGGER IF EXISTS branch_registry_update_timestamp ON branch_registry;
CREATE TRIGGER branch_registry_update_timestamp
  BEFORE UPDATE ON branch_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_branch_registry_timestamp();

-- View: Active branches
CREATE OR REPLACE VIEW active_branches AS
SELECT *, 
  EXTRACT(EPOCH FROM (NOW() - updated_at)) / 86400 as days_since_update
FROM branch_registry
WHERE state NOT IN ('merged', 'abandoned')
ORDER BY updated_at DESC;

-- View: Stale branches (7+ days)
CREATE OR REPLACE VIEW stale_branches AS
SELECT * FROM active_branches
WHERE days_since_update > 7;

-- RLS (permissive for now - adjust as needed)
ALTER TABLE branch_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS branch_registry_all ON branch_registry
  FOR ALL
  USING (true)
  WITH CHECK (true);
