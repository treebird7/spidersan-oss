# Changelog

All notable changes to Spidersan will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
