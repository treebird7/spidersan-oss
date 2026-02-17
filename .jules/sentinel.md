# Sentinel's Journal

## 2026-02-10 - Command Injection in Git Commands
**Vulnerability:** Command injection vulnerability in `conflicts` command where filenames were interpolated into `execSync('git show ...')`.
**Learning:** `execSync` uses a shell, allowing metacharacters in arguments (like filenames from untrusted sources) to execute arbitrary commands.
**Prevention:** Use `execFileSync` or `spawnSync` with an array of arguments for all git commands to bypass the shell and treat arguments as data.

## 2026-02-12 - Prototype Pollution in Config
**Vulnerability:** Prototype pollution via `setNestedValue` and `deepMerge` in configuration handling. Attackers could inject properties into `Object.prototype` via malicious config keys (e.g., `__proto__`).
**Learning:** Utility functions that traverse or merge objects based on user input must explicitly block access to `__proto__`, `constructor`, and `prototype`.
**Prevention:** Always validate keys against a deny-list before recursive merge or assignment operations.

## 2026-02-14 - Missing Input Validation on Registration
**Vulnerability:** `register` command accepted raw input for files and agent IDs, potentially allowing registration of malicious data (though not directly exploitable for RCE, it could pollute the system).
**Learning:** Input validation should be applied at the entry point of the system (e.g., CLI commands), not just when data is consumed.
**Prevention:** Use centralized validation functions (like `validateFilePath`, `validateAgentId`) immediately upon receiving user input.

## 2026-02-15 - Arbitrary File Read in Rescue Command
**Vulnerability:** The `rescue` command accepted arbitrary file paths for its `--salvage` option, allowing users to copy sensitive files (e.g., `/etc/passwd`) from outside the repository into the `salvage/` directory.
**Learning:** CLI tools running with user privileges can be tricked into accessing sensitive files if input paths are not validated to be within the expected scope (the repository).
**Prevention:** Always resolve user-provided file paths against the repository root and verify that they do not traverse outside it using `path.resolve` and checking for `..` or absolute paths.

## 2026-02-18 - Input Validation Bypass in CLI Options
**Vulnerability:** The `register` command validated files provided via `--files` flag but failed to validate files obtained via `--auto` (git diff) or `--interactive` (user input) modes.
**Learning:** When a CLI command has multiple ways to obtain the same type of input (flags, auto-detection, prompts), validation logic must be applied to the *final* dataset, not just inside the block handling one specific input method.
**Prevention:** Centralize validation logic immediately before the data is used or stored, ensuring it covers all possible input sources.
