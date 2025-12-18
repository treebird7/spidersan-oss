# Watsan - AI Agent Context

> **Quick Load Context for Claude Code and AI Agents**

## What is Watsan?

Watsan is the **collective brain and orchestrator** for the Treebird ecosystem. It coordinates armies of AI agents across repos, branches, and use cases—from coding to company simulations to storytelling.

## Core Capabilities (Target)

| Capability | Description |
|------------|-------------|
| **Mission Control** | Dashboard showing all repos, branches, agents, tasks |
| **Task Decomposition** | Break big picture into tiny working bits |
| **Prompt Generation** | Create context-aware prompts for each task |
| **Scheduling** | Parallel/sequential execution, dependencies, timing |
| **Agent Dispatch** | Send tasks to agents via Myceliumail |
| **Status Tracking** | Monitor agent progress, handle junctions, push alerts |

## Treebird Ecosystem

| Tool | Abbrev | Purpose |
|------|--------|---------|
| **Watsan** | `wsan` | This project: orchestrator/brain |
| **Spidersan** | `ssan` | Branch coordination, conflict detection |
| **Myceliumail** | `mycm` | Encrypted inter-agent messaging |
| **Mappersan** | `maps` | Repo analysis and CLAUDE.md generation |
| **Watson** | `wson` | Agent on Claude Desktop |

## Current Phase: Foundation

Building Phase 0 + Phase 1:

### Phase 0: Prerequisites
1. **Mycmail Push Notifications** - Real-time alerts when agents complete/block
2. **Work Session Workflow** - `watsan sync` for agents to get current context

### Phase 1: Core
1. **Project Structure** - TypeScript CLI + MCP server
2. **Supabase Schema** - Projects, tasks, agent sessions
3. **Basic Commands** - `watsan status`, `watsan sync`, `watsan tasks`

## Project Structure (Target)

```
watsan/
├── src/
│   ├── bin/watsan.ts          # CLI entry point
│   ├── commands/              # CLI commands
│   │   ├── status.ts
│   │   ├── sync.ts
│   │   ├── tasks.ts
│   │   ├── plan.ts
│   │   └── dispatch.ts
│   ├── core/
│   │   ├── scheduler.ts       # Task scheduling engine
│   │   ├── prompt-gen.ts      # Prompt generator
│   │   └── graph.ts           # Dependency graph
│   ├── storage/
│   │   ├── supabase.ts        # Supabase adapter
│   │   └── factory.ts         # Storage factory
│   ├── mcp/                   # MCP server
│   │   └── server.ts
│   └── lib/
│       └── config.ts          # Config loading
├── supabase/
│   └── migrations/            # Database migrations
├── docs/
│   ├── ARCHITECTURE.md
│   └── AGENT_GUIDE.md
├── CLAUDE.md                  # This file
├── package.json
└── tsconfig.json
```

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **CLI**: Commander.js
- **Storage**: Supabase (Postgres + Realtime)
- **MCP**: @modelcontextprotocol/sdk
- **Messaging**: Myceliumail (via mycmail CLI)
- **Config**: `~/.treebird/watsan/`

## Environment Variables

```bash
SUPABASE_URL=...              # Supabase project URL
SUPABASE_KEY=...              # Supabase anon key
WATSAN_AGENT_ID=wsan          # This agent's identity
MYCELIUMAIL_AGENT_ID=wsan     # For mycmail integration
```

## Key Dependencies

```json
{
  "dependencies": {
    "commander": "^12.0.0",
    "@supabase/supabase-js": "^2.39.0",
    "@modelcontextprotocol/sdk": "^0.6.0",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.7.0"
  }
}
```

## Supabase Schema

Tables in `watsan` schema:
- `projects` - Tracked projects/repos
- `tasks` - Task hierarchy with dependencies
- `agent_sessions` - Active agent sessions

## Commands (Phase 1)

```bash
watsan status                 # Show ecosystem overview
watsan sync                   # Sync current context (for agents)
watsan tasks                  # List all tasks
watsan tasks --mine           # Tasks assigned to me
watsan plan "<goal>"          # Decompose goal into tasks
watsan dispatch               # Send tasks to agents
```

## Integration Points

### Myceliumail
```bash
# Watsan sends tasks
mycmail send <agent> "<task-subject>" --message "<prompt>"

# Watsan receives status
mycmail inbox --for wsan      # Check for agent updates
```

### Spidersan
```bash
# Query branch status across repos
spidersan list                # See active branches
spidersan conflicts           # Check for conflicts
```

### Mappersan
```bash
# Learn about repos
mappersan analyze <repo>      # Get repo structure
mappersan generate --tier 1   # Generate CLAUDE.md
```

## Limitations

- **No auto-execution**: Watsan generates prompts, doesn't run them directly
- **Myceliumail dependency**: Requires mycmail for inter-agent communication
- **Single orchestrator**: One Watsan instance per ecosystem (by design)
- **Human-in-the-loop**: Major decisions require user approval via push notifications

## Quick Patterns

### Pattern 1: Bootstrap Project
```bash
npm init -y
npm install commander @supabase/supabase-js dotenv typescript
npx tsc --init
# Create src/bin/watsan.ts entry point
```

### Pattern 2: Add New Command
```bash
# 1. Create src/commands/<command>.ts
# 2. Export command setup function
# 3. Register in src/bin/watsan.ts
```

### Pattern 3: Test with Mycmail
```bash
mycmail send wsan "Test" --message "Testing watsan integration"
mycmail inbox --for wsan
```

---

**Implementation Plan**: See `docs/IMPLEMENTATION_PLAN.md`  
**Ecosystem Docs**: Check Spidersan and Myceliumail repos for their CLAUDE.md files
