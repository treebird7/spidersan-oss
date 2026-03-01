# F4: Smart Sync Advisor

## Objective

Analyze git state across all repos on the current machine and recommend push/pull/cleanup actions — the automated version of the manual audit we did on Feb 19 ("all repos pushed to remote?").

## Context

**Problem:** Today's session manually ran `git rev-list --count` across 29 repos to find unpushed commits, behind branches, and dirty state. This should be a single command that also knows about other machines' state from Supabase.

**The Feb 19 audit found:**
- 4 repos needing push (spidersan, invoak, sasu, Toak)
- 2 repos needing pull (Envoak, skills)
- 12 repos with dirty uncommitted files
- 1 repo with diverged branches needing rebase (Toak)

**Existing patterns:**
- `spidersan pulse` — checks local health
- `spidersan doctor` — diagnoses issues
- `spidersan sync` — syncs registry with local git

## Files to Read

- `src/commands/sync.ts` — Existing sync command
- `src/commands/doctor.ts` — Health check patterns
- `src/lib/github.ts` — GitHub client from F2

## Files to Create/Modify

- **Create:** `src/commands/sync-advisor.ts` — New `spidersan sync-advisor` command
- **Create:** `src/lib/repo-scanner.ts` — Multi-repo git state scanner
- **Modify:** `src/bin/spidersan.ts` — Register new command
- **Create:** `tests/sync-advisor.test.ts`

## Deliverables

### 1. Repo scanner

```typescript
// src/lib/repo-scanner.ts
export interface RepoState {
    name: string;
    path: string;
    branch: string;
    ahead: number;          // commits ahead of remote
    behind: number;         // commits behind remote
    dirty: number;          // uncommitted files count
    dirtyFiles: string[];   // first 5 dirty files
    hasRemote: boolean;
    lastCommitAge: string;  // "5 hours ago"
    stale: boolean;         // no commits in 7+ days
}

export interface SyncAdvice {
    repo: string;
    action: 'push' | 'pull' | 'rebase-push' | 'commit-push' | 'cleanup' | 'ok';
    urgency: 'high' | 'medium' | 'low';
    reason: string;
    command: string;        // suggested git command
}

export async function scanRepos(basePath: string): Promise<RepoState[]>;
export function generateAdvice(states: RepoState[], 
                               remoteStates?: MachineRegistry[]): SyncAdvice[];
```

### 2. New command: `spidersan sync-advisor`

```typescript
export function syncAdvisorCommand(program: Command): void {
    program
        .command('sync-advisor')
        .description('Scan all repos and recommend push/pull/cleanup actions')
        .option('--path <dir>', 'Base directory to scan', '~/Dev')
        .option('--fix', 'Execute recommended actions (with confirmation)')
        .option('--json', 'Output as JSON')
        .option('--global', 'Include cross-machine state from Supabase')
        .action(async (options) => { ... });
}
```

**Output example:**
```
🕷️ Sync Advisor — scanning /Users/freedbird/Dev (29 repos)

  🔴 PUSH NEEDED:
    spidersan (fix/salvage-sentinel-gaps)  1 ahead
      → git push -u origin fix/salvage-sentinel-security-gaps
    invoak (raptor-mini/session-02-10)     2 ahead
      → git push

  🟠 PULL NEEDED:
    Envoak (main)                          1 behind
      → git pull --rebase
    skills (main)                          3 behind, 5 dirty
      → git stash && git pull --rebase && git stash pop

  🟡 DIVERGED (rebase recommended):
    Toak (main)                            1 ahead, 1 behind
      → git stash && git pull --rebase && git push && git stash pop

  ⚪ DIRTY ONLY (uncommitted work):
    Artisan (main)                         19 files
    tree (envision)                        10 files
    Sherlocksan (main)                     7 files

  ✅ SYNCED (12 repos):
    Birdsan, Cosan, nanoclaw, ...

Summary: 3 push, 2 pull, 1 rebase, 8 dirty, 12 clean
```

### 3. Auto-fix mode

With `--fix`, execute recommendations interactively:

```
🕷️ Execute sync recommendations?

  [1] Push spidersan (1 ahead) — Y/n?
  [2] Push invoak (2 ahead) — Y/n?
  [3] Pull Envoak (1 behind) — Y/n?
  [4] Rebase+push Toak (diverged) — Y/n?
  [5] Pull skills (3 behind, stash dirty) — Y/n?

  [A] Execute all — a?
  [S] Skip all — s?
```

### 4. Cross-machine awareness (with `--global`)

When Supabase data from F1 is available, add cross-machine context:

```
  🔴 PUSH NEEDED:
    spidersan (fix/salvage-sentinel-gaps)  1 ahead
      → git push
      ℹ️  M1 last synced 2hrs ago — they'll see this after push

  📡 OTHER MACHINES:
    M1 has 3 branches not on M2: feature/auth, feature/api, docs/update
    Cloud has 1 branch not on M2: codex/security-audit
```

## Test Cases

| Test | Expected |
|------|----------|
| Repo ahead of remote | Recommends push |
| Repo behind remote | Recommends pull |
| Repo diverged | Recommends stash + rebase + push |
| Repo with dirty + behind | Recommends stash + pull + stash pop |
| Repo fully synced | Marked as OK |
| Non-git directory skipped | Silently ignored |
| --fix executes commands | Runs suggested git commands after confirmation |
| --global with Supabase data | Shows other machines' state |
| No network → graceful | Shows local state, warns about remote check failure |

## Constraints

- Must work without Supabase (local-only scan is the default)
- `--fix` must ALWAYS confirm before executing (never auto-execute)
- Scan must be fast (use `git status --porcelain` and `git rev-list --count`)
- Skip directories that aren't git repos
- Handle worktrees (`.git` file instead of directory)
- Must not modify any repo without explicit `--fix` + user confirmation

## Definition of Done

- [ ] `spidersan sync-advisor` scans all repos under ~/Dev
- [ ] Correct categorization: push/pull/rebase/dirty/clean
- [ ] Suggested commands are accurate and safe
- [ ] `--fix` mode works with interactive confirmation
- [ ] `--global` shows cross-machine state from Supabase
- [ ] Tests pass
- [ ] Handles edge cases (worktrees, no remote, detached HEAD)
