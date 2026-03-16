# CI/CD Workflow Coverage Analysis

**Date:** 2026-03-16
**Workflows:** 4 files in `.github/workflows/`

## Current Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | push to main/docs, PRs to main | Build, lint, test, CLI smoke test |
| `publish.yml` | release published, manual dispatch | npm publish with OIDC provenance |
| `auto-register.yml` | push to non-main branches | Auto-register branches with Spidersan |
| `migrations.yml` | push to main (migrations/*.sql), manual | Apply Supabase migrations |

---

## Workflow-by-Workflow Analysis

### 1. `ci.yml` — Gaps Found

**What it does:**
- Job `build`: checkout → install → build → lint (soft fail) → tests
- Job `test-cli`: checkout → install → build → `--help` / `--version` / `init`

**Issues:**

| # | Issue | Severity | Detail |
|---|-------|----------|--------|
| 1 | **Lint failures are silently swallowed** | High | `npm run lint \|\| true` + `continue-on-error: true` — lint never blocks CI. This is double-suppressed (both shell `\|\| true` and `continue-on-error`). Lint errors accumulate unnoticed. |
| 2 | **No coverage reporting** | Medium | Tests run but coverage is never collected or uploaded. No visibility into coverage trends. |
| 3 | **No Node.js matrix** | Medium | Only tests on Node 20. Package supports `"engines"` unspecified — users on Node 18 or 22 could hit issues. |
| 4 | **CLI smoke tests are minimal** | Medium | Only tests `--help`, `--version`, `init`. Missing: `register`, `conflicts`, `list`, `merge-order` — the core workflow commands. |
| 5 | **No caching of build artifacts** | Low | `test-cli` job re-installs and re-builds from scratch instead of using artifacts from `build` job. |
| 6 | **No security audit step** | Medium | `npm audit` never runs. Vulnerable dependencies can ship undetected. |
| 7 | **Missing git config for tests** | High | 4 tests fail in CI because `git commit` requires `user.name`/`user.email`. These are the git-messages and git-injection tests — security tests silently failing in CI. |

---

### 2. `publish.yml` — Gaps Found

**What it does:**
- Builds, verifies (`--version`, `--help`), sets version on manual dispatch, publishes with provenance.

**Issues:**

| # | Issue | Severity | Detail |
|---|-------|----------|--------|
| 1 | **No tests before publish** | Critical | Build is verified but `npm test` never runs. A broken release can ship. |
| 2 | **`continue-on-error: true` on `npm version`** | High | If version setting fails (e.g. invalid semver), publish proceeds with the old version. Could overwrite an existing release or publish wrong version. |
| 3 | **No dry-run validation** | Medium | No `npm publish --dry-run` step to verify package contents before actual publish. |
| 4 | **No changelog/release notes automation** | Low | Summary is generated but no changelog diff or release body is attached. |
| 5 | **Missing `NODE_AUTH_TOKEN`** | Unclear | Uses OIDC (`id-token: write`) for trusted publisher, but the `npm publish` step doesn't reference any auth env var. If OIDC isn't configured on npm, this silently fails. |

---

### 3. `auto-register.yml` — Gaps Found

**What it does:**
- On push to feature branches: detects changed files, registers with Spidersan, checks conflicts.

**Issues:**

| # | Issue | Severity | Detail |
|---|-------|----------|--------|
| 1 | **Command injection via branch name** | Critical | `${{ steps.commit.outputs.agent }}` and `${{ steps.commit.outputs.files }}` are interpolated directly into shell commands (lines 81-84). A branch named `; rm -rf /` or containing `$(malicious)` would execute arbitrary commands. Must use environment variables instead of direct interpolation. |
| 2 | **`spidersan init` runs 3 times** | Low | Lines 37, 71, and 78 all run `spidersan init`. Redundant — once is enough. |
| 3 | **Installs from npm, not from source** | Medium | `npm install -g spidersan` installs the published version, not the version in the current commit. Auto-registration uses a potentially outdated spidersan. |
| 4 | **No error handling on git diff** | Medium | Line 57: `git diff --name-only origin/main...${{ github.sha }} 2>/dev/null` — if main doesn't exist or diverged significantly, silently returns empty. Branch goes unregistered. |
| 5 | **Conflict check always succeeds** | Low | `spidersan conflicts ... \|\| true` (line 92) — conflicts never fail the workflow. This is intentional (informational only) but means TIER 3 BLOCKs don't actually block. |
| 6 | **Missing `jq` dependency check** | Low | Line 99 uses `jq` to parse JSON — it's available on `ubuntu-latest` but not guaranteed on all runners. |

---

### 4. `migrations.yml` — Gaps Found

**What it does:**
- Links to Supabase project, pushes migrations.

**Issues:**

| # | Issue | Severity | Detail |
|---|-------|----------|--------|
| 1 | **No migration validation/dry-run** | High | Migrations are pushed directly. No `supabase db diff` or dry-run to preview changes before applying. |
| 2 | **Project ref extraction is fragile** | Medium | Line 33: `sed 's\|https://\|\|' \| sed 's\|.supabase.co\|\|'` — breaks if URL format changes or has a path suffix. Should use a dedicated secret for project ref. |
| 3 | **No rollback plan** | Medium | If migration fails partway, there's no documented or automated rollback. |
| 4 | **No migration test step** | Medium | Could run migrations against a local Supabase instance first (`supabase start` → `supabase db push` → verify). |
| 5 | **Secrets logged in error output** | Low | If `supabase link` fails, the extracted project ref (derived from secret URL) could appear in logs. |

---

## What's Missing Entirely

### Workflows that should exist but don't:

| Workflow | Purpose | Priority |
|----------|---------|----------|
| **Dependency audit** | `npm audit` on PRs + scheduled weekly | High |
| **Coverage reporting** | Upload to Codecov/Coveralls, enforce thresholds | High |
| **Release gating** | Run full test suite before publish (block publish on failure) | Critical |
| **Branch protection checks** | Required status checks (build + test must pass) | High |
| **MCP server tests** | The `mcp-server/` has its own test suite but CI doesn't run it | Medium |
| **Stale branch cleanup** | Scheduled `spidersan stale` + `cleanup` on the repo itself | Low |
| **Build size tracking** | Track `dist/` size to catch accidental bloat | Low |

---

## Prioritized Recommendations

### P0 — Fix Now (Security/Correctness)

1. **Fix command injection in `auto-register.yml`** — Replace direct `${{ }}` interpolation in shell commands with env vars:
   ```yaml
   - name: Register with Spidersan
     env:
       AGENT: ${{ steps.commit.outputs.agent }}
       FILES: ${{ steps.commit.outputs.files }}
     run: |
       spidersan register --agent "$AGENT" --files "$FILES" --description "Auto-registered"
   ```

2. **Add tests to publish workflow** — Insert `npm test -- --run` before `npm publish`. Never publish without tests passing.

3. **Fix git config in CI for test reliability** — Add before `Run Tests`:
   ```yaml
   - name: Configure git for tests
     run: |
       git config --global user.email "ci@test.com"
       git config --global user.name "CI"
   ```

### P1 — Add Soon

4. **Make lint failures block CI** — Remove `|| true` and `continue-on-error`. If lint is too noisy now, fix the violations first, then enforce.

5. **Add coverage reporting** — Add step: `npx vitest run --coverage` and upload results. Consider Codecov GitHub Action.

6. **Add `npm audit` step** to CI:
   ```yaml
   - name: Security audit
     run: npm audit --audit-level=high
   ```

7. **Add Node.js version matrix** — Test on 18, 20, 22.

8. **Remove `continue-on-error` from `npm version`** in publish workflow — fail fast on bad version input.

### P2 — Improve

9. **Cache build artifacts** between CI jobs using `actions/upload-artifact` / `actions/download-artifact`.

10. **Add migration dry-run** before applying — use a throwaway Supabase instance or `supabase db diff`.

11. **Run MCP server tests in CI** — Add a job that runs `cd mcp-server && npm test`.

12. **Expand CLI smoke tests** — Test `register`, `conflicts`, `list`, `stale` commands with a pre-seeded registry.

13. **Add `npm publish --dry-run`** step before actual publish to verify package contents.

### P3 — Nice to Have

14. **Deduplicate `spidersan init`** calls in auto-register (3→1).
15. **Use dedicated `SUPABASE_PROJECT_REF` secret** instead of parsing the URL.
16. **Add scheduled dependency update workflow** (Dependabot or Renovate).
17. **Add build size tracking** with `size-limit` or similar.
