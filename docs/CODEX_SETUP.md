# Spidersan for OpenAI Codex CLI — Install Guide

> Goal: a Codex session gets the same branch-coordination guarantees a Claude Code
> session gets — registration, conflict detection, merge ordering — even though
> Codex's hook system can't run our Claude-Code hooks.
>
> Claude Code setup lives elsewhere: `.claude/skills/install-hooks/SKILL.md` (skill)
> and `~/treebird-shared/hooks/INSTALL-m2-i7.md`. **Do not copy those hook scripts
> into Codex** — they parse Claude-Code's PreToolUse/PostToolUse JSON stdin, which
> Codex does not emit.

## Why Codex needs a different shape

Codex CLI hooks (`~/.codex/hooks.json` or `[hooks]` in `config.toml`) only fire
reliably on the `shell` tool. **`apply_patch` — how Codex edits files — bypasses
them**, so a Claude-style "auto-register on every file edit" hook is impossible.
Instead we stack four layers, each catching what the one above misses:

| Layer | Mechanism | Catches |
|-------|-----------|---------|
| 1. Fresh CLI | `spidersan` binary on PATH | everything below depends on it |
| 2. MCP server | `spidersan-mcp` in `config.toml` | model-initiated coordination (register, conflicts, ready-check as tools) |
| 3. AGENTS.md | workflow instructions | behavioral: register early, check before work |
| 4. git hooks | native `pre-push` | the floor — fires no matter which agent (or human) pushes |

## 1. CLI binary (fresh — this matters)

A stale binary re-introduces fixed bugs (e.g. squash-merge phantom conflicts,
fixed in spidersan-oss #267). Same rule as the Claude install:

```bash
# published package:
npm i -g spidersan@latest
# or, on flock machines with the checkout, link it:
cd ~/Dev/spidersan && git pull --rebase && npm install && npm run build && npm link
spidersan --version
```

## 2. MCP server

The repo ships an MCP server at `mcp-server/` (stdio). Build once:

```bash
cd ~/Dev/spidersan/mcp-server && npm install && npm run build
```

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.spidersan]
command = "node"
args = ["/Users/<you>/Dev/spidersan/mcp-server/dist/server.js"]
```

This gives the Codex model the coordination tools directly: `register_branch`,
`check_conflicts`, `ready_check`, `get_merge_order`, `list_branches`, `who_owns`,
`lock_files` / `unlock_files`, and friends. Verify inside a Codex session by asking
it to list its spidersan tools.

## 3. AGENTS.md — the behavioral layer

Codex reads `AGENTS.md` (repo root and `~/.codex/AGENTS.md`) the way Claude reads
`CLAUDE.md`. Add this block to any repo where Codex works alongside other agents
(or to `~/.codex/AGENTS.md` globally):

```markdown
## Branch coordination (spidersan) — REQUIRED

Multiple AI agents work in this repo. Before modifying any files:

1. `spidersan conflicts` — 🔴 BLOCK: stop and coordinate. 🟠 PAUSE: contact the
   other agent first. 🟡 WARN: proceed with caution.
2. `spidersan register --files "<files you'll touch>" --agent codex \
   --description "<what you're doing>"` — re-run when your file set grows.
3. Never work directly on main; branch as `codex/<topic>`.

Before creating a PR: `spidersan ready-check` and `spidersan merge-order`.
After your PR merges: `spidersan merged --pr <num>`.
```

The `--agent codex` id keeps Codex's registrations distinguishable in
`spidersan list` and in the shared Supabase registry.

## 4. git-native hooks — the bypass-proof floor

Unlike agent-CLI hooks, git hooks fire for every push from any tool. In each
coordinated repo:

```bash
cat > .git/hooks/pre-push <<'EOF'
#!/bin/sh
# spidersan conflict gate — advisory-strict: blocks on TIER 3 (security-critical)
# conflicts, warns on the rest. Fail-open if spidersan is missing.
command -v spidersan >/dev/null 2>&1 || exit 0
spidersan conflicts --tier 3 --strict || {
  echo "🔴 spidersan: TIER 3 conflict — coordinate before pushing (or --no-verify to override)" >&2
  exit 1
}
spidersan conflicts --tier 2 >&2 || true
exit 0
EOF
chmod +x .git/hooks/pre-push
```

Optional Codex shell-hook (advisory only — remember `apply_patch` bypasses it, so
treat it as a bonus, not coverage): a `PreToolUse` hook on `shell` matching
`git push` that runs the same `spidersan conflicts --tier 2` and returns its
output as context. If you build one, follow `/hooks-create` for the Codex JSON
protocol; don't reuse the Claude scripts.

## 5. Supabase announce (optional, flock machines)

`spidersan registry-sync` pushes registrations to the shared `spider_registries`
table so other machines see them. It needs treebird-runtime env in the shell
Codex runs from:

```bash
echo "${SUPABASE_URL:?unset}" && echo ok   # source via vault/agent .env if unset
```

Without it, everything above still works — coordination is just local to the
machine.

## 6. Verify

```bash
# in a spidersan-initialized repo (spidersan init if not):
git checkout -b codex/smoke-test
spidersan register --files "README.md" --agent codex --description "smoke"
spidersan list             # branch appears, agent=codex
spidersan conflicts        # runs clean or reports real overlaps
git push --dry-run         # pre-push hook fires (needs a remote)
git checkout - && git branch -D codex/smoke-test && spidersan sync
```

Then in a Codex session: ask it to "check spidersan conflicts" — it should reach
for the MCP tool or the CLI, not shrug.

## Known gaps vs the Claude Code install

- **No auto-registration on file edit** (`apply_patch` bypasses hooks) — layer 3's
  instructions carry that weight; expect to occasionally remind Codex.
- **No trunk-poison auto-heal / checkout auto-register** — those live in the Claude
  PostToolUse hook. The git `pre-push` gate and `spidersan sync` cover the fallout.
- **No dangerous-`rm` block** — Codex sandboxing is its own layer; configure its
  approval mode accordingly.
