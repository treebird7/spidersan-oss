# PLAN — Spidersan PR-Coordination Suite

**Branch:** `feat/pr-coordination` · **Target version:** 0.11.0 · **Date:** 2026-06-16
**Author:** spidersan/m5 · **Status:** Draft for ratification

---

## Why

Spidersan coordinates *branches in a registry*, but the merge **decision** lives in GitHub (PR base chains, `mergeStateStatus`, CI rollup) + git (real conflicts via `merge-tree`). It doesn't fuse them. Evidence (example merge train, PRs #175/#179/#181): every authoritative call came from raw `gh` + `git merge-tree`; `spidersan github-sync` only counted branches, `ready-check`/`merge-order`/`conflicts` are registry-only. We close that gap.

## What we're building (3 features)

1. **`merge-plan`** — one command that fuses PR + CI + git into an **ordered merge verdict**. The integrator.
2. **`conflicts --real`** — git-`merge-tree`-backed true conflict detection (vs registry file-overlap heuristic).
3. **`pr-check <n>` + `verify-trunk`** — first-class promotions of the two hooks shipped 2026-06-15 (stacked/red PR precheck; post-merge trunk-poison).

## Non-goals (explicit)

- **No auto-classification of "is this red CI real vs flake/infra."** That's human judgment (Node-20/WebSocket infra, spurious sql-review on no-SQL PR, e2e flake — all seen this session). We **surface staleness** ("checks ran N commits behind base") and let the human judge.
- **No reimplementing GitHub.** Value is fusion, not replacement. Reuse `gh` via existing `src/lib/github.ts`.
- No Supabase requirement — features are local-first (may emit to the existing Supabase boundary later, out of scope).

## Architecture — dependency graph

```
Phase A0 (PRE — ALREADY APPLIED): export `execGit` from src/lib/git.ts.
         Without it A3 (trunk.ts) can't import execGit and isn't independent of A1.
         With it, A1/A2/A3 are truly parallel.

Phase A: FOUNDATIONS (shared libs, disjoint files, parallel-safe AFTER A0)
  A1  src/lib/git-merge-analyzer.ts   (+ git.ts: getMergeConflicts)   ──► conflicts --real, merge-plan
  A2  src/lib/github.ts  (+ getPRMergeState: base, mergeStateStatus,  ──► pr-check, merge-plan
                            mergeable, CI rollup)
  A3  src/lib/trunk.ts   (getTrunkBranch: symbolic-ref → .spidersanrc ──► verify-trunk, merge-plan
                            → main/master fallback)

Phase B: COMMANDS (disjoint files, parallel-safe; do NOT touch command-registry.ts)
  B1  src/commands/conflicts.ts  --real flag            (uses A1)
  B2  src/commands/pr-check.ts + verify-trunk.ts        (uses A2, A3)
  B3  src/commands/merge-plan.ts                        (uses A1, A2, A3)

Phase C: INTEGRATION (single agent — owns all shared-file edits)
  C1  register B1/B2/B3 in src/bin/command-registry.ts (COMMANDS array — this is what
      ROUTES commands; commands/index.ts barrel is cosmetic and does NOT route)
      CHANGELOG.md + package.json + package-lock.json version bump + README.md + STATE.json
      build + typecheck + lint + test:run  → loop-fix until GREEN
```

**Collision design:** A pre-step **A0** exports `execGit` (already applied) so A1/A2/A3 are truly independent. Phase A & B agents then write **disjoint** files only. Every shared file (`command-registry.ts`, `commands/index.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json`, `README.md`, `STATE.json`) is touched **only** in Phase C by a single agent. This removes all parallel-write races without needing per-agent git worktrees. Phases are **barriers** (B imports A's exports; C wires B's modules).

## Reuse map (from codebase survey)

| Need | Reuse | Path |
|------|-------|------|
| Run git safely | `execGit()` wrapper + `GitError` | `src/lib/git.ts` |
| Fetch PRs/CI via `gh` | `listPullRequests`, `getCIStatus`, `getPRDetails`, `getAheadBehind`, `isGhAvailable` | `src/lib/github.ts` |
| Registry read | `JsonBranchRegistryStore.list/get` via `getStorage()` | `src/storage/json-branch-registry-store.ts` |
| Order branches | `buildConflictGraph`, `topologicalSort`, `calculateBlockingCounts` | `src/lib/graph.ts` |
| Command pattern | `new Command(...).option().action()` + `--json` | `src/commands/merge-order.ts` |
| Register a command | `COMMANDS` array lazy-load entry | `src/bin/command-registry.ts` |

## Conventions (must follow)

- TypeScript, ESM (`.js` import suffixes), build `npm run build` (tsc → dist/).
- New command module: `src/commands/<name>.ts` exporting `export const <name>Command = new Command('<name>')…`.
- Register: add `{ name, description, load }` to `COMMANDS` in `command-registry.ts`. **`description` MUST exactly match the command's `.description()`** — `tests/bin-command-registry.test.ts` enforces this.
- Tests: vitest, `tests/<name>.test.ts`; mock `child_process` + `src/storage/index.js`; use `MemoryBranchRegistryStore` for registry fixtures. Run `npm run test:run`.
- Lint `npm run lint`, typecheck `npm run typecheck`. `prepublishOnly` runs all three.
- Every command supports `--json`. Advisory commands exit 0; only hard gates exit non-zero (see each spec).
- Git robustness: `git merge-tree --write-tree` (git ≥2.38) with parse of the conflict-info block; **fallback** to legacy `git merge-tree <base> <ours> <theirs>` parsing for older git. Never assume a git version.

## Acceptance (suite-level)

- [ ] `npm run build && npm run typecheck && npm run lint && npm run test:run` all green on `feat/pr-coordination`.
- [ ] `bin-command-registry.test.ts` passes (3 new commands registered, descriptions synced).
- [ ] Each feature meets its spec's acceptance checklist.
- [ ] `merge-plan` reproduces, against example PRs #179/#181-class inputs, the golden-case verdicts: `#179 BLOCKED (conflict in CheckoutScreen.tsx)`, `#181 WAIT (stacked on #179)`, plus stale-check flag when checks ran behind base.
- [ ] No edits to `main`; CHANGELOG + version bump present; STATE.json reflects final status.
- [ ] README/docs note the 3 new commands (light — Phase C).

## Build orchestration (the team)

Run as a **Workflow** (deterministic phases):
- Phase A: 3 agents in parallel (barrier).
- Phase B: 3 agents in parallel (barrier).
- Phase C: 1 integration agent, loop-fix build/test until green.
- Each agent gets: its STATE.json task, its spec section, the reuse map, and "write ONLY your listed files."

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Parallel agents collide on shared files | Phase partitioning; all shared-file edits in Phase C only |
| Interdependent TS doesn't compile together | Phase C integration agent owns build+typecheck+loop-fix |
| `gh` not authed in agent env | `isGhAvailable()` guard; commands degrade gracefully + advise `gh auth login` |
| Old git without `--write-tree` | Dual-path analyzer with legacy fallback (A1 spec) |
| `mergeStateStatus` UNKNOWN (GitHub async-computes) | merge-plan/pr-check re-poll once, then report UNKNOWN honestly (don't block) |
| Registry-description drift breaks registry test | Phase C copies `.description()` text verbatim into COMMANDS |
