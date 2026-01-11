---
tags: [agent/mappersan, agent/spidersan, topic/mcp]
---

# Spidersan Use Cases

> **The Complete Guide to Spidersan Applications**
> Branch Coordination CLI for AI Coding Agents

---

## Table of Contents

1. [Development Use Cases](#development-use-cases)
2. [Agent Inner Documentation](#agent-inner-documentation)
3. [Marketing Use Cases](#marketing-use-cases)
4. [Industry-Specific Applications](#industry-specific-applications)
5. [Integration Scenarios](#integration-scenarios)

---

# Development Use Cases

## 1. Multi-Agent Coordination

### 1.1 Parallel Feature Development
**Scenario:** Multiple AI agents working on different features simultaneously in the same repository.

**Problem Solved:** Without coordination, Claude Code might edit `api/auth.ts` while Cursor is modifying the same file for a different feature, causing merge conflicts.

**Spidersan Solution:**
```bash
# Agent 1 (Claude Code) registers their work
spidersan register --files api/auth.ts,lib/jwt.ts --agent claude-code --desc "Adding JWT refresh tokens"

# Agent 2 (Cursor) checks before starting
spidersan conflicts
# Output: CONFLICT: api/auth.ts is being modified by claude-code (feature/jwt-refresh)

# Agent 2 picks non-conflicting files or waits
spidersan list
```

**Hashtags:** `#multi-agent` `#parallel-development` `#conflict-prevention` `#team-coordination`

---

### 1.2 Merge Order Optimization
**Scenario:** 15 branches ready to merge, but wrong order causes cascade failures.

**Problem Solved:** Merging `feature/db-schema` after `feature/new-endpoints` breaks because endpoints depend on schema changes.

**Spidersan Solution:**
```bash
spidersan merge-order
# Output:
# Optimal merge order:
# 1. feature/db-schema (0 conflicts, oldest)
# 2. feature/utils-refactor (0 conflicts)
# 3. feature/new-endpoints (1 conflict with db-schema - merge after)
# 4. feature/ui-components (2 conflicts)
```

**Hashtags:** `#merge-strategy` `#dependency-aware` `#conflict-resolution` `#ci-cd-optimization`

---

### 1.3 WIP Detection Before Merge
**Scenario:** Developer accidentally tries to merge a branch with TODO markers.

**Problem Solved:** Incomplete code with `// TODO: implement error handling` gets merged to production.

**Spidersan Solution:**
```bash
spidersan ready-check
# Output:
# Branch: feature/payment-flow
# Status: NOT READY
# Issues found:
#   - src/payments/stripe.ts:45 - TODO: add retry logic
#   - src/payments/stripe.ts:89 - FIXME: handle edge case
#   - src/payments/webhook.ts:23 - WIP: incomplete implementation
```

**Hashtags:** `#code-quality` `#pre-merge-validation` `#wip-detection` `#production-safety`

---

### 1.4 Stale Branch Management
**Scenario:** Repository cluttered with 50+ abandoned AI-generated branches.

**Problem Solved:** Old branches from forgotten experiments pollute the repo and confuse developers.

**Spidersan Solution:**
```bash
# Find branches older than 7 days
spidersan stale

# Find branches older than 3 days
spidersan stale --days 3

# Auto-cleanup stale branches
spidersan cleanup --older-than 14
# Removed 23 stale branches from registry

# Sync registry with actual git state
spidersan sync
```

**Hashtags:** `#repository-hygiene` `#branch-cleanup` `#stale-detection` `#maintenance`

---

### 1.5 Dependency Chain Tracking
**Scenario:** Feature branch depends on another feature that hasn't been merged yet.

**Problem Solved:** Merging `feature/ui-dashboard` fails because it imports from `feature/api-endpoints` which isn't in main yet.

**Spidersan Solution:**
```bash
# Declare dependency
spidersan depends feature/api-endpoints

# View dependencies
spidersan depends
# Output: feature/ui-dashboard depends on: feature/api-endpoints

# Merge order respects dependencies
spidersan merge-order
# Output:
# 1. feature/api-endpoints (must merge first)
# 2. feature/ui-dashboard (depends on #1)
```

**Hashtags:** `#dependency-management` `#branch-dependencies` `#merge-order` `#chain-tracking`

---

## 2. Solo Developer Workflows

### 2.1 Context Switching Between Tasks
**Scenario:** Developer uses multiple AI agents for different tasks throughout the day.

**Problem Solved:** Forgetting what each branch was for and which files were being modified.

**Spidersan Solution:**
```bash
# Morning: Start authentication feature with Claude
spidersan register --files lib/auth.ts,api/login.ts --desc "OAuth2 implementation"

# Afternoon: Switch to bug fix with Cursor
spidersan register --files components/Form.tsx --desc "Fix form validation bug"

# Evening: Review all active work
spidersan list
# Shows all branches with descriptions, files, and status
```

**Hashtags:** `#context-switching` `#task-tracking` `#solo-developer` `#productivity`

---

### 2.2 Branch Documentation
**Scenario:** Coming back to a project after a week, forgetting what each branch does.

**Problem Solved:** Branches named `feature/update-123` with no context on purpose or status.

**Spidersan Solution:**
```bash
spidersan list
# Output:
# Branch                    | Agent       | Files           | Description                    | Age
# feature/oauth2            | claude-code | 4 files         | OAuth2 with Google/GitHub     | 3d
# fix/form-validation       | cursor      | 1 file          | Fix email regex pattern        | 1d
# feature/dark-mode         | copilot     | 12 files        | Complete dark mode theme       | 5d
```

**Hashtags:** `#documentation` `#branch-tracking` `#project-memory` `#developer-experience`

---

### 2.3 Experimental Branch Tracking
**Scenario:** Developer wants to try multiple approaches to solve a problem.

**Problem Solved:** Losing track of which experimental approach was which.

**Spidersan Solution:**
```bash
# Register experiments
spidersan register --files lib/cache.ts --desc "Experiment: Redis cache approach"
spidersan register --files lib/cache.ts --desc "Experiment: In-memory LRU cache"

# Later, mark winner and abandon others
spidersan merged --pr 456  # Redis approach won
spidersan abandoned  # Abandon LRU approach (switch to that branch first)
```

**Hashtags:** `#experimentation` `#a-b-testing` `#prototype-tracking` `#decision-making`

---

## 3. Team Development Workflows

### 3.1 Cross-Agent Communication
**Scenario:** Claude Code discovers a bug while implementing a feature that another agent should know about.

**Problem Solved:** No way for AI agents to communicate findings to each other.

**Spidersan Solution:**
```bash
# Claude Code sends alert
spidersan send cursor "Security Issue Found" --type alert --branch feature/auth \
  --message "Found SQL injection vulnerability in user input handling.
  See lib/db.ts:145. This affects your feature/user-search branch."

# Cursor agent checks inbox
spidersan inbox
# Shows: [ALERT] From: claude-code - Security Issue Found (unread)

# Read full message
spidersan read msg_123abc
```

**Hashtags:** `#agent-communication` `#team-collaboration` `#bug-reporting` `#cross-agent`

---

### 3.2 Task Handoff Between Agents
**Scenario:** Claude Code completes backend API, needs to hand off to UI-focused agent.

**Problem Solved:** Manual context transfer between agents loses information.

**Spidersan Solution:**
```bash
# Claude Code completes backend and hands off
spidersan send frontend-agent "API Ready for UI Integration" --type handoff \
  --files api/users.ts,api/products.ts \
  --message "REST endpoints complete:
  - GET /api/users - returns paginated users
  - POST /api/products - creates product with validation
  - See OpenAPI spec at docs/api.yaml
  Branch: feature/rest-api is ready to merge"

# Frontend agent receives structured handoff
spidersan inbox --type handoff
```

**Hashtags:** `#handoff` `#workflow-automation` `#context-transfer` `#agent-collaboration`

---

### 3.3 Question & Answer Between Agents
**Scenario:** Agent needs clarification on existing code decisions.

**Problem Solved:** No way to ask "why was this done this way?" to the agent who wrote it.

**Spidersan Solution:**
```bash
# Agent asks question
spidersan send claude-code "Why custom auth instead of Passport?" --type question \
  --files lib/auth.ts \
  --message "I see a custom auth implementation. Was Passport.js considered?
  I'm adding OAuth and need to understand the constraints."

# Original agent responds
spidersan send cursor "RE: Why custom auth" --type info \
  --message "Passport.js was too heavy for our use case. Custom allows:
  1. Smaller bundle size
  2. Full control over session handling
  3. Easy JWT integration
  OAuth should extend AuthProvider class in lib/auth.ts:23"
```

**Hashtags:** `#knowledge-sharing` `#code-decisions` `#documentation` `#agent-questions`

---

### 3.4 Conflict Early Warning System
**Scenario:** Two developers assign AI agents to features that will conflict.

**Problem Solved:** Discovering conflicts only at PR time wastes hours of work.

**Spidersan Solution:**
```bash
# Before starting work, check for conflicts
spidersan register --files components/Header.tsx,lib/navigation.ts --dry-run
# Output:
# WARNING: Would conflict with:
#   - feature/mobile-nav (cursor): components/Header.tsx
#   - feature/menu-refactor (copilot): lib/navigation.ts
#
# Consider coordinating with these branches before proceeding.
```

**Hashtags:** `#early-warning` `#conflict-prevention` `#proactive-detection` `#coordination`

---

## 4. CI/CD Integration

### 4.1 Pre-Merge Pipeline Validation
**Scenario:** CI pipeline should verify Spidersan ready-check before allowing merge.

**Spidersan Solution:**
```yaml
# .github/workflows/pr-check.yml
name: PR Validation
on: pull_request

jobs:
  spidersan-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install -g spidersan
      - run: spidersan ready-check --strict
        # Fails if WIP markers found or conflicts exist
```

**Hashtags:** `#ci-cd` `#pipeline-integration` `#automated-checks` `#quality-gates`

---

### 4.2 Automated Branch Registry Sync
**Scenario:** Keep Spidersan registry in sync with actual git branches.

**Spidersan Solution:**
```yaml
# .github/workflows/nightly-sync.yml
name: Spidersan Sync
on:
  schedule:
    - cron: '0 0 * * *'  # Daily at midnight

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - run: npm install -g spidersan
      - run: |
          spidersan sync
          spidersan cleanup --older-than 14
```

**Hashtags:** `#automation` `#nightly-jobs` `#registry-sync` `#maintenance`

---

### 4.3 PR Auto-Labeling Based on Conflicts
**Scenario:** Automatically label PRs that have conflicts with other branches.

**Spidersan Solution:**
```bash
# In PR workflow
CONFLICTS=$(spidersan conflicts --json | jq '.conflicts | length')
if [ "$CONFLICTS" -gt 0 ]; then
  gh pr edit $PR_NUMBER --add-label "has-conflicts"
fi
```

**Hashtags:** `#pr-automation` `#labeling` `#github-actions` `#conflict-visibility`

---

## 5. Monorepo Management

### 5.1 Package-Level Conflict Detection
**Scenario:** Monorepo with multiple packages, need to track conflicts per package.

**Spidersan Solution:**
```bash
# Register with package context
spidersan register --files packages/api/src/routes.ts --desc "API package updates"
spidersan register --files packages/web/src/App.tsx --desc "Web package updates"

# Conflicts are detected even across packages
spidersan conflicts
# No conflicts - different packages
```

**Hashtags:** `#monorepo` `#package-management` `#workspace` `#multi-package`

---

### 5.2 Cross-Package Dependency Tracking
**Scenario:** Change in shared package affects multiple downstream packages.

**Spidersan Solution:**
```bash
# Shared package modification
spidersan register --files packages/shared/types.ts --desc "Adding new type definitions"

# This affects all consumers - visible in conflicts
spidersan conflicts
# Shows all branches modifying packages that import from shared
```

**Hashtags:** `#cross-package` `#dependency-chain` `#shared-code` `#impact-analysis`

---

---

# Agent Inner Documentation

> **For AI Coding Agents: How to Use Spidersan Effectively**

## Core Principles for AI Agents

### Principle 1: Always Register Before Modifying
```bash
# BEFORE making any file changes, register your intent
spidersan register --files <files-you-will-modify> --desc "<what you're doing>"
```

**Why:** This prevents other agents from unknowingly creating conflicts with your work.

---

### Principle 2: Check for Conflicts Before Starting
```bash
# Before beginning work on any files
spidersan conflicts
# Or check specific files
spidersan register --files target/files.ts --dry-run
```

**Why:** Discovering conflicts after hours of work wastes time. Check first.

---

### Principle 3: Use Descriptive Registrations
```bash
# BAD
spidersan register --files auth.ts

# GOOD
spidersan register --files lib/auth.ts,api/login.ts,tests/auth.test.ts \
  --agent claude-code \
  --desc "Implementing OAuth2 with Google and GitHub providers, including refresh token rotation"
```

**Why:** Other agents and developers need context to make coordination decisions.

---

### Principle 4: Communicate Important Findings
```bash
# When you discover something another agent should know
spidersan send <target-agent> "<subject>" --type <info|question|alert|handoff> \
  --message "<detailed context>"
```

**Why:** AI agents often work asynchronously. Message passing ensures knowledge transfer.

---

### Principle 5: Mark Completion States
```bash
# When your branch is merged
spidersan merged --pr <pr-number>

# When abandoning an approach
spidersan abandoned
```

**Why:** This keeps the registry accurate and helps `merge-order` calculations.

---

## Command Reference for Agents

### Essential Commands

| Command | When to Use | Example |
|---------|-------------|---------|
| `register` | Starting work on files | `spidersan register --files src/api.ts` |
| `conflicts` | Before starting any work | `spidersan conflicts` |
| `list` | Understanding current landscape | `spidersan list` |
| `ready-check` | Before requesting PR review | `spidersan ready-check` |
| `merge-order` | Planning merge sequence | `spidersan merge-order` |

### Communication Commands

| Command | When to Use | Example |
|---------|-------------|---------|
| `send` | Share info with another agent | `spidersan send cursor "Found bug" --type alert` |
| `inbox` | Check for messages | `spidersan inbox` |
| `read` | Read message details | `spidersan read <msg-id>` |

### Lifecycle Commands

| Command | When to Use | Example |
|---------|-------------|---------|
| `merged` | After PR is merged | `spidersan merged --pr 123` |
| `abandoned` | Giving up on approach | `spidersan abandoned` |
| `sync` | Registry seems stale | `spidersan sync` |

---

## Decision Trees for Agents

### Starting New Work
```
1. Is this a new branch?
   ├─ YES → Create branch, then:
   │        spidersan register --files <files> --desc "<description>"
   └─ NO  → Continue on existing registered branch

2. Check for conflicts:
   spidersan conflicts
   ├─ CONFLICTS FOUND →
   │   ├─ Can you work on different files? → Modify your plan
   │   ├─ Is the other work almost done? → Wait or coordinate
   │   └─ Must work on same files? → Send message to coordinate
   └─ NO CONFLICTS → Proceed with work
```

### Before Creating PR
```
1. Run ready-check:
   spidersan ready-check
   ├─ NOT READY → Fix WIP markers, then recheck
   └─ READY → Continue

2. Check merge order:
   spidersan merge-order
   ├─ Dependencies exist → Wait for them or coordinate
   └─ Good to go → Create PR

3. Update status:
   # After PR is merged
   spidersan merged --pr <number>
```

### When Discovering Issues
```
1. Is this issue relevant to other agents?
   ├─ YES → spidersan send <agent> "<subject>" --type alert
   └─ NO  → Handle locally

2. Is this a blocking issue?
   ├─ YES → Send with --type alert, include severity
   └─ NO  → Send with --type info

3. Do you need input from another agent?
   └─ YES → Send with --type question
```

---

## Best Practices for AI Agents

### 1. Atomic Registrations
Register all files you plan to modify upfront, not incrementally.

```bash
# BAD - Incremental (causes missed conflicts)
spidersan register --files auth.ts
# ... later ...
spidersan register --files login.ts  # Might conflict!

# GOOD - Complete upfront
spidersan register --files auth.ts,login.ts,session.ts
```

### 2. Granular Descriptions
Include what, why, and any dependencies.

```bash
# Helpful description format
spidersan register --files api/users.ts,lib/validation.ts \
  --desc "Adding email validation to user registration (depends on validation library update in feature/utils)"
```

### 3. Proactive Conflict Resolution
Don't just detect conflicts - resolve them.

```bash
# After detecting conflict
spidersan send cursor "Coordination needed for Header.tsx" --type info \
  --message "I'm modifying the navigation logic in Header.tsx.
  I see you're also working on it for mobile-nav.
  Proposal: I'll handle desktop nav (lines 1-50), you handle mobile (lines 51-100).
  Let me know if this works."
```

### 4. Clean Exit Protocol
Always clean up when done.

```bash
# Success path
git push origin feature/my-feature
gh pr create --title "Feature: XYZ"
# After merge:
spidersan merged --pr 123

# Failure path
spidersan abandoned
git branch -D feature/failed-experiment
```

---

## Message Templates for Agents

### Bug Discovery Alert
```bash
spidersan send <agent> "Bug Found in <component>" --type alert \
  --files affected/file.ts \
  --message "Severity: HIGH

  Location: src/affected/file.ts:123

  Issue: <description of bug>

  Impact: <what breaks>

  Suggested Fix: <if known>

  This affects your branch: <branch-name>"
```

### Handoff Message
```bash
spidersan send <agent> "Handoff: <feature> Ready for <next-phase>" --type handoff \
  --files list,of,files.ts \
  --message "## Completed Work
  - <bullet points of what's done>

  ## Files Modified
  - file1.ts: <what was changed>
  - file2.ts: <what was changed>

  ## Next Steps
  1. <what the receiving agent should do>
  2. <additional steps>

  ## Notes
  - <any gotchas or considerations>

  Branch is ready to merge: YES/NO"
```

### Coordination Request
```bash
spidersan send <agent> "Coordination: Both working on <component>" --type question \
  --files shared/file.ts \
  --message "I noticed we're both modifying <file>.

  My changes:
  - <description>

  Proposal:
  - <how to split the work>

  Questions:
  1. Does this work for you?
  2. What's your timeline?
  3. Should one of us wait?"
```

---

---

# Marketing Use Cases

## 1. Pain Point Solutions

### 1.1 "The Merge Conflict Nightmare"
**Target Audience:** Teams using multiple AI coding assistants

**The Problem:**
> "We started using Claude Code, Cursor, and Copilot Workspace. Within a week, we had 23 merge conflicts. Engineers spent more time resolving conflicts than writing code."

**The Solution:**
Spidersan provides real-time visibility into what every AI agent is working on, preventing conflicts before they happen.

**Key Message:** *"Stop playing merge conflict whack-a-mole. Know what every AI agent is doing, before they conflict."*

**Hashtags:** `#merge-conflicts` `#ai-coordination` `#developer-productivity` `#team-efficiency`

---

### 1.2 "The Lost Context Problem"
**Target Audience:** Solo developers using AI assistants

**The Problem:**
> "I have 15 branches from AI sessions. I don't remember what any of them were for or if they're safe to delete."

**The Solution:**
Every branch registered with Spidersan includes description, agent, files modified, and status - instant context at a glance.

**Key Message:** *"Never lose track of AI-generated branches again. Full context, always."*

**Hashtags:** `#context-management` `#branch-tracking` `#solo-developer` `#ai-assistant`

---

### 1.3 "The Silent AI Problem"
**Target Audience:** Organizations with multiple AI coding tools

**The Problem:**
> "Our AI assistants can't talk to each other. Claude found a bug that Cursor needed to know about, but there was no way to communicate."

**The Solution:**
Spidersan's agent messaging system enables AI-to-AI communication with typed messages, priorities, and handoffs.

**Key Message:** *"Give your AI agents a voice. Let them coordinate like a real team."*

**Hashtags:** `#ai-communication` `#agent-collaboration` `#team-coordination` `#knowledge-sharing`

---

### 1.4 "The Stale Branch Graveyard"
**Target Audience:** Repository maintainers

**The Problem:**
> "Our repo has 150 branches. Half are from abandoned AI experiments. Nobody knows what's safe to delete."

**The Solution:**
Spidersan tracks branch lifecycle from creation to merge/abandon, with automated stale detection and cleanup.

**Key Message:** *"Keep your repository clean. Automated stale branch detection and cleanup."*

**Hashtags:** `#repository-hygiene` `#branch-cleanup` `#maintenance` `#automation`

---

### 1.5 "The Wrong Merge Order Disaster"
**Target Audience:** DevOps and Release Engineers

**The Problem:**
> "We merged the UI branch before the API branch it depended on. Spent 4 hours debugging the cascade failures."

**The Solution:**
Spidersan calculates optimal merge order based on file conflicts and declared dependencies.

**Key Message:** *"Merge in the right order, every time. Dependency-aware merge ordering."*

**Hashtags:** `#merge-order` `#dependency-management` `#release-engineering` `#devops`

---

## 2. Competitive Positioning

### 2.1 vs. Manual Coordination
| Aspect | Manual | Spidersan |
|--------|--------|-----------|
| Conflict detection | At PR time (too late) | Before work begins |
| Branch tracking | Spreadsheets/Notion | Automated CLI |
| Agent communication | Slack/Discord | Native agent messaging |
| Merge ordering | Guesswork | Calculated algorithm |

**Hashtags:** `#productivity` `#automation` `#developer-experience`

---

### 2.2 vs. Git Alone
| Aspect | Git Only | Git + Spidersan |
|--------|----------|-----------------|
| See conflicts | After they happen | Predict before starting |
| Track AI sessions | No native support | Purpose-built tracking |
| WIP detection | Manual review | Automated scanning |
| Branch lifecycle | Manual management | Tracked states |

**Hashtags:** `#git-enhancement` `#developer-tools` `#workflow-optimization`

---

## 3. ROI Messaging

### 3.1 Time Savings Calculator
```
Average merge conflict resolution time: 45 minutes
Average conflicts per week (3+ AI agents): 8
Weekly time lost: 6 hours

With Spidersan:
- 80% conflict prevention
- 6.4 hours saved per week
- 332 hours saved per year per developer
```

**Key Message:** *"Save 6+ hours per week. Prevent conflicts instead of resolving them."*

**Hashtags:** `#roi` `#time-savings` `#productivity-metrics` `#developer-efficiency`

---

### 3.2 Quality Improvement
```
WIP markers slipping to production: ~2 per month
Cost per production incident: $X,XXX

With Spidersan ready-check:
- 100% WIP detection before merge
- Zero TODO/FIXME in production
- Reduced incident rate
```

**Key Message:** *"No more 'TODO' in production. Automated quality gates."*

**Hashtags:** `#code-quality` `#production-safety` `#incident-prevention`

---

## 4. Use Case Stories

### 4.1 The Startup Story
> "We're a 5-person startup. Everyone uses AI coding assistants. Before Spidersan, we had daily standups just to coordinate who was using which AI on which files. Now it's automatic."

**Target:** Early-stage startups, small teams

**Hashtags:** `#startup` `#small-team` `#agile` `#efficiency`

---

### 4.2 The Enterprise Story
> "With 50 developers using various AI tools across 12 repositories, coordination was chaos. Spidersan's centralized registry with Supabase gives us visibility we never had."

**Target:** Enterprise development teams

**Hashtags:** `#enterprise` `#scale` `#visibility` `#governance`

---

### 4.3 The Solo Developer Story
> "I use Claude Code for backend, Cursor for frontend. I kept forgetting what each branch was for. Spidersan's descriptions and tracking changed everything."

**Target:** Individual developers, freelancers

**Hashtags:** `#solo-developer` `#freelancer` `#personal-productivity`

---

### 4.4 The Open Source Story
> "Our open source project gets AI-generated PRs from contributors worldwide. Spidersan helps us track and coordinate these contributions."

**Target:** Open source maintainers

**Hashtags:** `#open-source` `#community` `#maintainer-tools`

---

## 5. Feature Highlights for Marketing

### Free Tier (MIT License)
- Branch registration and tracking
- Conflict detection
- Merge order calculation
- WIP/TODO detection
- Stale branch management
- Local storage (no account needed)

**Message:** *"Everything you need to coordinate AI agents. Free forever."*

---

### Pro Tier (Business Source License)
- Unlimited concurrent branches
- Cloud sync with Supabase
- Agent-to-agent messaging
- Conflict prediction
- Team collaboration
- MCP Server integration

**Message:** *"Scale your AI coordination. Team features for growing teams."*

---

---

# Industry-Specific Applications

## 1. Fintech / Banking

### 1.1 Regulatory Compliance Tracking
**Scenario:** AI agents implementing features that affect compliance.

**Use Case:**
- Track which branches modify compliance-related code
- Ensure proper review sequence for regulated code paths
- Alert when multiple agents touch PCI-DSS sensitive files

**Hashtags:** `#fintech` `#compliance` `#pci-dss` `#regulatory` `#banking`

---

### 1.2 Audit Trail for AI Changes
**Scenario:** Need to prove what AI made which changes and when.

**Use Case:**
- Complete history of agent registrations
- Timestamps on all branch activities
- Message trail for decision documentation

**Hashtags:** `#audit-trail` `#compliance` `#documentation` `#accountability`

---

## 2. Healthcare / HIPAA

### 2.1 PHI Code Path Protection
**Scenario:** Ensure AI agents don't simultaneously modify PHI-handling code.

**Use Case:**
- High-severity conflict detection for PHI files
- Mandatory ready-check before PHI code merges
- Agent messaging for security findings

**Hashtags:** `#healthcare` `#hipaa` `#phi-protection` `#security`

---

## 3. E-commerce

### 3.1 Checkout Flow Coordination
**Scenario:** Multiple features affecting the critical checkout path.

**Use Case:**
- Track all branches modifying checkout flow
- Optimal merge order for payment-critical code
- Conflict prevention for cart/payment logic

**Hashtags:** `#ecommerce` `#checkout` `#payment` `#critical-path`

---

### 3.2 Holiday Rush Preparation
**Scenario:** Multiple AI agents preparing features for Black Friday.

**Use Case:**
- Coordinate 20+ feature branches
- Dependency tracking for feature rollout
- Clear merge sequence for release

**Hashtags:** `#black-friday` `#holiday-prep` `#feature-coordination` `#release-management`

---

## 4. SaaS / Multi-tenant

### 4.1 Tenant Isolation Code
**Scenario:** Ensure AI agents don't break tenant isolation.

**Use Case:**
- High-severity patterns for multi-tenant code
- Alert when multiple agents modify isolation logic
- Ready-check for security-sensitive changes

**Hashtags:** `#saas` `#multi-tenant` `#isolation` `#security`

---

## 5. Gaming

### 5.1 Game Engine Coordination
**Scenario:** Multiple AI agents modifying game engine code.

**Use Case:**
- Track physics, rendering, audio system changes
- Prevent conflicting engine modifications
- Coordinate asset pipeline changes

**Hashtags:** `#gaming` `#game-dev` `#engine` `#asset-pipeline`

---

---

# Integration Scenarios

## 1. IDE Integrations

### 1.1 VS Code Extension
**Scenario:** See Spidersan status directly in VS Code.

**Use Case:**
- Status bar showing current branch registration
- Conflict warnings on file open
- Quick commands for register/check

**Hashtags:** `#vscode` `#ide-integration` `#developer-experience`

---

### 1.2 JetBrains Plugin
**Scenario:** IntelliJ/WebStorm integration.

**Use Case:**
- Tool window showing all branches
- Gutter icons for conflicting files
- Merge order visualization

**Hashtags:** `#jetbrains` `#intellij` `#webstorm` `#ide`

---

## 2. Chat/Collaboration Tools

### 2.1 Slack Integration
**Scenario:** Receive Spidersan alerts in Slack.

**Use Case:**
- Conflict notifications in team channel
- Stale branch alerts
- Merge order recommendations

**Hashtags:** `#slack` `#notifications` `#team-chat` `#alerts`

---

### 2.2 Discord Bot
**Scenario:** Open source project uses Discord.

**Use Case:**
- Bot commands for branch status
- Contributor coordination
- Conflict alerts in dev channel

**Hashtags:** `#discord` `#open-source` `#community` `#bot`

---

## 3. Project Management

### 3.1 Jira Integration
**Scenario:** Link branches to Jira tickets.

**Use Case:**
- Auto-update ticket when branch registered
- Conflict warnings on ticket
- Status sync to Jira

**Hashtags:** `#jira` `#project-management` `#ticket-tracking`

---

### 3.2 Linear Integration
**Scenario:** Modern project management sync.

**Use Case:**
- Branch-to-issue linking
- Automated status updates
- Team visibility

**Hashtags:** `#linear` `#modern-pm` `#issue-tracking`

---

## 4. AI Platform Integrations

### 4.1 Claude Code Native
**Scenario:** Built-in Spidersan awareness in Claude Code.

**Use Case:**
- Automatic registration on branch creation
- Conflict check before file edits
- Native message receiving

**Hashtags:** `#claude-code` `#anthropic` `#native-integration`

---

### 4.2 Cursor Integration
**Scenario:** Cursor AI with Spidersan awareness.

**Use Case:**
- MCP server for Spidersan commands
- AI-aware conflict prevention
- Agent identity tracking

**Hashtags:** `#cursor` `#ai-integration` `#mcp`

---

### 4.3 GitHub Copilot Workspace
**Scenario:** Copilot Workspace coordination.

**Use Case:**
- Track Copilot-created branches
- Integrate with existing workflow
- Team-wide visibility

**Hashtags:** `#copilot` `#github` `#workspace`

---

## 5. Monitoring & Observability

### 5.1 Datadog Metrics
**Scenario:** Track Spidersan metrics in Datadog.

**Use Case:**
- Conflict rate over time
- Branch lifecycle metrics
- Stale branch count

**Hashtags:** `#datadog` `#metrics` `#observability`

---

### 5.2 Grafana Dashboards
**Scenario:** Visualize branch coordination health.

**Use Case:**
- Real-time branch status
- Conflict heat maps
- Team activity metrics

**Hashtags:** `#grafana` `#dashboards` `#visualization`

---

---

# Rescue Mode: Repository Recovery

> **When chaos reigns, Spidersan brings order**

## 6. Rescue Mode Use Cases

### 6.1 The ADHD Developer Scenario
**Scenario:** Developer (often with AI assistance) has created 20+ branches over weeks. Some are complete, some are WIP, some are abandoned experiments. Main branch is outdated. Nobody knows what's where.

**Problem Solved:** Complete loss of project visibility. Developer feels overwhelmed and doesn't know where to start.

**Spidersan Solution:**
```bash
# 1. Install and start rescue mission
npm install -g spidersan
spidersan rescue --create-master

# 2. Scan all branches
spidersan scan --all
# Output:
# Found 23 branches
# - 8 appear active
# - 6 appear stale (>30 days)
# - 5 have conflicts with each other
# - 4 are orphaned (no clear purpose)

# 3. View triage dashboard
spidersan triage
# Shows: MERGE (3) | SALVAGE (5) | ABANDON (7)

# 4. See the light
spidersan status
# Clear action plan with next steps
```

**Hashtags:** `#rescue-mode` `#adhd-friendly` `#repository-recovery` `#chaos-to-order` `#overwhelm-relief`

---

### 6.2 AI Agent Branch Explosion
**Scenario:** Team uses Claude Code, Cursor, and Copilot. In one week, 47 branches were created. Many are duplicates, conflicts abound, nobody remembers which AI did what.

**Problem Solved:** AI-generated branch chaos with no coordination history.

**Spidersan Solution:**
```bash
# Scan with agent detection
spidersan scan --all --detect-agents
# Output:
# Branch analysis by agent:
# - claude-code: 18 branches (12 active, 6 stale)
# - cursor: 15 branches (8 active, 7 stale)
# - copilot: 9 branches (4 active, 5 stale)
# - unknown: 5 branches
#
# Duplicate work detected:
# - feature/auth (claude) ↔ feat/authentication (cursor) - 73% overlap
# - fix/login-bug (claude) ↔ bugfix/login (copilot) - 89% overlap

# Deduplicate
spidersan dedupe --interactive
# Choose which version to keep, salvage unique parts from others
```

**Hashtags:** `#ai-chaos` `#branch-explosion` `#deduplication` `#agent-detection` `#multi-ai-team`

---

### 6.3 Salvage Operation
**Scenario:** A branch is 80% garbage but has one brilliant component worth saving.

**Problem Solved:** Throwing away good code because the branch is mostly broken.

**Spidersan Solution:**
```bash
# Analyze branch for salvageable components
spidersan analyze feature/experimental-auth
# Output:
# BRANCH ANALYSIS: feature/experimental-auth
# Status: SALVAGEABLE
#
# USABLE COMPONENTS:
# ✓ src/middleware/auth.ts (complete, tested)
# ✓ src/utils/jwt.ts (complete)
#
# BROKEN/INCOMPLETE:
# ✗ src/routes/oauth.ts (WIP, conflicts)
# ✗ src/config/auth.ts (syntax errors)
#
# RECOMMENDATION: Salvage 2 components

# Extract the good parts
spidersan salvage feature/experimental-auth \
  --components src/middleware/auth.ts,src/utils/jwt.ts \
  --target feature/clean-auth

# Spidermail notification
spidersan send rescue-master "Salvage Complete" --type handoff \
  --message "Extracted auth middleware and jwt utils from experimental branch"
```

**Hashtags:** `#salvage` `#code-rescue` `#partial-recovery` `#component-extraction` `#waste-nothing`

---

### 6.4 Mappersan Intelligence Gathering
**Scenario:** Need to understand what each branch actually contains before deciding what to do with it.

**Problem Solved:** Manual inspection of 20+ branches is time-prohibitive.

**Spidersan + Mappersan Solution:**
```bash
# Mappersan analyzes each branch
mappersan analyze --branch feature/auth --report-to spidersan
mappersan analyze --branch feature/api --report-to spidersan
mappersan analyze --branch feature/ui --report-to spidersan

# Reports arrive via Spidermail
spidersan inbox
# FROM: mappersan@feature/auth - Analysis Complete
# FROM: mappersan@feature/api - Analysis Complete
# FROM: mappersan@feature/ui - Analysis Complete

# View consolidated intelligence
spidersan intel
# Displays all mappersan reports in unified view
# Shows: components, conflicts, recommendations per branch
```

**Hashtags:** `#mappersan-integration` `#intelligence-gathering` `#automated-analysis` `#branch-reports`

---

### 6.5 The Master Rescue Branch
**Scenario:** Need a single point of coordination for the entire rescue operation.

**Problem Solved:** Rescue efforts scattered, no single source of truth.

**Spidersan Solution:**
```bash
# Create master rescue branch
spidersan rescue --create-master
# Creates: claude/spidersan-rescue-master

# All rescue operations report here
# - Branch scans
# - Salvage operations
# - Mappersan analyses
# - Triage decisions

# View rescue mission status
spidersan rescue-status
# ┌─────────────────────────────────────────────┐
# │ RESCUE MISSION: my-chaotic-repo             │
# ├─────────────────────────────────────────────┤
# │ Started: 2 hours ago                        │
# │ Branches scanned: 23/23 ✓                   │
# │ Components salvaged: 8                      │
# │ Branches merged: 3                          │
# │ Branches abandoned: 7                       │
# │ Remaining: 5 (in triage)                    │
# │                                             │
# │ Progress: ████████████░░░░ 75%             │
# │                                             │
# │ Next action: Merge feature/db-schema        │
# └─────────────────────────────────────────────┘
```

**Hashtags:** `#master-branch` `#coordination-center` `#rescue-mission` `#single-source-of-truth`

---

### 6.6 Progressive Recovery
**Scenario:** Can't fix everything at once. Need to recover incrementally while still shipping features.

**Problem Solved:** Rescue mission blocks all other work.

**Spidersan Solution:**
```bash
# Set rescue priority levels
spidersan triage --prioritize
# P0 (Critical): Branches blocking deployments
# P1 (High): Branches with customer-facing features
# P2 (Medium): Internal tooling branches
# P3 (Low): Experimental/nice-to-have

# Work on P0 first while tracking others
spidersan rescue --priority P0
# Only processes critical branches

# Daily rescue progress
spidersan rescue --daily-summary
# Shows: What was recovered today, what's next
```

**Hashtags:** `#progressive-recovery` `#prioritization` `#incremental` `#ship-while-fixing`

---

### 6.7 The "Start Fresh But Keep History" Pattern
**Scenario:** Repo is so chaotic that starting fresh seems easier, but don't want to lose valuable work.

**Problem Solved:** False choice between "keep the mess" and "lose everything."

**Spidersan Solution:**
```bash
# Full archaeological scan
spidersan archaeology
# Scans ALL branches for valuable artifacts:
# - Completed features (never merged)
# - Useful utilities
# - Bug fixes
# - Documentation

# Create artifact manifest
spidersan archaeology --export artifacts.json
# JSON file of all valuable code with locations

# Start fresh branch from clean main
git checkout -b fresh-start main

# Replay valuable artifacts
spidersan replay artifacts.json --target fresh-start
# Intelligently applies salvaged code to fresh branch

# Old branches become archive
spidersan archive --all-except fresh-start
# Moves all old branches to archive/ prefix
```

**Hashtags:** `#fresh-start` `#archaeology` `#artifact-recovery` `#history-preservation` `#clean-slate`

---

## Rescue Mode Commands Reference

| Command | Purpose |
|---------|---------|
| `spidersan rescue` | Start rescue mission |
| `spidersan scan --all` | Scan all branches |
| `spidersan triage` | Categorize branches |
| `spidersan salvage <branch>` | Extract usable components |
| `spidersan dedupe` | Find and resolve duplicates |
| `spidersan archaeology` | Deep scan for valuable code |
| `spidersan replay <manifest>` | Apply salvaged code |
| `spidersan archive` | Move branches to archive |
| `spidersan rescue-status` | View mission progress |
| `spidersan intel` | View Mappersan reports |

---

## Rescue Mode Workflow Diagram

```
     CHAOS                    RESCUE                    ORDER
       │                         │                         │
       ▼                         ▼                         ▼
  ┌─────────┐             ┌─────────────┐           ┌─────────┐
  │ 20+     │             │   MASTER    │           │ Clean   │
  │ branches│────scan────▶│   RESCUE    │──merge───▶│ main    │
  │ ???     │             │   BRANCH    │           │ branch  │
  └─────────┘             └──────┬──────┘           └─────────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
                    ▼            ▼            ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │  TRIAGE  │ │ SALVAGE  │ │ ARCHIVE  │
              │ Decide   │ │ Extract  │ │ Preserve │
              │ fate     │ │ good     │ │ history  │
              └──────────┘ └──────────┘ └──────────┘
```

---

---

# Quick Reference: All Hashtags

## By Category

### Development
`#multi-agent` `#parallel-development` `#conflict-prevention` `#merge-strategy` `#dependency-aware` `#code-quality` `#wip-detection` `#pre-merge-validation` `#repository-hygiene` `#branch-cleanup` `#stale-detection` `#dependency-management` `#context-switching` `#documentation` `#experimentation` `#handoff` `#ci-cd` `#pipeline-integration` `#monorepo`

### Rescue Mode
`#rescue-mode` `#adhd-friendly` `#repository-recovery` `#chaos-to-order` `#overwhelm-relief` `#ai-chaos` `#branch-explosion` `#deduplication` `#agent-detection` `#multi-ai-team` `#salvage` `#code-rescue` `#partial-recovery` `#component-extraction` `#waste-nothing` `#mappersan-integration` `#intelligence-gathering` `#automated-analysis` `#branch-reports` `#master-branch` `#coordination-center` `#rescue-mission` `#single-source-of-truth` `#progressive-recovery` `#prioritization` `#incremental` `#ship-while-fixing` `#fresh-start` `#archaeology` `#artifact-recovery` `#history-preservation` `#clean-slate`

### Agent Documentation
`#agent-communication` `#cross-agent` `#knowledge-sharing` `#best-practices` `#workflow` `#decision-making` `#coordination` `#lifecycle-management`

### Marketing
`#productivity` `#time-savings` `#roi` `#developer-experience` `#team-efficiency` `#automation` `#scale` `#enterprise` `#startup` `#solo-developer` `#open-source`

### Industry
`#fintech` `#healthcare` `#ecommerce` `#saas` `#gaming` `#compliance` `#security` `#hipaa` `#pci-dss`

### Integrations
`#vscode` `#jetbrains` `#slack` `#discord` `#jira` `#linear` `#claude-code` `#cursor` `#copilot` `#datadog` `#grafana` `#github-actions`

---

*Document Version: 1.0*
*Last Updated: 2025-12-13*
*Maintainer: Spidersan Team*
