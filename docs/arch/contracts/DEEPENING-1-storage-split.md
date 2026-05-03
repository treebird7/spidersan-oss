# P1-DEEPENING-1 — Split `StorageAdapter` into `BranchRegistryStore` + `SupabaseRegistrySyncClient`

**Status:** pending
**Owner:** spidersan-m5
**Source:** `spidersan-ai/docs/arch/STATE.json` candidate `P1-DEEPENING-1-storage-split`; consortium 2026-05-03
**Related:** `CORE.md` SQLite→JSON correction; `MemoryRegistryStore` test double (sherlocksan-m2 A2 #5 ack — rolled in)

> **Note:** scaffold by spidersan-m5 (P0-A3 trailing criterion). Edit-in-place.

## Goal

`StorageAdapter` (interface at `src/storage/adapter.ts:23`) is implemented twice: `LocalStorage`
(121 LOC, JSON-backed) and `SupabaseStorage` (469 LOC, Supabase-backed). The two implementations
serve **two distinct concerns** that today live behind one interface:

1. **Branch registry persistence** — the local source of truth for "what branches do I know
   about, what files do they touch, what status are they in." Per-machine, append-write,
   sub-millisecond reads. Today: `LocalStorage`.
2. **Cross-machine registry sync** — the reconciliation channel between machines. Per-fleet,
   network-bound, last-writer-wins with conflict surfacing. Today: a subset of
   `SupabaseStorage`'s 469 LOC, mixed in with the same `register/get/list/update` calls that
   `LocalStorage` answers locally.

Conflating them means: every command that writes a branch incurs a Supabase round-trip even
when offline-mode would do; the test double for "registry behavior" requires mocking Supabase;
and the SQLite/JSON storage choice (clarified in CORE.md) is hidden inside one of the two
implementations.

## Seam

Two new abstractions, each with a focused contract:

```ts
// src/storage/branch-registry-store.ts
export interface BranchRegistryStore {
  init(): Promise<void>;
  isInitialized(): Promise<boolean>;
  list(): Promise<Branch[]>;
  register(branch: Omit<Branch, 'registeredAt'>): Promise<Branch>;
  update(name: string, updates: Partial<Branch>): Promise<Branch | null>;
  unregister(name: string): Promise<boolean>;
  get(name: string): Promise<Branch | null>;
  findByFiles(files: string[]): Promise<Branch[]>;
  cleanup(olderThan: Date): Promise<string[]>;
}

// src/storage/supabase-registry-sync-client.ts
export interface SupabaseRegistrySyncClient {
  pull(machineId: string): Promise<RemoteBranch[]>;       // fetch other machines' state
  push(branches: Branch[], machineId: string): Promise<void>;  // publish local state
  detectCrossMachineConflicts(): Promise<CrossMachineConflict[]>;
  // (no register/get/list — those are local-only via BranchRegistryStore)
}
```

The current `StorageAdapter` interface stays as a backwards-compat shim that composes both
during the transition; new code uses the focused interfaces directly. Eventually `StorageAdapter`
gets deleted (separate cleanup PR after all callers migrate).

## Files to touch

| Path | Change |
|---|---|
| `src/storage/branch-registry-store.ts` | NEW — interface |
| `src/storage/supabase-registry-sync-client.ts` | NEW — interface |
| `src/storage/json-branch-registry-store.ts` | NEW — JSON impl (lifted from `local.ts`) |
| `src/storage/memory-branch-registry-store.ts` | NEW — in-memory test double (per A2 #5) |
| `src/storage/supabase-registry-sync-client-impl.ts` | NEW — sync impl (lifted from `supabase.ts`) |
| `src/storage/adapter.ts` | EDIT — keep `StorageAdapter` as composing shim; mark `@deprecated` |
| `src/storage/local.ts` | THIN — delegate to JsonBranchRegistryStore |
| `src/storage/supabase.ts` | THIN — delegate to JsonBranchRegistryStore + SupabaseRegistrySyncClient |
| `src/storage/factory.ts` | EDIT — also expose factories for the focused interfaces |
| `tests/branch-registry-store.test.ts` | NEW — tests against `MemoryBranchRegistryStore` |
| `tests/supabase-registry-sync-client.test.ts` | NEW — uses a fake transport, not real Supabase |

Net LOC: roughly flat (existing ~590 LOC redistributes; new test double + 2 new test files
add ~150 LOC; `StorageAdapter` shim removes ~30 LOC of duplication).

## Verification

- All existing commands continue to work without code change at the call site (the
  `StorageAdapter` shim preserves the public surface).
- `tsc --noEmit` clean.
- New tests pass; existing tests pass.
- `MemoryBranchRegistryStore` is sufficient for any command-level test that doesn't care
  about real persistence — a regression test that previously needed a Supabase mock now
  uses `MemoryBranchRegistryStore` and runs in-process.

## Critical: do not change the on-disk JSON format

The JSON layout used by `LocalStorage` IS the persistence format. `JsonBranchRegistryStore`
must read and write the same files in the same shape. CORE.md's SQLite→JSON correction is
documenting reality — this contract preserves it.

## Files NOT to touch

- The on-disk JSON files themselves (`~/.spidersan/registry.json` etc.)
- `src/types/cloud.ts` (RemoteBranch / CrossMachineConflict types — consumed as-is)
- Any test fixtures using the JSON format

## Open question for spidersan-agent / sherlocksan to confirm

Should the deprecated `StorageAdapter` shim live in this PR (gradual migration) or be
deleted in a follow-up PR after all 12+ call sites move to the focused interfaces? Default
in this contract is gradual (less risk, smaller diff per PR). Override if the team prefers
a single hard cut.
