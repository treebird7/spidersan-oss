import { describe, expect, it, vi } from 'vitest';
import { SupabaseRegistrySyncClientImpl } from '../src/storage/supabase-registry-sync-client-impl.js';
import type { Branch } from '../src/storage/adapter.js';
import type { MachineIdentity } from '../src/types/cloud.js';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

describe('SupabaseRegistrySyncClientImpl', () => {
    const machine: MachineIdentity = {
        id: 'machine-1',
        name: 'm2',
        hostname: 'm2.local',
    };

    it('pushes local branches in bulk and abandons remote branches removed locally', async () => {
        const fetchFn = vi.fn(async (input: string | URL, init?: RequestInit) => {
            const url = String(input);

            if (url.includes('spider_registries?on_conflict=machine_id,repo_name,branch_name')) {
                expect(init?.method).toBe('POST');
                const payload = JSON.parse(String(init?.body)) as Array<{ branch_name: string; project_id: string }>;
                expect(payload.map((row) => row.branch_name)).toEqual(['feature-a', 'feature-b']);
                expect(payload.every((row) => row.project_id === 'default')).toBe(true);
                return jsonResponse([]);
            }

            if (url.includes('&status=eq.active&select=branch_name')) {
                return jsonResponse([
                    { branch_name: 'feature-a' },
                    { branch_name: 'stale-remote' },
                ]);
            }

            if (url.includes('&branch_name=in.(stale-remote)')) {
                expect(init?.method).toBe('PATCH');
                expect(JSON.parse(String(init?.body))).toMatchObject({ status: 'abandoned' });
                return jsonResponse([]);
            }

            throw new Error(`Unexpected request: ${url}`);
        });

        const client = new SupabaseRegistrySyncClientImpl({
            url: 'https://example.supabase.co',
            key: 'test-key',
            fetchFn: fetchFn as typeof fetch,
        });

        const branches: Branch[] = [
            {
                name: 'feature-a',
                files: ['src/a.ts'],
                status: 'active',
                registeredAt: new Date('2026-05-01T00:00:00.000Z'),
            },
            {
                name: 'feature-b',
                files: ['src/b.ts'],
                status: 'completed',
                registeredAt: new Date('2026-05-02T00:00:00.000Z'),
            },
        ];

        const result = await client.push(machine, 'spidersan', '/repo/spidersan', branches);

        expect(result).toEqual({
            pushed: 1,
            updated: 1,
            abandoned: 1,
            errors: [],
        });
        expect(fetchFn).toHaveBeenCalledTimes(3);
    });

    it('pulls and groups remote branch state by machine', async () => {
        const fetchFn = vi.fn(async (input: string | URL) => {
            const url = String(input);
            expect(url).toContain('repo_name=eq.spidersan');
            expect(url).toContain('machine_id=neq.machine-1');

            return jsonResponse([
                {
                    branch_name: 'feature-a',
                    status: 'active',
                    files: ['src/a.ts'],
                    agent: 'agent-a',
                    description: 'first',
                    created_at: '2026-05-01T12:00:00.000Z',
                    synced_at: '2026-05-03T12:00:00.000Z',
                    machine_id: 'remote-1',
                    machine_name: 'i7',
                    hostname: 'i7.local',
                    repo_name: 'spidersan',
                    repo_path: '/repos/spidersan',
                },
                {
                    branch_name: 'feature-b',
                    status: 'merged',
                    files: ['src/b.ts'],
                    agent: null,
                    description: null,
                    created_at: '2026-05-02T12:00:00.000Z',
                    synced_at: '2026-05-04T12:00:00.000Z',
                    machine_id: 'remote-1',
                    machine_name: 'i7',
                    hostname: 'i7.local',
                    repo_name: 'spidersan',
                    repo_path: '/repos/spidersan',
                },
                {
                    branch_name: 'feature-c',
                    status: 'active',
                    files: ['README.md'],
                    agent: 'agent-c',
                    description: null,
                    created_at: '2026-05-02T18:00:00.000Z',
                    synced_at: '2026-05-04T18:00:00.000Z',
                    machine_id: 'remote-2',
                    machine_name: 'mini',
                    hostname: 'mini.local',
                    repo_name: 'spidersan',
                    repo_path: '/repos/spidersan',
                },
            ]);
        });

        const client = new SupabaseRegistrySyncClientImpl({
            url: 'https://example.supabase.co',
            key: 'test-key',
            fetchFn: fetchFn as typeof fetch,
        });

        const machines = await client.pull('spidersan', 'machine-1');

        expect(machines).toHaveLength(2);
        expect(machines[0]).toMatchObject({
            machine_id: 'remote-1',
            machine_name: 'i7',
            last_synced: '2026-05-04T12:00:00.000Z',
        });
        expect(machines[0]?.branches).toHaveLength(2);
        expect(machines[0]?.branches[0]?.registeredAt).toBeInstanceOf(Date);
        expect(machines[0]?.branches[1]).toMatchObject({ status: 'completed' });
    });

    it('detects cross-machine conflicts from pulled registries', async () => {
        const fetchFn = vi.fn(async () => jsonResponse([
            {
                branch_name: 'feature-a',
                status: 'active',
                files: ['src/auth.ts', 'README.md'],
                agent: 'agent-a',
                description: null,
                created_at: '2026-05-01T12:00:00.000Z',
                synced_at: '2026-05-03T12:00:00.000Z',
                machine_id: 'remote-1',
                machine_name: 'i7',
                hostname: 'i7.local',
                repo_name: 'spidersan',
                repo_path: '/repos/spidersan',
            },
            {
                branch_name: 'feature-b',
                status: 'active',
                files: ['src/auth.ts'],
                agent: 'agent-b',
                description: null,
                created_at: '2026-05-02T12:00:00.000Z',
                synced_at: '2026-05-04T12:00:00.000Z',
                machine_id: 'remote-2',
                machine_name: 'mini',
                hostname: 'mini.local',
                repo_name: 'spidersan',
                repo_path: '/repos/spidersan',
            },
            {
                branch_name: 'feature-c',
                status: 'active',
                files: ['README.md'],
                agent: 'agent-c',
                description: null,
                created_at: '2026-05-02T18:00:00.000Z',
                synced_at: '2026-05-04T18:00:00.000Z',
                machine_id: 'remote-3',
                machine_name: 'studio',
                hostname: 'studio.local',
                repo_name: 'spidersan',
                repo_path: '/repos/spidersan',
            },
        ]));

        const client = new SupabaseRegistrySyncClientImpl({
            url: 'https://example.supabase.co',
            key: 'test-key',
            fetchFn: fetchFn as typeof fetch,
        });

        const conflicts = await client.detectCrossMachineConflicts('spidersan');

        expect(conflicts).toHaveLength(2);
        expect(conflicts[0]).toMatchObject({ file: 'src/auth.ts', tier: 3 });
        expect(conflicts[1]).toMatchObject({ file: 'README.md', tier: 1 });
        expect(conflicts[0]?.branches.map((branch) => branch.machine_id).sort()).toEqual(['remote-1', 'remote-2']);
    });
});
