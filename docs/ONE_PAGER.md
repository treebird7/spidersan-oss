# Spidersan One Pager

## The Problem

AI coding agents (Claude, Cursor, GitHub Copilot) are revolutionizing development—but they create a new coordination problem:

> **Multiple AI agents working simultaneously = merge conflict chaos**

When 3+ agents work on a codebase:
- Each creates its own branch
- No visibility into overlapping file changes
- Merge conflicts discovered too late
- Hours of agent work wasted

## The Solution

**Spidersan** is a lightweight CLI that coordinates AI agent branches:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Agent 1   │     │   Agent 2   │     │   Agent 3   │
│ feature/auth│     │ feature/api │     │ feature/ui  │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                    ┌──────▼──────┐
                    │  Spidersan  │
                    │  Coordinator│
                    └─────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         Conflicts    Merge Order   Ready Check
```

## Target Audience

1. **AI Agent Developers** - Building multi-agent coding systems
2. **DevOps Teams** - Managing AI-assisted development workflows
3. **Solo Developers** - Running multiple AI agents on one project

## Key Features

| Feature | Description |
|---------|-------------|
| Branch registration | Track what each agent is working on |
| 4-tier conflict detection | BLOCK → PAUSE → WARN → INFO |
| Semantic analysis | `--semantic` flag for AST-based conflicts |
| Merge ordering | Topological sort for optimal sequence |
| MCP Server | Direct integration with Claude Desktop |
| GitHub Actions | Auto-register branches on push |

## Competitive Advantage

- **First mover** in AI agent coordination space
- **Zero config** - works with any Git workflow
- **Language agnostic** - not tied to any AI platform
- **Local-first** - optional cloud sync via Supabase

## Open Source

Spidersan is **MIT licensed** and free to use.

## Links

- GitHub: [github.com/treebird7/spidersan-oss](https://github.com/treebird7/spidersan-oss)
- npm: `npm install -g spidersan`
