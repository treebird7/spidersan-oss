# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **GitHub Actions auto-register is back — zero-secret OIDC edition** (PR #279, #280) — successor to the workflow retired in c9a449b for keeping a DB key in public-repo Actions secrets. New flow: on push, CI mints a short-lived GitHub OIDC token (`permissions: id-token: write`, **no repo secrets at all**); the new `supabase/functions/register-branch` edge function verifies it (RS256, issuer, audience, `repository` claim allowlist + optional `repository_id` pin — the `repository` claim is the only real gate) and writes `branch_registry` server-side with an `sb_secret_*` key held only in Supabase function secrets. Branch and actor come from verified token claims, never the request body. Existing branches get a `files_changed`-only refresh — a push can never re-activate a merged branch or overwrite attribution (which also neutralizes token replay). The workflow (`.github/workflows/auto-register.yml`) no-ops until the `SPIDERSAN_REGISTER_URL` repo variable is set. Proven end-to-end in production (probe push → workflow green → correct claims-derived row).
- **`setup-oidc-autoregister` Claude Code skill** (`.claude/skills/setup-oidc-autoregister/SKILL.md`) — guided BYK adoption of the above on your own repo + Supabase project: deploy, wire secrets server-side, copy workflow, strict 4-point verify (three exact reject codes + probe row). Security invariants stated as non-negotiable, including rejecting legacy `eyJ` service_role JWTs via a no-print prefix check. Note: `.claude/skills/` is allowlist-gated in `.gitignore` — new skills need a `!` entry.

### Security

- **CI dependency audit scoped to production deps** (`npm audit --omit=dev --audit-level=high`) — GHSA-mh99-v99m-4gvg (brace-expansion, published 2026-07-29) is unfixable inside eslint 8's transitive tree: the only patched release (5.0.8) breaks minimatch@3's direct-function import (verified). The published CLI ships none of that chain. Full-tree audit returns with the eslint 8→10 flat-config migration (tracked as invoak tb-wb47). js-yaml and postcss high advisories fixed via lockfile bump in the same pass.

### Removed (docs)

- `INSTALL_AUTO_REGISTER.md`, `AUTO_REGISTER_USE_CASES.md` and the local `install-auto-register` skill (832 lines) — they taught the retired secret-in-CI flow. README § "GitHub Actions Auto-Register (OIDC)" is the single current reference.

### Added

- **`spidersan depends` actually works now** (tb-5h9b) — it was a stub that always printed "requires Supabase storage" and stored nothing. Dependencies (`dependsOn`) and the merged PR (`prNumber`, via `merged --pr N`) now live on the registry `Branch` entry itself, so they work with **local** storage too. `merge-order` folds declared dependencies into its sort as directed edges (new `addDependencyEdges` in `src/lib/graph.ts`): "A depends on B" puts B first regardless of file overlap. `registry-sync` pushes/pulls both fields (`depends_on`, `pr_number` on `spider_registries` — canonical table, not the dead `branch_registry` path removed above). **Deploy order:** apply migration `treebird/supabase/migrations/20260711000000_spider_registries_depends_pr.sql` before shipping this, or cloud pushes will reject the unknown columns.

### Fixed

