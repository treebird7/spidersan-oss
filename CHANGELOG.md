# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
