---
aliases: ["Spidersan Lessons"]
tags: [agent/spidersan, type/lesson]
---

# Spidersan Lessons Learned

## 1. Idempotent Migrations (Critical)
**Problem:** Migrations fail on re-run  
**Fix:** ALL SQL must use `IF NOT EXISTS` / `IF EXISTS`  
**Test locally before push**

## 2. One Feature = One Branch
**Problem:** Mixed unrelated work causes merge chaos  
**Fix:** Single-purpose branches only

## 3. Migration Number Collisions
**Problem:** Cross-repo migrations can overlap  
**Fix:** Spidersan uses 200+, Recovery-Tree uses 001-199

## 4. Duplicate Repos
**Problem:** Multiple clones cause divergent histories  
**Fix:** Single source of truth - one location per project

## 5. Always Use Storage Factory (12-Dec-25)
**Problem:** 9 commands used `new LocalStorage()` directly, ignoring Supabase config  
**Fix:** Always use `await getStorage()` - it auto-detects backend from env vars  
**Pattern:**
```typescript
// ❌ Wrong - bypasses Supabase
const storage = new LocalStorage();

// ✅ Right - uses factory
const storage = await getStorage();
```

## 6. macOS Case Sensitivity Git Staging (16-Dec-25)
**Problem:** `git add CLAUDE.md` fails silently when file was tracked as `claude.md`
**Cause:** macOS filesystem is case-insensitive, git is case-sensitive
**Symptom:** `git status` shows modified, but `git add` does nothing
**Fix:** Rename via temp file:
```bash
mv CLAUDE.md _CLAUDE.md && git add -A && git commit -m "temp"
mv _CLAUDE.md CLAUDE.md && git add CLAUDE.md && git commit -m "fix"
```
**Prevention:** Use consistent casing from the start

## 7. WIP Detection False Positives in Generated Files (10-Feb-26)
**Problem:** `spidersan ready-check` flags "WIP", "HACK", "XXX" tokens found inside cryptographic hashes in `package-lock.json`
**Cause:** Generated lock files contain SHA-512 hashes which are statistically likely to spell out common English words by coincidence
**Symptom:** `ready-check` reports WIP markers on files developer didn't modify, forcing use of `--skip-wip` or `--no-verify`
**Impact:** 10-15 minutes wasted per session debugging false positives
**Fix:** Exclude generated lock files from WIP pattern scanning in `src/lib/config.ts`:
```typescript
excludeFiles: [
  'tests/**',
  '*.test.js',
  '*.test.ts',
  '*.md',
  '**/docs/**',
  '**/package-lock.json',  // ← NEW
  '**/yarn.lock',          // ← NEW
  '**/pnpm-lock.yaml'      // ← NEW
]
```
**Lesson:** Safety checks should be file-type aware. Hashes in generated files are not meaningful markers.
**Broader Pattern:** Detection systems need context. Don't just pattern-match blindly across all file types.
**Prevention:** When adding safety checks, always consider which file types should be scanned and which should be excluded.

## 8. Agent Playbook: Spidersan Use Cases (10-Feb-26)
**Purpose:** Guidance for agents using Spidersan in multi-repo coordination workflows.

**Core patterns:**
- **Register before changing** — Always run `spidersan register --files "..."` when creating a branch to make intent discoverable.
- **Check conflicts early** — Run `spidersan conflicts` (use `--tier` or `--semantic` when needed) before rebasing or pushing.
- **Run ready-check pre-PR** — Use `spidersan ready-check` to catch WIP markers and conflicting files; use `--skip-wip` only when you understand the false-positive risk.
- **Preserve incoming add/add variants** — If two agents add the same file, prefer preserving the incoming variant as `<file>.incoming` for auditability and include a canonical merged version.
- **Use rebase-helper for stuck rebases** — When local git opens an editor or a rebase is in progress, run `spidersan rebase-helper` for non-interactive diagnostics and guidance.
- **File-type awareness** — Prefer excluding generated files (lockfiles, binary artifacts) from WIP scanning and other pattern checks.

**Operational tips:**
- Keep changes small and testable (one feature per branch).
- If `ready-check` flags many issues, prioritize addressing TIER 3/TIER 2 items first.
- Document any `--skip-wip` decisions in the PR body and link to the lesson in `SPIDERSAN_LESSONS_LEARNED.md`.

