/**
 * `spidersan depends` must refuse a write that closes a declared cycle: non-zero
 * exit, registry untouched. Exit code asserted, not just the message.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { dependsCommand } from '../src/commands/depends';
import { getStorage } from '../src/storage/index';

vi.mock('../src/storage/index', () => ({ getStorage: vi.fn() }));
vi.mock('../src/lib/git', () => ({ getCurrentBranch: () => 'feature-a' }));

const text = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c) => c.join(' ')).join('\n');
let errorSpy: ReturnType<typeof vi.spyOn>;
let reg: Record<string, { name: string; dependsOn: string[] }>;
let update: Mock;

async function run(args: string[]): Promise<void> {
    (dependsCommand as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};
    await dependsCommand.parseAsync(['node', 'spidersan', ...args]);
}
const snapshot = () => JSON.stringify(reg);

describe('depends write-time cycle check', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`exit ${code}`);
        }) as never);
        reg = Object.fromEntries(['feature-a', 'feature-b', 'feature-c'].map((n) => [n, { name: n, dependsOn: [] as string[] }]));
        update = vi.fn(async (name: string, patch: { dependsOn: string[] }) => { reg[name].dependsOn = patch.dependsOn; });
        (getStorage as Mock).mockResolvedValue({
            isInitialized: async () => true,
            get: async (n: string) => reg[n] ?? null,
            list: async () => Object.values(reg),
            update,
        });
    });

    it('rejects a 2-cycle with exit 1 and leaves the registry unchanged', async () => {
        await run(['feature-b', '--branch', 'feature-a']);
        const before = snapshot();
        await expect(run(['feature-a', '--branch', 'feature-b'])).rejects.toThrow('exit 1');
        expect(snapshot()).toBe(before);
        expect(update).toHaveBeenCalledTimes(1);
        expect(text(errorSpy)).toContain('feature-a depends on feature-b');
        expect(text(errorSpy)).toContain('feature-b depends on feature-a');
        expect(text(errorSpy)).toContain('spidersan depends --clear --branch feature-b');
    });

    it('rejects a 3-cycle A→B→C→A', async () => {
        await run(['feature-b', '--branch', 'feature-a']);
        await run(['feature-c', '--branch', 'feature-b']);
        const before = snapshot();
        await expect(run(['feature-a', '--branch', 'feature-c'])).rejects.toThrow('exit 1');
        expect(snapshot()).toBe(before);
    });

    it('accepts a valid chain', async () => {
        await run(['feature-b', '--branch', 'feature-a']);
        await run(['feature-c', '--branch', 'feature-b']);
        expect(reg['feature-a'].dependsOn).toEqual(['feature-b']);
        expect(reg['feature-b'].dependsOn).toEqual(['feature-c']);
    });

    it('a pre-existing cycle elsewhere does not block an unrelated write', async () => {
        reg['feature-a'].dependsOn = ['feature-b'];
        reg['feature-b'].dependsOn = ['feature-a'];
        reg['feature-d'] = { name: 'feature-d', dependsOn: [] };
        await run(['feature-c', '--branch', 'feature-d']);
        expect(reg['feature-d'].dependsOn).toEqual(['feature-c']);
    });

    it('--clear still works and unblocks the reverse edge', async () => {
        await run(['feature-b', '--branch', 'feature-a']);
        await run(['--clear', '--branch', 'feature-a']);
        expect(reg['feature-a'].dependsOn).toEqual([]);
        await run(['feature-a', '--branch', 'feature-b']);
        expect(reg['feature-b'].dependsOn).toEqual(['feature-a']);
    });
});
