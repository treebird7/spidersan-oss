# Spec: `spidersan pulse --remote-drift`

**Status:** Proposed  
**Source:** 2026-05-11 rebase-sync-chaos incident (spidersan-ai, 7+1 gold pairs at `bcb581c`)  
**Author:** spidersan-m5  

---

## Problem

`spidersan conflicts` is registry-based: it compares registered branches across
agents and reports when two branches touch the same files. It correctly reported
✅ clean throughout the 2026-05-11 incident — because the incident was
**single-agent, multi-machine**: one agent (yosef) working on `main` from m2 and
m5 simultaneously. No cross-agent branch overlap existed.

The actual failure was **remote drift**: `origin/main` advanced 3 times while
local work was in progress, and nothing surfaced that before the first `git push`
attempt. The only signal was a push rejection — which triggered a 7-step rebase
cascade.

`spidersan pulse --remote-drift` closes this gap by checking whether the remote
has advanced past local HEAD *before* a push is attempted, and reporting which
registered files are at risk.

---

## Command

```bash
spidersan pulse --remote-drift              # fetch + drift report
spidersan pulse --remote-drift --json       # machine-readable output
spidersan pulse --remote-drift --hub-sync   # post alert to Hub chat if drifted
spidersan pulse --remote-drift --strict     # exit 1 if any registered file is in drift zone
```

`--remote-drift` is a new flag on the existing `pulse` command. All other pulse
behaviour (colony sync, local conflict detection) runs first as normal;
`--remote-drift` appends the drift report at the end.

---

## Behaviour

### Step 1 — Fetch

```
git fetch origin
```

Read-only. Never rebases or merges. Run via `execFileSync('git', ['fetch', 'origin'])`.
If the network is unreachable, print a warning and skip the drift section (same
offline-graceful pattern as colony sync).

### Step 2 — Detect divergence

```
git rev-list --count HEAD..origin/<branch>   → N commits remote is ahead
git rev-list --count origin/<branch>..HEAD   → M commits local is ahead
```

Four states:

| Local ahead (M) | Remote ahead (N) | State | Icon |
|---|---|---|---|
| 0 | 0 | Fully synced | ✅ |
| M | 0 | Local ahead — push is clean | ⬆️ |
| 0 | N | Remote ahead — pull/rebase needed | ⬇️ |
| M | N | **Diverged** — rebase or merge required | 🔀 |

Only states ⬇️ and 🔀 trigger further analysis.

### Step 3 — Identify drifted files

For each remote commit that local doesn't have:

```
git show --stat <sha>   →  list of files touched
```

Collect the union of all files across all N remote commits. Call this the
**drift zone**.

### Step 4 — Cross-reference: registry + unstaged working tree

Two independent cross-references against the drift zone:

**4a. Registry cross-ref** — load the registered file list for the current
branch and intersect with the drift zone.

- **No overlap** → remote didn't touch your declared files
- **Overlap** → conflict-at-rebase risk; classify each file by tier (same
  `classifyTier()` logic as `conflicts`)

**4b. Unstaged working-tree cross-ref** — run `git diff --name-only` to get
all tracked files with unstaged modifications. Intersect with the drift zone.

- **No overlap** → no additional rebase blocker
- **Overlap** → `git rebase --continue` blocker risk (pair #3 in the
  2026-05-11 training data): git treats any unstaged tracked file as potential
  unresolved conflict state, even when that file has no conflict markers.
  The fix is `git checkout HEAD -- <file>` before continuing — not `git add`.

These are orthogonal: a file can be in both sets, either one, or neither.
Both are surfaced in output with distinct labels so the operator knows
which risk they're looking at.

### Step 5 — Output

**Human-readable (default):**

```
🕷️ REMOTE DRIFT — "main"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Remote is 3 commits ahead of local.

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

**JSON (`--json`):**

```json
{
  "branch": "main",
  "remote": "origin/main",
  "local_ahead": 2,
  "remote_ahead": 3,
  "state": "diverged",
  "drift_zone": ["canopy/tasks.md", "CONSORTIUM-cat-A.md", "docs/PAPER_finetune_findings.md"],
  "registered_in_drift": [
    { "file": "CONSORTIUM-cat-A.md", "tier": 2, "unstaged": true },
    { "file": "docs/PAPER_finetune_findings.md", "tier": 3, "unstaged": false }
  ],
  "unstaged_in_drift": [
    { "file": "CONSORTIUM-cat-A.md", "registered": true }
  ],
  "safe_to_push": false,
  "rebase_continue_risk": true,
  "recommendation": "rebase_with_conflict_prep"
}
```

### Step 6 — Hub notification (`--hub-sync`)

If `--hub-sync` is passed and there are registered files **or unstaged files**
in the drift zone, post to Hub chat:

```
🕷️⚠️ Remote drift detected on `main`
  3 commits ahead | 2 registered files at risk | 1 rebase-continue blocker
  🟠 CONSORTIUM-cat-A.md  [also has unstaged modifications]
  🔴 docs/PAPER_finetune_findings.md
  Recommended: pre-build merge content before rebasing.
