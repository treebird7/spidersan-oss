---
tags: [spidersan, core, public, features]
---

# Spidersan Core — Public Feature Set

**Version:** 0.4.0+  
**License:** MIT  
**Audience:** All users  
**Status:** Stable, production-ready

---

## What is Spidersan Core?

Branch coordination for AI coding agents. When multiple AI agents work on the same codebase simultaneously, Spidersan helps them:

1. **Register** what they're modifying
2. **Detect** file conflicts early
3. **Coordinate** safe merge order
4. **Verify** readiness before merging

Simple. Focused. Offline-first. 15 commands.

---

## Core Commands (15)

### Registration & Visibility
- **`spidersan init`** — Initialize Spidersan in a project (creates local registry)
- **`spidersan register`** — Register a branch with files you're modifying
- **`spidersan list`** — List all registered branches and their status

### Conflict Detection
- **`spidersan conflicts`** — Show file conflicts between branches (tiered by risk)
- **`spidersan depends`** — Declare that your branch depends on another (optional Supabase sync)
- **`spidersan merge-order`** — Get a merge sequence based on dependencies (heuristic, not guaranteed)

### Readiness Checks
- **`spidersan ready-check`** — Verify branch is ready to merge (no WIP markers, lint clean)

### Branch Lifecycle
- **`spidersan stale`** — Find branches older than N days (default: 7)
- **`spidersan cleanup`** — Remove stale branches from registry
- **`spidersan abandon`** — Mark branch as abandoned (work stopped)
- **`spidersan merged`** — Mark branch as merged (include PR number if available)
- **`spidersan sync`** — Sync registry with current git state

### Monitoring & Diagnostics
- **`spidersan watch`** — File watcher daemon (auto-detects changes, maintains registry)
- **`spidersan doctor`** — Diagnose issues (missing files, stale state, corruption)

---

## Core Concepts

### Tiered Conflicts

Spidersan classifies conflicts by risk:

| Tier | Risk | Examples | Action |
|------|------|----------|--------|
| 1 🟡 | WARN | `.md`, `.json`, `.css` | Review if needed |
| 2 🟠 | PAUSE | Tests, migrations, API types | Coordinate |
| 3 🔴 | BLOCK | `package.json`, `.env`, core lib | Must resolve |

### Merge Order is a Heuristic

`merge-order` suggests a sequence based on file overlaps, but:
- ✅ Modern Git handles most conflicts automatically
- ✅ Used for **visibility** (see dependencies)
- ✅ Not a guarantee (teams still need to coordinate)
- ⚠️ Won't prevent conflicts in fundamentally incompatible changes

Use it to answer: "In what order should we merge?" not "Will this work?"

### Optional Supabase Sync

By default, Spidersan stores state locally (SQLite in `.spidersan/`).

`spidersan depends` can optionally sync to Supabase for team visibility:
```bash
spidersan depends feature/auth --cloud  # Store in Supabase
spidersan depends feature/auth          # View (local or synced)
```

Not required. Useful for coordinated teams.

---

## Storage

### Local (Default)
```
.spidersan/
├── registry.db         # SQLite: branches, files, status
├── state.json          # Current session state
└── messages.json       # Local message fallback
```

**No setup needed.** Works offline. Perfect for solo development or local teams.

### Cloud (Optional)
```bash
export SUPABASE_URL=your-url
export SUPABASE_SERVICE_KEY=your-key
spidersan depends feature/auth --cloud
```

**Supabase required.** Enables cross-team visibility. Optional.

---

## Use Cases

### Solo Development
You're working on a feature branch and want to know if other branches conflict:
```bash
spidersan init
spidersan register --files src/auth.ts,src/api.ts
spidersan conflicts  # See what's conflicting with you
```

### Multi-Agent Coordination
Several AI agents working on the same repo:
```bash
# Agent 1
spidersan register feature/auth --files src/auth.ts

# Agent 2
spidersan register feature/api --files src/api.ts

# Team lead
spidersan conflicts              # See all conflicts
spidersan merge-order            # Get safe sequence
spidersan merge-order --blocking-count  # Show priority
```

