# Spidersan — Agent Guide

**Spidersan** is a branch-coordination CLI for multi-agent (AI) coding teams, published to npm as `spidersan`. When multiple AI agents (Claude Code, Cursor, Copilot) work across branches on the same repo, they collide on overlapping files. Spidersan maintains a shared registry of *who is working on what*, detects file-level conflicts before they become merge disasters (tiered WARN/PAUSE/BLOCK), recommends merge order, and monitors remote drift.

This is the open-source component of the broader Spidersan / Treebird ecosystem. MIT licensed. Package version **0.10.0**.

Read this before changing code, and read `CONTEXT.md` (the richest domain map) + `BEST_PRACTICES.md` for the full picture.

---

## Tech Stack

- **TypeScript**, ESM (`"type": "module"`), compiled via `tsc` → `dist/`.
- **npm** (pinned `npm@11.6.1`; `package-lock.json` is canonical — pnpm-lock was deliberately dropped from root). Node `>=18` (CI uses Node 20).
- **CLI framework:** Commander.js. Entry: `dist/bin/spidersan.js` (`bin.spidersan`).
- Key deps: `chalk`, `chokidar` (watch), `execa`, `blessed` (TUI), `socket.io-client` (Hub), `yjs` (CRDT experiments), `tree-sitter` + `ts-morph` (AST), `tweetnacl` (crypto), `minimatch`, `dotenv`.

---

## Build / Test / Lint / Typecheck

```bash
npm run build         # tsc → dist/
npm run dev           # tsc --watch
npm start             # node dist/bin/spidersan.js
npm run test:run      # vitest run         ← single-run; use this in CI/automation
npm test              # vitest             (WATCH mode — not for automation)
npm run test:coverage # vitest run --coverage (v8)
npm run lint          # eslint 'src/**/*.ts'
npm run typecheck     # tsc --noEmit
npm run prepublishOnly # typecheck && lint && build
```

- **Single test file:** `npx vitest run tests/<name>.test.ts` or `npx vitest run -t "<test name>"`.
- **Test framework:** Vitest 4 (`vitest.config.ts`). Runs `tests/**/*.test.ts`, `test/**/*.spec.ts`, `src/**/*.test.ts`. Uses `pool: 'forks'` with `maxForks: 1` (serial — avoids OOM); 10s timeout. ⚠️ `tests/conflict-tier.test.ts` is **explicitly excluded** in the vitest config.
- **ESLint:** `eslint:recommended` + `@typescript-eslint/recommended`. `no-unused-vars` warn (ignores `^_`), `no-explicit-any` warn, `no-console` off.
- **PR flow:** `npm install` → `npm run build` → `npm run lint` → `npm run test:run`.

---

## Architecture

`src/bin/spidersan.ts` builds a Commander `program`, registers each command object, async-loads ecosystem plugin commands (`loadEcosystemCommands()`), then `program.parse()`. Global `--debug/-D` flag + uncaught-exception handlers.

### Source layout (`src/`)

| Dir | What it holds |
|---|---|
| `bin/spidersan.ts` | CLI entry — wires all commands + ecosystem loader. |
| `commands/` | One file per subcommand (~36 files), re-exported via `commands/index.ts`. |
| `lib/` | Core logic (~28 files): conflict tiers, drift, git, graph, hub, config, security, AST, crypto. |
| `lib/ai/` | Local-first LLM client + reasoner (7 files). |
| `storage/` | `StorageAdapter` interface + local/Supabase backends (10 files). |
| `tui/` | `blessed` 4-panel dashboard. |
| `types/` | Shared TS types + ambient declarations. |

### Core abstractions & invariants

**Storage adapter pattern** (`src/storage/adapter.ts`): the `StorageAdapter` interface (`getBranches`, `registerBranch`, `updateBranchStatus`, `isInitialized`, …) is the central abstraction. `factory.ts` auto-selects **LocalStorage** (writes `.spidersan/registry.json`, default) vs **SupabaseStorage** (when `SUPABASE_URL` + `SUPABASE_KEY` are set).
→ **Always go through the adapter; never read `registry.json` directly.**

**Conflict tiers** (`src/lib/conflict-tier.ts`, `classifyTier(file) → 1|2|3`):
- **Tier 1 WARN 🟡** — low risk (`.md`, `.css`, generic).
- **Tier 2 PAUSE 🟠** — structural (`package.json`, `tsconfig.json`, `server.ts`, migrations, types). Gates `git push`.
- **Tier 3 BLOCK 🔴** — security/secrets only (`.env`, `*.pem`, `auth.ts`, `security.ts`). Gates `git merge`/`rebase`.
- **Invariant:** `package.json` is **Tier 2, NOT Tier 3**.

