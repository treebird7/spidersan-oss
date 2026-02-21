---
tags: [agent/copilot, agent/spidersan, topic/field-test]
date: 2026-02-16
---

# Spidersan Field Test: Session Use Cases

> **Real-world assessment from a live triage + stress test session**
> Tested against 14 stale branches, 4 AI agents, and a 41-task mammoth hunt decomposition.

---

## Context

A single session covered:
- Triaging 14+ branches across 4 AI agents (claude, copilot, codex, sentinel)
- Identifying 11 conflicting files, with `src/commands/config.ts` as worst hotspot (6 branches)
- Abandoning 9 superseded branches, merging 3 PRs
- Salvaging the torrent command from a nearly-abandoned branch
- Stress-testing torrent with 41 tasks, 4 agents, 55 files, 9 conflict hotspots, 3-level nesting

---

## ✅ What Worked Well

### 1. Branch Triage Pipeline: `list → conflicts → merge-order`

The combination — not any single command — was the killer workflow. In minutes we went from "14 unknown branches" to a clear action plan.

```bash
spidersan list                    # See everything
spidersan conflicts               # Find overlaps
spidersan merge-order             # Get sequencing
```

**Result:** Identified 9 branches to abandon, 3 to merge, 2 to investigate. Without this, would have manually diffed each branch.

### 2. `torrent tree` — Best Feature for Multi-Agent Visibility

At 35+ tasks, the nested tree with ✅/🔄 icons made the entire project state instantly readable:

```
├─ 🔄 MAMMOTH-A (sherlocksan)
│  ├─ ✅ MAMMOTH-A-A (sherlocksan)
│  ├─ ✅ MAMMOTH-A-B (sherlocksan)
│  │  ├─ 🔄 MAMMOTH-A-B-A
│  │  └─ 🔄 MAMMOTH-A-B-C
│  ├─ 🔄 MAMMOTH-A-C (sherlocksan)
```

No agent had to ask "what's done?" — the tree answered it.

### 3. `torrent decompose` — Scales Effortlessly

Created 41 tasks across 3 levels of nesting without any performance issues. Registry stayed at 11KB. The "register without creating git branches" approach was the right design — decompose plans work, create claims work.

### 4. `torrent status --parent` — Scoped Views

Filtering by workstream (`--parent MAMMOTH-A`) showed only the 6 relevant tasks instead of all 35. Essential for agents working on one slice.

### 5. `torrent merge-order` — Conflict-Aware Sequencing

Correctly identified 14 conflict-free tasks to merge first, then showed rebase dependencies for the remaining 21. The `└─ Rebase after:` lines told each agent exactly what to wait for.

### 6. `spidersan abandoned` — Bulk Cleanup

Marked 9 branches abandoned in one pass. Registry stayed clean.

---

## ⚠️ What Needs Improvement

### 1. Registry is Branch-Local (Critical)

**Problem:** `.spidersan/registry.json` lives in the git tree. When `torrent create` checks out a new branch, the registry on that branch is stale — it was forked from main at creation time.

**Impact:** Multi-agent workflows break. Agent A creates task branch, registers files — Agent B on main can't see it.

**Workaround used:** Used `decompose` (register-only, no checkout) for bulk creation, then stayed on main.

**Fix needed:** Registry should be stored outside the git tree (e.g., `.git/spidersan/` or a git note), or use the orphan `spidersan/messages` branch pattern.

### 2. No `register --branch` Flag

**Problem:** `register -f` only works for the current branch. Can't register files for a branch you're not checked out on.

**Impact:** Had to manually edit `registry.json` to assign files to task branches.

**Fix needed:** Add `--branch <name>` / `-b <name>` option to `register` command.

### 3. `conflicts` Requires Current Branch Registered

**Problem:** Running `spidersan conflicts` on main returns `Branch "main" is not registered` — even though you just want a global conflict overview.

**Fix needed:** When current branch isn't registered, show all conflicts between registered branches instead of erroring.

### 4. `torrent create` Always Switches Branches

**Problem:** No way to claim a task without `git checkout -b`. In a multi-task setup, you don't want to switch away from your current work.

**Fix needed:** Add `--no-checkout` flag that registers the task without creating/switching to the git branch.

### 5. Supabase Env Override Pain

**Problem:** If `.env` has `SUPABASE_URL`/`SUPABASE_KEY`, storage factory selects SupabaseStorage which fails auth. Every command needs `SUPABASE_URL= SUPABASE_KEY=` prefix to force local.

**Fix needed:** Add `--local` flag or `SPIDERSAN_STORAGE=local` env override, or gracefully fall back to local when Supabase auth fails.

---

## ❌ Not Useful in This Session

| Feature | Why |
|---------|-----|
| `ready-check` | Session was triage-focused, not merge-focused |
| `rescue` / `salvage` | Manual `git checkout <branch> -- <file>` was faster for targeted file extraction |
| Hub notifications | Every command tries `fetch(HUB_URL)` and silently fails offline. Adds noise to output |

---

## Key Insight

> The real value of spidersan isn't any single command — it's the **pipeline**.
> `list → conflicts → merge-order` turns "14 mystery branches" into an action plan in minutes.
> `decompose → tree → status` turns "114 tasks across 5 agents" into a readable, conflict-aware board.

---

## Test Data

- Mammoth stress test fixture: `tests/fixtures/mammoth-registry.json`
  - 41 tasks, 5 agents, 55 files, 9 conflict hotspots, 3-level nesting
  - Can be loaded into any `.spidersan/registry.json` for testing

## Related Files

- [[MAMMOTH_HUNT_TASKS]] — Source task list (114 tasks)
- [[docs/USE_CASES]] — General use case documentation
- [[docs/AGENT_GUIDE]] — Agent quick reference
- Skill file: `.agent/skills/SPIDERSAN_WORKFLOW.md`
