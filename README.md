
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

Multi-agent teams working across branches inevitably collide — overlapping files, unclear merge order, rogue abandoned branches. The bigger the fleet, the worse the chaos.

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
- ⏱️ ~5 min (about 10x faster)
- ✅ 0 conflicts

---

## 🚀 Quick Start

### Installation

```bash
npm install -g spidersan
```

### Guided Setup (Optional)

```bash
spidersan welcome
spidersan config wizard
```

### Basic Usage

```bash
# 1. Register your branch when you start working
spidersan register --files "lib/auth.ts,api/login.ts"

# 2. Check for conflicts before you go too deep
spidersan conflicts

# 3. When done, verify you're merge-ready
spidersan ready-check

# 4. Get recommended merge order for the team
spidersan merge-order
```

---

## ✨ Features

### Core Commands

| Command | Description |
|---------|-------------|
| `spidersan init` | Initialize Spidersan in the current project |
| `spidersan register --files` | Register a branch with the files being modified |
| `spidersan list` | List all registered branches and their file ownership |
| `spidersan conflicts` | Detect file conflicts between branches (tiered: T1/T2/T3) |
| `spidersan conflicts --ecosystem` | Aggregate conflict scan across all repos in your dev folder |
| `spidersan merge-order` | Get topologically-sorted optimal merge order |
| `spidersan ready-check` | Verify branch is ready to merge (no WIP, no conflicts) |
| `spidersan depends` | Set/show branch dependencies (Supabase only) |
| `spidersan stale` | Find stale branches |
| `spidersan cleanup` | Remove stale branches from registry |
| `spidersan rescue` | Rescue mode — scan for and salvage rogue/unregistered work |
| `spidersan abandon` | Abandon a branch (mark inactive) |
| `spidersan merged` | Mark a branch merged |
| `spidersan sync` | Sync registry with actual git branches |
| `spidersan watch` | Daemon mode: watch files and auto-register |
| `spidersan doctor` | Diagnose local state and registry health |
| `spidersan config` | View/edit configuration + guided wizard |
| `spidersan auto` | Auto-watch start/stop/status (config-based) |
| `spidersan welcome` | Onboarding and quick start |
| `spidersan log` | Show branch operation history (local activity log) |
| `spidersan daily` | Show branch-relevant entries from daily collab logs |
| `spidersan rebase-helper` | Detect and guide through local git rebase states |

### 🧠 AI Commands (Gemma 4 / LM Studio)

Ask spidersan questions about your repo state — powered by a local LLM with an embedded gitops playbook.

| Command | Description |
|---------|-------------|
| `spidersan context` | Build full repo context (registry, conflicts, colony, git) |
| `spidersan ask "<question>"` | Ask a question — get actionable gitops advice with commands |
| `spidersan advise` | Get proactive recommendations based on current repo state |
| `spidersan explain <branch>` | Explain what a branch does, its risk, and next steps |
| `spidersan ai-ping` | Test LLM connectivity and latency |

```bash
# Get AI-powered advice
spidersan ask "I have 3 branches touching auth.ts — what should I do?"

# Proactive recommendations
spidersan advise

# Understand a mystery branch
spidersan explain feat/strange-refactor

# Flags
spidersan context --json --verbose --repo ~/Dev/other-repo
spidersan ask "merge strategy?" --provider copilot
```

**Features:**
- 🏠 **Local-first**: Defaults to Gemma 4 26B on LM Studio (no API key needed)
- 🔒 **Privacy**: Code context never leaves your machine unless you opt into remote providers
- 📋 **18-scenario playbook**: PHC-optimized command reference covering all spidersan workflows
- 🔧 **MCP integration**: All AI commands available as MCP tools (27 total)

### 🌐 Multi-Repo & Cloud Commands

| Command | Description |
|---------|-------------|
| `spidersan sync-advisor` | Scan all repos and recommend push/pull/cleanup actions |
| `spidersan registry-sync --push` | Push local branch registry to colony Supabase (share with fleet) |
| `spidersan registry-sync --pull` | Pull other machines' registries — see what the full fleet is working on |
| `spidersan registry-sync --status` | Show sync status across all machines |
| `spidersan cross-conflicts` | Detect file conflicts across machines via Supabase |
| `spidersan github-sync` | Fetch branch/PR/CI status from GitHub for configured repos |
| `spidersan pulse` | Sync from Colony then show active conflicts (quick health-check) |

