# TREEBIRD BEST PRACTICES: Feature Documentation Mapping System

> **IMPORTANT: This document applies to ALL treebird7 projects**
> Standard methodology for documenting features for both human developers and AI agents

---

## Overview

This document describes the **tiered documentation mapping system** used to ensure AI agents (Claude Code, Cursor, Copilot) and developers can instantly understand a project's features without researching the codebase each time.

## The Problem This Solves

1. **AI agents waste time** re-exploring codebases every session
2. **Context is lost** between sessions - agents forget what the project does
3. **Capabilities are unclear** - agents don't know what a tool can/can't do
4. **No quick reference** - everything is either too brief or too detailed

## The Solution: Tiered Documentation Pyramid

```
                    ┌─────────────────┐
                    │   CLAUDE.md     │  ← Auto-loaded (30 sec)
                    │  Project Root   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  AGENT_GUIDE.md │  ← Quick reference (1 min)
                    │   docs/ folder  │
                    └────────┬────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
   ┌────────▼────────┐ ┌─────▼─────┐ ┌────────▼────────┐
   │ LIMITATIONS.md  │ │ USE_CASES │ │ Other detailed  │
   │  What it CAN'T  │ │    .md    │ │   docs...       │
   │      do         │ │           │ │                 │
   └─────────────────┘ └───────────┘ └─────────────────┘
         (3 min)          (10+ min)       (as needed)
```

---

## Tier 1: CLAUDE.md (CRITICAL)

**Location:** Project root (`/CLAUDE.md`)
**Purpose:** Auto-loaded by Claude Code on every session start
**Target read time:** 30 seconds
**Max length:** ~200 lines

### What to Include

```markdown
# Project Name - AI Agent Context

## What is [Project]?
One paragraph explaining the core purpose.

## Core Problem It Solves
Bullet points of the main problems addressed.

## Available Commands / API / Features
Quick reference tables or code blocks.

## When to Use [Project]
Clear triggers for when this tool applies.

## Limitations (Brief)
Top 5-6 things it CANNOT do.

## Quick Patterns
2-4 most common usage patterns with code.

## Configuration
Environment variables, config files.

## Architecture Overview (Brief)
ASCII diagram or simple description.

## Key Files to Know
Table of important files and their purposes.

## Testing
How to run tests.
```

### Template

```markdown
# [PROJECT_NAME] - AI Agent Context

> **Quick Load Context for Claude Code and AI Agents**

## What is [PROJECT_NAME]?

[One paragraph description]

## Core Problem It Solves

- Problem 1
- Problem 2
- Problem 3

## Available Commands

| Command | Purpose |
|---------|---------|
| `cmd1` | Does X |
| `cmd2` | Does Y |

## When to Use

### ALWAYS use when:
1. Scenario A
2. Scenario B

### NEVER use when:
1. Scenario C
2. Scenario D

## Limitations

- Cannot do X
- Cannot do Y
- Cannot do Z

## Quick Patterns

### Pattern 1: [Name]
\`\`\`bash
example code
\`\`\`

### Pattern 2: [Name]
\`\`\`bash
example code
\`\`\`

## Configuration

\`\`\`bash
ENV_VAR_1=value
ENV_VAR_2=value
\`\`\`

## Key Files

| File | Purpose |
|------|---------|
| `src/main.ts` | Entry point |
| `src/config.ts` | Configuration |

## Testing

\`\`\`bash
npm test
\`\`\`

---

**For detailed documentation, see:** `docs/`
```

---

## Tier 2: AGENT_GUIDE.md

**Location:** `docs/AGENT_GUIDE.md`
**Purpose:** Cheat sheet for AI agents
**Target read time:** 1 minute
**Max length:** ~150 lines

### What to Include

```markdown
# [Project] Agent Quick Reference

> **TL;DR for AI Agents - Read this in 30 seconds**

## What It Is
One sentence.

## Commands You'll Use 90% of the Time
Top 5 commands with examples.

## The Golden Rules
Numbered list of 4-5 rules agents MUST follow.

## Decision Tree
ASCII flowchart for common decisions.

## Command Cheat Sheet
Complete table of all commands.

## What It CANNOT Do
Brief bullet list.

## When NOT to Use
Counter-scenarios.

## Error Recovery
Common errors and fixes.

## Environment Setup
Minimal and full setup options.
```

### Key Principles

1. **Tables over paragraphs** - Agents parse tables faster
2. **Decision trees over prose** - Visual flow > text description
3. **Commands with examples** - Always show, don't just tell
4. **Golden rules first** - Most important behaviors upfront

---

## Tier 3: LIMITATIONS.md

**Location:** `docs/LIMITATIONS.md`
**Purpose:** Explicitly document what the system CANNOT do
**Target read time:** 3 minutes
**Max length:** ~300 lines

### Why This Matters

AI agents often **assume capabilities** that don't exist. A dedicated limitations document:
- Prevents false promises to users
- Stops agents from attempting impossible operations
- Sets clear scope boundaries
- Reduces user frustration

### What to Include

```markdown
# [Project] Limitations

## Core Limitations
Numbered list with:
- What it does (briefly)
- What it does NOT do
- Why (technical reason)

## Feature-Specific Limitations
Per-feature breakdown.

## What Users Often Expect (But We Don't Do)
Common misconceptions.

## Workarounds
Table of limitation → workaround pairs.

## Future Considerations
What might be addressed later.
```

### Format Each Limitation

