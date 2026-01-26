---
tags: [project/treebird-hub, agent/myceliumail, agent/spidersan, topic/mcp]
---

# Changelog

All notable changes to Spidersan will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.1] - 2026-01-26 (Metadata Fix)

### Fixed
- **Repository URLs** - Updated package.json to point to public repo (spidersan-oss) instead of legacy private repo

## [0.4.0] - 2026-01-26 (Core Release)

This release consolidates Spidersan into a focused, professional 15-command core with an optional ecosystem plugin for advanced features.

### Added
- **Plugin Architecture** - Optional ecosystem commands loaded at runtime via `ecosystem-loader.ts`
- **Version Mismatch Detection** - Warns if ecosystem plugin is incompatible with core version
- **Type Stubs** - Support for optional ecosystem module without installation
- **Ecosystem Package** - Separate `spidersan-ecosystem` package for advanced features (locking, intent scanning, real-time monitoring, torrenting, messaging, security audit)

### Changed
- **Core Streamlined** - Reduced from 47 commands to 15 essential commands
- **Documentation Split** - Public CORE.md (15 commands) vs. advanced ECOSYSTEM.md (16 commands)
- **CLI Messaging** - Removed Pro/BSL licensing references; MIT-only across all packages
- **README Refocused** - Emphasizes core use cases (coordination, conflict resolution)
- **USAGE Examples** - Updated to match 15-command core; ecosystem features documented separately

### Removed
- **16 Ecosystem Commands** - Moved to optional `spidersan-ecosystem` plugin: lock, semantic, torrent, monitor, intent-scan, active-windows, radar, collab, collab-sync, sync-all, tension, audit-mark, send, inbox, msg-read, keygen
- **Pro Licensing** - Consolidated to MIT-only model

### Fixed
- **Abandon Command Name** - Consistency across CORE.md and CLI help
- **Register Examples** - Now reflect actual core command behavior

## [0.3.0] - 2026-01-25 (Feature Release)

This release focuses on advanced coordination infrastructure, forensic analysis, and offline-first reliability.

### Added
- **🚑 Rescue Mode** (`spidersan rescue`) - Automated scanning, triage (Merge/Salvage/Abandon), and code salvage for chaotic or abandoned repositories.
- **📺 Monitor Dashboard** (`spidersan monitor`) - Real-time terminal TUI for tracking the swarm's activity and conflict status across the team.
- **🧬 DNA-Level Security** - AST hashing in `spidersan lock` ensures agents never work on stale code by verifying the underlying logic structure hasn't changed.
- **🔄 CRDT Sync** - Ground-up rewrite of local coordination to use state-based CRDTs, allowing agents to resolve conflicts locally even without Hub connectivity.
- **🔍 Ownership Forensics** (`spidersan who-owns`) - Identifies file "owners" based on git contribution density and recent activity.
- **🧠 Semantic RLS** (`spidersan semantic`) - Deep conflict detection using the RLS Knowledge Graph (requires `@treebird/mappersan`).
- **🩺 Advanced Diagnostics** - Enhanced `spidersan doctor` with ulimit (EMFILE prevention), daemon health, and Node.js environment checks.

### Changed
- **OSS Portability**: Refactored `mappersan` from a hard file dependency to a dynamic optional import, making the CLI fully publishable and portable.
- **Persistence**: Improved Invoak/Spidersan coordination logic for better result persistence across machine boundaries.

### Security
- Added SHA-256 structural hashing for all semantic locks.
- Refactored hardcoded user paths to use cross-platform environment variables.

## [0.2.2] - 2026-01-19 (Security Release)

This release addresses several critical security vulnerabilities. Users are strongly encouraged to upgrade immediately.

### Security
- **Fixed:** Resolved a shell injection vulnerability in `conflicts.ts`. Improper sanitization of user-provided input could allow arbitrary command execution via `--wake` flag.
- **Fixed:** Implemented stricter input validation across 8 mycmail wrapper commands (send.ts, inbox.ts, msg-read.ts, keys.ts, keygen.ts, key-import.ts, collab.ts) to prevent injection attacks.
- **Fixed:** Sanitized Supabase queries to prevent potential SQL injection vulnerabilities.
- **Added:** Implemented MCP server Access Control Lists (ACLs) to restrict process control and validate watch directories.
- **Added:** Centralized security validation utilities in `src/lib/security.ts`.

### Changed
- Replaced `execSync` with `execFileSync` and `spawnSync` for safer command execution using argument arrays instead of string interpolation.
- Added input validation patterns: `VALID_AGENT_ID` (`[a-z0-9_-]{1,32}`), `VALID_BRANCH_NAME` (`[a-zA-Z0-9/_.-]{1,128}`), `VALID_MESSAGE_ID`.
- Hardened file path handling in all commands.

### Added
- **AST semantic detection** - `spidersan conflicts --semantic` for symbol-level conflict analysis using Tree-sitter
- **CRDT symbol locking** - `spidersan lock` for distributed coordination
- **GitHub Action template** for auto-registration on push

## [0.2.1] - 2025-12-30

### Added
- **Watch mode (daemon)** - Real-time file monitoring and auto-registration
  - `spidersan watch` - Start watching files in current repo
  - `--agent <id>` - Tag registrations with agent identifier
  - `--hub` - Connect to Treebird Hub for real-time conflict warnings
  - `--hub-sync` - Post conflicts to Hub chat via REST API
  - `--quiet` - Only show conflicts, not file changes
  - `--dir <path>` - Watch specific directory
  - Debounced file detection (1s) to prevent spam
  - Auto-register files to current branch on change
  - Real-time conflict detection across active branches
  - Hub integration via `conflicts:warning` socket event

### Dependencies
- Added `chokidar` for file system watching
- Added `socket.io-client` for Hub real-time connection

## [0.2.0] - 2025-12-29

### Added
- **Session lifecycle commands** - Myceliumail ecosystem integration
  - `spidersan wake` - Start session: sync registry, check conflicts, call `mycmail wake`
  - `spidersan close` - End session: show status, optionally mark stale, call `mycmail close`

## [0.2.0] - 2025-12-23

### Added
- **MCP Server** - Model Context Protocol integration for Claude Desktop
  - 7 tools: list_branches, check_conflicts, get_merge_order, register_branch, mark_merged, mark_abandoned, get_branch_info
  - Global storage at `~/.spidersan/registry.json`
- **Update check notifications** - CLI checks npm for newer versions
  - Shows banner when update available
  - 24-hour cache, non-blocking

### Changed
- MCP server uses global storage (works without git context)
- `register_branch` accepts explicit branch name (no git auto-detect required)

## [0.1.0] - 2025-12-15

### Added
- Initial project structure
- Branch registration and conflict detection
- Merge order recommendations
- Local JSON storage
