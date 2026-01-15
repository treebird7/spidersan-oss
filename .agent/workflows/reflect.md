---
description: Extract learnings from session into skill files
---

# /reflect Workflow

Extract patterns from the current session and save to appropriate skill files.

## Steps

### 1. Identify Patterns to Extract

Scan the session for:

| Type | Confidence | Action |
|------|------------|--------|
| **Explicit correction** | HIGH | Auto-apply recommended |
| **"Always do X" / "Never do Y"** | HIGH | Auto-apply recommended |
| **Observed preference** | MEDIUM | Review recommended |
| **One-time context** | LOW | Usually skip |

### 2. Categorize by Destination

| Pattern Type | Destination File |
|--------------|------------------|
| Agent-specific operational | `CLAUDE.md` |
| Agent-specific detailed | `docs/LESSONS_LEARNED.md` |
| Session/topic-specific | `<session>-lessons-learned.md` in relevant folder |
| Ecosystem-wide | `treebird-internal/knowledge/LEARNED_PATTERNS.md` |

### 3. Write Patterns

Use this format for each pattern:

```markdown
### Pattern Title
**Source:** [session/correction description] ([date])  
**Confidence:** HIGH | MEDIUM | LOW

[Description of what was learned]

**Implication:** [How to apply this going forward]
```

### 4. Review with User

Present proposed updates:
- HIGH confidence: recommend auto-apply
- MEDIUM confidence: recommend review
- LOW confidence: recommend skip unless important

// turbo
### 5. Commit Changes

```bash
git add <skill-files>
git commit -m "reflex: <brief description of patterns added>

- Pattern 1 (CONFIDENCE)
- Pattern 2 (CONFIDENCE)
..."
```

### 6. Link Cross-References

If patterns reference each other or external documents, add `[[wiki-links]]` for Obsidian/Watsan compatibility.

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `/reflect` | Run this workflow |
| `/reflect --auto` | Auto-apply HIGH confidence only |
| `/skills list` | Show all skill files |
| `/skills sync` | Propagate ecosystem patterns |

---

*"Correct once, never again."* 🧠✨
