# Treebird Ecosystem Context

> Reference document for agents working on Watsan

## Ecosystem Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    TREEBIRD ECOSYSTEM                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────┐     ┌─────────────┐     ┌──────────┐         │
│   │ Watsan  │────▶│ Myceliumail │◀────│ Watson   │         │
│   │ (wsan)  │     │   (mycm)    │     │ (wson)   │         │
│   │ Brain   │     │  Messaging  │     │ Desktop  │         │
│   └────┬────┘     └──────┬──────┘     └──────────┘         │
│        │                 │                                  │
│        │                 │                                  │
│   ┌────▼────┐     ┌──────▼──────┐     ┌──────────┐         │
│   │Spidersan│     │  Mappersan  │     │ Future   │         │
│   │ (ssan)  │     │   (maps)    │     │ Agents   │         │
│   │ Branches│     │  Analysis   │     │   ...    │         │
│   └─────────┘     └─────────────┘     └──────────┘         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Agent Identities

| Agent | Abbrev | Platform | Purpose | Public Key |
|-------|--------|----------|---------|------------|
| Watsan | `wsan` | Claude Code | Orchestrator/brain | TBD (from `mycmail keygen`) |
| Spidersan | `ssan` | CLI | Branch coordination | `AJiuvd49I8uY819nnIZE4DoIugVnD/lA/2xksH5JtVo=` |
| Myceliumail | `mycm` | CLI/MCP | Messaging | Varies |
| Watson | `wson` | Claude Desktop | General agent | `x8Thogt9p0Jle+xGteaOy9ATkwdxoBfFIYM5ZsXWymE=` |
| Treebird | `treebird` | Human | Ecosystem owner | - |

## Shared Configuration

All Treebird tools use:
- **Config directory**: `~/.treebird/`
- **Keys**: `~/.treebird/keys/` (NaCl keypairs)
- **Agent ID env var**: `MYCELIUMAIL_AGENT_ID`

## Communication Protocol

### Sending Messages
```bash
mycmail send <recipient> "<subject>" --message "<body>"
mycmail send <recipient> "<subject>" --encrypt  # Encrypted
```

### Status Updates (Agent → Watsan)
```bash
# Task completed
mycmail send wsan "TASK_DONE" --message '{"task_id": "...", "result": "..."}'

# Question/junction
mycmail send wsan "JUNCTION" --message '{"task_id": "...", "question": "...", "options": [...]}'

# Blocked
mycmail send wsan "BLOCKED" --message '{"task_id": "...", "reason": "..."}'
```

### Receiving Tasks (Watsan → Agent)
```bash
mycmail inbox  # Check for new tasks
mycmail read <id>  # Read task details
```

## Supabase Configuration

All tools share the same Supabase project:

```bash
SUPABASE_URL=https://[project].supabase.co
SUPABASE_KEY=[anon-key]
```

### Schema Namespaces
- `spidersan.*` - Branch registry and messaging (legacy)
- `myceliumail.*` - Current messaging tables
- `watsan.*` - Orchestrator state (new)

## Git Conventions

### Branch Naming
```
feature/<tool>-<feature>
fix/<tool>-<issue>
refactor/<tool>-<area>
```

### Commit Messages
```
feat(watsan): add task scheduling
fix(mycmail): resolve push notification delay
docs(ssan): update CLAUDE.md
```

## Key Files per Repo

| Repo | Key Files |
|------|-----------|
| Spidersan | `CLAUDE.md`, `src/commands/*.ts`, `src/storage/` |
| Myceliumail | `CLAUDE.md`, `src/commands/*.ts`, `src/storage/` |
| Watsan | `CLAUDE.md`, `src/commands/*.ts`, `src/core/` |

## Lessons Learned (Apply to Watsan)

1. **Idempotent migrations**: Always use `IF NOT EXISTS` / `IF EXISTS`
2. **Storage factory pattern**: Use `await getStorage()` not direct instantiation
3. **One feature = one branch**: Keep changes focused
4. **Test locally before push**: Especially migrations
5. **macOS case sensitivity**: Be careful with file casing in git

## Quick Reference

### Check Ecosystem Status
```bash
spidersan list          # Active branches
spidersan conflicts     # Any conflicts?
mycmail inbox           # Pending messages
watsan status           # Overall state (when built)
```

### Send Ecosystem-Wide Update
```bash
mycmail broadcast "Update message here"
```

### Import Agent Keys
```bash
mycmail key-import ssan AJiuvd49I8uY819nnIZE4DoIugVnD/lA/2xksH5JtVo=
mycmail key-import wson x8Thogt9p0Jle+xGteaOy9ATkwdxoBfFIYM5ZsXWymE=
```
