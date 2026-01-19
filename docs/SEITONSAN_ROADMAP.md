# Seitonsan - Document Declutter CLI

> *Seiton (整頓): "Orderliness" - the second pillar of the Japanese 5S methodology*

## Vision

**Seitonsan** is an AI-powered CLI that sorts through document clutter, identifying duplicates, outdated files, orphans, and organizing chaos into structure.

Think of it as **Marie Kondo for your document folders** - but powered by AI agents.

## The Problem

Document folders become graveyards:

```
docs/
├── README.md
├── README-old.md
├── README-backup.md
├── README-final.md
├── README-final-v2.md
├── README-FINAL-ACTUAL.md          # Which one is real?
├── api-spec.md
├── api-spec-draft.md
├── api-spec-2024.md
├── notes.txt
├── notes-meeting.txt
├── TODO.md
├── TODO-old.md
├── archive/
│   └── (200 files nobody remembers)
└── temp/
    └── (should have been deleted months ago)
```

**Pain points:**
- Which version is current?
- What's safe to delete?
- Are any docs orphaned (nothing links to them)?
- What duplicates exist?
- What's outdated vs. actively maintained?

## Solution: Seitonsan

```bash
# Scan and analyze document folder
seitonsan scan ./docs

# Show the mess
seitonsan report

# Get actionable recommendations
seitonsan tidy

# Execute cleanup (with confirmation)
seitonsan clean --interactive
```

## Core Features

### 1. Duplicate Detection
```bash
seitonsan duplicates

# Output:
# DUPLICATES FOUND (3 groups)
#
# Group 1: README variants (5 files, 4 likely duplicates)
#   ├─ README.md              [CURRENT] last modified: 2 days ago
#   ├─ README-old.md          [92% similar] last modified: 3 months ago
#   ├─ README-backup.md       [100% identical] last modified: 1 month ago
#   ├─ README-final.md        [87% similar] last modified: 6 months ago
#   └─ README-final-v2.md     [95% similar] last modified: 5 months ago
#
# Recommendation: Keep README.md, archive or delete others
```

### 2. Orphan Detection
```bash
seitonsan orphans

# Output:
# ORPHANED DOCUMENTS (not linked from anywhere)
#
# docs/internal/old-process.md
#   └─ No incoming links, last modified 8 months ago
#
# docs/api/deprecated-endpoint.md
#   └─ No incoming links, contains "DEPRECATED" marker
#
# docs/guides/draft-feature.md
#   └─ No incoming links, contains "WIP" marker
```

### 3. Staleness Analysis
```bash
seitonsan stale --days 90

# Output:
# STALE DOCUMENTS (not modified in 90+ days)
#
# HIGH PRIORITY (referenced but stale):
#   docs/api/authentication.md    [180 days, 12 incoming links]
#   docs/guides/deployment.md     [95 days, 8 incoming links]
#
# LOW PRIORITY (unreferenced and stale):
#   docs/archive/2023-roadmap.md  [400 days, 0 links]
#   docs/temp/scratch.md          [200 days, 0 links]
```

### 4. Structure Analysis
```bash
seitonsan structure

# Output:
# STRUCTURE ANALYSIS
#
# Depth: 4 levels (recommended: ≤3)
# Naming consistency: 67% (kebab-case: 45, mixed: 22)
# Empty directories: 3
# Oversized directories: 2 (>50 files)
#
# RECOMMENDATIONS:
# 1. Flatten docs/api/v1/endpoints/auth/ (4 levels deep)
# 2. Rename 22 files to kebab-case for consistency
# 3. Remove empty: docs/archive/2022/, docs/temp/old/
# 4. Split docs/guides/ (78 files) into subcategories
```

### 5. Content Analysis (AI-powered)
```bash
seitonsan analyze --ai

# Output:
# CONTENT ANALYSIS
#
# CONTRADICTIONS DETECTED:
#   docs/api/auth.md says "use JWT tokens"
#   docs/guides/security.md says "use session cookies"
#   → Recommendation: Reconcile authentication guidance
#
# OUTDATED REFERENCES:
#   docs/setup.md references "config.json" (file doesn't exist)
#   docs/api/users.md references "/api/v1/users" (endpoint removed)
#
# MISSING DOCUMENTATION:
#   src/services/payment.ts has no corresponding docs
#   src/lib/encryption.ts has no corresponding docs
```

## Command Reference

### Scanning & Analysis
```bash
seitonsan init                    # Initialize in a folder
seitonsan scan [path]             # Scan documents
seitonsan report                  # Full analysis report
seitonsan report --json           # Machine-readable output
```

### Detection Commands
```bash
seitonsan duplicates              # Find duplicate/similar files
seitonsan orphans                 # Find unlinked documents
seitonsan stale [--days N]        # Find old documents
seitonsan broken-links            # Find broken internal links
seitonsan empty                   # Find empty files/directories
```

### Organization Commands
```bash
seitonsan structure               # Analyze folder structure
seitonsan naming                  # Check naming consistency
seitonsan categorize              # Suggest categories for uncategorized
seitonsan suggest-archive         # Suggest files to archive
```

