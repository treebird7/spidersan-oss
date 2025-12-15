# The Treebird Ecosystem

## A Vision for Coordinated AI Agent Development

> **Version:** 1.0 (Draft)
> **Author:** treebird7 with Claude Opus 4.5
> **Date:** December 2024

---

## The World is Changing

In 2024, something shifted. AI coding agents—Claude Code, Cursor, GitHub Copilot, Windsurf—moved from autocomplete to autonomous. They don't just suggest code; they write features, fix bugs, and refactor systems.

Developers went from typing code to directing agents.

But here's what nobody anticipated: **what happens when multiple agents work on the same codebase?**

---

## The Chaos Problem

Picture this: A developer has three AI agents working simultaneously.

- **Claude Code** is building a new API endpoint
- **Cursor** is refactoring the authentication module
- **Copilot** is fixing a bug in the data layer

All three are productive. All three are creating branches. None of them know what the others are doing.

The result?

```
Branch: claude/feature-api-v2
Branch: cursor/auth-refactor
Branch: copilot/fix-data-bug
         ↓
    MERGE CONFLICTS
    DUPLICATED WORK
    BROKEN BUILDS
    ABANDONED BRANCHES
```

This isn't a hypothetical. This is happening right now in repositories everywhere. The tools that made us 10x more productive are creating 10x more coordination problems.

**We built tools for humans to collaborate. We never built tools for AI agents to collaborate.**

Until now.

---

## Introducing Treebird

**Treebird** is an ecosystem of CLI tools designed for the age of AI-assisted development. It solves the coordination problem by giving AI agents what they need:

1. **Context** — Instant understanding of any codebase
2. **Coordination** — Awareness of what other agents are doing
3. **Communication** — Direct messaging between agents
4. **Recovery** — Tools to rescue chaotic repositories

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                     THE TREEBIRD ECOSYSTEM                      │
│                                                                 │
│     ┌───────────┐      ┌───────────┐      ┌───────────┐        │
│     │ STARTERSAN│      │ MAPPERSAN │      │ SPIDERSAN │        │
│     │  Bootstrap│  →   │  Document │  →   │ Coordinate│        │
│     └───────────┘      └───────────┘      └───────────┘        │
│                                                  ↓              │
│                                           ┌───────────┐        │
│                                           │MYCELIUMAIL│        │
│                                           │Communicate│        │
│                                           └───────────┘        │
│                                                                 │
│     "From chaos to coordination in four tools"                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## The Four Tools

### 1. Startersan — The Entry Point

**Problem:** AI agents waste time learning codebases. They grep, they search, they hallucinate file structures.

**Solution:** Startersan bootstraps any repository with AI-agent-optimized documentation.

```bash
/startersan

→ Analyzes repository structure
→ Generates CLAUDE.md (auto-loaded by Claude Code)
→ Creates AGENT_GUIDE.md (30-second quick reference)
→ Creates LIMITATIONS.md (what the system CAN'T do)
```

**The Philosophy:** An AI agent should understand a codebase in seconds, not minutes. Startersan creates the documentation pyramid that makes this possible.

**Form:** Claude Code skill (free forever)

---

### 2. Mappersan — The Documenter

**Problem:** Documentation rots. The moment code changes, docs become lies.

**Solution:** Mappersan automatically generates and maintains AI-agent-ready documentation.

```bash
mappersan init          # Initial documentation generation
mappersan sync          # Update docs to match code
mappersan watch         # Auto-sync on file changes
mappersan verify        # Check doc accuracy
```

**The Philosophy:** Documentation should be a living reflection of code, not a fossil record of intentions. Mappersan treats docs as derived artifacts, regenerated on demand.

**Integration with Startersan:** Mappersan automates what Startersan bootstraps. Startersan gets you started; Mappersan keeps you current.

**Form:** npm CLI (free core, paid watch mode)

---

### 3. Spidersan — The Coordinator

**Problem:** Multiple AI agents create branches without coordination, causing merge conflicts and duplicated work.

**Solution:** Spidersan is air traffic control for AI coding sessions.

```bash
spidersan register --files src/api.ts    # Declare what you're working on
spidersan conflicts                       # See overlapping work
spidersan merge-order                     # Get optimal merge sequence
spidersan ready-check                     # Validate before PR
```

**The Philosophy:** Conflicts are easier to prevent than resolve. By registering intent before writing code, agents can avoid stepping on each other.

**The Rescue Mode:** When coordination fails and repositories become chaotic:

```bash
spidersan rescue        # Start recovery mission
spidersan scan --all    # Analyze all branches
spidersan triage        # Categorize: MERGE / SALVAGE / ABANDON
spidersan salvage       # Extract valuable code from broken branches
spidersan archaeology   # Deep scan for buried treasure
```

**Form:** npm CLI (free local, paid cloud sync)

---

### 4. Myceliumail — The Messenger

**Problem:** AI agents can't talk to each other. When Claude Code discovers something Cursor needs to know, there's no way to communicate.

**Solution:** Myceliumail (mycmail) is a standalone agent-to-agent messaging system.

