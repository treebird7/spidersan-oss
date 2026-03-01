# F5: Terminal Dashboard — Cross-Repo Branch Tree with Conflict Heatmap

## Objective

A `spidersan dashboard` TUI command showing all repos × all machines × GitHub state in a single interactive terminal view. The "air traffic control" screen for multi-agent coordination.

## Context

**Problem:** Today's session required 6+ manual commands to understand the state across repos. The information exists (F1-F4 produce it) but there's no unified view.

**Existing infra:**
- `src/tui/dashboard.ts` — Blessed-based TUI already exists (used by `spidersan watch`)
- `src/lib/security.ts` — `escapeBlessed()` for safe TUI rendering
- F1-F4 provide all the data: registries, GitHub branches, conflicts, sync state

## Files to Read

- `src/tui/dashboard.ts` — Existing TUI patterns (blessed)
- `src/commands/conflicts.ts` — Conflict rendering
- `src/commands/sync-advisor.ts` — Repo state from F4

## Files to Create/Modify

- **Create:** `src/commands/dashboard.ts` — New `spidersan dashboard` command
- **Create:** `src/tui/dashboard-panels.ts` — Panel components (branch tree, conflict map, sync status)
- **Modify:** `src/bin/spidersan.ts` — Register command
- **Create:** `tests/dashboard-tui.test.ts`

## Deliverables

### TUI Layout

```
┌─ Spidersan Dashboard ─────────────────────────────────────────────┐
│                                                                    │
│ ┌─ Repos (29) ─────────┐  ┌─ Conflicts (10 files) ──────────────┐│
│ │ ▸ spidersan      22br │  │ 🔴 src/commands/register.ts     4br ││
│ │   ├ main          ✓   │  │ 🔴 tests/security/git_inj...   5br ││
│ │   ├ fix/salvage   ⬆1  │  │ 🟠 src/lib/ast.ts              3br ││
│ │   ├ wave0-hyg...  CI✗ │  │ 🟠 src/commands/config.ts      3br ││
│ │   └ 19 more...        │  │ 🟡 README.md                   2br ││
│ │ ▸ Toak            3br │  │                                     ││
│ │ ▸ Envoak          4br │  └─────────────────────────────────────┘│
│ │ ▸ myceliumail     6br │                                         │
│ │ ▸ invoak          1br │  ┌─ Sync Status ───────────────────────┐│
│ │                       │  │ M2 (this machine)    29 repos       ││
│ └───────────────────────┘  │   ⬆ 3 push  ⬇ 2 pull  ⟳ 1 rebase ││
│                            │   💾 8 dirty  ✅ 12 clean           ││
│ ┌─ Merge Order ─────────┐ │                                      ││
│ │ 1. claude/fix-gh-act  │ │ M1 (last sync: 2hrs ago)  14 repos  ││
│ │ 2. wave0-hygiene      │ │   ⬆ 1 push  ✅ 13 clean            ││
│ │ 3. bolt/optimize-ast  │ │                                      ││
│ │ 4. copilot/fix-inj    │ │ Cloud (last sync: 6hrs)    3 repos  ││
│ │ ...                   │ │   ✅ 3 clean                        ││
│ └───────────────────────┘ └──────────────────────────────────────┘│
│                                                                    │
│ [R]efresh  [S]ync  [C]onflicts  [M]erge-order  [Q]uit            │
└────────────────────────────────────────────────────────────────────┘
```

### Key interactions

- Arrow keys: navigate repos/branches
- Enter: expand/collapse repo branch tree
- `R`: refresh all data (re-scan + Supabase pull)
- `S`: run sync-advisor recommendations
- `C`: jump to conflict detail view
- `M`: show full merge order
- `Q`: quit

## Constraints

- Must use blessed (already a dependency, existing TUI patterns)
- All dynamic text must be escaped with `escapeBlessed()`
- Graceful degradation: works without Supabase (local-only mode)
- Responsive to terminal width (min 80 cols)

## Definition of Done

- [ ] `spidersan dashboard` renders the TUI
- [ ] Repo tree shows branches with status indicators
- [ ] Conflict heatmap shows tiered conflicts
- [ ] Sync status panel shows push/pull/dirty state
- [ ] Merge order panel shows recommended sequence
- [ ] Keyboard navigation works
- [ ] Works in local-only mode (no Supabase)
- [ ] Tests pass
