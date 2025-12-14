# Spidersan & Mappersan for General Documents

> Beyond code: coordinating any files AI agents touch

## Overview

While Spidersan and Mappersan were designed for code repositories, they work equally well for **any file-based project** where multiple AI agents collaborate:

- Technical documentation
- Marketing content
- Research papers
- Configuration files
- Data files (JSON, YAML, CSV)
- Design assets metadata

## Why Use These Tools for Documents?

| Problem | Without Spidersan | With Spidersan |
|---------|-------------------|----------------|
| Two agents edit same doc | Merge conflicts, lost work | Conflict detected before work starts |
| Who's working on what? | No visibility | `spidersan list` shows all activity |
| Old drafts everywhere | Manual cleanup | `spidersan stale` finds abandoned work |
| Coordination needed | Slack/email back-and-forth | `spidersan send` for direct agent messaging |

## Use Case 1: Technical Documentation Project

### Scenario
Multiple AI agents maintain documentation for a product:
- Claude Code writes API docs
- Cursor updates user guides
- Copilot handles changelog

### Setup
```bash
# Initialize in docs repository
cd product-docs/
spidersan init

# Each agent registers their area
spidersan register --files docs/api/*.md --desc "API reference updates"
spidersan register --files docs/guides/*.md --desc "User guide refresh"
spidersan register --files CHANGELOG.md --desc "Release notes"
```

### Daily Workflow
```bash
# Before starting work
spidersan conflicts
# Shows: "docs/api/authentication.md claimed by claude-agent"

# After completing work
spidersan ready-check
# Ensures no WIP markers like [TODO], [DRAFT], etc.
```

## Use Case 2: Marketing Content Coordination

### Scenario
Marketing team uses AI agents for content creation:
- Blog posts
- Social media copy
- Email campaigns
- Landing pages

### File Registration
```bash
# Blog team
spidersan register \
  --files content/blog/2024-*.md \
  --desc "Q4 blog content refresh"

# Social team
spidersan register \
  --files content/social/linkedin/*.md,content/social/twitter/*.md \
  --desc "Social campaign: product launch"

# Email team
spidersan register \
  --files content/email/sequences/*.html \
  --desc "Onboarding email rewrite"
```

### Checking for Overlap
```bash
spidersan conflicts

# Output:
# content/blog/2024-product-announcement.md
#   ├─ claude-blog-agent (blog content)
#   └─ claude-social-agent (social campaign)
#
# Action needed: Coordinate messaging!
```

## Use Case 3: Research Paper Collaboration

### Scenario
Research team with AI assistants working on sections:
- Literature review (Claude)
- Methodology (human + AI assist)
- Data analysis (specialized AI)
- Conclusions (senior researcher + AI)

### Registration by Section
```bash
# Literature agent
spidersan register \
  --files paper/sections/02-literature.md,paper/references.bib \
  --desc "Literature review expansion"

# Methods section
spidersan register \
  --files paper/sections/03-methodology.md \
  --desc "Methods clarification"

# Analysis agent
spidersan register \
  --files paper/sections/04-results.md,paper/figures/*.py \
  --desc "Statistical analysis and figures"
```

### Dependency Declaration (Supabase tier)
```bash
# Results depend on methodology being finalized
spidersan depends methodology-branch

# Conclusions depend on results
spidersan depends results-branch
```

## Use Case 4: Configuration File Management

### Scenario
DevOps team managing infrastructure configs:
- Terraform files
- Kubernetes manifests
- CI/CD pipelines
- Environment configs

### High-Risk File Tracking
```bash
# Infrastructure changes
spidersan register \
  --files terraform/*.tf \
  --desc "AWS infrastructure update"

# K8s changes
spidersan register \
  --files k8s/production/*.yaml \
  --desc "Production deployment config"

# CI/CD
spidersan register \
  --files .github/workflows/*.yml \
  --desc "Pipeline optimization"
```

### Merge Order for Config Changes
```bash
spidersan merge-order

# Output:
# Recommended merge sequence:
# 1. feature/terraform-vpc (no dependencies)
# 2. feature/k8s-networking (depends on #1)
# 3. feature/ci-deploy (depends on #2)
```

## Use Case 5: Data File Coordination

### Scenario
Data team with multiple agents processing files:
- Data cleaning scripts
- Schema definitions
- Sample datasets
- Transformation configs

### Registration Pattern
```bash
# Schema changes (high impact)
spidersan register \
  --files schemas/*.json,schemas/*.yaml \
  --desc "Schema v2 migration"

# Transform configs
spidersan register \
  --files transforms/*.py,transforms/config.yaml \
  --desc "New ETL pipeline"
```

## Mappersan for Document Projects

Mappersan auto-generates documentation for your documentation:

### What Mappersan Creates for Doc Projects

