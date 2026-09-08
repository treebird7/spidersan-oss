import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const storage = {
        isInitialized: vi.fn(),
        get: vi.fn(),
        update: vi.fn(),
        register: vi.fn(),
        list: vi.fn(),
    };

    return {
        execFileSync: vi.fn(),
        spawnSync: vi.fn(),
        existsSync: vi.fn(() => false),
        chokidarWatch: vi.fn(),
        getStorage: vi.fn(),
        loadConfig: vi.fn(),
        syncFromColony: vi.fn(),
        getCurrentBranch: vi.fn(),
        getRepoName: vi.fn(),
        getRemoteHead: vi.fn(),
        computeDriftResult: vi.fn(),
        injectCoordComment: vi.fn(() => false),
        removeCoordComment: vi.fn(),
        // The transport behind the real `deliver`. Defaults to dead, which is
        // exactly the sp-8iqm condition under test.
        notifier: vi.fn(),
        storage,
    };
});

vi.mock('child_process', () => ({
    execFileSync: mocks.execFileSync,
    spawnSync: mocks.spawnSync,
}));

vi.mock('fs', () => ({
    existsSync: mocks.existsSync,
}));

vi.mock('chokidar', () => ({
    watch: mocks.chokidarWatch,
}));

vi.mock('../src/storage/index.js', () => ({
    getStorage: mocks.getStorage,
}));

vi.mock('../src/lib/config.js', () => ({
    loadConfig: mocks.loadConfig,
}));

vi.mock('../src/lib/colony-subscriber.js', () => ({
    syncFromColony: mocks.syncFromColony,
}));

vi.mock('../src/lib/git.js', () => ({
    getCurrentBranch: mocks.getCurrentBranch,
    getRepoName: mocks.getRepoName,
    getRemoteHead: mocks.getRemoteHead,
}));

vi.mock('../src/lib/remote-drift.js', () => ({
    computeDriftResult: mocks.computeDriftResult,
}));

vi.mock('../src/lib/coord-comment.js', () => ({
    injectCoordComment: mocks.injectCoordComment,
    removeCoordComment: mocks.removeCoordComment,
}));

// The REAL `deliver` runs; only the transport underneath it is swapped. Mocking
// `deliver` itself would test the mock, not the rule it enforces.
vi.mock('../src/lib/notify.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/lib/notify.js')>();
    return { ...actual, createNotifier: () => mocks.notifier };
});

function makeDriftResult(overrides: Record<string, unknown> = {}) {
    return {
        branch: 'feat/my-feature',
        remote: 'origin/feat/my-feature',
        localAhead: 0,
        remoteAhead: 2,
        state: 'remote_ahead',
        driftZone: ['src/auth.ts'],
        registeredInDrift: [],
        unstagedInDrift: [],
        safeToPush: false,
        rebaseContinueRisk: false,
        recommendation: 'pull_rebase',
        ...overrides,
    };
}

/** chokidar handlers registered by the watch command, keyed by event name. */
const handlers = new Map<string, (p: string) => void>();

async function loadWatchModule() {
    return import('../src/commands/watch.js');
}

beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.clearAllMocks();

    mocks.execFileSync.mockReturnValue('/repo\n');
    mocks.spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });
    handlers.clear();
    mocks.chokidarWatch.mockReturnValue({
        on: (event: string, cb: (p: string) => void) => { handlers.set(event, cb); },
        close: vi.fn(),
    });
    mocks.storage.isInitialized.mockResolvedValue(true);
    mocks.storage.get.mockResolvedValue({ files: ['src/auth.ts'] });
    mocks.storage.update.mockResolvedValue(null);
    mocks.storage.register.mockResolvedValue(null);
    mocks.storage.list.mockResolvedValue([]);
    mocks.getStorage.mockResolvedValue(mocks.storage);
    mocks.loadConfig.mockResolvedValue({ agent: { name: 'tester' } });
    mocks.getCurrentBranch.mockReturnValue('feat/my-feature');
    mocks.getRepoName.mockReturnValue('spidersan-oss');
    mocks.notifier.mockResolvedValue({ ok: false, reason: 'ENOTFOUND toak.me' });
});

afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('watch fetch poll', () => {
    it('startFetchPollLoop schedules polling and avoids a warning when drift result reports remoteAhead 0', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const intervalSpy = vi.spyOn(globalThis, 'setInterval');
        mocks.getRemoteHead
            .mockReturnValueOnce('sha-initial')
            .mockReturnValueOnce('sha-advanced')
            .mockReturnValue('sha-advanced');
        mocks.computeDriftResult.mockResolvedValueOnce(makeDriftResult({
            remoteAhead: 0,
            driftZone: [],
            state: 'synced',
            safeToPush: true,
            recommendation: 'synced',
        }));

        const { startFetchPollLoop } = await loadWatchModule();
        await startFetchPollLoop({
            intervalSecs: 30,
            quiet: false,
            repoDir: process.cwd(),
        });

        expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);

        await vi.advanceTimersByTimeAsync(30_000);
        expect(mocks.computeDriftResult).toHaveBeenCalledTimes(1);
        expect(logSpy.mock.calls.flat().join('\n')).not.toContain('Remote advanced');

        await vi.advanceTimersByTimeAsync(30_000);
        expect(logSpy.mock.calls.flat().join('\n')).toContain('Remote unchanged');
    });

    it('startFetchPollLoop prints a warning when drift is detected', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mocks.getRemoteHead
            .mockReturnValueOnce('sha-initial')
            .mockReturnValueOnce('sha-advanced');
        mocks.computeDriftResult.mockResolvedValueOnce(makeDriftResult());

        const { startFetchPollLoop } = await loadWatchModule();
        await startFetchPollLoop({
            intervalSecs: 1,
            quiet: false,
            repoDir: process.cwd(),
        });

        await vi.advanceTimersByTimeAsync(1_000);

        expect(logSpy.mock.calls.flat().join('\n')).toContain('Remote advanced');
    });

    it('startFetchPollLoop includes registered files and tier in the warning', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mocks.getRemoteHead
            .mockReturnValueOnce('sha-initial')
            .mockReturnValueOnce('sha-advanced');
        mocks.computeDriftResult.mockResolvedValueOnce(makeDriftResult({
            registeredInDrift: [
                { file: 'src/auth.ts', registered: true, tier: 2, unstaged: false },
            ],
        }));

        const { startFetchPollLoop } = await loadWatchModule();
        await startFetchPollLoop({
            intervalSecs: 1,
            quiet: false,
            repoDir: process.cwd(),
        });

        await vi.advanceTimersByTimeAsync(1_000);

        const output = logSpy.mock.calls.flat().join('\n');
        expect(output).toContain('src/auth.ts');
        expect(output).toContain('registered tier 2');
    });

    it('startFetchPollLoop includes unstaged drift files in the warning', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mocks.getRemoteHead
            .mockReturnValueOnce('sha-initial')
            .mockReturnValueOnce('sha-advanced');
        mocks.computeDriftResult.mockResolvedValueOnce(makeDriftResult({
            driftZone: ['CONSORTIUM.md'],
            unstagedInDrift: [
                { file: 'CONSORTIUM.md', registered: false, tier: null, unstaged: true },
            ],
        }));

        const { startFetchPollLoop } = await loadWatchModule();
        await startFetchPollLoop({
            intervalSecs: 1,
            quiet: false,
            repoDir: process.cwd(),
        });

        await vi.advanceTimersByTimeAsync(1_000);

        expect(logSpy.mock.calls.flat().join('\n')).toContain('unstaged ⚠');
    });

    it('startFetchPollLoop logs skipped results without crashing', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        mocks.getRemoteHead
            .mockReturnValueOnce('sha-initial')
            .mockReturnValueOnce('sha-advanced');
        mocks.computeDriftResult.mockResolvedValueOnce({
            skipped: true,
            reason: 'offline',
        });

        const { startFetchPollLoop } = await loadWatchModule();
        await startFetchPollLoop({
            intervalSecs: 1,
            quiet: false,
            repoDir: process.cwd(),
        });

        await vi.advanceTimersByTimeAsync(1_000);

        expect(logSpy.mock.calls.flat().join('\n')).toContain('Skipped: offline');
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('startFetchPollLoop suppresses the unchanged heartbeat in quiet mode', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mocks.getRemoteHead
            .mockReturnValueOnce('sha-initial')
            .mockReturnValueOnce('sha-initial');

        const { startFetchPollLoop } = await loadWatchModule();
        await startFetchPollLoop({
            intervalSecs: 1,
            quiet: true,
            repoDir: process.cwd(),
        });

        await vi.advanceTimersByTimeAsync(1_000);

        expect(logSpy).not.toHaveBeenCalled();
    });

    it('startFetchPollLoop still prints drift warnings in quiet mode, and delivers nothing', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mocks.getRemoteHead
            .mockReturnValueOnce('sha-initial')
            .mockReturnValueOnce('sha-advanced');
        mocks.computeDriftResult.mockResolvedValueOnce(makeDriftResult());

        const { startFetchPollLoop } = await loadWatchModule();
        await startFetchPollLoop({
            intervalSecs: 1,
            quiet: true,
            repoDir: process.cwd(),
        });

        await vi.advanceTimersByTimeAsync(1_000);

        expect(logSpy.mock.calls.flat().join('\n')).toContain('Remote advanced');
        // Drift is not a conflict: it has no transport at all now, so there is
        // nothing that could report a delivery it did not make. (sp-hnjf)
        expect(mocks.notifier).not.toHaveBeenCalled();
    });

    it('watch accepts --fetch-poll 30 and commander stores the parsed value', async () => {
        const { watchCommand } = await loadWatchModule();
        watchCommand.parseOptions(['--fetch-poll', '30']);

        expect(watchCommand.opts().fetchPoll).toBe('30');
    });
});

