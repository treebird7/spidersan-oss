# Spidersan - AI Agent Context

> **Quick Load Context for Claude Code and AI Agents**

## What is Spidersan?

Spidersan is a **branch coordination CLI** that prevents merge conflicts when multiple AI agents work on the same codebase. Think of it as "air traffic control" for AI coding sessions.

## Core Problem It Solves

When Claude Code, Cursor, and Copilot work simultaneously:
- They create conflicting branches on the same files
- No visibility into what other agents are doing
- Wrong merge order causes cascade failures
- Abandoned branches clutter the repository

## Available Commands

### Registration & Tracking
```bash
spidersan init                    # Initialize in a project
spidersan register --files <f>    # Register files you'll modify
spidersan list                    # List all registered branches
```

### Conflict Detection
```bash
spidersan conflicts               # Show all file conflicts
spidersan merge-order             # Get optimal merge sequence
spidersan ready-check             # Validate branch is merge-ready (no WIP markers)
```

### Lifecycle Management
```bash
spidersan merged --pr <num>       # Mark branch as merged
spidersan abandoned               # Mark branch as abandoned
spidersan stale                   # Show old branches (default: 7 days)
spidersan cleanup                 # Remove stale branches
spidersan sync                    # Sync registry with git
```

### Dependencies (Supabase only)
```bash
spidersan depends <branch>        # Declare dependency on another branch
spidersan depends                 # Show current dependencies
```

### Agent Messaging (Supabase only)
```bash
spidersan send <agent> <subject>  # Send message to another agent
spidersan inbox                   # Check incoming messages
spidersan read <id>               # Read specific message
```

## When to Use Spidersan

### ALWAYS Register When:
1. Starting work on a new feature branch
2. About to modify files that might conflict
3. Beginning any multi-file refactoring

### ALWAYS Check Conflicts When:
1. Before starting work on any files
2. Before creating a PR
3. When planning merge sequence

### ALWAYS Run Ready-Check When:
1. Before requesting PR review
2. Before merging to main
3. After completing a feature

## Limitations

### What Spidersan CANNOT Do:
- **Cannot auto-resolve conflicts** - Only detects and reports them
- **Cannot enforce registration** - Agents must voluntarily register
- **Cannot track unregistered branches** - If not registered, invisible
- **Cannot modify git** - It's metadata-only, doesn't touch your code
- **Cannot communicate across repos** - Messages are repo-scoped (Supabase tier)
- **Cannot predict semantic conflicts** - Only file-level overlap detection

### Storage Limitations:
- **Local storage**: Max 5 concurrent branches (free tier)
- **No real-time sync**: Local storage is single-machine only
- **Supabase required** for: messaging, cross-machine sync, dependencies

## Quick Patterns

### Pattern 1: Starting New Work
```bash
git checkout -b feature/my-feature
spidersan register --files src/api.ts,src/lib.ts --desc "Adding new API endpoints"
# Now other agents can see what you're working on
```

### Pattern 2: Before Modifying Files
```bash
spidersan conflicts
# If conflicts exist, coordinate or pick different files
```

### Pattern 3: Before Creating PR
```bash
spidersan ready-check
# Fix any WIP markers found
spidersan merge-order
# Check if other branches should merge first
```

### Pattern 4: After PR Merged
```bash
spidersan merged --pr 123
# Cleans up registry, informs other agents
```

## Configuration

Config files (in priority order):
1. `.spidersanrc`
2. `.spidersanrc.json`
3. `.spidersan.config.json`

Environment variables:
```bash
SUPABASE_URL=...          # Enable cloud storage
SUPABASE_KEY=...          # Supabase API key
SPIDERSAN_AGENT=claude    # Your agent identifier
```

## Architecture Overview

```
CLI Commands → Storage Adapter → Local JSON / Supabase
                    ↓
              Branch Registry (tracks: name, files, agent, status, description)
              Agent Messages (tracks: from, to, subject, type, read status)
```

## This Repository Structure

```
src/
├── bin/spidersan.ts      # CLI entry point
├── commands/             # All CLI commands
├── storage/              # Storage adapters (local, supabase)
└── lib/                  # Config loading, utilities
docs/
├── USE_CASES.md          # Comprehensive use case documentation
├── AGENT_GUIDE.md        # Quick reference for AI agents
└── ...                   # Other documentation
```

## Key Files to Know

| File | Purpose |
|------|---------|
| `src/storage/factory.ts` | Auto-selects storage backend |
| `src/storage/adapter.ts` | Storage interface contract |
| `src/commands/*.ts` | Individual command implementations |
| `.spidersan/registry.json` | Local storage location |

## Testing

```bash
npm test              # Run unit tests
npm run stress-test   # Run stress tests (200+ branches)
npm run lint          # ESLint
npm run build         # TypeScript compilation
```

---

**For detailed use cases, see:** `docs/USE_CASES.md`
**For agent-specific quick reference, see:** `docs/AGENT_GUIDE.md`
