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
- ✅ Supabase sync (optional)
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

## Documentation

- [Core Guide](CORE.md)
- [Ecosystem Overview](ECOSYSTEM.md)
- [Usage](../USAGE.md)
- [Limitations](LIMITATIONS.md)

---

## License

MIT License. See [LICENSE](../LICENSE).

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Support

- 📖 [Documentation](https://github.com/treebird7/Spidersan)
- 💬 [Discussions](https://github.com/treebird7/Spidersan/discussions)
- 🐛 [Issues](https://github.com/treebird7/Spidersan/issues)

---

## Roadmap

- [x] Core CLI
- [x] Supabase sync
- [ ] Conflict detection refinements
- [ ] Ecosystem plugin rollout

---

**🕷️ Spidersan — Built for the AI-first developer**

Made with ❤️ by developers tired of merge conflicts.
