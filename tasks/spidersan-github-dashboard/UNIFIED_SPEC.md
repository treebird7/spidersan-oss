# Spidersan GitHub Dashboard — Unified Spec

> **Project:** `spidersan-github-dashboard`  
> **Spec Author:** Spidersan (ssan) + Copilot  
> **Date:** 2026-02-19  
> **Status:** Spec Complete — Ready for Dispatch

---

## Problem Statement

Spidersan registries are local JSON files. Each machine is blind to other machines' branches. GitHub branch/PR/CI state isn't tracked. There's no unified view of what's happening across the entire codebase ecosystem.

**Evidence (Feb 19 session):**
- 10 unregistered branches discovered only by manual `git branch -r` scan
- 4 repos had unpushed commits, 2 needed pulls — found by manual loop
- Old sentinel branches had unique security fixes that were nearly lost
- No way for M1 to know what M2 is working on

## Vision

Transform Spidersan from **single-machine conflict detector** → **cross-machine coordination dashboard** with GitHub awareness.

```
Machine (M1/M2/Cloud)          GitHub              Supabase
┌─────────────────┐       ┌──────────────┐    ┌──────────────────┐
│ .spidersan/     │──push→│ Repos (29+)  │    │ spider_registries│
│ registry.json   │       │ Branches     │←──→│ spider_github_br │
│ (per repo)      │       │ PRs / CI     │    │                  │
└────────┬────────┘       └──────┬───────┘    └────────┬─────────┘
         │                       │                     │
         └───────sync────────────┴─────────────────────┘
                                                       │
                                    ┌──────────────────┤
                                    ▼                  ▼
                              TUI Dashboard     FlockView Web
```

## Consolidated Context Sources

This spec synthesizes decisions from across the ecosystem:

| Source | Key Decision |
|--------|-------------|
| `DREAM_spidersan_semantic_intelligence.md` | Cross-repo intelligence, `spider_intents` table, semantic overlap detection |
| `DREAM_spidersan_mcp_v2_sessions_memory.md` | Session continuity, `branch_story()`, loose end detection |
| `DREAM_intelligent_domain_routing.md` | Spidersan as Git Coordination domain leader |
| Mappersan Realism Pass (Feb 17) | 3 dreams → 2 layers: Intelligence + Routing. Build 1 new table (`spider_intents`), reuse memoak for rest |
| `SHORT_TERM_ROADMAP.md` | Cross-repo conflict detection = 🔥🔥🔥🔥 stretch goal |
| `ONE_PAGER.md` | Q3 2026: dashboard. SaaS tier: $10-50/user/mo |
| `BUSINESS_STRATEGY.md` | Dashboard = revenue differentiator vs GitHub Agent HQ |
| `PLAN_agent_identity_dashboard.md` | Phase 4 = web dashboard with agent cards, session monitoring |
| `DREAM_flockview_wiki_system.md` | FlockView as "Working Memory" UI, wiki-linked semantic web |
| Daily collab Feb 16-19 | Operational proof: branch triage, MCP registration, 184 tools audited |
| `spidersan-v2/context/CLAUDE.md` | Supabase required for messaging, cross-machine sync, dependencies |
| `spidersan_audit.md` | Security issue #8: MCP global registry lacks repo isolation |
| FlockView scaffold | Express + React + MCP, spec phase, SSE streaming ready |

## Architecture: Where This Fits

```
┌─────────────────────────────────────────────────┐
│  LAYER 2: ROUTING & ORCHESTRATION (future)      │
│  classifyDomain() → routeToDomainLeader()       │
│  Lives in: invoak router                         │
└──────────────────────┬──────────────────────────┘
                       │ reads from
┌──────────────────────▼──────────────────────────┐
│  LAYER 1: SPIDER INTELLIGENCE                    │
│  ┌────────────────────────────────────────────┐ │
│  │ THIS SPEC: F1-F6                           │ │
│  │ Registry sync + GitHub awareness +         │ │
│  │ Cross-machine conflicts + Sync advisor +   │ │
│  │ TUI dashboard + Web dashboard              │ │
│  └────────────────────────────────────────────┘ │
│  FUTURE: spider_intents, session continuity,    │
│  semantic overlap, branch_story                  │
│  Lives in: SpiderSan + memoak backend            │
└──────────────────────┬──────────────────────────┘
                       │ built on
┌──────────────────────▼──────────────────────────┐
│  LAYER 0: EXISTING INFRASTRUCTURE (operational)  │
│  SpiderSan CLI (53 cmds + 22 MCP tools)          │
│  Supabase (storage adapter exists)               │
│  GitHub MCP + gh CLI (authenticated)             │
│  Envoak (machine identity: m2)                   │
│  Toaklink (agent messaging)                      │
│  FlockView (scaffold: Express+React)             │
│  Memoak (embeddings + semantic search)           │
└─────────────────────────────────────────────────┘
```

## Feature Spec Bundle (6 features)

