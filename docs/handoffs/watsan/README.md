# Watsan - The Collective Brain

> AI Agent Orchestrator for the Treebird Ecosystem

## Overview

Watsan coordinates armies of AI agents across repositories, branches, and use cases. It decomposes big-picture goals into tasks, generates prompts, schedules execution, and monitors progress via push notifications.

## Use Cases

- **Coding Teams**: Orchestrate multiple AI agents working on the same codebase
- **Company Simulation**: Manager, designer, developer, marketing agents working together
- **Storytelling**: Characters and storyteller agents creating interactive narratives
- **Research**: Literature review, analysis, synthesis, and writing agents

## Quick Start

```bash
# Install
npm install -g watsan

# Show ecosystem status
watsan status

# Sync context (for agents)
watsan sync

# Create tasks from a goal
watsan plan "Build user authentication"

# Dispatch tasks to agents
watsan dispatch
```

## Core Commands

| Command | Description |
|---------|-------------|
| `watsan status` | Show ecosystem overview |
| `watsan sync` | Sync current context for agents |
| `watsan tasks` | List all tasks |
| `watsan plan "<goal>"` | Decompose goal into tasks |
| `watsan dispatch` | Send tasks to agents via Myceliumail |
| `watsan graph` | Show task dependency graph |

## Treebird Ecosystem

Watsan is part of the Treebird ecosystem:

- **Spidersan** - Branch coordination, conflict detection
- **Myceliumail** - Encrypted inter-agent messaging
- **Mappersan** - Repo analysis and documentation generation
- **Watson** - Agent on Claude Desktop

## Configuration

```bash
# Environment variables
SUPABASE_URL=...          # Supabase project URL
SUPABASE_KEY=...          # Supabase anon key
WATSAN_AGENT_ID=wsan      # Agent identity
```

## Documentation

- [CLAUDE.md](./CLAUDE.md) - AI agent context
- [docs/IMPLEMENTATION_PLAN.md](./docs/IMPLEMENTATION_PLAN.md) - Full architecture
- [docs/AGENT_GUIDE.md](./docs/AGENT_GUIDE.md) - Quick reference for agents

## License

MIT
