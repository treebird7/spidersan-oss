# P1-DEEPENING-3 — Pure `ConflictAnalyzer`

**Status:** blocked (depends on P1-DEEPENING-2-conflict-tier)
**Owner:** spidersan-m5
**Source:** `spidersan-ai/docs/arch/STATE.json` candidate `P1-DEEPENING-3-conflict-analyzer`; consortium 2026-05-03 (sherlocksan-m2 A2 #3 — hard-blocks on #2)
**Related:** P1-DEEPENING-2-conflict-tier (prerequisite); `src/lib/ast.ts` (already deep, this contract composes); SECURITY-H10 (lands here as final mitigation)

> **Note:** scaffold by spidersan-m5 (P0-A3 trailing criterion). Edit-in-place. Hard-blocks
> on #2 — do not start authoring code until #2 is merged. The contract itself can be reviewed
> earlier.

## Goal

Conflict overlap detection and tier assignment are still inlined inside `commands/conflicts.ts`
at L64 (`getConflictTier` — moves out via DEEPENING-2) and L446 (the cross-branch overlap
walk). The latter is the focus of this contract: the loop that takes a registry of branches
and a target file set, walks pairwise overlaps, classifies each conflict, and emits the tier-3
blocking decision is **mixed in with command-level concerns** (CLI output, exit code, telemetry).

`src/lib/ast.ts` is already a clean, deep module (per consortium A2 #3 — "AST already deep").
What's missing is a `ConflictAnalyzer` that **composes** AST-based content analysis with
DEEPENING-2's `classifyTier` to produce a single decision artifact:

```ts
analyze({ branches, targetFiles }) → ConflictReport
```

Pure: no I/O, no console, no process exit. Deterministic given inputs. Trivially testable.

## Seam

```ts
// src/lib/conflict-analyzer.ts
import { classifyTier, TIER_LABELS, type ConflictTier } from './conflict-tier.js';
import { analyzeFileSymbols } from './ast.js';  // existing

export interface ConflictReport {
  conflicts: Conflict[];
  highest: ConflictTier;            // for exit-code mapping at the call site
  shouldBlock: boolean;             // = (highest === 3)
  byTier: Record<ConflictTier, Conflict[]>;
}

export interface Conflict {
  file: string;
  tier: ConflictTier;
  branches: BranchRef[];            // who else is touching this file
  symbolsOverlap?: string[];        // populated when AST analysis was available
  classifierSource: 'path' | 'symbol';  // SECURITY-H10 telemetry
  recommendation: string;           // from TIER_LABELS
}

export function analyzeConflicts(input: {
  branches: Branch[];
  targetFiles: string[];
  options?: { extraTier3?: RegExp[]; extraTier2?: RegExp[]; useSymbolAware?: boolean };
}): ConflictReport;
```

The `classifierSource` field is the H10 hook: when symbol-aware mode is on, the analyzer
reads `analyzeFileSymbols(file)` and may *promote* a tier (e.g. a benign-named file that
contains a `setSecret()` call promotes from TIER 1 → TIER 3). When symbol-aware mode is off
or AST analysis fails (parse error, non-source file), it falls back to `classifyTier` from
DEEPENING-2 and tags `classifierSource: 'path'`.

## Files to touch

| Path | Change |
|---|---|
| `src/lib/conflict-analyzer.ts` | NEW — pure analyzer module |
| `src/commands/conflicts.ts` | EDIT — replace inlined overlap loop at L446 with `analyzeConflicts({...})`; keep CLI rendering and exit code mapping |
| `src/commands/cross-conflicts.ts` | EDIT (optional, follow-up) — same composition for cross-machine variant |
| `tests/conflict-analyzer.test.ts` | NEW — pure-function tests; cover overlap, tier promotion via AST, fallback to path |
| `src/lib/ast.ts` | UNCHANGED — consumed only |

## Verification

- `tsc --noEmit` clean.
- `analyzeConflicts` is pure (no `process.*`, no `console.*`, no `fs.*` references in the new module).
- The CLI output of `spidersan conflicts` is byte-identical to today's output for any pre-existing test fixture, when `useSymbolAware: false` (the default during the migration PR).
- Adding `useSymbolAware: true` is a separate PR (the H10 lift); this contract makes it land as a one-line option flip, not a refactor.

## Critical: hard-block discipline

Do not start coding this until DEEPENING-2 is merged. The contract may be reviewed in
parallel; the implementation depends on `src/lib/conflict-tier.ts` existing. Starting early
risks two parallel branches re-introducing the duplication this whole arc is designed to
remove.

## Files NOT to touch

- `src/lib/ast.ts` (already deep)
- `src/lib/regex-utils.ts`
- Any caller of `getConflictTier` outside `commands/conflicts.ts` that DEEPENING-2 already
  migrated

## Cross-cut: SECURITY-H10

This contract is the natural landing pad for H10 (symbol-aware classifier in CLI) per
`spidersan-ai/docs/SECURITY_HARDENING.md` L107: "Tier classification then reads symbols, not
paths." The `classifierSource` enum and `useSymbolAware` flag are H10's affordances. After
DEEPENING-3 ships, H10 = (1) flip the default to `useSymbolAware: true`, (2) extend the AST
module with the symbol patterns currently encoded as path regexes (`auth.*`, `security.*`).
The interface stays the same.
