<div align="center">

# 🕷️ Spidersan

### One Spider To Rule Them All

**Branch coordination for AI coding agents**

[![npm version](https://img.shields.io/npm/v/spidersan.svg)](https://www.npmjs.com/package/spidersan)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[Quick Start](#-quick-start) • [Features](#-features) • [Documentation](#-documentation) • [Pro](#-pro)

</div>

---

## 🎯 The Problem

AI coding agents are powerful—but when multiple agents work on the same codebase simultaneously, chaos ensues:

- 🔀 **Merge conflicts** everywhere
- 🤷 **No visibility** into what other agents are doing
- 💥 **Wasted work** when branches can't be merged
- 🐌 **Manual coordination** slows everything down

## 🕷️ The Solution

**Spidersan** is your AI team's coordination layer. It tracks branches, detects conflicts early, and provides optimal merge ordering—so your agents can work in harmony.

```bash
# Register your branch
spidersan register feature/auth --files "lib/auth.ts,api/login.ts"

# See what conflicts with you
spidersan conflicts

# Get the right merge order
spidersan merge-order

# Check if you're ready to merge
spidersan ready-check
```

---

## 🚀 Quick Start

### Installation

```bash
npm install -g spidersan
```

### Basic Usage

```bash
# 1. Register your branch when you start working
spidersan register my-feature --files "src/component.tsx"

# 2. Check for conflicts before you go too deep
spidersan conflicts

# 3. When done, verify you're merge-ready
spidersan ready-check

# 4. Get optimal merge order for the team
spidersan merge-order
```

---

## ✨ Features

### Free (MIT License)

| Command | Description |
|---------|-------------|
| `spidersan list` | List all registered branches |
| `spidersan register` | Register a branch with files being modified |
| `spidersan conflicts` | Show file conflicts between branches |
| `spidersan merge-order` | Get topologically-sorted merge order |
| `spidersan ready-check` | Verify branch is ready (no WIP, no conflicts) |
| `spidersan watch` | **NEW!** Daemon mode - watch files and auto-register |

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
# 1. Start rescue mission
spidersan rescue

# 2. Scan and categorize all branches
spidersan scan --all
spidersan triage   # → MERGE / SALVAGE / ABANDON

# 3. Extract good code from broken branches
spidersan salvage feature/old-auth --components src/auth/jwt.ts

# 4. See your progress
spidersan rescue-status
```

**Perfect for:** Post-hackathon cleanup, onboarding to chaotic repos, AI agent disasters.

### Pro (License Required)

| Feature | Description |
|---------|-------------|
| **Unlimited Branches** | No limit on concurrent registered branches |
| **Conflict Prediction** | Proactive detection before conflicts occur |
| **MCP Server** | Model Context Protocol integration for AI agents |

---

## 📖 Documentation

- [One Pager](docs/ONE_PAGER.md) - Product overview
- [Implementation Plan](docs/implementation_plan.md) - Technical architecture
- [Data Collection](docs/DATA_COLLECTION.md) - Privacy & data practices

---

## 💎 Pro

Spidersan Pro unlocks advanced features for teams running multiple AI agents.

| Feature | Free | Pro ($9/mo) |
|---------|------|-------------|
| Core commands | ✅ All | ✅ All |
| Concurrent branches | 5 max | ✅ Unlimited |
| MCP Server | ❌ | ✅ |
| Conflict prediction | ❌ | ✅ Coming soon |
| Priority support | ❌ | ✅ |

**Activate Pro:**
```bash
spidersan activate <your-license-key>
spidersan status  # Check your plan
```

Get a license: [spidersan.dev/pro](https://spidersan.dev/pro)

> **Note:** One Pro license unlocks the entire Treebird ecosystem (Spidersan + Myceliumail).

---

## 🗣️ Feedback & Support

We're building this in public and want to hear from you!

- **Issues & Features:** [GitHub Issues](https://github.com/treebird7/Spidersan/issues)
- **Email:** treebird7@proton.me
- **Twitter/X:** [@treebird7](https://twitter.com/treebird7)

Tell us what's working, what's broken, and what you'd love to see next.

---

## 🤝 Contributing

Contributions welcome! Please read our contributing guidelines first.

---

## 📄 License

- **Core CLI**: [MIT License](LICENSE.md)
- **Pro Features**: [Business Source License 1.1](LICENSE.md)

---

<div align="center">

**Made with 🕷️ for AI-first development teams**

Part of the [Treebird Ecosystem](https://github.com/treebird7) 🌲

</div>
