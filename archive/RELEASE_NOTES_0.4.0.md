# Spidersan 0.4.0 — Professional Core Release

**Release Date:** January 26, 2026

## What's New

Spidersan 0.4.0 consolidates into a focused, professional **11-command core** with an optional plugin system for advanced features. This release addresses community feedback on licensing clarity, feature scope, and professional positioning.

### 🎯 Core Focus

**11 Essential Commands** (reduced from 47):
- `list` — List all registered branches and their file ownership
- `register --files` — Register a branch with the files being modified
- `conflicts` — Show file conflicts between your branch and others
- `merge-order` — Get topologically-sorted optimal merge order
- `ready-check` — Verify branch is ready to merge (no WIP, no conflicts)
- `watch --hub` — Daemon mode: watch files and auto-register with Hub sync
- `who-touched <file>` — Show git history + agent activity for specific files
- `rescue` — Start rescue mission for abandoned branch cleanup
- `scan --all` — Scan and categorize all branches in the repo
- `triage` — Categorize branches: MERGE / SALVAGE / ABANDON
- `salvage <branch>` — Extract good code from broken branches

**What This Means:**
- Simple, focused CLI for coordination & conflict resolution
- Professional tooling for multi-agent development
- Offline-first design (works without cloud)
- Optional Supabase for cloud sync

### 🔌 Optional Ecosystem Plugin

**16 Advanced Commands** (now optional):
- `lock` — CRDT-based symbol locking
- `semantic` — Deep semantic conflict detection
- `torrent` — Peer-to-peer code distribution
- `intent-scan` — Intent-aware refactoring detection
- `active-windows` — Real-time agent activity tracking
- `radar` — Swarm visualization & metrics
- `collab` — Hub-based collaboration
- `collab-sync` — Persistent sync state management
- `sync-all` — Batch synchronization
- `tension` — Conflict heat mapping
- `audit-mark` — Advanced audit trails
- `send` — Message passing infrastructure
- `inbox` — Persistent message queue
- `msg-read` — Message verification
- `monitor` — Enhanced monitoring (ecosystem version)
- `keygen` — Expanded key management

Install separately when needed:
```bash
npm install spidersan-ecosystem
```

Advanced features will be available as optional plugin (coming soon).

### 📋 What's Changed

- **Licensing:** MIT-only model (removed BSL-1.1 complexity)
- **Documentation:** Split into public (CORE.md) and advanced (ecosystem docs, internal)
- **Architecture:** Plugin-based loading with graceful fallback
- **CLI:** Shows only core commands by default; ecosystem loads transparently if installed
- **Examples:** Updated to reflect core-only usage patterns

### 🛠️ Technical Details

**Plugin Architecture:**
- Ecosystem commands loaded dynamically at startup
- Version mismatch detection (warns, doesn't block)
- Graceful fallback if ecosystem not installed
- Mirrors VS Code extensions pattern

**Compatibility:**
- No breaking changes to existing APIs
- Core works standalone (no ecosystem dependency)
- Ecosystem requires `spidersan@^0.4.0`

### 📦 Installation

```bash
# Core only (recommended for most users)
npm install spidersan

# With ecosystem (advanced use cases)
npm install spidersan spidersan-ecosystem
```

### 🚀 Getting Started

```bash
# Initialize coordination
spidersan register --branch main

# Check for conflicts
spidersan conflicts

# Merge cleanly
spidersan merge --from feature-branch

# Monitor status
spidersan monitor
```

### 📚 Documentation

- **[CORE.md](https://github.com/treebird7/spidersan-oss/docs/CORE.md)** — Core command reference & tutorials
- **USAGE.md** — Practical workflows (internal)
- **[CLI Help](https://github.com/treebird7/spidersan-oss#quick-start)** — Built-in `spidersan --help`

Advanced features documented separately when ecosystem is released.

### 🔄 Upgrade Path

**From 0.3.x:**
```bash
npm install spidersan@latest
```

All core commands are backward compatible. Ecosystem features from 0.3.x (lock, semantic, monitoring enhancements) will be available via optional plugin.

### 🎓 Why This Design?

Community feedback highlighted:
- **Licensing confusion** — MIT-only eliminates complexity
- **Feature bloat** — 15 focused commands > 47 scattered features
- **Professional positioning** — Clear separation of core vs. advanced

This release delivers a **professional coordination tool** that's simple, reliable, and focused on what matters: branch coordination for AI agents.

### 📝 Credits

Built with Haiku (architecture), Codex (implementation), and Big Pickle (quality assurance).

### 🔗 Links

- **GitHub:** https://github.com/treebird7/spidersan-oss
- **npm:** https://www.npmjs.com/package/spidersan
- **Issues:** https://github.com/treebird7/spidersan-oss/issues
- **Discussions:** https://github.com/treebird7/spidersan-oss/discussions

---

**Thank you for using Spidersan.** 🕷️
