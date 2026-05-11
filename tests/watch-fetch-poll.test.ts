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
        socketIo: vi.fn(),
        getStorage: vi.fn(),
        loadConfig: vi.fn(),
        syncFromColony: vi.fn(),
        getCurrentBranch: vi.fn(),
        getRemoteHead: vi.fn(),
        computeDriftResult: vi.fn(),
        postToChat: vi.fn(),
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

vi.mock('socket.io-client', () => ({
    io: mocks.socketIo,
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
    getRemoteHead: mocks.getRemoteHead,
}));

vi.mock('../src/lib/remote-drift.js', () => ({
    computeDriftResult: mocks.computeDriftResult,
}));

vi.mock('../src/lib/hub.js', () => ({
    createHubClient: vi.fn(() => ({
        url: 'https://hub.test',
        postToChat: mocks.postToChat,
    })),
}));

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

async function loadWatchModule() {
    return import('../src/commands/watch.js');
}

describe('watch fetch poll', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        vi.clearAllMocks();

        mocks.execFileSync.mockReturnValue('/repo\n');
        mocks.spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });
        mocks.chokidarWatch.mockReturnValue({
            on: vi.fn(),
            close: vi.fn(),
        });
        mocks.socketIo.mockReturnValue({
            on: vi.fn(),
            disconnect: vi.fn(),
            connected: false,
        });
        mocks.storage.isInitialized.mockResolvedValue(true);
        mocks.storage.get.mockResolvedValue({ files: ['src/auth.ts'] });
        mocks.storage.update.mockResolvedValue(null);
        mocks.storage.register.mockResolvedValue(null);
        mocks.storage.list.mockResolvedValue([]);
        mocks.getStorage.mockResolvedValue(mocks.storage);
        mocks.loadConfig.mockResolvedValue({ agent: { name: 'tester' } });
        mocks.getCurrentBranch.mockReturnValue('feat/my-feature');
        mocks.postToChat.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

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
            hubSync: false,
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
            hubSync: false,
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
            hubSync: false,
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
            hubSync: false,
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
            hubSync: false,
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
            hubSync: false,
            quiet: true,
            repoDir: process.cwd(),
        });

        await vi.advanceTimersByTimeAsync(1_000);

        expect(logSpy).not.toHaveBeenCalled();
    });

    it('startFetchPollLoop still prints drift warnings in quiet mode and syncs them to Hub', async () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        mocks.getRemoteHead
            .mockReturnValueOnce('sha-initial')
            .mockReturnValueOnce('sha-advanced');
        mocks.computeDriftResult.mockResolvedValueOnce(makeDriftResult());

        const { startFetchPollLoop } = await loadWatchModule();
        await startFetchPollLoop({
            intervalSecs: 1,
            hubSync: true,
            quiet: true,
            repoDir: process.cwd(),
        });

        await vi.advanceTimersByTimeAsync(1_000);

        expect(logSpy.mock.calls.flat().join('\n')).toContain('Remote advanced');
        expect(mocks.postToChat).toHaveBeenCalledTimes(1);
        expect(String(mocks.postToChat.mock.calls[0]?.[0]?.message ?? '')).toContain('Remote advanced');
    });

    it('watch accepts --fetch-poll 30 and commander stores the parsed value', async () => {
        const { watchCommand } = await loadWatchModule();
        watchCommand.parseOptions(['--fetch-poll', '30']);

        expect(watchCommand.opts().fetchPoll).toBe('30');
    });
});