```bash
mycmail send cursor "BLOCKED: Need auth module first"   # Direct message
mycmail broadcast "API schema changed"                   # Team-wide alert
mycmail inbox                                            # Check messages
mycmail subscribe api-changes                            # Join channel
```

**The Philosophy:** Named after mycelium—the underground fungal network that lets trees share resources and warnings—Myceliumail creates the communication substrate for AI agents.

**End-to-End Encryption:** Messages are encrypted with NaCl. Even the server can't read them.

```bash
mycmail keygen                    # Generate keypair
mycmail key-import cursor.pub     # Import teammate's public key
```

**Form:** npm CLI (free local, paid cloud relay)

---

## The Ecosystem in Action

### Scenario: New Developer Joins Team

```
Day 1, Hour 1:

Developer: "Claude, help me understand this codebase"

Claude Code: *reads CLAUDE.md auto-loaded by Startersan*
            "This is a branch coordination CLI. Here are the
             key commands, architecture, and limitations..."

Developer: "Add a new feature for branch analytics"

Claude Code: *runs spidersan register*
            "I've registered that I'm working on src/analytics/.
             Two other agents are active:
             - Cursor is refactoring src/storage/
             - Copilot is fixing tests
             No conflicts detected. Proceeding."

*Later...*

Claude Code: *discovers storage schema needs to change*
            *runs mycmail send cursor "Need storage schema change for analytics"*

Cursor: *receives message, replies*
       "Acknowledged. I'll add the fields. Will notify when done."

*Even later...*

Developer: "Create PR"

Claude Code: *runs spidersan ready-check*
            "Ready. Recommended merge order:
             1. cursor/storage-refactor (dependency)
             2. Your branch
             3. copilot/test-fixes"
```

**Result:** Zero conflicts. Coordinated merge. Happy developer.

---

### Scenario: Repository Rescue

```
Situation: Startup with 47 abandoned AI-generated branches.
Nobody knows what's in them. Main is months behind.

spidersan rescue --create-master

→ "Rescue mission initiated. Scanning 47 branches..."

spidersan scan --all

→ Branch analysis complete:
   - 12 branches: Duplicate implementations of auth
   - 8 branches: Abandoned mid-feature
   - 15 branches: Potentially mergeable
   - 7 branches: Conflicting with each other
   - 5 branches: Unknown purpose

spidersan triage

→ Recommendations:
   MERGE:    feature/user-api (clean, tested)
   SALVAGE:  feature/auth-v3 (good JWT code, bad integration)
   ABANDON:  cursor/experiment-* (incomplete experiments)

spidersan salvage feature/auth-v3 --components src/auth/jwt.ts

→ Extracted jwt.ts to current branch. Origin preserved in commit.

*After 2 hours of guided triage...*

spidersan rescue-status

→ Mission complete:
   - 8 branches merged
   - 12 components salvaged
   - 27 branches archived
   - Repository restored to working state
```

**Result:** Months of chaos resolved in an afternoon.

---

## The Documentation Pyramid

Treebird introduces a tiered documentation architecture optimized for AI agents:

```
                    ┌─────────────┐
                    │  CLAUDE.md  │  ← Auto-loaded (Tier 1)
                    │   ~150 LOC  │     Agent reads this first
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ AGENT_GUIDE │  ← Quick reference (Tier 2)
                    │   ~100 LOC  │     30-second decisions
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ LIMITATIONS │  ← Boundaries (Tier 3)
                    │   ~200 LOC  │     What system CAN'T do
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  USE_CASES  │  ← Deep reference (Tier 4)
                    │  ~1000 LOC  │     Comprehensive scenarios
                    └─────────────┘
```

**Key Insight:** AI agents don't need encyclopedic documentation. They need:

1. **Instant context** (CLAUDE.md) — What is this? What can it do?
2. **Decision support** (AGENT_GUIDE) — When should I use X vs Y?
3. **Boundary awareness** (LIMITATIONS) — What will fail if I try it?
4. **Deep reference** (USE_CASES) — Only when the above isn't enough

This pyramid ensures agents get maximum understanding with minimum token consumption.

---

## Design Principles

### 1. CLI-Native

Treebird tools are CLI applications, not web dashboards or IDE plugins. Why?

- **Universal:** Works with any AI agent that can run shell commands
- **Scriptable:** Integrates into CI/CD, hooks, automation
- **Portable:** Same commands work everywhere
- **Composable:** Pipe outputs, chain commands

### 2. Local-First

Every tool works without internet:

- **Spidersan:** Local JSON registry
- **Mappersan:** Local documentation generation
- **Myceliumail:** Local message queue

Cloud features (sync, relay, dashboard) are enhancements, not requirements.

### 3. Agent-Optimized

Traditional developer tools assume a human is reading output. Treebird assumes an AI agent is reading output:

- **Structured responses** — Easy to parse
- **Explicit states** — No ambiguous status messages
- **Deterministic behavior** — Same input = same output
- **Token-efficient** — Information-dense, not verbose

