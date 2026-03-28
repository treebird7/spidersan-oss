# Spidersan — Status Flags

> **Aligned with:** 2026-01-15-VISION.md  
> **Last Updated:** 2026-03-28

---

## Product Maturity Tracking

Every product in the Treebird ecosystem should track these status flags.

---

## Current Status

| Flag | Status | Details |
|------|--------|---------|
| **E2E Tested** | ✅ Yes | CI runs tests, build verified locally |
| **User Reviewed** | ✅ In Use | Treebird uses for daily coordination |
| **Documentation** | ✅ Complete | README, STARTER_KIT (public); Lessons Learned (internal) |
| **Clarity** | ✅ Good | Clear CLI, tiered conflict system |
| **Published** | ✅ npm | `npm install -g spidersan` |

---

## Component Breakdown

### CLI Commands

Note: `mcp-health` and `pulse` are ecosystem-only commands.

| Command | Tested | Documented | Notes |
|---------|--------|------------|-------|
| `init` | ✅ | ✅ | Creates .spidersan/ |
| `register` | ✅ | ✅ | --auto, --interactive modes |
| `list` | ✅ | ✅ | Lists all branches |
| `conflicts` | ✅ | ✅ | Tiered system, --wake, --auto |
| `merge-order` | ✅ | ✅ | Topological sort |
| `ready-check` | ✅ | ✅ | Pre-merge verification |
| `depends` | ✅ | ✅ | Set/show branch dependencies |
| `stale` | ✅ | ✅ | Show branches not updated recently |
| `cleanup` | ✅ | ✅ | Remove stale branches from registry |
| `rescue` | ✅ | ✅ | Scan and salvage rogue/orphaned work |
| `abandon` | ✅ | ✅ | Mark branch as abandoned |
| `merged` | ✅ | ✅ | Mark branch as merged |
| `sync` | ✅ | ✅ | Sync registry with actual git branches |
| `watch` | 🟡 | ✅ | Daemon mode, needs more testing |
| `auto` | ✅ | ✅ | Auto-watch shortcuts (start/stop) |
| `welcome` | ✅ | ✅ | Onboarding ritual for new agents |
| `config` | ✅ | ✅ | View and edit Spidersan config |
| `registry-sync` | ✅ | ✅ | Sync registry to/from Supabase (cross-machine) |
| `cross-conflicts` | ✅ | ✅ | Detect conflicts across machines via Supabase |
| `mcp-health` | ✅ | ✅ | MCP server status |
| `pulse` | ✅ | ✅ | Colony sync + conflict health check |
| `doctor` | ✅ | ✅ | Diagnose common Spidersan issues |

### MCP Server

| Component | Status | Notes |
|-----------|--------|-------|
| Build | ✅ | TypeScript compiles |
| Tools | ✅ | All tools functional |
| prOaksy | ✅ | Proxied through proaksy |
| Integration | ✅ | Works with Antigravity |

### CI/CD

| Pipeline | Status | Notes |
|----------|--------|-------|
| Build | ✅ | Runs on push |
| Test | ✅ | Mandatory, fails build if tests fail |
| Lint | 🟡 | Optional, doesn't block |
| Migrations | 🟡 | Needs verification |

---

## Verification History

| Date | Action | Result |
|------|--------|--------|
| 2026-01-15 | Full maintenance sweep | ✅ All tests passing |
| 2026-01-16 | CI enforcement added | ✅ Tests now mandatory |
| 2026-01-16 | --auto mode fixed | ✅ Confirmations skippable |
| 2026-03-26 | registry-sync --push/--pull/--status verified live | ✅ Supabase RLS fix shipped |
| 2026-03-26 | auto-register.yml wired with COLONY_SUPABASE_URL/KEY | ✅ CI secrets confirmed |
| 2026-03-28 | Docs audit — STATUS_FLAGS updated with 13 missing commands | ✅ Table now complete |

---

## Action Items

- [ ] Verify migrations workflow works with current Supabase
- [ ] Add more E2E tests for watch mode
- [ ] Test MCP integration with other AI tools

---

*This file tracks compliance with the Vision document's status flag requirements.*
