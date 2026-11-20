# Running the PR coordinator

The coordinator lives in `coordinator/` and runs on Bun. It is not part of the
published npm package. One run makes one pass and exits.

## What a pass does

1. Resolves anything an earlier run left unfinished (a note or escalation with
   no receipt).
2. Lists the open, non-draft pull requests of every repo in the config.
3. For each one: reads it, decides, and does one thing. The steps, in order,
   are triage, the review set triage picked, then one note or one escalation.
   The pull request is read again after every paid step.

It never merges. `live` mode is refused by the config parser, and no pull
request can reach a merge decision until invoak can say who registered a branch.

## Before the first run

| Needed | How to check |
|---|---|
| The reviewer sandbox | `<prsan home>/bin/isolated-run --check` prints `sandbox-exec` when `PRSAN_ISOLATION=require` |
| A prsan pin | `<prsan home>/bin/trusted-inputs` prints a snapshot directory |
| `CLAUDE_CODE_OAUTH_TOKEN` in the environment | triage logs in with it |
| invoak acting as the configured principal | `invoak whoami` |
| A GitHub token per repo owner, in the variable `githubTokens` names | `bun coordinator/main.ts --preflight <config.json>` |

The coordinator asks all five itself. A missing one means it starts nothing
paid and charges nothing; it says which one in its output.

### GitHub tokens

Every GitHub read the coordinator makes runs with the fine-grained token of the
repo's owner, passed to that one `gh` run as `GH_TOKEN`. The host's own `gh`
login, and any `GH_TOKEN` or `GITHUB_TOKEN` the coordinator was started with,
are never used for them: a repo with no token is not read. (Triage and prsan
runs are separate: they still get an ambient `GH_TOKEN` if one is set.) The tokens need Metadata, Contents, Pull
requests, Commit statuses and Actions read; a repo in `live` mode also needs
Commit statuses write (and Contents and Pull requests write to merge).

Before any pass, each repo's token is checked. It must be set, read the repo,
its pull requests, its default branch, commit statuses and Actions runs, and not
be expired. In `live` mode it must also be allowed to write commit statuses:
the check posts a status to the all-zero sha, which GitHub refuses with 422 when
the token may write and 403 when it may not, and creates nothing either way.
Review-only and dry-run deliver through invoak and write nothing to GitHub, so
their tokens are not asked to write. A token under 14 days from expiry starts
with a warning. Anything else is exit 77, naming the repo, the variable and
what GitHub asked for, never the token.

`bun coordinator/main.ts --preflight <config.json>` runs that check alone, with
the write check for every repo whatever its mode, so a token can be checked
before its repo goes live. It takes no lock and opens no database. The flag
goes first: the launcher refuses anything after the config path (exit 78).

CI is read from each head's Actions runs and jobs and its commit statuses, not
from check runs, which a fine-grained token cannot read on a private repo. A
re-run counts at its latest attempt. Check runs from other apps (Socket
Security) are not seen; no repo requires one.

## Config

One JSON file. Nothing has a default: a missing field is exit 78.

| Field | Meaning |
|---|---|
| `hostId` | The one machine allowed to run it. `bun coordinator/main.ts --host-id` prints it |
| `stateDb` | Absolute path of the SQLite state file. The lock is `<stateDb>.lock` |
| `self`, `owner` | The coordinator's invoak principal, and the owner's |
| `escalationProject` | The invoak project escalation tasks are created in |
| `maxReviewsPerPass` | Review runs per pass, over all pull requests |
| `githubTokens` | GitHub owner → the environment variable holding that owner's token, e.g. `{"treebird7": "TREEBIRD7_SPIDERSAN_PAT", "Treebird-Ecosystem": "TREEBIRD_ECOSYSTEM_SPIDERSAN_PAT"}`. Every repo's owner, spelled as in its key. One variable per owner; not `GH_TOKEN` or `GITHUB_TOKEN` |
| `prsan.home` | Absolute path of the prsan agent directory |
| `prsan.timeoutMs` | How long one triage or review run may take |
| `prsan.models` | Model family → what `prsan -m` is given. Needs `luna`, `terra`, `sol` and each repo's `secondFamily` |
| `prsan.families` | A review file's `model:` header → model family. Every family in `models` must appear as a value |
| `repos.<owner/name>.taskProjects` | Projects a `(xx-abcd)` in a title may name |
| `repos.<owner/name>.policy` | Mode, per-PR ceiling, reservations, head limit, stall timers (`coordinator/types.ts`, `Policy`) |
| `repos.<owner/name>.touches` | `protectedPaths` (escalate, unreviewed) and `mergeEffects` |

## Launch

```bash
coordinator/spidersan-coordinator /path/to/config.json
```

When the token comes from the Envoak vault, the agent label has to be put back
inside the injected process: `envoak vault inject` does not pass it on, and
without it invoak has no identity and the coordinator exits 78.

```bash
envoak vault inject --key @<agent> \
  --only <service>/CLAUDE_CODE_OAUTH_TOKEN,github/TREEBIRD7_SPIDERSAN_PAT,github/TREEBIRD_ECOSYSTEM_SPIDERSAN_PAT -- \
  /usr/bin/env ENVOAK_AGENT_LABEL=<agent> \
  coordinator/spidersan-coordinator /path/to/config.json
```

The two `github/` secrets are the per-owner tokens `githubTokens` names.

The launcher takes the lock and starts the pass. Exit 75: another coordinator
holds the lock. Exit 78: the config, the host or the invoak identity is wrong.
Exit 77: a repo's GitHub token is missing, expired or lacks a permission.
On exit 0 it prints one JSON line: what reconcile left pending, one entry per
pull request with its decision and what was done, and `unread`, the repos whose
pull requests could not be listed whole.

## Who hears the result

A note goes to the task a pull request's title names, when the title holds
exactly one `(xx-abcd)`, in a listed project, on a task that is in progress.
Otherwise the owner gets one escalation task. A note starts with `[prsan]` and
holds run ids, verdicts and finding ids, never review text.
