# Test Coverage Analysis

**Date:** 2026-03-16
**Test Framework:** Vitest 4.0.17 (V8 coverage provider)
**Test Results:** 74/78 passing (4 failures due to git config in CI, not bugs)

## Current Coverage Summary

| Category | Files Tested | Total Files | Coverage |
|----------|-------------|-------------|----------|
| Security | 6/6 | 6 | 100% |
| Commands | 5/31 | 31 | 16% |
| Libraries | 4/15 | 15 | 27% |
| Storage | 3/8 | 8 | 38% |
| TUI | 0/2 | 2 | 0% |
| **Total** | **18/62** | **62** | **~29%** |

## What's Well-Tested

- **Security layer** — Comprehensive: injection prevention, path traversal, prototype pollution, input sanitization, TUI escaping (11 test files)
- **MCP server tools** — All 22 tools integration-tested with real stdio transport
- **Performance** — Benchmarks for conflict detection (Set vs Array), cleanup batching, Supabase push optimization
- **Colony integration** — 5 scenarios including offline fallback
- **Git safety** — Multiple tests validating `execFileSync` over `execSync`

## Recommended Improvements (Priority Order)

### P0 — Critical Command Coverage

These are the most-used commands with zero tests:

1. **`src/commands/init.ts`** — The entry point for every new user. Test: directory creation, `.spidersan/` scaffolding, idempotency (running init twice), error on non-git repos.

2. **`src/commands/list.ts`** — Core workflow command. Test: empty registry output, multiple branches display, filtering by agent/status, JSON output format.

3. **`src/commands/sync.ts`** — Registry integrity depends on this. Test: pruning deleted branches, adding unregistered branches, handling corrupt registry JSON, dry-run mode.

4. **`src/commands/stale.ts`** — Used in cleanup workflows. Test: age threshold calculation (default 7 days), custom threshold, edge cases around timezone handling, output format.

5. **`src/commands/merged.ts` / `abandon.ts`** — Lifecycle state transitions. Test: status updates in registry, PR number recording, already-merged idempotency.

### P1 — Core Library Gaps

6. **`src/lib/crypto.ts`** — Encryption is security-critical. Test: key generation, encrypt/decrypt round-trip, invalid key handling, key import/export format.

7. **`src/lib/crdt.ts`** — Data consistency depends on CRDT correctness. Test: merge commutativity, merge associativity, concurrent edit convergence, empty state merges.

8. **`src/lib/github.ts`** — External integration. Test: PR creation payload format, API error handling (rate limits, 404s), auth token validation.

9. **`src/lib/repo-scanner.ts`** — Used by rescue mode. Test: multi-branch scanning, file change detection, handling repos with thousands of commits.

### P2 — Important Command Coverage

10. **`src/commands/merge-order.ts`** — Merge sequencing logic. Test: topological sort correctness, circular dependency detection, single-branch case, dependency chain ordering.

11. **`src/commands/torrent.ts`** — Task decomposition feature. Test: branch creation from task ID, parent-child relationships, status transitions, tree visualization output.

12. **`src/commands/watch.ts`** — File watcher. Test: auto-registration on file change, debouncing, ignore patterns, cleanup on exit.

13. **`src/commands/rescue.ts`** — Repository recovery. Test: scan/triage/salvage pipeline, branch categorization logic, component extraction.

### P3 — Storage & Messaging Layer

14. **`src/storage/local-messages.ts`** / **`message-factory.ts`** — Message routing. Test: adapter selection logic, message persistence, read/unread state management.

15. **`src/storage/adapter.ts`** — Interface contract. Test: ensure all implementations satisfy the adapter interface (contract tests).

16. **`src/storage/supabase.ts`** — Only has push benchmark, missing: connection failure handling, retry logic, conflict resolution on concurrent writes.

### P4 — Nice to Have

17. **`src/commands/dashboard.ts`** / **`src/tui/`** — TUI rendering is hard to test but snapshot tests for rendered output would catch regressions.

18. **`src/lib/activity.ts`** — Activity logging. Test: log rotation, format consistency.

19. **`src/commands/config.ts`** — Config management. Test: get/set/delete operations, nested key paths, type coercion.

## Structural Recommendations

### 1. Add Contract Tests for Storage Adapters
Create a shared test suite that runs against every `StorageAdapter` implementation (local, supabase, git-messages) to verify they all satisfy the same interface contract.

### 2. Add CLI Integration Tests
Test the full `spidersan <command>` flow end-to-end using `execFileSync` against the built binary. This catches argument parsing, output formatting, and exit code issues that unit tests miss.

### 3. Enable Coverage Thresholds
Add to `vitest.config.ts`:
```ts
coverage: {
  thresholds: {
    statements: 50, // start here, ratchet up over time
    branches: 40,
    functions: 50,
    lines: 50,
  }
}
```

### 4. Fix Existing Test Failures
The 4 failing tests in `git-messages.test.ts` and `git-injection.test.ts` fail because `git commit` requires `user.name`/`user.email` config. Fix by adding to the test setup:
```ts
execSync('git config user.email "test@test.com"', { cwd: dir });
execSync('git config user.name "Test"', { cwd: dir });
```

### 5. Add Test Helpers
Create a `tests/helpers/` module with:
- `createTestRegistry()` — pre-populated registry for command tests
- `createTempGitRepo()` — standardized git repo setup (fixing the config issue above)
- `mockStorage()` — consistent storage mock factory
