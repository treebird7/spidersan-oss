#!/usr/bin/env node
/**
 * ts-review scanner — implements the /ts-review skill checks as a CI script.
 * Reads file paths from args or stdin, runs 6 security checks per file,
 * outputs a JSON findings report to stdout.
 *
 * Usage:
 *   node scan.mjs src/foo.ts src/bar.ts
 *   git diff --name-only HEAD~1 | grep '\.ts$' | node scan.mjs
 */

import { readFileSync } from 'fs';
import { basename } from 'path';

// ------------------------------------------------------------------
// Check rules — each rule produces at most one finding per match site
// ------------------------------------------------------------------

const RULES = [
  // ── spawn_hygiene ────────────────────────────────────────────────
  {
    check: 'spawn_hygiene',
    sev: 'error',
    pattern: /\bexecSync\s*\(/g,
    message:
      'execSync() spawns a shell — replace with execFileSync(binary, [arg, ...]) to avoid shell injection',
  },
  {
    check: 'spawn_hygiene',
    sev: 'warning',
    pattern: /\bexecFileSync\s*\(\s*['"]node['"]/g,
    message:
      "execFileSync('node', ...) — hardcoded 'node' resolves via PATH; use process.execPath instead",
  },
  {
    check: 'spawn_hygiene',
    sev: 'error',
    // exec() called with a template literal containing a ${ substitution
    pattern: /\bexec\s*\(`[^`]*\$\{/g,
    message:
      'exec() with template literal interpolation — user-derived content reaches shell; use execFile() with arg array',
  },
  {
    check: 'spawn_hygiene',
    sev: 'warning',
    pattern: /shell\s*:\s*true/g,
    message:
      'shell: true — verify no user-derived content reaches the command string or args',
  },

  // ── input_validation ─────────────────────────────────────────────
  {
    check: 'input_validation',
    sev: 'warning',
    // new RegExp( followed by a variable/identifier (not a string literal)
    pattern: /new\s+RegExp\s*\(\s*(?!['"`])[a-zA-Z_$]/g,
    message:
      'new RegExp(variable) — verify the input is escaped (escapeStringRegexp) before reaching the RegExp constructor',
  },

  {
    check: 'spawn_hygiene',
    sev: 'warning',
    pattern: /\bspawnSync\s*\(/g,
    message:
      'spawnSync() — verify result.error and result.status are checked; failures are silent if not',
  },

  // ── env_isolation ────────────────────────────────────────────────
  {
    check: 'env_isolation',
    sev: 'warning',
    pattern: /\.\.\.\s*process\.env\b/g,
    message:
      '...process.env spread — may leak ENVOAK_*, SUPABASE_*, ANTHROPIC_* and other secrets to a child process or logger; verify only safe keys are forwarded',
  },
  {
    check: 'env_isolation',
    sev: 'error',
    // env: process.env passed directly as spawn option — not spread, the whole object
    pattern: /\benv\s*:\s*process\.env\b/g,
    message:
      'env: process.env passed directly to subprocess — leaks all env vars including secrets; build an explicit allowlist instead',
  },

  // ── path_safety ──────────────────────────────────────────────────
  {
    check: 'path_safety',
    sev: 'warning',
    // startsWith('..') or startsWith("..") as a traversal guard — too weak
    pattern: /\.startsWith\s*\(\s*['"]\.\./g,
    message:
      "startsWith('..') as traversal guard — misses embedded a/../../b patterns; use path.resolve + startsWith(root + path.sep) containment check instead",
  },
  {
    check: 'path_safety',
    sev: 'info',
    pattern: /path\.normalize\s*\(/g,
    message:
      'path.normalize normalizes .. but does not guarantee root containment — combine with startsWith(resolvedRoot + path.sep) check',
  },
  {
    check: 'path_safety',
    sev: 'warning',
    // fs write calls targeting sensitive paths by name
    pattern: /(?:writeFile|appendFile|createWriteStream)(?:Sync)?\s*\([^)]*(?:\.git[\\/]hooks|authorized_keys|id_rsa|id_ed25519|\.env)\b/g,
    message:
      'Write to sensitive path — verify user input cannot influence this path',
  },

  // ── permissions_hygiene ──────────────────────────────────────────
  {
    check: 'permissions_hygiene',
    sev: 'warning',
    pattern: /fs\.chmod(?:Sync)?\s*\(/g,
    message:
      'fs.chmod after write creates a race window — pass mode: option directly to writeFile/mkdir instead',
  },
  {
    check: 'permissions_hygiene',
    sev: 'warning',
    // writeFile/writeFileSync where the first argument contains a secret-like file extension or name
    pattern: /writeFile(?:Sync)?\s*\([^,]*(?:\.key|\.pem|\.p12|id_rsa|id_ed25519|\.env|secret|credential)/gi,
    message:
      'writeFile with secret-like path — verify mode: 0o600 is set; default 0o644 is world-readable',
  },

  // ── error_discipline ─────────────────────────────────────────────
  {
    check: 'error_discipline',
    sev: 'warning',
    // catch block with nothing but optional whitespace inside
    pattern: /catch\s*\([^)]*\)\s*\{\s*\}/g,
    message:
      'Empty catch block — silently swallows errors; add at minimum a console.error or rethrow',
  },
  {
    check: 'error_discipline',
    sev: 'warning',
    // throw followed immediately by a string literal
    pattern: /\bthrow\s+['"`]/g,
    message:
      'throw string literal — use throw new Error("…") to preserve a stack trace',
  },
  {
    check: 'error_discipline',
    sev: 'error',
    pattern: /\bthrow\s+(?:null|undefined)\b/g,
    message:
      'throw null/undefined — loses all error context; use throw new Error("descriptive message")',
  },
];

// Files that are pure type definitions or generated — skip security checks
const SKIP_PATTERNS = [/\.d\.ts$/, /node_modules/, /__generated__/, /\.test\.ts$/, /\.spec\.ts$/];

// ------------------------------------------------------------------
// Core scanner
// ------------------------------------------------------------------

function scanFile(filePath) {
  let src;
  try {
    src = readFileSync(filePath, 'utf8');
  } catch {
    return { file: filePath, skipped: true, reason: 'unreadable', findings: [] };
  }

  if (SKIP_PATTERNS.some((p) => p.test(filePath))) {
    return { file: filePath, skipped: true, reason: 'excluded', findings: [] };
  }

  // Only run security checks when the file touches a security-relevant surface
  const isRelevant =
    /child_process/.test(src) ||
    /process\.env/.test(src) ||
    /\bfs\b/.test(src) ||
    /\bfs\/promises\b/.test(src) ||
    /new\s+RegExp/.test(src) ||
    /['"]path['"]/.test(src) ||    // path_safety checks
    /\bwriteFile\b/.test(src) ||   // permissions_hygiene
    /\bfs\.chmod\b/.test(src);

  if (!isRelevant) {
    return { file: filePath, skipped: true, reason: 'no-security-surface', findings: [] };
  }

  const lines = src.split('\n');
  const findings = [];

  for (const rule of RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? 'g' : '');
    let match;
    while ((match = re.exec(src)) !== null) {
      // Compute line number from character offset
      const lineIndex = src.slice(0, match.index).split('\n').length - 1;
      const lineText = lines[lineIndex]?.trim() ?? '';

      // Skip matches inside single-line comments
      if (/^\s*\/\//.test(lines[lineIndex] ?? '')) continue;

      findings.push({
        sev: rule.sev,
        check: rule.check,
        message: rule.message,
        file: filePath,
        line: lineIndex + 1,
        context: lineText.slice(0, 120),
      });
    }
  }

  return { file: filePath, skipped: false, findings };
}

// ------------------------------------------------------------------
// Entry point
// ------------------------------------------------------------------

async function main() {
  let files = process.argv.slice(2);

  if (files.length === 0) {
    // Read file list from stdin (one per line)
    const stdin = readFileSync('/dev/stdin', 'utf8');
    files = stdin.split('\n').map((l) => l.trim()).filter(Boolean);
  }

  const results = files.map(scanFile);
  const allFindings = results.flatMap((r) => r.findings);
  const errCount = allFindings.filter((f) => f.sev === 'error').length;
  const warnCount = allFindings.filter((f) => f.sev === 'warning').length;
  const scanned = results.filter((r) => !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;

  const report = {
    scanned,
    skipped,
    errCount,
    warnCount,
    findings: allFindings,
    files: results,
  };

  process.stdout.write(JSON.stringify(report, null, 2));
  process.exitCode = errCount > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
