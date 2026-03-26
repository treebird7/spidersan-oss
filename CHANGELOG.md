# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **RLS: spider_registries write policies now apply to anon+authenticated** — `CREATE POLICY` with no `TO` clause silently defaults to `service_role` in PostgreSQL; INSERT/UPDATE/DELETE policies dropped and recreated with explicit `TO anon, authenticated`. `registry-sync --push` was blocked by `42501` for all non-service-role clients. Both migration files (`20260219_spider_registries.sql`, `PASTE_THIS.sql`) patched with explicit role grants.

## [0.5.0] - 2026-03-24

### Added
- **Ecosystem scan**: `spidersan conflicts --ecosystem` — multi-repo aggregate conflict scan across all registered repos (29 repos in default sweep)
- **Colony integration**: `spidersan pulse` — sync from Colony then show active conflicts; colony subscriber hooks; cross-machine cross-conflicts
- **Queen command**: `spidersan queen` — Mode 3 Queen Spider; dispatches sub-spidersan jobs in parallel across repos
- **Activity log**: `spidersan log` — structured activity event log; wired into `sync` and `conflicts` commands
- **Daily bridge**: `spidersan daily` — branch-aware daily collab entry bridge (L2)
- **PR conflict detection**: `spidersan conflicts --pr <num>` — detect conflicts against a specific open PR
- **Stale auto-cleanup**: `spidersan stale --auto-cleanup` — non-interactive batch branch removal
- **Cross-machine registry sync**: `spidersan registry-sync` — push/pull branch registry to/from Supabase (F1/F3)
- **GitHub branch inventory**: `spidersan github-sync` — fetch branch/PR/CI status from GitHub (F2/F4)
- **Sync advisor**: `spidersan sync-advisor` — scan repos and recommend push/pull actions
- **TUI Dashboard** (Phase A): 4-panel blessed UI with ecosystem overview, conflict map, activity feed, and merge queue
- **MCP Wave 3 ecosystem tools**: additional MCP server tools for ecosystem-level operations
- **Toak MCP**: toak MCP server now loads correctly in Copilot CLI via `scripts/toak-mcp-wrapper.sh`
- **Dawn script**: `bin/dawn.sh` — fleet agent session startup (git sync, vault, colony, inbox)
- **Close script**: `bin/close.sh` — session close ceremony with pending task generation
- **`.myctoak/registry.json`**: spidersan table ownership declaration for MycToak

### Changed
- **Dynamic path resolution** (Phase 2b): all hardcoded `/Users/freedbird/Dev/` paths replaced with `process.env.HOME` / `os.homedir()` fallbacks — ecosystem repos, treetop repos, queen paths, MCP wrapper scripts all portable
- **Privacy**: `homedir()` fallback in `conflicts.ts`, `queen.ts`, `watch.ts` — safe to publish to npm
- **TOAK_AGENT_ID**: now auto-injected via vault key — no manual prefix required
- **ready-check**: WIP markers are advisory only; only branch file conflicts block merges
- **Colony vars**: falls back to `SUPABASE_URL`/`SUPABASE_KEY` if `COLONY_*` vars not set
- **Sync**: remote branches included in orphan detection

### Performance
- **O(1) file overlap**: Set pre-computation in `buildConflictGraph`, `watch`, `torrent`, `ready-check` (was O(n²))
- **AST traversal ~6× speedup**: TreeCursor-based traversal replacing recursive walk
- **N+1 elimination**: `conflicts --wake` branchMap pre-fetch; `cleanup` bulk patch
- **Batch Supabase**: `pushRegistry` batched upserts; stale notifications batched
- **`findByFiles` optimization**: Array intersection via Set lookup in local storage

### Fixed
- MCP: `isError: true` added to all 40 error response paths
- Dashboard: non-TTY guard prevents crash in CI; suppress console bleed in TUI; `padEnd`/`escapeBlessed` ordering fix
- Colony subscriber: TypeScript strict type fixes; `agent_label` added to `ColonySignalRow`
- Sync advisor: suppress git stderr noise; include remote branches
- Doctor: ignore comments in `.env` Supabase check; add `*.key` to `.gitignore`
- `rebase-helper` command registered in CLI
- Migrations: idempotent for shared DB deployment
- Conflicts: exclude `node_modules` and build dirs from scan

### Security
- **Path traversal**: `stale`, `rescue`, storage utilities — second-order path validation
- **Command injection**: `git-messages.ts` hardened with `execFileSync`/argument arrays; `git shell executions` sanitized (#67)
- **TUI markup injection**: `escapeBlessed()` applied throughout dashboard
- **Input validation**: `register`, `conflicts --cleanup`, `rescue --symbols` — all input sources validated
- **Prototype pollution**: `deepMerge` throws on `__proto__`/`constructor` keys
- **execSync→execFileSync**: `register.ts` fully refactored; remaining `execSync` instances replaced

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
