# Agent Instructions

Spidersan is a branch-coordination CLI for multi-agent coding: a registry of who
is touching which files, tiered conflict detection, and merge ordering. Build and
test with npm (`npm run typecheck`, `npm run build`, `npm run test:run`).
Every command takes `--help`; the user-facing overview is [README.md](README.md).

## Pre-merge loop

```bash
spidersan conflicts                                   # registry overlap for this branch
spidersan register -f "a.ts,b.ts" -a <agent> -d "what this branch does"
spidersan ready-check                                 # overlaps (blocking) + WIP markers (advisory)
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
| Watching | `watch` · `auto` · `dashboard` (`git-watch` is retired: refuses, exit 1) |
| AI | `context` (CLI); ask / advise / explain are MCP tools (`spidersan_ask`, …) |

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
| `SPIDERSAN_SYNC_MODULE` | Absolute path to the cross-machine sync module (exports `createRegistrySyncClient()`); overrides `storage.syncModule` in `~/.spidersanrc`. Unset and unconfigured: no cross-machine sync — `registry-sync` / `cross-conflicts` exit 1, `conflicts` is local-only |
| `SPIDERSAN_SUPABASE_URL` / `SPIDERSAN_SUPABASE_KEY` | Activity-log upload only (precedence over `SUPABASE_URL` / `SUPABASE_KEY`). They no longer drive the registry: the built-in hosted sync client was removed |
| `SPIDERSAN_AGENT` | Default agent id for `register`, `watch`, `auto`, `torrent` when `-a` is not given |
| `SPIDERSAN_ECOSYSTEM` | Colon-separated repo paths for `conflicts --ecosystem`; `0`/`false`/`no`/`off` disables the ecosystem plugin |
| `SPIDERSAN_CORE_ONLY` | `1`/`true`/`yes`/`on` disables the ecosystem plugin (it was inverted before #313) |
| `SPIDERSAN_ROOM_TOKEN` | Alert room for `conflicts --notify`; unset reports `NOT NOTIFIED` locally |

## Pushed branches register themselves (webhook)

Every push to a watched repo reaches the `spidersan-webhook` edge function
through the repo's GitHub webhook — no Actions
minutes, no workflow file, and no write credential outside Supabase: GitHub's HMAC
proves the event and the service key stays in the function. For a non-trunk branch
it upserts one row in the cross-machine registry under the virtual machine `github`, with
the files the branch changes against the default branch. `conflicts` on every
machine whose `storage.syncModule` reads that registry then sees the branch whoever pushed it — Codex, Copilot, a cloud agent, the
web editor, a person — even though no Claude Code hook ran. A closed PR or a deleted
branch marks the row `abandoned`; `[bot]` senders, tags and fork PRs are skipped.

- The row's `repo_name` is the lowercased GitHub repo name (the function never sees
  your clone). Reads query both that and the clone's directory name
  (`registryRepoNames()` in `src/lib/git.ts`), so `spidersan-oss` cloned as
  `spidersan`, or `toak` cloned as `Toak`, still match.
- A pushed-branch row is dropped on read whenever a real machine (or the caller's
  own local registry / current branch) has the same branch, so nothing shows twice
  or conflicts with itself. `SupabaseStorage.pullRegistries` applies this over
  whatever the sync module returns.
- Repos without the webhook register nothing this way. The function needs a
  read-only GitHub token per owner in its secrets (see its `SOURCE.md`).

The old Actions workflow (`auto-register.yml` → `register-branch` edge function) was
removed on 2026-10-12 because nothing read what it wrote.

The built-in hosted sync client (direct REST reads/writes of the hosted registry
tables) was removed and `git-watch` (Realtime on a hosted git-event table) retired on
2026-11-02 ahead of those tables being dropped. All cross-machine reads and writes go
through `storage.syncModule`; never add a direct table read.

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
