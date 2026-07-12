/**
 * tb-tr1z — squash-merged branches must reconcile away.
 *
 * Integration test against a REAL temp repo: a branch squash-merged into main
 * (the GitHub "Squash and merge" shape — tip never becomes an ancestor) must
 * be detected by isSquashMergedInto and dropped by reconcileBranches.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isMergedInto, isSquashMergedInto } from '../src/lib/git.js';
import { reconcileBranches, type ReconcileDeps } from '../src/lib/reconcile.js';
import type { Branch } from '../src/storage/adapter.js';

let repo: string;
let prevCwd: string;

function git(...args: string[]): string {
    return execFileSync('git', args, {
        cwd: repo,
        encoding: 'utf-8',
        env: {
            ...process.env,
            GIT_AUTHOR_NAME: 't',
            GIT_AUTHOR_EMAIL: 't@t',
            GIT_COMMITTER_NAME: 't',
            GIT_COMMITTER_EMAIL: 't@t',
        },
    }).trim();
}

function commitFile(name: string, content: string, msg: string): void {
    writeFileSync(join(repo, name), content);
    git('add', name);
    git('commit', '-m', msg);
}

beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'ssan-squash-'));
    prevCwd = process.cwd();
    git('init', '-b', 'main');
    commitFile('base.txt', 'base\n', 'base');

    // Multi-commit feature branch (single-commit branches are already caught
    // by plain git cherry; multi-commit is the case is-ancestor can't see).
    git('checkout', '-b', 'feat/squashed');
    commitFile('a.txt', 'a\n', 'feat: a');
    commitFile('b.txt', 'b\n', 'feat: b');

    // Squash-merge into main, GitHub-style.
    git('checkout', 'main');
    git('merge', '--squash', 'feat/squashed');
    git('commit', '-m', 'feat: squashed (#1)');

    // A genuinely live branch with unmerged content.
    git('checkout', '-b', 'feat/live', 'main');
    commitFile('c.txt', 'c\n', 'feat: c');
    git('checkout', 'main');

    // git.ts helpers run in process.cwd().
    process.chdir(repo);
});

afterAll(() => {
    process.chdir(prevCwd);
    rmSync(repo, { recursive: true, force: true });
});

describe('isSquashMergedInto (real repo)', () => {
    it('is-ancestor does NOT see the squash merge (the tb-tr1z gap)', () => {
        expect(isMergedInto('feat/squashed', 'main')).toBe(false);
    });

    it('detects the squash-merged multi-commit branch', () => {
        expect(isSquashMergedInto('feat/squashed', 'main')).toBe(true);
    });

    it('does not claim a live branch is merged', () => {
        expect(isSquashMergedInto('feat/live', 'main')).toBe(false);
    });

    it('is repeatable (deterministic probe object, no error on rerun)', () => {
        expect(isSquashMergedInto('feat/squashed', 'main')).toBe(true);
    });

    it('returns false on a bad ref instead of throwing', () => {
        expect(isSquashMergedInto('no/such/branch', 'main')).toBe(false);
    });
});

describe('reconcileBranches with real squash-merge deps', () => {
    const entry = (name: string): Branch => ({
        name,
        files: ['x.ts'],
        registeredAt: new Date(0),
        status: 'active',
    });

    const deps: ReconcileDeps = {
        trunkName: 'main',
        trunkRef: 'main',
        resolveRef: (n) => n,
        isMerged: (ref, trunk) => isMergedInto(ref, trunk),
        isSquashMerged: (ref, trunk) => isSquashMergedInto(ref, trunk),
    };

    it('drops the squash-merged branch and keeps the live one (acceptance: no phantom conflicts)', () => {
        const { live, merged } = reconcileBranches(
            [entry('feat/squashed'), entry('feat/live')],
            deps,
        );
        expect(merged).toEqual(['feat/squashed']);
        expect(live.map(b => b.name)).toEqual(['feat/live']);
    });
});