**Why this matters:** These patterns reduce wasted time, prevent unsafe merges, and make cross-agent collaboration auditable.

## 9. npm `"files"` Field Overrides `.npmignore` (18-Feb-26)
**Problem:** Added `!CHANGELOG.md` to `.npmignore` negation — still excluded from published package.  
**Root cause:** When `"files"` is set in `package.json`, it takes full precedence. `.npmignore` negations are irrelevant.  
**Fix:** Add files explicitly to the `"files"` array in `package.json`.  
**Pattern:**
```json
// ✅ Correct
"files": ["dist", "README.md", "CHANGELOG.md", "LICENSE.md"]

// ❌ Wrong — .npmignore negation is silently ignored when "files" exists
// .npmignore: !CHANGELOG.md
```

## 10. Pre-Publish: Grep for Private Agent IDs (18-Feb-26)
**Problem:** Hardcoded private agent ID `'ssan'` shipped in Hub API calls in `watch.ts` and `conflicts.ts`.  
**Fix:** Before `npm publish`, grep source for internal agent IDs and replace with public generic names.  
```bash
grep -r "'ssan'\|\"ssan\"" dist/
```
**Pattern:** Any string that identifies a specific internal agent (not a config value) is a pre-publish risk.

**Lesson:** Use the right tool for validation. Envoak's parser handles edge cases better than spidersan's simple lint.

## 11. Storage Factory SUPABASE_URL Override Behavior (12-Feb-26)
**Problem:** Setting `SPIDERSAN_ENV=local` doesn't force local storage if `SUPABASE_URL` is set  
**Cause:** Storage factory checks for SUPABASE_URL presence first, ignoring SPIDERSAN_ENV  
**Symptom:** Auth fails even with `SPIDERSAN_ENV=local`, can't fall back to local `.spidersan/registry.json`

**Current behavior:**
```typescript
// Factory checks URL first, ENV second
if (SUPABASE_URL && SUPABASE_KEY) → Supabase
else → Local
```

**Workaround:** Clear SUPABASE vars to force local:
```bash
SUPABASE_URL="" SUPABASE_KEY="" spidersan register ...
# OR comment out in .env temporarily
```

**Future improvement:** Respect SPIDERSAN_ENV=local as explicit override, even if Supabase vars exist.

**Use case:** Testing local storage, working offline, or troubleshooting Supabase auth without editing .env.

## 12. GitHub Workflow Invalid --branch Flag (13-Feb-26)
**Problem:** Auto-register workflow fails with "unknown option '--branch'" when calling `spidersan register`
**Cause:** Workflow assumed `register` command accepts `--branch` flag, but it auto-detects current branch from git context
**Location:** `.github/workflows/auto-register.yml` line 68

**Symptom:**
```bash
error: unknown option '--branch'
spidersan register --agent "..." --branch "feature/x" --files "..."
```

**Fix:** Remove `--branch` flag from register command in workflow:
```yaml
# ❌ Wrong - register doesn't accept --branch
spidersan register \
  --agent "${{ steps.commit.outputs.agent }}" \
  --branch "${{ steps.commit.outputs.branch }}" \
  --files "${{ steps.commit.outputs.files }}"

# ✅ Correct - auto-detects current branch
spidersan register \
  --agent "${{ steps.commit.outputs.agent }}" \
  --files "${{ steps.commit.outputs.files }}"
```

**Note:** The `conflicts` command DOES support `--branch` flag - those usages are correct and should remain.

**Lesson:** Verify CLI interfaces before writing workflows. Check command help or source code to confirm available flags.

**Pattern:** When a command operates on "current context" (branch, repo, etc.), it typically auto-detects rather than requiring explicit parameters.

## 13. Branch-Local Registry Limits Multi-Agent Visibility (16-Feb-26)
**Problem:** `.spidersan/registry.json` lives in the git working tree. When `torrent create` checks out a new task branch, the registry on that branch is a stale snapshot from when the branch was created.
**Cause:** Git branches have independent file trees — changes to registry on one branch don't appear on others until merge.
**Symptom:** Agent A registers files on task branch A. Agent B on main (or task branch B) can't see A's registration.
**Impact:** Defeats the purpose of coordination — agents can't see each other's intent.

