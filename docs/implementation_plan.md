# Spidersan Implementation Plan

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        Spidersan CLI                        │
├─────────────────────────────────────────────────────────────┤
│  Commands                                                    │
│  ├── list          (show registered branches)               │
│  ├── register      (register branch + files)                │
│  ├── unregister    (remove branch from registry)            │
│  ├── conflicts     (detect file overlaps)                   │
│  ├── merge-order   (topological sort for merging)           │
│  └── ready-check   (WIP detection, conflict check)          │
├─────────────────────────────────────────────────────────────┤
│  Core Modules                                                │
│  ├── registry.js   (branch storage, CRUD operations)        │
│  ├── conflicts.js  (file overlap detection)                 │
│  ├── topology.js   (DAG-based merge ordering)               │
│  └── wip.js        (WIP/TODO/FIXME detection)               │
├─────────────────────────────────────────────────────────────┤
│  Storage                                                     │
│  └── .spidersan/   (local JSON registry)                    │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Core CLI (Week 1-2)

- [ ] Project scaffolding (package.json, bin setup)
- [ ] `spidersan init` - Initialize .spidersan directory
- [ ] `spidersan register <branch> --files <paths>` 
- [ ] `spidersan list` - List all registered branches
- [ ] `spidersan unregister <branch>`

### Phase 2: Conflict Detection (Week 3)

- [ ] File overlap detection algorithm
- [ ] `spidersan conflicts` - Show conflicting branches
- [ ] `spidersan conflicts <branch>` - Check specific branch

### Phase 3: Merge Ordering (Week 4)

- [ ] Dependency graph construction
- [ ] Topological sort implementation
- [ ] `spidersan merge-order` - Output optimal merge sequence

### Phase 4: Ready Check (Week 5)

- [ ] WIP pattern detection (TODO, FIXME, WIP, XXX)
- [ ] Configurable patterns via .spidersanrc
- [ ] `spidersan ready-check` - Validate merge readiness

### Phase 5: Pro Features (Week 6-8)

- [ ] License key validation
- [ ] Branch limit enforcement (5 free, unlimited pro)
- [ ] Conflict prediction algorithm
- [ ] MCP server implementation

## Data Structures

### Branch Registry (.spidersan/registry.json)

```json
{
  "branches": {
    "feature/auth": {
      "files": ["lib/auth.ts", "api/login.ts"],
      "registered_at": "2025-01-15T10:00:00Z",
      "agent": "claude-code"
    }
  },
  "version": "1.0"
}
```

### Configuration (.spidersanrc)

```json
{
  "wip_patterns": ["TODO", "FIXME", "WIP", "XXX", "HACK"],
  "exclude_patterns": ["*.test.ts", "*.spec.js"],
  "max_branches_free": 5
}
```

## Tech Stack

- **Runtime**: Node.js 18+
- **CLI Framework**: Commander.js
- **Storage**: Local JSON files
- **Testing**: Vitest
- **Linting**: ESLint + Prettier

## Success Metrics

1. **Adoption**: 1000+ npm weekly downloads in 3 months
2. **Retention**: 50%+ users return after first use
3. **Conversion**: 5%+ free-to-pro conversion rate
