# CODEX CONTRACT — DEEPENING #10: Output seam for pulse.ts, watch.ts, register.ts

## Goal

Apply the output seam pattern (established in DEEPENING-6 for `conflicts.ts`) to three remaining commands: `pulse.ts`, `watch.ts`, and `register.ts`.

Each command currently mixes business logic with `console.log` calls, making output untestable. The fix in each case is the same:
1. Extract a pure renderer function that returns a `string` (no `console.log` inside)
2. Leave the `console.log` call in the command action (single call per output path)
3. Export the renderer from `src/lib/pulse-renderer.ts`, `src/lib/watch-renderer.ts`, and `src/lib/register-renderer.ts`
4. Write tests against the renderer strings

**Do not change CLI behaviour.** Terminal output must be semantically identical before and after.

---

## Seam (per command)

### pulse-renderer.ts

```typescript
// src/lib/pulse-renderer.ts
import type { DriftResult, DriftSkipped } from './remote-drift.js';

export interface PulseRenderOptions {
    branch: string;
    registered: boolean;
    colonySynced?: number;
    conflicts: Array<{ tier: number; branch: string; files: string[]; agent?: string }>;
    drift?: DriftResult | DriftSkipped | null;
    verbose?: boolean;
}

/** Pure. Returns terminal string for spidersan pulse human output. */
export function renderPulseReport(opts: PulseRenderOptions): string;
```

### watch-renderer.ts

```typescript
// src/lib/watch-renderer.ts
import type { DriftResult, DriftSkipped } from './remote-drift.js';

export interface FetchPollRenderOptions {
    branch: string;
    drift: DriftResult | DriftSkipped;
    timestamp?: string; // ISO string or formatted time
}

/** Pure. Returns terminal string for --fetch-poll drift warnings and heartbeats. */
export function renderFetchPollHeartbeat(opts: { branch: string; timestamp?: string }): string;
export function renderFetchPollDrift(opts: FetchPollRenderOptions): string;
```

### register-renderer.ts

```typescript
// src/lib/register-renderer.ts
export interface RegisterRenderOptions {
    branchName: string;
    files: string[];
    isUpdate: boolean;
    autoDetected?: boolean;
    autoDetectedFiles?: string[];
}

/** Pure. Returns terminal string for spidersan register success output. */
export function renderRegisterResult(opts: RegisterRenderOptions): string;
```

---

## Files to Touch

| File | Change |
|------|--------|
| `src/lib/pulse-renderer.ts` | **NEW** — pure `renderPulseReport` |
| `src/lib/watch-renderer.ts` | **NEW** — pure `renderFetchPollHeartbeat` + `renderFetchPollDrift` |
| `src/lib/register-renderer.ts` | **NEW** — pure `renderRegisterResult` |
| `src/commands/pulse.ts` | EDIT — replace inline console.log blocks with `renderPulseReport`; keep Commander scaffolding and JSON path unchanged |
| `src/commands/watch.ts` | EDIT — replace inline console.log in `startFetchPollLoop` with `renderFetchPollHeartbeat` / `renderFetchPollDrift` |
| `src/commands/register.ts` | EDIT — replace inline console.log blocks with `renderRegisterResult` |
| `tests/pulse-renderer.test.ts` | **NEW** — vitest tests |
| `tests/watch-renderer.test.ts` | **NEW** — vitest tests |
| `tests/register-renderer.test.ts` | **NEW** — vitest tests |

## Files NOT to Touch

- `src/lib/conflict-renderer.ts` — already done in DEEPENING-6, do not modify
- `src/commands/conflicts.ts` — already done in DEEPENING-6, do not modify
- `src/lib/remote-drift.ts` — no changes needed
- Any existing test file — only ADD the three new test files; never remove or modify existing tests
- `src/lib/conflict-tier.ts` — no changes needed

---

## Implementation Notes

### pulse.ts

The human output section of `pulse.ts` has two sub-paths:
1. Unregistered branch path (lines ~81–94): short message + optional colony count + optional drift skip warning
2. Registered branch path (lines ~160–250): header, conflict list, summary bar, drift section

Both should be captured by `renderPulseReport`. The `--json` path (lines ~79, ~151) is **NOT** touched — JSON output stays as direct `JSON.stringify` + `console.log`.

The drift section within `renderPulseReport` should reuse the `tierIcon` and `printDriftReport` logic that already exists at the bottom of `pulse.ts` — move those helper functions into `pulse-renderer.ts` instead.

### watch.ts — startFetchPollLoop

Only the `startFetchPollLoop` function's console.log calls need the seam. The watch banner printed at startup (`🕷️ SPIDERSAN WATCH MODE`) and the chokidar change logs are lower-priority and can remain inline for now.

### register.ts

Focus on the success output paths:
- Auto-detected files list (lines ~46–48)
- "Updated branch" message (line ~146)
- "Registered branch" message (lines ~157–162)

The error paths (`console.error`) should remain inline — only `console.log` success paths need the seam.

### Renderer design rules

1. Return `string` — no `console.log` inside renderer functions
2. Pure — no side effects, no imports from `child_process` or `fs`
3. Deterministic — same input = same output
4. Trim trailing newline from the returned string — the caller adds `\n` via `console.log`

---

## Tests Required

### tests/pulse-renderer.test.ts (minimum 6 tests)
1. Unregistered branch → output contains "not registered"
2. Registered branch, no conflicts → output contains "No conflicts"
3. Registered branch, tier 2 conflict → output contains "🟠" and branch name
4. Registered branch, tier 3 conflict → output contains "🔴"
5. With drift (remoteAhead > 0) → output contains "REMOTE DRIFT" and commit count
6. With drift skipped → output contains "skipped" reason

### tests/watch-renderer.test.ts (minimum 4 tests)
1. Heartbeat (no drift) → output contains "Remote unchanged"
2. Drift detected, no registered files → output contains "Remote advanced"
3. Drift detected, registered file in drift zone → output contains file name and tier
4. Drift detected, unstaged file → output contains "unstaged ⚠"

### tests/register-renderer.test.ts (minimum 4 tests)
1. New registration → output contains "Registered branch" and file list
2. Update → output contains "Updated branch"
3. Auto-detected files → output contains detected file count
4. Multiple files → all files appear in output

---

## Success Criteria

- [ ] `src/lib/pulse-renderer.ts` exists and exports `renderPulseReport`
- [ ] `src/lib/watch-renderer.ts` exists and exports `renderFetchPollHeartbeat` and `renderFetchPollDrift`
- [ ] `src/lib/register-renderer.ts` exists and exports `renderRegisterResult`
- [ ] `pulse.ts` human output paths call `console.log(renderPulseReport(...))` — no inline string building
- [ ] `watch.ts` `startFetchPollLoop` calls `renderFetchPollHeartbeat` / `renderFetchPollDrift`
- [ ] `register.ts` success paths call `console.log(renderRegisterResult(...))`
- [ ] `--json` paths in `pulse.ts` are unchanged
- [ ] All 14 new renderer tests pass
- [ ] All 147 existing tests still pass
- [ ] `tsc --noEmit` clean

---

## Out of Scope

- Output seam for `watch.ts` banner / chokidar logs (lower priority)
- Output seam for `doctor.ts`, `list.ts`, `stale.ts` (future DEEPENING)
- Error path (`console.error`) seam — only success `console.log` paths
- i18n / theming support on renderers
