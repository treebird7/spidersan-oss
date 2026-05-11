import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'child_process';

vi.mock('child_process', () => ({
    execFileSync: vi.fn(),
}));

import {
    GitError,
    getAheadBehind,
    getChangedFiles,
    getCurrentBranch,
    getFileAtRef,
    getRemoteHead,
} from '../src/lib/git.js';

const mockExecFileSync = vi.mocked(execFileSync);

describe('src/lib/git.ts', () => {
    it('getCurrentBranch returns branch name on success', () => {
        vi.clearAllMocks();
        mockExecFileSync.mockReturnValueOnce('feature/extract-git\n');

        expect(getCurrentBranch()).toBe('feature/extract-git');
        expect(mockExecFileSync).toHaveBeenCalledWith(
            'git',
            ['rev-parse', '--abbrev-ref', 'HEAD'],
            expect.objectContaining({
                encoding: 'utf-8',
                env: expect.any(Object),
            })
        );
    });

    it('getCurrentBranch throws GitError with code NOT_A_REPO when not in a repo', () => {
        vi.clearAllMocks();
        mockExecFileSync.mockImplementation(() => {
            throw new Error('fatal: not a git repository (or any of the parent directories): .git');
        });

        try {
            getCurrentBranch();
            throw new Error('expected getCurrentBranch to throw');
        } catch (error) {
            expect(error).toBeInstanceOf(GitError);
            expect(error).toMatchObject({
                code: 'NOT_A_REPO',
                message: 'Not in a git repository',
            });
        }
    });

    it('getChangedFiles returns files from first succeeding strategy', () => {
        vi.clearAllMocks();
        mockExecFileSync
            .mockImplementationOnce(() => {
                throw new Error('fatal: ambiguous argument main...HEAD');
            })
            .mockReturnValueOnce('src/a.ts\nsrc/b.ts\n');

        expect(getChangedFiles()).toEqual(['src/a.ts', 'src/b.ts']);
        expect(mockExecFileSync).toHaveBeenNthCalledWith(
            1,
            'git',
            ['diff', '--name-only', 'main...HEAD'],
            expect.objectContaining({
                encoding: 'utf-8',
                env: expect.any(Object),
                stdio: ['pipe', 'pipe', 'ignore'],
            })
        );
        expect(mockExecFileSync).toHaveBeenNthCalledWith(
            2,
            'git',
            ['diff', '--name-only', 'HEAD~1'],
            expect.objectContaining({
                encoding: 'utf-8',
                env: expect.any(Object),
                stdio: ['pipe', 'pipe', 'ignore'],
            })
        );
    });

    it('getChangedFiles returns [] when all strategies fail', () => {
        vi.clearAllMocks();
        mockExecFileSync.mockImplementation(() => {
            throw new Error('fatal: bad revision');
        });

        expect(getChangedFiles()).toEqual([]);
    });

    it('getFileAtRef returns null when file does not exist at ref', () => {
        vi.clearAllMocks();
        mockExecFileSync
            .mockReturnValueOnce('abc123\n')
            .mockImplementationOnce(() => {
                throw new Error("fatal: path 'src/missing.ts' does not exist in 'HEAD'");
            });

        expect(getFileAtRef('HEAD', 'src/missing.ts')).toBeNull();
    });

    it('getRemoteHead returns null when remote is unreachable', () => {
        vi.clearAllMocks();
        mockExecFileSync.mockImplementation(() => {
            throw new Error('fatal: unable to access https://example.invalid/repo.git/');
        });

        expect(getRemoteHead('origin', 'main')).toBeNull();
    });

    it('getAheadBehind returns { ahead: 0, behind: 0 } when no tracking branch', () => {
        vi.clearAllMocks();
        mockExecFileSync.mockImplementation(() => {
            throw new Error('fatal: no upstream configured for branch');
        });

        expect(getAheadBehind()).toEqual({ ahead: 0, behind: 0 });
    });
});
