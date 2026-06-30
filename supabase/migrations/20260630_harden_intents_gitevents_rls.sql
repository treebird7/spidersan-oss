-- Harden spider_intents + spidersan_git_events READS on the treebird runtime
-- (ruvwundetxnzesrbkdzr). Bead tb-3dz (P3) — leftover from the 2026-06-24 RLS audit.
--
-- Pattern matches 20260623_harden_spidersan_rls.sql (branch_registry) and
-- 20260219_spider_registries.sql: reads by FLEET AGENTS only (an authenticated JWT
-- carrying an agent_id claim — not anon, not a plain app user), anon/blanket denied.
--
-- BEFORE (audited 2026-06-30, mycsan, live on ruvwundetxnzesrbkdzr):
--   spider_intents       SELECT "Agents can read all intents" TO public        USING true  ← world-readable
--   spidersan_git_events SELECT "anon_read"                   TO anon          USING true  ← anon-readable
--   spidersan_git_events SELECT "authenticated_read"          TO authenticated USING true  ← blanket auth-readable
--   Writes are UNCHANGED and intentionally retained:
--     spider_intents "Service manages all intents" [ALL service_role],
--     "Agents claim own intents" [INSERT], "Agents update own intents" [UPDATE, agent_id self-scope].
--     spidersan_git_events has no write policy — service_role bypasses RLS (the git-watcher writes
--     with the service/runtime key).
--
-- ⚠️ PREREQUISITE (reader auth): consumers must present a COLONY_SESSION_JWT (agent JWT with an
--    agent_id claim) OR a service_role key. Verified for git-watch / registry-sync / cross-conflicts
--    (.env.example L15, README L189: service_role required — bypasses RLS). Any reader using a bare
--    anon publishable key (e.g. a COLONY_SUPABASE_KEY anon path) is DENIED after this and must switch
--    to an agent JWT. Realtime subscriptions on spidersan_git_events are RLS-checked via their
--    access_token too — same requirement.
--
-- ROLLBACK: re-create the dropped policies (NOT recommended — they were the hole).

-- ── spider_intents: replace world-readable SELECT with an agent-scoped read ──
DROP POLICY IF EXISTS "Agents can read all intents" ON public.spider_intents;
DROP POLICY IF EXISTS "Agents read intents"         ON public.spider_intents;
CREATE POLICY "Agents read intents"
    ON public.spider_intents FOR SELECT
    TO authenticated
    USING ((current_setting('request.jwt.claims', true)::jsonb ->> 'agent_id') IS NOT NULL);

-- ── spidersan_git_events: drop anon + blanket-authenticated SELECT, add agent-scoped read ──
DROP POLICY IF EXISTS "anon_read"              ON public.spidersan_git_events;
DROP POLICY IF EXISTS "authenticated_read"     ON public.spidersan_git_events;
DROP POLICY IF EXISTS "Agents read git events" ON public.spidersan_git_events;
CREATE POLICY "Agents read git events"
    ON public.spidersan_git_events FOR SELECT
    TO authenticated
    USING ((current_setting('request.jwt.claims', true)::jsonb ->> 'agent_id') IS NOT NULL);
