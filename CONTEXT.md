# Spidersan — Domain Vocabulary & Codebase Map

> Quick-load context for AI agents and contributors. Read this before navigating the codebase.

---

## What Spidersan Does

Spidersan is **branch coordination middleware** for multi-agent coding environments. It maintains a shared registry of who is working on what files, detects file-level conflicts before they become merge disasters, and now continuously monitors remote drift so agents get warned before they hit push rejection.

---

## Core Domain Concepts

### Branch
A registered unit of work. Stored in `.spidersan/registry.json`.

```typescript
interface Branch {
    name: string;           // git branch name
    files: string[];        // files the agent declared it will modify
    registeredAt: Date;
    agent?: string;         // e.g. "ssan", "copilot", "birdsan"
    status: 'active' | 'completed' | 'abandoned';
    description?: string;
}
```

Branches must be **registered** to be visible. Unregistered branches are dark — `conflicts`, `list`, and `stale` return nothing for them. Always run `spidersan register` early.

---

### Registry
The `.spidersan/registry.json` file that maps branch names to `Branch` records. Two storage adapters exist: **local** (JSON file, single-machine) and **Supabase** (cross-machine sync). The factory in `src/storage/factory.ts` selects based on env vars.

```
src/storage/
  adapter.ts          ← StorageAdapter interface + Branch / BranchRegistry types
  factory.ts          ← picks local vs Supabase
  local.ts            ← reads/writes .spidersan/registry.json
  supabase.ts         ← Supabase cloud store
  branch-registry-store.ts  ← thin wrapper used by most commands
```

---

### Conflict
Detected when two registered branches both claim the same file. Classified into three tiers.

| Tier | Icon | Meaning | Action |
|------|------|---------|--------|
| 1 WARN | 🟡 | Same file, compatible edit likely | Proceed with caution |
| 2 PAUSE | 🟠 | Same file, structural overlap | Coordinate before merging |
| 3 BLOCK | 🔴 | Security/config file | Must resolve first |

Tier logic lives in `src/lib/conflict-tier.ts` — `classifyTier(file)` returns `1 | 2 | 3`.

**Tier 3 patterns** (env, secrets, auth files): `.env`, `*.pem`, `auth.ts`, `security.ts`, etc.
**Tier 2 patterns** (structural): `package.json`, `tsconfig.json`, `CLAUDE.md`, `server.ts`, `index.ts`.
**Tier 1**: everything else.

---

### DriftZone
The set of files touched by commits on `origin` that local HEAD does not have. Introduced in DEEPENING-8 (`src/lib/remote-drift.ts`).

```typescript
interface DriftEntry {
    file: string;
    registered: boolean;   // in this branch's registered file list
    tier: 1 | 2 | 3 | null;
    unstaged: boolean;     // DANGER: blocks git rebase --continue
}

interface DriftResult {
    branch: string;
    remote: string;
    localAhead: number;
    remoteAhead: number;
    state: 'synced' | 'local_ahead' | 'remote_ahead' | 'diverged';
    driftZone: string[];            // all files changed in remote-only commits
    registeredInDrift: DriftEntry[]; // overlap with this branch's files
    unstagedInDrift: DriftEntry[];  // unstaged files in drift zone = rebase blocker
    safeToPush: boolean;
    rebaseContinueRisk: boolean;
    recommendation: 'synced' | 'push_clean' | 'pull_rebase' | 'rebase_clean' | 'rebase_with_conflict_prep';
}
```

**Key invariant:** `safeToPush` is `false` whenever `remoteAhead > 0`, regardless of file overlap — remote-ahead always means push will be rejected.

**`DriftSkipped`** is returned instead of `DriftResult` when detection is not possible (offline, no remote, detached HEAD, mid-rebase). Always check `'skipped' in result` before accessing `DriftResult` fields.

---

### ConflictTier
`type ConflictTier = 1 | 2 | 3` — the severity classification used by both conflict detection and drift zone cross-referencing. Lives in `src/lib/conflict-tier.ts`.

---

### StorageAdapter
The interface all storage backends implement. Key methods: `getBranches()`, `registerBranch()`, `updateBranchStatus()`, `isInitialized()`. Always go through the adapter — never read `registry.json` directly.

---

### Colony
The Supabase-backed signal bus (MycToak project `<vault-project-ref>`) used for cross-machine awareness. Spidersan polls Colony via `src/lib/colony-subscriber.ts` on `spidersan pulse`. Colony signals are *advisory* — Spidersan falls back gracefully if Colony is unavailable.