**Remote drift** (`src/lib/remote-drift.ts`): describes files changed in remote-only commits.
- **Invariant:** `safeToPush` is `false` whenever `remoteAhead > 0`, regardless of overlap.
- When detection is impossible (offline / detached / mid-rebase) it returns `DriftSkipped` — **always check `'skipped' in result` first.**
- `getRemoteHead` lives in `src/lib/git.ts`, **not** in `remote-drift.ts`.

**Colony** = Supabase signal bus for cross-machine awareness (advisory; graceful fallback). **Hub** = real-time chat channel (`src/lib/hub.ts`); the only public method is `hub.postToChat({...})` — **`hub.postMessage()` does not exist.**

### Two distinct `.spidersan` things

1. **`.spidersan/registry.json`** — the branch registry directory created by `spidersan init` (git-tracked).
2. **`.spidersan.schema.json`** (repo root) — JSON Schema for the **`.spidersanrc` config file**. Config sections: `readyCheck` (WIP-marker detection — `wipPatterns` default `[TODO,FIXME,WIP,HACK,XXX]`), `conflicts` (regex severity arrays), `storage` (`type: local|supabase`). Loaded by `src/lib/config.ts` with a `__proto__` prototype-pollution guard.

### CLI command surface (~40)

Core: `init`, `register`, `list`, `conflicts`, `merge-order`, `ready-check`, `depends`, `stale`, `cleanup`, `rescue`, `abandon`, `merged`, `sync`, `watch`, `doctor`, `config`, `auto`, `log`, `daily`, `rebase-helper`. AI: `context`, `ask`, `advise`, `explain`, `ai-ping`. Multi-repo/cloud: `registry-sync`, `cross-conflicts`, `github-sync`, `pulse` (`--remote-drift`), `sync-advisor`, `fleet-status`. Remote ops: `bot`, `git-watch`. Scale: `queen` (sub-agent spawning), `torrent` (branch-per-task). TUI: `dashboard`.

---

## Other Top-Level Packages & Dirs

| Path | What it is |
|---|---|
| `mcp-server/` | Separate package `spidersan-mcp` v1.1.0 — exposes spidersan as MCP tools. Own tsconfig/vitest/lockfile. |
| `workers/api-proxy/` | Cloudflare Worker — hosted LLM proxy with cost guardrails (`wrangler.toml`). |
| `workers/keys/` | Cloudflare Worker — key issuance, Turnstile-gated. |
| `migrations/` + `supabase/migrations/` | SQL migrations, range **200–299**, `spidersan` schema. Always `IF NOT EXISTS` / `IF EXISTS`. |
| `hooks/` | Git hooks: `post-checkout`, `post-checkout-release`. |
| `experiments/` | `ast-locking/` + `crdt-sync/` — experimental sub-packages, NOT shipped. |
| `.colony/signals/` | JSON signal files for the Colony cross-machine signal bus. |
| `.agent/skills/SPIDERSAN_WORKFLOW.md` | Agent-facing usage skill. |
| `selfimprove/` | Python self-improvement harness (`improve.py`). |
| `docs/` | `CORE.md`, `USE_CASES.md`, `AGENT_GUIDE.md`, `STATUS_FLAGS.md`, `LIMITATIONS.md`, … |

---

## Security Conventions (NON-NEGOTIABLE)

From `SECURITY.md` / `SECURITY_AUDIT.md` / `CONTEXT.md`:

- **Shell execution:** always `execFileSync(cmd, [args])` / `execFile` — **never** string interpolation or `exec` (shell-injection prevention). This is consistent across core; do not break it.
- **Input validation:** call `validateFilePath` / `validateBranchName` from `src/lib/security.ts` at the sink. `validateFilePath` throws; `sanitizeFilePaths` silently filters (use when partial success is acceptable).
- **Prototype pollution:** `deepMerge` in `config.ts` guards `__proto__` — don't bypass it.
- **Env injection:** pass `env: { ...process.env }` as an object, never inline strings. Prefer `sdkEnv` over mutating `process.env`.
- **Secrets:** API keys in env only; never commit `.env`. Report vulnerabilities via GitHub private vulnerability reporting, not public issues.

---

## Environment Variables (`.env.example`)

