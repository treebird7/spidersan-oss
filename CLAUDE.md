---
aliases: ["Spidersan Identity"]
tags: [agent/myceliumail, type/identity]
---

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

### Conflict Detection (Tiered)
```bash
spidersan conflicts               # Show all file conflicts with tier levels
spidersan conflicts --tier 2      # Filter: TIER 2+ only (PAUSE, BLOCK)
spidersan conflicts --tier 3      # Filter: TIER 3 only (BLOCK - security critical)
spidersan conflicts --strict      # Exit 1 if TIER 2+ conflicts found
spidersan conflicts --notify      # Post conflicts to Hub chat
spidersan conflicts --wake        # Wake conflicting agents via Hub + Toak
spidersan conflicts --retry 60    # Re-check after 60s when using --wake
spidersan merge-order             # Get optimal merge sequence
spidersan ready-check             # Validate branch is merge-ready (no WIP markers)
```

**Conflict Tiers:**
| Tier | Icon | Action | Examples |
|------|------|--------|----------|
| 1 WARN | 🟡 | Proceed with caution | .md, .json, .css |
| 2 PAUSE | 🟠 | Coordinate first | tests, migrations, API |
| 3 BLOCK | 🔴 | Must resolve | CLAUDE.md, .env, package.json |

### Lifecycle Management
```bash
spidersan merged --pr <num>       # Mark branch as merged
spidersan abandoned               # Mark branch as abandoned
spidersan stale                   # Show old branches (default: 7 days)
spidersan cleanup                 # Remove stale branches
spidersan sync                    # Sync registry with git
```

### Session Lifecycle (Toak Integration)
```bash
spidersan wake                    # Start session: sync, conflicts, announce presence
spidersan wake --skip-mail        # Start session without Toak messaging
spidersan pulse                   # Check web health and registry completeness
spidersan pulse --quiet           # One-line health summary
spidersan close                   # End session: show status, broadcast sign-off
spidersan close --mark-stale      # End session and mark branches as stale
spidersan close -m "Done for now" # Custom sign-off message
spidersan watch                   # Watch files, auto-register, detect conflicts
spidersan watch --hub-sync        # Post conflicts to Hub chat
spidersan mcp-health              # Check MCP server health
spidersan mcp-health --hub        # Post health report to Hub chat
spidersan mcp-health --kill-zombies   # Kill duplicate zombie MCP processes 🆕
spidersan mcp-health --auto-restart   # Restart stopped required MCPs 🆕
```

### Task Torrenting (Branch-per-Task) 🆕
```bash
spidersan torrent create <task-id>      # Create branch for task (e.g., DASH-001)
spidersan torrent create SEC-001 -a srlk # Claim task for agent
spidersan torrent status                # Show all active task branches
spidersan torrent status --parent DASH  # Filter by parent task
spidersan torrent complete <task-id>    # Mark task complete, check conflicts
spidersan torrent merge-order           # Optimal merge sequence for tasks
spidersan torrent tree                  # Nested task tree visualization
spidersan torrent decompose PARENT -c 3 # Create 3 child tasks (A, B, C)
```

### Dependencies (Supabase only)
```bash
spidersan depends <branch>        # Declare dependency on another branch
spidersan depends                 # Show current dependencies
```

### Agent Messaging (via Toak)
```bash
# Send a Toak message
envoak vault inject --key $(cat ~/.envoak/ssan.key) -- toak say <agent> "<message>"

# Check inbox
envoak vault inject --key $(cat ~/.envoak/ssan.key) -- toak inbox
```

> **Note:** Spidersan's key is at `~/.envoak/ssan.key` (30d TTL). If missing, ping bsan to re-provision.
> `TOAK_AGENT_ID` is injected automatically via the agent's vault key (`agent-ssan/TOAK_AGENT_ID`). No manual prefix needed.

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

---

## ⚡ Pre-Work Workflow for AI Agents

**ALWAYS run this sequence before modifying any files:**

### Step 1: Initialize (First Time Only)
```bash
# Check if repo is initialized
if [ ! -d ".spidersan" ]; then
  spidersan init
fi
```

