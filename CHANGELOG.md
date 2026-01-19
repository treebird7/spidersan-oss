---
tags: [project/treebird-hub, agent/myceliumail, agent/spidersan, topic/mcp]
---

# Changelog

All notable changes to Spidersan will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- **Pro license system** - Ed25519-based cryptographic licensing
  - `spidersan activate <key>` - Activate Pro license
  - `spidersan status` - Check license and branch status
  - 5-branch limit for free tier
  - Unlimited branches for Pro users
- **MCP Server** - Model Context Protocol integration for Claude Desktop
  - 7 tools: list_branches, check_conflicts, get_merge_order, register_branch, mark_merged, mark_abandoned, get_branch_info
  - Pro license required
  - Global storage at `~/.spidersan/registry.json`
- **Update check notifications** - CLI checks npm for newer versions
  - Shows banner when update available
  - 24-hour cache, non-blocking
- **Pro READMEs** - Updated docs with pricing ($9/mo) and features
  - Free vs Pro comparison table
  - Feedback & support section
  - Contact: treebird7@proton.me

### Changed
- MCP server uses global storage (works without git context)
- `register_branch` accepts explicit branch name (no git auto-detect required)

## [0.1.0] - 2025-12-15

### Added
- Initial project structure
- Branch registration and conflict detection
- Merge order recommendations
- Local JSON storage