`SPIDERSAN_ENV` (production/staging/local), `SUPABASE_URL_PROD`/`SUPABASE_KEY_PROD`, `SUPABASE_URL_STAGING`/`SUPABASE_KEY_STAGING`, legacy `SUPABASE_URL`/`SUPABASE_KEY`, `SPIDERSAN_AGENT` (agent identity), `HUB_URL` (default `https://hub.treebird.uk`). LLM: `SPIDERSAN_LLM` (provider, default `lmstudio`), `SPIDERSAN_LLM_MODEL`, `SPIDERSAN_LLM_URL`. LLM fallback chain: **LM Studio (Gemma) → Ollama → api.spidersan.net → GitHub Copilot**.

> To force local storage in tests, set `SUPABASE_URL=` / `SUPABASE_KEY=` empty.

---

## CI Workflows (`.github/workflows/`)

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | push to `main`/`docs`, PRs to `main` | Node 20: `npm ci`, build, lint (non-blocking), `npm test -- --run`; plus `test-cli` (`--help`/`--version`/`init`). |
| `publish.yml` | manual `workflow_dispatch` | npm Trusted Publisher OIDC, `npm publish --provenance`. |
| `migrations.yml` | push of `migrations/*.sql` to main | Supabase `db push`. |
| `ts-review.yml` | non-main branches | Custom security/review action, posts PR comments. |
| `auto-register.yml` | push | Auto-registers branches in the spidersan registry. |

---

## Conventions

- **`.editorconfig`:** UTF-8, LF, final newline, trim trailing whitespace, **2-space indent** (Makefile uses tabs; markdown exempt from trailing-whitespace trim).
- **Commit style:** Conventional Commits — `feat(scope):`, `fix(scope):`, `chore(scope):`, `test(scope):`, `security(keys):`, `docs:`, `perf:`. PRs referenced as `(#NNN)`. Imperative present tense, first line < 72 chars (CONTRIBUTING.md).
- **Branching:** fork → branch from `main`; one feature = one branch; `agent/feature` naming (prefix becomes the agent name in auto-register). Register with `spidersan register`; run `spidersan ready-check` before merge.
- **Migrations:** range 200–299, `spidersan` schema, idempotent (`IF NOT EXISTS`/`IF EXISTS`).

---

## Key Files

| Path | What it is |
|---|---|
| `src/bin/spidersan.ts` | CLI entry — wires all commands + ecosystem loader. |
| `src/commands/index.ts` | Re-exports all command objects. |
| `src/storage/adapter.ts` | `StorageAdapter` interface + `Branch`/`BranchRegistry` types. |
| `src/storage/factory.ts` | Auto-selects local vs Supabase backend. |
| `src/storage/local.ts` | Reads/writes `.spidersan/registry.json`. |
| `src/lib/conflict-tier.ts` | `classifyTier(file) → 1\|2\|3`. |
| `src/lib/conflict-analyzer.ts` / `conflict-renderer.ts` | Overlap analysis + human/JSON output. |
| `src/lib/remote-drift.ts` | `DriftResult` / `DriftSkipped` / drift zone. |
| `src/lib/git.ts` | `getAheadBehind`, `getRemoteHead`, `getCurrentBranch`. |
| `src/lib/graph.ts` | DAG for merge order / dependencies. |
| `src/lib/security.ts` | `validateFilePath` / `validateBranchName`. |
| `src/lib/config.ts` | `.spidersanrc` loader (deepMerge, `__proto__` guard). |
| `src/lib/ai/llm-client.ts` | LLM provider fallback chain. |
| `.spidersan.schema.json` | JSON Schema for `.spidersanrc`. |
| `mcp-server/src/server.ts` | MCP server (`spidersan-mcp`). |
| `vitest.config.ts` / `.eslintrc.json` / `tsconfig.json` | Test / lint / build config. |
| `CONTEXT.md` | Domain vocabulary + codebase map (read first). |
| `BEST_PRACTICES.md` | Workflow / branching / storage conventions. |
| `docs/AGENT_GUIDE.md`, `docs/CORE.md` | Agent + feature docs. |

---

## Gotchas

1. Never read `.spidersan/registry.json` directly — go through the `StorageAdapter`.
2. `hub.postToChat()` is the only Hub method — `postMessage()` does not exist.
3. `getRemoteHead` is in `git.ts`, not `remote-drift.ts`.
4. `package.json` is Tier 2 (PAUSE), not Tier 3 (BLOCK).
5. Always check `'skipped' in result` before reading drift fields.
6. `tests/conflict-tier.test.ts` is excluded from the vitest run — don't assume it runs.
7. Use `npm run test:run` (not `npm test`) for non-interactive runs — `npm test` is watch mode.
