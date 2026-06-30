# spider_registries consolidation — vault → runtime (+ RLS hardening)

> **Why:** the registry-sync uses a single `SUPABASE_URL`/client to write *both*
> `spider_registries` and `branch_registry`, but config drift left them on different
> projects — `spider_registries` on **vault** (`<vault-project-ref>`, 49 rows, last
> written 2026-06-07) and `branch_registry` on **runtime** (`<runtime-project-ref>`,
> 115 rows). So the `spider_registries` half of every sync from a runtime-pointed
> machine has been silently 404-ing. The whole spidersan family lives on **runtime**;
> `spider_registries` is the lone stray. Canonical = **runtime**.
>
> **Also:** both live tables had wide-open anon RLS on a public-keyed project. This
> closes that (service-role writes, agent-JWT reads, anon denied).

Migrations in this set:
- `20260219_spider_registries.sql` — hardened CREATE, **runtime**
- `20260623_harden_spidersan_rls.sql` — branch_registry + views, **runtime**
- `20260623_decommission_vault_spider_registries.sql` — teardown, **vault** (manual, gated)

## Order (do not reorder — step 1 gates the rest)

### 1. Switch registry-sync to the service key FIRST
The sync writes `branch_registry` as **anon** today. Dropping the anon policies (step 3)
before this denies the live sync. Set its credential to the service_role key:
```bash
# per machine running registry-sync — vault: supabase_runtime/SUPABASE_RUNTIME_SERVICE_KEY
export SUPABASE_URL=<runtime url>            # supabase/URL  (<runtime-project-ref>)
export SUPABASE_KEY=<runtime service_role>   # supabase_runtime/SUPABASE_RUNTIME_SERVICE_KEY
spidersan registry-sync --status            # confirm it connects as service_role
```

### 2. Apply the hardened CREATE to runtime
```bash
cd ~/Dev/spidersan && supabase db push --linked   # repo links <runtime-project-ref>
# or apply 20260219_spider_registries.sql via the mgmt API against <runtime-project-ref>
# → creates an EMPTY hardened spider_registries + views on runtime
```

### 3. Move the 49 rows vault → runtime (cross-project; not a .sql migration)
Read from vault, upsert into runtime (idempotent on the unique key):
```bash
# pseudo: SELECT * FROM vault.spider_registries  → INSERT ... ON CONFLICT
#         (machine_id,repo_name,branch_name) DO UPDATE  INTO runtime.spider_registries
# Done via the Supabase Management API /database/query against each project.
```

### 4. Apply branch_registry hardening to runtime + VERIFY
```bash
# apply 20260623_harden_spidersan_rls.sql against <runtime-project-ref>, then:
#  • runtime.spider_registries count == 49 (parity with vault before teardown)
#  • anon  → 0 read / 0 write on both tables  (RLS denies)
#  • service_role sync --push / --pull round-trips
#  • authenticated WITHOUT agent_id claim → denied; WITH agent_id → reads
```

### 5. Decommission the vault copy (GATED on step 4 parity)
```bash
# apply 20260623_decommission_vault_spider_registries.sql MANUALLY against vault
# (<vault-project-ref>) — drops the orphaned table + views.
```

### 6. Update the project maps (so this can't drift back)
- `<internal cookbook> (not in this repo)`
- `~/Dev/Docs/ecosystem/SUPABASE_PROJECTS.md`
- the `/sql-review` Check-5 registry (`spider_registries` → runtime, not vault)

## Rollback
Pre-step-5 it's fully reversible: vault still holds the 49 rows. If runtime apply or
verification fails, revert the sync key (step 1) and the vault copy is untouched.
After step 5, the runtime copy is canonical (per-migration ROLLBACK headers apply).
