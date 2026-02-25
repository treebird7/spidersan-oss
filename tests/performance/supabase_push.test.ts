import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabaseStorage } from '../../src/storage/supabase.js';

describe('SupabaseStorage Performance', () => {
    let storage: SupabaseStorage;
    const fetchMock = vi.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        // @ts-ignore
        global.fetch = fetchMock;
        storage = new SupabaseStorage({ url: 'https://test.supabase.co', key: 'test' });
    });

    it('pushRegistry should batch requests', async () => {
        const branches = Array.from({ length: 10 }, (_, i) => ({
            name: `branch-${i}`,
            files: [`file-${i}.ts`],
            status: 'active' as const,
            registeredAt: new Date(),
        }));

        const machine = { id: 'm1', name: 'mac', hostname: 'localhost' };

        // Mock responses
        fetchMock.mockImplementation(async (url, options) => {
            // Unoptimized path: Individual checks
            if (url.includes('branch_registry?branch_name=eq')) {
                // Return empty for first 5, existing for next 5 to test both insert and update paths
                 const branchNameMatch = url.match(/branch_name=eq\.([^&]+)/);
                 if (branchNameMatch) {
                     const name = decodeURIComponent(branchNameMatch[1]);
                     const index = parseInt(name.split('-')[1]);
                     if (index >= 5) {
                         return {
                             ok: true,
                             json: async () => ([{ branch_name: name, machine_id: 'm1' }]) // Exists
                         };
                     }
                 }
                 return {
                     ok: true,
                     json: async () => ([]) // Does not exist
                 };
            }

            // Optimized path: Bulk check
            if (url.includes('branch_name=in.')) {
                 return {
                     ok: true,
                     json: async () => branches.slice(5).map(b => ({ branch_name: b.name, machine_id: 'm1' }))
                 };
            }

            // Default success for POST/PATCH
            return {
                ok: true,
                json: async () => ([])
            };
        });

        await storage.pushRegistry(machine, 'repo', '/path', branches);

        const callCount = fetchMock.mock.calls.length;
        console.log(`Fetch called ${callCount} times for ${branches.length} branches`);

        // Expect optimization to reduce calls significantly below 2 * N
        // Ideal: 1 check + 1 insert + 5 updates = 7 calls
        expect(callCount).toBeLessThan(15);
    });
});
