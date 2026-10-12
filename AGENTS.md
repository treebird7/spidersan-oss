# Agent Instructions

Spidersan is a branch-coordination CLI for multi-agent coding: a registry of who
is touching which files, tiered conflict detection, and merge ordering. Build and
test with npm (`npm run typecheck`, `npm run build`, `npm run test:run`).
Every command takes `--help`; the long-form guide is
[docs/AGENT_GUIDE.md](docs/AGENT_GUIDE.md).

## Pre-merge loop

```bash
spidersan conflicts                                   # registry overlap for this branch
spidersan register -f "a.ts,b.ts" -a <agent> -d "what this branch does"
spidersan ready-check                                 # WIP markers + build check
spidersan conflicts --pr <N> --real --vs-prs          # authoritative check, right before merge
spidersan merged --pr <N>                             # after the merge lands
```

`conflicts --pr <N> --real --vs-prs` runs a real `git merge-tree` against trunk
**and** the overlap pass against other open PRs; the exit code is the worse of
the two. `--pr <N>` alone runs only the merge-tree half. Found conflicts (even
TIER 3) exit 0 by default; only errors exit 1. Read the report, or add `--exit-code` (real conflicts → exit 1) or
`--strict` (real conflicts or TIER 2+ overlap → exit 1) when gating a script.

## Commands by group

| Group | Commands |
|---|---|
| Registry | `init` `register` `list` `sync` `stale` `cleanup` `abandon` `merged` `depends` `registry-sync` |
| File claims | `claim <files> -a <agent>` · `release <files> -a <agent>` · `whos-here [file]` |
| Conflicts | `conflicts` (`--real`, `--pr`, `--vs-prs`, `--strict`, `--notify`, `--ecosystem`) · `cross-conflicts` · `pulse` |
| Merge planning | `merge-order` · `merge-plan` (open PRs + CI + real conflicts) · `pr-check <N>` · `mq run\|status` |
| Registry health | `verify-trunk [--fix] [--exit-code]` (trunk must claim no files) · `doctor [--remote]` |
| Recovery | `rescue --scan\|--symbols <branch>\|--salvage <file>` · `rebase-helper` |
| Work split | `torrent create\|decompose\|status\|complete\|tree\|merge-order` (sequential) · `queen` (parallel) |
| Watching | `watch` · `auto` · `git-watch` · `dashboard` |
| AI | `ask` `advise` `explain` `context` `ai-ping` `ai-setup` |

The full list is `spidersan --help` (source of truth: `src/bin/command-registry.ts`).

## Conflict tiers

`src/lib/conflict-tier.ts` classifies each overlapping file by path:

| Tier | Label | Built-in patterns |
|---|---|---|
| 3 | BLOCK | `.env`, `secret(s).`, `credentials`, `password`, `api_key`, `private_key`, `.pem`, `auth.ts/js`, `security.ts/js` |
| 2 | PAUSE | `package.json`, `package-lock.json`, `tsconfig.json`, `CLAUDE.md`, `.gitignore`, `server.*`, `index.*`, `config.*` |
| 1 | WARN | everything else |

`conflicts` (overlap pass) and `pulse` also add the config's
`conflicts.highSeverityPatterns` (→ tier 3) and `conflicts.mediumSeverityPatterns`
(→ tier 2). These have defaults in `src/lib/config.ts` even with no config file —
tier 3 adds `package.json`, `migrations/`, `.env` anywhere in a path, `middleware.`, `route.ts`; tier 2
adds `components/ui/`, `lib/`, `hooks/`, `utils/` — so `package.json` is tier 3 in
`conflicts` but tier 2 in `cross-conflicts` and `watch`, which use the built-ins
only. Override them in `.spidersanrc` / `.spidersanrc.json` / `.spidersan.config.json`.

## Environment variables

| Variable | Effect |
|---|---|
| `SPIDERSAN_SUPABASE_URL` / `SPIDERSAN_SUPABASE_KEY` | Cloud registry credentials; take precedence over `SUPABASE_URL` / `SUPABASE_KEY`, then `storage.*` in config |
| `SPIDERSAN_GIT_WATCH_URL` / `SPIDERSAN_GIT_WATCH_KEY` | git-watch's event reader only (an anon read key); checked first, so the service key used to register pushed branches is not the realtime socket's key |
| `SPIDERSAN_AGENT` | Default agent id for `register`, `watch`, `auto`, `torrent` when `-a` is not given |
| `SPIDERSAN_ECOSYSTEM` | Colon-separated repo paths for `conflicts --ecosystem`; `0`/`false`/`no`/`off` disables the ecosystem plugin |
| `SPIDERSAN_CORE_ONLY` | `1`/`true`/`yes`/`on` disables the ecosystem plugin (it was inverted before #313) |
| `SPIDERSAN_ROOM_TOKEN` | Alert room for `conflicts --notify`; unset reports `NOT NOTIFIED` locally |

## Pushed branches register themselves (git-watch)

Every push to a branch reaches `spidersan git-watch` through the repo's GitHub
webhook (no Actions minutes). For a non-trunk branch, git-watch upserts one row in
`spider_registries` under the virtual machine `github`, with the files the branch
changes against trunk (GitHub compare API). `conflicts` on every machine then sees
the branch whoever pushed it — Codex, Copilot, a cloud agent, the web editor, a
person — even though no Claude Code hook ran. Closing the branch's PR, or deleting
the branch, marks the row `abandoned`; a later push re-activates it. Pushes from
`[bot]` senders are skipped.

- Needs `SPIDERSAN_SUPABASE_URL` / `SPIDERSAN_SUPABASE_KEY` (service role) in
  git-watch's environment, plus `SPIDERSAN_GITHUB_TOKEN` for private repos. Without
  them it logs once and registers nothing; the plain `SUPABASE_*` pair is never used
  for this write.
- Only repos with a local clone that git-watch watches: `repo_name` is the main
  clone's directory name (a worktree resolves to it), the value `conflicts` queries.
- A pushed-branch row is dropped on read whenever a real machine (or the caller's
  own local registry / current branch) has the same branch, so nothing shows twice
  or conflicts with itself.
- Trunk is the repo's default branch from the GitHub API, not a hardcoded `main`.

The old Actions workflow (`auto-register.yml` → `branch_registry` via the
`register-branch` edge function) was removed on 2026-10-12 because nothing read
`branch_registry`. The function and table are dormant, not deleted.

## Knowledge graph (graphify)

`graphify-out/` is a local tree-sitter AST graph of this repo — gitignored,
rebuilt on demand, never committed.

```bash
g() { env -i PATH="$HOME/.local/bin:$PATH" HOME="$HOME" TMPDIR="$TMPDIR" \
        uvx --from "graphifyy==0.9.64" --with tree-sitter-sql graphify "$@"; }
g extract . --code-only --force && g cluster-only . --no-label
g explain "getStorage"; g affected "<node id>" --depth 2; g god-nodes --top 10
```

`--code-only` + `env -i` keep it local (no LLM, no network); without
`--with tree-sitter-sql` the `.sql` files silently parse to nothing. Build over a
fresh `git worktree add` of `origin/main`, or a behind checkout yields a stale
graph that looks fresh. For an ambiguous label, `explain`/`affected` refuse, but
`path` silently picks one — use it for orientation only.

## Finishing work

Work on a branch, never directly on `main`. Run `npm run typecheck`,
`npm run build` and the relevant tests, push the branch, open a PR, and run the
pre-merge loop above before anyone merges it.
