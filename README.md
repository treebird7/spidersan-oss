# 🕷️ Spidersan

**Branch coordination for AI coding agents.** Agents register the files they are about to
touch. Spidersan tells them, before they merge, who else is touching those files and how
much that matters.

[![npm version](https://img.shields.io/npm/v/spidersan.svg)](https://www.npmjs.com/package/spidersan)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

![spidersan register, conflicts and ready-check in a repo where three agents share files](assets/demo.gif)

## Why

Put several agents (or people) on one repo, each on its own branch, and they will edit the
same files without knowing it. Git only notices at merge time, after both sides have
built on their changes. Spidersan moves that moment forward: every branch declares its
files up front, and every agent can ask "does anyone else have these?" at any point.

It is a local CLI with a JSON registry in `.spidersan/` and no telemetry. See
[what it sends over the network](docs/DATA_COLLECTION.md).

## Install

Requires Node.js 22 or newer.

```bash
npm install -g spidersan
```

Using Claude Code? Install the plugin as well, so the checks run without anyone having to
remember them (see [Claude Code plugin](#claude-code-plugin)).

## Quick start

```bash
spidersan init                                   # once per repo: creates .spidersan/

git switch -c feature/login
spidersan register --files "src/auth.ts,src/api.ts" --agent alice --description "login flow"

spidersan conflicts      # which other branches claim the same files, by tier
spidersan ready-check    # overlaps (blocking) and WIP markers (advisory) before you merge
spidersan merged         # after the merge lands, free the files
```

`--agent` can also come from `SPIDERSAN_AGENT`. Register early and re-run `register` when
your file list changes.

## Conflict tiers

Every overlapping file is classified by its path, and a branch's conflict takes the
highest tier among its files:

| Tier | Meaning | Built-in patterns (examples) |
|---|---|---|
| 🔴 3 · BLOCK | Resolve before merging | `.env`, `secrets.*`, `credentials`, `*.pem`, `auth.ts`, `security.ts` |
| 🟠 2 · PAUSE | Coordinate first | `package.json`, `package-lock.json`, `tsconfig.json`, `CLAUDE.md`, `index.*`, `config.*` |
| 🟡 1 · WARN | Safe, but worth a word | everything else |

`conflicts` also applies `conflicts.highSeverityPatterns` and
`conflicts.mediumSeverityPatterns` from your config. Their defaults add, for example,
`migrations/` and `route.ts` to tier 3 and `lib/`, `hooks/` and `utils/` to tier 2.

## Before you merge

Registry overlap tells you about *intent*. For the merge decision, ask git:

```bash
spidersan conflicts --pr 42 --real --vs-prs
```

- `--real` runs `git merge-tree` against trunk: true conflicts, not just shared files.
- `--vs-prs` checks overlap against every other open PR, registered or not (needs `gh`).
- `--pr <N>` checks a PR's head branch and changed files instead of the current branch.

Found conflicts exit 0 so the report is never mistaken for a crash. To gate a script, add
`--exit-code` (real conflicts exit 1) or `--strict` (real conflicts or tier 2+ overlap
exit 1).

## Claude Code plugin

```
/plugin marketplace add treebird7/spidersan-oss
/plugin install spidersan@spidersan
```

The plugin's hooks block force-pushes and commits that would sweep up another session's
files. They warn when two sessions share a checkout, when you edit a file that another
branch has registered, when your branch's PR has already merged, and when a worktree holds
someone else's uncommitted work. On push, merge and rebase they run `spidersan conflicts`.
It also adds a `/spidersan` skill. Details: [plugin/README.md](plugin/README.md).

## Commands

| Group | Commands |
|---|---|
| Registry | `init` · `register` · `list` · `merged` · `abandon` · `depends` · `stale` · `cleanup` · `sync` |
| Conflicts | `conflicts` (`--real`, `--pr`, `--vs-prs`, `--strict`, `--exit-code`, `--ecosystem`) · `cross-conflicts` |
| Merging | `merge-order` · `ready-check` · `pr-check <N>` · `rebase-helper` |
| Health | `doctor` · `verify-trunk` (trunk must claim no files) · `log` · `context` |
| Multi-machine | `registry-sync --push \| --pull \| --status` · `github-sync` |
| Watching | `watch` (auto-registers files as you edit them) |
| Setup | `config` |

Every command takes `--help`. `git-watch` is retired: it exits 1 and says what to use.

## Configuration

Config is read from `~/.spidersanrc`, `.spidersanrc`, `.spidersanrc.json` or
`.spidersan.config.json`. Project settings override global ones.

| Variable | Effect |
|---|---|
| `SPIDERSAN_AGENT` | Default agent id for `register`, `watch` and others when `--agent` is not given |
| `SPIDERSAN_SYNC_MODULE` | Absolute path to a cross-machine sync module (see below) |
| `SPIDERSAN_ECOSYSTEM` | Colon-separated repo paths for `conflicts --ecosystem` |
| `SPIDERSAN_ROOM_TOKEN` | Alert room for `conflicts --notify`; unset, alerts report `NOT NOTIFIED` locally |

### Several repos

`conflicts --ecosystem` scans the repos you list, chosen by the first that is set: `--repos a,b`,
`SPIDERSAN_ECOSYSTEM=a:b`, or `{ "conflicts": { "ecosystemRepos": ["~/code/a", "~/code/b"] } }`
in a config file.

### Several machines

By default the registry is local to one clone. To share it, write an ES module that exports
`createRegistrySyncClient()` (the interface is `SupabaseRegistrySyncClient` in
[`src/storage/supabase-registry-sync-client.ts`](src/storage/supabase-registry-sync-client.ts))
and point to it from your own `~/.spidersanrc` (a repo-local config is never used for this):

```json
{ "storage": { "syncModule": "~/path/to/registry-client.mjs" } }
```

Then `registry-sync` and `cross-conflicts` work, and `conflicts` includes other machines'
branches. If your backend also registers branches on push (for example, from a GitHub
webhook), `conflicts` sees work from tools that never ran spidersan: cloud agents, the web
editor, a teammate without the CLI. Without a module, `conflicts` says it checked local
branches only.

## More

- [Claude Code plugin](plugin/README.md): each hook and its settings
- [Data and network](docs/DATA_COLLECTION.md): what spidersan stores and sends
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md): dev setup and checks. The demo above is generated by
  [`assets/demo.sh`](assets/demo.sh).

Questions and bug reports: [GitHub Issues](https://github.com/treebird7/spidersan-oss/issues)
or treebird@treebird.dev · X: [@Treebird_Dev](https://x.com/Treebird_Dev)

If spidersan saves you a merge or two, you can support it through
[GitHub Sponsors](https://github.com/sponsors/treebird7) or
[Buy me a coffee](https://buymeacoffee.com/tree.bird).

MIT licensed ([LICENSE](LICENSE)). Part of [Treebird](https://treebird.uk) 🌲
