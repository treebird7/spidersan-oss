/**
 * `conflicts --json` must say whether other machines were actually consulted.
 * Without this field a plain session (no Supabase creds) reads as "no overlap"
 * even when another machine holds the same file (tb-f4bl3).
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { conflictsCommand } from '../src/commands/conflicts';
import { getStorage } from '../src/storage/index';
import { resolveSupabaseCredentials } from '../src/lib/supabase-credentials';
import { execFileSync } from 'child_process';

const pullRegistries = vi.fn();

vi.mock('../src/storage/index', () => ({ getStorage: vi.fn() }));
vi.mock('../src/lib/config', () => ({ loadConfig: vi.fn(async () => ({})) }));
vi.mock('../src/lib/supabase-credentials', () => ({ resolveSupabaseCredentials: vi.fn() }));
vi.mock('../src/lib/machine', () => ({ loadMachineIdentity: vi.fn(async () => ({ id: 'm-self', name: 'm2', hostname: 'h' })) }));
vi.mock('../src/storage/supabase', () => ({
    SupabaseStorage: class { pullRegistries = pullRegistries; },
}));
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

    it('no-credentials when credential resolution returns null (Supabase never asked)', async () => {
        (resolveSupabaseCredentials as Mock).mockResolvedValue(null);
        expect(await crossMachine()).toBe('no-credentials');
        expect(pullRegistries).not.toHaveBeenCalled();
    });

    it('degraded when the remote pull fails', async () => {
        (resolveSupabaseCredentials as Mock).mockResolvedValue({ url: 'https://x.supabase.co', key: 'k' });
        pullRegistries.mockRejectedValue(new Error('network down'));
        expect(await crossMachine()).toBe('degraded');
    });

    it('checked when the remote pull succeeds', async () => {
        (resolveSupabaseCredentials as Mock).mockResolvedValue({ url: 'https://x.supabase.co', key: 'k' });
        pullRegistries.mockResolvedValue([]);
        expect(await crossMachine()).toBe('checked');
    });
});
