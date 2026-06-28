import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';

vi.mock('child_process', () => ({
    execFileSync: vi.fn(),
}));

import { listOpenPRs, getPRChangedFiles, getPRLabels } from '../src/lib/github.js';

const mockExecFileSync = vi.mocked(execFileSync);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('listOpenPRs', () => {
    it('maps gh pr list JSON to OpenPR entries', async () => {
        mockExecFileSync.mockReturnValue(JSON.stringify([
            { number: 12, title: 'feat: a', headRefName: 'alice/a', isDraft: false },
            { number: 13, title: 'fix: b', headRefName: 'bob/b', isDraft: true },
        ]) as never);

        expect(await listOpenPRs()).toEqual([
            { number: 12, title: 'feat: a', headBranch: 'alice/a', draft: false },
            { number: 13, title: 'fix: b', headBranch: 'bob/b', draft: true },
        ]);
    });

    it('returns [] when gh fails (unavailable/unauthenticated)', async () => {
        mockExecFileSync.mockImplementation((() => { throw new Error('gh boom'); }) as never);
        expect(await listOpenPRs()).toEqual([]);
    });
});

describe('getPRChangedFiles', () => {
    it('splits diff --name-only into paths, dropping blanks', async () => {
        mockExecFileSync.mockReturnValue('src/a.ts\nsrc/b.ts\n\n' as never);
        expect(await getPRChangedFiles(7)).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('returns [] when the diff call fails', async () => {
        mockExecFileSync.mockImplementation((() => { throw new Error('no diff'); }) as never);
        expect(await getPRChangedFiles(7)).toEqual([]);
    });
});

describe('getPRLabels', () => {
    it('extracts label names from gh pr view --json labels', async () => {
        mockExecFileSync.mockReturnValue(JSON.stringify({
            labels: [{ name: 'needs-grant:memoak/URL' }, { name: 'enhancement' }],
        }) as never);
        expect(await getPRLabels(80)).toEqual(['needs-grant:memoak/URL', 'enhancement']);
    });

    it('returns [] when there are no labels or gh fails', async () => {
        mockExecFileSync.mockReturnValue(JSON.stringify({}) as never);
        expect(await getPRLabels(80)).toEqual([]);
        mockExecFileSync.mockImplementation((() => { throw new Error('boom'); }) as never);
        expect(await getPRLabels(80)).toEqual([]);
    });
});
