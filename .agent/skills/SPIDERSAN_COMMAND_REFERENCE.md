---
description: Coordinate multi-agent branch work with Spidersan — conflict detection (including real GitHub PR checks), merge ordering, stale cleanup, and systemwide repo sync
---

# /spidersan — Branch Coordination & Repo Sync

Use Spidersan to coordinate parallel agent branches, detect file conflicts before they happen, find optimal merge order, and keep the registry clean.

## When to Use

- Starting work on a new branch (register it)
- Before merging any branch (check conflicts + ready-check)
- Reviewing what branches are active across a repo
- Finding stale or abandoned branches to clean up
- Auditing all repos systemwide for branch health
- Deep tidying branches — triage, merge, cherry-pick, abandon across one or all repos
- Installing the auto-register CI workflow in a new repo

## Architecture

Spidersan stores a `.spidersan/registry.json` in each repo. Each entry records:
- Branch name + owning agent
- Files being modified
- Last updated timestamp
- Status (active / merged / abandoned)

Conflict tiers:
| Tier | Meaning | Action |
|------|---------|--------|
| 🔴 TIER 1 | Same file, likely overwrite | **Block** — coordinate immediately |
| 🟠 TIER 2 | Same file, may be compatible | **Pause** — coordinate before merging |
| 🟡 TIER 3 | Adjacent files | **Warn** — be aware |

## ⚠️ Blind spots — read this first

Spidersan's local commands (`conflicts`, `merge-order`, `ready-check`, `list`) read **only** the
local `.spidersan/registry.json` **by default**. Plain `spidersan conflicts` (no flags) is
**blind** to:

