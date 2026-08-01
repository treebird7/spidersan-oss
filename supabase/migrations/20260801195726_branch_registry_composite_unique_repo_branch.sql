-- tb-31t4: branch_registry.branch_name global UNIQUE -> composite (repo_name, branch_name)
-- Applied to treebird-runtime (ruvwundetxnzesrbkdzr) 2026-08-01 as version 20260801195726.
-- Spec: treebird/agents/mycsan/migrations/pending/tb-31t4_branch_registry_composite_unique_2026-08-01.md
--
-- The fleet-wide OIDC auto-register rollout (2026-08-01, 11 repos) collided: the same
-- branch name pushed from 3 repos left one row (first writer wins) and two unregistered.
-- NULLS NOT DISTINCT keeps the 82 legacy NULL repo_name rows in one shared namespace
-- (exactly current behavior). No backfill.
--
-- Rollback: drop this constraint, re-add UNIQUE (branch_name). Only valid while no
-- cross-repo duplicate rows exist yet -- dedupe first if any have accumulated.

ALTER TABLE public.branch_registry
    DROP CONSTRAINT IF EXISTS branch_registry_branch_name_key;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.branch_registry'::regclass
          AND conname = 'branch_registry_repo_branch_key'
    ) THEN
        ALTER TABLE public.branch_registry
            ADD CONSTRAINT branch_registry_repo_branch_key
            UNIQUE NULLS NOT DISTINCT (repo_name, branch_name);
    END IF;
END $$;
