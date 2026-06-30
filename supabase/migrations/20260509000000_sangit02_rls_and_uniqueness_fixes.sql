-- ============================================================
-- Spidersan Real-Time Apprenticeship — sql-review fixes
-- Migration: 20260509000000_sangit02_rls_and_uniqueness_fixes
-- Author:    mycsan-m5
-- Target:    treebird-runtime (<runtime-project-ref>) — staging
--            treebird-prod    (iopbbsjdphgctfbqljcf) — prod (apply separately)
--
-- Fixes from /sql-review of 20260504000000_realtime_apprenticeship.sql:
--
--   ❌ [rls_correctness]  Split FOR ALL policies → per-operation policies
--                         (spider_pattern_weights, spider_agent_trust)
--   ⚠️ [query_review]     NULL uniqueness gap: UNIQUE(actor_machine, repo)
--                         doesn't prevent duplicate NULL-repo rows.
--                         Fix: two partial unique indexes + null-aware upsert.
--   ⚠️ [migration_safety] Add SET search_path = '' to trigger functions.
--
-- ROLLBACK:
--   -- Restore FOR ALL policies:
--   DROP POLICY IF EXISTS "spider_pattern_weights_insert_service" ON public.spider_pattern_weights;
--   DROP POLICY IF EXISTS "spider_pattern_weights_update_service" ON public.spider_pattern_weights;
--   DROP POLICY IF EXISTS "spider_pattern_weights_delete_service" ON public.spider_pattern_weights;
--   CREATE POLICY "service_role_write_patterns" ON public.spider_pattern_weights FOR ALL
--     TO authenticated USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
--   -- (same pattern for spider_agent_trust_* policies and service_role_write_trust)
--   -- Restore composite UNIQUE:
--   DROP INDEX IF EXISTS public.idx_sat_machine_repo_scoped;
--   DROP INDEX IF EXISTS public.idx_sat_machine_repo_global;
--   ALTER TABLE public.spider_agent_trust ADD CONSTRAINT spider_agent_trust_actor_machine_repo_key
--     UNIQUE (actor_machine, repo);
-- ============================================================

-- ─── 1. Split FOR ALL → per-op: spider_pattern_weights ───────────────────────

DROP POLICY IF EXISTS "service_role_write_patterns" ON public.spider_pattern_weights;

DROP POLICY IF EXISTS "spider_pattern_weights_insert_service" ON public.spider_pattern_weights;
CREATE POLICY "spider_pattern_weights_insert_service"
    ON public.spider_pattern_weights FOR INSERT
    TO authenticated
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "spider_pattern_weights_update_service" ON public.spider_pattern_weights;
CREATE POLICY "spider_pattern_weights_update_service"
    ON public.spider_pattern_weights FOR UPDATE
    TO authenticated
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "spider_pattern_weights_delete_service" ON public.spider_pattern_weights;
CREATE POLICY "spider_pattern_weights_delete_service"
    ON public.spider_pattern_weights FOR DELETE
    TO authenticated
    USING (auth.role() = 'service_role');

-- ─── 2. Split FOR ALL → per-op: spider_agent_trust ───────────────────────────

DROP POLICY IF EXISTS "service_role_write_trust" ON public.spider_agent_trust;

DROP POLICY IF EXISTS "spider_agent_trust_insert_service" ON public.spider_agent_trust;
CREATE POLICY "spider_agent_trust_insert_service"
    ON public.spider_agent_trust FOR INSERT
    TO authenticated
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "spider_agent_trust_update_service" ON public.spider_agent_trust;
CREATE POLICY "spider_agent_trust_update_service"
    ON public.spider_agent_trust FOR UPDATE
    TO authenticated
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "spider_agent_trust_delete_service" ON public.spider_agent_trust;
CREATE POLICY "spider_agent_trust_delete_service"
    ON public.spider_agent_trust FOR DELETE
    TO authenticated
    USING (auth.role() = 'service_role');

-- ─── 3. Fix NULL uniqueness gap on spider_agent_trust ────────────────────────
-- UNIQUE(actor_machine, repo) uses a B-tree constraint where NULL != NULL,
-- so two rows with repo=NULL are NOT considered duplicates.
-- ON CONFLICT (actor_machine, repo) silently skips the upsert for NULL repo.
-- Fix: replace with two partial unique indexes covering disjoint key spaces.

