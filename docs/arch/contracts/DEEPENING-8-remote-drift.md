# DEEPENING-8: `spidersan pulse --remote-drift`

## Goal

Add `--remote-drift` flag to `spidersan pulse`. When set, after the existing colony sync + local conflict check, the command:
1. Fetches `origin`
2. Detects how many commits remote is ahead / local is ahead
3. Collects all files touched by those remote commits (the **drift zone**)
4. Cross-references the drift zone against (a) the registered file list for the current branch and (b) unstaged tracked files in the working tree
5. Reports results in human-readable or JSON form; optionally posts to Hub; optionally exits 1 if risk found

The core logic lives in `src/lib/remote-drift.ts` so `watch --fetch-poll` can reuse it later without importing from the command.

---

## Seam — `src/lib/remote-drift.ts`

```typescript
import { getAheadBehind } from './git.js';   // already exists — do NOT redefine
import { classifyTier } from './conflict-tier.js';

export interface DriftEntry {
  file: string;
  registered: boolean;
  tier: 1 | 2 | 3 | null;  // null = not registered
  unstaged: boolean;         // true = git rebase --continue blocker risk
}

export interface DriftResult {
  branch: string;
  remote: string;
  localAhead: number;
  remoteAhead: number;
  state: 'synced' | 'local_ahead' | 'remote_ahead' | 'diverged';
  driftZone: string[];
  registeredInDrift: DriftEntry[];
  unstagedInDrift: DriftEntry[];  // entries where unstaged=true (may overlap registeredInDrift)
  safeToPush: boolean;
  rebaseContinueRisk: boolean;
  recommendation: 'push_clean' | 'pull_rebase' | 'rebase_clean' | 'rebase_with_conflict_prep' | 'synced';
}

// Returns union of files touched by remote commits that local doesn't have.
// Uses: git rev-list HEAD..origin/<branch> then git show --stat <sha> for each.
// All git calls: execFileSync('git', [args]) — no string interpolation.
export function getDriftZone(remote: string, branch: string): string[]

// Returns tracked files with unstaged modifications.
// Uses: git diff --name-only (no args = compares working tree to index)
export function getUnstagedTrackedFiles(): string[]

// Cross-references driftFiles against registeredFiles + unstagedFiles.
// Calls classifyTier(file) for registered files.
export function classifyDriftZone(
  driftFiles: string[],
  registeredFiles: string[],
  unstagedFiles: string[],
  tierOptions?: { extraTier3?: RegExp[]; extraTier2?: RegExp[] }
): DriftEntry[]

// Main entry point — runs fetch, then delegates to the above helpers.
// branch defaults to getCurrentBranch().
// Returns null if offline, not-in-repo, detached HEAD, mid-rebase, or no remote.
// In those cases also sets a string `skipReason` in the returned object.
export function computeDriftResult(
  registeredFiles: string[],
  options?: { remote?: string; branch?: string }
): Promise<DriftResult | { skipped: true; reason: string }>
```

**Important:** `getAheadBehind` already exists in `src/lib/git.ts`. Import it from there; do not copy or redefine it. The `computeDriftResult` function should call `getAheadBehind('origin', branch)` after the fetch.

---

## Files to touch

| File | Change |
|------|--------|
| `src/lib/remote-drift.ts` | **Create** — full implementation |
| `src/commands/pulse.ts` | **Modify** — add `--remote-drift`, `--hub-sync`, `--strict` options; call `computeDriftResult` after existing logic when `--remote-drift` is set |
| `tests/remote-drift.test.ts` | **Create** — vitest test file (see Tests required below) |
| `docs/arch/STATE.json` | **Modify** — set `P1-DEEPENING-8-remote-drift` status to `done` after implementation |

---

## Critical: do not remove existing tests

Only ADD test files and test cases. Do NOT modify, delete, or replace existing test files or existing test cases in any file. The existing 124 tests must still pass.

---

## Files NOT to touch

- `src/lib/git.ts` — `getAheadBehind` and `getRemoteHead` already exist here; only import them
- `src/lib/conflict-tier.ts` — already has `classifyTier`; only import
- `src/lib/hub.ts` — already has `HubClient`; import for `--hub-sync` in pulse.ts
- `src/storage/` — no changes needed
- `vitest.config.ts` — do not modify
- Any other `src/commands/` file — only `pulse.ts` changes

---

## Tests required (`tests/remote-drift.test.ts`)

Use vitest (`import { describe, it, expect, vi, beforeEach } from 'vitest'`). Mock `child_process.execFileSync` and `node:child_process` to stub git output. Do not spawn real git processes.

Required test cases:

