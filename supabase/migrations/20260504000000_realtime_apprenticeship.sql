-- ============================================================
-- Spidersan Real-Time Apprenticeship — Decision Stream + Pattern Weights
-- Migration: 20260504000000_realtime_apprenticeship
-- Author:    mycsan-m2
-- Target:    treebird-runtime (ruvwundetxnzesrbkdzr) — staging
--            treebird-prod    (iopbbsjdphgctfbqljcf) — prod (apply separately)
--
-- Dream:     walt-san/dreams/DREAM_spidersan_realtime_apprenticeship.md
-- Plan:      walt-san/realism/PLAN_spidersan_realtime_apprenticeship.md
-- Audit:     walt-san/criticism/AUDIT_spidersan_realtime_apprenticeship.md
--
-- Covers:
--   • spider_decision_stream       — append-only git decision log
--   • spider_pattern_weights       — live pattern weight registry
--   • spider_pattern_corrections   — immutable correction audit
--   • spider_agent_trust           — per-machine trust scores
--   • RLS policies                 — stream integrity + agent isolation
--   • Triggers                     — HMAC gate, optimistic lock, ceiling guard
--   • Functions                    — decay, tombstone, trust update
--   • Indexes                      — query patterns from audit HIGH-5
-- ============================================================

-- ─── 1. Decision Stream ──────────────────────────────────────────────────────
-- Append-only log of every git decision.  No UPDATE/DELETE policies exist —
-- immutability is enforced at the RLS layer, not by convention.
-- HMAC-SHA256 of (decision_id || actor_session || git_action || command_line)
-- is required on every row (CRITICAL-1: stream poisoning).

