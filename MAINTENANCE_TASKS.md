# 🕷️ Spidersan Maintenance Tasks
## Delegated to Flock - January 15, 2026

> **Created by:** Spidersan  
> **Date:** 2026-01-15 @ 15:43  
> **Status:** 🟢 Active delegation  

---

## ✅ Completed (by Spidersan)

| Task | Status | Time |
|------|--------|------|
| Git sync (pull --rebase) | ✅ Done | 15:43 |
| Delete .pending_task.md | ✅ Done | 15:43 |
| Fix Vitest 4 deprecation | ✅ Done | 15:43 |

---

## 📋 Delegated Tasks

### 🔴 High Priority

#### 1. Supabase URL Migration Decision
**Owner:** 🐦 **Birdsan** (task management specialist)  
**Priority:** P0  
**Estimated time:** 10 minutes

**Task:**
- Review BACKLOG.md line 9-32
- Check if Supabase URL migration is still needed
- Update BACKLOG.md with current status
- If done, move to ✅ Completed section
- If still needed, add to proper workflow/task tracker

**Acceptance criteria:**
- BACKLOG.md is accurate
- Decision documented in git commit message

**Files:**
- `/Dev/Spidersan/BACKLOG.md`

---

#### 2. CHANGELOG.md Update (Internal)
**Owner:** 📚 **Watsan** (documentation + indexing)  
**Priority:** P1  
**Estimated time:** 15 minutes

**Task:**
Update internal CHANGELOG.md with recent additions:
- `/reflect` workflow (commit eb4d970)
- `/git-sync` workflow (commit dc61af8)
- `/remote-agents` workflow (commit 27dd7e2)
- `--kill-zombies` self-termination fix (commit 15c3f22)

**Format:**
```markdown
## [0.2.2] - 2026-01-15
### Added
- New `/reflect` workflow for skill extraction
- New `/git-sync` workflow for multi-repo conflict checking
- New `/remote-agents` workflow for multi-model deployment

### Fixed
- `mcp-health --kill-zombies` no longer terminates itself
```

**Acceptance criteria:**
- CHANGELOG follows Keep a Changelog format
- All 4 recent commits documented
- Version bumped if needed

**Files:**
- `/Users/freedbird/Dev/treebird-internal/spidersan-ecosystem/archives/spidersan-public-2026-01-26/CHANGELOG.md`
- `/Users/freedbird/Dev/spidersan-public/package.json` (if version bump)

---

### 🟡 Medium Priority

#### 3. JSDoc Comments for Error Classes
**Owner:** 🔍 **Sherlocksan** (code quality + types)  
**Priority:** P2  
**Estimated time:** 20 minutes

**Task:**
Add comprehensive JSDoc to all error classes in `src/lib/errors.ts`:
- `SpidersanError`
- `StorageError`
- `ConfigError`
- `GitError`
- `LicenseError`
- `SupabaseError`

**Example:**
```typescript
/**
 * Base error class for all Spidersan-specific errors
 * @extends Error
 * @param {string} message - Human-readable error message
 * @param {string} code - Machine-readable error code for tracking
 * @example
 * throw new SpidersanError('Branch not found', 'BRANCH_NOT_FOUND');
 */
export class SpidersanError extends Error {
```

**Acceptance criteria:**
- All 6 error classes have JSDoc
- Include @param, @example, @extends tags
- Build passes (`npm run build`)

**Files:**
- `/Dev/Spidersan/src/lib/errors.ts`

---

#### 4. Improve Register Command UX
**Owner:** 📣 **Marksan** (UX + copy optimization)  
**Priority:** P2  
**Estimated time:** 30 minutes

**Task:**
Review `src/commands/register.ts` and improve:
1. Error messages (clearer, more actionable)
2. Success messages (more informative)
3. Help text for the command
4. Consider adding examples to `--help` output

**Current issues:**
- Line 80: Generic "not initialized" error
- Line 125: Could be more celebratory/encouraging
- Help text doesn't show examples

