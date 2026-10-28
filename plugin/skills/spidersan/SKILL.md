---
name: spidersan
description: Coordinate parallel branch work between AI coding agents with the spidersan CLI — register a branch, check real merge conflicts (git merge-tree, open PRs), order merges, and tidy stale or abandoned branches. Use before merging, when several agents share a repo, or when asked to triage or tidy branches.
---

# /spidersan — branch coordination for agent teams

Spidersan keeps a registry of which branch is changing which files, so agents working in
parallel can see overlap before it becomes a merge conflict. It also computes **real**
conflicts with `git merge-tree`, which no registry can.

Install the CLI with `npm i -g spidersan` (or prefix commands with `npx`). This skill also
ships inside the spidersan Claude Code plugin (`treebird7/spidersan-oss`), which adds hooks
that run these checks automatically.

## Two kinds of answer — know which one you have

| Question | Source | Commands |
|---|---|---|
| Who *intends* to change this file? | the registry (`.spidersan/registry.json`) | `register`, `list`, `conflicts`, `merge-order`, `ready-check` |
| Will these changes actually *merge*? | git and GitHub | `conflicts --real`, `conflicts --pr <N> --real`, `bin/pr-conflicts <N>` |

Plain `spidersan conflicts` reads only the registry. It is **blind** to:

1. **Branches nobody registered.** Cloud agent branches, a teammate's PR, anything pushed
   without `register`. The registry says "no overlap" while a PR touches the same file.
2. **CI state.** The registry knows files, not whether checks pass. Ask GitHub:
   `gh pr view <N> --json statusCheckRollup,mergeStateStatus`.
3. **Unpushed sibling worktrees.** Another agent's local branch in a different worktree
   can already contain the same new file. A merge against `origin/main` comes back clean
   because the overlap isn't on main yet.

So: use the registry to **announce intent**, and git/GitHub to **decide a merge**.

## Conflict tiers

| Tier | Label | Meaning |
|---|---|---|
| 🔴 3 | BLOCK | Critical file (secrets, auth, env). Resolve before merging. |
| 🟠 2 | PAUSE | Important file (package manifest, config, server). Coordinate first. |
| 🟡 1 | WARN | Other overlap. Safe to proceed with care. |

`--strict` makes `conflicts` exit non-zero when it finds TIER 2 or worse, which is what hooks
and CI gate on. `--tier <n>` only filters what is shown.

## Quick reference

**Per branch**

| Command | Purpose |
|---|---|
| `spidersan init` | Create `.spidersan/` in this repo |
| `spidersan register --files "src/a.ts,src/b.ts"` | Announce the files this branch changes |
| `spidersan register --auto` | Same, detected from your diff |
| `spidersan list` | All registered branches |
| `spidersan conflicts` | Registry overlap with other branches (see blind spots) |
| `spidersan conflicts --tier 2 --strict` | Exit 1 on TIER 2 or worse |
| `spidersan merge-order` | Suggested merge sequence (registry-based) |
| `spidersan ready-check` | No blocking overlap, no WIP markers |
| `spidersan depends <branches...>` | Declare branches that must merge first |

**Real merge checks**

| Command | Purpose |
|---|---|
| `spidersan conflicts --real` | `git merge-tree` of this branch against trunk |
| `spidersan conflicts --pr <N> --real` | Same for PR N, registry-independent |
| `spidersan conflicts --real --all --exit-code` | Every active registered branch, for CI |
| `spidersan conflicts --pr <N> --real --vs-prs` | ...plus file-*name* overlap with other open PRs (not a merge) |
| `<skill dir>/bin/pr-conflicts <N>` | Real merge of PR N against its base **and** against every other open PR |
| `spidersan pr-check <N>` | Stacked base, red or behind state |

**Hygiene**

