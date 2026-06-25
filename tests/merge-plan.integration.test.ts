import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { analyzeRealConflicts } from '../src/lib/git-merge-analyzer.js';
import { buildMergePlan, type PRFacts } from '../src/commands/merge-plan.js';

/**
 * tb-uvy — dogfood the FUSED verdict path on a real conflicting/stacked train.
 *
 * The unit tests in merge-plan.test.ts assert BLOCKED/WAIT from HAND-MADE
 * `conflictFiles`/`base`. The original dogfood (tb-bi2) ran the live command on a
 * REAL RT train but that train was disjoint — only MERGE/STALE/ordering fired,
 * never BLOCKED or WAIT.
 *
 * This closes the gap: a real temp git repo with a genuine `git merge-tree`
 * conflict and a real stacked base, wired through the SAME mapping the command
 * uses (`conflictFiles = report.conflicts.map(c => c.file)`), then run through
 * `buildMergePlan`. So the BLOCKED + WAIT paths are exercised from real git
 * truth, not fixtures.
 */
describe('merge-plan fused verdicts on a real conflicting/stacked train (tb-uvy)', () => {
    let repo: string;
    let originalCwd: string;

    function git(...args: string[]): string {
        return execFileSync('git', args, { cwd: repo, encoding: 'utf-8' });
    }

    beforeEach(() => {
        originalCwd = process.cwd();
        repo = mkdtempSync(join(tmpdir(), 'ss-merge-plan-int-'));
        git('init', '-q', '-b', 'main');
        git('config', 'user.email', 'test@test');
        git('config', 'user.name', 'test');
        writeFileSync(join(repo, 'shared.txt'), 'a\nb\nc\nd\ne\n');
        git('add', '-A');
        git('commit', '-qm', 'seed');
        // analyzeRealConflicts shells git in process.cwd() — point it at the repo.
        process.chdir(repo);
    });

    afterEach(() => {
        process.chdir(originalCwd);
        rmSync(repo, { recursive: true, force: true });
    });

    it('BLOCKED (real merge-tree conflict) + WAIT (stacked) + MERGE + parent-before-child order', async () => {
        const seed = git('rev-parse', 'HEAD').trim();

        // feat-conflict: edit line1 off the seed...
        git('checkout', '-q', '-b', 'feat-conflict', seed);
        writeFileSync(join(repo, 'shared.txt'), 'X\nb\nc\nd\ne\n');
        git('add', '-A');
        git('commit', '-qm', 'conflict: line1=X');

        // ...then main edits the SAME line differently → real merge-tree conflict.
        git('checkout', '-q', 'main');
        writeFileSync(join(repo, 'shared.txt'), 'M\nb\nc\nd\ne\n');
        git('add', '-A');
        git('commit', '-qm', 'main: line1=M');

        // feat-clean: a disjoint new file off current main → no conflict.
        git('checkout', '-q', '-b', 'feat-clean', 'main');
        writeFileSync(join(repo, 'feature.txt'), 'hello\n');
        git('add', '-A');
        git('commit', '-qm', 'clean: add feature.txt');

        // feat-stacked: based on feat-clean's head (a stacked child).
        git('checkout', '-q', '-b', 'feat-stacked', 'feat-clean');
        writeFileSync(join(repo, 'feature.txt'), 'hello\nworld\n');
        git('add', '-A');
        git('commit', '-qm', 'stacked: extend feature.txt');

        // Real conflict analysis — the BLOCKED input comes from git truth, not a fixture.
        const report = await analyzeRealConflicts('main', 'feat-conflict');
        expect(report.error).toBeUndefined();
        expect(report.clean).toBe(false); // guard: the train really conflicts
        const realConflictFiles = report.conflicts.map((c) => c.file);
        expect(realConflictFiles).toContain('shared.txt');

        const facts: PRFacts[] = [
            // #10 clean child-parent: disjoint file, on trunk → MERGE
            {
                number: 10, title: 'clean feature', base: 'main', head: 'feat-clean',
                mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
                failingRequired: [], behind: 0, conflictFiles: [],
            },
            // #11 real conflict against main → BLOCKED, real file surfaced
            {
                number: 11, title: 'conflicting change', base: 'main', head: 'feat-conflict',
                mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY',
                failingRequired: [], behind: 0, conflictFiles: realConflictFiles,
            },
            // #12 base == #10's head → stacked → WAIT
            {
                number: 12, title: 'stacked on feature', base: 'feat-clean', head: 'feat-stacked',
                mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
                failingRequired: [], behind: 0, conflictFiles: [],
            },
        ];

        const plan = buildMergePlan(facts, 'main', 'treebird7/Recovery-Tree-New');
        const by = new Map(plan.plan.map((e) => [e.number, e] as const));

        // BLOCKED with the real conflict file named.
        expect(by.get(11)!.verdict).toBe('BLOCKED');
        expect(by.get(11)!.reason).toContain('shared.txt');
        expect(by.get(11)!.conflicts).toContain('shared.txt');

        // WAIT, stacked on its real parent, with a retarget advisory.
        expect(by.get(12)!.verdict).toBe('WAIT');
        expect(by.get(12)!.stackedOn).toBe(10);
        expect(by.get(12)!.advisories.some((a) => a.includes('after #10'))).toBe(true);

        // Clean one on trunk → MERGE.
        expect(by.get(10)!.verdict).toBe('MERGE');

        // Ordering invariant: parent (#10) is never placed after its child (#12).
        const order = plan.plan.map((e) => e.number);
        expect(order.indexOf(10)).toBeLessThan(order.indexOf(12));
    });
});
