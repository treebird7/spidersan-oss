# Sentinel's Journal

## 2026-02-10 - Command Injection in Git Commands
**Vulnerability:** Command injection vulnerability in `conflicts` command where filenames were interpolated into `execSync('git show ...')`.
**Learning:** `execSync` uses a shell, allowing metacharacters in arguments (like filenames from untrusted sources) to execute arbitrary commands.
**Prevention:** Use `execFileSync` or `spawnSync` with an array of arguments for all git commands to bypass the shell and treat arguments as data.

## 2026-02-12 - Prototype Pollution in Config
**Vulnerability:** Prototype pollution via `setNestedValue` and `deepMerge` in configuration handling. Attackers could inject properties into `Object.prototype` via malicious config keys (e.g., `__proto__`).
**Learning:** Utility functions that traverse or merge objects based on user input must explicitly block access to `__proto__`, `constructor`, and `prototype`.
**Prevention:** Always validate keys against a deny-list before recursive merge or assignment operations.
