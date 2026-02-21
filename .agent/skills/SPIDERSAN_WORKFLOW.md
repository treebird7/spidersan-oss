---
description: How to use spidersan effectively for branch coordination and multi-agent task management
globs: ["src/**", "*.ts", "*.md"]
---

# Spidersan Workflow Skill 🕷️

Field-tested patterns for using spidersan in real multi-agent sessions.

## 1. The Triage Pipeline (Most Valuable Pattern)

When entering a repo with unknown branch state:

```bash
# Step 1: See everything
spidersan list

# Step 2: Find file conflicts between branches
spidersan conflicts

# Step 3: Get merge sequencing
spidersan merge-order
```

This pipeline turns "N mystery branches" into an action plan. Always run all three — the value is in the combination.

## 2. Task Decomposition at Scale (Torrent)

For large task sets (10+ tasks, multiple agents):

```bash
# Decompose top-level into workstreams (stays on current branch)
spidersan torrent decompose PROJECT -c 4

# Decompose each workstream into sub-tasks
spidersan torrent decompose PROJECT-A -c 8 --agent sherlocksan

# Visualize the full tree
spidersan torrent tree

# Check merge order (conflict-free first)
spidersan torrent merge-order

# Filter by workstream
spidersan torrent status --parent PROJECT-A
```

**Key:** Use `decompose` for planning (no branch switching), `create` only when an agent is ready to start coding.

## 3. Pre-Work Checklist

Before modifying any files:

```bash
spidersan conflicts          # Check for overlaps
spidersan register -f "src/auth.ts,src/api.ts"   # Declare intent
```

## 4. Known Workarounds

### Supabase env override
If `.env` has Supabase creds that fail auth:
```bash
SUPABASE_URL= SUPABASE_KEY= spidersan <command>
```

### Registry is branch-local
The registry lives in `.spidersan/registry.json` in the git tree. When switching branches, you see that branch's snapshot. Stay on main for global visibility.

### Register files for another branch
`register` only works for current branch. To register files for a task branch without switching:
```python
# Edit .spidersan/registry.json directly
import json
reg = json.load(open('.spidersan/registry.json'))
reg['branches']['task/MY-TASK']['files'] = ['src/auth.ts']
reg['branches']['task/MY-TASK']['agent'] = 'myagent'
json.dump(reg, open('.spidersan/registry.json', 'w'), indent=2)
```

### Global conflicts without registering main
`spidersan conflicts` errors if current branch isn't registered. Use `spidersan list` + visual inspection, or register main with empty files first.

## 5. What to Use When

| Goal | Command |
|------|---------|
| "What branches exist?" | `spidersan list` |
| "Any file conflicts?" | `spidersan conflicts` |
| "What order to merge?" | `spidersan merge-order` |
| "Break big task into pieces" | `spidersan torrent decompose` |
| "See full task state" | `spidersan torrent tree` |
| "Which tasks have conflicts?" | `spidersan torrent status` |
| "Is this branch ready?" | `spidersan ready-check` |
| "Clean up dead branches" | `spidersan abandoned` then `spidersan cleanup` |

## 6. What NOT to Use

| Situation | Don't | Do Instead |
|-----------|-------|------------|
| Extract one file from a branch | `spidersan rescue` | `git checkout <branch> -- <file>` |
| Quick conflict check | `spidersan conflicts --wake` | `spidersan conflicts` (skip Hub) |
| Hub is offline | Any `--notify` flag | Skip it, adds noise |

## Related

- Field test results: [[docs/FIELD_TEST_USE_CASES]]
- Test fixture: `tests/fixtures/mammoth-registry.json` (41 tasks, 5 agents)
- General docs: [[docs/USE_CASES]], [[docs/AGENT_GUIDE]]
