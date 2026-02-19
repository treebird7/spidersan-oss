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
