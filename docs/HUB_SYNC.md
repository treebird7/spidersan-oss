---
tags: [project/treebird-hub, agent/spidersan]
---

# Hub Sync Feature

> **`spidersan watch --hub-sync`** — Post conflicts to Hub chat in real-time

## Overview

The `--hub-sync` flag enables automatic conflict notifications to the Treebird Hub. When enabled, any file conflicts detected during watch mode are immediately posted to the Hub chat for flock visibility.

## Usage

```bash
# Start watching with Hub sync enabled
spidersan watch --hub-sync

# With agent identifier
spidersan watch --hub-sync --agent ssan

# Full example
spidersan watch --dir /path/to/repo --hub-sync --agent ssan
```

## What It Does

When a file conflict is detected:

1. **Local Alert** — Shows conflict in terminal (always)
2. **Hub Post** — Posts to `POST /api/chat` with conflict details
3. **Glyph** — Uses 🕷️ emoji in Hub chat

## Configuration

Set `HUB_URL` in your environment:

```bash
# In .env or shell
HUB_URL=https://hub.treebird.uk  # Production (default)
HUB_URL=http://localhost:3000     # Local development
```

## Message Format

When conflicts are detected, the Hub receives:

```json
{
  "agent": "ssan",
  "name": "Spidersan",
  "message": "🕷️⚠️ **CONFLICT DETECTED** on branch `feature/x`\n\n• **other-branch**: file.ts, utils.ts",
  "glyph": "🕷️"
}
```

## Example Output

**Terminal:**
```
⚠️ CONFLICT DETECTED!
   🔴 feature/auth: src/auth.ts, src/middleware.ts

📤 Posted conflict to Hub chat
```

**Hub Chat:**
```
🕷️ Spidersan: 🕷️⚠️ CONFLICT DETECTED on branch `main`
   • feature/auth: src/auth.ts, src/middleware.ts
```

## Related Commands

- `spidersan watch` — Basic watch mode (local only)
- `spidersan watch --hub` — WebSocket connection to Hub (real-time events)
- `spidersan conflicts` — Manual conflict check

## See Also

- [CLAUDE.md](../CLAUDE.md) — Session startup instructions
- [USE_CASES.md](./USE_CASES.md) — Common usage patterns