| Generated File | Purpose |
|----------------|---------|
| `CLAUDE.md` | Quick context: what docs exist, structure, conventions |
| `AGENT_GUIDE.md` | Cheat sheet: file locations, naming patterns, style guide |
| `LIMITATIONS.md` | What can't be auto-generated (images, diagrams, etc.) |
| `USE_CASES.md` | When to update which docs, approval workflows |

### Example: Auto-Generated CLAUDE.md for Docs Repo

```markdown
# Product Documentation - AI Context

## Structure
docs/
├── api/          # API reference (OpenAPI generated)
├── guides/       # User tutorials (human-reviewed)
├── internal/     # Team processes (restricted)
└── changelog/    # Release notes (auto-generated)

## Conventions
- File naming: kebab-case (e.g., getting-started.md)
- Frontmatter required: title, updated, author
- Images: /assets/images/{section}/{name}.png

## What NOT to Auto-Edit
- docs/internal/* (requires human approval)
- Any file with `<!-- HUMAN-ONLY -->` comment
```

## Integration: Spidersan + Mappersan for Documents

```
┌─────────────────────────────────────────────────────┐
│                  DOCUMENT PROJECT                    │
├─────────────────────────────────────────────────────┤
│                                                      │
│  MAPPERSAN                    SPIDERSAN             │
│  ─────────                    ─────────             │
│  • Analyzes doc structure     • Tracks who's        │
│  • Generates CLAUDE.md          editing what        │
│  • Detects style drift        • Prevents conflicts  │
│  • Updates conventions        • Orders merges       │
│                                                      │
│           ↓                         ↓                │
│  ┌─────────────────────────────────────────────┐    │
│  │        COORDINATED AI EDITING               │    │
│  │                                             │    │
│  │  Agent A: api-docs    → No conflicts       │    │
│  │  Agent B: user-guides → No conflicts       │    │
│  │  Agent C: blog-posts  → Conflict detected! │    │
│  └─────────────────────────────────────────────┘    │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## File Types Supported

### Fully Supported
- Markdown (`.md`, `.mdx`)
- Text files (`.txt`, `.rst`)
- Structured data (`.json`, `.yaml`, `.toml`)
- Config files (`.ini`, `.conf`, `.env`)
- Code (all languages)

### Partial Support (metadata only)
- Binary files (images, PDFs)
- Compiled outputs
- Large data files

### Best Practices for Binary Files
```bash
# Track the metadata, not the binary
spidersan register \
  --files assets/images/manifest.json \
  --desc "Image asset updates (see manifest for actual files)"
```

## Quick Reference: Document Project Commands

| Task | Command |
|------|---------|
| Start tracking a doc project | `spidersan init` |
| Claim docs for editing | `spidersan register --files docs/*.md` |
| Check for conflicts before editing | `spidersan conflicts` |
| See all active document work | `spidersan list` |
| Validate doc is ready for review | `spidersan ready-check` |
| Find abandoned drafts | `spidersan stale --days 14` |
| Clean up old branches | `spidersan cleanup` |
| Message another doc agent | `spidersan send @content-team "blog draft ready"` |

## Common Patterns

### Pattern: Shared Style Guide
```bash
# All agents reference, one agent owns
spidersan register \
  --files docs/STYLE_GUIDE.md \
  --desc "Style guide is LOCKED - request changes via message"
```

### Pattern: Rotating Ownership
```bash
# Weekly changelog rotation
spidersan register \
  --files CHANGELOG.md \
  --desc "Week 48 changelog - claude-agent-3"

# After week ends
spidersan merged --pr 456
# Next agent registers for Week 49
```

### Pattern: Review Queue
```bash
# Check merge order before review day
spidersan merge-order

# Output shows optimal review sequence:
# 1. docs/api/auth.md (no deps, 2 days old)
# 2. docs/guides/setup.md (depends on #1)
# 3. docs/changelog/v2.md (depends on #1, #2)
```

## Limitations for Document Projects

### What Spidersan Cannot Do
- Cannot detect semantic conflicts (two agents writing contradictory content)
- Cannot enforce style consistency (use Mappersan + linters)
- Cannot track changes inside binary files
- Cannot auto-resolve conflicting edits

### Workarounds
| Limitation | Workaround |
|------------|------------|
| Semantic conflicts | Use descriptive `--desc` flags; send messages |
| Style drift | Run Mappersan analysis periodically |
| Binary files | Track manifest/metadata files instead |
| Auto-resolve | Use `merge-order` for optimal sequence |

---

**See also:**
- [USE_CASES.md](./USE_CASES.md) - Comprehensive code-focused scenarios
- [MAPPERSAN_ROADMAP.md](./MAPPERSAN_ROADMAP.md) - Future document analysis features
- [AGENT_GUIDE.md](./AGENT_GUIDE.md) - Quick command reference