CREATE TABLE IF NOT EXISTS public.spider_decision_stream (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    repo             TEXT        NOT NULL,
    actor_session    TEXT        NOT NULL,
    actor_machine    TEXT        NOT NULL,
    git_action       TEXT        NOT NULL CHECK (git_action IN (
                                     'merge', 'rebase', 'cherry-pick', 'reset', 'abandon'
                                 )),
    command_line     TEXT        NOT NULL CHECK (length(command_line) <= 500),
    -- Pre-state: branches, conflict tiers, spidersan prediction (nullable for day-1 cold start)
    context_snapshot JSONB       NOT NULL DEFAULT '{}',
    -- Decision: action_taken, rationale, agent_confidence, matches_prediction, explicit_tags
    decision_payload JSONB       NOT NULL DEFAULT '{}',
    -- Post-state: success, merged_commit, time_ms
    outcome_snapshot JSONB,
    -- Populated when agent overrides spidersan's prediction
    correction_payload JSONB,
    -- Session goal tags for context-aware weighting (mappersan angle 3)
    session_context_tags TEXT[]  NOT NULL DEFAULT '{}',
    -- HMAC-SHA256(decision_id || actor_session || git_action || command_line, actor_session_key)
    -- Set by application before INSERT; trigger blocks null (CRITICAL-1)
    hmac_signature   TEXT        NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.spider_decision_stream ENABLE ROW LEVEL SECURITY;

-- Authenticated agents: INSERT own decisions (any agent can log)
DROP POLICY IF EXISTS "agents_insert_own_decisions" ON public.spider_decision_stream;
CREATE POLICY "agents_insert_own_decisions"
    ON public.spider_decision_stream FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- All authenticated agents can read the full stream (cross-agent learning)
DROP POLICY IF EXISTS "agents_read_all_decisions" ON public.spider_decision_stream;
CREATE POLICY "agents_read_all_decisions"
    ON public.spider_decision_stream FOR SELECT
    TO authenticated
    USING (true);

-- Anonymous read for local tooling (CLI queries without session token)
DROP POLICY IF EXISTS "anon_read_decisions" ON public.spider_decision_stream;
CREATE POLICY "anon_read_decisions"
    ON public.spider_decision_stream FOR SELECT
    TO anon
    USING (true);

-- No UPDATE or DELETE policies — append-only is enforced by absence.

GRANT SELECT, INSERT ON public.spider_decision_stream TO authenticated, anon;

-- Indexes for HIGH-5 query patterns (git_action + time window + session)
CREATE INDEX IF NOT EXISTS idx_sds_repo_action_time
    ON public.spider_decision_stream (repo, git_action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sds_actor_session_time
    ON public.spider_decision_stream (actor_session, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sds_context_tags
    ON public.spider_decision_stream USING GIN (session_context_tags);
CREATE INDEX IF NOT EXISTS idx_sds_correction
    ON public.spider_decision_stream (id)
    WHERE correction_payload IS NOT NULL;

-- ─── 2. Pattern Weights ───────────────────────────────────────────────────────
-- Live weight registry.  Owned by the weight manager (watsan); agents read.
-- base_weight ceiling = 0.95 enforced as CHECK (CRITICAL-2 at DB layer).
-- Optimistic locking via `version` column prevents race conditions (MEDIUM-7).
-- `last_invoked_at` enables tombstoning dormant patterns (mappersan angle 4).

CREATE TABLE IF NOT EXISTS public.spider_pattern_weights (
    pattern_id            TEXT        PRIMARY KEY,
    name                  TEXT        NOT NULL,
    -- Weight ceiling 0.95 is a DB constraint, not application code (CRITICAL-2)
    base_weight           NUMERIC(4,3) NOT NULL DEFAULT 0.5
                              CHECK (base_weight >= 0.0 AND base_weight <= 0.95),
    recent_confirmations  INTEGER     NOT NULL DEFAULT 0,
    -- Nullable: per-repo weight fork; NULL = cross-repo universal
    repo_scope            TEXT,
    session_context_tags  TEXT[]      NOT NULL DEFAULT '{}',
    last_confirmed_at     TIMESTAMPTZ,
    -- Tombstone clock (mappersan angle 4): if now() - last_invoked_at > 30 days,
    -- spider_tombstone_stale_patterns() marks is_tombstoned = true
    last_invoked_at       TIMESTAMPTZ,
    decay_rate            NUMERIC(5,4) NOT NULL DEFAULT 0.99
                              CHECK (decay_rate > 0.0 AND decay_rate <= 1.0),
    is_tombstoned         BOOLEAN     NOT NULL DEFAULT false,
    tombstoned_at         TIMESTAMPTZ,
    -- Optimistic lock counter; increment on every UPDATE (MEDIUM-7)
    version               INTEGER     NOT NULL DEFAULT 0,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.spider_pattern_weights ENABLE ROW LEVEL SECURITY;

-- All agents can read the full pattern registry
DROP POLICY IF EXISTS "agents_read_patterns" ON public.spider_pattern_weights;
CREATE POLICY "agents_read_patterns"
    ON public.spider_pattern_weights FOR SELECT
    TO authenticated, anon
    USING (true);

-- Only service_role (weight manager / watsan) can mutate weights
DROP POLICY IF EXISTS "service_role_write_patterns" ON public.spider_pattern_weights;
CREATE POLICY "service_role_write_patterns"
    ON public.spider_pattern_weights FOR ALL
    TO authenticated
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

GRANT SELECT ON public.spider_pattern_weights TO authenticated, anon;
GRANT ALL ON public.spider_pattern_weights TO service_role;

CREATE INDEX IF NOT EXISTS idx_spw_repo_scope
    ON public.spider_pattern_weights (repo_scope)
    WHERE repo_scope IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spw_tombstone_check
    ON public.spider_pattern_weights (last_invoked_at)
    WHERE is_tombstoned = false;
CREATE INDEX IF NOT EXISTS idx_spw_context_tags
    ON public.spider_pattern_weights USING GIN (session_context_tags);

-- ─── 3. Pattern Corrections Log ──────────────────────────────────────────────
-- Immutable audit of every weight change.  Captures surprise-weighted delta
-- (mappersan angle 2) and agent trust score at time of correction
-- (mappersan angle 5), making the full correction math reproducible.

CREATE TABLE IF NOT EXISTS public.spider_pattern_corrections (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    pattern_id           TEXT        NOT NULL REFERENCES public.spider_pattern_weights(pattern_id),
    -- FK to the decision that triggered the correction (nullable: manual corrections)
    decision_id          UUID        REFERENCES public.spider_decision_stream(id),
    actor_session        TEXT        NOT NULL,
    actor_machine        TEXT        NOT NULL,
    -- Spidersan's confidence at time of correction (for surprise-weighting)
    predicted_confidence NUMERIC(4,3),
    -- The flat delta before surprise weighting
    base_delta           NUMERIC(6,4) NOT NULL,
    -- effective_delta = base_delta * predicted_confidence (mappersan angle 2)
    -- Stored for audit; application computes before INSERT
    effective_delta      NUMERIC(6,4) NOT NULL,
    -- Agent trust score at time of correction (mappersan angle 5)
    agent_trust_score    NUMERIC(4,3),
    correction_reason    TEXT        NOT NULL CHECK (length(correction_reason) <= 500),
    old_weight           NUMERIC(4,3) NOT NULL,
    new_weight           NUMERIC(4,3) NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.spider_pattern_corrections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agents_insert_corrections" ON public.spider_pattern_corrections;
CREATE POLICY "agents_insert_corrections"
    ON public.spider_pattern_corrections FOR INSERT
    TO authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "agents_read_corrections" ON public.spider_pattern_corrections;
CREATE POLICY "agents_read_corrections"
    ON public.spider_pattern_corrections FOR SELECT
    TO authenticated, anon
    USING (true);

GRANT SELECT, INSERT ON public.spider_pattern_corrections TO authenticated, anon;

CREATE INDEX IF NOT EXISTS idx_spc_pattern_id_time
    ON public.spider_pattern_corrections (pattern_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spc_actor_session
    ON public.spider_pattern_corrections (actor_session, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spc_decision_id
    ON public.spider_pattern_corrections (decision_id)
    WHERE decision_id IS NOT NULL;

-- ─── 4. Agent Trust Profiles ─────────────────────────────────────────────────
-- Per-machine trust accumulator (mappersan angle 5).
-- trust_score = confirmations_correct / (confirmations_correct + confirmations_wrong + 1)
-- is a GENERATED column — always consistent with counters; no sync bug possible.
-- Scope: per (actor_machine, repo); repo = NULL means cross-repo trust.

CREATE TABLE IF NOT EXISTS public.spider_agent_trust (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_machine         TEXT        NOT NULL,
    -- NULL = cross-repo universal trust; TEXT = repo-scoped trust
    repo                  TEXT,
    confirmations_correct INTEGER     NOT NULL DEFAULT 0,
    confirmations_wrong   INTEGER     NOT NULL DEFAULT 0,
    -- GENERATED: never drifts from counters
    trust_score           NUMERIC(4,3) GENERATED ALWAYS AS (
                              confirmations_correct::numeric /
                              (confirmations_correct + confirmations_wrong + 1)
                          ) STORED,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (actor_machine, repo)
);

ALTER TABLE public.spider_agent_trust ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agents_read_trust" ON public.spider_agent_trust;
CREATE POLICY "agents_read_trust"
    ON public.spider_agent_trust FOR SELECT
    TO authenticated, anon
    USING (true);

-- Only service_role updates trust counters (called by weight manager on correction)
DROP POLICY IF EXISTS "service_role_write_trust" ON public.spider_agent_trust;
CREATE POLICY "service_role_write_trust"
    ON public.spider_agent_trust FOR ALL
    TO authenticated
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

GRANT SELECT ON public.spider_agent_trust TO authenticated, anon;
GRANT ALL ON public.spider_agent_trust TO service_role;

CREATE INDEX IF NOT EXISTS idx_sat_machine_repo
    ON public.spider_agent_trust (actor_machine, repo);

-- ─── 5. Triggers ──────────────────────────────────────────────────────────────

-- 5a. HMAC gate: reject decision inserts with null or empty signature (CRITICAL-1)
CREATE OR REPLACE FUNCTION public.enforce_decision_hmac()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.hmac_signature IS NULL OR length(trim(NEW.hmac_signature)) = 0 THEN
        RAISE EXCEPTION
            'spider_decision_stream: hmac_signature is required. '
            'Compute HMAC-SHA256(decision_id || actor_session || git_action || command_line, session_key) before INSERT.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS require_decision_hmac ON public.spider_decision_stream;
CREATE TRIGGER require_decision_hmac
    BEFORE INSERT ON public.spider_decision_stream
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_decision_hmac();

-- 5b. Optimistic lock: reject stale pattern weight updates (MEDIUM-7)
CREATE OR REPLACE FUNCTION public.enforce_pattern_version_lock()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
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

DROP TRIGGER IF EXISTS enforce_pattern_version ON public.spider_pattern_weights;
CREATE TRIGGER enforce_pattern_version
    BEFORE UPDATE ON public.spider_pattern_weights
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_pattern_version_lock();

-- 5c. Weight ceiling guard: reject writes that exceed 0.95 (belt-and-suspenders,
--     CHECK constraint is primary; this fires a readable error with context)
CREATE OR REPLACE FUNCTION public.enforce_weight_ceiling()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.base_weight > 0.95 THEN
        RAISE EXCEPTION
            'spider_pattern_weights: base_weight cannot exceed 0.95 (ceiling per CRITICAL-2). '
            'Attempted: % for pattern_id=%', NEW.base_weight, NEW.pattern_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_weight_ceiling ON public.spider_pattern_weights;
CREATE TRIGGER enforce_weight_ceiling
    BEFORE INSERT OR UPDATE ON public.spider_pattern_weights
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_weight_ceiling();

-- ─── 6. Functions ─────────────────────────────────────────────────────────────

-- 6a. Apply decay to patterns not confirmed in the last N days.
--     Call daily via pg_cron: SELECT spider_apply_decay(1);
CREATE OR REPLACE FUNCTION public.spider_apply_decay(days_since_last INT DEFAULT 1)
RETURNS TABLE(pattern_id TEXT, old_weight NUMERIC, new_weight NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    UPDATE public.spider_pattern_weights pw
    SET
        base_weight = GREATEST(
            0.0,
            ROUND((pw.base_weight * POWER(pw.decay_rate, days_since_last))::numeric, 3)
        ),
        version = pw.version + 1,
        updated_at = now()
    WHERE
        pw.is_tombstoned = false
        AND (
            pw.last_confirmed_at IS NULL
            OR pw.last_confirmed_at < now() - (days_since_last || ' days')::interval
        )
    RETURNING pw.pattern_id, pw.base_weight AS old_weight, pw.base_weight AS new_weight;
END;
$$;

-- 6b. Tombstone patterns not invoked in N days (mappersan angle 4: dormancy ≠ obsolescence)
--     Call weekly: SELECT spider_tombstone_stale_patterns(30);
CREATE OR REPLACE FUNCTION public.spider_tombstone_stale_patterns(inactive_days INT DEFAULT 30)
RETURNS TABLE(pattern_id TEXT, last_invoked_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    UPDATE public.spider_pattern_weights pw
    SET
        is_tombstoned = true,
        tombstoned_at = now(),
        version = pw.version + 1,
        updated_at = now()
    WHERE
        pw.is_tombstoned = false
        AND pw.last_invoked_at IS NOT NULL
        AND pw.last_invoked_at < now() - (inactive_days || ' days')::interval
    RETURNING pw.pattern_id, pw.last_invoked_at;
END;
$$;

-- 6c. Resurface a tombstoned pattern with base weight 0.3 (mappersan angle 4)
CREATE OR REPLACE FUNCTION public.spider_resurface_pattern(p_pattern_id TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    UPDATE public.spider_pattern_weights
    SET
        is_tombstoned = false,
        tombstoned_at = NULL,
        base_weight = 0.3,
        last_invoked_at = now(),
        version = version + 1,
        updated_at = now()
    WHERE pattern_id = p_pattern_id
      AND is_tombstoned = true;
END;
$$;

-- 6d. Upsert agent trust counters after a confirmed or corrected decision
CREATE OR REPLACE FUNCTION public.spider_update_agent_trust(
    p_actor_machine TEXT,
    p_repo TEXT,
    p_was_correct BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    INSERT INTO public.spider_agent_trust (actor_machine, repo, confirmations_correct, confirmations_wrong)
    VALUES (
        p_actor_machine,
        p_repo,
        CASE WHEN p_was_correct THEN 1 ELSE 0 END,
        CASE WHEN p_was_correct THEN 0 ELSE 1 END
    )
    ON CONFLICT (actor_machine, repo) DO UPDATE SET
        confirmations_correct = spider_agent_trust.confirmations_correct +
            CASE WHEN p_was_correct THEN 1 ELSE 0 END,
        confirmations_wrong = spider_agent_trust.confirmations_wrong +
            CASE WHEN p_was_correct THEN 0 ELSE 1 END,
        updated_at = now();
END;
$$;

-- ─── 7. pg_cron schedule (apply manually if cron extension available) ─────────
-- Schedule decay + tombstone sweeps.  Uncomment if pg_cron is enabled:
--
-- SELECT cron.schedule('spider-decay-daily',   '0 3 * * *', $$SELECT spider_apply_decay(1)$$);
-- SELECT cron.schedule('spider-tombstone-weekly', '0 4 * * 0', $$SELECT spider_tombstone_stale_patterns(30)$$);

-- ─── 8. Comments ──────────────────────────────────────────────────────────────

COMMENT ON TABLE public.spider_decision_stream IS
    'Append-only log of git decisions for real-time apprenticeship. '
    'Immutability enforced by absence of UPDATE/DELETE RLS policies. '
    'hmac_signature required on every row (CRITICAL-1).';

COMMENT ON TABLE public.spider_pattern_weights IS
    'Live pattern weight registry. base_weight capped at 0.95 by CHECK constraint (CRITICAL-2). '
    'Optimistic locking via version column (MEDIUM-7). '
    'last_invoked_at drives tombstoning (mappersan angle 4).';

COMMENT ON TABLE public.spider_pattern_corrections IS
    'Immutable audit of pattern weight changes. '
    'effective_delta = base_delta * predicted_confidence for surprise-weighted updates (mappersan angle 2).';

COMMENT ON TABLE public.spider_agent_trust IS
    'Per-machine correction trust scores (mappersan angle 5). '
    'trust_score is GENERATED from counters — cannot drift.';
