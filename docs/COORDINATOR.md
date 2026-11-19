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

The coordinator asks all four itself. A missing one means it starts nothing
paid and charges nothing; it says which one in its output.

## Config

One JSON file. Nothing has a default: a missing field is exit 78.

| Field | Meaning |
|---|---|
| `hostId` | The one machine allowed to run it. `bun coordinator/main.ts --host-id` prints it |
| `stateDb` | Absolute path of the SQLite state file. The lock is `<stateDb>.lock` |
| `self`, `owner` | The coordinator's invoak principal, and the owner's |
| `escalationProject` | The invoak project escalation tasks are created in |
| `maxReviewsPerPass` | Review runs per pass, over all pull requests |
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

The launcher takes the lock and starts the pass. Exit 75: another coordinator
holds the lock. Exit 78: the config, the host or the invoak identity is wrong.
On exit 0 it prints one JSON line: what reconcile left pending, one entry per
pull request with its decision and what was done, and `unread`, the repos whose
pull requests could not be listed whole.

## Who hears the result

A note goes to the task a pull request's title names, when the title holds
exactly one `(xx-abcd)`, in a listed project, on a task that is in progress.
Otherwise the owner gets one escalation task. A note starts with `[prsan]` and
holds run ids, verdicts and finding ids, never review text.
