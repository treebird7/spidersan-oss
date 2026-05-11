import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryBranchRegistryStore } from '../src/storage/memory-branch-registry-store.js';

describe('MemoryBranchRegistryStore', () => {
    let store: MemoryBranchRegistryStore;

    beforeEach(async () => {
        store = new MemoryBranchRegistryStore();
        await store.init();
    });

    it('registers, lists, gets, updates, and unregisters branches in-process', async () => {
        expect(await store.isInitialized()).toBe(true);

        const created = await store.register({
            name: 'feature/storage-split',
            files: ['src/storage/local.ts'],
            status: 'active',
            agent: 'spidersan-m5',
            description: 'storage refactor',
        });

        expect(created.registeredAt).toBeInstanceOf(Date);
        expect(await store.list()).toHaveLength(1);
        expect(await store.get('feature/storage-split')).toMatchObject({
            name: 'feature/storage-split',
            status: 'active',
            agent: 'spidersan-m5',
        });

        const updated = await store.update('feature/storage-split', {
            status: 'completed',
            description: 'done',
            name: 'ignored-rename',
        });

        expect(updated).toMatchObject({
            name: 'feature/storage-split',
            status: 'completed',
            description: 'done',
        });

        expect(await store.unregister('feature/storage-split')).toBe(true);
        expect(await store.get('feature/storage-split')).toBeNull();
    });

    it('finds overlapping branches by file set', async () => {
        await store.register({
            name: 'feature-a',
            files: ['src/a.ts', 'src/shared.ts'],
            status: 'active',
        });
        await store.register({
            name: 'feature-b',
            files: ['src/b.ts'],
            status: 'active',
        });
        await store.register({
            name: 'feature-c',
            files: ['src/shared.ts', 'src/c.ts'],
            status: 'active',
        });

        const matches = await store.findByFiles(['src/shared.ts', 'src/missing.ts']);
        expect(matches.map((branch) => branch.name).sort()).toEqual(['feature-a', 'feature-c']);
    });

    it('cleans up only branches older than the threshold', async () => {
        await store.register({
            name: 'stale-branch',
            files: ['src/old.ts'],
            status: 'active',
        });
        await store.register({
            name: 'fresh-branch',
            files: ['src/new.ts'],
            status: 'active',
        });

        const staleDate = new Date('2026-04-01T00:00:00.000Z');
        const freshDate = new Date('2026-05-10T00:00:00.000Z');
        await store.update('stale-branch', { registeredAt: staleDate });
        await store.update('fresh-branch', { registeredAt: freshDate });

        const removed = await store.cleanup(new Date('2026-05-01T00:00:00.000Z'));

        expect(removed).toEqual(['stale-branch']);
        expect((await store.list()).map((branch) => branch.name)).toEqual(['fresh-branch']);
    });
});
