# P1-DEEPENING-2 — Extract `conflict-tier` module

**Status:** done (2026-05-04, codex gpt-5.4/high)
**Owner:** spidersan-m5
**Source:** `spidersan-ai/docs/arch/STATE.json` candidate `P1-DEEPENING-2-conflict-tier`; consortium 2026-05-03 (sherlocksan-m2 + yosef sequencing); `spidersan-ai/docs/SECURITY_HARDENING.md` H10
**Related:** P1-DEEPENING-3-conflict-analyzer (hard-blocks on this); SECURITY-H10 (lands as a side-effect; H10 should run AFTER #2, not parallel — yosef)

> **Note:** scaffold by spidersan-m5 (P0-A3 trailing criterion). Edit-in-place; revise as
> implementation reveals constraints. The duplication this contract removes is verified
> byte-for-byte across the 4 referenced files — the pattern arrays are identical.

## Goal

The TIER 1/2/3 path-pattern lists and their `classifyTier` / `getConflictTier` helpers are
duplicated across **5 files** today (contract originally said 4 — codex caught
`src/lib/ai/event-handler.ts:14-28` during implementation; the spec grep was incomplete).
spidersan-m5 verified line-for-line on `main` 2026-05-03 (sha `006d51e` baseline):

| File | Tier patterns at | Tier helper at |
|---|---|---|
| `src/commands/conflicts.ts` | L28 (`TIER_3_PATTERNS`), L41 (`TIER_2_PATTERNS`) | L64 (`getConflictTier`, returns `ConflictTier` object with label/icon/action) |
| `src/commands/cross-conflicts.ts` | L28, L40 | L55 (`classifyTier`, returns `1\|2\|3`); separate `TIER_LABELS` table at L65 |
| `src/commands/pulse.ts` | L20, L33 | L48 (`classifyTier` with optional extra-pattern args) |
| `src/lib/ai/context-builder.ts` | L38, L44 | L50 (`classifyTier`, no extras) |
| `src/lib/ai/event-handler.ts` | L14, L20 | L26 (`classifyTier`, no extras) — **added during impl, not in original spec** |

All four arrays are byte-identical. Each call site re-compiles patterns and re-invents the
3-tier label table. SECURITY-H10 wants tier classification to read **symbols, not paths** —
this contract is the prerequisite seam: one place to swap the implementation.

## Seam

New module: `src/lib/conflict-tier.ts`. Exports:

```ts
export type ConflictTier = 1 | 2 | 3;
export interface TierLabel { label: string; icon: string; action: string }

// Default pattern tables (today's behavior preserved)
export const DEFAULT_TIER_3_PATTERNS: RegExp[];
export const DEFAULT_TIER_2_PATTERNS: RegExp[];

// Pure classifier
export function classifyTier(
  file: string,
  opts?: { extraTier3?: RegExp[]; extraTier2?: RegExp[] }
): ConflictTier;

// Label lookup (replaces the 3 partial tables across files)
export const TIER_LABELS: Record<ConflictTier, TierLabel>;

// Convenience: classify + label in one shot
export function classifyWithLabel(file: string, opts?): { tier: ConflictTier } & TierLabel;
```

Behavior: identical to today's implementation (substring-on-`RegExp` check, TIER 3 first then
TIER 2, default TIER 1). The existing `compilePatterns()` from `lib/regex-utils.ts` is reused
internally — call sites no longer pre-compile.

## Files to touch

| Path | Change |
|---|---|
| `src/lib/conflict-tier.ts` | NEW — module with patterns, classifier, labels |
| `src/commands/conflicts.ts` | DELETE local `TIER_*_PATTERNS` + `getConflictTier`; import from new module |
| `src/commands/cross-conflicts.ts` | Same; replace `TIER_LABELS` local table with imported |
| `src/commands/pulse.ts` | Same; thread `opts` parameter through if any caller uses extras |
| `src/lib/ai/context-builder.ts` | Same |
| `tests/conflict-tier.test.ts` | NEW — Node `--test` runner; cover each tier per-pattern + extras + default-fallthrough |

Approximate diff: -120 LOC (4 dedupes), +60 LOC (one module + tests). Net-negative.

## Verification

After the refactor, `grep -nE 'TIER_[23]_PATTERNS|classifyTier|getConflictTier' src/` should
show **only** `src/lib/conflict-tier.ts` (definitions) and the 4 call sites (imports).

Existing tests must continue to pass. `tsc --noEmit` clean. `pnpm build` clean.

## Critical: do not regress label semantics

`commands/conflicts.ts` has the most detailed label table (icon + action both differ between
TIER 2 in `conflicts.ts` and `cross-conflicts.ts` — "Coordinate with other agent…" vs
"Coordinate with remote agent before proceeding"). The new `TIER_LABELS` should preserve the
**conflicts.ts** wording as the canonical, since it's user-facing in the most common command.
`cross-conflicts.ts` callers may need a small adapter or may accept the canonical wording —
spec a one-line decision in the PR.

## Files NOT to touch

- `src/lib/ast.ts` (already deep; SECURITY-H10 / DEEPENING-3 will compose this in later)
- `src/lib/regex-utils.ts` (just consume `compilePatterns`)
- Any test fixtures for existing eval paths

## Cross-cut: SECURITY-H10

Per yosef's sequencing decision, H10 (symbol-aware tier classification) lands AFTER this
contract, not in parallel. This contract creates the seam; H10 swaps the implementation.
Concretely: H10 will replace `classifyTier(file)` with a function that consults
`src/lib/ast.ts` for content-aware classification, falling back to path patterns when AST
analysis is unavailable. The interface stays the same — only the body changes.
