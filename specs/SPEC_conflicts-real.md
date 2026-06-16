# SPEC — `conflicts --real` (git-merge-tree-backed conflicts)

**Feature 2 of 3** · Foundation: A1 · Command: B1 · Target: 0.11.0

---

## Problem

`spidersan conflicts` detects conflicts by **registry file-overlap** (intersection of branches' `files` arrays) — a heuristic. Two branches touching the same file may NOT actually conflict (different regions), and a branch may conflict with the live trunk even when no other registered branch touches that file. The authoritative answer is `git merge-tree`. In practice, the real #179 conflict ("one file, CONFLICT content in CheckoutScreen.tsx") came only from `git merge-tree --write-tree origin/main <head>` — the registry view couldn't confirm it.

## Goal

Add `--real` to `conflicts` that computes **true** merge conflicts via git, against the trunk (or a `--base`), for the current branch (or `--branch`/all registered branches). Reuse-friendly: the analyzer lib is also consumed by `merge-plan`.

---

## A1 — Foundation: `src/lib/git-merge-analyzer.ts` (+ `git.ts`)

### `src/lib/git.ts` — add
`execGit` is now **exported** (A0 seam, already applied). Define the result type explicitly:
```ts
export interface MergeConflictResult {
  base: string; branch: string; mergeBase: string | null;
  conflicts: { file: string; kind: 'content' | 'add/add' | 'delete/modify' | 'rename' }[];
  clean: boolean;                       // conflicts.length === 0 && !error
  method: 'write-tree' | 'legacy';
  rawOutput?: string;
  error?: string;                       // env failure only (bad ref / not a repo)
}
/** Real conflicts merging `branch` into `base`. Prefers `--write-tree` (git ≥2.38),
 *  falls back to legacy 3-arg form. NEVER throws for "they conflict" — only sets `error`. */
export function getMergeConflicts(base: string, branch: string): MergeConflictResult
```
- **⚠️ exit-1 gotcha (the load-bearing detail):** `git merge-tree --write-tree` exits **non-zero on conflict**, so `execFileSync` **throws**. The conflict output is on the *thrown error's* `stdout`, not normal return. Reuse the existing `GitExecError` shape (`git.ts:17`) + `getErrorText` pattern: wrap the call in try/catch, and on a thrown error read `err.stdout`. **Status 1 with parseable conflict output = a valid conflict result, NOT an error.** Only a genuine git failure (bad ref, not-a-repo, "unknown option") becomes `error`/`GitError`.
- **Modern path:** `git merge-tree --write-tree <base> <branch>`. First line of output = the written tree OID; remaining lines = a conflict-info block listing conflicted paths. Parse paths from that block. Treat `--name-only`/`--no-messages` as *optional* refinements gated behind a capability probe (their support varies 2.38→2.50) — do not assume them.
- **Legacy fallback** (modern probe fails / "unknown option"): `mergeBase=$(git merge-base <base> <branch>)`, then `git merge-tree <mergeBase> <base> <branch>`. Output is a per-file record stream; extract paths by tracking the **file-header records** (the `merged`/`added in both`/`changed in both` lines), NOT by grepping `<<<<<<<` alone. Must handle **paths containing spaces**.
- Resolve refs leniently: accept local branch, `origin/<branch>`, or SHA; if missing, try `origin/<ref>`; else `error: 'ref not found: <ref>'` (do not throw).
- **Fixture-test both parsers** (see A1 tests) against recorded real output — never hand-wave the format.

### `src/lib/git-merge-analyzer.ts` — new
```ts
export interface RealConflict { file: string; kind: 'content' | 'add/add' | 'delete/modify' | 'rename'; }
export interface RealConflictReport {
  base: string; branch: string; mergeBase: string | null;
  conflicts: RealConflict[];        // empty = clean
  clean: boolean;
  method: 'write-tree' | 'legacy';
  error?: string;                   // e.g. ref not found / not a repo
}
export async function analyzeRealConflicts(base: string, branch: string): Promise<RealConflictReport>
```
- Thin orchestration over `getMergeConflicts`. Never throws for "branch conflicts" — only sets `error` for environmental failures (missing ref, not a repo).
- Pure function of git state; no registry, no network.

### A1 tests — `tests/git-merge-analyzer.test.ts`
- Build temp git repos in a tmp dir (allowed; some existing tests mock, but real git is fine here and higher-fidelity). Cases:
  1. Two branches edit the **same lines** of a file → 1 content conflict.
  2. Two branches edit the **same file, different regions** → **clean** (proves the heuristic-vs-real difference).
  3. add/add same new path with different content → conflict.
  4. Clean disjoint-file change → clean.
  5. Missing ref → `error` set, `clean=false`, no throw.
- If real-git temp repos are disallowed by CI sandbox, fall back to mocking `execGit` with captured `git merge-tree` fixtures (record real output for the 5 cases).

---

## B1 — Command: `conflicts --real`

**B1 deps: A1 + A3** (uses `analyzeRealConflicts` and `getTrunkBranch`).

### Edit `src/commands/conflicts.ts`
- Add options: `--real` (git merge-tree instead of registry overlap), `--base <ref>` (default = `getTrunkBranch()` from A3), `--branch <name>` (default = current branch), and **NEW `--all`** (every active registered branch — this option does not exist today; B1 adds it). Existing options (`--ecosystem`, `--pr`, `--semantic`, `--strict`, `--notify`, `--json`) must keep working.
- **⚠️ registry-init ordering (review):** existing `conflicts` inits storage early (`conflicts.ts:324`) and **exits if not initialized** (`:327`). A `--real` check for the current/`--branch` target is **pure git** and must work in repos with **no `.spidersan/registry.json`**. So handle `--real` **before** the storage-init guard. Only `--real --all` (which enumerates registered branches via `getStorage().list()`) requires an initialized registry — gate just that path.
- When `--real`:
  - Resolve base via `getTrunkBranch()` (or `--base`). Targets: current branch, or `--branch`, or (with `--all`) every active registered branch. For each, call `analyzeRealConflicts(base, branch)` (A1).
  - Human output: per branch, `✅ <branch>: clean vs <base>` or `⚠️ <branch>: N real conflict(s) vs <base>` + file list + `kind`. Trailing dim line shows `method` (write-tree/legacy). If `error`, print it and continue.
  - `--json`: `{ base, results: MergeConflictResult[] }`.
  - Exit code: **0 by default** (advisory). Add `--exit-code` (like `git diff`) → exit 1 if any conflicts found (for CI/hook gating).
- Without `--real`: **unchanged** — preserve the existing `--ecosystem` early path (`conflicts.ts:316`), `--pr`, `--semantic`, `--strict`, `--notify`, and the current JSON shape. Do not regress existing tests.

### B1 tests — `tests/conflicts-real.test.ts`
- Mock `analyzeRealConflicts` (from A1) and assert: clean → exit 0 + "clean"; conflicts → lists files + kind; `--exit-code` flips exit; `--json` shape; `--all` iterates registered branches (mock storage `list()`).

---

## Acceptance
- [ ] `spidersan conflicts --real` (current branch vs trunk) reports true conflicts; clean when regions don't overlap even if same file.
- [ ] `--base`, `--branch`, `--all`, `--exit-code`, `--json` all work.
- [ ] Legacy-git fallback path covered by a test (mock unsupported `--write-tree`).
- [ ] Existing `conflicts` (non-`--real`) behavior + tests unchanged.
- [ ] Lint/typecheck/build/test green.

## Notes for the integrator (Phase C)
- `conflicts` is **already registered** — B1 only edits the existing module; no `command-registry.ts` change for B1.
- Description string unchanged → registry test unaffected by B1.
