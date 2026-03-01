import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanupCommand } from '../../src/commands/cleanup.js';
import { getStorage } from '../../src/storage/index.js';

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
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('should use storage.cleanup instead of N+1 unregister calls', async () => {
        const oldDate = new Date();
        oldDate.setDate(oldDate.getDate() - 10);

        // list() returns all branches (mix of stale and fresh)
        const staleBranches = Array.from({ length: 100 }, (_, i) => ({
            name: `stale-branch-${i}`,
            registeredAt: oldDate,
            files: [],
            status: 'active',
        }));
        const freshBranch = { name: 'fresh', registeredAt: new Date(), files: [], status: 'active' };
        mockStorage.list.mockResolvedValue([...staleBranches, freshBranch]);

        const staleBranchNames = staleBranches.map(b => b.name);
        mockStorage.cleanup.mockResolvedValue(staleBranchNames);

        await cleanupCommand.parseAsync(['node', 'test', '--days', '7']);

        // cleanup called once with a Date threshold
        expect(mockStorage.cleanup).toHaveBeenCalledOnce();
        expect(mockStorage.cleanup).toHaveBeenCalledWith(expect.any(Date));

        // unregister never called — N+1 pattern eliminated
        expect(mockStorage.unregister).not.toHaveBeenCalled();

        // threshold passed to cleanup is approximately `now - 7 days`
        const [calledThreshold] = mockStorage.cleanup.mock.calls[0];
        const expectedThreshold = new Date();
        expectedThreshold.setDate(expectedThreshold.getDate() - 7);
        expect(Math.abs(calledThreshold.getTime() - expectedThreshold.getTime())).toBeLessThan(5000);
    });

    it('should skip cleanup when no stale branches exist', async () => {
        const freshBranch = { name: 'fresh', registeredAt: new Date(), files: [], status: 'active' };
        mockStorage.list.mockResolvedValue([freshBranch]);

        await cleanupCommand.parseAsync(['node', 'test', '--days', '7']);

        expect(mockStorage.cleanup).not.toHaveBeenCalled();
        expect(mockStorage.unregister).not.toHaveBeenCalled();
    });
});
