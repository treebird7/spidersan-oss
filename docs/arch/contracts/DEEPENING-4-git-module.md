# P1-DEEPENING-4 — Extract Git Operations Module

**Status:** specced
**Owner:** spidersan-m5
**Depends on:** none
**Rationale:** `getCurrentBranch()` is defined identically in 8 command files; `getChangedFiles()`
is defined in 2. Every command reaches directly into `child_process` with `execFileSync('git', [...])`.
There is no seam for git operations — tests must mock child_process at each call site independently,
and git error handling diverges file-by-file.

## Goal

Extract all shared git operations into `src/lib/git.ts` — a single deep module. Commands import
from it; tests mock one place. Error handling, fallback strategies, and security conventions
(always `execFileSync(cmd, [args])`, never string interpolation) live in one place.

## Seam

```ts
// src/lib/git.ts

/**
 * Returns the current branch name.
 * Throws with a clean message if not in a git repository.
 */
export function getCurrentBranch(): string;

/**
 * Returns the list of files changed relative to the branch base.
 * Tries strategies in order; returns [] if all fail (detached HEAD, empty repo).
 * Default strategies: ['main...HEAD', 'HEAD~1', 'HEAD'] — same as existing inline fallback.
 */
export function getChangedFiles(options?: { base?: string }): string[];

/**
 * Returns the content of a file at a given git ref.
 * Returns null if the file does not exist at that ref.
 * Throws if the ref itself is invalid.
 */
export function getFileAtRef(ref: string, filePath: string): string | null;

/**
 * Returns the SHA of the remote branch HEAD.
 * Uses `git ls-remote` (no object download).
 * Returns null if remote is unreachable or branch does not exist.
 */
export function getRemoteHead(remote: string, branch: string): string | null;

/**
 * Returns how many commits the local branch is ahead/behind its remote tracking branch.
 * Returns { ahead: 0, behind: 0 } if no tracking branch is configured.
 */
export function getAheadBehind(remote?: string, branch?: string): { ahead: number; behind: number };
```

All functions:
- Use `execFileSync('git', [args], { encoding: 'utf-8' })` — never string concatenation
- Pass env via `env: { ...process.env }` object, not inline
- Throw typed `GitError` (see below) on failure, never raw `Error('string')`

```ts
export class GitError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_A_REPO' | 'INVALID_REF' | 'EXEC_FAILED'
  ) { super(message); this.name = 'GitError'; }
}
```

## Files to touch

| Path | Change |
|---|---|
| `src/lib/git.ts` | NEW — all git operations |
| `src/commands/conflicts.ts` | EDIT — remove local `getCurrentBranch`, import from `../lib/git.js` |
| `src/commands/pulse.ts` | EDIT — same |
| `src/commands/register.ts` | EDIT — remove local `getCurrentBranch` and `getChangedFiles`, import from `../lib/git.js` |
| `src/commands/watch.ts` | EDIT — same |
| `src/commands/ready-check.ts` | EDIT — remove local `getCurrentBranch` and `getChangedFiles`, import from `../lib/git.js` |
| `src/commands/depends.ts` | EDIT — remove local `getCurrentBranch`, import from `../lib/git.js` |
| `src/commands/abandon.ts` | EDIT — remove local `getCurrentBranch`, import from `../lib/git.js` |
| `src/commands/merged.ts` | EDIT — remove local `getCurrentBranch`, import from `../lib/git.js` |
| `tests/git.test.ts` | NEW — vitest tests using child_process mocking |

## Critical: do not remove existing tests

Only ADD tests. Do not delete, comment out, or replace any test in any existing test file.
The conflict-tier.test.ts file uses `node:test` runner — leave it exactly as-is (it is a
pre-existing issue tracked separately). Do not touch it.

## Tests required (vitest format, NOT node:test)

All new tests go in `tests/git.test.ts` and use `import { describe, it, expect, vi } from 'vitest'`.

1. `getCurrentBranch` returns branch name on success
2. `getCurrentBranch` throws `GitError` with code `NOT_A_REPO` when not in a repo
3. `getChangedFiles` returns files from first succeeding strategy
4. `getChangedFiles` returns `[]` when all strategies fail (not an error)
5. `getFileAtRef` returns null when file does not exist at ref
6. `getRemoteHead` returns null when remote is unreachable (silent, not thrown)
7. `getAheadBehind` returns `{ ahead: 0, behind: 0 }` when no tracking branch

## Files NOT to touch

- `src/lib/security.ts` (validation helpers — git.ts should call `validateFilePath` when
  accepting file paths as input)
- Any command file's non-git logic
- `src/lib/conflict-tier.ts`
- Any existing test fixture

## Success criteria

- [ ] `src/lib/git.ts` exists with all 5 exported functions + `GitError`
- [ ] No `getCurrentBranch` function defined inline in any command file
- [ ] No `getChangedFiles` function defined inline in any command file
- [ ] All new command imports use `import { ... } from '../lib/git.js'`
- [ ] `tsc --noEmit` clean
- [ ] `pnpm build` clean
- [ ] `tests/git.test.ts` exists with at least 7 vitest test cases, all passing
- [ ] All previously passing tests still pass (84 tests)

## Out of scope

- Migrating `getRemoteHead` or `getAheadBehind` callers (they don't exist yet in commands —
  these are forward-looking for DEEPENING-pulse-remote-drift)
- Async versions of any function (keep sync for now; matches existing call pattern)
- Git fetch / push operations (out of scope — git.ts is read-only git queries)
