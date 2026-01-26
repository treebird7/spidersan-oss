# Spidersan: Branch Coordination for AI Agents

> "The web doesn't just connect — it coordinates."

## 1. Overview

Spidersan Core is a lightweight MIT CLI for branch coordination across AI coding sessions. It helps you register what you're changing, detect conflicts early, and get a recommended merge order. An optional ecosystem plugin adds advanced coordination tools for internal teams.

**Core capabilities:**
- File-level conflict detection (tiered)
- Branch registration and dependency hints
- Merge readiness checks
- Watch mode auto-registration
- Cleanup and rescue tools
- Local-first storage with optional Supabase

## 2. Quick Start (Core)

```bash
spidersan init
spidersan register --files "src/app.ts,README.md" --description "Adding feature X"
spidersan conflicts
spidersan ready-check
spidersan merge-order
spidersan merged --pr 123
```

## 3. Core Commands

### Initialization

```bash
spidersan init
```

Creates `.spidersan/` with local registry data.

### Registration & Visibility

```bash
spidersan register --files "file1.ts,file2.ts"
spidersan register --auto
spidersan register --interactive
spidersan list
```

### Conflict Detection

```bash
spidersan conflicts
spidersan conflicts --tier 2
spidersan conflicts --strict
spidersan conflicts --notify
spidersan conflicts --wake
```

Conflict tiers:
- Tier 1: warn
- Tier 2: pause
- Tier 3: block

### Dependencies (Supabase Optional)

```bash
spidersan depends feature/auth feature/oauth
spidersan depends --branch feature/auth
spidersan depends --clear
```

Dependency tracking requires Supabase (`SUPABASE_URL` + `SUPABASE_KEY`). Local storage will show a hint.

### Readiness & Merge Order

```bash
spidersan ready-check
spidersan merge-order
```

`merge-order` is a heuristic: use it for visibility, not as a guarantee.

### Branch Lifecycle

```bash
spidersan stale --days 14
spidersan cleanup --days 14
spidersan rescue --scan
spidersan rescue --salvage path/to/file.ts
spidersan rescue --abandon path/to/file.ts
spidersan abandon
spidersan merged --pr 123
spidersan sync
```

### Watch Mode

```bash
spidersan watch
spidersan watch --agent myagent
spidersan watch --hub
spidersan watch --hub-sync
```

### Diagnostics

```bash
spidersan doctor
```

## 4. Configuration

Spidersan loads optional config from `.spidersanrc` or `.spidersanrc.json` in your repo. Invalid JSON falls back to defaults.

## 5. Ecosystem Plugin (Optional)

Advanced features live in the optional `spidersan-ecosystem` plugin (internal for now). When installed, the core CLI loads it automatically.

**Ecosystem commands include:**
- Monitoring and coordination: `monitor`, `radar`, `collab`, `collab-sync`
- Semantic tools: `lock`, `semantic`, `intent-scan`, `active-windows`
- Messaging: `send`, `inbox`, `msg-read`, `keygen`, `key-import`, `keys`
- Task distribution: `torrent`, `sync-all`
- Security + MCP: `tension`, `audit-mark`, `mcp-health`, `mcp-restart`

If you need access, use the internal repo at `treebird-internal/spidersan-ecosystem`.
