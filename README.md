
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
| `spidersan git-watch` | **Retired** — refuses and exits 1; use pushed-branch sync via `storage.syncModule` (below) |

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
| `spidersan registry-sync --push` | Push local branch registry through your sync module (share with other machines) |
| `spidersan registry-sync --pull` | Pull other machines' registries — see what the full fleet is working on |
| `spidersan registry-sync --status` | Show sync status across all machines |
| `spidersan cross-conflicts` | Detect file conflicts across machines via your sync module (`--local` for this machine only) |
| `spidersan github-sync` | Fetch branch/PR/CI status from GitHub for configured repos |
| `spidersan pr-check <number>` | Check a PR's merge readiness (stacked base, red/behind state) |
| `spidersan verify-trunk` | Detect registry trunk-poison (main/master must claim no files) |

> **Cross-machine sync needs a sync module.** `registry-sync`, `cross-conflicts` and the
> cross-machine half of `conflicts` talk to whatever registry your `storage.syncModule`
> provides — an ES module exporting `createRegistrySyncClient()` (the
> `SupabaseRegistrySyncClient` interface in `src/storage/supabase-registry-sync-client.ts`).
> Name it in your own `~/.spidersanrc` (a repo-local config is never read for this):
>
> ```json
> { "storage": { "syncModule": "~/path/to/registry-client.mjs" } }
> ```
>
> or with `SPIDERSAN_SYNC_MODULE=/abs/path/to/registry-client.mjs`. There is no built-in
> hosted client any more: `SPIDERSAN_SUPABASE_*` / `SUPABASE_*` no longer enable sync.
> Without a module, `registry-sync` and `cross-conflicts` exit 1 with this hint, and
> `conflicts` checks local branches only and says so. Everything else is local and needs
> no configuration.

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

### 🔕 git-watch (retired)

`git-watch` subscribed to a hosted git-event feed that no longer exists, and the sync-module
interface has no git-event API, so the command was retired. It is still registered so old
cron jobs and launch agents fail loudly: every invocation prints what to use instead and
exits 1. For cross-machine awareness of pushed branches use the pushed-branch sync below
through `storage.syncModule`; for local file watching use `spidersan watch`.

### 🤖 Pushed branches register themselves

Every push to a watched repo reaches the `spidersan-webhook` edge function through
the GitHub webhook, so a branch pushed by any tool — Codex, Copilot, a cloud agent,
the web editor, a person — is registered server-side in the cross-machine registry and
shows up in `conflicts` on every machine whose `storage.syncModule` reads that registry,
even though no local hook ran. No GitHub Actions workflow, and no write credential on
any client.

Rows sit under the virtual machine `github`, files are computed against the repo's
default branch, and a row is ignored wherever a real machine already has the same
branch. A closed PR or a deleted branch retires it.

The earlier OIDC Actions workflow (`auto-register.yml` → `register-branch` edge
function) was removed: nothing read what it wrote.

---

## 🪝 Claude Code Plugin

The hooks ship as a Claude Code plugin, so checks happen **automatically** and no agent has to remember to run them:

```
/plugin marketplace add treebird7/spidersan-oss
/plugin install spidersan@spidersan
```

It blocks force-pushes and commits that would sweep up another session's files. It also warns when two sessions share a checkout, when an edited file is registered on another branch, when a branch's PR already merged, and when a worktree holds someone else's uncommitted work. On push, merge and rebase it runs `spidersan conflicts`. See [plugin/README.md](plugin/README.md) for each hook, its requirements and the optional agent-identity settings. The plugin also adds the `/spidersan` skill.

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