| Command | Purpose |
|---|---|
| `spidersan sync` | Drop registry entries whose branch is gone from origin |
| `spidersan stale` / `cleanup` | Find / remove entries not updated recently |
| `spidersan abandon <branch>` / `merged <branch>` | Mark a branch done |
| `spidersan verify-trunk` | Trunk must claim no files (a poisoned trunk overlaps everyone) |
| `spidersan rebase-helper` | Diagnose a stuck local rebase |
| `spidersan log [--since 7d] [--branch <b>] [--agent <id>]` | Branch operation history |
| `spidersan doctor [--remote]` | Diagnose setup; `--remote` = ahead/behind per repo |

**Across machines** (optional; needs `SPIDERSAN_SUPABASE_URL` / `SPIDERSAN_SUPABASE_KEY`)

| Command | Purpose |
|---|---|
| `spidersan registry-sync --push` / `--pull` | Share the registry through Supabase |
| `spidersan cross-conflicts [--local]` | Overlap with other machines' branches |
| `spidersan github-sync [--ci]` | Live branch, PR and CI status from GitHub |

## Workflows

### Starting a branch

```bash
git checkout -b feat/my-change
spidersan register --files "src/foo.ts,src/bar.ts"
```

Confirm your own branch first (`git rev-parse --abbrev-ref HEAD`). In a shared checkout,
another session may have left it on a different branch.

### Before opening or merging a PR

```bash
spidersan conflicts            # anyone else announced these files?
spidersan ready-check
<skill dir>/bin/pr-conflicts <N>   # once the PR exists: the real answer
```

`pr-conflicts` merges PR N onto its base, then merges each other open PR onto that result,
and reports only conflicts a PR does *not* already have against the base. (Merging two PR
heads directly is wrong: a stale PR drags its base's changes in and blames N.) Exit 0 is
clean, 1 is conflicts, 2 means the check did not complete, never "clean". It needs `gh`,
`jq` and git 2.38 or newer.

If GitHub disagrees with a clean result, ask it directly:

```bash
gh api repos/<owner>/<repo>/pulls/<N> --jq '{mergeable,mergeable_state}'
```

`mergeable_state: "dirty"` is a real conflict even with green CI. `gh pr view`'s `mergeable`
is often `UNKNOWN` right after a push.

### Resolving a TIER 2 pause

```bash
spidersan conflicts                                    # which files overlap
git diff origin/main...origin/<other-branch> -- <file> # what the other branch did
git fetch origin && git rebase origin/<other-branch>   # if theirs should land first
spidersan merge-order
```

### Tidying branches (`/spidersan tidy`)

For a repo full of stale, superseded or abandoned branches.

1. **Inventory** every registered branch and every git branch:
   ```bash
   git log origin/main..<branch> --oneline   # unique commits
   git diff origin/main...<branch> --stat    # what it changes
   ```
2. **Classify**:
   - 0 commits ahead → ABANDON (merged, or never diverged)
   - changes already on main via another branch → ABANDON (superseded)
   - unique commits, clean merge → MERGE
   - unique commits, some files unwanted → CHERRY-PICK
   - unclear intent or unexpected deletions → REVIEW. Check its history first:
     `spidersan log --branch <b>` and `git log --format='%h %an %cs %s' origin/main..<b>`.
     A branch deleting 300 lines often turns out to be a stale fork, not sabotage.
3. **Report** a table (branch, commits, verdict, reason) and **wait for approval**.
4. **Execute**: `spidersan abandon`, merge in `merge-order`, `git cherry-pick --no-commit` and
   unstage what you don't want, then delete the git branches.
5. **Verify**: `spidersan list` shows only real work, `spidersan conflicts` is quiet.

Never merge a branch with unresolved conflict markers, or scripts with hard-coded paths or
`--no-verify`. Of two branches doing the same work, keep the more complete one.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Spidersan not initialized" | `spidersan init`, or `cd` into the repo first (the registry is per repo) |
| Conflicts with long-merged branches | `spidersan sync`, then `cleanup` |
| Trunk overlaps every branch | `spidersan verify-trunk`; the plugin's post-merge hook also repairs it |
| `watch` loops at high CPU on the same file | a deleted branch still claims it: `spidersan sync` |
| A watcher you killed comes back | it runs under a service manager (launchd `KeepAlive`, systemd); stop it there |
