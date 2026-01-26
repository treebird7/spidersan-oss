---
tags: [agent/spidersan]
---

# Spidersan One Pager

## The Problem

AI coding agents (Claude Code, Cursor, GitHub Copilot Workspace) are revolutionizing development—but they create a new coordination problem:

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

## Core Features (v0.4.0)

**15 Essential Commands:**
- Branch registration & lifecycle management
- Conflict detection (file-level, tiered blocking)
- Merge ordering (heuristic)
- Dependency tracking (optional cloud sync)
- Health checks & diagnostics
- Repository rescue & recovery

**Optional Ecosystem Plugin:**
- Advanced locking (CRDT-based)
- Semantic conflict detection
- Real-time monitoring
- Intent-aware scanning
- Peer-to-peer torrenting
- Messaging & audit trails

## Competitive Advantage

- **First mover** in AI agent coordination space
- **Zero config** - works with any Git workflow
- **Language agnostic** - not tied to any AI platform
- **Local-first** - no mandatory cloud dependency
- **MIT licensed** - open source, no restrictions

## Roadmap

1. **Q1 2026** ✅: CLI v0.4.0, focused core (15 commands), npm package
2. **Q2 2026**: Ecosystem plugin public release, MCP server refinements
3. **Q3 2026**: VS Code extension, dashboard
4. **Q4 2026**: Enterprise features, self-hosted Hub

## Links

- **GitHub:** [github.com/treebird7/spidersan-oss](https://github.com/treebird7/spidersan-oss)
- **npm:** [npmjs.com/package/spidersan](https://www.npmjs.com/package/spidersan)
- **Docs:** [CORE.md](CORE.md) for full documentation