- **Registry store: crash-safe writes + no silent wipe** (`src/storage/json-branch-registry-store.ts`) — `save()` now writes temp-then-rename (atomic), and `load()` only falls back to an empty registry on ENOENT. Previously a corrupt/truncated `registry.json` (crash mid-write) parsed as "empty" and the next `register` **silently destroyed every agent's registrations**; now it fails loudly and never saves over the corrupt file.
- **`cleanup` no longer deletes active registrations** — `registeredAt` is never refreshed, so an old ACTIVE entry usually means in-flight work; deleting it blinded conflict detection for every other agent. `storage.cleanup(olderThan, includeActive)` now skips `status: 'active'` by default; new `cleanup --force` restores the old behavior. Both `cleanup` and `stale` also reject non-numeric `--days` instead of silently matching nothing.
- **`conflicts --pr` survives PR force-pushes** — the stash refspec is now `+pull/<n>/head:refs/spidersan/pr-<n>`; without the `+`, a rebased PR made every subsequent check fail with "Could not fetch PR head" until the ref was deleted by hand.
- **`conflicts --pr --strict` is honoured** — the real merge-tree path only read `--exit-code`, so the advertised CI flag `--strict` silently exited 0 on real conflicts. `--strict` now gates the real path too. The dead `--max-retries` option (declared, never read) is removed.
- **`conflicts --pr --gate` fails closed** — `getPRLabels` now returns `null` on failure (vs `[]`), and the gate treats "couldn't read labels" (gh missing/unauthenticated/rate-limited) as UNMET instead of invisibly bypassing a `needs-*:` blocking label.
- **`mq run --execute` refuses a repo mismatch** — the speculative merge fetches `pull/<n>/head` from the **cwd's** origin, so `--repo other/repo` from a different checkout would CI-test one repo's code and land another's PRs. Now hard-errors unless the cwd checkout IS the target repo.
- **`mq` red-gate with zero applied PRs no longer crashes** — a red gate before any PR applied (broken base) hit `culprit.number` on `undefined`, aborting the run and losing landed/ejected state; it now aborts cleanly with `converged: false`.
- **Reconcile-on-read: unpushed local commits are no longer reconciled away** — `reconcileBranches` preferred the remote-tracking ref, so a branch whose PR landed but that kept receiving local commits was classified `merged` and vanished from conflict detection. Both tips (stale `origin/<name>` AND `refs/heads/<name>`, new `resolveLocalBranchRef`) must now be ancestors of trunk.
- **`getRemoteHead` matches the exact ref** — `git ls-remote --heads origin main` pattern-matches ref *suffixes* (`feature/main` too) and the first line won; remote-drift detection could compare against the wrong branch's SHA. Now queries and matches `refs/heads/<branch>` exactly.
- **`getChangedFiles` empty-diff semantics** — a successful-but-empty `main...HEAD` diff no longer falls through to `HEAD~1` (which reported the previous already-merged commit's files as "changed" — phantom registrations on fully-merged branches). Also passes `core.quotepath=off` so non-ASCII paths aren't stored C-quoted, and `ready-check`/`register` now diff against the detected trunk instead of hardcoded `main`.
- **`stale --notify` delivers to the agent's own pending file** — the cwd's `.pending_task.md` was checked first, so every agent's notifications landed in whatever repo the command ran from; now only agent-owned locations are considered (incl. `~/Dev/treebird/agents/<agent>/`).
- **`bot`**: command args can no longer start with `-` (git option injection, e.g. `/pull repo --force`); `/log abc` no longer produces `git log -NaN`; `/sync` no longer runs registration + conflict-check twice; dead `pollInterval`/`syncInterval`/`rateLimit` config fields removed.

### Removed

- **Dead code sweep (~700 lines + a dependency)** — `src/lib/crdt.ts` (Yjs SwarmState, zero callers; drops the `yjs` dependency), `src/tui/dashboard.ts` + `src/tui/screen.ts` (two unwired TUI implementations; `spidersan dashboard` uses `src/commands/dashboard.ts`), the never-called `branch_registry` method family (`setDependencies`/`setConflicts`/`markMerged`/`getStale`/`getRaw`/`pushGitHubBranches` on the Supabase impl + wrappers), and the unused factory functions `getBranchRegistryStore`/`getSupabaseRegistrySyncClient`. `mqCommand` added to the library barrel (was CLI-only).

### Added

- **`mq` conflict-graph ordering** (tb-y121, merge queue phase 1.5, PR #254 + #255) — `mq run`/`mq status` order the ready-PR queue with the existing `buildConflictGraph` + `topologicalSort` (`src/lib/graph.ts`, already used by `merge-order`) instead of plain PR-number order: the most-blocking (most file-overlapping) PRs sort first so a "hub" PR lands before the PRs it conflicts with. Non-conflicting PRs and ties fall back to oldest-first. Pure `conflictOrder` over a pre-fetched `filesByPr` map — no IO — so `mq run`'s plan, `mq status`, and the actual `--execute` all agree on the same order. `listChangedFiles` (one `gh pr view` per PR, 30s timeout) degrades to "no files" on fetch failure with a visible stderr warning, rather than silently collapsing back to oldest-first. Correctness still rests on the speculative-merge + CI gate, not this ordering.
- **`spidersan pulse` smalltoak health probe** (tb-r9s) — `pulse` now proactively probes the smalltoak comms bridge (`SMALLTOAK_SERVER_URL`) that `spidersan bot` depends on, surfacing an outage before message-driven git ops silently stall. New `src/lib/smalltoak.ts` `probeSmalltoak()`: GETs `/health` with a 2s timeout; **any HTTP response = reachable** (a missing `/health` route never false-alarms), only a network error/timeout = DOWN. No-op when `SMALLTOAK_SERVER_URL` is unset. Shown in the human report (`Smalltoak: ✅ up` / `🔴 DOWN`) and JSON (`smalltoak` field).

### Tests

- **`merge-plan` fused-verdict integration test** (tb-uvy) — `tests/merge-plan.integration.test.ts` drives a real temp-git train (genuine `git merge-tree` conflict + a real stacked base) through `analyzeRealConflicts` → `buildMergePlan`, asserting BLOCKED (real conflict file surfaced), WAIT (stacked, parent-before-child order), and MERGE. Closes the dogfood gap from tb-bi2, whose live RT train was disjoint and only exercised MERGE/STALE/ordering.

### Added

- **Reconcile-on-read** (`src/lib/reconcile.ts`) — `conflicts`, `ready-check`, and `merge-order` now fold git truth over the registry's `status` before answering: a branch already merged into trunk (`git merge-base --is-ancestor`, or registry status `completed`) is dropped from conflict detection. Retires the phantom-conflict class where a fully-merged branch kept showing as conflicting from a stale worktree. New git primitives `resolveBranchRef` / `isMergedInto` (`src/lib/git.ts`). Orphaned (no-ref) branches are deliberately KEPT on the read path — a missing ref can mean "unfetched on another machine", and dropping it would miss a real conflict.

### Security

- **Consolidate `spider_registries` to runtime + harden RLS** (PR #247) — fixed silent cross-project drift where `spider_registries` lived on the vault Supabase project (`<vault-project-ref>`) while `branch_registry` lives on runtime (`<runtime-project-ref>`). Registry-sync uses a single `SUPABASE_URL` client, so the `spider_registries` half of every runtime-pointed sync was silently 404-ing. Canonical = runtime. Also closes wide-open anon RLS on the public project: `spider_registries` and `branch_registry` both had anon `INSERT/UPDATE/SELECT` open; views used owner-rights that bypassed base-table RLS. Hardening: service_role writes, authenticated agent-JWT reads, anon denied, views `security_invoker`.
- **Migrations** — `20260219_spider_registries.sql` (hardened CREATE + GIN index, runtime), `20260623_harden_spidersan_rls.sql` (branch_registry + views, runtime), `20260623_decommission_vault_spider_registries.sql` (vault teardown, manual, gated on parity), `supabase/migrations/CONSOLIDATION.md` (ordered deploy runbook).

### Removed

- **`auto-register.yml` CI workflow** — retired. It ran `spidersan register` on every push using an anon `SUPABASE_KEY` from Actions secrets, writing `branch_registry` as anon. The RLS hardening above denies anon writes, making this workflow both broken and a security risk (promoting the key to service_role in a public repo's CI secrets is worse). Machine-side `registry-sync` with the service key is the correct sync path.

### Fixed

- **`merge-plan` fused verdict is additive, not lossy** (tb-cdz) — a PR that is both behind base and has non-required checks red (`STALE` + `UNSTABLE`) now keeps the `STALE` headline **and** annotates the suppressed check axis (`↳ non-required checks red`). Previously the `UNSTABLE` signal was silently dropped on the STALE path. Ref coord-tree pair `fused_verdict_must_be_additive_not_lossy`.
- **`spidersan sync`** now prunes **merged** registry entries (is-ancestor / status `completed`), not just orphans. Previously a merged branch whose ref still existed lingered forever and kept phantom-conflicting; merged entries are now deleted, not just marked.

## [0.11.0] - 2026-06-16

### Added

- **`spidersan merge-plan`** — ordered merge plan for open PRs; fuses PR merge-state + CI rollup (`src/lib/github.ts`), real `git merge-tree` conflicts (`src/lib/git-merge-analyzer.ts`), staleness (commits behind base), and stacked-base detection into a per-PR verdict (MERGE / BLOCKED / WAIT / VERIFY / STALE / UNKNOWN) plus a topologically-ordered global plan. Fork-safe head via `pull/<n>/head`; advisory (always exit 0). Supports `--json`, `--base`, `--limit`, `--include-drafts`, `--repo`.
- **`spidersan pr-check <number>`** — check a single PR's merge readiness: stacked-base detection and red/behind/conflict state with failing *required* checks surfaced. Advisory by default; `--exit-code` makes it gate for pre-merge hooks. Supports `--json`, `--repo`.
- **`spidersan verify-trunk`** — detect (and with `--fix` reset) registry "trunk-poison": the trunk branch (main/master) claiming files in the spidersan registry, which a clean auto-merge can silently re-introduce. `--exit-code` gates for post-merge hooks; `--json` for tooling.
- **`spidersan conflicts --real`** — compute TRUE merge conflicts via `git merge-tree` (vs registry overlap), distinguishing same-file-different-region (clean) from real conflict. Works with no registry for a single target; `--all` checks every active branch, `--base <ref>` sets trunk, `--exit-code` gates.

## [0.10.0] - 2026-05-11

### Added

- **`spidersan watch --fetch-poll`** (DEEPENING-9) — continuous remote drift polling layered on the existing `watch` daemon. Runs `git fetch origin` every `--fetch-interval` seconds (default 120s), reuses `getDriftZone` / `classifyDriftZone` from `src/lib/remote-drift.ts`, and emits a TIER-aware console report whenever new remote commits intersect the registered file list. Supports `--fetch-interval <s>`, `--hub-sync` (post to Hub on drift), `--strict` (exit 1 on first drift hit). Graceful degradation: offline, detached HEAD, mid-rebase, no upstream — all skip the fetch cycle without crashing the watcher.
- **`CONTEXT.md`** — domain vocabulary and codebase map for AI agent orientation. Covers core concepts (drift zone, tier, registry, colony), canonical file roles, and the DEEPENING architecture series.

### Fixed (security — ts-review 2026-05-11)

- **`src/lib/remote-drift.ts` — git fetch timeout** — `execGit` was missing a timeout; `git fetch` on a stalled TCP connection would block the CLI indefinitely. Added `GIT_TIMEOUT_MS = 15_000` constant applied to all `execFileSync` calls.
- **`src/lib/remote-drift.ts` — `isOfflineError` exported** — extracted from module-private so `pulse.ts` can use the same classifier instead of duplicating the regex.
- **`src/commands/pulse.ts` — hub catch now warns** — `.catch(() => {})` on `hub.postToChat` was fully silent; auth failures and unexpected errors were invisible. Replaced with `isOfflineError`-gated `console.warn`.
- **`src/commands/bot.ts` — env isolation** — all `execFileSync` calls (git and spidersan subprocesses) were implicitly inheriting `process.env`, leaking `SMALLTOAK_TOKEN` and vault-injected secrets to child processes. Added `gitEnv()` (minimal allowlist: HOME, PATH, GIT_SSH_COMMAND, SSH_AUTH_SOCK, GIT_AUTHOR_*/COMMITTER_*, GIT_TERMINAL_PROMPT=0) and `spidersanEnv()` (full env minus SMALLTOAK_TOKEN, SMALLTOAK_SERVER_URL, GIT_BOT_ENABLED).
- **`src/commands/bot.ts` — BRANCH_RE length cap** — `/^[\w/.-]+$/` allowed unlimited-length branch names from external smalltoak messages. Changed to `/^[\w/.-]{1,200}$/`.
- **`src/commands/bot.ts` — stPost silent catch** — `} catch { /* silent */ }` swallowed all posting errors. Now logs non-offline failures via `console.warn`.

### Performance

- **`spidersan conflicts` + `spidersan cross-conflicts`** — replaced multiple `.filter()` passes with single-pass `for` loops for conflict tier counting. Eliminates O(N×3) traversal in `notifyHub()`, `logActivity`, and JSON summary output.

### Tests

- **161 tests, 35 test files** — up from 147 / 32 after DEEPENING-10 renderer test additions.

## [0.9.0] - 2026-05-11

### Added

- **`spidersan pulse --remote-drift`** — proactive remote drift detection. Fetches `origin`, identifies the drift zone (files touched by remote commits local doesn't have), cross-references against (a) the registered branch file list with tier classification and (b) unstaged working-tree files (rebase-continue blocker risk). Gracefully degrades when offline, detached HEAD, mid-rebase, or no remote branch. Supports `--json`, `--hub-sync` (post to Hub on risk), `--strict` (exit 1 on overlap). Pre-push hook integration: `spidersan pulse --remote-drift --strict`. Closes the proactive gap exposed by the 2026-05-11 rebase-sync-chaos incident — 7 sangit gold pairs cover the reactive patterns; this command warns before the first push attempt.
- **`src/lib/remote-drift.ts`** — pure library exporting `getDriftZone`, `getUnstagedTrackedFiles`, `classifyDriftZone`, `computeDriftResult`. Extracted so `watch --fetch-poll` can reuse the primitives without importing from the command layer.
- **Architecture DEEPENING-8** — contract at `docs/arch/contracts/DEEPENING-8-remote-drift.md`; 15 new tests in `tests/remote-drift.test.ts`.

### Architecture (DEEPENING series — all in this release cycle)

- **DEEPENING-3: `src/lib/conflict-analyzer.ts`** — pure `analyzeConflicts() → ConflictReport`; `classifierSource` enum and `useSymbolAware` flag as H10 affordances. `conflicts.ts` reduced from 68 to 2 `console.log` calls.
- **DEEPENING-4: `src/lib/git.ts`** — canonical git operations module; `getCurrentBranch` deduplication (8× → 1), plus `getChangedFiles`, `getFileAtRef`, `getRemoteHead`, `getAheadBehind`, `GitError`. All git calls use `execFileSync` argv arrays.
- **DEEPENING-5: `src/lib/hub.ts`** — single `HubClient` with injectable `HubAdapter`; `HUB_URL` defined once (was in 3+ files). Stray `HUB_URL` in `torrent.ts` also removed.
- **DEEPENING-6: `src/lib/conflict-renderer.ts`** — pure `renderConflictReport()` → `string`; zero side effects; makes conflict detection testable without stdout capture.
- **DEEPENING-7: `src/lib/graph.ts`** — pure `buildConflictGraph`, `topologicalSort`, `calculateBlockingCounts`; first test coverage for merge-order logic (11 tests).
- **DEEPENING-1: `src/storage/` split** — `BranchRegistryStore` + `JsonBranchRegistryStore` + `MemoryBranchRegistryStore` (test double) + `SupabaseRegistrySyncClient`. `StorageAdapter` kept as `@deprecated` composing shim; on-disk JSON format unchanged.

### Changed

- `vitest.config.ts` — excludes `conflict-tier.test.ts` (uses `node:test` runner, not vitest)

### Tests

- **139 tests, 31 test files** — up from 84 tests / ~20 files before this cycle. All pass.

 — 4 new tables on treebird-runtime staging (`spider_decision_stream`, `spider_pattern_weights`, `spider_pattern_corrections`, `spider_agent_trust`). HMAC gate trigger on decision stream, optimistic version lock + weight ceiling (≤0.95) triggers on pattern weights, SECURITY DEFINER functions for decay/tombstone/resurface/trust-upsert. `last_promoted_at` column on `spider_pattern_weights` (SANGIT-08 curriculum sync). Migration: `20260504000000_realtime_apprenticeship.sql` · commit `7392776`.
- **pg_cron schedules for decay + tombstone** — `spider-decay-daily` (03:00 UTC daily) and `spider-tombstone-weekly` (04:00 UTC Sunday) registered on staging. Idempotent unschedule guard. Migration: `20260509000001_pg_cron_spider_decay_tombstone.sql` · authored by watsan-m5 · commit `d8d09f9`.

### Fixed
- **RLS: FOR ALL → per-op split** — `service_role_write_patterns` and `service_role_write_trust` were `FOR ALL`; replaced with separate INSERT / UPDATE / DELETE policies per table (migration `20260509000000_sangit02_rls_and_uniqueness_fixes.sql` · commit `9843107`).
- **NULL uniqueness gap on `spider_agent_trust`** — `UNIQUE(actor_machine, repo)` did not prevent duplicate rows when `repo IS NULL` (PostgreSQL NULL ≠ NULL in UNIQUE constraints). `ON CONFLICT(actor_machine, repo)` silently skipped upsert for cross-repo trust rows. Fix: dropped composite constraint, replaced with two partial unique indexes (`idx_sat_machine_repo_scoped WHERE repo IS NOT NULL`, `idx_sat_machine_repo_global WHERE repo IS NULL`). Updated `spider_update_agent_trust` to branch on `p_repo IS NULL` with correct partial-index conflict targets.
- **`spider_apply_decay` RETURNING bug** — was returning post-update `base_weight` for both `old_weight` and `new_weight`. Fixed with CTE to capture pre-update weight before the UPDATE fires.
- **`SET search_path = ''`** added to all 4 SECURITY DEFINER functions and all 3 trigger functions (consistent hardening; prevents schema injection).


- **CI: Security tests failing silently** — Added `git config user.name/email` so git-messages and git-injection tests pass in CI
- **CI: Lint failures swallowed** — Removed `|| true` and `continue-on-error: true` from lint step; lint now blocks CI
- **Publish: No tests before npm publish** — Added `npm test -- --run` to publish workflow so broken releases cannot ship
- **Publish: Bad version input ignored** — Removed `continue-on-error` from `npm version` step; invalid semver now fails the workflow

### Added
- **CI: Node.js version matrix** — Tests now run on Node 18, 20, and 22
- **CI: npm audit step** — `npm audit --audit-level=high` runs on every build
- **CI: MCP server test job** — New `test-mcp` job builds and tests the MCP server in CI
- **Publish: Dry-run verification** — `npm publish --dry-run` validates package contents before actual publish

### Changed
- **auto-register workflow**: Deduplicated `spidersan init` calls (3 → 1)

### Documentation
- Test coverage analysis (`docs/TEST_COVERAGE_ANALYSIS.md`)
- CI/CD workflow coverage analysis (`docs/CI_CD_COVERAGE_ANALYSIS.md`)

## [0.4.5] - 2026-02-18
### Added
- **Fork Sync Use Case**: New documentation pattern for safely cherry-picking commits from a public fork into a private branch using spidersan conflict detection (`docs/USE_CASES.md` Use Case #8)
- **Fork Sync Best Practices**: Per-commit classification workflow (SAFE / NEEDS-REVIEW / SKIP) documented in `BEST_PRACTICES.md`
- **Task Torrenting Command**: `spidersan torrent` for branch-per-task workflow management (create, status, complete, merge-order, tree, decompose)

### Fixed
- **Security: Command injection in git adapter** — `execSync` with string interpolation replaced with `execFileSync`/`spawnSync` with argument arrays across all git operations (PR #13)
- **Security: Arbitrary file read in rescue command** — Path traversal vulnerability fixed in `rescue` command
- **Security: Input validation bypass in register** — File path and agent ID validation now covers all input sources (flags, auto-detection, prompts) in `register` and `conflicts --cleanup` commands (PR #14, #16)
- **Security: Git command injection** — Comprehensive fix for remaining injection vectors (PR #17)
- `_testable` export from `config.ts` for prototype pollution tests
- **Test: git_injection test mocks aligned with execFileSync** — Test was mocking `execSync` but source code uses `execFileSync` exclusively; updated mocks to properly simulate branch operations

### Changed
- **npm audit fix**: Resolved high-severity vulnerability in `@isaacs/brace-expansion`

### Documentation
- Fork Sync use case with full spidersan workflow example
- Best practices: Fork Sync Workflow section
- Auto-register use cases guide (`AUTO_REGISTER_USE_CASES.md`)
- MCP integration config for Copilot
- GitOps session recap: Spidersan-assisted registry sync, branch cleanup, rebase, and publish workflow


### Added
- **GitHub Actions Auto-Register Workflow**: Automatic branch registration on every push
  - Extracts agent name from branch prefix (e.g., `claude/feature` → `claude`)
  - Auto-detects changed files via git diff
  - Runs conflict detection with TIER 2+ warnings
  - Handles first push to new branches correctly
  - Documented in `AUTO_REGISTER_USE_CASES.md` with 10 real-world scenarios

### Fixed
- GitHub workflow: Removed invalid `--branch` flag from `spidersan register` command
- GitHub workflow: Added `spidersan init` step to initialize environment
- GitHub workflow: Fixed file detection for first push to new branches (null SHA handling)

### Documentation
- Added comprehensive auto-register use cases guide
- Updated README with GitHub Actions auto-register section
- Added Lesson #12 to SPIDERSAN_LESSONS_LEARNED.md for workflow --branch flag issue

## [0.4.3] - 2026-01-27
### Added
- `spidersan welcome` onboarding command for core.
- `spidersan config` command with guided wizard, global/local config support, and ecosystem toggle.
- Config fields for `agent.name` and `autoWatch` presets.
- `spidersan auto start|stop|status` for background watch sessions.
- `spidersan watch --paths` and `--root` for scoped watching.

### Changed
- `spidersan register` and `spidersan watch` now default to `agent.name` from config when set.
- Ecosystem commands only load when enabled in config (or not disabled via env).

## [0.4.2] - 2026-01-26

### Changed
- README updated with Support section.

### Fixed
- npm `bin` field normalized to avoid publish warnings.
