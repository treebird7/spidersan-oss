import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the foundations — use a real in-memory store, never the real registry/network.
vi.mock('../src/storage/index.js', () => ({
    getStorage: vi.fn(),
}));
vi.mock('../src/lib/trunk.js', () => ({
    getTrunkBranch: vi.fn(() => 'main'),
}));

import { verifyTrunkCommand, trunkEquivalentNames } from '../src/commands/verify-trunk.js';
import { getStorage } from '../src/storage/index.js';
import { getTrunkBranch } from '../src/lib/trunk.js';
import { MemoryBranchRegistryStore } from '../src/storage/memory-branch-registry-store.js';
import type { Branch } from '../src/storage/adapter.js';

const mockGetStorage = vi.mocked(getStorage);
const mockGetTrunkBranch = vi.mocked(getTrunkBranch);

/** Fresh, initialized in-memory store seeded with the given branch entries. */
async function seedStore(entries: Array<Pick<Branch, 'name' | 'files'>>): Promise<MemoryBranchRegistryStore> {
    const store = new MemoryBranchRegistryStore();
    await store.init();
    for (const entry of entries) {
        await store.register({ name: entry.name, files: entry.files, status: 'active' });
    }
    return store;
}

/** Run the action, capturing stdout/stderr + the exit code (no real process exit). */
async function runVerifyTrunk(args: string[]): Promise<{ out: string; exitCode: number | undefined }> {
    const logs: string[] = [];
    const errs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.join(' ')); });
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...a) => { errs.push(a.join(' ')); });

    let exitCode: number | undefined;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        exitCode = code;
        throw new Error(`__exit__:${code}`);
    }) as never);

    // verifyTrunkCommand is a singleton; clear option values from a prior run so
    // flags like --fix / --exit-code don't leak across tests.
    (verifyTrunkCommand as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};

    try {
        await verifyTrunkCommand.parseAsync(['node', 'verify-trunk', ...args]);
    } catch (err) {
        if (!(err instanceof Error) || !err.message.startsWith('__exit__:')) throw err;
    } finally {
        logSpy.mockRestore();
        errSpy.mockRestore();
        exitSpy.mockRestore();
    }

    return { out: [...logs, ...errs].join('\n'), exitCode };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockGetTrunkBranch.mockReturnValue('main');
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('trunkEquivalentNames (pure)', () => {
    it('returns trunk + literal main/master, de-duplicated', () => {
        expect(trunkEquivalentNames('main')).toEqual(['main', 'master']);
        expect(trunkEquivalentNames('master')).toEqual(['master', 'main']);
        expect(trunkEquivalentNames('develop')).toEqual(['develop', 'main', 'master']);
    });
});