### Step 2: Check for Conflicts (REQUIRED)
```bash
spidersan conflicts
# 🔴 BLOCK → STOP immediately, coordinate with other agent
# 🟠 PAUSE → Contact other agent via toak before proceeding  
# 🟡 WARN → Note it, proceed with caution
# ✅ CLEAN → Safe to proceed
```

### Step 3: Register Your Work (REQUIRED)
```bash
spidersan register --files "src/auth.ts,src/api.ts" \
  --agent <your-agent-id> \
  --description "Brief description of what you're doing"
```

### Step 4: Proceed with Changes
Only after Steps 1-3 are complete.

---

### Quick Pre-Work Commands

```bash
# Minimal check before work
spidersan conflicts && spidersan register --files "your files" --agent yourname

# With specific file check
spidersan conflicts --files "src/auth.ts"

# Check who's working where
spidersan list
```

---

## 🤖 AI Agent Use Cases

### Scenario 1: Starting a New Feature
**When:** User asks you to implement a new feature

```bash
# 1. Check what's already in progress
spidersan list

# 2. Check for potential conflicts on files you plan to modify
spidersan conflicts

# 3. Register your work
git checkout -b feature/new-api-endpoint
spidersan register --files "src/api/endpoints.ts,src/types/api.ts" --desc "Adding new API endpoint"

# 4. Start coding...
```

**Why:** Prevents duplicate work and alerts other agents to your changes.

---

### Scenario 2: Before Making Changes
**When:** User asks you to modify existing files

```bash
# 1. Check if anyone else is working on these files
spidersan conflicts

# 2. If TIER 2+ conflicts exist, coordinate first
spidersan conflicts --tier 2

# 3. If clear, register and proceed
spidersan register --files "src/auth.ts"
```

**Why:** Avoids merge conflicts and wasted effort.

---

### Scenario 3: Before Creating a PR
**When:** You've completed work and user wants to create a PR

```bash
# 1. Verify no WIP markers or incomplete work
spidersan ready-check

# 2. Check final conflict status
spidersan conflicts --strict

# 3. Get recommended merge order
spidersan merge-order

# 4. If you're not first in line, wait or coordinate
```

**Why:** Ensures clean merges and proper sequencing.

---

### Scenario 4: Multi-Agent Coordination
**When:** Multiple agents are working simultaneously

```bash
# At session start:
spidersan list                    # See who's working on what
spidersan conflicts --tier 2      # Check critical conflicts

# During work:
spidersan watch --agent myagent   # Auto-register file changes

# Before committing:
spidersan conflicts               # Final check
spidersan merge-order             # Confirm merge sequence
```

**Why:** Real-time awareness prevents conflicts.

---

### Scenario 5: Repository Cleanup
**When:** Repo has many stale/abandoned branches

```bash
# 1. Start rescue mission
spidersan rescue --scan

# 2. Find stale branches
spidersan stale

# 3. Clean up old branches
spidersan cleanup

# 4. Mark abandoned work
spidersan abandon
```

**Why:** Keeps repository clean and registry accurate.

---

### Scenario 6: Debugging Registry Issues
**When:** Spidersan seems out of sync or broken

```bash
# 1. Run diagnostics
spidersan doctor

# 2. Check configuration
spidersan config view

# 3. Sync registry
spidersan sync

# 4. Verify health
spidersan doctor --fix
```

**Why:** Ensures Spidersan is functioning correctly.

---

### Scenario 7: Working on Critical Files
**When:** Modifying package.json, .env, CLAUDE.md, migrations, etc.

```bash
# 1. Check TIER 3 (BLOCK) conflicts
spidersan conflicts --tier 3

# 2. If conflicts exist, STOP and coordinate
# These files require sequential changes

# 3. Only proceed if clear
spidersan register --files "package.json" --desc "Adding new dependency"
```

**Why:** TIER 3 files can break the entire project if conflicted.

---

### Scenario 8: Long-Running Feature Branch
**When:** Working on a feature over multiple sessions

```bash
# Session start:
spidersan list                    # Check current state
spidersan conflicts               # See new conflicts

# During work:
spidersan watch --agent myagent   # Monitor changes

# Session end:
spidersan conflicts               # Final status check
# Leave branch registered for next session
```

**Why:** Maintains visibility across sessions.

---

