---
tags: [agent/spidersan, type/guide]
---

# 🕷️ Spidersan Starter Kit

> **Quick setup guide for AI agents and developers to use Spidersan for branch coordination**

---

## What is Spidersan?

Spidersan is a **branch coordination tool** for AI coding agents. It tracks which files each agent is working on, detects conflicts before they become merge nightmares, and provides optimal merge ordering.

**The metaphor:** The spider's web doesn't catch prey — it *senses* the forest. Every strand is a nerve ending.

Note: `mcp-health` is an ecosystem-only command (requires the optional plugin).

---

## 1. Install

```bash
# Global install (recommended)
npm install -g spidersan

# Verify
spidersan --version
```

---

## 2. Initialize in Your Repo

```bash
cd your-repo
spidersan init
```

This creates `.spidersan/` with local storage.

---

## 3. Core Workflow

### Register Your Branch

```bash
# Manual registration
spidersan register --files "src/auth.ts,lib/db.ts"

# Auto-detect from git diff
spidersan register --auto

# Interactive mode
spidersan register -i
```

### Check for Conflicts

```bash
# See all conflicts
spidersan conflicts

# Filter by severity
spidersan conflicts --tier 2  # PAUSE level and above
spidersan conflicts --tier 3  # BLOCK level only

# Get JSON output
spidersan conflicts --json
```

### Get Merge Order

```bash
# Topological sort of registered branches
spidersan merge-order
```

### Verify Ready to Merge

```bash
spidersan ready-check
```

---

## 4. Conflict Tiers

Spidersan uses a **three-tier conflict system**:

| Tier | Icon | Label | Files | Action |
|------|------|-------|-------|--------|
| 🟡 1 | WARN | General files | Proceed with awareness |
| 🟠 2 | PAUSE | Config files (package.json, etc.) | Coordinate first |
| 🔴 3 | BLOCK | Security files (.env, auth.ts, etc.) | Must resolve before merge |

---

## 5. MCP Integration for AI Agents

Spidersan has an MCP server for integration with AI coding tools:

```json
{
  "mcpServers": {
    "spidersan-mcp": {
      "command": "npx",
      "args": ["-y", "proaksy", "node", "/path/to/spidersan/mcp-server/dist/index.js"],
      "env": {}
    }
  }
}
```

**MCP Tools Available:**
- `register_branch` — Register files you're working on
- `check_conflicts` — See conflicts with other agents
- `get_merge_order` — Get optimal merge sequence
- `list_branches` — See all registered branches

---

## 6. Watch Mode (Daemon)

Auto-register files as you edit:

```bash
# Start watching
spidersan watch --agent myagent

# With Hub integration for real-time updates
spidersan watch --agent myagent --hub
```

---

## 7. Quick Reference

| Command | Description |
|---------|-------------|
| `spidersan init` | Initialize in current repo |
| `spidersan register` | Register branch + files |
| `spidersan list` | List all registered branches |
| `spidersan conflicts` | Show file conflicts |
| `spidersan merge-order` | Get optimal merge order |
| `spidersan ready-check` | Verify branch is merge-ready |
| `spidersan watch` | Daemon mode, auto-register |
| `spidersan mcp-health` | Check MCP server status (ecosystem-only) |

---

## 8. Best Practices

1. **Register early** — As soon as you start working on files
2. **Check conflicts often** — Before diving deep into changes
3. **Use --tier 2 in CI** — Block merges on config file conflicts
4. **Coordinate on TIER 3** — Never force-merge security-critical files

---

## 9. Troubleshooting

**"Spidersan not initialized"**  
→ Run `spidersan init` in your repo root

**"Branch not registered"**  
→ Run `spidersan register --auto` or `spidersan register --files "..."`

**"No conflicts detected" but merge fails**  
→ Conflicts may be in unregistered files — use `--auto` to detect from git

---

## 10. Conflict alert delivery

`spidersan conflicts --notify` delivers TIER 2+ conflicts to the configured
alert room. The transport is chosen by environment, not by a flag — set
`SPIDERSAN_ROOM_TOKEN` (inject it from the envoak vault, `toak/SPIDERSAN_ROOM_TOKEN`).
With no token the alert is reported locally as `NOT NOTIFIED`, never silently dropped.

```bash
spidersan conflicts --notify
```

**Note:** `--wake` / `--retry` were removed in sp-hnjf. They woke agents via
`hub.treebird.uk`, which was retired 2026-09-05, and reported success
unconditionally. Messaging commands like `spidersan send`, `inbox`, and `read`
are ecosystem-only and require the plugin plus Myceliumail setup.

---

*Part of the Treebird Ecosystem 🌲*

*For Myceliumail setup, see: `/Dev/Myceliumail/docs/AGENT_STARTER_KIT.md`*