### 4. Graceful Degradation

Treebird never blocks development:

- No registration? Spidersan still works (just without coordination)
- No internet? Everything runs locally
- Agent ignores treebird? Code still ships

**Philosophy:** Coordination should help, never hinder.

---

## The Name

**Treebird** comes from the symbiosis of trees and birds:

- Trees provide structure, shelter, perspective
- Birds provide mobility, communication, pollination

In the Treebird ecosystem:

- **Code is the tree** — The structure being built
- **AI agents are the birds** — Mobile, productive, needing coordination

The individual tools follow the Japanese "-san" honorific pattern:

| Tool | Meaning |
|------|---------|
| Spidersan | The coordinator (spider's web = connections) |
| Mappersan | The cartographer (mapping the codebase) |
| Myceliumail | The messenger (mycelium = underground network) |
| Startersan | The initiator (getting things started) |

---

## Business Model

Treebird follows the **open core** model:

### Free Forever
- All CLI tools (MIT licensed)
- Local storage and functionality
- Core features for individual developers
- Startersan skill (no limits)

### Paid Tiers
- **Pro ($29/mo):** Hosted backend, zero setup, unlimited everything
- **Team ($99/mo):** Dashboard, analytics, multi-user coordination
- **Enterprise:** Self-hosted, SSO, SLA, dedicated support

**Philosophy:** The tools are free. We charge for convenience (hosted infrastructure) and scale (team features).

---

## Roadmap

### Phase 1: Foundation (Current)
- [x] Spidersan core (branch coordination)
- [x] Local storage adapter
- [x] Supabase cloud storage
- [x] End-to-end encryption
- [x] Documentation pyramid

### Phase 2: Ecosystem (Q1 2025)
- [ ] Mappersan v1 (documentation generation)
- [ ] Myceliumail standalone (agent messaging)
- [ ] Startersan skill (repository bootstrap)
- [ ] Cross-tool integration

### Phase 3: Intelligence (Q2 2025)
- [ ] Conflict prediction (ML-based)
- [ ] Auto-triage recommendations
- [ ] Merge sequence optimization
- [ ] Documentation drift detection

### Phase 4: Platform (Q3 2025)
- [ ] Team dashboard
- [ ] Analytics and insights
- [ ] Webhook integrations
- [ ] VS Code / JetBrains extensions

### Phase 5: Ecosystem Growth (Q4 2025)
- [ ] Plugin architecture
- [ ] Community tool marketplace
- [ ] Enterprise features
- [ ] Multi-repository coordination

---

## The Bigger Picture

Treebird isn't just about preventing merge conflicts. It's about building the infrastructure for a new way of developing software.

**The Old Model:**
```
Human writes code → Human reviews code → Human merges code
```

**The Current Model:**
```
Human directs AI → AI writes code → Human reviews → Human merges
```

**The Emerging Model:**
```
Human sets goals → Multiple AIs coordinate → AIs propose merge plan → Human approves
```

Treebird is infrastructure for that emerging model. When AI agents can:

- Understand codebases instantly (Mappersan + Startersan)
- Coordinate work automatically (Spidersan)
- Communicate directly (Myceliumail)

...then the human's role elevates from "code manager" to "outcome architect."

**We're not replacing developers. We're upgrading them.**

---

## Join the Flock

Treebird is open source and community-driven.

**GitHub:** github.com/treebird7

**Tools:**
- [Spidersan](https://github.com/treebird7/Spidersan) — Branch coordination
- Mappersan — *Coming soon*
- Myceliumail — *Coming soon*
- Startersan — *Available as Claude Code skill*

**License:** MIT

**Contributing:** PRs welcome. See CONTRIBUTING.md in each repository.

---

## Closing Thought

> "The forest is more than a collection of trees. It's a network—roots intertwined, mycelium connecting, birds carrying seeds between canopies. Each tree is productive alone, but the forest thrives because they coordinate."

AI agents are productive alone. But codebases thrive when they coordinate.

**Treebird makes the forest.**

---

*— treebird7, December 2024*

---

## Appendix: Tool Quick Reference

| Tool | Command | Purpose |
|------|---------|---------|
| Startersan | `/startersan` | Bootstrap AI-ready documentation |
| Mappersan | `msan init` | Generate documentation |
| Mappersan | `msan sync` | Update docs from code |
| Mappersan | `msan watch` | Auto-sync on changes |
| Spidersan | `ssan register` | Declare working files |
| Spidersan | `ssan conflicts` | Check for overlaps |
| Spidersan | `ssan merge-order` | Get merge sequence |
| Spidersan | `ssan rescue` | Start recovery mission |
| Myceliumail | `mycm send` | Message another agent |
| Myceliumail | `mycm inbox` | Check messages |
| Myceliumail | `mycm broadcast` | Team-wide alert |

## Appendix: Abbreviations

| Full Name | Standard | Short |
|-----------|----------|-------|
| Startersan | stsan | st |
| Mappersan | msan | ms |
| Spidersan | ssan | ss |
| Myceliumail | mycm | mc |
