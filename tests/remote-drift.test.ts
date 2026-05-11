import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockedFunction } from 'vitest';

// Mock child_process before importing the module under test
vi.mock('child_process', () => ({
    execFileSync: vi.fn(),
}));

vi.mock('fs', () => ({
    existsSync: vi.fn(() => false),
}));

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import {
    getDriftZone,
    getUnstagedTrackedFiles,
    classifyDriftZone,
    computeDriftResult,
} from '../src/lib/remote-drift.js';

const mockExecFileSync = execFileSync as MockedFunction<typeof execFileSync>;
const mockExistsSync = fs.existsSync as MockedFunction<typeof fs.existsSync>;

// Helper: build git show --stat output for a set of files
function makeShowStat(files: string[]): string {
    return files.map(f => ` ${f} | 5 ++---`).join('\n') + '\n';
}

// Helper: set up standard git mocks for a drift scenario
function setupGitMocks(opts: {
    branch?: string;
    fetchOk?: boolean;
    remoteRefExists?: boolean;
    localAhead?: number;
    remoteAhead?: number;
    remoteShas?: string[];
    remoteFiles?: string[];
    unstagedFiles?: string[];
}) {
    const {
        branch = 'main',
        fetchOk = true,
        remoteRefExists = true,
        localAhead = 0,
        remoteAhead = 0,
        remoteShas = [],
        remoteFiles = [],
        unstagedFiles = [],
    } = opts;

    mockExecFileSync.mockImplementation(function mockGit(_cmd, args) {
        const argv = args as string[];

        // getCurrentBranch
        if (argv[0] === 'rev-parse' && argv[1] === '--abbrev-ref' && argv[2] === 'HEAD') {
            return `${branch}\n`;
        }

        // git fetch origin
        if (argv[0] === 'fetch') {
            if (!fetchOk) throw new Error('ENOTFOUND: Could not resolve host origin');
            return '';
        }

        // git rev-parse --verify origin/main
        if (argv[0] === 'rev-parse' && argv[1] === '--verify') {
            if (!remoteRefExists) throw new Error('fatal: Needed a single revision');
            return 'abc123\n';
        }

        // git rev-list --left-right --count HEAD...origin/main
        if (argv[0] === 'rev-list' && argv[1] === '--left-right') {
            return `${localAhead}\t${remoteAhead}\n`;
        }

        // git rev-list HEAD..origin/main (for getDriftZone) — no --left-right, no --count
        if (argv[0] === 'rev-list' && !argv.includes('--left-right') && !argv.includes('--count')) {
            return remoteShas.join('\n') + (remoteShas.length ? '\n' : '');
        }

        // git show --stat --format= <sha>
        if (argv[0] === 'show' && argv[1] === '--stat') {
            return makeShowStat(remoteFiles);
        }

        // git diff --name-only (unstaged files)
        if (argv[0] === 'diff' && argv[1] === '--name-only') {
            return unstagedFiles.join('\n') + (unstagedFiles.length ? '\n' : '');
        }

        // git rev-parse --git-dir
        if (argv[0] === 'rev-parse' && argv[1] === '--git-dir') {
            return '.git\n';
        }

        return '';
    });
}

describe('getDriftZone', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockExistsSync.mockReturnValue(false);
    });

    it('returns empty array when no remote commits', () => {
        mockExecFileSync.mockReturnValue('' as never);
        const result = getDriftZone('origin', 'main');
        expect(result).toEqual([]);
    });

    it('returns files touched by remote commits', () => {
        mockExecFileSync
            .mockReturnValueOnce('sha1\nsha2\n' as never) // rev-list
            .mockReturnValueOnce(makeShowStat(['src/lib/git.ts', 'README.md']) as never) // show --stat sha1
            .mockReturnValueOnce(makeShowStat(['src/commands/pulse.ts']) as never);  // show --stat sha2

        const result = getDriftZone('origin', 'main');
        expect(result).toContain('src/lib/git.ts');
        expect(result).toContain('README.md');
        expect(result).toContain('src/commands/pulse.ts');
    });
});

