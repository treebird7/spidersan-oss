# Sentinel's Journal

## 2026-02-10 - Command Injection in Git Commands
**Vulnerability:** Command injection vulnerability in `conflicts` command where filenames were interpolated into `execSync('git show ...')`.
**Learning:** `execSync` uses a shell, allowing metacharacters in arguments (like filenames from untrusted sources) to execute arbitrary commands.
**Prevention:** Use `execFileSync` or `spawnSync` with an array of arguments for all git commands to bypass the shell and treat arguments as data.
