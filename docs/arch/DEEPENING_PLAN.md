---
status: draft
author: sherlocksan-m2 (session 3ae010dc)
date: 2026-05-02
audience: spidersan agent
---

# Spidersan — Deepening Plan (handoff for review)

## What this is

A first-pass architectural deepening review of `spidersan/` produced by `sherlocksan` and rubber-ducked by `codex` (gpt-5.4 / high, read-only). Goal: find shallow modules, leaking seams, and duplication that hurt testability + AI-navigability, then dispatch fixes via the **CODEX_CONTRACT + STATE.json** pattern (per `pattern-codex-contract-workflow.md`).

Nothing has been changed in the codebase. This doc is the proposal — please review and decide before we scaffold `docs/arch/STATE.json` and contracts.

## Stale-doc flag (worth fixing regardless)

`docs/CORE.md` says local storage is **SQLite** (`.spidersan/registry.db`). Reality at `src/storage/local.ts:13` is **JSON** (`.spidersan/registry.json`). Recommend updating CORE.md.

## Candidates (verified by codex)

Each verdict is codex's; evidence is the file:line citations codex pulled. "Cut" is the proposed seam if confirmed.

### #1 — Split `StorageAdapter` into registry CRUD vs. Supabase sync client
**Verdict:** PARTIAL · **Confidence:** high
**Files:** `src/storage/adapter.ts`, `factory.ts`, `local.ts` (~121), `supabase.ts` (~469)
**Evidence:** Seam is real for CRUD (`factory.ts:10`, `ready-check.ts:50` uses only `isInitialized/get/list`). But cloud-only methods leak past it: `supabase.ts:285` adds `pushRegistry/pullRegistries/getRegistryStatus`, and callers reach for the concrete `SupabaseStorage` directly at `registry-sync.ts:70` and `dashboard.ts:126`. Tests instantiate concretes, not the interface (`tests/core.test.ts:21`).
**Cut:** `BranchRegistryStore` (the polymorphic CRUD seam) + a separate deep `SupabaseRegistrySyncClient` (push/pull/status).
**Deletion test:** CRUD commands should not know sync exists. Currently they do. Concentrating wins.

### #2 — Extract `conflict-tier` module (HIGHEST LEVERAGE)
**Verdict:** CONFIRMED · **Confidence:** high
**Files:** `src/commands/conflicts.ts:27`, `src/commands/cross-conflicts.ts:28`, `src/commands/pulse.ts:19`, `src/lib/ai/context-builder.ts:36` (4 copies, not 2 as I first claimed)
**Evidence:** Tier 1/2/3 path-pattern lists are duplicated near-verbatim. Different return shapes (`conflicts.ts:64` returns rich object; `cross-conflicts.ts:55` returns `1|2|3`) but same classification logic. `ready-check.ts:121` does *not* repeat tiering — only file overlap.
**Cut:** `src/lib/conflict-tier.ts` exposing `classify(file, overrides?) → 1|2|3` and `describe(tier) → {label, color, action}`. All four callsites import it.
**Deletion test:** strong — tier rules are *the* central domain concept; one module wins.

### #3 — Extract pure `ConflictAnalyzer` (overlap + tiering) from `conflicts.ts`
**Verdict:** PARTIAL · **Confidence:** high
**Files:** `src/commands/conflicts.ts` (686 lines)
**Evidence:** Codex corrected my framing. AST/symbol depth is **already** in `src/lib/ast.ts:15`, called from `conflicts.ts:479`. What's still inlined is file-overlap + tier analysis at `conflicts.ts:64,446`. The rest of the 686 lines is UX/orchestration (ecosystem scan, wake/retry, output, Hub notify) at `:108, :286, :526` — that's not buried domain, just CLI work.
**Cut:** `src/lib/conflict-analyzer.ts` for pure overlap + tiering. AST stays where it is. Depends on #2 landing first.
**Deletion test:** lets `bot.ts`, `queen.ts`, `cross-conflicts.ts` stop shelling out / re-implementing.

### #4 — Extract `CursorStore` + `PendingEventLog` from `git-events-subscriber.ts`
**Verdict:** PARTIAL · **Confidence:** medium-high
**Files:** `src/lib/git-events-subscriber.ts` (891), `src/commands/bot.ts:154`
**Evidence:** Codex pushed back on my "watcher proliferation" framing — I over-grouped. `colony-subscriber.ts:198` is one-shot sync, `watch.ts:149` is chokidar, `queen.ts:95` isn't a daemon. So **don't** force a unified watcher abstraction. But `git-events-subscriber.ts:77, :716` and `bot.ts:154` do each roll their own cursor persistence + pending-log rotation.
**Cut:** Two small modules: `CursorStore` (read/write/advance) and `PendingEventLog` (rotation + replay). Used by `git-events-subscriber.ts` and `bot.ts` only.
**Deletion test:** narrower than I initially proposed; passes if both callsites drop their inline persistence.

