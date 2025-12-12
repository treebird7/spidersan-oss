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
