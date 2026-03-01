# F6: FlockView Web Dashboard — Visual Branch Management

## Objective

A web dashboard in FlockView that visualizes all branch state, conflicts, merge ordering, and sync status across machines and repos — the visual complement to the TUI (F5).

## Context

**Existing infra:**
- FlockView scaffold exists at `/Dev/flockview` (Express server + React client + MCP)
- FlockView TODO lists "Hub route integration (`/collab`)" as MVP item
- Toak identity dashboard plan (PLAN_agent_identity_dashboard.md) targets Phase 4 as web dashboard
- ONE_PAGER.md roadmap: "Q3 2026: VS Code extension, dashboard"
- BUSINESS_STRATEGY.md: "SaaS Dashboard ($10-50/user/mo)"
- Supabase tables from F1+F2 provide all data via Supabase Realtime

## Files to Read

- `/Dev/flockview/packages/server/` — Express API patterns
- `/Dev/flockview/packages/client/` — React frontend
- `supabase/migrations/004_spider_registries.sql` — Registry schema (F1)
- `supabase/migrations/005_spider_github_branches.sql` — GitHub state schema (F2)

## Files to Create/Modify

- **Create:** FlockView route: `packages/server/src/routes/spidersan.ts`
- **Create:** FlockView components:
  - `packages/client/src/components/BranchTree.tsx`
  - `packages/client/src/components/ConflictHeatmap.tsx`
  - `packages/client/src/components/SyncStatus.tsx`
  - `packages/client/src/components/MergeOrder.tsx`
  - `packages/client/src/pages/SpidersanDashboard.tsx`

## Deliverables

### 1. Data API (Express routes)

```typescript
// GET /api/spidersan/registries — all machine registries
// GET /api/spidersan/github-branches?repo=spidersan-oss — GitHub state
// GET /api/spidersan/conflicts?global=true — conflict report
// GET /api/spidersan/merge-order?repo=spidersan-oss — merge sequence
// GET /api/spidersan/sync-status — push/pull state per repo per machine
```

All routes query Supabase directly (same tables F1+F2 populate).

### 2. React components

**BranchTree** — Collapsible tree: repo → branch → files, with status badges (CI, PR, stale)
**ConflictHeatmap** — File list colored by tier (red/orange/yellow), branches listed per file
**SyncStatus** — Machine cards showing push/pull/dirty counts with recommended actions
**MergeOrder** — Numbered list with dependency arrows, drag-to-reorder (stretch)

### 3. Supabase Realtime

Subscribe to `spider_registries` and `spider_github_branches` changes for live updates — when M1 pushes a sync, M2's dashboard updates automatically.

## Constraints

- Must extend FlockView (not a separate app)
- Supabase Realtime for live updates (no polling)
- Mobile-responsive (FlockView may become PWA)
- Auth via existing FlockView auth (password protection for MVP)
- Must work with SSR off (React SPA, not Next.js)

## Definition of Done

- [ ] `/spidersan` route in FlockView renders dashboard
- [ ] Branch tree shows all repos × branches with status
- [ ] Conflict heatmap renders with tier coloring
- [ ] Sync status shows machine state
- [ ] Supabase Realtime updates dashboard live
- [ ] Responsive on mobile
- [ ] Tests pass
