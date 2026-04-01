# spidersan bot — Self-Improve Assignment

**Repo:** `~/Dev/spidersan` (branch: `feat/bot`)
**Target:** `src/commands/bot.ts` — new subcommand
**Tests:** `selfimprove/test_bot.py`
**Participants:** nemosan-m5 (opencode/nemotron-3-super) + llama-i7

---

## Goal

Add `spidersan bot` subcommand — a message-driven git operations daemon that:
1. Polls smalltoak for `/commands` addressed to spidersan
2. Executes git actions on configured repos
3. Posts results back via smalltoak
4. Runs periodic auto-sync
5. Requires envoak vault injection to start (no raw tokens)

This replaces the Python `git_bot.py` prototype with a proper TypeScript implementation inside the spidersan CLI.

## Architecture

```
spidersan bot
  |
  +-- startup: verify GIT_BOT_ENABLED env var (vault-gated)
  +-- config: load repos from ~/.spidersan/bot.json
  +-- loop:
       +-- every 15s: poll smalltoak for /commands
       +-- every 90s: auto-sync all configured repos
       +-- on command: verify sender tier → execute → reply
```

## Invocation

```bash
# Start (requires vault injection)
envoak vault inject --key $(cat ~/.envoak/agent-ssan.key) -- spidersan bot

# One-shot (testing)
envoak vault inject --key ... -- spidersan bot --once

# Manage repos
spidersan bot add <name> --path <path> --branch <branch> --push <file1,file2,...>
spidersan bot remove <name>
spidersan bot repos
```

## Vault Gate

The bot requires `GIT_BOT_ENABLED=true` in its environment. This comes from an envoak vault secret:

```bash
# Setup (one-time, by birdsan)
envoak vault add spidersan-bot GIT_BOT_ENABLED
# Enter: true

# Grant to spidersan's key
envoak vault keys grant <ssan-key-uuid> spidersan-bot/GIT_BOT_ENABLED
```

On startup, the bot checks:
```typescript
if (process.env.GIT_BOT_ENABLED !== 'true') {
  console.error('Error: GIT_BOT_ENABLED not set. Run via envoak vault inject.');
  process.exit(1);
}
```

No vault grant = no bot. Workers and unauthorized agents can't start it.

## Smalltoak Transport

The bot talks to smalltoak via HTTP. Env vars (injected by vault or set manually):

| Var | Purpose |
|-----|---------|
| `SMALLTOAK_SERVER_URL` | HTTP server URL (e.g. `http://192.168.1.157:7474`) |
| `SMALLTOAK_TOKEN` | Bearer auth token |
| `GIT_BOT_ENABLED` | Gate — must be `true` to start |

Uses Node `fetch()` (built-in since Node 18) — no external HTTP deps.

## Commands

| Command | Tier Required | Action |
|---------|:------------:|--------|
| `/sync <repo>` | specialist+ | pull + auto-push configured files |
| `/pull <repo> [branch]` | specialist+ | git pull --ff-only |
| `/push <repo>` | specialist+ | add configured files + commit + push |
| `/status <repo>` | worker+ | branch, ahead/behind, dirty files |
| `/conflicts <repo>` | specialist+ | run `spidersan conflicts` |
| `/log <repo> [N]` | worker+ | git log --oneline (max 50) |

## Tier-Based Access Control

```typescript
const TIERS: Record<string, { agents: string[], commands: string[] }> = {
  coordinator: {
    agents: ['birdsan', 'bsan', 'treebird', 'trbr'],
    commands: ['sync', 'pull', 'push', 'status', 'conflicts', 'log'],
  },
  specialist: {
    agents: ['spidersan', 'ssan', 'sherlock', 'srlk', 'watsan', 'wsan',
             'treesan', 'tsan', 'mycsan', 'mycs'],
    commands: ['sync', 'pull', 'push', 'status', 'conflicts', 'log'],
  },
  worker: {
    agents: ['nemosan', 'nemo', 'codex', 'codx', 'goose', 'goos'],
    commands: ['status', 'log'],
  },
};
```

## Repo Config

Stored in `~/.spidersan/bot.json`:

```json
{
  "repos": {
    "selfimprove": {
      "path": "/Users/freedbird/Dev/selfimprove",
      "branch": "main",
      "autoPush": ["machines/macbook-pro/", "smalltoak/messages.jsonl", "prompt.md"]
    },
    "Toak": {
      "path": "/Users/freedbird/Dev/Toak",
      "branch": "selfimprove/toak-chat",
      "autoPush": ["selfimprove/toak-chat.ts"]
    }
  },
  "pollInterval": 15,
  "syncInterval": 90,
  "rateLimit": 10
}
```

`spidersan bot add/remove/repos` manages this file.

## Files to Create

| File | Purpose |
|------|---------|
| `src/commands/bot.ts` | Main subcommand — the loop, command dispatch, transport |
| `src/lib/bot-config.ts` | Load/save `~/.spidersan/bot.json` |
| `selfimprove/test_bot.py` | Test suite (Python — same pattern as git_bot tests) |
| `selfimprove/improve.py` | Self-improve loop for bot.ts |
| `selfimprove/BOT_ASSIGNMENT.md` | This file |

## Test Tiers

### Tier 1: CLI structure
- `spidersan bot --help` shows usage
- `spidersan bot repos` runs without error
- `spidersan bot add` validates required args
- `spidersan bot remove` validates repo name

### Tier 2: Vault gate
- Exits with error when GIT_BOT_ENABLED not set
- Starts when GIT_BOT_ENABLED=true

### Tier 3: Command parsing
- Parses `/sync selfimprove` correctly
- Parses `/pull Toak selfimprove/toak-chat` correctly
- Rejects unknown commands
- Rejects unknown repos
- Rejects shell metacharacters in branch args

### Tier 4: Access control
- Workers can only /status and /log
- Specialists can use all commands
- Unknown senders denied

### Tier 5: Git execution
- Uses execFileSync/spawn with array args (no shell)
- Pull uses --ff-only
- Push only adds configured files
- Rate limiter blocks rapid commands

### Tier 6: Transport
- Polls smalltoak HTTP with Bearer auth
- Posts replies with reply_to
- Tracks high-water mark in ~/.spidersan/bot_hwm

## Security

- **Vault gate:** Won't start without envoak injection
- **Tier access:** Workers read-only, unknown denied
- **No shell:** All git via `execFileSync('git', [...])` with array args
- **Repo whitelist:** Only configured repos in bot.json
- **Branch validation:** Regex `^[\w/.-]+$`, reject `..`
- **Rate limit:** 10s cooldown per repo
- **Reply truncation:** 500 char max on git output

## How to Run the Self-Improve Loop

```bash
cd ~/Dev/spidersan
git checkout -b feat/bot

# Write skeleton bot.ts that passes tier 1-2 tests
# Then run loop:
LLAMA_URL=http://localhost:11434 python3 selfimprove/improve.py 10
```

## Rules

1. **ONE fix per iteration.** Don't rewrite the whole file.
2. **Keep all existing tests passing.** Regressions get reverted.
3. **No new npm dependencies.** Use Node built-ins (fetch, fs, child_process, path).
4. **No shell execution.** `execFileSync('git', [...])` only.
5. **Don't modify existing spidersan commands.**
6. **Register the command in `src/bin/spidersan.ts`** — add `botCommand` import + `.addCommand(botCommand)`.

## Git Protocol

```bash
git checkout feat/bot
git add src/commands/bot.ts src/lib/bot-config.ts
git commit -m "feat(bot): iter N — <what you fixed>"
git push origin feat/bot
```

---

*Created by Sherlock, 2026-04-01*
