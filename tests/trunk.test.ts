import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MockedFunction } from 'vitest';

// Mock the git layer (execGit is the only thing trunk.ts shells out through)
// and the fs layer (for the .spidersanrc `trunk` key read).
vi.mock('../src/lib/git.js', () => ({
    execGit: vi.fn(),
}));

vi.mock('fs', () => ({
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => '{}'),
}));

import { execGit } from '../src/lib/git.js';
import { existsSync, readFileSync } from 'fs';
import { getTrunkBranch, isTrunk, _clearTrunkCache } from '../src/lib/trunk.js';

const mockExecGit = execGit as MockedFunction<typeof execGit>;
const mockExistsSync = existsSync as MockedFunction<typeof existsSync>;
const mockReadFileSync = readFileSync as MockedFunction<typeof readFileSync>;

/**
 * Build an execGit mock from a scenario description.
 *
 * Resolution order touches three distinct git calls:
 *   - symbolic-ref refs/remotes/origin/HEAD   (origin/HEAD)
 *   - rev-parse --verify refs/heads/main      (main exists?)
 *   - rev-parse --verify refs/heads/master    (master exists?)
 *
 * We dispatch on the args so call ordering doesn't matter.
 */
function setupGit(opts: {
    originHead?: string | null; // e.g. 'develop' → "refs/remotes/origin/develop"; null → throws
    mainExists?: boolean;
    masterExists?: boolean;
}) {
    const { originHead = null, mainExists = false, masterExists = false } = opts;

    mockExecGit.mockImplementation((args: string[]) => {
        const joined = args.join(' ');

        if (joined.includes('symbolic-ref') && joined.includes('refs/remotes/origin/HEAD')) {
            if (originHead === null) {
                throw new Error("fatal: ref refs/remotes/origin/HEAD is not a symbolic ref");
            }
            return `refs/remotes/origin/${originHead}\n`;
        }

        if (joined.includes('rev-parse') && joined.includes('refs/heads/main')) {
            if (mainExists) return 'abc123\n';
            throw new Error('fatal: Needed a single revision');
        }

        if (joined.includes('rev-parse') && joined.includes('refs/heads/master')) {
            if (masterExists) return 'def456\n';
            throw new Error('fatal: Needed a single revision');
        }

        return '';
    });
}

/** Make .spidersanrc present with a given `trunk` key. */
function setupConfig(trunk: string | null) {
    if (trunk === null) {
        mockExistsSync.mockReturnValue(false);
        return;
    }
    mockExistsSync.mockImplementation((p: unknown) =>
        typeof p === 'string' && p.endsWith('.spidersanrc')
    );
    mockReadFileSync.mockReturnValue(JSON.stringify({ trunk }));
}

describe('src/lib/trunk.ts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        _clearTrunkCache();
        // Default: no config file present.
        mockExistsSync.mockReturnValue(false);
        mockReadFileSync.mockReturnValue('{}');
    });

    it('resolves origin/HEAD=develop → "develop"', () => {
        setupGit({ originHead: 'develop' });
        expect(getTrunkBranch({ cwd: '/repo' })).toBe('develop');
    });

    it('no origin/HEAD + .spidersanrc trunk=trunk → "trunk"', () => {
        setupGit({ originHead: null });
        setupConfig('trunk');
        expect(getTrunkBranch({ cwd: '/repo' })).toBe('trunk');
    });

    it('no origin/HEAD, no config, main exists → "main"', () => {
        setupGit({ originHead: null, mainExists: true });
        setupConfig(null);
        expect(getTrunkBranch({ cwd: '/repo' })).toBe('main');
    });

    it('no origin/HEAD, no config, only master exists → "master"', () => {
        setupGit({ originHead: null, mainExists: false, masterExists: true });
        setupConfig(null);
        expect(getTrunkBranch({ cwd: '/repo' })).toBe('master');
    });

    it('nothing resolves → default "main"', () => {
        setupGit({ originHead: null, mainExists: false, masterExists: false });
        setupConfig(null);
        expect(getTrunkBranch({ cwd: '/repo' })).toBe('main');
    });

    it('config is only consulted when origin/HEAD is unset (origin/HEAD wins)', () => {
        setupGit({ originHead: 'develop' });
        setupConfig('trunk');
        expect(getTrunkBranch({ cwd: '/repo' })).toBe('develop');
    });

    it('caches per cwd within a process (one git call set per cwd)', () => {
        setupGit({ originHead: 'develop' });
        getTrunkBranch({ cwd: '/repo' });
        const callsAfterFirst = mockExecGit.mock.calls.length;
        getTrunkBranch({ cwd: '/repo' });
        // Second call served from cache — no additional execGit calls.
        expect(mockExecGit.mock.calls.length).toBe(callsAfterFirst);
    });

    it('isTrunk("main") is true when trunk is main', () => {
        setupGit({ originHead: null, mainExists: true });
        setupConfig(null);
        expect(isTrunk('main', { cwd: '/repo' })).toBe(true);
    });

    it('isTrunk("feature/x") is false when trunk is main', () => {
        setupGit({ originHead: null, mainExists: true });
        setupConfig(null);
        expect(isTrunk('feature/x', { cwd: '/repo' })).toBe(false);
    });

    it('isTrunk respects a non-main trunk (origin/HEAD=develop)', () => {
        setupGit({ originHead: 'develop' });
        expect(isTrunk('develop', { cwd: '/repo' })).toBe(true);
        expect(isTrunk('main', { cwd: '/repo' })).toBe(false);
    });
});
