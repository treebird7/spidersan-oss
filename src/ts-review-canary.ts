/**
 * ts-review-canary.ts — intentionally bad code to smoke-test all 6 scan.mjs checks.
 * DO NOT MERGE. Delete this file after CI pipeline verification.
 */

import { execSync, execFileSync, exec, spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// ── Check 1: input_validation ─────────────────────────────────────
// ❌ new RegExp with variable — unescaped user input reaches regex engine
function searchLogs(userQuery: string) {
  const re = new RegExp(userQuery, 'g');
  return logs.filter((l: string) => re.test(l));
}

// ── Check 2: spawn_hygiene ────────────────────────────────────────
// ❌ execSync — shell injection risk
function runGit(cmd: string) {
  return execSync(`git ${cmd}`);
}

// ⚠️ execFileSync with hardcoded 'node' — use process.execPath
function runScript(script: string) {
  return execFileSync('node', [script]);
}

// ❌ exec with template literal — shell injection
function compileTs(file: string) {
  exec(`tsc ${file}`);
}

// ⚠️ shell: true — verify no user input in args
function lsDir(dir: string) {
  return spawnSync('ls', [dir], { shell: true });
}

// ⚠️ spawnSync without error check — silent failures
function checkGit() {
  const result = spawnSync('git', ['status']);
  return result.stdout;
}

// ── Check 3: env_isolation ────────────────────────────────────────
// ⚠️ ...process.env spread
function runWithEnv(cmd: string) {
  return spawnSync(cmd, [], { env: { ...process.env, EXTRA: '1' } });
}

// ❌ env: process.env — full env leak
function runBare(cmd: string) {
  return spawnSync(cmd, [], { env: process.env });
}

// ── Check 4: path_safety ──────────────────────────────────────────
// ⚠️ startsWith('..') as traversal guard — too weak
function readUserFile(userPath: string) {
  if (userPath.startsWith('..')) throw new Error('bad path');
  return fs.readFileSync(userPath, 'utf8');
}

// ℹ️ path.normalize without containment
function sanitize(input: string) {
  return path.normalize(input);
}

// ⚠️ write to sensitive path
function writeKey(key: string) {
  fs.writeFileSync('/home/user/id_rsa', key);
}

// ── Check 5: permissions_hygiene ──────────────────────────────────
// ⚠️ fs.chmod after write — race window
function writeConfig(data: string) {
  fs.writeFileSync('/tmp/config', data);
  fs.chmod('/tmp/config', 0o600, () => {});
}

// ⚠️ writeFile with secret-like path — missing mode: 0o600
function storeToken(token: string) {
  fs.writeFileSync('/etc/app/secret', token);
}

// ── Check 6: error_discipline ─────────────────────────────────────
// ⚠️ empty catch
function parseJson(raw: string) {
  try {
    return JSON.parse(raw);
  } catch (e) {}
}

// ⚠️ throw string literal
function validate(input: unknown) {
  if (!input) throw 'input is required';
}

// ❌ throw null
function fail() {
  throw null;
}
