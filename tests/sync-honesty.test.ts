/**
 * tb-orpt — sync must not claim "Removed" when unregister was a no-op.
 *
 * Before this fix, sync ignored storage.unregister()'s boolean and printed
 * "🗑️ Removed" for deletes that never happened (a corrupted registry produced
 * 13 phantom removal lines across 3 runs with zero writes).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Branch } from '../src/storage/adapter.js';

const storageMock = {
    isInitialized: vi.fn(async () => true),
    list: vi.fn(async (): Promise<Branch[]> => []),
    unregister: vi.fn(async () => false),
};

vi.mock('../src/storage/index.js', () => ({
    getStorage: async () => storageMock,
}));
vi.mock('../src/lib/activity.js', () => ({ logActivity: vi.fn() }));
vi.mock('../src/lib/reconcile.js', () => ({
    // Everything the registry lists is stale-orphaned, so sync must try to
    // remove each entry.
    reconcileBranches: (branches: Branch[]) => ({
        live: [],
        merged: [],
        orphaned: branches.map(b => b.name),
    }),
}));

import { syncCommand } from '../src/commands/sync.js';

describe('sync honesty (tb-orpt)', () => {
    let logs: string[];
    let exitCode: number | undefined;

    beforeEach(() => {
        logs = [];
        exitCode = undefined;
        vi.spyOn(console, 'log').mockImplementation((msg: string) => { logs.push(String(msg)); });
        vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            exitCode = code;
            return undefined as never;
        }) as never);
        storageMock.list.mockResolvedValue([
            { name: 'feat/ghost', files: ['x.ts'], registeredAt: new Date(0), status: 'active' },
        ]);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('reports a failed removal instead of claiming "Removed", and exits 1', async () => {
        storageMock.unregister.mockResolvedValue(false);
        await syncCommand.parseAsync(['node', 'sync']);

        const out = logs.join('\n');
        expect(out).not.toContain('Removed (orphaned): feat/ghost');
        expect(out).toContain('Could not remove (orphaned): feat/ghost');
        expect(out).toContain('registry may be corrupt');
        expect(exitCode).toBe(1);
    });

    it('still reports success normally when the delete lands', async () => {
        storageMock.unregister.mockResolvedValue(true);
        await syncCommand.parseAsync(['node', 'sync']);

        const out = logs.join('\n');
        expect(out).toContain('Removed (orphaned): feat/ghost');
        expect(out).toContain('✅ Synced registry with git.');
        expect(exitCode).toBeUndefined();
    });
});
