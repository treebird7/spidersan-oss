# Security Audit Report — Spidersan OSS

**Date:** 2026-04-06  
**Scope:** Full source tree (`src/`, `mcp-server/`, `scripts/`, `.github/workflows/`, config files)  
**Methodology:** Manual static analysis of all source files

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0     |
| High     | 0     |
| Medium   | 5     |
| Low      | 7     |

The codebase demonstrates generally **strong security practices**: `execFileSync` is used consistently instead of `exec` (preventing shell injection), input validation exists for agent IDs/branch names/file paths, prototype pollution guards are in place, and TUI injection is mitigated. No critical or high severity vulnerabilities were found.

---

## Medium Severity

### 1. SSRF via User-Controlled `HUB_URL` / `SUPABASE_URL`

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

### 2. ReDoS via Config-Supplied Regex Patterns

**Files:**
- `src/lib/config.ts:266-280` (`getWipPatterns`, `getHighSeverityPatterns`, `getMediumSeverityPatterns`)
- `src/commands/conflicts.ts:403-404`
- `src/commands/pulse.ts:85-86`

**Issue:** User-supplied strings from `.spidersanrc` are compiled directly into `new RegExp()` without safe-regex validation. A malicious pattern like `(a+)+$` causes catastrophic backtracking, freezing the process. In shared-repo scenarios, a malicious `.spidersanrc` committed to the repo affects all users.

**Recommendation:** Wrap `new RegExp()` in try/catch, add a timeout for regex execution, or validate patterns with a safe-regex library.

---

### 3. PostgREST Query Parameter Injection in Supabase Storage

**File:** `src/storage/supabase.ts:231,346`

**Issue:** In the `cleanup` and `pushRegistry` methods, branch names are `encodeURIComponent`-encoded but Supabase PostgREST uses commas as delimiters in `in.(...)` operators. An encoded comma (`%2C`) or closing parenthesis (`%29`) could break out of the filter at the PostgREST layer, modifying query scope.

**Recommendation:** Strip or reject branch names containing `,`, `(`, `)` before building PostgREST filter strings (as `findByFiles` already does for its inputs).

---

### 4. Prototype Pollution Guard Uses `for...in` Without `hasOwnProperty`

**File:** `src/lib/config.ts:245-264`

**Issue:** The `deepMerge` function guards against `__proto__`, `constructor`, and `prototype` keys, but iterates with `for...in` without checking `Object.hasOwn(source, key)`. If a prototype upstream has been polluted, inherited enumerable properties could leak into the result.

**Recommendation:** Use `Object.keys(source)` or add `Object.hasOwn(source, key)` guard.

---

### 5. Unsanitized Colony Payload Used in Storage Operations

**File:** `src/lib/colony-subscriber.ts:155-169`

**Issue:** Payloads from the Supabase `colony_signals` table are parsed with `JSON.parse` and used directly in branch registration (`payload.branch`, `payload.files`) without schema validation. A malicious colony signal could inject arbitrary branch names or file paths into local state.

**Recommendation:** Validate colony payloads against the same validators used for local input (`validateBranchName`, `validateFilePath`).

---

## Low Severity

### 6. Regex Injection in `upsertEnvVar`

**File:** `src/commands/config.ts:112`

**Issue:** The `key` parameter is interpolated into `new RegExp()` without escaping. Currently safe (keys are hardcoded), but fragile if the function is ever called with user input.

---

### 7. Fragile Path Construction in `stale.ts`

**File:** `src/commands/stale.ts:30-34`

**Issue:** Uses `../${agentId}/` in path construction. The agent ID validation regex is currently restrictive enough, but the pattern of navigating outside the project via `../` + user input is inherently risky.

---

### 8. Known Public Keys File Missing Restrictive Permissions

**File:** `src/lib/crypto.ts:132`

**Issue:** `known_keys.json` is written without restrictive file permissions (unlike private keys which use `0o600`). An attacker with write access to `~/.spidersan/keys/` could substitute public keys to MITM agent-to-agent encrypted messaging.

---

### 9. No Distinction Between Anon and Service-Role Supabase Keys

**Files:** `src/storage/supabase.ts:53-65`, `src/lib/activity.ts:196-211`

**Issue:** The code does not validate whether `SUPABASE_KEY` is an anon key or service_role key. A service_role key bypasses all Row Level Security policies. The key is also stored in plain text in `.spidersanrc`.

---

### 10. Race Condition in Local Storage (TOCTOU)

**File:** `src/storage/local.ts:40-51`

**Issue:** Load-modify-save pattern with no file locking. Concurrent processes can silently lose writes (last writer wins).

---

### 11. Insecure `validateWatchDirectory` Bypass via Symlinks-to-Subdirs

**File:** `mcp-server/src/server.ts:25-44`

**Issue:** The sensitive directory check blocks `/etc`, `/var`, etc., but a `/home/user/link -> /etc` symlink is resolved by `realpathSync` and correctly blocked. However, the allow/deny list doesn't cover all sensitive paths (e.g., `~/.ssh`, `~/.gnupg`, `~/.aws`).

---

### 12. `doctor.ts` Uses `sh -c` for Shell Command

**File:** `src/commands/doctor.ts:483`

**Issue:** Uses `execFileSync('sh', ['-c', 'ulimit -n'])`. The command is hardcoded so not exploitable, but sets a pattern that could be dangerous if copied with user input.

---

## Positive Security Findings

- **No shell injection:** `execFileSync` with argument arrays used consistently throughout.
- **Input validation:** `src/lib/security.ts` provides robust validation for agent IDs, branch names, task IDs, and file paths, used consistently across commands.
- **Prototype pollution awareness:** `deepMerge`, `setNestedValue`, and `getNestedValue` all block `__proto__`, `constructor`, `prototype`.
- **TUI injection prevention:** `escapeBlessed()` sanitizes data before rendering in blessed TUI.
- **Shell escaping:** `queen.ts` uses `escapeShellString()` for generated bash scripts.
- **Path traversal protection:** `validateRepoPath()` and `validateFilePath()` block `..` traversal.
- **Zod validation in MCP server:** All MCP tool inputs are validated with Zod schemas.
- **Good crypto:** TweetNaCl with X25519 + XSalsa20-Poly1305; private keys saved with `mode: 0o600`.