describe('getUnstagedTrackedFiles', () => {
    beforeEach(() => vi.clearAllMocks());

    it('returns empty array when no unstaged files', () => {
        mockExecFileSync.mockReturnValue('' as never);
        expect(getUnstagedTrackedFiles()).toEqual([]);
    });

    it('returns list of unstaged files', () => {
        mockExecFileSync.mockReturnValue('src/lib/git.ts\ndocs/README.md\n' as never);
        expect(getUnstagedTrackedFiles()).toEqual(['src/lib/git.ts', 'docs/README.md']);
    });
});

describe('classifyDriftZone', () => {
    it('marks files correctly as registered and/or unstaged', () => {
        const entries = classifyDriftZone(
            ['src/lib/git.ts', 'README.md', 'package.json'],
            ['src/lib/git.ts', 'package.json'],
            ['README.md', 'package.json'],
        );

        const byFile = Object.fromEntries(entries.map(e => [e.file, e]));

        expect(byFile['src/lib/git.ts'].registered).toBe(true);
        expect(byFile['src/lib/git.ts'].unstaged).toBe(false);
        expect(byFile['src/lib/git.ts'].tier).not.toBeNull();

        expect(byFile['README.md'].registered).toBe(false);
        expect(byFile['README.md'].unstaged).toBe(true);
        expect(byFile['README.md'].tier).toBeNull();

        expect(byFile['package.json'].registered).toBe(true);
        expect(byFile['package.json'].unstaged).toBe(true);
        expect(byFile['package.json'].tier).toBe(2); // package.json is TIER 2
    });
});

