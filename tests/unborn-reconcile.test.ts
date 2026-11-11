/**
 * sp-woci — a branch registered before its first commit must not read as merged.
 *
 * Integration test against a REAL temp repo with pinned committer dates
 * (git dates are whole seconds, registeredAt is ms — pinning removes the
 * same-second ambiguity). Real merges of branches that did work must still
 * reconcile away.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMergedInto, isSquashMergedInto, tipCommitTime, isOnFirstParentChain } from '../src/lib/git.js';
import { reconcileBranches, type ReconcileDeps } from '../src/lib/reconcile.js';
import type { Branch } from '../src/storage/adapter.js';

const BEFORE = '2026-01-01T00:00:00Z';
const REGISTERED = new Date('2026-06-01T00:00:00Z');
const AFTER = '2026-07-01T00:00:00Z';

let repo: string;
let prevCwd: string;

function git(date: string, ...args: string[]): string {
    return execFileSync('git', args, {
        cwd: repo,
        encoding: 'utf-8',
        env: {
            ...process.env,
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_AUTHOR_NAME: 't',
            GIT_AUTHOR_EMAIL: 't@t',
            GIT_COMMITTER_NAME: 't',
            GIT_COMMITTER_EMAIL: 't@t',
            GIT_AUTHOR_DATE: date,
            GIT_COMMITTER_DATE: date,
        },
    }).trim();
}

function commitFile(date: string, name: string): void {
    writeFileSync(join(repo, name), `${name}\n`);
    git(date, 'add', name);
    git(date, 'commit', '-m', name);
}

beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'spidersan-unborn-'));
    prevCwd = process.cwd();
    git(BEFORE, 'init', '-b', 'main');
    commitFile(BEFORE, 'base.txt');

    // The repro: two branches registered right after `git switch -c`, no commits yet.
    git(BEFORE, 'branch', 'a');
    git(BEFORE, 'branch', 'b');

    // Committed BEFORE registering, then merged with a merge commit.
    git(BEFORE, 'switch', '-c', 'feat/merge-commit');
    commitFile(BEFORE, 'mc.txt');
    git(BEFORE, 'switch', 'main');
    git(AFTER, 'merge', '--no-ff', '-m', 'merge mc', 'feat/merge-commit');

    // Committed AFTER registering, then fast-forwarded.
    git(AFTER, 'switch', '-c', 'feat/ff');
    commitFile(AFTER, 'ff.txt');
    git(AFTER, 'switch', 'main');
    git(AFTER, 'merge', '--ff-only', 'feat/ff');

    // Committed BEFORE registering, then squash-merged.
    git(BEFORE, 'switch', '-c', 'feat/squash', 'main~1');
    commitFile(BEFORE, 'sq1.txt');
    commitFile(BEFORE, 'sq2.txt');
    git(AFTER, 'switch', 'main');
    git(AFTER, 'merge', '--squash', 'feat/squash');
    git(AFTER, 'commit', '-m', 'squash');

    process.chdir(repo);
});

afterAll(() => {
    process.chdir(prevCwd);
    rmSync(repo, { recursive: true, force: true });
});

const entry = (name: string): Branch => ({ name, files: ['src/auth.ts'], registeredAt: REGISTERED, status: 'active' });

const deps: ReconcileDeps = {
    trunkName: 'main',
    trunkRef: 'main',
    resolveRef: (n) => `refs/heads/${n}`,
    isMerged: (ref, trunk) => isMergedInto(ref, trunk),
    isSquashMerged: (ref, trunk) => isSquashMergedInto(ref, trunk),
    tipTime: (ref) => tipCommitTime(ref),
    isOnFirstParent: (ref, trunk) => isOnFirstParentChain(ref, trunk),
};

describe('git probes (real repo)', () => {
    it('reads the tip committer time', () => {
        expect(tipCommitTime('refs/heads/a')).toBe(Date.parse(BEFORE));
        expect(tipCommitTime('no/such/ref')).toBeNull();
    });

    it('tells first-parent tips from merge-commit second parents', () => {
        expect(isOnFirstParentChain('refs/heads/a', 'main')).toBe(true);
        expect(isOnFirstParentChain('refs/heads/feat/ff', 'main')).toBe(true);
        expect(isOnFirstParentChain('refs/heads/feat/merge-commit', 'main')).toBe(false);
        expect(isOnFirstParentChain('main', 'main')).toBe(true);
        expect(isOnFirstParentChain('no/such/ref', 'main')).toBeNull();
    });
});

describe('reconcileBranches (real repo, sp-woci)', () => {
    it('keeps both unborn branches live even after trunk moved on', () => {
        const { live, merged } = reconcileBranches([entry('a'), entry('b')], deps);
        expect(live.map(b => b.name)).toEqual(['a', 'b']);
        expect(merged).toEqual([]);
    });

    it('still reconciles away merge-commit, fast-forward and squash merges', () => {
        const { live, merged } = reconcileBranches(
            [entry('feat/merge-commit'), entry('feat/ff'), entry('feat/squash')],
            deps,
        );
        expect(live).toEqual([]);
        expect(merged).toEqual(['feat/merge-commit', 'feat/ff', 'feat/squash']);
    });
});
