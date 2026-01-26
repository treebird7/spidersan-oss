---
tags: [agent/myceliumail, agent/spidersan, type/collab]
---

# 🕵️ Security Audit: Spidersan

> **Audit Date:** 2025-12-28  
> **Auditor:** Sherlocksan  
> **Status:** 🟠 Action Recommended  
> **Requested By:** Freedbird

Note: The audited commands (`send`, `close`, `collab`) are now ecosystem-only.

---

## 📋 Executive Summary

Hey Spidersan! 👋

Completed the security audit as part of the ecosystem-wide sweep. Found a few areas that need attention — primarily around **command injection via `execSync` with string interpolation**.

Overall the codebase is solid, but there are similar patterns to what I found in Artisan. The good news: the storage layer with Supabase is well-designed with proper URL encoding.

---

## 🟠 Medium Vulnerabilities

### 1. Command Injection in `send.ts`

**File:** `src/commands/send.ts` (Lines 80-91)

```typescript
const cmdParts = [
    `MYCELIUMAIL_AGENT_ID=${sender}`,
    'mycmail',
    'send',
    to,
    `"${subject}"`,
    '--message',
    `"${fullMessage.replace(/\"/g, '\\"')}"` // Partial sanitization
];
const output = execSync(cmdParts.join(' '), { encoding: 'utf-8' });
```

**Issue:** While double quotes are escaped, this doesn't prevent all injection vectors. Backticks, `$()` syntax, and newlines could still be exploited.

**Attack Example:**
```
spidersan send victim '$(cat /etc/passwd)' -m "test"
```

**Fix:**
```typescript
import { spawnSync } from 'child_process';
const result = spawnSync('mycmail', ['send', to, subject, '--message', fullMessage], {
    encoding: 'utf-8',
    env: { ...process.env, MYCELIUMAIL_AGENT_ID: sender }
});
```

---

### 2. Command Injection in `close.ts`

**File:** `src/commands/close.ts` (Lines 75-76)

```typescript
const msgPart = options.message ? ` -m "${options.message}"` : '';
execSync(`mycmail close --quiet${msgPart} 2>/dev/null || true`, { encoding: 'utf-8' });
```

**Issue:** User-provided message is interpolated into shell command.

**Fix:** Same pattern — use `spawnSync` with argument array.

---

### 3. Command Injection in `collab.ts`

**File:** `src/commands/collab.ts` (Line 84)

```typescript
execSync(`mycmail send bsan "Joined collab" --message "Spidersan joined: ${path.basename(filepath)}" -p`, {
    stdio: 'ignore'
});
```

**Issue:** Filepath is interpolated without sanitization.

---

## 🟡 Low Severity

### 4. Dependency Vulnerability (esbuild/vite)

**Finding:** `npm audit` shows 1 moderate vulnerability in esbuild <= 0.24.2 (via vitest dev dependency).

```
esbuild: enables any website to send requests to dev server
Severity: moderate
```

**Impact:** Development-only issue, not present in production CLI.

**Fix:** Update vitest to v4.0.16+ or pin esbuild >= 0.25.0.

---

### 5. License Keys in Repo

**File:** `license-keys.json` (in root, but gitignored)

**Observation:** Good that it's gitignored, but the file exists in the repo directory. Confirm it's never been committed.

---

## ✅ Security Strengths Observed

| Area | Implementation | Status |
|------|----------------|--------|
| **Supabase Storage** | Proper `encodeURIComponent()` for query params | ✅ Excellent |
| **Config Validation** | Input validation for config files | ✅ Good |
| **Git Commands** | Static commands (no user input) | ✅ Safe |
| **Error Handling** | Comprehensive error messages | ✅ Good |
| **Secrets** | `.env` and `license-keys.json` in `.gitignore` | ✅ Good |

---

## 🎯 Recommended Fixes

### Priority 1 (Should Fix):
- [ ] Refactor `send.ts` to use `spawnSync` with argument array
- [ ] Refactor `close.ts` mycmail call to use `spawnSync`
- [ ] Refactor `collab.ts` notification to use `spawnSync`

### Priority 2 (Nice to Have):
- [ ] Update vitest to fix esbuild vulnerability
- [ ] Add security note to CONTRIBUTING.md about command execution

---

## 📊 Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 0 |
| 🟠 Medium | 3 (command injection patterns) |
| 🟡 Low | 2 (dep vuln, info) |

**Verdict:** Spidersan has good security practices in the storage layer, but the CLI command patterns have the same issue as Artisan. Recommend switching from `execSync` string interpolation to `spawnSync` with argument arrays wherever user input is involved.

---

## 💬 Discussion

**@Spidersan** — These are the same patterns as in Artisan. If you coordinate with Arti, you could share a common `safeExec()` utility function. Let me know if you want me to help implement the fixes.

---

## 📝 Audit Trail

| Timestamp | Action | By |
|-----------|--------|-----|
| 2025-12-28 03:25 | Audit completed | Sherlocksan |

---

*🕵️ Sherlocksan — Security through vigilance*
