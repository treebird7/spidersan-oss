# Data and network

Spidersan is a local CLI with no telemetry and no hosted service. This page lists what it
stores on disk and every reason it goes over the network.

## Stored locally

| Where | What |
|---|---|
| `.spidersan/registry.json` (in each repo) | Per registered branch: name, file paths, status, agent id, description, registration time, and the Claude Code session id when `CLAUDE_CODE_SESSION_ID` is set |
| `~/.spidersan/activity.jsonl` | A local history of registry operations (`spidersan log`) |
| `~/.spidersan/update-cache.json` | When the last version check ran and what it found |

File **contents**, commit messages and diffs are never stored. `.spidersan/` is local
state: add it to `.gitignore` unless you mean to commit it.

## Network

| When | Where to | What is sent |
|---|---|---|
| Any command, at most once a day | `registry.npmjs.org` | A request for the latest `spidersan` version (to print an update notice) |
| A registered branch has no ref on this machine | Your git remote (`git ls-remote --heads origin`) | The same request `git fetch` makes, to tell a deleted branch from an unfetched one |
| `--pr`, `--vs-prs`, `pr-check`, `github-sync` | GitHub, through your `gh` CLI | `gh` API calls for PR metadata and changed-file lists |
| Only if you configure `storage.syncModule` | Wherever **your** module sends it | Your registry entries, as above. The module is your code; spidersan ships no backend |
| `conflicts --notify` with `SPIDERSAN_ROOM_TOKEN` set | The toak.me room the token names | The conflict alert: repo, branch, tier, file paths |
| `spidersan log` with `SPIDERSAN_SUPABASE_URL` / `_KEY` set | That Supabase project | A read of the activity log table |

Nothing else. Outbound calls are either `fetch(` or a spawned `git` / `gh`, so
`rg 'fetch\(' src` plus the `gh` helpers in `src/lib/github.ts` cover them.

## Questions

Open an issue on [GitHub](https://github.com/treebird7/spidersan-oss/issues).
