# 🕷️ Spidersan

**The Branch Coordinator for AI Coding Agents**

> *"Stop the merge chaos. Know what every AI session is doing."*

---

## The Problem

AI coding agents (Claude Code, Cursor, GitHub Copilot) are transforming development. But when you run multiple sessions:

- **Branch proliferation:** 10-20 branches pile up weekly
- **Merge chaos:** Wrong merge order → hours of conflict resolution
- **Context loss:** Sessions don't know what other sessions did
- **Stale branches:** Abandoned work clutters your repo

**Result:** Developers spend 30% of their time on coordination, not coding.

---

## The Solution

**Spidersan** gives you a central command center for all your AI coding sessions:

```bash
$ spidersan list

🕷️ Active Branches:

  1. fix-auth-bug         ✅ Ready to merge
     └─ Last: 5 min ago | Files: auth.ts, middleware.ts

  2. refactor-api        ⚠️ Conflicts with #1
     └─ Last: 2 hours ago | Files: api.ts, auth.ts

  3. new-dashboard        🔄 In progress
     └─ Last: 30 sec ago | Working: "Building chart component"

$ spidersan merge-order

Recommended merge sequence:
  1. fix-auth-bug     (no dependencies)
  2. new-dashboard    (depends on main)
  3. refactor-api     (rebase after #1 merges)
```

---

## How It Works

1. **Register:** Every AI session registers its branch automatically
2. **Track:** Spidersan records files changed, dependencies, status
3. **Coordinate:** Get merge order recommendations, conflict warnings
4. **Clean up:** Auto-detect stale branches, one-click cleanup

---

## Target Market

| Segment | Size | Pain Level |
|---------|------|------------|
| Claude Code power users | 100k+ | 🔥🔥🔥 High |
| Cursor users with multi-session | 500k+ | 🔥🔥 Medium-High |
| AI-assisted dev teams | Growing | 🔥🔥🔥 High |

**Early adopters:** Solo developers running 3+ AI sessions daily.

---

## Pricing

### Free (Open Source Core)
- All CLI commands
- Supabase sync (5 branch limit)
- Community support

### Pro — $15/month
- Unlimited branches
- Conflict prediction
- GitHub Actions integration
- Web dashboard
- MCP server for Claude
- Priority support

### Enterprise — Contact us
- Self-hosted deployment
- SSO integration
- Custom SLAs
- Dedicated support

---

## Roadmap

**Completed (Recovery-Tree):**
- [x] Core CLI (13 commands)
- [x] Branch registration & tracking
- [x] Conflict detection
- [x] Merge order recommendations
- [x] Ready-check validation
- [x] Configurable WIP detection
- [x] Test suite (15 cases)

**In Progress:**
- [ ] WIP detection fine-tuning

**Standalone Extraction:**
- [ ] npm packaging
- [ ] SQLite adapter
- [ ] MCP server
- [ ] Web dashboard

---

## Competitive Landscape

| Tool | What It Does | Gap |
|------|--------------|-----|
| **Git worktrees** | Multiple checkouts | Manual, no coordination |
| **GitButler** | Parallel branches | No AI-specific features |
| **Branch Memory Manager** | Context per branch | No merge coordination |
| **Spidersan** | Full coordination | ✅ Complete solution |

**Our moat:** Purpose-built for AI coding workflows. First to market.

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Spidersan                        │
├─────────────────────────────────────────────────────┤
│  CLI: spidersan init | register | list | merge     │
├─────────────────────────────────────────────────────┤
│  Storage Layer                                      │
│  ├── SQLite (free, local)                          │
│  ├── Supabase (pro, cloud)                         │
│  └── PostgreSQL (pro, self-hosted)                 │
├─────────────────────────────────────────────────────┤
│  Integrations                                       │
│  ├── Git hooks (auto-register on push)             │
│  ├── GitHub Actions (CI/CD awareness)              │
│  └── MCP Server (Claude can use as tool)           │
└─────────────────────────────────────────────────────┘
```

---

## Go-to-Market

### Phase 1: Launch (Month 1-2)
- Release open-source CLI on npm
- Post on Reddit (r/ClaudeAI, r/programming)
- Show HN post
- **Target:** 100+ GitHub stars

### Phase 2: Monetize (Month 3-4)
- Launch Pro tier
- GitHub Sponsors
- Blog content marketing
- **Target:** 10 paying customers

### Phase 3: Scale (Month 5+)
- Product Hunt launch
- Partnership outreach (Cursor, Anthropic)
- Enterprise pilots
- **Target:** $1,500/month MRR

---

## Traction & Proof Points

- ✅ Architecture validated in production (Recovery-Tree app)
- ✅ Existing CLI and schema working for 2+ months
- ✅ Solves creator's own pain (dogfooding)
- ✅ No direct competitor in AI coordination space

---

## Why Now

1. **AI coding is exploding:** Claude Code, Cursor, Copilot adoption at record highs
2. **Multi-agent workflows:** Teams running 5-10 parallel AI sessions is becoming normal
3. **No solution exists:** The market is wide open
4. **Tools consolidating:** Big players (Anthropic, GitHub) acquiring developer tools

---

## The Ask

**Option A: Launch & Grow**
- 2-3 weeks to MVP
- 3 months to first revenue
- Self-funded path

**Option B: Acquisition Target**
- Build traction
- Position for acquisition by Anthropic/Cursor/GitHub
- Exit: $50k-500k based on adoption

---

## Contact

**Creator:** [Your Name]
**Email:** [Your Email]
**Twitter:** [@handle]
**GitHub:** [repo link]

---

*🕷️ Spidersan — Coordination for the AI-first developer*
