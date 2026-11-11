---
aliases: ["Spidersan Docs"]
tags: [agent/spidersan, type/readme]
---

# 🕷️ Spidersan

**Branch coordination for AI coding agents**

> Stop the merge chaos. Know what every AI session is doing.

[![npm version](https://img.shields.io/npm/v/spidersan.svg)](https://www.npmjs.com/package/spidersan)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE.md)

---

## The Problem

You're crushing it with AI coding agents (Claude Code, Cursor, GitHub Copilot). But when you run multiple sessions:

- 🌿 **Branch explosion:** 10-20 branches pile up weekly
- 💥 **Merge chaos:** Wrong merge order = hours of conflicts
- 🤷 **Context loss:** Sessions don't know what others did
- 🗑️ **Stale branches:** Abandoned work clutters your repo

---

## The Solution

Spidersan gives you a **command center** for all your AI sessions:

```bash
$ spidersan list

🕷️ Active Branches:

  1. fix-auth-bug         ✅ Ready to merge
     └─ Last: 5 min ago | Claude Code

  2. refactor-api        ⚠️ Conflicts with #1
     └─ Last: 2 hours ago | Cursor

  3. new-dashboard        🔄 In progress
     └─ Last: 30 sec ago | Working on charts

$ spidersan merge-order

📋 Recommended merge sequence:
  1. fix-auth-bug     (no dependencies)
    2. new-dashboard    (overlaps with #1)
    3. refactor-api     (rebase after #1)
```

---

## Quick Start

### Installation

```bash
npm install -g spidersan
```

### Initialize

```bash
cd your-project
spidersan init
```

This creates `.spidersan/` with local registry data. Optional config can live in `.spidersanrc`.

### Usage

```bash
# Register your current branch
git checkout -b my-feature
spidersan register --files "src/feature.ts" --description "Building awesome feature"

# See what's happening across all sessions
spidersan list

# Get recommended merge order
spidersan merge-order

# Mark branch as done
spidersan merged --pr 123

# Clean up old branches
spidersan cleanup --days 7
```

---

## Features

- ✅ Branch tracking across sessions
- ✅ Merge order recommendations (heuristic)
- ✅ Cross-machine sync via `storage.syncModule` (optional)
- ✅ Git integration
- ✅ Session persistence
- ✅ Optional ecosystem plugin for advanced features

---

## How It Works

1. **Register:** Every AI session auto-registers its branch
2. **Track:** Spidersan records files changed, dependencies, status
3. **Coordinate:** Get merge order, conflict warnings
4. **Clean:** Auto-detect stale branches

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `watch` process in infinite conflict loop | Ghost branch in registry claiming files that watcher re-registers | `spidersan sync` removes orphaned branches |
| `kill <pid>` doesn't stop watcher | LaunchAgent with `KeepAlive: true` restarts it | `launchctl unload ~/Library/LaunchAgents/<plist>.plist` |
| Multiple MCP server instances accumulating | Each IDE/Claude session spawns one, none clean up | `spidersan mcp-health --kill-zombies` |
| Treesync skipping auto-commits unexpectedly | `conflicts --strict` returning TIER 2+ | `spidersan sync` to clear ghost branches, then `spidersan conflicts` to confirm clean |
| Conflict references a branch that doesn't exist in git | Stale registry entry (ghost branch) | `spidersan sync` |

## Documentation

- [Core Guide](CORE.md)

---

## License

MIT License. See [LICENSE](../LICENSE).

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Support

- 📖 [Documentation](https://github.com/treebird7/spidersan-oss)
- 💬 [Discussions](https://github.com/treebird7/spidersan-oss/discussions)
- 🐛 [Issues](https://github.com/treebird7/spidersan-oss/issues)

---

## Roadmap

- [x] Core CLI
- [x] Cross-machine sync (pluggable `storage.syncModule`)
- [ ] Conflict detection refinements
- [ ] Ecosystem plugin rollout

---

**🕷️ Spidersan — Built for the AI-first developer**

Made with ❤️ by developers tired of merge conflicts.
