# Spidersan: Branch Coordination for AI Agents

> 🕷️ *"The web doesn't just connect — it coordinates."*

## 1. Overview

Spidersan is the **branch coordination system** for multi-agent AI development. When multiple AI coding assistants work on the same codebase, Spidersan prevents merge conflicts, coordinates file access, and orchestrates parallel work.

**Core capabilities:**
- **Conflict Detection** — 7-layer conflict prevention system
- **Branch Registration** — Track who's editing what
- **Real-time Monitoring** — Watch mode and radar for live awareness
- **Session Management** — Wake/close patterns for agent lifecycles
- **Multi-repo Sync** — Manage all /Dev repositories at once

## 2. Quick Start

```bash
# Start a session
spidersan wake

# Register what you're working on
spidersan register --files "src/app.ts,README.md" --description "Adding feature X"

# Check for conflicts before committing
spidersan conflicts

# Validate before merge
spidersan ready-check

# End your session
spidersan close
```

## 3. The 7-Layer Conflict Detection

Spidersan uses a sophisticated multi-layer approach:

| Layer | Name | What It Detects |
|-------|------|-----------------|
| L1 | File-level | Git conflicts (same file, different changes) |
| L2 | Semantic | Code dependencies (function calls, imports) |
| L3 | Intent | Overlapping work in collab entries |
| L4 | Temporal | Active windows (who's working now) |
| L5 | Cross-repo | Breaking changes across repositories |
| L6 | Predictive | Pattern analysis (likely conflicts) |
| L7 | Resolution | Auto-merge strategies |

## 4. Core Commands

### Session Management

```bash
# Wake up - start your session
spidersan wake
spidersan wake --quiet          # Minimal output
spidersan wake --skip-mail      # Skip messaging integration

# Close - end your session  
spidersan close
```

### Branch Registration

```bash
# Register files you're editing
spidersan register --files "file1.ts,file2.ts"
spidersan register --files "src/*" --description "Refactoring auth"
spidersan register --auto        # Auto-detect from git diff
spidersan register -i            # Interactive mode

# List all registered branches
spidersan list
spidersan list --json            # JSON output
```

### Conflict Detection

```bash
# Check for conflicts
spidersan conflicts
spidersan conflicts --tier 2         # Only TIER 2+ (blocking)
spidersan conflicts --strict         # Exit with error if conflicts found
spidersan conflicts --notify         # Alert Hub about conflicts
spidersan conflicts --wake           # Wake conflicting agents
spidersan conflicts --auto           # Auto-resolve loop (Ralph Wiggum mode)
```

**Conflict Tiers:**
- **Tier 1** — Potential conflicts (same directory)
- **Tier 2** — Likely conflicts (same file, different edits)
- **Tier 3** — Definite conflicts (same lines)

### Pre-Merge Validation

```bash
# Check if branch is ready to merge
spidersan ready-check
spidersan merge-order           # Get optimal merge sequence
```

## 5. Real-time Monitoring

### Watch Mode (Daemon)

```bash
# Watch current directory for changes
spidersan watch

# Watch with options
spidersan watch --agent birdsan       # Set agent identifier
spidersan watch --hub                 # Connect to Hub for real-time warnings
spidersan watch --hub-sync            # Post conflicts to Hub chat
spidersan watch --quiet               # Only log conflicts
spidersan watch /path/to/dir          # Watch specific directory
```

### Radar

```bash
# Real-time conflict radar
spidersan radar
spidersan radar --hub https://hub.example.com
```

### Pulse

```bash
# Self-awareness check
spidersan pulse
spidersan pulse --json
```

## 6. Multi-Repo Sync

```bash
# Sync all /Dev repositories
spidersan sync-all                    # Show status of all repos
spidersan sync-all --pull             # Pull all repos
spidersan sync-all --push             # Push repos with commits
spidersan sync-all --pull --push      # Full sync cycle
spidersan sync-all --repos "Envoak,Sherlocksan" --pull  # Specific repos
```

## 7. Collaboration Tools

### Collab Documents

```bash
# Manage collaborative documents
spidersan collab
spidersan collab-sync               # Prevent collab merge conflicts
```

### Intent Scanning (Layer 3)

```bash
# Detect overlapping work intentions
spidersan intent-scan               # Scan today's collab
spidersan intent-scan --days 3      # Scan last 3 days
spidersan intent-scan --verbose     # Show all detected intents
spidersan intent-scan --json        # Output as JSON
```

### Active Windows (Layer 4)

```bash
# Detect overlapping work sessions
spidersan active-windows
```

## 8. Task Torrenting

Parallel task execution with automatic branch management:

```bash
# Create task branch
spidersan torrent create TASK-001

# Show all task branches
spidersan torrent status

# Mark task complete
spidersan torrent complete TASK-001

# Get optimal merge order
spidersan torrent merge-order

# View task tree
spidersan torrent tree

# Decompose parent into children
spidersan torrent decompose TASK --children "TASK-A,TASK-B,TASK-C"
```

## 9. Security Integration

```bash
# Show file tensions (security pipeline)
spidersan tension

# Mark branch as security-reviewed
spidersan audit-mark feature/my-branch
```

## 10. MCP Ecosystem

```bash
# Check MCP server health
spidersan mcp-health

# Restart MCP connections
spidersan mcp-restart
```

## 11. Diagnostics

```bash
# Diagnose issues
spidersan doctor

# View session log
spidersan log
spidersan log "Session note here"
```

## 12. Configuration

Initialize Spidersan in a project:

```bash
spidersan init
```

This creates `.spidersan/` with:
- `registry.json` — Branch registrations
- `config.json` — Local settings

### Shell Completions

```bash
spidersan completions bash >> ~/.bashrc
spidersan completions zsh >> ~/.zshrc
spidersan completions fish >> ~/.config/fish/completions/spidersan.fish
```

## 13. Workflow Examples

### Solo Agent Session

```bash
spidersan wake
spidersan register --auto
# ... do your work ...
spidersan conflicts
spidersan ready-check
spidersan close
```

### Multi-Agent Coordination

```bash
# Agent A registers
spidersan register --files "auth/*" --agent agentA

# Agent B registers
spidersan register --files "api/*" --agent agentB

# Coordinator checks
spidersan conflicts
spidersan radar

# When ready
spidersan merge-order
```

### Continuous Watch

```bash
# Start in background
spidersan watch --hub --quiet &

# Work normally... Spidersan warns of conflicts in real-time
```

## 14. Troubleshooting

| Issue | Solution |
|-------|----------|
| "No registry found" | Run `spidersan init` first |
| Stale branches | Run `spidersan cleanup` |
| MCP not connecting | Run `spidersan mcp-health` |
| Conflicts not detected | Ensure branches are registered |

---

*Generated manually for Spidersan's Birthday Stress Test (Hour 1: No Spider Assistance)*  
*Date: 2026-01-18*  
*Time: Started 20:36, documented without spidersan commands*

🕷️🎂🌲
