# BEST_PRACTICES - Spidersan

## Migrations
- Use `IF NOT EXISTS` / `IF EXISTS` always
- Test locally before push
- Spidersan migrations: 200-299
- Use `spidersan` schema for Spidersan tables

## Branching
- One feature = one branch
- Register with `spidersan register`
- Run `spidersan ready-check` before merge

## Environment
- Use staging for feature branches
- Use production for main only
- Set `SPIDERSAN_ENV` appropriately

## Fork Sync Workflow
- Always use `spidersan conflicts` before merging or cherry-picking from a fork — not after
- Register both branches (private + fork-candidate) before conflict detection to get accurate tier analysis
- Use per-commit `git diff --name-only <sha>^..<sha>` to classify each commit: SAFE / NEEDS-REVIEW / SKIP
- Skip commits that touch files where your branch has replaced the underlying platform/architecture
- Cherry-pick security and bug-fix commits individually (never batch them) so conflict resolution is surgical
- Prefer `sdkEnv` (never mutate `process.env`) over `process.env[key] = value` for secret handling in containers


- Check `spidersan inbox` for messages
- Use descriptive agent IDs
- Mark messages read after processing

## Branch Triage Pipeline (Feb-26)
When a repo accumulates stale/conflicting branches across multiple agents:
1. `spidersan list` — see all registered branches
2. `spidersan conflicts` — find file overlaps
3. `spidersan merge-order` — get sequencing
4. Cross-reference with GitHub PRs (`gh pr list`)
5. Categorize: MERGE / SUPERSEDED / STALE / DUPLICATE
6. Execute: abandon superseded, merge ready PRs, salvage valuable code
7. The combination of steps 1-3 is the value — not any single command

## Torrent Task Management (Feb-26)
- Use `torrent decompose` for planning (stays on current branch, no checkout)
- Use `torrent create` only when an agent is ready to start coding (creates git branch)
- Use `torrent tree` for full project visibility — best feature at 10+ tasks
- Use `torrent status --parent <id>` to scope to one workstream
- Use `torrent merge-order` before any merges — it sorts conflict-free tasks first
- Torrent lives in `spidersan-ecosystem` plugin, not core

## Local vs Supabase Storage (Feb-26)
- Registry is branch-local (`.spidersan/registry.json` in git tree) — stay on main for global visibility
- Override Supabase with `SUPABASE_URL= SUPABASE_KEY=` to force local storage
- Prefer local storage for testing and single-machine workflows
- Supabase only needed for cross-machine multi-agent coordination

## Salvaging Code from Abandoned Branches (Feb-26)
- Before abandoning a branch, check for unique features not on main
- Use `git checkout <branch> -- <file>` to extract specific files — faster than `spidersan rescue`
- Compare compiled dist files (if source is missing) against source to verify parity
- Always check if the branch's changes were superseded by already-merged PRs before salvaging