**Suggested improvements:**
```typescript
// Before
console.error('❌ Spidersan not initialized. Run: spidersan init');

// After
console.error('❌ Spidersan not initialized in this repo.');
console.error('   Run: spidersan init');
console.error('   (This only needs to be done once per repository)');
```

**Acceptance criteria:**
- All error messages are actionable
- Success messages feel rewarding
- At least 2 usage examples in help text

**Files:**
- `/Dev/Spidersan/src/commands/register.ts`

---

#### 5. README Accuracy Verification
**Owner:** 📚 **Watsan** (documentation verification)  
**Priority:** P2  
**Estimated time:** 15 minutes

**Task:**
Verify README.md is current:
1. Check all commands listed match actual CLI
2. Verify feature list is accurate
3. Update installation instructions if needed
4. Check links aren't broken

**Specific checks:**
- Line 88: Does `spidersan watch` exist?
- Line 122: Does `spidersan rescue` exist?
- All command examples run without errors

**Acceptance criteria:**
- All examples tested and work
- No outdated commands listed
- Version badge matches package.json

**Files:**
- `/Dev/Spidersan/README.md`
- Test by running: `spidersan --help`

---

### 🟢 Low Priority / Nice to Have

#### 6. Add Validation to File Detection
**Owner:** 🔍 **Sherlocksan** (defensive programming)  
**Priority:** P3  
**Estimated time:** 25 minutes

**Task:**
Add validation to `src/commands/register.ts` file detection:
- Check if detected files actually exist
- Warn about binary files
- Filter out common non-source files (.DS_Store, etc.)
- Suggest better file patterns

**Example validation:**
```typescript
function validateFiles(files: string[]): string[] {
    return files.filter(file => {
        if (!fs.existsSync(file)) {
            console.warn(`⚠️  File not found: ${file}`);
            return false;
        }
        if (isBinaryFile(file)) {
            console.warn(`⚠️  Skipping binary: ${file}`);
            return false;
        }
        return true;
    });
}
```

**Acceptance criteria:**
- Files are validated before registration
- User gets helpful warnings
- Tests updated to cover validation

**Files:**
- `/Dev/Spidersan/src/commands/register.ts`
- `/Dev/Spidersan/tests/core.test.ts` (add validation tests)

---

#### 7. Enhance Command Help Text
**Owner:** 📣 **Marksan** (copy + UX)  
**Priority:** P3  
**Estimated time:** 20 minutes

**Task:**
Review all command help text and add examples:
- `spidersan register --help`
- `spidersan conflicts --help`
- `spidersan merge-order --help`
- etc.

**Example enhancement:**
```typescript
.description('Register the current branch with files being modified')
.addHelpText('after', `
Examples:
  $ spidersan register --files "src/auth.ts,lib/db.ts"
  $ spidersan register --auto
  $ spidersan register -i  (interactive mode)
`);
```

**Acceptance criteria:**
- All major commands have examples
- Examples are copy-pasteable
- Help text is concise

**Files:**
- `/Dev/Spidersan/src/commands/*.ts`

---

## 🤝 Delegation Protocol

### How to Pick Up a Task

1. **Claim it** - Add your name to the task in this file
2. **Update status** - Change 🔲 to 🟡 (in progress)
3. **Do the work** - Follow acceptance criteria
4. **Test** - Run `npm run build && npm test`
5. **Commit** - Use format: `chore(task-number): description`
6. **Update** - Change 🟡 to ✅ and add completion time

### Task Status Icons
- 🔲 Available
- 🟡 In Progress
- ✅ Complete
- ❌ Blocked

---

## 📊 Progress Tracker

| Priority | Total | Done | In Progress | Remaining |
|----------|-------|------|-------------|-----------|
| 🔴 P0-P1 | 2 | 0 | 0 | 2 |
| 🟡 P2 | 3 | 0 | 0 | 3 |
| 🟢 P3 | 2 | 0 | 0 | 2 |
| **TOTAL** | **7** | **0** | **0** | **7** |

---

## 💬 Questions or Blockers?

Add them here or in the daily collab document!

---

🕷️ *Generated by Spidersan - "The web coordinates. The flock executes."*