1. **Cloud / unregistered branches** — e.g. Claude Code `claude/*` branches, or any branch whose
   author never ran `register`. Plain `conflicts` will say "✅ no conflicts" while a real file
   overlap exists on a PR. (Bit us 2026-06-15: #179 `claude/*` overlapped #180 on
   `Step4InventoryScreen.tsx`; local `conflicts` saw nothing.)

   **Largely closed as of v0.11.0** (spidersan-oss #256/#258/#259, merged 2026-06-28) —
   `spidersan conflicts --pr <N> --real` computes a **true `git merge-tree` conflict** for that
   PR against trunk, registry-independent. `--vs-prs` extends this to check a branch/PR against
   *every other open PR*, not just registered branches. This is now the first thing to reach for
   before merging a PR — see "Pre-Merge Check via GitHub" below. It still requires the explicit
   flag; a bare `conflicts` call remains registry-only.
2. **CI / build state** — registry knows files, not whether a PR's `build`/`e2e` checks pass.
   Use `gh pr view <N> --json statusCheckRollup,mergeable,mergeStateStatus` — `mergeable_state`
   via `gh api repos/<owner>/<repo>/pulls/<N>` is more reliable than the `gh pr view` `mergeable`
   field, which is frequently `UNKNOWN` until GitHub finishes computing it.
3. **A different central DB** — RT's CI registers PRs to RT's *own* Supabase; `cross-conflicts`
   reads spidersan's *central* DB (a different project). They don't see each other.
4. **Sibling / worktree branches that were never pushed** — a concurrent instance working in
   another git worktree (e.g. `~/Dev/<repo>-<agent>/`) can have an *unpushed* branch that already
   built the same files. `merge-tree` vs `origin/main` comes back CLEAN (the overlap isn't on main
   yet), and `register` may even mis-attribute your files to that instance. (Bit us 2026-06-28:
   two instances independently wrote `src/lib/security-policy.ts` on different branches; neither
   `conflicts` nor `merge-tree`-vs-main saw it.)
5. **Non-conflict repo hygiene** — a stale `.gitignore` that misses newly-added local-state files
   (e.g. a tool starts writing `backup/` after an earlier commit only untracked its old output
   files) shows up as `git status` noise forever, not a branch conflict. Spidersan doesn't scan
   for this — it's a `/doc-review` or `/node-review` concern, not a branch-coordination one.

**Authoritative for real merge-safety:** `npx spidersan conflicts --pr <N> --real` (or `--vs-prs`
for cross-PR checks) now covers most of what previously required shelling out manually. Still
useful for anything the CLI doesn't cover: `npx spidersan github-sync` (live GitHub branch/PR/CI),
`gh pr list --json files,mergeable,mergeStateStatus`, `gh api repos/<owner>/<repo>/pulls/<N>`
(for a reliable `mergeable_state`), and `git merge-tree --write-tree A B` directly. Use the
registry for *intent broadcasting*; use GitHub (or `--real`/`--pr`) for *the merge decision*.

**Before a PR, also check against the SIBLING branch, not just main** (closes blind spot 4):
```bash
git worktree list                                  # any concurrent worktree on a related branch?
git merge-tree --write-tree HEAD <sibling-branch>  # true content-conflict vs that branch
git cherry-pick <their-commit>                     # an `AA` (both-added) on a new file = someone
                                                   #   already built it → defer / salvage, don't dup
```
And confirm your own HEAD first — `git rev-parse --abbrev-ref HEAD` — the harness branch snapshot
can be stale, so you may be committing on a different branch than you think.

## Quick Reference

**Core — per-branch coordination**
| Command | Purpose |
|---------|---------|
| `npx spidersan init` | Initialize in current repo (creates `.spidersan/`) |
| `npx spidersan register --files "src/foo.ts,lib/bar.ts"` | Register branch + files you're editing |
| `npx spidersan list` | List all registered branches |
| `npx spidersan conflicts` | Detect conflicts with other branches (registry-only — see Blind spots) |
| `npx spidersan conflicts --pr <N> --real` | **True** `git merge-tree` conflict for PR #N vs trunk (registry-independent, v0.11.0+) |
| `npx spidersan conflicts --pr <N> --vs-prs --real` | …plus check against every other open PR |
| `npx spidersan conflicts --real --all [--exit-code]` | Real merge-tree check across every active registered branch; `--exit-code` for CI gating |
| `npx spidersan merge-order` | Get optimal merge sequence (registry-only) |
| `npx spidersan ready-check` | Verify branch has no file conflicts (WIP markers advisory) |
| `npx spidersan depends <branches...> [--branch <name>] [--clear]` | Set/show/clear branch dependencies (orders merge) |

**GitHub / fleet — authoritative cross-repo + cross-machine**
| Command | Purpose |
|---------|---------|
| `npx spidersan github-sync` | **Live** branch/PR status from GitHub — sees cloud PRs the registry can't |
| `npx spidersan github-sync --ci` | …plus CI/Actions status (slower) |
| `npx spidersan github-sync --all [--json]` | Sync every repo in `.spidersan/repos.json`; JSON for scripts |
| `npx spidersan fleet-status` | git sync status (ahead/behind) for every repo in `~/Dev` |
| `npx spidersan sync-advisor` | Scan repos + recommend push/pull/cleanup actions |
| `npx spidersan registry-sync --status\|--push\|--pull [--repo <name>]` | Sync registry to/from Supabase (cross-machine awareness) |
| `npx spidersan cross-conflicts [--local]` | Conflicts across machines via Supabase (central DB; `--local` = no Supabase) |
| `npx spidersan pulse [--remote-drift [--strict]]` | Colony sync → conflicts; `--remote-drift` fetches origin + flags drift zone (`--strict` exits non-zero) |
| `npx spidersan git-watch` | Subscribe to GitHub-webhook git-change notifications |

**Hygiene + diagnosis**
| Command | Purpose |
|---------|---------|
| `npx spidersan stale` | Show branches not updated in >7 days |
| `npx spidersan cleanup` | Remove stale/orphan entries from registry |
| `npx spidersan sync` | Reconcile registry with actual git branches |
| `npx spidersan abandon <branch>` / `merged <branch>` | Mark branch abandoned / merged |
| `npx spidersan rescue` | Scan for + salvage rogue/unregistered work |
| `npx spidersan rebase-helper` | Detect a stuck local rebase + non-interactive resolution guidance |
| `npx spidersan doctor [--fix] [--remote]` | Diagnose issues; `--fix` installs Colony hook; `--remote` = ahead/behind table |
| `npx spidersan config show\|get <path>\|set <path> <value>\|wizard` | View/edit configuration |

**Watch / live**
| Command | Purpose |
|---------|---------|
| `npx spidersan watch` | Auto-register file changes as you work (daemon) |
| `npx spidersan auto start\|stop` | Background file-watcher shortcuts |
| `npx spidersan dashboard` | Real-time TUI dashboard (4 panels) |

**Orchestration — decompose + fan out work**
| Command | Purpose |
|---------|---------|
| `npx spidersan torrent create <task-id>` / `status` / `complete <id>` / `merge-order` / `tree` | **Sequential** task decomposition into ordered branches |
| `npx spidersan queen spawn` / `status` / `dissolve <signal-id>` | **Parallel** fan-out to multiple sub-spidersans at once |
| `npx spidersan bot` | Message-driven git-operations daemon (via smalltoak) |

**Activity log + daily bridge**
| Command | Purpose |
|---------|---------|
| `npx spidersan log [--since 7d --branch <name>]` | Branch operation history (L1) |
| `npx spidersan daily [--branch <name>] [--tldr\|--context\|--dates]` | Branch-relevant daily-collab entries (L2) |
| `npx spidersan welcome` | Onboarding ritual — start here if new |

**Insight + AI-assisted** (the `ai-*`/`ask` paths need a local LLM loaded — `lms load <model>`)
| Command | Purpose |
|---------|---------|
| `npx spidersan context` | Aggregated repo context — registry + conflicts + git + colony in one view |
| `npx spidersan explain <branch>` | Explain a branch's purpose, owner, status, and conflicts |
| `npx spidersan advise` | Heuristic recommendations for the current repo state |
| `npx spidersan ask "<question>"` | Natural-language query over coordination state (needs loaded LLM; same blind registry as `conflicts`) |
| `npx spidersan ai-setup` / `ai-ping` / `ai-telemetry` | Configure / health-check / inspect the AI-assist subsystem |

## Common Workflows

### 1. Start of Work — Register Your Branch

Always do this when starting a new branch:

```bash
git checkout -b feat/my-feature
npx spidersan register --files "src/foo.ts,src/bar.ts"
```

Or let spidersan auto-detect changed files:
```bash
npx spidersan register --auto
```

### 2. Pre-Merge Check

Before opening a PR or merging:

```bash
npx spidersan conflicts       # Any TIER 1/2 blocks? (registry-only)
npx spidersan ready-check     # All clear?
npx spidersan merge-order     # Where do I fit in the queue?
```

### 3. Pre-Merge Check via GitHub (real conflicts, v0.11.0+)

Once a PR exists, prefer the real-conflict check over the registry-only one — it catches
conflicts on branches that never ran `register` (the #1 blind spot above):

```bash
npx spidersan conflicts --pr <N> --real            # true merge-tree conflict vs trunk
npx spidersan conflicts --pr <N> --real --vs-prs   # ...and against every other open PR
npx spidersan conflicts --pr <N> --real --gate     # also check precondition() needs-* labels
```

If it reports clean but you still suspect a conflict, cross-check directly:
```bash
gh api repos/<owner>/<repo>/pulls/<N> --jq '{mergeable,mergeable_state}'
```
`mergeable_state: "dirty"` is a real conflict even when CI is green — CI ran before the conflicting
commit landed on trunk. `gh pr view`'s `mergeable` field is often `"UNKNOWN"` right after a push;
the `gh api` form is more reliable.

### 4. Systemwide Repo Audit

To review all registered branches across a repo:

```bash
npx spidersan list            # All branches + files + age
npx spidersan stale           # Branches older than 7 days
npx spidersan sync            # Remove orphan entries (branches deleted from git)
npx spidersan cleanup         # Remove stale entries from registry
```

### 5. Install Auto-Register CI (New Repos)

Automatically register branches on push via GitHub Actions:

```bash
# Copy workflow from spidersan-oss
mkdir -p .github/workflows
cp ~/Dev/spidersan/.github/workflows/auto-register.yml .github/workflows/
git add .github/workflows/auto-register.yml
git commit -m "feat: add spidersan auto-register workflow"
git push origin main
```

Or run the install script:
```bash
bash ~/Dev/spidersan/.claude/skills/install-auto-register.sh
```

What it does: on every push, the workflow detects changed files and runs `spidersan register` automatically — so agents don't have to remember to register.

### 6. Rescue Mode (Rogue Work)

If an agent has been working without registering:

```bash
npx spidersan rescue
```

Scans for uncommitted/unregistered work and helps register it retroactively.

### 7. Resolve TIER 2 Conflicts

When `spidersan conflicts` shows a TIER 2 pause:

```bash
# See exactly which files overlap
npx spidersan conflicts

# Check actual diff
git diff origin/main...origin/<conflicting-branch> -- <shared-file>

# Coordinate: merge the other branch first, then rebase
git fetch origin
git rebase origin/<other-branch>
npx spidersan merge-order     # Re-check order after rebase
```

## Initialization Checklist (New Repo)

```bash
cd ~/Dev/<new-repo>
npx spidersan init            # Creates .spidersan/
npx spidersan welcome         # Guided setup (optional)
npx spidersan register --auto # Register current branch
```

Add `.spidersan/registry.json` to git (it's the shared coordination file):
```bash
# DO commit .spidersan/registry.json — it's the coordination state
# DON'T add to .gitignore
```

### 8. Remote Drift Detection (v0.9.0+)

**What it solves:** The `pulse --remote-drift` command is the proactive complement to conflict detection. It fetches `origin` and identifies commits on the remote that your local HEAD doesn't have, then cross-references the affected files against:
1. **Registered branch files** (with tier classification) — rebase will likely conflict
2. **Unstaged working-tree files** — these block `git rebase --continue` even after conflict markers are resolved (the root cause of the 2026-05 rebase-chaos incident)

**Use before pushing or rebasing** — especially in long sessions where the remote may have advanced while you worked.

```bash
# On-demand check — fetch origin + show drift zone
npx spidersan pulse --remote-drift

# Gate a push script — exits 1 if any registered/unstaged file is in drift zone
npx spidersan pulse --remote-drift --strict

# Post result to Hub chat
npx spidersan pulse --remote-drift --hub-sync

# Machine-readable output
npx spidersan pulse --remote-drift --json
```

**Reading the output:**
```
📡 REMOTE DRIFT — "feat/my-feature"
Remote is 3 commit(s) ahead | local is 1 ahead
State: diverged | Recommendation: fetch and rebase

Drift zone:
  src/auth.ts        [registered — tier 2]
  CONSORTIUM.md      [registered — tier 2, unstaged ⚠]

⚠️ 2 registered file(s) in drift zone — rebase will conflict.
⚠️ 1 file(s) with unstaged modifications — git rebase --continue may block.
   Fix: git checkout HEAD -- CONSORTIUM.md
```

**If unstaged files appear:** run `git checkout HEAD -- <file>` (not `git add`) to unblock `git rebase --continue`. Using `git add` on a file with no conflict markers causes git to treat the rebase step as "continue" but then immediately block again on the next iteration.

**MCP tool:** `pulse_remote_drift` is available in the Spidersan MCP server (v0.9.0+):
```
pulse_remote_drift(repo?: string, strict?: boolean)
```



When Colony is configured, use `spidersan pulse` to bring your local registry up to date with the whole fleet before checking conflicts:

```bash
# Sync from Colony then show conflicts
spidersan pulse

# Check what the whole fleet is touching across machines
spidersan cross-conflicts

# Local-only cross-conflicts (no Supabase needed)
spidersan cross-conflicts --local

# Auto-install Colony hook in current repo if missing
spidersan doctor --fix
```

**Environment variables needed:**

| Variable | Purpose |
|----------|---------|
| `COLONY_SUPABASE_URL` | MycToak project URL — for reading Colony state |
| `COLONY_SUPABASE_KEY` | Supabase anon key — no JWT needed (migration 025) |
| `COLONY_SESSION_ID` | Set by `envoak colony enlist` — needed for emitting signals |
| `COLONY_AGENT_KEY_ID` | Your agent key UUID — needed for emitting signals |

**Hook auto-install:** `spidersan init` now installs the Colony `post-checkout` hook automatically and configures `~/.git-template/hooks/` for future clones. For repos initialized before this feature, run `spidersan doctor --fix`.

## Repos with Spidersan Initialized

A static repo list here always drifts stale. Get the live answer instead:
```bash
find ~/Dev -maxdepth 2 -type d -name .spidersan   # every repo spidersan is initialized in, right now
```

## Notes

- Registry is per-repo — `cd` into the target repo before running commands
- `spidersan conflicts` checks against the **current branch** by default
- The `sync` command only removes orphaned registry entries — it does NOT do `git pull`
- Stale threshold is 7 days by default (configurable via `spidersan config`)

### 9. Branch Tidy (Deep Cleanup)

When a repo has accumulated many stale, superseded, or zombie branches — run a full tidy. This goes beyond `sync`/`cleanup` by comparing every branch against main and making merge/abandon decisions.

**Trigger:** `/spidersan tidy` or `/spidersan tidy <repo>` or `/spidersan tidy ALL`

**Protocol:**

#### Step 1: Inventory
For each registered branch (and unregistered git branches), check:
```bash
git log main..<branch> --oneline    # Unique commits ahead of main
git diff main...<branch> --stat     # Files changed
```

Classify each branch:
- **0 commits ahead** → ABANDON (already merged or never diverged)
- **Has commits, but changes are on main** → ABANDON (superseded)
- **Has unique commits, clean diff** → MERGE candidate
- **Has unique commits, overlaps with other branches** → CHERRY-PICK candidate
- **Has unique commits, needs inspection** → REVIEW

**For any REVIEW branch or branch with unexpected deletions**, run the daily cross-reference before deciding:
```bash
npx spidersan daily --branch <branch-name> --tldr
```
This surfaces collab context: who created it, why, what session it belongs to. Often resolves "is this malicious or just stale?" in seconds.

> **Example:** A branch deleting 300 lines of server.js looked dangerous — `spidersan daily --branch copilot-worktree-2026-02-17T15-42-22` revealed it was a Copilot fork from Feb 17 that predated Birdsan's Feb 19 correspondence feature. Stale fork, not sabotage. Decision: cherry-pick safe files, skip server.js.

#### Step 2: Triage Report
Present a summary table:

```
| Branch | Commits | Verdict | Reason |
|--------|---------|---------|--------|
| feat/x | 0       | ABANDON | Fully merged |
| fix/y  | 3       | MERGE   | Clean security fix |
| wip/z  | 1       | CHERRY-PICK | Take tests, skip scripts |
```

#### Step 3: Execute (with user approval)
1. **ABANDON** — mark abandoned in registry via MCP `mark_abandoned` or `npx spidersan abandon`
2. **MERGE** — merge in recommended order, resolve conflicts
3. **CHERRY-PICK** — `git cherry-pick --no-commit`, unstage unwanted files, commit clean subset
4. **Delete git branches** — after marking in registry, `git branch -d` (or `-D` for branches with remote tracking but 0 commits ahead)

#### Step 4: Verify
```bash
npx spidersan list --status active  # Should be just main + real WIP
npx spidersan conflicts             # Should be minimal/zero
```

#### Multi-Repo Tidy
When `tidy ALL` is requested, discover the repo list live instead of trusting a hardcoded one
(see "Repos with Spidersan Initialized" above) and iterate over it:
```bash
find ~/Dev -maxdepth 2 -type d -name .spidersan -exec dirname {} \;
```

For each repo:
1. `npx spidersan sync` + `npx spidersan cleanup` (quick pass)
2. If branches remain, run full triage protocol above
3. Report per-repo summary

#### Decision Rules
- Branches with **0 commits ahead of main** are always safe to abandon/delete
- **Superseded branches** (same changes already on main via another branch) → abandon
- **Duplicate work** (two branches doing the same thing) → keep the more comprehensive one
- **Shell scripts with hardcoded paths or `--no-verify`** → never merge, always skip
- **Unresolved merge conflict markers in committed files** → corrupted, abandon
- When cherry-picking, always unstage files that are already on main to avoid no-op conflicts

### 10. Activity Log + Daily Bridge (L1 + L2)

Spidersan now tracks a persistent event log and can cross-reference the treebird-internal daily collab.

#### Activity Log (L1)

Every `register`, `merge`, `abandon` emits a local event to `~/.spidersan/activity.jsonl` (flushes to Supabase on sync).

```bash
spidersan log                          # Last 24h across all branches
spidersan log --since 7d               # Last week
spidersan log --branch feat/foo        # One branch's history
spidersan log --agent ssan             # One agent's operations
spidersan log --json                   # Machine-readable
```

#### Daily Bridge (L2)

Reads `treebird-internal/collab/daily/` and filters for branch-relevant entries. Respects `TREEBIRD_INTERNAL` env var.

```bash
spidersan daily                        # Today's relevant entries
spidersan daily --tldr                 # One-liner per entry
spidersan daily --date 2026-02-25      # Specific date
spidersan daily --lookback 7           # Last N days
spidersan daily --branch feat/foo      # All mentions of this branch
spidersan daily --agent birdsan        # Filter by agent
spidersan daily --all                  # All entries (not just branch-relevant)
spidersan daily --dates                # List available daily files
spidersan daily --context --branch x   # Unified: activity log + daily mentions
```

#### When to Use

| Situation | Command |
|-----------|---------|
| Branch with unexpected deletions | `spidersan daily --branch <name> --tldr` |
| "Who created this and why?" | `spidersan daily --branch <name>` |
| "What happened in the repo last week?" | `spidersan daily --lookback 7` |
| Full triage context for a branch | `spidersan daily --context --branch <name>` |
| Check fleet health at session start | `spidersan doctor --remote` |

#### Config

Set in `.spidersanrc` or env vars:
```bash
TREEBIRD_INTERNAL=~/Dev/treebird-internal   # daily bridge path root
TREEBIRD_DAILY=~/Dev/treebird-internal/collab/daily  # override daily dir directly
```

---

## Troubleshooting

### "Not a spidersan repo"
Run `npx spidersan init` first.

### Registry out of sync after branch deletions
Run `npx spidersan sync` to clean orphan entries, then `npx spidersan cleanup` to remove stale ones.

### Conflicts showing on already-merged branches
Mark them: `npx spidersan merged <branch-name> --force`

### `spidersan stale` shows nothing but registry is bloated
Branches may be freshly updated — check `npx spidersan list` for full view including timestamps.

---

## Spidersan Process & Registry Hygiene

### Ghost Branch → Watcher Feedback Loop

**Symptom:** `spidersan watch` log grows unboundedly — same file registered + conflict detected in an infinite loop. Watcher at 90–100% CPU.

**Cause:** A branch deleted from git but still in the registry claims files the watcher keeps re-registering. Each registration triggers a conflict → log → re-register cycle.

```bash
spidersan list        # spot branches missing from git
spidersan sync        # removes orphaned registry entries
spidersan conflicts --strict  # confirm exit 0
```

**Prevention:** Always run `spidersan sync` after merging or deleting branches.

### LaunchAgent-Managed Watchers (KeepAlive)

`kill <pid>` won't stop a watcher managed by a LaunchAgent with `KeepAlive: true` — launchd restarts it immediately.

```bash
# Diagnose: PPID = 1 means launchd-managed
ps -eo pid,ppid,command | grep "spidersan watch"

# Find the plist
grep -rl "spidersan watch" ~/Library/LaunchAgents/

# Stop properly
launchctl unload ~/Library/LaunchAgents/<plist-name>.plist

# Restart
launchctl load ~/Library/LaunchAgents/<plist-name>.plist
```

### Phantom MCP Processes

Each Claude Code / IDE session can spawn a new MCP instance without cleaning up old ones. Check periodically:

```bash
ps aux | grep -E "mcp-server|envoak mcp" | grep -v grep
# Kill all but the newest PID of each type
spidersan mcp-health --kill-zombies   # or kill manually
```

### Treesync Conflict Gating

Treesync runs `spidersan conflicts --strict` before auto-committing. If it skips commits unexpectedly:

```bash
spidersan conflicts      # see what's blocking
spidersan sync           # most common fix: ghost branch in registry
spidersan conflicts --strict  # confirm exit 0 → treesync will proceed
```

Treesync fails safe: if spidersan times out or isn't installed, it proceeds without blocking.
