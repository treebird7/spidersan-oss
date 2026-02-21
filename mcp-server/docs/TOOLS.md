# Spidersan MCP Tools Reference

This document describes all 22 tools exposed by the Spidersan MCP server.

## Tool Index

| Category | Tool | Description |
| --- | --- | --- |
| Coordination | `welcome` | Onboarding ritual with optional demo |
| Coordination | `list_tools` | List available MCP tools with version info |
| Coordination | `list_branches` | List registered branches (filter by status) |
| Branch Management | `register_branch` | Register a branch with the files you are editing |
| Branch Management | `mark_merged` | Mark a branch as merged |
| Branch Management | `mark_abandoned` | Mark a branch as abandoned |
| Branch Management | `get_branch_info` | Get detailed info about a registered branch |
| Conflict Detection | `check_conflicts` | Detect file conflicts between active branches |
| Conflict Detection | `ready_check` | Validate if a branch is safe to merge |
| Conflict Detection | `branch_status` | Get detailed status for branches, staleness, and conflicts |
| Resolution | `request_resolution` | Claim a conflict for resolution and return context |
| Resolution | `release_resolution` | Release a conflict claim early |
| Resolution | `get_merge_order` | Recommend a safe merge sequence |
| File Locking | `lock_files` | Lock files to prevent concurrent edits |
| File Locking | `unlock_files` | Release file locks |
| File Locking | `who_owns` | Query who owns or has locked files |
| File Locking | `intent_scan` | Scan for potential conflicts before starting work |
| Git Operations | `git_merge` | Merge a branch into a target with safety checks |
| Git Operations | `git_commit_and_push` | Stage, commit, and push changes |
| Git Operations | `create_pr` | Create a GitHub pull request |
| Watching | `start_watch` | Start the background file watcher |
| Watching | `stop_watch` | Stop the background file watcher |

## Quick Start

1) Install and build the server:

```bash
cd Spidersan/mcp-server
npm install
npm run build
```

2) Add an MCP server entry (Claude Desktop / Cursor MCP config):

```json
{
  "mcpServers": {
    "spidersan": {
      "command": "node",
      "args": ["/absolute/path/to/Spidersan/mcp-server/dist/server.js"]
    }
  }
}
```

3) Verify connectivity using MCP JSON-RPC:

```json
{"jsonrpc":"2.0","id":1,"method":"tools/list"}
```

## Tool Reference

### welcome

Welcome ritual for new agents with an optional demo.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "demo": {
      "type": "boolean",
      "description": "Run interactive demo showing conflict detection"
    }
  }
}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"welcome","arguments":{"demo":false}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"Welcome to the web..."}]}}
```

Error cases:
- None (always returns onboarding text; demo mode registers a temporary branch).

### list_tools

List all available Spidersan MCP tools with version info.

Input schema:
```json
{}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_tools","arguments":{}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"Spidersan MCP Server v1.2.3..."}]}}
```

Error cases:
- None (returns tool list text).

### list_branches

List registered branches by status.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": ["all", "active", "completed", "merged", "abandoned"],
      "description": "Filter by status (default: active). 'merged' is an alias for 'completed'."
    }
  }
}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_branches","arguments":{"status":"active"}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"Branches (2 active): ..."}]}}
```

Error cases:
- Returns a "No branches registered" message when registry is empty.

### register_branch