```markdown
### X. [Limitation Name]

**What it does:** Brief description of actual capability
**What it does NOT do:** Clear statement of limitation

\`\`\`
Example scenario showing the limitation
\`\`\`

**Why:** Technical or design reason for the limitation
```

---

## Tier 4: USE_CASES.md

**Location:** `docs/USE_CASES.md`
**Purpose:** Comprehensive scenarios for all audiences
**Target read time:** 10+ minutes (reference document)
**Max length:** Unlimited (well-organized)

### Structure

```markdown
# [Project] Use Cases

## Table of Contents

## 1. Development Use Cases
### 1.1 [Scenario Name]
- Problem Solved
- Solution with code
- Hashtags

## 2. Agent Documentation
- Principles
- Command reference
- Decision trees
- Best practices
- Message templates

## 3. Marketing Use Cases
- Pain point solutions
- Competitive positioning
- ROI messaging
- User stories

## 4. Industry-Specific
- Industry 1
- Industry 2
- etc.

## 5. Integration Scenarios
- Tool 1
- Tool 2
- etc.

## Quick Reference: All Hashtags
Categorized hashtag index.
```

### Hashtag System

Every use case should have hashtags for:
- **Discoverability** - Find related use cases
- **Categorization** - Group by theme
- **Marketing** - Tag for campaigns

```markdown
**Hashtags:** `#category` `#feature` `#audience` `#industry`
```

---

## Implementation Checklist

When documenting a new feature or project:

### Phase 1: Core Context (Do First)
- [ ] Create/update `CLAUDE.md` in project root
- [ ] Include: what, why, commands, limitations, patterns
- [ ] Keep under 200 lines
- [ ] Test: Can an agent understand the project in 30 seconds?

### Phase 2: Quick Reference
- [ ] Create `docs/AGENT_GUIDE.md`
- [ ] Add decision trees for common workflows
- [ ] Add command cheat sheet tables
- [ ] Add golden rules (numbered, imperative)
- [ ] Keep under 150 lines

### Phase 3: Boundaries
- [ ] Create `docs/LIMITATIONS.md`
- [ ] Document every "cannot do"
- [ ] Explain why for each limitation
- [ ] Add workarounds where possible
- [ ] Add "common misconceptions" section

### Phase 4: Comprehensive
- [ ] Create `docs/USE_CASES.md`
- [ ] Add development scenarios
- [ ] Add agent-specific documentation
- [ ] Add marketing use cases
- [ ] Add industry applications
- [ ] Add integration scenarios
- [ ] Tag everything with hashtags

---

## File Naming Convention

```
project-root/
├── CLAUDE.md                    # REQUIRED - Auto-loaded context
├── README.md                    # User-facing intro (existing)
├── docs/
│   ├── AGENT_GUIDE.md          # REQUIRED - Quick reference
│   ├── LIMITATIONS.md          # REQUIRED - Scope boundaries
│   ├── USE_CASES.md            # RECOMMENDED - Comprehensive
│   └── [other docs]            # As needed
```

---

## Quality Checklist

### CLAUDE.md Quality Test
- [ ] Agent can understand project in <30 seconds
- [ ] All main commands are listed
- [ ] Top limitations are mentioned
- [ ] At least 2 quick patterns included
- [ ] Key files table is present

### AGENT_GUIDE.md Quality Test
- [ ] Golden rules are numbered and imperative
- [ ] Decision tree covers main workflows
- [ ] Command table is complete
- [ ] Error recovery section exists

### LIMITATIONS.md Quality Test
- [ ] Every "cannot" has a "why"
- [ ] Workarounds are provided where possible
- [ ] Common misconceptions are addressed
- [ ] No vague language ("might not work")

### USE_CASES.md Quality Test
- [ ] Table of contents is navigable
- [ ] Each use case has problem/solution/code
- [ ] Hashtags are consistent and useful
- [ ] Marketing language is separate from technical

---

## Maintenance

### When to Update

| Event | Update |
|-------|--------|
| New command added | CLAUDE.md, AGENT_GUIDE.md |
| New limitation discovered | LIMITATIONS.md, CLAUDE.md (brief) |
| New use case identified | USE_CASES.md |
| Breaking change | All four documents |
| Bug fix | Usually none (unless behavior change) |

### Version Tracking

Add to each document footer:
```markdown
---
*Document Version: X.Y*
*Last Updated: YYYY-MM-DD*
*Maintainer: [team/person]*
```

---

## Example: Spidersan Implementation

This system was first implemented for Spidersan with these results:

| Document | Lines | Purpose |
|----------|-------|---------|
| `CLAUDE.md` | 174 | Auto-loaded project context |
| `docs/AGENT_GUIDE.md` | 115 | 30-second quick reference |
| `docs/LIMITATIONS.md` | 292 | Explicit scope boundaries |
| `docs/USE_CASES.md` | 1141 | Comprehensive scenarios |

**Total:** 1,722 lines of structured documentation

**Result:** AI agents can now understand Spidersan without exploring the codebase.

---

## Summary

1. **CLAUDE.md** = Agent's first impression (auto-loaded, 30 sec)
2. **AGENT_GUIDE.md** = Cheat sheet (quick reference, 1 min)
3. **LIMITATIONS.md** = Boundaries (prevent false assumptions)
4. **USE_CASES.md** = Deep dive (comprehensive reference)

**The goal:** Any AI agent should understand your project's capabilities, limitations, and usage patterns within 2 minutes of starting a session.

---

*This is a treebird7 standard. Apply to all projects.*

*Document Version: 1.0*
*Last Updated: 2025-12-13*
*Origin: Spidersan documentation mapping*
