# Spidersan MCP Server

MCP Server for Spidersan - Branch coordination for AI coding agents.

## 🕷️ Pro Feature

This MCP server requires a Pro license. Activate with:

```bash
spidersan activate <license-key>
```

Get a license at: [spidersan.dev/pro](https://spidersan.dev/pro)

## Installation

```bash
cd mcp-server
npm install
npm run build
```

## Claude Desktop Configuration

Add to `~/.cursor/mcp.json` or Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "spidersan": {
      "command": "node",
      "args": ["/path/to/Spidersan/mcp-server/dist/server.js"]
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `list_branches` | List all registered branches (filter by status) |
| `check_conflicts` | Check for file conflicts between active branches |
| `get_merge_order` | Get recommended merge order based on dependencies |
| `register_branch` | Register files you're modifying on current branch |
| `mark_merged` | Mark a branch as merged |
| `mark_abandoned` | Mark a branch as abandoned |
| `get_branch_info` | Get detailed info about a branch |

## Example Usage

**Check for conflicts before starting work:**
```
Use check_conflicts to see if any other agents are working on the same files
```

**Register your branch:**
```
Use register_branch with files ["src/index.ts", "src/lib/utils.ts"] and description "Adding utility functions"
```

**Get merge order:**
```
Use get_merge_order to see the recommended order for merging branches
```
