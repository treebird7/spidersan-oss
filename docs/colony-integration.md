# Spidersan Colony Integration

Spidersan connects to [Envoak Colony](https://envoak.dev) — a signal bus for multi-agent coordination. It reads and writes Colony signals to keep the agent fleet aware of which branches are actively being worked on.

Colony is an **optional dependency** — all signal emission and reception is guarded by environment variable checks and wrapped in silent try/catch blocks. Spidersan operates normally when Colony is not configured.

---

## Setup

### 1. Initialize (auto-installs hook)

```bash
spidersan init
```

`init` now automatically:
- Copies `hooks/post-checkout` → `.git/hooks/post-checkout` in the current repo
- Sets up `~/.git-template/hooks/` so all future `git clone` repos get the hook automatically
- Sets `git config --global init.templateDir ~/.git-template`

### 2. For existing repos (already initialized before this feature)

```bash
spidersan doctor --fix
```

The `Colony Hook` check in `spidersan doctor` detects whether the hook is present and is a Colony hook. `--fix` installs it silently if missing.

### 3. Set environment variables

| Variable | Description |
|---|---|
| `COLONY_SESSION_ID` | Active Colony session identifier. Set by `envoak colony enlist`. |
| `COLONY_AGENT_KEY_ID` | Agent key UUID registered in Envoak Vault. Authenticates signals. |
| `COLONY_SUPABASE_URL` | MycToak Supabase project URL (for reading Colony state). |
| `COLONY_SUPABASE_KEY` | Supabase anon key (public — no JWT needed, migration 025 grants SELECT). |

`COLONY_SESSION_ID` and `COLONY_AGENT_KEY_ID` are needed for **emitting** signals (hook + abandon/merged commands).
`COLONY_SUPABASE_URL` + `COLONY_SUPABASE_KEY` are needed for **reading** Colony state (`pulse`, `stale`, `conflicts`).

---

## Signals emitted

### `work_claim` — branch checkout

**Trigger:** `git checkout <branch>` (branch switch only, not file checkout)

**When:** Automatically via the `post-checkout` git hook.

**Payload:**
```json
{
  "branch": "<branch-name>",
  "files": [],
  "repo": "<repo-directory-name>"
}
```

**Status:** `in-progress`

### `work_release` — branch abandoned or merged

**Trigger:** `spidersan abandon [branch]` or `spidersan merged [branch]`

**When:** After the branch registry is updated.

**Payload:**
```json
{
  "branch": "<branch-name>",
  "repo": "<repo-directory-name>"
}
```

**Status:** `idle`

### Manual release

For scripted cleanup outside the CLI:

```bash
bash hooks/post-checkout-release <branch-name>
```

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

### `spidersan doctor --fix`

```bash
spidersan doctor          # shows Colony Hook status
spidersan doctor --fix    # auto-installs hook if missing
```

---

## How it works end-to-end

1. Agent runs `spidersan init` — hook installed in `.git/hooks/` + `~/.git-template/` configured.
2. Agent starts a Colony session via `envoak colony enlist` — sets `COLONY_SESSION_ID`.
3. Agent checks out a branch — `post-checkout` hook fires, emits `work_claim` to Colony.
4. Other agents run `spidersan pulse` — Colony signals sync into their local registry.
5. `spidersan conflicts` now sees cross-agent file overlap and reports it.
6. When the agent runs `spidersan abandon` or `spidersan merged` — `work_release` signal emitted; other agents' next `pulse` removes the branch from their registries.

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
