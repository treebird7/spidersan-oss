import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { checkWorkingTreeIntegrity } from '../src/lib/git-events-subscriber';

/**
 * The git-watch working-tree integrity guard detects the stale-revert signature:
 * many tracked files MISSING from the working tree while .git/HEAD are intact
 * (the 2026-06-13 incident — a mixed reset stranded the tree behind HEAD).
 */
describe('checkWorkingTreeIntegrity', () => {
    let repo: string;

    function git(...args: string[]): void {
        execFileSync('git', args, { cwd: repo, stdio: ['ignore', 'ignore', 'ignore'] });
    }

    beforeEach(() => {
        repo = mkdtempSync(join(tmpdir(), 'ss-wt-guard-'));
        git('init', '-q');
        git('config', 'user.email', 'test@test'); git('config', 'user.name', 'test');
        for (let i = 0; i < 8; i++) writeFileSync(join(repo, `f${i}.txt`), `content ${i}\n`);
        git('add', '-A'); git('commit', '-qm', 'seed 8 files');
    });

    afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

    it('alarms when many tracked files are missing from the working tree', () => {
        for (let i = 0; i < 8; i++) unlinkSync(join(repo, `f${i}.txt`)); // strand the tree
        const msgs: string[] = [];
        const fired = checkWorkingTreeIntegrity(repo, (m) => msgs.push(m));
        expect(fired).toBe(true);
        expect(msgs.join('\n')).toMatch(/working-tree integrity/);
        expect(msgs.join('\n')).toMatch(/git restore/); // recovery hint present
    });

    it('does NOT alarm on a few intentional deletions (below threshold)', () => {
        unlinkSync(join(repo, 'f0.txt')); unlinkSync(join(repo, 'f1.txt')); // 2 < threshold(5)
        const msgs: string[] = [];
        const fired = checkWorkingTreeIntegrity(repo, (m) => msgs.push(m));
        expect(fired).toBe(false);
        expect(msgs.length).toBe(0);
    });

    it('does NOT alarm on a clean working tree', () => {
        const msgs: string[] = [];
        expect(checkWorkingTreeIntegrity(repo, (m) => msgs.push(m))).toBe(false);
        expect(msgs.length).toBe(0);
    });

    it('is silent on a non-git path (returns false, no throw)', () => {
        const nonRepo = mkdtempSync(join(tmpdir(), 'ss-nonrepo-'));
        try {
            const msgs: string[] = [];
            expect(checkWorkingTreeIntegrity(nonRepo, (m) => msgs.push(m))).toBe(false);
            expect(msgs.length).toBe(0);
        } finally {
            rmSync(nonRepo, { recursive: true, force: true });
        }
    });
});
