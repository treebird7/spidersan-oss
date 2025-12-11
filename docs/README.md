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
  2. new-dashboard    (depends on main)
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

This creates a `.spidersanrc` config file.

### Usage

```bash
# Register your current branch
git checkout -b my-feature
spidersan register "Building awesome feature"

# See what's happening across all sessions
spidersan list

# Get optimal merge order
spidersan merge-order

# Mark branch as done
spidersan complete

# Clean up old branches
spidersan cleanup --older-than 7d
```

---

## Features

### Free (Open Source)

- ✅ Branch tracking across sessions
- ✅ Merge order recommendations
- ✅ Supabase sync (up to 5 branches)
- ✅ Git integration
- ✅ Session persistence

### Pro ($15/month)

- ✅ Unlimited branches
- ✅ Conflict prediction
- ✅ Team collaboration
- ✅ GitHub Actions integration
- ✅ Web dashboard
- ✅ MCP server for Claude
- ✅ Priority support

---

## How It Works

1. **Register:** Every AI session auto-registers its branch
2. **Track:** Spidersan records files changed, dependencies, status
3. **Coordinate:** Get merge order, conflict warnings
4. **Clean:** Auto-detect stale branches

---

## Documentation

- [Installation Guide](docs/installation.md)
- [Configuration](docs/configuration.md)
- [Commands](docs/commands.md)
- [Pro Features](docs/pro.md)

---

## License

Dual-licensed:
- **Core:** MIT License (free forever)
- **Pro:** Business Source License 1.1

See [LICENSE.md](LICENSE.md) for details.

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Support

- 📖 [Documentation](https://github.com/yourname/spidersan/wiki)
- 💬 [Discussions](https://github.com/yourname/spidersan/discussions)
- 🐛 [Issues](https://github.com/yourname/spidersan/issues)

---

## Roadmap

- [x] Core CLI
- [x] Supabase sync
- [ ] Conflict detection (Pro)
- [ ] MCP server
- [ ] Web dashboard
- [ ] GitHub Actions bot

---

**🕷️ Spidersan — Built for the AI-first developer**

Made with ❤️ by developers tired of merge conflicts.