| Feature | Title | Depends On | Effort |
|---------|-------|-----------|--------|
| **F1** | Supabase Registry Sync — machine-tagged branch state | — | 2-3 days |
| **F2** | GitHub Branch Inventory — API-aware branch/PR/CI state | F1 | 2-3 days |
| **F3** | Cross-Machine Conflict Detection — multi-machine overlap | F1, F2 | 2 days |
| **F4** | Smart Sync Advisor — push/pull/cleanup recommendations | F2 | 2 days |
| **F5** | Terminal Dashboard — blessed TUI with 4-panel layout | F3, F4 | 3 days |
| **F6** | FlockView Web Dashboard — React + Supabase Realtime | F3, F4 | 3-5 days |

```
F1 ──→ F2 ──→ F3 ──→ F5 (TUI)
              ↗      ↗
F1 ──→ F2 → F4 ──→ F6 (Web)
```

**Total estimated effort:** 14-18 days (parallelizable: F5 and F6 can run concurrently)

## New Supabase Tables

### `spider_registries` (F1)
Machine-tagged branch registrations. One row per machine × repo × branch.

| Column | Type | Purpose |
|--------|------|---------|
| machine_id | TEXT | From `~/.envoak/machine.json` |
| machine_name | TEXT | Human label ("m2") |
| repo_name | TEXT | e.g. "spidersan" |
| branch_name | TEXT | e.g. "fix/salvage-sentinel-gaps" |
| files | TEXT[] | Registered files |
| agent | TEXT | e.g. "sentinel", "copilot" |
| status | TEXT | active/completed/abandoned/merged |
| UNIQUE | | (machine_id, repo_name, branch_name) |

### `spider_github_branches` (F2)
GitHub state per branch. Populated by `gh` CLI calls.

| Column | Type | Purpose |
|--------|------|---------|
| repo_owner/repo_name | TEXT | e.g. "treebird7/spidersan-oss" |
| branch_name | TEXT | e.g. "sentinel/fix-stale-path-traversal" |
| pr_number/pr_state/pr_title | various | PR status |
| ci_status/ci_conclusion | TEXT | CI/Actions state |
| registered | BOOLEAN | Mapped to spider_registries? |
| is_stale | BOOLEAN | No activity > N days |

## New CLI Commands

| Command | What It Does |
|---------|-------------|
| `spidersan registry-sync --push` | Upload local registry to Supabase with machine_id |
| `spidersan registry-sync --pull` | Show other machines' branches |
| `spidersan registry-sync --status` | Multi-machine sync table |
| `spidersan github-sync` | Fetch branch/PR/CI from GitHub for configured repos |
| `spidersan github-sync --unregistered` | Show branches not in registry |
| `spidersan conflicts --global` | Cross-machine conflict detection |
| `spidersan conflicts --cross-repo` | Cross-repo conflict detection |
| `spidersan sync-advisor` | Recommend push/pull/cleanup per repo |
| `spidersan sync-advisor --fix` | Execute recommendations interactively |
| `spidersan dashboard` | TUI dashboard (blessed) |

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| GitHub API method | `gh` CLI (not Octokit) | Already authenticated, handles SSO/2FA, available on all machines |
| Machine identity | Envoak `machine.json` | Already exists, includes UUID, hostname, SSH fingerprint |
| Storage | Supabase (optional) | Existing adapter, Realtime for live updates, already has tables |
| TUI framework | Blessed | Already a dependency, existing TUI patterns in dashboard.ts |
| Web framework | FlockView (Express+React) | Scaffold exists, aligns with Q3 roadmap |
| Local-first | Always works without Supabase | Core principle — cloud enhances, never blocks |
| Cross-repo conflicts | Opt-in flag | Noisy by default, valuable when intentional |

## Risk & Blockers

| Risk | Mitigation |
|------|-----------|
| GitHub API rate limits (5000/hr) | Cache in Supabase, incremental sync, `--ci` opt-in |
| Supabase RLS complexity | Simple policies: read all, write own machine |
| FlockView not yet operational | F6 can wait — TUI (F5) delivers same value |
| Security audit #8 (repo isolation) | UNIQUE constraint on (machine_id, repo_name, branch_name) |
| Mappersan warning: torrent.ts at complexity cliff | Separate commands (registry-sync, github-sync) — not extending torrent |

## Relationship to Other Dreams

This spec is **Phase 0** of SpiderSan v2 — the data foundation that everything else depends on:

- **Semantic intelligence** (spider_intents, who-else) → needs cross-machine awareness first
- **Session continuity** (branch_story, loose ends) → needs branch state data first
- **Domain routing** (classifyDomain) → consumes intelligence layer, ships independently
- **Identity dashboard** (Toak Phase 4) → web dashboard (F6) could merge with it

## Next Steps After This Ships

1. `spider_intents` table + `claim/release` commands (semantic layer)
2. `spidersan session start/end/restore` (session continuity)
3. `spidersan branch story` (torrent + git log + memoak narrative)
4. VS Code extension (Q3 2026 roadmap)
5. SaaS dashboard tier (BUSINESS_STRATEGY.md revenue plan)
