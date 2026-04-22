1. **Analyze:** The `src/lib/github.ts` file executes `gh` CLI commands using `execFileSync` to fetch information. However, while some parameters like `prNumber` are numbers and some logic prevents severe injection, the use of `branch` in `execFileSync` could be subject to option injection (e.g. if a branch is named `--something`).
2. **Action:** We will import `validateBranchName` from `../lib/security.js` inside `src/lib/github.ts` and sanitize any `branch` string before passing it into `execFileSync`. For PR numbers, since they are validated as positive integers (`Number.isInteger(prNumber) || prNumber <= 0`), they are relatively safe, but it's a best practice to add `--` to the `gh` commands that take positional arguments to terminate options parsing to fully prevent injection.
3. **Plan:**
   - In `src/lib/github.ts`, import `validateBranchName` from `./security.js`.
   - Update `getCommitInfo`, `getCIStatus`, `getAheadBehind` to call `validateBranchName(branch)` at the beginning.
   - For commands taking positional arguments or explicit base branches, we could also use `--` but since we're using execFileSync with arrays and option formats like `--branch`, `validateBranchName` is sufficient for branch names.
   - However, for `gh pr view` and `gh pr diff`, we should add `--` before `String(prNumber)` just as a defense-in-depth measure.
4. **Pre-commit:** Complete pre commit steps to make sure proper testing, verifications, reviews and reflections are done.
5. **Submit:** Submit the changes with an appropriate commit message.
