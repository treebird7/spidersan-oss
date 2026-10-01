# Spidersan Colony Integration

> **The emit side was removed (tb-ba69).** Envoak colony signals were pruned on 2026-08-04
> (ADR-0002), so `hooks/post-checkout` and `hooks/post-checkout-release` — whose only job was
> `envoak colony signal` — are deleted, and Spidersan no longer emits `work_claim`/`work_release`.
> Nothing in `src/` installed those hooks, so `init`/`doctor` never did either. The **read** side
> below (`pulse`, `stale`, `conflicts`, `colony-subscriber`) still queries `colony_state`, which no
> longer receives new signals from this repo; cross-machine awareness is `registry-sync` +
> `cross-conflicts` (Supabase). Treat the sections below as historical until the read side is retired.

Spidersan connects to [Envoak Colony](https://envoak.dev) — a signal bus for multi-agent coordination. It used to read and write Colony signals to keep the agent fleet aware of which branches were being worked on; only the read side remains.

Colony is an **optional dependency** — signal reception is guarded by environment variable checks and wrapped in silent try/catch blocks. Spidersan operates normally when Colony is not configured.

---

## Setup

### Environment variables

| Variable | Description |
|---|---|
| `COLONY_SESSION_ID` | Active Colony session identifier. Set by `envoak colony enlist`. |
| `COLONY_AGENT_KEY_ID` | Agent key UUID registered in Envoak Vault. Authenticates signals. |
| `COLONY_SUPABASE_URL` | MycToak Supabase project URL (for reading Colony state). |
| `COLONY_SUPABASE_KEY` | Supabase anon key (public — no JWT needed, migration 025 grants SELECT). |

`COLONY_SESSION_ID` and `COLONY_AGENT_KEY_ID` were only used for **emitting** signals — no longer used here.
`COLONY_SUPABASE_URL` + `COLONY_SUPABASE_KEY` are needed for **reading** Colony state (`pulse`, `stale`, `conflicts`).

---


---

## Commands

### `spidersan pulse`

Syncs the local registry from Colony then reports conflicts:

```bash
spidersan pulse
```

1. Calls `syncFromColony()` — queries `colony_state` view for active `work_claim` signals
2. Upserts claimed branches into the local registry (additive — never removes local data)
3. Sweeps `work_release` signals to remove released branches
4. Reports file-level conflicts across the updated registry

Offline fallback: if `COLONY_SUPABASE_URL` is not set or the network is unreachable, reports local conflicts only with a warning.

### `spidersan conflicts`

Now syncs from Colony before checking the local registry:

```bash
spidersan conflicts
```

Additive merge — Colony data supplements local data, never replaces it.

### `spidersan stale`

Colony-powered stale detection:

```bash
spidersan stale
spidersan stale --notify    # shows agent_label from Colony signal
```

Uses `is_stale` flag from `colony_state` view (computed server-side by Supabase). Merges with local date-math results; Colony wins on collision (server staleness is authoritative).

### `spidersan cross-conflicts`

Cross-machine conflict detection:

```bash
spidersan cross-conflicts              # compare against all machines in Supabase
spidersan cross-conflicts --local      # local-only (no Supabase)
spidersan cross-conflicts --tier 2     # only show TIER 2+ conflicts
spidersan cross-conflicts --strict     # exit 1 if TIER 2+ found
spidersan cross-conflicts --json       # machine-readable output
```

Pulls all other machines' branch registries from Supabase, compares file overlap with the local registry, and applies tier escalation:

| Tier | Label | Action |
|------|-------|--------|
| 🔴 TIER 3 | BLOCK | Must resolve before merge — cross-machine conflict |
| 🟠 TIER 2 | PAUSE | Coordinate with remote agent before proceeding |
| 🟡 TIER 1 | WARN | Proceed with caution |


---

## How it works end-to-end

Removed with the emit side — there is no longer a writer for `colony_state` in this repo.

---

## Colony state view

Spidersan queries the `colony_state` VIEW (not raw `colony_signals` table):
- `DISTINCT ON (agent_key_id)` — one row per agent, latest signal wins
- `is_stale` computed server-side based on `stale_after_ms` threshold
- Requires Envoak migration 025 (anon key SELECT granted on `colony_signals` + `colony_state`)

---

## Offline behaviour

| Scenario | Behaviour |
|----------|-----------|
| `COLONY_SUPABASE_URL` not set | `syncFromColony()` returns `{ offline: true }` — local registry used as-is |
| Network unreachable | Silent `catch` → same offline fallback |
| `envoak` not installed | Hook uses `2>/dev/null \|\| true` — exits 0 silently |
| `COLONY_SESSION_ID` not set | Hook skips emission entirely — no-op |
