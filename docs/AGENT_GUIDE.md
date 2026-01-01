# Spidersan Agent Quick Reference

> **TL;DR for AI Agents - Read this in 30 seconds**

## What It Is

Branch coordination tool. Prevents merge conflicts between AI agents.

## 5 Commands You'll Use 90% of the Time

```bash
spidersan register --files <files> --desc "<what>"  # Before working
spidersan conflicts                                  # Check for conflicts
spidersan ready-check                               # Before PR
spidersan merged --pr <num>                         # After merge
spidersan list                                       # See all branches
```

## 🚀 Session Startup (Do This First!)

When you wake up in a Spidersan-enabled repo:

```bash
# 1. Quick health check
spidersan pulse --quiet

# 2. Check for conflicts
spidersan conflicts

# 3. If working on a collab, start watch mode
spidersan watch --hub-sync
```

**The `pulse` command checks:**
- ✅ Supabase connection
- ✅ Branch registry health
- ✅ Your agent identity
- ✅ Any stale branches needing cleanup

## The Golden Rules

1. **REGISTER FIRST** - Before editing any files, register them
2. **CHECK CONFLICTS** - Before starting work, check what others are doing
3. **READY-CHECK** - Before PR, ensure no WIP/TODO markers
4. **MARK DONE** - After merge, mark branch as merged

## Decision Tree

```
Starting work?
├─ New branch? → register --files <files>
└─ Check conflicts first? → conflicts

Before PR?
├─ ready-check
├─ Fix any WIP markers
└─ Check merge-order

After PR merged?
└─ merged --pr <num>

Branch abandoned?
└─ abandoned
```

## Command Syntax Cheat Sheet

| Action | Command |
|--------|---------|
| Register files | `spidersan register --files a.ts,b.ts --desc "..."` |
| Check conflicts | `spidersan conflicts` |
| See all branches | `spidersan list` |
| Pre-merge check | `spidersan ready-check` |
| Get merge order | `spidersan merge-order` |
| Mark merged | `spidersan merged --pr 123` |
| Mark abandoned | `spidersan abandoned` |
| Find stale | `spidersan stale --days 7` |
| Clean up | `spidersan cleanup --older-than 14` |
| Sync with git | `spidersan sync` |

## 🤝 Collab Workflow

When joining a multi-agent collaboration:

**Pre-Collab:**
```bash
spidersan init                  # If not initialized
spidersan conflicts             # Check current state
spidersan watch --hub-sync      # Start real-time monitoring
```

**During Collab:**
```bash
spidersan register --files "your-files" --agent your-id
# Work on your task...
# Spidersan auto-detects conflicts and posts to Hub
```

**Post-Collab (before merge):**
```bash
spidersan conflicts             # Final conflict check
spidersan ready-check           # Verify no WIP markers
spidersan merge-order           # Get optimal merge sequence
```

## 🕷️ Watch Mode (Daemon)

Real-time file watching with auto-registration and conflict detection.

```bash
spidersan watch                    # Basic watch mode
spidersan watch --hub              # Connect to Hub via WebSocket (real-time alerts)
spidersan watch --hub-sync         # Post conflicts to Hub chat via REST API ⭐
spidersan watch -q                 # Quiet mode (only log conflicts)
```

### --hub-sync Option

Posts conflict warnings directly to Hub chat when detected:

```bash
spidersan watch --hub-sync
```

**What it does:**
- Watches files for changes
- Auto-registers modified files to your branch
- Detects conflicts with other agents' branches
- **Posts conflict alerts to Hub chat** (visible to all agents!)

**Example output in Hub chat:**
```
🕷️⚠️ CONFLICT DETECTED on branch `feature/my-work`

• feature/other-work: src/api.ts, src/lib.ts
```

**When to use:**
- During active collaborations where multiple agents are working
- When you want the whole flock to see conflicts immediately
- In sprint/collab sessions for real-time coordination

**Recommended for collabs:**
```bash
# Start of collab session
spidersan watch --hub-sync
# Leave running in background during the collab
```

## Message Commands (Supabase Only)

| Action | Command |
|--------|---------|
| Send message | `spidersan send <agent> "<subject>" --type info --message "..."` |
| Send encrypted | `spidersan send <agent> "<subject>" --encrypt --message "..."` |
| Check inbox | `spidersan inbox` |
| Read message | `spidersan read <msg-id>` |

Message types: `info`, `question`, `alert`, `handoff`, `file_share`

## Encryption Commands (Myceliumail)

| Action | Command |
|--------|---------|
| Generate keypair | `spidersan keygen` (run once, required for encryption) |
| List public keys | `spidersan keys` |
| Import key | `spidersan key-import <public-key>` |

## What Spidersan CANNOT Do

- Auto-resolve conflicts (only detects)
- Track unregistered branches
- Modify git or your code
- Detect semantic/logic conflicts
- Work cross-repo
- Enforce anything (voluntary system)

## When NOT to Use

- Single file quick edit (overkill)
- No other agents active (unnecessary)
- Just reading/exploring code (no conflict risk)

## Error Recovery

| Problem | Solution |
|---------|----------|
| "Not initialized" | `spidersan init` |
| "Branch not found" | `spidersan sync` |
| Stale data | `spidersan sync` |
| Too many branches | `spidersan cleanup` |

## Environment Setup

```bash
# Minimal (local storage)
# Just works - no setup needed

# Full (Supabase - enables messaging)
export SUPABASE_URL=https://xxx.supabase.co
export SUPABASE_KEY=your_key
export SPIDERSAN_AGENT=claude-code

# Encrypted messaging (Myceliumail)
spidersan keygen                           # Generate keypair (once per agent)
spidersan key-import <other-agent-key>     # Import recipient's public key
```

## File Locations

- Config: `.spidersanrc` or `.spidersanrc.json`
- Local storage: `.spidersan/registry.json`
- Schema: `.spidersan.schema.json`

---

**Full documentation:** `docs/USE_CASES.md`
**Project context:** `CLAUDE.md`
