---
name: install-auto-register
description: Install Spidersan auto-register workflow in current repository
version: 1.0.0
author: Treebird
tags: [spidersan, github-actions, workflow, automation]
---

# Install Auto-Register Skill

**Quickly install the Spidersan auto-register GitHub Actions workflow in any repository.**

## Usage

```
/install-auto-register
```

## What This Does

1. Checks if workflow already exists
2. Creates `.github/workflows/` directory if needed
3. Copies `auto-register.yml` from spidersan-oss repo
4. Commits and pushes the workflow
5. Verifies installation
6. Provides next steps

## Requirements

- Repository must be a git repo
- Must have spidersan-oss repo accessible (or downloads from GitHub)
- GitHub Actions must be enabled

## Steps Performed

### 1. Pre-flight Checks
- Verify current directory is a git repository
- Check if workflow already exists
- Confirm GitHub Actions directory structure

### 2. Install Workflow
- Create `.github/workflows/` if missing
- Copy or download `auto-register.yml`
- Verify file integrity

### 3. Commit Changes
- Stage the workflow file
- Create commit with standard message
- Push to origin/main (or current branch)

### 4. Verification
- Check workflow file exists
- List available workflows
- Show next steps

## Example Output

```
🕷️ Installing Spidersan Auto-Register Workflow

✅ Pre-flight checks:
   - Git repository: ✓
   - GitHub Actions: ✓
   - Workflow exists: ✗ (will create)

📥 Downloading workflow file...
✅ Created: .github/workflows/auto-register.yml

📝 Committing changes...
✅ Committed: feat: add spidersan auto-register workflow

🚀 Pushing to origin...
✅ Pushed to origin/main

🎉 Installation Complete!

Next steps:
1. Create a test branch: git checkout -b test/auto-register
2. Push to trigger: git push origin test/auto-register
3. View runs: gh run list --workflow=auto-register.yml

Documentation: INSTALL_AUTO_REGISTER.md
```

## Options

You can customize the installation by editing the workflow file after installation:

- **Change ignored branches:** Edit `branches-ignore` section
- **Add Supabase sync:** Add SUPABASE_URL and SUPABASE_KEY secrets
- **Modify conflict tiers:** Change `--tier 2` to `--tier 1` or `--tier 3`

## Troubleshooting

### Workflow Not Found
If spidersan-oss repo is not accessible, the skill will download from GitHub:
```
https://raw.githubusercontent.com/treebird7/spidersan-oss/main/.github/workflows/auto-register.yml
```

### Permission Denied
Ensure you have write access to the repository:
```bash
git remote -v  # Verify you can push
```

### Already Exists
If workflow already exists, skill will ask to:
- Skip (keep existing)
- Overwrite (update to latest)
- Compare (show diff)

## Related

- [Installation Guide](../../INSTALL_AUTO_REGISTER.md)
- [Use Cases](../../AUTO_REGISTER_USE_CASES.md)
- [Main README](../../README.md)
