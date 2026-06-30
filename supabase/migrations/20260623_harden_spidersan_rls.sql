-- Harden the LIVE spidersan tables on treebird_runtime (<runtime-project-ref>).
--
-- Audit (2026-06-23, mycsan) on the PUBLIC runtime project (Toak app's anon key is publishable):
--   • branch_registry (TABLE): anon INSERT + UPDATE + SELECT, all `true` — anyone with the
--     publishable anon key could poison or wipe the 115 live rows. Also a blanket
--     "Authenticated can read" that exposes fleet activity to Toak app end-users.
--   • active_branches, stale_branches (VIEWS): default (owner) rights → bypass branch_registry's RLS.
--
-- Fix: writes via service_role only (registry-sync uses the service key); reads by FLEET AGENTS
-- only (authenticated JWT carrying an agent_id claim — not plain app users); anon denied.
-- Pattern matches spider_activity_log and 20260219_spider_registries.sql.
--
-- DEPLOYMENT TARGET: treebird_runtime (<runtime-project-ref>).
-- ⚠️ PREREQUISITE: switch registry-sync's SUPABASE_KEY to the service_role key BEFORE applying —
--    the sync writes branch_registry as anon today, so these DROPs deny it until the key is switched.
-- ROLLBACK: re-create the dropped policies (NOT recommended — they were the hole).

-- ── branch_registry (TABLE): drop wide-open anon + blanket-authenticated policies ──
DROP POLICY IF EXISTS "Anon can read branch registry"          ON public.branch_registry;
DROP POLICY IF EXISTS "Anon can write branch registry"         ON public.branch_registry;
DROP POLICY IF EXISTS "Anon can update branch registry"        ON public.branch_registry;
DROP POLICY IF EXISTS "Authenticated can read branch registry" ON public.branch_registry;
-- Retained (already present): "Service role manages branch registry" [ALL service_role].

-- Replace the blanket auth-read with an agent-scoped read (fleet agents only):
DROP POLICY IF EXISTS "Agents read branch registry" ON public.branch_registry;
CREATE POLICY "Agents read branch registry"
    ON public.branch_registry FOR SELECT
    TO authenticated
    USING ((current_setting('request.jwt.claims', true)::jsonb ->> 'agent_id') IS NOT NULL);

-- ── active_branches / stale_branches (VIEWS): enforce the caller's RLS, not the owner's ──
ALTER VIEW public.active_branches SET (security_invoker = true);
ALTER VIEW public.stale_branches  SET (security_invoker = true);
