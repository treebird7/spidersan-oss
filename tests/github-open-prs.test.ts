import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';

vi.mock('child_process', () => ({
    execFileSync: vi.fn(),
}));

import { listOpenPRs, getPRChangedFiles } from '../src/lib/github.js';

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
