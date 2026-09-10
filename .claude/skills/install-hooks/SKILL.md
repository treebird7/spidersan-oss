---
name: install-hooks
description: Install or update the spidersan Claude-Code hooks (autoreg, pre, post) on any flock machine — pre-flight drift diff, copy, settings.json wiring, Supabase env check, verify, ledger. Use when setting up a new machine, when hooks fire stale warnings (e.g. squash-merge phantoms from an old binary), or when asked to "install/update spidersan hooks".
---

# /install-hooks — spidersan hooks on any machine

Canonical hook source: **`~/Dev/treebird/hooks/`** — git-tracked, so it has
history, review and a real backup. `git pull` in that repo is the distribution;
**pull before installing.** Live copies run from `~/.claude/hooks/` (NOT a git repo).

> `~/treebird-shared/hooks/` is now a compatibility mirror, kept in step by
> `hooks/sync-shared.sh --push`. Install from the repo; the mirror goes away once
> nobody reads it.
Full rationale: `~/treebird-shared/hooks/README.md` + `INSTALL-m2-i7.md`;
per-hook failure modes: `treebird/canopy/spidersan-hooks-v2-report_16-06-26.md`.

> ⚠️ Do NOT install from `~/treebird-shared/spidersan/claude-hooks/` — stale v2.0 copy.
> Two stale-copy incidents are on record; installing from git is what ends that class.

## What gets installed

| Hook | Event | Gives you |
|------|-------|-----------|
| `spidersan-autoreg.sh` | PostToolUse(Write\|Edit\|MultiEdit\|NotebookEdit) | Every file edit auto-registers branch + changed files. Never touches main/master; only in repos with `.spidersan/`. |
| `spidersan-pre.sh` (v2.5) | PreToolUse(Bash) | Dangerous-`rm` hard block + advisories: force-push guard, `gh pr merge` precheck, conflicts advisory, concurrent-checkout busy guard, branch-ownership warning, and dead-branch-on-push warning. |
| `spidersan-worktree-guard.sh` | SessionStart | Warns when this worktree already holds uncommitted work that isn't yours (invoak `sp-iocc`). Fires at session open, before the first tool call — `spidersan-pre.sh` #5/#6 only fire at `git add|commit`, which on 2026-09-04 was an hour too late. Pure git; no envoak call, no registry read, nothing persisted. Silent unless it fires. Identity (`BIRDCHAT_AGENT` → session-identity file → `TOAK_AGENT_ID`) only *suppresses* the warning for your own leftovers — at a fresh SessionStart none of those is set yet, so it warns without attribution rather than going quiet. |
| `spidersan-post-m5-merged.sh` → installed AS `spidersan-post.sh` | PostToolUse(Bash) | registry-sync to Supabase after `git push`, trunk-poison auto-heal after merges, auto-`register` on `git checkout -b`/`switch -c`. (`sangit-refresh` inside fails silently if absent — harmless.) |

Everything is fail-open except the dangerous-`rm` block — a hook bug can never block a push.

## 0. Binary freshness FIRST (the part the docs used to skip)

