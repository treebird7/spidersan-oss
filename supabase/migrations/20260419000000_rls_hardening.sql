-- 20260419000000_rls_hardening.sql
-- Purpose: Fix 5 LIVE security issues found by mycsan sql-review (2026-04-19)
--
-- Findings addressed:
--   ❌ branch_registry:     FOR ALL USING (true) WITH CHECK (true) → per-op explicit
--   ❌ agent_messages:       FOR ALL USING (true) WITH CHECK (true) → service_role writes
--   ❌ watsan_doc_chunks:    DEFERRED — watsan RAG storage uses anon key for writes
--   ❌ watsan_indexed_files: DEFERRED — same as above
--   ❌ GRANT ALL on spidersan schema → revoked + default privileges revoked
--   ⚠️ spider_registries:   misleading policy names → renamed for clarity
--
-- DEFERRED items tracked in: treebird/agents/mycsan/knowledge/reviews/sql-review-log.md
-- Prerequisite for watsan lockdown: migrate watsan RAG storage to service_role key
--
-- CLI compatibility: spidersan CLI uses anon key via direct PostgREST.
--   - branch_registry: CLI reads + writes (POST/PATCH) — kept open per-op
--   - spider_registries: CLI reads + writes (POST upsert/PATCH) — kept open per-op
--   - agent_messages: CLI does NOT touch — safe to lock
--   - watsan tables: watsan CLI uses anon key for RAG writes — DEFERRED
--
-- ROLLBACK: see inline DROP/REVOKE statements; reverse with original migration policies


-- =============================================================================
-- 1. branch_registry — replace FOR ALL with explicit per-op
-- =============================================================================
-- Temporary mitigation: writes still open to anon (CLI requirement).
-- Real fix requires signed identity (JWT claims or edge function proxy).
-- Improvement: no DELETE, explicit per-op, no silent "all operations" grant.

DROP POLICY IF EXISTS "branch_registry_all" ON branch_registry;

CREATE POLICY "branch_registry_select"
    ON branch_registry FOR SELECT
    USING (true);

CREATE POLICY "branch_registry_insert"
    ON branch_registry FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

CREATE POLICY "branch_registry_update"
    ON branch_registry FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- No DELETE policy — CLI only PATCHes state to 'abandoned', never deletes rows.


-- =============================================================================
-- 2. agent_messages — lock writes to service_role
-- =============================================================================
-- CLI never touches this table (confirmed: no references in spidersan/src/).
-- Messages route through hub/toak, which uses service_role.
-- Reads stay open (agents need to poll their inbox).

DROP POLICY IF EXISTS "agent_messages_all" ON agent_messages;

CREATE POLICY "agent_messages_select"
    ON agent_messages FOR SELECT
    USING (true);

CREATE POLICY "agent_messages_service_write"
    ON agent_messages FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

REVOKE INSERT, UPDATE, DELETE ON agent_messages FROM anon, authenticated;


-- =============================================================================
-- 3. watsan_doc_chunks — DEFERRED
-- =============================================================================
-- Current state: FOR ALL USING (true) TO anon — data poisoning risk.
-- Cannot lock: watsan RAG storage (~/Dev/Watsan/src/rag/storage.ts) uses anon key.
-- TODO: migrate watsan to SUPABASE_SERVICE_ROLE_KEY for writes, then harden.
-- Tracked in sql-review-log.md as deferred finding.


-- =============================================================================
-- 4. watsan_indexed_files — DEFERRED
-- =============================================================================
-- Same as watsan_doc_chunks — anon key dependency in watsan client.


-- =============================================================================
-- 5. spider_registries — rename misleading policies
-- =============================================================================
-- Policies already per-op (good), but names say "own machine" with no actual
-- machine_id scoping. Rename for honest description.

DROP POLICY IF EXISTS "Anyone can read all registries" ON spider_registries;
DROP POLICY IF EXISTS "Insert own machine registries" ON spider_registries;
DROP POLICY IF EXISTS "Update own machine registries" ON spider_registries;
DROP POLICY IF EXISTS "Delete own machine registries" ON spider_registries;

CREATE POLICY "spider_registries_select"
    ON spider_registries FOR SELECT
    USING (true);

CREATE POLICY "spider_registries_insert"
    ON spider_registries FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

CREATE POLICY "spider_registries_update"
    ON spider_registries FOR UPDATE
    TO anon, authenticated
    USING (true)
    WITH CHECK (true);

-- No DELETE policy — CLI uses upsert (Prefer: resolution=merge-duplicates),
-- never deletes registries. Stale cleanup is a backend/service_role job.


-- =============================================================================
-- 6. Revoke GRANT ALL on spidersan schema
-- =============================================================================
-- Original setup.sql granted ALL on schema spidersan to anon/authenticated
-- plus DEFAULT PRIVILEGES for future objects. Revoke both.

REVOKE ALL ON ALL TABLES IN SCHEMA spidersan FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA spidersan FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA spidersan FROM anon, authenticated;

-- Revoke default privileges (setup.sql lines 16-23 granted these)
ALTER DEFAULT PRIVILEGES IN SCHEMA spidersan REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA spidersan REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA spidersan REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- Re-grant USAGE so qualified queries (spidersan.table_name) still resolve
GRANT USAGE ON SCHEMA spidersan TO anon, authenticated;
