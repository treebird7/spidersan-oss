# P1-DEEPENING-6 — Command Output Seam

**Status:** specced
**Owner:** spidersan-m5
**Depends on:** P1-DEEPENING-3-conflict-analyzer (ConflictReport type)
**Rationale:** 230+ `console.log` calls are mixed into business logic across all command files.
The symptom is most acute in `conflicts.ts` (68 console calls): you cannot test "does conflict
detection work?" without capturing stdout. Once DEEPENING-3 provides a typed `ConflictReport`,
`conflicts.ts` is the first command to get the seam. Other commands follow the same pattern
in subsequent PRs.

## Goal

Separate the core logic from the output formatting in `conflicts.ts`. The command function
returns a typed `ConflictReport` (from DEEPENING-3). A pure `renderConflictReport(report, options)`
function formats it for the terminal. The `--json` path calls `JSON.stringify(report)` directly
— no second code path through the logic. Other commands are out of scope for this contract;
they adopt the pattern in follow-up work.

## Seam

```ts
// src/lib/conflict-renderer.ts

import type { ConflictReport } from './conflict-analyzer.js';

export interface RenderOptions {
  verbose?: boolean;
  showRecommendations?: boolean;
}

/**
 * Pure function. Formats a ConflictReport as a terminal string.
 * No console.log — returns a string the caller prints.
 * Deterministic: same report + options = same output.
 */
export function renderConflictReport(report: ConflictReport, options?: RenderOptions): string;
```

In `conflicts.ts`:

```ts
// Before (untestable):
// ... 68 console.log calls mixed with detection logic ...

// After:
import { analyzeConflicts } from '../lib/conflict-analyzer.js';
import { renderConflictReport } from '../lib/conflict-renderer.js';

const report = analyzeConflicts({ branches, targetFiles, options: { ... } });

if (opts.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(renderConflictReport(report, { verbose: opts.verbose }));
}
process.exit(report.shouldBlock && opts.strict ? 1 : 0);
```

## Files to touch

| Path | Change |
|---|---|
| `src/lib/conflict-renderer.ts` | NEW — pure `renderConflictReport` function |
| `src/commands/conflicts.ts` | EDIT — replace inlined console.log blocks with `renderConflictReport`; keep CLI scaffolding (Commander action, exit code) |
| `tests/conflict-renderer.test.ts` | NEW — vitest tests asserting on the returned string |

## Critical: do not remove existing tests

Only ADD tests. Do not delete, comment out, or replace any test in any existing test file.
The behavior-preserving operational gate in STATE.json applies: CLI output for
`spidersan conflicts` must be byte-identical to pre-DEEPENING output for any existing fixture
when `useSymbolAware: false`.

## Tests required (vitest format)

All in `tests/conflict-renderer.test.ts`.

1. Empty ConflictReport (no conflicts) renders "no conflicts" summary
2. Tier 1 conflict renders correct icon (🟡) and label
3. Tier 2 conflict renders correct icon (🟠) and label
4. Tier 3 conflict renders correct icon (🔴) and BLOCK label
5. `symbolsOverlap` populated -> rendered in output when verbose
6. `symbolsOverlap` empty -> not rendered in non-verbose mode
7. Pure function: same report always returns same string (no Date.now, no randomness)

## Files NOT to touch

- `src/lib/conflict-analyzer.ts` (DEEPENING-3 output — consumed only)
- `src/commands/watch.ts`, `pulse.ts`, `register.ts` — other commands adopt seam in follow-up PRs
- Any existing test file

## Success criteria

- [ ] `src/lib/conflict-renderer.ts` exists with `renderConflictReport` exported
- [ ] `renderConflictReport` has zero `console.log` / `process.exit` / `fs.*` calls
- [ ] `conflicts.ts` has at most 3 `console.log` calls (one for JSON, one for human, one for errors)
- [ ] `--json` output is valid JSON parseable as `ConflictReport` shape
- [ ] `tsc --noEmit` clean
- [ ] `pnpm build` clean
- [ ] `tests/conflict-renderer.test.ts` exists with at least 7 vitest tests, all passing
- [ ] All previously passing tests still pass

## Out of scope

- Applying the output seam to `pulse.ts`, `watch.ts`, `register.ts`, `ready-check.ts` —
  those follow in separate PRs after this pattern is established
- Color/ANSI stripping for CI environments (future work)
