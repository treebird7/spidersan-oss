# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Reconcile-on-read** (`src/lib/reconcile.ts`) — `conflicts`, `ready-check`, and `merge-order` now fold git truth over the registry's `status` before answering: a branch already merged into trunk (`git merge-base --is-ancestor`, or registry status `completed`) is dropped from conflict detection. Retires the phantom-conflict class where a fully-merged branch kept showing as conflicting from a stale worktree. New git primitives `resolveBranchRef` / `isMergedInto` (`src/lib/git.ts`). Orphaned (no-ref) branches are deliberately KEPT on the read path — a missing ref can mean "unfetched on another machine", and dropping it would miss a real conflict.

### Security

- **Consolidate `spider_registries` to runtime + harden RLS** (PR #247) — fixed silent cross-project drift where `spider_registries` lived on the vault Supabase project (`dknahxavnrtaqlatflot`) while `branch_registry` lives on runtime (`ruvwundetxnzesrbkdzr`). Registry-sync uses a single `SUPABASE_URL` client, so the `spider_registries` half of every runtime-pointed sync was silently 404-ing. Canonical = runtime. Also closes wide-open anon RLS on the public project: `spider_registries` and `branch_registry` both had anon `INSERT/UPDATE/SELECT` open; views used owner-rights that bypassed base-table RLS. Hardening: service_role writes, authenticated agent-JWT reads, anon denied, views `security_invoker`.
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