The hooks are only as good as the `spidersan` binary they call. `spidersan-pre.sh`
runs `spidersan conflicts --tier 2/3 --strict` — a stale binary re-introduces fixed
bugs (e.g. squash-merge phantom conflicts, fixed in #267 / tb-tr1z).

```bash
which spidersan && npm ls -g spidersan   # symlink → local checkout, or published pkg?
# npm-linked to a checkout:
cd ~/Dev/spidersan && git pull --rebase && npm run build
# published package:
npm i -g spidersan@latest
```

## 1. Pre-flight: diff, don't clobber (tb-q6mi)

Machines drift. If any `~/.claude/hooks/spidersan-*.sh` already exists, diff before
overwriting — a raw copy can silently drop behaviors the local copy gained.

Diff against `origin/main`, **not** against `~/Dev/treebird/hooks/`. That checkout is
shared and routinely parked on another agent's branch, so a drift check run against it
reports "no drift" when there is drift:

```bash
git -C ~/Dev/treebird fetch origin -q || echo "STOP: fetch failed — comparing against a stale origin/main"
for f in spidersan-pre.sh spidersan-post.sh spidersan-autoreg.sh; do
  [ -f ~/.claude/hooks/$f ] && { echo "== $f"; git -C ~/Dev/treebird show "origin/main:hooks/$f" | diff ~/.claude/hooks/$f -; }
done
# post hook drifted? also diff against the merged variant:
git -C ~/Dev/treebird show origin/main:hooks/spidersan-post-m5-merged.sh | diff ~/.claude/hooks/spidersan-post.sh -
```

If the LOCAL copy has behaviors the shared one lacks: merge by hand, then push the
merged version BACK to `~/Dev/treebird/hooks/` (that's how `-m5-merged` was born).

## 2. Copy + chmod

> Claude Code's P-3 config guard blocks **agents** from writing `~/.claude/**` — a
> human runs this step (or `P3GUARD_OFF=1 claude`). Print the block for them to paste.

Install reads `origin/main` directly, never the working tree. `~/Dev/treebird` is a
shared checkout: agents park it on feature branches, and it usually carries uncommitted
files, so `git pull --rebase` there fails (exit 128) while `cp` carries on regardless.
Either way you install a stale hook at exit 0 — that is how treebird#86 came to be
"installed" on m5 while the machine kept running the unpatched hook (`sp-q118`,
`sp-92jw`). `git show origin/main:` has no opinion about the branch or the dirt.

```bash
mkdir -p ~/.claude/hooks
git -C ~/Dev/treebird fetch origin -q || echo "STOP: fetch failed — everything below installs whatever you fetched last"

for f in spidersan-pre.sh spidersan-post-m5-merged.sh spidersan-autoreg.sh \
         spidersan-worktree-guard.sh untracked-skills.sh; do
  git -C ~/Dev/treebird show "origin/main:hooks/$f" > "/tmp/hk-$f" || echo "STOP: no origin/main:hooks/$f"
done

cp /tmp/hk-spidersan-pre.sh            ~/.claude/hooks/spidersan-pre.sh
cp /tmp/hk-spidersan-post-m5-merged.sh ~/.claude/hooks/spidersan-post.sh
cp /tmp/hk-spidersan-autoreg.sh        ~/.claude/hooks/spidersan-autoreg.sh
cp /tmp/hk-spidersan-worktree-guard.sh ~/.claude/hooks/spidersan-worktree-guard.sh
cp /tmp/hk-untracked-skills.sh         ~/.claude/hooks/untracked-skills.sh
chmod +x ~/.claude/hooks/spidersan-{pre,post,autoreg,worktree-guard}.sh ~/.claude/hooks/untracked-skills.sh
```

**The install is not done until this prints all OK.** A copy that never confirms its
destination is a hope, not an install: `cp` exits 0 and prints nothing whether it copied
the fix or an eight-week-old file.

```bash
check() {  # check <name-in-repo> <installed-path>
  want=$(git -C ~/Dev/treebird show "origin/main:hooks/$1" | shasum -a 256 | cut -d' ' -f1)
  got=$(shasum -a 256 < "$2" | cut -d' ' -f1)
  [ "$want" = "$got" ] && echo "OK       $2" || echo "MISMATCH $2 (want ${want:0:8}, got ${got:0:8})"
}
check spidersan-pre.sh            ~/.claude/hooks/spidersan-pre.sh
check spidersan-post-m5-merged.sh ~/.claude/hooks/spidersan-post.sh
check spidersan-autoreg.sh        ~/.claude/hooks/spidersan-autoreg.sh
check spidersan-worktree-guard.sh ~/.claude/hooks/spidersan-worktree-guard.sh
check untracked-skills.sh         ~/.claude/hooks/untracked-skills.sh
```

A `MISMATCH` on `spidersan-post.sh` alone may be the deliberate machine merge step 1
describes — confirm that is what it is. Anything else means the install did not take,
and the machine is still running the old hook.

## 3. Wire into `~/.claude/settings.json` (merge into existing matchers)

```jsonc
"hooks": {
  "PreToolUse": [
    { "matcher": "Bash", "hooks": [ { "type": "command", "command": "~/.claude/hooks/spidersan-pre.sh", "timeout": 10 } ] }
  ],
  "PostToolUse": [
    { "matcher": "Bash", "hooks": [ { "type": "command", "command": "~/.claude/hooks/spidersan-post.sh", "timeout": 10 } ] },
    { "matcher": "Write|Edit|MultiEdit|NotebookEdit", "hooks": [ { "type": "command", "command": "~/.claude/hooks/spidersan-autoreg.sh", "timeout": 10 } ] }
  ],
  "SessionStart": [
    { "hooks": [ { "type": "command", "command": "~/.claude/hooks/spidersan-worktree-guard.sh", "timeout": 10 } ] }
  ]
}
```

No `async: true` on the worktree guard either — its whole point is to reach the agent
*before* it touches the tree, and an async SessionStart hook races the first tool call.

No `async: true` on spidersan-post — the trunk-poison warning should reach the agent
synchronously. Restart Claude Code after editing.

## 4. Supabase env — without it, "announce" is silently a no-op

`spidersan-post.sh`'s registry-sync only reaches the shared registry if the shell has
treebird-runtime env (`SUPABASE_URL`/`SUPABASE_KEY`; runtime `ruvwundetxnzesrbkdzr`
owns `spider_registries` — see `Docs/ecosystem/SUPABASE_PROJECTS.md`):

```bash
echo "${SUPABASE_URL:?unset}" >/dev/null && echo ok
# unset → source it the way this machine's /dawn does (vault inject / agent .env);
# see ~/treebird-shared/machines/<machine>.md
```

## 5. Verify

```bash
bash ~/treebird-shared/hooks/test-hooks.sh          # fixture harness, 32 checks
# live smoke, in any spidersan-initialized repo inside a Claude session:
#   git checkout -b test/hook-smoke   → post hook registers it
#   edit any file                     → autoreg: "registered N file(s) …"
#   spidersan list                    → branch appears with files
#   git checkout - && git branch -D test/hook-smoke && spidersan sync
```

## 6. Ledger

Append one line to `~/treebird-shared/machines/<machine>.md` so the next drift-diff
has a baseline:

```
- spidersan hooks installed <date> from treebird-shared/hooks (pre 2.5 / post 2.1-m5 / autoreg 1.1) — binary <version/commit>
```

## Requirements + knobs

- `bash ~/treebird-shared/hooks/test-hooks.sh` is the required regression harness
  before trusting a changed pre-hook; it currently reports 32 checks.
- Needs `jq`, `git`, `python3`, spidersan on PATH (`npx --no-install spidersan` works
  from checkouts; global covers `register --auto`).
- `SPIDERSAN_AUTOREG_QUIET=1` silences autoreg's stderr line (CI/pipelines).
- Commit-level announce is deliberately absent — GitHub webhooks →
  `spidersan_git_events` cover pushes server-side (bd `tb-ietd`).
