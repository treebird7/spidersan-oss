# Claude Code Skills for Spidersan

This directory contains skills that Claude Code agents can use to automate common Spidersan tasks.

## Available Skills

### `/install-auto-register`

**Description:** Automatically install the Spidersan auto-register GitHub Actions workflow in any repository.

**Usage:**
```bash
# From any repository
/install-auto-register

# Or run the script directly
/path/to/spidersan/.claude/skills/install-auto-register.sh
```

**What it does:**
1. Checks if workflow already exists
2. Downloads or copies `auto-register.yml`
3. Creates `.github/workflows/` directory if needed
4. Commits the workflow file
5. Optionally pushes to origin
6. Shows next steps for testing

**Documentation:** [install-auto-register.md](./install-auto-register.md)

---

## For Claude Code Agents

When a user asks you to:
- "Install spidersan auto-register"
- "Add the auto-register workflow"
- "Set up automatic branch registration"
- "Enable spidersan GitHub Actions"

You can:

1. **Use the script:**
   ```bash
   /path/to/spidersan/.claude/skills/install-auto-register.sh
   ```

2. **Or manually:**
   ```bash
   # Copy workflow file
   mkdir -p .github/workflows
   cp /path/to/spidersan/.github/workflows/auto-register.yml .github/workflows/

   # Commit and push
   git add .github/workflows/auto-register.yml
   git commit -m "feat: add spidersan auto-register workflow"
   git push origin main
   ```

3. **Then verify:**
   ```bash
   # Create test branch
   git checkout -b test/auto-register
   echo "test" >> README.md
   git add README.md
   git commit -m "test: verify auto-register"
   git push origin test/auto-register

   # Check workflow runs
   gh run list --workflow=auto-register.yml --limit 1
   ```

---

## Creating New Skills

To add a new skill:

1. Create a `.md` file with frontmatter:
   ```markdown
   ---
   name: skill-name
   description: What it does
   version: 1.0.0
   ---

   # Skill Documentation
   ```

2. Optionally create a `.sh` script for automation

3. Update this README

4. Test with Claude Code

---

## Resources

- [Installation Guide](../../INSTALL_AUTO_REGISTER.md)
- [Use Cases](../../AUTO_REGISTER_USE_CASES.md)
- [Main README](../../README.md)
