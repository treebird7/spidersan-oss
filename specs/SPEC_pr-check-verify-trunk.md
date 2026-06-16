# SPEC — `pr-check <n>` + `verify-trunk`

**Feature 3 of 3** · Foundations: A2 (PR merge-state), A3 (trunk) · Commands: B2 · Target: 0.11.0

These promote the two Claude-Code hooks shipped 2026-06-15 (`spidersan-pre.sh` #1, `spidersan-post.sh` #2) into first-class, tested commands. Once shipped, the hooks should shell out to these instead of re-implementing the logic in bash/python.

---

## A2 — Foundation: PR merge-state + CI rollup (`src/lib/github.ts`)

Today `github.ts` (gh-CLI via `execFileSync`) fetches `state`/`draft` but **not** `mergeStateStatus`, `mergeable`, `baseRefName`, or a check rollup. Add:

```ts
export interface PRMergeState {
  number: number; title: string;
  baseRefName: string; headRefName: string;
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  mergeStateStatus: 'CLEAN'|'UNSTABLE'|'DIRTY'|'BEHIND'|'BLOCKED'|'DRAFT'|'HAS_HOOKS'|'UNKNOWN';
  checks: { name: string; bucket: 'pass'|'fail'|'pending'|'skipping'; required: boolean; }[];
  checkRollup: { pass: number; fail: number; pending: number; failingRequired: string[] };
  headRefOid?: string;            // PR head SHA (for fork-safe conflict analysis in merge-plan)
}
export async function getPRMergeState(prNumber: number, opts?: { repo?: string }): Promise<PRMergeState | null>
```
- **Signature carries repo** (review): existing `github.ts` fetchers take a `GitHubRepoConfig`; this one accepts `opts.repo` ("owner/name"). When provided, pass `--repo owner/name` to `gh` — mirror the existing `gh pr view … -- <number>` style in `getPRDetails` (`github.ts:231`).
- Impl: `gh pr view <n> [--repo owner/name] --json number,title,baseRefName,headRefName,headRefOid,mergeable,mergeStateStatus,statusCheckRollup` (one call).
- **Defensive rollup parsing** (review): `statusCheckRollup` nodes are **heterogeneous** (CheckRun vs StatusContext). Bucket from whichever of `conclusion`/`state`/`status` is present; handle `null` conclusion and `SUCCESS/FAILURE/NEUTRAL/SKIPPED/CANCELLED/TIMED_OUT/ACTION_REQUIRED/PENDING/IN_PROGRESS`. `required` from `isRequired` **when present** (often absent) — default `false`; only `fail` + `required` feeds `failingRequired`.
- Guard with `isGhAvailable()`. On gh failure / PR-not-found → return `null` (caller decides). Re-poll **once** if `mergeable === 'UNKNOWN'` (GitHub computes async) with a short delay; then report as-is.
- Keep existing `github.ts` exports intact (only add).

### A2 tests — `tests/github-merge-state.test.ts`
- Mock `execFileSync`/the gh runner; feed recorded `gh pr view --json` payloads:
  - stacked (base != main), CLEAN/MERGEABLE → parsed base surfaced.
  - UNSTABLE + failing non-required check → bucket `fail`, `failingRequired` empty.
  - DIRTY/CONFLICTING → mergeable CONFLICTING.
  - UNKNOWN → triggers one re-poll.
  - gh unavailable → returns null.

---

## A3 — Foundation: trunk detection (`src/lib/trunk.ts`)

Trunk is currently hardcoded `main`/`master` in ≥4 places. Centralize:

```ts
/** Resolve the repo's trunk: origin/HEAD symbolic-ref → .spidersanrc `trunk` → main → master. */
export function getTrunkBranch(opts?: { cwd?: string }): string
export function isTrunk(branch: string, opts?: { cwd?: string }): boolean
```
- Order: `git symbolic-ref refs/remotes/origin/HEAD` (strip `origin/`) → `.spidersanrc` `trunk` key → `main` if it exists → `master` if it exists → `'main'` default.
- Use `execGit`; tolerate missing origin/HEAD (fresh clones). Pure, cached per cwd within a process.

### A3 tests — `tests/trunk.test.ts`
- Mock `execGit`/config: origin/HEAD=develop → 'develop'; no origin/HEAD + .spidersanrc trunk=trunk → 'trunk'; neither, main exists → 'main'; only master → 'master'. `isTrunk('main')` true/false cases.

---

## B2 — Commands

### `src/commands/pr-check.ts` — `spidersan pr-check <number>`
Description (verbatim for registry): **`Check a PR's merge readiness (stacked base, red/behind state)`**
- Action: `getPRMergeState(n)` (A2) + `getTrunkBranch()` (A3). Warn when:
  - `baseRefName` is not trunk → **STACKED PR**: "base=<x> (not trunk) — merging lands on <x>, not <trunk>."
  - `mergeStateStatus` in `{UNSTABLE,DIRTY,BEHIND,BLOCKED}` → "state=<x> — red/behind/conflicts; verify before merging." Include `checkRollup.failingRequired` if any.
  - else → "PR #n base=<base> state=<state> — looks clean."
- `--json` → the `PRMergeState` plus `{ stacked: boolean, trunk: string, advisories: string[] }`.
- Exit **0** (advisory) by default; `--exit-code` → 1 if any advisory fired (for hook gating).
- gh unavailable / PR not found → friendly message, exit 0 (advisory), `--exit-code` → 2.

### `src/commands/verify-trunk.ts` — `spidersan verify-trunk`
Description (verbatim): **`Detect registry trunk-poison (main/master must claim no files)`**
- Action: read registry via `getStorage().list()`; for the trunk branch (A3) **and** literal `main`/`master` entries, if `files` non-empty → **TRUNK POISON** warning: "`<trunk>` claims N file(s) in the registry (<first few>). A merge re-poisoned it (silent on clean auto-merge). Reset to files:[] before pushing."
- Clean → "✅ trunk `<trunk>` is clean (files:[])."
- `--fix` → clear `files: []` via `storage.update()` for **every** poisoned trunk-equivalent entry found (trunk + literal `main`/`master`), not just the resolved trunk name (review). Report each cleared. Without `--fix`, read-only.
- `--json` → `{ trunk, poisoned: boolean, entries: [{ name, files, fixed?: boolean }] }` (per-entry, so `--fix` is unambiguous when several are poisoned).
- Exit **0** read-only; `--exit-code` → 1 when any entry poisoned (for the post-merge hook).

### B2 tests — `tests/pr-check.test.ts`, `tests/verify-trunk.test.ts`
- pr-check: mock `getPRMergeState` + `getTrunkBranch`; assert stacked/red/clean advisories, `--exit-code`, `--json`, null-PR path.
- verify-trunk: `MemoryBranchRegistryStore` seeded with main.files=['a.tsx'] → poisoned; main.files=[] → clean; `--fix` clears + re-reads clean; `--json` shape.

---

## Acceptance
- [ ] `spidersan pr-check 179` flags STACKED/red exactly as the 2026-06-15 hook #1 did; `pr-check 175` on an UNSTABLE PR warns; clean PR says "looks clean".
- [ ] `spidersan verify-trunk` flags a poisoned main; `--fix` resets it; clean main is silent-OK.
- [ ] `--exit-code` works on both (so the hooks can gate on it).
- [ ] A2 adds `mergeStateStatus`/rollup without breaking existing `github.ts` exports/tests.
- [ ] A3 trunk helper used by both commands (no new hardcoded 'main').
- [ ] Lint/typecheck/build/test green.

## Phase C wiring (integrator)
- Register **both** `pr-check` and `verify-trunk` in `src/bin/command-registry.ts` (descriptions verbatim above) + barrel `src/commands/index.ts`.
- Note in CHANGELOG that the two CC hooks can now call these (`spidersan pr-check`, `spidersan verify-trunk --exit-code`) instead of inline bash.
