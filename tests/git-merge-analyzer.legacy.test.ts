import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { execFileSync as ExecFileSync } from 'child_process';

/**
 * A1 — LEGACY-fallback parser, fixture-tested with RECORDED real
 * `git merge-tree <mergeBase> <base> <branch>` output (git 2.50).
 *
 * `vi.mock('child_process')` is hoisted file-wide, so this lives in its own file
 * (separate from the real-git tests). The capability probe is wired to fail with
 * an "unknown option" error → forces `getMergeConflicts` down the legacy path.
 *
 * Recorded fixtures cover the spec's heuristic-vs-real trap: legacy emits
 * `changed in both` even when the same file is edited in DIFFERENT regions and
 * merges cleanly — so the parser must require `<<<<<<<` markers, not the header.
 */

vi.mock('child_process', () => ({
    execFileSync: vi.fn(),
}));

import { execFileSync } from 'child_process';
import { getMergeConflicts } from '../src/lib/git.js';

const mockExecFileSync = vi.mocked(execFileSync);

const LEGACY_CONTENT_CONFLICT = `changed in both
  base   100644 b3c5a95f929a50feb06c275ac567cdb1b441d1e2 a file.txt
  our    100644 69d705b2183057916928feb0d42492bfa41dee47 a file.txt
  their  100644 877240bcc0c8396c6dbd408d55658d0c577790c6 a file.txt
@@ -1,4 +1,8 @@
+<<<<<<< .our
 X1
+=======
+Y1
+>>>>>>> .their
 line2
 line3
 line4
`;

const LEGACY_ADD_ADD = `added in both
  our    100644 43d5a8ed6ef6c00ff775008633f95787d088285d new file.txt
  their  100644 ba629238ca89489f2b350e196ca445e09d8bb834 new file.txt
@@ -1 +1,5 @@
+<<<<<<< .our
 AAA
+=======
+BBB
+>>>>>>> .their
`;

// Same file, DIFFERENT region: legacy still emits `changed in both` but the hunk
// has NO conflict markers — must be CLEAN (the heuristic-vs-real trap).
const LEGACY_DIFFERENT_REGION_CLEAN = `changed in both
  base   100644 b3c5a95f929a50feb06c275ac567cdb1b441d1e2 a file.txt
  our    100644 69d705b2183057916928feb0d42492bfa41dee47 a file.txt
  their  100644 85c83497d394d4260248093c7650e75f97a803ba a file.txt
@@ -2,4 +2,4 @@
 line2
 line3
 line4
-line5
+Z5
`;

const LEGACY_DISJOINT_CLEAN = `added in remote
  their  100644 cc628ccd10742baea8241c5924df992b5c019f71 other2.txt
@@ -0,0 +1 @@
+world
`;

function unknownOptionError(): Error {
    const err = new Error("error: unknown option `write-tree'") as Error & { stdout?: string; stderr?: string };
    err.stderr = "error: unknown option `write-tree'\nusage: git merge-tree";
    return err;
}

/**
 * Wire the mock to: resolve refs (rev-parse), FAIL `--write-tree` (capability
 * probe + any modern attempt → forces legacy), supply a merge-base, then return
 * the recorded `legacyOutput` for the legacy 3-arg merge-tree.
 */
function wireLegacy(legacyOutput: string): void {
    mockExecFileSync.mockImplementation(((_cmd: string, args: readonly string[]) => {
        const a = args as string[];
        if (a[0] === 'rev-parse' && a[1] === '--verify') {
            return 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n';
        }
        if (a[0] === 'merge-tree' && a.includes('--write-tree')) {
            throw unknownOptionError();
        }
        if (a[0] === 'merge-base') {
            return 'cafebabecafebabecafebabecafebabecafebabe\n';
        }
        if (a[0] === 'merge-tree') {
            return legacyOutput;
        }
        return '';
    }) as unknown as typeof ExecFileSync);
}

describe('getMergeConflicts — legacy fallback parser (mocked, recorded fixtures)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('content conflict → 1 content conflict', () => {
        wireLegacy(LEGACY_CONTENT_CONFLICT);
        const result = getMergeConflicts('bx', 'by');
        expect(result.error).toBeUndefined();
        expect(result.method).toBe('legacy');
        expect(result.clean).toBe(false);
        expect(result.conflicts).toEqual([{ file: 'a file.txt', kind: 'content' }]);
    });

    it('add/add → 1 add/add conflict', () => {
        wireLegacy(LEGACY_ADD_ADD);
        const result = getMergeConflicts('addA', 'addB');
        expect(result.error).toBeUndefined();
        expect(result.method).toBe('legacy');
        expect(result.conflicts).toEqual([{ file: 'new file.txt', kind: 'add/add' }]);
    });

    it('same file DIFFERENT region (changed-in-both, no markers) → CLEAN', () => {
        wireLegacy(LEGACY_DIFFERENT_REGION_CLEAN);
        const result = getMergeConflicts('bx', 'bz');
        expect(result.error).toBeUndefined();
        expect(result.method).toBe('legacy');
        expect(result.clean).toBe(true);
        expect(result.conflicts).toEqual([]);
    });

    it('disjoint files → clean', () => {
        wireLegacy(LEGACY_DISJOINT_CLEAN);
        const result = getMergeConflicts('dj1', 'dj2');
        expect(result.error).toBeUndefined();
        expect(result.method).toBe('legacy');
        expect(result.clean).toBe(true);
        expect(result.conflicts).toEqual([]);
    });

    it('handles a conflicted path containing spaces', () => {
        wireLegacy(LEGACY_CONTENT_CONFLICT);
        const result = getMergeConflicts('bx', 'by');
        expect(result.conflicts[0].file).toBe('a file.txt');
    });

    it('missing ref (rev-parse fails on both candidates) → error set, no throw', () => {
        mockExecFileSync.mockImplementation(((_cmd: string, args: readonly string[]) => {
            const a = args as string[];
            if (a[0] === 'rev-parse' && a[1] === '--verify') {
                throw new Error('fatal: Needed a single revision');
            }
            return '';
        }) as unknown as typeof ExecFileSync);

        const result = getMergeConflicts('bx', 'no-such-ref');
        expect(result.error).toMatch(/ref not found/);
        expect(result.clean).toBe(false);
        expect(result.conflicts).toEqual([]);
    });
});
