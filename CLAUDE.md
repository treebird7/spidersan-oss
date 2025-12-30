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

### Session Lifecycle (Myceliumail Integration)
```bash
spidersan wake                    # Start session: sync, conflicts, announce presence
spidersan wake --skip-mail        # Start session without mycmail
spidersan pulse                   # Check web health and registry completeness
spidersan pulse --quiet           # One-line health summary
spidersan close                   # End session: show status, broadcast sign-off
spidersan close --mark-stale      # End session and mark branches as stale
spidersan close -m "Done for now" # Custom sign-off message
```

### Dependencies (Supabase only)
```bash
spidersan depends <branch>        # Declare dependency on another branch
spidersan depends                 # Show current dependencies
```

### Agent Messaging (via Myceliumail)
```bash
spidersan send <agent> <subject>  # Send message (wraps mycmail)
spidersan send <agent> <subject> --encrypt  # Send encrypted
spidersan inbox                   # Check inbox (wraps mycmail)
spidersan read <id>               # Read message (wraps mycmail)
```

### Encryption
```bash
spidersan keygen                 # Generate keypair (via custom Myceliumail wrapper)
spidersan keys                    # List known public keys
spidersan key-import <key>        # Import another agent's public key
```

### Rescue Mode (Repository Recovery)
```bash
spidersan rescue                  # Start rescue mission
spidersan scan --all              # Scan all branches
spidersan triage                  # Categorize: MERGE/SALVAGE/ABANDON
spidersan salvage <branch>        # Extract usable components
spidersan archaeology             # Deep scan for valuable code
spidersan rescue-status           # View mission progress
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

### USE RESCUE MODE When:
1. Repository has 10+ uncoordinated branches
2. Don't know what each branch contains
3. Multiple AI agents have created overlapping work
4. Need to salvage good code from broken branches
5. Starting fresh but want to preserve valuable work

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

### Pattern 5: Rescue a Chaotic Repository
```bash
spidersan rescue --create-master
spidersan scan --all
# Triage: decide what to merge, salvage, or abandon
spidersan triage
# Extract good code from broken branches
spidersan salvage feature/old-auth --components src/auth/jwt.ts
# View progress
spidersan rescue-status
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

### Encryption Setup (for Myceliumail)
```bash
spidersan keygen              # Generate keypair (run once per agent)
# Keys stored in ~/.spidersan/keys/
# Share your public key with agents you want encrypted comms with
```

## Myceliumail Identity

> **This agent is connected to the Mycelium network**

| Field | Value |
|-------|-------|
| Agent ID | `ssan` |
| Public Key | `AJiuvd49I8uY819nnIZE4DoIugVnD/lA/2xksH5JtVo=` |

```bash
# Import ssan's key to send encrypted messages:
mycmail key-import ssan AJiuvd49I8uY819nnIZE4DoIugVnD/lA/2xksH5JtVo=
```

## Session Startup

**On session start, announce in Hub chat:**
```bash
curl -s -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"sender":"Spidersan","text":"🕷️ Web active. Scanning for conflicts...","glyph":"🕷️"}'
```

**Then run wake:**
```bash
spidersan wake
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