### AI-Powered Commands
```bash
seitonsan analyze --ai            # Deep content analysis
seitonsan summarize [file]        # Summarize a document
seitonsan relate                  # Map document relationships
seitonsan contradictions          # Find conflicting information
```

### Cleanup Commands
```bash
seitonsan tidy                    # Show all recommendations
seitonsan clean --interactive     # Interactive cleanup wizard
seitonsan clean --dry-run         # Preview what would be cleaned
seitonsan archive [files...]      # Move to archive folder
seitonsan delete [files...]       # Delete with confirmation
```

### Integration Commands
```bash
seitonsan export                  # Export analysis to JSON/CSV
seitonsan watch                   # Watch for new clutter
seitonsan hook --pre-commit       # Prevent clutter in commits
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        SEITONSAN                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Scanner   │  │  Analyzer   │  │     AI Engine       │ │
│  │             │  │             │  │                     │ │
│  │ • File walk │  │ • Duplicates│  │ • Content analysis  │ │
│  │ • Metadata  │  │ • Orphans   │  │ • Summarization     │ │
│  │ • Hashing   │  │ • Staleness │  │ • Contradiction     │ │
│  │ • Links     │  │ • Structure │  │ • Categorization    │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                │                     │            │
│         └────────────────┼─────────────────────┘            │
│                          ▼                                  │
│                 ┌─────────────────┐                         │
│                 │   Index Store   │                         │
│                 │                 │                         │
│                 │ .seitonsan/     │                         │
│                 │ ├── index.json  │                         │
│                 │ ├── hashes.json │                         │
│                 │ └── links.json  │                         │
│                 └────────┬────────┘                         │
│                          │                                  │
│                          ▼                                  │
│                 ┌─────────────────┐                         │
│                 │  Action Engine  │                         │
│                 │                 │                         │
│                 │ • Recommendations│                        │
│                 │ • Interactive UI │                        │
│                 │ • Safe cleanup   │                        │
│                 └─────────────────┘                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Development Phases

### Phase 1: Foundation (MVP)
**Goal:** Basic scanning and duplicate detection

```
Features:
├── CLI scaffold (TypeScript, Commander.js)
├── File scanner with metadata extraction
├── Content hashing for exact duplicates
├── Fuzzy matching for similar files
├── Basic reporting (terminal output)
└── Init/config system
```

**Commands available:**
- `seitonsan init`
- `seitonsan scan`
- `seitonsan duplicates`
- `seitonsan report`

### Phase 2: Link Analysis
**Goal:** Orphan detection and broken link finding

```
Features:
├── Markdown link parser
├── Internal link graph builder
├── Orphan detection (no incoming links)
├── Broken link detection
├── Link report visualization
└── Support for wiki-style [[links]]
```

**Commands available:**
- `seitonsan orphans`
- `seitonsan broken-links`
- `seitonsan links [file]`

### Phase 3: Structure Analysis
**Goal:** Folder organization recommendations

```
Features:
├── Directory depth analysis
├── Naming convention detection
├── Empty directory finder
├── Oversized directory detection
├── Structure recommendations
└── Naming consistency checker
```

**Commands available:**
- `seitonsan structure`
- `seitonsan naming`
- `seitonsan empty`

### Phase 4: Staleness & Lifecycle
**Goal:** Time-based analysis and archival

```
Features:
├── Last-modified tracking
├── Staleness scoring (age + links + size)
├── Archive recommendations
├── Git history integration (last commit)
├── Activity heatmaps
└── Lifecycle stage detection (draft/active/stale/archive)
```

**Commands available:**
- `seitonsan stale`
- `seitonsan lifecycle`
- `seitonsan suggest-archive`
- `seitonsan archive`

### Phase 5: Cleanup Engine
**Goal:** Safe, interactive cleanup operations

```
Features:
├── Interactive cleanup wizard
├── Dry-run mode (preview changes)
├── Undo support (move to .seitonsan/trash/)
├── Batch operations
├── Confirmation prompts
└── Cleanup reports
```

**Commands available:**
- `seitonsan tidy`
- `seitonsan clean --interactive`
- `seitonsan clean --dry-run`
- `seitonsan undo`

### Phase 6: AI Integration
**Goal:** Content-aware analysis

```
Features:
├── Document summarization
├── Contradiction detection
├── Missing documentation finder
├── Auto-categorization
├── Semantic duplicate detection
├── Outdated reference detection
└── Content relationship mapping
```

**Commands available:**
- `seitonsan analyze --ai`
- `seitonsan summarize`
- `seitonsan contradictions`
- `seitonsan categorize`
- `seitonsan relate`

### Phase 7: Ecosystem Integration
**Goal:** Connect with Spidersan, Mappersan, Myceliumail

```
Features:
├── Spidersan: Register cleanup branches
├── Mappersan: Update docs after cleanup
├── Myceliumail: Notify agents of changes
├── Git hooks: Prevent clutter in commits
├── CI integration: Clutter score in PRs
└── Watch mode: Real-time clutter alerts
```

**Commands available:**
- `seitonsan hook --pre-commit`
- `seitonsan watch`
- `seitonsan ci-check`
- `seitonsan sync-spidersan`

## Configuration

### Config File: `.seitonsan.json`
```json
{
  "include": ["docs/", "content/", "*.md"],
  "exclude": ["node_modules/", ".git/", "dist/"],
  "duplicates": {
    "similarity_threshold": 0.85,
    "min_size": 100
  },
  "stale": {
    "days": 90,
    "ignore_patterns": ["archive/*", "historical/*"]
  },
  "naming": {
    "convention": "kebab-case",
    "extensions": [".md", ".txt", ".rst"]
  },
  "ai": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514"
  },
  "cleanup": {
    "archive_dir": ".seitonsan/archive/",
    "trash_dir": ".seitonsan/trash/",
    "require_confirmation": true
  }
}
```

### Environment Variables
```bash
SEITONSAN_AI_KEY=...          # API key for AI features
SEITONSAN_AUTO_ARCHIVE=true   # Auto-archive on cleanup
SEITONSAN_VERBOSE=true        # Verbose output
```

## Example Workflows

### Workflow 1: Weekly Cleanup
```bash
# Monday morning document hygiene
seitonsan scan ./docs
seitonsan report

