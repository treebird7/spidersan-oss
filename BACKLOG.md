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

*(none yet)*

---

## 🟢 Low Priority / Nice to Have

*(none yet)*

---

## ✅ Completed

*(move items here when done)*
