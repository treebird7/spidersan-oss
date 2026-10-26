/**
 * sp-slemub — sync deletes an orphan only when origin confirms the branch is
 * gone. A missing ref alone only proves "not fetched here".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Branch } from '../src/storage/adapter.js';

const storageMock = {
    isInitialized: vi.fn(async () => true),
    list: vi.fn(async (): Promise<Branch[]> => []),
    unregister: vi.fn(async () => true),
};
let heads: Set<string> | null = null;

vi.mock('../src/storage/index.js', () => ({ getStorage: async () => storageMock }));
vi.mock('../src/lib/activity.js', () => ({ logActivity: vi.fn() }));
vi.mock('../src/lib/git.js', async (orig) => ({
    ...(await orig<typeof import('../src/lib/git.js')>()),
    // No entry has a ref on this machine, so all of them read as orphaned.
    resolveBranchRef: () => null,
    resolveLocalBranchRef: () => null,
    listRemoteHeads: () => heads,
}));

import { syncCommand } from '../src/commands/sync.js';

const b = (name: string, status: Branch['status'] = 'active'): Branch =>
    ({ name, files: [], registeredAt: new Date(0), status });

describe('sync prunes only remote-confirmed orphans (sp-slemub)', () => {
    let logs: string[];
    beforeEach(() => {
        logs = [];
        storageMock.unregister.mockClear();
        vi.spyOn(console, 'log').mockImplementation((m: string) => { logs.push(String(m)); });
        storageMock.list.mockResolvedValue([b('feat/deleted'), b('feat/unfetched'), b('feat/dead', 'abandoned')]);
    });
    afterEach(() => { vi.restoreAllMocks(); });

    const removed = () => storageMock.unregister.mock.calls.map(c => (c as unknown as [string])[0]).sort();

    it('removes an orphan origin no longer has, keeps one origin still has, and always prunes abandoned', async () => {
        heads = new Set(['feat/unfetched', 'feat/dead']);
        await syncCommand.parseAsync(['node', 'sync']);
        expect(removed()).toEqual(['feat/dead', 'feat/deleted']);
        expect(logs.join('\n')).toContain('still on origin (unfetched): feat/unfetched');
    });

    it('keeps every active orphan when origin cannot be asked, and says so', async () => {
        heads = null;
        await syncCommand.parseAsync(['node', 'sync']);
        expect(removed()).toEqual(['feat/dead']);
        expect(logs.join('\n')).toContain('Could not reach origin — kept 2 entries');
    });
});
