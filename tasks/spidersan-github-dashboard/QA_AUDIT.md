# QA AUDIT: spidersan-github-dashboard

## End-to-End Verification

The full flow to verify:

1. **M2 registers branch** → `spidersan register --files ...`
2. **Registry sync pushes** → `spidersan registry-sync --push`
3. **GitHub sync fetches** → `spidersan github-sync --all`
4. **M1 pulls and sees M2's branches** → `spidersan registry-sync --pull`
5. **Cross-machine conflict detected** → `spidersan conflicts --global`
6. **Sync advisor recommends actions** → `spidersan sync-advisor`
7. **TUI dashboard renders all state** → `spidersan dashboard`
8. **Web dashboard shows live updates** → FlockView `/spidersan` route

## Verification Checklist

- [ ] Registry data round-trips: local → Supabase → other machine
- [ ] GitHub state matches reality (branch count, PR status, CI)
- [ ] Cross-machine conflicts are real (not false positives)
- [ ] Sync advisor recommendations are safe to execute
- [ ] TUI renders without crashes on 80-col terminal
- [ ] Web dashboard loads and shows Realtime updates
- [ ] Backward compatibility: all existing commands work unchanged
- [ ] Security: no path traversal via machine_id or repo_name fields
- [ ] Performance: github-sync < 30s for 10 repos

## QA Status

**Not started** — Awaiting feature implementation.
