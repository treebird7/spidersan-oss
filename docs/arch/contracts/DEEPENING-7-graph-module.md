# P1-DEEPENING-7 — Extract Pure Graph / Topological Sort Module

**Status:** specced
**Owner:** spidersan-m5
**Depends on:** none
**Rationale:** `topologicalSort()` and `buildConflictGraph()` are buried inside
`src/commands/merge-order.ts` with no extraction. They are pure computation — no I/O, no storage,
no git calls. There is zero test coverage for the most failure-prone coordination operation in
spidersan. Deletion test: delete the command wrapper, the algorithm complexity concentrates at
the functions — they are clearly earning their keep in the wrong place.

## Goal

Extract the graph construction and topological sort into `src/lib/graph.ts` — a pure, dependency-free
module. `merge-order.ts` calls it. Tests cover the algorithm directly without any storage or git mocks.

## Seam

```ts
// src/lib/graph.ts

export type NodeId = string;

/**
 * Build a conflict adjacency map: for each branch, which other branches
 * share overlapping files?
 * Pure function — takes branch data, returns a Map.
 */
export function buildConflictGraph(
  branches: Array<{ name: string; files: string[] }>
): Map<NodeId, NodeId[]>;

/**
 * Topological sort with tie-breaking by blocking count.
 * Returns branches in recommended merge order.
 * Cycles are broken by inserting branches at earliest valid position.
 * blockingCounts is optional; when omitted, sort is alphabetical within tied groups.
 */
export function topologicalSort(
  nodes: NodeId[],
  graph: Map<NodeId, NodeId[]>,
  blockingCounts?: Map<NodeId, number>
): NodeId[];

/**
 * For each node, count how many other nodes are (transitively) blocked by it.
 * Used for rarest-first prioritization.
 */
export function calculateBlockingCounts(
  nodes: NodeId[],
  graph: Map<NodeId, NodeId[]>
): Map<NodeId, number>;
```

All functions are pure (no side effects, no I/O, no process.exit). Deterministic given the same inputs.

## Files to touch

| Path | Change |
|---|---|
| `src/lib/graph.ts` | NEW — `buildConflictGraph`, `topologicalSort`, `calculateBlockingCounts` |
| `src/commands/merge-order.ts` | EDIT — remove inline implementations; import from `../lib/graph.js`; keep CLI scaffolding (Commander, console output, storage reads) |
| `tests/graph.test.ts` | NEW — vitest tests covering graph construction and sort correctness |

## Critical: do not remove existing tests

Only ADD tests. Do not delete, comment out, or replace any test in any existing test file.

## Tests required (vitest format)

All in `tests/graph.test.ts` using `import { describe, it, expect } from 'vitest'`.

1. `buildConflictGraph` returns empty map for branches with no file overlap
2. `buildConflictGraph` links two branches that share a file
3. `buildConflictGraph` does not link a branch to itself
4. `topologicalSort` returns single node unchanged
5. `topologicalSort` returns independent nodes in stable order
6. `topologicalSort` places non-conflicting branch before conflicting branch
7. `topologicalSort` handles cycle gracefully (does not throw, returns all nodes)
8. `calculateBlockingCounts` returns 0 for node with no outgoing edges
9. `calculateBlockingCounts` returns correct count for hub node (blocks N others)

## Files NOT to touch

- `src/storage/` (merge-order.ts reads storage — that stays in the command)
- `src/lib/conflict-tier.ts`
- Any existing test file

## Success criteria

- [ ] `src/lib/graph.ts` exists with all 3 exported functions
- [ ] No `topologicalSort`, `buildConflictGraph`, or `calculateBlockingCounts` defined inline in `merge-order.ts`
- [ ] All 3 graph functions have zero `console.*` / `process.*` / `fs.*` / `execFileSync` references
- [ ] `tsc --noEmit` clean
- [ ] `pnpm build` clean
- [ ] `tests/graph.test.ts` exists with at least 9 vitest tests, all passing
- [ ] All previously passing tests still pass (84 tests)

## Out of scope

- Weighted graph algorithms (DAG shortest path, etc.)
- Supabase dependency graph (`depends.ts` / `spidersan depends`) — separate concern
- Visualisation of the graph (CLI tree output stays in merge-order.ts)