describe('verify-trunk command', () => {
    it('flags a poisoned trunk (main claims files)', async () => {
        const store = await seedStore([{ name: 'main', files: ['a.tsx', 'b.tsx'] }]);
        mockGetStorage.mockResolvedValue(store);

        const { out, exitCode } = await runVerifyTrunk([]);
        expect(out).toContain('TRUNK POISON');
        expect(out).toContain('main');
        expect(out).toContain('a.tsx');
        expect(exitCode).toBeUndefined(); // read-only without --exit-code → no exit
    });

    it('reports clean when trunk claims no files', async () => {
        const store = await seedStore([{ name: 'main', files: [] }]);
        mockGetStorage.mockResolvedValue(store);

        const { out, exitCode } = await runVerifyTrunk([]);
        expect(out).toContain('is clean');
        expect(out).toContain('files:[]');
        expect(exitCode).toBeUndefined();
    });

    it('is clean when there is no main entry at all', async () => {
        const store = await seedStore([{ name: 'feat/x', files: ['x.ts'] }]);
        mockGetStorage.mockResolvedValue(store);

        const { out } = await runVerifyTrunk([]);
        expect(out).toContain('is clean');
    });

    it('--exit-code → 1 when poisoned', async () => {
        const store = await seedStore([{ name: 'main', files: ['a.tsx'] }]);
        mockGetStorage.mockResolvedValue(store);

        const { exitCode } = await runVerifyTrunk(['--exit-code']);
        expect(exitCode).toBe(1);
    });

    it('--exit-code → no exit (0) when clean', async () => {
        const store = await seedStore([{ name: 'main', files: [] }]);
        mockGetStorage.mockResolvedValue(store);

        const { exitCode } = await runVerifyTrunk(['--exit-code']);
        expect(exitCode).toBeUndefined();
    });

    it('--fix clears files:[] and a re-read confirms clean', async () => {
        const store = await seedStore([{ name: 'main', files: ['a.tsx', 'b.tsx'] }]);
        mockGetStorage.mockResolvedValue(store);

        const { out } = await runVerifyTrunk(['--fix']);
        expect(out).toContain('reset to files:[]');

        // Re-read the actual store to confirm the fix persisted.
        const main = await store.get('main');
        expect(main?.files).toEqual([]);

        // A subsequent verify is now clean.
        const second = await runVerifyTrunk([]);
        expect(second.out).toContain('is clean');
    });

    it('--fix clears EVERY poisoned trunk-equivalent (main AND master) when trunk=develop', async () => {
        mockGetTrunkBranch.mockReturnValue('develop');
        const store = await seedStore([
            { name: 'develop', files: ['d.ts'] },
            { name: 'main', files: ['m.ts'] },
            { name: 'master', files: ['x.ts'] },
            { name: 'feat/keep', files: ['keep.ts'] }, // must NOT be touched
        ]);
        mockGetStorage.mockResolvedValue(store);

        await runVerifyTrunk(['--fix']);

        expect((await store.get('develop'))?.files).toEqual([]);
        expect((await store.get('main'))?.files).toEqual([]);
        expect((await store.get('master'))?.files).toEqual([]);
        // Non-trunk feature branch left intact.
        expect((await store.get('feat/keep'))?.files).toEqual(['keep.ts']);
    });

    it('--fix with --exit-code does not exit 1 (poison resolved → hook can re-run clean)', async () => {
        const store = await seedStore([{ name: 'main', files: ['a.tsx'] }]);
        mockGetStorage.mockResolvedValue(store);

        const { exitCode } = await runVerifyTrunk(['--fix', '--exit-code']);
        expect(exitCode).toBeUndefined();
    });

    it('--json emits { trunk, poisoned, entries[] } with per-entry shape', async () => {
        const store = await seedStore([{ name: 'main', files: ['a.tsx', 'b.tsx'] }]);
        mockGetStorage.mockResolvedValue(store);

        const { out } = await runVerifyTrunk(['--json']);
        const parsed = JSON.parse(out);
        expect(parsed.trunk).toBe('main');
        expect(parsed.poisoned).toBe(true);
        expect(parsed.entries).toHaveLength(1);
        expect(parsed.entries[0].name).toBe('main');
        expect(parsed.entries[0].files).toEqual(['a.tsx', 'b.tsx']);
        expect(parsed.entries[0].fixed).toBeUndefined(); // no --fix
    });

    it('--json --fix marks each entry fixed:true', async () => {
        const store = await seedStore([{ name: 'main', files: ['a.tsx'] }]);
        mockGetStorage.mockResolvedValue(store);

        const { out } = await runVerifyTrunk(['--json', '--fix']);
        const parsed = JSON.parse(out);
        expect(parsed.poisoned).toBe(true);
        expect(parsed.entries[0].fixed).toBe(true);
    });

    it('--json clean → poisoned:false, empty entries', async () => {
        const store = await seedStore([{ name: 'main', files: [] }]);
        mockGetStorage.mockResolvedValue(store);

        const { out } = await runVerifyTrunk(['--json']);
        const parsed = JSON.parse(out);
        expect(parsed.poisoned).toBe(false);
        expect(parsed.entries).toEqual([]);
    });
});
