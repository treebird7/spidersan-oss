# P1-DEEPENING-5 — Extract Hub Client Module

**Status:** specced
**Owner:** spidersan-m5
**Depends on:** none
**Rationale:** `HUB_URL` is defined independently in `conflicts.ts` and `watch.ts`. Hub integration
functions (`notifyHub`, `postConflictToChat`, `wakeConflictingAgent`) are implemented 2-3 times
with divergent error handling and message formatting. Tests must mock `fetch` in each command file
independently. There is no seam — Hub is a true external dependency (category 4 per DEEPENING.md)
and needs a port with a stub adapter for tests.

## Goal

Extract all Hub API calls into `src/lib/hub.ts`. Commands import from it. Tests inject a stub
adapter. The production adapter does `fetch`. HUB_URL lives once. Silent-fail semantics for
network errors are centralised.

## Seam

```ts
// src/lib/hub.ts

export interface HubAdapter {
  postToChat(payload: ChatPayload): Promise<void>;
  wakeAgent(agentId: string, payload: WakePayload): Promise<boolean>;
}

export interface ChatPayload {
  message: string;
  agent?: string;
  name?: string;
  glyph?: string;
}

export interface WakePayload {
  sender: string;
  reason: string;
}

/**
 * Default production adapter. Uses HUB_URL from env.
 * Silent-fail on network errors (logs a warning, never throws).
 */
export function createHubClient(options?: {
  url?: string;
  adapter?: HubAdapter;  // injected in tests
}): HubClient;

export class HubClient {
  /**
   * Post a message to Hub chat. Silent-fail if Hub is offline.
   */
  async postToChat(payload: ChatPayload): Promise<void>;

  /**
   * Notify Hub of a conflict. Filters to tier 2+ before posting.
   * Returns immediately if all conflicts are tier 1.
   */
  async notifyConflict(branch: string, conflicts: Array<{
    branch: string;
    files: string[];
    tier: number;
  }>): Promise<void>;

  /**
   * Wake an agent via Hub. Returns true if wake signal was sent.
   * Silent-fail if Hub is offline.
   */
  async wakeAgent(agentId: string, reason: string): Promise<boolean>;
}
```

`HUB_URL` default: `process.env.HUB_URL || 'https://hub.treebird.uk'` — defined once inside
`hub.ts`, not exported.

## Files to touch

| Path | Change |
|---|---|
| `src/lib/hub.ts` | NEW — HubClient, HubAdapter interface, createHubClient factory |
| `src/commands/conflicts.ts` | EDIT — remove local `notifyHub`, `wakeConflictingAgent`, `HUB_URL`; use `createHubClient().notifyConflict()` / `.wakeAgent()` |
| `src/commands/watch.ts` | EDIT — remove local `postConflictToChat`, `HUB_URL`; use `createHubClient().postToChat()` |
| `tests/hub.test.ts` | NEW — vitest tests using stub HubAdapter |

## Critical: do not remove existing tests

Only ADD tests. Do not delete, comment out, or replace any test in any existing test file.

## Tests required (vitest format)

All new tests in `tests/hub.test.ts` using `import { describe, it, expect, vi } from 'vitest'`.

1. `notifyConflict` does NOT post when all conflicts are tier 1
2. `notifyConflict` posts when at least one tier 2 conflict
3. `notifyConflict` posts tier 3 severity label when tier 3 present
4. `wakeAgent` calls `wakeAgent` on the adapter and returns true on success
5. `wakeAgent` returns false silently when adapter throws (never propagates)
6. `postToChat` calls through to adapter; silently ignores adapter errors

## Files NOT to touch

- `src/commands/pulse.ts` (does not currently call Hub)
- `src/lib/conflict-tier.ts`
- Any existing test file

## Success criteria

- [ ] `src/lib/hub.ts` exists with `HubClient`, `HubAdapter`, `createHubClient`
- [ ] No `HUB_URL` constant defined in any command file
- [ ] No `notifyHub` function in `conflicts.ts`
- [ ] No `postConflictToChat` function in `watch.ts`
- [ ] No `wakeConflictingAgent` function in `conflicts.ts`
- [ ] `tsc --noEmit` clean
- [ ] `pnpm build` clean
- [ ] `tests/hub.test.ts` exists with at least 6 vitest tests, all passing
- [ ] All previously passing tests still pass (84 tests)

## Out of scope

- Hub WebSocket integration in `watch.ts` (the `socket.io` path) — keep as-is
- Retry logic (silent-fail is correct for now)
- Hub auth headers (not currently implemented)