describe('computeDriftResult', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockExistsSync.mockReturnValue(false); // not mid-rebase
    });

    afterEach(() => vi.clearAllMocks());

    it('returns synced when 0 ahead / 0 behind', async () => {
        setupGitMocks({ branch: 'main', localAhead: 0, remoteAhead: 0 });
        const result = await computeDriftResult([]);
        expect('skipped' in result).toBe(false);
        if ('skipped' in result) return;
        expect(result.state).toBe('synced');
        expect(result.safeToPush).toBe(true);
        expect(result.driftZone).toEqual([]);
    });

    it('returns local_ahead when local is 2 ahead and remote is 0', async () => {
        setupGitMocks({ branch: 'main', localAhead: 2, remoteAhead: 0 });
        const result = await computeDriftResult([]);
        if ('skipped' in result) throw new Error('Unexpected skip');
        expect(result.state).toBe('local_ahead');
        expect(result.safeToPush).toBe(true);
    });

    it('returns remote_ahead with no overlap when drift files do not intersect registry', async () => {
        setupGitMocks({
            branch: 'main',
            localAhead: 0,
            remoteAhead: 2,
            remoteShas: ['sha1'],
            remoteFiles: ['canopy/tasks.md'],
            unstagedFiles: [],
        });
        const result = await computeDriftResult(['src/commands/conflicts.ts']);
        if ('skipped' in result) throw new Error('Unexpected skip');
        expect(result.state).toBe('remote_ahead');
        expect(result.registeredInDrift).toHaveLength(0);
        expect(result.unstagedInDrift).toHaveLength(0);
        // Remote is ahead → push would be rejected; safe_to_push = false
        expect(result.safeToPush).toBe(false);
    });

    it('returns registered_in_drift with tier when drift overlaps registry', async () => {
        setupGitMocks({
            branch: 'main',
            localAhead: 0,
            remoteAhead: 1,
            remoteShas: ['sha1'],
            remoteFiles: ['CONSORTIUM-cat-A.md'],
            unstagedFiles: [],
        });
        const result = await computeDriftResult(['CONSORTIUM-cat-A.md']);
        if ('skipped' in result) throw new Error('Unexpected skip');
        expect(result.registeredInDrift).toHaveLength(1);
        expect(result.registeredInDrift[0].file).toBe('CONSORTIUM-cat-A.md');
        expect(result.registeredInDrift[0].tier).not.toBeNull();
        expect(result.safeToPush).toBe(false);
    });

    it('sets rebaseContinueRisk when unstaged files overlap drift zone', async () => {
        setupGitMocks({
            branch: 'main',
            localAhead: 0,
            remoteAhead: 1,
            remoteShas: ['sha1'],
            remoteFiles: ['CONSORTIUM-cat-A.md'],
            unstagedFiles: ['CONSORTIUM-cat-A.md'],
        });
        const result = await computeDriftResult([]);
        if ('skipped' in result) throw new Error('Unexpected skip');
        expect(result.unstagedInDrift).toHaveLength(1);
        expect(result.rebaseContinueRisk).toBe(true);
    });

    it('returns diverged with rebase_with_conflict_prep when both local + remote have commits', async () => {
        setupGitMocks({
            branch: 'main',
            localAhead: 1,
            remoteAhead: 3,
            remoteShas: ['sha1'],
            remoteFiles: ['CONSORTIUM-cat-A.md'],
            unstagedFiles: ['CONSORTIUM-cat-A.md'],
        });
        const result = await computeDriftResult(['CONSORTIUM-cat-A.md']);
        if ('skipped' in result) throw new Error('Unexpected skip');
        expect(result.state).toBe('diverged');
        expect(result.recommendation).toBe('rebase_with_conflict_prep');
    });

    it('returns skipped when network is offline', async () => {
        mockExecFileSync.mockImplementation(function mockGit(_cmd, args) {
            const argv = args as string[];
            if (argv[0] === 'rev-parse' && argv[1] === '--abbrev-ref') return 'main\n';
            if (argv[0] === 'rev-parse' && argv[1] === '--git-dir') return '.git\n';
            if (argv[0] === 'fetch') throw new Error('ENOTFOUND: Could not resolve host origin');
            return '';
        });

        const result = await computeDriftResult([]);
        expect('skipped' in result).toBe(true);
        if (!('skipped' in result)) return;
        expect(result.reason).toMatch(/unreachable|skipped/i);
    });

    it('returns skipped for detached HEAD', async () => {
        mockExecFileSync.mockImplementation(function mockGit(_cmd, args) {
            const argv = args as string[];
            if (argv[0] === 'rev-parse' && argv[1] === '--abbrev-ref') return 'HEAD\n';
            if (argv[0] === 'rev-parse' && argv[1] === '--git-dir') return '.git\n';
            return '';
        });

        const result = await computeDriftResult([]);
        expect('skipped' in result).toBe(true);
        if (!('skipped' in result)) return;
        expect(result.reason).toMatch(/detached/i);
    });

    it('returns skipped when mid-rebase (rebase-merge dir exists)', async () => {
        mockExistsSync.mockImplementation((p: unknown) =>
            String(p).includes('rebase-merge'),
        );
        mockExecFileSync.mockImplementation(function mockGit(_cmd, args) {
            const argv = args as string[];
            if (argv[0] === 'rev-parse' && argv[1] === '--git-dir') return '.git\n';
            return '';
        });

        const result = await computeDriftResult([]);
        expect('skipped' in result).toBe(true);
        if (!('skipped' in result)) return;
        expect(result.reason).toMatch(/rebase/i);
    });

    it('returns push_clean when remote branch does not exist yet', async () => {
        mockExecFileSync.mockImplementation(function mockGit(_cmd, args) {
            const argv = args as string[];
            if (argv[0] === 'rev-parse' && argv[1] === '--abbrev-ref' && argv[2] === 'HEAD') return 'feature/new\n';
            if (argv[0] === 'rev-parse' && argv[1] === '--git-dir') return '.git\n';
            if (argv[0] === 'fetch') return '';
            if (argv[0] === 'rev-parse' && argv[1] === '--verify') throw new Error('fatal: Needed a single revision');
            return '';
        });

        const result = await computeDriftResult([]);
        if ('skipped' in result) throw new Error('Unexpected skip');
        expect(result.safeToPush).toBe(true);
        expect(result.recommendation).toBe('push_clean');
    });
});
