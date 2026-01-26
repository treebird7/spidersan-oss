
# 🕷️ Spidersan

### Coordination for the multi-agent era

**Branch coordination for AI coding agents**

[![npm version](https://img.shields.io/npm/v/spidersan.svg)](https://www.npmjs.com/package/spidersan)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

![Demo](./assets/demo.gif)

[Quick Start](#-quick-start) • [Features](#-features) • [Documentation](#-documentation)

</div>

---


## 🎯 The Problem

**Local experiment: 10 AI agents. 1 file. 51 minutes of chaos.**

In our experience:
- ⏱️ ~51 min to complete 1 shared file
- 💥 12 conflicts
- 🔥 2 build breaks pushed to main
- 😰 Frustration level: 5/5

## 🕷️ The Solution

**Spidersan** is your AI team's coordination layer. It tracks branches, detects conflicts early, and recommends a merge order based on registered overlap—so your agents can work in harmony.

```bash
# Register your branch
spidersan register --files "lib/auth.ts,api/login.ts"

# See what conflicts with you
spidersan conflicts

# Get the right merge order
spidersan merge-order

# Check if you're ready to merge
spidersan ready-check
```

**Results with Spidersan (same team):**
- ⏱️ ~5 min (about 10x faster for us)
- ✅ 0 conflicts
- 🎯 Recommended merge sequence
- 😌 Confidence: 5/5

---

## 🚀 Quick Start

### Installation

```bash
npm install -g spidersan
```

### Basic Usage

```bash
# 1. Register your branch when you start working
spidersan register --files "src/component.tsx"

# 2. Check for conflicts before you go too deep
spidersan conflicts

# 3. When done, verify you're merge-ready
spidersan ready-check

# 4. Get recommended merge order for the team
spidersan merge-order
```

---

## ✨ Features

### Core Commands (MIT)

| Command | Description |
|---------|-------------|
| `spidersan init` | Initialize a repo for local branch tracking |
| `spidersan register` | Register a branch with files being modified |
| `spidersan list` | List active branches and metadata |
| `spidersan conflicts` | Show file conflicts between branches |
| `spidersan depends` | Declare dependencies between branches (optional Supabase sync) |
| `spidersan merge-order` | Get recommended merge order (heuristic) |
| `spidersan ready-check` | Verify branch is ready to merge |
| `spidersan stale` | Find stale branches older than N days |
| `spidersan cleanup` | Remove stale branches from registry |
| `spidersan rescue` | Scan/salvage rogue work |
| `spidersan abandon` | Mark a branch as abandoned |
| `spidersan merged` | Mark a branch as merged |
| `spidersan sync` | Sync registry with git state |
| `spidersan watch` | Daemon mode - watch files and auto-register |
| `spidersan doctor` | Diagnose local state and registry health |

### Ecosystem Plugin (Optional)

Install `spidersan-ecosystem` to unlock advanced coordination (internal for now):
- Symbol locking (`lock`) and semantic analysis (`semantic`)
- Intent scanning, active windows, and realtime monitoring (`intent-scan`, `active-windows`, `monitor`, `radar`)
- Task torrenting, multi-repo sync, and messaging (`torrent`, `sync-all`, `send`, `inbox`)
- Security pipeline + MCP health (`tension`, `audit-mark`, `mcp-health`, `mcp-restart`)


### Watch Mode (Daemon)

Real-time file monitoring with auto-registration:

```bash
# Start watching (auto-registers file changes)
spidersan watch --agent myagent

# With Hub integration for real-time conflict warnings
spidersan watch --agent myagent --hub

# Quiet mode (only show conflicts)
spidersan watch --agent myagent --hub --quiet
```

**Features:**
- 📁 Auto-registers files when you edit them
- ⚠️ Real-time conflict detection
- 🔌 Hub integration for team visibility
- 🕐 Debounced (1s) to prevent spam

### 🦺 Rescue Mode

Got a repo with 10+ abandoned branches? Let Spidersan clean up the mess:

```bash
# Scan for rogue files/branches
spidersan rescue --scan

# Salvage a file into ./salvage/
spidersan rescue --salvage path/to/file.ts

# Abandon a rogue file
spidersan rescue --abandon path/to/file.ts
```

**Perfect for:** Post-hackathon cleanup, onboarding to chaotic repos, AI agent disasters.

---

## 📖 Documentation

- [Core Guide](docs/CORE.md) - Public feature set and core workflows
- [Ecosystem Overview](docs/ECOSYSTEM.md) - Advanced features (internal)
- [Usage](USAGE.md) - CLI walkthroughs
- [One Pager](docs/ONE_PAGER.md) - Product overview
- [Data Collection](docs/DATA_COLLECTION.md) - Privacy & data practices

---



## 🗣️ Feedback & Support

We're building this in public and want to hear from you!

- **Issues & Features:** [GitHub Issues](https://github.com/treebird7/spidersan-oss/issues)
- **Email:** treebird@treebird.dev
- **Site:** [Treebird](https://treebird.uk)
- **Twitter/X:** [@Treebird_Dev](https://twitter.com/Treebird_Dev)

Tell us what's working, what's broken, and what you'd love to see next.

---

## 🤝 Contributing

Contributions welcome! Please read our contributing guidelines first.

---

## 📄 License

- **MIT License**: [LICENSE](LICENSE)

---

<div align="center">

**Made with 🕷️ for AI-first development teams**

Part of the [Treebird Ecosystem](https://treebird.uk) 🌲

</div>
