import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { JsonBranchRegistryStore } from '../src/storage/json-branch-registry-store.js';

describe('JsonBranchRegistryStore', () => {
    let dir: string;
    let store: JsonBranchRegistryStore;

    beforeEach(async () => {
        dir = mkdtempSync(join(tmpdir(), 'spidersan-store-'));
        store = new JsonBranchRegistryStore(dir);
        await store.init();
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('round-trips a registration', async () => {
        await store.register({ name: 'feat/x', files: ['a.ts'], status: 'active' });
        const got = await store.get('feat/x');
        expect(got?.files).toEqual(['a.ts']);
    });

    it('round-trips dependsOn and prNumber through update', async () => {
        await store.register({ name: 'feat/x', files: ['a.ts'], status: 'active' });
        await store.update('feat/x', { dependsOn: ['feat/base'], prNumber: 7 });

        const fresh = new JsonBranchRegistryStore(dir); // re-read from disk
        const got = await fresh.get('feat/x');
        expect(got?.dependsOn).toEqual(['feat/base']);
        expect(got?.prNumber).toBe(7);
    });

    it('rejects an array-shaped `branches` loudly instead of silently missing every lookup (tb-orpt)', async () => {
        await store.register({ name: 'feat/x', files: ['a.ts'], status: 'active' });
        const registryPath = join(dir, '.spidersan', 'registry.json');
        // The corruption a stray `jq 'map(...)'` edit produces: object → array.
        const corrupt = JSON.stringify({
            version: '1.0',
            branches: [{ name: 'feat/x', files: ['a.ts'], status: 'active', registeredAt: new Date(0).toISOString() }],
        });
        writeFileSync(registryPath, corrupt, 'utf-8');

        await expect(store.list()).rejects.toThrow(/branches.*must be an object/);
        await expect(store.unregister('feat/x')).rejects.toThrow(/branches.*must be an object/);
        // the corrupt file is untouched — nothing saved over it
        expect(readFileSync(registryPath, 'utf-8')).toBe(corrupt);
    });

    it('refuses to operate on a corrupt registry instead of silently wiping it', async () => {
        await store.register({ name: 'feat/x', files: ['a.ts'], status: 'active' });
        const registryPath = join(dir, '.spidersan', 'registry.json');
        writeFileSync(registryPath, '{ truncated-by-crash', 'utf-8');

        await expect(store.register({ name: 'feat/y', files: ['b.ts'], status: 'active' }))
            .rejects.toThrow();
        // the corrupt file is untouched — no empty registry was saved over it
        expect(readFileSync(registryPath, 'utf-8')).toBe('{ truncated-by-crash');
    });
});