**Workaround:**
- Use `torrent decompose` (register-only, no branch switch) for bulk task creation
- Stay on main for global visibility, only `torrent create` when ready to code
- Manually commit registry changes and cherry-pick to main if needed

**Proper fix needed:** Move registry to `.git/spidersan/` (outside working tree), use an orphan branch (like `spidersan/messages`), or add a `register --branch` flag with cross-branch write capability.

**Lesson:** Coordination metadata should never live in the same tree as the code being coordinated. It needs a separate namespace.

## 14. Torrent Belongs in Ecosystem, Not Core (16-Feb-26)
**Problem:** Torrent command was initially wired into spidersan core (`src/commands/torrent.ts`, `index.ts`, `spidersan.ts`) but it depends on Hub notifications and ecosystem-level patterns.
**Fix:** Moved to `spidersan-ecosystem` plugin. Imports from `spidersan` package (proper plugin pattern). Removed from core `index.ts` and `spidersan.ts`.
**Lesson:** Features that depend on external services (Hub, Myceliumail) or ecosystem conventions should live in the ecosystem plugin, not core. Core should remain dependency-free and self-contained.

## 15. Cross-Reference Branches with PRs Before Triage (16-Feb-26)
**Problem:** 8 of 14 branches had changes that were already merged to main via other PRs. Without checking, we'd have tried to merge superseded code.
**Fix:** Always cross-reference local branches with GitHub PRs before triaging:
```bash
spidersan list              # Local branches
gh pr list --state all      # GitHub PRs
# Compare: which branches have merged PRs? Which PRs target non-main branches?
```
**Pattern:** A branch can be "active" in the registry but "superseded" in reality. The registry doesn't know about PRs. Always check both sources.

## 16. Synthetic Test Fixtures for Coordination Features (16-Feb-26)
**Problem:** Torrent and conflict detection are hard to test without realistic multi-agent data.
**Fix:** Created `tests/fixtures/mammoth-registry.json` — 41 tasks, 5 agents, 55 files, 9 conflict hotspots, 3-level nesting. Can be loaded into any `.spidersan/registry.json` for testing.
**Pattern:** Save registry snapshots from real or realistic test sessions as fixtures. They're more valuable than unit test mocks for coordination features.

## 17. Spidersan MCP as GitOps Co-Pilot (18-Feb-26)
**Problem:** Manual gitops workflows (sync registry, identify merged branches, rebase, fix tests, publish) are error-prone and easy to forget steps.
**Fix:** Used Spidersan MCP tools as an integrated gitops workflow:
```bash
# 1. Sync registry with git state
spidersan sync

# 2. Identify branches already merged to main
git branch --merged main  # Found 3 branches still "active" in registry

# 3. Clean registry via MCP mark_merged
spidersan-mcp mark_merged <branch>  # Cleaned 3 stale entries

# 4. Rebase current branch on updated main
git rebase main  # 14 commits cleanly rebased

# 5. Verify with ready-check + conflicts
spidersan ready-check  # PASS
spidersan conflicts     # Reduced from 43 → 13 conflicts

# 6. Fix broken test, run full suite, publish
npm run test:run  # 47/47 passing
npm publish       # v0.4.5 published
```
**Results:** Conflict count dropped from 43 to 13 files by cleaning merged branches. Registry was out of sync with 3 branches that had already been merged via PRs.
**Pattern:** Run `git branch --merged main` regularly and mark those branches in Spidersan. The registry doesn't auto-detect PR merges — you must reconcile manually. The MCP `mark_merged` + `check_conflicts` + `ready_check` loop is the fastest way to do this.

## 18. Test Mocks Must Mirror Source Code Patterns (18-Feb-26)
**Problem:** `git_injection.test.ts` was failing because it mocked `execSync` for git rev-parse calls, but the source code (`git-messages.ts`) had been hardened to use `execFileSync` exclusively. The mock setup never triggered, so `branchExists()` didn't behave as expected and no `checkout` call was recorded.
**Fix:** Rewrote the mock to use a single `execFileSync` implementation that handles all git subcommands (rev-parse, checkout, stash, etc.) with proper return types based on whether `encoding: 'utf-8'` was specified.
**Pattern:** When security-hardening changes the API surface (e.g., `execSync` → `execFileSync`), tests that verify the hardening must be updated in the same PR. A test that passes by accident (because the mocked function is never called) is worse than no test at all.