-- Drop the composite UNIQUE constraint (also drops its backing btree index)
ALTER TABLE public.spider_agent_trust
    DROP CONSTRAINT IF EXISTS spider_agent_trust_actor_machine_repo_key;

-- Drop the non-unique covering index from the original migration (now redundant)
DROP INDEX IF EXISTS public.idx_sat_machine_repo;

-- Partial index: repo-scoped trust rows (repo IS NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_sat_machine_repo_scoped
    ON public.spider_agent_trust (actor_machine, repo)
    WHERE repo IS NOT NULL;

-- Partial index: cross-repo universal trust rows (repo IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_sat_machine_repo_global
    ON public.spider_agent_trust (actor_machine)
    WHERE repo IS NULL;

-- ─── 4. Update spider_update_agent_trust — null-aware ON CONFLICT ────────────
-- The original single ON CONFLICT (actor_machine, repo) cannot target a partial
-- index. Branch on p_repo IS NULL to route to the correct conflict target.

CREATE OR REPLACE FUNCTION public.spider_update_agent_trust(
    p_actor_machine TEXT,
    p_repo          TEXT,
    p_was_correct   BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF p_repo IS NULL THEN
        -- Cross-repo universal trust row: conflict on the global partial index
        INSERT INTO public.spider_agent_trust
            (actor_machine, repo, confirmations_correct, confirmations_wrong)
        VALUES (
            p_actor_machine,
            NULL,
            CASE WHEN p_was_correct THEN 1 ELSE 0 END,
            CASE WHEN p_was_correct THEN 0 ELSE 1 END
        )
        ON CONFLICT (actor_machine) WHERE repo IS NULL DO UPDATE SET
            -- EXCLUDED holds the proposed INSERT values (0 or 1 per the CASE above)
            confirmations_correct = spider_agent_trust.confirmations_correct + EXCLUDED.confirmations_correct,
            confirmations_wrong   = spider_agent_trust.confirmations_wrong   + EXCLUDED.confirmations_wrong,
            updated_at = now();
    ELSE
        -- Repo-scoped trust row: conflict on the scoped partial index
        INSERT INTO public.spider_agent_trust
            (actor_machine, repo, confirmations_correct, confirmations_wrong)
        VALUES (
            p_actor_machine,
            p_repo,
            CASE WHEN p_was_correct THEN 1 ELSE 0 END,
            CASE WHEN p_was_correct THEN 0 ELSE 1 END
        )
        ON CONFLICT (actor_machine, repo) WHERE repo IS NOT NULL DO UPDATE SET
            confirmations_correct = spider_agent_trust.confirmations_correct + EXCLUDED.confirmations_correct,
            confirmations_wrong   = spider_agent_trust.confirmations_wrong   + EXCLUDED.confirmations_wrong,
            updated_at = now();
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.spider_update_agent_trust(TEXT, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.spider_update_agent_trust(TEXT, TEXT, BOOLEAN) TO service_role;

-- ─── 5. Add SET search_path to trigger functions ──────────────────────────────
-- Non-SECURITY DEFINER, but consistent search_path hardening prevents schema
-- injection if search_path is ever changed at session level.

CREATE OR REPLACE FUNCTION public.enforce_decision_hmac()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.hmac_signature IS NULL OR length(trim(NEW.hmac_signature)) = 0 THEN
        RAISE EXCEPTION
            'spider_decision_stream: hmac_signature is required. '
            'Compute HMAC-SHA256(decision_id || actor_session || git_action || command_line, session_key) before INSERT.';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_pattern_version_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.version != OLD.version + 1 THEN
        RAISE EXCEPTION
            'spider_pattern_weights: version conflict. '
            'Expected version=%, got %. Re-read the row and retry.',
            OLD.version + 1, NEW.version;
    END IF;
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_weight_ceiling()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.base_weight > 0.95 THEN
        RAISE EXCEPTION
            'spider_pattern_weights: base_weight cannot exceed 0.95 (ceiling per CRITICAL-2). '
            'Attempted: % for pattern_id=%', NEW.base_weight, NEW.pattern_id;
    END IF;
    RETURN NEW;
END;
$$;