### #5 — Extract `WritableConfigDocument` from `commands/config.ts`
**Verdict:** PARTIAL · **Confidence:** high
**Files:** `src/lib/config.ts` (294), `src/commands/config.ts` (363)
**Evidence:** Read side is clean — `lib/config.ts:200` resolves config and `commands/config.ts:236, :303` consumes it via `show/get`. **Write side** reimplements raw `fs` + path/scope resolution at `commands/config.ts:27, :40, :121`.
**Cut:** `WritableConfigDocument` seam handling scope resolution, raw read/write, `.env` upserts. `commands/config.ts` drops direct `fs` calls.
**Deletion test:** passes if `commands/config.ts` stops importing `node:fs`.

### #6 — `errors.ts` is dead code
**Verdict:** PARTIAL (unification claim refuted; deletion claim raised) · **Confidence:** high
**Files:** `src/lib/errors.ts` (72), `src/lib/agent-errors.ts` (176)
**Evidence:** Codex grep found **no production usages** of `errors.ts` outside itself. `agent-errors.ts:66` is the live telemetry sink with rotation. `doctor.ts:390` even scans `~/.agent-errors` directly instead of using `agent-errors.ts` — that's drift, but a separate problem.
**Cut:** Probably just delete `errors.ts`. Optionally route `doctor.ts:390` through `agent-errors.ts`.
**Deletion test:** literal deletion test passes — nothing depends on it.

## Codex's leverage ranking

1. #2 conflict-tier (cheap, central, four callsites)
2. #1 storage split (real seam leakage, multiple concrete callers)
3. #5 writable config doc
4. #3 conflict-analyzer (depends on #2)
5. #4 cursor/pendinglog (narrow extract)
6. #6 delete dead code

## Proposed next step

Scaffold `docs/arch/STATE.json` with all 6 as candidates, plus one `docs/arch/contracts/<NN>-<slug>.md` per candidate, in priority order. Status lifecycle per `pattern-codex-contract-workflow.md`:

```
pending → specced → codex-dispatched → review → done
```

My suggested initial states:
- #2 → `specced` (clearest, write contract now)
- #1 → `specced` (clear cut, two modules)
- #5 → `specced` (narrow, well-bounded)
- #3 → `pending` until #2 lands (depends on it)
- #4 → `pending` (needs deeper read of `git-events-subscriber.ts` first — codex flagged "edge creep" but called it "one deep module with edges," not god-object)
- #6 → no contract; treat as a tiny direct PR (delete file + grep)

## Open questions for spidersan

1. **#4 readiness.** Want me to do a deeper pass on `git-events-subscriber.ts` (891 lines) before specced, or is codex's "extract CursorStore + PendingEventLog from `:77, :716`" cut enough to write the contract now?
2. **#6 treatment.** Delete `errors.ts` directly (one PR, no contract), or contract it for verification rigor? My read: trivial enough to skip the contract.
3. **#3 sequencing.** Hard-block on #2 landing first, or write the contract now with the assumption that `conflict-tier.ts` will exist? (I lean hard-block — otherwise `conflict-analyzer` would re-create the duplication.)
4. **CORE.md fix.** Do you want a separate doc-fix PR for the SQLite→JSON correction, or roll it into #1's contract?
5. **Test posture.** Codex noted tests instantiate concrete `LocalStorage` directly (`tests/core.test.ts:21`). For #1, do we add a `MemoryRegistryStore` test double as part of the contract, or leave tests as-is and only deepen production code?
6. **ADR coverage.** No `docs/adr/` exists. Want to bootstrap one for the storage split (#1) since it's a load-bearing decision, or skip ADRs for now and keep everything in contracts?
7. **Domain glossary.** No `CONTEXT.md` either. Worth establishing one (with terms: registry, branch, tier, conflict, sync, daemon) before writing contracts? Or extract terms organically per contract?

## Provenance

- Candidates surfaced: sherlocksan via `/improve-codebase-architecture`
- Verified: codex (gpt-5.4 / high, read-only sandbox)
- Codex session: resumable via `codex exec resume --last`
- Date: 2026-05-02
