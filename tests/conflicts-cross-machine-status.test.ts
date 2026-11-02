/**
 * `conflicts --json` must say whether other machines were actually consulted.
 * Without this field a plain session (no sync module) reads as "no overlap"
 * even when another machine holds the same file (tb-f4bl3).
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { conflictsCommand } from '../src/commands/conflicts';
import { getStorage } from '../src/storage/index';
import { resolveRegistrySync } from '../src/storage/registry-sync';
import { execFileSync } from 'child_process';

const pullRegistries = vi.fn();

vi.mock('../src/storage/index', () => ({ getStorage: vi.fn() }));
vi.mock('../src/lib/config', () => ({ loadConfig: vi.fn(async () => ({})) }));
vi.mock('../src/storage/registry-sync', () => ({ resolveRegistrySync: vi.fn() }));
vi.mock('../src/lib/machine', () => ({ loadMachineIdentity: vi.fn(async () => ({ id: 'm-self', name: 'm2', hostname: 'h' })) }));
vi.mock('child_process', () => ({ execFileSync: vi.fn(), spawnSync: vi.fn() }));

let logSpy: ReturnType<typeof vi.spyOn>;

async function crossMachine(): Promise<string> {
    (conflictsCommand as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};
    await conflictsCommand.parseAsync(['node', 'spidersan', 'conflicts', '--json']);
    return JSON.parse(logSpy.mock.calls.map((c) => c.join(' ')).join('\n')).crossMachine;
}

describe('conflicts --json crossMachine', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        (execFileSync as Mock).mockImplementation((_c: string, args?: string[]) => {
            if (Array.isArray(args) && args.includes('--is-ancestor')) throw new Error('not an ancestor');
            return 'feat/current\n';
        });
        const mine = { name: 'feat/current', files: ['a.ts'], status: 'active', registeredAt: new Date() };
        (getStorage as Mock).mockResolvedValue({
            isInitialized: vi.fn(async () => true),
            get: vi.fn(async () => mine),
            list: vi.fn(async () => [mine]),
        });
    });

    it('no-credentials when no storage.syncModule is configured (nothing asked)', async () => {
        (resolveRegistrySync as Mock).mockResolvedValue(null);
        expect(await crossMachine()).toBe('no-credentials');
        expect(pullRegistries).not.toHaveBeenCalled();
    });

    it('degraded when the remote pull fails', async () => {
        (resolveRegistrySync as Mock).mockResolvedValue({ pullRegistries });
        pullRegistries.mockRejectedValue(new Error('network down'));
        expect(await crossMachine()).toBe('degraded');
    });

    it('checked when the remote pull succeeds', async () => {
        (resolveRegistrySync as Mock).mockResolvedValue({ pullRegistries });
        pullRegistries.mockResolvedValue([]);
        expect(await crossMachine()).toBe('checked');
    });

    it('text output says the cross-machine registry was not checked and names storage.syncModule', async () => {
        (resolveRegistrySync as Mock).mockResolvedValue(null);
        (conflictsCommand as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};
        await conflictsCommand.parseAsync(['node', 'spidersan', 'conflicts']);
        const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
        expect(out).toContain('No registry overlap');
        expect(out).toContain('not checked (no storage.syncModule configured)');
    });
});
