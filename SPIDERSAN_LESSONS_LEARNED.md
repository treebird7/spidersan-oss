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