### 👑 Queen Mode (Parallel Dispatch)

Dispatch sub-spidersans to run ground jobs across multiple repos in parallel:

```bash
# Spawn sub-spidersans for a task (generates fire-complete-dissolve scripts)
spidersan queen spawn --task "morning sync" --type sync --repos "repo1,repo2"

# Dry-run: preview scripts without emitting colony signals
spidersan queen spawn --task "conflict scan" --type conflicts --dry-run

# Monitor active sub-spidersans via the colony gradient
spidersan queen status --queen-signal-id <id>

# Manually dissolve a stuck sub-spidersan
spidersan queen dissolve <signal-id>
```

Job types: `sync` | `conflicts` | `cleanup` | `custom`

### 🔄 Task Torrenting (Branch-per-Task)

Create and manage parallel task branches with conflict-aware merge ordering:

```bash
spidersan torrent create DASH-001 --agent myagent
spidersan torrent status
spidersan torrent tree
spidersan torrent complete DASH-001
spidersan torrent merge-order
spidersan torrent decompose DASH --into "DASH-A,DASH-B,DASH-C"
```

### 📊 TUI Dashboard

Real-time 4-panel terminal UI — ecosystem overview, conflict map, activity feed, merge queue:

```bash
spidersan dashboard
```

### Watch Mode (Daemon)

Real-time file monitoring with auto-registration:

```bash
# Start watching (auto-registers file changes)
spidersan watch --agent myagent

# With Hub integration for real-time conflict warnings
spidersan watch --agent myagent --hub

# Quiet mode (only show conflicts)
spidersan watch --agent myagent --hub --quiet

# Watch only specific paths
spidersan watch --paths "src,lib" --root .
```

**Features:**
- 📁 Auto-registers files when you edit them
- ⚠️ Real-time conflict detection
- 🔌 Hub integration for team visibility
- 🕐 Debounced (1s) to prevent spam

### ⚡ Auto Watch (Background)

Run a background watcher using paths from your config:

```bash
spidersan auto start
spidersan auto status
spidersan auto stop
```

### 🤖 GitHub Actions Auto-Register

**Zero-effort branch registration via GitHub workflow**

When enabled, every push to a branch automatically:
- ✅ Registers the branch with Spidersan
- ✅ Detects changed files via git diff
- ✅ Checks for conflicts with other branches
- ✅ Reports TIER 2+ conflicts as workflow warnings
- ✅ Extracts agent name from branch prefix (e.g., `claude/feature` → `claude`)

**Setup:**
1. Workflow is already included: `.github/workflows/auto-register.yml`
2. Just push to any branch (except main/staging)
3. View results in GitHub Actions tab

**Example:**
```bash
git checkout -b yourname/new-feature
git add src/api.ts
git commit -m "feat: add new endpoint"
git push origin yourname/new-feature
# ✅ Auto-registered in ~15 seconds!
```

**Benefits:**
- No manual `spidersan register` needed
- Works across all contributors and AI agents
- Conflict warnings appear in CI checks
- Perfect for multi-agent repositories

**Note:** This complements (doesn't replace) local `spidersan watch` for real-time file monitoring.

**Installation:**
- [📖 Complete Installation Guide →](./INSTALL_AUTO_REGISTER.md)
- [🎯 Use Cases & Examples →](./AUTO_REGISTER_USE_CASES.md)
- [🤖 Claude Code Skill →](./.claude/skills/install-auto-register.md)

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
- Usage (internal; see spidersan-ecosystem repo)
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

## Support

### Fuel the Flock

Treebird is free and open source. Star our repos on GitHub or support us to keep the servers running and the agents dreaming.

❤️ Sponsor on GitHub
https://github.com/sponsors/treebird7

☕ Buy me a coffee
https://buymeacoffee.com/tree.bird

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details

---

<div align="center">

**Made with 🕷️ for AI-first development teams**

Part of the [Treebird Ecosystem](https://treebird.uk) 🌲

</div>
