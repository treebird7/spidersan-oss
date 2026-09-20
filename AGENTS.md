# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd prime` for full workflow context.

## CI Auto-Register (OIDC)

Pushed branches self-register in the cloud `branch_registry` via
`.github/workflows/auto-register.yml` — GitHub OIDC token verified by the
`register-branch` edge function, zero secrets in this repo. Don't manually
register a branch you just pushed; don't ever add a Supabase key of any
kind to this repo's Actions secrets (the old workflow was retired for
exactly that — c9a449b). Full rules: CLAUDE.md § "CI Auto-Register (OIDC)".

> **Architecture in one line:** Issues live in a local Dolt database
> (`.beads/dolt/`); cross-machine sync uses `bd dolt push/pull` (a
> git-compatible protocol), stored under `refs/dolt/data` on your git
> remote — separate from `refs/heads/*` where your code lives.
> `.beads/issues.jsonl` is a passive export, not the wire protocol.
>
> See [SYNC_CONCEPTS.md](https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md)
> for the one-screen overview and anti-patterns (don't treat JSONL as the
> source of truth; don't `bd import` during normal operation; don't
> reach for third-party Dolt hosting before trying the default).

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work atomically
bd close <id>         # Complete work
bd dolt push          # Push beads data to remote
```

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Knowledge graph — query the code instead of grepping it

`graphify-out/` holds a tree-sitter AST knowledge graph of this repo: ~1,980
nodes and ~4,280 edges over 247 code files. It is gitignored and rebuilt on
demand in about 30 seconds, never committed. Run from the repo root:

```bash
g() { env -i PATH="$HOME/.local/bin:$PATH" HOME="$HOME" TMPDIR="$TMPDIR" \
        uvx --from "graphifyy==0.9.64" --with tree-sitter-sql graphify "$@"; }

git fetch -q origin main
echo "graph : $(jq -r '.built_at_commit[0:7]' graphify-out/graph.json 2>/dev/null)"
echo "HEAD  : $(git rev-parse --short HEAD)"
echo "behind: $(git rev-list --count HEAD..origin/main) commits vs origin/main"

g extract . --code-only --force && g cluster-only . --no-label
g explain "getStorage"                              # a node and everything touching it
g affected "SupabaseStorage" --depth 2              # blast radius, reverse traversal
g path "conflictsCommand" "SupabaseStorage"         # how two things connect
g god-nodes --top 10
```

There are two staleness faults and only the first is obvious. `built_at_commit`
≠ `HEAD` means the graph is behind the checkout — rebuild in place. A non-zero
`behind` means the *checkout* is behind the remote, and rebuilding there
re-graphs old code into a graph that then **looks** fresh, because
`built_at_commit` and `HEAD` agree while both are stale. Build over
`git worktree add -q "$WT" origin/main` instead. An mtime comparison detects
neither reliably: a fresh checkout writes old code with new mtimes.

`--code-only` keeps extraction to local tree-sitter AST — no LLM, no network.
Without it the 52 markdown files are sent to a backend, and `extract` picks that
backend from *whichever API key is set*, which is why the wrapper runs under
`env -i`: the stripped environment is the control, the flag is only the intent.
`--with tree-sitter-sql` **fails silently** without the grammar — the 26 `.sql`
files parse to nothing and the run still exits 0 behind one warning.

`explain`, `affected` and `path` match exact symbol names and are precise;
`query "<plain question>"` is fuzzy keyword matching, so use it to discover a
symbol name and then switch. Two things this repo's graph actually shows:
`god-nodes` mixes framework fan-in (`vitest` 67 edges, `commander` 45) with real
hubs (`getStorage()` 63, `Branch` 54, `SupabaseStorage` 31), so read the list
rather than taking the top entry; and 176 labels are shared by more than one
node, so when a verb's answer contradicts an edge you can see in `graph.json`,
check for duplicates first:
`jq -r '.nodes[]|select(.label=="X")|.source_file' graphify-out/graph.json`.

Every file parsed — no syntax-error warnings. `graph.json` stores identifiers
plus `source_file`/`source_location` and no source text. `graph.html` next to it
is the clickable version.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
