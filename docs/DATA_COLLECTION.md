# Spidersan Standalone: Existing System Data Collection

> **Last Updated:** 11-12-25
> **Status:** ✅ Significant implementation already exists

## Overview

This document captures all existing spidersan components from the Recovery-Tree codebase. **Major update:** A production-ready CLI with 13 commands now exists.

---

## 1. Current Implementation (Recovery-Tree)

### CLI Tool: `scripts/spider-cli.js` (760 lines)

**Commands Available:**
| Command | Description | Status |
|---------|-------------|--------|
| `list` | List all active branches | ✅ Working |
| `register [desc]` | Register current branch | ✅ Working |
| `depends <branch>` | Set dependency | ✅ Working |
| `conflicts` | Show file conflicts | ✅ Working |
| `update-conflicts` | Update conflict_with in DB | ✅ Working |
| `merge-order` | Topological merge order | ✅ Working |
| `ready-check` | Pre-merge validation | ✅ Working |
| `stale` | Show stale branches | ✅ Working |
| `cleanup [days]` | Show old branches | ✅ Working |
| `sync` | Update files + conflicts | ✅ Working |
| `abandon` | Mark abandoned | ✅ Working |
| `merged` | Mark merged | ✅ Working |
| `help` | Show help | ✅ Working |

### Configuration: `.spidersan.config.json`

```json
{
  "readyCheck": {
    "enableWipDetection": true,
    "wipPatterns": ["TODO", "FIXME", "WIP", "HACK", "XXX"],
    "excludeFiles": ["tests/**", "*.test.js", "*.md", "**/docs/**"],
    "enableExperimentalDetection": true,
    "experimentalPatterns": ["experimental/", "test-"],
    "enableBuildCheck": true
  }
}
```

### Documentation & Tests

| File | Lines | Purpose |
|------|-------|---------|
| `SPIDERSAN_GUIDE.md` | 258 | Branch hygiene rules |
| `.spidersan.config.json` | 26 | Configuration |
| `.spidersan.schema.json` | 68 | IDE autocomplete |
| `.spidersan.examples.md` | 104 | Config examples |
| `tests/spidersan-ready-check.test.js` | 257 | 15 test cases |

---

## 2. Database Schema

### Implemented: `branch_registry` table

```sql
CREATE TABLE branch_registry (
  id UUID PRIMARY KEY,
  branch_name TEXT NOT NULL UNIQUE,
  created_by_session TEXT NOT NULL,
  created_by_agent TEXT NOT NULL,
  parent_branch TEXT DEFAULT 'main',
  state TEXT DEFAULT 'active',
  depends_on TEXT[],
  conflict_with TEXT[],
  files_changed TEXT[],
  description TEXT,
  pr_number INTEGER,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

### Views
- `active_branches` - Non-merged/abandoned branches
- `stale_branches` - Branches >7 days old

---

## 3. What's Standalone-Ready

| Component | Lines | Extraction Effort |
|-----------|-------|-------------------|
| CLI logic | 760 | Low - mostly standalone |
| Config loader | 30 | Already portable |
| Git helpers | 50 | Already portable |
| Conflict analysis | 100 | Already portable |
| Merge order algo | 50 | Already portable |

**Total reusable code:** ~990 lines

---

## 4. What Needs Work for Standalone

| Component | Current State | Needed for Standalone |
|-----------|---------------|----------------------|
| Database | Supabase-only | Add SQLite/Postgres adapters |
| Config | `.spidersan.config.json` | Also support `.spidersanrc` |
| WIP detection | Needs fine-tuning | Improve pattern matching |
| npm packaging | Not packaged | Add package.json, bin entry |

---

## 5. Related Features (To Keep)

### Tree Generator (`integration/spidersan-challenge`)
- `lib/services/gemini-images.ts` - Gemini image generation
- `lib/services/tree-sketcher.ts` - Tree sketch generation
- **Status:** Keep for future Gemini 3.0 agent testing

---

## 6. Gap Analysis (Updated)

| Feature | Status |
|---------|--------|
| Branch tracking | ✅ Complete |
| Conflict detection | ✅ Complete |
| Merge ordering | ✅ Complete |
| Ready-check validation | ✅ Complete |
| WIP detection | ⚠️ Needs fine-tuning |
| Configurable rules | ✅ Complete |
| Tests | ✅ 15 test cases |
| SQLite support | ❌ Not started |
| npm packaging | ❌ Not started |

---

## Summary

**Current state:** ~80% complete for Recovery-Tree use
**Standalone extraction:** ~30% additional work needed

---

## 5. Agent Definition

**Source:** `.claude/agents/` directory

### Existing Agents
1. `researchsan.md` - Research & analysis
2. `plannersan.md` - Architecture planning
3. `buildersan.md` - Implementation
4. `fixersan.md` - Bug fixing
5. `testersan.md` - Testing
6. `deploysan.md` - Deployment

### Proposed: `spidersan.md`
- Role: Branch orchestration, merge coordination
- Not yet implemented (in architecture doc only)

---

## 6. Identified Components for Standalone

### Reusable As-Is
| Component | Notes |
|-----------|-------|
| CLI command parsing | From agent-status-cli.js |
| Git branch detection | `execSync('git branch --show-current')` |
| Session persistence | Temp file approach |
| Merge order algorithm | From architecture (topological sort) |

### Needs Modification
| Component | Changes Needed |
|-----------|----------------|
| Database client | Abstract away Supabase, support SQLite/Postgres |
| Config loading | Support `.spidersanrc` or `spidersan.config.js` |
| Schema | Add `branch_registry` table |

### Build Fresh
| Component | Description |
|-----------|-------------|
| `spidersan` CLI | New branded CLI tool |
| SQLite adapter | For local-only mode |
| Conflict detection | File overlap analysis |
| npm package setup | `package.json`, bin scripts |

---

## 7. Distribution Requirements

### npm Package Structure
```
spidersan/
├── package.json
├── LICENSE.md
├── README.md
├── bin/
│   └── spidersan.js      # Entry point
├── src/
│   ├── cli.ts            # Command handling
│   ├── storage/
│   │   ├── interface.ts  # Storage abstraction
│   │   ├── sqlite.ts     # Local storage
│   │   ├── supabase.ts   # Cloud storage (Pro)
│   │   └── postgres.ts   # Self-hosted
│   ├── core/
│   │   ├── branch.ts     # Branch registry logic
│   │   ├── merge-order.ts
│   │   └── conflicts.ts  # Pro feature
│   └── config.ts         # Config file handling
└── schemas/
    └── branch_registry.sql
```

### npm Scripts
```json
{
  "name": "spidersan",
  "version": "0.1.0",
  "bin": {
    "spidersan": "./bin/spidersan.js"
  }
}
```

---

## 8. Gap Analysis

| Feature | Current State | Standalone Need |
|---------|---------------|-----------------|
| Agent status tracking | ✅ Working | ✅ Port as-is |
| Branch registry | 📋 Spec only | 🔨 Build new |
| Merge order algorithm | 📋 Spec only | 🔨 Build new |
| Conflict detection | 📋 Spec only | 🔨 Build new (Pro) |
| SQLite support | ❌ None | 🔨 Build new |
| Config file support | ❌ None | 🔨 Build new |
| npm packaging | ❌ None | 🔨 Build new |

---

## Summary

**Existing code to extract:** ~430 lines
**New code to write:** ~1,200-1,500 lines
**Estimated effort:** 2-3 weeks for MVP
