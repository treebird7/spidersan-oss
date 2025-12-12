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

## Agent Coordination
- Check `spidersan inbox` for messages
- Use descriptive agent IDs
- Mark messages read after processing