1. **synced** — remote 0 ahead, local 0 ahead → `state: 'synced'`, `safeToPush: true`, `driftZone: []`
2. **local_ahead** — local 2 ahead, remote 0 ahead → `state: 'local_ahead'`, `safeToPush: true`
3. **remote_ahead_no_overlap** — remote 2 ahead, drift zone files do not overlap registered or unstaged → `registeredInDrift: []`, `unstagedInDrift: []`, `safeToPush: true`
4. **remote_ahead_registered_overlap** — remote commits touch a file that is registered → `registeredInDrift` has 1 entry with correct tier, `safeToPush: false`
5. **remote_ahead_unstaged_overlap** — remote commits touch a file that has unstaged modifications → `unstagedInDrift` has 1 entry, `rebaseContinueRisk: true`
6. **diverged_both** — local 1 ahead, remote 3 ahead, registered+unstaged overlap → `state: 'diverged'`, `recommendation: 'rebase_with_conflict_prep'`
7. **offline** — `git fetch origin` throws ENOTFOUND or network error → returns `{ skipped: true, reason: '...' }`, does not throw
8. **detached_HEAD** — `getCurrentBranch()` returns `'HEAD'` → returns `{ skipped: true, reason: 'Detached HEAD' }`
9. **mid_rebase** — `.git/REBASE_HEAD` or `git status` indicates mid-rebase → returns `{ skipped: true, reason: 'Rebase in progress' }`
10. **no_remote_branch** — `getRemoteHead` returns null (branch not yet pushed) → returns synced-equivalent with note "Remote branch not found — safe to push (first push)"

---

## `pulse.ts` changes

Add these options to the `pulseCommand`:
```typescript
.option('--remote-drift', 'Check if remote has advanced past local HEAD')
.option('--hub-sync', 'Post drift alert to Hub if registered or unstaged files are in drift zone')
.option('--strict', 'Exit 1 if any registered or unstaged files are in the drift zone')
```

After the existing local conflict detection block, when `options.remoteDrift` is true:
1. Load registered files for current branch from storage (`target?.files ?? []`)
2. Call `computeDriftResult(registeredFiles, { remote: 'origin', branch: currentBranch })`
3. If skipped: print `⚠  Remote drift check skipped: <reason>` and continue
4. If JSON mode: merge drift result into the JSON output object
5. If human mode: print the drift section (see Output format below)
6. If `--hub-sync` and drift is non-empty (registered or unstaged in drift): post to Hub using `HubClient` from `src/lib/hub.ts`
7. If `--strict` and `(registeredInDrift.length > 0 || unstagedInDrift.length > 0)`: `process.exit(1)`

### Human output format

```
🕷️ REMOTE DRIFT — "<branch>"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Remote is N commits ahead of local.

Drift zone (files touched by remote commits):
  canopy/tasks.md               [not registered, not modified]
  CONSORTIUM-cat-A.md           [registered — 🟠 TIER 2] [unstaged modification ⚠]
  docs/PAPER_finetune_findings.md  [registered — 🔴 TIER 3]

⚠  2 registered file(s) in drift zone. Rebase will conflict.
⚠  1 file has unstaged modifications — git rebase --continue may block even
   after resolving conflict markers. Fix: git checkout HEAD -- <file>

   git fetch origin
   git log --oneline origin/main -3
```

When clean:
```
✅ Remote drift: 0 commits ahead. Safe to push.
```

### JSON additions (merged into existing pulse JSON output)

```json
{
  "remoteDrift": {
    "branch": "main",
    "remote": "origin/main",
    "localAhead": 2,
    "remoteAhead": 3,
    "state": "diverged",
    "driftZone": [...],
    "registeredInDrift": [...],
    "unstagedInDrift": [...],
    "safeToPush": false,
    "rebaseContinueRisk": true,
    "recommendation": "rebase_with_conflict_prep"
  }
}
```

---

## Security invariants

- All git calls: `execFileSync('git', [args])` — never string interpolation
- Remote name `origin` is a constant (not user-supplied); if made configurable later, validate with `validateBranchName`
- Branch name validated with `validateBranchName` from `src/lib/security.ts` before use in git args
- No user-supplied values interpolated into git args anywhere in `remote-drift.ts`

---

## Success criteria

- [ ] `spidersan pulse --remote-drift` runs `git fetch origin` and reports drift state
- [ ] Drift zone files cross-referenced against spidersan registry with tier classification
- [ ] Drift zone files cross-referenced against `git diff --name-only` (unstaged tracked); overlap flagged as `rebaseContinueRisk`
- [ ] `--json` output includes `remoteDrift` object with `unstagedInDrift` array and `rebaseContinueRisk` boolean
- [ ] Human output shows `[unstaged modification ⚠]` label and separate warning line
- [ ] `--hub-sync` posts to Hub when registered **or** unstaged files are in drift zone
- [ ] `--strict` exits 1 when `registeredInDrift` or `unstagedInDrift` is non-empty
- [ ] All git calls use `execFileSync` with argv array (no string interpolation)
- [ ] Offline / no-remote / detached-HEAD / mid-rebase all degrade gracefully (no crash, no exit 1)
- [ ] `src/lib/remote-drift.ts` exports `getDriftZone`, `getUnstagedTrackedFiles`, `classifyDriftZone`, `computeDriftResult`
- [ ] Tests in `tests/remote-drift.test.ts` — all 10 cases described above
- [ ] All 124 existing tests still pass (`npm run test:run`)
- [ ] `tsc --noEmit` clean, `pnpm build` clean

---

## Out of scope

- `watch --fetch-poll` — future work; `remote-drift.ts` exports the building blocks but watch.ts is NOT touched
- Pre-push hook scaffolding — `spidersan init` not modified
- Symbol-aware tier classification (SECURITY-H10) — use existing `classifyTier` as-is
- Any changes to `src/storage/`, `src/lib/conflict-analyzer.ts`, `src/lib/graph.ts`
- Detecting mid-rebase via filesystem is acceptable heuristic (check for `.git/rebase-merge/` or `.git/rebase-apply/` directories); no need to parse git status