Register a branch with the files you are modifying.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "branch": { "type": "string", "description": "Branch name to register" },
    "files": { "type": "array", "items": { "type": "string" }, "description": "Files being modified" },
    "description": { "type": "string", "description": "Brief description of changes" },
    "agent": { "type": "string", "description": "Agent identifier" },
    "repo": { "type": "string", "description": "Repository name (context)" }
  },
  "required": ["branch", "files"]
}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"register_branch","arguments":{"branch":"feat/mcp-docs","files":["docs/TOOLS.md"],"description":"Add MCP tool docs","agent":"codex","repo":"spidersan"}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":"Registered branch: feat/mcp-docs"}]}}
```

Error cases:
- None (creates or updates the branch entry).

### mark_merged

Mark a branch as merged (completed).

Input schema:
```json
{
  "type": "object",
  "properties": {
    "branch": { "type": "string", "description": "Branch name (default: current branch)" }
  }
}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"mark_merged","arguments":{"branch":"feat/mcp-docs"}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":5,"result":{"content":[{"type":"text","text":"Marked as merged: feat/mcp-docs"}]}}
```

Error cases:
- No registry found for this repo.
- Branch not found.
- Current branch cannot be determined.

### mark_abandoned

Mark a branch as abandoned.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "branch": { "type": "string", "description": "Branch name (default: current branch)" }
  }
}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"mark_abandoned","arguments":{"branch":"feat/mcp-docs"}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":6,"result":{"content":[{"type":"text","text":"Marked as abandoned: feat/mcp-docs"}]}}
```

Error cases:
- No registry found for this repo.
- Branch not found.
- Current branch cannot be determined.

### get_branch_info

Get detailed info about a specific branch.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "branch": { "type": "string", "description": "Branch name (default: current branch)" }
  }
}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"get_branch_info","arguments":{"branch":"feat/mcp-docs"}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":7,"result":{"content":[{"type":"text","text":"Branch: feat/mcp-docs\\nStatus: active..."}]}}
```

Error cases:
- No branches registered for this repo.
- Branch not registered.
- Current branch cannot be determined.

### check_conflicts

Check for file conflicts between active branches.

Input schema:
```json
{}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"check_conflicts","arguments":{}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":8,"result":{"content":[{"type":"text","text":"No file conflicts detected"}]}}
```

Error cases:
- None (returns a no-conflicts message if registry is empty).

### ready_check

Validate if a branch is safe to merge. Returns pass/fail and reasons as JSON text.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "branch": { "type": "string", "description": "Branch name to check" },
    "target": { "type": "string", "description": "Target branch (default: main)" }
  },
  "required": ["branch"]
}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string (JSON encoded)" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"ready_check","arguments":{"branch":"feat/mcp-docs","target":"main"}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":9,"result":{"content":[{"type":"text","text":"{\"success\":true,\"ready\":true}"}]}}
```

Error cases:
- CLI execution failure (returns `{ "success": false, "error": "..." }` as text).

### branch_status

Get detailed status of branches, including staleness and conflict tiers.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "repo": { "type": "string", "description": "Repository path (default: current directory)" },
    "includeStale": { "type": "boolean", "description": "Include stale branches (>7 days inactive)" }
  }
}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string (JSON encoded)" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"branch_status","arguments":{"includeStale":false}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":10,"result":{"content":[{"type":"text","text":"{\"count\":1,\"branches\":[...]}"}]}}
```

Error cases:
- Repository path not found.
- CLI failure (returns `{ "success": false, "error": "..." }` as text).

### request_resolution

Claim a conflict for resolution and return conflict context.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "branch": { "type": "string", "description": "Branch with conflicts to resolve" },
    "target": { "type": "string", "description": "Target branch (default: main)" },
    "agent": { "type": "string", "description": "Agent claiming the resolution" },
    "tier": { "type": "number", "description": "Conflict tier to resolve (1, 2, or 3)" }
  },
  "required": ["branch", "agent"]
}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string (JSON encoded)" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"request_resolution","arguments":{"branch":"feat/mcp-docs","agent":"codex","tier":2}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":11,"result":{"content":[{"type":"text","text":"{\"success\":true,\"claimedBy\":\"codex\",\"conflicts\":[]}"}]}}
```

Error cases:
- Conflict already claimed (returns `success: false`).
- CLI failure for conflict scan.

### release_resolution

