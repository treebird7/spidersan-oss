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