### Scenario 9: After PR Merged
**When:** Your PR has been merged to main

```bash
# Mark as merged
spidersan merged --pr 123

# Clean up local registry
spidersan sync
```

**Why:** Keeps registry clean and informs other agents.

---

### Scenario 10: Emergency Conflict Resolution
**When:** Merge conflict detected during PR

```bash
# 1. Check conflict details
spidersan conflicts --tier 2

# 2. Get merge order recommendation
spidersan merge-order

# 3. Coordinate with conflicting agent
# (Use Toak/Myceliumail if available)

# 4. Resolve conflicts manually
# 5. Re-verify
spidersan ready-check
```

**Why:** Systematic approach to conflict resolution.

---

## 🎯 Command Decision Tree

```
User Request
    │
    ├─ "Implement feature X"
    │   └─→ spidersan list → conflicts → register
    │
    ├─ "Modify file Y"
    │   └─→ spidersan conflicts → register
    │
    ├─ "Create PR"
    │   └─→ spidersan ready-check → merge-order
    │
    ├─ "Clean up repo"
    │   └─→ spidersan rescue → stale → cleanup
    │
    ├─ "Check status"
    │   └─→ spidersan list → conflicts
    │
    └─ "Something's broken"
        └─→ spidersan doctor → sync
```

## Limitations

### What Spidersan CANNOT Do:
- **Cannot auto-resolve conflicts** - Only detects and reports them
- **Cannot enforce registration** - Agents must voluntarily register
- **Cannot track unregistered branches** - If not registered, invisible
- **Cannot modify git** - It's metadata-only, doesn't touch your code
- **Cannot communicate across repos** - Messages are repo-scoped (Supabase tier)
- **Cannot predict semantic conflicts** - Only file-level overlap detection

### Storage Limitations:
- **Local storage**: Single-machine only (no real-time sync)
- **Supabase optional** for cross-machine sync and dependency tracking

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

### Encryption Setup (for Toak via Envoak)
```bash
# Toak keys are provisioned by bsan and stored at ~/.envoak/ssan.key
# If missing, ping bsan to re-provision:
# envoak vault inject --key $(cat ~/.envoak/ssan.key) -- toak say bsan "ssan key missing"
```

## Toak Identity

| Field | Value |
|-------|-------|
| Agent ID | `ssan` |
| Key location | `~/.envoak/ssan.key` (30d TTL, provisioned by bsan) |

## Session Startup

**Available commands for session startup (run only if explicitly requested):**

```bash
# Check for pending tasks (optional)
cat .pending_task.md 2>/dev/null && rm .pending_task.md

# Start session (optional)
spidersan wake

# Check inbox (optional)
envoak vault inject --key $(cat ~/.envoak/ssan.key) -- toak inbox
```

> **Note:** These are available commands, not automatic actions. Only run when the user explicitly asks you to start a session or run these commands.

## Ecosystem Conventions (Learned)

### Daily Collab
- **Canonical location:** `treebird-internal/collab/daily/` — this is the source of truth
- **Write via:** `node /Users/macbook/Dev/toak/dist/bin/toak.js collab "message"`
- **Do NOT** write directly to `sansan-knowledge/collab/` — it is a one-way rsync mirror (`--delete`) and will wipe manually created files on next sync
- `treesync` auto-commits changes to `treebird-internal` — no need to manually commit after editing files there

### Skills Repo
- **Canonical location:** `/Users/macbook/Dev/Skills` (capital S) — git-tracked, `treebird7/skills.git`
- `/Dev/skills/` (lowercase) is stale — do not use

### npm Publish Checklist
- `"files"` field in `package.json` **overrides `.npmignore` entirely** — negations like `!CHANGELOG.md` are ignored; add files explicitly to `"files"` array
- Before publishing: grep for hardcoded private agent IDs (e.g. `ssan`) in Hub API calls — replace with generic public name

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

## Execution Boundaries

| Action | Allowed | Notes |
|--------|---------|-------|
| Branch operations (read, register) | ✅ | Spidersan's domain |
| Intent registration | ✅ | Spidersan's domain |
| Code changes in other agents' files | ❌ | Registry only |
| Force push / destructive git ops | ❌ | Never |