---

### Hub
The real-time chat channel used for agent notifications. Client in `src/lib/hub.ts`. The one public method agents should call:

```typescript
hub.postToChat({ agent: 'spidersan', name: 'Spidersan', message, glyph: '🕷️' })
```

Never call `hub.postMessage()` — it doesn't exist.

---

### DriftPoll (watch --fetch-poll)
The continuous background loop started by `spidersan watch --fetch-poll [seconds]`. Calls `getRemoteHead()` from `src/lib/git.ts` every N seconds; when the SHA changes, calls `computeDriftResult()` from `src/lib/remote-drift.ts` and warns. Runs via `setInterval` concurrently with the chokidar file watcher. Introduced in DEEPENING-9 (`src/commands/watch.ts → startFetchPollLoop()`).

---

## Module Map

```
src/
├── bin/spidersan.ts          CLI entry — wires Commander commands
├── commands/                 One file per CLI subcommand
│   ├── conflicts.ts          Tier-based conflict detection
│   ├── pulse.ts              Colony sync + --remote-drift drift check
│   ├── register.ts           Register branch + files
│   ├── watch.ts              File watcher + --fetch-poll drift loop
│   ├── ready-check.ts        Pre-merge validation
│   ├── merge-order.ts        DAG-based merge sequencing
│   ├── doctor.ts             Health diagnostics + Colony hook installer
│   ├── rescue.ts             Scan/triage/salvage rogue branches
│   └── ...
├── lib/
│   ├── conflict-tier.ts      classifyTier(file) → ConflictTier
│   ├── conflict-analyzer.ts  Cross-branch overlap analysis
│   ├── conflict-renderer.ts  Human + JSON output for conflicts
│   ├── remote-drift.ts       getDriftZone, computeDriftResult, DriftResult
│   ├── git.ts                getAheadBehind, getRemoteHead, getCurrentBranch
│   ├── graph.ts              DAG for merge order / dependency tracking
│   ├── hub.ts                Hub REST client (postToChat)
│   ├── colony-subscriber.ts  Colony signal polling
│   ├── security.ts           Input validation: validateFilePath, validateBranchName
│   └── config.ts             .spidersanrc loader (deepMerge, __proto__ guard)
└── storage/
    ├── adapter.ts            StorageAdapter interface + Branch type
    ├── factory.ts            Auto-select local vs Supabase
    ├── local.ts              JSON file backend
    └── supabase.ts           Cloud backend
```

---

## Security Conventions

| Rule | Detail |
|------|--------|
| Shell execution | Always `execFileSync(cmd, [args])` — never string interpolation |
| Input validation | Call `validateFilePath` / `validateBranchName` from `security.ts` at the sink |
| `validateFilePath` | Throws on invalid input |
| `sanitizeFilePaths` | Silently filters — use when partial success is acceptable |
| Prototype pollution | `deepMerge` in `config.ts` guards against `__proto__` keys — do not bypass |
| Env injection | Pass env as `env: { ...process.env }` object, not inline string |

---

## Testing

```bash
npm run test:run       # Vitest single run (CI)
npm test               # Vitest watch mode
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint src/**/*.ts
npm run build          # tsc compilation

# Single file
npx vitest run tests/remote-drift.test.ts
```

**Current baseline:** 147 tests / 32 files (as of v0.9.0 + DEEPENING-9).

**Mock pattern for git commands:**
```typescript
// In tests, mock child_process and use named function (not arrow + `as typeof`)
vi.mock('child_process');
mockExecFileSync.mockImplementation(function mockGit(_cmd, args) { ... });
// getDriftZone calls: last arg is 'HEAD..origin/main' (not 'origin/main')
// distinguish from getAheadBehind: check !args.includes('--left-right') && !args.includes('--count')
```

---

## Key Invariants

1. **`safeToPush` is false when `remoteAhead > 0`** — even with zero file overlap, a remote-ahead branch will be push-rejected.
2. **`DriftSkipped` vs `DriftResult`** — always check `'skipped' in result` before accessing drift fields.
3. **Registry is dark without `register`** — `conflicts`, `list`, `stale` return nothing for unregistered branches.
4. **`getRemoteHead` lives in `git.ts`**, not `remote-drift.ts` — watch uses it directly; pulse goes through `computeDriftResult`.
5. **Tier 3 ≠ package.json** — `package.json` is Tier 2. Tier 3 is exclusively security/secrets files.
6. **Never write to `sansan-knowledge` directly** — it is a one-way rsync mirror of `treebird-internal`.