# Review duplicates
seitonsan duplicates
seitonsan clean --interactive --duplicates

# Check for orphans
seitonsan orphans
seitonsan archive docs/orphaned/*.md

# Verify no broken links
seitonsan broken-links
```

### Workflow 2: Pre-Release Audit
```bash
# Before release, ensure docs are clean
seitonsan analyze --ai

# Fix contradictions
seitonsan contradictions

# Remove WIP markers
seitonsan scan --markers "WIP,TODO,DRAFT,FIXME"

# Ensure no broken links
seitonsan broken-links --strict
```

### Workflow 3: Repository Rescue
```bash
# Inherited a messy repo
seitonsan scan . --deep
seitonsan report --json > clutter-report.json

# Triage: what's safe to delete?
seitonsan tidy --safe-only

# Interactive cleanup
seitonsan clean --interactive

# Generate new structure
seitonsan structure --suggest
```

## Treebird Ecosystem Integration

```
┌──────────────────────────────────────────────────────────┐
│                   TREEBIRD ECOSYSTEM                      │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  SEITONSAN          SPIDERSAN          MAPPERSAN         │
│  ──────────         ──────────         ──────────        │
│  Declutter &        Branch             Auto-generate     │
│  organize docs      coordination       documentation     │
│       │                  │                  │            │
│       │                  │                  │            │
│       └──────────────────┼──────────────────┘            │
│                          │                               │
│                          ▼                               │
│                    MYCELIUMAIL                           │
│                    ────────────                          │
│                    Agent messaging                       │
│                    & coordination                        │
│                                                          │
└──────────────────────────────────────────────────────────┘

Integration Points:
─────────────────────
• Seitonsan cleans → Mappersan regenerates docs
• Seitonsan archives → Spidersan updates registry
• Seitonsan finds conflicts → Myceliumail notifies agents
• Spidersan rescue → Seitonsan analyzes salvaged branches
```

## Comparison: Seitonsan vs Existing Tools

| Feature | Seitonsan | fdupes | rmlint | DocInventory |
|---------|-----------|--------|--------|--------------|
| Duplicate detection | ✅ | ✅ | ✅ | ✅ |
| Fuzzy/similar matching | ✅ | ❌ | ❌ | ❌ |
| Orphan detection | ✅ | ❌ | ❌ | ✅ |
| Broken link finding | ✅ | ❌ | ❌ | ✅ |
| Structure analysis | ✅ | ❌ | ❌ | ❌ |
| AI content analysis | ✅ | ❌ | ❌ | ❌ |
| Git integration | ✅ | ❌ | ❌ | ❌ |
| Interactive cleanup | ✅ | ✅ | ✅ | ❌ |
| Document-aware | ✅ | ❌ | ❌ | ✅ |
| Ecosystem integration | ✅ | ❌ | ❌ | ❌ |

## Tech Stack

```
Runtime:        Node.js 18+
Language:       TypeScript 5.x
CLI Framework:  Commander.js
File Hashing:   crypto (Node built-in)
Fuzzy Match:    fast-levenshtein / fuzzball
Link Parser:    unified/remark ecosystem
AI Provider:    Anthropic Claude API
Storage:        Local JSON (upgradeable to Supabase)
Testing:        Vitest
```

## Success Metrics

| Metric | Target |
|--------|--------|
| Scan speed | 10,000 files < 10 seconds |
| Duplicate accuracy | 95%+ precision |
| Orphan detection | 99%+ recall |
| False positive rate | < 5% |
| User satisfaction | Reduce cleanup time by 80% |

---

## Getting Started (Future)

```bash
# Install
npm install -g seitonsan

# Initialize in your docs folder
cd my-project/docs
seitonsan init

# Run first scan
seitonsan scan

# See what's cluttered
seitonsan report

# Start cleaning
seitonsan tidy
```

---

**Status:** Roadmap / Concept Design
**Target:** Sister project to Spidersan & Mappersan
**Philosophy:** "A place for everything, everything in its place"
