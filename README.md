
# 🕷️ Spidersan

### Coordination for the multi-agent era

**Branch coordination for AI coding agents**

[![npm version](https://img.shields.io/npm/v/spidersan.svg)](https://www.npmjs.com/package/spidersan)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

![Demo](./assets/demo.gif)

[Quick Start](#-quick-start) • [Features](#-features) • [Documentation](#-documentation)

</div>

---


## 🎯 The Problem

Multi-agent teams working across branches inevitably collide — overlapping files, unclear merge order, rogue abandoned branches. The bigger the fleet, the worse the chaos.

## 🕷️ The Solution

**Spidersan** is your AI team's coordination layer. It tracks branches, detects conflicts early, and recommends a merge order based on registered overlap—so your agents can work in harmony.

```bash
# Register your branch
spidersan register --files "lib/auth.ts,api/login.ts"

# See what conflicts with you
spidersan conflicts

# Get the right merge order
spidersan merge-order

# Check if you're ready to merge
spidersan ready-check
```

**Results with Spidersan (same team):**
- ⏱️ ~5 min (about 10x faster)
- ✅ 0 conflicts

---

## 🚀 Quick Start

### Installation

```bash
npm install -g spidersan
```

### Basic Usage

```bash
# 1. Register your branch when you start working
spidersan register --files "lib/auth.ts,api/login.ts"

# 2. Check for conflicts before you go too deep
spidersan conflicts

# 3. When done, verify you're merge-ready
spidersan ready-check

# 4. Get recommended merge order for the team
spidersan merge-order
```

---

## ✨ Features

### Core Commands

| Command | Description |
|---------|-------------|
| `spidersan init` | Initialize Spidersan in the current project |
| `spidersan register --files` | Register a branch with the files being modified |
| `spidersan list` | List all registered branches and their file ownership |
| `spidersan conflicts` | Detect file conflicts between branches (tiered: T1/T2/T3) |
| `spidersan conflicts --ecosystem` | Aggregate conflict scan across the repos you configure (see [Ecosystem scan](#ecosystem-scan-repo-list)) |
| `spidersan conflicts --real` | Compute TRUE merge conflicts via `git merge-tree` (vs registry overlap) |
| `spidersan merge-order` | Get topologically-sorted optimal merge order |
| `spidersan ready-check` | Verify branch is ready to merge (no WIP, no conflicts) |
| `spidersan depends` | Set/show branch dependencies (deps merge first; synced cross-machine) |
| `spidersan stale` | Find stale branches |
| `spidersan cleanup` | Remove stale branches from registry |
| `spidersan abandon` | Abandon a branch (mark inactive) |
| `spidersan merged` | Mark a branch merged |
| `spidersan sync` | Sync registry with actual git branches |
| `spidersan watch` | Daemon mode: watch files and auto-register |
| `spidersan doctor` | Diagnose local state and registry health |
| `spidersan config` | View/edit configuration + setup wizard |
| `spidersan log` | Show branch operation history (local activity log) |
| `spidersan rebase-helper` | Detect and guide through local git rebase states |
| `spidersan git-watch` | Subscribe to GitHub webhook events — cross-machine push/PR/create/delete with AI conflict routing |

#### Ecosystem scan repo list

`conflicts --ecosystem` ships with no built-in repo list. Pick one (first match wins):

1. `--repos /path/to/repo-a,/path/to/repo-b`
2. `SPIDERSAN_ECOSYSTEM=/path/to/repo-a:/path/to/repo-b` (colon-separated)
3. A config file (`~/.spidersanrc`, `.spidersanrc`, `.spidersanrc.json` or `.spidersan.config.json`):

```json
{ "conflicts": { "ecosystemRepos": ["~/code/repo-a", "/path/to/repo-b"] } }
```

A project-level file's list replaces the global one rather than extending it. With nothing configured the scan prints a hint and checks no repos.

Plugin switches (separate from the repo list): `SPIDERSAN_CORE_ONLY=1` or `SPIDERSAN_ECOSYSTEM=0` disables the optional `spidersan-ecosystem` plugin. Neither value is read as a repo path.

### 🌐 Multi-Repo & Cloud Commands

| Command | Description |
|---------|-------------|
| `spidersan registry-sync --push` | Push local branch registry to the shared Supabase (share with other machines) |
| `spidersan registry-sync --pull` | Pull other machines' registries — see what the full fleet is working on |
| `spidersan registry-sync --status` | Show sync status across all machines |
| `spidersan cross-conflicts` | Detect file conflicts across machines via Supabase |
| `spidersan github-sync` | Fetch branch/PR/CI status from GitHub for configured repos |
| `spidersan pr-check <number>` | Check a PR's merge readiness (stacked base, red/behind state) |
| `spidersan verify-trunk` | Detect registry trunk-poison (main/master must claim no files) |

> **Note:** `registry-sync`, `cross-conflicts`, and `git-watch` require a **`service_role`** key in `SUPABASE_KEY` — anon writes are denied by RLS. See `.env.example` for the required credential format.

### Watch Mode (Daemon)

Real-time file monitoring with auto-registration:

```bash
# Start watching (auto-registers file changes)
spidersan watch --agent myagent

# Quiet mode (only show conflicts)
spidersan watch --agent myagent --quiet

# Watch only specific paths
spidersan watch --paths "src,lib" --root .
```

**Features:**
- 📁 Auto-registers files when you edit them
- ⚠️ Real-time conflict detection
- 🕐 Debounced (1s) to prevent spam

### 🔔 git-watch — GitHub Webhook Notifications

Cross-machine push/delete notifications via a GitHub org webhook → Supabase edge function → `spidersan_git_events` table. Each machine runs a polling daemon that reacts to events: auto-abandons deleted branches in the registry, warns to run `spidersan conflicts` on pushes.

**Infrastructure (one-time setup):**

1. **Deploy edge function** to your Supabase runtime project:
   ```bash
   supabase functions deploy spidersan-webhook --no-verify-jwt --project-ref <runtime-ref>
   ```

2. **Set edge function secret** (`SPIDERSAN_WEBHOOK_SECRET`) via the Supabase dashboard or CLI.

3. **Apply the migration** (`supabase/migrations/20260421000000_spidersan_git_events.sql`) to your runtime project.

4. **Create a GitHub org webhook:**
   - URL: `https://<runtime-ref>.supabase.co/functions/v1/spidersan-webhook`
   - Content type: `application/json`
   - Secret: your `SPIDERSAN_WEBHOOK_SECRET` value
   - Events: **Pushes**, **Pull requests**, **Branch or tag creation**, **Branch or tag deletion**

**Running the daemon on each machine:**

```bash
# One-shot catch-up (useful for cron / CI)
SUPABASE_URL=https://<runtime-ref>.supabase.co \
SUPABASE_KEY=<service-role-key> \
spidersan git-watch --once

# Persistent daemon (poll every 30s)
SUPABASE_URL=https://<runtime-ref>.supabase.co \
SUPABASE_KEY=<service-role-key> \
spidersan git-watch --interval 30000
```

**macOS LaunchAgent (keep-alive daemon):**

```xml
<!-- ~/Library/LaunchAgents/com.treebird.spidersan-git-watch.plist -->
<key>ProgramArguments</key>
<array>
  <string>/usr/local/bin/node</string>
  <string>/path/to/spidersan-oss/dist/bin/spidersan.js</string>
  <string>git-watch</string>
  <string>--interval</string>
  <string>30000</string>
</array>
<key>EnvironmentVariables</key>
<dict>
  <key>SUPABASE_URL</key><string>https://<runtime-ref>.supabase.co</string>
  <key>SUPABASE_KEY</key><string><anon-key></string>
</dict>
```

```bash
launchctl load ~/Library/LaunchAgents/com.treebird.spidersan-git-watch.plist
tail -f /tmp/spidersan-git-watch.log
```

**What each event does:**

| Event | Action |
|-------|--------|
| `push` | Logs to `activity.jsonl`, warns to run `spidersan conflicts`. Detects new gold pairs in `sql-tree/pairs/` and `ts-tree/pairs/` — emits `🌱 tree_pairs_ready` cue to `~/.spidersan/git-events-pending.jsonl` |
| `delete` | Marks branch `abandoned` in the local registry, archives to `~/.spidersan/archive.jsonl` |
| `pull_request` / `create` | Logged only |

### 🤖 Pushed branches register themselves

Every push to a watched repo reaches the `spidersan-webhook` edge function through
the GitHub webhook, so a branch pushed by any tool — Codex, Copilot, a cloud agent,
the web editor, a person — is registered in `spider_registries` and shows up in
`conflicts` on every machine, even though no local hook ran. No GitHub Actions
workflow, and no write credential outside Supabase.

Rows sit under the virtual machine `github`, files are computed against the repo's
default branch, and a row is ignored wherever a real machine already has the same
branch. A closed PR or a deleted branch retires it.

The earlier OIDC Actions workflow (`auto-register.yml` → `register-branch` edge
function → `branch_registry`) was removed: nothing read `branch_registry`.

---

## 🪝 Claude Code Plugin

The hooks ship as a Claude Code plugin, so checks happen **automatically** and no agent has to remember to run them:

```
/plugin marketplace add treebird7/spidersan-oss
/plugin install spidersan@spidersan
```

It blocks force-pushes and commits that would sweep up another session's files. It also warns when two sessions share a checkout, when an edited file is registered on another branch, when a branch's PR already merged, and when a worktree holds someone else's uncommitted work. On push, merge and rebase it runs `spidersan conflicts`. See [plugin/README.md](plugin/README.md) for each hook, its requirements and the optional agent-identity settings.

---

## 📖 Documentation

- [Core Guide](docs/CORE.md) - Public feature set and core workflows
- Usage (internal; see spidersan-ecosystem repo)
- [Data Collection](docs/DATA_COLLECTION.md) - Privacy & data practices

---



## 🗣️ Feedback & Support

We're building this in public and want to hear from you!

- **Issues & Features:** [GitHub Issues](https://github.com/treebird7/spidersan-oss/issues)
- **Email:** treebird@treebird.dev
- **Site:** [Treebird](https://treebird.uk)
- **Twitter/X:** [@Treebird_Dev](https://twitter.com/Treebird_Dev)

Tell us what's working, what's broken, and what you'd love to see next.

---

## 🤝 Contributing

Contributions welcome! Please read our contributing guidelines first.

---

## Support

### Fuel the Flock

Treebird is free and open source. Star our repos on GitHub or support us to keep the servers running and the agents dreaming.

❤️ Sponsor on GitHub
https://github.com/sponsors/treebird7

☕ Buy me a coffee
https://buymeacoffee.com/tree.bird

---

## 📄 License

MIT License - see [LICENSE](LICENSE) for details

---

<div align="center">

**Made with 🕷️ for AI-first development teams**

Part of the [Treebird Ecosystem](https://treebird.uk) 🌲

</div>
