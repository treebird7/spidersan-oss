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
