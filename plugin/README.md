# Spidersan plugin for Claude Code

Git safety hooks for teams of AI coding agents working in the same repositories.
The hooks are advisory, except three that stop a command outright:
a force-push, a commit that would sweep up another session's files, and an `rm`
aimed at your home directory or `/`.

## Install

```
/plugin marketplace add treebird7/spidersan-oss
/plugin install spidersan@spidersan
```

Requirements: `bash`, `git`, `jq` and `python3`. The `spidersan` CLI
(`npm i -g spidersan`) is optional: the hooks that use it say so plainly when it is
missing, and the others don't need it.

## What the hooks do

| Hook | When | What it does |
|------|------|--------------|
| `force-push-guard.sh` | before a Bash command | **Blocks** `git push --force`, `-f` (also inside `-uf`), `+refspec` and `--mirror`. `--force-with-lease` stays allowed. |
| `same-file-warn.sh` | before and after Bash, after Write/Edit | Warns when another Claude session wrote the same file in this checkout in the last 30 minutes. **Blocks** a `git commit` that would include files another session wrote and hasn't committed. Override with `SAME_FILE_OK=1` in the command. |
| `spidersan-pre.sh` | before a Bash command | **Blocks** an `rm` aimed at your home directory or `/`, and flags any other `rm`. Advises on: a force-push to a trunk branch, `gh pr merge` on a stacked or red PR, a second agent mid-commit in the same checkout, committing on a branch whose prefix isn't yours, and pushing a branch whose PR is already merged or closed. Runs `spidersan conflicts` on push, merge and rebase. |
| `spidersan-post.sh` | after a Bash command | After a push, syncs the registry. After a merge, resets a trunk branch that wrongly claims files in the local registry. |
| `spidersan-overlap-warn.sh` | after Write/Edit | Warns when the file you just edited is also registered on another branch. |
| `spidersan-worktree-guard.sh` | session start | Warns when the worktree already holds uncommitted work that isn't yours. |

`same-file-warn.sh` keeps its state in `<git-dir>/claude-writes`, which is per worktree,
so agents in separate worktrees never warn each other. Working in your own worktree
(`git worktree add ../<repo>-<topic>`) is the fix most warnings point to.

## Telling agents apart (optional)

Two hooks compare a branch's prefix (`builder/fix-login`) with the current agent's
name, and `same-file-warn.sh` names the other session in its warnings. None of
this is required: with nothing configured, the hooks treat every session as
unknown and stay neutral.

| Variable | Meaning |
|----------|---------|
| `SPIDERSAN_IDENTITY_FILE` | A per-session file. `{session_id}` is replaced with the Claude Code session id, and a leading `~` expands. Example: `~/.agent-ids/{session_id}.env` |
| `SPIDERSAN_IDENTITY_KEY` | The `KEY=value` line to read from that file (default `SPIDERSAN_AGENT`). |
| `SPIDERSAN_AGENT` | This session's name when there is no identity file. Every session that inherits it gets the same name, so prefer the file when several agents share a machine. |
| `SPIDERSAN_SESSION_HINT` | A command to show for reaching another session. `{session_id}` is replaced. Example: `my-sessions watch {session_id}` |

Set them in the `env` block of `~/.claude/settings.json`:

```json
{
  "env": {
    "SPIDERSAN_IDENTITY_FILE": "~/.agent-ids/{session_id}.env",
    "SPIDERSAN_IDENTITY_KEY": "AGENT"
  }
}
```

A branch prefix counts as yours when it equals your name, its base before the first
`-` (`builder` for `builder-host2`), or that base plus a digit (`builder2`). Common
type prefixes such as `feat/`, `fix/` and `docs/` belong to nobody.

## Migrating from hand-installed hooks

If you copied these scripts into `~/.claude/hooks/` and wired them in
`settings.json`, remove those entries after installing the plugin. Otherwise each
hook runs twice on every call.

## Tests

```
for t in plugin/tests/test-*.sh; do bash "$t"; done
```

Each suite builds its own fixtures (temporary repos, stub `spidersan` and `gh` on
`PATH`), so it runs anywhere with `git`, `jq` and `python3`. CI runs them on every PR.
