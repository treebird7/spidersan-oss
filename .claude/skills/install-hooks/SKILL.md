---
name: install-hooks
description: Install or update the spidersan Claude-Code hooks (autoreg, pre, post) on any flock machine — pre-flight drift diff, copy, settings.json wiring, Supabase env check, verify, ledger. Use when setting up a new machine, when hooks fire stale warnings (e.g. squash-merge phantoms from an old binary), or when asked to "install/update spidersan hooks".
---

# /install-hooks — spidersan hooks on any machine

Canonical hook source: **`~/treebird-shared/hooks/`** (Syncthing-synced, already on
every flock machine). Live copies run from `~/.claude/hooks/` (NOT a git repo).
Full rationale: `~/treebird-shared/hooks/README.md` + `INSTALL-m2-i7.md`;
per-hook failure modes: `treebird/canopy/spidersan-hooks-v2-report_16-06-26.md`.

> ⚠️ Do NOT install from `~/treebird-shared/spidersan/claude-hooks/` — stale v2.0 copy.

## What gets installed

| Hook | Event | Gives you |
|------|-------|-----------|
| `spidersan-autoreg.sh` | PostToolUse(Write\|Edit\|MultiEdit\|NotebookEdit) | Every file edit auto-registers branch + changed files. Never touches main/master; only in repos with `.spidersan/`. |
| `spidersan-pre.sh` | PreToolUse(Bash) | Dangerous-`rm` hard block + advisories: force-push guard, `gh pr merge` precheck, conflicts advisory, concurrent-checkout busy guard. |
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
overwriting — a raw copy can silently drop behaviors the local copy gained:

```bash
for f in spidersan-pre.sh spidersan-post.sh spidersan-autoreg.sh; do
  [ -f ~/.claude/hooks/$f ] && { echo "== $f"; diff ~/.claude/hooks/$f ~/treebird-shared/hooks/$f; }
done
# post hook drifted? also diff against the merged variant:
diff ~/.claude/hooks/spidersan-post.sh ~/treebird-shared/hooks/spidersan-post-m5-merged.sh
```

If the LOCAL copy has behaviors the shared one lacks: merge by hand, then push the
merged version BACK to `~/treebird-shared/hooks/` (that's how `-m5-merged` was born).

## 2. Copy + chmod

> Claude Code's P-3 config guard blocks **agents** from writing `~/.claude/**` — a
> human runs this step (or `P3GUARD_OFF=1 claude`). Print the block for them to paste.

```bash
mkdir -p ~/.claude/hooks
SRC=~/treebird-shared/hooks
cp "$SRC/spidersan-pre.sh"            ~/.claude/hooks/spidersan-pre.sh
cp "$SRC/spidersan-post-m5-merged.sh" ~/.claude/hooks/spidersan-post.sh
cp "$SRC/spidersan-autoreg.sh"        ~/.claude/hooks/spidersan-autoreg.sh
chmod +x ~/.claude/hooks/spidersan-{pre,post,autoreg}.sh
```

## 3. Wire into `~/.claude/settings.json` (merge into existing matchers)

```jsonc
"hooks": {
  "PreToolUse": [
    { "matcher": "Bash", "hooks": [ { "type": "command", "command": "~/.claude/hooks/spidersan-pre.sh", "timeout": 10 } ] }
  ],
  "PostToolUse": [
    { "matcher": "Bash", "hooks": [ { "type": "command", "command": "~/.claude/hooks/spidersan-post.sh", "timeout": 10 } ] },
    { "matcher": "Write|Edit|MultiEdit|NotebookEdit", "hooks": [ { "type": "command", "command": "~/.claude/hooks/spidersan-autoreg.sh", "timeout": 10 } ] }
  ]
}
```

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
bash ~/treebird-shared/hooks/test-hooks.sh          # fixture harness, 16 checks
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
- spidersan hooks installed <date> from treebird-shared/hooks (pre 2.2 / post 2.1-m5 / autoreg 1.1) — binary <version/commit>
```

## Requirements + knobs

- Needs `jq`, `git`, `python3`, spidersan on PATH (`npx --no-install spidersan` works
  from checkouts; global covers `register --auto`).
- `SPIDERSAN_AUTOREG_QUIET=1` silences autoreg's stderr line (CI/pipelines).
- Commit-level announce is deliberately absent — GitHub webhooks →
  `spidersan_git_events` cover pushes server-side (bd `tb-ietd`).