### Continuous Integration
In CI/CD before merge:
```bash
spidersan sync              # Sync with latest git
spidersan conflicts --strict  # Fail if TIER 2+ conflicts
spidersan ready-check         # Verify merge safety
```

---

## Getting Started

### Installation
```bash
npm install -g spidersan
```

### First Time
```bash
cd your-project
spidersan init              # Create .spidersan/ directory
spidersan register --files "src/**/*.ts"  # Register your files
spidersan conflicts         # See what conflicts with you
```

### Daily Workflow
```bash
# Start work
spidersan register my-feature --files src/component.tsx

# Throughout the day
spidersan conflicts  # Check periodically

# Before merging
spidersan ready-check
spidersan merge-order    # See merge sequence

# After merging
spidersan merged --pr 123  # Mark branch as done
```

---

## Advanced Usage

### Conflict Tiers
```bash
spidersan conflicts --tier 2      # Show only PAUSE/BLOCK
spidersan conflicts --tier 3      # Show only BLOCK
spidersan conflicts --strict      # Exit 1 if TIER 2+ (for CI)
```

### Merge Order with Blocking Count
```bash
spidersan merge-order --blocking-count

# Output: Shows which tasks block the most others
# Merge "rarest blockers" first (fewer dependencies)
```

### File-Level Tracking
```bash
spidersan register my-branch --files src/auth.ts src/api.ts src/types.ts
spidersan register --update  # Re-register without specifying files
```

### Cleanup & Maintenance
```bash
spidersan stale --days 14        # Find branches older than 2 weeks
spidersan cleanup --dry-run      # Preview what will be removed
spidersan cleanup                # Actually remove stale branches
spidersan sync --all             # Force full sync with git
```

---

## When to Use Ecosystem Features

**Core Spidersan** is for:
- ✅ Seeing what conflicts
- ✅ Coordinating merge order
- ✅ Checking readiness

**Spidersan Ecosystem** (internal plugin) adds:
- 🚀 Prevent conflicts with symbol locking (distributed CRDT)
- 🚀 Detect duplicate work before coding starts
- 🚀 Monitor branch activity in real-time dashboards
- 🚀 Semantic analysis of code intent
- 🚀 Distribute tasks across agents

Start with core. Add ecosystem when you need it.

---

## Common Questions

**Q: Does this prevent merge conflicts?**  
A: No. It helps you *see* and *coordinate around* conflicts. Git itself handles most technical conflicts; Spidersan helps humans coordinate.

**Q: What if I'm working alone?**  
A: Still useful! Tracks your branches, helps you notice stale work, keeps history clean.

**Q: Do I need Supabase?**  
A: No. Local SQLite works great. Supabase is optional for team sync.

**Q: Can I use this with GitHub, GitLab, Bitbucket?**  
A: Yes. Spidersan tracks branches locally; works with any Git host.

**Q: What about private branches?**  
A: All data stays local by default. Supabase sync is opt-in.

---

## Troubleshooting

### Commands not found
```bash
which spidersan         # Verify installation
npm install -g spidersan  # Reinstall if needed
```

### Conflicts not showing
```bash
spidersan sync          # Force sync with git
spidersan doctor        # Check for corrupted state
rm -rf .spidersan       # Nuclear option: reset state
spidersan init          # Reinitialize
```

### Stale registry
```bash
spidersan stale --days 365
spidersan cleanup
```

---

## Philosophy

**Simple:** 15 focused commands. Learn them in 5 minutes.

**Local-first:** Works offline. No cloud account required.

**Clear boundaries:** Knows what it does (coordination), doesn't try to solve merging itself (that's Git).

**Honest messaging:** `merge-order` is a heuristic. `merge-order` is visibility. Modern Git is good; Spidersan helps humans coordinate better.

---

## Next: Ecosystem Features

Ready for more? The Spidersan Ecosystem (internal plugin) covers advanced team coordination features.

Or stick with core. Both are great. 🕷️
