# CODEX CONTRACT — DEEPENING #9: watch --fetch-poll

## Goal

Extend `spidersan watch` with a `--fetch-poll <seconds>` option that continuously polls `git ls-remote origin` on an interval and warns when the remote advances while the agent is working locally.

This closes the proactive gap exposed by the 2026-05 rebase-chaos incident: during a long session, the remote advanced 2 commits that touched files the agent was modifying. Without continuous polling, the first warning only came at push-rejection time. `pulse --remote-drift` (DEEPENING-8) solved the on-demand case; this solves the continuous case.

**Key design principle:** Reuse `getDriftZone` and `getUnstagedTrackedFiles` from `src/lib/remote-drift.ts` exactly as `pulse --remote-drift` does. Do NOT duplicate the detection logic.

---

## Seam

### New CLI option on `watchCommand`

```
spidersan watch --fetch-poll [interval]
```

- `--fetch-poll <seconds>` — poll `git ls-remote origin` every N seconds (default: 60)
- Combines with all existing `watch` options (`--hub-sync`, `--quiet`, `--agent`, etc.)
- Independent of the chokidar file-change watcher — both run concurrently

### Behaviour

1. On start, record the current remote HEAD SHA (`getRemoteHead()` from `src/lib/remote-drift.ts`).
2. Every N seconds, call `getRemoteHead()` again.
3. If the SHA changed, call `computeDriftResult()` from `src/lib/remote-drift.ts`.
4. If the result is not skipped and `remoteAhead > 0`, print a drift warning to stdout.
5. If `--hub-sync` is also set, post the drift warning to Hub chat via `createHubClient()`.
6. If `--quiet` is set, suppress the per-poll "remote unchanged" heartbeat but still print warnings.
7. Continue polling — do NOT exit on drift (it's a watcher, not a gate).

### Warning format (stdout)

```
📡 [FETCH-POLL] Remote advanced while you're working!
   Branch: feat/my-feature  |  Remote is 2 commit(s) ahead
   Drift zone: src/auth.ts [registered tier 2], CONSORTIUM.md [unstaged ⚠]
   → Run: git fetch origin && git log --oneline origin/main -5
```

If no drift: (only printed when `--quiet` is NOT set)
```
📡 [FETCH-POLL] Remote unchanged (checked at 20:55:01)
```

---

## Files to Touch

| File | Change |
|------|--------|
| `src/commands/watch.ts` | Add `--fetch-poll <seconds>` option; add `startFetchPollLoop()` function; call it from `.action()` alongside the chokidar setup |
| `tests/watch-fetch-poll.test.ts` | **New file** — vitest tests for the fetch-poll loop |

## Files NOT to Touch

- `src/lib/remote-drift.ts` — must be used as-is; do not modify
- `src/commands/pulse.ts` — no changes needed
- Any existing test file — only ADD `tests/watch-fetch-poll.test.ts`; do NOT modify existing tests

---

## Implementation Notes

### Imports to add to watch.ts

```typescript
import { computeDriftResult, getRemoteHead, DriftResult, DriftSkipped } from '../lib/remote-drift.js';
```

### `startFetchPollLoop()` function shape

```typescript
async function startFetchPollLoop(opts: {
    intervalSecs: number;
    hubSync: boolean;
    quiet: boolean;
    repoDir: string;
}): Promise<void> {
    // record initial SHA
    // setInterval: call computeDriftResult, format output, optionally post to hub
    // never throws — catch all errors and log as warnings
}
```

Call from `.action()` after the main watcher setup, only when `options.fetchPoll` is set:

```typescript
if (options.fetchPoll) {
    const secs = parseInt(options.fetchPoll, 10) || 60;
    startFetchPollLoop({ intervalSecs: secs, hubSync: !!options.hubSync, quiet: !!options.quiet, repoDir: repoRoot });
    // do NOT await — runs concurrently with chokidar
}
```

### Handling `computeDriftResult` return

`computeDriftResult` returns `DriftResult | DriftSkipped`. Always check:

```typescript
if ('skipped' in result) {
    if (!opts.quiet) console.log(`📡 [FETCH-POLL] Skipped: ${result.reason}`);
    return;
}
// result is DriftResult
if (result.remoteAhead === 0) { ... } else { print warning }
```

### Interval vs setInterval

Use `setInterval` (not a manual sleep loop) so the chokidar event loop is not blocked.

---

## Tests Required (`tests/watch-fetch-poll.test.ts`)

Use `vi.mock` to mock `child_process` and `fs` (same pattern as `tests/remote-drift.test.ts`).

1. **`startFetchPollLoop` — no drift**: `computeDriftResult` returns `remoteAhead: 0` → no warning logged
2. **`startFetchPollLoop` — drift detected**: `remoteAhead: 2`, `driftZone: ['src/auth.ts']` → warning printed to stdout containing "Remote advanced"
3. **`startFetchPollLoop` — drift with registered file**: `registeredInDrift` non-empty → warning includes file name and tier
4. **`startFetchPollLoop` — drift with unstaged file**: `unstagedInDrift` non-empty → warning includes "unstaged ⚠"
5. **`startFetchPollLoop` — skipped result**: offline → `skipped: true` → no crash, logs "Skipped" (unless quiet)
6. **`startFetchPollLoop` — quiet mode, no drift**: heartbeat suppressed (no stdout line)
7. **`startFetchPollLoop` — quiet mode, drift detected**: warning still printed even in quiet mode
8. **`watch` CLI option `--fetch-poll`**: commander parses `--fetch-poll 30` → `options.fetchPoll === '30'`

---

## Success Criteria

- [ ] `spidersan watch --fetch-poll` is accepted without error
- [ ] `spidersan watch --fetch-poll 30` polls every 30s (verified by test mocking `setInterval`)
- [ ] When remote advances, stdout contains "Remote advanced" and drift zone files
- [ ] When remote is unchanged, heartbeat line printed (suppressed with `--quiet`)
- [ ] Unstaged files in drift zone show "unstaged ⚠" in warning
- [ ] `--hub-sync` + `--fetch-poll` together posts to Hub chat on drift
- [ ] Skipped result (offline/no-remote) does not crash the watcher
- [ ] All 8 new tests pass
- [ ] All 139 existing tests still pass
- [ ] `tsc --noEmit` clean

---

## Out of Scope

- Adaptive poll interval (not needed for MVP)
- `--fetch-poll` on the `watch treetop` subcommand (separate concern)
- Persisting drift events to `~/.spidersan/activity.jsonl`
- `--strict` mode for watch (watch is advisory, not a gate)
