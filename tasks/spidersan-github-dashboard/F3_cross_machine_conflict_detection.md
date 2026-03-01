# F3: Cross-Machine Conflict Detection

## Objective

Detect file conflicts across machines and repos using synced registries from F1 + GitHub state from F2. A branch on M1 touching `src/auth.ts` should conflict with a branch on M2 touching the same file — even if they've never talked.

## Context

**Problem:** Current `spidersan conflicts` only sees the local registry. If M1 has a sentinel security branch and M2 has a copilot feature branch touching the same files, neither knows. The Feb 19 session proved this gap — 10 branches were invisible until manually scanned.

**Existing infra:**
- `src/commands/conflicts.ts` — File-level conflict detection with tiered blocking (WARN/PAUSE/BLOCK)
- `src/lib/ast.ts` — Semantic conflict detection (symbol-level, TS/JS only)
- `spider_registries` from F1 (machine-tagged branches)
- `spider_github_branches` from F2 (GitHub state)

**Mappersan verdict:** "Cross-repo conflict detection is a 🔥🔥🔥🔥 stretch goal" (SHORT_TERM_ROADMAP.md). With F1+F2 providing the data, this becomes achievable.

## Files to Read

- `src/commands/conflicts.ts` — Current conflict logic (getConflictTier, tier system)
- `src/storage/supabase.ts` — Supabase query patterns
- `src/lib/ast.ts` — Semantic conflict detection (optional enhancement)

## Files to Create/Modify

- **Create:** `src/commands/global-conflicts.ts` — New `spidersan conflicts --global` extension
- **Create:** `src/lib/cross-machine.ts` — Cross-machine conflict engine
- **Modify:** `src/commands/conflicts.ts` — Add `--global` flag that delegates to global-conflicts
- **Create:** `tests/cross-machine-conflicts.test.ts`

## Deliverables

### 1. Cross-machine conflict engine

```typescript
// src/lib/cross-machine.ts
export interface GlobalConflict {
    file: string;
    tier: 1 | 2 | 3;
    branches: {
        name: string;
        machine: string;       // "m2" or "cloud"
        agent: string;
        repo: string;
        source: 'registry' | 'github';  // where we learned about it
    }[];
}

export interface GlobalConflictReport {
    conflicts: GlobalConflict[];
    machines: string[];
    repos: string[];
    totalBranches: number;
    timestamp: string;
}

// Query Supabase for all registries + GitHub branches, detect overlaps
export async function detectGlobalConflicts(
    options: {
        repo?: string;           // filter to one repo
        crossRepo?: boolean;     // detect across repos (stretch)
        minTier?: 1 | 2 | 3;    // minimum tier to report
    }
): Promise<GlobalConflictReport>;
```

### 2. Extended conflicts command

```typescript
// Added to src/commands/conflicts.ts
.option('--global', 'Detect conflicts across all machines (requires Supabase)')
.option('--cross-repo', 'Detect conflicts across repos (with --global)')
.option('--machine <name>', 'Filter to specific machine')
```

**Output example:**
```
🕷️ Global conflicts (3 machines, 2 repos):

🔴 BLOCK: src/commands/register.ts
   M2/spidersan: sentinel/fix-stale-path-traversal (sentinel, 5hrs ago)
   M2/spidersan: sentinel-input-validation-register (sentinel, 4d ago)
   M1/spidersan: feature/register-refactor (claude, 2d ago)          ← CROSS-MACHINE
   
🟠 PAUSE: tests/security/git_injection.test.ts
   M2/spidersan: 5 branches (bolt, copilot, perf, 2x sentinel)
   Cloud/spidersan: codex/security-audit (codex, 1d ago)             ← CROSS-MACHINE

🟡 WARN: README.md
   M2/spidersan: docs/update-readme (copilot, 3d)
   M1/myceliumail: docs/cross-reference (watsan, 1d)                 ← CROSS-REPO

Summary: 12 conflicts (3 BLOCK, 4 PAUSE, 5 WARN) across 3 machines
```

### 3. Toaklink notification on cross-machine conflicts

When `--global` detects TIER 2+ cross-machine conflicts, optionally broadcast via Toaklink:

```typescript
if (options.notify && crossMachineConflicts.length > 0) {
    await toaklinkBroadcast({
        type: 'conflict_alert',
        message: `🔴 ${crossMachineConflicts.length} cross-machine conflicts detected`,
        details: crossMachineConflicts,
    });
}
```

## Test Cases

| Test | Expected |
|------|----------|
| Same file on different machines | Detected as cross-machine conflict |
| Same file on same machine | Detected as local conflict (existing behavior) |
| Cross-repo file overlap | Detected only with --cross-repo flag |
| Tier filtering | --global --tier 2 only shows PAUSE and BLOCK |
| No Supabase → error | "Global conflicts require Supabase. Run: spidersan registry-sync --push first" |
| GitHub-only branches (unregistered) | Included in conflict detection via F2 data |
| Stale branches excluded by default | Branches marked stale are dimmed, not counted as active conflicts |

## Constraints

- Local-only mode (`spidersan conflicts` without `--global`) must work exactly as before
- Cross-repo detection is opt-in (extra flag) because it's noisy
- Must handle repos with different naming conventions (same file paths in different repos doesn't always mean conflict)
- Notification is opt-in (`--notify` flag)

## Definition of Done

- [ ] `spidersan conflicts --global` shows multi-machine conflicts
- [ ] Cross-machine conflicts clearly labeled with machine name
- [ ] Tier system applies correctly to global conflicts
- [ ] `--cross-repo` extends detection across repos
- [ ] `--notify` sends Toaklink alert for TIER 2+ cross-machine conflicts
- [ ] Tests pass
- [ ] Existing `spidersan conflicts` behavior unchanged
