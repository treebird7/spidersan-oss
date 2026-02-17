# 🤖 Installing Spidersan Auto-Register Workflow

**5-minute setup for automatic branch registration**

---

## 📋 What This Does

When installed, every push to your repo automatically:
- ✅ Registers branches with Spidersan
- ✅ Detects changed files
- ✅ Checks for conflicts
- ✅ Reports warnings in GitHub Actions

**No manual `spidersan register` needed!**

---

## 🚀 Quick Install (3 Steps)

### Step 1: Copy the Workflow File

**Option A: From spidersan-oss repo (recommended)**
```bash
# If you have spidersan-oss cloned
cd /path/to/your/repo
mkdir -p .github/workflows
cp /path/to/spidersan-oss/.github/workflows/auto-register.yml .github/workflows/
```

**Option B: Download directly**
```bash
cd /path/to/your/repo
mkdir -p .github/workflows
curl -o .github/workflows/auto-register.yml \
  https://raw.githubusercontent.com/treebird7/spidersan-oss/main/.github/workflows/auto-register.yml
```

**Option C: Manual copy**
1. Open [auto-register.yml](https://github.com/treebird7/spidersan-oss/blob/main/.github/workflows/auto-register.yml)
2. Copy the entire file content
3. Create `.github/workflows/auto-register.yml` in your repo
4. Paste the content

### Step 2: Commit and Push

```bash
git add .github/workflows/auto-register.yml
git commit -m "feat: add spidersan auto-register workflow"
git push origin main
```

### Step 3: Test It!

```bash
# Create a test branch
git checkout -b test/auto-register
echo "test" > test.txt
git add test.txt
git commit -m "test: verify auto-register works"
git push origin test/auto-register

# View the workflow run
gh run list --workflow=auto-register.yml --limit 1
# Or visit: https://github.com/YOUR_USERNAME/YOUR_REPO/actions
```

**That's it! ✅**

---

## 🎯 What Happens Next

Every time you (or an AI agent) pushes to a branch:

1. **GitHub Actions triggers** (~2 seconds after push)
2. **Workflow runs** these steps:
   - Checkout code
   - Install Spidersan
   - Initialize Spidersan
   - Extract agent name from branch (e.g., `claude/feature` → `claude`)
   - Detect changed files via git diff
   - Register branch: `spidersan register --agent X --files Y`
   - Check conflicts: `spidersan conflicts --tier 2`
   - Report results

3. **Results appear** in GitHub Actions tab

**Total time:** ~15 seconds

---

## 🔍 Verify It's Working

### Check Workflow Status
```bash
# Command line
gh run list --workflow=auto-register.yml

# Or visit GitHub UI
# → Your repo → Actions tab → "Spidersan Auto-Register"
```

### Check Registration
```bash
# In your repo
spidersan list
# Should show your branch if it was registered
```

### View Logs
```bash
# Get the latest run ID
RUN_ID=$(gh run list --workflow=auto-register.yml --limit 1 --json databaseId --jq '.[0].databaseId')

# View logs
gh run view $RUN_ID --log
```

---

## 🛠️ Configuration (Optional)

### Customize Ignored Branches

Edit `.github/workflows/auto-register.yml`:

```yaml
on:
  push:
    branches-ignore:
      - main          # Don't register main
      - staging/*     # Don't register staging branches
      - release/*     # Add: Don't register release branches
      - hotfix/*      # Add: Don't register hotfix branches
```

### Add Supabase Sync (Optional)

For cross-machine registry sync:

1. **Get Supabase credentials:**
   - Sign up at [supabase.com](https://supabase.com)
   - Create a project
   - Get your project URL and API key

2. **Add GitHub secrets:**
   ```
   Repo → Settings → Secrets and variables → Actions → New repository secret

   Name: SUPABASE_URL
   Value: https://your-project.supabase.co

   Name: SUPABASE_KEY
   Value: your-anon-key
   ```

3. **Workflow automatically uses them!** (already configured)

---

## 📚 Advanced Usage

### Multiple Repos Setup

**Quick script to install in multiple repos:**

```bash
#!/bin/bash
# install-auto-register.sh

REPOS=(
  "/path/to/repo1"
  "/path/to/repo2"
  "/path/to/repo3"
)

WORKFLOW_FILE="/path/to/spidersan-oss/.github/workflows/auto-register.yml"

for repo in "${REPOS[@]}"; do
  echo "Installing in $repo..."
  mkdir -p "$repo/.github/workflows"
  cp "$WORKFLOW_FILE" "$repo/.github/workflows/auto-register.yml"

  cd "$repo"
  git add .github/workflows/auto-register.yml
  git commit -m "feat: add spidersan auto-register workflow"
  git push

  echo "✅ Installed in $repo"
done
```

### Integration with Existing CI

The workflow runs **independently** and won't interfere with:
- Existing GitHub Actions workflows
- Test runners
- Deployment pipelines
- Linters

It's purely metadata tracking - no code changes.

---

## ❓ Troubleshooting

### Workflow Not Running?

**Check triggers:**
```bash
# View recent pushes
git log --oneline --graph --all -10

# View workflow runs
gh run list --workflow=auto-register.yml --limit 5
```

**Common issues:**
- Pushed to `main` or `staging/*` (these are ignored by default)
- Workflow file not committed/pushed
- GitHub Actions disabled for repo

**Fix:**
```bash
# Verify file exists
ls -la .github/workflows/auto-register.yml

# Check GitHub Actions is enabled
# Repo → Settings → Actions → General → Allow all actions
```

### Registration Not Working?

**Check logs:**
```bash
gh run view LATEST_RUN_ID --log | grep -A 10 "Register with Spidersan"
```

**Common issues:**
- No files changed in push (skipped by `if: steps.commit.outputs.files != ''`)
- First push to branch (fixed in latest version)
- Spidersan not initialized (workflow should run `spidersan init`)

**Verify fix:**
```bash
# Make a change and push
echo "test" >> README.md
git add README.md
git commit -m "test: trigger workflow"
git push

# Watch it run
gh run watch $(gh run list --workflow=auto-register.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

### Conflicts Not Detected?

**The workflow only detects TIER 2+ conflicts by default.**

To see all conflicts locally:
```bash
spidersan conflicts --tier 1
```

To modify workflow to report TIER 1:
```yaml
# In .github/workflows/auto-register.yml
# Change line ~84:
CONFLICTS=$(spidersan conflicts --branch "${{ steps.commit.outputs.branch }}" --tier 1 --json 2>/dev/null || echo '{"conflicts":[]}')
```

---

## 🎓 Best Practices

### Branch Naming

Use prefixes to auto-detect agent names:
```
✅ claude/new-feature      → agent: claude
✅ cursor/bug-fix          → agent: cursor
✅ copilot/refactor        → agent: copilot
✅ yourname/experiment     → agent: yourname

❌ new-feature             → agent: github-username (fallback)
```

### Commit Messages

The workflow runs on **every push**, so:
- Push frequently to maintain visibility
- Each push updates the registry
- Conflicts detected within ~15 seconds

### Local + Remote Workflow

**Best practice:**
```bash
# 1. Start local watch (optional but recommended)
spidersan watch --agent yourname

# 2. Work on files
# (watch shows real-time conflicts)

# 3. Commit and push
git add .
git commit -m "feat: add feature"
git push
# (auto-register updates team registry)

# 4. Before merging
spidersan ready-check
spidersan merge-order
```

---

## 🔗 Resources

- **Full Documentation:** [README.md](./README.md)
- **Use Cases:** [AUTO_REGISTER_USE_CASES.md](./AUTO_REGISTER_USE_CASES.md)
- **Lessons Learned:** [SPIDERSAN_LESSONS_LEARNED.md](./SPIDERSAN_LESSONS_LEARNED.md) (Lesson #12)
- **Workflow Source:** [.github/workflows/auto-register.yml](./.github/workflows/auto-register.yml)

---

## 💡 Quick Reference

| Task | Command |
|------|---------|
| Install workflow | `cp auto-register.yml .github/workflows/` |
| Test workflow | `git push origin test/branch` |
| View runs | `gh run list --workflow=auto-register.yml` |
| View logs | `gh run view RUN_ID --log` |
| Check registry | `spidersan list` |
| Check conflicts | `spidersan conflicts` |
| Uninstall | `rm .github/workflows/auto-register.yml` |

---

## 🚀 Next Steps

Once installed:
1. ✅ Push to a branch to test
2. ✅ View the workflow run in GitHub Actions
3. ✅ Check `spidersan list` to see your registered branch
4. ✅ Share with your team or other AI agents
5. ✅ Enjoy conflict-free multi-agent development!

**Questions?** Open an issue at [spidersan-oss](https://github.com/treebird7/spidersan-oss/issues)

---

**Made with 🕷️ by Treebird**