Release a conflict claim early.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "branch": { "type": "string", "description": "Branch with conflicts to resolve" },
    "target": { "type": "string", "description": "Target branch (default: main)" },
    "agent": { "type": "string", "description": "Agent releasing the claim" }
  },
  "required": ["branch", "agent"]
}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string (JSON encoded)" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"release_resolution","arguments":{"branch":"feat/mcp-docs","agent":"codex"}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":12,"result":{"content":[{"type":"text","text":"{\"released\":true}"}]}}
```

Error cases:
- Not claimed by this agent (returns `{ "released": false, "error": "Not claimed by this agent" }`).

### get_merge_order

Get recommended merge order based on dependencies.

Input schema:
```json
{}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"get_merge_order","arguments":{}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":13,"result":{"content":[{"type":"text","text":"Recommended merge order:\\n1. feat/mcp-docs"}]}}
```

Error cases:
- No active branches (returns informational text).

### lock_files

Lock files to prevent concurrent edits.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "files": { "type": "array", "items": { "type": "string" }, "description": "File paths to lock" },
    "agent": { "type": "string", "description": "Agent requesting lock" },
    "reason": { "type": "string", "description": "Reason for locking" },
    "ttl": { "type": "number", "description": "Lock timeout in minutes (default: 30)" }
  },
  "required": ["files", "agent"]
}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string (JSON encoded)" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"lock_files","arguments":{"files":["docs/TOOLS.md"],"agent":"codex","reason":"Writing tool docs","ttl":30}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":14,"result":{"content":[{"type":"text","text":"{\"success\":true,\"lockToken\":\"...\",\"files\":1}"}]}}
```

Error cases:
- Files already locked by another agent (returns `success: false` with conflicts).

### unlock_files

Release file locks.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "files": { "type": "array", "items": { "type": "string" }, "description": "Files to unlock (optional)" },
    "agent": { "type": "string", "description": "Agent releasing lock" },
    "token": { "type": "string", "description": "Lock token" },
    "force": { "type": "boolean", "description": "Force unlock (admin only)" }
  }
}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string (JSON encoded)" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":15,"method":"tools/call","params":{"name":"unlock_files","arguments":{"files":["docs/TOOLS.md"],"agent":"codex"}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":15,"result":{"content":[{"type":"text","text":"{\"success\":true,\"released\":1,\"remaining\":0}"}]}}
```

Error cases:
- None (returns success with released count even when no locks exist).

### who_owns

Query who owns, locks, or is working on specific files.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "files": { "type": "array", "items": { "type": "string" }, "description": "File paths to query" },
    "pattern": { "type": "string", "description": "Glob pattern to match files" }
  }
}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string (JSON encoded)" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":16,"method":"tools/call","params":{"name":"who_owns","arguments":{"files":["docs/TOOLS.md"]}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":16,"result":{"content":[{"type":"text","text":"{\"queried\":1,\"results\":[...]}"}]}}
```

Error cases:
- None (returns empty results if no owners or locks).

### intent_scan

Scan for potential conflicts before starting work.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "files": { "type": "array", "items": { "type": "string" }, "description": "Files you intend to modify" },
    "agent": { "type": "string", "description": "Agent planning the work" },
    "taskId": { "type": "string", "description": "Optional task ID" }
  },
  "required": ["files", "agent"]
}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string (JSON encoded)" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":17,"method":"tools/call","params":{"name":"intent_scan","arguments":{"files":["docs/TOOLS.md"],"agent":"codex","taskId":"wave4-mcp-docs-001"}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":17,"result":{"content":[{"type":"text","text":"{\"safe\":true,\"fileCount\":1,\"conflicts\":[],\"locks\":[]}"}]}}
```

Error cases:
- None (returns a safe/conflict summary).

### git_merge

Merge a branch into target with safety checks.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "source": { "type": "string", "description": "Source branch to merge" },
    "target": { "type": "string", "description": "Target branch (default: main)" },
    "strategy": { "type": "string", "enum": ["merge", "squash", "rebase"], "description": "Merge strategy (default: merge)" },
    "dryRun": { "type": "boolean", "description": "Preview merge without executing" }
  },
  "required": ["source"]
}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string (JSON encoded)" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":18,"method":"tools/call","params":{"name":"git_merge","arguments":{"source":"feat/mcp-docs","target":"main","strategy":"merge","dryRun":true}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":18,"result":{"content":[{"type":"text","text":"{\"dryRun\":true,\"wouldMerge\":{\"source\":\"feat/mcp-docs\",\"target\":\"main\"}}"}]}}
```

