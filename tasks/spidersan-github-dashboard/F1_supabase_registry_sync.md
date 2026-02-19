# F1: Supabase Registry Sync — Machine-Aware Branch State

## Objective

Sync local `.spidersan/registry.json` to Supabase tagged with `machine_id`, so all machines see each other's registered branches in real time.

## Context

**Problem:** Spidersan registries are local JSON files. M1 can't see M2's branches. Cloud agents can't see either. The `src/storage/supabase.ts` adapter exists but only syncs individual branch operations — there's no holistic registry push/pull with machine awareness.

**Existing infra:**
- `src/storage/supabase.ts` — Supabase storage adapter (branch CRUD operations exist)
- `src/storage/factory.ts` — Auto-selects storage backend
- `~/.envoak/machine.json` — Machine identity (`m2`, UUID, hostname, SSH fingerprint)
- Supabase project already configured (tables exist for branches, messages, dependencies)

**Mappersan's realism pass (Feb 17):** "Phase 1 — Wire Existing Systems." Registry sync is the foundation everything else depends on.

## Files to Read

- `src/storage/supabase.ts` — Existing Supabase adapter (understand current schema)
- `src/storage/adapter.ts` — Storage interface contract
- `src/storage/local.ts` — Local JSON storage (what we're syncing FROM)
- `src/storage/factory.ts` — Storage backend selection logic
- `src/lib/config.ts` — Config loading (SUPABASE_URL, SUPABASE_KEY)

## Files to Create/Modify

- **Create:** `src/commands/registry-sync.ts` — New `spidersan registry-sync` command
- **Create:** `supabase/migrations/004_spider_registries.sql` — Schema for machine-tagged registries
- **Modify:** `src/storage/supabase.ts` — Add `pushRegistry()` and `pullRegistry()` methods
- **Modify:** `src/bin/spidersan.ts` — Register new command
- **Create:** `tests/registry-sync.test.ts`

## Deliverables

### 1. SQL Migration: `spider_registries` table

```sql
CREATE TABLE spider_registries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id TEXT NOT NULL,           -- from ~/.envoak/machine.json
    machine_name TEXT NOT NULL,         -- e.g. "m2"
    hostname TEXT,                      -- e.g. "Mac.lan"
    repo_path TEXT NOT NULL,            -- e.g. "/Users/freedbird/Dev/spidersan"
    repo_name TEXT NOT NULL,            -- e.g. "spidersan"
    branch_name TEXT NOT NULL,
    files TEXT[] DEFAULT '{}',
    agent TEXT,
    description TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned', 'merged')),
    last_commit_sha TEXT,
    last_commit_date TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(machine_id, repo_name, branch_name)
);

CREATE INDEX idx_spider_reg_machine ON spider_registries(machine_id);
CREATE INDEX idx_spider_reg_repo ON spider_registries(repo_name);
CREATE INDEX idx_spider_reg_status ON spider_registries(status);
CREATE INDEX idx_spider_reg_synced ON spider_registries(synced_at DESC);

-- RLS: All authenticated agents can read, write only their machine's rows
ALTER TABLE spider_registries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents can read all registries"
    ON spider_registries FOR SELECT USING (true);

CREATE POLICY "Agents can write own machine registries"
    ON spider_registries FOR INSERT
    WITH CHECK (machine_id = current_setting('request.jwt.claims', true)::json->>'machine_id'
                OR current_setting('request.jwt.claims', true) IS NULL);

CREATE POLICY "Agents can update own machine registries"
    ON spider_registries FOR UPDATE
    USING (machine_id = current_setting('request.jwt.claims', true)::json->>'machine_id'
           OR current_setting('request.jwt.claims', true) IS NULL);
```

### 2. New command: `spidersan registry-sync`

```typescript
// src/commands/registry-sync.ts
export function registrySyncCommand(program: Command): void {
    program
        .command('registry-sync')
        .description('Sync local registry to/from Supabase (cross-machine awareness)')
        .option('--push', 'Push local registry to Supabase')
        .option('--pull', 'Pull other machines registries')
        .option('--status', 'Show sync status across machines')
        .option('--repo <name>', 'Limit to specific repo (default: current)')
        .option('--all-repos', 'Sync all repos found in ~/Dev/*')
        .action(async (options) => { ... });
}
```

**Push flow:**
1. Read `~/.envoak/machine.json` for `machine_id` and `machine_name`
2. Read local `.spidersan/registry.json`
3. For each branch: upsert into `spider_registries` with machine tags
4. Mark branches removed locally as abandoned in Supabase
5. Print summary: `✅ Pushed 22 branches from m2 (spidersan)`

**Pull flow:**
1. Query `spider_registries` WHERE `machine_id != current` AND `repo_name = current`
2. Display other machines' branches with conflict indicators
3. Don't modify local registry (read-only view of remote state)

**Status flow:**
1. Query all machines' registries for current repo
2. Show table: machine × branch × status × last_sync

### 3. Supabase adapter extensions

```typescript
// Added to src/storage/supabase.ts
async pushRegistry(machineId: string, machineName: string, 
                   hostname: string, repoName: string, 
                   branches: BranchRecord[]): Promise<void>;

async pullRegistries(repoName: string, excludeMachine?: string): Promise<MachineRegistry[]>;

async getRegistryStatus(repoName?: string): Promise<RegistryStatus[]>;
```

### 4. Machine identity integration

```typescript
// Read from ~/.envoak/machine.json
interface MachineIdentity {
    id: string;         // UUID
    name: string;       // "m2"
    hostname: string;   // "Mac.lan"
}

function loadMachineIdentity(): MachineIdentity {
    const configPath = join(homedir(), '.envoak', 'machine.json');
    // Falls back to hostname if no envoak identity configured
}
```

## Test Cases

| Test | Expected |
|------|----------|
| Push with valid machine identity | Upserts all branches to Supabase |
| Push detects removed local branches | Marks them abandoned in Supabase |
| Pull shows other machines' branches | Returns branches from M1 when running on M2 |
| Pull doesn't modify local registry | Local registry.json unchanged after pull |
| Status shows all machines | Table with machine_name, branch_count, last_sync |
| No Supabase config → graceful error | "Supabase not configured. Set SUPABASE_URL and SUPABASE_KEY" |
| No machine identity → fallback | Uses hostname as machine_name, generates UUID |
| Concurrent push from 2 machines | UPSERT handles correctly via UNIQUE constraint |

## Constraints

- Must not break existing local-only workflow (Supabase remains optional)
- Machine identity must come from Envoak's `machine.json` (not hardcoded)
- Push must be idempotent (safe to run repeatedly)
- Pull must be read-only (never modifies local state)
- All Supabase calls must handle network errors gracefully

## Definition of Done

- [ ] Migration applied to Supabase
- [ ] `spidersan registry-sync --push` works from M2
- [ ] `spidersan registry-sync --pull` shows M1's branches (or vice versa)
- [ ] `spidersan registry-sync --status` shows multi-machine table
- [ ] Tests pass
- [ ] No existing tests broken
- [ ] Works with `--all-repos` flag to batch-sync all repos
