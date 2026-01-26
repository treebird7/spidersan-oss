# Spidersan 0.4.0 — Professional Core Release

**Release Date:** January 26, 2026

## What's New

Spidersan 0.4.0 consolidates into a focused, professional **15-command core** with an optional plugin system for advanced features. This release addresses community feedback on licensing clarity, feature scope, and professional positioning.

### 🎯 Core Focus

**15 Essential Commands** (reduced from 47):
- `register` — Register agents & branches
- `merge` — Merge conflict-free branches  
- `conflicts` — Detect & resolve conflicts
- `depends` — Declare & verify dependencies (optional Supabase sync)
- `abandon` — Mark branches as abandoned
- `doctor` — Health check & diagnostics
- `rescue` — Triage & recover chaotic repositories
- `monitor` — Real-time status monitoring
- `lifecycle` — Branch lifecycle tracking
- `audit` — Security & integrity audits
- `sync` — Local/cloud synchronization
- `repair` — Recover from corruption
- `debug` — Detailed diagnostics
- `keygen` — Generate coordination tokens
- `help` — Built-in documentation

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
- **Documentation:** Split into public (CORE.md) and advanced (ECOSYSTEM.md)
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

- **[CORE.md](https://github.com/treebird7/spidersan/docs/CORE.md)** — Core command reference & tutorials
- **[USAGE.md](https://github.com/treebird7/spidersan/USAGE.md)** — Practical workflows
- **[CLI Help](https://github.com/treebird7/spidersan#quick-start)** — Built-in `spidersan --help`

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

- **GitHub:** https://github.com/treebird7/spidersan
- **npm:** https://www.npmjs.com/package/spidersan
- **Issues:** https://github.com/treebird7/spidersan/issues
- **Discussions:** https://github.com/treebird7/spidersan/discussions

---

**Thank you for using Spidersan.** 🕷️
