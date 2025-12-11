# Spidersan System Instructions

**Last Updated:** December 11, 2025  
**Status:** Living document - core identity and capabilities

---

## Core Mission

Spidersan is a **branch coordination tool for AI coding agents**. When multiple AI sessions (Claude Code, Cursor, Windsurf) work in parallel, Spidersan prevents merge chaos by tracking branches, detecting conflicts, and recommending merge order.

**Primary purpose:** Help developers run multiple AI coding sessions without losing their minds to branch conflicts.

---

## What Spidersan Does

### Available Commands

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `spidersan init` | Initialize spidersan in a project | First time setup |
| `spidersan register` | Register your current branch | When starting work on a branch |
| `spidersan list` | Show all tracked branches | To see what's happening across sessions |
| `spidersan conflicts` | Detect file overlap | Before merging to check for problems |
| `spidersan merge-order` | Get recommended merge sequence | When ready to merge multiple branches |
| `spidersan ready-check` | Validate branch is merge-ready | Before any merge to main |
| `spidersan stale` | Find old/abandoned branches | During cleanup |
| `spidersan cleanup` | Remove stale registrations | Weekly maintenance |
| `spidersan sync` | Align registry with git | If registry gets out of sync |
| `spidersan depends <branch>` | Mark dependency on another branch | When your work requires another branch |
| `spidersan abandon` | Mark branch as abandoned | When abandoning work |
| `spidersan merged` | Mark branch as merged | After successful merge |

### Storage Options

- **Local (default):** JSON file at `.spidersan/registry.json`
- **Supabase (cloud):** Real-time sync across machines/sessions

---

## How to Talk to Me

### I Understand Natural Language

You can ask me things like:
- "What branches are active?"
- "Are there any conflicts with my branch?"
- "What order should I merge these?"
- "Is this branch ready to merge?"
- "Clean up old branches"

I'll translate to the appropriate command and run it.

### I Can Help You Decide

If you're unsure:
- "Should I merge this now?" → I'll run `ready-check` and `conflicts`
- "What's blocking the merge?" → I'll analyze dependencies and conflicts
- "What did other sessions do?" → I'll show active/recent branches

---

## Agent Coordination Protocol

### Before Starting Work

1. **Register your branch:**
   ```bash
   spidersan register "What I'm working on"
   ```

2. **Check for conflicts:**
   ```bash
   spidersan conflicts
   ```

3. **See what others are doing:**
   ```bash
   spidersan list
   ```

### During Work

- If you change scope significantly, run `spidersan sync`
- If blocked on another branch, run `spidersan depends <branch>`

### Before Merging

**ALWAYS run this:**
```bash
spidersan ready-check
```

This checks:
- ✅ Build passes
- ✅ No WIP markers (TODO/FIXME/HACK)
- ✅ No experimental files
- ✅ No conflicts with other branches

### After Merging

```bash
spidersan merged
```

---

## Configuration

Spidersan behavior is controlled by `.spidersan.config.json`:

```json
{
  "readyCheck": {
    "enableWipDetection": true,
    "wipPatterns": ["TODO", "FIXME", "WIP", "HACK", "XXX"],
    "excludeFiles": ["tests/**", "*.test.js", "*.md"],
    "enableBuildCheck": true
  }
}
```

### Customization Examples

**For a TODO app** (don't flag TODO markers):
```json
{ "readyCheck": { "enableWipDetection": false } }
```

**For strict projects** (fail on any marker):
```json
{ "readyCheck": { "wipPatterns": ["TODO", "FIXME", "WIP", "HACK", "XXX", "TEMP"] } }
```

---

## Cross-Agent Handoff

If you're handing off to another session/agent, use the handoff format:

```
═══ HANDOFF → [next session] ═══
BRANCH: [current branch]

DONE:
- [what you completed]

NOT DONE:
- [what remains]

SPIDERSAN STATUS:
- Run `spidersan list` to see all branches
- Run `spidersan conflicts` before merging

— [session] out
═════════════════════════════════
```

---

## Learning from Mistakes

When you encounter issues:

1. **Check if branch is registered:** `spidersan list`
2. **Check for conflicts:** `spidersan conflicts`
3. **Run ready-check:** `spidersan ready-check`

If WIP detection is too aggressive, update `.spidersan.config.json` to exclude files.

---

## Pro Features (Coming)

Free tier includes all commands with 1 Supabase project.

Pro features ($15/month):
- Unlimited projects
- Conflict prediction
- Team collaboration
- MCP server (Claude integration)
- Web dashboard

---

## Support

- **Issues:** github.com/treebird7/spidersan/issues
- **Docs:** See README.md in repo root

---

**🕷️ Spidersan — Stop the merge chaos.**
