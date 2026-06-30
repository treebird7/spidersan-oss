-- Decommission the ORPHANED spider_registries on the VAULT project (<vault-project-ref>).
--
-- This table drifted onto vault by accident (the registry-sync uses a single SUPABASE_URL and
-- expects both spider_registries + branch_registry on ONE project; branch_registry is on runtime,
-- so spider_registries belongs there too). It has been consolidated onto runtime — see
-- 20260219_spider_registries.sql + the vault→runtime data move in CONSOLIDATION.md.
--
-- ⚠️ DEPLOYMENT TARGET: treebird_VAULT (<vault-project-ref>) — apply MANUALLY against vault,
--    NOT via the runtime-linked migration runner. This is the ONLY file here that targets vault.
-- ⚠️ GATE: apply ONLY AFTER the 49 vault rows are confirmed present in runtime.spider_registries
--    (CONSOLIDATION.md step 4 verifies count parity first).
-- ROLLBACK: none — teardown of the orphaned copy once the data is safe on runtime.

DROP VIEW  IF EXISTS public.spider_file_overlaps;
DROP VIEW  IF EXISTS public.spider_active_registries;
DROP TABLE IF EXISTS public.spider_registries;