// THE sp-hnjf regression test, mirroring tests/notify.test.ts. watch.ts:372 used
// to print '📤 Posted conflict to Hub chat' unconditionally after awaiting a
// Promise<void> that swallowed failure at both the adapter and client layers —
// gated on --hub-sync, never on delivery. The conflict path now runs through the
// real `deliver`, so a dead transport must surface and must not claim success.
describe('watch conflict delivery', () => {
    async function fireConflict() {
        const { watchCommand } = await loadWatchModule();
        // Another active branch already holds the file we are about to touch.
        mocks.storage.list.mockResolvedValue([
            { name: 'other/branch', status: 'active', files: ['src/auth.ts'], agent: 'other' },
        ]);
        mocks.storage.get.mockResolvedValue({ files: ['src/auth.ts'], agent: 'tester' });

        await watchCommand.parseAsync(['/repo'], { from: 'user' });

        const onChange = handlers.get('change');
        expect(onChange).toBeTypeOf('function');
        onChange!('/repo/src/auth.ts');
        await vi.advanceTimersByTimeAsync(2_000);
    }

    it('reports NOT NOTIFIED and never claims success when delivery fails', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mocks.notifier.mockResolvedValue({ ok: false, reason: 'ENOTFOUND toak.me' });

        await fireConflict();

        const output = logSpy.mock.calls.flat().join('\n');
        expect(output).toContain('CONFLICT DETECTED');
        expect(output).toContain('NOT NOTIFIED');
        expect(output).toContain('ENOTFOUND toak.me');
        expect(output).not.toContain('notified:');
        // The exact line the old code printed regardless of outcome.
        expect(output).not.toContain('Posted conflict to Hub chat');
    });

    it('claims success only when the transport reports delivery', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mocks.notifier.mockResolvedValue({ ok: true });

        await fireConflict();

        const output = logSpy.mock.calls.flat().join('\n');
        expect(output).toContain('notified:');
        expect(output).not.toContain('NOT NOTIFIED');
    });

    it('keys dedupe off the contested files, not the rendered message', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        mocks.notifier.mockResolvedValue({ ok: true });

        await fireConflict();

        expect(mocks.notifier).toHaveBeenCalledTimes(1);
        const event = mocks.notifier.mock.calls[0]?.[0];
        expect(event.dedupe).toBe('watch:feat/my-feature:src/auth.ts');
        expect(event.repo).toBe('spidersan-oss');
        expect(event.files).toEqual(['src/auth.ts']);
        expect(event.tier).toBeGreaterThanOrEqual(1);
    });
});
