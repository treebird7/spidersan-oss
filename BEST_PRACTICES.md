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
