# SPEC — `merge-plan` (the fusion command)

**Feature 1 of 3 — the integrator** · Foundations: A1+A2+A3 · Command: B3 · Target: 0.11.0

---

## Problem

Driving a real merge train (RT #175/#179/#181, 2026-06-16) required hand-stitching four tools: `gh pr list --json` → `gh pr view` → `gh pr checks` → `git merge-tree`. Spidersan contributed nothing to the decision. `merge-plan` makes that one command: an **ordered, per-PR verdict** that says what to merge, in what order, and what's blocking.

## Goal

`spidersan merge-plan` scans open PRs for the configured repo(s) and emits an ordered plan. For each PR it fuses:
- **PR state** (A2): base, `mergeStateStatus`, `mergeable`, CI rollup.
- **Real conflict** (A1): `analyzeRealConflicts(base, head)` — the true blocker file(s), not registry overlap.
- **Staleness**: commits behind base (`getAheadBehind`) + whether the latest checks ran behind current base HEAD → `STALE` flag (surface, don't judge).
- **Stack detection** (A3): `baseRefName !== trunk` ⇒ stacked; order parent before child; flag retarget-needed.

## Command — `src/commands/merge-plan.ts`

Description (verbatim for registry): **`Ordered merge plan for open PRs (fuses PR + CI + real git conflicts)`**

Options: `--json`, `--base <trunk>` (default `getTrunkBranch()`), `--limit <n>`, `--include-drafts` (default off), `--repo <owner/name>` (default: configured repos / current).

### Algorithm
1. `isGhAvailable()` guard; else friendly message + exit 0.
2. **Resolve repo** (review): `--repo` → else `gh repo view --json owner,name` → use as "owner/name" for every gh call. List PRs via `listPullRequests` (note: it currently calls `gh pr list --state all` — **filter to `state === 'OPEN'` in merge-plan**, since the lib returns all states). Drop drafts unless `--include-drafts`. `listPullRequests`'s `GitHubPRInfo` does **not** carry `baseRefName` — get base/head from per-PR `getPRMergeState`, not the list.
3. For each PR (bounded concurrency): `getPRMergeState(n, {repo})` (A2) → base, head, `headRefOid`, mergeable, mergeStateStatus, rollup. **Fork-safe head ref** (review): `headRefName` may not exist locally and fork heads aren't under `origin/`. Fetch the canonical PR head: `git fetch origin pull/<n>/head` (or use `headRefOid` directly) and pass that ref/SHA to `analyzeRealConflicts(base = baseRefName-or-trunk, head = headRefOid)` (A1). If the head can't be fetched (rare), mark conflicts `unknown` and surface advisory — don't crash.
4. **Staleness (simplified — review):** the "checks ran N commits behind head SHA" claim isn't cleanly computable from current `getCIStatus`/`getAheadBehind`. Define `stale = mergeStateStatus === 'BEHIND' || behind > 0` (PR behind its base) — an available, actionable signal. `behind` from `getAheadBehind(config, head, base)`.
5. **Stack ordering (explicit edge direction — review):** a PR is a *stacked child* when its `baseRefName` equals another open PR's `headRefName`. Build graph edges **parent → child** (parent = the PR whose head is the child's base). Pass PR numbers (as strings) to `topologicalSort` (`src/lib/graph.ts`) — reuse **only** `topologicalSort`, NOT `buildConflictGraph`/`calculateBlockingCounts` (those are file-overlap-specific). `topologicalSort` emits zero-in-degree (parents) first; it tie-breaks **alphabetically** unless given blocking-counts, so apply the readiness ordering (clean+green first, then behind asc) as a **separate stable sort within each available set** (or a small local Kahn loop with a readiness comparator). Add a test asserting parent `#179` precedes child `#181`.
6. Assign each PR a **verdict**:
   - `MERGE` — base=trunk, mergeable=MERGEABLE, no real conflicts, no failing **required** checks.
   - `BLOCKED: conflict in <files>` — real conflicts found.
   - `WAIT: stacked on #<n>` — base is another open PR's head (+ "retarget to <trunk> after #n lands").
   - `VERIFY: <mergeStateStatus>` — UNSTABLE/BEHIND/BLOCKED/required-check-failing (list `failingRequired`).
   - `STALE: <behind> commit(s) behind base` — surface (PR behind its base; see staleness def above); pairs with whatever other verdict applies.
   - `UNKNOWN` — mergeable=UNKNOWN after one re-poll (report honestly).

### Output
- **Human:** a numbered, ordered list:
  ```
  🕷️ Merge plan — base: main (3 open PRs)

   1. #175  MERGE            password reset            ✓ mergeable ✓ build  (e2e: non-required fail)
   2. #179  BLOCKED          checkout redesign      conflict: src/components/CheckoutScreen.tsx
   3. #181  WAIT (stack)     coupon support        base=feat/checkout-redesign → retarget to main after #179
  ```
  Footer: legend + the reminder "CI red can be flake/infra — staleness shown, realness is yours to judge."
- **JSON:** `{ base, generatedFor: repo, plan: [{ number, title, verdict, base, head, mergeStateStatus, mergeable, behind, stale, conflicts: string[], stackedOn: number|null, advisories: string[] }] }`.
- Exit **0** always (advisory/report). (No `--exit-code` — this is a planner, not a gate.)

### Reuse (do not reinvent)
- `listPullRequests`, `getPRMergeState`(A2), `getAheadBehind`, `isGhAvailable` — `src/lib/github.ts`
- `analyzeRealConflicts`(A1) — `src/lib/git-merge-analyzer.ts`
- `getTrunkBranch`(A3) — `src/lib/trunk.ts`
- `topologicalSort` — `src/lib/graph.ts`
- `--json`/command skeleton — mirror `src/commands/merge-order.ts`

## Tests — `tests/merge-plan.test.ts`
Mock `github.ts` (PR list + merge-state), `git-merge-analyzer` (conflicts), `trunk`. Assert against the **golden-derived golden case**:
- 3 PRs: #175 (base main, MERGEABLE, no conflict) → `MERGE`, ordered first.
- #179 (base main, real conflict in `CheckoutScreen.tsx`) → `BLOCKED`, conflict file surfaced.
- #181 (base = #179's head) → `WAIT: stacked on #179`, retarget advisory, ordered after #179.
- A PR whose checks ran behind base → `STALE` flag present alongside its verdict.
- `--json` shape matches; drafts excluded unless `--include-drafts`; `gh` unavailable → graceful.

## Acceptance
- [ ] `spidersan merge-plan` on golden-case input reproduces the #175→#179→#181 verdicts/order derived from a real stacked-PR merge train.
- [ ] Stacked PRs detected + ordered parent-before-child with retarget advisory.
- [ ] Real conflict files (not registry overlap) drive `BLOCKED`.
- [ ] Staleness surfaced; no auto-judgment of CI realness.
- [ ] `--json`, `--base`, `--limit`, `--include-drafts` work; exits 0.
- [ ] Lint/typecheck/build/test green.

## Phase C wiring (integrator)
- Register `merge-plan` in `command-registry.ts` (description verbatim) + barrel.
- CHANGELOG: headline feature for 0.11.0.