```

### Step 7 — Exit code (`--strict`)

`--strict` causes exit 1 if `registered_in_drift` **or `unstaged_in_drift`** is
non-empty. Both are blocker-class signals in the context of a rebase.

```bash
# .git/hooks/pre-push
spidersan pulse --remote-drift --strict || { echo "Fetch + resolve drift first"; exit 1; }
```

---

## Edge Cases

| Case | Behaviour |
|---|---|
| Not in a git repo | Error: "Not a git repository" |
| No remote configured | Skip drift check, print "No remote 'origin' found" |
| Detached HEAD | Skip drift check (can't determine branch) |
| Network unreachable | Print "⚠ Remote unreachable — drift check skipped" and continue |
| Branch not registered | Drift zone computed but no registry cross-reference; report all drifted files as unregistered |
| Remote branch doesn't exist yet (new branch) | N=0 by definition; report "Remote branch not found — safe to push (first push)" |
| Mid-rebase state | Print "⚠ Rebase in progress — run after completing or aborting rebase" |

---

## Implementation Notes

### Security

- All git calls: `execFileSync('git', [args])` — never string interpolation
- Remote name validated before use: only `origin` by default; configurable via
  `config.remote` (validated with `validateBranchName` which covers remote names)
- No user-supplied values interpolated into git args

### Where it lives

- Flag added to `src/commands/pulse.ts` as `.option('--remote-drift', 'Check if remote has advanced past local HEAD')`
- Core logic extracted to `src/lib/remote-drift.ts` so `watch.ts` can reuse it
  for the `--fetch-poll` integration (see §Future Work)

### Helper functions (`src/lib/remote-drift.ts`)

```typescript
// Returns how many commits remote is ahead / local is ahead
function getAheadBehind(remote: string, branch: string): { ahead: number; behind: number }

// Returns union of files touched by commits in remote that local doesn't have
function getDriftZone(remote: string, branch: string): string[]

// Returns tracked files with unstaged modifications (git diff --name-only)
function getUnstagedTrackedFiles(): string[]

// Classifies drift zone files against registry + unstaged set
function classifyDriftZone(
  driftFiles: string[],
  registeredFiles: string[],
  unstagedFiles: string[],
): DriftEntry[]

interface DriftEntry {
  file: string;
  registered: boolean;
  tier: 1 | 2 | 3 | null;  // null = not registered
  unstaged: boolean;        // true = git rebase --continue blocker risk
}

interface DriftResult {
  localAhead: number;
  remoteAhead: number;
  state: 'synced' | 'local_ahead' | 'remote_ahead' | 'diverged';
  driftZone: string[];
  registeredInDrift: DriftEntry[];
  unstagedInDrift: DriftEntry[];   // entries where unstaged=true (may overlap registeredInDrift)
  safeToPush: boolean;
  rebaseContinueRisk: boolean;     // true if unstagedInDrift is non-empty
  recommendation: 'push_clean' | 'pull_rebase' | 'rebase_clean' | 'rebase_with_conflict_prep';
}
```

---

## Future Work

### `spidersan watch --fetch-poll <seconds>`

Extend `watch.ts` to periodically call `getDriftZone()` (from `remote-drift.ts`)
on a timer, without a `git fetch` — use `git ls-remote origin <branch>` (cheaper,
no full object download) to check if remote HEAD has moved, then fetch only if
it has.

```bash
spidersan watch --fetch-poll 60   # check remote every 60s
spidersan watch --hub-sync --fetch-poll 120  # post to Hub when drift detected
```

When drift is detected mid-watch, print:

```
⚠  [10:31] Remote drifted: origin/main is now 2 commits ahead.
   Drift zone: CONSORTIUM-cat-A.md (🟠 TIER 2)
   Recommended: pause work, fetch + inspect before next commit.
```

This would have prevented the 2026-05-11 incident: yosef would have seen the
drift alert before attempting the first push.

### Pre-push hook scaffolding

`spidersan init` could optionally install a `.git/hooks/pre-push` that runs
`spidersan pulse --remote-drift --strict`, gating every push on a clean drift
check. Opt-in only.

---

## Acceptance Criteria

- [ ] `spidersan pulse --remote-drift` runs `git fetch origin` and reports drift state
- [ ] Drifted files cross-referenced against spidersan registry with tier classification
- [ ] Drifted files cross-referenced against `git diff --name-only` (unstaged tracked files); overlap flagged as `rebase_continue_risk`
- [ ] `--json` output includes `unstaged_in_drift` array and `rebase_continue_risk` boolean
- [ ] Human output shows `[unstaged modification ⚠]` label and separate warning line for rebase-continue blockers
- [ ] `--hub-sync` posts to Hub when registered **or unstaged** files are in drift zone
- [ ] `--strict` exits 1 when `registered_in_drift` or `unstaged_in_drift` is non-empty
- [ ] All git calls use `execFileSync` with argv array (no string interpolation)
- [ ] Offline / no-remote / detached-HEAD / mid-rebase all degrade gracefully
- [ ] `src/lib/remote-drift.ts` exports `getDriftZone`, `getUnstagedTrackedFiles`, `classifyDriftZone` for `watch --fetch-poll` reuse
- [ ] Tests in `tests/remote-drift.test.ts` covering: synced, remote-ahead-no-overlap, remote-ahead-registered-overlap, remote-ahead-unstaged-overlap, diverged-both, offline
