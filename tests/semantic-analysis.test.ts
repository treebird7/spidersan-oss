import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { analyzeSemantic, resolveBranchTip, resolveCrossMachineRef } from '../src/lib/semantic-analysis';

let repo: string;
const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'pipe', encoding: 'utf-8' });
const commit = (ref: string, content: string) => {
    git('checkout', '-q', '-B', ref, 'base');
    writeFileSync(join(repo, 'a.ts'), content);
    git('commit', '-qam', ref);
};

beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'sem-'));
    git('init', '-q', '-b', 'base');
    git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
    writeFileSync(join(repo, 'a.ts'), 'export function login(){ return 1 }\nexport function helper(){ return 1 }\n');
    git('add', '.'); git('commit', '-qm', 'base');
    // two "PR heads" stored under refs/spidersan/pr-N, NOT as branches named like their labels
    commit('x', 'export function login(){ return 2 }\nexport function helper(){ return 1 }\n');
    git('update-ref', 'refs/spidersan/pr-1', 'x');
    commit('y', 'export function login(){ return 3 }\nexport function helper(){ return 9 }\n');
    git('update-ref', 'refs/spidersan/pr-2', 'y');
});

describe('analyzeSemantic', () => {
    it('two PRs editing the same function are reported (real refs, display labels)', () => {
        const r = analyzeSemantic('PR #1', 'refs/spidersan/pr-1',
            [{ label: 'PR #2 (feat-y)', files: ['a.ts'], ref: 'refs/spidersan/pr-2' }], repo);
        expect(r.skipped).toEqual([]);
        expect(r.conflicts.map(c => c.symbolName)).toEqual(['login']); // helper: only PR #2 touched it
    });

    it('an unresolvable target ref is SKIPPED, never a silent clean result', () => {
        const r = analyzeSemantic('PR #1', 'refs/spidersan/pr-1',
            [{ label: 'PR #2 (feat-y)', files: ['a.ts'], ref: null }], repo);
        expect(r.conflicts).toEqual([]);
        expect(r.skipped).toHaveLength(1);
        expect(r.skipped[0]).toContain('PR #2 (feat-y)');
    });

    it('a null current ref is skipped too', () => {
        const r = analyzeSemantic('PR #1', null, [{ label: 't', files: ['a.ts'], ref: 'refs/spidersan/pr-2' }], repo);
        expect(r.skipped).toHaveLength(1);
    });

    it('a file absent on one side is not a conflict and not "skipped"', () => {
        const r = analyzeSemantic('PR #1', 'refs/spidersan/pr-1',
            [{ label: 'z', files: ['nope.ts'], ref: 'refs/spidersan/pr-2' }], repo);
        expect(r).toEqual({ conflicts: [], skipped: [] });
    });

    it('parses files larger than the 32KB tree-sitter default buffer', () => {
        const big = (n: number) => `export function big(){ return ${n} }\n` + '// pad\n'.repeat(6000);
        execFileSync('git', ['checkout', '-q', '-B', 'bigbase', 'base'], { cwd: repo });
        writeFileSync(join(repo, 'big.ts'), big(0)); git('add', '.'); git('commit', '-qm', 'bigbase');
        for (const [ref, n] of [['bx', 1], ['by', 2]] as const) {
            git('checkout', '-q', '-B', ref, 'bigbase'); writeFileSync(join(repo, 'big.ts'), big(n)); git('commit', '-qam', ref);
        }
        expect(big(0).length).toBeGreaterThan(40000);
        const r = analyzeSemantic('bx', 'bx', [{ label: 'by', files: ['big.ts'], ref: 'by' }], repo);
        expect(r.skipped).toEqual([]);
        expect(r.conflicts.map(c => c.symbolName)).toEqual(['big']);
    });

    describe('git failures are skipped, never read as "file absent" (P1)', () => {
        it('a ref that does not resolve is skipped, not a clean result', () => {
            const r = analyzeSemantic('PR #1', 'refs/spidersan/pr-1',
                [{ label: 'gone', files: ['a.ts'], ref: 'refs/spidersan/does-not-exist' }], repo);
            expect(r.conflicts).toEqual([]);
            expect(r.skipped).toHaveLength(1);
        });

        it('a non-repository cwd is skipped, not "no conflicts"', () => {
            const notARepo = mkdtempSync(join(tmpdir(), 'not-a-repo-'));
            const r = analyzeSemantic('PR #1', 'refs/spidersan/pr-1',
                [{ label: 't', files: ['a.ts'], ref: 'refs/spidersan/pr-2' }], notARepo);
            expect(r.conflicts).toEqual([]);
            expect(r.skipped).toHaveLength(1);
        });

        it('unrelated histories (no merge-base) still analyze two-way instead of being skipped', () => {
            git('checkout', '-q', '--orphan', 'unrelated'); git('rm', '-rqf', '.');
            writeFileSync(join(repo, 'a.ts'), 'export function login(){ return 5 }\n');
            git('add', '.'); git('commit', '-qm', 'orphan');
            const r = analyzeSemantic('PR #1', 'refs/spidersan/pr-1',
                [{ label: 'orphan', files: ['a.ts'], ref: 'unrelated' }], repo);
            expect(r.skipped).toEqual([]);
            expect(r.conflicts.map(c => c.symbolName)).toEqual(['login']);
        });
    });

    describe('ref resolution (P1: a stale origin/<branch> must not shadow the local tip)', () => {
        let prev: string;
        beforeAll(() => {
            // resolveBranchRef/resolveLocalBranchRef run git in process.cwd()
            prev = process.cwd(); process.chdir(repo);
            git('checkout', '-q', '-B', 'ahead', 'base');
            git('update-ref', 'refs/remotes/origin/ahead', 'base');            // stale remote tip
            writeFileSync(join(repo, 'a.ts'), 'export function login(){ return 99 }\n'); git('commit', '-qam', 'unpushed');
            git('checkout', '-q', '-B', 'localonly', 'base');
            git('update-ref', 'refs/remotes/origin/box2branch', 'base');
            git('checkout', '-q', '-B', 'box2branch', 'base');                  // same-named LOCAL branch, different tip
        });
        afterAll(() => process.chdir(prev));

        it('a local branch ahead of a stale origin resolves to the local tip', () => {
            expect(resolveBranchTip('ahead')).toBe('refs/heads/ahead');
        });

        it('falls back to origin when there is no local branch', () => {
            git('update-ref', 'refs/remotes/origin/remoteonly', 'base');
            expect(resolveBranchTip('remoteonly')).toBe('refs/remotes/origin/remoteonly');
        });

        it('a cross-machine label resolves only against origin, never a same-named local branch', () => {
            expect(resolveCrossMachineRef('otherbox/box2branch')).toBe('refs/remotes/origin/box2branch');
            expect(resolveCrossMachineRef('otherbox/localonly')).toBeNull(); // local exists, origin does not => unknown
        });

        it('a prefixed local branch does not shadow the cross-machine label (P2)', () => {
            git('checkout', '-q', '-B', 'otherbox/feature/x', 'base');            // a LOCAL branch that looks like the label
            git('update-ref', 'refs/remotes/origin/feature/x', 'base');           // the real cross-machine branch, on origin
            expect(resolveCrossMachineRef('otherbox/feature/x')).toBe('refs/remotes/origin/feature/x');
        });
    });
});
