# Spidersan Backlog

> **Active Tasks & Future Work**

---

## 🔴 High Priority

### [ ] Migrate Production Supabase URL
**Created:** 2025-12-31  
**Requested by:** Treebird

Change the production Supabase project URL. Current: `iopbbsjdphgctfbqljcf.supabase.co`

**Migration Steps:**
1. [ ] Export existing data from old production
   - `branch_registry` table
   - `agent_messages` table
   - `agent_aliases` table
2. [ ] Set up new Supabase project with same schema
3. [ ] Import data to new project
4. [ ] Update `supabase-config.env` with new URL
5. [ ] Update any agent `.env` files using old URL
6. [ ] Test with `spidersan pulse` to verify connection
7. [ ] Notify Recovery-Tree team (shares this database)

**Files to update:**
- `supabase-config.env`
- Any local `.env` files

**Impact:** Low - just config updates, no code changes needed.

---

## 🟡 Medium Priority

### [ ] `spidersan audit` — registryless branch audit command
**Created:** 2026-03-10  
**Requested by:** Treebird (flagged during branch cleanup session)

**Observation:** `spidersan stale` and `spidersan conflicts` are blind when the registry is cold (no `spidersan register` calls made). `doctor --remote` was the only useful command during the March 2026 cleanup because it scans git directly without needing a registry.

**Spec:** Add `spidersan audit` (or extend `doctor --remote`) to do a registryless branch audit across all repos:
- For each repo: list branches with `git branch -r --merged origin/main` (safe to delete) and `--no-merged` (needs triage)
- Show last commit age for each unmerged branch
- Classify: bot-generated (`claude/`, `bolt-`, `sentinel-`, `snyk-`), backup (`i7-saved`, worktree timestamps), active (recent activity), stale (N+ days)
- No registry required — pure git
- Output: table with repo / branch / age / classification / recommendation
- Optional `--delete-merged` flag to sweep confirmed-merged branches in one pass

**Files to touch:**
- `src/commands/doctor.ts` — extend `--remote` or add `--audit` mode
- `src/lib/git.ts` — add `getMergedBranches()`, `getUnmergedBranches()` helpers

---

## 🟢 Low Priority / Nice to Have

*(none yet)*

---

## ✅ Completed

*(move items here when done)*
