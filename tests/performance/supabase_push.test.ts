import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SupabaseStorage } from '../../src/storage/supabase';
import { Branch } from '../../src/storage/adapter';
import { MachineIdentity } from '../../src/types/cloud';

// Mock fetch
const fetchMock = vi.fn();
global.fetch = fetchMock;

describe('SupabaseStorage.pushRegistry Performance', () => {
    let storage: SupabaseStorage;
    const machine: MachineIdentity = {
        id: 'machine-123',
        name: 'test-machine',
        hostname: 'localhost',
        os: 'linux',
        ip: '127.0.0.1'
    };
    const repoName = 'test-repo';
    const repoPath = '/path/to/repo';

    beforeEach(() => {
        fetchMock.mockReset();
        storage = new SupabaseStorage({
            url: 'https://example.supabase.co',
            key: 'test-key',
        });
    });

    it('should use optimized bulk upsert (2 requests) for N branches', async () => {
        const branches: Branch[] = Array.from({ length: 5 }, (_, i) => ({
            name: `branch-${i}`,
            files: ['file1.ts'],
            registeredAt: new Date(),
            status: 'active',
            description: `Branch ${i}`
        }));

        // Mock responses:
        // 1. Check existing branches (GET)
        // 2. Batch Upsert (POST)

        fetchMock.mockImplementation(async (url: string | URL | Request, options?: RequestInit) => {
            const urlStr = url.toString();

            if (urlStr.includes('branch_registry?select=branch_name')) {
                // Return some existing branches to test update count logic
                // Say branch-0 and branch-1 exist
                return {
                    ok: true,
                    json: async () => [
                        { branch_name: 'branch-0' },
                        { branch_name: 'branch-1' }
                    ],
                    text: async () => 'JSON',
                } as Response;
            }

            if (urlStr.includes('branch_registry') && options?.method === 'POST') {
                // Verify payload structure (optional)
                // const payload = JSON.parse(options.body as string);
                // expect(payload).toHaveLength(5);

                return {
                    ok: true,
                    json: async () => [{}],
                    text: async () => '[{}]',
                } as Response;
            }

            return {
                ok: true,
                json: async () => [],
                text: async () => '[]',
            } as Response;
        });

        const result = await storage.pushRegistry(machine, repoName, repoPath, branches);

        // Expect exactly 2 requests:
        // 1. GET (check existing)
        // 2. POST (batch upsert)
        expect(fetchMock).toHaveBeenCalledTimes(2);

        // Verify counts
        // 2 existing (branch-0, branch-1) -> updated
        // 3 new (branch-2, branch-3, branch-4) -> pushed
        expect(result.updated).toBe(2);
        expect(result.pushed).toBe(3);
        expect(result.errors).toHaveLength(0);
    });
});
