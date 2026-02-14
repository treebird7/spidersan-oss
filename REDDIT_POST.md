# Reddit Post: Spidersan Auto-Register Feature

---

**Title:** I built a GitHub Actions workflow to prevent AI agents from stepping on each other's toes

**Body:**

Hey folks! Solo dev here working on a problem I kept running into: multiple AI coding agents (Claude Code, Cursor, Copilot, etc.) creating merge conflicts when they work on the same codebase.

## The Problem

I use Claude Code on my laptop and Cursor on my desktop. Both are amazing, but they have zero awareness of each other. So this kept happening:

```
Me on laptop (Claude Code): Refactors auth.ts
Me on desktop (Cursor): Also refactors auth.ts
Me 2 hours later: 💥 Merge conflict hell
```

Even with my own tool (Spidersan - a CLI for tracking which agent is working on which files), I'd forget to run `spidersan register` before pushing. Classic "automate the thing you keep forgetting" situation.

## The Solution

I built a GitHub Actions workflow that auto-registers branches whenever you push. Zero manual work.

**How it works:**
1. Push to any branch
2. Workflow detects agent name from branch prefix (`claude/feature` → `claude`)
3. Detects changed files via git diff
4. Runs conflict detection
5. Warns if multiple agents are editing the same files

**Example:**
```bash
# Claude Code on laptop
git checkout -b claude/new-api
# Edit src/api.ts
git push
# ✅ Auto-registered in ~15 seconds

# Cursor on desktop (later)
git checkout -b cursor/api-improvements
# Also edit src/api.ts
git push
# 🟠 CONFLICT WARNING in GitHub Actions
# "src/api.ts already modified by claude/new-api"
```

Now I get a heads-up BEFORE wasting time on conflicting work.

## Current State

- Works on every push (except main/staging)
- ~15 second registration time
- Free to use (runs in GitHub Actions free tier)
- Handles edge cases (first push to new branch, empty commits, etc.)

## Why I'm Posting

1. **Looking for feedback:** Is this actually useful to others, or am I solving a very niche problem?

2. **Invite collaboration:** Code is MIT licensed, and I'd love help with:
   - Testing on different repo structures
   - Ideas for better conflict detection
   - Integration with other AI coding tools

3. **Curious about your setup:** How do YOU coordinate when using multiple AI agents? Or is this not a problem people face?

## Links

- GitHub: [spidersan-oss](https://github.com/treebird7/spidersan-oss)
- Installation guide: [INSTALL_AUTO_REGISTER.md](https://github.com/treebird7/spidersan-oss/blob/main/INSTALL_AUTO_REGISTER.md)
- Just the workflow file: [auto-register.yml](https://github.com/treebird7/spidersan-oss/blob/main/.github/workflows/auto-register.yml)

You can literally just copy the workflow file to your repo and it works. No dependencies on the main Spidersan CLI (though it helps for local monitoring).

## Questions I'm Expecting

**Q: Why not just use branch protection rules?**
A: Those prevent merges, but don't tell you about conflicts *while you're working*. This gives you a heads-up early.

**Q: Does this work without the Spidersan CLI?**
A: The workflow installs it automatically via npm in the CI environment. No local install needed (but recommended for `spidersan watch`).

**Q: What if I don't use AI agents?**
A: Still works! Useful for any team where multiple people might edit the same files on different branches.

**Q: Performance impact?**
A: Zero - it's metadata-only. Doesn't touch your code, just tracks what's being modified.

---

Anyway, would love to hear thoughts, criticism, or "you're solving a problem that doesn't exist" feedback. Also happy to answer questions if this is interesting to anyone.

Built this for myself but figured I'd share in case others are dealing with the same chaos.

Cheers! 🕷️

---

**Subreddit suggestions:**
- r/programming
- r/opensource
- r/MachineLearning (if framed around AI agent workflows)
- r/ChatGPTCoding
- r/ClaudeAI

**Flair suggestions:**
- [Project]
- [Show and Tell]
- [Open Source]
