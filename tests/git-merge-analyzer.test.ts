import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { analyzeRealConflicts } from '../src/lib/git-merge-analyzer.js';

/**
 * A1 — Real merge-conflict analysis against REAL temp git repos (high fidelity).
 *
 * Exercises the live `git merge-tree --write-tree` modern path, including the
 * load-bearing exit-1-on-conflict gotcha (the conflict block arrives on the
 * THROWN error's stdout). The LEGACY-fallback parser is fixture-tested with
 * recorded output in tests/git-merge-analyzer.legacy.test.ts (a separate file
 * because `vi.mock('child_process')` is hoisted file-wide and would otherwise
 * break these real-git cases).
 */
describe('analyzeRealConflicts (real git repos)', () => {
    let repo: string;
    let originalCwd: string;

    function git(...args: string[]): string {
        return execFileSync('git', args, { cwd: repo, encoding: 'utf-8' });
    }

    function commitOn(branch: string, file: string, contents: string, from: string): void {
        git('checkout', '-q', from);
        git('checkout', '-q', '-b', branch);
        writeFileSync(join(repo, file), contents);
        git('add', '-A');
        git('commit', '-qm', `${branch}: ${file}`);
    }

    beforeEach(() => {
        originalCwd = process.cwd();
        repo = mkdtempSync(join(tmpdir(), 'ss-merge-analyzer-'));
        git('init', '-q');
        git('config', 'user.email', 'test@test');
        git('config', 'user.name', 'test');
        // Seed file with a path containing a space (exercises space handling).
        writeFileSync(join(repo, 'a file.txt'), 'line1\nline2\nline3\nline4\nline5\n');
        git('add', '-A');
        git('commit', '-qm', 'seed');
        // execGit() runs in process.cwd(); point it at the temp repo.
        process.chdir(repo);
    });

    afterEach(() => {
        process.chdir(originalCwd);
        rmSync(repo, { recursive: true, force: true });
    });

    it('case 1: same lines edited in both → 1 content conflict', async () => {
        const base = git('rev-parse', 'HEAD').trim();
        commitOn('bx', 'a file.txt', 'X1\nline2\nline3\nline4\nline5\n', base);
        commitOn('by', 'a file.txt', 'Y1\nline2\nline3\nline4\nline5\n', base);

        const report = await analyzeRealConflicts('bx', 'by');

        expect(report.error).toBeUndefined();
        expect(report.clean).toBe(false);
        expect(report.conflicts).toHaveLength(1);
        expect(report.conflicts[0]).toEqual({ file: 'a file.txt', kind: 'content' });
        expect(report.method).toBe('write-tree');
    });

    it('case 2: same file, DIFFERENT regions → CLEAN (real vs heuristic)', async () => {
        const base = git('rev-parse', 'HEAD').trim();
        commitOn('bx', 'a file.txt', 'X1\nline2\nline3\nline4\nline5\n', base);
        // Edit line5 only — disjoint from bx's line1 edit.
        commitOn('bz', 'a file.txt', 'line1\nline2\nline3\nline4\nZ5\n', base);

        const report = await analyzeRealConflicts('bx', 'bz');

        expect(report.error).toBeUndefined();
        expect(report.clean).toBe(true);
        expect(report.conflicts).toEqual([]);
    });

    it('case 3: add/add same new path, different content → conflict', async () => {
        const base = git('rev-parse', 'HEAD').trim();
        commitOn('addA', 'new file.txt', 'AAA\n', base);
        commitOn('addB', 'new file.txt', 'BBB\n', base);

        const report = await analyzeRealConflicts('addA', 'addB');

        expect(report.error).toBeUndefined();
        expect(report.clean).toBe(false);
        expect(report.conflicts).toHaveLength(1);
        expect(report.conflicts[0]).toEqual({ file: 'new file.txt', kind: 'add/add' });
    });

    it('case 4: disjoint files → clean', async () => {
        const base = git('rev-parse', 'HEAD').trim();
        commitOn('dj1', 'other1.txt', 'hello\n', base);
        commitOn('dj2', 'other2.txt', 'world\n', base);

        const report = await analyzeRealConflicts('dj1', 'dj2');

        expect(report.error).toBeUndefined();
        expect(report.clean).toBe(true);
        expect(report.conflicts).toEqual([]);
    });

    it('case 5: missing ref → error set, clean=false, no throw', async () => {
        const base = git('rev-parse', 'HEAD').trim();
        commitOn('bx', 'a file.txt', 'X1\nline2\nline3\nline4\nline5\n', base);

        const report = await analyzeRealConflicts('bx', 'no-such-branch');

        expect(report.error).toBeDefined();
        expect(report.error).toMatch(/ref not found: no-such-branch/);
        expect(report.clean).toBe(false);
        expect(report.conflicts).toEqual([]);
    });

    it('resolves raw SHAs leniently (no branch names) and detects the conflict', async () => {
        const base = git('rev-parse', 'HEAD').trim();
        commitOn('bx', 'a file.txt', 'X1\nline2\nline3\nline4\nline5\n', base);
        commitOn('by', 'a file.txt', 'Y1\nline2\nline3\nline4\nline5\n', base);

        const bxSha = git('rev-parse', 'bx').trim();
        const bySha = git('rev-parse', 'by').trim();
        const report = await analyzeRealConflicts(bxSha, bySha);

        expect(report.error).toBeUndefined();
        expect(report.conflicts).toHaveLength(1);
        expect(report.conflicts[0].file).toBe('a file.txt');
    });

    it('case 6: modify/delete on a keyword-containing path → full path, not truncated (Bug-1 regression)', async () => {
        // Path contains the word "added" — the old parser truncated it to "my".
        writeFileSync(join(repo, 'my added notes.txt'), 'orig\n');
        git('add', '-A');
        git('commit', '-qm', 'add notes');
        const base = git('rev-parse', 'HEAD').trim();
        commitOn('featM', 'my added notes.txt', 'modified on M\n', base);
        git('checkout', '-q', base);
        git('checkout', '-q', '-b', 'featD');
        git('rm', '-q', 'my added notes.txt');
        git('commit', '-qm', 'delete notes');

        const report = await analyzeRealConflicts('featM', 'featD');

        expect(report.error).toBeUndefined();
        expect(report.clean).toBe(false);
        expect(report.conflicts).toHaveLength(1);
        // The point: full path preserved, NOT truncated at the keyword "added".
        expect(report.conflicts[0].file).toBe('my added notes.txt');
        expect(report.conflicts[0].kind).toBe('delete/modify');
    });

    it('case 7: rename/delete → conflict with kind rename (exercises " renamed to " terminator)', async () => {
        writeFileSync(join(repo, 'report.txt'), 'a\nb\nc\nd\ne\nf\ng\nh\n');
        git('add', '-A');
        git('commit', '-qm', 'add report');
        const base = git('rev-parse', 'HEAD').trim();
        git('checkout', '-q', '-b', 'featRen');
        git('mv', 'report.txt', 'summary.txt');
        git('commit', '-qm', 'rename report');
        git('checkout', '-q', base);
        git('checkout', '-q', '-b', 'featDel');
        git('rm', '-q', 'report.txt');
        git('commit', '-qm', 'delete report');

        const report = await analyzeRealConflicts('featRen', 'featDel');

        expect(report.error).toBeUndefined();
        expect(report.clean).toBe(false);
        // The conflicting source path must appear with kind 'rename'.
        const renamed = report.conflicts.find(c => c.kind === 'rename');
        expect(renamed).toBeDefined();
        expect(renamed?.file).toBe('report.txt');
    });
});
