---
description: Sync all repos with conflict detection before commit/push
---

# /git-sync Workflow (Spidersan-Style)

Commit and push changes across all /Dev repositories with conflict detection.

## Steps

### 1. Scan All Repositories

// turbo
```bash
find /Users/freedbird/Dev -maxdepth 2 -name ".git" -type d | while read gitdir; do
  repo=$(dirname "$gitdir")
  echo "📁 $(basename $repo)"
  cd "$repo"
  
  # Check for uncommitted changes
  if [[ -n $(git status --porcelain) ]]; then
    echo "   ⚠️  Uncommitted changes"
    git status --short
  fi
  
  # Check for unpushed commits
  unpushed=$(git log @{u}..HEAD --oneline 2>/dev/null | wc -l | xargs)
  if [[ "$unpushed" -gt 0 ]]; then
    echo "   📤 $unpushed unpushed commits"
  fi
  
  echo ""
done
```

### 2. Check for Conflicts (Spidersan-Style)

For each repo with changes, run conflict detection:

// turbo
```bash
cd /Users/freedbird/Dev/<repo>
spidersan conflicts --tier 2
```

**Conflict Tiers:**
| Tier | Icon | Action |
|------|------|--------|
| 1 🟡 WARN | Proceed with caution |
| 2 🟠 PAUSE | Coordinate first |
| 3 🔴 BLOCK | Must resolve |

### 3. Stage and Commit (Per Repo)

For repos with changes and NO blocking conflicts:

```bash
cd /Users/freedbird/Dev/<repo>
git add -A
git status
# Review what's being committed
git commit -m "<type>: <description>"
```

**Commit types:**
- `feat:` — New feature
- `fix:` — Bug fix
- `reflex:` — Skill/pattern learning
- `docs:` — Documentation
- `chore:` — Maintenance

### 4. Pull Before Push (Safety)

// turbo
```bash
git pull --rebase origin $(git branch --show-current)
```

If conflicts arise during rebase:
1. Resolve manually
2. `git add <resolved-files>`
3. `git rebase --continue`

### 5. Push

// turbo
```bash
git push origin $(git branch --show-current)
```

### 6. Post-Push Verification

// turbo
```bash
# Verify push succeeded
git log -1 --oneline
echo "✅ Pushed to $(git remote get-url origin)"
```

---

## Quick Commands

| Command | Purpose |
|---------|---------|
| `git status --short` | One-line status per file |
| `git diff --stat` | Summary of changes |
| `git stash` | Temporarily save uncommitted work |
| `git log --oneline -5` | Last 5 commits |
| `spidersan conflicts` | Check for file conflicts |
| `spidersan ready-check` | Validate merge-readiness |

---

## Multi-Repo Quick Scan

// turbo
```bash
for repo in Spidersan Artisan treebird-hub treebird-internal Myceliumail Watsan Envoak; do
  echo "=== $repo ==="
  cd "/Users/freedbird/Dev/$repo" 2>/dev/null && git status --short || echo "  (not found)"
done
```

---

*"The web senses all changes. Push only when the strands are clear."* 🕷️
