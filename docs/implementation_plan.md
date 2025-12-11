# Spidersan Standalone: Implementation Plan

> **Last Updated:** 11-12-25
> **Status:** ~80% complete in Recovery-Tree, ready for extraction

## Goal

Extract the working spidersan CLI from Recovery-Tree into a standalone npm package, adding database adapters for broader use.

---

## Current State

**Already Built (in Recovery-Tree):**
- ✅ 760-line CLI with 13 commands
- ✅ Configurable WIP detection (`.spidersan.config.json`)
- ✅ Ready-check validation
- ✅ Conflict detection & merge ordering
- ✅ 15 test cases
- ✅ Documentation (SPIDERSAN_GUIDE.md)

**Known Issues:**
- ⚠️ WIP detection needs fine-tuning (pattern matching)

---

## User Review Required

> [!IMPORTANT]
> **Tree Generator:** Keep `integration/spidersan-challenge` branch for Gemini 3.0 agent testing (NOT deleted)

> [!NOTE]
> **WIP Detection:** User noted this needs more fine-tuning before standalone release

---

## Proposed Changes

### New Repository Structure

```
spidersan/
├── package.json          [NEW]
├── LICENSE.md            [NEW] ← Already drafted
├── README.md             [NEW]
├── tsconfig.json         [NEW]
├── bin/
│   └── spidersan.js      [NEW] Entry point
├── src/
│   ├── index.ts          [NEW] Main exports
│   ├── cli.ts            [NEW] Command handling
│   ├── config.ts         [NEW] Config file loading
│   ├── storage/
│   │   ├── interface.ts  [NEW] Storage abstraction
│   │   ├── sqlite.ts     [NEW] Local storage (Free)
│   │   └── supabase.ts   [PORT] From lib/agent-status.ts (Pro)
│   ├── core/
│   │   ├── branch.ts     [NEW] Branch registry logic
│   │   ├── session.ts    [PORT] From agent-status.ts
│   │   └── merge-order.ts [NEW] Topological sort
│   └── git/
│       └── helpers.ts    [PORT] From agent-status-cli.js
└── schemas/
    ├── sqlite.sql        [NEW]
    └── postgres.sql      [NEW]
```

---

### Phase 1: MVP (Core CLI) — Week 1-2

#### [NEW] package.json
```json
{
  "name": "spidersan",
  "version": "0.1.0",
  "description": "Branch coordination for AI coding agents",
  "bin": {
    "spidersan": "./bin/spidersan.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts"
}
```

#### [NEW] bin/spidersan.js
Entry point shebang script that loads CLI.

#### [NEW] src/cli.ts
Command handler supporting:
- `spidersan init` — Create `.spidersanrc` config
- `spidersan register [description]` — Register current branch
- `spidersan list` — Show all branches
- `spidersan merge-order` — Compute optimal merge sequence
- `spidersan complete` — Mark branch as done
- `spidersan cleanup` — Remove stale branches

#### [NEW] src/config.ts
Config file support:
```javascript
// .spidersanrc or spidersan.config.js
module.exports = {
  storage: 'sqlite',  // or 'supabase', 'postgres'
  dataDir: '.spidersan',
  // Pro: supabaseUrl, supabaseKey
}
```

#### [NEW] src/storage/interface.ts
```typescript
interface StorageAdapter {
  init(): Promise<void>;
  registerBranch(branch: BranchEntry): Promise<void>;
  getBranches(): Promise<BranchEntry[]>;
  updateBranch(name: string, updates: Partial<BranchEntry>): Promise<void>;
  deleteBranch(name: string): Promise<void>;
}
```

#### [NEW] src/storage/sqlite.ts
Local SQLite storage using `better-sqlite3`.

#### [PORT] src/git/helpers.ts
Extract from `scripts/agent-status-cli.js`:
- `getCurrentBranch()` — Get current git branch
- `getSessionId()` — Session persistence

---

### Phase 2: Pro Features — Week 3-4

#### [PORT] src/storage/supabase.ts
Adapt from `lib/agent-status.ts` with config-based credentials.

#### [NEW] src/core/merge-order.ts
Topological sort algorithm for merge ordering based on dependencies.

#### [NEW] src/core/conflicts.ts
Conflict prediction based on `files_changed` overlap.

---

## Verification Plan

### Manual Testing (MVP)

Since this is a new standalone package, verification will be manual:

**Test 1: Installation**
```bash
# From the spidersan repo
npm link
spidersan --version
# Expected: "0.1.0"
```

**Test 2: Init Command**
```bash
cd /tmp/test-project
git init
spidersan init
# Expected: Creates .spidersanrc file
cat .spidersanrc
# Expected: Shows default config
```

**Test 3: Register and List**
```bash
git checkout -b test-branch
spidersan register "Testing spidersan"
spidersan list
# Expected: Shows "test-branch" with description
```

**Test 4: Merge Order**
```bash
# Create multiple branches
git checkout main
git checkout -b feature-a
spidersan register "Feature A"

git checkout main  
git checkout -b feature-b
spidersan register "Feature B" --depends-on feature-a

spidersan merge-order
# Expected: Shows feature-a before feature-b
```

**Test 5: Cleanup**
```bash
spidersan cleanup --older-than 0
spidersan list
# Expected: No branches listed
```

### User Manual Verification

After MVP is built, I'll ask you to:
1. Install the package via `npm link`
2. Test in a real git repo
3. Confirm commands work as expected
4. Report any UX issues

---

## Dependencies

| Package | Purpose | License |
|---------|---------|---------|
| `commander` | CLI argument parsing | MIT |
| `better-sqlite3` | Local SQLite | MIT |
| `@supabase/supabase-js` | Cloud storage (Pro) | MIT |
| `chalk` | Terminal colors | MIT |
| `ora` | Spinners | MIT |

---

## Timeline

| Week | Deliverable |
|------|-------------|
| 1 | Package setup, config, SQLite storage |
| 2 | CLI commands, git helpers, basic merge-order |
| 3 | Supabase adapter, conflict detection |
| 4 | Polish, README, npm publish |

---

## Open Questions for User

1. **Repository location:** Create new repo or subfolder of Recovery-Tree?
2. **npm org:** Publish as `spidersan` or `@yourname/spidersan`?
3. **Supabase in MVP:** Include Supabase adapter in free tier for testing?

---

## Next Steps After Approval

1. Create fresh git repo for spidersan
2. Set up TypeScript project structure
3. Implement SQLite adapter
4. Build CLI commands
5. Test locally
6. Prepare npm package
