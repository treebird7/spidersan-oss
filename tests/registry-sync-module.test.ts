import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveRegistrySync, syncModulePath } from '../src/storage/registry-sync.js';

const saved = { HOME: process.env.HOME, MOD: process.env.SPIDERSAN_SYNC_MODULE, cwd: process.cwd() };
let home: string;
let repo: string;

function fakeModule(dir: string, body = "export const createRegistrySyncClient = async () => ({ pull: async () => [{ machine_id: 'fake' }], push: async () => ({}), getStatus: async () => [], detectCrossMachineConflicts: async () => [] });"): string {
    const p = join(dir, 'client.mjs');
    writeFileSync(p, body);
    return p;
}

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'spsn-home-'));
    repo = mkdtempSync(join(tmpdir(), 'spsn-repo-'));
    process.env.HOME = home;
    delete process.env.SPIDERSAN_SYNC_MODULE;
});
afterEach(() => {
    process.env.HOME = saved.HOME;
    if (saved.MOD === undefined) delete process.env.SPIDERSAN_SYNC_MODULE; else process.env.SPIDERSAN_SYNC_MODULE = saved.MOD;
    process.chdir(saved.cwd);
});

describe('storage.syncModule', () => {
    it('a module named in ~/.spidersanrc becomes the sync client', async () => {
        writeFileSync(join(home, '.spidersanrc'), JSON.stringify({ storage: { syncModule: fakeModule(home) } }));
        const s = await resolveRegistrySync();
        expect(await s!.pullRegistries('x')).toEqual([{ machine_id: 'fake' }]);
    });

    it('SPIDERSAN_SYNC_MODULE works too, with ~ expanded', async () => {
        fakeModule(home);
        process.env.SPIDERSAN_SYNC_MODULE = '~/client.mjs';
        expect(await syncModulePath()).toBe(join(home, 'client.mjs'));
    });

    it('a repo-local .spidersanrc can NOT name a module (a cloned repo must not run code)', async () => {
        writeFileSync(join(repo, '.spidersanrc'), JSON.stringify({ storage: { syncModule: fakeModule(repo, 'throw new Error("ran repo code")') } }));
        process.chdir(repo);
        expect(await syncModulePath()).toBeUndefined();
    });

    it('a relative path or a module without the export is refused loudly', async () => {
        process.env.SPIDERSAN_SYNC_MODULE = 'client.mjs';
        await expect(syncModulePath()).rejects.toThrow(/absolute/);
        process.env.SPIDERSAN_SYNC_MODULE = fakeModule(home, 'export const nope = 1;');
        await expect(resolveRegistrySync()).rejects.toThrow(/createRegistrySyncClient/);
    });
});
