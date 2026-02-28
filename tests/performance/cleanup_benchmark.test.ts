import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanupCommand } from '../../src/commands/cleanup.js';
import { getStorage } from '../../src/storage/index.js';
import { SupabaseStorage } from '../../src/storage/supabase.js';

vi.mock('../../src/storage/index.js');

describe('Cleanup Performance', () => {
    let mockStorage: any;

    beforeEach(() => {
        mockStorage = {
            isInitialized: vi.fn().mockResolvedValue(true),
            list: vi.fn(),
            cleanup: vi.fn(),
            unregister: vi.fn(),
        };
        (getStorage as any).mockResolvedValue(mockStorage);
        // intercept console logs
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('should use storage.cleanup instead of unregistering branches one by one', async () => {
        // Setup stale branches
        const oldDate = new Date();
        oldDate.setDate(oldDate.getDate() - 10);

        const staleBranches = Array.from({ length: 100 }).map((_, i) => ({
            name: `stale-branch-${i}`,
            registeredAt: oldDate,
        }));
        const staleBranchNames = staleBranches.map(b => b.name);

        mockStorage.list.mockResolvedValue(staleBranches);
        mockStorage.cleanup.mockResolvedValue(staleBranchNames);

        await cleanupCommand.parseAsync(['node', 'test', 'cleanup']);

        // verify cleanup is called once and unregister is not called
        expect(mockStorage.cleanup).toHaveBeenCalled();
        expect(mockStorage.unregister).not.toHaveBeenCalled();
    });
});
