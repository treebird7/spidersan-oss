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

## Features

| Free | Pro |
|------|-----|
| Branch registration | Unlimited branches |
| Conflict detection | Conflict prediction |
| Merge ordering | MCP Server integration |
| Ready-check validation | Priority support |

## Pricing Model

- **Free Tier**: 5 concurrent branches, core CLI features
- **Pro Tier**: $29/month per project, unlimited branches + advanced features
- **Enterprise**: Custom pricing, self-hosted option

## Competitive Advantage

- **First mover** in AI agent coordination space
- **Zero config** - works with any Git workflow
- **Language agnostic** - not tied to any AI platform
- **Local-first** - no mandatory cloud dependency

## Roadmap

1. **Q1 2025**: CLI v1.0, npm package
2. **Q2 2025**: MCP server, conflict prediction
3. **Q3 2025**: VS Code extension, dashboard
4. **Q4 2025**: Enterprise self-hosted

## Contact

- GitHub: [github.com/treebird7/Spidersan](https://github.com/treebird7/Spidersan)
- Email: [hello@spidersan.dev](mailto:hello@spidersan.dev)