Error cases:
- Invalid branch names (returns error message).
- TIER 3 conflicts detected (merge blocked).
- Ready-check fails (returns reasons).
- Git operations fail (checkout/merge errors).

### git_commit_and_push

Stage, commit, and push changes.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "files": { "type": "array", "items": { "type": "string" }, "description": "Files to stage (default: all)" },
    "message": { "type": "string", "description": "Commit message (auto-generated if omitted)" },
    "branch": { "type": "string", "description": "Branch to push (default: current)" },
    "autoMessage": { "type": "boolean", "description": "Generate commit message from diff" }
  }
}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string (JSON encoded)" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":19,"method":"tools/call","params":{"name":"git_commit_and_push","arguments":{"files":["docs/TOOLS.md"],"message":"docs: add MCP tool reference","branch":"feat/mcp-docs","autoMessage":false}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":19,"result":{"content":[{"type":"text","text":"{\"success\":true,\"branch\":\"feat/mcp-docs\",\"pushed\":true}"}]}}
```

Error cases:
- Ready-check fails (returns reasons).
- Git add/commit/push errors.
- Invalid branch name.

### create_pr

Create a GitHub pull request with optional auto-generated title/description.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "branch": { "type": "string", "description": "Source branch (default: current)" },
    "target": { "type": "string", "description": "Target branch (default: main)" },
    "title": { "type": "string", "description": "PR title (auto-generated if omitted)" },
    "description": { "type": "string", "description": "PR description (auto-generated if omitted)" },
    "reviewers": { "type": "array", "items": { "type": "string" }, "description": "GitHub reviewers" },
    "draft": { "type": "boolean", "description": "Create as draft" }
  }
}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string (JSON encoded)" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":20,"method":"tools/call","params":{"name":"create_pr","arguments":{"branch":"feat/mcp-docs","target":"main","title":"docs: MCP tool reference","draft":true}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":20,"result":{"content":[{"type":"text","text":"{\"success\":true,\"url\":\"https://github.com/...\"}"}]}}
```

Error cases:
- Invalid branch names.
- TIER 3 conflicts detected.
- Ready-check fails.
- GitHub CLI failure.

### get_merge_order

Get recommended merge order based on dependencies.

Input schema:
```json
{}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":21,"method":"tools/call","params":{"name":"get_merge_order","arguments":{}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":21,"result":{"content":[{"type":"text","text":"Recommended merge order:\\n1. feat/mcp-docs"}]}}
```

Error cases:
- No active branches to merge.

### start_watch

Start watching files and auto-registering changes in the background.

Input schema:
```json
{
  "type": "object",
  "properties": {
    "agent": { "type": "string", "description": "Agent identifier for registrations" },
    "dir": { "type": "string", "description": "Directory to watch (default: current repo)" },
    "hub": { "type": "boolean", "description": "Connect to Hub for real-time conflict warnings" },
    "quiet": { "type": "boolean", "description": "Only show conflicts, not file changes" }
  }
}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":22,"method":"tools/call","params":{"name":"start_watch","arguments":{"agent":"codex","dir":".","hub":true,"quiet":false}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":22,"result":{"content":[{"type":"text","text":"Watch mode started (PID: 12345)..."}]}}
```

Error cases:
- Invalid directory (validation error).

### stop_watch

Stop the background file watcher.

Input schema:
```json
{}
```

Output schema:
```json
{
  "content": [
    { "type": "text", "text": "string" }
  ]
}
```

Example request:
```json
{"jsonrpc":"2.0","id":23,"method":"tools/call","params":{"name":"stop_watch","arguments":{}}}
```

Example response:
```json
{"jsonrpc":"2.0","id":23,"result":{"content":[{"type":"text","text":"Watch mode stopped."}]}}
```

Error cases:
- No watch process found (returns a warning text).
