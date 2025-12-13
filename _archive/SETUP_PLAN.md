# Spidersan Setup & Multi-Repo Plan

**Date:** December 12, 2025
**Status:** Draft - Under Discussion

---

## Setup Tiers

| Tier | Storage | Messaging | Use Case |
|------|---------|-----------|----------|
| **Free (Local)** | `.spidersan/registry.json` | ❌ None | Single repo, single machine |
| **Self-hosted Supabase** | User's Supabase | ✅ Full | Multi-repo, teams, needs setup |
| **Spidersan Cloud** (Pro) | Managed Supabase | ✅ Full | Zero setup, pay for convenience |

---

## The Multi-Repo Problem

If a user has multiple repos with agents working in parallel:

```
~/projects/
├── frontend/      <- Repo A (agent working here)
├── backend/       <- Repo B (agent working here)
└── mobile/        <- Repo C (agent working here)
```

They need a **shared Supabase project** to coordinate between repos.

### Options Considered

1. **Dedicated "coordination" repo** - A repo just for Spidersan config
   - Overkill for most users
   - Extra repo to manage

2. **Global config** - `~/.spidersan/config.json` with shared Supabase creds ✅
   - Single source of truth
   - Works across all repos on the machine
   - `.env` in each repo can override if needed

3. **Per-org Supabase** - One Supabase project per team/org
   - Good for teams
   - Requires coordination on who sets it up

**Recommendation:** Option 2 (global config) as default, with per-repo `.env` override.

---

## Proposed Commands

### `spidersan setup`

Interactive wizard for first-time setup:

```
🕷️ Spidersan Setup

? Choose storage mode:
  ○ Local only (single repo, no sync)
  ○ Self-hosted Supabase (bring your own)
  ○ Spidersan Cloud (coming soon)

? Enter Supabase URL: https://xxx.supabase.co
? Enter Supabase anon key: ********

? Run migrations now? (Y/n)

✅ Connected! Testing...
✅ Migrations applied!
✅ Saved to ~/.spidersan/config.json
```

### `spidersan migrate`

Apply/manage database migrations:

```bash
spidersan migrate              # Apply pending migrations
spidersan migrate --status     # Show migration status
spidersan migrate --dry-run    # Show what would be applied
```

---

## Config File Locations

| Location | Purpose | Priority |
|----------|---------|----------|
| `.env` (repo) | Per-repo overrides | Highest |
| `.spidersan.config.json` (repo) | Repo-specific settings | High |
| `~/.spidersan/config.json` | Global/shared settings | Medium |
| Environment variables | CI/CD, scripts | Highest |

---

## Setup Documentation Needed

### FAQ / How-To Guide

1. **Creating a Supabase Project**
   - Go to supabase.com
   - Create new project
   - Note the URL and anon key

2. **Getting API Keys**
   - Settings → API
   - Copy "Project URL" and "anon public" key

3. **Multi-Repo Setup**
   - Run `spidersan setup` once
   - All repos on the machine will use same Supabase
   - Use `.env` per-repo to override if needed

4. **Team Setup**
   - One team member creates Supabase project
   - Share URL and anon key with team
   - Each member runs `spidersan setup`

---

## Open Questions

1. **Spidersan Cloud pricing?**
   - Per-user? Per-org? Per-message?
   - Free tier limits?

2. **Migration permissions**
   - Anon key can't run DDL (CREATE TABLE)
   - Need service_role key for migrations
   - Security implications?

3. **Conflict between repos**
   - What if two repos register same branch name?
   - Namespace by repo URL?

4. **Offline/fallback**
   - If Supabase is unreachable, fallback to local?
   - Sync when back online?

---

## Next Steps

- [ ] Discuss open questions
- [ ] Design `spidersan setup` wizard UX
- [ ] Design `spidersan migrate` command
- [ ] Write setup documentation/FAQ
- [ ] Implement commands
- [ ] Test multi-repo scenario
