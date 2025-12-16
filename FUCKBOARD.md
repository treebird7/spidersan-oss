# FUCKBOARD - Spidersan Lessons Learned

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
