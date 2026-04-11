## 2025-04-11 - Pre-compiling Minimatch patterns
**Learning:** Using the stateless `minimatch()` function in a loop with multiple patterns causes significant performance degradation because it parses the pattern into a RegExp on every call.
**Action:** When filtering files against multiple glob patterns in a loop (like in `ready-check`), pre-compile the patterns into `Minimatch` class instances outside the loop (`patterns.map(p => new Minimatch(p))`).
